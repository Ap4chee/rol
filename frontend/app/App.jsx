import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteField, saveField } from '@/api/endpoints';
import { DESKTOP, useMediaQuery } from '@/shared/lib/media';
import { Callout } from '@/shared/ui/callout';
import { LoadingState } from '@/shared/ui/effects';
import { useToast } from '@/shared/ui/toaster';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { FieldPending } from '@/features/fields/FieldPending';
import { inputFromReport } from '@/features/fields/logic';
import { FieldworkPage } from '@/features/fieldwork/FieldworkPage';
import { FieldsMap } from '@/features/map/FieldsMap';
import { Onboarding, useOnboarding } from '@/features/onboarding/Onboarding';
import { mergeSatellite } from '@/features/report/completion';
import { Report } from '@/features/report/Report';
import { WeatherCard } from '@/features/weather/WeatherCard';
import { prefetchForecast } from '@/features/weather/useForecast';
import { DeleteFieldDialog, FieldFormDialog } from './FieldDialogs.jsx';
import { REPORT_TABS } from './reportTabs.jsx';
import { DASHBOARD_HREF, fieldHref, fieldTabHref, LEGACY_ADD_HREF, mapCode, pageOf, routeTab } from './router.js';
import { Shell } from './Shell.jsx';
import { NotFound, SharedLoading } from './StatusViews.jsx';
import { useFields } from './useFields.js';
import { navigate, replaceHash, useHash } from './useHashRoute.js';
import { useSharedReport } from './useSharedReport.js';

// samouczek startuje po zamknięciu szuflady menu i przerysowaniu widoku, żeby znalazł elementy do podświetlenia
const HELP_DELAY_MS = 280;

/** Okno otwarte z danymi; po zamknięciu dane zostają do końca animacji wyjścia, `seq` daje świeży formularz. */
function useDialogs() {
  const [modal, setModal] = useState({ open: false, field: undefined, seq: 0 });
  const [deleting, setDeleting] = useState({ open: false, field: null });
  const openModal = useCallback((entry) => setModal((state) => ({ open: true, field: entry, seq: state.seq + 1 })), []);
  const closeModal = useCallback(() => setModal((state) => (state.open ? { ...state, open: false } : state)), []);
  const askDelete = useCallback((entry) => setDeleting({ open: true, field: entry }), []);
  const closeDelete = useCallback(() => setDeleting((state) => (state.open ? { ...state, open: false } : state)), []);
  return { modal, deleting, openModal, closeModal, askDelete, closeDelete };
}

/** Karta prognozy na pulpicie (należy do funkcji pogody, pulpit wskazuje tylko jej miejsce). */
const renderWeather = (props) => <WeatherCard {...props}/>;

export function App() {
  const { fields, loaded, message, refresh, update } = useFields();
  const { preview, setPreview, status: shared } = useSharedReport();
  const { modal, deleting, openModal, closeModal, askDelete, closeDelete } = useDialogs();
  const { toast } = useToast();
  const hash = useHash();
  const { id: current, tab } = routeTab(hash);
  const field = current === 'preview' ? preview : fields.find((entry) => entry.id === current);
  const page = pageOf(hash, Boolean(field));
  const [menuOpen, setMenuOpen] = useState(false);
  const desktop = useMediaQuery(DESKTOP);
  // prognoza od razu po otwarciu raportu: wydruk (montuje zakładkę pogody dopiero przy drukowaniu) ma ją gotową
  const forecastAt = page === 'field' ? field?.report?.parcel?.centroid ?? field?.report?.request?.point : null;
  useEffect(() => { prefetchForecast(forecastAt); }, [forecastAt?.lat, forecastAt?.lon]);

  const onSatellite = useCallback((id, generatedAt, result) => {
    const merge = (entry) => ({ ...entry, report: mergeSatellite(entry.report, result) });
    const matches = (entry) => entry?.id === id && entry.report?.generated_at === generatedAt;
    update((entry) => (matches(entry) ? merge(entry) : entry));
    setPreview((entry) => (matches(entry) ? merge(entry) : entry));
  }, [update, setPreview]);

  useEffect(() => { window.scrollTo(0, 0); }, [page, field?.id]);
  useEffect(() => {   // stary adres #dodaj otwiera modal dodawania
    if (hash === LEGACY_ADD_HREF) { openModal(); replaceHash(DASHBOARD_HREF); }
  }, [hash, openModal]);

  const failed = (what) => (error) => toast({ title: `Nie udało się ${what}.`, description: error.message, status: 'error' });

  /** Raport z linku zapisany jako pole: serwer liczy je od nowa w tle i odświeża codziennie. */
  function save(entry) {
    saveField(inputFromReport(entry.report, entry.name)).then(async (saved) => {
      await refresh();
      if (current === 'preview') navigate(fieldHref(saved.id));
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
      if (page === 'field' && saved.id !== current) navigate(fieldHref(saved.id));
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
      if (current === target.id) navigate(DASHBOARD_HREF);
      toast({ title: `Usunięto pole „${target.name}”.`, status: 'info' });
    }).catch(failed('usunąć pola'));
  }

  // „Wstecz” z widoku pola wraca tam, skąd rolnik przyszedł: pulpit, poziom mapy albo plan prac
  const cameFrom = useRef('');
  if (page !== 'field') cameFrom.current = hash;
  const goBack = () => navigate(cameFrom.current || DASHBOARD_HREF);
  const addField = () => openModal();

  // samouczek: powitanie przy pierwszej wizycie na pulpicie, objaśnienie raportu przy pierwszym gotowym raporcie
  const hasReport = Boolean(field?.report);
  const onboarding = useOnboarding({ ready: loaded && shared !== 'loading', page, tab, hasReport,
    blocked: modal.open || deleting.open || menuOpen });

  function closeTour(reason) {
    onboarding.close(reason);
    if (reason === 'add') openModal();
  }

  /** „Jak to działa” w menu: na otwartym raporcie objaśnia raport, poza nim zaczyna od powitania na pulpicie. */
  function showHelp() {
    const onReport = page === 'field' && hasReport;
    if (onReport && tab !== 'podsumowanie') navigate(fieldTabHref(current, 'podsumowanie'));
    if (!onReport && page !== 'dashboard') navigate(DASHBOARD_HREF);
    setTimeout(() => onboarding.start(onReport ? 'report' : 'welcome'), HELP_DELAY_MS);
  }

  function content() {
    if (page === 'field' && !field.report) {
      return <FieldPending field={field} onEdit={() => openModal(field)} onDelete={() => askDelete(field)} onBack={goBack}/>;
    }
    if (page === 'field') {
      return <Report key={field.id + field.report.generated_at} field={field} tab={tab} tabs={REPORT_TABS}
        onTab={(next) => navigate(fieldTabHref(current, next))} onEdit={() => openModal(field)}
        onDelete={() => askDelete(field)} onSave={save} onSatellite={onSatellite} onBack={goBack}
        saved={fields.some((entry) => entry.id === field.id)}/>;
    }
    if (page === 'map') return <FieldsMap code={mapCode(hash)} fields={fields} onAdd={addField}/>;
    // plan potrzebuje uprawy i gleby z raportu; pole, którego raport jeszcze się liczy, dołącza po policzeniu
    if (page === 'plan') return <FieldworkPage fields={fields.filter((entry) => entry.report)} onAdd={addField}/>;
    return <>
      {current && <NotFound onAdd={addField}/>}
      <Dashboard fields={fields} onAdd={addField} onEdit={openModal} onDelete={askDelete} renderWeather={renderWeather}/>
    </>;
  }

  return <Shell page={page} desktop={desktop} menuOpen={menuOpen} onMenuOpen={setMenuOpen} onAdd={addField} onHelp={showHelp}
    overlays={<>
      <FieldFormDialog modal={modal} fields={fields} onClose={closeModal} onSubmit={submitField}/>
      <DeleteFieldDialog deleting={deleting} onClose={closeDelete} onConfirm={confirmDelete}/>
      <Onboarding tour={onboarding.tour} narrow={!desktop} onClose={closeTour}/>
    </>}>
    {message && <Callout tone="danger" role="alert" className="no-print mb-6">{message}</Callout>}
    {shared === 'loading' ? <SharedLoading/> : !loaded ? <LoadingState label="Wczytuję pola"/> : <>
      {shared && <Callout tone="danger" role="alert" title="Nie udało się otworzyć raportu z linku" className="mb-6">{shared}</Callout>}
      {content()}
    </>}
  </Shell>;
}
