# Przegląd aplikacji okiem rolnika

Data przeglądu: 22.11.2026. Stan kodu: commit `79adeda`.

## Co sprawdzono

Cztery raporty wygenerowane na żywo przez `POST /api/report` na lokalnym serwerze, przeczytane tak, jak czytałby je rolnik:

| Działka | Uprawa | Data analizy | Ocena w raporcie |
|---|---|---|---|
| `060910_2.0011.580/2` (Niedrzwica Kościelna, 0,48 ha) | pszenica ozima | 22.11.2026 | poza okresem wzrostu, zapas częściowo wyczerpany |
| `060910_2.0011.580/2` | kukurydza | 15.07.2026 | umiarkowany niedobór |
| `301103_2.0017.119/2` (Nacław, gm. Kościan, 2,62 ha) | jęczmień jary | 15.07.2018 | umiarkowany niedobór |
| `060910_2.0011.580/2` | ziemniak | 20.06.2023 | zapas łatwo dostępnej wody się kończy |

Do tego kod zakładek w `frontend/` i reguły w `app/core/`.

Czego nie sprawdzono: wyglądu w przeglądarce (ocena dotyczy treści raportów i kodu komponentów), widoku na telefonie, wydruku PDF, pozostałych upraw (rzepak, burak, użytki zielone).

Uwagi agronomiczne (terminy żniw, zabiegi w danej fazie) to ocena z praktyki, a nie wynik porównania z publikacją. Przed zmianą kalendarza upraw warto je potwierdzić w zaleceniach IUNG albo COBORU.

## Co działa dobrze

- Kolejność raportu: ocena, przyczyny, retencja, agrotechnika, na końcu nawadnianie.
- „Co sprawdzić na polu” tam, gdzie dane nie rozstrzygają, i rada z łopatą na 10–30 cm.
- Każda rekomendacja ma uzasadnienie z liczbami działki i poziom pewności.
- Raport mówi wprost, gdy nawadnianie nie ma sensu (uprawa dojrzewa, poza okresem wzrostu).

## Błędy, które rolnik zobaczy od razu

### 1. Data stanu jest nieprawdziwa

Raport dla pszenicy ma w nagłówku „stan na 22.11.2026”, a pogoda w bilansie kończy się 15.11.2026. Open-Meteo odmawiało (HTTP 429), a NASA POWER ma około tygodnia opóźnienia.

Serwer zwraca `water_status.last_data_day` i wpisuje opóźnienie do ograniczeń, ale frontend tego pola nie używa. Nagłówek raportu ([Report.jsx](../frontend/Report.jsx)) i karta pola na pulpicie ([Dashboard.jsx](../frontend/Dashboard.jsx)) pokazują `analysis_date`.

Skutek: gdy wczoraj padało, a aplikacja mówi „sucho”, rolnik przestaje jej wierzyć. Ograniczenie jest opisane tylko w zwiniętej sekcji „Czego nie wiemy” w zakładce Źródła.

Poprawka: pokazywać „stan na” według `last_data_day`, a gdy różni się od daty analizy, dopisać obok, ilu dni brakuje.

### 2. „Najważniejsze teraz” nie jest na teraz

Karta w podsumowaniu ([Summary.jsx](../frontend/report/Summary.jsx)) bierze pierwszą rekomendację z listy, czyli pierwszą retencyjną. W efekcie:

- 22.11, pszenica posiana we wrześniu: „Zostaw resztki pożniwne jako okrywę gleby”.
- 15.07, kukurydza z umiarkowanym niedoborem: to samo, choć na liście są „Nie pogłębiaj niedoboru zabiegami” i „Oglądaj pole co kilka dni”.

To samo działanie trafia do „Najbliższych działań” na pulpicie.

Poprawka: każda rekomendacja dostaje termin (teraz, po zbiorze, na lata). Kolejność grup zostaje, a karta „Najważniejsze teraz” wybiera działanie z terminem „teraz”. Najmniejsza zmiana: inny tytuł karty, np. „Pierwsze działanie”.

### 3. Jęczmień jary 15 lipca

Raport podaje jako przyczynę niedoboru „Faza dużego zapotrzebowania uprawy: jęczmień jary jest w fazie: koniec sezonu (dojrzewanie) (Kc = 1,15). Potrzebuje teraz średnio 4,1 mm wody na dobę”. Tytuł i treść sobie przeczą, a kalendarz daje zbiór 13.08.

W połowie lipca jęczmień jary jest zwykle tuż przed żniwami i wody prawie nie pobiera. Kalendarz w [crops.py](../app/core/crops.py) (siew 1.04, fazy 20/25/60/30 dni z tabeli FAO-56 dla 35–45° szerokości) wygląda na spóźniony o 2–3 tygodnie.

Poprawka: przyczyna „faza dużego zapotrzebowania” nie powinna pojawiać się w fazie końcowej; terminy jęczmienia do sprawdzenia.

### 4. Rady nie pasują do uprawy ani fazy

Teksty w [recommendations.py](../app/core/recommendations.py) są wspólne dla wszystkich upraw:

| Uprawa i data | Tekst w raporcie | Co nie pasuje |
|---|---|---|
| ziemniak | „siej w najwcześniejszym zalecanym terminie”, „do siewu 20.04” | ziemniaki się sadzi |
| ziemniak | „wysiej międzyplon ścierniskowy” | po ziemniakach nie ma ścierniska |
| ziemniak | „rozważ uprawę uproszczoną (bez orki albo pasową)” | ziemniak wymaga redlin |
| kukurydza, 15.07 | „Pogłówne nawożenie azotem zaplanuj tuż przed zapowiadanym opadem”, „odłóż spulchnianie międzyrzędzi” | w tej fazie nikt już tych zabiegów nie robi |
| kukurydza, 15.07 | „Jednorazowo nie podawaj więcej niż 119 mm” | 119 mm to 1190 m³/ha; ten sam raport liczy dawki po 25 mm |
| jęczmień, 15.07 | „Oglądaj pole… zwijanie, więdnięcie liści” | łan dojrzewa, liście i tak zasychają |

Poprawka: warianty tekstu zależne od uprawy (siew/sadzenie, rodzaj resztek) i fazy; w nawadnianiu podawać dawkę jednorazową 20–30 mm i liczbę dawek zamiast górnej granicy równej całemu ubytkowi.

### 5. Liczby o historii się gryzą

- Karta w podsumowaniu: „Sezony z niedoborem 8 z 10” (wystarczy jeden dzień stresu w okresie krytycznym).
- Rekomendacja obok: „W 4 z 10 ostatnich sezonów… stres wodny trwający co najmniej 14 dni”.

Dla ziemniaka i jęczmienia wychodzi 10 z 10, przy medianie 52–62 dni stresu w sezonie. Wskaźnik, który co roku pokazuje suszę, niczego nie rozróżnia, a rolnik, który z tego pola co roku zbiera plon, uzna go za błędny.

Poprawka: jedna definicja w karcie i w rekomendacjach (np. sezony z długim stresem), a obok miejsce bieżącego roku na tle pozostałych („trzeci najsuchszy z dziesięciu”). Zakładka Historia ma już słupki dni niedoboru sezon po sezonie.

## Czego brakuje

### 6. Aplikacja nie pyta o to, co rolnik wie

Cztery opcjonalne pola w formularzu zamieniłyby zgadywanie w konkret:

- **Gleba** (lekka, średnia, ciężka albo klasa bonitacyjna). Dziś przedział niepewności dla 580/2 to 97–231 mm wody dostępnej. Pod Kościanem mapa podaje ok. 3,1% próchnicy na lekkiej glebie, co wygląda na zawyżone.
- **Data siewu.** Kalendarz jest umowny; wczesny albo późny siew przesuwa okres największego zapotrzebowania.
- **Rów, dreny, oczko albo ciek przy polu.** Dziś rekomendacja brzmi „jeśli przy polu są rowy…”, a raport każe to sprawdzić na mapie.
- **Przedplon i następna uprawa.** Dziś raport zakłada 10 lat tej samej uprawy i np. 221 dni gołej ziemi po ziemniakach, choć zwykle wchodzi po nich ozimina.

### 7. Brakuje upraw lekkich gleb

Na liście jest 7 upraw. Nie ma żyta, pszenżyta ani owsa, czyli upraw gleb, na których wody brakuje najczęściej. Nie ma też jęczmienia ozimego, soi, bobowatych, warzyw i sadów.

### 8. Działka to nie pole

580/2 ma 0,48 ha. Pole złożone z kilku działek trzeba dodawać po kawałku, a działki z kilkoma uprawami nie da się opisać. Rekomendacje terenowe („zadarnij drogę spływu pasem trwałej roślinności”) na wąskiej działce są trudne do wykonania.

### 9. Gotowe zdania nie trafiają na ekran

Serwer zwraca wnioski słowne, których frontend nie wyświetla (w `frontend/` nie ma odwołań do tych pól):

| Pole w raporcie | Przykład | Co widzi rolnik |
|---|---|---|
| `satellite.text` | „Rośliny tracą wodę: spadek NDMI potwierdza niedobór pokazany przez bilans.” | „Zieloność (NDVI) 0,50 · Uwilgotnienie (NDMI) 0,22” |
| `satellite.ndmi_forecast` | prognoza modelu ML albo powód jej braku | nic |
| `history.text` | „Najdłużej w sezonie 2019: 53 dni, w tym 45 dni z rzędu.” | same słupki |
| `history.same_day_*` | dziś suszej niż w tym samym dniu każdego z 10 lat | nic |
| `soil_moisture.text`, `hydrology.text` | „Model regionalny i bilans działki zgadzają się…” | same liczby |
| `water_status.uncertainty_text` | przedział gleby i klasy | odnośnik „Ograniczona pewność wyniku” |

Brak `ndmi_forecast` na ekranie oznacza, że modelu ML opisanego w README nie widać w aplikacji.

### 10. Żargon w przyczynach

Po rozwinięciu przyczyny rolnik czyta: „Ewapotranspiracja wskaźnikowa (ET0) powyżej 110% mediany”, „(Kc = 1,20)”, „pojemność polowa 13%, punkt więdnięcia 6% objętości”. W zakładce Gleba kolumna nazywa się „Pojemność polowa”. Nazwy gleb są tłumaczeniem klas USDA („glina piaszczysta”), a nie nazwami używanymi w Polsce.

Komunikaty błędów źródeł też są techniczne: „Open-Meteo Forecast: HTTP 429, przekroczony limit zapytań z tego adresu IP”.

## Pomysły na większą wartość praktyczną

- **Metry sześcienne dla całego pola.** Powierzchnia jest znana, więc „21 mm” można podać także jako ok. 100 m³ na 0,48 ha.
- **Ekoschematy.** Przy rekomendacjach (międzyplon, uprawa uproszczona, resztki pożniwne) dopisać, czy działanie jest premiowane. Nazwy i warunki trzeba sprawdzić w aktualnych przepisach. Do sprawdzenia także, czy rada „zostaw resztki na powierzchni zamiast przyorywać” nie kłóci się z praktyką wymieszania słomy z glebą.
- **Odświeżanie wszystkich pól.** Pulpit pokazuje zapisane raporty; żeby zobaczyć stan na dziś, każde pole trzeba przeliczyć osobno.

## Kolejność prac

| Kolejność | Punkty | Nakład |
|---|---|---|
| 1 | 1, 2, 9 | głównie frontend, na danych, które serwer już zwraca; do punktu 2 wystarczy na początek zmiana tytułu karty |
| 2 | 3, 4, 5 | teksty i warunki reguł w `app/core/`, kalendarz jęczmienia |
| 3 | 10 | redakcja tekstów przyczyn i komunikatów |
| 4 | 6, 7, 8 | nowe pola formularza i kontraktu API, nowe uprawy, pole z kilku działek |
