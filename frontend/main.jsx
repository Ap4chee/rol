import '@mantine/core/styles.css';
import './style.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, Container, createTheme, Group, Loader, MantineProvider, Modal, Text } from '@mantine/core';
import { IconDroplet } from '@tabler/icons-react';
import { AddFieldForm } from './AddField.jsx';
import { Dashboard } from './Dashboard.jsx';
import { Report } from './Report.jsx';
import { fieldFromReport, fieldHref, readFields, route, STORAGE_KEY, upsertField } from './model.js';
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
    <Box component="header" className="app-header no-print">
      <Container size="xl" h={60}>
        <Group h="100%" justify="space-between">
          <a className="brand" href="/"><IconDroplet size={24} stroke={1.8}/> Asystent wody</a>
          <Text size="sm" c="dimmed" visibleFrom="sm">Bilans wody na działce · dane otwarte</Text>
        </Group>
      </Container>
    </Box>
    <Container size="xl" component="main" id="main-content" tabIndex={-1} py="xl" className="main">
      {message && <Alert color="red" mb="md" className="no-print">{message}</Alert>}
      {shared === 'loading' ? <Group gap="sm"><Loader size="sm"/><Text>Pobieram dane i liczę raport dla wskazanej działki…</Text></Group> : <>
        {shared && <Alert color="red" mb="md">{shared}</Alert>}
        {field ? <Report key={field.id + field.report.generated_at} field={field} onEdit={() => setModal({ field })}
          onSave={add} onSatellite={onSatellite} saved={fields.some((entry) => entry.id === field.id)}/>
          : <>
            {current && <Alert color="gray" mb="md">Nie znaleziono raportu w tej przeglądarce.
              <Button ml="sm" size="xs" variant="default" onClick={() => setModal({})}>Dodaj pole</Button></Alert>}
            <Dashboard fields={fields} onAdd={() => setModal({})} onReport={add}/>
          </>}
      </>}
    </Container>
    <Container size="xl" component="footer" className="footer no-print">
      <Text size="sm" fw={600}>Asystent wody</Text>
      <Text size="sm" c="dimmed">Wynik jest szacunkiem z modeli i otwartych danych.</Text>
    </Container>
    <Modal opened={Boolean(modal)} onClose={() => setModal(null)} size="xl" radius="lg"
      title={<Text fw={700} size="xl" ff="heading">{modal?.field ? 'Przelicz raport' : 'Dodaj pole'}</Text>}>
      {modal && <AddFieldForm initial={modal.field} onCancel={() => setModal(null)} onReport={add}/>}
    </Modal>
  </>;
}

createRoot(document.getElementById('root')).render(<MantineProvider theme={theme}><App/></MantineProvider>);
