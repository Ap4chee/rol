# Kontrakt API

Źródłem prawdy jest [app/schemas.py](../app/schemas.py). Po uruchomieniu serwera pełny schemat z opisami pól jest pod `/docs` (Swagger) i `/openapi.json`.

Zasady:

- Oceny i zalecenia liczy serwer. Frontend formatuje i prezentuje wyniki.
- Każda sekcja ma `status` (`ok`, `no_data`, `error`, dla terenu także `pending`) i `reason`.
- Każde źródło danych ma wpis w `sources`: status, powód, nazwa, rozdzielczość, daty danych, licencja, czas pobrania.
- Jednostki są w nazwach pól (`_mm`, `_pct`, `_ha`, `_m`). Współrzędne w odpowiedzi: EPSG:4326, kolejność lon, lat.
- Kolejność sekcji raportu jest narzucona przez zadanie: sytuacja wodna, przyczyny, rekomendacje retencyjne, agrotechniczne, nawadnianie, potem źródła i ograniczenia.

## `POST /api/report`

Wejście: identyfikator działki albo punkt (dokładnie jedno z dwojga), uprawa, data.

```json
{"parcel_id": "060910_2.0011.580/2", "crop": "winter_wheat", "date": "2026-11-21"}
```

```json
{"point": {"lon": 22.3559, "lat": 51.0933}, "crop": "spring_barley", "date": "2018-07-15"}
```

Uprawy (`crop`): `winter_wheat`, `spring_barley`, `winter_rapeseed`, `maize`, `potato`, `sugar_beet`, `grassland`. Lista z polskimi nazwami: `GET /api/crops`.

Wyjście (`ReportResponse`), pola najwyższego poziomu:

| Pole | Zawartość |
|---|---|
| `parcel` | identyfikator, położenie administracyjne, powierzchnia, geometria GeoJSON |
| `crop` | uprawa, faza w dniu analizy, Kc, głębokość korzeni, założenia |
| `summary` | najważniejsze wnioski, 2–4 zdania |
| `water_status` | bilans wodny FAO-56: klasa niedoboru, wyczerpanie względem RAW i TAW, przedział niepewności, klimatyczny bilans wodny 60 dni, przebieg dzienny (zapas w % z pasmem 10/50/90 percentyla tych samych dni w 10 latach), dla analizy na dziś prognoza zapasu na 7 dni (`forecast`, `forecast_stress_day`) |
| `satellite` | obserwacje NDVI i NDMI z Sentinel-2 i to, czy potwierdzają bilans |
| `history` | ten sam bilans dla 10 poprzednich sezonów |
| `causes` | przyczyny wynikające z danych: opad i ET0 względem mediany 10 lat, gleba, faza uprawy |
| `soil` | warstwy gleby z SoilGrids i wyliczona pojemność wodna |
| `soil_moisture` | wilgotność 3 warstw w okolicy (NASA POWER, ok. 50 km) na tle tych samych dni w 10 latach, albo jawny brak danych |
| `terrain` | `pending` i adres, pod którym frontend dociąga teren i spływ |
| `hydrology` | odległość do najbliższego cieku albo jawny brak danych |
| `recommendations` | `retention`, `agrotechnical`, `irrigation`, `field_checks`; każda pozycja: co, gdzie, dlaczego, pewność |
| `limitations` | uproszczenia modelu i braki danych |
| `sources` | lista źródeł ze statusem i datami |
| `timings_s` | zmierzone czasy kroków |

Błędne wejście (zły format, data z przyszłości, punkt poza Polską) daje `422` z opisem po polsku.

## `GET /api/terrain?parcel_id=...`

Teren i spływ liczone osobno, bo wycinek NMT z WCS GUGiK trwa kilkanaście sekund. Wynik (`TerrainResponse`): spadek, drogi spływu i punkty wejścia/wyjścia jako GeoJSON, a także dodatkowe przyczyny i rekomendacje wynikające z terenu, które frontend dopisuje do odpowiednich sekcji raportu.

## `GET /api/satellite?parcel_id=...&crop=...&date=...`

Raport czeka na zdjęcia Sentinel-2 najwyżej kilkanaście sekund. Gdy łącze do archiwum zdjęć jest wolne, sekcja `satellite` ma status `pending` i pole `endpoint` z tym adresem, a pobieranie trwa dalej w tle. Wynik (`SatelliteResponse`): pełna sekcja `satellite`, wpis źródła i ewentualne oględziny pola (`field_checks`), które frontend dopisuje do listy.

## `GET /api/parcels/search?q=...`, `GET /api/parcels/by-point?lon=..&lat=..`, `GET /api/parcels/by-id?id=...`

Wyszukiwanie działki po nazwie obrębu i numerze (może zwrócić wiele trafień do wyboru), po punkcie na mapie albo po pełnym identyfikatorze. Dwa ostatnie zwracają też geometrię działki (`parcel`).

## `GET /api/forecast?lon=...&lat=...`

Bieżąca prognoza Open-Meteo dla współrzędnych pola, poza historycznym bilansem raportu. `ForecastResponse` zawiera status oraz dobową temperaturę maksymalną, opad, parowanie wskaźnikowe i kod pogody na siedem dni w strefie Europe/Warsaw. Pomiary niedostępne mają wartość `null`. `last_wet_day` wskazuje ostatni dzień z opadem powyżej 5 mm w dostępnych danych z poprzednich 30 dni. `past_days_complete` sygnalizuje, czy sprawdzono cały okres. Cache ma ważność godziny.
