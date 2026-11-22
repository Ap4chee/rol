# AGENTS.md

Instrukcje dla agentów AI i ludzi pracujących w tym repo. Czytaj całość przed pierwszą zmianą.

## Projekt

KOWR — „Zatrzymaj Wodę, Chroń Plony" (HackNation 2026, termin oddania 22.11.2026 11:00).

Webowa aplikacja dla rolnika. Rolnik wskazuje działkę ewidencyjną (numer albo punkt na mapie), uprawę i datę. Aplikacja sama pobiera otwarte dane, ocenia sytuację wodną i historyczną podatność na niedobory (ostatnie 10 lat), po czym generuje raport z uzasadnionymi rekomendacjami.

Dokumenty:
- [docs/zadanie_kowr.md](docs/zadanie_kowr.md) — streszczenie zadania, kryteriów i wymagań. Przy wątpliwościach co do zakresu zajrzyj tam.
- [docs/ml/specyfikacja_treningu.md](docs/ml/specyfikacja_treningu.md) — specyfikacja modelu prognozy zmiany NDMI.
- [docs/brief_model_ai.md](docs/brief_model_ai.md) — brief modelu AI: bilans FAO-56 + ML, wejścia, wyjścia, walidacja.

## Jak jury to testuje

To decyduje o priorytetach, więc miej to w głowie przy każdej zmianie.

- **Etap 1:** jury uruchamia prototyp na tych samych działkach i datach dla wszystkich zespołów i porównuje wynik z danymi referencyjnymi, których nie znamy.
- **Etap 2:** pokaz na żywo dla 1–3 działek wskazanych przez jury na miejscu.
- Działka może być dowolna w Polsce, data dzisiejsza albo z ostatnich 10 lat.

Wniosek: najważniejsze jest, żeby cały przebieg od działki do raportu działał dla nieznanego wejścia i żeby ocena niedoboru wody była merytorycznie poprawna. Wygląd, model ML i dodatki mają sens dopiero wtedy, gdy to działa.

Wagi: wartość praktyczna 25%, wykorzystanie danych i wiarygodność 25%, innowacyjność 20%, prostota obsługi 15%, działający prototyp i jakość techniczna 15%.

## Twarde zasady produktu

Złamanie którejkolwiek kosztuje punkty albo dyskwalifikuje funkcję.

1. **Wynik liczony na żywo z pobranych danych.** Żadnych zaszytych wyników, gotowych rekomendacji ani specjalnych ścieżek dla konkretnej działki czy daty. Dotyczy to też działki testowej 580/2.
2. **Dowolna działka w Polsce i dowolna data z ostatnich 10 lat.** Nie zakładaj regionu, kafla Sentinel, strefy UTM ani roku. Dla daty historycznej używaj wyłącznie danych dostępnych do tej daty.
3. **Brak danych mówimy wprost.** Gdy źródło nie odpowiada, scena jest zachmurzona albo dane nie obejmują daty, raport podaje, czego brakuje i jak to ogranicza wniosek. Nie wstawiaj wartości domyślnych, średnich ani zer w miejsce brakujących danych bez oznaczenia tego w wyniku.
4. **Bez pozornej precyzji.** Wynik pokazuj z dokładnością, na jaką pozwalają dane, razem z niepewnością i ograniczeniami.
5. **Bilans wodny, nie sam opad.** Ocena uwzględnia opad, ewapotranspirację, glebę i uprawę (podejście FAO-56). Wskaźników satelitarnych nie interpretuj samodzielnie: łącz je z pogodą, glebą i hydrologią, z uwzględnieniem uprawy i fazy sezonu.
6. **Kolejność analizy i raportu jest narzucona:** sytuacja wodna, przyczyny niedoboru, rekomendacje retencyjne, agrotechniczne, na końcu nawadnianie (opcjonalne). Rekomendacja nie może powstać bez wcześniejszej oceny warunków działki, a retencja ma pierwszeństwo przed nawadnianiem.
7. **Każda rekomendacja ma uzasadnienie w danych tej działki.** Raport podaje źródła danych i daty, z których pochodzą.
8. **Raport da się zapisać (PDF) lub wydrukować.**
9. **Rolnik nie potrzebuje niczego poza przeglądarką:** bez instalacji, płatnych licencji, wiedzy GIS. Język interfejsu polski, prosty, bez żargonu.
10. **Preferowany czas odpowiedzi dla jednej działki: do 30 s.** Pobieraj źródła równolegle, czytaj tylko wycinek rastra dla działki (nie całe kafle), zapisuj odpowiedzi zewnętrznych usług w pamięci podręcznej.

## Dane i licencje

Dane muszą być bezpłatne i legalne. Zwycięzca przenosi prawa do kodu na KOWR, więc licencja każdej biblioteki, modelu i zbioru danych musi na to pozwalać.

Źródła, z których korzystamy lub planujemy korzystać:

| Kategoria | Źródło |
|---|---|
| Działka (geometria) | ULDK GUGiK |
| Satelita | Sentinel-2 L2A przez Earth Search STAC (`sentinel-2-c1-l2a`) |
| Pogoda | Open-Meteo (archiwum ERA5 i prognoza), IMGW-PIB |
| Gleba | ISRIC SoilGrids, IUNG-PIB |
| Teren | NMT GUGiK (WCS) |
| Hydrologia, susza | Hydroportal ISOK, Monitoring Suszy IUNG, EDO |

Zasady:
- **Zanim dodasz bibliotekę, model albo źródło danych, sprawdź licencję** i dopisz pozycję do wykazu w README (nazwa, do czego służy, licencja, czy dane są pobierane na żywo czy wcześniej, z jaką datą). Licencji nie podawaj z pamięci.
- Unikaj licencji copyleft (GPL, AGPL) i usług płatnych. Jeśli płatna usługa jest konieczna, opisz koszt i darmową alternatywę.
- Zewnętrzne usługi wywołuj z limitem czasu i obsługą błędu. Szanuj limity zapytań, nie odpytuj w pętli bez pamięci podręcznej.
- Nie przetwarzaj danych osobowych. Numer działki i geometria wystarczą.
- Jeśli AI działa w aplikacji (np. do redagowania tekstu raportu), liczby i wnioski pochodzą z obliczeń, a model językowy ich nie wymyśla. Zakres użycia AI opisz w README.

## Model ML

- Model jest dodatkiem do bilansu wodnego, a nie jego zamiennikiem. Aplikacja musi dawać pełny raport również bez modelu.
- Trzymaj się specyfikacji: cechy tylko z danych sprzed dnia prognozy, podział na zbiory według bloków przestrzennych, porównanie z prognozą „bez zmiany".
- Gdy model nie ma danych wejściowych, aplikacja podaje powód zamiast prognozy.
- Z predykcji NDMI nie wyliczaj dawki nawodnienia ani wilgotności gleby w jednostkach fizycznych.

## Jak pracować w kodzie

- **Najpierw przeczytaj istniejący kod** i trzymaj się jego struktury, nazw i stylu. Stos technologiczny i komendy są w README; jeśli zmieniasz sposób uruchamiania lub testowania, zaktualizuj README w tym samym commicie.
- **Rób to, o co poproszono.** Bez refaktorów przy okazji, bez nowych zależności, gdy wystarczy to, co już jest.
- **Obliczenia oddzielaj od pobierania danych.** Funkcje liczące (bilans wodny, wskaźniki) przyjmują dane jako argumenty, żeby dało się je testować bez sieci.
- **Jednostki i układy współrzędnych zapisuj jawnie** w nazwach lub komentarzach (`rain_mm`, `et0_mm`, EPSG:4326, EPSG:2180). Pomyłka w układzie albo jednostce daje wynik, który wygląda wiarygodnie i jest błędny.
- **Sprawdzaj zmianę na prawdziwym wejściu, nie tylko na testach.** Minimum: działka `060910_2.0011.580/2` oraz jedna działka z innej części Polski, dla daty bieżącej i jednej historycznej (np. lato 2018). Dodatkowo przypadek z brakiem danych, np. data z zachmurzonym zdjęciem.
- **Mów, czego nie sprawdziłeś.** Jeśli coś nie zostało uruchomione albo test nie przechodzi, napisz to wprost.
- Komentarze i dokumentacja po polsku, nazwy w kodzie po angielsku.

## README

README jest oceniane. Musi zawierać: instrukcję uruchomienia, funkcje, architekturę, źródła i zakresy danych, podział na dane pobierane na żywo i wcześniej (z datami), wykaz bibliotek, modeli i usług z licencjami (w tym AI), ograniczenia oraz sposób weryfikacji wyników. Aktualizuj je razem z kodem, a nie na końcu.

## Praca równoległa

Nad repo pracuje kilka osób jednocześnie, każda ze swoim agentem AI. Kod zmienia się cały czas, dlatego:

1. **Przed rozpoczęciem pracy zawsze `git pull --rebase`.** Nie zakładaj, że lokalna kopia jest aktualna.
2. **Po każdej zmianie commit + push.** Każda skończona, działająca zmiana (nawet mała) idzie od razu na `origin`:
   ```sh
   git pull --rebase
   git add <pliki>
   git commit -m "krótki opis zmiany"
   git push
   ```
   Nie zbieraj wielu zmian w jeden duży commit i nie zostawiaj niewypchniętej pracy.
3. **Konflikty rozwiązuj od razu** po `pull --rebase`. Nie nadpisuj cudzych zmian: przeczytaj obie wersje i połącz je. Nigdy `git push --force` na `main`.
4. **Małe, skupione commity.** Jeden commit = jedna rzecz. Opis commita mówi, co się zmieniło.
5. **Nie ruszaj bez potrzeby plików, nad którymi pracuje ktoś inny.** Jeśli musisz, zrób to małym commitem i wypchnij od razu, żeby zminimalizować konflikty.
6. **Dodawaj pliki po nazwie**, nie przez `git add .` ani `git add -A`.
7. **Nie commituj sekretów** (`.env`, klucze API, tokeny) ani dużych plików danych (rastry, zbiory treningowe, wagi modeli). Używaj `.env.example` i `.gitignore`. Wyjątek: jeden mały model prognozy NDMI w `kowr_ml/model/<run>/` (kilka MB), bo bez niego jury nie zobaczy prognozy. Nie usuwaj go i nie dodawaj kolejnych wersji bez potrzeby (każda zostaje w historii gita).
8. **Repozytorium ma pozostać prywatne** do czasu przekazania kodu organizatorowi.

## Gałąź

Pracujemy na `main`. Remote: `https://github.com/Ap4chee/rol.git`.
