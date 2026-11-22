// Liczby po polsku do tekstu na ekranie. Same formaty, bez wiedzy o raporcie.

/** Liczba z przecinkiem dziesiętnym i spacją tysięcy; „—”, gdy wartości nie ma. Bliskie zera bez „-0”. */
export const number = (value, digits = 0) => Number.isFinite(value)
  ? (Math.abs(value) < .5 * 10 ** -digits ? 0 : value).toLocaleString('pl-PL', { maximumFractionDigits: digits }) : '—';

/** Typograficzny minus zamiast dywizu (−1°, nie -1°); zmienia tylko pierwszy znak minus w tekście. */
export const minus = (text) => text.replace('-', '−');

/** Milimetry wody, np. „12 mm”. */
export const mm = (value, digits = 0) => `${number(value, digits)} mm`;

/** Temperatura w stopniach z typograficznym minusem, np. „−3°”. */
export const degrees = (value) => `${minus(number(value))}°`;

/** Liczba zawsze z `digits` miejscami po przecinku (np. „0,20”), żeby wartości w kolumnie się nie rozjeżdżały. */
export const fixed = (value, digits) => (Number.isFinite(value)
  ? value.toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—');
