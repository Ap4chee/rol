# Ilustracje warstw gleby

Zestaw do widoku profilu w aplikacji wspierającej gospodarowanie wodą. Każda ilustracja pokazuje pojedynczą warstwę w tej samej perspektywie. Pliki mają wspólne wymiary i przezroczyste tło.

| Nazwa pliku | Etykieta | Klucz |
|---|---|---|
| sand | Piasek | `sand` |
| sandy-loam | Glina piaszczysta | `sandy_loam` |
| loam | Glina | `loam` |
| silt-loam | Glina pylasta | `silt_loam` |
| clay | Ił | `clay` |
| peat | Gleba torfowa | `peat` |

Folder `webp/` zawiera pliki do użycia w aplikacji. Folder `png/` zawiera wersje do dalszej edycji. Pliki w obu formatach mają 1200 × 400 px.

Pięć warstw mineralnych reprezentuje wybrane klasy uziarnienia USDA. Dobieraj je na podstawie udziału piasku, pyłu i iłu w danej warstwie. [Klasyfikacja USDA](https://www.nrcs.usda.gov/resources/education-and-teaching-materials/soil-texture-calculator)

Gleba torfowa to osobna ilustracja. Dobieraj ją wtedy, gdy rozpoznanie gleby wskazuje torf. Pojedyncza wartość węgla organicznego z SoilGrids nie wystarcza do takiego przypisania.

Kolory i faktury są umowne. W interfejsie obok ilustracji wyświetl nazwę, faktyczny przedział głębokości i dane dla warstwy. Informację o wilgotności lub zasobie wody pokaż oddzielnie. Ilustracje wygenerowano narzędziem ImageGen. Treści użytych promptów są w pliku `prompty.txt`.
