import { useEffect, useRef, useState } from 'react';
import {
  Accordion, Anchor, Badge, Box, Button, Card, Divider, Grid, Group, Image, List, SegmentedControl,
  SimpleGrid, Slider, Stack, Table, Text, Title,
} from '@mantine/core';
import {
  IconArrowLeft, IconArrowRight, IconCloudRain, IconDeviceFloppy, IconDroplet, IconMapPin, IconMountain, IconPrinter,
  IconRefresh, IconStack2, IconTemperature, IconWaveSine,
} from '@tabler/icons-react';
import { Field3D } from './Field3D.jsx';
import { ParcelMap } from './ParcelMap.jsx';
import { WaterChart } from './WaterChart.jsx';
import { api, Note, Paragraphs, Sparkline, statusColor } from './ui.jsx';
import { dateText, mergeSoilLayers, number, satelliteMeasurements, seasonMonths } from './model.js';

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

function Section({ title, lead, children, id }) {
  return <Box component="section" id={id} className="report-section">
    <Title order={2} mb={lead ? 4 : 'md'}>{title}</Title>
    {lead && <Text c="dimmed" mb="lg" maw={720}>{lead}</Text>}
    {children}
  </Box>;
}

const cssColor = (water) => `var(--mantine-color-${statusColor(water)}-7)`;
const scrollTo = (id) => (event) => { event.preventDefault(); document.getElementById(id).scrollIntoView({ behavior: 'smooth' }); };

// ---------- nagłówek: werdykt w jednym zdaniu ----------

function Verdict({ report, field, limited }) {
  const water = report.water_status;
  const result = water.result;
  const first = [...report.recommendations.retention, ...report.recommendations.agrotechnical, ...report.recommendations.irrigation][0];
  const stressDay = water.forecast_stress_day;
  const facts = [report.crop.name, report.parcel?.area_ha != null && `${number(report.parcel.area_ha, 2)} ha`,
    report.parcel?.id ?? 'wskazany punkt', `stan na ${dateText(report.analysis_date)}`].filter(Boolean);
  return <Stack gap="lg" justify="center" h="100%">
    <div>
      <Title order={1} tabIndex={-1} className="field-name">{field.name}</Title>
      <Text size="sm" c="dimmed" mt={4}>{facts.join(' · ')}</Text>
    </div>
    <div>
      <Text className="verdict" c={cssColor(water)}>{water.headline ?? 'Brakuje danych do oceny'}</Text>
      {result && <Text size="lg" mt={8}>
        W zasięgu korzeni jest {number(result.available_mm)} z {number(result.taw_mm)} mm wody, którą ta gleba może zmieścić
        {result.depletion_mm > 1 ? `; brakuje ${number(result.depletion_mm)} mm do pełnego zapasu.` : '.'}
        {stressDay ? ` Przy prognozowanej pogodzie stres wodny od ${dateText(stressDay)}.`
          : water.forecast?.length ? ' Prognoza na 7 dni nie przewiduje stresu.' : ''}
      </Text>}
      <Note section={water}/>
    </div>
    {first && <Anchor href="#dzialania" underline="never" className="next-step" onClick={scrollTo('dzialania')}>
      <Text size="xs" tt="uppercase" fw={700} c="dimmed" lts={.6}>Najważniejsze teraz</Text>
      <Group gap={6} wrap="nowrap"><Text fw={700} size="lg">{first.title}</Text><IconArrowRight size={18}/></Group>
    </Anchor>}
    {limited && <Text size="sm" c="dimmed">{water.uncertainty_text ?? 'Ograniczona pewność wyniku.'}{' '}
      <Anchor size="sm" href="#zrodla" onClick={scrollTo('zrodla')}>Źródła i ograniczenia</Anchor></Text>}
  </Stack>;
}

// ---------- 1. zapas wody ----------

function Fact({ label, value, hint }) {
  return <div className="fact"><Text size="sm" c="dimmed">{label}</Text><Text fw={700} size="xl" lh={1.2}>{value}</Text>
    {hint && <Text size="xs" c="dimmed">{hint}</Text>}</div>;
}

function Assessment({ report, satellite, satFailed, satRetry }) {
  const water = report.water_status;
  const climat = water.climatic_water_balance;
  const rain = report.causes.windows?.find((w) => w.days === 30);
  const history = report.history;
  return <Section id="ocena" title="Zapas wody w glebie"
    lead="Linia pokazuje, ile wody dostępnej dla roślin zostało w strefie korzeni każdego dnia. Szare pasmo to zakres z tych samych dni w ostatnich 10 latach.">
    {water.series?.length > 1 ? <WaterChart series={water.series} forecast={water.forecast} color={cssColor(water)}/>
      : <Note section={water}/>}
    {water.forecast_reason && !water.forecast?.length && <Text size="xs" c="dimmed" mt={4}>{water.forecast_reason}</Text>}
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="lg" mt="xl" className="facts">
      <Fact label="Opad, 30 dni" value={rain ? `${number(rain.rain_mm)} mm` : '—'}
        hint={rain?.rain_median_mm != null ? `zwykle ${number(rain.rain_median_mm)} mm` : null}/>
      <Fact label={`Opad minus parowanie, ${climat?.days ?? 60} dni`} value={climat ? `${number(climat.balance_mm)} mm` : '—'}/>
      <Fact label="Sezony z niedoborem" value={history.seasons_total ? `${history.seasons_with_stress} z ${history.seasons_total}` : '—'}
        hint="ostatnie pełne sezony"/>
      <Fact label="Faza uprawy" value={report.crop.stage_name?.split(' (')[0] ?? '—'}
        hint={report.crop.in_season === false ? 'poza okresem wzrostu' : null}/>
    </SimpleGrid>
    <Satellite satellite={satellite} failed={satFailed} retry={satRetry}/>
    {water.status === 'ok' && <Accordion variant="default" mt="md" className="quiet-accordion">
      <Accordion.Item value="balance"><Accordion.Control>Jak to policzono</Accordion.Control>
        <Accordion.Panel>
          <Paragraphs lines={water.text} size="sm"/>
          {climat && <Text size="sm" mt={6}>{climat.text}</Text>}
          {water.variants?.length > 1 && <Table mt="md" striped>
            <Table.Thead><Table.Tr><Table.Th>Wariant gleby</Table.Th><Table.Th>Zapas</Table.Th><Table.Th>Ocena</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{water.variants.map((v) => <Table.Tr key={v.key}><Table.Td>{v.label}</Table.Td>
              <Table.Td>{number(100 * v.available_mm / v.taw_mm)}%</Table.Td><Table.Td>{v.class_label}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>}
          {water.last_season?.text && <Text size="sm" mt="md">{water.last_season.text}</Text>}
        </Accordion.Panel></Accordion.Item>
    </Accordion>}
  </Section>;
}

function Satellite({ satellite, failed, retry }) {
  const measurements = satelliteMeasurements(satellite);
  const [index, setIndex] = useState(null);
  const observation = index == null ? measurements.at(-1) : measurements[index];
  return <Grid mt="xl" gutter="lg" align="center" className="satellite-row">
    <Grid.Col span={{ base: 12, md: 5 }}>
      <Text fw={700}>Rośliny na zdjęciach satelitarnych</Text>
      {satellite.status === 'ok' ? <Text size="sm" c="dimmed">{satellite.text?.[0]}</Text>
        : <Text size="sm" c="dimmed">{satellite.status === 'pending' ? 'Wczytuję zdjęcia Sentinel-2…' : satellite.reason ?? 'Brak obserwacji.'}</Text>}
      {failed && <Button mt="xs" size="xs" variant="default" leftSection={<IconRefresh size={14}/>} onClick={retry}>Ponów</Button>}
    </Grid.Col>
    <Grid.Col span={{ base: 12, md: 7 }}>
      {measurements.length > 1 ? <Box c="forest.7">
        <Sparkline values={measurements.map((o) => o.ndvi)} min={0} max={1} height={48}
          label="Zieloność roślin (NDVI) w kolejnych zdjęciach satelitarnych"/>
        <Slider className="no-print" mt={4} size="xs" min={0} max={measurements.length - 1} step={1} label={null}
          value={index ?? measurements.length - 1} onChange={setIndex}/>
        {observation && <Text size="xs" c="dimmed" mt={4}>{dateText(observation.date)} · zieloność (NDVI) {number(observation.ndvi, 2)}
          {Number.isFinite(observation.ndmi) && ` · wilgotność roślin (NDMI) ${number(observation.ndmi, 2)}`}</Text>}
      </Box> : observation ? <Text size="sm">{dateText(observation.date)} · zieloność {number(observation.ndvi, 2)}</Text> : null}
    </Grid.Col>
  </Grid>;
}

// ---------- 2. historia ----------

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

function History({ report }) {
  const history = report.history;
  const critical = seasonMonths(report.crop);
  const seasons = history.seasons ?? [];
  const max = Math.max(1, ...seasons.map((s) => s.stress_days_critical));
  return <Section id="historia" title="Czy to się powtarza?"
    lead={`Dni niedoboru wody w okresie, w którym ${report.crop.name.toLowerCase()} najbardziej jej potrzebuje, w każdym z ostatnich sezonów.`}>
    <Note section={history}/>
    <div className="season-bars">{seasons.map((s) => <div key={s.season} className={s.stressed ? 'stressed' : ''}>
      <Text size="xs" fw={700}>{s.stress_days_critical}</Text>
      <span style={{ height: `${Math.max(3, 100 * s.stress_days_critical / max)}%` }}/>
      <Text size="xs" c="dimmed">{s.season}{!s.complete ? '*' : ''}</Text>
    </div>)}</div>
    {seasons.some((s) => !s.complete) && <Text size="xs" c="dimmed">* sezon w trakcie</Text>}
    {critical.length > 0 && <Group gap={4} mt="lg" className="month-strip">
      <Text size="sm" c="dimmed" mr="xs">Okres krytyczny:</Text>
      {MONTHS.map((m, i) => <span key={m} className={critical.includes(i) ? 'month critical' : 'month'}>{m}</span>)}
    </Group>}
    {history.text?.length > 0 && <Accordion variant="default" mt="sm" className="quiet-accordion">
      <Accordion.Item value="h"><Accordion.Control>Jak czytać historię</Accordion.Control>
        <Accordion.Panel><Paragraphs lines={history.text} size="sm"/></Accordion.Panel></Accordion.Item></Accordion>}
  </Section>;
}

// ---------- 3. przyczyny ----------

function causeIcon(key) {
  if (key.includes('soil')) return IconStack2;
  if (key.includes('rain') || key.includes('precip') || key.includes('carry')) return IconCloudRain;
  if (key.includes('et0') || key.includes('heat') || key.includes('temp') || key.includes('demand')) return IconTemperature;
  if (key.includes('slope') || key.includes('flow') || key.includes('terrain') || key.includes('runoff')) return IconMountain;
  if (key.includes('river')) return IconWaveSine;
  return IconDroplet;
}

function SoilMoisture({ soil, moisture, water, crop }) {
  const rootCm = (soil.root_depth_m ?? crop.root_depth_m ?? 0) * 100;
  const regional = moisture?.status === 'ok' ? moisture.layers : [];
  const layers = mergeSoilLayers(soil.layers);   // te same klasy gleby obok siebie jako jedna warstwa, jak w modelu 3D
  return <Stack gap="md">
    <Note section={soil}/>
    <Paragraphs lines={soil.text} size="sm"/>
    {layers.length > 0 && <Table striped>
      <Table.Thead><Table.Tr><Table.Th>Warstwa</Table.Th><Table.Th>Gleba</Table.Th><Table.Th>Woda dostępna</Table.Th><Table.Th>Pojemność polowa</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{layers.map((l) => <Table.Tr key={l.top_cm} c={l.top_cm < rootCm ? undefined : 'dimmed'}>
        <Table.Td>{l.top_cm}–{l.bottom_cm} cm</Table.Td><Table.Td>{l.texture_label}</Table.Td>
        <Table.Td>{number(l.available_water_mm)} mm</Table.Td><Table.Td>{number(l.field_capacity_vol_pct)}%</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table>}
    {regional.length > 0 && <div>
      <Text fw={700} size="sm" mb={6}>Wilgotność warstw w okolicy na tle 10 lat (NASA POWER, ok. 50 km)</Text>
      <Stack gap="sm">{regional.map((layer) => {
        const dry = layer.class_key === 'low' || layer.class_key === 'very_low';
        return <div key={layer.key}>
          <Group justify="space-between" gap={4}>
            <Text size="sm">{layer.label} <Text span size="xs" c="dimmed">{layer.bottom_cm == null ? 'cały profil' : `${layer.top_cm}–${layer.bottom_cm} cm`}</Text></Text>
            <Text size="xs" c={dry ? 'orange.8' : 'dimmed'} fw={dry ? 700 : 400}>{layer.class_label} · wilgotniej w {layer.years_higher} z {layer.years_compared} lat</Text>
          </Group>
          <div className="moisture-bar"><i style={{ width: `${layer.current * 100}%`, background: dry ? 'var(--mantine-color-orange-6)' : 'var(--mantine-color-blue-6)' }}/>
            <b style={{ left: `${layer.median * 100}%` }}/></div>
        </div>;
      })}</Stack>
      <Text size="xs" c="dimmed" mt={4}>Pasek: teraz. Kreska: mediana z poprzednich lat. {moisture.text?.at(-1)}</Text>
    </div>}
    {water.result && <Text size="xs" c="dimmed">Bilans działki liczy warstwy do {number(rootCm)} cm razem jako jedną strefę korzeni.</Text>}
  </Stack>;
}

function Causes({ report, terrain, failed, retry }) {
  const causes = report.causes;
  const all = [...(causes.items ?? []), ...(terrain?.causes ?? [])];
  return <Section id="przyczyny" title="Dlaczego?">
    <Note section={causes}/>
    {all.length > 0 && <Stack gap="lg">{all.map((cause) => {
      const Icon = causeIcon(cause.key);
      return <Group key={cause.key} gap="md" wrap="nowrap" align="flex-start" className="cause">
        <Icon size={24} stroke={1.6}/>
        <div><Text fw={700}>{cause.title}</Text><Text size="sm" mt={2} maw={760}>{cause.text}</Text></div>
      </Group>;
    })}</Stack>}
    {causes.reason && causes.status === 'ok' && <Text c="dimmed" mt="sm">{causes.reason}</Text>}
    <Accordion variant="default" mt="lg" multiple className="quiet-accordion">
      {causes.windows?.length > 0 && <Accordion.Item value="weather"><Accordion.Control>Opad i parowanie na tle 10 lat</Accordion.Control>
        <Accordion.Panel><Table.ScrollContainer minWidth={480}><Table striped>
          <Table.Thead><Table.Tr><Table.Th>Okres</Table.Th><Table.Th>Opad</Table.Th><Table.Th>Zwykle</Table.Th>
            <Table.Th>Parowanie</Table.Th><Table.Th>Zwykle</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{causes.windows.map((row) => <Table.Tr key={row.days}><Table.Td>{row.days} dni</Table.Td>
            {['rain_mm', 'rain_median_mm', 'et0_mm', 'et0_median_mm'].map((key) =>
              <Table.Td key={key}>{row[key] == null ? '—' : `${number(row[key], 1)} mm`}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
        </Table></Table.ScrollContainer></Accordion.Panel></Accordion.Item>}
      <Accordion.Item value="soil"><Accordion.Control>Gleba i wilgotność w warstwach</Accordion.Control>
        <Accordion.Panel><SoilMoisture soil={report.soil} moisture={report.soil_moisture} water={report.water_status} crop={report.crop}/></Accordion.Panel></Accordion.Item>
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

function Recommendations({ report, terrainActions, satelliteChecks }) {
  const data = report.recommendations;
  const groups = [['retention', 'Zatrzymaj wodę na polu'], ['agrotechnical', 'Zabiegi agrotechniczne'], ['irrigation', 'Nawadnianie']];
  const checks = [...new Map([
    ...(data.field_checks ?? []), ...satelliteChecks, ...terrainActions.filter((item) => item.category === 'field_check'),
  ].map((item) => [item.key, item])).values()];
  return <Section id="dzialania" title="Co robić?" lead="Najpierw zatrzymanie wody, potem zabiegi na polu, nawadnianie na końcu.">
    <Note section={data}/>
    <Stack gap={36}>{groups.map(([category, title], i) => {
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
    {checks.length > 0 && <Box mt={36}>
      <Title order={3} mb="sm">Co sprawdzić na polu</Title>
      <List spacing="sm">{checks.map((item) => <List.Item key={item.key}><Text fw={600} size="sm">{item.title}</Text>
        <Text size="sm">{item.what}</Text><Text size="xs" c="dimmed">{item.why}</Text></List.Item>)}</List>
    </Box>}
  </Section>;
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
      <Paragraphs lines={need.text} size="xs" c="dimmed"/>
    </Grid.Col>
    <Grid.Col span={{ base: 12, md: 7 }}>
      {need.monthly.some((m) => m.mm > 0) && <>
        <Text size="sm" c="dimmed" mb={6}>Typowa potrzeba nawadniania w miesiącach sezonu (mediana {need.seasons_compared} lat)</Text>
        <div className="month-need">{need.monthly.map((m) => <div key={m.month}>
          <Text size="xs" fw={700}>{m.mm >= 1 ? number(m.mm) : ''}</Text>
          <span style={{ height: `${Math.max(2, 100 * m.mm / max)}%` }}/>
          <Text size="xs" c="dimmed">{MONTHS[m.month - 1]}</Text>
        </div>)}</div>
      </>}
    </Grid.Col>
  </Grid>;
}

// ---------- 5. źródła ----------

const sourceState = { ok: ['Użyto', 'green'], no_data: ['Brak danych', 'gray'], error: ['Niedostępne', 'red'], pending: ['W trakcie', 'blue'] };

function Sources({ report, satelliteSource, terrain }) {
  let sources = report.sources ?? [];
  for (const source of [satelliteSource, terrain?.source]) {
    if (source) sources = [...sources.filter((entry) => entry.key !== source.key), source];
  }
  return <Section id="zrodla" title="Skąd to wiemy i czego nie wiemy">
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
    <Title order={3} mt="xl" mb="xs">Ograniczenia</Title>
    <List size="sm" spacing={4}>{report.limitations?.map((s) => <List.Item key={s}>{s}</List.Item>)}</List>
    {report.crop.assumptions?.length > 0 && <><Title order={4} mt="md" mb="xs">Założenia o uprawie</Title>
      <Paragraphs lines={report.crop.assumptions} size="sm"/></>}
  </Section>;
}

export function Report({ field, onSave, onEdit, onSatellite, saved }) {
  const { report } = field;
  const top = useRef(null);
  const sat = useDeferred(report.satellite.endpoint);
  const topo = useDeferred(report.terrain.endpoint);
  const satellite = sat.result?.satellite ?? (sat.failure ? { status: 'error', reason: sat.failure } : report.satellite);
  const terrain = topo.result ?? (topo.failure ? { status: 'error', reason: topo.failure } : report.terrain);
  const terrainActions = terrain.recommendations ?? [];
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('3d');
  const limited = report.water_status.spans_classes || report.water_status.soil_assumed;

  useEffect(() => { top.current?.querySelector('h1')?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (sat.result && sat.result.satellite?.status !== 'pending') onSatellite(field.id, report.generated_at, sat.result);
  }, [field.id, report.generated_at, sat.result, onSatellite]);

  function save() {
    setNotice(onSave(field) ? 'Raport zapisany w tej przeglądarce.' : '');
  }

  return <Stack component="article" gap={72} className="report">
    <Stack gap="lg" ref={top}>
      <Group justify="space-between" className="no-print">
        <Button component="a" href={window.location.search ? '/' : '#'} variant="subtle" color="gray" leftSection={<IconArrowLeft size={18}/>}>Wszystkie pola</Button>
        <Group gap="xs">
          {notice && <Text role="status" size="sm" c="forest.8">{notice}</Text>}
          <Button variant="subtle" color="gray" leftSection={<IconRefresh size={16}/>} onClick={onEdit}>Przelicz</Button>
          <Button variant="subtle" color="gray" leftSection={<IconPrinter size={16}/>} onClick={() => window.print()}>PDF</Button>
          <Button leftSection={<IconDeviceFloppy size={16}/>} onClick={save}>{saved ? 'Zapisz' : 'Zapisz pole'}</Button>
        </Group>
      </Group>
      <Grid gutter={48} align="center">
        <Grid.Col span={{ base: 12, md: 5 }}><Verdict report={report} field={field} limited={limited}/></Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }} className="report-map">
          <Group justify="flex-end" mb={4} className="no-print">
            <SegmentedControl size="xs" value={view} onChange={setView}
              data={[{ value: '3d', label: 'Pole i gleba' }, { value: 'map', label: 'Zdjęcie lotnicze' }]}/>
          </Group>
          {view === '3d' ? <Field3D report={report} cropArea={report.test_crop_area}/>
            : <ParcelMap parcel={report.parcel} point={report.parcel ? null : report.request.point} terrain={terrain}/>}
        </Grid.Col>
      </Grid>
    </Stack>
    <Assessment report={report} satellite={satellite} satFailed={sat.failure} satRetry={sat.retry}/>
    <History report={report}/>
    <Causes report={report} terrain={terrain} failed={topo.failure} retry={topo.retry}/>
    <Recommendations report={report} terrainActions={terrainActions} satelliteChecks={sat.result?.field_checks ?? []}/>
    <Divider/>
    <Sources report={report} satelliteSource={sat.result?.source} terrain={terrain}/>
  </Stack>;
}
