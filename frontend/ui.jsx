import { useId } from 'react';
import { Callout } from '@/components/ui/callout';
import { StatusBadge, TONE } from '@/components/ui/status';
import { cn } from '@/lib/utils';

// Stan oceny wody → ton (kolory w app.css) i opisy.
const TONES = { none: 'ok', watch: 'watch', moderate: 'moderate', severe: 'severe' };
const LABEL = { none: 'Brak suszy', watch: 'Obserwuj', moderate: 'Umiarkowana susza', severe: 'Silna susza' };
const OFF_SEASON = { none: 'Wysoki zapas', watch: 'Niższy zapas', moderate: 'Niski zapas', severe: 'Bardzo niski zapas' };
const SHORT = { severe: 'silny niedobór', moderate: 'umiarkowany niedobór', watch: 'do obserwacji', none: 'bez niedoboru' };
const SHORT_OFF = { severe: 'zapas bardzo niski', moderate: 'zapas niski', watch: 'zapas niższy', none: 'zapas wysoki' };

/** Ton stanu: 'ok' | 'watch' | 'moderate' | 'severe' | 'unknown'. */
export function statusTone(water) {
  return water?.status === 'ok' ? TONES[water.class_key] ?? 'unknown' : 'unknown';
}

/** Kolor znaku stanu (CSS), np. linia wykresu, pasek. */
export function statusFill(water) {
  return TONE[statusTone(water)].fill;
}

/** Kolor tekstu w kolorze stanu (ciemniejszy, czytelny na bieli). */
export function statusInk(water) {
  return TONE[statusTone(water)].ink;
}

/** Krótki opis stanu do list i plakietek (pełny opis jest w `headline`). */
export function statusShort(water) {
  if (water?.status !== 'ok' || !water.class_key) return 'brak oceny';
  return (water.in_season === false ? SHORT_OFF : SHORT)[water.class_key];
}

/** Plakietka stanu wody (poza sezonem mówi o zapasie, nie o suszy). */
export function Status({ water, size, className }) {
  const known = water?.status === 'ok' && LABEL[water.class_key];
  const label = known ? (water.in_season === false ? OFF_SEASON[water.class_key] : LABEL[water.class_key]) : 'Brak oceny';
  return <StatusBadge tone={statusTone(water)} size={size} className={className} title={water?.class_label ?? undefined}>{label}</StatusBadge>;
}

/** Brak danych albo błąd sekcji powiedziany wprost (nic nie pokazuje, gdy sekcja ma dane). */
export function Note({ section, fallback = 'Brak danych dla tej analizy.', className }) {
  if (section?.status === 'ok') return null;
  return <Callout tone={section?.status === 'error' ? 'danger' : 'neutral'} className={cn('my-2', className)}>
    {section?.reason || fallback}</Callout>;
}

/** Linia wartości w czasie (bez osi); kolor z `currentColor`. */
export function Sparkline({ values, min, max, label, height = 44, className }) {
  if (values.length < 2) return <p className="text-[13px] text-neutral-500">{values.length ? 'Jedna obserwacja' : 'Brak danych'}</p>;
  const span = max - min || 1;
  const points = values.map((value, i) => `${3 + 154 * i / (values.length - 1)},${39 - 34 * (value - min) / span}`).join(' ');
  return <svg className={cn('block w-full', className)} style={{ height }} viewBox="0 0 160 44" preserveAspectRatio="none" role="img" aria-label={label}>
    <path d="M3 39H157" fill="none" stroke="currentColor" strokeOpacity=".18" vectorEffect="non-scaling-stroke"/>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
  </svg>;
}

/**
 * Sylwetka działki z geometrii raportu, wypełniona bruzdami. EPSG:4326 → płaski układ (długość × cos szerokości),
 * północ u góry, jak na mapie. Bez geometrii (wskazany punkt) nic nie rysuje.
 */
export function ParcelOutline({ geometry, className }) {
  const furrows = useId();
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const rings = polygons.flat().filter((ring) => ring.length > 2);
  if (!rings.length) return null;
  const kx = Math.cos(rings[0][0][1] * Math.PI / 180);
  const points = rings.map((ring) => ring.map(([lon, lat]) => [lon * kx, -lat]));
  const xs = points.flat().map(([x]) => x), ys = points.flat().map(([, y]) => y);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX, h = Math.max(...ys) - minY;
  const k = 84 / (Math.max(w, h) || 1);   // kwadrat 100×100 z marginesem na obrys, kształt wyśrodkowany
  const ox = (100 - w * k) / 2, oy = (100 - h * k) / 2;
  const d = points.map((ring) => 'M' + ring.map(([x, y]) => `${((x - minX) * k + ox).toFixed(1)},${((y - minY) * k + oy).toFixed(1)}`).join('L') + 'Z').join('');
  return <svg viewBox="0 0 100 100" aria-hidden className={className}>
    <defs><pattern id={furrows} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
      <path d="M0 4H8" stroke="var(--color-brand-400)" strokeWidth="2.5"/></pattern></defs>
    <path d={d} fillRule="evenodd" fill="var(--color-brand-200)"/>
    <path d={d} fillRule="evenodd" fill={`url(#${furrows})`} stroke="var(--color-brand-700)" strokeWidth="2"
      strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
  </svg>;
}

/** Akapity z listy zdań. */
export function Paragraphs({ lines, className }) {
  return lines?.map((line, i) => <p key={i} className={cn(i ? 'mt-1.5' : '', className)}>{line}</p>);
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
