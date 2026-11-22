// Nazwy zakładek raportu i kolejność części w PDF. Kolejność zakładek na ekranie jest w app/router.js (TABS).

export const TAB_LABELS = { podsumowanie: 'Podsumowanie', rekomendacje: 'Rekomendacje', prace: 'Prace polowe', gleba: 'Gleba',
  pogoda: 'Pogoda', teren: 'Teren i woda', historia: 'Historia', zrodla: 'Źródła' };

// „Prace polowe” nie trafiają do PDF: to plan z bieżącej prognozy, a nie część raportu na datę analizy
// kolejność w PDF: ocena → przyczyny → rekomendacje → źródła (narzucona przez zadanie)
export const PRINT_ORDER = ['podsumowanie', 'historia', 'pogoda', 'gleba', 'teren', 'rekomendacje', 'zrodla'];
