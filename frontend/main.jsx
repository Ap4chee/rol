import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Menu, Pencil, Plus, Trash2 } from 'lucide-react';
import { LoadingState } from '@/shared/vendor/spectrumui/loading-state';
import {
  ResponsiveModal, ResponsiveModalContent, ResponsiveModalTitle, ResponsiveModalTrigger,
} from '@/shared/vendor/spectrumui/responsive-modal';
import { Button } from '@/shared/ui/button';
import { Callout } from '@/shared/ui/callout';
import { Dialog } from '@/shared/ui/dialog';
import { MoreMenu } from '@/shared/ui/menu';
import { ToastProvider, useToast } from '@/shared/ui/toaster';
import { Tooltip, TooltipProvider } from '@/shared/ui/tooltip';
import { AddFieldForm } from './AddField.jsx';
import { Dashboard, JobBadge } from './Dashboard.jsx';
import { FieldworkPage } from './Fieldwork.jsx';
import { FieldsMap } from './FieldsMap.jsx';
import { GenerationSteps } from './GenerationSteps.jsx';
import { Onboarding, useOnboarding } from './Onboarding.jsx';
import { mapCode } from './fieldsMap.js';
import { Report } from './Report.jsx';
import { mergeSatellite } from './completion.js';
import { Brand, Sidebar } from './Sidebar.jsx';
import { dateText, fieldFromReport, fieldHref, fieldTabHref, inputFromReport, readFields, routeTab, STORAGE_KEY } from './model.js';
import { testParcel } from './testParcel.js';
import { deleteField, generateReport, listFields, saveField } from './ui.jsx';

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

/** Obrys testowy (adres z ?test) dorysowany do raportu, który serwer policzył dla punktu. */
function withTestShape(field) {
  const point = field.input?.test && field.report?.request?.point;
  if (!point) return field;
  const shape = testParcel(point.lat, point.lon);
  return { ...field, report: { ...field.report, parcel: shape.parcel, test_crop_area: shape.cropArea } };
}

/** Lista z serwera. Pole bez zmian zostaje tym samym obiektem, więc otwarty raport się nie przeładowuje
 *  i nie gubi dociągniętych w przeglądarce zdjęć satelitarnych. */
function mergeFields(previous, next) {
  return next.map((field) => {
    const old = previous.find((entry) => entry.id === field.id);
    return old && old.name === field.name && old.job === field.job && old.error === field.error
      && old.refreshed_at === field.refreshed_at && JSON.stringify(old.progress ?? null) === JSON.stringify(field.progress ?? null)
      ? old : withTestShape(field);
  });
}

/** Pole zapisane, ale jego pierwszy raport jeszcze się liczy na serwerze (albo liczenie się nie udało). */
function FieldPending({ field, onEdit, onDelete, onBack }) {
  return <div className="flex flex-col gap-6">
    <Button variant="ghost" size="sm" icon={<ArrowLeft/>} onClick={onBack} className="-ml-2 self-start">Wstecz</Button>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]">{field.name}</h1>
        <div role="status" className="mt-3"><JobBadge field={field}/></div>
      </div>
      <MoreMenu items={[{ label: 'Edytuj pole', icon: Pencil, onSelect: onEdit },
        { label: 'Usuń pole', icon: Trash2, onSelect: onDelete, danger: true }]}/>
    </header>
    {field.job === 'error'
      ? <Callout tone="danger" title="Raport się nie policzył">{field.error} Serwer spróbuje ponownie sam.</Callout>
      : <GenerationSteps field={field}/>}
  </div>;
}

function App() {
  const [fields, setFields] = useState([]);   // pola z serwera; raporty liczy tam worker (app/fields.py)
  const [loaded, setLoaded] = useState(false);
  const currentFields = useRef(fields);
  const poll = useRef(0);
  const [preview, setPreview] = useState(null);
  // Modal dodawania/edycji i potwierdzenie usunięcia. Po zamknięciu `field` zostaje, żeby tytuł i treść nie znikały
  // w trakcie animacji wyjścia; `seq` daje świeży formularz przy każdym otwarciu.
  const [modal, setModal] = useState({ open: false, field: undefined, seq: 0 });
  const [deleting, setDeleting] = useState({ open: false, field: null });
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [shared, setShared] = useState(() => new URLSearchParams(window.location.search).get('parcel') ? 'loading' : '');
  const hash = useHash();
  const { id: current, tab } = routeTab(hash);
  const field = current === 'preview' ? preview : fields.find((entry) => entry.id === current);
  const mapAt = mapCode(hash);
  const page = field ? 'field' : mapAt !== null ? 'map' : hash === '#plan' ? 'plan' : 'dashboard';
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
  const askDelete = useCallback((entry) => setDeleting({ open: true, field: entry }), []);
  const closeDelete = useCallback(() => setDeleting((state) => (state.open ? { ...state, open: false } : state)), []);

  const show = useCallback((next) => {
    currentFields.current = next;
    setFields(next);
  }, []);

  /** Lista pól z serwera. W trakcie liczenia co 3 s (stan na kartach), poza tym co minutę (odświeżenie dobowe). */
  const refresh = useCallback(async () => {
    try {
      show(mergeFields(currentFields.current, await listFields()));
      setMessage('');
    } catch (error) {
      setMessage(`Nie udało się wczytać pól z serwera: ${error.message}`);
    }
    setLoaded(true);
    clearTimeout(poll.current);
    const busy = currentFields.current.some((field) => field.job === 'queued' || field.job === 'running');
    poll.current = setTimeout(refresh, busy ? 1200 : 60000);   // w trakcie liczenia często: widać kolejne etapy
  }, [show]);

  useEffect(() => {
    // pola zapisane dawniej tylko w tej przeglądarce przenosimy na serwer; przy błędzie zostają i wracamy do nich później
    (async () => {
      let local = [];
      try { local = readFields(window.localStorage); } catch { /* brak dostępu do pamięci przeglądarki */ }
      try {
        for (const field of local) await saveField(inputFromReport(field.report, field.name));
        if (local.length) window.localStorage.removeItem(STORAGE_KEY);
      } catch { /* spróbujemy przy następnym wejściu */ }
      refresh();
    })();
    return () => clearTimeout(poll.current);
  }, [refresh]);

  const onSatellite = useCallback((id, generatedAt, result) => {
    const merge = (entry) => ({ ...entry, report: mergeSatellite(entry.report, result) });
    const matches = (field) => field?.id === id && field.report?.generated_at === generatedAt;
    show(currentFields.current.map((field) => (matches(field) ? merge(field) : field)));
    setPreview((field) => (matches(field) ? merge(field) : field));
  }, [show]);

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

  const failed = (what) => (error) => toast({ title: `Nie udało się ${what}.`, description: error.message, status: 'error' });

  /** Raport z linku zapisany jako pole: serwer liczy je od nowa w tle i odświeża codziennie. */
  function save(entry) {
    saveField(inputFromReport(entry.report, entry.name)).then(async (saved) => {
      await refresh();
      if (current === 'preview') window.location.hash = fieldHref(saved.id);
    }).catch(failed('zapisać pola'));
    return true;
  }

  /** Formularz: zapis pola na serwerze i od razu zamknięcie okna; raport liczy się w tle (stan na karcie pola). */
  async function submitField(input, signal) {
    const edited = modal.field;
    const saved = await saveField(input, edited?.id, signal);
    await refresh();
    closeModal();
    if (edited) {
      toast({ title: 'Zapisano zmiany w polu.', description: saved.job === 'queued' ? 'Raport przelicza się w tle.' : undefined, status: 'success' });
      if (page === 'field' && saved.id !== current) window.location.hash = fieldHref(saved.id);
    } else {
      toast({ title: `Dodano pole „${saved.name}”.`, description: 'Raport liczy się w tle, stan widać na karcie pola.', status: 'success' });
    }
  }

  function confirmDelete() {
    const target = deleting.field;
    if (!target) return;
    closeDelete();
    deleteField(target.id).then(async () => {
      await refresh();
      if (current === target.id) window.location.hash = '';
      toast({ title: `Usunięto pole „${target.name}”.`, status: 'info' });
    }).catch(failed('usunąć pola'));
  }

  const closeMenu = () => setMobileOpen(false);
  // „Wstecz” z widoku pola wraca tam, skąd rolnik przyszedł: pulpit, poziom mapy albo plan prac
  const cameFrom = useRef('');
  if (page !== 'field') cameFrom.current = hash;
  const goBack = () => { window.location.hash = cameFrom.current.replace(/^#/, ''); };
  const addField = () => openModal();

  // samouczek: powitanie przy pierwszej wizycie na pulpicie, objaśnienie raportu przy pierwszym gotowym raporcie
  const hasReport = Boolean(field?.report);
  const onboarding = useOnboarding({ ready: loaded && shared !== 'loading', page, tab, hasReport,
    blocked: modal.open || deleting.open || mobileOpen });

  function closeTour(reason) {
    onboarding.close(reason);
    if (reason === 'add') openModal();
  }

  /** „Jak to działa” w menu: na otwartym raporcie objaśnia raport, poza nim zaczyna od powitania na pulpicie. */
  function showHelp() {
    const onReport = page === 'field' && hasReport;
    if (onReport && tab !== 'podsumowanie') window.location.hash = fieldTabHref(current, 'podsumowanie');
    if (!onReport && page !== 'dashboard') window.location.hash = '';
    // po zamknięciu szuflady menu i przerysowaniu widoku, żeby samouczek znalazł elementy do podświetlenia
    setTimeout(() => onboarding.start(onReport ? 'report' : 'welcome'), 280);
  }

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
            <Button variant="ghost" size="icon" aria-label="Otwórz menu" data-tour="menu"><Menu strokeWidth={1.9}/></Button>
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
        <Sidebar page={page} compact={false} onToggle={toggleCompact} onNavigate={closeMenu} onAdd={addField} onHelp={showHelp}/>
      </ResponsiveModalContent>
    </ResponsiveModal>

    <div className="no-print hidden overflow-hidden md:sticky md:top-0 md:block md:h-svh md:self-start">
      <Sidebar page={page} compact={compact} onToggle={toggleCompact} onNavigate={closeMenu} onAdd={addField} onHelp={showHelp}/>
    </div>

    <div className="print-plain flex min-h-[calc(100svh_-_var(--app-header))] min-w-0 flex-col overflow-x-clip bg-white md:my-2 md:mr-2 md:min-h-[calc(100svh_-_1rem)] md:rounded-2xl md:border md:border-black/[0.06] md:shadow-hairline print:min-h-0!">
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-6 md:px-8 md:py-10 lg:px-10 print:max-w-none! print:p-0!">
          {message && <Callout tone="danger" role="alert" className="no-print mb-6">{message}</Callout>}
          {shared === 'loading' ? <SharedLoading/> : !loaded ? <LoadingState label="Wczytuję pola"/> : <>
            {shared && <Callout tone="danger" role="alert" title="Nie udało się otworzyć raportu z linku" className="mb-6">{shared}</Callout>}
            {page === 'field' && !field.report ? <FieldPending field={field} onEdit={() => openModal(field)}
              onDelete={() => askDelete(field)} onBack={goBack}/>
              : page === 'field' ? <Report key={field.id + field.report.generated_at} field={field} tab={tab}
              onTab={(next) => { window.location.hash = fieldTabHref(current, next); }} onEdit={() => openModal(field)}
              onDelete={() => askDelete(field)} onSave={save} onSatellite={onSatellite} onBack={goBack}
              saved={fields.some((entry) => entry.id === field.id)}/>
              : page === 'map' ? <FieldsMap code={mapAt} fields={fields} onAdd={addField}/>
              // plan potrzebuje uprawy i gleby z raportu; pole, którego raport jeszcze się liczy, dołącza po policzeniu
              : page === 'plan' ? <FieldworkPage fields={fields.filter((entry) => entry.report)} onAdd={addField}/> : <>
                {current && <NotFound onAdd={addField}/>}
                <Dashboard fields={fields} onAdd={addField} onEdit={openModal} onDelete={askDelete}/>
              </>}
          </>}
        </div>
      </main>
    </div>

    <Dialog open={modal.open} onOpenChange={(open) => { if (!open) closeModal(); }}
      title={modal.field ? 'Edytuj pole' : 'Dodaj pole'} width="lg:max-w-6xl">
      <AddFieldForm key={modal.seq} initial={modal.field} fields={fields} onCancel={closeModal} onSubmit={submitField}/>
    </Dialog>

    <Dialog open={deleting.open} onOpenChange={(open) => { if (!open) closeDelete(); }}
      title="Usuń pole"
      description={deleting.field ? `Pole „${deleting.field.name}” i jego raport zostaną usunięte.` : undefined}
      width="lg:max-w-md">
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={closeDelete} data-autofocus>Anuluj</Button>
        <Button variant="danger" onClick={confirmDelete}>Usuń pole</Button>
      </div>
    </Dialog>

    <Onboarding tour={onboarding.tour} narrow={!desktop} onClose={closeTour}/>
  </div>;
}

createRoot(document.getElementById('root')).render(<TooltipProvider><ToastProvider><App/></ToastProvider></TooltipProvider>);
