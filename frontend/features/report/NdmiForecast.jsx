import { Sparkles } from 'lucide-react';
import { dateText } from '@/shared/format/date';
import { fixed, minus } from '@/shared/format/number';
import { Card } from '@/shared/ui/card';
import { StatusBadge, TONE } from '@/shared/ui/status';

// wskaźniki satelitarne zawsze z dwoma miejscami (dokładność NDVI/NDMI), żeby „0,2” i „0,61” się nie rozjeżdżały
export const index2 = (value) => fixed(value, 2);

// Kierunek prognozy (serwer: ndmi_forecast.trend) → ton i zdanie dla rolnika.
const TREND = {
  down: ['watch', 'Rośliny prawdopodobnie zaczną tracić wodę'],
  flat: ['unknown', 'Nie widać wyraźnego kierunku zmiany'],
  up: ['ok', 'Woda w liściach prawdopodobnie przybędzie'],
};

/**
 * Prognoza modelu ML: zmiana NDMI za 7–14 dni z przedziałem 80% na osi „spadek – bez zmiany – wzrost”.
 * Oś jest symetryczna wokół zera i obejmuje cały przedział (co najmniej ±0,15).
 */
export function NdmiForecast({ forecast }) {
  const header = <div className="flex flex-wrap items-center justify-between gap-2">
    <p className="text-[14.5px] font-semibold text-neutral-900">Prognoza na 1–2 tygodnie</p>
    <StatusBadge tone="info" size="sm" icon={Sparkles}>model ML · {forecast.status ?? 'eksperymentalny'}</StatusBadge>
  </div>;
  if (!forecast.available) return <Card className="mt-3 p-5">
    {header}
    <p className="mt-2 text-[13px] leading-relaxed text-neutral-500">Prognozy nie ma: {forecast.reason ?? 'brak danych wejściowych'}.</p>
  </Card>;

  const { delta_p10: lo, delta_p50: mid, delta_p90: hi, ndmi_last: base } = forecast;
  const [tone, statement] = TREND[forecast.trend] ?? ['unknown', forecast.text?.[0]];
  const t = TONE[tone];
  const span = Math.max(0.15, Math.abs(lo), Math.abs(hi)) * 1.15;
  const x = (value) => `${50 + 50 * value / span}%`;
  const after = (delta) => index2(base + delta);
  return <Card className="mt-3 p-5">
    {header}
    <p className="mt-3 text-[16px] font-semibold leading-snug tracking-tight" style={{ color: t.ink }}>{statement}</p>
    <p className="num mt-1 text-[12.5px] text-neutral-500">
      {dateText(forecast.window_from)}–{dateText(forecast.window_to)} · względem zdjęcia z {dateText(forecast.last_scene_date)}</p>
    <div role="img" className="mt-5" aria-label={`Prognozowana zmiana NDMI ${minus(index2(mid))}, przedział 80% od ${minus(index2(lo))} do ${minus(index2(hi))}.`}>
      <div className="relative h-6">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-neutral-200"/>
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-neutral-400"/>
        <span aria-hidden className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
          style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})`, background: t.soft, boxShadow: `inset 0 0 0 1px ${t.fill}` }}/>
        <span aria-hidden className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(14_16_13/0.14)]"
          style={{ left: x(mid), background: t.fill }}/>
      </div>
      <div aria-hidden className="mt-1.5 grid grid-cols-3 text-[11.5px] text-neutral-500">
        <span>← spadek</span><span className="text-center">bez zmiany</span><span className="text-right">wzrost →</span>
      </div>
    </div>
    <p className="num mt-4 text-[13px] text-neutral-700">
      NDMI {index2(base)} → ok. <strong className="font-semibold text-neutral-950">{after(mid)}</strong>
      <span className="text-neutral-500"> (przedział 80%: {after(lo)}–{after(hi)})</span></p>
    {forecast.text?.length > 1 && <ul className="mt-3 flex list-disc flex-col gap-1 pl-4 text-[12.5px] leading-relaxed text-neutral-500 marker:text-neutral-300">
      {/* text[0] to zdanie z liczbami, pokazane wyżej jako oś; dalej uwagi o pewności */}
      {forecast.text.slice(1).map((line, i) => <li key={i}>{line}</li>)}
    </ul>}
  </Card>;
}
