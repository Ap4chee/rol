import { useEffect, useState } from 'react';
import { reportPart } from '@/api/endpoints';
import { completeReport, nextStep, POLL_DELAY_MS } from './completion.js';

/** Jedna część liczona osobno: zapytanie, ponowne zapytania przy „pending”, ponowienie na żądanie. */
function usePart(kind, endpoint) {
  const [state, setState] = useState({ result: null, failure: '', exhausted: false });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!endpoint) return undefined;
    const controller = new AbortController();
    let timer = null;
    let polls = 0;
    setState({ result: null, failure: '', exhausted: false });
    const ask = () => reportPart(kind, endpoint, controller.signal).then((result) => {
      if (controller.signal.aborted) return;   // spóźniona odpowiedź po zmianie raportu
      const step = nextStep(kind, result, polls);
      setState({ result, failure: '', exhausted: step === 'exhausted' });
      if (step === 'poll') { polls += 1; timer = setTimeout(ask, POLL_DELAY_MS); }
    }).catch((error) => {
      if (!controller.signal.aborted) setState((prev) => ({ ...prev, failure: error.message }));
    });
    ask();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [kind, endpoint, tries]);
  return { ...state, retry: () => setTries((n) => n + 1) };
}

/**
 * Uzupełnianie raportu: jedna scalona wersja dla ekranu, wydruku i zapisu.
 * `onSatelliteSettled(result)` dostaje ostateczny wynik satelitarny (do zapisu w przeglądarce). Teren nie jest
 * zapisywany: serwer trzyma go w pamięci podręcznej po działce i raport dociąga go przy każdym otwarciu.
 */
export function useReportCompletion(report, onSatelliteSettled) {
  const sat = usePart('satellite', report.satellite?.endpoint);
  const topo = usePart('terrain', report.terrain?.endpoint);
  const settled = sat.result && nextStep('satellite', sat.result, 0) === 'done' ? sat.result : null;
  useEffect(() => { if (settled) onSatelliteSettled(settled); }, [settled, onSatelliteSettled]);
  // „Ponów” przy błędzie połączenia, błędzie zgłoszonym przez serwer i po wyczerpaniu prób przy „pending”
  const control = (part, endpoint) => ({ failed: part.failure || part.exhausted, retry: part.retry, canRetry: Boolean(endpoint) });
  return {
    report: completeReport(report, sat, topo),
    satellite: control(sat, report.satellite?.endpoint),
    terrain: control(topo, report.terrain?.endpoint),
  };
}
