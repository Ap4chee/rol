import { useEffect, useRef, useState } from 'react';
import { FieldLayers } from './FieldLayers.jsx';
import { api, Button, Icon, Meter, Note, Paragraphs, Sparkline, Status } from './ui.jsx';
import { dateText, number, satelliteMeasurements, seasonMonths, waterPercent } from './model.js';

function useDeferred(endpoint) {
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState('');
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    setResult(null);
    setFailure('');
    api(endpoint, { signal: controller.signal }).then(setResult)
      .catch((error) => { if (!controller.signal.aborted) setFailure(error.message); });
    return () => controller.abort();
  }, [endpoint, tries]);
  return { result, failure, retry: () => setTries((n) => n + 1) };
}

function Section({ title, children, id }) {
  return <section className="report-section" id={id}><h2>{title}</h2>{children}</section>;
}

function SoilProfile({ soil, moisture, water, crop }) {
  if (!soil.layers?.length) return null;
  const rootCm = (soil.root_depth_m ?? crop.root_depth_m ?? 0) * 100;
  const fill = waterPercent(water.result);
  const rootLayers = soil.layers.filter((layer) => layer.top_cm < rootCm);
  const regional = moisture?.status === 'ok' ? moisture.layers : [];
  return <div className="panel soil-profile">
    <div className="profile-head"><h3>Woda w warstwach gleby</h3>
      <small>Gleba: SoilGrids 250 m · zapas: bilans działki · okolica: NASA POWER ok. 50 km</small></div>
    <div className="profile-body">
      <ol className="profile-column" aria-label="Przekrój gleby od powierzchni w głąb"
        style={{ gridTemplateRows: soil.layers.map((l) => `minmax(44px, ${l.bottom_cm - l.top_cm}fr)`).join(' ') }}>
        {soil.layers.map((layer) => {
          const root = rootCm > layer.top_cm && rootCm < layer.bottom_cm
            ? 100 * (rootCm - layer.top_cm) / (layer.bottom_cm - layer.top_cm) : null;
          return <li key={layer.top_cm} className={`${layer.texture_key} ${layer.top_cm < rootCm ? 'in-root' : ''}`}>
            <div><span><strong>{layer.top_cm}–{layer.bottom_cm} cm</strong> {layer.texture_label}</span>
              <small>{number(layer.available_water_mm)} mm wody dostępnej · pojemność polowa {number(layer.field_capacity_vol_pct)}%</small></div>
            {root != null && <i className="root-line" style={{ top: `${root}%` }}><b>korzenie do {number(rootCm)} cm</b></i>}
          </li>;
        })}
      </ol>
      <div className="profile-side">
        <div className="profile-fill">
          <h4>Strefa korzeni na działce</h4>
          {fill == null ? <p className="subtle">Brak bilansu wodnego.</p> : <>
            <div className="fill-bar" role="img" aria-label={`Zapas wody ${number(fill)}% pojemności`}>
              <i style={{ height: `${fill}%` }}/></div>
            <p><strong>{number(fill)}%</strong> zapasu · {number(water.result.available_mm)} z {number(water.result.taw_mm)} mm</p>
            <small>Warstwy {rootLayers[0]?.top_cm}–{number(rootCm)} cm liczone razem (bilans FAO-56)</small>
          </>}
        </div>
        <div className="profile-regional">
          <h4>Okolica na tle 10 lat</h4>
          {regional.length ? <ul>{regional.map((layer) => <li key={layer.key} className={layer.class_key}>
            <span>{layer.label} <small>{layer.bottom_cm == null ? 'cały profil' : `${layer.top_cm}–${layer.bottom_cm} cm`}</small></span>
            <div className="moisture-bar" role="img" aria-label={`Wilgotność ${number(layer.current * 100)}%, mediana ${number(layer.median * 100)}%`}>
              <i style={{ width: `${layer.current * 100}%` }}/><b style={{ left: `${layer.median * 100}%` }}/></div>
            <small>{layer.class_label} · wilgotniej w {layer.years_higher} z {layer.years_compared} lat</small>
          </li>)}</ul> : <p className="subtle">{moisture?.reason ?? 'Brak danych o wilgotności warstw w okolicy.'}</p>}
          {regional.length > 0 && <small className="legend">Pasek: wilgotność teraz (7 dni do {dateText(regional[0].current_to)}) · kreska: mediana z poprzednich lat</small>}
        </div>
      </div>
    </div>
    {moisture?.text?.length > 0 && <details className="disclosure"><summary>Jak czytać te dane <Icon name="chevron" size={17}/></summary>
      <Paragraphs lines={moisture.text}/></details>}
  </div>;
}

function Assessment({ report }) {
  const water = report.water_status;
  const value = waterPercent(water.result);
  const climat = water.climatic_water_balance;
  const history = report.history;
  const series = (water.series ?? []).filter((day) => day.taw_mm > 0).map((day) =>
    Math.min(100, Math.max(0, 100 * (1 - day.depletion_mm / day.taw_mm))));
  return <Section title="Jak jest z wodą?" id="ocena">
    <div className="assessment panel">
      <div className="reservoir" style={{ '--water-level': `${value ?? 0}%` }}>
        {value != null && <div className="water-fill" aria-hidden="true"/>}
        <div><strong>{value == null ? '—' : `${number(value)}%`}</strong><span>Zapas wody w glebie</span></div>
      </div>
      <div className="assessment-body">
        <Status water={water}/>
        <h3>{water.headline ?? water.class_label ?? 'Brakuje danych do oceny'}</h3>
        <Note section={water}/>
        {report.summary?.[0] && <p>{report.summary[0]}</p>}
        <div className="now-later">
          <div><h4>Teraz</h4>{climat ? <p>{number(climat.rain_mm, 1)} mm opadu w {climat.days} dni</p> : <p>Brak bilansu pogodowego</p>}
            {report.crop.stage_name && <small>{report.crop.stage_name}</small>}</div>
          <div><h4>Na dłuższą metę</h4>
            <p>{history.seasons_total ? `Niedobór w ${history.seasons_with_stress} z ${history.seasons_total} pełnych sezonów` : 'Brak oceny historycznej'}</p>
            {history.seasons?.length > 0 && <div className="history-dots" aria-hidden="true">{history.seasons.filter((s) => s.complete).map((s) =>
              <i key={s.season} className={s.stressed ? 'stressed' : ''}/>)}</div>}</div>
        </div>
        {water.uncertainty_text && <p className="subtle">{water.uncertainty_text}</p>}
      </div>
    </div>
    <SoilProfile soil={report.soil} moisture={report.soil_moisture} water={water} crop={report.crop}/>
    {water.status === 'ok' && <details className="panel disclosure"><summary>Dane bilansu wodnego <Icon name="chevron" size={17}/></summary>
      <Paragraphs lines={water.text}/>
      {climat && <p>{climat.text}</p>}
      {series.length > 1 && <div className="balance-chart"><h3>Zapas wody w ostatnich dniach</h3>
        <Sparkline values={series} min={0} max={100} label="Zmiana zapasu wody w strefie korzeniowej"/>
        <div className="scale"><span>{dateText(water.series[0].date)}</span><span>{dateText(water.series.at(-1).date)}</span></div>
      </div>}
      {water.variants?.length > 1 && <div className="table-wrap"><table>
        <thead><tr><th>Wariant gleby</th><th>Zapas</th><th>Ocena</th></tr></thead>
        <tbody>{water.variants.map((v) => <tr key={v.key}><td>{v.label}</td><td>{number(waterPercent(v))}%</td><td>{v.class_label}</td></tr>)}</tbody>
      </table></div>}
      {water.last_season?.text && <p>{water.last_season.text}</p>}
    </details>}
  </Section>;
}

function HydrologyTable({ hydro }) {
  if (hydro.status !== 'ok' || !hydro.years?.length) return null;
  const label = hydro.metric === 'flow' ? 'Przepływ' : 'Stan wody';
  const digits = hydro.metric === 'flow' ? (hydro.median_value < 10 ? 2 : 1) : 0;
  return <div className="table-wrap"><table>
    <caption>{label} na wodowskazie {hydro.station_name}{hydro.river ? ` · ${hydro.river}` : ''} · IMGW-PIB, dane przetworzone</caption>
    <thead><tr><th>Rok lub okres</th><th>{label}</th></tr></thead>
    <tbody>{hydro.years.map(({ year, value }) => <tr key={year}><td>{year} · średnia z 7 dni</td>
      <td>{number(value, digits)} {hydro.unit}</td></tr>)}
      <tr><th>{hydro.origin === 'live' ? 'Pomiar' : '7 dni do'} {dateText(hydro.current_to)}</th>
        <td>{number(hydro.current_value, digits)} {hydro.unit} · {hydro.class_label}</td></tr>
    </tbody>
  </table></div>;
}

function Causes({ report, terrain, failed, retry }) {
  const causes = report.causes;
  const all = [...(causes.items ?? []), ...(terrain?.causes ?? [])];
  return <Section title="Dlaczego?" id="przyczyny">
    <Note section={causes}/>
    {all.length > 0 && <div className="cause-grid">{all.map((cause, index) =>
      <details className="panel disclosure cause" key={cause.key}>
        <summary><Icon name={cause.key.includes('soil') ? 'layers' : index === 0 ? 'drop' : 'eye'}/>
          <span><strong>{cause.title}</strong><small>Pokaż dane</small></span><Icon name="chevron" size={17}/></summary>
        <p>{cause.text}</p>
      </details>)}</div>}
    {causes.reason && causes.status === 'ok' && <p className="subtle">{causes.reason}</p>}
    {causes.windows?.length > 0 && <details className="panel disclosure"><summary>Opad i parowanie na tle 10 lat <Icon name="chevron" size={17}/></summary>
      <div className="table-wrap"><table><thead><tr><th>Okres</th><th>Opad</th><th>Mediana opadu</th><th>Parowanie</th><th>Mediana parowania</th></tr></thead>
        <tbody>{causes.windows.map((row) => <tr key={row.days}><td>{row.days} dni</td>{['rain_mm', 'rain_median_mm', 'et0_mm', 'et0_median_mm'].map((key) =>
          <td key={key}>{row[key] == null ? '—' : `${number(row[key], 1)} mm`}</td>)}</tr>)}</tbody></table></div>
    </details>}
    <details className="panel disclosure"><summary>Gleba, teren i wody w okolicy <Icon name="chevron" size={17}/></summary>
      <Note section={report.soil}/><Paragraphs lines={report.soil.text}/>
      {report.soil.layers?.length > 0 && <div className="soil-grid">{report.soil.layers.map((layer) => <div key={layer.top_cm}>
        {layer.image && <img src={layer.image} alt="" loading="lazy"/>}
        <strong>{layer.top_cm}–{layer.bottom_cm} cm</strong><span>{layer.texture_label}</span>
        <small>Woda dostępna: {number(layer.available_water_mm, 1)} mm</small>
      </div>)}</div>}
      <Note section={terrain}/><Paragraphs lines={terrain?.text}/><Paragraphs lines={terrain?.limitations}/>
      {failed && <Button onClick={retry}>Ponów pobieranie terenu</Button>}
      <Note section={report.hydrology}/><Paragraphs lines={report.hydrology.text}/>
      <HydrologyTable hydro={report.hydrology}/>
      {causes.not_assessed?.filter((s) => terrain?.status !== 'ok' || !s.startsWith('Spadek terenu')).map((s) =>
        <p className="subtle" key={s}>{s}</p>)}
    </details>
  </Section>;
}

const actionImages = {
  residue_cover: 'mulcz.jpg', cover_crop: 'miedzyplon.jpg', organic_matter: 'mulcz.jpg',
  buffer_strip_watercourse: 'zadrzewienia.jpg', reduced_tillage: 'mulcz.jpg',
  buffer_strip_flow_path: 'zadrzewienia.jpg', protect_depression: 'zaglebienie.jpg',
};

function Recommendation({ item, image }) {
  return <article className={`advice panel ${item.category === 'irrigation' ? 'irrigation' : ''}`}>
    {image && <img src={`/design/${image}`} alt="" loading="lazy"/>}
    <div>
      <h3>{item.title}</h3>
      <p>{item.what}</p>
      {item.where && <p className="where"><Icon name="pin" size={16}/>{item.where}</p>}
      <details><summary>Dlaczego na tym polu? <Icon name="chevron" size={16}/></summary>
        <p>{item.why}</p><p className="subtle">Pewność: {item.confidence}. {item.confidence_reason}</p>
      </details>
    </div>
  </article>;
}

function Recommendations({ report, terrainActions, satelliteChecks }) {
  const data = report.recommendations;
  const groups = [['retention', 'Zatrzymaj wodę'], ['agrotechnical', 'Na polu'], ['irrigation', 'Nawadnianie']];
  const checks = [...new Map([
    ...(data.field_checks ?? []), ...satelliteChecks, ...terrainActions.filter((item) => item.category === 'field_check'),
  ].map((item) => [item.key, item])).values()];
  return <Section title="Co robić" id="dzialania">
    <Note section={data}/>
    {groups.map(([category, title], i) => {
      const items = [...(data[category] ?? []), ...terrainActions.filter((item) => item.category === category)];
      return <div className="action-group" key={category}>
      <h3 className="group-heading"><span>{i + 1}</span> {title}</h3>
      {items?.length ? <div className={i === 2 ? 'irrigation-grid' : 'recommendations-grid'}>{items.map((item) =>
        <Recommendation key={item.key} item={item} image={actionImages[item.key]}/>)}</div>
        : <p className="panel empty-detail">{data.status !== 'ok' ? 'Na tym etapie brakuje danych do zaleceń.'
          : i === 2 ? data.irrigation_note || 'Raport nie wskazuje potrzeby nawadniania.' : 'Raport nie wskazuje działań w tej grupie.'}</p>}
      {i === 2 && items?.length > 0 && data.irrigation_note && <p className="subtle">{data.irrigation_note}</p>}
      </div>;
    })}
    {checks.length > 0 && <details className="panel disclosure"><summary>Co sprawdzić na polu <Icon name="chevron" size={17}/></summary>
      {checks.map((item) => <article key={item.key}><h4>{item.title}</h4><p>{item.what}</p><p>{item.why}</p></article>)}</details>}
  </Section>;
}

const months = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
function History({ report }) {
  const history = report.history;
  const critical = seasonMonths(report.crop);
  const max = Math.max(1, ...(history.seasons ?? []).map((s) => s.stress_days_critical));
  return <Section title="Historia i ryzyko" id="historia">
    <div className="history-grid">
      <div className="panel risk-calendar">
        <h3>Kalendarz uprawy</h3>
        <p>Okres największej wrażliwości na niedobór wody</p>
        {critical.length > 0 ? <>
          <div className="month-wheel" aria-hidden="true">{months.map((month, i) =>
            <span key={month} className={critical.includes(i) ? 'critical' : ''} style={{ '--angle': `${i * 30}deg` }}>{month}</span>)}
            <Icon name="calendar" size={30}/>
          </div>
          <strong>{dateText(report.crop.critical_from).slice(0, 5)}–{dateText(report.crop.critical_to).slice(0, 5)}</strong>
        </> : <p>Brak okresu krytycznego w tej analizie.</p>}
      </div>
      <div className="panel seasons">
        <h3>10 lat tego pola</h3>
        <p className="subtle">Dni niedoboru w okresie krytycznym każdego sezonu</p>
        <Note section={history}/>
        <ul className="season-list">{history.seasons?.map((s) => <li key={s.season}>
          <span>{s.season}{!s.complete && <small> · w trakcie</small>}</span>
          <meter min="0" max={max} value={s.stress_days_critical} aria-label={`Dni niedoboru w sezonie ${s.season}`}/>
          <strong>{s.stress_days_critical} dni</strong>
        </li>)}</ul>
        <details><summary>Jak czytać historię? <Icon name="chevron" size={16}/></summary><Paragraphs lines={history.text}/></details>
      </div>
    </div>
  </Section>;
}

function Satellite({ satellite, failed, retry }) {
  const measurements = satelliteMeasurements(satellite);
  const [index, setIndex] = useState(null);
  useEffect(() => {
    if (index == null || index >= measurements.length - 1) return;
    const timer = setTimeout(() => setIndex(index + 1), 850);
    return () => clearTimeout(timer);
  }, [index, measurements.length]);
  const observation = index == null ? measurements.at(-1) : measurements[index];
  return <details className="panel disclosure">
    <summary>Zieloność z satelity <Icon name="chevron" size={17}/></summary>
    <Note section={satellite}/>
    <Paragraphs lines={satellite.text}/>
    {failed && <Button onClick={retry}>Ponów pobieranie obserwacji</Button>}
    {measurements.length > 1 && <Sparkline values={measurements.map((observation) => observation.ndvi)}
      min={-1} max={1} label="Zmiana wskaźnika zieloności w dostępnych obserwacjach satelitarnych"/>}
    {observation && <p role="status">{dateText(observation.date)} · zieloność {number(observation.ndvi, 2)} · pokrycie {number(observation.coverage_pct)}%</p>}
    {measurements.length > 1 && <div className="observation-controls no-print">
      <Button onClick={() => setIndex(index != null && index < measurements.length - 1 ? measurements.length - 1 : 0)}>
        {index != null && index < measurements.length - 1 ? 'Zatrzymaj' : 'Odtwórz obserwacje'}
      </Button>
      <label>Obserwacja
        <input type="range" min="0" max={measurements.length - 1} value={index ?? measurements.length - 1}
          onChange={(event) => setIndex(Number(event.target.value))}/>
      </label>
    </div>}
    {satellite.observations?.some((s) => !s.accepted) && <small className="subtle">Część scen pominięto z powodu jakości lub pokrycia zdjęcia.</small>}
  </details>;
}

function Sources({ report, satelliteSource, terrain }) {
  let sources = report.sources ?? [];
  for (const source of [satelliteSource, terrain?.source]) {
    if (source) sources = [...sources.filter((entry) => entry.key !== source.key), source];
  }
  const state = { ok: 'Użyto', no_data: 'Brak danych', error: 'Niedostępne', pending: 'W trakcie' };
  return <Section title="Skąd to wiemy i czego nie wiemy?" id="zrodla">
    <div className="panel source-panel">
      <h3>Źródła danych</h3>
      <ul className="source-list">{sources.map((source, i) => <li key={source.key + i}>
        <div><strong>{source.name}</strong><small>{source.resolution}</small></div>
        <div><span className={`source-state ${source.status}`}>{state[source.status] ?? source.status}</span>
          <small>{source.data_date ?? (source.data_from ? `${dateText(source.data_from)} – ${dateText(source.data_to)}` : 'Data niedostępna')}</small></div>
        {(source.reason || source.impact) && <p className="subtle">{[source.reason, source.impact].filter(Boolean).join(' ')}</p>}
        {source.notes?.length > 0 && <p className="subtle">{source.notes.join(' ')}</p>}
      </li>)}</ul>
      <h3>Ograniczenia</h3>
      <ul>{report.limitations?.map((s) => <li key={s}>{s}</li>)}</ul>
      <Paragraphs lines={report.crop.assumptions}/>
    </div>
  </Section>;
}

export function Report({ field, onSave, onEdit, onSatellite, saved }) {
  const { report } = field;
  const heading = useRef(null);
  const article = useRef(null);
  const sat = useDeferred(report.satellite.endpoint);
  const topo = useDeferred(report.terrain.endpoint);
  const satellite = sat.result?.satellite ?? (sat.failure ? { status: 'error', reason: sat.failure } : report.satellite);
  const terrain = topo.result ?? (topo.failure ? { status: 'error', reason: topo.failure } : report.terrain);
  const terrainActions = terrain.recommendations ?? [];
  const count = report.recommendations.retention.length + report.recommendations.agrotechnical.length
    + report.recommendations.irrigation.length + terrainActions.filter((item) => item.category !== 'field_check').length;
  const [notice, setNotice] = useState('');

  useEffect(() => { heading.current.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let collapsed = [];
    const expand = () => {
      collapsed = [...article.current.querySelectorAll('details:not([open])')];
      collapsed.forEach((details) => { details.open = true; });
    };
    const restore = () => {
      collapsed.forEach((details) => { details.open = false; });
      collapsed = [];
    };
    window.addEventListener('beforeprint', expand);
    window.addEventListener('afterprint', restore);
    return () => {
      window.removeEventListener('beforeprint', expand);
      window.removeEventListener('afterprint', restore);
    };
  }, []);
  useEffect(() => {
    if (sat.result && sat.result.satellite?.status !== 'pending') onSatellite(field.id, report.generated_at, sat.result);
  }, [field.id, report.generated_at, sat.result, onSatellite]);

  function save() {
    setNotice(onSave(field) ? 'Raport zapisany w tej przeglądarce.' : '');
  }

  return <article className="report" ref={article}>
    <div className="report-toolbar no-print">
      <a href={window.location.search ? '/' : '#'} className="button"><Icon name="back"/> Wszystkie pola</a>
      <div className="report-actions">
        <Button icon="download" onClick={() => window.print()}>Pobierz PDF</Button>
        <Button icon="print" onClick={() => window.print()}>Drukuj</Button>
        <Button icon="save" className="primary" onClick={save}>{saved ? 'Zapisz' : 'Zapisz pole'}</Button>
      </div>
    </div>
    <header className="report-header">
      <h1 tabIndex={-1} ref={heading}>{field.name}</h1>
      <div className="report-meta"><strong>{report.crop.name}{report.parcel?.area_ha != null ? ` · ${number(report.parcel.area_ha, 2)} ha` : ''}</strong>
        <code>{report.parcel?.id ?? report.request.parcel_id ?? 'Wskazany punkt'}</code>
        <span><Icon name="calendar" size={17}/> Stan na {dateText(report.analysis_date)}</span>
        <Status water={report.water_status}/>
        {(report.water_status.spans_classes || report.water_status.soil_assumed) &&
          <button className="quiet-button no-print" onClick={() =>
            document.getElementById('zrodla').scrollIntoView()}>Ograniczona pewność · zobacz źródła</button>}
        <Button className="small no-print" onClick={onEdit}>Przelicz raport</Button>
      </div>
      {notice && <p role="status" className="subtle">{notice}</p>}
    </header>
    <FieldLayers report={report} terrain={terrain} satellite={satellite} actions={count}/>
    <Assessment report={report}/>
    <Causes report={report} terrain={terrain} failed={topo.failure} retry={topo.retry}/>
    <Recommendations report={report} terrainActions={terrainActions} satelliteChecks={sat.result?.field_checks ?? []}/>
    <History report={report}/>
    <Satellite satellite={satellite} failed={sat.failure} retry={sat.retry}/>
    <Sources report={report} satelliteSource={sat.result?.source} terrain={terrain}/>
  </article>;
}
