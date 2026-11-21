import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Calendar, Check, ChevronRight, Search, Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, Input } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { LoadingState } from '@/components/spectrumui/loading-state';
import { SkeletonReveal } from '@/components/spectrumui/skeleton-reveal';
import { TextStates } from '@/components/spectrumui/text-states';
import { cn } from '@/lib/utils';
import { ParcelMap } from './ParcelMap.jsx';
import { api, generateReport } from './ui.jsx';
import { fieldFromReport, FULL_ID, number, oldestDate, today } from './model.js';
import { testParcel } from './testParcel.js';

const TEST_AVAILABLE = new URLSearchParams(window.location.search).has('test');
const TEST_POINT = { lat: 52.0, lon: 19.0 };   // gdy w trybie testowym nie wskazano miejsca
const REPORT_BUSY = 'Pobieram dane działki i liczę bilans wodny (do 30 s)';

// Ilustracje upraw (static/design). Uprawa bez ilustracji dostaje ikonę kiełka.
const CROP_IMAGES = {
  maize: '/design/kukurydza.png',
  winter_wheat: '/design/pszenica.png',
  grassland: '/design/laka.png',
  potato: '/design/ziemniaki.png',
  sugar_beet: '/design/burak.png',
};
// Kafelki upraw: 4 w rzędzie na telefonie i w kolumnie formularza (lg), jeden rząd na średnim ekranie.
const CROP_GRID = 'grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-4';
// Zastępcze kafelki na czas pobierania listy (tyle, ile upraw zwraca dziś API), żeby układ nie skakał.
const CROP_SKELETON = <div className={CROP_GRID}>
  {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-[102px] rounded-xl bg-neutral-100 sm:h-[118px]"/>)}
</div>;
// Natywny wskaźnik kalendarza (Chrome, Edge) niewidoczny i rozciągnięty na całe pole: klik w dowolnym miejscu otwiera
// kalendarz, a w polu zostaje jedna ikona (po lewej, z z-10, bo pole z `relative` przykryłoby ją).
// Safari na iOS: data do lewej jak w pozostałych polach.
const DATE_INPUT = 'relative [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 '
  + '[&::-webkit-calendar-picker-indicator]:h-auto [&::-webkit-calendar-picker-indicator]:w-auto '
  + '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 '
  + '[&::-webkit-date-and-time-value]:text-left';

function describe(parcel) {
  return [parcel.region, parcel.commune && 'gm. ' + parcel.commune, parcel.voivodeship].filter(Boolean).join(', ');
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
    <p id={labelId} className="mb-1.5 text-[13px] font-medium text-neutral-700">
      Uprawa<span aria-hidden className="ml-0.5 text-severe">*</span>
    </p>
    {error ? <Callout tone="danger">Nie udało się pobrać upraw. {error}</Callout>
      : <SkeletonReveal loading={!crops} skeleton={CROP_SKELETON} pulseCount="infinite" revealDuration={300}>
        {crops ? <div role="radiogroup" aria-labelledby={labelId} aria-required="true" className={CROP_GRID}>
          {crops.map((item, at) => {
            const active = item.key === value;
            const image = CROP_IMAGES[item.key];
            return <button key={item.key} ref={(node) => { tiles.current[at] = node; }} type="button" role="radio"
              aria-checked={active} tabIndex={at === focusable ? 0 : -1} disabled={disabled}
              onClick={() => onChange(item.key)} onKeyDown={(event) => onKeyDown(event, at)}
              className={cn('relative flex flex-col items-center gap-1.5 rounded-xl border bg-white px-1.5 pb-2.5 pt-1.5 text-center shadow-hairline',
                'transition-[border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100',
                'focus-visible:outline-offset-[3px] disabled:pointer-events-none disabled:opacity-50',
                active ? 'border-brand-600 ring-[3px] ring-brand-600/15' : 'border-black/[0.08] hover:border-black/[0.18]')}>
              <span className={cn('grid h-12 w-full place-items-center rounded-lg transition-[background-color] duration-150 ease-out sm:h-16',
                active ? 'bg-brand-50' : 'bg-neutral-100/70')}>
                {image ? <img src={image} alt="" draggable={false} decoding="async" className="size-10 object-contain sm:size-14"/>
                  : <Sprout aria-hidden className="size-6 text-brand-500 sm:size-7" strokeWidth={1.75}/>}
              </span>
              <span className={cn('text-[12.5px] font-medium leading-tight', active ? 'text-neutral-950' : 'text-neutral-700')}>{item.name}</span>
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

/** Formularz działki, uprawy i daty z mapą obok (w oknie dodawania i przeliczania pola). */
export function AddFieldForm({ initial, onCancel, onReport }) {
  const active = useRef(null);
  const form = useRef(null);
  const finderInput = useRef(null);
  const hadCandidates = useRef(false);
  const [query, setQuery] = useState(initial?.report.request.parcel_id ?? initial?.report.parcel?.id ?? '');
  const [parcel, setParcel] = useState(initial?.report.parcel ?? null);
  const [point, setPoint] = useState(initial?.report.parcel ? null : initial?.report.request.point ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [crop, setCrop] = useState(initial?.report.crop.key ?? null);
  const [date, setDate] = useState(initial?.report.analysis_date ?? today());
  const [crops, setCrops] = useState(null);
  const [cropsError, setCropsError] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api('/api/crops', { signal: controller.signal })
      .then(setCrops)
      .catch((err) => { if (!controller.signal.aborted) setCropsError(err.message); });
    return () => { controller.abort(); active.current?.abort(); };
  }, []);

  // Działka wybrana z listy zamyka listę razem z przyciskiem, który miał fokus: wtedy wracamy do pola wyszukiwania.
  useEffect(() => {
    if (hadCandidates.current && !candidates.length && !form.current?.contains(document.activeElement)) finderInput.current?.focus();
    hadCandidates.current = candidates.length > 0;
  }, [candidates]);

  async function request(mode, work) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError('');
    setBusy(mode);
    try { await work(controller.signal); }
    catch (err) { if (!controller.signal.aborted) setError(err.name === 'TimeoutError' ? 'Serwer nie odpowiedział na czas. Spróbuj ponownie.' : err.message); }
    finally { if (active.current === controller) setBusy(''); }
  }

  async function getParcel(id, signal) {
    const response = await api('/api/parcels/by-id?id=' + encodeURIComponent(id), { signal });
    if (response.status !== 'ok' || !response.parcel) throw new Error(response.reason || 'Nie znaleziono działki.');
    select(response.parcel);
  }

  function select(next) {
    setParcel(next);
    setPoint(null);
    setQuery(next.id);
    setCandidates([]);
    setMessage('');
  }

  function search() {
    const input = query.trim();
    if (input.length < 2) { setError('Wpisz nazwę obrębu i numer działki.'); return; }
    setParcel(null);
    setPoint(null);
    setCandidates([]);
    setMessage('');
    request('search', async (signal) => {
      if (FULL_ID.test(input)) return getParcel(input, signal);
      const response = await api('/api/parcels/search?q=' + encodeURIComponent(input), { signal });
      if (response.status !== 'ok' || !response.candidates.length) throw new Error(response.reason || 'Nie znaleziono działki.');
      if (response.candidates.length === 1) return getParcel(response.candidates[0].id, signal);
      setCandidates(response.candidates);
      setMessage(response.truncated ? 'Wybierz działkę lub doprecyzuj nazwę obrębu.' : 'Wybierz swoją działkę z wyników.');
    });
  }

  function pick(next) {
    if (busy === 'report') return;
    if (next.lat < 48.9 || next.lat > 55 || next.lon < 14 || next.lon > 24.3) {
      setError('Wskaż miejsce w granicach Polski.');
      return;
    }
    setParcel(null);
    setPoint(null);
    setCandidates([]);
    setMessage('');
    request('search', async (signal) => {
      const response = await api('/api/parcels/by-point?' + new URLSearchParams(next), { signal });
      if (response.status === 'ok' && response.parcel) { select(response.parcel); return; }
      if (response.status === 'error') {
        setPoint(next);
        setMessage('Usługa działek jest niedostępna. Raport będzie dotyczył wskazanego punktu.');
      } else throw new Error(response.reason || 'W tym miejscu nie ma działki.');
    });
  }

  function submit(event) {
    event.preventDefault();
    if (busy || !crop || !(parcel || point || test)) return;
    request('report', async (signal) => {
      if (test) {   // analiza na żywo dla punktu, w widoku obrys testowy
        const where = parcel?.centroid ?? point ?? TEST_POINT;
        const result = await generateReport({ crop, date, point: { lat: where.lat, lon: where.lon } }, signal);
        const shape = testParcel(where.lat, where.lon);
        if (!signal.aborted) onReport(fieldFromReport({ ...result, parcel: shape.parcel, test_crop_area: shape.cropArea }, name || 'Działka testowa'));
        return;
      }
      const result = await generateReport({ crop, date, ...(parcel ? { parcel_id: parcel.id } : { point }) }, signal);
      if (!signal.aborted) onReport(fieldFromReport(result, name));
    });
  }

  const disabled = busy === 'report';
  const searching = busy === 'search';
  const status = searching ? 'Sprawdzam działkę…' : message;
  // Błąd wyszukiwania stoi przy wyszukiwarce; błąd raportu przy przycisku (wtedy działka, punkt albo tryb testowy już są).
  const finderError = parcel || point || test ? '' : error;
  const submitError = finderError ? '' : error;

  const finder = <>
    <Field label="Numer działki lub obręb">{(id) =>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          {/* lupa zamienia się w spinner na czas sprawdzania działki (także po kliknięciu mapy) */}
          <Input ref={finderInput} id={id} icon={searching ? <Spinner className="text-brand-600"/> : <Search/>}
            placeholder="np. Niedrzwica Kościelna 580/2" value={query} maxLength={80} autoComplete="off" spellCheck={false}
            enterKeyHint="search" disabled={disabled} data-autofocus
            onChange={(event) => { active.current?.abort(); setQuery(event.target.value); setParcel(null); setPoint(null); setCandidates([]); setError(''); setMessage(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }}/>
        </div>
        <Button variant="secondary" onClick={search} disabled={Boolean(busy)}>Szukaj</Button>
      </div>}
    </Field>
    {/* region statusu jest zawsze w drzewie, żeby czytnik ekranu ogłaszał każdą zmianę */}
    <div role="status">
      {status ? <p className="mt-2.5 text-[13px] leading-snug text-neutral-500"><TextStates text={status}/></p>
        : parcel ? <span className="sr-only">Wybrano działkę {parcel.number || parcel.id}.</span>
          : point ? <span className="sr-only">Wybrano punkt na mapie.</span> : null}
    </div>
    {finderError && <Callout tone="danger" role="alert" className="mt-3">{finderError}</Callout>}
    {candidates.length > 0 && <ul aria-label="Znalezione działki" className={cn(
      'mt-2 max-h-[min(19rem,42vh)] overflow-y-auto overscroll-contain rounded-xl border border-black/[0.08] bg-white p-1 shadow-hairline',
      'animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out motion-reduce:[--tw-enter-translate-y:0]')}>
      {candidates.map((item) => <li key={item.id}>
        <button type="button" onClick={() => request('search', (signal) => getParcel(item.id, signal))}
          className={'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-[background-color,scale] duration-150 ease-out '
            + 'hover:bg-black/[0.035] active:scale-[0.99] motion-reduce:active:scale-100'}>
          <span className="min-w-0 flex-1">
            <span className="num block text-[14px] font-semibold text-neutral-900">{item.number || item.id}</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-neutral-500">{[describe(item), item.id].filter(Boolean).join(' · ')}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-neutral-300"/>
        </button>
      </li>)}
    </ul>}
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
  </>;

  const details = <>
    <CropPicker crops={crops} error={cropsError} value={crop} onChange={setCrop} disabled={disabled}/>
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <Field label="Data analizy" required hint="Dziś lub do 10 lat wstecz">{(id, describedBy) =>
        <Input id={id} aria-describedby={describedBy} type="date" icon={<Calendar className="relative z-10"/>} required value={date}
          min={oldestDate()} max={today()} disabled={disabled} className={DATE_INPUT}
          onChange={(event) => setDate(event.target.value)}/>}
      </Field>
      <Field label={<>Nazwa pola <span className="font-normal text-neutral-400">(opcjonalnie)</span></>}>{(id) =>
        <Input id={id} value={name} maxLength={80} disabled={disabled} placeholder="np. Pod lasem"
          onChange={(event) => setName(event.target.value)}/>}
      </Field>
    </div>
    {TEST_AVAILABLE && <div className="rounded-xl border border-dashed border-black/[0.14] px-3.5 py-3">
      <Switch checked={test} onCheckedChange={setTest} disabled={disabled} label="Tryb testowy (obrys testowy, dane na żywo)"/>
    </div>}
  </>;

  // Stopka przyklejona do dołu okna (na telefonie dołu arkusza). Ujemne marginesy znoszą p-6 okna (dialog.jsx), więc pasek
  // z włosową linią sięga krawędzi; -bottom-6, bo przyklejenie liczy się od krawędzi treści okna (bez jego paddingu).
  // Na dole margines bezpieczny iPhone'a.
  const footer = <div className={cn('sticky -bottom-6 z-20 -mx-6 -mb-6 mt-8 flex flex-col gap-3 border-t border-black/[0.07] bg-white/92 px-6 pt-4',
    'pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:flex-row lg:items-center lg:gap-6 lg:py-5')}>
    <p role="status" className="sr-only">{busy === 'report' ? REPORT_BUSY : ''}</p>
    {submitError && <Callout tone="danger" role="alert" className="lg:flex-1">{submitError}</Callout>}
    {/* bez udawanych etapów: animacja i licznik czasu, który upłynął (licznik nie łamie się w wąskim pasku) */}
    {busy === 'report' && <div aria-hidden className="min-w-0 lg:flex-1">
      <LoadingState label={REPORT_BUSY} className="[&>span:last-child]:shrink-0 [&>span:last-child]:whitespace-nowrap"/>
    </div>}
    <div className="flex gap-2 lg:ml-auto">
      {onCancel && <Button variant="secondary" size="lg" className="px-4" onClick={onCancel}>Anuluj</Button>}
      <Button type="submit" size="lg" iconRight={<ArrowRight/>} className="flex-1 px-4 sm:px-5 lg:flex-none"
        disabled={Boolean(busy) || !(parcel || point || test) || !crop}>Sprawdź wodę na polu</Button>
    </div>
  </div>;

  // Komputer: formularz po lewej (5/12), mapa po prawej (7/12, przyklejona przy przewijaniu okna).
  // Telefon: mapa zaraz po wyszukiwarce (żeby dało się stuknąć pole), dopiero potem uprawa i data.
  return <form ref={form} onSubmit={submit} className="mt-5 lg:mt-1">
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-12 lg:grid-rows-[auto_1fr]">
      <div className="min-w-0 lg:col-span-5 lg:col-start-1 lg:row-start-1">{finder}</div>
      <div className="min-w-0 lg:sticky lg:top-0 lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1 lg:self-start">
        <ParcelMap parcel={parcel} point={point} onPick={pick}/>
      </div>
      <div className="min-w-0 space-y-6 lg:col-span-5 lg:col-start-1 lg:row-start-2">{details}</div>
    </div>
    {footer}
  </form>;
}
