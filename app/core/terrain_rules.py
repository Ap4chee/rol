"""Wnioski z ukształtowania terenu: przyczyny strat wody i działania retencyjne związane ze spływem.

Wejściem są wartości policzone z numerycznego modelu terenu dla tej działki (app/sources/terrain.py).
Powierzchnia zasilająca punkt to nie objętość wody i powierzchni punktów nie sumujemy.
Wynik topograficzny zawsze wymaga potwierdzenia w terenie, dlatego rekomendacje mają postać
„sprawdź po deszczu, a jeśli potwierdzisz, zrób”. Progi są założeniami roboczymi.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.core.recommendations import Rec
from app.presentation.textfmt import fmt

SLOPE_NOTABLE_PCT = 5.0        # średni spadek, od którego spływ powierzchniowy jest istotną drogą strat
SLOPE_STEEP_PART_PCT = 8.0     # ...albo taki spadek na najbardziej stromych 10% powierzchni
SLOPE_FLAT_PCT = 2.0
BIG_FLOW_HA = 0.5              # droga spływu warta sprawdzenia i zadarnienia
INFLOW_RETENTION_HA = 1.0      # dopływ z zewnątrz, przy którym warto ocenić miejsce na zatrzymanie wody
DEPRESSION_MIN_AREA_M2 = 100.0
DEPRESSION_MIN_DEPTH_M = 0.2

LIMITATIONS = [
    "Drogi spływu wynikają wyłącznie z ukształtowania terenu (model 1 m). Nie uwzględniają intensywności opadu, "
    "wsiąkania, drenów, przepustów, rowów ani kierunku uprawy.",
    "Liczba przy punkcie to powierzchnia, z której woda może do niego spływać, a nie objętość wody. "
    "Powierzchni przy różnych punktach nie należy sumować, bo trasy mogą należeć do jednego układu spływu.",
]


@dataclass
class Point:
    kind: str        # inflow | outflow
    area_ha: float
    side: str        # np. "południowo-wschodnia"


@dataclass
class TerrainFacts:
    elevation_min_m: float
    elevation_max_m: float
    slope_mean_pct: float
    slope_p90_pct: float
    points: list[Point]
    threshold_ha: float
    depression_area_m2: float = 0.0      # zagłębienia bezodpływowe na działce głębsze niż próg
    depression_max_depth_m: float = 0.0
    depression_side: str | None = None


@dataclass
class TerrainConclusions:
    text: list[str] = field(default_factory=list)
    causes: list[tuple[str, str, str]] = field(default_factory=list)   # (klucz, tytuł, treść)
    recommendations: list[Rec] = field(default_factory=list)
    limitations: list[str] = field(default_factory=lambda: list(LIMITATIONS))


def conclude(f: TerrainFacts) -> TerrainConclusions:
    out = TerrainConclusions()
    inflows = sorted((p for p in f.points if p.kind == "inflow"), key=lambda p: -p.area_ha)
    outflows = sorted((p for p in f.points if p.kind == "outflow"), key=lambda p: -p.area_ha)

    out.text.append(
        f"Wysokości na działce: od {fmt(f.elevation_min_m, 1)} do {fmt(f.elevation_max_m, 1)} m n.p.m. "
        f"Średni spadek {fmt(f.slope_mean_pct, 1)}%, a na najbardziej stromych 10% powierzchni ponad {fmt(f.slope_p90_pct, 1)}%.")
    if f.points:
        sentence = (f"Na mapie zaznaczono miejsca, w których drogi spływu o zlewni powyżej {fmt(f.threshold_ha, 2)} ha "
                    f"przecinają granicę działki: punkty dopływu wody – {len(inflows)}, punkty odpływu – {len(outflows)}.")
        if outflows:
            sentence += (f" Największa powierzchnia zasilająca punkt odpływu to {fmt(outflows[0].area_ha, 2)} ha, "
                         f"przy granicy {_genitive(outflows[0].side)}.")
        out.text.append(sentence)
    else:
        out.text.append(f"Przez działkę nie przechodzi żadna droga spływu o zlewni powyżej {fmt(f.threshold_ha, 2)} ha.")

    steep = f.slope_mean_pct >= SLOPE_NOTABLE_PCT or f.slope_p90_pct >= SLOPE_STEEP_PART_PCT
    if steep:
        out.causes.append((
            "slope", "Spadek terenu",
            f"Średni spadek działki to {fmt(f.slope_mean_pct, 1)}%, a na najbardziej stromych 10% powierzchni ponad "
            f"{fmt(f.slope_p90_pct, 1)}%. Przy ulewie część wody spływa po powierzchni, zanim wsiąknie, więc do gleby "
            "trafia mniej, niż pokazuje bilans."))
        out.recommendations.append(Rec(
            "across_slope", "agrotechnical", "Uprawiaj i siej w poprzek stoku",
            "Prowadź uprawę, siew i ścieżki technologiczne w poprzek spadku, a stoku nie zostawiaj na zimę bez okrywy.",
            "Części pola o największym spadku.",
            f"Średni spadek {fmt(f.slope_mean_pct, 1)}%, miejscami ponad {fmt(f.slope_p90_pct, 1)}%: bruzdy wzdłuż stoku "
            "stają się drogami spływu wody i gleby.",
            "średnia", "Spadek policzono z modelu terenu 1 m; nie znamy obecnego kierunku uprawy."))

    big = [p for p in f.points if p.area_ha >= BIG_FLOW_HA]
    if big:
        main = max(big, key=lambda p: p.area_ha)
        verb = "wypływa z działki" if main.kind == "outflow" else "wpływa na działkę"
        out.causes.append((
            "concentrated_flow", "Skoncentrowany spływ wody",
            f"Przez działkę przechodzi droga spływu zbierająca wodę z {fmt(main.area_ha, 2)} ha; woda {verb} przy granicy "
            f"{_genitive(main.side)}. Po intensywnym deszczu może tędy odpływać woda, która nie zdążyła wsiąknąć, "
            "razem z glebą i nawozem."))
        target = outflows[0] if outflows and outflows[0].area_ha >= BIG_FLOW_HA else main
        out.recommendations.append(Rec(
            "buffer_strip_flow_path", "retention", "Pas trwałej roślinności na drodze spływu",
            f"Po intensywnym deszczu sprawdź {_accusative(target.side)} granicę pola i zaznaczoną na mapie drogę spływu. "
            "Jeśli potwierdzisz przepływ wody albo ślady erozji, zadarnij tę drogę pasem trwałej roślinności "
            "(trawa, krzewy) i nie przeorywaj go.",
            f"Droga spływu i punkt przy granicy {_genitive(target.side)} (na mapie).",
            f"Powierzchnia zasilająca ten punkt to {fmt(target.area_ha, 2)} ha, w tym grunty poza działką. "
            "Pas roślinności spowalnia wodę i pozwala jej wsiąknąć.",
            "niska", "To wynik z samego ukształtowania terenu; rzeczywisty spływ zależy od opadu, drenów i przepustów."))

    if inflows and inflows[0].area_ha >= INFLOW_RETENTION_HA:
        out.recommendations.append(Rec(
            "inflow_retention_check", "field_check", "Sprawdź, czy da się zatrzymać wodę dopływającą z góry",
            "Obejrzyj po deszczu miejsce, w którym woda wpływa na działkę. Jeśli płynie regularnie, oceń z doradcą "
            "możliwość jej spowolnienia: zadarnienie, niewielkie zagłębienie retencyjne albo próg na rowie.",
            f"Punkt dopływu przy granicy {_genitive(inflows[0].side)} (na mapie).",
            f"Na działkę może dopływać woda z {fmt(inflows[0].area_ha, 2)} ha położonych wyżej.",
            "niska", "Nie znamy układu rowów i drenów ani tego, czy woda rzeczywiście tędy płynie."))

    if f.depression_area_m2 >= DEPRESSION_MIN_AREA_M2 and f.depression_max_depth_m >= DEPRESSION_MIN_DEPTH_M:
        where = f"Obniżenie w części {_genitive(f.depression_side)} działki." if f.depression_side else "Obniżenie na działce."
        out.recommendations.append(Rec(
            "protect_depression", "retention", "Zachowaj obniżenie, w którym zbiera się woda",
            "Sprawdź, czy po opadach albo na wiosnę stoi tu woda. Jeśli tak, nie zasypuj i nie odwadniaj tego miejsca: "
            "oczko albo podmokłe obniżenie zatrzymuje wodę na polu.",
            where,
            f"Model terenu pokazuje zagłębienie bez odpływu o powierzchni ok. {fmt(round(f.depression_area_m2, -1))} m² "
            f"i głębokości do {fmt(f.depression_max_depth_m * 100)} cm.",
            "niska", "Zagłębienie w modelu 1 m może być też koleiną, wyrobiskiem albo błędem pomiaru."))

    if not steep and not big and f.slope_mean_pct < SLOPE_FLAT_PCT:
        out.text.append("Teren jest prawie płaski i nie ma tu skoncentrowanego spływu: spływ powierzchniowy nie jest "
                        "na tej działce istotną drogą strat wody.")
    return out


def _accusative(side: str | None) -> str:
    """„południowo-wschodnia” → „południowo-wschodnią” (do zwrotu „sprawdź ... granicę”)."""
    if not side:
        return "zaznaczoną"
    return side[:-1] + "ą" if side.endswith("a") else side


def _genitive(side: str | None) -> str:
    """„południowo-wschodnia” → „południowo-wschodniej” (do zwrotu „przy granicy ...”)."""
    if not side:
        return "działki"
    return side[:-1] + "ej" if side.endswith("a") else side
