import { useId, useState } from 'react';
import { Label, NativeSelect } from '@/shared/ui/field';
import { Segmented } from '@/shared/ui/segmented';
import { cn } from '@/shared/lib/cn';
import { ForecastDays } from './ForecastDays.jsx';
import { FORECAST_DAYS } from './logic.js';

/** Karta prognozy na pulpicie: prognoza dla jednego pola; przy kilku polach wybór pola (segmenty dla 2–3 krótkich nazw, inaczej lista). */
export function WeatherCard({ fields, className, style }) {
  const titleId = useId();
  const selectId = useId();
  const [selected, setSelected] = useState(null);
  const field = fields.find(({ id }) => id === selected) ?? fields[0];
  // segmenty muszą się zmieścić w wąskiej karcie (ok. 260 px), więc tylko przy krótkich nazwach
  const segmented = fields.length <= 3 && fields.every(({ name }) => name.length <= (fields.length === 2 ? 16 : 9));
  return <section aria-labelledby={titleId} className={cn('surface p-5', className)} style={style}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={titleId} className="font-sans text-[15px] font-semibold tracking-tight text-neutral-900">Prognoza pogody</h2>
      <span className="text-[12.5px] text-neutral-500">{`do ${FORECAST_DAYS} dni`}</span>
    </div>
    {fields.length > 1 && (segmented
      // na ekranach dotykowych segmenty mają co najmniej 40 px wysokości
      ? <Segmented className="mt-3 w-full" label="Pole, dla którego pokazać prognozę" value={field.id} onChange={setSelected}
        options={fields.map(({ id, name }) => ({ value: id, label: name }))}/>
      : <div className="mt-3 flex items-center gap-3">
        <Label htmlFor={selectId} className="mb-0 shrink-0 text-neutral-500">Dla pola</Label>
        <div className="min-w-0 flex-1">
          <NativeSelect id={selectId} value={field.id} onChange={(event) => setSelected(event.target.value)}>
            {fields.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </NativeSelect>
        </div>
      </div>)}
    <div className="mt-4"><ForecastDays position={field.report.parcel?.centroid ?? field.report.request.point}/></div>
  </section>;
}
