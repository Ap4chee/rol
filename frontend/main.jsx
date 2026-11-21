import '@mantine/core/styles.css';
import './style.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, AppShell, Burger, Button, Container, createTheme, Group, Loader, MantineProvider, Modal, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconDroplet } from '@tabler/icons-react';
import { AddFieldForm } from './AddField.jsx';
import { Dashboard } from './Dashboard.jsx';
import { Report } from './Report.jsx';
import { Sidebar } from './Sidebar.jsx';
import { fieldFromReport, fieldHref, fieldTabHref, readFields, routeTab, STORAGE_KEY, upsertField } from './model.js';

const COMPACT_KEY = 'kowr.sidebar-compact';
import { generateReport } from './ui.jsx';

const theme = createTheme({
  primaryColor: 'forest',
  primaryShade: 8,
  colors: {
    forest: ['#edf6ef', '#dbeddf', '#b4d9bc', '#8bc497', '#69b178', '#53a565', '#469e5a', '#36894a', '#2c7a40', '#1f5c30'],
  },
  fontFamily: 'Inter, system-ui, sans-serif',
  headings: { fontFamily: "'Bricolage Grotesque', Inter, system-ui, sans-serif", fontWeight: '700' },
  defaultRadius: 'md',
  components: {
    Paper: { defaultProps: { withBorder: true, radius: 'lg' } },
    Card: { defaultProps: { withBorder: true, radius: 'lg' } },
    Badge: { defaultProps: { tt: 'none', fw: 600 } },
  },
});

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
  const { id: current, tab } = routeTab(hash);
  const field = current === 'preview' ? preview : fields.find((entry) => entry.id === current);
  const page = field ? 'field' : 'dashboard';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compactPref, setCompact] = useState(() => { try { return localStorage.getItem(COMPACT_KEY) === '1'; } catch { return false; } });
  const mobile = useMediaQuery('(max-width: 48em)');
  const compact = compactPref && !mobile;   // na telefonie menu jest szufladą, zawsze pełną
  function toggleCompact() {
    setCompact((value) => {
      try { localStorage.setItem(COMPACT_KEY, value ? '0' : '1'); } catch { /* tylko wygoda, bez zapisu też działa */ }
      return !value;
    });
  }

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
    if (hash === '#dodaj') { setModal({}); window.history.replaceState(null, '', '#'); }
  }, [hash]);

  function add(field) {
    const saved = persist(upsertField(currentFields.current, field));
    setModal(null);
    window.location.hash = fieldHref(field.id);
    return saved;
  }

  return <AppShell header={{ height: 56 }} padding={0}
    navbar={{ width: compact ? 76 : 272, breakpoint: 'sm', collapsed: { mobile: !mobileOpen } }}>
    <a className="skip-link" href="#main-content" onClick={(event) => {
      event.preventDefault();
      document.getElementById('main-content').focus();
    }}>Przejdź do treści</a>
    <AppShell.Header className="app-header no-print">
      <Group h="100%" px="md" justify="space-between">
        <Group gap="sm">
          <Burger opened={mobileOpen} onClick={() => setMobileOpen((o) => !o)} hiddenFrom="sm" size="sm" aria-label="Menu"/>
          <a className="brand" href="#"><IconDroplet size={24} stroke={1.8}/> Asystent wody</a>
        </Group>
        <Text size="sm" c="dimmed" visibleFrom="sm">Bilans wody na działce · dane otwarte</Text>
      </Group>
    </AppShell.Header>
    <AppShell.Navbar p="sm" className="app-navbar no-print">
      <Sidebar page={page} compact={compact} onToggle={toggleCompact} onNavigate={() => setMobileOpen(false)} onAdd={() => setModal({})}/>
    </AppShell.Navbar>
    <AppShell.Main>
      <Container size="xl" px={{ base: 'md', md: 'xl' }} py="xl" id="main-content" tabIndex={-1} className="main">
        {message && <Alert color="red" mb="md" className="no-print">{message}</Alert>}
        {shared === 'loading' ? <Group gap="sm"><Loader size="sm"/><Text>Pobieram dane i liczę raport dla wskazanej działki…</Text></Group> : <>
          {shared && <Alert color="red" mb="md">{shared}</Alert>}
          {page === 'field' ? <Report key={field.id + field.report.generated_at} field={field} tab={tab}
            onTab={(next) => { window.location.hash = fieldTabHref(current, next); }} onEdit={() => setModal({ field })}
            onSave={add} onSatellite={onSatellite} saved={fields.some((entry) => entry.id === field.id)}/>
            : <>
              {current && <Alert color="gray" mb="md">Nie znaleziono raportu w tej przeglądarce.
                <Button ml="sm" size="xs" variant="default" onClick={() => setModal({})}>Dodaj pole</Button></Alert>}
              <Dashboard fields={fields} onAdd={() => setModal({})}/>
            </>}
        </>}
        <footer className="footer no-print">
          <Text size="sm" fw={600}>Asystent wody</Text>
          <Text size="sm" c="dimmed">Wynik jest szacunkiem z modeli i otwartych danych.</Text>
        </footer>
      </Container>
    </AppShell.Main>
    <Modal opened={Boolean(modal)} onClose={() => setModal(null)} size="72rem" radius="lg"
      title={<Text fw={700} size="xl" ff="heading">{modal?.field ? 'Przelicz raport' : 'Dodaj pole'}</Text>}>
      {modal && <AddFieldForm initial={modal.field} onCancel={() => setModal(null)} onReport={add}/>}
    </Modal>
  </AppShell>;
}

createRoot(document.getElementById('root')).render(<MantineProvider theme={theme}><App/></MantineProvider>);
