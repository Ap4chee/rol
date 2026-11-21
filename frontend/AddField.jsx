import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Grid, Group, Loader, Paper, SegmentedControl, Select, Stack, Switch, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconArrowRight, IconCalendar, IconCircleCheck, IconMapPin, IconSearch } from '@tabler/icons-react';
import { ParcelMap } from './ParcelMap.jsx';
import { api, generateReport } from './ui.jsx';
import { fieldFromReport, FULL_ID, number, oldestDate, today } from './model.js';
import { testParcel } from './testParcel.js';

const TEST_AVAILABLE = new URLSearchParams(window.location.search).has('test');
const TEST_POINT = { lat: 52.0, lon: 19.0 };   // gdy w trybie testowym nie wskazano miejsca

function describe(parcel) {
  return [parcel.region, parcel.commune && 'gm. ' + parcel.commune, parcel.voivodeship].filter(Boolean).join(', ');
}

/** Formularz działki, uprawy i daty. `split`: mapa zawsze obok formularza (ekran startowy), inaczej zakładki. */
export function AddFieldForm({ initial, onCancel, onReport, split = false }) {
  const active = useRef(null);
  const [tab, setTab] = useState('number');
  const [query, setQuery] = useState(initial?.report.request.parcel_id ?? initial?.report.parcel?.id ?? '');
  const [parcel, setParcel] = useState(initial?.report.parcel ?? null);
  const [point, setPoint] = useState(initial?.report.parcel ? null : initial?.report.request.point ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [crop, setCrop] = useState(initial?.report.crop.key ?? null);
  const [date, setDate] = useState(initial?.report.analysis_date ?? today());
  const [crops, setCrops] = useState(null);
  const [cropsError, setCropsError] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(false);

  useEffect(() => {
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
    if (busy || !crop || !(parcel || point || test)) return;
    request('report', async (signal) => {
      if (test) {   // analiza na żywo dla punktu, w widoku obrys testowy
        const where = parcel?.centroid ?? point ?? TEST_POINT;
        const result = await generateReport({ crop, date, point: { lat: where.lat, lon: where.lon } }, signal);
        const shape = testParcel(where.lat, where.lon);
        if (!signal.aborted) onReport(fieldFromReport({ ...result, parcel: shape.parcel, test_crop_area: shape.cropArea }, name || 'Działka testowa'));
        return;
      }
      const result = await generateReport({ crop, date, ...(parcel ? { parcel_id: parcel.id } : { point }) }, signal);
      if (!signal.aborted) onReport(fieldFromReport(result, name));
    });
  }

  const disabled = busy === 'report';
  const finder = <Stack gap="xs">
    <Group align="flex-end" gap="xs" wrap="nowrap">
      <TextInput flex={1} label="Numer działki lub obręb" placeholder="np. Niedrzwica Kościelna 580/2" value={query}
        maxLength={80} autoComplete="off" enterKeyHint="search" disabled={disabled} data-autofocus
        description="Pełny identyfikator, np. 060910_2.0011.580/2, albo nazwa obrębu i numer"
        onChange={(event) => { active.current?.abort(); setQuery(event.target.value); setParcel(null); setPoint(null); setCandidates([]); setError(''); setMessage(''); }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }}/>
      <Button variant="default" leftSection={<IconSearch size={16}/>} onClick={search} disabled={Boolean(busy)}>Szukaj</Button>
    </Group>
    {candidates.length > 0 && <Paper p={4}>{candidates.map((item) =>
      <UnstyledButton key={item.id} className="candidate" onClick={() => request('search', (signal) => getParcel(item.id, signal))}>
        <Text fw={600}>{item.number || item.id}</Text><Text size="xs" c="dimmed">{describe(item)} · {item.id}</Text>
      </UnstyledButton>)}</Paper>}
  </Stack>;
  const map = <ParcelMap parcel={parcel} point={point} onPick={pick}/>;

  const details = <Stack gap="sm">
    {parcel && <Alert color="forest" variant="light" icon={<IconCircleCheck size={18}/>} p="xs">
      Działka <b>{parcel.number || parcel.id}</b>{describe(parcel) ? ' · ' + describe(parcel) : ''} · {number(parcel.area_ha, 2)} ha</Alert>}
    {point && <Alert color="blue" variant="light" icon={<IconMapPin size={18}/>} p="xs">
      Punkt · {number(point.lat, 4)}° N, {number(point.lon, 4)}° E</Alert>}
    {message && <Text size="sm" c="dimmed" role="status">{message}</Text>}
    <Group grow align="flex-start">
      <Select label="Uprawa" placeholder={crops ? 'Wybierz uprawę' : 'Ładowanie upraw…'} required disabled={!crops || disabled}
        data={crops?.map((item) => ({ value: item.key, label: item.name })) ?? []} value={crop} onChange={setCrop} allowDeselect={false}/>
      <TextInput label="Data analizy" type="date" required value={date} min={oldestDate()} max={today()} disabled={disabled}
        leftSection={<IconCalendar size={16}/>} onChange={(event) => setDate(event.target.value)}/>
    </Group>
    {!split && <TextInput label="Nazwa pola" description="opcjonalnie" value={name} maxLength={80} disabled={disabled}
      onChange={(event) => setName(event.target.value)} placeholder="np. Pod lasem"/>}
    {TEST_AVAILABLE && <Switch color="red" checked={test} onChange={(event) => setTest(event.currentTarget.checked)} disabled={disabled}
      label="Tryb testowy" description="Obrys działki testowej w wybranym miejscu (albo w środku Polski). Pogoda, gleba i bilans liczą się na żywo dla tego punktu."/>}
    {cropsError && <Alert color="red" variant="light">Nie udało się pobrać upraw. {cropsError}</Alert>}
    {error && <Alert color="red" variant="light" role="alert">{error}</Alert>}
    {busy && <Group gap="xs" role="status"><Loader size="xs"/><Text size="sm">
      {busy === 'report' ? 'Pobieram dane działki i liczę bilans wodny (do 30 s)…' : 'Sprawdzam działkę…'}</Text></Group>}
    <Group justify="flex-end" mt="xs">
      {onCancel && <Button variant="default" onClick={onCancel}>Anuluj</Button>}
      <Button type="submit" size={split ? 'md' : 'sm'} rightSection={<IconArrowRight size={18}/>}
        disabled={Boolean(busy) || !(parcel || point || test) || !crop} fullWidth={split}>Sprawdź wodę na polu</Button>
    </Group>
  </Stack>;

  if (split) {
    return <form onSubmit={submit}>
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}><Stack gap="md">{finder}{details}</Stack></Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>{map}</Grid.Col>
      </Grid>
    </form>;
  }
  return <form onSubmit={submit}>
    <Stack gap="md">
      <SegmentedControl value={tab} onChange={setTab} disabled={disabled}
        data={[{ value: 'number', label: 'Numer działki' }, { value: 'map', label: 'Wskaż na mapie' }]}/>
      {tab === 'number' ? finder : map}
      {details}
    </Stack>
  </form>;
}
