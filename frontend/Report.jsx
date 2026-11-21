import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Accordion, Anchor, Badge, Box, Button, Card, Grid, Group, Image, List, Paper, SegmentedControl,
  SimpleGrid, Slider, Stack, Table, Tabs, Text, Title,
} from '@mantine/core';
import {
  IconArrowRight, IconCloudRain, IconDeviceFloppy, IconDroplet, IconMapPin, IconMountain, IconPrinter,
  IconRefresh, IconStack2, IconTemperature, IconWaveSine,
} from '@tabler/icons-react';
import { ForecastDays } from './Dashboard.jsx';
import { Field3D } from './Field3D.jsx';
import { ParcelMap } from './ParcelMap.jsx';
import { WaterChart } from './WaterChart.jsx';
import { api, Note, Paragraphs, Sparkline, statusColor, statusShort } from './ui.jsx';
import { dateText, mergeSoilLayers, number, satelliteMeasurements, seasonMonths, TABS, today } from './model.js';

function useDeferred(endpoint) {
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState('');
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    setResult(null);
    setFailure('');
    api(endpoint, { signal: controller.signal }).then(setResult)
      .catch((error) => { if (!controller.signal.aborted) setFailure(error.message); });
    return () => controller.abort();
  }, [endpoint, tries]);
  return { result, failure, retry: () => setTries((n) => n + 1) };
}

/** Przy drukowaniu wszystkie zakładki renderują się jedna pod drugą (flushSync: zanim przeglądarka zrobi zrzut strony). */
function usePrinting() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);
  return printing;
}

function Section({ title, lead, children, aside }) {
  return <Box component="section" className="report-section">
    <Group justify="space-between" align="flex-end" mb={lead ? 4 : 'md'}>
      <Title order={2}>{title}</Title>{aside}
    </Group>
    {lead && <Text c="dimmed" mb="lg" maw={720}>{lead}</Text>}
    {children}
  </Box>;
}

function Fact({ label, value, hint }) {
  return <div className="fact"><Text size="sm" c="dimmed">{label}</Text><Text fw={700} size="xl" lh={1.2}>{value}</Text>
    {hint && <Text size="xs" c="dimmed">{hint}</Text>}</div>;
}

const cssColor = (water) => `var(--mantine-color-${statusColor(water)}-7)`;
const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const TAB_LABELS = { podsumowanie: 'Podsumowanie', rekomendacje: 'Rekomendacje', gleba: 'Gleba', pogoda: 'Pogoda',
  teren: 'Teren i woda', historia: 'Historia', zrodla: 'Źródła' };
// kolejność w PDF: ocena → przyczyny → rekomendacje → źródła (narzucona przez zadanie)
const PRINT_ORDER = ['podsumowanie', 'historia', 'pogoda', 'gleba', 'teren', 'rekomendacje', 'zrodla'];

// ---------- podsumowanie ----------

function Verdict({ report, limited, onTab }) {
  const water = report.water_status;
  const result = water.result;
  const recs = report.recommendations;
  const all = [...recs.retention, ...recs.agrotechnical, ...recs.irrigation];
  const first = all[0];
  const stressDay = water.forecast_stress_day;
  return <Stack gap="xl" justify="center" h="100%">
    <div>
      <Text className="verdict" c={cssColor(water)}>{water.headline ?? 'Brakuje danych do oceny'}</Text>
      {result && <Text size="lg" mt="sm">
        {result.depletion_mm > 1 ? `Brakuje ${number(result.depletion_mm)} mm wody do pełnego zapasu` : 'Zapas wody jest pełny'}
        <Text span c="dimmed"> · {number(result.available_mm)} z {number(result.taw_mm)} mm</Text>
        {stressDay && <Text span fw={700} c="red.8"><br/>Stres wodny od {dateText(stressDay)}</Text>}
      </Text>}
      <Note section={water}/>
    </div>
    {first && <Paper p="lg" className="next-step-card">
      <Text size="xs" tt="uppercase" fw={700} c="dimmed" lts={.6}>Najważniejsze teraz</Text>
      <Text fw={700} size="xl" lh={1.25} mt={4}>{first.title}</Text>
      <Button className="no-print" variant="subtle" px={0} mt="xs" rightSection={<IconArrowRight size={16}/>} onClick={() => onTab('rekomendacje')}>
        {all.length > 1 ? `Wszystkie działania (${all.length})` : 'Szczegóły działania'}</Button>
    </Paper>}
    {limited && <Anchor size="sm" c="dimmed" component="button" ta="left" onClick={() => onTab('zrodla')}>
      Ograniczona pewność wyniku →</Anchor>}
  </Stack>;
}

function causeIcon(key) {
  if (key.includes('soil')) return IconStack2;
  if (key.includes('rain') || key.includes('precip') || key.includes('carry')) return IconCloudRain;
  if (key.includes('et0') || key.includes('heat') || key.includes('temp') || key.includes('demand')) return IconTemperature;
  if (key.includes('slope') || key.includes('flow') || key.includes('terrain') || key.includes('runoff')) return IconMountain;
  if (key.includes('river')) return IconWaveSine;
  return IconDroplet;
}

/** Przyczyny jako tytuły z ikoną; pełny opis rozwija się po kliknięciu. */
function CauseList({ causes, limit }) {
  const items = limit ? causes.slice(0, limit) : causes;
  return <Accordion variant="default" multiple className="quiet-accordion cause-list">{items.map((cause) => {
    const Icon = causeIcon(cause.key);
    return <Accordion.Item key={cause.key} value={cause.key}>
      <Accordion.Control icon={<Icon size={22} stroke={1.6}/>}><Text fw={700}>{cause.title}</Text></Accordion.Control>
      <Accordion.Panel><Text size="sm" maw={760}>{cause.text}</Text></Accordion.Panel>
    </Accordion.Item>;
  })}</Accordion>;
}

function Satellite({ satellite, failed, retry }) {
  const measurements = satelliteMeasurements(satellite);
  const [index, setIndex] = useState(null);
  const observation = index == null ? measurements.at(-1) : measurements[index];
  return <div>
    <Title order={2} mb="md">Zieloność roślin</Title>
    {satellite.status !== 'ok' && <Text size="sm" c="dimmed">{satellite.status === 'pending' ? 'Wczytuję zdjęcia Sentinel-2…' : satellite.reason ?? 'Brak obserwacji.'}</Text>}
    {failed && <Button mt="xs" size="xs" variant="default" leftSection={<IconRefresh size={14}/>} onClick={retry}>Ponów</Button>}
    {measurements.length > 1 && <Box c="forest.7" mt="sm">
      <Sparkline values={measurements.map((o) => o.ndvi)} min={0} max={1} height={48}
        label="Zieloność roślin (NDVI) w kolejnych zdjęciach satelitarnych"/>
      <Slider className="no-print" mt={4} size="xs" min={0} max={measurements.length - 1} step={1} label={null}
        value={index ?? measurements.length - 1} onChange={setIndex}/>
    </Box>}
    {observation && <Text size="xs" c="dimmed" mt={4}>{dateText(observation.date)} · NDVI {number(observation.ndvi, 2)}
      {Number.isFinite(observation.ndmi) && ` · NDMI ${number(observation.ndmi, 2)}`} · Sentinel-2</Text>}
  </div>;
}

function Summary({ report, terrain, satellite, sat, limited, onTab, printing }) {
  const [view, setView] = useState('3d');
  const water = report.water_status;
  const climat = water.climatic_water_balance;
  const rain = report.causes.windows?.find((w) => w.days === 30);
  const history = report.history;
  const need = report.irrigation_need;
  const causes = [...(report.causes.items ?? []), ...(terrain?.causes ?? [])];
  return <Stack gap={56}>
    <Grid gutter={48} align="center">
      <Grid.Col span={{ base: 12, md: 5 }}><Verdict report={report} limited={limited} onTab={onTab}/></Grid.Col>
      <Grid.Col span={{ base: 12, md: 7 }} className="report-map">
        <Group justify="flex-end" mb={4} className="no-print">
          <SegmentedControl size="xs" value={view} onChange={setView}
            data={[{ value: '3d', label: 'Pole i gleba' }, { value: 'map', label: 'Zdjęcie lotnicze' }]}/>
        </Group>
        {view === '3d' || printing ? <Field3D report={report} cropArea={report.test_crop_area}/>
          : <ParcelMap parcel={report.parcel} point={report.parcel ? null : report.request.point} terrain={terrain}/>}
      </Grid.Col>
    </Grid>
    <Section title="Zapas wody w glebie">
      {water.series?.length > 1 ? <WaterChart series={water.series} forecast={water.forecast} color={cssColor(water)}/>
        : <Note section={water}/>}
      {water.forecast_reason && !water.forecast?.length && <Text size="xs" c="dimmed" mt={4}>{water.forecast_reason}</Text>}
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="lg" mt="xl" className="facts">
        <Fact label="Opad, 30 dni" value={rain ? `${number(rain.rain_mm)} mm` : '—'}
          hint={rain?.rain_median_mm != null ? `zwykle ${number(rain.rain_median_mm)} mm` : null}/>
        <Fact label={`Opad minus parowanie, ${climat?.days ?? 60} dni`} value={climat ? `${number(climat.balance_mm)} mm` : '—'}/>
        <Fact label="Sezony z niedoborem" value={history.seasons_total ? `${history.seasons_with_stress} z ${history.seasons_total}` : '—'}
          hint="ostatnie pełne sezony"/>
        <Fact label="Nawadnianie w typowym sezonie" value={need?.typical_mm != null ? `${number(need.typical_mm)} mm` : '—'}
          hint={need?.dry_mm != null ? `w suchym roku ${number(need.dry_mm)} mm` : null}/>
      </SimpleGrid>
    </Section>
    <Grid gutter={48}>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Section title="Dlaczego?" aside={<Group gap={4} className="no-print">
          {['pogoda', 'gleba', 'teren'].map((key) => <Button key={key} size="compact-sm" variant="subtle" onClick={() => onTab(key)}>{TAB_LABELS[key]}</Button>)}
        </Group>}>
          <Note section={report.causes}/>
          {causes.length > 0 ? <CauseList causes={causes} limit={3}/>
            : report.causes.reason && <Text c="dimmed">{report.causes.reason}</Text>}
        </Section>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Box className="report-section"><Satellite satellite={satellite} failed={sat.failure} retry={sat.retry}/></Box>
      </Grid.Col>
    </Grid>
  </Stack>;
}

// ---------- rekomendacje ----------

const actionImages = {
  residue_cover: 'mulcz.jpg', cover_crop: 'miedzyplon.jpg', organic_matter: 'mulcz.jpg',
  buffer_strip_watercourse: 'zadrzewienia.jpg', reduced_tillage: 'mulcz.jpg',
  buffer_strip_flow_path: 'zadrzewienia.jpg', protect_depression: 'zaglebienie.jpg',
};

function Recommendation({ item }) {
  const image = actionImages[item.key];
  return <Card padding="lg" className="advice">
    {image && <Card.Section><Image src={`/design/${image}`} h={110} alt="" loading="lazy"/></Card.Section>}
    <Text fw={700} size="lg" lh={1.25} mt={image ? 'md' : 0}>{item.title}</Text>
    <Text size="sm" mt="xs">{item.what}</Text>
    {item.where && <Group gap={6} mt="xs" wrap="nowrap" align="flex-start"><IconMapPin size={16} style={{ marginTop: 2, flexShrink: 0 }}/>
      <Text size="sm" c="dimmed">{item.where}</Text></Group>}
    <Accordion variant="default" mt="xs" className="card-accordion">
      <Accordion.Item value="why"><Accordion.Control><Text size="sm">Dlaczego na tym polu · pewność {item.confidence}</Text></Accordion.Control>
        <Accordion.Panel><Text size="sm">{item.why}</Text>
          {item.confidence_reason && <Text size="xs" c="dimmed" mt={4}>{item.confidence_reason}</Text>}</Accordion.Panel></Accordion.Item>
    </Accordion>
  </Card>;
}

function IrrigationNeed({ need, crop }) {
  if (!need) return null;
  if (need.status !== 'ok') return <Note section={need}/>;
  const max = Math.max(1, ...need.monthly.map((m) => m.mm));
  return <Grid mt="lg" gutter="xl" align="flex-end" className="irrigation-need">
    <Grid.Col span={{ base: 12, md: 5 }}>
      <Text fw={700} mb={4}>Ile wody potrzebuje {crop.name.toLowerCase()} w sezonie</Text>
      <SimpleGrid cols={3} spacing="md" mb="sm">
        <Fact label="ten sezon do dziś" value={need.so_far_mm != null ? `${number(need.so_far_mm)} mm` : '—'}/>
        <Fact label="typowy sezon" value={need.typical_mm != null ? `${number(need.typical_mm)} mm` : '—'}/>
        <Fact label="suchy rok" value={need.dry_mm != null ? `${number(need.dry_mm)} mm` : '—'}/>
      </SimpleGrid>
      <Text size="xs" c="dimmed">Ilość netto, dawki po 25 mm, gdy zapas spada poniżej progu stresu.</Text>
    </Grid.Col>
    <Grid.Col span={{ base: 12, md: 7 }}>
      {need.monthly.some((m) => m.mm > 0) && <>
        <Text size="sm" c="dimmed" mb={6}>Typowo w miesiącach (mm)</Text>
        <div className="month-need">{need.monthly.map((m) => <div key={m.month}>
          <Text size="xs" fw={700}>{m.mm >= 1 ? number(m.mm) : ''}</Text>
          <span style={{ height: `${Math.max(2, 100 * m.mm / max)}%` }}/>
          <Text size="xs" c="dimmed">{MONTHS[m.month - 1]}</Text>
        </div>)}</div>
      </>}
    </Grid.Col>
  </Grid>;
}

function Recommendations({ report, terrainActions, satelliteChecks }) {
  const data = report.recommendations;
  const groups = [['retention', 'Zatrzymaj wodę na polu'], ['agrotechnical', 'Zabiegi agrotechniczne'], ['irrigation', 'Nawadnianie']];
  const checks = [...new Map([
    ...(data.field_checks ?? []), ...satelliteChecks, ...terrainActions.filter((item) => item.category === 'field_check'),
  ].map((item) => [item.key, item])).values()];
  return <Section title="Co robić?">
    <Note section={data}/>
    <Stack gap={40}>{groups.map(([category, title], i) => {
      const items = [...(data[category] ?? []), ...terrainActions.filter((item) => item.category === category)];
      return <div key={category}>
        <Title order={3} mb="sm">{title}</Title>
        {items.length ? <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">{items.map((item) =>
          <Recommendation key={item.key} item={item}/>)}</SimpleGrid>
          : <Text c="dimmed">{data.status !== 'ok' ? 'Na tym etapie brakuje danych do zaleceń.'
            : i === 2 ? data.irrigation_note || 'Raport nie wskazuje potrzeby nawadniania.' : 'Raport nie wskazuje działań w tej grupie.'}</Text>}
        {i === 2 && items.length > 0 && data.irrigation_note && <Text size="sm" c="dimmed" mt="xs">{data.irrigation_note}</Text>}
        {i === 2 && <IrrigationNeed need={report.irrigation_need} crop={report.crop}/>}
      </div>;
    })}</Stack>
    {checks.length > 0 && <Box mt={40}>
      <Title order={3} mb="sm">Co sprawdzić na polu</Title>
      <List spacing="sm">{checks.map((item) => <List.Item key={item.key}><Text fw={600} size="sm">{item.title}</Text>
        <Text size="sm" c="dimmed">{item.what}</Text></List.Item>)}</List>
    </Box>}
  </Section>;
}

// ---------- gleba ----------

function SoilTab({ report, printing }) {
  const { soil, soil_moisture: moisture, crop } = report;
  const rootCm = (soil.root_depth_m ?? crop.root_depth_m ?? 0) * 100;
  const regional = moisture?.status === 'ok' ? moisture.layers : [];
  const layers = mergeSoilLayers(soil.layers);   // te same klasy gleby obok siebie jako jedna warstwa, jak w modelu 3D
  return <Stack gap={56}>
    {!printing && <Field3D report={report} cropArea={report.test_crop_area} height={480}/>}
    <Grid gutter={48}>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Section title="Profil gleby">
          <Note section={soil}/>
          {layers.length > 0 && <Table striped mb="md">
            <Table.Thead><Table.Tr><Table.Th>Warstwa</Table.Th><Table.Th>Gleba</Table.Th><Table.Th>Woda dostępna</Table.Th><Table.Th>Pojemność polowa</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{layers.map((l) => <Table.Tr key={l.top_cm} c={l.top_cm < rootCm ? undefined : 'dimmed'}>
              <Table.Td>{l.top_cm}–{l.bottom_cm} cm</Table.Td><Table.Td>{l.texture_label}</Table.Td>
              <Table.Td>{number(l.available_water_mm)} mm</Table.Td><Table.Td>{number(l.field_capacity_vol_pct)}%</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>}

        </Section>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Section title="Wilgotność w okolicy">
          {regional.length ? <>

            <Stack gap="md">{regional.map((layer) => {
              const dry = layer.class_key === 'low' || layer.class_key === 'very_low';
              return <div key={layer.key}>
                <Text size="sm" fw={600}>{layer.label} <Text span size="xs" c="dimmed" fw={400}>{layer.bottom_cm == null ? 'cały profil' : `${layer.top_cm}–${layer.bottom_cm} cm`}</Text></Text>
                <div className="moisture-bar"><i style={{ width: `${layer.current * 100}%`, background: dry ? 'var(--mantine-color-orange-6)' : 'var(--mantine-color-blue-6)' }}/>
                  <b style={{ left: `${layer.median * 100}%` }}/></div>
                <Text size="xs" c={dry ? 'orange.8' : 'dimmed'} fw={dry ? 700 : 400}>{layer.class_label}</Text>

              </div>;
            })}</Stack>
            <Text size="xs" c="dimmed" mt="sm">Pasek: teraz · kreska: zwykle (10 lat) · NASA POWER, ok. 50 km</Text>
          </> : <Note section={moisture ?? { status: 'no_data' }} fallback="Brak danych o wilgotności warstw w okolicy."/>}
        </Section>
      </Grid.Col>
    </Grid>
  </Stack>;
}

// ---------- pogoda ----------

function WeatherWindows({ windows }) {
  if (!windows?.length) return null;
  const max = Math.max(1, ...windows.flatMap((w) => [w.rain_mm, w.rain_median_mm ?? 0, w.et0_mm, w.et0_median_mm ?? 0]));
  const bar = (value, typical, color, label) => <div className="compare-bar" role="img" aria-label={label}>
    <i style={{ width: `${100 * value / max}%`, background: `var(--mantine-color-${color}-6)` }}/>
    {typical != null && <b style={{ left: `${100 * typical / max}%` }}/>}
  </div>;
  return <Stack gap="lg">{windows.map((w) => <div key={w.days}>
    <Text fw={700} size="sm" mb={4}>Ostatnie {w.days} dni</Text>
    <Grid gutter="xs" align="center">
      <Grid.Col span={3}><Text size="sm">Opad</Text></Grid.Col>
      <Grid.Col span={6}>{bar(w.rain_mm, w.rain_median_mm, 'blue', `Opad ${w.days} dni`)}</Grid.Col>
      <Grid.Col span={3}><Text size="sm" ta="right">{number(w.rain_mm)} mm <Text span size="xs" c="dimmed">/ {number(w.rain_median_mm)}</Text></Text></Grid.Col>
      <Grid.Col span={3}><Text size="sm">Parowanie</Text></Grid.Col>
      <Grid.Col span={6}>{bar(w.et0_mm, w.et0_median_mm, 'orange', `Parowanie ${w.days} dni`)}</Grid.Col>
      <Grid.Col span={3}><Text size="sm" ta="right">{number(w.et0_mm)} mm <Text span size="xs" c="dimmed">/ {number(w.et0_median_mm)}</Text></Text></Grid.Col>
    </Grid>
  </div>)}
  <Text size="xs" c="dimmed">Kreska i liczba po ukośniku: zwykle (mediana 10 lat).</Text></Stack>;
}

function WeatherTab({ report }) {
  const water = report.water_status;
  const position = report.parcel?.centroid ?? report.request.point;
  const isToday = report.analysis_date >= today();
  const causes = (report.causes.items ?? []).filter((c) => /rain|precip|carry|et0|heat|temp|demand/.test(c.key));
  const forecast = <Section key="forecast" title="Prognoza na 7 dni"
    lead={isToday ? null : `Od dziś. Nie wchodzi do raportu na ${dateText(report.analysis_date)}.`}>
    <ForecastDays position={position} size="lg"/>
    {water.forecast?.length > 0 && <Table mt="lg" striped maw={620} captionSide="bottom">
      <Table.Caption>Czerwony: zapas poniżej progu stresu.</Table.Caption>
      <Table.Thead><Table.Tr><Table.Th>Dzień</Table.Th><Table.Th>Opad</Table.Th><Table.Th>Parowanie</Table.Th><Table.Th>Zapas wody</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{water.forecast.map((d) => <Table.Tr key={d.date} c={d.available_pct < d.stress_threshold_pct ? 'red.8' : undefined}>
        <Table.Td>{dateText(d.date)}</Table.Td><Table.Td>{number(d.rain_mm, 1)} mm</Table.Td><Table.Td>{number(d.et0_mm, 1)} mm</Table.Td>
        <Table.Td fw={700}>{number(d.available_pct)}%</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table>}
  </Section>;
  const past = <Grid key="past" gutter={48}>
    <Grid.Col span={{ base: 12, md: 7 }}>
      <Section title="Opad i parowanie na tle 10 lat"><WeatherWindows windows={report.causes.windows}/></Section>
    </Grid.Col>
    <Grid.Col span={{ base: 12, md: 5 }}>
      <Section title="Co z tego wynika">
        {water.climatic_water_balance && <Box mb="lg" className="facts"><Fact label={`Opad minus parowanie, ${water.climatic_water_balance.days} dni`}
          value={`${number(water.climatic_water_balance.balance_mm)} mm`}/></Box>}
        {causes.length ? <CauseList causes={causes}/> : <Text size="sm" c="dimmed">Pogoda nie jest główną przyczyną.</Text>}
      </Section>
    </Grid.Col>
  </Grid>;
  // analiza na dziś: najpierw to, co nadchodzi; analiza historyczna: najpierw pogoda przed datą raportu
  return <Stack gap={56}>{isToday ? [forecast, past] : [past, forecast]}</Stack>;
}

// ---------- teren i woda ----------

function HydrologyTable({ hydro }) {
  if (hydro.status !== 'ok' || !hydro.years?.length) return null;
  const label = hydro.metric === 'flow' ? 'Przepływ' : 'Stan wody';
  const digits = hydro.metric === 'flow' ? (hydro.median_value < 10 ? 2 : 1) : 0;
  return <Table mt="md" striped captionSide="bottom" maw={620}>
    <Table.Caption>{label} na wodowskazie {hydro.station_name}{hydro.river ? ` · ${hydro.river}` : ''} · IMGW-PIB, dane przetworzone</Table.Caption>
    <Table.Thead><Table.Tr><Table.Th>Rok lub okres</Table.Th><Table.Th>{label}</Table.Th></Table.Tr></Table.Thead>
    <Table.Tbody>{hydro.years.map(({ year, value }) => <Table.Tr key={year}><Table.Td>{year} · średnia z 7 dni</Table.Td>
      <Table.Td>{number(value, digits)} {hydro.unit}</Table.Td></Table.Tr>)}
      <Table.Tr fw={700}><Table.Td>{hydro.origin === 'live' ? 'Pomiar' : '7 dni do'} {dateText(hydro.current_to)}</Table.Td>
        <Table.Td>{number(hydro.current_value, digits)} {hydro.unit} · {hydro.class_label}</Table.Td></Table.Tr>
    </Table.Tbody>
  </Table>;
}

function TerrainTab({ report, terrain, failed, retry }) {
  const hydro = report.hydrology;
  return <Stack gap={56}>
    <Grid gutter={48}>
      <Grid.Col span={{ base: 12, md: 7 }} className="report-map">
        <ParcelMap parcel={report.parcel} point={report.parcel ? null : report.request.point} terrain={terrain}/>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Section title="Ukształtowanie i spływ">
          <Note section={terrain}/>
          {terrain?.status === 'pending' && <Text size="sm" c="dimmed">Liczę spadki i drogi spływu z modelu terenu (zwykle 15–60 s)…</Text>}
          {terrain?.status === 'ok' && <SimpleGrid cols={2} spacing="lg" mb="md" className="facts">
            <Fact label="Średni spadek" value={`${number(terrain.slope_mean_pct, 1)}%`}/>
            <Fact label="Najbardziej strome 10%" value={`> ${number(terrain.slope_p90_pct, 1)}%`}/>
          </SimpleGrid>}
          {terrain?.causes?.length > 0 && <Box mt="md"><CauseList causes={terrain.causes}/></Box>}
          {terrain?.text?.length > 0 && <Accordion variant="default" className="quiet-accordion" mt="sm">
            <Accordion.Item value="t"><Accordion.Control><Text size="sm">Szczegóły spływu</Text></Accordion.Control>
              <Accordion.Panel><Paragraphs lines={terrain.text} size="sm"/></Accordion.Panel></Accordion.Item></Accordion>}
          {failed && <Button mt="sm" size="xs" variant="default" onClick={retry}>Ponów pobieranie terenu</Button>}
        </Section>
      </Grid.Col>
    </Grid>
    <Section title="Rzeki w okolicy">
      <Note section={hydro}/>
      {hydro.status === 'ok' && <>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="lg" className="facts">
          <Fact label="Wodowskaz" value={hydro.station_name} hint={`${hydro.river} · ${number(hydro.station_distance_km)} km`}/>
          <Fact label={hydro.metric === 'flow' ? 'Przepływ teraz' : 'Stan wody teraz'} value={`${number(hydro.current_value, hydro.metric === 'flow' ? 2 : 0)} ${hydro.unit}`}
            hint={`zwykle ${number(hydro.median_value, hydro.metric === 'flow' ? 2 : 0)} ${hydro.unit}`}/>
          <Fact label="Na tle 10 lat" value={hydro.class_label} hint={`więcej wody było w ${hydro.years_higher} z ${hydro.years_compared} lat`}/>
        </SimpleGrid>
        <Accordion variant="default" className="quiet-accordion" mt="md">
          <Accordion.Item value="h"><Accordion.Control><Text size="sm">Pomiary z 10 lat</Text></Accordion.Control>
            <Accordion.Panel><HydrologyTable hydro={hydro}/></Accordion.Panel></Accordion.Item></Accordion>
      </>}
    </Section>
  </Stack>;
}

// ---------- historia ----------

function HistoryTab({ report }) {
  const history = report.history;
  const last = report.water_status.last_season;
  const critical = seasonMonths(report.crop);
  const seasons = history.seasons ?? [];
  const max = Math.max(1, ...seasons.map((s) => s.stress_days_critical));
  return <Stack gap={56}>
    <Section title="Czy niedobór się powtarza?" lead="Dni niedoboru w okresie krytycznym uprawy, sezon po sezonie.">
      <Note section={history}/>
      <div className="season-bars">{seasons.map((s) => <div key={s.season} className={s.stressed ? 'stressed' : ''}>
        <Text size="xs" fw={700}>{s.stress_days_critical}</Text>
        <span style={{ height: `${Math.max(3, 100 * s.stress_days_critical / max)}%` }}/>
        <Text size="xs" c="dimmed">{s.season}{!s.complete ? '*' : ''}</Text>
      </div>)}</div>
      {seasons.some((s) => !s.complete) && <Text size="xs" c="dimmed">* sezon w trakcie</Text>}
      {critical.length > 0 && <Group gap={4} mt="lg">
        <Text size="sm" c="dimmed" mr="xs">Okres krytyczny:</Text>
        {MONTHS.map((m, i) => <span key={m} className={critical.includes(i) ? 'month critical' : 'month'}>{m}</span>)}
      </Group>}
    </Section>
    {last && <Section title={`Miniony sezon ${last.season}`}>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="lg" className="facts">
        <Fact label="Opad" value={`${number(last.rain_mm)} mm`}/>
        <Fact label="Zużycie wody przez uprawę" value={`${number(last.etc_mm)} mm`}/>
        <Fact label="Dni niedoboru w okresie krytycznym" value={last.stress_days_critical}/>
        <Fact label="Największe wyczerpanie zapasu" value={`${number(last.max_depletion_pct_taw)}%`}/>
      </SimpleGrid>
    </Section>}
  </Stack>;
}

// ---------- źródła ----------

const sourceState = { ok: ['Użyto', 'green'], no_data: ['Brak danych', 'gray'], error: ['Niedostępne', 'red'], pending: ['W trakcie', 'blue'] };

function SourcesTab({ report, satelliteSource, terrain }) {
  const water = report.water_status;
  let sources = report.sources ?? [];
  for (const source of [satelliteSource, terrain?.source]) {
    if (source) sources = [...sources.filter((entry) => entry.key !== source.key), source];
  }
  return <Stack gap={56}>
    <Section title="Skąd to wiemy">
      <Table.ScrollContainer minWidth={620}><Table verticalSpacing="sm">
        <Table.Thead><Table.Tr><Table.Th>Źródło</Table.Th><Table.Th w={120}>Stan</Table.Th><Table.Th w={190}>Dane z okresu</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{sources.map((source, i) => {
          const [label, color] = sourceState[source.status] ?? [source.status, 'gray'];
          return <Table.Tr key={source.key + i}>
            <Table.Td><Text size="sm" fw={600}>{source.name}</Text>
              {source.status !== 'ok' && (source.reason || source.impact) && <Text size="xs" c="dimmed" mt={2}>{[source.reason, source.impact].filter(Boolean).join(' ')}</Text>}</Table.Td>
            <Table.Td><Badge variant="light" color={color}>{label}</Badge></Table.Td>
            <Table.Td><Text size="xs">{source.data_date ?? (source.data_from ? `${dateText(source.data_from)} – ${dateText(source.data_to)}` : 'brak daty')}</Text></Table.Td>
          </Table.Tr>;
        })}</Table.Tbody>
      </Table></Table.ScrollContainer>
    </Section>
    <Accordion variant="default" multiple className="quiet-accordion">
      <Accordion.Item value="limits"><Accordion.Control><Text fw={700}>Czego nie wiemy ({report.limitations?.length ?? 0})</Text></Accordion.Control>
        <Accordion.Panel><List size="sm" spacing={6}>{report.limitations?.map((s) => <List.Item key={s}>{s}</List.Item>)}</List></Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="method"><Accordion.Control><Text fw={700}>Jak to policzono</Text></Accordion.Control>
        <Accordion.Panel>
          <Paragraphs lines={water.text} size="sm"/>
          {water.variants?.length > 1 && <Table mt="md" striped>
            <Table.Thead><Table.Tr><Table.Th>Wariant gleby</Table.Th><Table.Th>Zapas</Table.Th><Table.Th>Ocena</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{water.variants.map((v) => <Table.Tr key={v.key}><Table.Td>{v.label}</Table.Td>
              <Table.Td>{number(100 * v.available_mm / v.taw_mm)}%</Table.Td><Table.Td>{v.class_label}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>}
          {report.crop.assumptions?.length > 0 && <><Title order={4} mt="lg" mb="xs">Założenia o uprawie</Title>
            <Paragraphs lines={report.crop.assumptions} size="sm"/></>}
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  </Stack>;
}

// ---------- widok pola ----------

export function Report({ field, tab, onTab, onSave, onEdit, onSatellite, saved }) {
  const { report } = field;
  const top = useRef(null);
  const printing = usePrinting();
  const sat = useDeferred(report.satellite.endpoint);
  const topo = useDeferred(report.terrain.endpoint);
  const satellite = sat.result?.satellite ?? (sat.failure ? { status: 'error', reason: sat.failure } : report.satellite);
  const terrain = topo.result ?? (topo.failure ? { status: 'error', reason: topo.failure } : report.terrain);
  const terrainActions = terrain.recommendations ?? [];
  const [notice, setNotice] = useState('');
  const water = report.water_status;
  const limited = water.spans_classes || water.soil_assumed;
  const recCount = report.recommendations.retention.length + report.recommendations.agrotechnical.length
    + report.recommendations.irrigation.length + terrainActions.filter((item) => item.category !== 'field_check').length;

  useEffect(() => { top.current?.querySelector('h1')?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (sat.result && sat.result.satellite?.status !== 'pending') onSatellite(field.id, report.generated_at, sat.result);
  }, [field.id, report.generated_at, sat.result, onSatellite]);

  function save() {
    setNotice(onSave(field) ? 'Raport zapisany w tej przeglądarce.' : '');
  }

  const panels = {
    podsumowanie: () => <Summary report={report} terrain={terrain} satellite={satellite} sat={sat} limited={limited} onTab={onTab} printing={printing}/>,
    rekomendacje: () => <Recommendations report={report} terrainActions={terrainActions} satelliteChecks={sat.result?.field_checks ?? []}/>,
    gleba: () => <SoilTab report={report} printing={printing}/>,
    pogoda: () => <WeatherTab report={report}/>,
    teren: () => <TerrainTab report={report} terrain={terrain} failed={topo.failure} retry={topo.retry}/>,
    historia: () => <HistoryTab report={report}/>,
    zrodla: () => <SourcesTab report={report} satelliteSource={sat.result?.source} terrain={terrain}/>,
  };
  const facts = [report.crop.name, report.parcel?.area_ha != null && `${number(report.parcel.area_ha, 2)} ha`,
    report.parcel?.id ?? 'wskazany punkt', `stan na ${dateText(report.analysis_date)}`].filter(Boolean);

  return <article className="report" ref={top}>
    <Group justify="space-between" align="flex-start" gap="md" mb="lg">
      <div>
        <Text size="sm" c="dimmed">{facts.join(' · ')}</Text>
        <Group gap="sm" mt={2}>
          <Title order={1} tabIndex={-1} className="field-name">{field.name}</Title>
          <span className="status-pill" style={{ '--c': cssColor(water) }}><i/>{statusShort(water)}</span>
        </Group>
      </div>
      <Group gap="xs" className="no-print">
        {notice && <Text role="status" size="sm" c="forest.8">{notice}</Text>}
        <Button variant="default" leftSection={<IconRefresh size={16}/>} onClick={onEdit}>Przelicz</Button>
        <Button variant="default" leftSection={<IconPrinter size={16}/>} onClick={() => window.print()}>PDF</Button>
        <Button leftSection={<IconDeviceFloppy size={16}/>} onClick={save}>{saved ? 'Zapisz' : 'Zapisz pole'}</Button>
      </Group>
    </Group>
    {printing ? <Stack gap={48}>{PRINT_ORDER.map((key) => <Box key={key} className="print-part">
      <Title order={2} className="print-heading">{TAB_LABELS[key]}</Title>{panels[key]()}</Box>)}</Stack>
      : <Tabs value={tab} onChange={(next) => next && onTab(next)} keepMounted={false} className="field-tabs">
        <Tabs.List className="field-tabs-list no-print">
          {TABS.map((key) => <Tabs.Tab key={key} value={key}
            rightSection={key === 'rekomendacje' && recCount ? <Badge size="sm" variant="light" circle>{recCount}</Badge> : null}>
            {TAB_LABELS[key]}</Tabs.Tab>)}
        </Tabs.List>
        {TABS.map((key) => <Tabs.Panel key={key} value={key} pt={40}>{panels[key]()}</Tabs.Panel>)}
      </Tabs>}
  </article>;
}
