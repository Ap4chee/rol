"""ReportBuilder na podstawionych źródłach (bez sieci): kolejność sekcji, opis braków, raport bez pogody."""
import asyncio
import time
from datetime import date, timedelta

import numpy as np
import pytest

from app.core.dates import AnalysisWindow, InvalidAnalysisDate
from app.core.water_balance import CLASS_KEYS
from app.presentation.sections import sources_info
from app.schemas import Point, ReportRequest, Status
from app.services.report_builder import ReportBuilder
from app.services.source_gatherer import SatelliteJob, SourceBundle, SourceGatherer
from app.sources.weather import Attempt, DailyWeather, WeatherResult

TODAY = date(2026, 11, 22)
REQUEST = ReportRequest(point=Point(lon=22.5, lat=51.2), crop="winter_wheat", date=date(2025, 6, 20))


def synthetic_weather(window: AnalysisWindow, dry_from: date | None = None) -> WeatherResult:
    """Pogoda umowna: 4 mm opadu co drugi dzień, ET0 według pory roku; od `dry_from` bez opadu."""
    days = (window.end - window.start).days + 1
    dates = [window.start + timedelta(days=i) for i in range(days)]
    doy = np.array([d.timetuple().tm_yday for d in dates])
    et0 = 0.5 + 3.5 * np.clip(np.sin(np.pi * (doy - 60) / 245), 0, None)
    rain = np.where(np.arange(days) % 2 == 0, 4.0, 0.0)
    if dry_from is not None:
        rain[[i for i, d in enumerate(dates) if d >= dry_from]] = 0.0
    series = DailyWeather(dates=dates, rain_mm=rain, et0_mm=et0, tmin_c=np.full(days, 10.0),
                          tmax_c=np.full(days, 22.0), origin=["open_meteo_archive"] * days)
    attempt = Attempt(provider="open_meteo_archive", ok=True, data_from=dates[0], data_to=dates[-1])
    return WeatherResult(series=series, provider="open_meteo_archive", attempts=[attempt])


class FakeGatherer(SourceGatherer):
    """Źródła bez sieci: działka jako sam punkt, pogoda umowna, pozostałe źródła bez danych."""

    def __init__(self, weather=None, dry_from: date | None = None) -> None:
        super().__init__()
        self.weather, self.dry_from = weather, dry_from
        self.calls = 0

    async def gather(self, request, window, today, satellite_budget_s, progress) -> SourceBundle:
        self.calls += 1
        weather = self.weather or synthetic_weather(window, self.dry_from)
        missing = Status.no_data
        infos = [sources_info.soil_source(), sources_info.hydrology_source(), sources_info.watercourse_source(),
                 sources_info.moisture_source_info()]
        for info in infos:
            info.status, info.reason = missing, "brak w teście"
        parcel_info = sources_info.parcel_source()
        parcel_info.status = Status.error
        return SourceBundle(
            parcel=None, lon=request.point.lon, lat=request.point.lat, weather=weather, soil=None, hydrology=None,
            watercourse=None, moisture=None, forecast=None, forecast_reason="w teście bez prognozy", ifs=None,
            ifs_reason=None, parcel_info=parcel_info, soil_info=infos[0], hydrology_info=infos[1],
            watercourse_info=infos[2], moisture_info=infos[3], satellite=SatelliteJob(None, time.perf_counter()))


def build(gatherer, request=REQUEST, **kwargs):
    return asyncio.run(ReportBuilder(gatherer).build(request, today=TODAY, **kwargs))


def test_report_from_fake_sources_has_all_sections_in_order():
    stages: dict[str, str] = {}
    report = build(FakeGatherer(), progress=stages.__setitem__)
    assert report.water_status.status == Status.ok
    assert report.water_status.class_key in CLASS_KEYS
    assert [s.key for s in report.sources] == [
        "uldk", "weather", "soil", "satellite", "hydrology", "soil_moisture", "watercourses", "land_use"]
    assert report.land_use.status == Status.no_data and "gruntem rolnym" in report.limitations[0]
    assert report.soil.assumed and report.limitations[1].startswith("Brak danych o glebie")
    assert report.satellite.status == Status.no_data and report.terrain.status == Status.no_data
    assert report.history.status == Status.ok and len(report.history.seasons) >= 3
    assert report.recommendations.status == Status.ok
    assert report.water_status.forecast_reason == "w teście bez prognozy" and report.water_status.ml_forecast is None
    assert stages["balance"] == "done" and stages["recommendations"] == "running"


def test_long_drought_shows_deficit_and_rain_cause():
    report = build(FakeGatherer(dry_from=date(2025, 4, 1)))
    assert report.water_status.class_key in ("moderate", "severe")
    assert "rain_deficit" in [c.key for c in report.causes.items]
    assert report.recommendations.retention or report.recommendations.agrotechnical


def test_without_weather_report_says_why_and_skips_dependent_sections():
    no_weather = WeatherResult(series=None, provider=None,
                               attempts=[Attempt(provider="open_meteo_archive", ok=False, reason="HTTP 429")])
    report = build(FakeGatherer(weather=no_weather))
    assert report.water_status.status == Status.error
    assert report.recommendations.status == Status.no_data
    assert report.summary == report.limitations
    assert [s.key for s in report.sources][-5:] == [
        "satellite", "hydrology", "watercourses", "soil_moisture", "land_use"]
    assert "Bez pogody" in report.sources[1].impact


def test_future_date_is_rejected_before_any_source_is_asked():
    gatherer = FakeGatherer()
    request = REQUEST.model_copy(update={"date": TODAY + timedelta(days=1)})
    with pytest.raises(InvalidAnalysisDate):
        build(gatherer, request)
    assert gatherer.calls == 0
