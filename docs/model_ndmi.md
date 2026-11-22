# Model prognozy zmiany NDMI: komplet informacji

Stan na 22.11.2026. Dokument zbiera wszystko o modelu ML w aplikacji: co robi, na czym go uczono, jak wypada,
co sprawdzono po drodze, czego nie wdrożono i jak to odtworzyć. Skrót jest w [README](../README.md) (sekcja
„Model ML”), kontrakt pola w raporcie w [kontrakt_api.md](kontrakt_api.md), założenia w
[specyfikacji](ml/specyfikacja_treningu.md).

## 1. W skrócie

- Model prognozuje zmianę wskaźnika NDMI pola między ostatnim czystym zdjęciem Sentinel-2 a zdjęciem z dni
  +7…+14 od daty analizy. Jest dodatkiem do bilansu wodnego: raport powstaje także bez niego.
- W aplikacji działa model `kowr_ml/models/ndmi/20261122_0005_e1c565` (gradient boosting ze scikit-learn, 47 cech,
  plik 3,7 MB), przypięty w `kowr_ml/models/CURRENT.json`. Poprzedni model `20261121_2014_0502bf` jest w historii gita.
- Uczony na 682 428 wierszach z 15 782 pól w 161 obszarach całej Polski, sezony 2017–2026.
- Średni błąd bezwzględny (MAE) dla nowych obszarów: **0,0541** wobec 0,0929 dla prognozy „bez zmiany”.
  Osobno, na 141 obszarach niewidzianych przez poprzedni model, MAE spadł z 0,0652 do 0,0543.
  Nominalny przedział 80% objął 80,0% obserwacji w walidacji przestrzennej.
- Naprawiono także podwójne odejmowanie offsetu reflektancji w starszej kolekcji Sentinel-2.
  Błąd dotyczył głównie sezonu 2022; w sprawdzanych scenach zawyżał NDMI i często uniemożliwiał obliczenie NDVI.

## 2. Co model robi i gdzie jest w raporcie

- Pytanie: w jakim kierunku i o ile zmieni się wskaźnik NDMI pola. NDMI jest wskaźnikiem satelitarnym związanym
  m.in. z zawartością wody w roślinności, a nie bezpośrednim pomiarem utraty wody ani diagnozą suszy.
- Wielkość prognozowana: `ndmi_future − ndmi_last`, gdzie `ndmi_last` to ostatnia zaakceptowana scena
  z dni t−14…t−1, a `ndmi_future` pierwsza zaakceptowana scena z dni t+7…t+14 (t = data analizy).
- Wynik: mediana i przedział 10–90%, pole `satellite.ndmi_forecast` raportu. Raport pisze „prawdopodobnie
  spadnie” przy prognozie ≤ −0,03, „prawdopodobnie wzrośnie” przy ≥ +0,03, a pomiędzy „może zmienić się
  w obie strony”.
- Prognozy nie ma (raport podaje powód): poza okresem 01.04–15.10, bez czystego zdjęcia z 14 dni przed datą,
  przy brakach w pogodzie z 30 dni.
- Z prognozy nie wylicza się wilgotności gleby ani dawki nawodnienia.

## 3. Dane treningowe

| Element | Wartość |
|---|---|
| Pola | 15 782 kwadraty 80 × 80 m na gruntach ornych (ESA WorldCover 2021, klasa 40, co najmniej 95% pikseli) |
| Obszary (skupiska 6 × 6 km) | 161: 20 z pierwszego modelu, 26 dodatkowych w regionach rolniczych, 115 w regularnej siatce co ok. 50 km |
| Sezony | 2017–2026 (2016 nie ma scen L2A w Earth Search; 2017 jest niepełny) |
| Sceny | Sentinel-2 L2A z Earth Search, kolekcje `sentinel-2-c1-l2a` i `sentinel-2-l2a`, łączone jak w aplikacji |
| Pogoda | Open-Meteo Historical Weather API, jedna komórka na obszar, zmienne dzienne jak w aplikacji |
| Dni prognozy | co tydzień od 1 kwietnia do 15 października |
| Wiersze | 682 428 |

Wiersze według sezonu: 2017: 4 414, 2018: 60 409, 2019: 55 714, 2020: 62 991, 2021: 49 113, 2022: 51 572,
2023: 57 959, 2024: 56 531, 2025: 142 511, 2026: 141 214.

Skąd przewaga dwóch ostatnich sezonów: 93 punkty siatki mają pogodę tylko od października 2024 r., bo dzienny
limit Open-Meteo skończył się w dniu treningu. Zapytanie o 10 lat danych dziennych liczy się tam jak ok. 260
wywołań, a darmowy limit to 10 000 na dobę, czyli ok. 38 lokalizacji dziennie z jednego adresu IP.

Z 4 515 532 par (pole, tydzień) odpadło 3 332 916 bez czystego zdjęcia z 14 dni albo bez pogody i 500 188
bez zdjęcia w oknie docelowym. Na polach z pełną pogodą prognozę da się wydać dla 44–51% par pole–tydzień.

Jedno skupisko („niedrzwica”) leży wokół działki demonstracyjnej 580/2, więc wynik dla tej działki nie jest
testem niezależnym. Główne metryki w sekcji 6 pochodzą z prognoz dla obszarów spoza dopasowania; przykłady
w sekcji 7 pochodzą z modelu wdrożonego i służą sprawdzeniu działania raportu.

## 4. Cechy (47)

Wszystkie pochodzą sprzed daty analizy i z danych, które raport i tak pobiera. Kod jest wspólny dla treningu
i aplikacji (`kowr_ml/runtime/features.py`).

| Grupa | Cechy | Skąd w aplikacji |
|---|---|---|
| Pierwszy model (16) | ostatnie NDMI, jego wiek i pokrycie pola, trend z poprzedniego zdjęcia, dzień roku (sin, cos), opad i ET0 z 7, 14 i 30 dni, klimatyczny bilans wodny z 30 dni, średnia Tmax z 7 dni, wyczerpanie referencyjnego bilansu FAO-56 (TAW 100 mm, Kc = 1), dni od opadu ≥ 5 mm | zdjęcia i pogoda |
| Ciepło (7) | sumy temperatur efektywnych powyżej 5 °C od 1 stycznia, od 1 marca i z 30 dni, suma temperatur powyżej 0 °C od 1 stycznia, średnia temperatura z 7 i 30 dni, najniższa Tmin z 7 dni | pogoda |
| Historia zdjęć z 45 dni (8) | NDMI poprzedniego zdjęcia, trend z jeszcze wcześniejszego zdjęcia, różnica trendów, liczba scen i czystych scen, dni od ostatniej sceny, udział roślinności na ostatniej scenie i średnio z 14 dni | NDMI trzech wybranych scen, klasy SCL wszystkich scen |
| Pogoda wokół zdjęcia (3) | opad w dniu zdjęcia bazowego i dzień wcześniej, opad i ET0 od zdjęcia do dnia analizy | pogoda |
| Goła gleba i chmury (5) | udział gołej gleby na zdjęciu bazowym, na ostatniej scenie i największy z 45 dni, udział chmur na zdjęciu bazowym i średnio z 45 dni | klasy SCL |
| Zieloność (3) | NDVI zdjęcia bazowego i poprzedniego, trend NDVI | NDVI trzech wybranych scen |
| Pasma (3) | mediany reflektancji B8A, B11 i B04 zdjęcia bazowego | dodane do obserwacji w `app/sources/sentinel.py` |
| Położenie (2) | szerokość i długość geograficzna środka działki | granica działki |

Aplikacja liczy NDMI tylko dla trzech czystych scen z 45 dni (bazowa i dwie starsze, każda o co najmniej 7 dni).
Trening zna wskaźniki wszystkich scen, ale wybiera je tą samą regułą. Test
`tests/test_ml_features.py::test_app_observations_give_the_same_features_as_training` sprawdza, że obie drogi
dają te same wartości.

Model nie zna gleby ani uprawy, bo w danych treningowych ich nie ma.

## 5. Model i sposób oceny

- Algorytm: `HistGradientBoostingRegressor` (scikit-learn 1.9.1), trzy modele: mediana (strata bezwzględna)
  oraz kwantyle 0,1 i 0,9.
- Hiperparametry: learning rate 0,1, 700 iteracji, 31 liści, co najmniej 50 próbek w liściu, regularyzacja L2 = 1.
- Przedział 80%: regresja kwantylowa z poprawką conformalized quantile regression (Romano i in. 2019) liczoną
  osobno dla obu granic: dolna o 0,0074 niżej, górna o 0,0104 wyżej.
- Ocena zawsze na polach z obszarów, których dane dopasowanie nie widziało:
  - **nowe miejsce**: 5 podziałów po obszarze, wszystkie sezony w treningu. To sytuacja raportu dla dat
    z lat 2017–2026: działka jest nowa, ale sezon model zna z innych miejsc.
  - **nowe miejsce i nieznany sezon**: sezon odłożony w całości, 3 podziały po obszarze. Trening może
    obejmować lata późniejsze od ocenianego sezonu, więc nie jest to test prognozowania wyłącznie w przód.
- Punkty odniesienia: prognoza „bez zmiany”, model sezonowy (dzień roku + ostatnie NDMI, ten sam algorytm),
  16 cech pierwszego modelu na tych samych podziałach, poprzedni plik modelu.
- Model do aplikacji jest dopasowany na wszystkich danych z tymi samymi ustawieniami.

## 6. Wyniki

MAE zmiany NDMI, mniej = lepiej. Pełne liczby: `kowr_ml/models/ndmi/20261122_0005_e1c565/metrics.json`.

### 6.1. Główne testy

| Test | Wiersze | „Bez zmiany” | Model sezonowy | 16 cech | **Model** |
|---|---:|---:|---:|---:|---:|
| Nowe miejsce | 682 428 | 0,0929 | 0,0712 | 0,0599 | **0,0541** |
| Nowe miejsce i nieznany sezon | 682 428 | 0,0929 | 0,0748 | 0,0668 | **0,0597** |

### 6.2. Wycinki testu „nowe miejsce”

| Wycinek | Wiersze | „Bez zmiany” | Model sezonowy | 16 cech | **Model** |
|---|---:|---:|---:|---:|---:|
| Susza: wyczerpanie bilansu referencyjnego ≥ 75% | 202 311 | 0,0918 | 0,0735 | 0,0617 | **0,0561** |
| Głęboka susza: bilans z 30 dni ≤ −100 mm | 32 089 | 0,0976 | 0,0792 | 0,0664 | **0,0606** |
| Duże spadki NDMI (≤ −0,05) | 184 204 | 0,1300 | 0,0962 | 0,0804 | **0,0714** |

### 6.3. Według sezonu

| Sezon | „Bez zmiany” | Model sezonowy | 16 cech | **Model, nowe miejsce** | Model, sezon nieznany | Pokrycie przedziału |
|---|---:|---:|---:|---:|---:|---:|
| 2017 | 0,098 | 0,089 | 0,087 | **0,075** | 0,078 | 78% |
| 2018 | 0,098 | 0,079 | 0,064 | **0,058** | 0,065 | 79% |
| 2019 | 0,093 | 0,069 | 0,058 | **0,054** | 0,060 | 80% |
| 2020 | 0,090 | 0,068 | 0,056 | **0,050** | 0,055 | 80% |
| 2021 | 0,101 | 0,073 | 0,061 | **0,055** | 0,060 | 79% |
| 2022 | 0,098 | 0,073 | 0,063 | **0,056** | 0,059 | 79% |
| 2023 | 0,089 | 0,064 | 0,055 | **0,051** | 0,055 | 81% |
| 2024 | 0,086 | 0,073 | 0,061 | **0,056** | 0,060 | 79% |
| 2025 | 0,093 | 0,069 | 0,059 | **0,053** | 0,059 | 81% |
| 2026 | 0,092 | 0,073 | 0,061 | **0,054** | 0,062 | 80% |

### 6.4. Według miesiąca (nowe miejsce)

| Miesiąc | IV | V | VI | VII | VIII | IX | X |
|---|---:|---:|---:|---:|---:|---:|---:|
| „Bez zmiany” | 0,102 | 0,081 | 0,100 | 0,104 | 0,071 | 0,087 | 0,099 |
| **Model** | 0,041 | 0,051 | 0,059 | 0,063 | 0,054 | 0,059 | 0,058 |

### 6.5. Wobec poprzedniego modelu

Na 497 144 wierszach ze 141 obszarów, których poprzedni model (`20261121_2014_0502bf`: 16 cech, 20 obszarów,
sezony 2019–2021 i 2023–2025) nie widział; nowy model oceniany prognozami spoza podziału.

| | Poprzedni | **Nowy** | Zmiana |
|---|---:|---:|---:|
| Łącznie | 0,0652 | **0,0543** | −17% |
| Sezon 2018 | 0,0712 | **0,0572** | −20% |
| Sezon 2022 | 0,0682 | **0,0562** | −18% |
| Sezon 2026 | 0,0720 | **0,0549** | −24% |
| Duże spadki (≤ −0,05) | 0,0925 | **0,0726** | −22% |
| Susza | 0,0678 | **0,0564** | −17% |
| Średnie zawyżenie prognozy | +0,0129 | +0,0035 | |

### 6.6. Przedział i komunikaty

- Przedział 80% (poprawka wyznaczana bez ocenianego podziału): pokrycie 80,0%, poniżej dolnej granicy 10,0%,
  powyżej górnej 10,0%, średnia szerokość 0,174, w suszy 79,5%. Przed poprawką pokrycie wynosiło 74,4%.
- „Prawdopodobnie spadnie” (32% prognoz) sprawdza się w 74% przypadków; „prawdopodobnie wzrośnie” (43%) w 82%.
- Model wykrywa 71% faktycznych spadków o co najmniej 0,03.
- Kierunek zmiany większej niż 0,05 trafia w 91%.
- Gdy model nie wskazuje kierunku (25% prognoz), NDMI zmienia się o mniej niż 0,03 tylko w 40% przypadków.
- Spadki większe niż 0,15 (8% wierszy): błąd 0,116, w przedziale mieści się 50%. Model takie spadki zaniża.

### 6.7. Krótkookresowa zmienność NDMI

Średnia bezwzględna różnica NDMI między dwoma czystymi zdjęciami tego samego pola wyniosła 0,026 przy odstępie
1 dnia i 0,039 przy odstępie 2–3 dni (768 028 par zdjęć z 60 obszarów). Te wartości obejmują zarówno zmienność
pomiaru, jak i rzeczywiste zmiany pola; nie wyznaczają dolnej granicy błędu prognozy.

## 7. Sprawdzenie w aplikacji na prawdziwych działkach

22.11.2026, pełny raport dla 4 lokalizacji (działka 580/2, punkty na Żuławach, na Podkarpaciu i koło Poznania)
i 9 dat z lat 2018–2026.

- Prognoza powstała w 20 z 36 przypadków. W pozostałych raport podał powód: brak czystego zdjęcia z 14 dni,
  a punkt koło Poznania nie ma pikseli roślinności w żadnej dacie (nie sprawdzono dlaczego).
- Z 11 prognoz, które dało się porównać z późniejszym zdjęciem, 8 zmieściło się w przedziale.
- Na samej działce 580/2 trafiła 1 z 4: spadek o 0,24 w lipcu 2022 r. model przewidział jako −0,19 (dolna
  granica −0,23), spadku o 0,21 w czerwcu 2023 r. nie przewidział (prognoza −0,06), w maju 2026 r. przewidział
  wzrost o 0,09 przy faktycznej zmianie 0,00.

## 8. Niezależna walidacja pierwszego modelu

Zanim powstał nowy model, pierwszy sprawdzono na danych pobranych od zera: 375 689 wierszy z 15 726 pól
(26 nowych obszarów z sezonów 2018–2026, siatka całej Polski z 2025 i 2026, pola treningowe w sezonie 2026).

| Zbiór | Wiersze | „Bez zmiany” | Model sezonowy | Pierwszy model | Pokrycie 80% |
|---|---:|---:|---:|---:|---:|
| Nowe obszary, sezony 2019–2025 | 134 103 | 0,093 | 0,070 | 0,060 | 79% |
| Siatka całej Polski, 2025 | 93 161 | 0,092 | 0,071 | 0,063 | 80% |
| Pola treningowe, sezon 2026 | 22 669 | 0,090 | 0,074 | 0,066 | 77% |
| Nowe obszary, sezon 2026 | 25 801 | 0,094 | 0,071 | 0,069 | 74% |
| Siatka całej Polski, 2026 | 92 989 | 0,092 | 0,078 | 0,073 | 73% |
| Nowe obszary, 2018 | 6 966 | 0,102 | 0,088 | 0,085 | 71% |
| Razem | 375 689 | 0,093 | 0,073 | 0,065 | 77% |

Wnioski, które ukierunkowały nowy model: liczby z README potwierdziły się dla znanych sezonów, ale w nieznanym
sezonie (2026, 2018) model był wyraźnie słabszy; przedział był za wąski od dołu; pogoda wnosiła ok. 10%
trafności, a opad i bilans prawie nic; komunikat „nie zmieni się wyraźnie” sprawdzał się w 34% przypadków.
Lat 2017, 2018 i 2022 w treningu nie było, bo używano tylko nowszej kolekcji Sentinel-2.

## 9. Eksperymenty: co pomogło, a co nie

Zapisano wyniki 91 przebiegów na różnych wersjach danych. Tabela pokazuje wybrane porównania z wersji z 10
sezonami: zmianę MAE wobec zestawu 16 cech na tych samych podziałach (682 tys. wierszy; trening jednego
modelu ograniczony do 300 tys. wierszy, o ile nie zaznaczono inaczej).

| Konfiguracja | Cech | Nowe miejsce | Nowe miejsce i sezon |
|---|---:|---:|---:|
| 16 cech pierwszego modelu | 16 | 0,0615 | 0,0674 |
| + ciepło + historia zdjęć | 31 | −4,1% | −4,3% |
| … + goła gleba i chmury | 36 | −5,5% | −6,0% |
| … + NDVI | 34 | −6,0% | −6,1% |
| ciepło + historia + pogoda wokół zdjęcia + gleba i chmury + NDVI | 42 | −7,9% | −8,2% |
| … + mediany pasm | 45 | −9,1% | −9,3% |
| … + położenie (**zestaw wdrożony**) | 47 | −9,3% | −9,7% |
| … + dłuższe okna opadu i bilansu (60 i 90 dni, od początku roku) | 59 | −9,2% | −9,6% |
| … + maksimum NDMI i NDVI z sezonu | 67 | −10,6% | −10,7% |
| … + pogoda z okna prognozy (idealna prognoza) | 64 | −10,7% | −12,8% |

Wyjmowanie po jednej grupie z zestawu 42 cech (−7,9% / −8,2%): bez ciepła −6,4% / −5,4%, bez NDVI
−6,0% / −6,4%, bez gołej gleby i chmur −6,5% / −6,6%, bez historii zdjęć −6,6% / −7,2%, bez pogody wokół
zdjęcia −7,4% / −7,6%.

Co nie pomogło albo pomogło za mało, żeby to wdrażać:

- dłuższe okna opadu i bilansu: bez zmiany;
- większa waga wierszy z suszy (×2, głęboka susza ×3): −7,5% / −8,1% wobec −7,9% / −8,2% bez wag, w samej
  suszy bez zmiany;
- wyrównanie wag sezonów: gorzej w znanym sezonie, bez zmiany w nieznanym;
- więcej wierszy przy tych samych cechach (pełne 682 tys. zamiast 300 tys.): bez zmiany;
- więcej sezonów w treningu przy prognozie dla 2026: 6 sezonów 0,0688, 9 sezonów 0,0682;
- uśrednianie 3 ziaren: −0,3%;
- większy model (63 liście albo 1500 iteracji): ok. 0,8 punktu procentowego przy dwukrotnie większym pliku;
- losowe strojenie hiperparametrów: ok. 0,6 punktu.

Więcej iteracji pomaga w znanym sezonie (ok. 1,5–2 punkty), a w nieznanym nie zmienia nic; wdrożone
ustawienie (learning rate 0,1, 700 iteracji) odpowiada ok. 1400 iteracjom przy 0,05.

## 10. Błąd offsetu reflektancji w kolekcji `sentinel-2-l2a`

- Objaw: dla dat z 2022 r. aplikacja pokazywała NDMI zawyżone o ok. 0,2 i zwykle puste NDVI.
- Przyczyna: w starszej kolekcji `sentinel-2-l2a` sceny z bazą przetwarzania od 04.00 mają przesunięcie
  1000 DN już odjęte w pikselach, a `raster:bands` nadal podaje offset −0,1. Aplikacja odejmowała je drugi raz.
- Flaga `earthsearch:boa_offset_applied` tego nie rozstrzyga: z 1570 scen z 2022 r. nad 70 obszarami 92 miały
  `false`, a ich piksele też były po korekcie (wpisy katalogu utworzone 3.11.2022).
- Reguła po poprawce: dla kolekcji `sentinel-2-l2a` offset = 0 zawsze; dla `sentinel-2-c1-l2a` offset
  z metadanych. Ta sama reguła jest w `kowr_ml/pipeline/ndmi/s2.py` (nazwa kolekcji z `app/sources/sentinel.py`).
- Dowody: ta sama scena z 3.06.2023 w obu kolekcjach (B8A 5108 i 4108 DN), dwa kafle jednego przelotu
  z 10.05.2022 (B11 1911 DN z flagą `false`, 1908 DN z flagą `true`).
- Skutek: działka 580/2, 10.07.2022: NDMI 0,88, 0,86, 0,67 bez NDVI → 0,63, 0,58, 0,49 z NDVI 0,85, 0,79, 0,71.
  W danych treningowych 2022: wiersze bez NDVI 4,5% → 0%, NDMI powyżej 0,8: 1157 → 4.
- Zakres: głównie sezon 2022, bo nowsza kolekcja ma dla niego po 2 sceny na obszar. Lata 2017–2021 są
  poprawne (sprawdzone na 2324 scenach).
- Kod i testy: `app/sources/sentinel.py`, `tests/test_sentinel_offset.py`, `scripts/checks/check_sentinel_offset.py`.
  Klucze pamięci podręcznej zdjęć dostały nową wersję, więc stare wpisy nie wracają do raportu.

## 11. Czego nie wdrożono

- **Sieć GRU** (PyTorch, przebieg pogody z 60 dni i te same 47 cech, zespół 5 sieci, `kowr_ml/experiments/train_gru.py`).
  Na podziale pierwszego modelu: 0,0512 na 4 odłożonych obszarach (model drzewiasty 0,0545) i 0,0559
  na odłożonych obszarach w sezonie 2025 (0,0583), czyli o 4–6% lepiej. To jeden podział; porównania
  w 5 podziałach nie dokończono. Wariant 120-dniowy przekroczył pamięć GPU podczas oceny; próbę porównania
  z oceną w partiach przerwano po wyborze modelu drzewiastego. Wdrożenie GRU wymagałoby PyTorcha w aplikacji.
- **Model prawdopodobieństwa spadku** (klasyfikator „NDMI spadnie o co najmniej 0,05”): AUC 0,889 na nowych
  miejscach wobec 0,860–0,867 z obecnej prognozy. Przy progu 0,7 trafia w 85% i wykrywa 36% spadków,
  przy 0,5 trafia w 73% i wykrywa 60%. Wymaga zmian w raporcie i interfejsie.
- **Maksimum NDMI z sezonu**: ok. 1 punkt procentowy, ale wymaga wskaźników ze wszystkich scen sezonu,
  czyli wielokrotnie dłuższego pobierania w raporcie.
- **Prognoza pogody na okno 7–14 dni**: górna granica zysku to 1–3 punkty (z danych archiwalnych);
  prawdziwa prognoza da mniej, a dla dat historycznych trzeba by użyć archiwum prognoz.
- **Trening na większym zbiorze** po dociągnięciu pogody dla kolejnych punktów siatki: nie uruchomiono.

## 12. Ograniczenia

- Model prognozuje wskaźnik satelitarny, nie wilgotność gleby. Nie zna gleby ani uprawy.
- Pola treningowe to fragmenty gruntów ornych z WorldCover 2021, a nie granice deklarowanych upraw.
- Duże spadki NDMI (zbiór, gwałtowne dojrzewanie) są zaniżane.
- Pogoda w treningu pochodzi z Open-Meteo, jedna komórka na obszar. Gdy raport dostaje pogodę z NASA POWER,
  ostrzega o mniejszej pewności.
- Zbiór nadreprezentuje okresy z dobrą widocznością pola oraz sezony 2025–2026.
- Te same protokoły walidacji służyły do wyboru cech. Metryki nie pochodzą z końcowego, nietkniętego zbioru
  testowego ani z danych jury. Pokrycie przedziału zmierzone dla nowych miejsc nie gwarantuje takiego samego
  pokrycia na konkretnej działce ani w kolejnym sezonie.
- Gdy czyste zdjęcie pochodzi z samego dnia analizy, model go nie używa (bierze dane do dnia poprzedniego),
  a aplikacja ma wtedy wskaźniki dla starszego zdjęcia bazowego niż w treningu.
- Nie porównano NDMI liczonego w granicy prawdziwej działki z NDMI kwadratów 80 m z treningu.
- Trafności według uprawy nie da się policzyć, bo dane nie mają etykiet upraw.

## 13. Odtworzenie

Katalog danych: `KOWR_ML_DATA` (domyślnie `kowr_ml/data`, poza gitem), wyniki: `KOWR_ML_RUNS` (domyślnie `kowr_ml/runs`).
Do treningu potrzebne są dodatkowe pakiety z `requirements-ml.txt` (`pandas`, `pyarrow`; aplikacja ich nie używa).

```sh
pip install -r requirements-ml.txt
python -m kowr_ml.pipeline.ndmi.fields       # pola z WorldCover -> fields.parquet
python -m kowr_ml.pipeline.ndmi.s2 12        # sceny, 12 procesów -> obs/<obszar>_<rok>.parquet
python -m kowr_ml.pipeline.ndmi.weather      # pogoda -> weather_raw/, weather.parquet (ogranicza limit Open-Meteo)
python -m kowr_ml.pipeline.ndmi.dataset 12   # tabela -> training.parquet, dataset_stats.json
python -m kowr_ml.pipeline.ndmi.train        # ocena i model -> runs/<data>_<hash>/
python -m kowr_ml.experiments.train_gru      # porównawcza sieć GRU (PyTorch) -> metrics_gru.json
```

Nowy przebieg trafia do aplikacji dopiero po skopiowaniu katalogu z `runs/` do `kowr_ml/models/ndmi/`
i wpisaniu go w `kowr_ml/models/CURRENT.json`.

Czasy na serwerze z 31 rdzeniami: sceny 43 minuty (1610 zadań obszar × sezon), tabela 1 minuta, trening
z oceną 33 minuty, samo dopasowanie końcowego modelu 2 minuty. Sieć GRU: 13 minut na RTX 3090.

Porównanie z poprzednim modelem włącza zmienna `KOWR_ML_PREVIOUS_MODEL` (katalog poprzedniego modelu).
Aplikacja bierze przebieg przypięty w `kowr_ml/models/CURRENT.json`; `KOWR_ML_MODEL_DIR` pozwala wskazać inny.

Uwaga do pogody: wdrożony model powstał z serii o różnej długości (45 obszarów od 10.2016, 26 od 10.2017,
93 od 10.2024). Pełne `kowr_ml.pipeline.ndmi.weather` pobierze dla wszystkich serię od 10.2016, więc odtworzona tabela
może być większa niż użyta. Kroki odtwarzają potok, ale ponowne pobranie danych nie gwarantuje identycznej
wersji tabeli ani modelu.

## 14. Gdzie co leży

W repozytorium:

| Ścieżka | Zawartość |
|---|---|
| `kowr_ml/models/ndmi/20261122_0005_e1c565/` | model w aplikacji: `model.joblib`, `model_card.json`, `metrics.json`, `metrics_gru.json`, `dataset_stats.json` |
| `kowr_ml/models/CURRENT.json` | które przebiegi obsługują aplikację |
| `kowr_ml/runtime/config.py` | okna cech i etykiety (wspólne dla treningu i predykcji) |
| `kowr_ml/runtime/features.py` | cechy wspólne dla treningu i aplikacji |
| `kowr_ml/runtime/ndmi.py` | predykcja z obserwacji aplikacji (`NdmiForecaster`) |
| `kowr_ml/runtime/registry.py` | wybór i wczytanie przypiętego modelu |
| `kowr_ml/pipeline/config.py` | obszary, sezony, podziały oceny, źródła danych |
| `kowr_ml/pipeline/ndmi/` | potok danych i trening: `fields.py`, `s2.py`, `weather.py`, `labels.py`, `dataset.py`, `train.py` |
| `kowr_ml/experiments/train_gru.py` | porównawcza sieć GRU |
| `tests/test_ml_features.py`, `tests/test_sentinel_offset.py` | testy cech, predykcji i offsetu |
| `scripts/checks/check_sentinel_offset.py` | sprawdzenie offsetu na żywo |

Poza gitem, na komputerze, na którym prowadzono prace (`kowr_ml/data/`, ok. 400 MB):

| Ścieżka | Zawartość |
|---|---|
| `training.parquet`, `fields.parquet`, `weather.parquet`, `obs/`, `weather_raw/` | komplet danych wdrożonego modelu |
| `20261122_0005_e1c565/oof_predictions.parquet` | prognozy spoza podziału dla wszystkich wierszy |
| `gru_v2/metrics_gru.json` | wynik sieci GRU |
| `validation_20261121/out_final/` | walidacja pierwszego modelu (`validation.json`, prognozy) |
| `validation_20261121/experiments/` | dziennik eksperymentów (`LOG.md`), skrypty, wyniki 91 konfiguracji |

Serwer treningowy był tymczasowy; dane potrzebne do analizy wdrożonego modelu skopiowano lokalnie.
Pierwotnego zbioru treningowego pierwszego modelu nie odzyskano.

## 15. Zmiany w repozytorium

| Commit | Co zmienia |
|---|---|
| `71149b3` | offset reflektancji: flaga `boa_offset_applied`, test, skrypt sprawdzający, nowa wersja pamięci podręcznej |
| `0f0d8eb` | offset zawsze 0 dla `sentinel-2-l2a`; mediany pasm w obserwacji |
| `3eb7a43` | nowy model, potok `kowr_ml`, testy cech, komunikat bez kierunku, README i kontrakt API |
