# Dobór technologii do treningu ML (KOWR)

Dotyczy [specyfikacji treningu ML](specyfikacja_treningu.md). Stan na 21.11.2026.

**Werdykt:** jeden pakiet w Pythonie 3.12, bez chmury, bazy danych i orkiestratora. Rastry czytamy bezpośrednio z COG przez `rasterio`, sceny wyszukujemy przez `pystac-client`, tabele trzymamy w Parquet (`pandas` + `pyarrow`), model to `HistGradientBoostingRegressor` ze `scikit-learn`. Ten sam pakiet importuje backend aplikacji, żeby predykcja liczyła cechy tym samym kodem co trening.

Stos został dziś zainstalowany i uruchomiony na działce 580/2. Odtworzył wartości z sekcji 5 specyfikacji co do cyfry (szczegóły w sekcji 2).

## 1. Wybór

| Obszar | Wybór | Dlaczego | Odrzucone |
|---|---|---|---|
| Język i środowisko | Python 3.12, `uv` z `pyproject.toml` i `uv.lock` | Wszystkie pakiety geo mają gotowe wheele na Windows z wbudowanym GDAL/GEOS/PROJ, więc nie trzeba condy ani OSGeo4W. Lockfile daje obu osobom i jury te same wersje. | conda (wolniejsza, zbędna), samo `pip` bez locka (rozjazd wersji między dwiema maszynami) |
| Wyszukiwanie scen | `pystac-client` na `earth-search.aws.element84.com/v1` | Obsługuje stronicowanie i filtr `intersects`, zwraca `raster:bands` ze skalą i offsetem. | ręczne zapytania HTTP (trzeba samemu stronicować) |
| Odczyt rastrów | `rasterio`, okna czytane wprost z adresów HTTPS assetów | Pole ma kilkanaście pikseli. Jawny odczyt okna i `geometry_mask(all_touched=False)` realizuje regułę „środek piksela w polu” dokładnie tak, jak ją opisuje specyfikacja. | `odc-stac`, `stackstac`, `xarray` + `dask` (kostka danych dla 11 pikseli to narzut i mniejsza kontrola nad maską, skalą i logiem odrzuceń), Google Earth Engine i Sentinel Hub (konta, limity i warunki licencyjne, a specyfikacja jest zweryfikowana na Earth Search) |
| Geometrie pól | `geopandas` + `pyogrio` + `shapely` 2 + `pyproj`, ULDK przez `httpx` | `pyogrio` czyta GPKG, SHP i FlatGeobuf z filtrem `bbox`, więc nie ładujemy całego kraju. Format eksportu GSA jest jeszcze niepotwierdzony i ten wybór od niego nie zależy. | PostGIS (serwer do postawienia dla 300 pól) |
| Pogoda | `httpx` do Open-Meteo, surowe odpowiedzi JSON zapisane na dysku per komórka | Kilka obszarów to kilka komórek siatki, czyli kilka zapytań na cały sezon. | SDK `openmeteo-requests` (dodatkowe zależności bez zysku przy tej skali) |
| Tabele | `pandas` 3 + `pyarrow`, pliki Parquet | Zbiór ma rząd dziesiątek tysięcy wierszy. `merge_asof` załatwia dobór ostatniej i docelowej sceny, `rolling` okna pogodowe. `geopandas` i tak wymaga `pandas`. | `polars` (drugi silnik ramek bez potrzeby), DuckDB (przyda się tylko wtedy, gdy GSA przyjdzie jako wielki plik Parquet) |
| Model i walidacja | `scikit-learn`: `HistGradientBoostingRegressor`, `GroupKFold` / `GroupShuffleSplit` po `spatial_group` | Model wskazany w specyfikacji. Natywnie obsługuje braki i cechy kategoryczne (typ uprawy). Podział grupowy jest w tej samej bibliotece. | XGBoost, LightGBM, CatBoost (ten sam typ modelu, kolejna zależność), sieci i modele fundamentowe (za mało etykiet, jeden sezon), Optuna (kilka hiperparametrów wystarczy przeszukać małą siatką) |
| Artefakt modelu | `joblib` + `model_card.json` (lista cech, wersja `scikit-learn`, wersje danych, licencje) | Backend jest w Pythonie, więc nie potrzeba formatu przenośnego. Plik `joblib` nie jest zgodny między wersjami `scikit-learn`, dlatego wersja jest przypięta w locku i zapisana w karcie. | ONNX (konwersja i drugi runtime bez korzyści) |
| Przebiegi i raport | katalog `runs/<data>_<hash>/` z parametrami, metrykami i wykresami z `matplotlib` | Specyfikacja wymaga trzymania licencji i wersji danych razem z przebiegiem. Zwykłe pliki w repo to spełniają. | MLflow, DVC, W&B (serwer lub konto dla kilku przebiegów) |
| Orkiestracja | moduły uruchamiane z linii poleceń, każdy etap zapisuje Parquet i pomija to, co już ma | Zerwane pobieranie wznawia się od miejsca przerwania. | Airflow, Prefect, Dagster |
| Testy | `pytest`, test integracyjny na 580/2 z wartościami ze specyfikacji | Trzy sceny z sekcji 5 to gotowy wzorzec: 0,59225, odrzucona, 0,54090. | — |

Dwie decyzje w ramach wybranego modelu, które warto podjąć od razu:

- **Funkcja straty:** `loss="absolute_error"`, bo warunkiem użycia jest MAE. Domyślny błąd kwadratowy optymalizuje inną wielkość.
- **Niepewność:** dwa dodatkowe modele z `loss="quantile"` (np. 0,1 i 0,9) dają przedział prognozy tym samym kodem. Zadanie KOWR ocenia jawność niepewności, więc to tani zysk. Nie jest to wymóg specyfikacji.

## 2. Co zostało sprawdzone

Wszystko poniżej uruchomione dziś na Windows 11, Python 3.12.10, w czystym środowisku wirtualnym.

- **Instalacja:** cały stos zainstalował się z samych wheeli (`--only-binary=:all:`), bez kompilacji.
- **Zgodność z sekcją 5:** dla `060910_2.0011.580/2` geometria z ULDK, wyszukanie scen i odczyt okien dały 04.06.2025 `11/11`, NDMI 0,59225; 19.06.2025 `0/11`, odrzucona; 21.06.2025 `11/11`, NDMI 0,54090.
- **Skala i offset:** `raster:bands` zwraca `scale 0.0001`, `offset -0.1`, `nodata 0`. Wartości bierzemy z metadanych sceny, nie wpisujemy na stałe.
- **Gęstość scen:** 1–21.06.2025 to 13 scen dla tej działki, z czego 6 przeszło próg pokrycia.

Sprawdzone wersje: `rasterio` 1.5.2 (GDAL 3.12), `pystac-client` 0.9.1, `geopandas` 1.2.0, `pyogrio` 0.13.0, `shapely` 2.2.0, `pyproj` 3.8.0, `pandas` 3.1.1, `pyarrow` 26.0.1, `scikit-learn` 1.9.1, `numpy` 2.5.5, `httpx` 0.28.1, `joblib` 1.6.0, `matplotlib` 3.11.2, `pytest` 9.2.0.

Nie sprawdzałem: eksportu GSA, SoilGrids, NMT ani samego treningu (nie ma jeszcze zbioru). Archiwum Open-Meteo nie dało się dziś sprawdzić, bo odpowiada błędem 429 (sekcja 6, punkt 1).

## 3. Koszt pobierania i co z niego wynika

Zmierzone na łączu z hackathonu, dane leżą w AWS `us-west-2`:

| Odczyt | Czas | Przyczyna |
|---|---|---|
| Okno SCL (otwarcie pliku + odczyt) | 0,7–1 s | blok 512×512 po kompresji ma kilka–kilkadziesiąt kB |
| Okno B8A albo B11 | 2–4 s | jeden blok 512×512 to ok. 0,5 MB, a pobiera się cały blok, nawet dla 11 pikseli |
| Pasma, 1 wątek | 0,26 pliku/s | |
| Pasma, 8 wątków | 2,45 pliku/s | skaluje się prawie liniowo, ogranicza nas połączenie, nie procesor |

Szacunek dla pilotażu (kampania marzec–październik, ok. 150 scen na pole w strefie nakładania orbit, mniej poza nią; ok. 45% przechodzi próg): 300 pól rozrzuconych po kraju to ok. 42 000 odczytów pasm, czyli ok. 21 GB i ok. 5 godzin przy 8 wątkach. Te same pola skupione w kilku obszarach po 10–20 km to rząd 3 000 odczytów i 20–40 minut, bo sąsiednie pola dzielą ten sam blok.

Wnioski dla implementacji:

1. **Najpierw SCL, pasma tylko dla scen, które przeszły próg.** Odcina to ponad połowę ciężkich odczytów.
2. **Pętla po scenach, nie po polach.** Plik otwieramy raz i czytamy okna wszystkich pól z danego kafla. Cache bloków GDAL sprawia, że kolejne pola z tego samego bloku nic nie kosztują.
3. **Pola pilotażu dobieramy w zwartych skupiskach.** Specyfikacja i tak zakłada kilka rozdzielonych obszarów, a to jednocześnie daje naturalne `spatial_group`.
4. **`ThreadPoolExecutor` z 16–32 wątkami**, każdy z własnym `rasterio.Env`. Ustawienia: `GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR`, `CPL_VSIL_CURL_ALLOWED_EXTENSIONS=.tif`, `GDAL_HTTP_MAX_RETRY=3`.
5. **Tabela obserwacji zapisywana przyrostowo** z kluczem (`field_id`, `scene_id`). Zmiana progu albo okna nie wymaga wtedy ponownego pobierania.

Dla predykcji w aplikacji (jedno pole): wyszukanie scen ok. 2,5 s, SCL dla scen z 14 dni równolegle 1–3 s, dwa pasma jednej sceny 2–4 s. Razem ok. 6–10 s z budżetu 30 s na tym łączu, więc backend powinien cache'ować obserwacje per pole i scena.

## 4. Układ repo

Plan sprzed implementacji. Obecny układ (`runtime/`, `pipeline/`, `experiments/`, `models/`) opisuje `kowr_ml/__init__.py`.

```
kowr_ml/
  fields.py        # ULDK, GSA -> fields.parquet
  sentinel.py      # STAC + okna COG -> s2_observations.parquet
  weather.py       # Open-Meteo -> weather_daily.parquet
  dataset.py       # etykiety, cechy, spatial_group, podział -> training.parquet
  train.py         # HGB + baseline'y -> runs/<id>/
  predict.py       # predict(field_geometry, issue_date), używane przez backend
tests/test_580_2.py
```

`sentinel.py`, `weather.py` i funkcje cech z `dataset.py` są wspólne dla treningu i predykcji. To jedyne miejsce, gdzie powstają cechy.

## 5. Licencje

Wymagane w README zadania i przy przeniesieniu praw na KOWR. To jest lista do decyzji; pozycje trafiają do wykazu w README razem z kodem, który ich używa. Kolumna „Skąd” mówi, co zostało dziś odczytane ze źródła, a co jeszcze nie.

| Składnik | Licencja | Skąd |
|---|---|---|
| `rasterio`, `geopandas`, `shapely`, `pandas`, `scikit-learn`, `numpy`, `scipy`, `httpx`, `joblib` | BSD-3-Clause (`numpy` dodatkowo 0BSD, MIT, Zlib, CC0 dla części dołączonych) | metadane zainstalowanych pakietów |
| `pystac-client`, `pystac`, `pyarrow` | Apache-2.0 | metadane pakietów |
| `pyogrio`, `pyproj`, `pytest` | MIT | metadane pakietów |
| `matplotlib` | licencja Matplotlib (klasyfikowana jako PSF) | metadane pakietu |
| Sentinel-2 L2A (`sentinel-2-c1-l2a`) | Sentinel Data Legal Notice (ESA); kolekcja deklaruje zakres od 27.06.2015 | metadane kolekcji w Earth Search |
| Open-Meteo | dane CC BY 4.0; bezpłatne API wyłącznie niekomercyjnie, poniżej 10 000 zapytań dziennie, 5 000 na godzinę i 600 na minutę, limit liczony per adres IP | regulamin na open-meteo.com/en/terms |
| GDAL, GEOS, PROJ (wbudowane w wheele) | niepotwierdzona | do sprawdzenia przed wpisaniem do README |
| Earth Search (Element 84), warunki samego API | niepotwierdzone | do sprawdzenia |
| SoilGrids (etap 2) | niepotwierdzona, strony ISRIC nie zwróciły dziś treści licencji | do sprawdzenia |
| ULDK, NMT (GUGiK) | niepotwierdzona | do sprawdzenia |
| GSA (ARiMR) | niepotwierdzona | do sprawdzenia razem z eksportem |

W etapie 2 do powierzchni zasilającej nie bierzcie `pysheds`: PyPI podaje GPLv3+, co kłóci się z przeniesieniem praw. `whitebox` (WhiteboxTools) jest według PyPI na licencji MIT.

## 6. Ryzyka i pytania otwarte

1. **Limit Open-Meteo jest dziś wyczerpany z sieci hackathonu.** `archive-api.open-meteo.com` odpowiada `429 Daily API request limit exceeded. Please try again tomorrow`. Limit jest liczony per adres IP, więc najpewniej zużyły go wszystkie zespoły na wspólnym łączu (tego nie potwierdziłem). Skutki: pogodę do treningu trzeba pobrać z innej sieci (hotspot, serwer) i od razu zapisać na dysku, a aplikacja pokazywana jury nie może odpytywać Open-Meteo z sieci sali. `api.open-meteo.com` (prognoza z `past_days`) w tym samym czasie odpowiadało poprawnie.
2. **Pogoda z dni tuż przed `t` przy predykcji na żywo.** Okna cech kończą się na `t-1`. Z pamięci: ERA5 trafia do archiwum Open-Meteo z kilkudniowym opóźnieniem, więc dla „dziś” brakowałoby ostatnich dni. Nie udało się tego dziś sprawdzić przez błąd 429. Jeśli się potwierdzi, są dwie drogi: trenować na Historical Forecast API, bo te same modele są dostępne na żywo w Forecast API przez `past_days`, albo zostać przy ERA5 w treningu i użyć innego źródła na żywo, z jawnie opisaną różnicą. Do decyzji autora specyfikacji. Dla dat historycznych problemu nie ma.
3. **Doba w pogodzie.** Zapytania do Open-Meteo z `timezone=Europe/Warsaw` i jawnym `models=...`, żeby sumy dobowe odpowiadały definicji dnia `t` i żeby źródło było jedno.
4. **Earth Search to jedyne źródło rastrów.** Awaria w trakcie oceny zatrzymuje predykcję. Zapasem może być Planetary Computer albo CDSE, ale wymagają osobnego sprawdzenia nazw assetów, skalowania i licencji oraz ponownego przejścia testu 580/2.
5. **Open-Meteo w wersji produkcyjnej.** Bezpłatne API jest wyłącznie niekomercyjne, więc README musi podać koszt planu płatnego albo darmową alternatywę.
6. **Eksport GSA.** Format i zakres lat niepotwierdzone. Do czasu potwierdzenia potok da się rozwijać na geometriach z ULDK.
