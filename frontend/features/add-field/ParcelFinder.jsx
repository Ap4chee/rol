import { Check, ChevronRight, Search } from 'lucide-react';
import { number } from '@/shared/format/number';
import { Button } from '@/shared/ui/button';
import { Callout } from '@/shared/ui/callout';
import { TextStates } from '@/shared/ui/effects';
import { Field, Input } from '@/shared/ui/field';
import { Segmented } from '@/shared/ui/segmented';
import { Spinner } from '@/shared/ui/spinner';
import { Switch } from '@/shared/ui/switch';
import { cn } from '@/shared/lib/cn';
import { describeParcel as describe, placeGuide } from './logic.js';

const SEARCH_MODES = [{ value: 'address', label: 'Adres lub miejscowość' }, { value: 'parcel', label: 'Numer działki' }];

/**
 * Wyszukiwarka działki: tryb (adres albo numer), pole tekstowe, stan sprawdzania, lista kandydatów i wybrana działka.
 * Stan i zapytania są w useParcelLookup; tu tylko widok.
 */
export function ParcelFinder({ lookup, inputRef, disabled, problem, testAvailable, test, onTest }) {
  const { selection, searchMode, search, edit, choose, switchSearchMode } = lookup;
  const { query, parcel, savedParcelId, point, location, candidates, message } = selection;
  const searching = selection.checking;
  const addressMode = searchMode === 'address';
  const status = searching ? (addressMode ? 'Szukam na mapie…' : 'Sprawdzam działkę…') : message;
  return <>
    <Segmented options={SEARCH_MODES} value={searchMode} onChange={switchSearchMode} label="Sposób wyszukiwania"
      className="mb-4"/>
    <Field label={addressMode ? 'Adres lub miejscowość' : 'Numer działki lub obręb'}
      hint={addressMode ? 'Np. Marki, Andersa 1' : 'Np. Niedrzwica Kościelna 580/2'}>{(id, describedBy) =>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          {/* lupa zamienia się w spinner na czas sprawdzania działki (także po kliknięciu mapy) */}
          <Input ref={inputRef} id={id} icon={searching ? <Spinner className="text-brand-600"/> : <Search/>}
            placeholder={addressMode ? 'Wpisz miejscowość lub adres' : 'Obręb i nr działki'} aria-describedby={describedBy} value={query}
            maxLength={addressMode ? 180 : 80} autoComplete="off" spellCheck={false}
            enterKeyHint="search" disabled={disabled} data-autofocus
            onChange={(event) => edit(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }}/>
        </div>
        <Button variant="secondary" onClick={search} disabled={disabled}>Szukaj</Button>
      </div>}
    </Field>
    {/* region statusu jest zawsze w drzewie, żeby czytnik ekranu ogłaszał każdą zmianę */}
    <div role="status">
      {status ? <p className="mt-2.5 text-[13px] leading-snug text-neutral-500"><TextStates text={status}/></p>
        : parcel ? <span className="sr-only">Wybrano działkę {parcel.number || parcel.id}.</span>
          : point ? <span className="sr-only">Wybrano punkt na mapie.</span>
            : location ? <span className="sr-only">Mapa przybliżona do {location.label}. Wskaż działkę na mapie.</span> : null}
    </div>
    {problem && <Callout tone={problem.kind === 'not_found' ? 'warning' : 'danger'} role="alert" className="mt-3">
      {problem.text}</Callout>}
    {candidates.length > 0 && <ul aria-label={addressMode ? 'Znalezione miejsca' : 'Znalezione działki'} className={cn(
      'mt-2 max-h-[min(19rem,42vh)] overflow-y-auto overscroll-contain rounded-xl border border-black/[0.08] bg-white p-1 shadow-hairline',
      'animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out motion-reduce:[--tw-enter-translate-y:0]')}>
      {candidates.map((item) => <li key={item.id ?? `${item.point.lon},${item.point.lat}:${item.label}`}>
        <button type="button" onClick={() => choose(item)}
          className={'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-[background-color,scale] duration-150 ease-out '
            + 'hover:bg-black/[0.035] active:scale-[0.99] motion-reduce:active:scale-100'}>
          <span className="min-w-0 flex-1">
            <span className="num block text-[14px] font-semibold text-neutral-900">{item.label ?? (item.number || item.id)}</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-neutral-500">
              {item.point ? item.region : [describe(item), item.id].filter(Boolean).join(' · ')}
            </span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-neutral-300"/>
        </button>
      </li>)}
    </ul>}
    {location && !parcel && !point && <Callout tone="info" className="mt-4 motion-safe:animate-rise" title={location.label}>
      Kliknij swoje pole na przybliżonej mapie.
    </Callout>}
    {parcel && <Callout tone="ok" className="mt-3 animate-in fade-in-0 duration-200 ease-out [&>div]:flex-1"
      title={<span className="flex items-baseline justify-between gap-3">
        <span>Działka <span className="num">{parcel.number || parcel.id}</span></span>
        <span className="num shrink-0">{number(parcel.area_ha, 2)} <span className="font-normal opacity-75">ha</span></span>
      </span>}>
      {describe(parcel) || null}
    </Callout>}
    {point && <Callout tone="info" className="mt-3 animate-in fade-in-0 duration-200 ease-out" title="Wskazany punkt">
      <span className="num">{number(point.lat, 4)}° N, {number(point.lon, 4)}° E</span>
    </Callout>}
    {savedParcelId && <Callout tone="ok" className="mt-3" title="Zapisana działka">{savedParcelId}</Callout>}
    {testAvailable && <div className="mt-4 rounded-xl border border-dashed border-black/[0.14] px-3.5 py-3">
      <Switch checked={test} onCheckedChange={onTest} disabled={disabled} label="Tryb testowy (obrys testowy, dane na żywo)"/>
    </div>}
  </>;
}

/** Trzy kroki wskazania pola pod wyszukiwarką, odhaczane w miarę postępu (tylko na szerokim ekranie). */
export function PlaceGuide({ found, chosen }) {
  const { steps: guide, at: guideAt } = placeGuide({ found, chosen });
  return <ol aria-label="Jak wskazać pole" className="mt-6 hidden border-t border-black/[0.06] pt-5 lg:mt-auto lg:block">
    {guide.map((item, index) => <li key={item.label} className="relative flex gap-3 pb-4 last:pb-0">
      {index < guide.length - 1 && <span aria-hidden className={cn('absolute left-3 top-7 bottom-0 w-px -translate-x-1/2',
        item.done ? 'bg-brand-300' : 'bg-neutral-200')}/>}
      <span aria-hidden className={cn('relative grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold transition-colors duration-200 motion-reduce:transition-none',
        item.done ? 'bg-brand-700 text-white' : index === guideAt ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-300'
          : 'bg-neutral-100 text-neutral-500')}>
        {item.done ? <Check className="size-3.5" strokeWidth={2.5}/> : <span className="num">{index + 1}</span>}
      </span>
      <span className="min-w-0 pt-0.5">
        <span className={cn('block text-[13px] font-medium leading-5', item.done || index === guideAt ? 'text-neutral-900' : 'text-neutral-500')}>
          {item.label}{item.done && <span className="sr-only"> (zrobione)</span>}</span>
        <span className="block text-[12.5px] leading-snug text-neutral-500">{item.text}</span>
      </span>
    </li>)}
  </ol>;
}
