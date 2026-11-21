import { useEffect, useRef, useState } from 'react';
import {
  Accordion, Alert, Anchor, Badge, Box, Button, Card, Code, Divider, Grid, Group, Image, List, Paper, Progress, RingProgress,
  SimpleGrid, Slider, Stack, Table, Text, ThemeIcon, Title,
} from '@mantine/core';
import {
  IconArrowLeft, IconCalendar, IconCloudRain, IconDeviceFloppy, IconDroplet, IconMapPin, IconMountain, IconPlant2,
  IconPrinter, IconRefresh, IconSatellite, IconStack2, IconTemperature, IconWaveSine,
} from '@tabler/icons-react';
import { ParcelMap } from './ParcelMap.jsx';
import { api, Note, Paragraphs, Sparkline, Status, statusColor } from './ui.jsx';
import { dateText, number, satelliteMeasurements, seasonMonths, waterPercent } from './model.js';

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

function Section({ step, title, children, id }) {
  return <Box component="section" id={id} className="report-section">
    <Group gap="sm" mb="md" wrap="nowrap">
      {step && <ThemeIcon size={32} radius="xl" variant="filled">{step}</ThemeIcon>}
      <Title order={2}>{title}</Title>
    </Group>
    {children}
  </Box>;
}

function Stat({ icon: Icon, label, value, hint, color = 'forest' }) {
  return <Paper p="md">
    <Group gap="xs" mb={4}><ThemeIcon size={26} variant="light" color={color}><Icon size={16}/></ThemeIcon>
      <Text size="sm" c="dimmed">{label}</Text></Group>
    <Text fw={700} size="xl" lh={1.2}>{value}</Text>
    {hint && <Text size="xs" c="dimmed" mt={2}>{hint}</Text>}
  </Paper>;
}

// ---------- 1. ocena ----------

function Assessment({ report, satellite, satFailed, satRetry }) {
  const water = report.water_status;
  const value = waterPercent(water.result);
  const climat = water.climatic_water_balance;
  const history = report.history;
  const rain = report.causes.windows?.find((w) => w.days === 30);
  const series = (water.series ?? []).filter((day) => day.taw_mm > 0).map((day) =>
    Math.min(100, Math.max(0, 100 * (1 - day.depletion_mm / day.taw_mm))));
  return <Section step="1" title="Jak jest z wodą?" id="ocena">
    <Paper p={{ base: 'md', md: 'xl' }}>
      <Group align="center" gap="xl" wrap="wrap">
        <RingProgress size={170} thickness={16} roundCaps sections={[{ value: value ?? 0, color: statusColor(water) }]}
          label={<Stack gap={0} align="center"><Text fw={800} size="32px" lh={1}>{value == null ? '—' : `${number(value)}%`}</Text>
            <Text size="xs" c="dimmed" ta="center">zapasu wody<br/>w strefie korzeni</Text></Stack>}/>
        <Stack gap="xs" flex={1} miw={260}>
          <Status water={water}/>
          <Title order={3} fz={{ base: 24, md: 30 }}>{water.headline ?? water.class_label ?? 'Brakuje danych do oceny'}</Title>
          <Note section={water}/>
          {report.summary?.slice(1).filter((line) => line !== water.uncertainty_text).map((line) => <Text key={line}>{line}</Text>)}
        </Stack>
      </Group>
    </Paper>
    <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md" mt="md">
      <Stat icon={IconCloudRain} color="blue" label="Opad, ostatnie 30 dni"
        value={rain ? `${number(rain.rain_mm)} mm` : '—'} hint={rain?.rain_median_mm != null ? `mediana 10 lat: ${number(rain.rain_median_mm)} mm` : null}/>
      <Stat icon={IconTemperature} color="orange" label={`Bilans klimatyczny, ${climat?.days ?? 60} dni`}
        value={climat ? `${number(climat.balance_mm)} mm` : '—'} hint="opad minus parowanie"/>
      <Stat icon={IconCalendar} color="grape" label="Sezony z niedoborem"
        value={history.seasons_total ? `${history.seasons_with_stress} z ${history.seasons_total}` : '—'} hint="ostatnie pełne sezony"/>
      <Stat icon={IconPlant2} label="Faza uprawy" value={report.crop.stage_name ?? '—'}
        hint={report.crop.in_season === false ? 'poza okresem wzrostu' : report.crop.name}/>
    </SimpleGrid>
    {water.uncertainty_text && <Alert mt="md" color="yellow" variant="light" title="Niepewność">{water.uncertainty_text}</Alert>}
    <SoilProfile soil={report.soil} moisture={report.soil_moisture} water={water} crop={report.crop}/>
    <Satellite satellite={satellite} failed={satFailed} retry={satRetry}/>
    {water.status === 'ok' && <Accordion variant="separated" radius="lg" mt="md">
      <Accordion.Item value="balance"><Accordion.Control>Szczegóły bilansu wodnego</Accordion.Control>
        <Accordion.Panel>
          <Paragraphs lines={water.text}/>
          {climat && <Text mt={6}>{climat.text}</Text>}
          {series.length > 1 && <Box mt="md" c="forest.8">
            <Text fw={600} c="dark">Zapas wody w ostatnich dniach</Text>
            <Sparkline values={series} min={0} max={100} height={70} label="Zmiana zapasu wody w strefie korzeniowej"/>
            <Group justify="space-between"><Text size="xs" c="dimmed">{dateText(water.series[0].date)}</Text>
              <Text size="xs" c="dimmed">{dateText(water.series.at(-1).date)}</Text></Group>
          </Box>}
          {water.variants?.length > 1 && <Table mt="md" striped>
            <Table.Thead><Table.Tr><Table.Th>Wariant gleby</Table.Th><Table.Th>Zapas</Table.Th><Table.Th>Ocena</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{water.variants.map((v) => <Table.Tr key={v.key}><Table.Td>{v.label}</Table.Td>
              <Table.Td>{number(waterPercent(v))}%</Table.Td><Table.Td>{v.class_label}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>}
          {water.last_season?.text && <Text mt="md">{water.last_season.text}</Text>}
        </Accordion.Panel></Accordion.Item>
    </Accordion>}
  </Section>;
}

const textureColors = { sand: '#c9a46c', sandy_loam: '#a97d4c', loam: '#8a643f', silt_loam: '#7a6345', clay: '#6a4330' };

function SoilProfile({ soil, moisture, water, crop }) {
  if (!soil.layers?.length) return null;
  const rootCm = (soil.root_depth_m ?? crop.root_depth_m ?? 0) * 100;
  const fill = waterPercent(water.result);
  const regional = moisture?.status === 'ok' ? moisture.layers : [];
  return <Paper p={{ base: 'md', md: 'lg' }} mt="md">
    <Group justify="space-between" align="baseline" mb="md">
      <Group gap="xs"><IconStack2 size={22}/><Title order={3}>Woda w warstwach gleby</Title></Group>
      <Text size="xs" c="dimmed">Gleba: SoilGrids 250 m · zapas: bilans działki · okolica: NASA POWER ok. 50 km</Text>
    </Group>
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, md: 7 }}>
        <ol className="profile-column" aria-label="Przekrój gleby od powierzchni w głąb"
          style={{ gridTemplateRows: soil.layers.map((l) => `minmax(46px, ${l.bottom_cm - l.top_cm}fr)`).join(' ') }}>
          {soil.layers.map((layer) => {
            const root = rootCm > layer.top_cm && rootCm < layer.bottom_cm
              ? 100 * (rootCm - layer.top_cm) / (layer.bottom_cm - layer.top_cm) : null;
            return <li key={layer.top_cm} className={layer.top_cm < rootCm ? 'in-root' : ''}
              style={{ background: textureColors[layer.texture_key] ?? '#8a6a48' }}>
              <Text size="sm" fw={700} w={78}>{layer.top_cm}–{layer.bottom_cm} cm</Text>
              <div><Text size="sm" fw={600}>{layer.texture_label}</Text>
                <Text size="xs" opacity={.85} className="layer-detail">{number(layer.available_water_mm)} mm wody dostępnej · pojemność polowa {number(layer.field_capacity_vol_pct)}%</Text></div>
              {root != null && <i className="root-line" style={{ top: `${root}%` }}><b>korzenie do {number(rootCm)} cm</b></i>}
            </li>;
          })}
        </ol>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Stack gap="lg">
          <div>
            <Text fw={700} mb={6}>Strefa korzeni na działce</Text>
            {fill == null ? <Text size="sm" c="dimmed">Brak bilansu wodnego.</Text> : <>
              <Progress.Root size={22} radius="xl"><Progress.Section value={fill} color="blue.7">
                <Progress.Label>{number(fill)}%</Progress.Label></Progress.Section></Progress.Root>
              <Text size="sm" mt={6}>{number(water.result.available_mm)} z {number(water.result.taw_mm)} mm wody dostępnej</Text>
              <Text size="xs" c="dimmed">Warstwy do {number(rootCm)} cm liczone razem (bilans FAO-56)</Text>
            </>}
          </div>
          <Divider/>
          <div>
            <Text fw={700} mb={6}>Okolica na tle 10 lat</Text>
            {regional.length ? <Stack gap="md">{regional.map((layer) => {
              const dry = layer.class_key === 'low' || layer.class_key === 'very_low';
              return <div key={layer.key}>
                <Group justify="space-between" gap={4}>
                  <Text size="sm" fw={600}>{layer.label} <Text span size="xs" c="dimmed">
                    {layer.bottom_cm == null ? 'cały profil' : `${layer.top_cm}–${layer.bottom_cm} cm`}</Text></Text>
                  <Badge size="sm" variant="light" color={dry ? 'orange' : layer.class_key === 'high' ? 'blue' : 'gray'}>{layer.class_label}</Badge>
                </Group>
                <div className="moisture-bar" role="img" aria-label={`Wilgotność ${number(layer.current * 100)}%, mediana ${number(layer.median * 100)}%`}>
                  <i style={{ width: `${layer.current * 100}%`, background: dry ? 'var(--mantine-color-orange-6)' : 'var(--mantine-color-blue-6)' }}/>
                  <b style={{ left: `${layer.median * 100}%` }}/></div>
                <Text size="xs" c="dimmed">wilgotniej było w {layer.years_higher} z {layer.years_compared} lat</Text>
              </div>;
            })}
              <Text size="xs" c="dimmed">Pasek: teraz (7 dni do {dateText(regional[0].current_to)}). Kreska: mediana z poprzednich lat.</Text>
            </Stack> : <Text size="sm" c="dimmed">{moisture?.reason ?? 'Brak danych o wilgotności warstw w okolicy.'}</Text>}
          </div>
        </Stack>
      </Grid.Col>
    </Grid>
    {moisture?.text?.length > 0 && <Accordion variant="contained" radius="md" mt="md">
      <Accordion.Item value="m"><Accordion.Control>Jak czytać te dane</Accordion.Control>
        <Accordion.Panel><Paragraphs lines={moisture.text} size="sm"/></Accordion.Panel></Accordion.Item>
    </Accordion>}
  </Paper>;
}

function Satellite({ satellite, failed, retry }) {
  const measurements = satelliteMeasurements(satellite);
  const [index, setIndex] = useState(null);
  const observation = index == null ? measurements.at(-1) : measurements[index];
  return <Paper p={{ base: 'md', md: 'lg' }} mt="md">
    <Group gap="xs" mb="xs"><IconSatellite size={22}/><Title order={3}>Rośliny na zdjęciach satelitarnych</Title>
      {satellite.status === 'pending' && <Badge variant="light" color="gray">wczytuję</Badge>}</Group>
    <Note section={satellite} fallback="Brak obserwacji satelitarnych."/>
    <Paragraphs lines={satellite.text} size="sm"/>
    {failed && <Button mt="sm" size="xs" variant="default" leftSection={<IconRefresh size={14}/>} onClick={retry}>Ponów pobieranie obserwacji</Button>}
    {measurements.length > 1 && <Box mt="md" c="forest.7">
      <Sparkline values={measurements.map((o) => o.ndvi)} min={-1} max={1} height={60}
        label="Zmiana wskaźnika zieloności w dostępnych obserwacjach satelitarnych"/>
      <Slider className="no-print" mt="xs" min={0} max={measurements.length - 1} step={1} label={null}
        value={index ?? measurements.length - 1} onChange={setIndex}/>
    </Box>}
    {observation && <Text size="sm" mt="xs">{dateText(observation.date)} · zieloność (NDVI) {number(observation.ndvi, 2)}
      {Number.isFinite(observation.ndmi) && ` · wilgotność roślin (NDMI) ${number(observation.ndmi, 2)}`} · pokrycie {number(observation.coverage_pct)}%</Text>}
    {satellite.observations?.some((s) => !s.accepted) && <Text size="xs" c="dimmed" mt={4}>Część scen pominięto z powodu chmur lub małego pokrycia działki.</Text>}
  </Paper>;
}

// ---------- historia (część oceny: podatność z 10 lat) ----------

const months = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

function History({ report }) {
  const history = report.history;
  const critical = seasonMonths(report.crop);
  const max = Math.max(1, ...(history.seasons ?? []).map((s) => s.stress_days_critical));
  return <Section step="2" title="Czy to się powtarza?" id="historia">
    <Grid gutter="md">
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Paper p="lg" h="100%">
          <Text fw={700}>Okres największej wrażliwości uprawy</Text>
          <Text size="sm" c="dimmed" mb="md">{report.crop.name}</Text>
          {critical.length > 0 ? <>
            <SimpleGrid cols={6} spacing={4}>{months.map((m, i) =>
              <Text key={m} ta="center" size="sm" py={6} className={critical.includes(i) ? 'month critical' : 'month'}>{m}</Text>)}</SimpleGrid>
            <Text mt="md" fw={600}>{dateText(report.crop.critical_from).slice(0, 5)}–{dateText(report.crop.critical_to).slice(0, 5)}</Text>
          </> : <Text size="sm">Brak okresu krytycznego w tej analizie.</Text>}
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Paper p="lg" h="100%">
          <Text fw={700}>10 sezonów na tym polu</Text>
          <Text size="sm" c="dimmed" mb="md">Dni niedoboru wody w okresie krytycznym</Text>
          <Note section={history}/>
          <Stack gap={8}>{history.seasons?.map((s) => <Group key={s.season} gap="sm" wrap="nowrap">
            <Text size="sm" w={86}>{s.season}{!s.complete && <Text span size="xs" c="dimmed"> · trwa</Text>}</Text>
            <Progress flex={1} value={100 * s.stress_days_critical / max} color={s.stressed ? 'orange' : 'forest.4'} size="md" radius="xl"
              aria-label={`Dni niedoboru w sezonie ${s.season}`}/>
            <Text size="sm" fw={600} w={56} ta="right">{s.stress_days_critical} dni</Text>
          </Group>)}</Stack>
          {history.text?.length > 0 && <Accordion variant="default" mt="sm">
            <Accordion.Item value="h"><Accordion.Control>Jak czytać historię?</Accordion.Control>
              <Accordion.Panel><Paragraphs lines={history.text} size="sm"/></Accordion.Panel></Accordion.Item></Accordion>}
        </Paper>
      </Grid.Col>
    </Grid>
  </Section>;
}

// ---------- 3. przyczyny ----------

function causeIcon(key) {
  if (key.includes('soil')) return IconStack2;
  if (key.includes('rain') || key.includes('precip')) return IconCloudRain;
  if (key.includes('et0') || key.includes('heat') || key.includes('temp')) return IconTemperature;
  if (key.includes('slope') || key.includes('flow') || key.includes('terrain') || key.includes('runoff')) return IconMountain;
  if (key.includes('river')) return IconWaveSine;
  return IconDroplet;
}

function Causes({ report, terrain, failed, retry }) {
  const causes = report.causes;
  const all = [...(causes.items ?? []), ...(terrain?.causes ?? [])];
  return <Section step="3" title="Dlaczego?" id="przyczyny">
    <Note section={causes}/>
    {all.length > 0 && <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">{all.map((cause) => {
      const Icon = causeIcon(cause.key);
      return <Paper p="lg" key={cause.key}>
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon size={36} variant="light" radius="md"><Icon size={20}/></ThemeIcon>
          <div><Text fw={700}>{cause.title}</Text><Text size="sm" mt={4}>{cause.text}</Text></div>
        </Group>
      </Paper>;
    })}</SimpleGrid>}
    {causes.reason && causes.status === 'ok' && <Text c="dimmed" mt="sm">{causes.reason}</Text>}
    <Accordion variant="separated" radius="lg" mt="md" multiple>
      {causes.windows?.length > 0 && <Accordion.Item value="weather"><Accordion.Control>Opad i parowanie na tle 10 lat</Accordion.Control>
        <Accordion.Panel><Table.ScrollContainer minWidth={480}><Table striped>
          <Table.Thead><Table.Tr><Table.Th>Okres</Table.Th><Table.Th>Opad</Table.Th><Table.Th>Mediana opadu</Table.Th>
            <Table.Th>Parowanie</Table.Th><Table.Th>Mediana parowania</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{causes.windows.map((row) => <Table.Tr key={row.days}><Table.Td>{row.days} dni</Table.Td>
            {['rain_mm', 'rain_median_mm', 'et0_mm', 'et0_median_mm'].map((key) =>
              <Table.Td key={key}>{row[key] == null ? '—' : `${number(row[key], 1)} mm`}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
        </Table></Table.ScrollContainer></Accordion.Panel></Accordion.Item>}
      <Accordion.Item value="soil"><Accordion.Control>Gleba</Accordion.Control>
        <Accordion.Panel><Note section={report.soil}/><Paragraphs lines={report.soil.text} size="sm"/></Accordion.Panel></Accordion.Item>
      <Accordion.Item value="terrain"><Accordion.Control>Teren i spływ wody</Accordion.Control>
        <Accordion.Panel><Note section={terrain}/><Paragraphs lines={terrain?.text} size="sm"/>
          <Paragraphs lines={terrain?.limitations} size="sm" c="dimmed"/>
          {failed && <Button mt="sm" size="xs" variant="default" onClick={retry}>Ponów pobieranie terenu</Button>}
          {causes.not_assessed?.filter((s) => terrain?.status !== 'ok' || !s.startsWith('Spadek terenu')).map((s) =>
            <Text size="sm" c="dimmed" key={s} mt={4}>{s}</Text>)}</Accordion.Panel></Accordion.Item>
      <Accordion.Item value="water"><Accordion.Control>Rzeki i wody w okolicy</Accordion.Control>
        <Accordion.Panel><Note section={report.hydrology}/><Paragraphs lines={report.hydrology.text} size="sm"/>
          <HydrologyTable hydro={report.hydrology}/></Accordion.Panel></Accordion.Item>
    </Accordion>
  </Section>;
}

function HydrologyTable({ hydro }) {
  if (hydro.status !== 'ok' || !hydro.years?.length) return null;
  const label = hydro.metric === 'flow' ? 'Przepływ' : 'Stan wody';
  const digits = hydro.metric === 'flow' ? (hydro.median_value < 10 ? 2 : 1) : 0;
  return <Table mt="md" striped captionSide="bottom">
    <Table.Caption>{label} na wodowskazie {hydro.station_name}{hydro.river ? ` · ${hydro.river}` : ''} · IMGW-PIB, dane przetworzone</Table.Caption>
    <Table.Thead><Table.Tr><Table.Th>Rok lub okres</Table.Th><Table.Th>{label}</Table.Th></Table.Tr></Table.Thead>
    <Table.Tbody>{hydro.years.map(({ year, value }) => <Table.Tr key={year}><Table.Td>{year} · średnia z 7 dni</Table.Td>
      <Table.Td>{number(value, digits)} {hydro.unit}</Table.Td></Table.Tr>)}
      <Table.Tr fw={700}><Table.Td>{hydro.origin === 'live' ? 'Pomiar' : '7 dni do'} {dateText(hydro.current_to)}</Table.Td>
        <Table.Td>{number(hydro.current_value, digits)} {hydro.unit} · {hydro.class_label}</Table.Td></Table.Tr>
    </Table.Tbody>
  </Table>;
}

// ---------- 4. działania ----------

const actionImages = {
  residue_cover: 'mulcz.jpg', cover_crop: 'miedzyplon.jpg', organic_matter: 'mulcz.jpg',
  buffer_strip_watercourse: 'zadrzewienia.jpg', reduced_tillage: 'mulcz.jpg',
  buffer_strip_flow_path: 'zadrzewienia.jpg', protect_depression: 'zaglebienie.jpg',
};
const confidenceColor = { wysoka: 'green', średnia: 'yellow', niska: 'gray' };

function Recommendation({ item }) {
  const image = actionImages[item.key];
  return <Card padding="lg">
    {image && <Card.Section><Image src={`/design/${image}`} h={120} alt="" loading="lazy"/></Card.Section>}
    <Group justify="space-between" align="flex-start" mt={image ? 'md' : 0} wrap="nowrap">
      <Text fw={700} size="lg" lh={1.25}>{item.title}</Text>
      {item.confidence && <Badge variant="light" color={confidenceColor[item.confidence] ?? 'gray'} style={{ flexShrink: 0 }}>
        pewność: {item.confidence}</Badge>}
    </Group>
    <Text size="sm" mt="xs">{item.what}</Text>
    {item.where && <Group gap={6} mt="xs" wrap="nowrap" align="flex-start"><IconMapPin size={16} style={{ marginTop: 2 }}/>
      <Text size="sm" c="dimmed">{item.where}</Text></Group>}
    <Accordion variant="default" mt="xs" className="card-accordion">
      <Accordion.Item value="why"><Accordion.Control>Dlaczego na tym polu?</Accordion.Control>
        <Accordion.Panel><Text size="sm">{item.why}</Text>
          {item.confidence_reason && <Text size="xs" c="dimmed" mt={4}>{item.confidence_reason}</Text>}</Accordion.Panel></Accordion.Item>
    </Accordion>
  </Card>;
}

function Recommendations({ report, terrainActions, satelliteChecks }) {
  const data = report.recommendations;
  const groups = [['retention', 'Zatrzymaj wodę na polu'], ['agrotechnical', 'Zabiegi agrotechniczne'], ['irrigation', 'Nawadnianie']];
  const checks = [...new Map([
    ...(data.field_checks ?? []), ...satelliteChecks, ...terrainActions.filter((item) => item.category === 'field_check'),
  ].map((item) => [item.key, item])).values()];
  return <Section step="4" title="Co robić?" id="dzialania">
    <Note section={data}/>
    <Stack gap="xl">{groups.map(([category, title], i) => {
      const items = [...(data[category] ?? []), ...terrainActions.filter((item) => item.category === category)];
      return <div key={category}>
        <Group gap="xs" mb="sm"><Badge variant="outline" size="lg" radius="sm">{String.fromCharCode(97 + i)}</Badge>
          <Title order={3}>{title}</Title></Group>
        {items.length ? <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">{items.map((item) =>
          <Recommendation key={item.key} item={item}/>)}</SimpleGrid>
          : <Paper p="md"><Text c="dimmed">{data.status !== 'ok' ? 'Na tym etapie brakuje danych do zaleceń.'
            : i === 2 ? data.irrigation_note || 'Raport nie wskazuje potrzeby nawadniania.' : 'Raport nie wskazuje działań w tej grupie.'}</Text></Paper>}
        {i === 2 && items.length > 0 && data.irrigation_note && <Text size="sm" c="dimmed" mt="xs">{data.irrigation_note}</Text>}
      </div>;
    })}</Stack>
    {checks.length > 0 && <Paper p="lg" mt="xl" bg="yellow.0">
      <Title order={3} mb="sm">Co sprawdzić na polu</Title>
      <Stack gap="sm">{checks.map((item) => <div key={item.key}><Text fw={600}>{item.title}</Text>
        <Text size="sm">{item.what}</Text><Text size="xs" c="dimmed">{item.why}</Text></div>)}</Stack>
    </Paper>}
  </Section>;
}

// ---------- 5. źródła ----------

const sourceState = { ok: ['Użyto', 'green'], no_data: ['Brak danych', 'gray'], error: ['Niedostępne', 'red'], pending: ['W trakcie', 'blue'] };

function Sources({ report, satelliteSource, terrain }) {
  let sources = report.sources ?? [];
  for (const source of [satelliteSource, terrain?.source]) {
    if (source) sources = [...sources.filter((entry) => entry.key !== source.key), source];
  }
  return <Section step="5" title="Skąd to wiemy i czego nie wiemy?" id="zrodla">
    <Paper p={{ base: 'sm', md: 'lg' }}>
      <Table.ScrollContainer minWidth={620}><Table verticalSpacing="sm">
        <Table.Thead><Table.Tr><Table.Th>Źródło</Table.Th><Table.Th w={120}>Stan</Table.Th><Table.Th w={190}>Dane z okresu</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{sources.map((source, i) => {
          const [label, color] = sourceState[source.status] ?? [source.status, 'gray'];
          return <Table.Tr key={source.key + i}>
            <Table.Td><Text size="sm" fw={600}>{source.name}</Text><Text size="xs" c="dimmed">{source.resolution}</Text>
              {(source.reason || source.impact) && <Text size="xs" mt={2}>{[source.reason, source.impact].filter(Boolean).join(' ')}</Text>}
              {source.notes?.length > 0 && <Text size="xs" c="dimmed" mt={2}>{source.notes.join(' ')}</Text>}</Table.Td>
            <Table.Td><Badge variant="light" color={color}>{label}</Badge></Table.Td>
            <Table.Td><Text size="xs">{source.data_date ?? (source.data_from ? `${dateText(source.data_from)} – ${dateText(source.data_to)}` : 'brak daty')}</Text></Table.Td>
          </Table.Tr>;
        })}</Table.Tbody>
      </Table></Table.ScrollContainer>
      <Title order={3} mt="lg" mb="xs">Ograniczenia</Title>
      <List size="sm" spacing={4}>{report.limitations?.map((s) => <List.Item key={s}>{s}</List.Item>)}</List>
      {report.crop.assumptions?.length > 0 && <><Title order={4} mt="md" mb="xs">Założenia o uprawie</Title>
        <Paragraphs lines={report.crop.assumptions} size="sm"/></>}
    </Paper>
  </Section>;
}

export function Report({ field, onSave, onEdit, onSatellite, saved }) {
  const { report } = field;
  const heading = useRef(null);
  const sat = useDeferred(report.satellite.endpoint);
  const topo = useDeferred(report.terrain.endpoint);
  const satellite = sat.result?.satellite ?? (sat.failure ? { status: 'error', reason: sat.failure } : report.satellite);
  const terrain = topo.result ?? (topo.failure ? { status: 'error', reason: topo.failure } : report.terrain);
  const terrainActions = terrain.recommendations ?? [];
  const [notice, setNotice] = useState('');
  const limited = report.water_status.spans_classes || report.water_status.soil_assumed;

  useEffect(() => { heading.current.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (sat.result && sat.result.satellite?.status !== 'pending') onSatellite(field.id, report.generated_at, sat.result);
  }, [field.id, report.generated_at, sat.result, onSatellite]);

  function save() {
    setNotice(onSave(field) ? 'Raport zapisany w tej przeglądarce.' : '');
  }

  return <Stack component="article" gap={48} className="report">
    <Stack gap="md">
      <Group justify="space-between" className="no-print">
        <Button component="a" href={window.location.search ? '/' : '#'} variant="subtle" leftSection={<IconArrowLeft size={18}/>}>Wszystkie pola</Button>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconRefresh size={16}/>} onClick={onEdit}>Przelicz</Button>
          <Button variant="default" leftSection={<IconPrinter size={16}/>} onClick={() => window.print()}>PDF / drukuj</Button>
          <Button leftSection={<IconDeviceFloppy size={16}/>} onClick={save}>{saved ? 'Zapisz' : 'Zapisz pole'}</Button>
        </Group>
      </Group>
      <Grid gutter="lg" align="stretch">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="sm" justify="center" h="100%">
            <Text size="sm" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Raport wody na działce</Text>
            <Title order={1} tabIndex={-1} ref={heading}>{field.name}</Title>
            <Group gap="xs">
              <Badge variant="light" size="lg" leftSection={<IconPlant2 size={14}/>}>{report.crop.name}</Badge>
              {report.parcel?.area_ha != null && <Badge variant="light" color="gray" size="lg">{number(report.parcel.area_ha, 2)} ha</Badge>}
              <Badge variant="light" color="gray" size="lg" leftSection={<IconCalendar size={14}/>}>stan na {dateText(report.analysis_date)}</Badge>
              <Status water={report.water_status}/>
            </Group>
            <Code>{report.parcel?.id ?? report.request.parcel_id ?? 'wskazany punkt'}</Code>
            {limited && <Alert color="yellow" variant="light" p="xs">Ograniczona pewność wyniku. <Anchor href="#zrodla" size="sm"
              onClick={(e) => { e.preventDefault(); document.getElementById('zrodla').scrollIntoView(); }}>Zobacz źródła i ograniczenia</Anchor></Alert>}
            {notice && <Text role="status" size="sm" c="forest.8">{notice}</Text>}
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }} className="report-map">
          <ParcelMap parcel={report.parcel} point={report.parcel ? null : report.request.point} terrain={terrain}/>
        </Grid.Col>
      </Grid>
    </Stack>
    <Assessment report={report} satellite={satellite} satFailed={sat.failure} satRetry={sat.retry}/>
    <History report={report}/>
    <Causes report={report} terrain={terrain} failed={topo.failure} retry={topo.retry}/>
    <Recommendations report={report} terrainActions={terrainActions} satelliteChecks={sat.result?.field_checks ?? []}/>
    <Sources report={report} satelliteSource={sat.result?.source} terrain={terrain}/>
  </Stack>;
}
