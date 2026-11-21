import { useEffect, useState } from 'react';
import { Anchor, Badge, Button, Card, Grid, Group, Image, Loader, Paper, Progress, Select, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import {
  IconArrowRight, IconCloud, IconCloudFog, IconCloudRain, IconCloudStorm, IconPlus, IconSeeding, IconSnowflake, IconSun, IconSunHigh,
} from '@tabler/icons-react';
import { actionItems, byUrgency, dateText, fieldHref, fieldTabHref, number, waterPercent } from './model.js';
import { api, Note, statusColor } from './ui.jsx';

const cropImages = { maize: 'kukurydza', winter_wheat: 'pszenica', grassland: 'laka', potato: 'ziemniaki', sugar_beet: 'burak' };

/** Pusty pulpit: jedno zdanie i przycisk; samo dodawanie pola jest w modalu. */
function EmptyState({ onAdd }) {
  return <Stack align="center" ta="center" gap="lg" py={80} maw={460} mx="auto">
    <svg width="168" height="128" viewBox="0 0 168 128" aria-hidden="true" className="empty-art">
      <ellipse cx="84" cy="112" rx="70" ry="10" fill="var(--mantine-color-gray-1)"/>
      <path d="M18 98 L62 52 H150 L112 98 Z" fill="var(--mantine-color-forest-1)"/>
      {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M${30 + i * 15} 98 L${70 + i * 13} 52`} stroke="var(--mantine-color-forest-5)" strokeWidth="3" strokeLinecap="round"/>)}
      <path d="M112 98 L150 52 V64 L112 110 Z" fill="var(--mantine-color-forest-3)"/>
      <path d="M18 98 H112 V110 H18 Z" fill="#8a6a48"/>
      <path d="M112 98 L150 52 V64 L112 110 Z" fill="#6d5238"/>
      <path d="M100 8 C92 20 86 27 86 35 a14 14 0 0 0 28 0 C114 27 108 20 100 8 Z" fill="var(--mantine-color-blue-5)"/>
    </svg>
    <Title order={1} fz={28}>Dodaj pierwsze pole</Title>
    <Text c="dimmed">Wpisz numer działki albo wskaż ją na mapie. Sprawdzimy, czy brakuje jej wody i co z tym zrobić.</Text>
    <Button size="md" leftSection={<IconPlus size={18}/>} onClick={onAdd}>Dodaj pole</Button>
  </Stack>;
}

// ---------- pierwszy rzut oka ----------

const STATES = [
  ['severe', 'silny niedobór', 'red'], ['moderate', 'umiarkowany niedobór', 'orange'],
  ['watch', 'do obserwacji', 'yellow'], ['none', 'bez niedoboru', 'green'],
];

function Overview({ fields }) {
  const count = (key) => fields.filter((f) => f.report.water_status.status === 'ok' && f.report.water_status.class_key === key).length;
  const urgent = count('severe') + count('moderate');
  return <div className="overview">
    <Text className="overview-lead">
      {urgent ? `${urgent} z ${fields.length} ${fields.length === 1 ? 'pola' : 'pól'} potrzebuje teraz uwagi.`
        : `Żadne z ${fields.length} ${fields.length === 1 ? 'pola' : 'pól'} nie ma teraz niedoboru wody.`}
    </Text>
    <Group gap="xl" mt="sm">{STATES.map(([key, label, color]) => <div key={key} className="overview-count">
      <Text fw={800} fz={32} lh={1} c={count(key) ? `${color}.7` : 'gray.4'}>{count(key)}</Text>
      <Text size="sm" c="dimmed">{label}</Text>
    </div>)}</Group>
  </div>;
}

function FieldCard({ field, action }) {
  const { report } = field;
  const water = report.water_status;
  const value = waterPercent(water.result);
  const image = cropImages[report.crop.key];
  const color = statusColor(water);
  return <Card component="a" href={fieldHref(field.id)} padding="lg" className="field-card" style={{ borderTop: `4px solid var(--mantine-color-${color}-6)` }}>
    <Group gap="sm" wrap="nowrap" align="flex-start">
      {image ? <Image src={`/design/${image}.png`} w={44} h={44} alt=""/>
        : <ThemeIcon size={44} variant="light"><IconSeeding size={24}/></ThemeIcon>}
      <div style={{ minWidth: 0 }}>
        <Text fw={700} size="lg" lh={1.2} truncate>{field.name}</Text>
        <Text size="sm" c="dimmed">{report.crop.name}{report.parcel?.area_ha != null && ` · ${number(report.parcel.area_ha, 2)} ha`}</Text>
      </div>
    </Group>
    <Text fw={700} mt="md" c={`${color}.8`} lh={1.25}>{water.headline ?? 'Brak oceny'}</Text>
    <Group justify="space-between" mt="sm" mb={4}>
      <Text size="xs" c="dimmed">Zapas wody w strefie korzeni</Text>
      <Text size="sm" fw={700}>{value == null ? '—' : `${number(value)}%`}</Text>
    </Group>
    <Progress value={value ?? 0} color={color} size="md" radius="xl"/>
    {action && <Group gap={6} mt="md" wrap="nowrap" className="card-action">
      <IconArrowRight size={16} style={{ flexShrink: 0 }}/><Text size="sm" fw={600} lineClamp={2}>{action.title}</Text></Group>}
    <Text size="xs" c="dimmed" mt="sm">Stan na {dateText(report.analysis_date)}</Text>
  </Card>;
}

function NextActions({ items }) {
  return <Paper p="lg">
    <Title order={3} mb="sm">Najbliższe działania</Title>
    {items.length ? <Stack gap="sm">{items.map(({ field, action }) =>
      <Anchor key={field.id} href={fieldTabHref(field.id, 'rekomendacje')} underline="never" c="inherit" className="action-link">
        <Text size="xs" c="dimmed">{field.name}</Text>
        <Text fw={600}>{action.title}</Text>
      </Anchor>)}</Stack> : <Text size="sm" c="dimmed">Zapisane raporty nie zawierają propozycji działań.</Text>}
  </Paper>;
}

// ---------- prognoza pogody ----------

function weatherIcon(code) {
  if (code === 0) return [IconSun, 'Bezchmurnie'];
  if (code === 1 || code === 2) return [IconSunHigh, 'Częściowe zachmurzenie'];
  if (code === 3) return [IconCloud, 'Zachmurzenie'];
  if (code === 45 || code === 48) return [IconCloudFog, 'Mgła'];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return [IconSnowflake, 'Śnieg'];
  if (code >= 95) return [IconCloudStorm, 'Burza'];
  if (Number.isFinite(code) && code >= 51) return [IconCloudRain, 'Opad'];
  return [IconCloud, 'Brak danych'];
}

/** Prognoza na 7 dni od dziś dla współrzędnych (Open-Meteo przez /api/forecast). */
export function ForecastDays({ position, size = 'sm' }) {
  const key = position ? new URLSearchParams({ lat: position.lat, lon: position.lon }).toString() : null;
  const [weather, setWeather] = useState(null);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    api('/api/forecast?' + key, { signal: controller.signal }).then((data) => setWeather({ key, data }))
      .catch((error) => { if (!controller.signal.aborted) setWeather({ key, data: { status: 'error', reason: error.message } }); });
    return () => controller.abort();
  }, [key]);
  const forecast = weather?.key === key ? weather?.data : null;
  const weekdays = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', timeZone: 'Europe/Warsaw' });
  const big = size === 'lg';
  if (!key) return <Text size="sm">Brak współrzędnych pola.</Text>;
  if (!forecast) return <Group gap="xs"><Loader size="xs"/><Text size="sm">Pobieram prognozę…</Text></Group>;
  if (forecast.status !== 'ok') return <Note section={forecast}/>;
  return <>
    <SimpleGrid cols={7} spacing={big ? 'sm' : 4}>{forecast.days.map((day) => {
      const [Icon, label] = weatherIcon(day.weather_code);
      return <Stack key={day.date} gap={big ? 4 : 2} align="center" py={big ? 'sm' : 0} className={day.precipitation_mm >= 5 ? 'wet-day' : ''}>
        <Text size="xs" c="dimmed">{weekdays.format(new Date(day.date + 'T12:00:00Z')).replace('.', '')}</Text>
        <Icon size={big ? 28 : 20} aria-label={label}/>
        <Text size={big ? 'md' : 'sm'} fw={600}>{day.temperature_max_c == null ? '—' : `${number(day.temperature_max_c)}°`}</Text>
        <Text size={big ? 'xs' : '10px'} c="blue.7">{day.precipitation_mm > 0 ? `${number(day.precipitation_mm, 1)} mm` : ''}</Text>
        {big && day.et0_mm != null && <Text size="10px" c="dimmed">parowanie {number(day.et0_mm, 1)}</Text>}
      </Stack>;
    })}</SimpleGrid>
    <Text size="xs" c="dimmed" mt="sm">{forecast.last_wet_day ? `Ostatni opad >5 mm: ${dateText(forecast.last_wet_day)}`
      : forecast.past_days_complete ? 'Brak opadu >5 mm w ostatnich 30 dniach.' : 'Niepełne dane o ostatnich opadach.'}
      {' · '}<Anchor size="xs" href="https://open-meteo.com/en/docs">Open-Meteo</Anchor></Text>
  </>;
}

function Weather({ fields }) {
  const [selected, setSelected] = useState(null);
  const field = fields.find(({ id }) => id === selected) ?? fields[0];
  return <Paper p="lg">
    <Title order={3}>Pogoda na 7 dni</Title>
    <Text size="xs" c="dimmed" mb="sm">od dziś</Text>
    {fields.length > 1 && <Select size="xs" mb="sm" label="Dla pola" value={field.id} onChange={setSelected} allowDeselect={false}
      data={fields.map((row) => ({ value: row.id, label: row.name }))}/>}
    <ForecastDays position={field.report.parcel?.centroid ?? field.report.request.point}/>
  </Paper>;
}

export function Dashboard({ fields, onAdd }) {
  if (!fields.length) return <EmptyState onAdd={onAdd}/>;
  const sorted = byUrgency(fields);
  const actions = actionItems(fields);
  const firstAction = new Map(actions.map(({ field, action }) => [field.id, action]));
  return <Stack gap={40}>
    <Group justify="space-between" align="flex-end">
      <div>
        <Text size="sm" c="dimmed">{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full', timeZone: 'Europe/Warsaw' }).format(new Date())}</Text>
        <Title order={1}>Pulpit</Title>
      </div>
      <Button leftSection={<IconPlus size={18}/>} onClick={onAdd}>Dodaj pole</Button>
    </Group>
    <Overview fields={fields}/>
    <Grid gutter="xl">
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Title order={2} fz="xl" mb="md">Pola od najpilniejszego</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">{sorted.map((f) => <FieldCard key={f.id} field={f} action={firstAction.get(f.id)}/>)}</SimpleGrid>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Stack gap="md"><NextActions items={actions}/><Weather fields={sorted}/></Stack>
      </Grid.Col>
    </Grid>
  </Stack>;
}
