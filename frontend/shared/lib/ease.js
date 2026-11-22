// Wspólne krzywe ruchu, za Spectrum UI (https://spectrumhq.in), licencja Apache-2.0 (shared/vendor/spectrumui/LICENSE).
// Zostały tylko te, których używamy; krzywe w CSS są w styles/app.css.

/** Mocne wyhamowanie na końcu: domyślne `ease-out` jest przy krótkich wejściach za miękkie. */
export const EASE_OUT = [0.16, 1, 0.3, 1];

/** Reakcja na wciśnięcie przycisku. */
export const SPRING_PRESS = { type: 'spring', stiffness: 500, damping: 30, mass: 0.6 };

/** Przesunięcie elementu między pozycjami (karuzela prognozy). */
export const SPRING_LAYOUT = { type: 'spring', stiffness: 360, damping: 32, mass: 0.6 };
