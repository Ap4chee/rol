"""Użytkowanie terenu: udziały klas mapy pokrycia terenu na działce i zdania o tym, czy to grunt rolny.

Mapa nie zmienia bilansu ani rekomendacji. Gdy działka w większości nie jest gruntem rolnym, raport mówi to
w ograniczeniach i dodaje punkt „co sprawdzić na polu”.
"""
from __future__ import annotations

from app.core import land_use as rules
from app.core.crops import Crop
from app.core.textfmt import fmt
from app.schemas import LandUseClass, LandUseSection, Recommendation, Recommendations, SourceInfo, Status
from app.sources import worldcover

MIN_LISTED_SHARE = 0.05   # mniejsze klasy nie trafiają do zdania (zostają w liście `classes`)
MAP_CAVEAT = (f"Mapa pokazuje stan z {worldcover.MAP_YEAR} r. i powstała z automatycznej klasyfikacji zdjęć: "
              "bywa, że myli łąkę z polem uprawnym, a młody sad albo ugór z zaroślami.")


def _shares_text(classes: list[rules.ClassShare]) -> str:
    listed = [c for c in classes if c.share >= MIN_LISTED_SHARE] or classes[:1]
    return ", ".join(f"{c.label} {fmt(100 * c.share)}%" for c in listed)


def _sentences(use: rules.LandUse, crop: Crop, point_only: bool) -> list[str]:
    if point_only:
        return [f"Według mapy pokrycia terenu ESA WorldCover w tym punkcie są: {use.dominant.label}. "
                "To jeden piksel ok. 10 m, bez granicy działki.", MAP_CAVEAT]
    out = [f"Pokrycie terenu działki według mapy ESA WorldCover ({fmt(use.pixels)} pikseli po ok. 10 m): "
           f"{_shares_text(use.classes)}."]
    if use.coarse:
        out.append("Działka mieści tylko kilka pikseli mapy, więc udziały są zgrubne.")
    other = ", ".join(c.label for c in use.other if c.share >= MIN_LISTED_SHARE)
    if use.verdict == "not_farmland":
        out.append(f"Większość działki nie wygląda na grunt rolny ({other}). Bilans wodny policzono tak, jakby na "
                   f"całej działce rosła uprawa: {crop.name.lower()}. Jeśli tak nie jest, ocena niedoboru i "
                   "rekomendacje nie dotyczą tej działki.")
    elif use.verdict == "partly_other":
        out.append(f"Część działki ({fmt(100 * (1 - use.farmland_share))}%) to nie grunt rolny ({other}). Bilans dotyczy "
                   "części uprawnej, a wskaźniki ze zdjęć satelitarnych są uśrednione z całej działki.")
    elif use.crop_matches is False:
        expected = "łąkę lub pastwisko" if crop.perennial else "grunt orny"
        out.append(f"Wybrana uprawa ({crop.name.lower()}) oznacza {expected}, a mapa pokazuje głównie: "
                   f"{use.dominant.label}. Raport liczy się dla uprawy podanej w formularzu.")
    else:
        out.append("To zgadza się z wybraną uprawą.")
    out.append(MAP_CAVEAT)
    return out


def land_use_section(counts: dict[int, int] | None, info: SourceInfo, crop: Crop, point_only: bool) -> LandUseSection:
    use = rules.summarize(counts, crop.perennial) if counts else None
    if use is None:
        reason = " ".join(filter(None, [info.reason, info.impact])) or "Brak danych o pokryciu terenu."
        return LandUseSection(status=info.status if info.status != Status.ok else Status.no_data, reason=reason)
    return LandUseSection(
        status=Status.ok, map_year=worldcover.MAP_YEAR, pixels=use.pixels,
        classes=[LandUseClass(key=c.key, label=c.label, share_pct=round(100 * c.share)) for c in use.classes],
        farmland_pct=round(100 * use.farmland_share), verdict=use.verdict,
        crop_matches=None if point_only else use.crop_matches, text=_sentences(use, crop, point_only))


def assumption(section: LandUseSection) -> list[str]:
    """Zdania do „Założeń o uprawie”: co mapa mówi o działce, bez zastrzeżenia o samej mapie."""
    return section.text[:-1] if section.status == Status.ok else []


def limitation(section: LandUseSection) -> list[str]:
    """Zdanie na początek listy ograniczeń, gdy działka nie jest w całości gruntem rolnym albo mapy nie ma."""
    if section.status != Status.ok:
        return ["Nie sprawdzono, czy działka jest gruntem rolnym (brak mapy pokrycia terenu). "
                "Bilans liczy się dla uprawy podanej w formularzu."]
    if section.verdict in ("not_farmland", "partly_other"):
        return [section.text[-2]]
    return []


def add_field_check(recs: Recommendations, section: LandUseSection, crop: Crop) -> None:
    """„Co sprawdzić na polu”, gdy mapa mówi, że większość działki nie jest gruntem rolnym."""
    if section.status != Status.ok or section.verdict != "not_farmland":
        return
    other = ", ".join(f"{c.label} {fmt(c.share_pct)}%" for c in section.classes
                      if c.key not in rules.FARMLAND_KEYS and c.share_pct >= 100 * MIN_LISTED_SHARE)
    recs.field_checks.insert(0, Recommendation(
        key="land_use_not_farmland", category="field_check", timing="now",
        title="Sprawdź, czy wskazałeś właściwą działkę",
        what=f"Upewnij się, że na tej działce rośnie uprawa: {crop.name.lower()}. Jeśli wskazałeś sąsiednią działkę "
             "albo las, zabudowę czy wodę, wybierz właściwą i przelicz raport.",
        where="Cała działka.",
        why=f"Według mapy pokrycia terenu ESA WorldCover z {section.map_year} r. tylko {fmt(section.farmland_pct)}% "
            f"działki to grunty rolne. Pozostała część: {other}. Bilans wodny i rekomendacje zakładają uprawę "
            "na całej działce.",
        confidence="średnia",
        confidence_reason=f"Mapa pokazuje stan z {section.map_year} r. i może mylić klasy; użytkowanie mogło się zmienić.",
        evidence={"farmland_pct": section.farmland_pct, "pixels": section.pixels,
                  "classes": {c.key: c.share_pct for c in section.classes}}))
