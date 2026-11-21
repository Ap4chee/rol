import { useEffect, useRef, useState } from 'react';
import { ParcelMap } from './ParcelMap.jsx';
import { api, Button, generateReport, Icon } from './ui.jsx';
import { fieldFromReport, FULL_ID, number, oldestDate, today } from './model.js';

function describe(parcel) {
  return [parcel.region, parcel.commune && 'gm. ' + parcel.commune, parcel.voivodeship].filter(Boolean).join(', ');
}

export function AddField({ initial, onClose, onReport }) {
  const dialog = useRef(null);
  const active = useRef(null);
  const [tab, setTab] = useState('number');
  const [query, setQuery] = useState(initial?.report.request.parcel_id ?? initial?.report.parcel?.id ?? '');
  const [parcel, setParcel] = useState(initial?.report.parcel ?? null);
  const [point, setPoint] = useState(initial?.report.parcel ? null : initial?.report.request.point ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [crop, setCrop] = useState(initial?.report.crop.key ?? '');
  const [date, setDate] = useState(initial?.report.analysis_date ?? today());
  const [crops, setCrops] = useState(null);
  const [cropsError, setCropsError] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    dialog.current.showModal();
    const controller = new AbortController();
    api('/api/crops', { signal: controller.signal })
      .then(setCrops)
      .catch((err) => { if (!controller.signal.aborted) setCropsError(err.message); });
    return () => { controller.abort(); active.current?.abort(); };
  }, []);

  async function request(mode, work) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError('');
    setBusy(mode);
    try { await work(controller.signal); }
    catch (err) { if (!controller.signal.aborted) setError(err.name === 'TimeoutError' ? 'Serwer nie odpowiedział na czas. Spróbuj ponownie.' : err.message); }
    finally { if (active.current === controller) setBusy(''); }
  }

  async function getParcel(id, signal) {
    const response = await api('/api/parcels/by-id?id=' + encodeURIComponent(id), { signal });
    if (response.status !== 'ok' || !response.parcel) throw new Error(response.reason || 'Nie znaleziono działki.');
    select(response.parcel);
  }

  function select(next) {
    setParcel(next);
    setPoint(null);
    setQuery(next.id);
    setCandidates([]);
    setMessage('');
  }

  function search() {
    const input = query.trim();
    if (input.length < 2) { setError('Wpisz nazwę obrębu i numer działki.'); return; }
    setParcel(null);
    setPoint(null);
    setCandidates([]);
    setMessage('');
    request('search', async (signal) => {
      if (FULL_ID.test(input)) return getParcel(input, signal);
      const response = await api('/api/parcels/search?q=' + encodeURIComponent(input), { signal });
      if (response.status !== 'ok' || !response.candidates.length) throw new Error(response.reason || 'Nie znaleziono działki.');
      if (response.candidates.length === 1) return getParcel(response.candidates[0].id, signal);
      setCandidates(response.candidates);
      setMessage(response.truncated ? 'Wybierz działkę lub doprecyzuj nazwę obrębu.' : 'Wybierz swoją działkę z wyników.');
    });
  }

  function pick(next) {
    if (busy === 'report') return;
    if (next.lat < 48.9 || next.lat > 55 || next.lon < 14 || next.lon > 24.3) {
      setError('Wskaż miejsce w granicach Polski.');
      return;
    }
    setParcel(null);
    setPoint(null);
    setCandidates([]);
    setMessage('');
    request('search', async (signal) => {
      const response = await api('/api/parcels/by-point?' + new URLSearchParams(next), { signal });
      if (response.status === 'ok' && response.parcel) { select(response.parcel); return; }
      if (response.status === 'error') {
        setPoint(next);
        setMessage('Usługa działek jest niedostępna. Raport będzie dotyczył wskazanego punktu.');
      } else throw new Error(response.reason || 'W tym miejscu nie ma działki.');
    });
  }

  function submit(event) {
    event.preventDefault();
    if (busy || !crop || !(parcel || point)) return;
    request('report', async (signal) => {
      const result = await generateReport({ crop, date, ...(parcel ? { parcel_id: parcel.id } : { point }) }, signal);
      if (!signal.aborted) onReport(fieldFromReport(result, name));
    });
  }

  return <dialog ref={dialog} className="field-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="dialog-title">
    <header className="dialog-head">
      <h2 id="dialog-title">{initial ? 'Przelicz raport' : 'Dodaj pole'}</h2>
      <button type="button" className="quiet-button close-button" aria-label="Zamknij" onClick={onClose}><Icon name="close"/></button>
    </header>
    <form onSubmit={submit}>
      <fieldset disabled={busy === 'report'}>
        <legend className="sr-only">Dane do raportu</legend>
        <div role="group" aria-label="Sposób wyboru działki" className="segments choose-mode">
          <button type="button" aria-pressed={tab === 'number'} onClick={() => setTab('number')}>Numer działki</button>
          <button type="button" aria-pressed={tab === 'map'} onClick={() => setTab('map')}>Wskaż na mapie</button>
        </div>
        {tab === 'number' ? <>
          <label htmlFor="parcel-query">Numer działki lub obręb</label>
          <div className="input-row">
            <input id="parcel-query" autoFocus value={query} maxLength={80} autoComplete="off" enterKeyHint="search"
              placeholder="np. Niedrzwica Kościelna 580/2"
              onChange={(event) => { active.current?.abort(); setQuery(event.target.value); setParcel(null); setPoint(null); setCandidates([]); setError(''); setMessage(''); }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }}/>
            <Button icon="search" onClick={search} disabled={Boolean(busy)}>Szukaj</Button>
          </div>
          {candidates.length > 0 && <ul className="candidates">{candidates.map((item) => <li key={item.id}>
            <button type="button" onClick={() => request('search', (signal) => getParcel(item.id, signal))}>
              <strong>{item.number || item.id}</strong><small>{describe(item)} · {item.id}</small>
            </button>
          </li>)}</ul>}
        </> : <ParcelMap parcel={parcel} point={point} onPick={pick}/>}
        {parcel && <p className="selection"><Icon name="check" size={18}/> Działka {parcel.number || parcel.id}
          {describe(parcel) ? ' · ' + describe(parcel) : ''} · {number(parcel.area_ha, 2)} ha</p>}
        {point && <p className="selection"><Icon name="pin" size={18}/> Punkt · {number(point.lat, 4)}° N, {number(point.lon, 4)}° E</p>}
        {message && <p className="subtle" role="status">{message}</p>}
        <label htmlFor="field-name">Nazwa pola <small>(opcjonalnie)</small></label>
        <input id="field-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="np. Pod lasem"/>
        <div className="form-grid">
          <div className="form-control"><label htmlFor="crop">Uprawa</label>
            <select id="crop" required value={crop} onChange={(event) => setCrop(event.target.value)} disabled={!crops}>
              <option value="">{crops ? 'Wybierz uprawę' : 'Ładowanie upraw…'}</option>
              {crops?.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
            </select>
          </div>
          <div className="form-control"><label htmlFor="analysis-date">Data analizy</label>
            <input id="analysis-date" required type="date" value={date} min={oldestDate()} max={today()} onChange={(event) => setDate(event.target.value)}/>
          </div>
        </div>
      </fieldset>
      {cropsError && <p className="note error" role="alert">Nie udało się pobrać upraw. {cropsError}</p>}
      {error && <p className="note error" role="alert">{error}</p>}
      {busy && <p className="note" role="status">{busy === 'report' ? 'Pobieram dane działki i liczę bilans wodny…' : 'Sprawdzam działkę…'}</p>}
      <div className="dialog-actions">
        <Button onClick={onClose}>Anuluj</Button>
        <Button className="primary" icon="arrow" type="submit" disabled={Boolean(busy) || !(parcel || point) || !crop}>Przygotuj raport</Button>
      </div>
    </form>
  </dialog>;
}
