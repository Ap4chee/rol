import { RefreshCw } from 'lucide-react';
import { ParcelMap } from './ParcelMap.jsx';
import { dateText } from '@/shared/format/date';
import { number } from '@/shared/format/number';
import { Note, Paragraphs } from '@/shared/ui/note';
import { CauseList } from '@/shared/ui/cause-list';
import { Explanation, Section } from '@/shared/ui/section';
import { SkeletonReveal } from '@/shared/ui/effects';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/shared/ui/accordion';
import { Button } from '@/shared/ui/button';
import { Callout } from '@/shared/ui/callout';
import { Spinner } from '@/shared/ui/spinner';
import { measure, Stat, StatGrid, wrapping } from '@/shared/ui/stat';
import { Caption, Table, TBody, TD, TH, THead, TR } from '@/shared/ui/table';

const LAND_USE_COLUMNS = { 1: 'grid-cols-1 md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'grid-cols-3 md:grid-cols-3' };
const SLOPE_LABELS = ['Średni spadek', 'Najbardziej strome 10%'];
// Komórki liczb: etykieta może zająć dwie linie (wąska kolumna obok mapy), liczby i tak stoją w jednej linii na dole.
const SLOPE_CELLS = 'md:grid-cols-2 [&>*]:flex [&>*]:flex-col [&>*]:justify-between [&>*]:gap-1';

/** Zakładka „Teren i woda”: mapa z drogami spływu, spadki i przyczyny z terenu, użytkowanie terenu, rzeki w okolicy. */
export function TerrainTab({ report, terrain, control }) {
  const hydro = report.hydrology;
  const pending = terrain?.status === 'pending';
  const causes = terrain?.causes ?? [];
  const details = terrain?.text ?? [];
  return <div className="flex flex-col gap-14">
    <div className="grid gap-12 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-7">
        <ParcelMap parcel={report.parcel} point={report.parcel ? null : report.request.point} terrain={terrain}/>
      </div>
      <Section title="Ukształtowanie i spływ" className="lg:col-span-5">
        {/* wydruk z przycisku czeka (do limitu), aż teren się policzy, zamiast drukować szkielet */}
        <div className="flex flex-col gap-4" data-print-pending={pending && !control.failed ? '' : undefined}>
          <Note section={terrain} className="my-0"/>
          {(pending || terrain?.status === 'ok') && <SlopeStats terrain={terrain} pending={pending}/>}
          {pending && <p role="status" className="flex items-start gap-2 text-[13px] text-neutral-500">
            <Spinner className="mt-px size-3.5 shrink-0"/>
            <span>Liczę spadki i drogi spływu z modelu terenu (zwykle <span className="whitespace-nowrap">15–60 s</span>)…</span>
          </p>}
          {(causes.length > 0 || details.length > 0) && <div>
            {causes.length > 0 && <CauseList causes={causes}/>}
            {details.length > 0 && <Accordion type="single" collapsible className={causes.length > 0 ? 'border-t border-black/[0.07]' : undefined}>
              <AccordionItem value="details">
                <AccordionTrigger className="py-3.5 text-[14px]">Szczegóły spływu</AccordionTrigger>
                <AccordionContent className="max-w-[72ch] text-[13.5px]"><Paragraphs lines={details}/></AccordionContent>
              </AccordionItem>
            </Accordion>}
          </div>}
          {/* ponów także, gdy serwer odpowiedział błędem źródła (np. WCS GUGiK nie odpowiedział): błędy nie trafiają do pamięci podręcznej */}
          {(control.failed || terrain?.status === 'error') && control.canRetry ? <Button className="no-print self-start" variant="secondary" size="sm"
            icon={<RefreshCw/>} onClick={control.retry}>Ponów pobieranie terenu</Button> : null}
        </div>
      </Section>
    </div>
    {/* raporty zapisane przed dodaniem tego źródła nie mają pola land_use */}
    {report.land_use && <Section title="Użytkowanie terenu"
      lead="Co mapa pokrycia terenu pokazuje na działce i czy zgadza się to z wybraną uprawą.">
      <Note section={report.land_use}/>
      {report.land_use.status === 'ok' && <LandUse use={report.land_use}/>}
    </Section>}
    <Section title="Rzeki w okolicy" lead="Najbliższy wodowskaz IMGW-PIB: czy susza dotyczy też wód w okolicy pola.">
      <Note section={hydro}/>
      {hydro.status === 'ok' ? <Rivers hydro={hydro}/> : <Explanation lines={hydro.text}/>}
    </Section>
  </div>;
}

/** Spadki terenu. Teren liczy się osobno (15–60 s), więc do czasu wyniku stoi szkielet tej samej wielkości. */
function SlopeStats({ terrain, pending }) {
  const skeleton = <StatGrid className={SLOPE_CELLS}>{SLOPE_LABELS.map((label) => <div key={label}>
    <p className="text-[13px] text-neutral-500">{label}</p>
    <span className="mt-1 block h-6 w-20 animate-pulse rounded-md bg-black/[0.06] motion-reduce:animate-none"/>
  </div>)}</StatGrid>;
  return <SkeletonReveal loading={pending} skeleton={skeleton} pulseCount={0} revealDuration={300}>
    <StatGrid className={SLOPE_CELLS}>
      <Stat label={wrapping(SLOPE_LABELS[0])} value={pending ? '—' : measure(number(terrain.slope_mean_pct, 1), '%')}/>
      <Stat label={wrapping(SLOPE_LABELS[1])} value={pending ? '—' : <>
        <span className="font-normal text-neutral-400">&gt;&nbsp;</span>{measure(number(terrain.slope_p90_pct, 1), '%')}</>}/>
    </StatGrid>
  </SkeletonReveal>;
}

/** Udziały klas pokrycia terenu na działce (ESA WorldCover) i wniosek policzony na serwerze. */
function LandUse({ use }) {
  const major = use.classes.filter((item) => item.share_pct >= 5).slice(0, 3);
  const shown = major.length ? major : use.classes.slice(0, 1);
  // zdania z serwera: [udziały, (mało pikseli), wniosek, zastrzeżenie o mapie]; udziały są już w liczbach wyżej
  const lines = use.text.slice(1);
  const verdict = lines.length > 1 ? lines[lines.length - 2] : null;
  const warn = use.verdict === 'not_farmland' || use.verdict === 'partly_other' || use.crop_matches === false;
  return <>
    {/* tyle kolumn, ile klas: przy jednej klasie pusta część siatki zostawała szara */}
    <StatGrid className={LAND_USE_COLUMNS[shown.length]}>
      {shown.map((item) => <Stat key={item.key}
        label={wrapping(item.label.charAt(0).toUpperCase() + item.label.slice(1))} value={measure(number(item.share_pct), '%')}/>)}
    </StatGrid>
    {warn && verdict && <Callout tone="warning" className="mt-5 max-w-[76ch]">{verdict}</Callout>}
    <Explanation lines={warn ? lines.filter((line) => line !== verdict) : lines}/>
  </>;
}

/** Najbliższy wodowskaz IMGW-PIB: stan teraz na tle tych samych dni w poprzednich latach. */
function Rivers({ hydro }) {
  const flow = hydro.metric === 'flow';
  const digits = flow ? 2 : 0;
  const compared = Number.isFinite(hydro.years_higher) && Number.isFinite(hydro.years_compared);
  return <>
    <StatGrid className="md:grid-cols-3">
      <Stat className="col-span-2 md:col-span-1" size="sm" label="Wodowskaz" value={hydro.station_name ?? '—'}
        hint={[hydro.river, `${number(hydro.station_distance_km)} km`].filter(Boolean).join(' · ')}/>
      <Stat label={flow ? 'Przepływ teraz' : 'Stan wody teraz'} value={measure(number(hydro.current_value, digits), hydro.unit ?? '')}
        hint={`zwykle ${number(hydro.median_value, digits)} ${hydro.unit ?? ''}`}/>
      <Stat size="sm" label="Na tle 10 lat" value={<span className="block leading-snug">{hydro.class_label ?? '—'}</span>}
        hint={compared ? `więcej wody było w ${hydro.years_higher} z ${hydro.years_compared} lat` : null}/>
    </StatGrid>
    <Explanation lines={hydro.text}/>
    {hydro.years?.length > 0 && <Accordion type="single" collapsible className="mt-4 border-y border-black/[0.07]">
      <AccordionItem value="years">
        <AccordionTrigger className="py-3.5 text-[14px]">Pomiary z 10 lat</AccordionTrigger>
        <AccordionContent><HydrologyTable hydro={hydro}/></AccordionContent>
      </AccordionItem>
    </Accordion>}
  </>;
}

/** Średnie z tych samych 7 dni w kolejnych latach; ostatni wiersz (pogrubiony) to stan teraz. */
function HydrologyTable({ hydro }) {
  const label = hydro.metric === 'flow' ? 'Przepływ' : 'Stan wody';
  const digits = hydro.metric === 'flow' ? (hydro.median_value < 10 ? 2 : 1) : 0;
  return <Table className="max-w-[620px]">
    <Caption>{label} na wodowskazie {hydro.station_name}{hydro.river ? ` · ${hydro.river}` : ''} · IMGW-PIB, dane przetworzone</Caption>
    <THead><TR><TH>Rok lub okres</TH><TH className="text-right">{label}</TH></TR></THead>
    <TBody>
      {hydro.years.map(({ year, value }) => <TR key={year}>
        <TD>{year} · średnia z 7 dni</TD>
        <TD className="num whitespace-nowrap text-right">{number(value, digits)} {hydro.unit}</TD>
      </TR>)}
      <TR className="font-semibold text-neutral-900">
        <TD>{hydro.origin === 'live' ? 'Pomiar' : '7 dni do'} {dateText(hydro.current_to)}</TD>
        <TD className="text-right">{number(hydro.current_value, digits)} {hydro.unit} · {hydro.class_label}</TD>
      </TR>
    </TBody>
  </Table>;
}
