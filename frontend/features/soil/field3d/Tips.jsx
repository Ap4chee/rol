import { MONTHS } from '@/shared/format/date';
import { number } from '@/shared/format/number';
import { cn } from '@/shared/lib/cn';
import { balanceText } from '../logic.js';

const TEXTURE = [['sand_pct', 'bg-sand'], ['silt_pct', 'bg-silt'], ['clay_pct', 'bg-clay']];
const TIP_TITLE = 'mt-1.5 text-[15px] font-semibold leading-tight tracking-tight text-neutral-950 first-letter:uppercase';   // „glina” → „Glina” (tylko wyświetlanie)
const TIP_RULE = 'border-t border-black/[0.06] pt-2';   // włosowa linia między nagłówkiem dymka a liczbami

/**
 * Dymek warstwy gleby. Położenie przy kursorze, kreska z kropką i wejście: `.layer-tip` w app.css.
 * Ten sam element zostaje przy przejściu na sąsiednią warstwę, więc kolejne dymki pokazują się od razu, bez animacji.
 */
export function LayerTip({ layer, profile }) {
  return <div className="layer-tip" role="tooltip">
    {/* głębokość jako mikro-etykieta, informacja o korzeniach zwykłym pismem (wersalikami nie mieści się w jednej linii) */}
    <p className="eyebrow num">{layer.top_cm}–{layer.bottom_cm} cm
      {layer.balance !== 'none' && <span className="font-sans text-[11px] font-medium normal-case tracking-normal text-brand-700"> · {balanceText(layer, profile.balanceCm)}</span>}</p>
    <p className={TIP_TITLE}>{layer.texture_label}</p>
    {/* uziarnienie: odcinki w proporcji piasek / pył / ił, rozdzielone szczeliną zamiast obramowania */}
    <div className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      {TEXTURE.filter(([key]) => layer[key] > 0).map(([key, swatch]) =>
        <i key={key} className={cn('basis-0', swatch)} style={{ flexGrow: layer[key] }}/>)}
    </div>
    <p className="num mt-1.5 text-[12px] text-neutral-500">piasek {number(layer.sand_pct)}% · pył {number(layer.silt_pct)}% · ił {number(layer.clay_pct)}%</p>
    <dl className={TIP_RULE}>
      <dt>Woda dostępna</dt><dd>{number(layer.available_water_mm)} mm</dd>
      <dt>Pojemność polowa</dt><dd>{number(layer.field_capacity_vol_pct)}%</dd>
      <dt>Punkt więdnięcia</dt><dd>{number(layer.wilting_point_vol_pct)}%</dd>
      {layer.soc_g_kg != null && <><dt>Węgiel organiczny</dt><dd>{number(layer.soc_g_kg, 1)} g/kg</dd></>}
    </dl>
  </div>;
}

export function CropTip({ report, rootCm }) {
  const crop = report.crop;
  const need = report.irrigation_need;
  const today = report.water_status?.series?.at(-1);
  const short = (iso) => iso?.slice(5).split('-').reverse().join('.');
  return <div className="layer-tip crop-tip" role="tooltip">
    <p className="eyebrow">{crop.stage_name?.split(' (')[0] ?? 'faza nieznana'}</p>
    <p className={TIP_TITLE}>{crop.name}</p>
    <dl className={TIP_RULE}>
      {today && crop.in_season !== false && <><dt>Zużycie wody dziś</dt><dd>{number(today.etc_mm, 1)} mm</dd></>}
      {crop.kc != null && <><dt>Współczynnik Kc</dt><dd>{number(crop.kc, 2)}</dd></>}
      <dt>Korzenie teraz</dt><dd>{crop.root_depth_now_m != null ? `ok. ${number(crop.root_depth_now_m * 100)} cm` : 'brak'}</dd>
      <dt>Strefa w bilansie</dt><dd>do {number(rootCm)} cm</dd>
      {crop.critical_from && <><dt>Okres krytyczny</dt><dd>{short(crop.critical_from)}–{short(crop.critical_to)}</dd></>}
    </dl>
    {need?.status === 'ok' && <>
      <p className={cn('mt-3 text-[12px] font-semibold text-neutral-900', TIP_RULE)}>Potrzeba nawadniania (netto)</p>
      <dl>
        {need.so_far_mm != null && <><dt>Ten sezon do dziś</dt><dd>{number(need.so_far_mm)} mm</dd></>}
        {need.typical_mm != null && <><dt>Typowy sezon</dt><dd>{number(need.typical_mm)} mm</dd></>}
        {need.dry_mm != null && <><dt>Suchy rok</dt><dd>{number(need.dry_mm)} mm</dd></>}
      </dl>
      {need.monthly?.some((m) => m.mm > 0) && <NeedBars monthly={need.monthly}/>}
    </>}
  </div>;
}

/** Typowa potrzeba nawadniania w kolejnych miesiącach: wąskie słupki na wspólnej linii bazowej. */
function NeedBars({ monthly }) {
  const max = Math.max(1, ...monthly.map((m) => m.mm));
  return <div className="mt-2.5 grid auto-cols-fr grid-flow-col" role="img" aria-label="Typowa potrzeba nawadniania w miesiącach">
    {monthly.map((m) => <div key={m.month} className="flex flex-col items-center gap-1">
      <div className="flex h-10 w-full items-end justify-center border-b border-black/10">
        <span className="w-3/5 max-w-3 rounded-t-[2px] bg-water-500" style={{ height: `${Math.max(2, 100 * m.mm / max)}%` }}/>
      </div>
      <small className="text-[9px] leading-none text-neutral-500">{MONTHS[m.month - 1]}</small>
    </div>)}
  </div>;
}
