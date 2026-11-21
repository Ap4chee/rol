import { Alert, Badge, Text } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconEye, IconHelpCircle } from '@tabler/icons-react';

const states = {
  none: ['Brak suszy', 'green', IconCircleCheck], watch: ['Obserwuj', 'yellow', IconEye],
  moderate: ['Umiarkowana susza', 'orange', IconAlertTriangle], severe: ['Silna susza', 'red', IconAlertCircle],
};
const offSeason = { none: 'Wysoki zapas', watch: 'Niższy zapas', moderate: 'Niski zapas', severe: 'Bardzo niski zapas' };

const SHORT = { severe: 'silny niedobór', moderate: 'umiarkowany niedobór', watch: 'do obserwacji', none: 'bez niedoboru' };
const SHORT_OFF = { severe: 'zapas bardzo niski', moderate: 'zapas niski', watch: 'zapas niższy', none: 'zapas wysoki' };

/** Krótki opis stanu do list i plakietek (pełny opis jest w `headline`). */
export function statusShort(water) {
  if (water?.status !== 'ok' || !water.class_key) return 'brak oceny';
  return (water.in_season === false ? SHORT_OFF : SHORT)[water.class_key];
}

export function statusColor(water) {
  return water?.status === 'ok' ? states[water.class_key]?.[1] ?? 'gray' : 'gray';
}

export function Status({ water, size = 'lg' }) {
  const state = water?.status === 'ok' ? states[water.class_key] : null;
  const label = state ? (water.in_season === false ? offSeason[water.class_key] : state[0]) : 'Brak oceny';
  const Icon = state?.[2] ?? IconHelpCircle;
  return <Badge size={size} variant="light" color={state?.[1] ?? 'gray'} title={water?.class_label ?? undefined}
    leftSection={<Icon size={14}/>}>{label}</Badge>;
}

export function Note({ section, fallback = 'Brak danych dla tej analizy.' }) {
  if (section?.status === 'ok') return null;
  const error = section?.status === 'error';
  return <Alert variant="light" color={error ? 'red' : 'gray'} icon={<IconAlertCircle size={18}/>} my="xs">
    {section?.reason || fallback}</Alert>;
}

export function Sparkline({ values, min, max, label, height = 44 }) {
  if (values.length < 2) return <Text size="sm" c="dimmed">{values.length ? 'Jedna obserwacja' : 'Brak danych'}</Text>;
  const points = values.map((value, i) => `${3 + 154 * i / (values.length - 1)},${39 - 34 * (value - min) / (max - min)}`).join(' ');
  return <svg className="sparkline" style={{ height }} viewBox="0 0 160 44" preserveAspectRatio="none" role="img" aria-label={label}>
    <path d="M3 39H157" fill="none" stroke="currentColor" strokeOpacity=".22" vectorEffect="non-scaling-stroke"/>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
  </svg>;
}

export function Paragraphs({ lines, ...props }) {
  return lines?.map((line, i) => <Text key={i} {...props} mt={i ? 6 : 0}>{line}</Text>);
}

export async function api(url, options = {}) {
  const { signal, ...rest } = options;
  const timeout = AbortSignal.timeout(url.startsWith('/api/terrain') ? 200_000 : url.startsWith('/api/satellite') ? 125_000 : 75_000);
  const response = await fetch(url, { ...rest, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const detail = data?.detail;
    throw new Error(Array.isArray(detail) ? detail.map((row) => row.msg).join(' ')
      : typeof detail === 'string' ? detail : `Błąd odpowiedzi serwera (${response.status}).`);
  }
  return data;
}

export function generateReport(request, signal) {
  return api('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal });
}
