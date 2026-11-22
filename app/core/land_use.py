"""Użytkowanie terenu na działce z liczby pikseli w klasach mapy pokrycia terenu (ESA WorldCover).

Bez sieci: wchodzi liczba pikseli na klasę, wychodzą udziały i ocena, czy działka wygląda na grunt rolny.
Mapa nie zmienia bilansu wodnego. Służy do sprawdzenia założenia, że na działce rośnie wskazana uprawa.
"""
from __future__ import annotations

from dataclasses import dataclass

# kod klasy WorldCover → (klucz, nazwa po polsku w dopełniaczu po „to”: „60% działki to …”)
CLASSES: dict[int, tuple[str, str]] = {
    10: ("trees", "drzewa i las"),
    20: ("shrubs", "zarośla"),
    30: ("grassland", "łąki i pastwiska"),
    40: ("cropland", "grunty orne"),
    50: ("built_up", "zabudowa"),
    60: ("bare", "teren bez roślinności"),
    70: ("snow", "śnieg i lód"),
    80: ("water", "woda"),
    90: ("wetland", "mokradła"),
    95: ("mangroves", "namorzyny"),
    100: ("moss", "mchy i porosty"),
}
FARMLAND_KEYS = ("cropland", "grassland")
# poniżej tylu pikseli 10 m udział klas jest zgrubny (działka węższa niż kilka pikseli)
MIN_PIXELS_FOR_SHARES = 10
NOT_FARMLAND_SHARE = 0.5      # co najmniej połowa działki poza gruntami rolnymi: raport każe to sprawdzić
PARTLY_OTHER_SHARE = 0.2      # co najmniej piąta część poza gruntami rolnymi: raport to odnotowuje


@dataclass
class ClassShare:
    key: str
    label: str
    share: float    # 0–1, udział pikseli działki
    pixels: int


@dataclass
class LandUse:
    classes: list[ClassShare]   # od największego udziału
    pixels: int                 # piksele 10 m policzone dla działki
    farmland_share: float       # grunty orne + łąki i pastwiska
    verdict: str                # farmland | partly_other | not_farmland
    crop_matches: bool | None   # czy dominująca klasa pasuje do rodzaju uprawy; None, gdy nie ma czego porównać
    coarse: bool                # mało pikseli: udziały są zgrubne

    @property
    def dominant(self) -> ClassShare:
        return self.classes[0]

    @property
    def other(self) -> list[ClassShare]:
        """Klasy poza gruntami rolnymi, od największej."""
        return [c for c in self.classes if c.key not in FARMLAND_KEYS]


def summarize(counts: dict[int, int], grassland_crop: bool) -> LandUse | None:
    """`counts`: kod klasy WorldCover → liczba pikseli działki (bez pikseli bez danych).
    `grassland_crop`: rolnik wskazał użytki zielone. None, gdy nie ma ani jednego piksela."""
    known = {code: n for code, n in counts.items() if code in CLASSES and n > 0}
    total = sum(known.values())
    if total == 0:
        return None
    classes = sorted((ClassShare(CLASSES[code][0], CLASSES[code][1], n / total, n) for code, n in known.items()),
                     key=lambda c: c.share, reverse=True)
    farmland = sum(c.share for c in classes if c.key in FARMLAND_KEYS)
    other = 1.0 - farmland
    verdict = ("not_farmland" if other >= NOT_FARMLAND_SHARE
               else "partly_other" if other >= PARTLY_OTHER_SHARE else "farmland")
    dominant = classes[0].key
    crop_matches = None
    if dominant in FARMLAND_KEYS:
        crop_matches = (dominant == "grassland") == grassland_crop
    return LandUse(classes=classes, pixels=total, farmland_share=farmland, verdict=verdict,
                   crop_matches=crop_matches, coarse=total < MIN_PIXELS_FOR_SHARES)
