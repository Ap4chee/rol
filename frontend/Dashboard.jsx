import { useEffect, useState } from 'react';
import { actionItems, dateText, fieldHref, number, satelliteMeasurements, waterPercent } from './model.js';
import { api, Button, Icon, Meter, Note, Sparkline, Status } from './ui.jsx';

const cropImages = { maize: 'kukurydza', winter_wheat: 'pszenica', grassland: 'laka', potato: 'ziemniaki', sugar_beet: 'burak' };

export function EmptyDashboard({ onAdd }) {
  return <section className="empty-dashboard">
    <div className="empty-copy">
      <h1>Dodaj<br/>pierwsze pole</h1>
      <p>Wpisz numer działki lub wskaż ją na mapie.<br className="desktop-only"/> Zobaczysz pogodę i zapas wody w glebie.</p>
      <Button icon="plus" className="primary" onClick={onAdd}>Dodaj pole</Button>
    </div>
    <figure>
      <img src="/design/pierwsze-pole-ortofoto.jpg" alt="Pola uprawne widziane z góry, rozdzielone polną drogą" width="1120" height="1400" fetchPriority="high"/>
      <figcaption>Widok poglądowy pól</figcaption>
    </figure>
  </section>;
}

function Summary({ fields, field }) {
  const known = fields.filter((item) => item.report.water_status.status === 'ok' && item.report.water_status.class_key);
  const priority = known.filter((item) => ['moderate', 'severe'].includes(item.report.water_status.class_key)
    && item.report.water_status.in_season !== false);
  const report = field.report;
  const rain = report.causes.windows?.find((window) => window.days === 30);
  const balance = report.water_status.climatic_water_balance;
  const history = report.history;
  const measures = [
    [known.length ? `${priority.length} z ${known.length} ${known.length === 1 ? 'pola' : 'pól'}` : '—', 'Wymaga uwagi', 'alert', priority.length ? 'clay' : '',
      fields.length !== known.length ? `Brak oceny dla pozostałych pól: ${fields.length - known.length}` : 'Według ostatnio zapisanych analiz'],
    [rain ? `${number(rain.rain_mm)}${rain.rain_median_mm != null ? ' / ' + number(rain.rain_median_mm) : ''} mm` : '—',
      rain?.rain_median_mm != null ? 'Opad / mediana · 30 dni' : 'Opad · 30 dni', 'drop', 'blue'],
    [balance ? `${number(balance.balance_mm)} mm` : '—', balance ? `Bilans wodny · ${balance.days} dni` : 'Bilans wodny', 'wind', ''],
    [history.seasons_total ? `${history.seasons_with_stress} z ${history.seasons_total}` : '—', 'Sezony z niedoborem', 'calendar', 'gold'],
  ];
  return <>
    <section className="overview panel" aria-label="Podsumowanie gospodarstwa i wybranego pola">
      {measures.map(([value, label, icon, color, hint]) => <div key={label} className="overview-item">
        <strong className={color}>{value}</strong>
        <span><Icon name={icon} size={17}/>{label}</span>
        {hint && <small>{hint}</small>}
      </div>)}
    </section>
    <p className="overview-context"><Icon name="pin" size={16}/> Opad, bilans i sezony: <strong>{field.name}</strong> · raport z {dateText(report.analysis_date)}</p>
  </>;
}

function FieldList({ fields }) {
  return <section className="field-section" aria-labelledby="field-list-title">
    <div className="section-label"><h2 id="field-list-title">Moje pola</h2><small>Ostatnia zapisana analiza</small></div>
    <div className="field-table panel">
      <div className="field-row fields-head" aria-hidden="true"><span>Pole</span><span>Status suszy</span><span>Zapas wody</span><span>Zieloność</span><span/></div>
      <ul className="field-list">
        {fields.map((field) => {
          const { report } = field;
          const water = report.water_status;
          const measurements = satelliteMeasurements(report.satellite);
          return <li key={field.id}>
            <a href={fieldHref(field.id)} className={`field-row field-entry ${water.class_key ?? 'unknown'}`}>
              <div className="field-identity">
                {cropImages[report.crop.key] ? <img src={`/design/${cropImages[report.crop.key]}.png`} width="64" height="64" alt=""/>
                  : <span className="crop-icon"><Icon name="layers" size={28}/></span>}
                <div><h3>{field.name}</h3>
                  <p>{report.crop.name}{report.parcel?.area_ha != null && ` · ${number(report.parcel.area_ha, 2)} ha`}</p>
                  <code>{report.parcel?.id ?? report.request.parcel_id ?? 'Wskazany punkt'}</code>
                  <small>Stan na {dateText(report.analysis_date)}</small>
                </div>
              </div>
              <div className="row-status"><Status water={water}/></div>
              <div className="row-water"><small className="mobile-only">Zapas wody</small><Meter value={waterPercent(water.result)}/></div>
              <div className="row-satellite"><small className="mobile-only">Zieloność z satelity</small>
                {report.satellite?.status === 'pending' && !measurements.length
                  ? <span className="subtle">Uzupełnij w raporcie</span> :
                  <Sparkline values={measurements.map((s) => s.ndvi)} min={-1} max={1} label="Zieloność roślin w dostępnych obserwacjach"/>}</div>
              <span className="field-arrow"><Icon name="arrow" size={22}/></span>
            </a>
          </li>;
        })}
      </ul>
    </div>
  </section>;
}

function NextActions({ fields }) {
  const items = actionItems(fields);
  return <section aria-labelledby="actions-title">
    <h2 id="actions-title">Najbliższe działania</h2>
    <div className="panel actions-list">
      {items.length ? <ul>{items.map(({ field, action }) => <li key={field.id} className={field.report.water_status.class_key || 'unknown'}>
        <a href={fieldHref(field.id) + '#dzialania'}>
          <strong>{field.name}</strong><span>{action.title}</span><small>Analiza z {dateText(field.report.analysis_date)}</small>
        </a>
      </li>)}</ul> : <p className="empty-detail">Zapisane raporty nie zawierają propozycji działań.</p>}
    </div>
  </section>;
}

function weatherIcon(code) {
  if (code === 0) return ['sun', 'Bezchmurnie'];
  if (code === 1 || code === 2) return ['partial', 'Częściowe zachmurzenie'];
  if (code === 3) return ['cloudy', 'Zachmurzenie'];
  if (code === 45 || code === 48) return ['fog', 'Mgła'];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['snow', 'Śnieg'];
  if (code >= 95) return ['storm', 'Burza'];
  if (Number.isFinite(code) && code >= 51) return ['rain', 'Opad'];
  return ['alert', 'Brak danych'];
}

function Weather({ fields, field, onPick }) {
  const position = field.report.parcel?.centroid ?? field.report.request.point;
  const key = position ? new URLSearchParams(position).toString() : null;
  const [weather, setWeather] = useState(null);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    api('/api/forecast?' + key, { signal: controller.signal }).then((data) => setWeather({ key, data }))
      .catch((error) => { if (!controller.signal.aborted) setWeather({ key, data: { status: 'error', reason: error.message } }); });
    return () => controller.abort();
  }, [key]);
  const forecast = weather?.key === key ? weather?.data : null;
  const weekdays = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', timeZone: 'Europe/Warsaw' });
  return <section className="weather panel" aria-labelledby="weather-title">
    <h2 id="weather-title">Pogoda na 7 dni</h2>
    {fields.length > 1 ? <label className="forecast-select">Prognoza dla pola
      <select value={field.id} onChange={(event) => onPick(event.target.value)}>{fields.map((row) =>
        <option key={row.id} value={row.id}>{row.name}</option>)}</select>
    </label> : <p className="subtle"><Icon name="pin" size={16}/> {field.name}{field.report.parcel?.commune && ` · gm. ${field.report.parcel.commune}`}</p>}
    {!key ? <p className="note">Brak współrzędnych pola.</p> : !forecast ? <p role="status" className="subtle">Pobieram prognozę…</p> : <Note section={forecast}/>}
    {forecast?.status === 'ok' && <>
      <ol className="weather-week">{forecast.days.map((day) => {
        const [icon, label] = weatherIcon(day.weather_code);
        return <li key={day.date} className={day.precipitation_mm >= 5 ? 'wet' : ''}>
          <time dateTime={day.date}>{weekdays.format(new Date(day.date + 'T12:00:00Z')).replace('.', '')}</time>
          <span className={icon} title={label} role="img" aria-label={label}><Icon name={icon} size={21}/></span>
          <strong>{day.temperature_max_c == null ? '—' : `${number(day.temperature_max_c)}°`}</strong>
          <small>{day.precipitation_mm == null ? '—' : day.precipitation_mm > 0 ? `${number(day.precipitation_mm, 1)} mm` : ''}</small>
        </li>;
      })}</ol>
      {forecast.days[0]?.et0_mm != null && <p className="evaporation">Parowanie wskaźnikowe dziś · {number(forecast.days[0].et0_mm, 1)} mm</p>}
      <p className="subtle">{forecast.last_wet_day ? `Ostatni odnotowany opad >5 mm: ${dateText(forecast.last_wet_day)}`
        : forecast.past_days_complete ? 'Brak opadu >5 mm w ostatnich 30 dniach.' : 'Niepełne dane o ostatnich opadach.'}</p>
      <a className="attribution" href="https://open-meteo.com/en/docs">Dane pogodowe: Open-Meteo</a>
    </>}
  </section>;
}

export function Dashboard({ fields, onAdd }) {
  const [selected, setSelected] = useState(null);
  const field = fields.find(({ id }) => id === selected) ?? fields[0];
  if (!field) return <EmptyDashboard onAdd={onAdd}/>;
  return <>
    <div className="dashboard-heading">
      <h1>Moje gospodarstwo</h1>
      <Button className="primary" icon="plus" onClick={onAdd}>Dodaj pole</Button>
    </div>
    <Summary fields={fields} field={field}/>
    <div className="dashboard-columns">
      <FieldList fields={fields}/>
      <aside className="dashboard-sidebar"><NextActions fields={fields}/>
        <Weather fields={fields} field={field} onPick={setSelected}/></aside>
    </div>
  </>;
}
