"""„Czego nie wiemy”: stałe ograniczenia modelu i te, które wynikają z danych tego raportu."""
from __future__ import annotations

from datetime import date

from app.core.crops import Crop
from app.presentation.textfmt import fmt_date, plural_days

MODEL_LIMITATIONS = [
    "Bilans nie uwzględnia spływu powierzchniowego: cały opad jest liczony jako woda, która wsiąka. "
    "Po ulewie i na stoku rzeczywisty zapas jest mniejszy.",
    "Bilans nie uwzględnia podsiąku z płytkiej wody gruntowej ani drenów. Na polach z wysokim "
    "poziomem wody gruntowej rzeczywisty niedobór jest mniejszy, niż pokazuje raport.",
    "Śnieg jest liczony jak deszcz w dniu opadu, a zamarznięcie gleby nie jest modelowane.",
    "Nawadnianie jest nieznane i nie wchodzi do bilansu. Jeśli pole było nawadniane, niedobór jest zawyżony.",
    "Pogoda pochodzi z siatki modelu, a nie z pomiaru na polu. Lokalna burza albo jej brak mogą "
    "zmienić wynik o kilkadziesiąt milimetrów.",
    "Długości faz rozwoju wynikają z kalendarza gatunku. Głębokość korzeni jest stała przez cały sezon.",
    "Współczynniki Kc pochodzą z tablic FAO-56 bez poprawki na lokalny wiatr i wilgotność powietrza.",
    "Porównanie z 10 latami zakłada, że co roku na polu rosła ta sama uprawa.",
]
HYDROLOGY_IMPACT = ("Raport nie ocenia poziomu wody gruntowej: nie ma go w otwartych danych dla dowolnego punktu. "
                    "Odległość od cieku pochodzi z mapy MPHP10k w skali 1:10 000: drenażu podziemnego na niej nie ma, "
                    "a małe rowy mogą nie być zaznaczone. Stan rzeki z najbliższego wodowskazu IMGW opisuje całą zlewnię "
                    "powyżej niego (także wpływ zbiorników, zrzutów i poborów wody), a nie wodę w glebie działki.")


def limitations(crop: Crop, last_data_day: date, end: date, for_today: bool, soil_assumed: bool) -> list[str]:
    """Najważniejsze braki danych idą na początek listy, stałe ograniczenia modelu za nimi."""
    out = list(MODEL_LIMITATIONS)
    if crop.season_override is None:
        out.append("Terminy siewu i zbioru oszacowano z kalendarza gatunku.")
    else:
        out.append("Terminy siewu i zbioru podane dla pola dotyczą jednego sezonu. Pozostałe terminy oszacowano.")
        if crop.next_sowing_date is not None:
            out.append("Data kolejnego siewu służy do oceny przerwy po zbiorze. Bilans kolejnej uprawy opiera się na kalendarzu gatunku.")
    if last_data_day < end:
        out.insert(0, f"Dane pogodowe kończą się {fmt_date(last_data_day)}, czyli {plural_days((end - last_data_day).days)} "
                      "przed ostatnim dniem analizy. Późniejszy opad nie jest uwzględniony.")
    if for_today:
        out.insert(0, f"Analiza „na dziś” kończy się na ostatniej pełnej dobie ({fmt_date(end)}).")
    if soil_assumed:
        out.insert(0, "Brak danych o glebie: bilans policzono dla gleby umownej, wynik jest orientacyjny.")
    out.append(HYDROLOGY_IMPACT)
    return out
