"""Odczyt odpowiedzi zapasowej usługi WFS EGiB bez sieci: kolejność osi, otwory, nazwy."""
import pytest

from app.sources import SourceError, egib_wfs

# Skrócona odpowiedź GetFeature w kształcie zwracanym przez usługę 21.11.2026 (współrzędne: północ, wschód).
SAMPLE = """<?xml version='1.0' encoding="UTF-8" ?>
<wfs:FeatureCollection xmlns:ms="http://mapserver.gis.umn.edu/mapserver"
   xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wfs="http://www.opengis.net/wfs/2.0"
   numberMatched="1" numberReturned="1">
  <wfs:member>
    <ms:dzialki gml:id="dzialki.060910_2.0011.580/2">
      <ms:geom>
        <gml:Polygon gml:id="p1" srsName="urn:ogc:def:crs:EPSG::2180">
          <gml:exterior><gml:LinearRing><gml:posList srsDimension="2">363800 734900 363800 735000 363900 735000 363900 734900 363800 734900</gml:posList></gml:LinearRing></gml:exterior>
          <gml:interior><gml:LinearRing><gml:posList srsDimension="2">363840 734940 363840 734960 363860 734960 363860 734940 363840 734940</gml:posList></gml:LinearRing></gml:interior>
        </gml:Polygon>
      </ms:geom>
      <ms:ID_DZIALKI>060910_2.0011.580/2</ms:ID_DZIALKI>
      <ms:NUMER_DZIALKI>580/2</ms:NUMER_DZIALKI>
      <ms:NAZWA_OBREBU>NIEDRZWICA KOŚCIELNA</ms:NAZWA_OBREBU>
      <ms:NAZWA_GMINY>NIEDRZWICA DUŻA</ms:NAZWA_GMINY>
      <ms:POLE_EWIDENYJNE></ms:POLE_EWIDENYJNE>
    </ms:dzialki>
  </wfs:member>
</wfs:FeatureCollection>"""


def test_parse_reads_north_east_order_and_holes():
    records = egib_wfs.parse_parcels(SAMPLE)
    assert len(records) == 1
    geometry = records[0]["geometry_2180"]
    min_e, min_n, max_e, max_n = geometry.bounds  # po odczycie x = wschód, y = północ
    assert (min_e, min_n, max_e, max_n) == (734900.0, 363800.0, 735000.0, 363900.0)
    assert geometry.area == pytest.approx(100 * 100 - 20 * 20)


def test_finish_gives_lon_lat_in_poland_and_plain_names():
    record = egib_wfs._finish(egib_wfs.parse_parcels(SAMPLE)[0])
    lon, lat = record["geometry"].centroid.x, record["geometry"].centroid.y
    assert 22.3 < lon < 22.4 and 51.0 < lat < 51.2  # okolice Niedrzwicy Kościelnej
    assert record["region"] == "Niedrzwica Kościelna"
    assert record["commune"] == "Niedrzwica Duża"
    assert record["voivodeship"] == "lubelskie"
    assert record["county"] is None


def test_exception_report_and_garbage_raise_source_error():
    with pytest.raises(SourceError):
        egib_wfs.parse_parcels('<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"/>')
    with pytest.raises(SourceError):
        egib_wfs.parse_parcels("<html>Request Rejected")


def test_empty_collection_gives_no_records():
    assert egib_wfs.parse_parcels('<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"/>') == []
