import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Calendar, Check, ChevronRight, MapPin, Search, Sprout, Wheat, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, Input } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { SkeletonReveal } from '@/components/spectrumui/skeleton-reveal';
import { TextStates } from '@/components/spectrumui/text-states';
import { cn } from '@/lib/utils';
import { FieldsMap } from './FieldsMap.jsx';
import { ParcelMap } from './ParcelMap.jsx';
import { api } from './ui.jsx';
import { fieldInput, FULL_ID, number, oldestDate, sameReportInputs, today } from './model.js';
import { initialSelection, insidePoland, isReady, OUTSIDE_AREA, QUERY_TOO_SHORT, selectionReducer } from './parcelSelection.js';

const TEST_AVAILABLE = new URLSearchParams(window.location.search).has('test');
const TEST_POINT = { lat: 52.0, lon: 19.0 };   // gdy w trybie testowym nie wskazano miejsca
const SAVING = 'Zapisuję pole…';
const STEPS = ['Działka', 'Uprawa i terminy'];
const SEARCH_MODES = [{ value: 'address', label: 'Adres lub miejscowość' }, { value: 'parcel', label: 'Numer działki' }];

// Ilustracje upraw (static/design). Uprawa bez ilustracji dostaje ikonę kiełka.
const CROP_IMAGES = {
  maize: '/design/kukurydza.png',
  winter_wheat: '/design/pszenica.png',
  spring_barley: '/design/jeczmien.png',
  winter_rapeseed: '/design/rzepak.png',
  grassland: '/design/laka.png',
  potato: '/design/ziemniaki.png',
  sugar_beet: '/design/burak.png',
};
const CROP_GRID = 'grid grid-cols-4 gap-2 md:grid-cols-7';
// Zastępcze kafelki na czas pobierania listy (tyle, ile upraw zwraca dziś API), żeby układ nie skakał.
const CROP_SKELETON = <div className={CROP_GRID}>
  {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-[104px] rounded-xl bg-neutral-100 sm:h-[112px]"/>)}
</div>;
function describe(parcel) {
  return [parcel.region, parcel.commune && 'gm. ' + parcel.commune, parcel.voivodeship].filter(Boolean).join(', ');
}

function DateField({ label, hint, value, onChange, disabled, required, min, max }) {
  return <Field label={label} hint={hint} required={required}>{(id, describedBy) =>
    <DatePicker id={id} label={label} describedBy={describedBy} value={value} onChange={onChange}
      min={min} max={max} disabled={disabled} variant="secondary" icon={<Calendar className="text-neutral-400"/>}
      className="num w-full justify-start px-3"/>}
  </Field>;
}

function TimelineDate({ label, value, onChange, error, disabled, icon: Icon, referenceDate }) {
  const id = useId();
  const trigger = useRef(null);
  const filled = value && !error;

  return <li className="relative min-w-0 text-center">
    <div className="relative mx-auto max-w-40 px-1 pb-1">
      <span aria-hidden className={cn(
        'mx-auto grid size-8 place-items-center rounded-full border transition-colors',
        'duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
        error ? 'border-severe/40 bg-severe-soft text-severe-ink'
          : filled ? 'border-brand-700 bg-brand-700 text-white' : 'border-brand-200 bg-white text-brand-700',
      )}>
        {filled ? <Check className="size-4 animate-in zoom-in-75 duration-150 motion-reduce:animate-none"/> : <Icon className="size-4"/>}
      </span>
      <span className="mt-2 grid min-h-8 place-items-center text-[12px] leading-4 font-medium text-neutral-800 sm:text-[13px]">
        {label}
      </span>
      <DatePicker triggerRef={trigger} label={label} referenceDate={referenceDate} value={value} onChange={onChange}
        disabled={disabled} invalid={Boolean(error)} describedBy={error ? id : undefined} variant={value ? 'soft' : 'ghost'}
        className={cn('num mt-0.5 h-8 rounded-lg px-1.5 text-[12px] sm:px-2.5 sm:text-[13px]',
          value ? 'font-semibold' : 'bg-neutral-100')}/>
    </div>
    {value && <button type="button" aria-label={`Wyczyść datę: ${label}`} disabled={disabled}
      className="press mx-auto grid size-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
      onClick={() => { onChange(''); trigger.current?.focus(); }}><X aria-hidden className="size-3.5"/></button>}
    {error && <p id={id} role="alert" className="mt-1 px-0.5 text-[11px] font-medium leading-tight text-severe-ink sm:text-xs">{error}</p>}
  </li>;
}

/**
 * Wybór uprawy kafelkami z ilustracją (na wzór listy Model Selector ze Spectrum UI).
 * radiogroup z ruchomym fokusem: Tab wchodzi na wybraną uprawę, strzałki przenoszą wybór, Home/End skaczą na skraj.
 */
function CropPicker({ crops, error, value, onChange, disabled }) {
  const labelId = useId();
  const tiles = useRef([]);
  const focusable = Math.max(0, crops?.findIndex((item) => item.key === value) ?? 0);

  function onKeyDown(event, at) {
    const last = crops.length - 1;
    const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const index = next > last ? 0 : next < 0 ? last : next;
    onChange(crops[index].key);
    tiles.current[index]?.focus();
  }

  return <div>
    <span id={labelId} className="sr-only">Uprawa</span>
    {error ? <Callout tone="danger">Nie udało się pobrać upraw. {error}</Callout>
      : <SkeletonReveal loading={!crops} skeleton={CROP_SKELETON} pulseCount="infinite" revealDuration={300}>
        {crops ? <div role="radiogroup" aria-labelledby={labelId} aria-required="true" className={CROP_GRID}>
          {crops.map((item, at) => {
            const active = item.key === value;
            const image = CROP_IMAGES[item.key];
            return <button key={item.key} ref={(node) => { tiles.current[at] = node; }} type="button" role="radio"
              aria-checked={active} tabIndex={at === focusable ? 0 : -1} disabled={disabled}
              onClick={() => onChange(item.key)} onKeyDown={(event) => onKeyDown(event, at)}
              className={cn('relative flex flex-col items-center gap-1 rounded-xl border px-1.5 pb-2 pt-2.5 text-center',
                'transition-[border-color,background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100',
                'focus-visible:outline-offset-[3px] disabled:pointer-events-none disabled:opacity-50',
                active ? 'border-brand-600 bg-brand-50/70 ring-[3px] ring-brand-600/15'
                  : 'border-black/[0.08] bg-white shadow-hairline hover:border-black/[0.16] hover:bg-neutral-50')}>
              {image ? <img src={image} alt="" draggable={false} decoding="async" className="size-12 object-contain sm:size-14"/>
                : <span className="grid size-12 place-items-center sm:size-14"><Sprout aria-hidden className="size-7 text-brand-500" strokeWidth={1.75}/></span>}
              {/* flex-1: krótka nazwa stoi na środku tej samej wysokości co dwuwierszowa w sąsiednim kafelku */}
              <span className={cn('flex flex-1 items-center text-[12.5px] font-medium leading-tight', active ? 'text-brand-900' : 'text-neutral-700')}>
                {item.name}</span>
              <span aria-hidden className={cn('absolute right-1 top-1 grid size-[18px] place-items-center rounded-full bg-brand-700 text-white',
                'shadow-[0_1px_2px_rgb(13_35_23/0.3)] transition-[opacity,scale] duration-150 ease-out',
                active ? 'scale-100 opacity-100' : 'scale-95 opacity-0')}>
                <Check className="size-3" strokeWidth={3}/>
              </span>
            </button>;
          })}
        </div> : <>{CROP_SKELETON}<span className="sr-only">Ładowanie upraw…</span></>}
      </SkeletonReveal>}
  </div>;
}

/** Wybór działki i konfiguracja uprawy. Wstecz zachowuje wprowadzone dane. */
export function AddFieldForm({ initial, fields, onCancel, onSubmit }) {
  const active = useRef(null);
  const form = useRef(null);
  const finderInput = useRef(null);
  const mapPanel = useRef(null);
  const stepHeading = useRef(null);
  const previousStep = useRef(0);
  const hadCandidates = useRef(false);
  const lookups = useRef(0);   // licznik wskazań działki: odpowiedź starszego zapytania jest pomijana
  const input = initial?.input ?? initial?.report?.request;
  // wybór działki (tekst, lista, punkt, ważność) w jednym miejscu: parcelSelection.js
  const [selection, dispatch] = useReducer(selectionReducer, initial, initialSelection);
  const { query, parcel, savedParcelId, point, location, candidates, message, problem } = selection;
  const [searchMode, setSearchMode] = useState(initial ? 'parcel' : 'address');
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(null);
  const [name, setName] = useState(initial?.name ?? '');
  const [crop, setCrop] = useState(input?.crop ?? null);
  const [date, setDate] = useState(input?.date ?? today());   // brak daty = pole „na dziś”
  const [sowingDate, setSowingDate] = useState(input?.sowing_date ?? '');
  const [harvestDate, setHarvestDate] = useState(input?.harvest_date ?? '');
  const [nextSowingDate, setNextSowingDate] = useState(input?.next_sowing_date ?? '');
  const [crops, setCrops] = useState(null);
  const [cropsError, setCropsError] = useState('');
  const [error, setError] = useState('');   // błąd zapisu pola
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(Boolean(input?.test));

  useEffect(() => {
    const controller = new AbortController();
    api('/api/crops', { signal: controller.signal })
      .then(setCrops)
      .catch((err) => { if (!controller.signal.aborted) setCropsError(err.message); });
    return () => { controller.abort(); active.current?.abort(); };
  }, []);

  useLayoutEffect(() => {
    if (step === previousStep.current) return;
    previousStep.current = step;
    const dialog = stepHeading.current?.closest('[role="dialog"]');
    if (dialog) dialog.scrollTop = 0;
    stepHeading.current?.focus({ preventScroll: true });
  }, [step]);

  useLayoutEffect(() => {
    if (!location || !window.matchMedia('(max-width: 639px)').matches) return;
    const panel = mapPanel.current;
    const dialog = panel?.closest('[role="dialog"]');
    if (!dialog) return;
    panel.querySelector('.map-canvas')?.focus({ preventScroll: true });
    dialog.scrollTop += panel.getBoundingClientRect().top - dialog.getBoundingClientRect().top - 16;
  }, [location]);

  // Działka wybrana z listy zamyka listę razem z przyciskiem, który miał fokus: wtedy wracamy do pola wyszukiwania.
  useEffect(() => {
    if (hadCandidates.current && !candidates.length && !form.current?.contains(document.activeElement)) finderInput.current?.focus();
    hadCandidates.current = candidates.length > 0;
  }, [candidates]);

  /** Anuluje trwające zapytanie (działka albo raport) i daje sygnał nowemu. */
  function takeOver() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    return controller;
  }

  const errorText = (err) => (err.name === 'TimeoutError' ? 'Serwer nie odpowiedział na czas. Spróbuj ponownie.' : err.message);

  /** Nowe wskazanie działki: unieważnia poprzedni wybór i trwające sprawdzanie. */
  function lookup(work, keepCandidates = false) {
    const controller = takeOver();
    const seq = ++lookups.current;
    setError('');
    setBusy('');
    dispatch({ type: 'start', seq, keepCandidates });
    work(controller.signal, (event) => { if (!controller.signal.aborted) dispatch({ ...event, seq }); })
      .catch((err) => { if (!controller.signal.aborted) dispatch({ type: 'failed', seq, text: errorText(err) }); });
  }

  async function getParcel(id, signal, report) {
    const response = await api('/api/parcels/by-id?id=' + encodeURIComponent(id), { signal });
    if (response.status === 'ok' && response.parcel) report({ type: 'selected', parcel: response.parcel });
    else if (response.status === 'no_data') report({ type: 'notFound', text: response.reason || 'Nie znaleziono działki.' });
    else report({ type: 'failed', text: response.reason || 'Usługa działek nie odpowiedziała.' });
  }

  function reject(text) {
    active.current?.abort();
    dispatch({ type: 'reject', seq: ++lookups.current, text });
  }

  function edit(value) {
    active.current?.abort();
    setError('');
    dispatch({ type: 'edit', seq: ++lookups.current, query: value });
  }

  function switchSearchMode(mode) {
    if (mode === searchMode) return;
    active.current?.abort();
    setSearchMode(mode);
    dispatch({ type: 'mode', seq: ++lookups.current, query: mode === 'parcel' ? parcel?.id ?? savedParcelId ?? '' : '' });
  }

  function search() {
    const input = query.trim();
    const addressSearch = searchMode === 'address' && !FULL_ID.test(input);
    if (input.length < 2) { reject(addressSearch ? 'Wpisz adres lub nazwę miejscowości.' : QUERY_TOO_SHORT); return; }
    lookup(async (signal, report) => {
      if (FULL_ID.test(input)) return getParcel(input, signal, report);
      if (addressSearch) {
        const list = await api('/api/addresses/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: input }), signal });
        if (list.length === 1) report({ type: 'located', location: list[0] });
        else if (list.length) report({ type: 'candidates', list, address: true });
        else report({ type: 'notFound', text: 'Brak wyników. Spróbuj wpisać miejscowość lub dopisz nazwę ulicy.' });
        return;
      }
      const response = await api('/api/parcels/search?q=' + encodeURIComponent(input), { signal });
      if (response.status === 'ok' && response.candidates.length === 1) return getParcel(response.candidates[0].id, signal, report);
      if (response.status === 'ok' && response.candidates.length) {
        report({ type: 'candidates', list: response.candidates, truncated: response.truncated });
      } else if (response.status === 'error') report({ type: 'failed', text: response.reason || 'Usługa działek nie odpowiedziała.' });
      else report({ type: 'notFound', text: response.reason || 'Nie znaleziono działki.' });
    });
  }

  function choose(item) {
    if (item.point) dispatch({ type: 'located', seq: selection.seq, location: item });
    else lookup((signal, report) => getParcel(item.id, signal, report), true);
  }

  function pick(next) {
    if (busy === 'saving') return;
    if (!insidePoland(next)) { reject(OUTSIDE_AREA); return; }
    lookup(async (signal, report) => {
      const response = await api('/api/parcels/by-point?' + new URLSearchParams(next), { signal });
      if (response.status === 'ok' && response.parcel) report({ type: 'selected', parcel: response.parcel, fromMap: true });
      else if (response.status === 'error') report({ type: 'pointOnly', point: next });
      else report({ type: 'notFound', text: response.reason || 'W tym miejscu nie ma działki.' });
    });
  }

  const ready = isReady(selection) || test;
  const where = test ? { parcel: null, point: parcel?.centroid ?? point ?? TEST_POINT }
    : { parcel: parcel ?? (savedParcelId ? { id: savedParcelId } : null), point };
  const usesTimeline = crop !== 'grassland';
  const timeline = usesTimeline ? { sowing_date: sowingDate, harvest_date: harvestDate, next_sowing_date: nextSowingDate } : {};
  const harvestError = usesTimeline && sowingDate && harvestDate && harvestDate <= sowingDate
    ? 'Zbiór musi przypadać po siewie lub sadzeniu.' : '';
  const precedingDate = harvestDate || sowingDate;
  const nextSowingError = usesTimeline && precedingDate && nextSowingDate && nextSowingDate <= precedingDate
    ? 'Kolejny siew musi przypadać po zbiorze.' : '';
  const values = { name, crop, date, test, ...where, ...timeline };
  const sameInputs = Boolean(ready && sameReportInputs(initial, values));
  const renameOnly = sameInputs && name.trim() !== initial.name;
  const lastStep = step === STEPS.length - 1;

  function goTo(next) {
    setError('');
    setDirection(next > step ? 'forward' : 'back');
    setStep(next);
  }

  /** Zapis pola na serwerze trwa chwilę; raport liczy się potem w tle (stan widać na karcie pola). */
  function submit(event) {
    event.preventDefault();
    if (busy || selection.checking || !ready || (step > 0 && !crop)) return;
    if (!lastStep) {
      goTo(step + 1);
      return;
    }
    if (harvestError || nextSowingError) return;
    const controller = takeOver();
    setError('');
    setBusy('saving');
    onSubmit(fieldInput(values), controller.signal)
      .catch((err) => { if (!controller.signal.aborted) setError(errorText(err)); })
      .finally(() => { if (active.current === controller) setBusy(''); });
  }

  const submitLabel = !initial ? 'Dodaj pole'
    : renameOnly ? 'Zapisz nazwę'
      : sameInputs ? 'Zapisz' : 'Zapisz i przelicz';

  const disabled = busy === 'saving';
  const searching = selection.checking;
  const addressMode = searchMode === 'address';
  const status = searching ? (addressMode ? 'Szukam na mapie…' : 'Sprawdzam działkę…') : message;
  // Problem z działką stoi przy wyszukiwarce (brak działki spokojniej niż błąd usługi); błąd raportu przy przycisku.
  const finderProblem = test ? null : problem;
  const submitError = error;

  const finder = <>
    <Segmented options={SEARCH_MODES} value={searchMode} onChange={switchSearchMode} label="Sposób wyszukiwania"
      className="mb-4"/>
    <Field label={addressMode ? 'Adres lub miejscowość' : 'Numer działki lub obręb'}
      hint={addressMode ? 'Np. Marki, Andersa 1' : 'Np. Niedrzwica Kościelna 580/2'}>{(id, describedBy) =>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          {/* lupa zamienia się w spinner na czas sprawdzania działki (także po kliknięciu mapy) */}
          <Input ref={finderInput} id={id} icon={searching ? <Spinner className="text-brand-600"/> : <Search/>}
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
    {finderProblem && <Callout tone={finderProblem.kind === 'not_found' ? 'warning' : 'danger'} role="alert" className="mt-3">
      {finderProblem.text}</Callout>}
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
    {TEST_AVAILABLE && <div className="mt-4 rounded-xl border border-dashed border-black/[0.14] px-3.5 py-3">
      <Switch checked={test} onCheckedChange={setTest} disabled={disabled} label="Tryb testowy (obrys testowy, dane na żywo)"/>
    </div>}
  </>;

  const timelineFields = [
    { label: crop === 'potato' ? 'Sadzenie' : 'Siew', value: sowingDate, onChange: setSowingDate, icon: Sprout },
    { label: 'Zbiór', value: harvestDate, onChange: setHarvestDate, error: harvestError, icon: Wheat },
    { label: 'Kolejny siew lub sadzenie', value: nextSowingDate, onChange: setNextSowingDate, error: nextSowingError, icon: Calendar },
  ];

  const footer = <div className={cn('sticky -bottom-6 z-20 -mx-6 -mb-6 mt-7 flex flex-col gap-3 border-t border-border bg-background/95 px-6 pt-4',
    'pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:flex-row sm:items-center sm:gap-6 sm:py-4')}>
    <p role="status" className="sr-only">{busy === 'saving' ? SAVING : ''}</p>
    {submitError && <Callout tone="danger" role="alert" className="lg:flex-1">{submitError}</Callout>}
    {!submitError && lastStep && <p className="hidden text-[13px] leading-snug text-neutral-500 sm:block sm:flex-1">
      Po zapisie raport policzy się w tle.</p>}
    <div className="flex gap-2 sm:ml-auto">
      {step > 0 ? <Button variant="secondary" size="lg" className="px-4" icon={<ArrowLeft/>} disabled={disabled}
        onClick={() => goTo(step - 1)}>Wstecz</Button>
        : onCancel && <Button variant="secondary" size="lg" className="px-4" onClick={onCancel}>Anuluj</Button>}
      <Button type="submit" size="lg" iconRight={lastStep ? <Check/> : <ArrowRight/>} className="flex-1 px-4 sm:flex-none sm:px-5"
        loading={disabled} disabled={searching || !ready || (step > 0 && !crop) || (lastStep && Boolean(harvestError || nextSowingError))}>
        {lastStep ? submitLabel : 'Dalej'}
      </Button>
    </div>
  </div>;

  return <form ref={form} onSubmit={submit} className="mt-5 lg:mt-1">
    <ol aria-label="Kroki formularza" className="mb-5 grid max-w-md grid-cols-2 gap-3 sm:mb-6">
      {STEPS.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}
        className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium',
          'transition-colors duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
          step === index ? 'border-brand-200 bg-brand-50 text-brand-900' : 'border-border text-neutral-600')}>
        <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-full text-xs tabular-nums',
          'transition-colors duration-200 motion-reduce:transition-none',
          step >= index ? 'bg-brand-700 text-white' : 'bg-neutral-100 text-neutral-500')}>
          {step > index ? <Check className="size-3.5"/> : index + 1}
        </span>
        {label}
      </li>)}
    </ol>
    <div key={step} className={cn(direction && 'animate-in fade-in-0 duration-200 ease-[var(--ease-out)] motion-reduce:animate-none',
      direction === 'forward' && 'slide-in-from-right-2', direction === 'back' && 'slide-in-from-left-2')}>
      <h2 ref={stepHeading} tabIndex={-1} className="mb-4 font-display text-[21px] font-semibold tracking-tight outline-none">
        {step === 0 ? 'Gdzie jest pole?' : 'Co rośnie na polu?'}
      </h2>
      {step === 0 && <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
        <div className="surface min-w-0 p-4 sm:p-5">{finder}</div>
        <div ref={mapPanel} className="min-w-0">
          {location ? <ParcelMap parcel={parcel} point={point} location={location} onPick={pick}/>
            : <FieldsMap fields={fields} parcel={parcel} point={point} onPick={pick}/>}
        </div>
      </div>}
      {lastStep && <div className="grid gap-4">
        <div className="surface min-w-0 p-4 sm:p-5">
          <CropPicker crops={crops} error={cropsError} value={crop} onChange={setCrop} disabled={disabled}/>
        </div>
        {usesTimeline && <section className="surface min-w-0 p-3 sm:p-5" aria-label="Terminy sezonu">
          <h3 className="text-base font-semibold">Terminy sezonu <span className="font-normal text-neutral-500">(opcjonalnie)</span></h3>
          <p className="mt-1 text-[13px] leading-snug text-neutral-600">
            Podaj znane lub planowane daty. Puste terminy oszacujemy z kalendarza uprawy.
          </p>
          <div className="relative mx-auto mt-4 max-w-3xl">
            <div aria-hidden className="pointer-events-none absolute inset-x-1/6 top-4 flex h-0.5 bg-brand-200">
              {timelineFields.slice(1).map(({ label, value, error }, index) => <span key={label}
                className={cn('h-full flex-1 origin-left bg-brand-600 transition-transform duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
                  value && !error && timelineFields[index].value && !timelineFields[index].error ? 'scale-x-100' : 'scale-x-0')}/>)}
            </div>
            <ol className="grid grid-cols-3">
              {timelineFields.map((field) => <TimelineDate key={field.label} {...field} referenceDate={date} disabled={disabled}/>)}
            </ol>
          </div>
        </section>}
        <div className="surface grid min-w-0 items-start gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Nazwa pola (opcjonalnie)">{(id) =>
            <Input id={id} value={name} maxLength={80} disabled={disabled} placeholder="np. Pod lasem"
              onChange={(event) => setName(event.target.value)}/>}
          </Field>
          <DateField label="Data analizy" required hint="Dziś lub do 10 lat wstecz" value={date}
            onChange={setDate} min={oldestDate()} max={today()} disabled={disabled}/>
        </div>
      </div>}
    </div>
    {footer}
  </form>;
}
