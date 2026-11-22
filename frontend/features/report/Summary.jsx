import { ChevronRight } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { CauseList } from '@/shared/ui/cause-list';
import { Note } from '@/shared/ui/note';
import { Section } from '@/shared/ui/section';
import { Greenness } from './Greenness.jsx';
import { Irrigation } from './Recommendations.jsx';
import { TAB_LABELS } from './tabs.js';
import { Verdict } from './Verdict.jsx';
import { WaterReserve } from './WaterReserve.jsx';

/** Przyczyny niedoboru z raportu i z analizy terenu, ze skrótami do zakładek z liczbami. */
function Causes({ report, terrain, onTab }) {
  const causes = [...(report.causes.items ?? []), ...(terrain?.causes ?? [])];
  return <Section title="Dlaczego?" aside={<div className="no-print flex flex-wrap gap-1">
    {['pogoda', 'gleba', 'teren'].map((key) => <Button key={key} variant="ghost" size="xs" onClick={() => onTab(key)}
      iconRight={<ChevronRight aria-hidden className="-ml-1 text-neutral-400"/>}>{TAB_LABELS[key]}</Button>)}
  </div>}>
    <Note section={report.causes}/>
    {causes.length > 0 ? <CauseList causes={causes}/>
      : report.causes.status === 'ok' && <p className="text-[14px] leading-relaxed text-neutral-500">
        {report.causes.reason || 'Raport nie wskazuje wyraźnej przyczyny niedoboru.'}</p>}
  </Section>;
}

/**
 * Zakładka „Podsumowanie”: ocena, zapas wody z liczbami, przyczyny, zieloność roślin i (na końcu) nawadnianie.
 * Przy drukowaniu blok nawadniania trafia na koniec zakładki Rekomendacje, po retencji i agrotechnice.
 * `intro`: wejście (ocena, karty liczb) tylko przy pierwszym pokazaniu raportu, nie przy powrocie na zakładkę.
 */
export function Summary({ report, terrain, satellite, sat, limited, onTab, printing, intro = false }) {
  return <div className="flex flex-col gap-14">
    {/* bez modelu 3D i mapy: te są w zakładkach Gleba i Teren i woda, tu same informacje */}
    <Verdict report={report} terrain={terrain} limited={limited} onTab={onTab} intro={intro}/>
    <WaterReserve report={report} intro={intro}/>
    <div className="grid gap-14 md:grid-cols-12 md:gap-12">
      <div className="min-w-0 md:col-span-7"><Causes report={report} terrain={terrain} onTab={onTab}/></div>
      <div className="min-w-0 md:col-span-5"><Greenness satellite={satellite} failed={sat.failed} retry={sat.retry}
        canRetry={sat.canRetry} printing={printing}/></div>
    </div>
    {!printing && <Irrigation report={report} terrainActions={terrain?.recommendations ?? []} intro={intro}/>}
  </div>;
}
