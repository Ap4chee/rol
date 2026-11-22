import { ChevronRight, CloudRain, Droplet, Droplets, Layers, Pencil, Trash2, Waves } from 'lucide-react';
import { fieldHref } from '@/app/router';
import { minus, mm, number } from '@/shared/format/number';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Meter } from '@/shared/ui/meter';
import { ParcelOutline } from '@/shared/ui/parcel-outline';
import { cn } from '@/shared/lib/cn';
import { CropTile, TILE } from '@/features/fields/CropTile';
import { JOB, JobBadge } from '@/features/fields/JobBadge';
import { waterPercent } from '@/features/fields/logic';
import { Status, statusFill, statusInk } from '@/features/fields/Status';
import { distanceText } from './logic.js';
import { RISE } from './motion.js';

// godzina odświeżenia po polsku, np. „22 lis, 06:00”
const refreshedText = (iso) => new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(iso));

/** Pasek pod kartą: stan raportu po lewej, edycja i usuwanie po prawej (przyciski nie są zagnieżdżone w <a>). */
function CardFooter({ field, onEdit, onDelete }) {
  return <div className="flex items-center justify-end gap-1 border-t border-black/[0.05] bg-neutral-50/70 px-3 py-1.5">
    <div role="status" className="mr-auto min-w-0 truncate pl-1 text-[12px] text-neutral-500">
      {/* karta bez raportu pokazuje stan w treści, więc tu tylko przy odświeżaniu istniejącego raportu */}
      {!field.report ? null : JOB[field.job] ? <JobBadge field={field}/>
        : field.refreshed_at && <>Odświeżono {refreshedText(field.refreshed_at)}</>}
    </div>
    <Button variant="ghost" size="sm" icon={<Pencil/>} aria-label={`Edytuj pole ${field.name}`}
      onClick={() => onEdit(field)} className="text-neutral-600 max-sm:h-9">Edytuj</Button>
    <Button variant="ghost" size="sm" icon={<Trash2/>} aria-label={`Usuń pole ${field.name}`}
      onClick={() => onDelete(field)}
      className="text-neutral-600 hover:bg-severe-soft hover:text-severe-ink max-sm:h-9">Usuń</Button>
  </div>;
}

/** Karta pola, którego pierwszy raport jeszcze się liczy (albo się nie udał): stan zamiast wyniku. */
export function PendingFieldCard({ field, style, onEdit, onDelete }) {
  const failed = field.job === 'error';
  return <Card className={cn('flex min-w-0 flex-col overflow-hidden', RISE)} style={style}>
    <a href={fieldHref(field.id)} className="group flex flex-1 flex-col p-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600">
      <div className="flex items-center gap-3">
        <CropTile crop={{ key: field.input.crop }}/>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-sans text-[15px] font-semibold leading-snug tracking-tight text-neutral-900">{field.name}</h3>
          <p className="mt-0.5 truncate text-[13px] text-neutral-500">{field.input.parcel_id ?? 'Wskazany punkt'}</p>
        </div>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-neutral-300 transition-[color,translate] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-neutral-500"/>
      </div>
      <div className="mt-5 flex flex-1 flex-col items-start gap-2.5">
        <JobBadge field={field}/>
        <p className="text-[13px] leading-snug text-neutral-500">{failed
          ? `${field.error} Serwer spróbuje ponownie sam.`
          : 'Pobieram pogodę, glebę i zdjęcia satelitarne. Wynik pojawi się tu sam, zwykle w ciągu minuty.'}</p>
      </div>
    </a>
    <CardFooter field={field} onEdit={onEdit} onDelete={onDelete}/>
  </Card>;
}

/** Karta pola: treść jest linkiem do raportu, a u dołu osobny pasek ze stanem raportu, edycją i usuwaniem. */
export function FieldCard({ field, style, onEdit, onDelete }) {
  const { report } = field;
  const water = report.water_status;
  const value = waterPercent(water.result);
  const climat = water.climatic_water_balance;
  const hydro = report.hydrology;
  const brook = hydro?.nearest_watercourse_distance_m;
  const retention = report.recommendations?.retention ?? [];
  // retencja wody na tym polu, z raportu; wiersz bez danych jest pomijany zamiast pokazywać zero
  const facts = [
    [Layers, 'Pojemność wodna gleby', water.result && mm(water.result.taw_mm)],
    [CloudRain, `Opad − parowanie, ${climat?.days} dni`, climat && minus(mm(climat.balance_mm))],
    [Waves, 'Najbliższy ciek', Number.isFinite(brook) && [hydro.nearest_watercourse_name, distanceText(brook)].filter(Boolean).join(' · ')],
  ].filter(([, , v]) => v);
  return <Card className={cn('flex min-w-0 flex-col overflow-hidden transition-[border-color,box-shadow] duration-200 ease-out hover:border-black/[0.14] hover:shadow-raised', RISE)} style={style}>
    <a href={fieldHref(field.id)} className="group flex flex-1 flex-col p-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600">
      <div className="flex items-center gap-3">
        <CropTile crop={report.crop}/>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-sans text-[15px] font-semibold leading-snug tracking-tight text-neutral-900">{field.name}</h3>
          <p className="mt-0.5 truncate text-[13px] text-neutral-500">
            {report.crop.name}{report.parcel?.area_ha != null && <> · <span className="num">{number(report.parcel.area_ha, 2)} ha</span></>}</p>
        </div>
        <ParcelOutline geometry={report.parcel?.geometry} className={cn(TILE, 'p-1')}/>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-neutral-300 transition-[color,translate] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-neutral-500"/>
      </div>
      {/* kolejność wzroku: 1) stan wody (duża liczba w kolorze stanu), 2) co zrobić, 3) szczegóły drobnym drukiem */}
      <div className="mt-5">
        <div className="flex items-start justify-between gap-3">
          {value != null
            ? <p className="num font-display text-[44px] font-semibold leading-none tracking-tight" style={{ color: statusInk(water) }}>
              {number(value)}<span className="text-[26px]">%</span></p>
            : <p className="font-display text-[22px] font-semibold leading-tight text-neutral-500">Brak oceny</p>}
          <Status water={water} size="sm" className="mt-1 shrink-0"/>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-neutral-500">
          <Droplet aria-hidden className="size-3.5 shrink-0 fill-water-100 text-water-500" strokeWidth={1.75}/>zapasu wody w strefie korzeni</p>
        {/* bez zapasu: powód z raportu (czego brakuje) zamiast pustego paska */}
        {value != null ? <Meter value={value} color={statusFill(water)} label="Zapas wody w strefie korzeni" className="mt-3"/>
          : (water.reason ?? water.headline) && <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-neutral-500">{water.reason ?? water.headline}</p>}
      </div>
      {retention.length > 0 && <div className="mt-4 flex gap-2.5 rounded-xl bg-brand-50 px-3.5 py-3">
        <Droplets aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" strokeWidth={1.75}/>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-brand-700">Co zrobić</p>
          <p className="mt-0.5 line-clamp-2 text-[14px] font-medium leading-snug text-neutral-900">{retention[0].title}</p>
          {retention.length > 1 && <p className="mt-0.5 text-[12.5px] text-neutral-500">i {retention.length - 1} więcej w raporcie</p>}
        </div>
      </div>}
      {/* mt-auto: szczegóły na dole, w jednym rzędzie kart na tej samej wysokości */}
      {facts.length > 0 && <div className="mt-auto pt-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-neutral-100 pt-3 text-[12.5px]">
          {facts.map(([Icon, label, text]) => <div key={label} className="contents">
            <dt className="flex items-center gap-2 text-neutral-500">
              <Icon aria-hidden className="size-3.5 shrink-0 text-neutral-400" strokeWidth={1.75}/>{label}</dt>
            <dd className="num truncate text-right text-neutral-700" title={text}>{text}</dd>
          </div>)}
        </dl>
      </div>}
    </a>
    <CardFooter field={field} onEdit={onEdit} onDelete={onDelete}/>
  </Card>;
}
