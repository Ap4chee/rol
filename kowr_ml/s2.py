"""Obserwacje pól z Sentinel-2 L2A (Earth Search), zgodnie ze specyfikacją, sekcja 3, i tak jak liczy aplikacja.

Sceny z obu kolekcji (`sentinel-2-c1-l2a` ma pierwszeństwo, `sentinel-2-l2a` uzupełnia lata 2017, 2018 i 2022),
łączone po satelicie, dniu i kaflu jak w app/sources/sentinel.py. Reflektancja = DN · scale + offset z `raster:bands`;
gdy scena ma `earthsearch:boa_offset_applied = true`, przesunięcie jest już odjęte w pikselach i offset = 0.

Pętla po scenach, nie po polach: dla każdej sceny czytamy jedno okno obejmujące całe skupisko,
najpierw SCL, a pasma B8A (nir08), B11 (swir16) i B04 (red) tylko gdy choć jedno pole przeszło próg.
Reguły: środek piksela w polu, SCL = 4, DN = 0 to NoData, odrzucamy niefinitywne i ujemne reflektancje
oraz mianownik ≤ 1e-6, próg ≥ 6 ważnych pikseli i ≥ 65% środków pikseli pola. Wartość pola to mediana.
B04 (10 m) uśredniamy blokami 2 × 2 do siatki 20 m.

Wynik: obs/<skupisko>_<rok>.parquet, wiersz na (pole, scena) dla pól, które scena obejmuje:
field_id, scene_id, collection, platform, date (doba Europe/Warsaw), total_px, valid_px, liczby pikseli klas SCL
(n_veg, n_bare, n_cloud, n_water, n_snow, n_nodata), ndmi (NaN = obserwacja odrzucona), ndmi_iqr, ndvi,
mediany reflektancji nir_med, swir_med, red_med.

Użycie: python -m kowr_ml.s2 [procesy] [sezon,sezon,...] [skupisko,skupisko,...]
"""
from __future__ import annotations

import sys
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from shapely import wkt as shp_wkt
from shapely.geometry import box, mapping
from shapely.ops import transform as shp_transform

from . import config as C

WARSAW = ZoneInfo("Europe/Warsaw")
GDAL_OPTIONS = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_TIMEOUT": "60",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "VSI_CACHE": "TRUE",
}
WORKERS = 48        # wątki na skupisko i sezon (odczyty zakresowe z S3)
PROCESSES = 10      # skupiska i sezony liczone równolegle
WINDOW_PAD_M = 40   # zapas okna rastra wokół pól skupiska (dwa piksele 20 m)
SCL_GROUPS = {"n_veg": (C.SCL_VEGETATION,), "n_bare": (C.SCL_BARE_SOIL,), "n_cloud": C.SCL_CLOUDY, "n_water": (6,),
              "n_snow": (11,), "n_nodata": (0,)}
VALUE_COLUMNS = ("ndmi", "ndmi_iqr", "ndvi", "nir_med", "swir_med", "red_med")
COLUMNS = ["field_id", "scene_id", "collection", "platform", "date", "total_px", "valid_px", *SCL_GROUPS, *VALUE_COLUMNS]


def tile_of(scene_id: str) -> str:
    """Kafel MGRS z identyfikatora sceny, np. 34UEB (oba formaty: S2A_T34UEB_… i S2B_34UEB_…)."""
    for part in scene_id.split("_"):
        if len(part) in (5, 6) and part[-5:-3].isdigit() and part[-3:].isalpha():
            return part[-5:]
    return ""


def scene_items(cluster_bbox_4326: tuple, season: int) -> list[dict]:
    from pystac_client import Client

    last_error = None
    for attempt in range(4):
        try:
            client = Client.open(C.STAC_URL)
            merged: dict = {}
            for collection in C.S2_COLLECTIONS:
                search = client.search(collections=[collection], intersects=mapping(box(*cluster_bbox_4326)),
                                       datetime=f"{season}-{C.S2_MONTHS[0]}/{season}-{C.S2_MONTHS[1]}", limit=200)
                for item in search.items():
                    # W `sentinel-2-l2a` przesunięcie reflektancji jest już odjęte w pikselach, także gdy flaga
                    # `earthsearch:boa_offset_applied` mówi inaczej (opis w app/sources/sentinel.py).
                    offset_applied = (collection == "sentinel-2-l2a"
                                      or bool(item.properties.get("earthsearch:boa_offset_applied")))
                    assets, ok = {}, True
                    for key, name in (("scl", "scl"), ("nir", "nir08"), ("swir", "swir16"), ("red", "red")):
                        a = item.assets.get(name)
                        rb = ((a.extra_fields.get("raster:bands") or [{}])[0]) if a is not None else {}
                        if a is None or (key != "scl" and "scale" not in rb):
                            ok = False   # bez skali z metadanych nie zgadujemy reflektancji (jak aplikacja)
                            break
                        assets[key] = {"href": a.href, "scale": float(rb.get("scale", 1.0)),
                                       "offset": 0.0 if offset_applied else float(rb.get("offset", 0.0) or 0.0),
                                       "nodata": float(rb.get("nodata", 0) or 0)}
                    if not ok:
                        continue
                    platform = str(item.properties.get("platform", ""))
                    key = (platform, item.datetime.date().isoformat(), tile_of(item.id))
                    merged.setdefault(key, {"id": item.id, "collection": collection, "platform": platform,
                                            "date": item.datetime.astimezone(WARSAW).date().isoformat(), **assets})
            return list(merged.values())
        except Exception as e:  # sieć albo katalog STAC: ponawiamy
            last_error = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Earth Search STAC nie odpowiada: {last_error!r}")


class ClusterGeometry:
    """Pola skupiska w układzie danej sceny; etykiety pikseli 20 m liczone raz na (układ, okno)."""

    def __init__(self, fields: pd.DataFrame):
        self.field_ids = fields["field_id"].tolist()
        self.polys = [shp_wkt.loads(w) for w in fields["wkt"]]
        self.bbox = tuple(float(v) for v in shapely.total_bounds(self.polys))
        self._cache: dict = {}

    def labels(self, ds):
        from rasterio.features import rasterize
        from rasterio.windows import from_bounds

        crs = ds.crs.to_string()
        key = (crs, tuple(ds.transform)[:6])
        if key not in self._cache:
            tr = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
            polys = [shp_transform(tr.transform, p) for p in self.polys]
            bounds = shapely.total_bounds(polys) + np.array([-1, -1, 1, 1]) * WINDOW_PAD_M
            win = from_bounds(*bounds, ds.transform).round_offsets().round_lengths()
            wt = ds.window_transform(win)
            lab = rasterize([(mapping(p), i + 1) for i, p in enumerate(polys)],
                            out_shape=(int(win.height), int(win.width)), transform=wt, fill=0,
                            all_touched=False, dtype="int32")
            self._cache[key] = (win, lab)
        return self._cache[key]


def _read(href: str, geom: ClusterGeometry):
    """Okno pasma 20 m obejmujące skupisko: wartości, etykiety pól, okno i początek siatki sceny."""
    import rasterio
    with rasterio.open(href) as ds:
        win, lab = geom.labels(ds)
        arr = ds.read(1, window=win, boundless=True, fill_value=0)
        origin = (ds.transform.c, ds.transform.f, ds.transform.a)
    return arr, lab, win, origin


def _read_on_20m_grid(asset: dict, win, origin) -> np.ndarray:
    """Reflektancja pasma na siatce 20 m sceny; pasmo 10 m uśredniamy blokami 2 × 2 (brak danych unieważnia piksel)."""
    import rasterio
    from rasterio.windows import Window
    with rasterio.open(asset["href"]) as ds:
        factor = int(round(origin[2] / ds.transform.a))
        if factor < 1 or abs(ds.transform.c - origin[0]) > 1e-6 or abs(ds.transform.f - origin[1]) > 1e-6:
            raise RuntimeError("pasmo ma inną siatkę niż SCL")
        dn = ds.read(1, window=Window(int(win.col_off) * factor, int(win.row_off) * factor,
                                      int(win.width) * factor, int(win.height) * factor), boundless=True, fill_value=0)
    value = dn.astype("float64") * asset["scale"] + asset["offset"]
    value[dn == asset["nodata"]] = np.nan
    if factor > 1:
        value = value.reshape(int(win.height), factor, int(win.width), factor).mean(axis=(1, 3))
    return value


def process_scene(scene: dict, geom: ClusterGeometry) -> list[dict]:
    import rasterio

    with rasterio.Env(**GDAL_OPTIONS):
        scl, lab, win, origin = _read(scene["scl"]["href"], geom)
        n = len(geom.field_ids) + 1
        total = np.bincount(lab.ravel(), minlength=n)
        counts = {name: np.bincount(lab[np.isin(scl, codes)].ravel(), minlength=n) for name, codes in SCL_GROUPS.items()}
        # Piksele poza zasięgiem danych sceny (SCL = 0, NoData) nie liczą się do pola: pole na skraju
        # kafla jest wtedy częściowo poza sceną i odrzucamy je, jeśli to, co zostaje, jest za małe.
        veg = scl == C.SCL_VEGETATION
        valid = counts["n_veg"]
        candidate = (valid >= C.MIN_PIXELS) & (valid >= C.MIN_COVERAGE * total) & (total >= C.MIN_PIXELS)
        candidate[0] = False
        values = {k: np.full(n, np.nan) for k in VALUE_COLUMNS}
        valid_final = np.zeros(n, dtype=int)
        if candidate.any():
            nir, _, _, _ = _read(scene["nir"]["href"], geom)
            swir, _, _, _ = _read(scene["swir"]["href"], geom)
            if nir.shape != scl.shape or swir.shape != scl.shape:
                raise RuntimeError(f"niezgodna siatka pasm w {scene['id']}")
            ok = veg & (nir != scene["nir"]["nodata"]) & (swir != scene["swir"]["nodata"])
            rn = nir.astype("float64") * scene["nir"]["scale"] + scene["nir"]["offset"]
            rs = swir.astype("float64") * scene["swir"]["scale"] + scene["swir"]["offset"]
            den = rn + rs
            ok &= np.isfinite(rn) & np.isfinite(rs) & (rn >= 0) & (rs >= 0) & (den > C.MIN_DENOMINATOR)
            with np.errstate(invalid="ignore", divide="ignore"):
                ndmi = (rn - rs) / den
            try:
                rr = _read_on_20m_grid(scene["red"], win, origin)
                if rr.shape != scl.shape:
                    rr = None
            except Exception:   # brak NDVI nie unieważnia NDMI (jak w aplikacji)
                rr = None
            for f in np.flatnonzero(candidate):
                sel = (lab == f) & ok
                v = ndmi[sel]
                valid_final[f] = v.size
                if v.size >= C.MIN_PIXELS and v.size >= C.MIN_COVERAGE * total[f]:
                    values["ndmi"][f] = float(np.median(v))
                    q25, q75 = np.percentile(v, [25, 75])
                    values["ndmi_iqr"][f] = float(q75 - q25)
                    a = rn[sel]
                    values["nir_med"][f] = float(np.median(a))
                    values["swir_med"][f] = float(np.median(rs[sel]))
                    if rr is not None:
                        r = rr[sel]
                        okv = np.isfinite(r) & (r >= 0) & ((a + r) > C.MIN_DENOMINATOR)
                        if okv.sum() >= C.MIN_PIXELS:
                            values["ndvi"][f] = float(np.median((a[okv] - r[okv]) / (a[okv] + r[okv])))
                            values["red_med"][f] = float(np.median(r[okv]))
    rows = []
    for f in np.flatnonzero(total[1:] > 0) + 1:
        row = {"field_id": geom.field_ids[f - 1], "scene_id": scene["id"], "collection": scene["collection"],
               "platform": scene["platform"], "date": scene["date"], "total_px": int(total[f]),
               "valid_px": int(valid_final[f] if candidate[f] else valid[f])}
        row.update({name: int(c[f]) for name, c in counts.items()})
        row.update({k: values[k][f] for k in VALUE_COLUMNS})
        rows.append(row)
    return rows


def run_cluster_season(cluster: str, season: int) -> str:
    out_dir = C.DATA_DIR / "obs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{cluster}_{season}.parquet"
    if out.exists():
        return f"{cluster} {season}: już jest"
    fields = pd.read_parquet(C.DATA_DIR / "fields.parquet")
    fields = fields[fields["cluster"] == cluster]
    if fields.empty:
        return f"{cluster} {season}: skupisko bez pól"
    geom = ClusterGeometry(fields)
    t0 = time.time()
    scenes = scene_items(geom.bbox, season)
    rows, failed = [], []
    with ThreadPoolExecutor(WORKERS) as pool:
        futs = {pool.submit(process_scene, s, geom): s for s in scenes}
        for fut in as_completed(futs):
            try:
                rows.extend(fut.result())
            except Exception as e:  # zapisujemy i idziemy dalej; scenę można dociągnąć ponownym uruchomieniem
                failed.append({"scene_id": futs[fut]["id"], "error": repr(e)[:300]})
    df = pd.DataFrame(rows, columns=COLUMNS)
    tmp = out.with_suffix(".tmp")
    df.to_parquet(tmp, index=False)
    tmp.rename(out)
    if failed:
        pd.DataFrame(failed).to_csv(out_dir / f"{cluster}_{season}_failed.csv", index=False)
    return (f"{cluster} {season}: scen {len(scenes)}, błędów {len(failed)}, wierszy {len(df)}, "
            f"zaakceptowanych {int(df['ndmi'].notna().sum())}, {time.time() - t0:.0f} s")


def _job(args: tuple[str, int]) -> str:
    try:
        return run_cluster_season(*args)
    except Exception as e:
        return f"{args[0]} {args[1]}: BŁĄD {e!r}"


def main(argv: list[str]) -> None:
    processes = int(argv[0]) if argv else PROCESSES
    seasons = tuple(int(s) for s in argv[1].split(",")) if len(argv) > 1 else C.SEASONS
    clusters = argv[2].split(",") if len(argv) > 2 else [c[0] for c in C.CLUSTERS]
    jobs = [(c, s) for s in seasons for c in clusters]
    t0 = time.time()
    with ProcessPoolExecutor(processes) as pool:
        for i, fut in enumerate(as_completed([pool.submit(_job, j) for j in jobs]), 1):
            print(f"[{i}/{len(jobs)}, {time.time() - t0:.0f} s] {fut.result()}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
