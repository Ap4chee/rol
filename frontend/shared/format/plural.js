// Polska liczba mnoga: 1 pole, 2–4 pola (ale 12–14 pól), 5 pól, 22 pola.

/** Czy `n` bierze formę „kilka” (2–4, 22–24…, bez 12–14). */
export const isFew = (n) => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);

/** Forma słowa dla liczby `n`: `one` dla 1, `few` dla 2–4 (bez 12–14), `many` dla reszty. */
export const plural = (n, one, few, many) => (n === 1 ? one : isFew(n) ? few : many);

/** „1 pole”, „3 pola”, „12 pól”, „22 pola”. */
export const fieldsCount = (n) => `${n} ${plural(n, 'pole', 'pola', 'pól')}`;
