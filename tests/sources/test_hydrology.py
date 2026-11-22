"""Stan rzeki na tle poprzednich lat i odczyt wierszy archiwum IMGW (bez sieci)."""
from datetime import date, timedelta

from app.core import hydrology as h
from app.sources.imgw_hydro import needed_files, parse_archive_line


def test_hydro_year_month_matches_imgw_files():
    # IMGW: listopad = miesiąc 01 roku hydrologicznego następnego roku kalendarzowego, lipiec = 09
    assert h.hydro_year_month(date(2015, 11, 3)) == (2016, 1)
    assert h.hydro_year_month(date(2018, 7, 15)) == (2018, 9)
    assert h.hydro_year_month(date(2018, 10, 31)) == (2018, 12)


def test_window_mean_needs_enough_days():
    end = date(2018, 7, 15)
    series = {end - timedelta(days=i): 2.0 for i in range(4)}
    assert h.window_mean(series, end) is None
    series[end - timedelta(days=4)] = 7.0
    assert h.window_mean(series, end) == 3.0


def test_compare_uses_only_previous_years_and_ranks():
    end = date(2018, 7, 15)
    series = {}
    for year, flow in zip(range(2008, 2019), [5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 0.5]):
        for d in h.window_days(h.same_day_in_year(end, year)):
            series[d] = flow
    years = h.reference_values(series, end, 10)
    assert [y for y, _ in years] == list(range(2008, 2018))   # rok analizy nie wchodzi do odniesienia
    result = h.compare(h.window_mean(series, end), years)
    assert result.years_higher == 10 and result.class_key == "very_low"
    assert h.compare(9.5, years).class_key == "normal"
    assert h.compare(20.0, years).class_key == "high"


def test_compare_needs_five_years():
    assert h.compare(1.0, [(2015, 1.0), (2016, 2.0), (2017, 3.0), (2018, 4.0)]) is None


def test_feb_29_maps_to_feb_28():
    assert h.same_day_in_year(date(2024, 2, 29), 2023) == date(2023, 2, 28)


def test_parse_archive_line_all_formats():
    old = '" 151220070","LUBLIN","Bystrzyca (246)","2018","07","01",266,2.810,99.9,"05"'
    y2023 = "﻿149180020;CHAŁUPKI;Odra (1);2023;01;01;88;14.200;99.9;11"
    y2024 = '"149180020,CHAŁUPKI,Odra (1),""2024"",""01"",""01"",113,25.400,,""11"""'
    y2025 = '"151220070",LUBLIN,Bystrzyca (246),"2025","03","01",273,,,"01"'
    assert parse_archive_line(old) == ("151220070", date(2018, 5, 1), 266.0, 2.81)
    assert parse_archive_line(y2023) == ("149180020", date(2022, 11, 1), 88.0, 14.2)
    assert parse_archive_line(y2024) == ("149180020", date(2023, 11, 1), 113.0, 25.4)
    assert parse_archive_line(y2025) == ("151220070", date(2025, 1, 1), 273.0, None)


def test_needed_files_monthly_then_yearly():
    files = needed_files(date(2024, 7, 15), 10)
    assert "codz_2014_09.zip" in files and "codz_2022_09.zip" in files
    assert "codz_2023.zip" in files and "codz_2024.zip" in files
    assert files["codz_2014_09.zip"] == 2014
