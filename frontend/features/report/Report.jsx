import { useCallback, useEffect, useRef, useState } from 'react';
import { TABS } from '@/app/router';
import { usePrinting } from '@/shared/lib/printing';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { actionCount } from './logic.js';
import { ReportHeader } from './ReportHeader.jsx';
import { PRINT_ORDER, TAB_LABELS } from './tabs.js';
import { useReportCompletion } from './useCompletion.js';

/**
 * Widok pola: nagłówek z działaniami i zakładki raportu; przy drukowaniu wszystkie części jedna pod drugą.
 * `tabs` to treść zakładek (klucz → funkcja rysująca z kontekstem raportu). Składa je aplikacja, bo część zakładek
 * (gleba, pogoda, teren, prace) należy do innych funkcji.
 */
export function Report({ field, tab, tabs, onTab, onSave, onEdit, onDelete, onSatellite, onBack, saved }) {
  const tabBar = useRef(null);
  const printing = usePrinting();
  // jedna wersja raportu z dociągniętymi zdjęciami i terenem: ekran, wydruk i zapis widzą to samo
  const settleSatellite = useCallback((result) => onSatellite(field.id, field.report.generated_at, result),
    [field.id, field.report.generated_at, onSatellite]);
  const { report, satellite: sat, terrain: topo } = useReportCompletion(field.report, settleSatellite);
  const { satellite, terrain } = report;
  const terrainActions = terrain.recommendations ?? [];
  const water = report.water_status;
  // wejście treści tylko przy pierwszym pokazaniu raportu; przełączanie zakładek jest bez animacji
  const [firstTab] = useState(tab);
  const [switched, setSwitched] = useState(false);
  const intro = (key) => !switched && !printing && key === firstTab;

  useEffect(() => { if (tab !== firstTab) setSwitched(true); }, [tab, firstTab]);

  /** Zmiana zakładki; gdy pasek zakładek jest przyklejony, treść zaczyna się od góry, a nie w połowie. */
  function openTab(next) {
    if (!next || next === tab) return;
    onTab(next);
    const node = tabBar.current;
    if (!node) return;
    const offset = parseFloat(getComputedStyle(node).scrollMarginTop) || 0;
    if (node.getBoundingClientRect().top < offset) node.scrollIntoView({ block: 'start' });
  }

  const context = { report, terrain, terrainActions, satellite, sat, topo, printing, intro, onTab: openTab,
    limited: water.spans_classes || water.soil_assumed };
  const panel = (key) => tabs[key](context);

  return <article className="min-w-0">
    <ReportHeader field={field} report={report} saved={saved} onSave={onSave} onEdit={onEdit} onDelete={onDelete} onBack={onBack}/>
    {printing
      ? <div className="space-y-12">{PRINT_ORDER.map((key) => <section key={key} className="print-part">
        <h2 className="print-only mb-6 border-b border-neutral-300 pb-2 text-[24px] font-semibold">{TAB_LABELS[key]}</h2>
        {panel(key)}
      </section>)}</div>
      : <Tabs ref={tabBar} value={tab} onValueChange={openTab} className="scroll-mt-[var(--app-header,0px)]">
        {/* na telefonie pasek do krawędzi ekranu: zakładki nie urywają się 16 px przed krawędzią */}
        <div data-tour="tabs" className="no-print sticky top-[var(--app-header,0px)] z-20 border-b border-black/[0.07] bg-white max-md:-mx-4">
          <TabsList value={tab} aria-label="Części raportu" className="-mb-px max-md:scroll-px-4 max-md:px-4">
            {TABS.map((key) => <TabsTrigger key={key} value={key}
              count={key === 'rekomendacje' ? actionCount(report.recommendations, terrainActions) : undefined}>
              {TAB_LABELS[key]}</TabsTrigger>)}
          </TabsList>
        </div>
        {/* data-tour-panel: samouczek podświetla pierwszą sekcję podsumowania (ocenę) */}
        {TABS.map((key) => <TabsContent key={key} value={key} data-tour-panel={key} className="rounded-lg pt-8">{panel(key)}</TabsContent>)}
      </Tabs>}
  </article>;
}
