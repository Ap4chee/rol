# Zatrzymaj wodę, chroń plony

Prototyp na HackNation 2026 (zadanie KOWR). Rolnik wskazuje działkę ewidencyjną, uprawę i datę, a aplikacja pobiera otwarte dane, liczy dzienny bilans wodny FAO-56 i pokazuje raport: sytuacja wodna, przyczyny niedoboru, rekomendacje retencyjne i agrotechniczne, na końcu nawadnianie. Raport da się wydrukować albo zapisać jako PDF.

Wszystko liczy się na żywo dla podanej działki i daty. W kodzie nie ma gotowych wyników ani ścieżek specjalnych dla żadnej działki.

## Uruchomienie (Windows)

Wymagany jest Python 3.12 i dostęp do internetu. Nie potrzeba Dockera, bazy danych ani kluczy API.

Najprościej: dwukrotnie kliknij `start.bat`. Skrypt tworzy środowisko, instaluje zależności, startuje serwer i otwiera przeglądarkę na `http://127.0.0.1:8000`. Pierwsze uruchomienie trwa kilka minut (instalacja bibliotek).

Te same kroki ręcznie:

```bat
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Potem otwórz `http://127.0.0.1:8000`. Odpowiedzi zewnętrznych usług zapisują się w folderze `cache/`; usunięcie go wymusza pobranie wszystkiego od nowa.

### Praca nad interfejsem

Interfejs React jest w `frontend/`. Gotowy build `static/ui.js` i `static/ui.css` jest w repozytorium, więc zwykłe uruchomienie przez FastAPI działa bez Node.js. Po edycji frontendu użyj:

```sh
npm ci
npm run build
npm test
```

Na Linuxie lub macOS użyj `python3 -m venv .venv`, `.venv/bin/python -m pip install -r requirements.txt` i `.venv/bin/python -m uvicorn app.main:app`.

## Funkcje

- **Moje gospodarstwo**: tabela pól i karty na telefonie. Raporty i własne nazwy działek zapisują się w tej przeglądarce. Każdy wpis pokazuje datę analizy, stan wody, dostępne obserwacje zieloności i odnośnik do raportu.
- **Prognoza i działania**: pogoda na 7 dni dla wybranego pola, a obok najważniejsze zalecenia z zapisanych analiz.
- **Raport działki**: warstwy 3D pokazują rzeczywisty obrys z ULDK z poglądowymi teksturami. Widok z góry pokazuje podkłady Geoportalu lub OpenStreetMap oraz dostępne drogi spływu.

- **Wskazanie działki**: nazwa obrębu i numer (przy wielu trafieniach lista do wyboru), pełny identyfikator albo kliknięcie pola na mapie. Mapa ma podkłady „Zdjęcie lotnicze” i „Mapa” oraz nakładkę „Granice działek”.
- **Uprawy**: pszenica ozima, jęczmień jary, rzepak ozimy, kukurydza, ziemniak, burak cukrowy, użytki zielone.
- **Data**: dziś albo dowolny dzień z ostatnich 10 lat. Dla daty historycznej do obliczeń nie wchodzi nic późniejszego niż ta data, a porównania z 10 latami sięgają wstecz od niej.
- **Raport w narzuconej kolejności**:
  1. Sytuacja wodna: ubytek wody w strefie korzeni względem RAW i TAW w czterech klasach słownych, przedział niepewności gleby, klimatyczny bilans wodny z 60 dni, wykres, zdjęcia satelitarne (czy potwierdzają bilans), podatność w ostatnich 10 sezonach, podsumowanie minionego sezonu.
  2. Przyczyny: opad i ET0 z 30, 60 i 90 dni względem mediany z 10 lat, pojemność wodna gleby, faza uprawy, niedobór przeniesiony z poprzedniego sezonu, spadek terenu i skoncentrowany spływ, stan rzeki na najbliższym wodowskazie IMGW na tle tych samych dni w poprzednich latach (czy susza dotyczy też wód w okolicy).
  3. Rekomendacje retencyjne, 4. agrotechniczne, 5. nawadnianie (tylko gdy niedobór pozostaje i uprawa jest w fazie, w której ma to sens).
  - „Co sprawdzić na polu” tam, gdzie dane nie rozstrzygają.
  - Profil gleby, założenia o uprawie, źródła z datami i statusem, ograniczenia.
- **Data poza okresem wzrostu**: raport mówi to wprost, pokazuje stan zapasu wody w glebie i miniony sezon.
- **Awaria źródła**: raport powstaje, brak jest nazwany w tabeli źródeł razem z wpływem na wniosek. Bez pogody raport mówi, że oceny niedoboru nie da się policzyć.
- **Druk**: przyciski „Drukuj” i „Pobierz PDF” otwierają systemowe okno drukowania. Aby pobrać plik, wybierz w nim „Zapisz jako PDF”.
- **Odnośnik do raportu**: `http://127.0.0.1:8000/?parcel=060910_2.0011.580/2&crop=winter_wheat&date=2026-11-21` (raport i tak liczy się od nowa).

## Architektura

Jeden proces FastAPI serwuje API oraz skompilowany frontend React z OpenLayers. Lokalne raporty są przechowywane w pamięci przeglądarki.

```
app/
  main.py              endpointy HTTP i pliki statyczne
  report.py            orkiestracja: pobranie źródeł równolegle, obliczenia, teksty wniosków
  schemas.py           kontrakt API (pydantic)
  terrain_service.py   teren liczony w tle, pamięć podręczna po działce
  cache.py, config.py, geo.py, textfmt.py
  sources/             pobieranie danych (zwykłe importowalne funkcje, do użycia także przy treningu ML)
    uldk.py            działka z ULDK GUGiK
    weather.py         Open-Meteo Archive → NASA POWER → dobór ostatnich dni z Open-Meteo Forecast
    soilgrids.py       SoilGrids: WCS → REST → kafle GeoTIFF, średnia ważona komórek 250 m
    sentinel.py        Sentinel-2 L2A z Earth Search STAC: maska SCL, NDVI, NDMI
    terrain.py         NMT GUGiK 1 m z WCS, drogi spływu
    imgw_hydro.py      wodowskazy IMGW-PIB: bieżące pomiary i archiwum dobowe przepływów
  core/                obliczenia bez sieci (dane wchodzą jako argumenty)
    et0.py             ET0 FAO-56 Penmana-Monteitha
    ptf.py             pojemność polowa i punkt więdnięcia (Saxton i Rawls 2006), klasy uziarnienia USDA
    crops.py           tabela upraw: Kc, fazy, korzenie, współczynnik p z numerem tabeli FAO-56
    water_balance.py   dzienny bilans strefy korzeni, cztery klasy
    soil.py            warianty gleby z kwantyli SoilGrids
    analysis.py        okna 30/60/90 dni, klimatyczny bilans wodny, historia 10 sezonów
    satellite_logic.py zgodność wskaźników z bilansem
    hydrology.py       przepływ z 7 dni na tle tych samych dni w poprzednich latach, zgodność z bilansem
    flow.py            Priority-Flood, D8, powierzchnia zasilająca
    recommendations.py, terrain_rules.py   reguły rekomendacji
  data/soilgrids_tiles_pl.json   indeks kafli SoilGrids dla Polski (tryb awaryjny)
frontend/              komponenty React, style i testy prezentacji
static/                gotowy build React, OpenLayers i zasoby graficzne
tests/                 testy obliczeń bez sieci
scripts/               sprawdzenia na prawdziwych danych
```

Endpointy: `POST /api/report` (raport), `GET /api/satellite` i `GET /api/terrain` (części dociągane po raporcie), `GET /api/parcels/search|by-id|by-point`, `GET /api/crops` i `GET /api/forecast` (bieżąca prognoza dla współrzędnych pola). Opis w [docs/kontrakt_api.md](docs/kontrakt_api.md), schemat w [app/schemas.py](app/schemas.py), po uruchomieniu także pod `/docs`.

Frontend formatuje odpowiedzi API, przelicza udział dostępnego zapasu na procent i porządkuje dane w pulpicie. Bilans, klasy i zalecenia oblicza serwer. Historia w raporcie korzysta z podsumowań sezonów, a odtwarzanie pokazuje dostępne obserwacje zieloności z datami.

### Czas odpowiedzi

Zmierzone 21.11.2026 na pustej pamięci podręcznej, działka `060910_2.0011.580/2`, pszenica ozima, data bieżąca:

| Krok | Czas |
|---|---|
| ULDK (działka) | 0,1–0,6 s (raz 6,8 s) |
| Pogoda: odmowa Open-Meteo Archive (429), NASA POWER 11 lat, dobór ostatnich dni | 2–3 s |
| Gleba: SoilGrids WCS, 54 warstwy równolegle | 4–5 s |
| Hydrologia: lista wodowskazów IMGW i 11–20 plików archiwum (pusta pamięć podręczna) | 1–5 s |
| Satelita: szukanie scen, maski SCL 26 scen, pasma 3 scen | 10–14 s |
| Obliczenia (bilans 11 lat w 3 wariantach gleby, historia, reguły) | 0,05 s |
| **Raport razem** (źródła idą równolegle) | **11–15 s** |
| Teren i spływ (osobno, po raporcie) | 15–125 s, z czego obliczenia 0,8 s |

Raport czeka na zdjęcia satelitarne najwyżej 14 s. Gdy łącze do archiwum zdjęć jest wolne, sekcja satelitarna dostaje status „liczę” i uzupełnia się sama (`GET /api/satellite`), tak samo jak teren. Przy ciepłej pamięci podręcznej raport powstaje w ok. 1 s.

## Dane: źródła, zakresy, licencje

Wszystkie dane są bezpłatne. Żadne źródło nie wymaga klucza ani konta. Warunki sprawdzono na stronach dostawców 21.11.2026.

| Kategoria | Źródło i zakres | Jak pobierane | Licencja i warunki |
|---|---|---|---|
| Działka | ULDK GUGiK: geometria i położenie działki ewidencyjnej, cała Polska | na żywo, przy każdym raporcie | Bezpłatne, także komercyjnie; wymagane podanie źródła: „Główny Urząd Geodezji i Kartografii (GUGiK), Usługa Lokalizacji Działek Katastralnych (ULDK)”. Limit 200 zapytań/min (6–18), 40/min poza tym, 10 000 na dobę z jednego IP |
| Mapa | Ortofotomapa GUGiK (WMS), granice działek KIEG (WMS), OpenStreetMap | na żywo, w przeglądarce | GUGiK: brak opłat, zakaz masowego pobierania obrazów. OSM: © OpenStreetMap contributors (ODbL), kafle z `tile.openstreetmap.org` zgodnie z polityką użycia (atrybucja, bez pobierania hurtowego, bez gwarancji dostępności) |
| Pogoda (archiwum) | Open-Meteo Archive (ERA5, ERA5-Land, ECMWF IFS): opad, ET0, Tmin, Tmax dziennie, siatka ok. 9–25 km | na żywo, 11 lat przed datą jednym zapytaniem | Dane CC BY 4.0. **Darmowe API tylko do użytku niekomercyjnego**, limit 10 000 zapytań na dobę z jednego IP |
| Pogoda (archiwum, drugi dostawca) | NASA POWER: opad, temperatura, promieniowanie, wiatr, wilgotność dziennie; siatka 0,5° × 0,625° (MERRA-2), promieniowanie 1° × 1° (CERES) | na żywo, gdy Open-Meteo odmówi (429), zawiedzie albo nie odpowie | Bez ograniczeń użycia; NASA prosi o cytowanie: dane z projektu NASA Langley Research Center POWER, finansowanego przez NASA Earth Science Division |
| Pogoda (ostatnie dni i prognoza) | Open-Meteo Forecast: uzupełnianie ostatnich dni bilansu oraz 7-dniowa prognoza dla wybranego pola | na żywo. Prognoza ma pamięć podręczną na godzinę | jak Open-Meteo wyżej |
| Gleba | ISRIC SoilGrids 250 m v2.0: piasek, pył, ił, węgiel organiczny, gęstość w 6 warstwach do 200 cm, średnia i kwantyle 5% i 95% | na żywo przez WCS `maps.isric.org`; zapas: REST, potem kafle GeoTIFF | CC BY 4.0. REST: limit 5 zapytań/min, usługa oznaczona przez ISRIC jako wstrzymana (21.11.2026 odpowiadała) |
| Satelita | Sentinel-2 L2A z Earth Search STAC (Element 84), kolekcje `sentinel-2-c1-l2a` i `sentinel-2-l2a`: pasma B04, B8A, B11 i maska SCL, okno 45 dni przed datą, archiwum od 2017 r. | na żywo; czytane są tylko bloki rastra pod działką | Dane Copernicus Sentinel: dostęp bezpłatny, pełny i otwarty. Raport zawiera zmodyfikowane dane Copernicus Sentinel. Earth Search: bezpłatny katalog bez opublikowanych limitów |
| Teren | NMT GUGiK 1 m przez WCS (`DTM_PL-KRON86-NH_TIFF`), wycinek z buforem 200 m wokół działki | na żywo, osobny endpoint | Brak opłat, dowolne wykorzystanie |
| Hydrologia (rzeki) | IMGW-PIB, API danych publicznych (`api/data/hydro/`, zapas `hydro2/`): czynne wodowskazy ze współrzędnymi, ostatni stan wody [cm] i przepływ [m³/s]. Archiwum danych dobowych (`dane_hydrologiczne/dobowe/`): stan i przepływ z każdego dnia, lata hydrologiczne do 2025 (do 31.10.2025) | na żywo: lista wodowskazów (pamięć podręczna 3 h) i pliki archiwum tylko dla 7 dni wokół daty analizy w każdym z 11 lat (pliki niezmienne, raz pobrane zostają na dysku) | Bezpłatne; regulamin IMGW-PIB wymaga podania źródła („Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – Państwowy Instytut Badawczy”) i informacji o przetworzeniu danych, oba zdania są w raporcie. Według regulaminu nieodpłatne użycie obejmuje cele prywatne, a w każdym celu dane o wysokiej wartości (rozporządzenie wykonawcze KE 2023/138); użycie w działalności gospodarczej poza tym wymaga umowy z IMGW-PIB. Przed wdrożeniem przez KOWR trzeba to potwierdzić z IMGW-PIB (regulamin sprawdzony 21.11.2026 na danepubliczne.imgw.pl/regulations) |
| Hydrologia (cieki przy działce) | MPHP10k (Wody Polskie, ISOK) | **nieużywane** | WFS z danymi wektorowymi wymaga logowania; publiczny WMS daje tylko obraz. Raport podaje, że odległości od cieku nie policzono |

Podstawa prawna bezpłatnego udostępniania danych GUGiK: art. 40a ust. 2 Prawa geodezyjnego i kartograficznego (zmiana z 16.04.2020, Dz.U. 2020 poz. 782).

### Co jest pobierane na żywo, a co przygotowane wcześniej

Na żywo, przy każdym raporcie: działka, pogoda, gleba, zdjęcia satelitarne, model terenu, wodowskazy IMGW, podkłady mapy.

Przygotowane wcześniej i zapisane w repozytorium:

| Plik | Co zawiera | Data |
|---|---|---|
| `app/core/crops.py` | współczynniki Kc, długości faz, głębokość korzeni i p z FAO-56 (tab. 11, 12, 22), przepisane z tekstu na fao.org | 21.11.2026 |
| `app/core/ptf.py` | równania Saxtona i Rawlsa (2006, tab. 1) oraz REW z FAO-56 tab. 19 | 21.11.2026 |
| `app/data/soilgrids_tiles_pl.json` | położenie 63 kafli SoilGrids nad Polską, wyciągnięte z pliku VRT ISRIC; używane tylko w trybie awaryjnym. Nie zawiera wartości gleby | 21.11.2026 |
| `outputs/assety_gleby/webp/` | umowne ilustracje warstw gleby (wygenerowane narzędziem AI, patrz niżej) | 21.11.2026 |
| `static/vendor/` | OpenLayers 10.11.0 i czcionki | 21.11.2026 |

Pamięć podręczna `cache/` powstaje dopiero przy uruchomieniu i nie jest częścią repozytorium.

## Biblioteki, usługi i AI

| Składnik | Do czego | Licencja (źródło: metadane pakietu na PyPI / repozytorium) |
|---|---|---|
| FastAPI 0.165.0 | serwer API | MIT |
| Uvicorn 0.54.0 | serwer ASGI | BSD-3-Clause |
| Starlette 1.10.0, Pydantic 2.14.4 | zależności FastAPI | BSD-3-Clause, MIT |
| httpx 0.28.1 | zapytania HTTP | BSD-3-Clause |
| rasterio 1.5.2 (z GDAL) | odczyt rastrów | BSD-3-Clause; licencji bibliotek natywnych w paczce (GDAL, PROJ i inne) nie sprawdzaliśmy osobno |
| pystac-client 0.9.1, pystac 1.16.1 | katalog STAC | Apache-2.0 |
| Shapely 2.2.0 | geometria | BSD-3-Clause |
| pyproj 3.8.0 | układy współrzędnych | MIT |
| NumPy 2.5.5 | obliczenia | BSD-3-Clause (z częściami 0BSD, MIT, Zlib, CC0-1.0) |
| tzdata 2026.6 | strefa czasowa na Windows | Apache-2.0 |
| pytest 9.2.0 | testy | MIT |
| certifi (zależność httpx) | certyfikaty | MPL-2.0 |
| OpenLayers 10.11.0 | mapa w przeglądarce | BSD-2-Clause (`static/vendor/OL_LICENSE.md`) |
| React i React DOM 19.3.1 | komponenty i renderowanie UI | MIT ([React](https://github.com/react/react/blob/main/LICENSE), `static/vendor/REACT_LICENSE.txt`) |
| esbuild 0.28.2 | budowanie frontendu | MIT ([esbuild](https://github.com/evanw/esbuild/blob/main/LICENSE.md)) |
| Bricolage Grotesque, Inter, JetBrains Mono | samodzielnie serwowane fonty interfejsu | SIL Open Font License 1.1 (`static/design/fonts/*-OFL.txt`) |

Żadna zależność nie ma licencji GPL ani AGPL. Analizę spływu napisaliśmy sami w NumPy, żeby nie używać `pysheds` (GPL) ani GRASS (GPL).

**Usługi płatne.** Aplikacja nie korzysta z żadnej płatnej usługi. Jedyne ograniczenie to Open-Meteo: darmowe API jest tylko do użytku niekomercyjnego. Przy wdrożeniu komercyjnym trzeba albo wykupić plan (archiwum pogody wymaga planu „API Professional”, 99 EUR miesięcznie; „API Standard” za 29 EUR go nie obejmuje), albo zostać przy NASA POWER, które jest bezpłatne bez ograniczeń i już działa jako drugi dostawca.

**AI.** W działającej aplikacji nie ma modelu AI ani uczenia maszynowego: liczby pochodzą z obliczeń, a teksty raportu z reguł w kodzie (`app/core/recommendations.py`, `app/core/terrain_rules.py`, `app/report.py`). Model prognozy NDMI opisany w `outputs/specyfikacja_treningu_ml_kowr.md` nie jest częścią tego prototypu. AI użyto przy tworzeniu: kod i dokumentację pisaliśmy z pomocą asystentów programistycznych (Claude Code, Codex), a ilustracje warstw gleby w `outputs/assety_gleby/` wygenerowało narzędzie ImageGen (opis w `outputs/assety_gleby/README.md`). Ilustracje są umowne i tak są podpisane w raporcie. Zasoby z projektu Penpot w `static/design/` również powstały przy użyciu ImageGen. Pełnią funkcję ilustracyjną.

## Jak liczony jest wynik

1. **ET0**: z Open-Meteo gotowe, z NASA POWER liczone wzorem FAO-56 Penmana-Monteitha (`app/core/et0.py`).
2. **Gleba**: z uziarnienia i węgla organicznego funkcja Saxtona i Rawlsa (2006) daje pojemność polową i punkt więdnięcia każdej warstwy; średnia ważona w strefie korzeni daje TAW, a RAW = p · TAW.
3. **Bilans dzienny** (FAO-56, rozdz. 8) przez 11 lat przed datą: ETc = Kc · ET0, współczynnik stresu Ks, przesiąk nadmiaru. Start co najmniej 12 miesięcy przed pierwszym porównywanym sezonem, więc stan początkowy nie ma znaczenia. Gdy pole jest bez uprawy, liczone jest parowanie z odkrytej gleby (FAO-56, rozdz. 7).
4. **Klasy**: brak niedoboru (ubytek do połowy RAW), zapas łatwo dostępnej wody się kończy (do RAW), niedobór umiarkowany (powyżej RAW, Ks ≥ 0,5), niedobór silny (Ks < 0,5).
5. **Niepewność**: ten sam bilans dla granic gleby z kwantyli SoilGrids. Jeśli wynik wypada w różnych klasach, raport mówi to wprost.
6. **Satelita**: mediana NDVI i NDMI po pikselach z roślinnością (SCL 4, środki pikseli w działce, co najmniej 6 pikseli i 65% pokrycia). Wskaźniki służą tylko do sprawdzenia bilansu: raport mówi, czy go potwierdzają, czy się z nim rozchodzą.
7. **Teren**: wypełnienie zagłębień Priority-Flood, kierunki D8, powierzchnia zasilająca; na mapie drogi spływu powyżej 0,05 ha i punkty, w których przecinają granicę działki.
8. **Rekomendacje**: reguły z jawnymi progami. Każda podaje, co zrobić, gdzie, dlaczego (z wartościami tej działki) i jak pewny jest wniosek.

## Weryfikacja wyników

Testy bez sieci (`.venv\Scripts\python.exe -m pytest -q`):

- ET0: przykład 18 z FAO-56 (Uccle, 6 lipca): 3,88 mm na dobę, razem z wynikami pośrednimi.
- Bilans: przykład 37 z FAO-56 (przebieg ubytku przez 10 dni), domknięcie bilansu, ograniczenie parowania z odkrytej gleby.
- Funkcja pedotransferowa: wszystkie 12 wierszy tabeli 3 Saxtona i Rawlsa (2006), np. glina 40% piasku i 20% iłu: 28% i 14% objętości.
- SoilGrids: wagi komórek i wartości dla działki 580/2 zgodne z `outputs/soilgrids_niedrzwica_koscielna_580_2.json` (0–5 cm: piasek 33,7%, pył 48,2%, ił 18,1%).
- Spływ: sztuczne powierzchnie (płaszczyzna, dolina, zagłębienie), reguły rekomendacji, zgodność satelity z bilansem.
- Prognoza: siedem dni od daty w Polsce, zachowanie braków danych i rzeczywistego opadu 0 mm.
- Pulpit (`npm test`): zapis pól, obsługa dat, zapas wody, obserwacje satelitarne i kolejność działań.
- Hydrologia: miesiące roku hydrologicznego zgodne z nazwami plików IMGW, porównanie tylko z latami przed datą analizy, odczyt wierszy archiwum we wszystkich trzech formatach używanych przez IMGW (do 2022, 2023, od 2024).

Sprawdzenia na prawdziwych danych (wymagają sieci):

| Skrypt | Co sprawdza | Wynik 21.11.2026 |
|---|---|---|
| `scripts/check_sentinel.py` | wzorzec dla 580/2 | 04.06.2025: 11/11 pikseli, NDMI 0,59225; 19.06.2025 odrzucona; 21.06.2025: 0,54090. Zgodne |
| `scripts/check_weather_providers.py` | ET0 liczone z NASA POWER wobec ET0 z Open-Meteo na wspólnych dniach | 66 dni, dwa punkty: stosunek sum ET0 1,07 i 0,97; opadu 0,78 i 1,19 |
| `scripts/check_terrain.py` | spływ dla 580/2 | największy odpływ 1,60 ha przy południowo-wschodniej granicy (wzorzec 1,63 ha); liczba punktów 5 + 2 wobec 4 + 4 we wzorcu |
| `scripts/acceptance.py` | pusty cache i wymuszone awarie źródeł (`KOWR_FAIL`) | raport powstaje, brak jest nazwany |
| `scripts/run_report.py`, `scripts/http_check.py` | raport z wiersza poleceń i przez HTTP | |
| `scripts/run_report.py` (sekcja `[hydrologia]`) | wodowskaz IMGW dla 580/2 dziś, Kościana 15.07.2018, 580/2 15.07.2026 | Lublin (Bystrzyca, 19 km): przepływ 1,01 m³/s, wyższy w 9 z 9 lat, „bardzo mało wody”; Kościan (Kanał Mosiński, 5 km): 0,18 m³/s wobec mediany 1,37, wyższy w 9 z 10 lat (susza 2018); 15.07.2026: brak danych podany wprost (archiwum kończy się 31.10.2025) |

Sprawdzian merytoryczny: jęczmień jary 15.07.2018 w Wielkopolsce (gm. Kościan) daje niedobór umiarkowany do silnego, klimatyczny bilans wodny −184 mm przy medianie −110 mm, a NDMI spadł w czerwcu z 0,29 do 0,13, co potwierdza bilans.

## Ograniczenia

- **Model, nie pomiar.** Pogoda pochodzi z siatki modelu (NASA POWER ok. 50 km), gleba z mapy globalnej 250 m. Lokalna burza albo płat piasku zmieniają wynik. Dlatego raport pokazuje przedział i klasy słowne, a nie wilgotność z dokładnością do procenta.
- **Dostawcy pogody różnią się między sobą**: na 66 wspólnych dniach suma opadu z NASA POWER wyniosła 78% i 119% sumy z Open-Meteo. Cała seria 10 lat pochodzi zawsze z jednego dostawcy, więc porównania z medianą są spójne, ale wartości bezwzględne zależą od tego, który dostawca odpowiedział.
- **Bilans nie zna** spływu powierzchniowego, podsiąku z wody gruntowej, drenów, śniegu, zamarznięcia gleby ani nawadniania.
- **Kalendarz uprawy jest umowny**: terminy siewu, faz i zbioru są założeniami dla Polski, głębokość korzeni jest stała przez sezon, Kc bez poprawki klimatycznej. Rolnik nie podaje daty siewu.
- **Historia 10 sezonów** zakłada tę samą uprawę co roku.
- **Przedział niepewności gleby jest szeroki**, bo kwantyle SoilGrids opisują 90-procentowy przedział predykcji; na lekkich glebach wynik często obejmuje dwie klasy.
- **Satelita**: wskaźniki liczone dla trzech scen z 45 dni; przy zachmurzeniu albo małej działce (mniej niż 6 pikseli 20 m) sekcja podaje brak danych. Łącze do archiwum scen (AWS us-west-2) bywało bardzo wolne, wtedy wynik dochodzi po raporcie.
- **Teren**: wynik czysto topograficzny. Wysokości z WCS różniły się od arkusza NMT użytego we wzorcu o 0,3–0,5 m (inna wersja danych), a liczba punktów na granicy zależy od progu łączenia.
- **Hydrologia**: stan rzeki pochodzi z najbliższego wodowskazu IMGW (do 40 km) i opisuje całą zlewnię powyżej niego, nie wodę na polu; zbiorniki i zrzuty mogą go zmieniać. Archiwum IMGW kończy się 31.10.2025, a bieżący pomiar dotyczy tylko dnia dzisiejszego, więc dla dat od 01.11.2025 do wczoraj raport podaje brak danych hydrologicznych. Bieżący pomiar to pojedynczy odczyt, porównywany ze średnimi z 7 dni. Brak danych o odległości od cieków i o wodzie gruntowej (patrz tabela źródeł).
- **FAO-56**: tabele pochodzą z wydania z 1998 r. dostępnego na fao.org. Materiał KOWR cytuje wydanie poprawione z 2025 r.; nie porównaliśmy tabel między wydaniami.
- **Progi reguł** rekomendacji i zgodności satelity z bilansem są założeniami roboczymi zapisanymi jako stałe w kodzie, nie wartościami z publikacji.
- Prototyp dla jednego użytkownika na komputerze lokalnym: bez kont, bazy danych i danych osobowych.

## Skala, limity i koszty

- Jeden raport to: 1 zapytanie ULDK, 2–3 zapytania o pogodę, 1 zapytanie o wodowskazy IMGW i do 20 plików archiwum IMGW (0,15–1,9 MB, tylko przy pierwszym użyciu), 54 małe zapytania WCS o glebę, 2 zapytania STAC i kilkadziesiąt odczytów fragmentów scen, 1 zapytanie WCS o teren.
- Pamięć podręczna na dysku: pogoda po komórce 0,01° i zakresie dat, gleba po oknie siatki 250 m, obserwacje satelitarne po działce i scenie, teren po działce, pliki archiwum IMGW bez zmian (`cache/imgw_zip/`), lista wodowskazów przez 3 h. Dane historyczne się nie zmieniają, więc powtórny raport nie odpytuje usług. Ostatnie dni pogody odświeżają się co godzinę.
- Wąskie gardła przy większym ruchu: limit dzienny Open-Meteo na adres IP, limit ULDK (10 000 zapytań na dobę) i czas WCS z modelem terenu. Rozwiązania: własna kopia NMT i SoilGrids dla Polski (dane są otwarte), kolejka zadań dla terenu i satelity, płatny plan pogody albo NASA POWER.
- Koszt danych: 0 zł.
