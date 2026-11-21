import { number } from './model.js';

const paths = {
  brand: 'M12 2c-2.5 3.5-4.5 5.5-4.5 8a4.5 4.5 0 0 0 9 0c0-2.5-2-4.5-4.5-8ZM3 18q4.5-3 9 0t9 0M3 22q4.5-3 9 0t9 0',
  plus: 'M5 12h14M12 5v14',
  back: 'M20 12H4m6-6-6 6 6 6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  drop: 'M12 2c-4 5-7 8.5-7 13a7 7 0 1 0 14 0c0-4.5-3-8-7-13z',
  alert: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 7v6m0 4h.01',
  triangle: 'M12 3 22 20H2Zm0 6v4m0 3h.01',
  eye: 'M2 12q10-11 20 0-10 11-20 0Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  check: 'm4 12 5 5 11-11',
  wind: 'M3 8h13q6 0 3-4-2-2-4 1M3 13h18M3 18h10q5 0 3 3',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v5m8-5v5',
  pin: 'M12 22Q4 13 4 9a8 8 0 1 1 16 0q0 4-8 13Zm0-16a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  layers: 'm2 8 10-5 10 5-10 5Zm0 4 10 5 10-5M2 16l10 5 10-5',
  sun: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM12 2v2.5M12 19.5V22M2 12h2.5m15 0H22M4.9 4.9l1.8 1.8m10.6 10.6 1.8 1.8m0-14.2-1.8 1.8M6.7 17.3l-1.8 1.8',
  cloudy: 'M6 18h12.5a3.7 3.7 0 1 0-.4-7.4 5.1 5.1 0 0 0-9.7 1.2A3.3 3.3 0 1 0 6 18Z',
  partial: 'M12 5a4.4 4.4 0 0 0-6.5 5.6M8 1.8v1.4M2 5.1l1.5.9M1.2 10h1.7m5.7 9.4h10a3.5 3.5 0 1 0-.3-7 4.9 4.9 0 0 0-9.3 1.2 2.9 2.9 0 1 0-.4 5.8Z',
  rain: 'M5.9 14.2h12.2a3.4 3.4 0 1 0-.3-6.8 4.9 4.9 0 0 0-9.3 1.3 3 3 0 1 0-2.6 5.5Zm2.5 2.8L7 20.2m5.8-3.2-1.4 3.2m5.8-3.2-1.4 3.2',
  snow: 'M12 2v20m-9-15 18 10M3 17 21 7M9 4l3 3 3-3m-6 16 3-3 3 3',
  storm: 'M5 14a3 3 0 0 1 1-6 5 5 0 0 1 9-1 3.5 3.5 0 0 1 4 6h-2m-5 0-3 5h4l-3 4',
  fog: 'M4 8h16M3 12h18M5 16h14',
  print: 'M7 8V3h10v5M7 17H3V9h18v8h-4m-10-3h10v8H7z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  save: 'M5 3h14v18l-7-5-7 5z',
  close: 'm6 6 12 12M18 6 6 18',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm5 11.5L21 21',
  chevron: 'm6 9 6 6 6-6',
};

export function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.alert}/></svg>;
}

const states = { none: ['Brak suszy', 'check'], watch: ['Obserwuj', 'eye'],
  moderate: ['Umiarkowana', 'triangle'], severe: ['Silna', 'alert'] };
const offSeason = { none: 'Wysoki zapas', watch: 'Niższy zapas', moderate: 'Niski zapas', severe: 'Bardzo niski zapas' };

export function Status({ water }) {
  const state = water?.status === 'ok' ? states[water.class_key] : null;
  const label = state ? (water.in_season === false ? offSeason[water.class_key] : state[0]) : 'Brak oceny';
  return <span title={water?.class_label ?? undefined} className={`status ${state ? water.class_key : 'unknown'}`}>
    <Icon name={state?.[1] ?? 'alert'} size={16}/>{label}</span>;
}

export function Note({ section, fallback = 'Brak danych dla tej analizy.' }) {
  if (section?.status === 'ok') return null;
  return <p className={`note ${section?.status === 'error' ? 'error' : ''}`}><Icon name="alert" size={17}/><span>{section?.reason || fallback}</span></p>;
}

export function Button({ icon, children, className = '', type = 'button', ...props }) {
  return <button type={type} className={`button ${className}`} {...props}>
    {icon && <Icon name={icon}/>} {children}
  </button>;
}

export function Meter({ value }) {
  return <div className="meter">
    <strong>{value == null ? '—' : `${number(value)}%`}</strong>
    {value != null && <meter aria-label="Zapas wody w glebie" min="0" max="100" value={value}/>}
  </div>;
}

export function Sparkline({ values, min, max, label, className = '' }) {
  if (values.length < 2) return <span className="subtle">{values.length ? 'Jedna obserwacja' : 'Brak danych'}</span>;
  const points = values.map((value, i) => `${3 + 154 * i / (values.length - 1)},${39 - 34 * (value - min) / (max - min)}`).join(' ');
  return <svg className={`sparkline ${className}`} viewBox="0 0 160 44" preserveAspectRatio="none" role="img" aria-label={label}>
    <path d="M3 39H157" fill="none" stroke="currentColor" strokeOpacity=".22" vectorEffect="non-scaling-stroke"/>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.7" vectorEffect="non-scaling-stroke"/>
  </svg>;
}

export function Paragraphs({ lines }) {
  return lines?.map((line, i) => <p key={i}>{line}</p>);
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
