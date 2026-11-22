/**
 * Wybór działki w formularzu: tekst, kandydaci, punkt z mapy i ważność wyboru w jednym miejscu.
 *
 * Zasady (decyzja zespołu):
 * - każde nowe wskazanie (edycja tekstu, wyszukanie, klik na mapie, wybór z listy) unieważnia poprzedni wybór
 *   i anuluje trwające sprawdzanie; spóźniona odpowiedź starego zapytania niczego nie zmienia;
 * - klik poza obsługiwanym obszarem też jest nowym wskazaniem: czyści poprzedni wybór, więc formularz
 *   nie jest gotowy do analizy, dopóki rolnik nie wskaże poprawnego miejsca;
 * - „brak działki” (usługa odpowiedziała, nic nie znalazła) to nie to samo co błąd usługi.
 *
 * Czyste funkcje bez Reacta i sieci (testy: parcelSelection.test.js). Zapytania wykonuje AddField.jsx.
 */

export const POLAND_BOUNDS = { minLat: 48.9, maxLat: 55, minLon: 14, maxLon: 24.3 };
export const OUTSIDE_AREA = 'Wskaż miejsce w granicach Polski.';
export const QUERY_TOO_SHORT = 'Wpisz nazwę obrębu i numer działki.';
export const POINT_ONLY = 'Usługa działek jest niedostępna. Raport będzie dotyczył wskazanego punktu.';

/** Stan początkowy (także przy przeliczaniu zapisanego pola). */
export function initialSelection(initial) {
  const report = initial?.report;
  const input = initial?.input;   // dane pola z serwera: są także, zanim policzy się pierwszy raport
  const parcel = input?.test ? null : report?.parcel ?? null;   // obrys testowy to nie działka
  return {
    query: input?.parcel_id ?? report?.request.parcel_id ?? report?.parcel?.id ?? '',
    parcel,
    savedParcelId: !parcel ? input?.parcel_id ?? null : null,
    point: parcel ? null : input?.point ?? report?.request.point ?? null,
    location: null,
    candidates: [], truncated: false,
    message: '',
    problem: null,          // { kind: 'not_found' | 'failure', text }
    checking: false,        // trwa sprawdzanie działki (wyszukanie, klik, wybór z listy)
    seq: 0,                 // numer bieżącego zapytania; odpowiedź z innym numerem jest spóźniona
  };
}

export function insidePoland({ lat, lon }) {
  const b = POLAND_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

/** Wybór gotowy do analizy: działka albo punkt (gdy usługa działek nie odpowiada), bez trwającego sprawdzania. */
export function isReady(state) {
  return !state.checking && Boolean(state.parcel || state.savedParcelId || state.point);
}

const RESPONSES = new Set(['candidates', 'located', 'selected', 'pointOnly', 'notFound', 'failed']);
const cleared = { parcel: null, savedParcelId: null, point: null, candidates: [], truncated: false, message: '', problem: null };

/**
 * Przejścia stanu. Każde nowe wskazanie ustala `seq` (numer z licznika w komponencie); odpowiedzi serwera niosą
 * `seq` swojego zapytania i są pomijane, gdy w międzyczasie było nowsze wskazanie.
 *  edit {seq, query}     — rolnik zmienia tekst
 *  start {seq, keepCandidates} — rusza sprawdzanie (wyszukanie, klik; wybór z listy zostawia listę)
 *  reject {seq, text}    — wskazanie odrzucone przed zapytaniem (klik poza Polską, za krótki tekst)
 *  candidates {seq, list, truncated}
 *  selected {seq, parcel}
 *  pointOnly {seq, point} — usługa działek nie działa, raport dla punktu
 *  notFound {seq, text}   — usługa odpowiedziała, brak działki
 *  failed {seq, text}     — błąd usługi albo połączenia
 */
export function selectionReducer(state, event) {
  if (RESPONSES.has(event.type) && event.seq !== state.seq) return state;   // spóźniona odpowiedź
  switch (event.type) {
    case 'mode':
      return { ...state, query: event.query, location: null, candidates: [], truncated: false, message: '', problem: null,
        checking: false, seq: event.seq };
    case 'edit':
      return { ...state, ...cleared, query: event.query, checking: false, seq: event.seq };
    case 'start':
      return { ...state, ...cleared, candidates: event.keepCandidates ? state.candidates : [],
        truncated: event.keepCandidates ? state.truncated : false, checking: true, seq: event.seq };
    case 'reject':
      return { ...state, ...cleared, checking: false, seq: event.seq, problem: { kind: 'failure', text: event.text } };
    case 'candidates':
      return { ...state, checking: false, candidates: event.list, truncated: Boolean(event.truncated),
        message: event.address ? 'Wybierz miejsce z wyników.' : event.truncated
          ? 'Wybierz działkę lub doprecyzuj nazwę obrębu.' : 'Wybierz swoją działkę z wyników.' };
    case 'located':
      return { ...state, ...cleared, checking: false, location: event.location, query: event.location.label };
    case 'selected':
      return { ...state, ...cleared, checking: false, parcel: event.parcel,
        query: event.fromMap && state.location ? state.query : event.parcel.id };
    case 'pointOnly':
      return { ...state, ...cleared, checking: false, point: event.point, message: POINT_ONLY };
    case 'notFound':   // lista kandydatów zostaje: rolnik może wybrać inną pozycję
      return { ...state, checking: false, problem: { kind: 'not_found', text: event.text } };
    case 'failed':
      return { ...state, checking: false, problem: { kind: 'failure', text: event.text } };
    default:
      return state;
  }
}
