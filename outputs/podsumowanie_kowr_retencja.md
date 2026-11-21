# KOWR HackNation 2026 — retencja wody na działce rolnej

**Cel aplikacji:** pomóc rolnikowi ocenić, czy uprawie brakuje wody, ustalić prawdopodobne przyczyny oraz wybrać działanie, które może poprawić retencję na jego działce. Wynikiem ma być decyzja możliwa do podjęcia w gospodarstwie, np. gdzie sprawdzić spływ po deszczu albo czy rozważyć pozostawienie okrywy po zbiorze.

## 1. Wymagania konkursowe

Podstawa: *KOWR – Pełna treść zadania konkursowego*, pkt 3.2–3.3 i rozdz. 4–7, oraz *KOWR – Podstawy naukowe*, s. 1–3. Poniższe techniki obliczeniowe i propozycje interfejsu są ustaleniami projektowymi.

- Rolnik wskazuje działkę ewidencyjną numerem lub na mapie i wybiera aktualną uprawę. Prototyp w przeglądarce obsługuje dowolną działkę w Polsce i analizę na dzień bieżący lub datę historyczną z ostatnich 10 lat.
- Aplikacja korzysta z **pięciu kategorii danych**: meteorologicznych, satelitarnych, glebowych, hydrologicznych i przestrzennych. Oblicza wyniki na podstawie danych bieżących i archiwalnych, uwzględniając historię ostatnich 10 lat. Dane można przygotować wcześniej. Rekomendacja musi wynikać z analizy wskazanej działki i daty.
- Kolejność analizy: **ocena sytuacji wodnej → rozpoznanie przyczyn → rekomendacje retencyjne → działania agrotechniczne → ewentualne nawadnianie**. Nawadnianie jest opcjonalne. Jeżeli system je uwzględnia, powinien uzasadnić zasadność, termin i zakres.
- Raport obejmuje stan niedoboru wody i jego przyczyny, działania, daty i źródła danych oraz niepewność i braki. Można go zapisać lub wydrukować. Podstawowe funkcje działają bez specjalistycznego sprzętu, płatnej licencji po stronie rolnika i znajomości GIS.
- Zgłoszenie obejmuje działający prototyp, prywatne repozytorium, README, prezentację PDF do 10 slajdów, film do 3 minut i raport wygenerowany przez aplikację. Dane muszą być dostępne bezpłatnie i używane zgodnie z warunkami dostawców. W README trzeba opisać także użyte modele, narzędzia AI i sposób walidacji.
- Punktacja: praktyczność **25%**, dane i wiarygodność **25%**, innowacyjność **20%**, prostota obsługi **15%**, prototyp i jakość techniczna **15%**. Organizator preferuje wynik w ciągu 30 sekund dla jednej działki.

## 2. Decyzje, które aplikacja wspiera

Lista działań pochodzi z dokumentów KOWR. Przesłanki i metody komputerowe to propozycja, jak przełożyć te działania na funkcje aplikacji. Wybór zależy od warunków pola i od tego, czy dostępne dane pozwalają potwierdzić przesłankę.

| Działanie | Na czym polega i kiedy je rozważyć | Jak system może je rozpoznać |
|---|---|---|
| **1. Międzyplony** | Obsianie pola między uprawami głównymi. Szczególnie warte rozważenia przy długim okresie bez okrywy, o ile jest czas i wilgoć na wzrost. Żywy międzyplon zużywa wodę. | Kalendarz zbioru i następnego siewu, reguły dla gatunku, temperatura, opady i szacowany zapas wody. Wynik: okno do rozważenia siewu lub sygnał, by sprawdzić możliwość wcześniejszego zakończenia wzrostu. |
| **2. Resztki pożniwne** | Pozostawienie słomy lub innych resztek jako okrywy. Istotne przy spodziewanym odsłonięciu powierzchni i ryzyku erozji lub przesuszenia. | Termin zbioru, deklaracja rolnika o resztkach i następnym siewie, mapa spadków i pogoda. Satelita pomaga ocenić okrywę, ale niski wskaźnik zieleni nie pozwala rozpoznać słomy. |
| **3. Ograniczenie intensywnej uprawy** | Mniej przejazdów lub mniej intensywne naruszanie gleby, jeżeli pasuje do uprawy i sprzętu. | Historia zabiegów podana przez rolnika, okrywa, nachylenie i stan uwilgotnienia. System może wskazać wariant do rozważenia. Termin zależy również od warunków pracy na polu. |
| **4. Zwiększanie materii organicznej** | Wieloletnie zachowywanie i dostarczanie biomasy, m.in. przez resztki, międzyplony i odpowiednio zaplanowane nawożenie organiczne. | Wstępny szacunek węgla organicznego, płodozmian i historia gospodarowania. Porównywalne badania laboratoryjne pozwalają sprawdzić poziom i trend. Wynik: priorytet na kolejne sezony. |
| **5. Strefy buforowe** | Pasy trwałej roślinności w miejscach, gdzie spływ wynosi wodę i materiał z pola. | Nachylenie i kierunki spływu z NMT, granice pól, pokrycie terenu i cieki. Wynik: odcinki do sprawdzenia po opadzie i dopasowania w terenie. |
| **6. Zadrzewienia śródpolne** | Pasy drzew lub krzewów chroniące przed wiatrem albo wspierające ograniczanie spływu. | Statystyki wiatru, otwartość pola, istniejące zadrzewienia i przebieg spływu. Lokalizacja wymaga uwzględnienia zacienienia, konkurencji o wodę i miejsca na uprawę. |
| **7. Małe zbiorniki retencyjne** | Przechwytywanie wody w miejscu o odpowiednim zasilaniu i ukształtowaniu. | Zlewnia z NMT, możliwy dopływ, opady i pokrycie terenu. Wynik: lokalizacje do oceny terenowej, w tym pod kątem podłoża i warunków wodnych. |
| **8. Ochrona oczek wodnych** | Zachowanie istniejącego oczka, jego otoczenia i zasilania. | Warstwy hydrograficzne, ortofotomapy i porównanie zdjęć w czasie. Sprawdzić, czy obserwowana zmiana nie wynika z sezonowości i różnic w opadach. |
| **9. Ochrona i odtwarzanie mokradeł** | Zachowanie terenu podmokłego albo przywrócenie jego warunków wodnych. | Mapy historyczne, grunty podmokłe, obniżenia i powtarzalne występowanie wody. Wynik: miejsca do oceny hydrologicznej, z uwzględnieniem wpływu na sąsiednie grunty. |
| **10. Spowalnianie odpływu** | Ograniczenie spływu powierzchniowego lub rozważenie regulacji istniejącego odwodnienia. | Model terenu, rowy i cieki, informacje o drenach, aktualny poziom wody i prognoza. Bez rozpoznania układu odwodnienia system może wskazać potencjał i ryzyko podtopienia. |
| **11. Monitorowanie upraw i wody** | Częstsze oględziny pola i kontrola stanu uprawy w okresach zwiększonego ryzyka. | Bilans wody, faza rozwoju, porównanie z ostatnimi 10 latami i wskaźniki satelitarne. Wynik: alert z terminem, przyczyną i informacją, co sprawdzić. |
| **12. Nawadnianie — opcjonalne** | Dostarczenie wody w odpowiednim terminie i zakresie, jeśli istnieje taka możliwość. | Dzienny bilans strefy korzeniowej, próg stresu dla uprawy, prognoza deszczu, wcześniejsze nawodnienia i parametry instalacji. Przy wystarczających danych można podać przedział terminu i dawki. |

Dobór międzyplonów: [NRCS](https://www.nrcs.usda.gov/sites/default/files/2024-06/340-nhcp-cps-cover-crop-2024.pdf). Działania retencyjne: [CDR](https://woda.cdr.gov.pl/woda-w-produkcji-rolniczej/gospodarowanie-woda), [NWRM](https://www.nwrm.eu/measures-catalogue). Planowanie nawodnienia: [FAO 56, rozdział 8](https://www.fao.org/4/x0490e/x0490e0e.htm).

## 3. Źródła danych

| Kategoria | Źródła i zastosowanie |
|---|---|
| **Meteorologia** | [Open-Meteo Archive](https://open-meteo.com/en/docs/historical-weather-api) i prognozy lub [IMGW](https://danepubliczne.imgw.pl/apiinfo). Opad, temperatura, ewapotranspiracja referencyjna i przebieg pogody do bilansu. Wybrana siatka modelu nie daje pomiaru dla punktu. Sprawdzić warunki użycia odpowiednio do sposobu wdrożenia. |
| **Satelity** | [Sentinel-2 / Earth Search](https://earth-search.aws.element84.com/v1). Zmiany kondycji i uwilgotnienia roślinności, np. NDVI i NDMI, po uwzględnieniu chmur i typu uprawy. Sygnał jest uzupełnieniem bilansu, bo pogorszenie kondycji może mieć również inne przyczyny. |
| **Gleba** | [ISRIC SoilGrids](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs.html) oraz [IUNG – mapa kategorii podatności na suszę](https://susza.iung.pulawy.pl/mapa-kategorii/). SoilGrids szacuje właściwości na sześciu głębokościach w siatce 250 m. Rastry można pobierać z [repozytorium WebDAV](https://files.isric.org/soilgrids/latest/data/): pliki VRT opisują mozaikę, a pliki TIFF zawierają wartości komórek. |
| **Hydrologia** | [MPHP10k / Wody Polskie](https://isok.gov.pl/inspire.html) do mapy cieków i otoczenia, IMGW do stanów i przepływów na stacjach. [EFAS](https://ewds.climate.copernicus.eu/datasets/efas-historical?tab=overview) daje modelowany przepływ rzeczny i odpływ powierzchniowy łącznie z podpowierzchniowym w siatce około 1–2 km. To tło regionalne. [HydroSHEDS](https://www.hydrosheds.org/products/hydrosheds) daje gotowe kierunki i akumulację spływu do analiz zlewni. |
| **Dane przestrzenne** | [ULDK](https://uldk.gugik.gov.pl/opis.html) do granicy działki, [NMT GUGiK](https://www.geoportal.gov.pl/pl/dane/numeryczny-model-terenu-nmt/) do nachylenia i dróg spływu, [BDOT10k](https://www.geoportal.gov.pl/pl/dane/baza-danych-obiektow-topograficznych-bdot10k/) oraz ortofotomapa do weryfikacji otoczenia i pokrycia terenu. |

Od rolnika warto zebrać aktualną uprawę i datę siewu. Dodatkowe informacje, takie jak ostatni zabieg, obecność międzyplonu, dreny lub instalacja nawodnieniowa, mają sens wtedy, gdy zmieniają decyzję. Obserwacja lub pomiar mogą zwiększać pewność, ale nie powinny być warunkiem podstawowej analizy.

## 4. Działka 580/2 w Niedrzwicy Kościelnej

**Identyfikator ULDK** `060910_2.0011.580/2`. Powierzchnia obliczona z geometrii **0,484 ha**. Środek geometrii ok. **51,093307°N, 22,355914°E**.

### Profil gleby

Wyniki to średnie ważone powierzchnią przecięcia działki z dwiema komórkami SoilGrids (ok. 16% i 84%). Każdy wiersz przedstawia szacunek dla przedziału głębokości.

| Głębokość | Piasek [%] | Pył [%] | Ił [%] | Węgiel org. [g/kg] | Gęstość [g/cm³] | pH w wodzie |
|---|---:|---:|---:|---:|---:|---:|
| 0–5 cm | 33,7 | 48,2 | 18,1 | 55,2 | 1,27 | 5,85 |
| 5–15 cm | 34,1 | 48,6 | 17,2 | 15,6 | 1,32 | 5,93 |
| 15–30 cm | 33,6 | 50,0 | 16,4 | 12,1 | 1,38 | 6,13 |
| 30–60 cm | 32,0 | 49,8 | 18,2 | 6,7 | 1,42 | 6,55 |
| 60–100 cm | 31,6 | 50,4 | 17,9 | 3,7 | 1,44 | 6,56 |
| 100–200 cm | 33,9 | 47,3 | 18,9 | 2,6 | 1,48 | 6,65 |

Uziarnienie jest w przybliżeniu zbliżone do klasy gliny (USDA *loam*), miejscami blisko granicy *silt loam*. Udział frakcji mineralnych zmienia się stosunkowo mało, zawartość węgla organicznego maleje z głębokością. Taki skład daje przesłankę, że gleba może magazynować więcej wody dostępnej roślinom niż gleba silnie piaszczysta przy porównywalnej głębokości korzeni i strukturze. Wielkość zapasu trzeba oszacować z pojemności polowej i punktu więdnięcia. Wzrost modelowej gęstości z głębokością nie potwierdza zagęszczenia ani podeszwy płużnej.

![Makieta profilu gleby](profil_gleby_580_2.png)

Grafika pokazuje sześć przedziałów głębokości i pomysł wybierania warstwy w aplikacji. Tekstury, kolory i grubości są umowne. Dane: [profil JSON](soilgrids_niedrzwica_koscielna_580_2.json) · [działka i komórki SoilGrids w GeoJSON](dzialka_580_2_i_siatka_soilgrids.geojson).

### Potencjalne drogi spływu

Użyto rzeczywistego [arkusza GUGiK M-34-33-D-a-4-4](https://opendata.geoportal.gov.pl/NumDaneWys/NMT/83815/83815_1789240_M-34-33-D-a-4-4.asc), z siatką 1 m i datą danych 2 maja 2025 r. Analiza obejmowała otoczenie działki. Z wysokości obliczono kierunek spływu D8, z obsługą zagłębień metodą Priority-Flood, oraz powierzchnię zasilającą poszczególne punkty. Na działce wysokości z rastra wynoszą od **202,45 do 203,65 m**.

![Mapa potencjalnego spływu i przecięć granicy działki](splyw_wody_dzialka_580_2.png)

- Mapa pokazuje **4 punkty dopływu i 4 punkty odpływu** po zastosowaniu progu wizualizacji **0,05 ha** powierzchni zasilającej.
- Największa powierzchnia zasilająca punkt odpływu wynosi **1,63 ha**. Punkt leży przy południowo-wschodniej granicy pola. Obszar zasilający obejmuje grunty poza działką. Powierzchni przypisanych poszczególnym punktom nie należy sumować, bo trasy mogą należeć do tego samego układu spływu.
- Przykładowa karta dla rolnika: **„Po intensywnym deszczu sprawdź południowo-wschodnią granicę pola. Jeśli potwierdzisz przepływ lub ślady erozji, oceń możliwość zastosowania pasa trwałej roślinności na drodze spływu.”**
- To wynik topograficzny. Nie uwzględnia intensywności opadu, infiltracji, drenów ani przepustów. **1,63 ha to powierzchnia zasilająca punkt, nie objętość wody.** Rozpoznanie rzeczywistego spływu i efektu zabiegu wymaga dodatkowych danych.

### Hydrologia i pogoda pobrane w przykładzie

- [IMGW — 913 stacji](dane_hydrologiczne_imgw.json) oraz [dwa wodowskazy w okolicy](niedrzwica_koscielna_stacje_imgw.json): Zemborzyce **108 cm**, Lublin **248 cm**, oba na Bystrzycy, zapis z 21 listopada 2026 r., godz. 10:50 według danych źródłowych. Wysokości odnoszą się do lokalnych zer wodowskazów. Nie odpowiadają na pytanie o wilgotność pola ani potrzebę jego nawodnienia.
- [Open-Meteo — wilgotność modelowa i opad](niedrzwica_koscielna_wilgotnosc_i_opady_open_meteo.json) dla okolicy miejscowości, **14–27 listopada 2026 r.** Zapis obejmuje część historyczną i prognostyczną według daty pobrania. Siatka modelu i jego poziomy głębokości mają inny zakres niż SoilGrids.

## 5. Jak złożyć analizę i co pokazać rolnikowi

1. **Ocena na dzień analizy.** Opady i zużycie wody przez uprawę zasilają dzienny bilans. Właściwości gleby służą do oszacowania zapasu w strefie korzeniowej, a satelita pomaga sprawdzić reakcję roślin. Do oszacowania pojemności polowej i punktu więdnięcia można użyć europejskich [funkcji euptfv2](https://gmd.copernicus.org/articles/14/151/2021/) i pokazać wpływ niepewności na wynik.
2. **Porównanie z historią.** Dla tych samych miesięcy lub faz uprawy system może pokazać, jak często występował niedobór w ciągu 10 lat. Przy testach historycznych obliczenia dla danego dnia nie powinny korzystać z późniejszych obserwacji tak, jakby były już znane.
3. **Uzasadnienie przyczyny.** Bilans pomaga rozpoznać niedostatek opadów i duże zużycie wody, profil wskazuje zdolność gleby do magazynowania, a mapa pokazuje, gdzie spływ może przyczyniać się do strat. Gdy dane nie pozwalają rozstrzygnąć przyczyny, raport wskazuje potrzebną obserwację.
4. **Decyzja na mapie.** Karta łączy proponowane działanie, miejsce, termin lub warunek wykonania, uzasadnienie i poziom pewności. Profil gleby stanowi rozwinięcie uzasadnienia, a nie obowiązkowy ekran do przeczytania przed podjęciem decyzji.

**Pomysł konkursowy: porównanie wariantów retencji na tej samej działce.** Rolnik może zestawić stan obecny z dwiema dostępnymi praktykami, np. pozostawieniem resztek i międzyplonem. Model uruchamia warianty dla tych samych warunków pogodowych, pokazuje szacowany wpływ na niedobór i ujawnia założenia. Dla działań przestrzennych mapa wskazuje miejsca oraz jedną obserwację, która może zmienić rekomendację. Różnica między wariantami jest wynikiem scenariusza, a ocenę rzeczywistej skuteczności trzeba zweryfikować.

**Opcjonalne ML.** Zadanie dopuszcza własny model. Najbardziej uzasadnione jest użycie go do korekty prognozy wilgotności opartej na bilansie, jeśli dostępne są wiarygodne pomiary referencyjne. Osobne dane z innych lokalizacji i okresów służą do walidacji względem bazowego modelu. Zmiany NDMI można modelować jako sygnał reakcji roślin, bez utożsamiania go z pomiarem wilgotności gleby lub skutkiem zabiegu.

**Stan prac:** zweryfikowano pobranie danych dla przykładowej działki, przygotowano profil gleby i obliczono potencjalne drogi spływu. Nie policzono jeszcze pojemności wodnej, aktualnego deficytu wody ani skuteczności działań. Brakuje także walidacji terenowej, analizy dziesięcioletniej dla działki i prototypu obsługującego dowolny numer działki i datę.
