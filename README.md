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

Interfejs React jest w `frontend/`: komponenty Spectrum UI skopiowane do `frontend/components/spectrumui/`, własne podstawowe komponenty w `frontend/components/ui/`, style Tailwind CSS v4 i tokeny wyglądu (kolory, fonty, krzywe ruchu) w `frontend/app.css`. Gotowy build `static/ui.js` i `static/ui.css` jest w repozytorium, więc zwykłe uruchomienie przez FastAPI działa bez Node.js. `npm run build` buduje JavaScript (esbuild) i CSS (Tailwind CLI). Po edycji frontendu użyj:

```sh
npm ci
npm run build
npm test
```

### Inny wygląd niż u innej osoby z zespołu

Jeśli pod `http://127.0.0.1:8000` widzisz inny interfejs niż ktoś z zespołu, sprawdź po kolei:

1. Czy jesteś w repozytorium `rol` na aktualnym `main`: `git pull --rebase`, potem `git log -1` (u obu osób ten sam commit).
2. Czy serwer był uruchomiony po ostatnim `git pull`. Uvicorn działa bez `--reload`, więc nowy kod API wchodzi dopiero po restarcie (Ctrl+C i ponowne uruchomienie). Pliki z `static/` są czytane z dysku przy każdym żądaniu.
3. Czy przeglądarka nie trzyma starego `ui.js` i `ui.css` (adresy nie mają wersji). Odśwież stronę z Ctrl+F5 albo otwórz ją w oknie prywatnym.
4. Czy `git status` nie pokazuje zmienionego `static/ui.js`. Lokalny `npm run build` po edycji `frontend/` daje inny build niż ten w repozytorium.

`127.0.0.1` to zawsze własny komputer, więc każda osoba widzi swoją kopię aplikacji. Żeby udostępnić swoją w sieci lokalnej, uruchom serwer z `--host 0.0.0.0` i podaj adres `http://<twoje-IP>:8000`.

Na Linuxie lub macOS użyj `python3 -m venv .venv`, `.venv/bin/python -m pip install -r requirements.txt` i `.venv/bin/python -m uvicorn app.main:app`.

## Funkcje

- **Pulpit**: liczba pól w każdym stanie wody, pola ułożone od najpilniejszego, najbliższe działania z zapisanych analiz i pogoda na 7 dni dla wybranego pola. Pola, ich nazwy i raporty zapisują się w tej przeglądarce.
- **Dodaj pole**: jedno okno z formularzem i mapą obok. To samo okno służy do ponownego przeliczenia raportu.
- **Widok pola** w zakładkach: Podsumowanie, Rekomendacje, Gleba, Pogoda, Teren i woda, Historia, Źródła. Model 3D pokazuje rzeczywisty obrys działki, warstwy gleby z SoilGrids i uprawę w fazie z dnia analizy (tekstury są poglądowe). Widok z góry pokazuje podkłady Geoportalu lub OpenStreetMap oraz drogi spływu.

- **Wskazanie działki**: nazwa obrębu i numer (przy wielu trafieniach lista do wyboru), pełny identyfikator albo kliknięcie pola na mapie. Mapa ma podkłady „Zdjęcie lotnicze” i „Mapa” oraz nakładkę „Granice działek”. Gdy usługa ULDK nie odpowiada, granica przychodzi z zapasowej usługi GUGiK (zbiorczy WFS ewidencji); działa wtedy pełny identyfikator, kliknięcie na mapie i wyszukiwanie „nazwa obrębu numer” (kod obrębu z rejestru PRG GUGiK, potem działka z WFS ewidencji; bez działek w arkuszach AR_n).
- **Uprawy**: pszenica ozima, jęczmień jary, rzepak ozimy, kukurydza, ziemniak, burak cukrowy, użytki zielone.
- **Data**: dziś albo dowolny dzień z ostatnich 10 lat. Dla daty historycznej do obliczeń nie wchodzi nic późniejszego niż ta data, a porównania z 10 latami sięgają wstecz od niej. Formularz nie pozwala wybrać dnia starszego niż 10 lat ani z przyszłości.
- **Raport w narzuconej kolejności**:
  1. Sytuacja wodna: ubytek wody w strefie korzeni względem RAW i TAW w czterech klasach słownych, przedział niepewności gleby, klimatyczny bilans wodny z 60 dni, wykres, zdjęcia satelitarne (czy potwierdzają bilans), podatność w ostatnich 10 sezonach, podsumowanie minionego sezonu.
  2. Przyczyny: opad i ET0 z 30, 60 i 90 dni względem mediany z 10 lat, pojemność wodna gleby, faza uprawy, niedobór przeniesiony z poprzedniego sezonu, spadek terenu i skoncentrowany spływ, stan rzeki na najbliższym wodowskazie IMGW na tle tych samych dni w poprzednich latach (czy susza dotyczy też wód w okolicy).
  3. Rekomendacje retencyjne, 4. agrotechniczne, 5. nawadnianie (tylko gdy niedobór pozostaje i uprawa jest w fazie, w której ma to sens). Przy nawadnianiu: ile wody netto potrzebowałaby uprawa w tym sezonie, w typowym i w suchym roku (bilans FAO-56 z dawką 25 mm, gdy zapas spada poniżej progu stresu).
  - „Co sprawdzić na polu” tam, gdzie dane nie rozstrzygają.
  - Profil gleby, założenia o uprawie, źródła z datami i statusem, ograniczenia.
- **Data poza okresem wzrostu**: raport mówi to wprost, pokazuje stan zapasu wody w glebie i miniony sezon.
- **Awaria źródła**: raport powstaje, brak jest nazwany w tabeli źródeł razem z wpływem na wniosek. Bez pogody raport mówi, że oceny niedoboru nie da się policzyć.
- **Druk i PDF**: przycisk „PDF” w widoku pola otwiera systemowe okno drukowania; aby pobrać plik, wybierz w nim „Zapisz jako PDF”. Wydruk składa wszystkie zakładki w jeden dokument w kolejności: ocena, historia, pogoda, gleba, teren i woda, rekomendacje, źródła.
- **Tryb testowy** (`?test` w adresie): w formularzu pojawia się przełącznik, który podmienia w widoku obrys działki na umowny kształt i dodaje obszar zasiewu. Analiza i tak liczy się na żywo dla wskazanego punktu. Służy do sprawdzania modelu 3D, nie jest częścią zwykłej ścieżki rolnika.
- **Odnośnik do raportu**: `http://127.0.0.1:8000/?parcel=060910_2.0011.580/2&crop=winter_wheat&date=2026-11-21` (raport i tak liczy się od nowa).

## Architektura

Jeden proces FastAPI serwuje API oraz skompilowany frontend React (komponenty Spectrum UI, Tailwind CSS) z OpenLayers. Lokalne raporty są przechowywane w pamięci przeglądarki.

```
app/
  main.py              endpointy HTTP i pliki statyczne
  report.py            orkiestracja: pobranie źródeł równolegle, obliczenia, teksty wniosków
  schemas.py           kontrakt API (pydantic)
  terrain_service.py   teren liczony w tle, pamięć podręczna po działce
  cache.py, config.py, geo.py, textfmt.py
  sources/             pobieranie danych (zwykłe importowalne funkcje, do użycia także przy treningu ML)
    parcels.py         wyszukiwanie działki: wybór źródła (ULDK → WFS EGiB), cache, pochodzenie wyniku
    uldk.py            adapter ULDK GUGiK (sam protokół)
    egib_wfs.py        adapter zapasowy: granica działki ze zbiorczego WFS ewidencji GUGiK, kody obrębów z PRG
    weather.py         Open-Meteo Archive → NASA POWER → dobór ostatnich dni z Open-Meteo Forecast
    soilgrids.py       SoilGrids: WCS → REST → kafle GeoTIFF, średnia ważona komórek 250 m
    sentinel.py        Sentinel-2 L2A z Earth Search STAC: maska SCL, NDVI, NDMI
    terrain.py         NMT GUGiK 1 m z WCS, drogi spływu
    imgw_hydro.py      wodowskazy IMGW-PIB: bieżące pomiary i archiwum dobowe przepływów
    soil_moisture.py   NASA POWER: wilgotność gleby w 3 warstwach (MERRA-2), 11 lat
  core/                obliczenia bez sieci (dane wchodzą jako argumenty)
    et0.py             ET0 FAO-56 Penmana-Monteitha
    ptf.py             pojemność polowa i punkt więdnięcia (Saxton i Rawls 2006), klasy uziarnienia USDA
    crops.py           tabela upraw: Kc, fazy, korzenie, współczynnik p z numerem tabeli FAO-56
    water_balance.py   dzienny bilans strefy korzeni, cztery klasy
    water_assessment.py ocena w dniu analizy (ubytek, RAW, dni do stresu) w pełnej precyzji dla raportu i reguł
    soil.py            warianty gleby z kwantyli SoilGrids
    analysis.py        okna 30/60/90 dni, klimatyczny bilans wodny, historia 10 sezonów
    satellite_logic.py zgodność wskaźników z bilansem
    hydrology.py       przepływ z 7 dni na tle tych samych dni w poprzednich latach, zgodność z bilansem
    soil_moisture.py   wilgotność warstw w okolicy na tle tych samych dni w poprzednich latach
    flow.py            Priority-Flood, D8, powierzchnia zasilająca
    recommendations.py, terrain_rules.py   reguły rekomendacji
  data/soilgrids_tiles_pl.json   indeks kafli SoilGrids dla Polski (tryb awaryjny)
frontend/              komponenty React, style (app.css, Tailwind) i testy prezentacji
  components/spectrumui/  komponenty Spectrum UI (Apache-2.0, plik LICENSE), dostosowane do aplikacji
  components/ui/       podstawowe komponenty: przycisk, pola, zakładki, okno, tabela, plakietki stanu
  report/              zakładki widoku pola
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
| Teren i spływ (osobno, po raporcie) | 15–125 s, z czego obliczenia 0,8 s; raz, dla działki 8,6 ha, serwer GUGiK z modelem terenu nie odpowiedział w 180 s i raport podał brak analizy spływu |

Raport czeka na zdjęcia satelitarne najwyżej 14 s. Gdy łącze do archiwum zdjęć jest wolne, sekcja satelitarna dostaje status „liczę” i uzupełnia się sama (`GET /api/satellite`), tak samo jak teren. Przy ciepłej pamięci podręcznej raport powstaje w ok. 1 s.

Na 24 działkach z całej Polski i datach 2016–2026 (pusta pamięć podręczna, `scripts/sweep_poland.py`, 21.11.2026) raport powstawał w 6,6–15,5 s, mediana 11,9 s. Granica działki z zapasowego WFS ewidencji przychodziła w 0,3–1,4 s.

## Dane: źródła, zakresy, licencje

Wszystkie dane są bezpłatne. Żadne źródło nie wymaga klucza ani konta. Warunki sprawdzono na stronach dostawców 21.11.2026.

| Kategoria | Źródło i zakres | Jak pobierane | Licencja i warunki |
|---|---|---|---|
| Działka | ULDK GUGiK: geometria i położenie działki ewidencyjnej, cała Polska | na żywo, przy każdym raporcie | Bezpłatne, także komercyjnie; wymagane podanie źródła: „Główny Urząd Geodezji i Kartografii (GUGiK), Usługa Lokalizacji Działek Katastralnych (ULDK)”. Limit 200 zapytań/min (6–18), 40/min poza tym, 10 000 na dobę z jednego IP |
| Działka (zapas) | Zbiorcza usługa WFS ewidencji gruntów i budynków GUGiK (`mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza`, warstwa `ms:dzialki`): granica, numer, obręb i gmina; bez nazwy powiatu | na żywo, tylko gdy ULDK nie odpowiada; po punkcie albo pełnym identyfikatorze | Dane ewidencji udostępniane przez GUGiK bezpłatnie, jak ULDK. Limitów tej usługi nie znaleźliśmy w dokumentacji |
| Obręb (zapas) | Usługa WFS granic administracyjnych PRG GUGiK (`mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries`, warstwa `ms:A06_Granice_obrebow_ewidencyjnych`): kod TERYT obrębu po nazwie | na żywo, tylko gdy ULDK nie odpowiada, przy wyszukiwaniu po nazwie obrębu | Dane PRG udostępniane przez GUGiK bezpłatnie, bez klucza |
| Mapa | Ortofotomapa GUGiK (WMS), granice działek KIEG (WMS), OpenStreetMap | na żywo, w przeglądarce | GUGiK: brak opłat, zakaz masowego pobierania obrazów. OSM: © OpenStreetMap contributors (ODbL), kafle z `tile.openstreetmap.org` zgodnie z polityką użycia (atrybucja, bez pobierania hurtowego, bez gwarancji dostępności) |
| Pogoda (archiwum) | Open-Meteo Archive (ERA5, ERA5-Land, ECMWF IFS): opad, ET0, Tmin, Tmax dziennie, siatka ok. 9–25 km | na żywo, 11 lat przed datą jednym zapytaniem | Dane CC BY 4.0. **Darmowe API tylko do użytku niekomercyjnego**, limit 10 000 zapytań na dobę z jednego IP |
| Pogoda (archiwum, drugi dostawca) | NASA POWER: opad, temperatura, promieniowanie, wiatr, wilgotność dziennie; siatka 0,5° × 0,625° (MERRA-2), promieniowanie 1° × 1° (CERES) | na żywo, gdy Open-Meteo odmówi (429), zawiedzie albo nie odpowie | Bez ograniczeń użycia; NASA prosi o cytowanie: dane z projektu NASA Langley Research Center POWER, finansowanego przez NASA Earth Science Division |
| Wilgotność gleby w warstwach (okolica) | NASA POWER: `GWETTOP` (0–5 cm), `GWETROOT` (0–100 cm), `GWETPROF` (cały profil), wilgotność względna 0–1 z modelu MERRA-2, dziennie, siatka 0,5° × 0,625°; w raporcie średnia z 7 dni na tle tych samych dni w 10 poprzednich latach | na żywo, 11 lat przed datą jednym zapytaniem, równolegle z pogodą | jak NASA POWER wyżej |
| Pogoda (ostatnie dni i prognoza) | Open-Meteo Forecast: uzupełnianie ostatnich dni bilansu oraz 7-dniowa prognoza dla wybranego pola | na żywo. Prognoza ma pamięć podręczną na godzinę | jak Open-Meteo wyżej |
| Gleba | ISRIC SoilGrids 250 m v2.0: piasek, pył, ił, węgiel organiczny, gęstość w 6 warstwach do 200 cm, średnia i kwantyle 5% i 95% | na żywo przez WCS `maps.isric.org`; zapas: REST, potem kafle GeoTIFF | CC BY 4.0. REST: limit 5 zapytań/min, usługa oznaczona przez ISRIC jako wstrzymana (21.11.2026 odpowiadała) |
| Satelita | Sentinel-2 L2A z Earth Search STAC (Element 84), kolekcje `sentinel-2-c1-l2a` i `sentinel-2-l2a`: pasma B04, B8A, B11 i maska SCL, okno 45 dni przed datą, archiwum od 2017 r. | na żywo; czytane są tylko bloki rastra pod działką | Dane Copernicus Sentinel: dostęp bezpłatny, pełny i otwarty. Raport zawiera zmodyfikowane dane Copernicus Sentinel. Earth Search: bezpłatny katalog bez opublikowanych limitów |
| Grunty orne (tylko trening modelu ML) | ESA WorldCover 10 m 2021 v200, klasa 40 (grunty orne): wybór 2531 pól pilotażowych 80 × 80 m w 20 skupiskach | jednorazowo przy budowie zbioru treningowego (21.11.2026), aplikacja z tego nie korzysta | CC BY 4.0; atrybucja: „© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium” (esa-worldcover.org, sprawdzone 21.11.2026) |
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
| `kowr_ml/model/20261122_0005_e1c565/` | wytrenowany model prognozy zmiany NDMI używany przez aplikację (`model.joblib`, 3,7 MB), karta modelu, metryki, porównanie z GRU. Dane treningowe: Sentinel-2 (obie kolekcje) i Open-Meteo z lat 2017–2026, pobrane 21–22.11.2026 | 22.11.2026 |
| `kowr_ml/model/20261121_2014_0502bf/` | poprzedni model (`model.joblib`, 6,6 MB), zostawiony do porównań. Dane treningowe: Sentinel-2 i Open-Meteo z lat 2019–2025 (bez 2022), pobrane 21.11.2026 | 21.11.2026 |

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
| scikit-learn 1.9.1 | model prognozy zmiany NDMI (HistGradientBoosting) w aplikacji i treningu | BSD-3-Clause |
| joblib 1.6.0, threadpoolctl 3.8.0 (zależności scikit-learn) | zapis modelu, wątki | BSD-3-Clause |
| SciPy 1.18.1 (zależność scikit-learn) | obliczenia | licencja BSD (tekst w metadanych pakietu) |
| pandas 3.1.1, pyarrow 26.0.1 | tylko trening ML: tabele i pliki Parquet | BSD-3-Clause, Apache-2.0 |
| PyTorch 2.8.0 | tylko trening: porównawcza sieć GRU na GPU, nie trafia do aplikacji | BSD-3-Clause |
| certifi (zależność httpx) | certyfikaty | MPL-2.0 |
| OpenLayers 10.11.0 | mapa w przeglądarce | BSD-2-Clause (`static/vendor/OL_LICENSE.md`) |
| React i React DOM 19.3.1 | komponenty i renderowanie UI | MIT ([React](https://github.com/react/react/blob/main/LICENSE), `static/vendor/REACT_LICENSE.txt`) |
| esbuild 0.28.2 | budowanie frontendu | MIT ([esbuild](https://github.com/evanw/esbuild/blob/main/LICENSE.md)) |
| Spectrum UI (komponenty z rejestru `spectrumhq.in`, kod skopiowany do `frontend/components/spectrumui/` 21.11.2026) | komponenty interfejsu: sekcje rozwijane, okno/arkusz, przełączniki, suwak, paski, karty liczb, powiadomienia, stany ładowania | Apache-2.0 ([Spectrum UI](https://github.com/arihantcodes/spectrum-ui/blob/main/LICENSE), `frontend/components/spectrumui/LICENSE`; pliki oznaczone jako zmodyfikowane) |
| Tailwind CSS 4.3.5 (`tailwindcss`, `@tailwindcss/cli`) | style interfejsu, budowanie `static/ui.css` | MIT ([Tailwind CSS](https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE)) |
| tw-animate-css 1.4.0 | klasy animacji wejścia i wyjścia (okno, dymki) | MIT ([tw-animate-css](https://github.com/Wombosvideo/tw-animate-css/blob/main/LICENSE)) |
| Radix UI 1.x (`@radix-ui/react-accordion`, `-dialog`, `-progress`, `-slider`, `-slot`, `-tabs`, `-tooltip`) | dostępne podstawy komponentów: klawiatura, fokus, role ARIA | MIT ([Radix Primitives](https://github.com/radix-ui/primitives/blob/main/LICENSE)) |
| Motion 14.14.0 (`motion`, w tym `framer-motion`) | animacje sprężynowe w komponentach Spectrum (przełącznik, powiadomienia, liczniki) | MIT ([Motion](https://github.com/motiondivision/motion/blob/main/LICENSE.md)) |
| Lucide React 1.77.0 | ikony interfejsu | ISC ([Lucide](https://github.com/lucide-icons/lucide/blob/main/LICENSE)) |
| clsx 2.1.1, tailwind-merge 3.7.1 | łączenie klas CSS | MIT |
| class-variance-authority 0.7.1 | warianty komponentów (przycisk, okno) | Apache-2.0 |
| three.js 0.187.0 | model 3D działki: kształt z ULDK, warstwy gleby z SoilGrids, uprawa w fazie z dnia analizy (stylizacja) | MIT ([three.js](https://github.com/mrdoob/three.js/blob/dev/LICENSE)) |
| Bricolage Grotesque, Inter, JetBrains Mono | samodzielnie serwowane fonty interfejsu | SIL Open Font License 1.1 (`static/design/fonts/*-OFL.txt`) |

Żadna zależność nie ma licencji GPL ani AGPL. Analizę spływu napisaliśmy sami w NumPy, żeby nie używać `pysheds` (GPL) ani GRASS (GPL).

**Usługi płatne.** Aplikacja nie korzysta z żadnej płatnej usługi. Jedyne ograniczenie to Open-Meteo: darmowe API jest tylko do użytku niekomercyjnego. Przy wdrożeniu komercyjnym trzeba albo wykupić plan (archiwum pogody wymaga planu „API Professional”, 99 EUR miesięcznie; „API Standard” za 29 EUR go nie obejmuje), albo zostać przy NASA POWER, które jest bezpłatne bez ograniczeń i już działa jako drugi dostawca.

**AI.** W aplikacji działa jeden model uczenia maszynowego: prognoza zmiany NDMI pola na 7–14 dni (gradient boosting, scikit-learn), opisana w sekcji „Model ML” niżej. Jest dodatkiem do bilansu wodnego: ocena niedoboru, przyczyny i rekomendacje nie zależą od niego, a raport powstaje także bez niego. Pozostałe liczby pochodzą z obliczeń, a teksty raportu z reguł w kodzie (`app/core/recommendations.py`, `app/core/terrain_rules.py`, `app/report.py`). AI użyto przy tworzeniu: kod i dokumentację pisaliśmy z pomocą asystentów programistycznych (Claude Code, Codex), a ilustracje warstw gleby w `outputs/assety_gleby/` wygenerowało narzędzie ImageGen (opis w `outputs/assety_gleby/README.md`). Ilustracje są umowne i tak są podpisane w raporcie. Zasoby z projektu Penpot w `static/design/` również powstały przy użyciu ImageGen. Pełnią funkcję ilustracyjną.

## Jak liczony jest wynik

1. **ET0**: z Open-Meteo gotowe, z NASA POWER liczone wzorem FAO-56 Penmana-Monteitha (`app/core/et0.py`).
2. **Gleba**: z uziarnienia i węgla organicznego funkcja Saxtona i Rawlsa (2006) daje pojemność polową i punkt więdnięcia każdej warstwy; średnia ważona w strefie korzeni daje TAW, a RAW = p · TAW.
3. **Bilans dzienny** (FAO-56, rozdz. 8) przez 11 lat przed datą: ETc = Kc · ET0, współczynnik stresu Ks, przesiąk nadmiaru. Start co najmniej 12 miesięcy przed pierwszym porównywanym sezonem, więc stan początkowy nie ma znaczenia. Gdy pole jest bez uprawy, liczone jest parowanie z odkrytej gleby (FAO-56, rozdz. 7).
4. **Klasy**: brak niedoboru (ubytek do połowy RAW), zapas łatwo dostępnej wody się kończy (do RAW), niedobór umiarkowany (powyżej RAW, Ks ≥ 0,5), niedobór silny (Ks < 0,5).
5. **Niepewność**: ten sam bilans dla granic gleby z kwantyli SoilGrids. Jeśli wynik wypada w różnych klasach, raport mówi to wprost.
6. **Satelita**: mediana NDVI i NDMI po pikselach z roślinnością (SCL 4, środki pikseli w działce, co najmniej 6 pikseli i 65% pokrycia). Wskaźniki służą tylko do sprawdzenia bilansu: raport mówi, czy go potwierdzają, czy się z nim rozchodzą.
7. **Teren**: wypełnienie zagłębień Priority-Flood, kierunki D8, powierzchnia zasilająca; na mapie drogi spływu powyżej 0,05 ha i punkty, w których przecinają granicę działki.
8. **Rekomendacje**: reguły z jawnymi progami. Każda podaje, co zrobić, gdzie, dlaczego (z wartościami tej działki) i jak pewny jest wniosek. Lista retencji nigdy nie jest pusta: gdy działka nie ma niedoboru, częstych susz ani lekkiej gleby, raport podaje działanie zapobiegawcze z zapasem wody tej działki i jej historią.

## Model ML: prognoza zmiany NDMI na 7–14 dni

Zgodnie ze [specyfikacją](specyfikacja_treningu_ml_kowr.md) model prognozuje zmianę wskaźnika NDMI (Sentinel-2, B8A i B11) między ostatnim czystym zdjęciem z 14 dni przed datą analizy a pierwszym czystym zdjęciem z dni +7…+14. NDMI jest związany m.in. z zawartością wody w roślinności, ale nie mierzy jej utraty bezpośrednio. Model nie prognozuje wilgotności gleby ani dawki nawodnienia.

[Pełna dokumentacja modelu](docs/model_ndmi.md): dane treningowe, walidacja, wyniki dla lat suszy, eksperymenty, ograniczenia i odtworzenie treningu.

- **Gdzie w raporcie:** sekcja satelitarna, pole `satellite.ndmi_forecast` (opis w [docs/kontrakt_api.md](docs/kontrakt_api.md)): zmiana z przedziałem 80%, okno prognozy, zdjęcie bazowe, cechy wejściowe. Bez danych (poza okresem 01.04–15.10, brak czystego zdjęcia z 14 dni) raport podaje powód.
- **Cechy** (47, wszystkie sprzed daty analizy i tylko z danych, które raport i tak pobiera):
  - stan pola: ostatnie NDMI, jego wiek i pokrycie pola, NDVI, mediany reflektancji pasm B8A, B11 i B04;
  - historia zdjęć z 45 dni: trend NDMI i NDVI z poprzedniego zdjęcia, trend z jeszcze wcześniejszego i ich różnica, liczba scen i czystych scen, udział roślinności, gołej gleby i chmur według klas SCL;
  - pora roku i ciepło: dzień roku, sumy temperatur efektywnych (od 1 stycznia, od 1 marca, z 30 dni), średnia temperatura z 7 i 30 dni, najniższa Tmin z 7 dni;
  - woda: opad i ET0 z 7, 14 i 30 dni, klimatyczny bilans wodny z 30 dni, średnia Tmax z 7 dni, dni od opadu ≥ 5 mm, wyczerpanie referencyjnego bilansu FAO-56 (TAW 100 mm, Kc = 1), opad w dniu zdjęcia i dzień wcześniej, opad i ET0 od zdjęcia do dnia analizy;
  - położenie: szerokość i długość geograficzna.

  Model nie zna gleby ani uprawy, bo w danych treningowych ich nie ma. Kod cech jest wspólny dla treningu i aplikacji (`kowr_ml/features.py`); test sprawdza, że z obserwacji aplikacji (wskaźniki tylko dla trzech scen) wychodzą te same wartości co w treningu.
- **Dane treningowe:** 15 782 pola 80 × 80 m na gruntach ornych (ESA WorldCover 2021) w 161 skupiskach po 6 × 6 km: 46 wybranych w regionach rolniczych i 115 w regularnej siatce co ok. 50 km na cały kraj. Sezony 2017–2026, obie kolekcje Sentinel-2 tak jak w aplikacji, dni prognozy co tydzień od kwietnia do połowy października: 682 428 wierszy (2017: 4 tys., lata 2018–2024 po 49–63 tys., 2025 i 2026 po ok. 142 tys.). 93 punkty siatki mają pogodę tylko od października 2024 r., bo dzienny limit Open-Meteo skończył się w dniu treningu, stąd przewaga dwóch ostatnich sezonów. Jedno skupisko leży wokół działki 580/2, więc wynik dla niej nie jest testem niezależnym; wszystkie liczby poniżej pochodzą z prognoz dla skupisk, których dopasowanie nie widziało.
- **Odtworzenie:** moduły `kowr_ml.fields`, `kowr_ml.s2`, `kowr_ml.weather`, `kowr_ml.dataset`, `kowr_ml.train` (opis w `kowr_ml/__init__.py`). Na serwerze z 31 rdzeniami pobranie scen trwało 43 minuty, tabela 1 minutę, trening z oceną 33 minuty. Pogodę ogranicza limit Open-Meteo (ok. 38 skupisk na dobę z jednego adresu).

Ocena na polach ze skupisk, których dopasowanie nie widziało (MAE zmiany NDMI, mniej = lepiej):

| Test | Wiersze | Prognoza „bez zmiany” | Model sezonowy (dzień roku + ostatnie NDMI) | 16 cech pierwszego modelu | **Model** | Pokrycie przedziału 80% |
|---|---:|---:|---:|---:|---:|---:|
| nowe miejsce, sezon znany z innych miejsc (5 foldów po skupisku) | 682 428 | 0,093 | 0,071 | 0,060 | **0,054** | 80% |
| nowe miejsce i nieznany sezon (sezon odłożony w całości) | 682 428 | 0,093 | 0,075 | 0,067 | **0,060** | nie liczono |
| susza: wyczerpanie bilansu referencyjnego ≥ 75% | 202 311 | 0,092 | 0,074 | 0,062 | **0,056** | 79% |
| głęboka susza: bilans z 30 dni ≤ −100 mm | 32 089 | 0,098 | 0,079 | 0,066 | **0,061** | |
| duże spadki NDMI (≤ −0,05) | 184 204 | 0,130 | 0,096 | 0,080 | **0,071** | |
| sezon 2018 (susza) | 60 409 | 0,098 | 0,079 | 0,064 | **0,058** | 79% |
| sezon 2022 (susza) | 51 572 | 0,098 | 0,073 | 0,063 | **0,056** | 79% |

Wiersze od trzeciego w dół to wycinki pierwszego testu. Pierwszy test odpowiada sytuacji raportu dla dat z lat 2017–2026 (działka jest nowa, sezon model zna), drugi pokazuje, czego się spodziewać w kolejnym sezonie.

- **Wobec poprzedniego modelu** (`20261121_2014_0502bf`, 16 cech, 20 skupisk, sezony 2019–2021 i 2023–2025) na 497 144 wierszach ze 141 skupisk, których tamten nie widział: błąd 0,065 → 0,054 (o 17% mniej), w sezonie 2018: 0,071 → 0,057, w 2022: 0,068 → 0,056, w 2026: 0,072 → 0,055, dla dużych spadków: 0,093 → 0,073. Poprzedni model zawyżał prognozę średnio o 0,013, nowy o 0,004.
- **Komunikaty raportu** (próg 0,03): „prawdopodobnie spadnie” sprawdza się w 74% przypadków, „prawdopodobnie wzrośnie” w 82%. Model wykrywa 71% faktycznych spadków, a kierunek zmiany większej niż 0,05 trafia w 91%. Gdy nie wskazuje kierunku, NDMI zmienia się o mniej niż 0,03 tylko w 40% przypadków, dlatego raport pisze wtedy „może zmienić się w obie strony”, a nie „nie zmieni się”.
- **Przedział 80%:** regresja kwantylowa z poprawką conformalized quantile regression liczoną osobno dla obu granic (dolna o 0,007 niżej, górna o 0,010 wyżej). Pokrycie liczone z poprawką wyznaczoną bez ocenianego foldu: 80,0%, w poszczególnych sezonach 78–81%. Przy spadkach większych niż 0,15 (8% wierszy) w przedziale mieści się połowa obserwacji, a błąd wynosi 0,12: model takie spadki zaniża.
- **Krótkookresowa zmienność:** to samo pole na dwóch czystych zdjęciach w odstępie jednego dnia różni się w NDMI średnio o 0,026, a w odstępie 2–3 dni o 0,039. Obejmuje to zmienność pomiaru i rzeczywiste zmiany pola; nie wyznacza dolnej granicy błędu.
- **Co sprawdziliśmy i odrzuciliśmy:** dłuższe okna opadu i bilansu (60 i 90 dni), większą wagę wierszy z suszy, wyrównanie wag sezonów i sam większy zbiór przy tych samych cechach nie zmieniały błędu. Maksimum NDMI z całego sezonu dałoby jeszcze ok. 1 punkt procentowy, ale wymaga wskaźników ze wszystkich scen sezonu, czyli wielokrotnie dłuższego pobierania w raporcie. Idealna prognoza pogody na okno 7–14 dni dałaby 1–3 punkty; prawdziwa prognoza da mniej.
- **Sieć GRU** (PyTorch na GPU, przebieg pogody z 60 dni i te same cechy, zespół 5 sieci, `kowr_ml/train_gru.py`) na podziale pierwszego modelu wypadła o 4–6% lepiej: 0,051 wobec 0,055 na 4 odłożonych skupiskach i 0,056 wobec 0,058 na odłożonych skupiskach w sezonie 2025. Do aplikacji trafił model drzewiasty, bo nie wymaga PyTorcha i mieści się w 3,7 MB; sieć jest kierunkiem dalszej pracy.

Pełne metryki (według sezonu i miesiąca) są w `kowr_ml/model/20261122_0005_e1c565/metrics.json`, karta modelu w `model_card.json`, wynik sieci w `metrics_gru.json`. Poprzedni model został w repozytorium (`kowr_ml/model/20261121_2014_0502bf/`); aplikacja bierze najnowszy katalog, a zmienna `KOWR_ML_MODEL_DIR` pozwala wskazać inny. Model ma status „eksperymentalny”: pola treningowe to fragmenty gruntów ornych, a nie granice deklarowanych upraw.

Sprawdzenie w aplikacji na prawdziwych działkach (22.11.2026): 4 lokalizacje (580/2, Żuławy, Podkarpacie, punkt koło Poznania) i 9 dat z lat 2018–2026. Prognoza powstała w 20 z 36 przypadków, w pozostałych raport podał powód (brak czystego zdjęcia z 14 dni; punkt koło Poznania nie ma pikseli roślinności w żadnej dacie). Z 11 prognoz, które dało się porównać z późniejszym zdjęciem, 8 zmieściło się w przedziale. Na samej działce 580/2 trafiła 1 z 4: spadek NDMI o 0,24 w lipcu 2022 r. model przewidział jako −0,19 (dolna granica −0,23), a spadku o 0,21 w czerwcu 2023 r. nie przewidział (prognoza −0,06).

## Weryfikacja wyników

Testy bez sieci (`.venv\Scripts\python.exe -m pytest -q`):

- ET0: przykład 18 z FAO-56 (Uccle, 6 lipca): 3,88 mm na dobę, razem z wynikami pośrednimi.
- Bilans: przykład 37 z FAO-56 (przebieg ubytku przez 10 dni), domknięcie bilansu, ograniczenie parowania z odkrytej gleby.
- Funkcja pedotransferowa: wszystkie 12 wierszy tabeli 3 Saxtona i Rawlsa (2006), np. glina 40% piasku i 20% iłu: 28% i 14% objętości.
- SoilGrids: wagi komórek i wartości dla działki 580/2 zgodne z `outputs/soilgrids_niedrzwica_koscielna_580_2.json` (0–5 cm: piasek 33,7%, pył 48,2%, ił 18,1%).
- Spływ: sztuczne powierzchnie (płaszczyzna, dolina, zagłębienie), reguły rekomendacji, zgodność satelity z bilansem.
- Prognoza: siedem dni od daty w Polsce, zachowanie braków danych i rzeczywistego opadu 0 mm.
- Satelita: przesunięcie reflektancji z metadanych sceny. Gdy scena ma je już odjęte w pikselach, nie odejmujemy go drugi raz (wartości z tej samej sceny w obu kolekcjach).
- Pulpit (`npm test`): zapis pól, obsługa dat, zapas wody, obserwacje satelitarne i kolejność działań.
- Hydrologia: miesiące roku hydrologicznego zgodne z nazwami plików IMGW, porównanie tylko z latami przed datą analizy, odczyt wierszy archiwum we wszystkich trzech formatach używanych przez IMGW (do 2022, 2023, od 2024).

Sprawdzenia na prawdziwych danych (wymagają sieci):

| Skrypt | Co sprawdza | Wynik 21.11.2026 |
|---|---|---|
| `scripts/check_sentinel.py` | wzorzec dla 580/2 | 04.06.2025: 11/11 pikseli, NDMI 0,59225; 19.06.2025 odrzucona; 21.06.2025: 0,54090. Zgodne |
| `scripts/check_sentinel_offset.py` | ta sama scena w kolekcjach `sentinel-2-c1-l2a` i `sentinel-2-l2a`: czy przesunięcie reflektancji stosujemy raz | 22.11.2026, sceny z 3 i 5.06.2023 koło Niedrzwicy: B8A 5108 i 4108 DN, reflektancja 0,4109 i 0,4108 (różnica 0,0000). Przed poprawką starsza kolekcja dawała reflektancję o 0,1 za niską: dla 580/2 z 10.07.2022 NDMI 0,88, 0,86 i 0,67 bez NDVI, po poprawce 0,63, 0,58 i 0,49 z NDVI 0,85, 0,79 i 0,71. Dotyczyło scen z bazą przetwarzania od 04.00, których nie ma w nowszej kolekcji, czyli głównie sezonu 2022. Flaga `earthsearch:boa_offset_applied` nie wystarcza: z 1570 scen z 2022 r. nad 70 obszarami w Polsce 92 miały `false`, a ich piksele też były po korekcie (10.05.2022 koło Inowrocławia: B11 1911 DN z flagą `false` i 1908 DN na sąsiednim kaflu z flagą `true`), więc dla starszej kolekcji offset wynosi zawsze 0 |
| `scripts/check_weather_providers.py` | ET0 liczone z NASA POWER wobec ET0 z Open-Meteo na wspólnych dniach | 66 dni, dwa punkty: stosunek sum ET0 1,07 i 0,97; opadu 0,78 i 1,19 |
| `scripts/check_terrain.py` | spływ dla 580/2 | największy odpływ 1,60 ha przy południowo-wschodniej granicy (wzorzec 1,63 ha); liczba punktów 5 + 2 wobec 4 + 4 we wzorcu |
| `scripts/acceptance.py` | pusty cache i wymuszone awarie źródeł (`KOWR_FAIL`) | raport powstaje, brak jest nazwany |
| `scripts/sweep_poland.py` | przegląd odporności na pustej pamięci podręcznej: 24 punkty z całej Polski (niziny, góry, wybrzeże, krańce wschodnie i zachodnie, miasto, las, jezioro) w datach 2016–2026 i dla 7 upraw; z `--cached-parcels` 8 przypadków dla działek z granicą zapisaną w `cache/uldk` | Drugi przebieg (21.11.2026 wieczorem, ULDK już działał): 24 z 24 raportów z granicą działki, mediana 15,0 s, najdłuższy 25,1 s, żaden powyżej 30 s. Zdjęcia satelitarne: wynik w 14 przypadkach, w 6 status „liczę” (wynik dochodzi po raporcie), w 4 powód braku (chmury, brak zielonej roślinności). Najwolniejsze źródła: archiwum IMGW przy pierwszym użyciu (do 17 s) i zdjęcia satelitarne. Open-Meteo odmawiało (429), pogodę dał NASA POWER. Przegląd wykrył raport bez żadnej rekomendacji (rzepak, Dolny Śląsk, 10.05.2023, bez niedoboru); dodaliśmy zapobiegawczą rekomendację retencyjną, która pojawia się, gdy żadna inna reguła retencji nie zadziała. Pierwszy przebieg (przy awarii ULDK): 24 z 24 raportów, mediana 11,9 s, najdłuższy 15,5 s, granice z zapasowego WFS ewidencji |
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
- **Teren**: wynik czysto topograficzny. Wysokości z WCS różniły się od arkusza NMT użytego we wzorcu o 0,3–0,5 m (inna wersja danych), a liczba punktów na granicy zależy od progu łączenia. Model terenu pobieramy na żywo z WCS GUGiK, który przy większych działkach bywa bardzo wolny; po przekroczeniu limitu czasu raport zostaje bez dróg spływu i rekomendacji terenowych i mówi to wprost.
- **Zakres dat pilnuje formularz, nie API.** `POST /api/report` odrzuca datę z przyszłości, ale przyjmuje dzień starszy niż 10 lat. Raport wtedy powstaje, a sekcja satelitarna podaje brak zdjęć (archiwum Sentinel-2 L2A zaczyna się w 2017 r.).
- **Hydrologia**: stan rzeki pochodzi z najbliższego wodowskazu IMGW (do 40 km) i opisuje całą zlewnię powyżej niego, nie wodę na polu; zbiorniki i zrzuty mogą go zmieniać. Archiwum IMGW kończy się 31.10.2025, a bieżący pomiar dotyczy tylko dnia dzisiejszego, więc dla dat od 01.11.2025 do wczoraj raport podaje brak danych hydrologicznych. Bieżący pomiar to pojedynczy odczyt, porównywany ze średnimi z 7 dni. Brak danych o odległości od cieków i o wodzie gruntowej (patrz tabela źródeł).
- **FAO-56**: tabele pochodzą z wydania z 1998 r. dostępnego na fao.org. Materiał KOWR cytuje wydanie poprawione z 2025 r.; nie porównaliśmy tabel między wydaniami.
- **Progi reguł** rekomendacji i zgodności satelity z bilansem są założeniami roboczymi zapisanymi jako stałe w kodzie, nie wartościami z publikacji.
- **Granice działek: ULDK, a przy jego awarii zbiorczy WFS ewidencji GUGiK.** 21.11.2026 wieczorem ULDK i KIEG przekierowywały każde zapytanie, z różnych adresów IP, na stronę zastępczą `integracja01.gugik.gov.pl/resp/`. Zbiorczy WFS stoi na innym serwerze i wtedy działał: na 5 działkach pobranych wcześniej z ULDK dał tę samą granicę (powierzchnia zgodna do 0,0001 ha). Raport podaje w tabeli źródeł, z której usługi pochodzi granica. WFS nie zastępuje wyszukiwania po nazwie obrębu i numerze (filtr po dwóch polach zwraca HTTP 500), więc przy awarii ULDK działa pełny identyfikator i kliknięcie na mapie. Gdy zawiodą obie usługi, działki zapisane wcześniej w pamięci podręcznej działają, a dla nowych raport powstaje dla wskazanego punktu: bez powierzchni, zdjęć satelitarnych pola i spływu.
- **Model ML** prognozuje wskaźnik satelitarny, nie wilgotność gleby. Nie zna gleby ani uprawy działki, uczono go na pogodzie z Open-Meteo (przy NASA POWER raport ostrzega o mniejszej pewności) i działa tylko od 1 kwietnia do 15 października, gdy jest czyste zdjęcie z 14 dni przed datą; na polach testowych z pełną pogodą ten warunek spełniało 44–51% par pole–tydzień. Zbiór treningowy nadreprezentuje okresy z dobrą widocznością pola. Duże spadki NDMI (zbiór, gwałtowne dojrzewanie) model zaniża. Gdy czyste zdjęcie pochodzi z samego dnia analizy, model go nie używa (bierze dane do dnia poprzedniego), a wskaźniki ma wtedy dla starszego zdjęcia bazowego.
- Prototyp dla jednego użytkownika na komputerze lokalnym: bez kont, bazy danych i danych osobowych.

## Skala, limity i koszty

- Jeden raport to: 1 zapytanie ULDK, 2–3 zapytania o pogodę, 1 zapytanie o wodowskazy IMGW i do 20 plików archiwum IMGW (0,15–1,9 MB, tylko przy pierwszym użyciu), 54 małe zapytania WCS o glebę, 2 zapytania STAC i kilkadziesiąt odczytów fragmentów scen, 1 zapytanie WCS o teren.
- Pamięć podręczna na dysku: pogoda po komórce 0,01° i zakresie dat, gleba po oknie siatki 250 m, obserwacje satelitarne po działce i scenie, teren po działce, pliki archiwum IMGW bez zmian (`cache/imgw_zip/`), lista wodowskazów przez 3 h. Dane historyczne się nie zmieniają, więc powtórny raport nie odpytuje usług. Ostatnie dni pogody odświeżają się co godzinę.
- Wąskie gardła przy większym ruchu: limit dzienny Open-Meteo na adres IP, limit ULDK (10 000 zapytań na dobę) i czas WCS z modelem terenu. Rozwiązania: własna kopia NMT i SoilGrids dla Polski (dane są otwarte), kolejka zadań dla terenu i satelity, płatny plan pogody albo NASA POWER.
- Koszt danych: 0 zł.
