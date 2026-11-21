# WaterOS 2.0: plan aplikacji

Plan na podstawie szkicu zespołu, zadania KOWR ([docs/zadanie_kowr.md](zadanie_kowr.md)) i obecnego API ([docs/kontrakt_api.md](kontrakt_api.md)). Stan na 21.11.2026. Komponenty z Mantine (`AppShell`, `NavLink`, `Tabs`), które już są w projekcie.

**Dwie zasady, które ustawiają cały układ:**

1. **Jury testuje jedną działkę i jedną datę** (link albo numer + data). Ścieżka „numer → wynik” musi mieć najwyżej dwa kroki, a zakładki nie mogą chować tego, co zadanie każe pokazać.
2. **Raport ma narzuconą kolejność:** ocena → przyczyny → retencja → agrotechnika → nawadnianie, plus źródła i ograniczenia. Zakładki służą do przeglądania. **Raport PDF zawsze składa wszystkie zakładki w tej kolejności**, niezależnie od tego, która jest otwarta.

---

## 1. Layout

```
┌─────────────┬──────────────────────────────────────────────────────────┐
│ 💧 WaterOS  │  Nagłówek widoku: tytuł · data „stan na” · akcje          │
│             ├──────────────────────────────────────────────────────────┤
│ ▣ Pulpit    │                                                          │
│ ＋ Dodaj    │                    obszar główny                         │
│             │                                                          │
│ MOJE POLA   │                                                          │
│ ● Pod lasem │                                                          │
│ ● Za stodołą│                                                          │
│ ○ Łąka      │                                                          │
│             │                                                          │
│ ─────────── │                                                          │
│ ⓘ Jak to    │                                                          │
│   działa    │                                                          │
│ « zwiń      │                                                          │
└─────────────┴──────────────────────────────────────────────────────────┘
```

**Sidebar (`AppShell.Navbar`):**
- **Pulpit:** przegląd wszystkich pól.
- **Dodaj pole:** formularz z mapą (obecny ekran startowy).
- **Moje pola:** lista z kropką statusu (zielona / żółta / pomarańczowa / czerwona / szara = brak oceny), sortowana od najpilniejszego.
- **Jak to działa:** metodyka, źródła danych i licencje. Odpowiada na kryterium „wiarygodność” i jest gotowcem do prezentacji.
- **Zwijanie:** w formie kompaktowej zostają same ikony, a pola pokazują się jako kółka z pierwszą literą i kolorem statusu. Stan zwinięcia pamiętamy w `localStorage`.
- **Telefon (< 768 px):** sidebar chowa się w szufladę pod przyciskiem menu (`Burger`). Na dole ekranu pole może mieć pasek zakładek.

## 2. Pulpit (wszystkie pola)

Cel: rolnik w 5 sekund wie, **które pole wymaga uwagi i co z nim zrobić**.

| Blok | Zawartość | Skąd dane |
|---|---|---|
| **Pasek alertów** (tylko gdy jest powód) | „2 pola z niedoborem wody”, „Pole X: stres za ok. 5 dni” | `water_status.class_key`, dni do stresu z reguł rekomendacji |
| **Mapa pól** | Wszystkie zapisane działki pokolorowane statusem; kliknięcie otwiera pole | geometrie z zapisanych raportów (`parcel.geometry`) |
| **Karty pól** | Uprawa, ha, status, pasek zapasu wody, data analizy, jedna najważniejsza rekomendacja | zapisane raporty |
| **Najbliższe działania** | Lista rekomendacji ze wszystkich pól, od najpilniejszych | `recommendations` (już jest `actionItems`) |
| **Pogoda na 7 dni** | Dla regionu gospodarstwa, z podpisem „od dziś” | `/api/forecast` |
| **Raporty nieaktualne** | „Analiza starsza niż 7 dni: Przelicz wszystkie” | `generated_at` |

**Pusty pulpit:** od razu formularz „Dodaj pole” z mapą (jak teraz), a nie pusta strona z przyciskiem.

## 3. Widok pojedynczego pola

**Nagłówek (stały nad zakładkami):** nazwa pola, uprawa, ha, identyfikator działki, **status**, **„stan na”** z wyborem daty (zmiana daty przelicza raport), oraz akcje: Przelicz, Raport PDF, Zapisz.

**Zakładki:**

| Zakładka | Po co | Krok zadania |
|---|---|---|
| Podsumowanie | pigułka: jeden rzut oka | ocena + skrót przyczyn + 1 działanie |
| Rekomendacje | co zrobić i w jakiej kolejności | retencja → agrotechnika → nawadnianie |
| Gleba | profil i woda w warstwach | ocena, przyczyny (gleba) |
| Pogoda | co było i co będzie | ocena, przyczyny (opad/parowanie), nawadnianie |
| Teren i woda (dawne „Retencja?”) | gdzie woda ucieka i gdzie ją zatrzymać | przyczyny (spływ), retencja |
| Historia | czy to się powtarza (10 lat) | ocena historyczna |
| Źródła | skąd to wiemy i czego nie wiemy | wymagane w raporcie |

### 3.1 Podsumowanie (pigułka)

Wszystko mieści się na jednym ekranie laptopa, bez przewijania.

```
┌──────────────┬────────────────────────────────────────────────────┐
│   ◯ 34%      │ ⚠ Umiarkowany niedobór wody                        │
│  zapas wody  │ Brakuje 154 mm do pełnego zapasu. Przy tej pogodzie │
│              │ stres wodny za ok. 5 dni.                           │
├──────────────┴────────────────────────────────────────────────────┤
│ DLACZEGO (max 3 punkty)                                           │
│ • 30 dni: 18 mm opadu wobec mediany 52 mm                         │
│ • Lekka gleba: mieści 78 mm wody w strefie korzeni                │
│ • Spływ: 2 drogi odpływu wody z pola                              │
├───────────────────────────────────────────────────────────────────┤
│ ZRÓB TERAZ: Zostaw resztki pożniwne jako okrywę → [wszystkie (5)] │
├──────────────┬──────────────┬──────────────┬──────────────────────┤
│ Opad 30 dni  │ Bilans 60 dni│ Niedobór w   │ Rośliny (satelita)   │
│ 18 / 52 mm   │ −92 mm       │ 5 z 10 lat   │ słabsze niż zwykle   │
├──────────────┴──────────────┴──────────────┴──────────────────────┤
│ Pewność: średnia · gleba z mapy 250 m, brak zdjęcia od 12 dni →   │
└───────────────────────────────────────────────────────────────────┘
```

**Odpowiedź na pytanie ze szkicu:** tak, jedna najważniejsza rekomendacja ma być w Podsumowaniu. Zadanie wymaga, żeby działanie wynikało z oceny, więc pigułka pokazuje ocenę, przyczynę i jedno działanie. Pełna lista jest w zakładce Rekomendacje.

### 3.2 Rekomendacje

- Trzy grupy w stałej kolejności: **a. Zatrzymaj wodę (retencja) → b. Zabiegi agrotechniczne → c. Nawadnianie**. Na końcu „Co sprawdzić na polu”.
- **Karta działania:**
  - co zrobić,
  - gdzie (z podglądem na mapie, jeśli dotyczy miejsca na polu),
  - kiedy,
  - dlaczego na tym polu (liczby z raportu),
  - pewność.
- **Ocena rekomendacji dla RSI** (recursive self-improvement modelu ML): przy każdej karcie przyciski „Pomogło” / „Nie pomogło” / „Nie zrobiłem”, z datą wykonania. Ocena trafia do zbioru treningowego jako etykieta: (stan działki w dniu rekomendacji, działanie, wynik). Wynik mierzymy niezależnie od deklaracji rolnika: zmiana NDMI z Sentinel-2 i zapasu wody z bilansu w kolejnych 2–4 tygodniach wobec podobnych pól bez działania. Model okresowo trenuje się na tych etykietach i zmienia kolejność oraz pewność rekomendacji. To pętla samodoskonalenia.
  - **Uczciwie:** dziś aplikacja nie ma wytrenowanego modelu (patrz [brief_model_ai.md](brief_model_ai.md)), a oceny wymagają backendu, który je zbiera. Na hackathon pokazujemy zbieranie ocen i opis pętli. Nie pokazujemy animacji „modelu, który się uczy”, bo byłaby nieprawdziwa (AGENTS.md: wynik liczony z danych, bez pozornej precyzji).
- **Status u rolnika:** przyciski „Zrobione” / „Nie dotyczy” zapisywane w przeglądarce, a pulpit pokazuje tylko otwarte działania. Bez kont i bez danych osobowych.

### 3.3 Gleba

- Przekrój 6 warstw (SoilGrids) z rodzajem gleby, wodą dostępną i linią korzeni. Komponent już jest.
- Zapas w strefie korzeni z bilansu oraz wilgotność 3 warstw okolicy (NASA POWER) na tle 10 lat. Też już jest.
- Węgiel organiczny w 0–30 cm i co z niego wynika (materia organiczna → retencja glebowa, PN s. 2).
- Przedział niepewności SoilGrids (5–95%) i jego wpływ na ocenę.
- Kategoria podatności gleby na suszę IUNG, jeśli zdążymy ją podłączyć.

### 3.4 Pogoda

- **Ostatnie 30/60/90 dni:** opad i parowanie wobec mediany 10 lat (wykres słupkowy). Klimatyczny bilans wodny.
- **Prognoza 7 dni:** opad, temperatura, ET0.
- **Prognozowany zapas wody w glebie na 7 dni:** bilans puszczony dalej z prognozą pogody. Wynik to dzień, w którym zapas spadnie poniżej progu stresu, albo „deszcz uzupełni zapas”. **Tego nie ma w API** (patrz sekcja 6).
- **Data historyczna:** prognoza nie ma sensu, więc zamiast niej pokazujemy „co działo się 7 dni po dacie analizy” albo samą historię. Zakładka musi to mówić wprost.

### 3.5 Teren i woda (odpowiedź na „?Retencja wody?”)

**Tak, ta zakładka jest potrzebna.** Retencja to rdzeń zadania KOWR („retain water where it falls”), a mamy już dane, które dziś nigdzie się dobrze nie mieszczą:
- mapa działki z NMT: drogi spływu, punkty dopływu i odpływu wody, zagłębienia,
- spadek terenu (średni i 90. percentyl) i co oznacza dla odpływu,
- działania retencyjne przypięte do miejsc na mapie: pas buforowy na drodze spływu, ochrona zagłębienia, zadrzewienie,
- rzeki w okolicy: najbliższy wodowskaz IMGW, przepływ na tle 10 lat,
- zwykłym językiem: czego nie wiemy (dreny, rowy, wody gruntowej nie ma w otwartych danych).

Nazwa „Teren i woda” jest dla rolnika jaśniejsza niż „Retencja”.

### 3.6 Historia

- 10 sezonów: dni niedoboru w okresie krytycznym uprawy (wykres słupkowy).
- Miesiące największego ryzyka (zadanie podaje przykład „maj–lipiec”).
- Zapas wody dziś wobec tego samego dnia w 10 latach.
- Krzywa NDVI/NDMI z satelity na tle typowej dla tej uprawy, jeśli zdążymy.

### 3.7 Źródła

Tabela źródeł ze statusem i datami danych, lista ograniczeń, założenia o uprawie. Wymóg zadania (Z 3.3 pkt 5). Plakietka pewności w Podsumowaniu linkuje tutaj.

### 3.8 Raport PDF

Osobny widok do druku: wszystkie zakładki jedna pod drugą w kolejności z zadania (Podsumowanie → Historia → Przyczyny → Rekomendacje → Gleba, Pogoda, Teren jako załączniki → Źródła). Ma nagłówek z działką, datą i datą wygenerowania.

## 4. Flow aplikacji

```
            ┌──────────── link ?parcel=…&crop=…&date=… (jury) ───────────┐
            │                                                            ▼
 [Pierwsze wejście] → [Dodaj pole: numer/mapa + uprawa + data] → [Analiza 10–30 s] → [Pole: Podsumowanie]
                                   ▲                                   │                     │
                                   │                         źródło padło → raport            ├─ zakładki
 [Pulpit] ── klik w pole ──────────┼───────────────────────────────────┼─────────────────────►│
    ▲                              │                         z jawnym brakiem                 ├─ zmień datę → Analiza
    └──── „Zapisz pole” ◄──────────┴──────────────────────────────────────────────────────────┤
                                                                                              └─ Raport PDF
```

1. **Pierwsze wejście:** od razu formularz z mapą. Bez logowania i bez samouczka.
2. **Dodanie pola:** numer działki (obręb + numer, pełny identyfikator) albo kliknięcie na mapie. Potem uprawa (kafelki z ikonami) i data, domyślnie dziś. Nazwa pola jest opcjonalna i można ją dodać później.
3. **Analiza (10–30 s):** ekran z listą źródeł, które spływają na żywo (ULDK ✓, pogoda ✓, gleba ✓, satelita ⏳…). Pokazuje jury, że wynik jest liczony, a nie gotowy. Podsumowanie pojawia się, gdy jest bilans, a satelita i teren dociągają się w tle (tak działa API).
4. **Pole:** zawsze otwiera się na Podsumowaniu.
5. **Zapis:** pole trafia do sidebara i na pulpit (`localStorage`). Pole z linku jury jest podglądem, dopóki ktoś go nie zapisze.
6. **Powrót po czasie:** pulpit oznacza raporty starsze niż 7 dni, a „Przelicz” liczy je na dziś.
7. **Błędy:** brak źródła nigdy nie blokuje raportu. Zakładka bez danych mówi, czego brakuje i jak to zmienia wniosek. ULDK niedostępne → raport dla punktu z mapy.

## 5. Co z obecnego kodu zostaje

| Element | Stan |
|---|---|
| Formularz z mapą (`AddFieldForm`) | zostaje, trafia do „Dodaj pole” i do pustego pulpitu |
| Sekcje raportu (`Report.jsx`) | rozcinamy na zakładki; ten sam układ służy do PDF |
| `SoilProfile`, `Satellite`, `History`, `Sources`, `HydrologyTable` | przenosimy do zakładek bez zmian |
| `ParcelMap` | zostaje: mapa w nagłówku pola, w „Teren i woda” i na pulpicie (wiele pól) |
| Routing przez `#pole/<id>` | rozszerzamy o zakładkę: `#pole/<id>/gleba` (link do konkretnej zakładki) |

## 6. Czego brakuje w backendzie

| Brak | Dla której części | Koszt |
|---|---|---|
| Prognoza zapasu wody na 7 dni (bilans dalej z `/api/forecast`) | Pogoda, alerty na pulpicie | średni: funkcja w `core/water_balance.py` + pole w raporcie; frontend niczego nie liczy |
| Ocena działań (koszt, nakład, kiedy działa, wpływ) | Rekomendacje | mały: stała tabela przy regułach w `core/recommendations.py` |
| „Kiedy” dla każdego działania | Rekomendacje | mały: część reguł już ma terminy (siew międzyplonu, po zbiorze) |
| Typowa krzywa NDVI dla uprawy | Historia | duży, do pominięcia na hackathon |
| Kategoria podatności gleby IUNG | Gleba | niepewny: trzeba sprawdzić usługę i licencję |

## 7. Kolejność prac (do 22.11, 11:00)

1. `AppShell` z sidebarem i listą pól, routing z zakładką.
2. Widok pola z zakładkami. Treść przenosimy z obecnego raportu bez przepisywania.
3. Podsumowanie (pigułka).
4. Widok PDF składający wszystkie zakładki. **Bez tego nie ma wymaganego raportu.**
5. Pulpit: karty, mapa pól, działania.
6. Backend: prognoza zapasu na 7 dni i tabela oceny działań.
7. Dopiero potem: status „zrobione”, krzywe NDVI, IUNG.

Punkty 1–4 są warunkiem, żeby nowy układ nie zepsuł tego, co jury sprawdza. Gdy zabraknie czasu, lepiej oddać obecny raport niż niedokończone zakładki.
