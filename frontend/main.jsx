import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Menu, Plus } from 'lucide-react';
import { LoadingState } from '@/components/spectrumui/loading-state';
import {
  ResponsiveModal, ResponsiveModalContent, ResponsiveModalTitle, ResponsiveModalTrigger,
} from '@/components/spectrumui/responsive-modal';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { ToastProvider } from '@/components/ui/toaster';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { AddFieldForm } from './AddField.jsx';
import { Dashboard } from './Dashboard.jsx';
import { Report } from './Report.jsx';
import { Brand, Sidebar } from './Sidebar.jsx';
import { dateText, fieldFromReport, fieldHref, fieldTabHref, readFields, routeTab, STORAGE_KEY, upsertField } from './model.js';
import { generateReport } from './ui.jsx';

const COMPACT_KEY = 'kowr.sidebar-compact';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Komputer od 768 px (jak `md:` w Tailwind): menu jest stałym paskiem bocznym; niżej szufladą z lewej.
const desktopQuery = window.matchMedia('(min-width: 48rem)');
function subscribeDesktop(notify) {
  desktopQuery.addEventListener('change', notify);
  return () => desktopQuery.removeEventListener('change', notify);
}
function useDesktop() {
  return useSyncExternalStore(subscribeDesktop, () => desktopQuery.matches);
}

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    function change() { setHash(window.location.hash); }
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return hash;
}

/** Raport z udostępnionego linku w trakcie liczenia: pikselowy wskaźnik z licznikiem czasu na środku panelu. */
function SharedLoading() {
  const params = new URLSearchParams(window.location.search);
  const parcel = params.get('parcel'), date = params.get('date');
  return <div className="grid flex-1 place-items-center py-16">
    <div className="flex max-w-full flex-col items-center gap-3 text-center">
      <p role="status" className="sr-only">Pobieram dane i liczę raport dla wskazanej działki…</p>
      {/* licznik odświeża się co 0,1 s, więc część wizualna jest ukryta przed czytnikami (komunikat jest wyżej);
          na wąskim ekranie podpis łamie się do lewej, a licznik (ostatni element) zostaje w jednej linii */}
      <div aria-hidden className="max-w-full">
        <LoadingState label="Pobieram dane i liczę raport dla wskazanej działki"
          className="max-w-full text-left [&>span:last-child]:whitespace-nowrap [&>span:nth-of-type(2)]:text-balance"/>
      </div>
      <p className="num wrap-anywhere font-mono text-[12px] text-neutral-500">
        Działka {parcel}{ISO_DATE.test(date ?? '') && <> · {dateText(date)}</>}
      </p>
    </div>
  </div>;
}

/** Adres wskazuje pole, którego nie ma w zapisanych w tej przeglądarce. */
function NotFound({ onAdd }) {
  return <Callout tone="neutral" className="mb-6 [&>div]:flex-1">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
      <div className="min-w-0">
        <p className="font-medium text-neutral-900">Nie znaleziono raportu w tej przeglądarce.</p>
        <p className="mt-0.5 text-neutral-500">Zapisane pola są przechowywane tylko w przeglądarce, w której je dodano.</p>
      </div>
      {/* pseudo-element powiększa cel dotyku do 40 px bez powiększania przycisku */}
      <Button variant="secondary" size="sm" icon={<Plus/>} onClick={onAdd} className="after:absolute after:-inset-1">Dodaj pole</Button>
    </div>
  </Callout>;
}

function Footer() {
  return <footer className="no-print mx-auto w-full max-w-[1180px] px-4 md:px-8 lg:px-10">
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-black/[0.06] py-5 text-[12.5px] leading-snug">
      <p className="font-medium text-neutral-700">Asystent wody</p>
      <p className="text-neutral-500">Wynik jest szacunkiem z modeli i otwartych danych.</p>
    </div>
  </footer>;
}

function App() {
  const [fields, setFields] = useState(() => {
    try { return readFields(window.localStorage); } catch { return []; }
  });
  const currentFields = useRef(fields);
  const [preview, setPreview] = useState(null);
  // Modal dodawania/przeliczania. Po zamknięciu `field` zostaje, żeby tytuł i treść nie podmieniały się
  // w trakcie animacji wyjścia; `seq` daje świeży formularz przy każdym otwarciu.
  const [modal, setModal] = useState({ open: false, field: undefined, seq: 0 });
  const [message, setMessage] = useState('');
  const [shared, setShared] = useState(() => new URLSearchParams(window.location.search).get('parcel') ? 'loading' : '');
  const hash = useHash();
  const { id: current, tab } = routeTab(hash);
  const field = current === 'preview' ? preview : fields.find((entry) => entry.id === current);
  const page = field ? 'field' : 'dashboard';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compactPref, setCompactPref] = useState(() => { try { return localStorage.getItem(COMPACT_KEY) === '1'; } catch { return false; } });
  const desktop = useDesktop();
  const compact = compactPref && desktop;   // na telefonie menu jest szufladą, zawsze pełną

  function toggleCompact() {
    const next = !compactPref;
    setCompactPref(next);
    try { localStorage.setItem(COMPACT_KEY, next ? '1' : '0'); } catch { /* tylko wygoda, bez zapisu też działa */ }
  }

  const openModal = useCallback((entry) => setModal((state) => ({ open: true, field: entry, seq: state.seq + 1 })), []);
  const closeModal = useCallback(() => setModal((state) => (state.open ? { ...state, open: false } : state)), []);

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

  useEffect(() => { window.scrollTo(0, 0); }, [page, field?.id]);
  useEffect(() => {   // stary adres #dodaj otwiera modal dodawania
    if (hash === '#dodaj') { openModal(); window.history.replaceState(null, '', '#'); }
  }, [hash, openModal]);
  useEffect(() => {   // szuflada istnieje tylko na telefonie: po poszerzeniu okna zamykamy ją
    if (desktop) setMobileOpen(false);
  }, [desktop]);

  function add(entry) {
    const saved = persist(upsertField(currentFields.current, entry));
    closeModal();
    window.location.hash = fieldHref(entry.id);
    return saved;
  }

  const closeMenu = () => setMobileOpen(false);
  const addField = () => openModal();

  // Układ: na komputerze menu na tle strony (bez ramki), treść na białym panelu z marginesem; na telefonie
  // górny pasek (stała wysokość, udostępniona jako --app-header dla przyklejanych pasków niżej) i treść na całą szerokość.
  // Szerokość menu zmienia się tylko po kliknięciu (rzadko), więc krótkie przejście kolumny siatki jest w porządku.
  return <div style={{ '--sidebar': compact ? '68px' : '248px' }}
    className="min-h-svh [--app-header:3.5rem] md:grid md:grid-cols-[var(--sidebar)_minmax(0,1fr)] md:[--app-header:0px] print:block!">
    {/* bez zmiany adresu: hash służy do przełączania widoków */}
    <a href="#main-content" onClick={(event) => {
      event.preventDefault();
      document.getElementById('main-content').focus();
    }} className="no-print fixed left-3 top-3 z-[100] -translate-y-[200%] rounded-[10px] bg-white px-3.5 py-2 text-[13.5px] font-medium text-neutral-900 shadow-raised ring-1 ring-black/[0.08] focus:translate-y-0">
      Przejdź do treści
    </a>

    <ResponsiveModal open={mobileOpen} onOpenChange={setMobileOpen}>
      <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-0.5 border-b border-black/[0.06] bg-canvas/90 px-2 backdrop-blur-md md:hidden">
        <Tooltip label="Menu">
          <ResponsiveModalTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Otwórz menu"><Menu strokeWidth={1.9}/></Button>
          </ResponsiveModalTrigger>
        </Tooltip>
        <Brand/>
      </header>
      {/* szuflada z lewej (od strony przycisku), w tle strony, z tym samym menu co na komputerze */}
      <ResponsiveModalContent side="left" aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // fokus na bieżącej pozycji menu: Radix pomija linki i trafiałby od razu w „Dodaj pole”
          const target = event.currentTarget?.querySelector?.('nav [aria-current="page"], nav a, nav button');
          if (target) { event.preventDefault(); target.focus(); }
        }}
        className="no-print w-[84vw] max-w-[300px] border-r-0 bg-canvas p-0 sm:max-w-[300px] [&>button]:top-[14px] [&>span]:hidden">
        <ResponsiveModalTitle className="sr-only">Menu</ResponsiveModalTitle>
        <Sidebar page={page} compact={false} onToggle={toggleCompact} onNavigate={closeMenu} onAdd={addField}/>
      </ResponsiveModalContent>
    </ResponsiveModal>

    <div className="no-print hidden overflow-hidden md:sticky md:top-0 md:block md:h-svh md:self-start">
      <Sidebar page={page} compact={compact} onToggle={toggleCompact} onNavigate={closeMenu} onAdd={addField}/>
    </div>

    <div className="print-plain flex min-h-[calc(100svh_-_var(--app-header))] min-w-0 flex-col overflow-x-clip bg-white md:my-2 md:mr-2 md:min-h-[calc(100svh_-_1rem)] md:rounded-2xl md:border md:border-black/[0.06] md:shadow-hairline print:min-h-0!">
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
        <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 py-6 md:px-8 md:py-10 lg:px-10 print:max-w-none! print:p-0!">
          {message && <Callout tone="danger" role="alert" className="no-print mb-6">{message}</Callout>}
          {shared === 'loading' ? <SharedLoading/> : <>
            {shared && <Callout tone="danger" role="alert" title="Nie udało się otworzyć raportu z linku" className="mb-6">{shared}</Callout>}
            {page === 'field' ? <Report key={field.id + field.report.generated_at} field={field} tab={tab}
              onTab={(next) => { window.location.hash = fieldTabHref(current, next); }} onEdit={() => openModal(field)}
              onSave={add} onSatellite={onSatellite} saved={fields.some((entry) => entry.id === field.id)}/>
              : <>
                {current && <NotFound onAdd={addField}/>}
                <Dashboard fields={fields} onAdd={addField}/>
              </>}
          </>}
        </div>
      </main>
      <Footer/>
    </div>

    <Dialog open={modal.open} onOpenChange={(open) => { if (!open) closeModal(); }}
      title={modal.field ? 'Przelicz raport' : 'Dodaj pole'} width="lg:max-w-6xl">
      <AddFieldForm key={modal.seq} initial={modal.field} onCancel={closeModal} onReport={add}/>
    </Dialog>
  </div>;
}

createRoot(document.getElementById('root')).render(<TooltipProvider><ToastProvider><App/></ToastProvider></TooltipProvider>);
