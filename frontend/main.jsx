import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AddField } from './AddField.jsx';
import { Dashboard } from './Dashboard.jsx';
import { Report } from './Report.jsx';
import { fieldFromReport, fieldHref, readFields, route, STORAGE_KEY, upsertField } from './model.js';
import { Button, generateReport, Icon } from './ui.jsx';
import './style.css';

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    function change() { setHash(window.location.hash); }
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return hash;
}

function App() {
  const [fields, setFields] = useState(() => {
    try { return readFields(window.localStorage); } catch { return []; }
  });
  const currentFields = useRef(fields);
  const [preview, setPreview] = useState(null);
  const [modal, setModal] = useState(null);
  const [message, setMessage] = useState('');
  const [shared, setShared] = useState(() => new URLSearchParams(window.location.search).has('parcel') ? 'loading' : '');
  const hash = useHash();
  const [path, anchor] = hash.slice(1).split('#');
  const current = route('#' + path);
  const field = current === 'preview' ? preview : fields.find((entry) => entry.id === current);

  const persist = useCallback((next) => {
    currentFields.current = next;
    setFields(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setMessage('');
      return true;
    } catch {
      setMessage('Przeglądarka nie mogła zapisać danych. Pola są dostępne do zamknięcia tej strony.');
      return false;
    }
  }, []);

  const onSatellite = useCallback((id, generatedAt, result) => {
    const merge = (entry) => ({
      ...entry, report: { ...entry.report, satellite: result.satellite,
        sources: result.source ? [...entry.report.sources.filter((s) => s.key !== result.source.key), result.source] : entry.report.sources,
        recommendations: { ...entry.report.recommendations, field_checks: [...new Map([
          ...entry.report.recommendations.field_checks, ...(result.field_checks ?? []),
        ].map((item) => [item.key, item])).values()] },
      },
    });
    const saved = currentFields.current.find((field) => field.id === id && field.report.generated_at === generatedAt);
    if (saved) persist(upsertField(currentFields.current, merge(saved)));
    setPreview((field) => field?.id === id && field.report.generated_at === generatedAt ? merge(field) : field);
  }, [persist]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const parcelId = params.get('parcel'), crop = params.get('crop'), date = params.get('date');
    if (!parcelId) return;
    const controller = new AbortController();
    if (!(crop && date)) {
      setShared('Link do raportu musi zawierać numer działki, uprawę i datę.');
      return () => controller.abort();
    }
    generateReport({ parcel_id: parcelId, crop, date }, controller.signal).then((report) => {
      setPreview(fieldFromReport(report));
      setShared('');
      window.location.hash = 'podglad';
    }).catch((error) => { if (!controller.signal.aborted) setShared(error.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, [current, anchor, field?.id]);

  function add(field) {
    const saved = persist(upsertField(currentFields.current, field));
    setModal(null);
    window.location.hash = fieldHref(field.id);
    return saved;
  }

  return <>
    <a className="skip-link" href="#main-content" onClick={(event) => {
      event.preventDefault();
      document.getElementById('main-content').focus();
    }}>Przejdź do treści</a>
    <header className="app-header no-print">
      <div className="layout header-inner">
        <a className="brand" href="/"><Icon name="brand" size={25}/> Asystent wody</a>
      </div>
    </header>
    <main className="layout" id="main-content" tabIndex={-1}>
      {message && <p className="note error no-print" role="alert">{message}</p>}
      {shared === 'loading' ? <p className="note" role="status">Pobieram dane i liczę raport dla wskazanej działki…</p> : <>
        {shared && <p className="note error" role="alert">{shared}</p>}
        {field ? <Report key={field.id + field.report.generated_at} field={field} onEdit={() => setModal({ field })}
          onSave={add} onSatellite={onSatellite} saved={fields.some((entry) => entry.id === field.id)}/>
          : <><Dashboard fields={fields} onAdd={() => setModal({})}/>
            {current && <p className="note">Nie znaleziono raportu w tej przeglądarce. <Button onClick={() => setModal({})}>Dodaj pole</Button></p>}</>}
      </>}
    </main>
    <footer className="layout footer no-print"><span>Asystent wody</span><span>Wynik jest szacunkiem z modeli i otwartych danych.</span></footer>
    {modal && <AddField initial={modal.field} onClose={() => setModal(null)} onReport={add}/>}
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
