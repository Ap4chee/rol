// Treść zakładek raportu. Składamy ją tutaj, bo zakładki należą do różnych funkcji (raport, gleba, pogoda, teren,
// prace polowe), a funkcje nie importują się nawzajem. `ctx` przygotowuje Report (features/report/Report.jsx).
import { FieldworkTab } from '@/features/fieldwork/FieldworkTab';
import { TerrainTab } from '@/features/map/TerrainTab';
import { HistoryTab } from '@/features/report/HistoryTab';
import { Recommendations } from '@/features/report/Recommendations';
import { SourcesTab } from '@/features/report/SourcesTab';
import { Summary } from '@/features/report/Summary';
import { SoilTab } from '@/features/soil/SoilTab';
import { WeatherTab } from '@/features/weather/WeatherTab';

export const REPORT_TABS = {
  podsumowanie: (ctx) => <Summary report={ctx.report} terrain={ctx.terrain} satellite={ctx.satellite} sat={ctx.sat}
    limited={ctx.limited} onTab={ctx.onTab} printing={ctx.printing} intro={ctx.intro('podsumowanie')}/>,
  rekomendacje: (ctx) => <Recommendations report={ctx.report} terrainActions={ctx.terrainActions}
    printing={ctx.printing} intro={ctx.intro('rekomendacje')}/>,
  prace: (ctx) => <FieldworkTab report={ctx.report}/>,
  gleba: (ctx) => <SoilTab report={ctx.report} printing={ctx.printing} intro={ctx.intro('gleba')}/>,
  pogoda: (ctx) => <WeatherTab report={ctx.report}/>,
  teren: (ctx) => <TerrainTab report={ctx.report} terrain={ctx.terrain} control={ctx.topo}/>,
  historia: (ctx) => <HistoryTab report={ctx.report} intro={ctx.intro('historia')}/>,
  zrodla: (ctx) => <SourcesTab report={ctx.report}/>,
};
