import { useEffect, useState } from 'react';

// Pierwsze wejście bloku: krótko w górę z przezroczystości. Przy ograniczonym ruchu samo przenikanie, bez przesunięcia.
export const RISE = 'animate-rise motion-reduce:animate-in motion-reduce:fade-in motion-reduce:fill-mode-both';
// Kaskada kart przy wejściu na pulpit: nierówne odstępy (ms); od siódmej karty bez dalszej zwłoki.
const STAGGER = [0, 50, 90, 120, 145, 165];
// karty wchodzą chwilę po nagłówku i pasku stanów
const CARDS_DELAY_MS = 80;

export const riseDelay = (ms) => ({ animationDelay: `${ms}ms` });

/** Opóźnienie wejścia i-tej karty pola. */
export const cardDelay = (i) => riseDelay(CARDS_DELAY_MS + STAGGER[Math.min(i, STAGGER.length - 1)]);

// Stan na całą sesję strony, nie na jedno zamontowanie pulpitu: po powrocie z raportu pulpit jest od razu na miejscu.
let introPlayed = false;

/** Czy pokazać wejście pulpitu (kaskada kart, pasek, liczniki). Zalicza się dopiero, gdy są pola do pokazania. */
export function useIntroOnce(hasContent) {
  const [intro] = useState(() => !introPlayed);
  useEffect(() => { if (hasContent) introPlayed = true; }, [hasContent]);
  return intro;
}
