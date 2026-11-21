# Brief: model AI do oceny sytuacji wodnej działki (KOWR, HackNation 2026)

Podstawa: *KOWR – Pełna treść zadania konkursowego* (dalej **Z**) i *KOWR – Podstawy naukowe* (dalej **PN**). Stan na 21.11.2026.

**W jednym zdaniu:** model liczy dzienny bilans wody w warstwach gleby pod konkretną uprawą na konkretnej działce przez ostatnie 10 lat aż do daty analizy. Uczenie maszynowe koryguje ten bilans obserwacjami satelitarnymi. Wynik mówi, czy jest niedobór, jak bardzo jest nietypowy na tle 10 lat, **dlaczego** występuje i jak bardzo jesteśmy tego pewni. Z tych liczb reguły układają rekomendacje.

---

## 1. Czego zadanie wymaga od modelu

| Wymóg | Skąd | Co to znaczy dla modelu |
|---|---|---|
| Ocena oparta na wskaźnikach satelitarnych, glebie i meteorologii **z 10 lat** | Z 3.2 pkt 1a | Symulacja musi biec po całym 10-letnim okresie. Satelita jest obowiązkowym wejściem, a nie dodatkiem. |
| Interpretacja satelity **zależy od rodzaju uprawy** | Z 3.2 pkt 1a | NDVI/NDMI porównujemy z typową krzywą tej uprawy w danej fazie, a nie z progiem globalnym. |
| Ocena bieżąca **i** historyczna podatność działki | Z 3.3 pkt 4; PN „Ocena sytuacji wodnej” | Dwa osobne wyjścia: stan na datę *t* oraz częstość niedoborów w latach 1–10 w poszczególnych miesiącach. |
| Wynik **liczony z pobranych danych**, nie gotowe rekomendacje | Z 3.3 pkt 4; Z 4.2 pkt 5 | Dane mogą być wcześniej pobrane, ale cała ocena i rekomendacja powstają w czasie zapytania dla działki i daty. |
| **Przyczyny** niedoboru | Z 3.3 pkt 5; PN „Identyfikacja przyczyn” | Model rozkłada deficyt na składniki: opad, parowanie i temperatura, pojemność gleby, odpływ powierzchniowy, wymagania uprawy. |
| Kolejność: ocena → przyczyny → retencja → agrotechnika → nawadnianie | Z 3.2; PN „Implikacje” | Model daje tylko ocenę i przyczyny. Rekomendacje to osobna warstwa, która z nich korzysta. |
| Niepewność, ograniczenia, **brak danych wprost** | Z 3.3 pkt 5; PN | Każde wyjście ma przedział i flagi jakości. Przy braku danych zwracamy `null` z powodem, nigdy wartość domyślną. |
| Dowolna działka w PL, **dowolna data z 10 lat** | Z 5.5; Z 6 | Żadnej kalibracji pod jedno pole. Źródła muszą pokrywać cały kraj i całe 10 lat. |
| Jury porównuje wynik z **danymi referencyjnymi** | Z 6 | Wyjście trzeba wyrazić w kategoriach, które da się porównać z oficjalnym monitoringiem (patrz sekcja 7). |
| Wynik w czasie **< 30 s** | Z 7 pkt 5 | Model musi być lekki: bilans to pętla po 3650 dniach, a ML to mały model drzewiasty. |
| Opis zakresu użycia AI w dokumentacji | Z 5.1; Z 4.2 pkt 6 | Sekcja 9 tego briefu trafia do README. |
| Zgodność z wiedzą naukową | Z 2; Z 7 pkt 2 | Rdzeniem jest FAO-56 (Allen i in.) i logika KBW z Systemu Monitoringu Suszy Rolniczej IUNG (Doroszewski i in. 2012). Obie pozycje są w bibliografii PN. |

## 2. Architektura: fizyka jako rdzeń, ML jako korekta

Model nie może być czarną skrzynką ML. Nie ma pomiarów wilgotności z działek, więc nie ma na czym uczyć modelu end-to-end. Jury ocenia też zgodność z wiedzą naukową i wyjaśnianie przyczyn. Dlatego układ jest hybrydowy:

```
               ┌──────────────────────────────────────────────────────────┐
 pogoda ──────►│ A. Bilans wodny warstw gleby (FAO-56, dziennie, 10 lat)  │
 gleba/warstwy►│    opad − odpływ − ETc(uprawa, faza) ± przepływ w dół    │──► wilgotność i zapas wody
 uprawa ──────►│    odpływ: metoda CN zależna od spadku z NMT             │    w każdej warstwie
 spływy (NMT) ►└───────────────────────────┬──────────────────────────────┘
                                           │ stan symulowany
 wilgotność     ┌──────────────────────────▼──────────────────────────────┐
 regionalna ───►│ B. Prognoza ML (HistGradientBoosting)                   │──► prognoza ΔNDMI
 satelita  ────►│    reakcja roślin na stan z A, 7–14 dni                 │    + przedział, flaga zgodności
 (NDVI/NDMI)    └──────────────────────────┬──────────────────────────────┘
                                           │
                ┌──────────────────────────▼──────────────────────────────┐
                │ C. Klimatologia działki (te same obliczenia × 10 lat)   │──► percentyl, kategoria suszy,
                │                                                         │    podatność wg miesięcy
                └──────────────────────────┬──────────────────────────────┘
                ┌──────────────────────────▼──────────────────────────────┐
                │ D. Atrybucja przyczyn (porównanie z biegiem typowym)    │──► udział czynników w deficycie
                └──────────────────────────┬──────────────────────────────┘
                                           ▼
                E. Reguły rekomendacji (poza modelem; tabela działań w outputs/podsumowanie_kowr_retencja.md)
```

- **A (fizyka)** daje wyjaśnialność i działa w każdym miejscu w Polsce bez treningu.
- **B (ML)** daje „AI” tam, gdzie ma realny sens. Prognozuje reakcję roślin (ΔNDMI) na stan wody z A i sprawdza, czy satelita zgadza się z bilansem. Nie przelicza NDMI na wilgotność gleby ani dawkę nawodnienia (zasada z AGENTS.md).
- **C** odpowiada na wymóg „historyczna podatność na podstawie 10 lat”.
- **D** odpowiada na wymóg „przyczyny”.

## 3. Wejścia

| Wejście | Źródło (bezpłatne) | Rozdzielczość | Do czego | Kategoria Z 3.3 |
|---|---|---|---|---|
| Opad, Tmax/Tmin, ET0 FAO, wiatr; 10 lat + prognoza 7–14 dni | Open-Meteo Archive (ERA5/ERA5-Land) i Forecast; IMGW jako kontrola | ~9–25 km, dziennie | A, C, D | meteorologiczne |
| Gleba w warstwach 0–5…100–200 cm: piasek, pył, ił, SOC, gęstość | ISRIC SoilGrids | 250 m | A: pojemność polowa, punkt więdnięcia, TAW z funkcji pedotransferu | glebowe |
| Kategoria podatności gleby na suszę | IUNG – mapa kategorii | gmina / kompleks | kontrola A, cecha w B, porównanie w sekcji 7 | glebowe |
| Uprawa i (opcjonalnie) data siewu | wybór rolnika | — | Kc, fazy, głębokość korzeni, próg stresu *p* (FAO-56, tab. 12 i 22) | — |
| Wilgotność gleby w okolicy, warstwy 0–7, 7–28, 28–100 cm | Open-Meteo / ERA5-Land; tło EDO (SMA, CDI) | ~9 km; EDO ~5 km | B: cecha i kotwica skali regionalnej | meteorologiczne / tło |
| **NDVI, NDMI** | Sentinel-2 L2A, Earth Search | 10–20 m, co 2–5 dni (bez chmur) | B: obserwacja stanu roślin; C: krzywa sezonowa działki | **satelitarne (obowiązkowe)** |
| Spadek, akumulacja i kierunki spływu | NMT GUGiK (WCS) | 1–5 m | A: odpływ powierzchniowy (CN zależne od spadku); strefy w obrębie działki | przestrzenne |
| Cieki, rowy, zbiorniki, odległość od działki | MPHP10k / Wody Polskie, BDOT10k | wektor | nie wchodzą do bilansu; trafiają do E jako uzasadnienie retencji krajobrazowej | hydrologiczne |
| Granica działki | ULDK | wektor | maska dla wszystkich rastrów | przestrzenne |

**Uzupełnienie Twojego diagramu:** do listy wejść trzeba dopisać **satelitę (NDVI/NDMI)**, bo zadanie wprost go wymaga w ocenie (Z 3.2 pkt 1a). Dane hydrologiczne są wymagane jako kategoria, ale do modelu wystarczy przekazać je dalej, do rekomendacji.

## 4. Wyjścia (kontrakt dla backendu i raportu)

Wszystkie wyjścia dotyczą działki i daty *t*. Każda wartość liczbowa ma `źródło`, `data_danych` i `pewność`.

| # | Wyjście | Jednostka | Sekcja raportu |
|---|---|---|---|
| 1 | Wilgotność w warstwach (0–30, 30–60, 60–100 cm) | m³/m³, przedział 10–90% | ① Ocena |
| 2 | Zapas wody dostępnej w strefie korzeniowej i niedobór do progu stresu uprawy | mm, % TAW | ① Ocena |
| 3 | **Kategoria stanu**: brak zagrożenia / zagrożenie / susza umiarkowana / silna (nazwy i progi zgodne z sekcją 7) | kategoria | ① Ocena (główny komunikat) |
| 4 | Percentyl stanu względem tej samej dekady w 10 latach | % | ① Ocena: „gorzej niż w 8 z 10 lat” |
| 5 | KBW (opad − ETP) dla okresów 60-dniowych, liczony jak w IUNG | mm | ① Ocena; porównywalność z referencją |
| 6 | Podatność historyczna: odsetek lat z niedoborem w każdym miesiącu | % na miesiąc | ① Ocena: „najwięcej ryzyka maj–lipiec” |
| 7 | Prognoza: za ile dni zostanie przekroczony próg stresu | dni, przedział lub „> 14” | ① Ocena; ⑤ Nawadnianie |
| 8 | **Przyczyny**: udział czynników w deficycie | % lub ranking | ② Przyczyny |
| 9 | Strefy w obrębie działki: odpływ i akumulacja wody | raster / poligony | ③ Retencja |
| 10 | Satelita na tle uprawy: NDVI/NDMI vs typowa krzywa tej uprawy w tej fazie | odchylenie, liczba scen | ① Ocena: „rośliny słabsze niż zwykle” |
| 11 | Pewność i braki: flagi każdego źródła, wiek ostatniej sceny, rozbieżność fizyka–satelita | lista | ⑥ Ograniczenia |

Rekomendacje (sekcje ③–⑤ raportu) to **reguły na tych wyjściach**, nie wyjście ML. Przykład: wysoki udział „odpływ” i spadek > 3% → strefy buforowe i spowalnianie odpływu w miejscach z wyjścia 9. Dzięki temu każda rekomendacja ma jawne uzasadnienie danymi, czego wymaga Z 3.2.

## 5. Szczegóły części A–D

**A. Bilans (FAO-56, rozdz. 8 i aneks).** Warstwy gleby z SoilGrids przeliczamy na θ_FC i θ_WP funkcją pedotransferu (np. Saxton–Rawls 2006 z uziarnienia i SOC). Pozwala to zróżnicować warstwy i pokazać wpływ materii organicznej, który PN wymienia wprost. Dalej:
- ETc = Kc × ET0 i współczynnik stresu Ks (dual Kc opcjonalnie),
- odpływ metodą SCS-CN z grupą hydrologiczną gleby i poprawką na spadek z NMT,
- przesiąkanie kaskadowe między warstwami.

Start symulacji to 1 rok przed oknem 10 lat (rozgrzewka stanu).

**B. Korekta ML.** Jeden `HistGradientBoostingRegressor` z `loss="quantile"` dla kwantyli 0,1, 0,5 i 0,9:
- **Cel:** ΔNDMI w horyzoncie 7–14 dni, zgodnie z [specyfikacja_treningu_ml_kowr.md](../specyfikacja_treningu_ml_kowr.md) (etykiety z archiwum S2, bez sond).
- **Cechy:** stan z A (zapas, Ks, deficyt narastający), anomalia wilgotności ERA5-Land, ostatnie NDMI/NDVI i ich wiek, uprawa, faza, dzień roku, cechy gleby i spadku.
- **Co daje w aplikacji:** (1) prognoza reakcji roślin, (2) gdy obserwowane NDMI rozjeżdża się z tym, co przewiduje bilans, model **obniża pewność** i raport mówi to wprost. Nie zastępuje bilansu.

**C. Klimatologia.** Ten sam przebieg A dla 10 sezonów daje rozkład zapasu wody dla każdej dekady roku na tej działce. Z niego liczymy percentyl (wyjście 4) i podatność (wyjście 6). Rozkład liczy się w czasie zapytania, więc spełnia wymóg „oblicza na podstawie danych archiwalnych”.

**D. Atrybucja.** Kontrfaktyczne przebiegi A: każdy składnik po kolei zamieniamy na jego medianę z 10 lat, a resztę zostawiamy bez zmian. Zmiana deficytu to wkład danego składnika:
- opad,
- ET0 (temperatura),
- TAW (gleba),
- odpływ (spadek).

Daje to przyczyny w języku PN: „deficyt opadów połączony z wysoką temperaturą”, „ograniczona zdolność magazynowania”, „nadmierny odpływ powierzchniowy”. Wymaga 4–5 dodatkowych przebiegów, co trwa milisekundy.

## 6. Dane do treningu B

- Pilotaż: 100–300 pól w kilku zwartych obszarach, sezony 2016–2025, geometrie i uprawy z GSA/LPIS tam, gdzie są dostępne (szczegóły w specyfikacji treningu).
- Podział przestrzenny (`GroupKFold` po bloku) oraz osobny test na późniejszym sezonie. 580/2 jest poza treningiem jako działka demo.
- Model zapisany jako `joblib` + `model_card.json` (cechy, wersje danych, licencje).
- Jeżeli B nie pobije baseline'u (ΔNDMI = 0 oraz sam bilans A), aplikacja działa na A+C+D, a B jest oznaczony jako eksperymentalny. **A, C i D muszą działać samodzielnie.**

## 7. Walidacja: jak przygotować się na „dane referencyjne jury”

Zadanie nie mówi, co jest referencją (Z 6). Najbardziej prawdopodobne są oficjalne wskaźniki, które samo zadanie podaje jako źródła:

1. **IUNG – System Monitoringu Suszy Rolniczej:** KBW i zagrożenie suszą dla gminy, uprawy i kategorii gleby. → Liczymy wyjście 5 tą samą metodą i porównujemy kategorie z archiwalnymi raportami IUNG dla 20–30 gmin i kilku sezonów (macierz zgodności).
2. **EDO (CDI, SMA):** → porównanie anomalii wilgotności z A z SMA w tych samych komórkach (korelacja rang).
3. **Sentinel-2:** → MAE ΔNDMI na odłożonych lokalizacjach w porównaniu z baseline'ami.
4. **Kontrola zdroworozsądkowa:** znane susze (np. 2018, 2019) muszą wyjść jako niskie percentyle w Polsce centralnej, a lata mokre jako wysokie.

Wyniki tych porównań trafiają do README jako „sposób weryfikacji wyników” (Z 4.2 pkt 9).

## 8. Niepewność i braki danych

- Każda liczba ma przedział (kwantyle z B albo zakres parametrów gleby w A: SoilGrids podaje kwantyle 5/50/95).
- **Plakietka pewności** (wysoka / średnia / niska) z reguł: wiek ostatniej sceny S2, liczba scen w sezonie, zgodność A z satelitą, wielkość działki względem pikseli 250 m SoilGrids i 9 km pogody.
- Brak źródła → wyjście `null` + powód w raporcie („brak bezchmurnej sceny od 23 dni”). Nigdy nie wstawiamy wartości domyślnej bez informacji (Z 3.3 pkt 5: „bez pozornej precyzji”).
- Jawnie nieuwzględnione: dreny, nawadnianie, wody gruntowe, faktyczna data siewu (jeśli nie podano), mikroklimat.

## 9. Gdzie jest AI (tekst do README, Z 5.1)

| Element | Technika | Rola |
|---|---|---|
| Korekta stanu i prognoza reakcji roślin | uczenie maszynowe: gradient boosting, regresja kwantylowa | łączy satelitę, wilgotność regionalną i bilans na skali działki; daje przedział niepewności |
| Bilans, klimatologia, przyczyny | model fizyczny FAO-56 + SCS-CN, pedotransfer Saxton–Rawls | deterministyczne i wyjaśnialne; nie jest AI i tak to opisujemy |
| Rekomendacje | reguły eksperckie oparte na PN i NWRM | jawne i audytowalne |
| (opcjonalnie) tekst raportu | model językowy przeredagowuje gotowe liczby i reguły na prosty język | nie liczy niczego i nie dodaje faktów; każde zdanie odnosi się do wyjścia z sekcji 4 |
| Narzędzia AI użyte przy tworzeniu kodu i dokumentów | asystenci kodowania | wymienić w README |

## 10. Wydajność: budżet 30 s

| Krok | Czas | Uwagi |
|---|---|---|
| ULDK | ~1 s | |
| Pogoda 11 lat, 1 komórka | 1–3 s | cache po komórce; Open-Meteo bywa limitowane (429), więc archiwum warto mieć wcześniej pobrane dla siatki PL |
| SoilGrids | 1–5 s z API albo < 1 s z lokalnego wycinka | REST API jest wolne i limitowane, więc lepiej pobrać rastry PL wcześniej (WebDAV) i opisać to w README |
| NMT dla działki | 2–4 s | WCS, mały wycinek |
| Sentinel-2 | 6–10 s | pomiar w [dobor_technologii_ml_kowr.md](../dobor_technologii_ml_kowr.md); dla krzywej 10-letniej potrzebny cache lub mniejsze próbkowanie |
| A + C + D + B | < 1 s | numpy, ok. 4000 dni × 5 przebiegów |

Źródła pobieramy równolegle. Sekcje raportu pokazujemy, gdy są gotowe.

## 11. Zakres na hackathon

**Musi być (demo dla jury):** A + C + D dla dowolnej działki i daty, NDVI/NDMI z S2 na tle uprawy, wyjścia 2–8, 10 i 11, KBW porównywalny z IUNG, reguły rekomendacji.

**Powinno być:** B wytrenowany na pilotażu z raportem MAE vs baseline, wyjście 9 (strefy z NMT), prognoza 7–14 dni (wyjście 7).

**Może poczekać:** wyjście 1 w m³/m³ w trzech warstwach (pokazujemy je jako szacunek), dual Kc, asymilacja ERA5-Land w filtrze Kalmana.

## 12. Pytania do mentorów

- **dr inż. T. Bolewski** (bilans): czy KBW w ujęciu IUNG to właściwa „waluta” porównania z referencją? Jakie progi kategorii suszy przyjąć dla bilansu glebowego?
- **dr hab. D. Gozdowski** (satelita, agrotechnika): typowe krzywe NDVI/NDMI dla głównych upraw w PL. Od jakiego odchylenia uznać, że uprawa reaguje na stres, a nie na fazę lub zbiór?
- **T. Rychlicki** (GIS): najszybszy dostęp do NMT dla dowolnej działki w < 5 s; czy jest gotowa warstwa grup hydrologicznych gleb dla PL.
