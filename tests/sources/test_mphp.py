"""Najbliższy ciek z odpowiedzi GetFeatureInfo mapy MPHP10k (bez sieci)."""
from shapely.geometry import LineString, box

from app.infra.geo import reproject
from app.sources.mphp import SEARCH_RADIUS_M, nearest, query_params, search_half_m


def _feature(line_2180: LineString, name: str | None) -> dict:
    lonlat = reproject(line_2180, "EPSG:2180", "EPSG:4326")
    return {"geometry": {"type": "LineString", "coordinates": list(lonlat.coords)}, "properties": {"gn_spelling": name}}


PARCEL_2180 = box(500_000, 400_000, 500_200, 400_100)   # 200 × 100 m


def test_nearest_measures_from_parcel_edge_and_keeps_name():
    far = _feature(LineString([(500_500, 399_000), (500_500, 401_000)]), "Daleka")      # 300 m na wschód
    near = _feature(LineString([(499_000, 400_150), (501_000, 400_150)]), "Nędznica")   # 50 m na północ
    node = {"geometry": {"type": "Point", "coordinates": list(reproject(LineString([(500_100, 400_120), (500_100, 400_121)]),
                                                                         "EPSG:2180", "EPSG:4326").coords[0])},
            "properties": {"gn_spelling": None}}   # węzeł sieci 20 m od działki: to nie ciek
    result = nearest([far, near, node, {"geometry": None}], PARCEL_2180)
    assert result.name == "Nędznica" and abs(result.distance_m - 50) < 0.5


def test_nearest_crossing_is_zero_and_outside_radius_is_none():
    crossing = _feature(LineString([(500_100, 399_000), (500_100, 401_000)]), "")
    result = nearest([crossing], PARCEL_2180)
    assert result.distance_m == 0 and result.name is None
    too_far = _feature(LineString([(500_200 + SEARCH_RADIUS_M + 50, 399_000), (500_200 + SEARCH_RADIUS_M + 50, 401_000)]), "X")
    assert nearest([too_far], PARCEL_2180) is None


def test_query_window_covers_radius_with_lat_lon_order():
    c = PARCEL_2180.centroid
    params = query_params(c.x, c.y, search_half_m(PARCEL_2180))
    lat0, lon0, lat1, lon1 = map(float, params["BBOX"].split(","))
    assert 49 < lat0 < lat1 < 55 and 14 < lon0 < lon1 < 25      # WMS 1.3.0 + EPSG:4326: szerokość pierwsza
    window_2180 = reproject(box(lon0, lat0, lon1, lat1), "EPSG:4326", "EPSG:2180")
    assert window_2180.contains(PARCEL_2180.buffer(SEARCH_RADIUS_M))
    assert params["I"] == params["J"] == params["BUFFER"] == params["WIDTH"] // 2 <= 25   # serwer obcina BUFFER do 25 px
