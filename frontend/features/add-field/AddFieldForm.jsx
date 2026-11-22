import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Calendar, Check, Sprout, Wheat } from 'lucide-react';
import { oldestDate, today } from '@/shared/format/date';
import { Button } from '@/shared/ui/button';
import { Callout } from '@/shared/ui/callout';
import { Field, Input } from '@/shared/ui/field';
import { cn } from '@/shared/lib/cn';
import { fieldInput, sameReportInputs } from '@/features/fields/logic';
import { CropPicker } from './CropPicker.jsx';
import { DateField, SeasonTimeline } from './DateFields.jsx';
import { errorText, submitLabel, timelineErrors, usesTimeline } from './logic.js';
import { ParcelFinder, PlaceGuide } from './ParcelFinder.jsx';
import { isReady } from './parcelSelection.js';
import { StepHeader, STEPS } from './StepHeader.jsx';
import { useCrops } from './useCrops.js';
import { useParcelLookup } from './useParcelLookup.js';

const TEST_AVAILABLE = new URLSearchParams(window.location.search).has('test');
const TEST_POINT = { lat: 52.0, lon: 19.0 };   // gdy w trybie testowym nie wskazano miejsca
const SAVING = 'Zapisuję pole…';
// telefon w pionie: po znalezieniu adresu przewijamy okno do mapy
const PHONE = '(max-width: 639px)';

/** Po zmianie kroku: okno na górę i fokus na tytuł kroku (czytnik ekranu ogłasza nowy krok). */
function useStepFocus(step, stepHeading) {
  const previousStep = useRef(0);
  useLayoutEffect(() => {
    if (step === previousStep.current) return;
    previousStep.current = step;
    const dialog = stepHeading.current?.closest('[role="dialog"]');
    if (dialog) dialog.scrollTop = 0;
    stepHeading.current?.focus({ preventScroll: true });
  }, [step, stepHeading]);
}

/** Na telefonie po znalezieniu adresu mapa wjeżdża na górę okna i dostaje fokus. */
function useScrollToMap(location, mapPanel) {
  useLayoutEffect(() => {
    if (!location || !window.matchMedia(PHONE).matches) return;
    const panel = mapPanel.current;
    const dialog = panel?.closest('[role="dialog"]');
    if (!dialog) return;
    panel.querySelector('.map-canvas')?.focus({ preventScroll: true });
    dialog.scrollTop += panel.getBoundingClientRect().top - dialog.getBoundingClientRect().top - 16;
  }, [location, mapPanel]);
}

/**
 * Wybór działki i konfiguracja uprawy w dwóch krokach. Wstecz zachowuje wprowadzone dane.
 * Mapę do wskazania działki daje aplikacja (`renderMap`), bo należy do funkcji mapy.
 */
export function AddFieldForm({ initial, fields, onCancel, onSubmit, renderMap }) {
  const form = useRef(null);
  const finderInput = useRef(null);
  const mapPanel = useRef(null);
  const stepHeading = useRef(null);
  const hadCandidates = useRef(false);
  const input = initial?.input ?? initial?.report?.request;
  const [error, setError] = useState('');   // błąd zapisu pola
  const [busy, setBusy] = useState('');
  const lookup = useParcelLookup(initial, {
    onLookup: () => { setError(''); setBusy(''); },
    onEdit: () => setError(''),
  });
  const { selection } = lookup;
  const { parcel, savedParcelId, point, location, candidates, problem } = selection;
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(null);
  const [name, setName] = useState(initial?.name ?? '');
  const [crop, setCrop] = useState(input?.crop ?? null);
  const [date, setDate] = useState(input?.date ?? today());   // brak daty = pole „na dziś”
  const [sowingDate, setSowingDate] = useState(input?.sowing_date ?? '');
  const [harvestDate, setHarvestDate] = useState(input?.harvest_date ?? '');
  const [nextSowingDate, setNextSowingDate] = useState(input?.next_sowing_date ?? '');
  const [test, setTest] = useState(Boolean(input?.test));
  const { crops, error: cropsError } = useCrops();

  useStepFocus(step, stepHeading);
  useScrollToMap(location, mapPanel);

  // Działka wybrana z listy zamyka listę razem z przyciskiem, który miał fokus: wtedy wracamy do pola wyszukiwania.
  useEffect(() => {
    if (hadCandidates.current && !candidates.length && !form.current?.contains(document.activeElement)) finderInput.current?.focus();
    hadCandidates.current = candidates.length > 0;
  }, [candidates]);

  const disabled = busy === 'saving';
  const pick = (next) => { if (!disabled) lookup.pick(next); };
  const ready = isReady(selection) || test;
  const where = test ? { parcel: null, point: parcel?.centroid ?? point ?? TEST_POINT }
    : { parcel: parcel ?? (savedParcelId ? { id: savedParcelId } : null), point };
  const withTimeline = usesTimeline(crop);
  const timeline = withTimeline ? { sowing_date: sowingDate, harvest_date: harvestDate, next_sowing_date: nextSowingDate } : {};
  const { harvest: harvestError, nextSowing: nextSowingError } = timelineErrors({ crop, sowingDate, harvestDate, nextSowingDate });
  const values = { name, crop, date, test, ...where, ...timeline };
  const sameInputs = Boolean(ready && sameReportInputs(initial, values));
  const renameOnly = sameInputs && name.trim() !== initial.name;
  const lastStep = step === STEPS.length - 1;
  const searching = selection.checking;

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
    const controller = lookup.takeOver();
    setError('');
    setBusy('saving');
    onSubmit(fieldInput(values), controller.signal)
      .catch((err) => { if (!controller.signal.aborted) setError(errorText(err)); })
      .finally(() => { if (lookup.active.current === controller) setBusy(''); });
  }

  const timelineFields = [
    { label: crop === 'potato' ? 'Sadzenie' : 'Siew', value: sowingDate, onChange: setSowingDate, icon: Sprout },
    { label: 'Zbiór', value: harvestDate, onChange: setHarvestDate, error: harvestError, icon: Wheat },
    { label: 'Kolejny siew lub sadzenie', value: nextSowingDate, onChange: setNextSowingDate, error: nextSowingError, icon: Calendar },
  ];

  const footer = <div className={cn('sticky -bottom-6 z-20 -mx-6 -mb-6 mt-7 flex flex-col gap-3 border-t border-border bg-background/95 px-6 pt-4',
    'pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:flex-row sm:items-center sm:gap-6 sm:py-4')}>
    <p role="status" className="sr-only">{busy === 'saving' ? SAVING : ''}</p>
    {error && <Callout tone="danger" role="alert" className="lg:flex-1">{error}</Callout>}
    {!error && lastStep && <p className="hidden text-[13px] leading-snug text-neutral-500 sm:block sm:flex-1">
      Po zapisie raport policzy się w tle.</p>}
    <div className="flex gap-2 sm:ml-auto">
      {step > 0 ? <Button variant="secondary" size="lg" className="px-4" icon={<ArrowLeft/>} disabled={disabled}
        onClick={() => goTo(step - 1)}>Wstecz</Button>
        : onCancel && <Button variant="secondary" size="lg" className="px-4" onClick={onCancel}>Anuluj</Button>}
      <Button type="submit" size="lg" iconRight={lastStep ? <Check/> : <ArrowRight/>} className="flex-1 px-4 sm:flex-none sm:px-5"
        loading={disabled} disabled={searching || !ready || (step > 0 && !crop) || (lastStep && Boolean(harvestError || nextSowingError))}>
        {lastStep ? submitLabel({ editing: Boolean(initial), renameOnly, sameInputs }) : 'Dalej'}
      </Button>
    </div>
  </div>;

  return <form ref={form} onSubmit={submit} className="mt-4 lg:mt-0">
    <StepHeader ref={stepHeading} step={step} direction={direction}/>
    <div key={step} className={cn(direction && 'animate-in fade-in-0 duration-200 ease-[var(--ease-out)] motion-reduce:animate-none',
      direction === 'forward' && 'slide-in-from-right-2', direction === 'back' && 'slide-in-from-left-2')}>
      {step === 0 && <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="surface flex min-w-0 flex-col p-4 sm:p-5">
          {/* problem z działką stoi przy wyszukiwarce (brak działki spokojniej niż błąd usługi); błąd zapisu przy przycisku */}
          <div><ParcelFinder lookup={lookup} inputRef={finderInput} disabled={disabled} problem={test ? null : problem}
            testAvailable={TEST_AVAILABLE} test={test} onTest={setTest}/></div>
          <PlaceGuide found={Boolean(location || parcel || point || savedParcelId)} chosen={Boolean(parcel || point || savedParcelId)}/>
        </div>
        {/* jedna wysokość mapy przed i po wyszukaniu adresu, żeby przejście FieldsMap → ParcelMap nie skakało */}
        <div ref={mapPanel} className="min-w-0 [&_.map-canvas]:h-[clamp(300px,56vh,540px)]">
          {renderMap({ location, parcel, point, fields, onPick: pick })}
        </div>
      </div>}
      {lastStep && <div className="grid gap-4">
        <div className="surface min-w-0 p-4 sm:p-5">
          <CropPicker crops={crops} error={cropsError} value={crop} onChange={setCrop} disabled={disabled}/>
        </div>
        {withTimeline && <SeasonTimeline fields={timelineFields} referenceDate={date} disabled={disabled}/>}
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
