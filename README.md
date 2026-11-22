# Zatrzymaj wodę, chroń plony

Prototyp na HackNation 2026 (zadanie KOWR). Rolnik wskazuje działkę ewidencyjną, uprawę i datę, a aplikacja pobiera otwarte dane, liczy dzienny bilans wodny FAO-56 i pokazuje raport: sytuacja wodna, przyczyny niedoboru, rekomendacje retencyjne i agrotechniczne, na końcu nawadnianie. Raport da się wydrukować albo zapisać jako PDF.

Wszystko liczy się na żywo dla podanej działki i daty. W kodzie nie ma gotowych wyników ani ścieżek specjalnych dla żadnej działki.

## Uruchomienie (Windows)

Wymagany jest Python 3.12 i dostęp do internetu. SQLite uruchamia się lokalnie. Nie potrzeba Dockera ani kluczy API.

Najprościej: dwukrotnie kliknij `start.bat`. Skrypt tworzy środowisko, instaluje zależności, startuje serwer i otwiera przeglądarkę na `http://127.0.0.1:8000`. Pierwsze uruchomienie trwa kilka minut (instalacja bibliotek).

Te same kroki ręcznie:

```bat
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Potem otwórz `http://127.0.0.1:8000`. Zapisane pola są w `data/fields.sqlite3`. Odpowiedzi zewnętrznych usług zapisują się w folderze `cache/`; usunięcie go wymusza pobranie wszystkiego od nowa.

### Praca nad interfejsem

Interfejs React jest w `frontend/`: kod podzielony na `app/`, `api/`, `features/` i `shared/` (opis w sekcji „Architektura”), komponenty Spectrum UI skopiowane do `frontend/shared/vendor/spectrumui/`, style Tailwind CSS v4 i tokeny wyglądu w `frontend/styles/app.css`. Gotowy build `static/ui.js` i `static/ui.css` jest w repozytorium, więc zwykłe uruchomienie przez FastAPI działa bez Node.js. `npm run build` buduje JavaScript (esbuild) i CSS (Tailwind CLI). Po edycji frontendu użyj:

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

### Docker i Google Cloud Run

`Dockerfile` buduje obraz w dwóch etapach: najpierw frontend (`npm ci`, `npm run build`, czyli `static/ui.js` i `static/ui.css` ze źródeł w `frontend/`), potem serwer na Pythonie 3.12. Do obrazu trafia kod `app/`, modele z `kowr_ml/models/` oraz `static/` (w tym ilustracje gleby w `static/gleba/`). Dane treningowe, `cache/`, `data/`, dokumentacja i testy zostają poza obrazem (`.dockerignore`, `.gcloudignore`). Serwer słucha na porcie z `$PORT` (domyślnie 8080).

Lokalnie:

```sh
docker build -t kowr .
docker run --rm -p 8080:8080 kowr
```

Wdrożenie na Cloud Run, gdy masz gcloud CLI (`winget install Google.CloudSDK`, potem `gcloud init`) i projekt GCP z włączonym billingiem:

```powershell
.\deploy.ps1 -Project <id-projektu>                 # region europe-central2 (Warszawa), usługa "kowr"
.\deploy.ps1 -Project <id> -Region europe-west1 -Service kowr-demo
```

Skrypt włącza API Cloud Run, Cloud Build i Artifact Registry, wysyła źródła do Cloud Build (lokalny Docker nie jest potrzebny) i wypisuje publiczny adres HTTPS. Pierwsze wdrożenie trwa 5–10 minut. Ustawienia usługi i ich powody:

- `--max-instances 1`: zapisane pola są w SQLite na dysku instancji, a worker raportów działa w tym samym procesie. Kilka instancji miałoby rozjechane listy pól.
- `--no-cpu-throttling` i `--min-instances 1`: worker przelicza pola w tle także między zapytaniami, a pierwsze wejście jury nie czeka na zimny start. Instancja działa wtedy cały czas i jest rozliczana za cały czas działania, nie tylko za zapytania (2 vCPU, 2 GiB).
- `--timeout 300`: pobieranie NMT z GUGiK potrafi trwać do 180 s.

Ograniczenie: dysk Cloud Run jest ulotny. Restart lub nowe wdrożenie kasuje zapisane pola (`data/`) i pamięć podręczną (`cache/`). Raporty liczą się od nowa z danych na żywo, więc wynik się nie zmienia, ale lista pól na pulpicie wraca do pustej.

## Funkcje

- **Pulpit**: liczba pól w każdym stanie wody, pola ułożone od najpilniejszego, najbliższe działania z zapisanych analiz i przewijana prognoza pogody do 16 dni dla wybranego pola. Pola zapisują się na serwerze, a ich raporty liczy worker w tle: zaraz po dodaniu pola i potem raz na dobę. Karta pola pokazuje stan liczenia (kręcąca się plakietka „Liczę raport” / „Odświeżam raport”, błąd z powodem) i godzinę ostatniego odświeżenia.
- **Mapa pól**: mapa Polski z zapisanymi polami. Województwa z polami są zielone z liczbą pól, bez pól szare; kliknięcie przybliża do powiatów, potem do gmin, a w gminie widać same pola (kliknięcie otwiera raport). Poziom jest w adresie (`#mapa/<kod TERYT>`), więc „wstecz” wraca poziom wyżej. Pole trafia do gminy po kodzie TERYT z numeru działki; pole z samego punktu (bez działki) po położeniu punktu w granicy.
- **Dodaj pole**: dwa kroki w jednym oknie: wybór działki na mapie oraz uprawa i terminy. Zapis zamyka okno, a raport liczy się w tle. Pole z dzisiejszą datą codziennie przelicza się na bieżący dzień. Pole z datą historyczną zachowuje tę datę. Zmiana działki, uprawy lub terminów przelicza raport, sama zmiana nazwy zachowuje obecny raport.
- **Plan prac**: dla wszystkich zapisanych pól i jednej wybranej pracy (wjazd i uprawa, siew, opryski, nawożenie) tabela pole × 7 dni od dziś z ocenami „dobre warunki / ostrożnie / unikaj / nie w tym okresie”, powodem każdej oceny w dymku i najlepszym oknem (najdłuższy ciąg dobrych dni) albo główną przeszkodą. Ten sam plan dla jednego pola jest w zakładce „Prace polowe” raportu, razem z pogodą, z której wynikają oceny (opad, wiatr, temperatura, wilgotność wierzchu gleby). Plan liczy się zawsze z bieżącej prognozy, także dla raportu historycznego, i nie trafia do PDF.
- **Widok pola** w zakładkach: Podsumowanie, Rekomendacje, Prace polowe, Gleba, Pogoda, Teren i woda, Historia, Źródła. Model 3D pokazuje rzeczywisty obrys działki, warstwy gleby z SoilGrids i uprawę w fazie z dnia analizy (tekstury są poglądowe). Widok z góry pokazuje podkłady Geoportalu lub OpenStreetMap oraz drogi spływu.

- **Wskazanie działki**: adres lub miejscowość przybliża zdjęcie lotnicze z granicami działek, na którym można wskazać pole. Można też wyszukać działkę po identyfikatorze albo nazwie obrębu i numerze lub przejść przez województwo, powiat i gminę. Gdy usługa ULDK nie odpowiada, granica pochodzi ze zbiorczej usługi WFS ewidencji GUGiK.
- **Historia i rekomendacje**: porównanie zapasu w dniu analizy z tym samym dniem w poprzednich latach, sezony z długim niedoborem oraz oznaczenie terminu zaleceń (teraz, po zbiorze lub w kolejnych sezonach).
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
- **Użytkowanie terenu**: raport podaje, jaką część działki mapa pokrycia terenu ESA WorldCover (stan z 2021 r.) pokazuje jako grunty orne, łąki, las, zabudowę albo wodę, i czy zgadza się to z wybraną uprawą (zdanie w „Założeniach o uprawie” w zakładce Źródła, pole `land_use` w API). Gdy co najmniej połowa działki nie jest gruntem rolnym, w „Co sprawdzić na polu” pojawia się punkt „Sprawdź, czy wskazałeś właściwą działkę”, a w „Czego nie wiemy” pierwsze zdanie mówi, że bilans policzono tak, jakby uprawa rosła na całej działce. Mapa nie zmienia bilansu ani pozostałych rekomendacji.
- **Druk i PDF**: przycisk „PDF” w widoku pola otwiera systemowe okno drukowania; aby pobrać plik, wybierz w nim „Zapisz jako PDF”. Wydruk składa wszystkie zakładki w jeden dokument w kolejności: ocena, historia, pogoda, gleba, teren i woda, rekomendacje, źródła.
- **Tryb testowy** (`?test` w adresie): w formularzu pojawia się przełącznik, który podmienia w widoku obrys działki na umowny kształt i dodaje obszar zasiewu. Analiza i tak liczy się na żywo dla wskazanego punktu. Służy do sprawdzania modelu 3D, nie jest częścią zwykłej ścieżki rolnika.
- **Odnośnik do raportu**: `http://127.0.0.1:8000/?parcel=060910_2.0011.580/2&crop=winter_wheat&date=2026-11-21` (raport i tak liczy się od nowa).

## Architektura

Jeden proces FastAPI serwuje API oraz skompilowany frontend React (komponenty Spectrum UI, Tailwind CSS) z OpenLayers. Pola i ich ostatnie raporty są w SQLite (`data/fields.sqlite3`, katalog zmienia `KOWR_DATA_DIR`). Worker raportów działa w tym samym procesie, dlatego serwer uruchamiamy jednym procesem uvicorn (bez `--workers`). Pola zapisane dawniej w `localStorage` przeglądarki frontend przenosi na serwer przy pierwszym wejściu.

```
app/
  main.py              fabryka aplikacji: serwisy, routery, worker pól w lifespan, pliki statyczne
  config.py            ścieżki, limity czasu, granice Polski, lata historii
  api/                 warstwa HTTP bez logiki: deps.py (klient HTTP, dzisiejszy dzień, serwisy z app.state),
                       errors.py (błędy domenowe → kody HTTP w jednym miejscu), validators.py (parametry zapytań)
    routers/           report, parcels, fields, forecast, fieldwork, satellite, terrain
  services/            orkiestracja
    report_builder.py  ReportBuilder: źródła → bilans → sekcje w narzuconej kolejności
    source_gatherer.py SourceGatherer: wszystkie źródła równolegle z limitami czasu; SourceBundle z wynikami i opisem braków
    field_worker.py    FieldWorker: pola rolnika, kolejka i worker (raport po dodaniu pola, potem raz na dobę)
    terrain_jobs.py    TerrainJobs: teren liczony w tle, pamięć podręczna po działce
    fieldwork_planner.py plan prac polowych z bieżącej prognozy
    ml_bridge.py       jedyne miejsce importujące kowr_ml; typowane wyniki, błędy modelu trafiają do logu
  persistence/
    field_repository.py FieldRepository: pola i ostatnie raporty w SQLite (data/fields.sqlite3)
  presentation/        wyniki obliczeń → schematy API i polskie zdania raportu
    sections/          jedna sekcja raportu na moduł: water_status, causes, history, satellite, forecast, soil,
                       soil_moisture, hydrology, irrigation, recommendations, limitations, summary, sources_info, terrain
  schemas/             kontrakt API (pydantic) podzielony według obszaru; `from app.schemas import X` działa dla każdego typu
  infra/               cache.py (odpowiedzi usług na dysku), geo.py (układy współrzędnych), http.py (fabryka klienta)
  sources/             pobieranie danych; zwracają dataclassy, nie schematy API (używane też przy treningu ML)
    parcels.py         wyszukiwanie działki: wybór źródła (ULDK → WFS EGiB), cache, pochodzenie wyniku
    uldk.py            adapter ULDK GUGiK (sam protokół)
    egib_wfs.py        adapter zapasowy: granica działki ze zbiorczego WFS ewidencji GUGiK, kody obrębów z PRG
    weather.py         Open-Meteo Archive → NASA POWER → dobór ostatnich dni z Open-Meteo Forecast; prognoza do 16 dni
    soilgrids.py       SoilGrids: WCS → REST → kafle GeoTIFF, średnia ważona komórek 250 m
    sentinel.py        Sentinel-2 L2A z Earth Search STAC: maska SCL, NDVI, NDMI
    terrain.py         wycinek NMT GUGiK 1 m wokół działki (analiza spływu jest w core/terrain_analysis.py)
    nmt_geotiff.py     arkusze NMT GUGiK z opendata.geoportal.gov.pl, lokalnie jako GeoTIFF
    imgw_hydro.py      wodowskazy IMGW-PIB: bieżące pomiary i archiwum dobowe przepływów
    mphp.py            najbliższy ciek z mapy MPHP10k (Wody Polskie) przez WMS GetFeatureInfo
    worldcover.py      pokrycie terenu z mapy ESA WorldCover 10 m: okno pod działką z pliku COG, liczba pikseli na klasę
    soil_moisture.py   NASA POWER: wilgotność gleby w 3 warstwach (MERRA-2), 11 lat
    ifs_forecast.py    prognoza ECMWF IFS (wejście modelu wilgotności)
  core/                obliczenia bez sieci (dane wchodzą jako argumenty), wyniki jako dataclassy
    dates.py           dzisiejszy dzień w Polsce, dopuszczalne daty, okno pobieranych danych
    textfmt.py         liczby i daty po polsku (na samym dole, bo reguły rekomendacji też piszą uzasadnienia z liczbami)
    et0.py             ET0 FAO-56 Penmana-Monteitha
    ptf.py             pojemność polowa i punkt więdnięcia (Saxton i Rawls 2006), klasy uziarnienia USDA
    crops.py           tabela upraw: Kc, fazy, korzenie, współczynnik p z numerem tabeli FAO-56
    water_balance.py   dzienny bilans strefy korzeni, cztery klasy
    balance_run.py     bilans dla wszystkich wariantów gleby (Computed), z nawadnianiem i na dniach prognozy
    water_assessment.py ocena w dniu analizy (ubytek, RAW, dni do stresu) w pełnej precyzji dla raportu i reguł
    soil.py            warianty gleby z kwantyli SoilGrids
    analysis.py        okna 30/60/90 dni, klimatyczny bilans wodny, historia 10 sezonów
    satellite_logic.py zgodność wskaźników z bilansem
    hydrology.py       przepływ z 7 dni na tle tych samych dni w poprzednich latach, zgodność z bilansem
    land_use.py        udziały klas pokrycia terenu na działce i ocena, czy to grunt rolny
    soil_moisture.py   wilgotność warstw w okolicy na tle tych samych dni w poprzednich latach
    flow.py            Priority-Flood, D8, powierzchnia zasilająca
    terrain_analysis.py spadek, drogi spływu i punkty na granicy działki z wycinka NMT
    fieldwork.py       plan prac polowych na 7 dni: wilgotność wierzchu (warstwa parowania FAO-56) i reguły ocen
    recommendations/   reguły rekomendacji: facts (fakty i progi), retention, agrotechnical, irrigation
    terrain_rules.py   wnioski i rekomendacje z analizy terenu
  data/soilgrids_tiles_pl.json   indeks kafli SoilGrids dla Polski (tryb awaryjny)
frontend/              React bez frameworka; każdy feature ma komponenty, hooki i czysty logic.js z testem obok
  app/                 wejście (main.jsx), szkielet strony, routing w adresie (router.js), lista pól i jej odświeżanie
  api/                 client.js (limit czasu, błędy po polsku) i endpoints.js: każde wywołanie serwera ma nazwaną funkcję
  features/            dashboard, report (zakładki widoku pola), add-field, fieldwork, map, soil (model 3D),
                       weather, onboarding, fields; feature'y nie importują się nawzajem (pilnuje tego architecture.test.js)
  shared/              format/ (liczby, daty, liczba mnoga), ui/ (podstawowe komponenty), geo/, lib/,
                       vendor/spectrumui/ (Spectrum UI, Apache-2.0, plik LICENSE; dostosowane do aplikacji)
  styles/app.css       Tailwind CSS v4 i tokeny wyglądu (kolory, fonty, krzywe ruchu)
static/                gotowy build React, OpenLayers i zasoby graficzne
tests/                 testy bez sieci: core/, sources/ (parsowanie odpowiedzi), services/ (ReportBuilder na
                       podstawionych źródłach, worker pól), api/ (routery przez TestClient), ml/
scripts/               sprawdzenia na prawdziwych danych; dev/snapshot_report.py zapisuje raporty do porównania przed i po zmianie
```

Zależności idą w jedną stronę: `api` → `services` → `core`, `sources`, `presentation`, `persistence`. Obliczenia w `core` nie znają HTTP ani schematów API, adaptery w `sources` nie liczą bilansu, a zdania dla rolnika powstają w `presentation`. Wyjątek: reguły rekomendacji, terenu i zgodności zdjęć z bilansem w `core` nadal same składają zdania.

Endpointy: `GET /api/fields`, `POST /api/fields` (dodanie albo zmiana pola, `?previous_id=` przy zmianie działki) i `DELETE /api/fields?id=` (pola i stan liczenia raportu w polu `job`: queued, running, ok, error), `POST /api/report` (raport), `GET /api/satellite` i `GET /api/terrain` (części dociągane po raporcie), `POST /api/addresses/search` (położenie adresu na mapie), `GET /api/parcels/search|by-id|by-point`, `GET /api/crops`, `GET /api/forecast` (bieżąca prognoza dla współrzędnych pola) i `GET /api/fieldwork` (plan prac na 7 dni: współrzędne, uprawa i uziarnienie wierzchu gleby z raportu). Opis w [docs/kontrakt_api.md](docs/kontrakt_api.md), schemat w [app/schemas/](app/schemas/), po uruchomieniu także pod `/docs`.

Frontend formatuje odpowiedzi API, przelicza udział dostępnego zapasu na procent i porządkuje dane w pulpicie. Bilans, klasy i zalecenia oblicza serwer. Historia w raporcie korzysta z podsumowań sezonów, a odtwarzanie pokazuje dostępne obserwacje zieloności z datami.

### Czas odpowiedzi

Zmierzone 21.11.2026 na pustej pamięci podręcznej, działka `060910_2.0011.580/2`, pszenica ozima, data bieżąca:

| Krok | Czas |
|---|---|
| ULDK (działka) | 0,1–0,6 s (raz 6,8 s) |
| Pogoda: odmowa Open-Meteo Archive (429), NASA POWER 11 lat, dobór ostatnich dni | 2–3 s |
| Gleba: SoilGrids WCS, 54 warstwy równolegle | 4–5 s |
| Hydrologia: lista wodowskazów IMGW i 11–20 plików archiwum (pusta pamięć podręczna) | 1–5 s |
| Użytkowanie terenu: okno mapy ESA WorldCover pod działką | 0,5–1,5 s |
| Satelita: szukanie scen, maski SCL 26 scen, pasma 3 scen | 10–14 s |
| Obliczenia (bilans 11 lat w 3 wariantach gleby, historia, reguły) | 0,05 s |
| **Raport razem** (źródła idą równolegle) | **11–15 s** |
| Teren i spływ (osobno, po raporcie) | 15–125 s, z czego obliczenia 0,8 s; raz, dla działki 8,6 ha, serwer GUGiK z modelem terenu nie odpowiedział w 180 s i raport podał brak analizy spływu |

Raport czeka na zdjęcia satelitarne najwyżej 14 s. Gdy łącze do archiwum zdjęć jest wolne, sekcja satelitarna dostaje status „liczę” i uzupełnia się sama (`GET /api/satellite`), tak samo jak teren. Przy ciepłej pamięci podręcznej raport powstaje w ok. 1 s.

Na 24 działkach z całej Polski i datach 2016–2026 (pusta pamięć podręczna, `scripts/dev/sweep_poland.py`, 21.11.2026) raport powstawał w 6,6–15,5 s, mediana 11,9 s. Granica działki z zapasowego WFS ewidencji przychodziła w 0,3–1,4 s.

## Dane: źródła, zakresy, licencje

Wszystkie dane są bezpłatne. Żadne źródło nie wymaga klucza ani konta. Warunki sprawdzono na stronach dostawców 21.11.2026.

| Kategoria | Źródło i zakres | Jak pobierane | Licencja i warunki |
|---|---|---|---|
| Działka | ULDK GUGiK: geometria i położenie działki ewidencyjnej, cała Polska | na żywo, przy każdym raporcie | Bezpłatne, także komercyjnie; wymagane podanie źródła: „Główny Urząd Geodezji i Kartografii (GUGiK), Usługa Lokalizacji Działek Katastralnych (ULDK)”. Limit 200 zapytań/min (6–18), 40/min poza tym, 10 000 na dobę z jednego IP |
| Działka (zapas) | Zbiorcza usługa WFS ewidencji gruntów i budynków GUGiK (`mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza`, warstwa `ms:dzialki`): granica, numer, obręb i gmina; bez nazwy powiatu | na żywo, tylko gdy ULDK nie odpowiada; po punkcie albo pełnym identyfikatorze | Dane ewidencji udostępniane przez GUGiK bezpłatnie, jak ULDK. Limitów tej usługi nie znaleźliśmy w dokumentacji |
| Obręb (zapas) | Usługa WFS granic administracyjnych PRG GUGiK (`mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries`, warstwa `ms:A06_Granice_obrebow_ewidencyjnych`): kod TERYT obrębu po nazwie | na żywo, tylko gdy ULDK nie odpowiada, przy wyszukiwaniu po nazwie obrębu | Dane PRG udostępniane przez GUGiK bezpłatnie, bez klucza |
| Adres lub miejscowość | [UUG GUGiK](https://services.gugik.gov.pl/uug/opis.html), dane adresowe PRG | na żywo po kliknięciu „Szukaj”, do przybliżenia mapy, bez zapisu adresu pola | [Dane PRG są bezpłatne i dostępne do dowolnego wykorzystania](https://www.geoportal.gov.pl/pl/dane/panstwowy-rejestr-granic-prg/). UUG nie wymaga klucza. |
| Granice jednostek (mapa pól) | PRG GUGiK, ta sama usługa WFS, warstwy `A01_Granice_wojewodztw`, `A02_Granice_powiatow`, `A03_Granice_gmin` | wcześniej, 22.11.2026, uproszczone do `static/mapa/` | Dane PRG udostępniane przez GUGiK bezpłatnie, bez klucza; na mapie podpis „Granice: © GUGiK (PRG)” |
| Mapa | Ortofotomapa GUGiK (WMS), granice działek KIEG (WMS), OpenStreetMap | na żywo, w przeglądarce | GUGiK: brak opłat, zakaz masowego pobierania obrazów. OSM: © OpenStreetMap contributors (ODbL), kafle z `tile.openstreetmap.org` zgodnie z polityką użycia (atrybucja, bez pobierania hurtowego, bez gwarancji dostępności) |
| Pogoda (archiwum) | Open-Meteo Archive (ERA5, ERA5-Land, ECMWF IFS): opad, ET0, Tmin, Tmax dziennie, siatka ok. 9–25 km | na żywo, 11 lat przed datą jednym zapytaniem | Dane CC BY 4.0. **Darmowe API tylko do użytku niekomercyjnego**, limit 10 000 zapytań na dobę z jednego IP |
| Pogoda (archiwum, drugi dostawca) | NASA POWER: opad, temperatura, promieniowanie, wiatr, wilgotność dziennie; siatka 0,5° × 0,625° (MERRA-2), promieniowanie 1° × 1° (CERES) | na żywo, gdy Open-Meteo odmówi (429), zawiedzie albo nie odpowie | Bez ograniczeń użycia; NASA prosi o cytowanie: dane z projektu NASA Langley Research Center POWER, finansowanego przez NASA Earth Science Division |
| Wilgotność gleby w warstwach (okolica) | NASA POWER: `GWETTOP` (0–5 cm), `GWETROOT` (0–100 cm), `GWETPROF` (cały profil), wilgotność względna 0–1 z modelu MERRA-2, dziennie, siatka 0,5° × 0,625°; w raporcie średnia z 7 dni na tle tych samych dni w 10 poprzednich latach | na żywo, 11 lat przed datą jednym zapytaniem, równolegle z pogodą | jak NASA POWER wyżej |
| Pogoda (ostatnie dni i prognoza) | Open-Meteo Forecast: uzupełnianie ostatnich dni bilansu oraz prognoza na 7 lub 16 dni (opad, ET0, temperatura, maksymalny wiatr; z projekcją zapasu wody w glebie na 14 dni, tyle co prognoza modelu AI; do planu prac także 30 dni wstecz) | na żywo. Prognoza ma pamięć podręczną na godzinę | jak Open-Meteo wyżej |
| Prognoza dla modelu wilgotności | Open-Meteo Forecast, `models=ecmwf_ifs025`: godzinowy opad, temperatura 2 m i wilgotność gleby 0–7, 7–28, 28–100 cm z ECMWF IFS 0,25° na 14 dni (`app/sources/ifs_forecast.py`; tyle pełnych dób IFS zwraca Open-Meteo) | na żywo, tylko dla analizy na dziś, pamięć podręczna na godzinę. Sprawdzone 22.11.2026: działa z tej sieci (archiwum Open-Meteo zwraca 429) | jak Open-Meteo wyżej; dane ECMWF CC BY 4.0 |
| Gleba | ISRIC SoilGrids 250 m v2.0: piasek, pył, ił, węgiel organiczny, gęstość w 6 warstwach do 200 cm, średnia i kwantyle 5% i 95% | na żywo przez WCS `maps.isric.org`; zapas: REST, potem kafle GeoTIFF | CC BY 4.0. REST: limit 5 zapytań/min, usługa oznaczona przez ISRIC jako wstrzymana (21.11.2026 odpowiadała) |
| Satelita | Sentinel-2 L2A z Earth Search STAC (Element 84), kolekcje `sentinel-2-c1-l2a` i `sentinel-2-l2a`: pasma B04, B8A, B11 i maska SCL, okno 45 dni przed datą, archiwum od 2017 r. | na żywo; czytane są tylko bloki rastra pod działką | Dane Copernicus Sentinel: dostęp bezpłatny, pełny i otwarty. Raport zawiera zmodyfikowane dane Copernicus Sentinel. Earth Search: bezpłatny katalog bez opublikowanych limitów |
| Grunty orne (tylko trening modelu ML) | ESA WorldCover 10 m 2021 v200, klasa 40 (grunty orne): wybór 2531 pól pilotażowych 80 × 80 m w 20 skupiskach | jednorazowo przy budowie zbioru treningowego (21.11.2026), aplikacja z tego nie korzysta | CC BY 4.0; atrybucja: „© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium” (esa-worldcover.org, sprawdzone 21.11.2026) |
| Wilgotność gleby i pogoda (tylko trening modelu wilgotności) | ERA5-Land 0,1° (godzinowa wilgotność warstw 0–7, 7–28, 28–100 cm) i ERA5 0,25° (opad, temperatura, punkt rosy, promieniowanie, wiatr) z otwartych plików Open-Meteo w `s3://openmeteo` (AWS Open Data), 20 punktów, 10.2018–12.2025 | jednorazowo, 22.11.2026, aplikacja z tego nie korzysta | CC BY 4.0 (README repozytorium open-meteo/open-data, sprawdzone 22.11.2026). Pliki nie mają limitu zapytań API |
| Teren | NMT GUGiK 1 m (PL-EVRF2007-NH): arkusz wskazany przez skorowidz WFS pobierany bezpośrednio z opendata.geoportal.gov.pl, zapisany w `cache/nmt/` jako GeoTIFF; wycinek z buforem 200 m wokół działki | na żywo przy pierwszym użyciu arkusza, osobny endpoint | Brak opłat, dowolne wykorzystanie |
| Hydrologia (rzeki) | IMGW-PIB, API danych publicznych (`api/data/hydro/`, zapas `hydro2/`): czynne wodowskazy ze współrzędnymi, ostatni stan wody [cm] i przepływ [m³/s]. Archiwum danych dobowych (`dane_hydrologiczne/dobowe/`): stan i przepływ z każdego dnia, lata hydrologiczne do 2025 (do 31.10.2025) | na żywo: lista wodowskazów (pamięć podręczna 3 h) i pliki archiwum tylko dla 7 dni wokół daty analizy w każdym z 11 lat (pliki niezmienne, raz pobrane zostają na dysku) | Bezpłatne; regulamin IMGW-PIB wymaga podania źródła („Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – Państwowy Instytut Badawczy”) i informacji o przetworzeniu danych, oba zdania są w raporcie. Według regulaminu nieodpłatne użycie obejmuje cele prywatne, a w każdym celu dane o wysokiej wartości (rozporządzenie wykonawcze KE 2023/138); użycie w działalności gospodarczej poza tym wymaga umowy z IMGW-PIB. Przed wdrożeniem przez KOWR trzeba to potwierdzić z IMGW-PIB (regulamin sprawdzony 21.11.2026 na danepubliczne.imgw.pl/regulations) |
| Hydrologia (cieki przy działce) | MPHP10k (Wody Polskie, ISOK), warstwa `HY.Network` z publicznego WMS `wody.isok.gov.pl/wss/INSPIRE/INSPIRE_HY_10k_2019_WMS`: najbliższy ciek i jego nazwa do 800 m od granicy działki. WFS z wektorami wymaga logowania, więc geometrię bierzemy z odpowiedzi GetFeatureInfo w JSON (dwa zapytania: zgrubne okno i doprecyzowanie wokół najbliższego punktu; serwer obcina BUFFER do 25 px). Rowów melioracyjnych w tej warstwie często nie ma | na żywo, pamięć podręczna 30 dni | Usługa: „Brak warunków dostępu i użytkowania”, „Brak ograniczeń w publicznym dostępie” (GetCapabilities, sprawdzone 22.11.2026); zbiór na dane.gov.pl: CC BY 4.0 |
| Użytkowanie terenu | ESA WorldCover 10 m 2021 v200: klasy pokrycia terenu (grunty orne, trawy, drzewa, zabudowa, woda i inne), piksel 1/12000° (w Polsce ok. 6 × 9 m), stan z 2021 r. Pliki COG po 3° × 3° w otwartym zasobniku AWS (`esa-worldcover.s3.eu-central-1.amazonaws.com`), bez konta | na żywo: tylko okno pod działką (zapytania zakresowe HTTP), wynik w pamięci podręcznej bez terminu, bo mapa się nie zmienia | CC BY 4.0; atrybucja w tabeli źródeł raportu: „© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium” (esa-worldcover.org, sprawdzone 21.11.2026). Limitów zasobnika nie znaleźliśmy w dokumentacji |

Podstawa prawna bezpłatnego udostępniania danych GUGiK: art. 40a ust. 2 Prawa geodezyjnego i kartograficznego (zmiana z 16.04.2020, Dz.U. 2020 poz. 782).

### Co jest pobierane na żywo, a co przygotowane wcześniej

Na żywo, przy każdym raporcie: działka, pogoda, gleba, zdjęcia satelitarne, model terenu, wodowskazy IMGW, cieki MPHP10k, pokrycie terenu ESA WorldCover, podkłady mapy.

Przygotowane wcześniej i zapisane w repozytorium:

| Plik | Co zawiera | Data |
|---|---|---|
| `app/core/crops.py` | współczynniki Kc, długości faz, głębokość korzeni i p z FAO-56 (tab. 11, 12, 22), przepisane z tekstu na fao.org | 21.11.2026 |
| `app/core/ptf.py` | równania Saxtona i Rawlsa (2006, tab. 1) oraz REW z FAO-56 tab. 19 | 21.11.2026 |
| `app/data/soilgrids_tiles_pl.json` | położenie 63 kafli SoilGrids nad Polską, wyciągnięte z pliku VRT ISRIC; używane tylko w trybie awaryjnym. Nie zawiera wartości gleby | 21.11.2026 |
| `static/gleba/` (źródła i opis w `docs/assets/gleba/`) | umowne ilustracje warstw gleby (wygenerowane narzędziem AI, patrz niżej) | 21.11.2026 |
| `static/vendor/` | OpenLayers 10.11.0 i czcionki | 21.11.2026 |
| `static/mapa/` | granice 16 województw, 380 powiatów i 2479 gmin z PRG GUGiK (WFS `AdministrativeBoundaries`, warstwy A01–A03), uproszczone do mapy pól (tolerancja 2 km / 500 m / 200 m), EPSG:4326; odtwarzalne skryptem `scripts/dev/build_admin_map.py`. Do pokazania na mapie, nie do obliczeń | 22.11.2026 |
| `kowr_ml/models/soil_moisture/20261122_0426_sm3_fceabc/` | model wilgotności gleby v3 na 14 dni używany przez wykres zapasu (`model.joblib`, 6,4 MB), karta i metryki. Dane treningowe: ERA5-Land, ERA5 i archiwum prognoz ECMWF IFS z lat 2023–2025 (dni 0–9 z HRES, 10–13 z przebiegu kontrolnego ensemble), SoilGrids, pobrane 22.11.2026 | 22.11.2026 |
| `kowr_ml/models/ndmi/20261122_0005_e1c565/` | wytrenowany model prognozy zmiany NDMI używany przez aplikację (`model.joblib`, 3,7 MB), karta modelu, metryki, porównanie z GRU. Dane treningowe: Sentinel-2 (obie kolekcje) i Open-Meteo z lat 2017–2026, pobrane 21–22.11.2026 | 22.11.2026 |
| `kowr_ml/models/CURRENT.json` | które z powyższych przebiegów obsługują aplikację | 22.11.2026 |

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
| eccodes 2.50.1 (z biblioteką ecCodes, pakiet `eccodeslib`) | tylko trening modelu wilgotności v2: odczyt pól GRIB z archiwum prognoz ECMWF | Apache-2.0 (PyPI; ecCodes: LICENSE w github.com/ecmwf/eccodes) |
| PyTorch 2.8.0 | tylko trening: porównawcza sieć GRU na GPU, nie trafia do aplikacji | BSD-3-Clause |
| certifi (zależność httpx) | certyfikaty | MPL-2.0 |
| OpenLayers 10.11.0 | mapa w przeglądarce | BSD-2-Clause (`static/vendor/OL_LICENSE.md`) |
| React i React DOM 19.3.1 | komponenty i renderowanie UI | MIT ([React](https://github.com/react/react/blob/main/LICENSE), `static/vendor/REACT_LICENSE.txt`) |
| esbuild 0.28.2 | budowanie frontendu | MIT ([esbuild](https://github.com/evanw/esbuild/blob/main/LICENSE.md)) |
| Spectrum UI (komponenty z rejestru `spectrumhq.in`, kod skopiowany do `frontend/shared/vendor/spectrumui/` 21.11.2026) | komponenty interfejsu: sekcje rozwijane, okno/arkusz, przełączniki, suwak, paski, karty liczb, powiadomienia, stany ładowania | Apache-2.0 ([Spectrum UI](https://github.com/arihantcodes/spectrum-ui/blob/main/LICENSE), `frontend/shared/vendor/spectrumui/LICENSE`; pliki oznaczone jako zmodyfikowane) |
| Tailwind CSS 4.3.5 (`tailwindcss`, `@tailwindcss/cli`) | style interfejsu, budowanie `static/ui.css` | MIT ([Tailwind CSS](https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE)) |
| tw-animate-css 1.4.0 | klasy animacji wejścia i wyjścia (okno, dymki) | MIT ([tw-animate-css](https://github.com/Wombosvideo/tw-animate-css/blob/main/LICENSE)) |
| Radix UI 1.x (`@radix-ui/react-accordion`, `-dialog`, `-popover`, `-progress`, `-slider`, `-slot`, `-tabs`, `-tooltip`) | dostępne podstawy komponentów: klawiatura, fokus, role ARIA | MIT ([Radix Primitives](https://github.com/radix-ui/primitives/blob/main/LICENSE)) |
| React DayPicker 9.13.1 (z date-fns) | kalendarz i wybór dat w formularzu pola | MIT ([React DayPicker](https://daypicker.dev/v9#license), [date-fns](https://github.com/date-fns/date-fns/blob/main/LICENSE.md)) |
| Motion 14.14.0 (`motion`, w tym `framer-motion`) | animacje sprężynowe w komponentach Spectrum (przełącznik, powiadomienia, liczniki) | MIT ([Motion](https://github.com/motiondivision/motion/blob/main/LICENSE.md)) |
| Lucide React 1.77.0 | ikony interfejsu | ISC ([Lucide](https://github.com/lucide-icons/lucide/blob/main/LICENSE)) |
| clsx 2.1.1, tailwind-merge 3.7.1 | łączenie klas CSS | MIT |
| class-variance-authority 0.7.1 | warianty komponentów (przycisk, okno) | Apache-2.0 |
| three.js 0.187.0 | model 3D działki: kształt z ULDK, warstwy gleby z SoilGrids, uprawa w fazie z dnia analizy (stylizacja) | MIT ([three.js](https://github.com/mrdoob/three.js/blob/dev/LICENSE)) |
| Bricolage Grotesque, Inter, JetBrains Mono | samodzielnie serwowane fonty interfejsu | SIL Open Font License 1.1 (`static/design/fonts/*-OFL.txt`) |

Żadna zależność nie ma licencji GPL ani AGPL. Analizę spływu napisaliśmy sami w NumPy, żeby nie używać `pysheds` (GPL) ani GRASS (GPL). Pliki `.om` z Open-Meteo do treningu modelu wilgotności czyta biblioteka `omfiles` 1.2.0 (GPL-2.0), dlatego jednorazowy skrypt eksportu leży poza repozytorium; kod w repo czyta już tylko tabele Parquet.

**Usługi płatne.** Aplikacja nie korzysta z żadnej płatnej usługi. Jedyne ograniczenie to Open-Meteo: darmowe API jest tylko do użytku niekomercyjnego. Przy wdrożeniu komercyjnym trzeba albo wykupić plan (archiwum pogody wymaga planu „API Professional”, 99 EUR miesięcznie; „API Standard” za 29 EUR go nie obejmuje), albo zostać przy NASA POWER, które jest bezpłatne bez ograniczeń i już działa jako drugi dostawca.

**AI.** W aplikacji działają dwa modele uczenia maszynowego (gradient boosting, scikit-learn): prognoza zmiany NDMI pola na 7–14 dni oraz prognoza zapasu wody na 14 dni na wykresie „Zapas wody w strefie korzeni” (model wilgotności v3). Oba opisano w sekcjach „Model ML” niżej. Są dodatkiem do bilansu wodnego: ocena niedoboru, przyczyny i rekomendacje nie zależą od nich, a raport powstaje także bez nich. Pozostałe liczby pochodzą z obliczeń, a teksty raportu z reguł w kodzie (`app/core/recommendations.py`, `app/core/terrain_rules.py`, `app/presentation/sections/`). AI użyto przy tworzeniu: kod i dokumentację pisaliśmy z pomocą asystentów programistycznych (Claude Code, Codex), a ilustracje warstw gleby w `docs/assets/gleba/` wygenerowało narzędzie ImageGen (opis w `docs/assets/gleba/README.md`). Ilustracje są umowne i tak są podpisane w raporcie. Zasoby z projektu Penpot w `static/design/` również powstały przy użyciu ImageGen. Pełnią funkcję ilustracyjną.

## Jak liczony jest wynik

1. **ET0**: z Open-Meteo gotowe, z NASA POWER liczone wzorem FAO-56 Penmana-Monteitha (`app/core/et0.py`).
2. **Gleba**: z uziarnienia i węgla organicznego funkcja Saxtona i Rawlsa (2006) daje pojemność polową i punkt więdnięcia każdej warstwy; średnia ważona w strefie korzeni daje TAW, a RAW = p · TAW.
3. **Bilans dzienny** (FAO-56, rozdz. 8) przez 11 lat przed datą: ETc = Kc · ET0, współczynnik stresu Ks, przesiąk nadmiaru. Start co najmniej 12 miesięcy przed pierwszym porównywanym sezonem, więc stan początkowy nie ma znaczenia. Gdy pole jest bez uprawy, liczone jest parowanie z odkrytej gleby (FAO-56, rozdz. 7).
4. **Klasy**: brak niedoboru (ubytek do połowy RAW), zapas łatwo dostępnej wody się kończy (do RAW), niedobór umiarkowany (powyżej RAW, Ks ≥ 0,5), niedobór silny (Ks < 0,5).
5. **Niepewność**: ten sam bilans dla granic gleby z kwantyli SoilGrids. Jeśli wynik wypada w różnych klasach, raport mówi to wprost.
6. **Satelita**: mediana NDVI i NDMI po pikselach z roślinnością (SCL 4, środki pikseli w działce, co najmniej 6 pikseli i 65% pokrycia). Wskaźniki służą tylko do sprawdzenia bilansu: raport mówi, czy go potwierdzają, czy się z nim rozchodzą.
7. **Teren**: wypełnienie zagłębień Priority-Flood, kierunki D8, powierzchnia zasilająca; na mapie drogi spływu powyżej 0,05 ha i punkty, w których przecinają granicę działki.
8. **Rekomendacje**: reguły z jawnymi progami. Każda podaje, co zrobić, gdzie, dlaczego (z wartościami tej działki) i jak pewny jest wniosek. Lista retencji nigdy nie jest pusta: gdy działka nie ma niedoboru, częstych susz ani lekkiej gleby, raport podaje działanie zapobiegawcze z zapasem wody tej działki i jej historią.
9. **Użytkowanie terenu**: udział pikseli mapy ESA WorldCover w każdej klasie, liczony po pikselach, których środek leży w działce (dla działki węższej niż kilka pikseli: po wszystkich, których dotyka). Grunty rolne to grunty orne oraz łąki i pastwiska. Progi: co najmniej 50% poza gruntami rolnymi daje ostrzeżenie i punkt do sprawdzenia, co najmniej 20% daje wzmiankę. Wynik służy tylko do sprawdzenia założenia o uprawie (`app/core/land_use.py`).

## Model ML: prognoza zmiany NDMI na 7–14 dni

Zgodnie ze [specyfikacją](docs/ml/specyfikacja_treningu.md) model prognozuje zmianę wskaźnika NDMI (Sentinel-2, B8A i B11) między ostatnim czystym zdjęciem z 14 dni przed datą analizy a pierwszym czystym zdjęciem z dni +7…+14. NDMI jest związany m.in. z zawartością wody w roślinności, ale nie mierzy jej utraty bezpośrednio. Model nie prognozuje wilgotności gleby ani dawki nawodnienia.

[Pełna dokumentacja modelu](docs/model_ndmi.md): dane treningowe, walidacja, wyniki dla lat suszy, eksperymenty, ograniczenia i odtworzenie treningu.

- **Gdzie w raporcie:** sekcja satelitarna, pole `satellite.ndmi_forecast` (opis w [docs/kontrakt_api.md](docs/kontrakt_api.md)): zmiana z przedziałem 80%, okno prognozy, zdjęcie bazowe, cechy wejściowe. Prognoza pojawia się w okresie 01.04–15.10. Gdy w tym czasie brakuje czystego zdjęcia lub pogody, karta podaje powód.
- **Cechy** (47, wszystkie sprzed daty analizy i tylko z danych, które raport i tak pobiera):
  - stan pola: ostatnie NDMI, jego wiek i pokrycie pola, NDVI, mediany reflektancji pasm B8A, B11 i B04;
  - historia zdjęć z 45 dni: trend NDMI i NDVI z poprzedniego zdjęcia, trend z jeszcze wcześniejszego i ich różnica, liczba scen i czystych scen, udział roślinności, gołej gleby i chmur według klas SCL;
  - pora roku i ciepło: dzień roku, sumy temperatur efektywnych (od 1 stycznia, od 1 marca, z 30 dni), średnia temperatura z 7 i 30 dni, najniższa Tmin z 7 dni;
  - woda: opad i ET0 z 7, 14 i 30 dni, klimatyczny bilans wodny z 30 dni, średnia Tmax z 7 dni, dni od opadu ≥ 5 mm, wyczerpanie referencyjnego bilansu FAO-56 (TAW 100 mm, Kc = 1), opad w dniu zdjęcia i dzień wcześniej, opad i ET0 od zdjęcia do dnia analizy;
  - położenie: szerokość i długość geograficzna.

  Model nie zna gleby ani uprawy, bo w danych treningowych ich nie ma. Kod cech jest wspólny dla treningu i aplikacji (`kowr_ml/runtime/features.py`); test sprawdza, że z obserwacji aplikacji (wskaźniki tylko dla trzech scen) wychodzą te same wartości co w treningu.
- **Dane treningowe:** 15 782 pola 80 × 80 m na gruntach ornych (ESA WorldCover 2021) w 161 skupiskach po 6 × 6 km: 46 wybranych w regionach rolniczych i 115 w regularnej siatce co ok. 50 km na cały kraj. Sezony 2017–2026, obie kolekcje Sentinel-2 tak jak w aplikacji, dni prognozy co tydzień od kwietnia do połowy października: 682 428 wierszy (2017: 4 tys., lata 2018–2024 po 49–63 tys., 2025 i 2026 po ok. 142 tys.). 93 punkty siatki mają pogodę tylko od października 2024 r., bo dzienny limit Open-Meteo skończył się w dniu treningu, stąd przewaga dwóch ostatnich sezonów. Jedno skupisko leży wokół działki 580/2, więc wynik dla niej nie jest testem niezależnym; wszystkie liczby poniżej pochodzą z prognoz dla skupisk, których dopasowanie nie widziało.
- **Odtworzenie:** `pip install -r requirements-ml.txt`, potem moduły `kowr_ml.pipeline.ndmi.fields`, `.s2`, `.weather`, `.dataset`, `.train` (opis w `kowr_ml/pipeline/ndmi/__init__.py`). Na serwerze z 31 rdzeniami pobranie scen trwało 43 minuty, tabela 1 minutę, trening z oceną 33 minuty. Pogodę ogranicza limit Open-Meteo (ok. 38 skupisk na dobę z jednego adresu).

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

- **Wobec poprzedniego modelu** (`20261121_2014_0502bf`, usunięty z repozytorium, jest w historii gita; 16 cech, 20 skupisk, sezony 2019–2021 i 2023–2025) na 497 144 wierszach ze 141 skupisk, których tamten nie widział: błąd 0,065 → 0,054 (o 17% mniej), w sezonie 2018: 0,071 → 0,057, w 2022: 0,068 → 0,056, w 2026: 0,072 → 0,055, dla dużych spadków: 0,093 → 0,073. Poprzedni model zawyżał prognozę średnio o 0,013, nowy o 0,004.
- **Komunikaty raportu** (próg 0,03): „prawdopodobnie spadnie” sprawdza się w 74% przypadków, „prawdopodobnie wzrośnie” w 82%. Model wykrywa 71% faktycznych spadków, a kierunek zmiany większej niż 0,05 trafia w 91%. Gdy nie wskazuje kierunku, NDMI zmienia się o mniej niż 0,03 tylko w 40% przypadków, dlatego raport pisze wtedy „może zmienić się w obie strony”, a nie „nie zmieni się”.
- **Przedział 80%:** regresja kwantylowa z poprawką conformalized quantile regression liczoną osobno dla obu granic (dolna o 0,007 niżej, górna o 0,010 wyżej). Pokrycie liczone z poprawką wyznaczoną bez ocenianego foldu: 80,0%, w poszczególnych sezonach 78–81%. Przy spadkach większych niż 0,15 (8% wierszy) w przedziale mieści się połowa obserwacji, a błąd wynosi 0,12: model takie spadki zaniża.
- **Krótkookresowa zmienność:** to samo pole na dwóch czystych zdjęciach w odstępie jednego dnia różni się w NDMI średnio o 0,026, a w odstępie 2–3 dni o 0,039. Obejmuje to zmienność pomiaru i rzeczywiste zmiany pola; nie wyznacza dolnej granicy błędu.
- **Co sprawdziliśmy i odrzuciliśmy:** dłuższe okna opadu i bilansu (60 i 90 dni), większą wagę wierszy z suszy, wyrównanie wag sezonów i sam większy zbiór przy tych samych cechach nie zmieniały błędu. Maksimum NDMI z całego sezonu dałoby jeszcze ok. 1 punkt procentowy, ale wymaga wskaźników ze wszystkich scen sezonu, czyli wielokrotnie dłuższego pobierania w raporcie. Idealna prognoza pogody na okno 7–14 dni dałaby 1–3 punkty; prawdziwa prognoza da mniej.
- **Sieć GRU** (PyTorch na GPU, przebieg pogody z 60 dni i te same cechy, zespół 5 sieci, `kowr_ml/experiments/train_gru.py`) na podziale pierwszego modelu wypadła o 4–6% lepiej: 0,051 wobec 0,055 na 4 odłożonych skupiskach i 0,056 wobec 0,058 na odłożonych skupiskach w sezonie 2025. Do aplikacji trafił model drzewiasty, bo nie wymaga PyTorcha i mieści się w 3,7 MB; sieć jest kierunkiem dalszej pracy.

Pełne metryki (według sezonu i miesiąca) są w `kowr_ml/models/ndmi/20261122_0005_e1c565/metrics.json`, karta modelu w `model_card.json`, wynik sieci w `metrics_gru.json`. Aplikacja bierze przebieg przypięty w `kowr_ml/models/CURRENT.json`, a zmienna `KOWR_ML_MODEL_DIR` pozwala wskazać inny. Model ma status „eksperymentalny”: pola treningowe to fragmenty gruntów ornych, a nie granice deklarowanych upraw.

Sprawdzenie w aplikacji na prawdziwych działkach (22.11.2026): 4 lokalizacje (580/2, Żuławy, Podkarpacie, punkt koło Poznania) i 9 dat z lat 2018–2026. Prognoza powstała w 20 z 36 przypadków, w pozostałych raport podał powód (brak czystego zdjęcia z 14 dni; punkt koło Poznania nie ma pikseli roślinności w żadnej dacie). Z 11 prognoz, które dało się porównać z późniejszym zdjęciem, 8 zmieściło się w przedziale. Na samej działce 580/2 trafiła 1 z 4: spadek NDMI o 0,24 w lipcu 2022 r. model przewidział jako −0,19 (dolna granica −0,23), a spadku o 0,21 w czerwcu 2023 r. nie przewidział (prognoza −0,06).

## Model ML: prognoza wilgotności gleby 0–100 cm

Pierwsze dwa eksperymenty oceniały dni t … t+6. W aplikacji działa opisana niżej wersja 3 na 14 dni, współdzieląca horyzont wykresu FAO-56. Etykieta to zmiana θ [m³/m³] względem ostatniej znanej wartości z dnia t−6, bo ERA5-Land ukazuje się z ok. 5-dniowym opóźnieniem. ERA5-Land to reanaliza dla komórki ok. 9 km, a nie pomiar na działce, więc model nie zna gleby ani uprawy działki.

- **Cechy** (θ do t−6, pogoda do t−1, bez prognozy pogody): θ 0–100 cm i 0–7 cm z t−6, zmiana θ w tygodniu przed t−6, wyprzedzenie w dniach, opad i ET0 od t−5 do t−1 oraz te same cechy pogodowe i dzień roku co w modelu NDMI.
- **Dane:** 20 skupisk z `kowr_ml/pipeline/config.py`, jedna komórka na skupisko, dni prognozy co 3 dni w latach 2019–2025, 118 140 wierszy. ET0 policzone wzorem FAO-56 (`app/core/et0.py`) z ERA5; dla Kutna koreluje dziennie z ET0 z NASA POWER na poziomie 0,98, a rocznie jest o 5–10% wyższe.
- **Odtworzenie:** eksport plików `.om` do `kowr_ml/data/era5_land_sm.parquet` i `era5_weather.parquet` (skrypt poza repo, ok. 18 min), potem tabela i trening (3,5 min na 24 wątkach CPU). Kod v1 jest w historii gita (`kowr_ml/sm_dataset.py`, `sm_train.py` sprzed refaktoru); w repozytorium został tylko potok wdrożonej wersji 3 (niżej).

Walidacja (MAE θ w m³/m³; 0,001 m³/m³ to 1 mm wody w warstwie 0–100 cm):

| Test | Wiersze | „Bez zmiany” | Sezonowy | **Model (HGB)** | Pokrycie przedziału 80% |
|---|---:|---:|---:|---:|---:|
| 4 odłożone skupiska, 2019–2024 | 20 248 | 0,0123 | 0,0098 | **0,0052** | 82% |
| 16 skupisk treningowych, 2025 | 13 520 | 0,0110 | 0,0106 | **0,0066** | 76% |
| odłożone skupiska, 2025 | 3 380 | 0,0114 | 0,0107 | **0,0068** | 75% |

Błąd rośnie z wyprzedzeniem: od ok. 0,003 m³/m³ dla dnia t do 0,007–0,010 dla t+6 (bez zmiany: 0,014–0,015). W grudniu 2025 model był gorszy od prognozy „bez zmiany” (0,010 wobec 0,008), prawdopodobnie przez mróz i śnieg. Model nie przewiduje skutków deszczu z dni t … t+6, bo nie dostaje prognozy pogody. Do wpięcia w wykres brakuje funkcji predykcji, pobierania ERA5-Land dla działki w aplikacji i decyzji, jak pokazać θ obok zapasu w % TAW.

### Wersja 2: z prognozą pogody, glebą i terenem

v2 ma tę samą etykietę i te same wiersze co v1, ale tylko od 18.01.2023, bo wtedy zaczyna się archiwum prognoz. Dodatkowe cechy:
- **Prognoza ECMWF IFS** z przebiegu 00 UTC dnia t (open data, `s3://ecmwf-forecasts`, CC BY 4.0 i ECMWF Terms of Use): opad i temperatura 2 m na dni t … t+k oraz wilgotność 0–100 cm z analizy IFS i jej prognozowana zmiana. Wilgotność jest w archiwum dopiero od 02.2024; wcześniej ta cecha jest pusta. Pobrano tylko potrzebne pola (`kowr_ml/pipeline/soil_moisture/ifs.py`, ok. 10 min).
- **Gleba i teren** liczone tymi samymi funkcjami co w aplikacji dla działki umownej 200 × 200 m w środku skupiska (`kowr_ml/pipeline/soil_moisture/static.py`): uziarnienie i węgiel 0–30 cm z SoilGrids, FC i WP 0–100 cm (Saxton–Rawls), spadek i wysokość z NMT GUGiK. 22.11.2026 NMT nie odpowiadał, więc w tym przebiegu teren jest pusty i karta modelu wypisuje go jako pominięty. Dla 2 z 20 skupisk SoilGrids nie ma danych.
- **Odtworzenie:** kod v2 jest w historii gita (`kowr_ml/sm2_dataset.py`, `sm2_train.py` sprzed refaktoru; trening 2,7 min). Pobieranie prognoz i gleby jest wspólne z v3.

Walidacja (MAE θ w m³/m³). Wszystkie warianty uczono na tych samych wierszach 2023–2024 z tymi samymi hiperparametrami:

| Test | Wiersze | „Bez zmiany” | Cechy v1 | v1 + prognoza | **v2 (+ gleba)** | Przedział 80% |
|---|---:|---:|---:|---:|---:|---:|
| 4 odłożone skupiska, 2023–2024 | 6 292 | 0,0123 | 0,0050 | 0,0043 | **0,0043** | 82% |
| 16 skupisk treningowych, 2025 | 13 520 | 0,0110 | 0,0070 | 0,0053 | **0,0053** | 68% |
| odłożone skupiska, 2025 | 3 380 | 0,0114 | 0,0073 | 0,0055 | **0,0054** | 69% |

Prognoza pogody zmniejsza błąd o 14–25%, najbardziej dla dalszych dni: dla t+6 w 2025 z 0,010 do 0,007. Wiersze z 2025 są te same co w teście v1, a sam v1 (uczony na 2019–2024) miał na nich 0,0066 i 0,0068, więc v2 jest o ok. 20% lepszy. Gleba nic nie dodaje, co jest zgodne z naturą etykiety: ERA5-Land liczy wilgotność dla komórki 9 km bez spływu bocznego, więc gleba i teren działki na nią nie wpływają, a 20 skupisk to za mało, żeby nauczyć się wpływu gleby komórki. Przedział 80% w 2025 obejmuje tylko 68–69% obserwacji, bo kalibrowano go na dwóch sezonach; przed użyciem trzeba go poszerzyć.

### Wersja 3 w aplikacji: wykres „Zapas wody w strefie korzeni”

v2 potrzebuje przy każdej predykcji wilgotności z ERA5-Land z dnia t−6, a ERA5-Land jest tylko w archiwum Open-Meteo, które z sieci hackathonu zwraca 429. Dlatego do aplikacji trafił v3 (`pip install -r requirements-ml.txt`, potem `python -m kowr_ml.pipeline.soil_moisture.ifs`, `.static`, `.dataset`, `.train`; opis w `kowr_ml/pipeline/soil_moisture/__init__.py`). Etykieta to zmiana wilgotności ERA5-Land od wczoraj, θ(t+k) − θ(t−1), dla k = 0…13: 14 dni, tyle samo co linia bilansu na prognozie pogody. 14, bo tyle pełnych dób prognozy IFS daje na żywo Open-Meteo. Archiwum HRES na AWS kończy się na 240 h (dzień 9), więc dni 10–13 w treningu pochodzą z przebiegu kontrolnego ensemble IFS z tego samego startu (te same pola; `kowr_ml/pipeline/soil_moisture/ifs.py`, `fetch_extension`). Średni opad i temperatura nie skaczą na granicy obu źródeł. Stan gleby model bierze z analizy IFS, a pozostałe cechy to pogoda do t−1, prognoza IFS z dnia t, gleba z SoilGrids, dzień roku i dzień prognozy. Teren pominięto. Wyniki v1 i v2 zostają w tabelach wyżej, ich kod w historii gita.

| Test (MAE θ, m³/m³) | Wiersze | „Bez zmiany” | Bez prognozy | Bez gleby | **v3** | Przedział 80% |
|---|---:|---:|---:|---:|---:|---:|
| 4 odłożone skupiska, 2023–2024 | 12 656 | 0,0105 | 0,0061 | 0,0052 | **0,0052** | 79% |
| 16 skupisk treningowych, 2025 | 26 768 | 0,0093 | 0,0096 | 0,0068 | **0,0068** | 67% |
| odłożone skupiska, 2025 | 6 692 | 0,0097 | 0,0103 | 0,0069 | **0,0069** | 67% |

Średnie są wyższe niż w 7-dniowej wersji, bo obejmują też dalsze dni. Model bije prognozę „bez zmiany” na każdym z 14 dni: w 2025 dla t+6 0,0063 wobec 0,0093, dla t+13 0,0123 wobec 0,0152. Dla t+6 jest prawie tak dobry jak wersja 7-dniowa (0,0060). Przedział 80% jest w 2025 za wąski (67%), co raport mówi wprost. Bez prognozy pogody model nie bije prognozy „bez zmiany”.

**W raporcie** (`water_status.ml_forecast`, tylko analiza na dziś): `kowr_ml/runtime/soil_moisture.py` liczy cechy tymi samymi funkcjami co trening. Na 40 losowych dniach z 2024–2025 predykcja z aplikacji i z treningu różniła się o 0. Przewidzianą zmianę θ przeliczamy na mm wody w strefie korzeni (do 1 m, bo tyle obejmuje etykieta) i doczepiamy do zapasu działki z bilansu FAO-56 z ostatniej pełnej doby. Wykres pokazuje od razu cały rok i pełną prognozę: przerywaną linię bilansu na prognozie pogody i ciągłą linię modelu z pasem 80%, obie na te same 14 dni (tyle pełnych dób daje prognoza IFS, z której korzysta model). Gdy IFS nie ma któregoś dnia, linia modelu kończy się przed nim. Dni prognozy zajmują ok. 1/5 szerokości osi, a ich opad ma własną, wyższą skalę z podpisami w pełnych mm. Gdy prognozy IFS brak, raport podaje powód. Pobranie IFS trwa ok. 0,3 s.

## Weryfikacja wyników

Testy bez sieci (`.venv\Scripts\python.exe -m pytest -q`):

- ET0: przykład 18 z FAO-56 (Uccle, 6 lipca): 3,88 mm na dobę, razem z wynikami pośrednimi.
- Bilans: przykład 37 z FAO-56 (przebieg ubytku przez 10 dni), domknięcie bilansu, ograniczenie parowania z odkrytej gleby.
- Funkcja pedotransferowa: wszystkie 12 wierszy tabeli 3 Saxtona i Rawlsa (2006), np. glina 40% piasku i 20% iłu: 28% i 14% objętości.
- SoilGrids: wagi komórek i wartości dla działki 580/2 zgodne z `tests/fixtures/soilgrids_niedrzwica_koscielna_580_2.json` (0–5 cm: piasek 33,7%, pył 48,2%, ił 18,1%).
- Spływ: sztuczne powierzchnie (płaszczyzna, dolina, zagłębienie), reguły rekomendacji, zgodność satelity z bilansem.
- Użytkowanie terenu: udziały klas i progi (pole, las, działka częściowo zadrzewiona), nazwa arkusza mapy z położenia, ostrzeżenie bez zmiany pozostałych rekomendacji, jawny brak mapy.
- Prognoza: siedem dni od daty w Polsce, zachowanie braków danych i rzeczywistego opadu 0 mm.
- Plan prac: mokry wierzch po deszczu przy małym parowaniu (listopad) blokuje wjazd, a po suchym tygodniu latem nie; wiatr i opad przy opryskach; siew tylko w terminie siewu; nawożenie przed ulewą i przy zatrzymanej wegetacji odradzane; brak prognozy opadu daje „brak danych”, a nie zgadywaną ocenę; najlepsze okno. Zapytanie z raportu (`npm test`): uziarnienie 0–10 cm ważone grubością warstw.
- Satelita: przesunięcie reflektancji z metadanych sceny. Gdy scena ma je już odjęte w pikselach, nie odejmujemy go drugi raz (wartości z tej samej sceny w obu kolekcjach).
- Pulpit (`npm test`): zapis pól, obsługa dat, zapas wody, obserwacje satelitarne i kolejność działań.
- Hydrologia: miesiące roku hydrologicznego zgodne z nazwami plików IMGW, porównanie tylko z latami przed datą analizy, odczyt wierszy archiwum we wszystkich trzech formatach używanych przez IMGW (do 2022, 2023, od 2024).

Sprawdzenia na prawdziwych danych (wymagają sieci):

| Skrypt | Co sprawdza | Wynik 21.11.2026 |
|---|---|---|
| `scripts/checks/check_sentinel.py` | wzorzec dla 580/2 | 04.06.2025: 11/11 pikseli, NDMI 0,59225; 19.06.2025 odrzucona; 21.06.2025: 0,54090. Zgodne |
| `scripts/checks/check_sentinel_offset.py` | ta sama scena w kolekcjach `sentinel-2-c1-l2a` i `sentinel-2-l2a`: czy przesunięcie reflektancji stosujemy raz | 22.11.2026, sceny z 3 i 5.06.2023 koło Niedrzwicy: B8A 5108 i 4108 DN, reflektancja 0,4109 i 0,4108 (różnica 0,0000). Przed poprawką starsza kolekcja dawała reflektancję o 0,1 za niską: dla 580/2 z 10.07.2022 NDMI 0,88, 0,86 i 0,67 bez NDVI, po poprawce 0,63, 0,58 i 0,49 z NDVI 0,85, 0,79 i 0,71. Dotyczyło scen z bazą przetwarzania od 04.00, których nie ma w nowszej kolekcji, czyli głównie sezonu 2022. Flaga `earthsearch:boa_offset_applied` nie wystarcza: z 1570 scen z 2022 r. nad 70 obszarami w Polsce 92 miały `false`, a ich piksele też były po korekcie (10.05.2022 koło Inowrocławia: B11 1911 DN z flagą `false` i 1908 DN na sąsiednim kaflu z flagą `true`), więc dla starszej kolekcji offset wynosi zawsze 0 |
| `scripts/checks/check_weather_providers.py` | ET0 liczone z NASA POWER wobec ET0 z Open-Meteo na wspólnych dniach | 66 dni, dwa punkty: stosunek sum ET0 1,07 i 0,97; opadu 0,78 i 1,19 |
| `scripts/checks/check_terrain.py` | spływ dla 580/2 | największy odpływ 1,60 ha przy południowo-wschodniej granicy (wzorzec 1,63 ha); liczba punktów 5 + 2 wobec 4 + 4 we wzorcu |
| `scripts/dev/acceptance.py` | pusty cache i wymuszone awarie źródeł (`KOWR_FAIL`) | raport powstaje, brak jest nazwany |
| ręczne raporty z pokryciem terenu (22.11.2026) | sześć raportów na żywo: 580/2 (pszenica 22.11.2026 i użytki zielone 20.06.2023), Nacław 119/2 (jęczmień 15.07.2018), punkt w Puszczy Białowieskiej, punkt przy Śniardwach, punkt w centrum Warszawy; do tego `KOWR_FAIL=land_use` | 580/2: grunty orne 97% (89 pikseli), zgodne z pszenicą, przy użytkach zielonych raport mówi o niezgodności; Nacław: grunty orne 81%, łąki 19%; Puszcza: drzewa 100% i Warszawa: zabudowa 100%, w obu ostrzeżenie i punkt „Sprawdź, czy wskazałeś właściwą działkę”; Śniardwy: łąki 87%, drzewa 10% (niezgodne z ziemniakiem). Odczyt mapy 0,5–1,5 s. Przy wymuszonej awarii raport powstaje, a brak jest nazwany w źródłach i ograniczeniach |
| `scripts/dev/sweep_poland.py` | przegląd odporności na pustej pamięci podręcznej: 24 punkty z całej Polski (niziny, góry, wybrzeże, krańce wschodnie i zachodnie, miasto, las, jezioro) w datach 2016–2026 i dla 7 upraw; z `--cached-parcels` 8 przypadków dla działek z granicą zapisaną w `cache/uldk` | Drugi przebieg (21.11.2026 wieczorem, ULDK już działał): 24 z 24 raportów z granicą działki, mediana 15,0 s, najdłuższy 25,1 s, żaden powyżej 30 s. Zdjęcia satelitarne: wynik w 14 przypadkach, w 6 status „liczę” (wynik dochodzi po raporcie), w 4 powód braku (chmury, brak zielonej roślinności). Najwolniejsze źródła: archiwum IMGW przy pierwszym użyciu (do 17 s) i zdjęcia satelitarne. Open-Meteo odmawiało (429), pogodę dał NASA POWER. Przegląd wykrył raport bez żadnej rekomendacji (rzepak, Dolny Śląsk, 10.05.2023, bez niedoboru); dodaliśmy zapobiegawczą rekomendację retencyjną, która pojawia się, gdy żadna inna reguła retencji nie zadziała. Pierwszy przebieg (przy awarii ULDK): 24 z 24 raportów, mediana 11,9 s, najdłuższy 15,5 s, granice z zapasowego WFS ewidencji |
| `scripts/dev/run_report.py`, `scripts/dev/http_check.py` | raport z wiersza poleceń i przez HTTP | |
| `scripts/dev/snapshot_report.py <katalog>` | JSON raportów 580/2 (15.07.2018 i 20.06.2025) i punktu w Wielkopolsce bez pól zależnych od czasu; `diff -r` dwóch katalogów pokazuje, czy zmiana w kodzie zmieniła wynik | przy podziale `app/report.py` na warstwy (22.11.2026): raporty identyczne |
| `scripts/dev/run_report.py` (sekcja `[hydrologia]`) | wodowskaz IMGW dla 580/2 dziś, Kościana 15.07.2018, 580/2 15.07.2026 | Lublin (Bystrzyca, 19 km): przepływ 1,01 m³/s, wyższy w 9 z 9 lat, „bardzo mało wody”; Kościan (Kanał Mosiński, 5 km): 0,18 m³/s wobec mediany 1,37, wyższy w 9 z 10 lat (susza 2018); 15.07.2026: brak danych podany wprost (archiwum kończy się 31.10.2025) |

Sprawdzian merytoryczny: jęczmień jary 15.07.2018 w Wielkopolsce (gm. Kościan) daje niedobór umiarkowany do silnego, klimatyczny bilans wodny −184 mm przy medianie −110 mm, a NDMI spadł w czerwcu z 0,29 do 0,13, co potwierdza bilans.

## Ograniczenia

- **Model, nie pomiar.** Pogoda pochodzi z siatki modelu (NASA POWER ok. 50 km), gleba z mapy globalnej 250 m. Lokalna burza albo płat piasku zmieniają wynik. Dlatego raport pokazuje przedział i klasy słowne, a nie wilgotność z dokładnością do procenta.
- **Dostawcy pogody różnią się między sobą**: na 66 wspólnych dniach suma opadu z NASA POWER wyniosła 78% i 119% sumy z Open-Meteo. Cała seria 10 lat pochodzi zawsze z jednego dostawcy, więc porównania z medianą są spójne, ale wartości bezwzględne zależą od tego, który dostawca odpowiedział.
- **Bilans nie zna** spływu powierzchniowego, podsiąku z wody gruntowej, drenów, śniegu, zamarznięcia gleby ani nawadniania.
- **Kalendarz uprawy**: opcjonalne daty siewu lub sadzenia i zbioru korygują bilans jednego sezonu. Jeśli podano obie, długości faz skalujemy proporcjonalnie. Przy jednej dacie pozostałą granicę szacujemy z domyślnej długości sezonu. Starsze sezony oraz pola bez własnych terminów korzystają z kalendarza gatunku. Data kolejnego siewu służy do oceny przerwy po zbiorze. Głębokość korzeni jest stała przez sezon, Kc bez poprawki klimatycznej.
- **Historia 10 sezonów** zakłada tę samą uprawę co roku.
- **Przedział niepewności gleby jest szeroki**, bo kwantyle SoilGrids opisują 90-procentowy przedział predykcji; na lekkich glebach wynik często obejmuje dwie klasy.
- **Satelita**: wskaźniki liczone dla trzech scen z 45 dni; przy zachmurzeniu albo małej działce (mniej niż 6 pikseli 20 m) sekcja podaje brak danych. Łącze do archiwum scen (AWS us-west-2) bywało bardzo wolne, wtedy wynik dochodzi po raporcie.
- **Teren**: wynik czysto topograficzny. Liczba punktów na granicy zależy od progu łączenia. Usługa WCS NMT GUGiK przestała odpowiadać (22.11.2026), więc pobieramy cały arkusz NMT (ok. 36 MB ASCII GRID, 20–30 s) z opendata.geoportal.gov.pl przy pierwszej działce na nim; kolejne działki z tego arkusza liczą się z lokalnego GeoTIFF-a w 1–2 s. Bierzemy najnowszy rocznik skorowidza z oczkiem 1 m. Gdy pobranie się nie uda, raport zostaje bez dróg spływu i rekomendacji terenowych i mówi to wprost.
- **Zakres dat pilnuje formularz, nie API.** `POST /api/report` odrzuca datę z przyszłości, ale przyjmuje dzień starszy niż 10 lat. Raport wtedy powstaje, a sekcja satelitarna podaje brak zdjęć (archiwum Sentinel-2 L2A zaczyna się w 2017 r.).
- **Hydrologia**: stan rzeki pochodzi z najbliższego wodowskazu IMGW (do 40 km) i opisuje całą zlewnię powyżej niego, nie wodę na polu; zbiorniki i zrzuty mogą go zmieniać. Archiwum IMGW kończy się 31.10.2025, a bieżący pomiar dotyczy tylko dnia dzisiejszego, więc dla dat od 01.11.2025 do wczoraj raport podaje brak danych hydrologicznych. Bieżący pomiar to pojedynczy odczyt, porównywany ze średnimi z 7 dni. Brak danych o odległości od cieków i o wodzie gruntowej (patrz tabela źródeł).
- **Użytkowanie terenu**: mapa ESA WorldCover pokazuje stan z 2021 r., także w raportach dla innych lat, i pochodzi z automatycznej klasyfikacji zdjęć: bywa, że myli łąkę z polem uprawnym. Nie rozróżnia upraw, sadów ani ugorów. Raport nie blokuje analizy dla lasu, zabudowy czy wody: liczy bilans dla podanej uprawy i ostrzega. Rekomendacje nie są dopasowywane do klas użytków z ewidencji gruntów (EGiB), bo aplikacja ich nie pobiera.
- **FAO-56**: tabele pochodzą z wydania z 1998 r. dostępnego na fao.org. Materiał KOWR cytuje wydanie poprawione z 2025 r.; nie porównaliśmy tabel między wydaniami.
- **Progi reguł** rekomendacji i zgodności satelity z bilansem są założeniami roboczymi zapisanymi jako stałe w kodzie, nie wartościami z publikacji.
- **Granice działek: ULDK, a przy jego awarii zbiorczy WFS ewidencji GUGiK.** 21.11.2026 wieczorem ULDK i KIEG przekierowywały każde zapytanie, z różnych adresów IP, na stronę zastępczą `integracja01.gugik.gov.pl/resp/`. Zbiorczy WFS stoi na innym serwerze i wtedy działał: na 5 działkach pobranych wcześniej z ULDK dał tę samą granicę (powierzchnia zgodna do 0,0001 ha). Raport podaje w tabeli źródeł, z której usługi pochodzi granica. Przy awarii ULDK działają pełny identyfikator, kliknięcie na mapie oraz wyszukiwanie „nazwa obrębu numer” (kod TERYT obrębu z usługi WFS PRG GUGiK, a następnie działka z WFS ewidencji; nie obejmuje działek zapisanych w arkuszach `AR_n`). Gdy zawiodą obie usługi, działki zapisane wcześniej w pamięci podręcznej działają, a dla nowych raport powstaje dla wskazanego punktu: bez powierzchni, zdjęć satelitarnych pola i spływu.
- **Model NDMI** prognozuje wskaźnik satelitarny, nie wilgotność gleby. Nie zna gleby ani uprawy działki, uczono go na pogodzie z Open-Meteo (przy NASA POWER raport ostrzega o mniejszej pewności) i działa tylko od 1 kwietnia do 15 października, gdy jest czyste zdjęcie z 14 dni przed datą; na polach testowych z pełną pogodą ten warunek spełniało 44–51% par pole–tydzień. Zbiór treningowy nadreprezentuje okresy z dobrą widocznością pola. Duże spadki NDMI (zbiór, gwałtowne dojrzewanie) model zaniża. Gdy czyste zdjęcie pochodzi z samego dnia analizy, model go nie używa (bierze dane do dnia poprzedniego), a wskaźniki ma wtedy dla starszego zdjęcia bazowego.
- **Plan prac** to uproszczone reguły z umownymi progami: wjazd odradzany przy wierzchu powyżej 90% pojemności polowej albo opadzie od 3 mm, opryski przy opadzie od 2 mm, wietrze od 20 km/h (ostrożnie od 15) albo mrozie, nawożenie przy średniej temperaturze poniżej 5 °C, opadzie od 5 mm albo od 20 mm w 2 kolejnych dniach. Wilgotność wierzchu to model warstwy parowania FAO-56 (od pojemności polowej 30 dni wstecz), który nie zna odcieku wody ponad pojemność polową, mrozu w glebie ani pokrywy śnieżnej (śnieg rozpoznaje tylko po kodzie pogody dnia). Wiatr to maksimum doby na 10 m. Termin siewu to umowna data z kalendarza upraw ±2–3 tygodnie. Plan nie zna sprzętu, etykiet środków ochrony roślin ani terminów programu azotanowego.
- Prototyp dla jednego użytkownika na komputerze lokalnym: bez kont i danych osobowych. Pola i raporty są przechowywane lokalnie w SQLite.

## Skala, limity, aktualizacje i koszty

- **Zapytania w prototypie:** jeden raport na pustej pamięci podręcznej to: 1 zapytanie ULDK, 2–3 zapytania o pogodę, 1 zapytanie o wodowskazy IMGW i do 20 plików archiwum IMGW (0,15–1,9 MB, tylko przy pierwszym użyciu), 54 małe zapytania WCS o glebę, 2 zapytania STAC i kilkadziesiąt odczytów fragmentów scen, do 9 zapytań o skorowidz NMT (roczniki 2018–2026) i 1 arkusz NMT (ok. 36 MB, tylko przy pierwszym użyciu arkusza).
- **Radzenie sobie z limitami i dostępnością źródeł:** wszystkie źródła wywoływane są równolegle z jawnymi limitami czasu (`app/config.py`), mechanizmami zapasowymi (ULDK → WFS EGiB/PRG, Open-Meteo → NASA POWER, SoilGrids WCS → REST → GeoTIFF) i pamięcią podręczną na dysku (pogoda po komórce 0,01° i zakresie dat, gleba po oknie 250 m, satelita po działce i scenie, teren po działce, archiwa IMGW na stałe, lista wodowskazów przez 3 h).
- **Aktualizacja danych i czas odpowiedzi przy większym ruchu:** dane statyczne lub wolnozmienne (NMT 1 m dla Polski, SoilGrids 250 m, granice działek z eksportu EGiB Parquet) w wdrożeniu ogólnokrajowym należy utrzymywać jako lokalną kopię odświeżaną cyklicznie (rocznie / kwartalnie). Pogodę (siatka dla Polski) i wodowskazy IMGW wystarczy pobierać centralnie w zadaniu harmonogramowym (raz dziennie / co godzinę) do wspólnej bazy lub pamięci podręcznej, a analizę Sentinel-2 i ciężkie obliczenia NMT wykonywać w kolejce zadań (workerach). Przy takim podziale czas odpowiedzi dla działki spada z 11–15 s do ok. 1–3 s nawet przy wielu jednoczesnych użytkownikach.
- **Przewidywane koszty infrastruktury przy rozwoju (szacunek dla wdrożenia krajowego):**
  - **Dane:** 0 zł przy pozostaniu na NASA POWER / IMGW, GUGiK, Copernicus i SoilGrids; przy komercyjnym użyciu Open-Meteo Archive plan „API Professional” to 99 EUR/mies. (ok. 430 zł/mies.).
  - **Serwery i pamięć masowa:** aplikacja + kolejka zadań + serwer bazy/cache (2–4 instancje CPU 4–8 vCPU, 16–32 GB RAM) to rząd ok. 1000–2500 zł/mies. w chmurze lub na infrastrukturze własnej KOWR; lokalna kopia rastra NMT 1 m dla Polski (~1–2 TB po kompresji COG) i SoilGrids (< 10 GB) to ok. 200–500 zł/mies. w pamięci obiektowej. Łącznie utrzymanie infrastruktury produkcyjnej dla skali ogólnokrajowej mieści się orientacyjnie w przedziale **1500–3500 zł/mies.** (bez kosztów zespołu utrzymaniowego).

## Bezpieczeństwo

- **Brak danych osobowych:** aplikacja nie zbiera, nie przesyła ani nie przechowuje danych osobowych (brak rejestracji, logowania, danych kontaktowych). Do analizy wystarcza identyfikator działki lub punkt na mapie; zapisane pola (działka, uprawa, data, nazwa nadana przez rolnika i ostatni raport) leżą w pliku SQLite na serwerze. Prototyp nie ma kont, więc każdy, kto otworzy aplikację na danym serwerze, widzi wszystkie zapisane na nim pola.
- **Walidacja wejścia i brak sekretów:** wszystkie parametry żądań HTTP są walidowane przez schematy Pydantic (`app/schemas/`: zakres współrzędnych ograniczony do Polski, maksymalna długość identyfikatora, walidacja dozwolonych upraw i zakaz dat z przyszłości). Aplikacja nie wymaga ani nie przechowuje kluczy API, tokenów ani haseł.
- **Odporność i izolacja:** wywołania usług zewnętrznych mają limity czasu i nie ujawniają śladów stosu w odpowiedziach; interfejs React domyślnie escapuje wszystkie wartości tekstowe (ochrona przed XSS). Przed wdrożeniem publicznym (poza lokalnym prototypem) należy dodać ograniczenie liczby zapytań (rate limiting), HTTPS i standardowe nagłówki bezpieczeństwa HTTP (CSP, `X-Content-Type-Options`).
