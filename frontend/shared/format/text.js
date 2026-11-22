/** Pierwsza litera wielka, reszta bez zmian; pusty tekst zostaje pusty. */
export const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
