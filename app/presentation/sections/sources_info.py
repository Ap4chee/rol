"""Opisy źródeł danych do tabeli „Źródła” raportu: nazwy, licencje, rozdzielczość i wpływ braku na wniosek.

Tu są tylko teksty i puste wpisy SourceInfo. Status, czasy i powody błędów uzupełnia app/services/source_gatherer.py.
"""
from __future__ import annotations

from datetime import date

from app.core.textfmt import fmt, fmt_date, plural_days
from app.schemas import SourceInfo, Status
from app.sources import egib_wfs, imgw_hydro, mphp, sentinel, soilgrids, weather
from app.sources import soil_moisture as moisture_source

SOIL_ASSUMED_IMPACT = ("Bilans policzono dla gleby umownej (glina: 40% piasku, 20% iłu). Wynik jest orientacyjny, "
                       "a wpływu gleby na niedobór nie da się ocenić.")
SATELLITE_NO_IMPACT = ("Bilans wodny nie zależy od zdjęć: brakuje tylko niezależnego potwierdzenia, "
                       "czy rośliny reagują tak, jak pokazuje bilans.")
HYDRO_NO_IMPACT = ("Bilans wodny działki nie zależy od danych z wodowskazu: brakuje tylko niezależnej informacji, "
                   "czy w rzekach okolicy jest mało wody.")
WATERCOURSE_NO_IMPACT = ("Bez mapy cieków raport nie sprawdza, czy działka leży przy cieku, więc nie podpowie pasa "
                         "roślinności wzdłuż brzegu.")
MOISTURE_NO_IMPACT = ("Bilans wodny działki nie zależy od tych danych: brakuje tylko niezależnego porównania wilgotności "
                      "warstw gleby w okolicy z poprzednimi latami.")
NO_TERRAIN_IMPACT = ("Bez modelu terenu raport nie ocenia spadku ani dróg spływu. "
                     "Bilans wodny i pozostałe rekomendacje nie zależą od tego źródła.")
PARCEL_POINT_ONLY_IMPACT = ("Raport policzono dla wskazanego punktu, bez granicy działki: nie ma powierzchni, "
                            "wskaźników satelitarnych dla pola ani analizy spływu.")
PARCEL_FALLBACK_REASON = ("ULDK nie odpowiadało, więc granicę działki pobrano z zapasowej usługi GUGiK "
                          "(zbiorczy WFS ewidencji gruntów i budynków). Ta usługa nie podaje nazwy powiatu.")

SOIL_SOURCE_NAME = "ISRIC SoilGrids 250 m v2.0"
SATELLITE_SOURCE_NAME = "Sentinel-2 L2A (Copernicus) przez Earth Search STAC (Element 84)"
HYDRO_SOURCE_NAME = "IMGW-PIB: wodowskazy (API danych publicznych i archiwum danych dobowych)"
WATERCOURSE_SOURCE_NAME = "Mapa Podziału Hydrograficznego Polski MPHP10k (Wody Polskie, ISOK)"


def parcel_source() -> SourceInfo:
    return SourceInfo(
        key="uldk", name="ULDK GUGiK (Usługa Lokalizacji Działek Katastralnych)", status=Status.ok,
        resolution="granica działki ewidencyjnej (wektor)", url="https://uldk.gugik.gov.pl/",
        license="dane państwowego zasobu geodezyjnego udostępniane bezpłatnie (szczegóły w README)",
        data_date="stan ewidencji w dniu pobrania")


def mark_parcel_fallback(info: SourceInfo) -> None:
    """Granica przyszła z zapasowego WFS ewidencji, a nie z ULDK."""
    info.name = egib_wfs.SOURCE_NAME
    info.url = egib_wfs.WFS_URL
    info.reason = PARCEL_FALLBACK_REASON


def soil_source() -> SourceInfo:
    return SourceInfo(
        key="soil", name=SOIL_SOURCE_NAME, status=Status.ok, resolution="siatka 250 m, sześć warstw do 200 cm",
        license="CC BY 4.0", url="https://www.isric.org/explore/soilgrids",
        data_date="mapa globalna z modelu (wersja 2.0, 2020), nie pomiar na polu")


def satellite_source() -> SourceInfo:
    return SourceInfo(
        key="satellite", name=SATELLITE_SOURCE_NAME, status=Status.ok,
        resolution="piksel 20 m (B8A, B11, maska SCL); B04 z 10 m uśrednione do 20 m",
        license="dane Copernicus Sentinel: dostęp bezpłatny, pełny i otwarty",
        url="https://earth-search.aws.element84.com/v1")


def hydrology_source() -> SourceInfo:
    return SourceInfo(
        key="hydrology", name=HYDRO_SOURCE_NAME, status=Status.ok,
        resolution=f"pomiar na wodowskazie (najbliższy w promieniu {imgw_hydro.MAX_DISTANCE_KM:.0f} km od działki)",
        license="dane IMGW-PIB, bezpłatne z obowiązkiem podania źródła (szczegóły w README)",
        url="https://danepubliczne.imgw.pl/", notes=[imgw_hydro.ATTRIBUTION])


def watercourse_source() -> SourceInfo:
    return SourceInfo(
        key="watercourses", name=WATERCOURSE_SOURCE_NAME, status=Status.ok,
        resolution=f"skala 1:10 000, cieki do {fmt(mphp.SEARCH_RADIUS_M)} m od działki",
        url="https://isok.gov.pl/inspire.html",
        license="usługa WMS: brak warunków dostępu i użytkowania; zbiór na dane.gov.pl: CC BY 4.0",
        notes=["Geometria cieków z publicznej usługi WMS (zapytanie GetFeatureInfo), bez logowania."])


def moisture_source_info() -> SourceInfo:
    return SourceInfo(key="soil_moisture", name=moisture_source.SOURCE_NAME, status=Status.ok,
                      resolution=moisture_source.RESOLUTION, license=moisture_source.LICENSE, url=moisture_source.URL)


def terrain_source(status: Status, reason: str | None = None, elapsed_s: float | None = None,
                   notes: list[str] | None = None, from_cache: bool = False) -> SourceInfo:
    return SourceInfo(
        key="terrain", name="Numeryczny model terenu GUGiK (NMT, arkusze GeoTIFF)", status=status, reason=reason,
        impact=None if status == Status.ok else NO_TERRAIN_IMPACT, resolution="siatka 1 m, układ PL-1992 (EPSG:2180)",
        data_date="stan zasobu GUGiK w dniu pobrania (pomiary lotnicze z różnych lat)",
        license="dane państwowego zasobu geodezyjnego udostępniane bezpłatnie",
        url="https://www.geoportal.gov.pl/pl/dane/numeryczny-model-terenu-nmt/", elapsed_s=elapsed_s,
        from_cache=from_cache, notes=notes or [])


def weather_sources(result: weather.WeatherResult) -> list[SourceInfo]:
    """Jeden wpis na każdą próbę pobrania pogody, także nieudaną, z wpływem braku na wynik."""
    out: list[SourceInfo] = []
    for attempt in result.attempts:
        meta = weather.PROVIDERS[attempt.provider]
        recent = attempt.provider == "open_meteo_forecast"
        info = SourceInfo(
            key="weather_recent" if recent else "weather", name=meta["name"],
            status=Status.ok if attempt.ok else Status.error, reason=attempt.reason,
            resolution=meta["resolution"], license=meta["license"], url=meta["url"],
            data_from=attempt.data_from, data_to=attempt.data_to,
            from_cache=attempt.from_cache, elapsed_s=attempt.elapsed_s, notes=list(attempt.notes))
        if not attempt.ok:
            if recent:
                info.impact = "Bilans kończy się na ostatnim dniu archiwum, kilka dni przed datą analizy."
            elif result.series is not None:
                info.impact = "Bez wpływu na wynik: użyto drugiego dostawcy pogody."
            else:
                info.impact = "Bez pogody nie da się policzyć bilansu wodnego ani oceny niedoboru."
        elif attempt.provider == result.provider:
            info.notes.append("Cała wieloletnia seria pochodzi z tego jednego dostawcy.")
            if result.interpolated_et0_days or result.missing_rain_days:
                info.notes.append(
                    f"Braki w środku serii: ET0 uzupełniono interpolacją w {plural_days(result.interpolated_et0_days)}, "
                    f"opad przyjęto jako 0 mm w {plural_days(result.missing_rain_days)}.")
        out.append(info)
    return out


def river_name(river: str) -> str:
    """„Bystrzyca (246)” → „Bystrzyca” (w nawiasie jest kod IMGW, rolnikowi niepotrzebny)."""
    return river.split(" (")[0].strip() if river else river


def describe_soil(info: SourceInfo, data: soilgrids.SoilData) -> None:
    info.from_cache = data.from_cache
    info.notes = [f"Sposób pobrania: {data.method_label}.", *data.notes,
                  *[f"Nieudana próba – {a}" for a in data.attempts]]


def describe_hydrology(info: SourceInfo, result: imgw_hydro.HydroResult) -> None:
    info.from_cache = result.from_cache
    info.resolution = (f"wodowskaz {result.station.name} ({river_name(result.station.river)}), "
                       f"{fmt(result.station.distance_km)} km od działki")
    years = [y for y, _ in result.comparison.years]
    info.data_from = date(min(years), 1, 1) if years else None
    info.data_to = result.current_to
    info.data_date = ("bieżący pomiar z " + fmt_date(result.current_to) if result.origin == "live"
                      else f"archiwum dobowe do {fmt_date(result.archive_to)}" if result.archive_to else None)
    info.notes += result.notes


def describe_satellite(info: SourceInfo, result: sentinel.SatelliteResult) -> None:
    info.data_from, info.data_to = result.window_from, result.window_to
    info.from_cache = result.cached_observations == result.scenes_found and result.scenes_found > 0
    info.notes = [f"Sceny w oknie 45 dni: {result.scenes_found}. Czas: szukanie {fmt(result.timings_s.get('search', 0), 1)} s, "
                  f"maski chmur {fmt(result.timings_s.get('scl', 0), 1)} s, pasma {fmt(result.timings_s.get('bands', 0), 1)} s.",
                  *result.notes]


def describe_moisture(info: SourceInfo, series: dict[str, dict[date, float]], from_cache: bool) -> None:
    info.from_cache = from_cache
    days = [d for values in series.values() for d in values]
    info.data_from, info.data_to = min(days), max(days)
