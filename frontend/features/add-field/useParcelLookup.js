import { useEffect, useReducer, useRef, useState } from 'react';
import { parcelAtPoint, parcelById, searchAddresses, searchParcels } from '@/api/endpoints';
import { errorText } from './logic.js';
import { FULL_ID, initialSelection, insidePoland, OUTSIDE_AREA, QUERY_TOO_SHORT, selectionReducer } from './parcelSelection.js';

/** Odpowiedź usługi działek → zdarzenie wyboru (działka, brak działki albo błąd usługi). */
async function reportParcel(id, signal, report) {
  const response = await parcelById(id, signal);
  if (response.status === 'ok' && response.parcel) report({ type: 'selected', parcel: response.parcel });
  else if (response.status === 'no_data') report({ type: 'notFound', text: response.reason || 'Nie znaleziono działki.' });
  else report({ type: 'failed', text: response.reason || 'Usługa działek nie odpowiedziała.' });
}

/** Wyszukanie po adresie: jedno miejsce przybliża mapę, kilka to lista do wyboru. */
async function findAddress(input, signal, report) {
  const list = await searchAddresses(input, signal);
  if (list.length === 1) report({ type: 'located', location: list[0] });
  else if (list.length) report({ type: 'candidates', list, address: true });
  else report({ type: 'notFound', text: 'Brak wyników. Spróbuj wpisać miejscowość lub dopisz nazwę ulicy.' });
}

/** Wyszukanie po obrębie i numerze: jedna działka od razu wybrana, kilka to lista do wyboru. */
async function findParcel(input, signal, report) {
  const response = await searchParcels(input, signal);
  if (response.status === 'ok' && response.candidates.length === 1) return reportParcel(response.candidates[0].id, signal, report);
  if (response.status === 'ok' && response.candidates.length) {
    report({ type: 'candidates', list: response.candidates, truncated: response.truncated });
  } else if (response.status === 'error') report({ type: 'failed', text: response.reason || 'Usługa działek nie odpowiedziała.' });
  else report({ type: 'notFound', text: response.reason || 'Nie znaleziono działki.' });
}

/**
 * Wskazywanie działki w formularzu: wyszukiwarka (adres albo numer), lista kandydatów i klik na mapie.
 * Stan i reguły są w parcelSelection.js; tu zapytania i to, że każde nowe wskazanie przerywa poprzednie.
 * `onLookup` czyści stan formularza przy nowym wskazaniu, `onEdit` przy samej edycji tekstu.
 */
export function useParcelLookup(initial, { onLookup, onEdit }) {
  const active = useRef(null);
  const lookups = useRef(0);   // licznik wskazań działki: odpowiedź starszego zapytania jest pomijana
  const [selection, dispatch] = useReducer(selectionReducer, initial, initialSelection);
  const [searchMode, setSearchMode] = useState(initial ? 'parcel' : 'address');
  const { query, parcel, savedParcelId } = selection;

  useEffect(() => () => active.current?.abort(), []);

  /** Anuluje trwające zapytanie (działka albo zapis pola) i daje sygnał nowemu. */
  function takeOver() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    return controller;
  }

  /** Nowe wskazanie działki: unieważnia poprzedni wybór i trwające sprawdzanie. */
  function lookup(work, keepCandidates = false) {
    const controller = takeOver();
    const seq = ++lookups.current;
    onLookup();
    dispatch({ type: 'start', seq, keepCandidates });
    work(controller.signal, (event) => { if (!controller.signal.aborted) dispatch({ ...event, seq }); })
      .catch((err) => { if (!controller.signal.aborted) dispatch({ type: 'failed', seq, text: errorText(err) }); });
  }

  function reject(text) {
    active.current?.abort();
    dispatch({ type: 'reject', seq: ++lookups.current, text });
  }

  function edit(value) {
    active.current?.abort();
    onEdit();
    dispatch({ type: 'edit', seq: ++lookups.current, query: value });
  }

  function switchSearchMode(mode) {
    if (mode === searchMode) return;
    active.current?.abort();
    setSearchMode(mode);
    dispatch({ type: 'mode', seq: ++lookups.current, query: mode === 'parcel' ? parcel?.id ?? savedParcelId ?? '' : '' });
  }

  function search() {
    const input = query.trim();
    const addressSearch = searchMode === 'address' && !FULL_ID.test(input);
    if (input.length < 2) { reject(addressSearch ? 'Wpisz adres lub nazwę miejscowości.' : QUERY_TOO_SHORT); return; }
    lookup(async (signal, report) => {
      if (FULL_ID.test(input)) return reportParcel(input, signal, report);
      return addressSearch ? findAddress(input, signal, report) : findParcel(input, signal, report);
    });
  }

  function choose(item) {
    if (item.point) dispatch({ type: 'located', seq: selection.seq, location: item });
    else lookup((signal, report) => reportParcel(item.id, signal, report), true);
  }

  /** Klik na mapie ({ lat, lon }, EPSG:4326): działka w tym miejscu, a gdy usługa działek nie działa, sam punkt. */
  function pick(next) {
    if (!insidePoland(next)) { reject(OUTSIDE_AREA); return; }
    lookup(async (signal, report) => {
      const response = await parcelAtPoint(next, signal);
      if (response.status === 'ok' && response.parcel) report({ type: 'selected', parcel: response.parcel, fromMap: true });
      else if (response.status === 'error') report({ type: 'pointOnly', point: next });
      else report({ type: 'notFound', text: response.reason || 'W tym miejscu nie ma działki.' });
    });
  }

  return { selection, searchMode, search, edit, choose, pick, switchSearchMode, takeOver, active };
}
