"""Stan wód w rzece przy działce na tle tych samych dni w poprzednich latach (bez sieci).

Wskaźnik: średni przepływ [m³/s] (albo stan wody [cm], gdy przepływu nie ma) z 7 dni do daty analizy
na najbliższym wodowskazie IMGW-PIB, porównany ze średnią z tych samych 7 dni kalendarzowych
w każdym z poprzednich lat. Do porównania wchodzą wyłącznie lata przed datą analizy.

Klasa wynika z tego, w ilu latach wartość była wyższa niż teraz (porównanie rangowe, bez progów
w m³/s, bo te zależą od wielkości rzeki):
- „very_low”: wyższa w co najmniej 90% lat,
- „low”: wyższa w co najmniej 70% lat,
- „high”: wyższa w co najwyżej 30% lat (czyli niższa w co najmniej 70%),
- „normal”: pozostałe.
Progi 70% i 90% odpowiadają często używanym przepływom granicznym niżówki Q70 i Q90, ale tu liczone są
tylko dla jednego okna w roku, nie z krzywej czasu trwania przepływów, więc to przybliżenie.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

WINDOW_DAYS = 7
MIN_DAYS_IN_WINDOW = 5     # okno z mniejszą liczbą dni z pomiarem uznajemy za brak danych
MIN_YEARS = 5              # mniej lat do porównania = bez oceny
LOW_SHARE = 0.7
VERY_LOW_SHARE = 0.9
HIGH_SHARE = 0.3

CLASS_LABELS = {
    "very_low": "bardzo mało wody w rzece",
    "low": "mniej wody w rzece niż zwykle",
    "normal": "stan wody w rzece typowy dla tej pory roku",
    "high": "więcej wody w rzece niż zwykle",
}


def distance_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Odległość po kuli (EPSG:4326, promień 6371 km). Dokładność wystarcza do wyboru wodowskazu."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def hydro_year_month(day: date) -> tuple[int, int]:
    """Rok hydrologiczny i numer miesiąca w nim (listopad = 1, październik = 12), jak w plikach IMGW."""
    if day.month >= 11:
        return day.year + 1, day.month - 10
    return day.year, day.month + 2


def same_day_in_year(day: date, year: int) -> date:
    """Ten sam dzień kalendarzowy w innym roku (29 lutego → 28 lutego)."""
    try:
        return day.replace(year=year)
    except ValueError:
        return day.replace(year=year, day=28)


def window_days(end: date, days: int = WINDOW_DAYS) -> list[date]:
    return [end - timedelta(days=i) for i in range(days - 1, -1, -1)]


def window_mean(series: dict[date, float], end: date, days: int = WINDOW_DAYS) -> float | None:
    """Średnia z okna kończącego się w `end` albo None, gdy pomiarów jest za mało."""
    values = [series[d] for d in window_days(end, days) if d in series]
    if len(values) < MIN_DAYS_IN_WINDOW:
        return None
    return sum(values) / len(values)


@dataclass
class Comparison:
    current: float
    years: list[tuple[int, float]]   # (rok, średnia z tego samego okna) dla lat przed datą analizy
    years_higher: int                # w ilu latach wartość była wyższa niż teraz
    median: float
    class_key: str

    @property
    def years_compared(self) -> int:
        return len(self.years)


def reference_values(series: dict[date, float], end: date, years_back: int) -> list[tuple[int, float]]:
    """Średnie z tego samego okna w `years_back` latach przed rokiem daty analizy (tylko lata z danymi)."""
    out = []
    for year in range(end.year - years_back, end.year):
        value = window_mean(series, same_day_in_year(end, year))
        if value is not None:
            out.append((year, value))
    return out


def classify_share(share_higher: float) -> str:
    if share_higher >= VERY_LOW_SHARE:
        return "very_low"
    if share_higher >= LOW_SHARE:
        return "low"
    if share_higher <= HIGH_SHARE:
        return "high"
    return "normal"


def compare(current: float, years: list[tuple[int, float]]) -> Comparison | None:
    """Porównanie rangowe bieżącej wartości z latami odniesienia. None, gdy lat jest za mało."""
    if len(years) < MIN_YEARS:
        return None
    values = sorted(v for _, v in years)
    n = len(values)
    median = values[n // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2
    higher = sum(1 for v in values if v > current)
    return Comparison(current=current, years=years, years_higher=higher, median=median,
                      class_key=classify_share(higher / n))


def agreement_with_balance(hydro_class: str, balance_class: str | None, in_season: bool) -> str:
    """Zdanie o zgodności stanu rzeki z bilansem wodnym działki (rzeka opisuje zlewnię, nie pole)."""
    if balance_class is None:
        return "Bez bilansu wodnego działki nie da się porównać stanu rzeki z sytuacją na polu."
    dry_soil = balance_class in ("moderate", "severe")
    if hydro_class in ("low", "very_low"):
        if dry_soil:
            return ("Niski stan rzeki i niedobór w bilansie działki wskazują na to samo: woda w okolicy jest na wyczerpaniu, "
                    "a niedobór nie jest tylko sprawą jednego pola.")
        return ("Rzeka niesie mniej wody niż zwykle, choć bilans działki nie pokazuje teraz niedoboru. To sygnał, że zapasy wody "
                "w okolicy są małe i przy kilku suchych tygodniach niedobór może narastać szybciej.")
    if hydro_class == "high":
        if dry_soil and in_season:
            return ("W rzece jest więcej wody niż zwykle, a bilans działki pokazuje niedobór. Najczęściej oznacza to, że opady "
                    "spadły w innej części zlewni albo woda szybko spłynęła; na polu wody brakuje mimo to.")
        return "Stan rzeki nie wskazuje na suszę w okolicy."
    if dry_soil:
        return ("Stan rzeki jest typowy, więc niedobór dotyczy głównie wody w glebie (susza rolnicza), a nie zasobów wód "
                "w okolicy.")
    return "Stan rzeki nie wskazuje na suszę w okolicy."
