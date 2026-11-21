import { useEffect, useState } from 'react';
import { Anchor, Badge, Button, Card, Grid, Group, Image, Loader, Paper, Progress, Select, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import {
  IconCloud, IconCloudFog, IconCloudRain, IconCloudStorm, IconPlus, IconSeeding, IconSnowflake, IconSun, IconSunHigh,
} from '@tabler/icons-react';
import { AddFieldForm } from './AddField.jsx';
import { actionItems, dateText, fieldHref, number, waterPercent } from './model.js';
import { api, Note, Status, statusColor } from './ui.jsx';

const cropImages = { maize: 'kukurydza', winter_wheat: 'pszenica', grassland: 'laka', potato: 'ziemniaki', sugar_beet: 'burak' };

const steps = [
  ['1', 'Ocena', 'zapas wody w glebie z bilansu FAO-56 i porównanie z 10 latami'],
  ['2', 'Przyczyny', 'opad, parowanie, gleba, teren i stan rzek w okolicy'],
  ['3', 'Działania', 'najpierw retencja i agrotechnika, na końcu nawadnianie'],
];
const sources = ['Działka: ULDK GUGiK', 'Pogoda: Open-Meteo, NASA POWER', 'Satelita: Sentinel-2',
  'Gleba: SoilGrids', 'Teren: NMT GUGiK', 'Wody: IMGW-PIB'];

function Start({ onReport }) {
  return <Stack gap="xl">
    <Stack gap={6} maw={760}>
      <Title order={1}>Sprawdź, czy Twojemu polu brakuje wody</Title>
      <Text size="lg" c="dimmed">Wpisz numer działki albo kliknij ją na mapie, wybierz uprawę i datę. Raport policzymy
        na żywo z otwartych danych w kilkanaście sekund.</Text>
    </Stack>
    <Paper p={{ base: 'md', md: 'xl' }} shadow="xs"><AddFieldForm split onReport={onReport}/></Paper>
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
      {steps.map(([n, title, text]) => <Group key={n} gap="sm" align="flex-start" wrap="nowrap">
        <ThemeIcon size={34} radius="xl" variant="light">{n}</ThemeIcon>
        <div><Text fw={700}>{title}</Text><Text size="sm" c="dimmed">{text}</Text></div>
      </Group>)}
    </SimpleGrid>
    <Group gap={6}>{sources.map((s) => <Badge key={s} variant="outline" color="gray" radius="sm" tt="none" fw={500}>{s}</Badge>)}</Group>
  </Stack>;
}

function FieldCard({ field }) {
  const { report } = field;
  const water = report.water_status;
  const value = waterPercent(water.result);
  const image = cropImages[report.crop.key];
  return <Card component="a" href={fieldHref(field.id)} padding="lg" className="field-card">
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        {image ? <Image src={`/design/${image}.png`} w={52} h={52} alt=""/>
          : <ThemeIcon size={52} variant="light"><IconSeeding size={28}/></ThemeIcon>}
        <div>
          <Text fw={700} size="lg" lh={1.2}>{field.name}</Text>
          <Text size="sm" c="dimmed">{report.crop.name}{report.parcel?.area_ha != null && ` · ${number(report.parcel.area_ha, 2)} ha`}</Text>
        </div>
      </Group>
      <Status water={water} size="md"/>
    </Group>
    <Group justify="space-between" mt="lg" mb={6}>
      <Text size="sm" c="dimmed">Zapas wody w strefie korzeni</Text>
      <Text fw={700}>{value == null ? '—' : `${number(value)}%`}</Text>
    </Group>
    <Progress value={value ?? 0} color={statusColor(water)} size="lg" radius="xl"/>
    <Text size="xs" c="dimmed" mt="md">Stan na {dateText(report.analysis_date)} · {report.parcel?.id ?? 'wskazany punkt'}</Text>
  </Card>;
}

function NextActions({ fields }) {
  const items = actionItems(fields);
  return <Paper p="lg">
    <Title order={3} mb="sm">Najbliższe działania</Title>
    {items.length ? <Stack gap="sm">{items.map(({ field, action }) =>
      <Anchor key={field.id} href={fieldHref(field.id) + '#dzialania'} underline="never" c="inherit" className="action-link">
        <Text size="xs" c="dimmed">{field.name} · analiza z {dateText(field.report.analysis_date)}</Text>
        <Text fw={600}>{action.title}</Text>
      </Anchor>)}</Stack> : <Text size="sm" c="dimmed">Zapisane raporty nie zawierają propozycji działań.</Text>}
  </Paper>;
}

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

function Weather({ fields, field, onPick }) {
  const position = field.report.parcel?.centroid ?? field.report.request.point;
  const key = position ? new URLSearchParams(position).toString() : null;
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
  return <Paper p="lg">
    <Title order={3}>Prognoza na 7 dni</Title>
    <Text size="xs" c="dimmed" mb="sm">od dziś, niezależnie od daty raportu</Text>
    {fields.length > 1 && <Select size="xs" mb="sm" label="Dla pola" value={field.id} onChange={onPick} allowDeselect={false}
      data={fields.map((row) => ({ value: row.id, label: row.name }))}/>}
    {!key ? <Text size="sm">Brak współrzędnych pola.</Text> : !forecast ? <Group gap="xs"><Loader size="xs"/><Text size="sm">Pobieram prognozę…</Text></Group>
      : <Note section={forecast}/>}
    {forecast?.status === 'ok' && <>
      <SimpleGrid cols={7} spacing={4}>{forecast.days.map((day) => {
        const [Icon, label] = weatherIcon(day.weather_code);
        return <Stack key={day.date} gap={2} align="center" className={day.precipitation_mm >= 5 ? 'wet-day' : ''}>
          <Text size="xs" c="dimmed">{weekdays.format(new Date(day.date + 'T12:00:00Z')).replace('.', '')}</Text>
          <Icon size={20} aria-label={label}/>
          <Text size="sm" fw={600}>{day.temperature_max_c == null ? '—' : `${number(day.temperature_max_c)}°`}</Text>
          <Text size="10px" c="blue.7">{day.precipitation_mm > 0 ? `${number(day.precipitation_mm, 1)}` : ''}</Text>
        </Stack>;
      })}</SimpleGrid>
      <Text size="xs" c="dimmed" mt="sm">{forecast.last_wet_day ? `Ostatni opad >5 mm: ${dateText(forecast.last_wet_day)}`
        : forecast.past_days_complete ? 'Brak opadu >5 mm w ostatnich 30 dniach.' : 'Niepełne dane o ostatnich opadach.'}
        {' · '}<Anchor size="xs" href="https://open-meteo.com/en/docs">Open-Meteo</Anchor></Text>
    </>}
  </Paper>;
}

export function Dashboard({ fields, onAdd, onReport }) {
  const [selected, setSelected] = useState(null);
  const field = fields.find(({ id }) => id === selected) ?? fields[0];
  if (!field) return <Start onReport={onReport}/>;
  return <Stack gap="lg">
    <Group justify="space-between">
      <Title order={1}>Moje pola</Title>
      <Button leftSection={<IconPlus size={18}/>} onClick={onAdd}>Dodaj pole</Button>
    </Group>
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">{fields.map((f) => <FieldCard key={f.id} field={f}/>)}</SimpleGrid>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Stack gap="md"><NextActions fields={fields}/><Weather fields={fields} field={field} onPick={setSelected}/></Stack>
      </Grid.Col>
    </Grid>
  </Stack>;
}
