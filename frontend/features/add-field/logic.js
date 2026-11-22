// Reguły formularza pola, które nie dotyczą samego wyboru działki (ten jest w parcelSelection.js). Bez Reacta.

/** Uprawa bez siewu i zbioru: na łące nie pytamy o terminy sezonu. */
const NO_TIMELINE_CROP = 'grassland';

/** Czy uprawa ma terminy sezonu (siew, zbiór, kolejny siew). */
export const usesTimeline = (crop) => crop !== NO_TIMELINE_CROP;

/** Błędy kolejności terminów: zbiór po siewie, kolejny siew po zbiorze (albo po siewie, gdy zbioru brak). */
export function timelineErrors({ crop, sowingDate, harvestDate, nextSowingDate }) {
  if (!usesTimeline(crop)) return { harvest: '', nextSowing: '' };
  const harvest = sowingDate && harvestDate && harvestDate <= sowingDate ? 'Zbiór musi przypadać po siewie lub sadzeniu.' : '';
  const preceding = harvestDate || sowingDate;
  const nextSowing = preceding && nextSowingDate && nextSowingDate <= preceding ? 'Kolejny siew musi przypadać po zbiorze.' : '';
  return { harvest, nextSowing };
}

/** Napis na przycisku zapisu: nowe pole, sama zmiana nazwy, zapis bez liczenia albo z przeliczeniem raportu. */
export function submitLabel({ editing, renameOnly, sameInputs }) {
  if (!editing) return 'Dodaj pole';
  if (renameOnly) return 'Zapisz nazwę';
  return sameInputs ? 'Zapisz' : 'Zapisz i przelicz';
}

/** Położenie działki słowami: obręb, gmina, województwo (to, co serwer zna). */
export function describeParcel(parcel) {
  return [parcel.region, parcel.commune && 'gm. ' + parcel.commune, parcel.voivodeship].filter(Boolean).join(', ');
}

/** Przewodnik pod wyszukiwarką: trzy kroki wskazania pola, odhaczane w miarę postępu; `at` to pierwszy nieodhaczony. */
export function placeGuide({ found, chosen }) {
  const steps = [
    { label: 'Znajdź miejsce', text: 'Wpisz adres albo numer działki, albo kliknij województwo na mapie.', done: found },
    { label: 'Wskaż pole na mapie', text: 'Kliknij swoją działkę na zdjęciu lotniczym.', done: chosen },
    { label: 'Sprawdź i przejdź dalej', text: 'Zobaczysz numer działki i powierzchnię.', done: false },
  ];
  return { steps, at: steps.findIndex((item) => !item.done) };
}

/** Komunikat błędu sieci dla rolnika: przekroczenie czasu mówimy po ludzku, resztę podaje serwer. */
export const errorText = (err) => (err.name === 'TimeoutError' ? 'Serwer nie odpowiedział na czas. Spróbuj ponownie.' : err.message);
