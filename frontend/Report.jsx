import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Printer, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toaster';
import { TextStates } from '@/components/spectrumui/text-states';
import { usePrinting } from '@/lib/printing';
import { cn } from '@/lib/utils';
import { CropTile, TILE } from './Dashboard.jsx';
import { ParcelOutline, Status } from './ui.jsx';
import { dateText, number, TABS } from './model.js';
import { HistoryTab } from './report/HistoryTab.jsx';
import { GROUPS, groupActions, Recommendations } from './report/Recommendations.jsx';
import { PRINT_ORDER, TAB_LABELS } from './report/shared.jsx';
import { SoilTab } from './report/SoilTab.jsx';
import { SourcesTab } from './report/SourcesTab.jsx';
import { Summary } from './report/Summary.jsx';
import { TerrainTab } from './report/TerrainTab.jsx';
import { WeatherTab } from './report/WeatherTab.jsx';
import { useReportCompletion } from './report/useCompletion.js';

const SAVE_LABELS = ['Zapisz pole', 'Zapisz', 'Zapisano'];
const SAVED_FEEDBACK_MS = 1800;

/** Ikona zapisu zamienia się w „ptaszek” na chwilę po zapisaniu (krótko, z rozmyciem zamiast skoku). */
function SaveIcon({ done }) {
  const swap = 'absolute inset-0 transition-[opacity,scale,filter] duration-200 ease-out motion-reduce:transition-opacity';
  return <span aria-hidden className="relative size-4 shrink-0">
    <Save className={cn(swap, done && 'scale-75 opacity-0 blur-[2px]')}/>
    <Check className={cn(swap, !done && 'scale-75 opacity-0 blur-[2px]')} strokeWidth={2.5}/>
  </span>;
}

/** Widok pola: nagłówek z działaniami i zakładki raportu; przy drukowaniu wszystkie części jedna pod drugą. */
export function Report({ field, tab, onTab, onSave, onEdit, onSatellite, saved }) {
  const title = useRef(null);
  const tabs = useRef(null);
  const printing = usePrinting();
  const { toast } = useToast();
  // jedna wersja raportu z dociągniętymi zdjęciami i terenem: ekran, wydruk i zapis widzą to samo
  const settleSatellite = useCallback((result) => onSatellite(field.id, field.report.generated_at, result),
    [field.id, field.report.generated_at, onSatellite]);
  const { report, satellite: sat, terrain: topo } = useReportCompletion(field.report, settleSatellite);
  const { satellite, terrain } = report;
  const terrainActions = terrain.recommendations ?? [];
  const water = report.water_status;
  const limited = water.spans_classes || water.soil_assumed;
  const recCount = GROUPS.reduce((count, group) => count + groupActions(report.recommendations, terrainActions, group.key).length, 0);
  const [justSaved, setJustSaved] = useState(false);
  // wejście treści tylko przy pierwszym pokazaniu raportu; przełączanie zakładek jest bez animacji
  const [firstTab] = useState(tab);
  const [switched, setSwitched] = useState(false);
  const intro = (key) => !switched && !printing && key === firstTab;

  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (tab !== firstTab) setSwitched(true); }, [tab, firstTab]);
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), SAVED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [justSaved]);

  function save() {
    if (!onSave(field)) return;
    setJustSaved(true);
    toast({ title: 'Raport zapisany w tej przeglądarce.', status: 'success' });
  }

  /** Zmiana zakładki; gdy pasek zakładek jest przyklejony, treść zaczyna się od góry, a nie w połowie. */
  function openTab(next) {
    if (!next || next === tab) return;
    onTab(next);
    const node = tabs.current;
    if (!node) return;
    const offset = parseFloat(getComputedStyle(node).scrollMarginTop) || 0;
    if (node.getBoundingClientRect().top < offset) node.scrollIntoView({ block: 'start' });
  }

  const panels = {
    podsumowanie: () => <Summary report={report} terrain={terrain} satellite={satellite} sat={sat} limited={limited}
      onTab={openTab} printing={printing} intro={intro('podsumowanie')}/>,
    rekomendacje: () => <Recommendations report={report} terrainActions={terrainActions}
      intro={intro('rekomendacje')}/>,
    gleba: () => <SoilTab report={report} printing={printing} intro={intro('gleba')}/>,
    pogoda: () => <WeatherTab report={report}/>,
    teren: () => <TerrainTab report={report} terrain={terrain} control={topo}/>,
    historia: () => <HistoryTab report={report} intro={intro('historia')}/>,
    zrodla: () => <SourcesTab report={report}/>,
  };
  const parcel = report.parcel;
  // numer i obręb zamiast identyfikatora EGiB (pełny identyfikator jest w zakładce Źródła)
  const parcelText = parcel?.number ? [`działka ${parcel.number}`, parcel.region && `obręb ${parcel.region}`].filter(Boolean).join(', ')
    : parcel?.id ?? 'wskazany punkt';
  const facts = [
    { text: report.crop.name },
    parcel?.area_ha != null && { text: `${number(parcel.area_ha, 2)} ha` },
    { text: parcelText, wrap: true },
    { text: `stan na ${dateText(report.analysis_date)}` },
  ].filter(Boolean);
  const saveLabel = justSaved ? 'Zapisano' : saved ? 'Zapisz' : 'Zapisz pole';

  return <article className="min-w-0">
    <header className="mb-7 flex animate-rise flex-col gap-5 motion-reduce:animate-none md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 items-center gap-4">
      {/* pole rolnika na pierwszy rzut oka: uprawa i kształt działki z geometrii */}
      <div className="flex shrink-0 gap-1.5">
        <CropTile crop={report.crop} className="size-12 md:size-14"/>
        <ParcelOutline geometry={parcel?.geometry} className={cn(TILE, 'size-12 p-1 md:size-14')}/>
      </div>
      <div className="min-w-0">
        {/* kropka sklejona twardą spacją z poprzednim faktem: zawinięty wiersz nigdy nie zaczyna się od „·” */}
        <p className="text-[13px] leading-relaxed text-neutral-500">
          {facts.map((fact, i) => <Fragment key={i}>
            {i > 0 && <span aria-hidden className="text-neutral-300">{' · '}</span>}
            <span className={fact.wrap ? undefined : 'whitespace-nowrap'}>{fact.text}</span>
          </Fragment>)}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
          {/* fokus tylko przenosi czytnik ekranu na tytuł po otwarciu raportu (tabIndex -1, poza kolejnością Tab), więc bez ramki */}
          <h1 ref={title} tabIndex={-1} className="font-display text-[28px] font-semibold leading-[1.05] tracking-tight outline-none md:text-[34px]">
            {field.name}</h1>
          <Status water={water}/>
        </div>
      </div>
      </div>
      <div className="no-print flex shrink-0 items-center gap-2">
        <Button variant="secondary" icon={<RefreshCw/>} onClick={onEdit} className="max-sm:w-10 max-sm:px-0">
          <span className="max-sm:sr-only">Przelicz</span></Button>
        <Button variant="secondary" icon={<Printer/>} onClick={() => window.print()} className="max-sm:w-10 max-sm:px-0">
          <span className="max-sm:sr-only">PDF</span></Button>
        <Button onClick={save} className="max-sm:flex-1">
          {/* miejsce na najdłuższy napis: przycisk nie zmienia szerokości przy „Zapisano”, ikona zostaje przy tekście */}
          <span className="grid justify-items-center">
            {SAVE_LABELS.map((label) => <span key={label} aria-hidden className="invisible col-start-1 row-start-1 flex items-center gap-2">
              <span className="size-4"/>{label}</span>)}
            <span className="col-start-1 row-start-1 flex items-center gap-2"><SaveIcon done={justSaved}/><TextStates text={saveLabel}/></span>
          </span>
        </Button>
      </div>
    </header>

    {printing
      ? <div className="space-y-12">{PRINT_ORDER.map((key) => <section key={key} className="print-part">
        <h2 className="print-only mb-6 border-b border-neutral-300 pb-2 text-[24px] font-semibold">{TAB_LABELS[key]}</h2>
        {panels[key]()}
      </section>)}</div>
      : <Tabs ref={tabs} value={tab} onValueChange={openTab} className="scroll-mt-[var(--app-header,0px)]">
        {/* na telefonie pasek do krawędzi ekranu: zakładki nie urywają się 16 px przed krawędzią */}
        <div className="no-print sticky top-[var(--app-header,0px)] z-20 border-b border-black/[0.07] bg-white max-md:-mx-4">
          <TabsList value={tab} aria-label="Części raportu" className="-mb-px max-md:scroll-px-4 max-md:px-4">
            {TABS.map((key) => <TabsTrigger key={key} value={key} count={key === 'rekomendacje' ? recCount : undefined}>
              {TAB_LABELS[key]}</TabsTrigger>)}
          </TabsList>
        </div>
        {TABS.map((key) => <TabsContent key={key} value={key} className="rounded-lg pt-8">{panels[key]()}</TabsContent>)}
      </Tabs>}
  </article>;
}
