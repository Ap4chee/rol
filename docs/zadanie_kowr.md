## Krajowy Ośrodek Wsparcia Rolnictwa (KOWR) — Zatrzymaj wodę, chroń plony
**W jednym zdaniu:** Webowy asystent dla rolnika, który dla dowolnej polskiej działki ewidencyjnej i wybranej daty sam pobiera otwarte dane (satelitarne, pogodowe, glebowe, hydrologiczne, przestrzenne), ocenia sytuację wodną i generuje uzasadnione rekomendacje retencyjne, agrotechniczne i (opcjonalnie) nawadniania.

### Problem / kontekst
- Polska ma jedne z najniższych zasobów wodnych w Europie i niską retencję; susze rolnicze powodują straty w plonach.
- Otwarte dane są rozproszone i wymagają specjalistycznej wiedzy, więc rolnik nie dostaje prostych, spersonalizowanych wskazówek.
- KOWR (ok. 1,4 mln ha zasobu Skarbu Państwa) traktuje hackathon jako test koncepcji w ramach działań na rzecz retencji wody. Najciekawsze rozwiązania posłużą jako źródło pomysłów.
- Podstawy naukowe: analiza musi uwzględniać cały bilans wodny (nie tylko opady), integrować wiele źródeł danych, wskazywać przyczyny niedoboru i priorytetowo traktować retencję („retain water where it falls”) przed nawadnianiem.

### Co trzeba zbudować
Działający prototyp aplikacji webowej (przeglądarka na komputerze, Windows; Chrome, Firefox, Edge, Safari, Opera; bez instalacji; atutem jest działanie na urządzeniach mobilnych). Obowiązkowy scenariusz:
1. Rolnik wskazuje działkę (numer ewidencyjny lub punkt na mapie).
2. Wybiera aktualną uprawę.
3. Narzędzie pobiera dane i ocenia bieżącą sytuację wodną oraz historyczną podatność na niedobory wody (dane z ostatnich 10 lat). Wynik liczy aplikacja, a pokazywanie gotowych, wcześniej przygotowanych rekomendacji nie spełnia wymagań.
4. Raport zawiera: stan niedoboru i jego przyczyny, rekomendacje uzasadnione danymi (retencyjne, agrotechniczne, opcjonalnie nawadnianie), datę i źródła danych oraz ograniczenia i niepewność. Brak danych trzeba komunikować wprost, bez pozornej precyzji.
5. Raport można zapisać (np. PDF) lub wydrukować.

Obowiązkowa kolejność analizy: ocena sytuacji wodnej, przyczyny, rekomendacje retencyjne, agrotechniczne, nawadnianie. Rekomendacje nie mogą powstać bez wcześniejszego rozpoznania warunków działki. Interpretacja danych satelitarnych ma uwzględniać rodzaj uprawy.

### Dane i materiały
- KOWR nie dostarcza danych. Zespoły pobierają je samodzielnie, a dane muszą być bezpłatne i legalne, zgodne z licencją dostawcy.
- Wymagane kategorie: meteorologiczne, satelitarne, glebowe, hydrologiczne, przestrzenne (działki, użytkowanie, ukształtowanie terenu).
- Przykładowe źródła (lista otwarta): Copernicus Data Space i Sentinel-2 Earth Search; IMGW-PIB, Open-Meteo; IUNG-PIB (Monitoring Suszy, mapa podatności gleb), ISRIC SoilGrids; Geoportal (NMT/NMPT przez WCS, ULDK, EGiB, plik działek w formacie Parquet); Hydroportal ISOK (PIG-PIB/Wody Polskie); EDO (WMS).
- Materiały w folderze: pełna treść zadania, podstawy naukowe (bibliografia: FAO-56, IUNG, KE o NWRM i inne), regulamin zadania. Plików .zip nie ma.
- Mentorzy: Bolewski (susza, bilans wodny), Czerniejewski (analiza biznesowa), Gozdowski (agrotechnika, dane satelitarne), Rychlicki (GIS), dwoje mentorów instytucjonalnych. Godziny konsultacji podano na Discordzie, rezerwacja przez platformę.

### Wymagania techniczne i ograniczenia
- Dowolny stack. Dopuszczalna jest AI, ale jej zakres i sposób użycia trzeba opisać w dokumentacji.
- Musi działać dla dowolnej działki w Polsce i dla dowolnej daty (dziś lub z ostatnich 10 lat).
- Rolnik nie może potrzebować: płatnej licencji, specjalistycznego sprzętu, wiedzy GIS ani instalacji. Płatne usługi trzeba wskazać wraz z kosztami i alternatywami.
- Preferowany czas rekomendacji dla jednej działki: do 30 s.
- Skalowalność: nie trzeba jej wykazywać, ale w dokumentacji opisać limity API, cache, aktualizację danych i koszty.
- Bezpieczeństwo podstawowe, unikać danych osobowych.
- README musi zawierać: instrukcję uruchomienia, funkcje, architekturę, źródła i zakresy danych, które dane są pobierane na żywo a które wcześniej (z datami), wykaz bibliotek, modeli i usług z licencjami (w tym AI), ograniczenia, sposób weryfikacji wyników.
- Rozwiązanie powstaje w trakcie wydarzenia. Zespół 1–6 osób.

### Kryteria oceny
- Wartość praktyczna dla użytkownika: 25%.
- Wykorzystanie danych i wiarygodność rekomendacji (zgodność z wiedzą naukową, dopasowanie do działki, transparentność niepewności): 25%.
- Innowacyjność i potencjał rozwojowy: 20%.
- Prostota obsługi: 15%.
- Działający prototyp i jakość techniczna (w tym licencje, dokumentacja, szybkość): 15%.
- Etap 1: jury uruchamia prototyp na tych samych działkach i datach dla wszystkich zespołów i porównuje z danymi referencyjnymi, które zna tylko jury. Etap 2: finał 3–5 zespołów, pokaz na żywo dla 1–3 działek wskazanych przez jury (pitch ok. 2–3 min i do 2 min pytań).

### Wymagane rezultaty i terminy
- Zgłoszenie: nazwa zespołu i tytuł, zwięzły opis (problem, funkcje, użycie danych, korzyści), link do prywatnego repozytorium (dostęp dla jury według instrukcji z platformy), README, prezentacja PDF (do 10 slajdów), działający prototyp (link lub instrukcja uruchomienia; element obowiązkowy), film do 3 min, raporty wygenerowane przez prototyp. Opcjonalnie zrzuty ekranu i grafiki.
- Wydarzenie: Bydgoszcz, 21–22 listopada 2026. Pełny opis zadania publikowany w dniu startu o 11:00. Organizator może zażądać wstępnej wersji rozwiązania w pierwszym dniu. Ostateczny termin wysyłki wyznacza regulamin wydarzenia (w materiałach brak konkretnej godziny).
- Nagroda: jedna, 25 000 zł netto dla zwycięskiego zespołu (podział równy lub według oświadczenia). Wypłata do 14 dni od podpisania umowy.
- Licencje: zwycięzcy nieodpłatnie przenoszą na KOWR autorskie prawa majątkowe (kod źródłowy i dokumentacja). Wszyscy członkowie muszą podpisać umowę w ciągu 7 dni od otrzymania, inaczej cały zespół traci nagrodę. Do czasu przekazania repozytorium ma pozostać niepubliczne.

### Uwagi / pułapki
- Wynik musi być obliczany na żywo z pobranych danych. Hardkodowane lub wcześniej przygotowane rekomendacje dyskwalifikują funkcjonalność.
- Narzędzie musi obsłużyć daty historyczne (do 10 lat wstecz) i dowolną działkę w kraju. Jury testuje na nieznanych działkach.
- Nie wolno pokazywać pozornej precyzji. Niepewność i braki danych mają być jawne, a to jest wprost oceniane.
- Satelitarne wskaźniki roślinności nie mogą być interpretowane samodzielnie. Łączyć z pogodą, glebą i hydrologią, uwzględniając uprawę.
- Retencja ma pierwszeństwo przed nawadnianiem (nawadnianie jest opcjonalne).
- Wszystkie biblioteki, dane i narzędzia AI muszą mieć licencje zgodne z przeniesieniem praw na KOWR.
- Jury może nie przyznać nagrody, jeśli żadne rozwiązanie nie osiągnie 50% punktów lub nie spełni wymagań formalnych. Decyzje jury są ostateczne.
- Nazwa zespołu nie powinna zawierać imion i nazwisk, bo jury ocenia anonimowo.
- Uczestnicy finału mogą wyrazić zgodę na nagranie i publikację wizerunku. Odmowa nie wpływa na ocenę.
