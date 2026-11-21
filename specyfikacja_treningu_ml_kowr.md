# Specyfikacja treningu ML dla aplikacji KOWR

**Model v1 prognozuje zmianę NDMI roślinności na polu w ciągu 7–14 dni.** Etykiety powstają automatycznie z archiwum Sentinel-2. Do ich konstrukcji nie potrzeba pomiarów z sond glebowych. Wynik w aplikacji wspiera decyzję o oględzinach pola. NDMI może się zmieniać m.in. z powodu rozwoju roślin, zbioru oraz zmian uwilgotnienia roślinności. [USGS – znaczenie NDMI](https://www.usgs.gov/landsat-missions/normalized-difference-moisture-index)

## 1. Zadanie i definicja etykiety

- **Typ zadania:** regresja, jedna obserwacja na pole i dzień prognozy. Za początek dnia `t` przyjmij północ w strefie `Europe/Warsaw`. W treningu próbkuj dni co tydzień według ustalonego kalendarza.
- **Obserwacja bazowa:** najnowsze użyteczne zdjęcie z dni `t-14…t-1`. Zapisz jego datę i wiek. Jeżeli go brakuje, nie twórz prognozy tym modelem. W produkcji wymagaj, żeby scena była faktycznie dostępna w momencie prognozy. W backteście, jeśli nie masz archiwalnego czasu publikacji, opisz założenie dostępności sceny z poprzedniego dnia i sprawdź wariant z dodatkowym dniem opóźnienia.
- **Obserwacja docelowa:** pierwsze użyteczne zdjęcie w dniach `t+7…t+14`, w tej samej kampanii uprawowej i na tej samej geometrii. Jeśli go brakuje, pozostaw brak etykiety i wyklucz wiersz z uczenia. Zapisuj też liczbę odrzuconych wierszy.
- **Etykieta:** `y = ndmi_future - ndmi_last`. Przykład wyłącznie ilustracyjny: `0,31 − 0,42 = −0,11`. Jednostką wyniku jest zmiana bezwymiarowego indeksu NDMI.
- **Wyjście do aplikacji:** prognozowana zmiana, okno prognozy, wiek ostatniej obserwacji i stan pokrycia danymi. Bez danych do prognozy wyświetl powód. Nie wyliczaj dawki nawodnienia z tej predykcji.

## 2. Dane do zebrania

| Zbiór | Minimalny zakres |
|---|---|
| **Pola** | ID pola, geometria faktycznej uprawy i rok, opcjonalnie gatunek. Na start użyj danych GSA 2025 o deklarowanych uprawach. Potwierdź dostępność eksportu i zakres lat. Aktualnej deklaracji nie przenoś wstecz na lata bez informacji o uprawie. ULDK daje granicę ewidencyjną do testu technicznego. [ARiMR – GSA i LPIS](https://www.gov.pl/web/arimr/arimr-otwiera-dane-przestrzenne-ze-swoich-zasobow), [ULDK](https://uldk.gugik.gov.pl/opis.html) |
| **Zdjęcia etykiet i cech** | Sentinel-2 L2A, kolekcja `sentinel-2-c1-l2a`, wyszukiwana przez STAC `/v1/search` po geometrii w WGS84 i przedziale dat. Pobieraj wycinki GeoTIFF dla assetów `nir08`, `swir16`, `scl`. [Metadane kolekcji](https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a) |
| **Pogoda** | Dzienny opad `precipitation_sum`, temperatura `temperature_2m_max`, `et0_fao_evapotranspiration`. Na pierwszy trening użyj wyłącznie przeszłych dni i jednego ustalonego źródła, np. ERA5 przez Open-Meteo Archive. Zapisuj współrzędne zwróconej komórki. Zbieraj pogodę jednorazowo dla powtarzających się komórek. [Open-Meteo Archive](https://open-meteo.com/en/docs/historical-weather-api) |
| **Gleba, etap 2** | SoilGrids 0–30 cm. Piasek, pył, ił, węgiel organiczny i gęstość objętościowa. Zachowaj metodę agregacji i jednostki. Sprawdź, czy dodanie cech poprawia wynik na nowych polach. [ISRIC](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs.html) |
| **Ukształtowanie terenu, etap 2** | Spadek i statystyki powierzchni zasilającej z NMT, jeśli dostępne tak samo przy treningu i predykcji. Mamy przykładową analizę 580/2. Nie wyprowadzaj objętości odpływu z samej powierzchni zasilającej. [NMT GUGiK](https://www.geoportal.gov.pl/pl/dane/numeryczny-model-terenu-nmt/) |

**Zakres pilotażu:** 2025 jako pierwsza kampania i około 100–300 pól z kilku rozdzielonych obszarów. To cel próby technicznej, bez gwarancji wystarczającej liczby etykiet. Testuj dodatkowe sezony, gdy są dostępne geometrie odpowiadające uprawom w tamtych latach. Jeden sezon pozwala ocenić predykcję w obrębie tej kampanii, a nie przenoszenie modelu do kolejnych lat. Działka 580/2 służy do sprawdzenia pobierania i wycinania rastrów.

## 3. Jak wygenerować NDMI

1. Dla sceny przelicz reflektancję za pomocą metadanych assetu `raster:bands`: `rho = DN * scale + offset`. Najpierw odfiltruj NoData. Assety B8A, B11 i SCL mają siatkę 20 m. Zweryfikuj zgodność projekcji, transformacji i okna. [Metadane Earth Search](https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a), [specyfikacja rozdzielczości Sentinel-2](https://sentiwiki.copernicus.eu/web/s2-products)
2. Zostaw piksele, których środki leżą w analizowanym polu i których SCL to `4` (roślinność). Pomijaj niefinitywne wartości, ujemne reflektancje i mianownik `≤ 0,000001`. Licz udział ważnych pikseli względem wszystkich środków pikseli wewnątrz pola. Próg pilotażu: **minimum 6 pikseli i 65% pokrycia**. Rejestruj odrzucenia, zwłaszcza małych i wąskich pól. [Klasyfikacja SCL](https://sentiwiki.copernicus.eu/web/s2-processing)
3. Dla ważnych pikseli oblicz `NDMI = (rho_B8A − rho_B11) / (rho_B8A + rho_B11)`. Użyj mediany po pikselach. Zapisz ID sceny, datę, pokrycie i liczbę pikseli. Przy wielu scenach z jednego dnia wybierz tę z najlepszym pokryciem pola. Pola na granicy kafli obsłuż mozaiką albo jawnie odrzuć obserwację, gdy z jednego kafla nie ma odpowiedniego pokrycia całego pola.
4. Próg, agregacja i okno są parametrami technicznymi. Raportuj, jak ich zmiana wpływa na liczbę etykiet. Zmiana zestawu ważnych pikseli między datami może zmieniać wynik, szczególnie na wąskim polu. Zbiór będzie nadreprezentował pola i okresy z dobrą widocznością roślinności.

## 4. Kontrakt danych i trening

Zapisz jedną tabelę treningową w Parquet z poniższymi kolumnami. Zachowaj osobno listę pól i tabelę obserwacji Sentinel-2, żeby przeliczać etykiety bez ponownego pobierania rastrów.

| Rola | Kolumny |
|---|---|
| **Identyfikatory i podział** | `field_id`, `season`, `issue_date`, `spatial_group`, `weather_cell_id`. Służą do łączenia i podziału, nie przekazuj identyfikatorów do modelu. |
| **Cechy v1** | `ndmi_last`, `days_since_last_scene`, `last_valid_fraction`, `day_of_year_sin`, `day_of_year_cos`, `rain_mm_7d`, `rain_mm_14d`, `et0_mm_7d`, `et0_mm_14d`, `tmax_c_mean_7d`. Okna kończą się na dniu `t-1`. Typ uprawy dodaj, jeśli masz wiarygodną informację dla danej kampanii i możesz ją podać również przy predykcji. |
| **Etykieta i metadane** | `ndmi_future`, `ndmi_delta`, `last_scene_id`, `last_scene_date`, `target_scene_id`, `target_scene_date`, `target_valid_fraction`. Model dostaje wyłącznie cechy z poprzedniego wiersza, bez kolumn docelowych. |

- **Model:** na początek jeden `HistGradientBoostingRegressor` w Pythonie. Porównaj go z prostą prognozą **ΔNDMI = 0** oraz modelem sezonowym z dniem roku i ostatnim NDMI. Nie używaj faktycznej pogody z dni po `t`. Jeśli później dodasz prognozy pogody, w backteście potrzebujesz archiwum prognoz wydanych przed `t`.
- **Podział:** odłóż całe bloki przestrzenne na test, najlepiej tak, by sąsiednie pola i pola z tej samej komórki pogody nie rozchodziły się między zbiory. Do strojenia użyj innych bloków. Osobno sprawdź późniejszy sezon. Przy podziale według dat pomiń na granicy wiersze, których okna cech lub etykiet przecinają granicę. Pozostaw 580/2 poza treningiem, jeśli ma służyć do demonstracji na nowym polu.
- **Metryki i warunek użycia:** podaj MAE w jednostkach NDMI i pokrycie prognozą. Pokaż wynik według miesiąca, regionu i wielkości pola, szczególnie dla obserwacji z dużym spadkiem NDMI. Porównaj na tych samych rekordach i raportuj MAE uśredniony po polach obok MAE po wierszach. Model trafia do aplikacji, jeśli poprawia wynik względem utrzymania ostatniej wartości na odłożonych lokalizacjach i późniejszym okresie. Przy pojedynczym sezonie oznacz go jako eksperymentalny.
- **Oczekiwane pliki od inżyniera:** przygotowany zbiór z przypisanym podziałem, wersja modelu wraz z listą cech, raport metryk i pokrycia oraz funkcja predykcji dla pola i daty. Słownik warunków licencyjnych i wersje danych trzymaj razem z przebiegiem treningu.

## 5. Sprawdzenie dla działki 580/2

- Identyfikator: `060910_2.0011.580/2`. [Geometria i wyniki SoilGrids](soilgrids_niedrzwica_koscielna_580_2.json).
- Zweryfikowane zapytanie STAC: kolekcja `sentinel-2-c1-l2a`, bounding box `22.3553,51.0924,22.3565,51.0944`, od 1 do 21 czerwca 2025. Zapytanie z limitem 10 zwróciło 10 pozycji, w tym `S2C_T34UEB_20250612T094050_L2A` oraz `S2A_T34UEB_20250621T093144_L2A`. Zachmurzenie całej sceny nie określa widoczności konkretnego pola.
- Wycięto rastry B8A, B11 i SCL dla działki i obliczono rzeczywiste obserwacje:

| Dzień | ID sceny | Ważne piksele | Mediana NDMI |
|---|---|---:|---:|
| 04.06.2025 | `S2A_T34UEB_20250604T094120_L2A` | 11/11 | 0,59225 |
| 19.06.2025 | `S2C_T34UEB_20250619T093506_L2A` | 0/11 | odrzucona |
| 21.06.2025 | `S2A_T34UEB_20250621T093144_L2A` | 11/11 | 0,54090 |

Różnica między dwiema zaakceptowanymi scenami to **−0,05135**. To test ekstrakcji i obliczenia różnicy. Utworzenie pełnego rekordu treningowego wymaga jeszcze sprawdzenia wszystkich scen w stosunku do ustalonej daty prognozy oraz dołączenia danych pogodowych.

```bash
curl -fsS -G 'https://earth-search.aws.element84.com/v1/search' \
  --data-urlencode 'collections=sentinel-2-c1-l2a' \
  --data-urlencode 'bbox=22.3553,51.0924,22.3565,51.0944' \
  --data-urlencode 'datetime=2025-06-01T00:00:00Z/2025-06-21T23:59:59Z' \
  --data-urlencode 'limit=10'
```

**Granica zastosowania:** ta ścieżka daje trenowalny model sygnału satelitarnego. Do wyrażenia wilgotności gleby w m³/m³ potrzebujesz innych etykiet lub modelu fizycznego, a do potwierdzenia trafności dla pola potrzebujesz niezależnej referencji. Dziesięcioletnia analiza dla konkursu może przebiegać w osobnym bilansie wodnym. Pierwsza kampania ML nie zastępuje tego wymagania.
