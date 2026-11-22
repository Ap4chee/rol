# Kontrakt API

Źródłem prawdy jest pakiet [app/schemas/](../app/schemas/) (modele podzielone według obszaru, każdy dostępny jako `app.schemas.<Nazwa>`). Po uruchomieniu serwera pełny schemat z opisami pól jest pod `/docs` (Swagger) i `/openapi.json`.

Zasady:

- Oceny i zalecenia liczy serwer. Frontend formatuje i prezentuje wyniki.
- Każda sekcja ma `status` (`ok`, `no_data`, `error`, dla terenu także `pending`) i `reason`.
- Każde źródło danych ma wpis w `sources`: status, powód, nazwa, rozdzielczość, daty danych, licencja, czas pobrania.
- Jednostki są w nazwach pól (`_mm`, `_pct`, `_ha`, `_m`). Współrzędne w odpowiedzi: EPSG:4326, kolejność lon, lat.
- Kolejność sekcji raportu jest narzucona przez zadanie: sytuacja wodna, przyczyny, rekomendacje retencyjne, agrotechniczne, nawadnianie, potem źródła i ograniczenia.

## `POST /api/addresses/search`

Przyjmuje `{"query":"Marki, Andersa 1"}`. Zwraca możliwe miejsca z UUG GUGiK. Każde ma etykietę, region, punkt w EPSG:4326 i flagę `precise` określającą, czy znaleziono konkretny numer adresowy. Wynik ustawia widok mapy, a rolnik osobno wskazuje działkę.

## `POST /api/report`

Wejście: identyfikator działki albo punkt (dokładnie jedno z dwojga), uprawa, data.

```json
{"parcel_id": "060910_2.0011.580/2", "crop": "winter_wheat", "date": "2026-11-21"}
```

```json
{"point": {"lon": 22.3559, "lat": 51.0933}, "crop": "spring_barley", "date": "2018-07-15"}
```

Uprawy (`crop`): `winter_wheat`, `spring_barley`, `winter_rapeseed`, `maize`, `potato`, `sugar_beet`, `grassland`. Lista z polskimi nazwami: `GET /api/crops`.

Opcjonalne daty dla upraw jednorocznych to `sowing_date`, `harvest_date` i `next_sowing_date` (ISO `RRRR-MM-DD`). Siew lub sadzenie i zbiór określają granice jednego sezonu, a kolejny siew służy do oceny przerwy po zbiorze. Te same pola przyjmuje zapis pola. Raport przekazuje je również w adresie do późniejszego pobrania sekcji satelitarnej.

Wyjście (`ReportResponse`), pola najwyższego poziomu:

| Pole | Zawartość |
|---|---|
| `parcel` | identyfikator, położenie administracyjne, powierzchnia, geometria GeoJSON |
| `crop` | uprawa, faza w dniu analizy, Kc, głębokość korzeni, założenia |
| `summary` | najważniejsze wnioski, 2–4 zdania |
| `water_status` | bilans wodny FAO-56: klasa niedoboru, wyczerpanie względem RAW i TAW, przedział niepewności, klimatyczny bilans wodny 60 dni, przebieg dzienny (zapas w % z pasmem 10/50/90 percentyla tych samych dni w 10 latach), dla analizy na dziś prognoza zapasu na maksymalnie 14 dni (`forecast`, `forecast_stress_day`; każdy dzień także z `typical_p10_pct`, `typical_median_pct`, `typical_p90_pct` z tych samych dni w 10 latach) oraz prognoza modelu ML na maksymalnie 14 dni (`ml_forecast`: `available`, `reason`, `points` z `date`, `available_pct`, `low_pct`, `high_pct` w % TAW, `text`; dla daty historycznej `null`) |
| `satellite` | obserwacje NDVI i NDMI z Sentinel-2 i to, czy potwierdzają bilans; `ndmi_forecast`: prognoza ML zmiany NDMI na 7–14 dni (opis niżej) |
| `history` | bilans dla 10 poprzednich sezonów. `seasons_with_stress` liczy sezony z co najmniej jednym dniem niedoboru w okresie krytycznym, a `seasons_with_long_stress` z co najmniej `long_stress_days`. Pola `same_day_*` porównują procent wyczerpania zapasu tego samego dnia w poprzednich latach |
| `causes` | przyczyny wynikające z danych: opad i ET0 względem mediany 10 lat, gleba, faza uprawy |
| `soil` | warstwy gleby z SoilGrids i wyliczona pojemność wodna |
| `irrigation_need` | zapotrzebowanie na nawadnianie netto (FAO-56 rozdz. 8, dawka 25 mm przy przekroczeniu RAW): bieżący sezon do dnia analizy, typowy i suchy sezon z 10 lat, rozkład na miesiące |
| `soil_moisture` | wilgotność 3 warstw w okolicy (NASA POWER, ok. 50 km) na tle tych samych dni w 10 latach, albo jawny brak danych |
| `terrain` | `pending` i adres, pod którym frontend dociąga teren i spływ |
| `hydrology` | odległość do najbliższego cieku albo jawny brak danych |
| `land_use` | użytkowanie terenu z mapy ESA WorldCover (stan z 2021 r.): `classes` (klasa, nazwa, udział w %), `farmland_pct` (grunty orne oraz łąki i pastwiska), `verdict` (`farmland`, `partly_other`, `not_farmland`), `crop_matches`, zdania w `text`; albo jawny brak danych. Nie zmienia bilansu |
| `recommendations` | `retention`, `agrotechnical`, `irrigation`, `field_checks`; każda pozycja: co, gdzie, dlaczego, pewność z uzasadnieniem i `timing` (`now`, `after_harvest`, `long_term`) |
| `limitations` | uproszczenia modelu i braki danych |
| `sources` | lista źródeł ze statusem i datami |
| `timings_s` | zmierzone czasy kroków |

Błędne wejście (zły format, data z przyszłości, punkt poza Polską) daje `422` z opisem po polsku.

### `satellite.ndmi_forecast` (prognoza ML)

Prognoza modelu z [kowr_ml](../kowr_ml/), dodatek do bilansu. Pole może być `null`, poza okresem 01.04–15.10 oraz gdy sekcja satelitarna nie ma żadnych obserwacji (np. raport dla punktu bez granicy działki).

| Pole | Zawartość |
|---|---|
| `available` | `true`, gdy jest prognoza; `false` z `reason` po polsku (np. brak czystego zdjęcia z 14 dni przed datą lub brak modelu) |
| `status` | status modelu z karty, np. `eksperymentalny`; pokazać przy prognozie |
| `trend` | `down`, `flat` lub `up` według mediany zmiany. `flat` oznacza brak wyraźnego kierunku |
| `window_from`, `window_to` | okno, którego dotyczy prognoza (data analizy + 7 … + 14 dni) |
| `ndmi_last`, `last_scene_date`, `last_scene_age_days` | zdjęcie, od którego liczona jest zmiana |
| `delta_p50` | prognozowana zmiana NDMI (bezwymiarowa, 2 miejsca po przecinku mają sens) |
| `delta_p10`, `delta_p90` | przedział 80% (skalibrowany na prognozach dla skupisk pól spoza treningu, osobno dolna i górna granica) |
| `inputs` | wartości cech wejściowych modelu, do panelu „dlaczego”: ostatnie NDMI i NDVI, trend, opad i ET0 z 7/14/30 dni, bilans referencyjny, sumy temperatur, udział gołej gleby i chmur na zdjęciach z 45 dni, mediany pasm, położenie. Lista i kolejność jak w `model_card.json` (`features`); `null` = brak wartości |
| `text` | gotowe zdania po polsku do wyświetlenia. Pierwsze mówi o kierunku: „prawdopodobnie spadnie”, „prawdopodobnie wzrośnie” albo, gdy prognozowana zmiana jest mniejsza niż 0,03, „może zmienić się w obie strony” |

Na stronie: karta „Prognoza stanu roślin na 7–14 dni” w sekcji satelitarnej. Przy `available: false` karta pokazuje `reason`. Z prognozy nie wolno wyliczać dawki nawodnienia ani wilgotności gleby.

## `GET /api/terrain?parcel_id=...`

Teren i spływ liczone osobno, bo wycinek NMT z WCS GUGiK trwa kilkanaście sekund. Wynik (`TerrainResponse`): spadek, drogi spływu i punkty wejścia/wyjścia jako GeoJSON, a także dodatkowe przyczyny i rekomendacje wynikające z terenu, które frontend dopisuje do odpowiednich sekcji raportu.

## `GET /api/satellite?parcel_id=...&crop=...&date=...`

Raport czeka na zdjęcia Sentinel-2 najwyżej kilkanaście sekund. Gdy łącze do archiwum zdjęć jest wolne, sekcja `satellite` ma status `pending` i pole `endpoint` z tym adresem, a pobieranie trwa dalej w tle. Wynik (`SatelliteResponse`): pełna sekcja `satellite`, wpis źródła i ewentualne oględziny pola (`field_checks`), które frontend dopisuje do listy.

## `GET /api/parcels/search?q=...`, `GET /api/parcels/by-point?lon=..&lat=..`, `GET /api/parcels/by-id?id=...`

Wyszukiwanie działki po nazwie obrębu i numerze (może zwrócić wiele trafień do wyboru), po punkcie na mapie albo po pełnym identyfikatorze. Dwa ostatnie zwracają też geometrię działki (`parcel`).

Granica pochodzi z ULDK, a gdy ULDK nie odpowiada, z zapasowej usługi GUGiK (zbiorczy WFS ewidencji gruntów i budynków). Rekord z usługi zapasowej ma `county: null` (usługa nie podaje nazwy powiatu), a nazwa gminy może mieć dopisek typu „- Obszar Wiejski”. W raporcie wpis źródła `uldk` ma wtedy nazwę i adres usługi zapasowej oraz wyjaśnienie w polu `reason` przy statusie `ok`. `search` nie ma zapasu: przy awarii ULDK zwraca `status: "error"` z powodem, więc frontend powinien wtedy podpowiedzieć pełny identyfikator albo kliknięcie na mapie.

## `GET /api/forecast?lon=...&lat=...[&days=...]`

Bieżąca prognoza Open-Meteo dla współrzędnych pola, poza historycznym bilansem raportu. `ForecastResponse` zawiera status oraz dobową temperaturę maksymalną, opad, parowanie wskaźnikowe i kod pogody na 1–16 dni (domyślnie 16) w strefie Europe/Warsaw. Pomiary niedostępne mają wartość `null`. `last_wet_day` wskazuje ostatni dzień z opadem powyżej 5 mm w dostępnych danych z poprzednich 30 dni. `past_days_complete` sygnalizuje, czy sprawdzono cały okres. Cache ma ważność godziny. Dni prognozy mają też `temperature_min_c` i `wind_max_kmh` (maksimum doby na 10 m), a `recent` to 30 dni przed dziś (opad, ET0) do bilansu wierzchu gleby.

## `GET /api/fieldwork?lon=...&lat=...&crop=...[&sand=...&clay=...&soc=...]`

Plan prac polowych na 7 dni od dziś. `sand`, `clay` [%] i `soc` [g/kg] to uziarnienie wierzchu 0–10 cm z raportu pola. Bez nich serwer liczy glebę umowną i ustawia `soil_assumed: true`. `FieldworkResponse.days[]` ma pogodę dnia, `surface_fc_pct` (wilgotność wierzchu rano w % pojemności polowej, model) i oceny `traffic`, `sowing`, `spraying`, `fertilizing`. Każda ocena ma `rating` (`good` | `caution` | `avoid` | `off`, gdy praca nie pasuje do okresu uprawy, | `unknown` przy braku danych) i `reason`. `windows` podaje najdłuższy ciąg dobrych dni dla każdej pracy (bez klucza, gdy go nie ma), a `notes` braki danych (gleba umowna, luka w opadzie z ostatnich 30 dni). Brak prognozy daje `status` `no_data` albo `error` z powodem.
