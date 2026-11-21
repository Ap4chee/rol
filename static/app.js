/* Frontend raportu. Zasada: przeglądarka tylko rysuje to, co zwróciło API (bez własnych obliczeń i wniosków). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const FULL_ID = /^\d{6}_\d\.\d{4}\.(AR_\d+\.)?[0-9A-Za-z\/._-]+$/;
  const STATUS_LABEL = { ok: 'dane są', no_data: 'brak danych', error: 'błąd źródła', pending: 'liczę…' };
  const state = { parcel: null, point: null, report: null, timer: null };

  // ---------- drobne narzędzia ----------
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value);
      }
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  function add(parent, ...nodes) {
    for (const node of nodes.flat()) if (node !== null && node !== undefined && node !== false) parent.append(node);
    return parent;
  }
  function svg(tag, attrs, ...children) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
    for (const child of children.flat()) if (child) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const num = (value, digits = 0) => (value === null || value === undefined) ? '–'
    : Number(value).toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const dateText = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('.') : '–';
  const paragraphs = (lines) => (lines || []).map((line) => el('p', { text: line }));
  function isoToday() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  async function getJson(url, options) {
    const response = await fetch(url, options);
    let body = null;
    try { body = await response.json(); } catch (e) { /* odpowiedź bez JSON */ }
    if (!response.ok) {
      let detail = body && body.detail;
      if (Array.isArray(detail)) detail = detail.map((d) => String(d.msg || '').replace(/^Value error, /, '')).join(' ');
      throw new Error(detail || ('Serwer odpowiedział błędem ' + response.status + '.'));
    }
    return body;
  }
  function statusNote(section, fallback) {
    if (!section || section.status === 'ok') return null;
    return el('p', { class: 'status-note' + (section.status === 'error' ? ' error' : '') },
      el('strong', { text: (STATUS_LABEL[section.status] || section.status) + ': ' }), section.reason || fallback || '');
  }

  // ---------- mapa ----------
  const parcelSource = new ol.source.Vector();
  const terrainSource = new ol.source.Vector();
  const orto = new ol.layer.Tile({
    source: new ol.source.TileWMS({
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution',
      params: { LAYERS: 'Raster', FORMAT: 'image/jpeg', VERSION: '1.3.0' },
      attributions: 'Ortofotomapa: © GUGiK (geoportal.gov.pl)',
    }),
  });
  const osm = new ol.layer.Tile({ source: new ol.source.OSM(), visible: false });
  const parcelsWms = new ol.layer.Image({
    minZoom: 14.5,
    source: new ol.source.ImageWMS({
      url: 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow',
      params: { LAYERS: 'dzialki,numery_dzialek', FORMAT: 'image/png', TRANSPARENT: 'TRUE', VERSION: '1.3.0' },
      ratio: 1.2,
      attributions: 'Granice działek: © GUGiK (KIEG)',
    }),
  });
  function terrainStyle(feature) {
    const kind = feature.get('kind');
    if (feature.getGeometry().getType() === 'Point') {
      const inflow = kind === 'inflow';
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 7, fill: new ol.style.Fill({ color: inflow ? '#1d6fd1' : '#d1331d' }),
          stroke: new ol.style.Stroke({ color: '#fff', width: 2 }),
        }),
        text: new ol.style.Text({
          text: feature.get('label') || '', offsetY: -16, font: 'bold 12px system-ui, sans-serif',
          fill: new ol.style.Fill({ color: '#111' }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
        }),
      });
    }
    return new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#35b6ff', width: Number(feature.get('width')) || 2 }) });
  }
  const map = new ol.Map({
    target: 'map',
    layers: [
      orto, osm, parcelsWms,
      new ol.layer.Vector({ source: terrainSource, style: terrainStyle }),
      new ol.layer.Vector({
        source: parcelSource,
        style: [
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#000', width: 5 }) }),
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#ffe600', width: 3 }), fill: new ol.style.Fill({ color: 'rgba(255,230,0,0.08)' }) }),
        ],
      }),
    ],
    view: new ol.View({ center: ol.proj.fromLonLat([19.4, 52.0]), zoom: 6.3, maxZoom: 20 }),
  });
  const geojson = new ol.format.GeoJSON();

  document.querySelectorAll('[data-base]').forEach((button) => {
    button.addEventListener('click', () => {
      const base = button.getAttribute('data-base');
      orto.setVisible(base === 'orto');
      osm.setVisible(base === 'osm');
      document.querySelectorAll('[data-base]').forEach((b) => b.classList.toggle('active', b === button));
    });
  });
  $('toggle-parcels').addEventListener('click', () => {
    const on = !parcelsWms.getVisible();
    parcelsWms.setVisible(on);
    $('toggle-parcels').classList.toggle('active', on);
    $('toggle-parcels').setAttribute('aria-pressed', String(on));
  });

  function showParcelOnMap(parcel) {
    parcelSource.clear();
    terrainSource.clear();
    $('map-legend').hidden = true;
    if (!parcel) return;
    const feature = geojson.readFeature({ type: 'Feature', geometry: parcel.geometry },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
    parcelSource.addFeature(feature);
    map.getView().fit(feature.getGeometry().getExtent(), { padding: [70, 70, 70, 70], maxZoom: 18, duration: 300 });
  }

  // ---------- wybór działki ----------
  function setMessage(id, text, isError) {
    const node = $(id);
    node.textContent = text || '';
    node.classList.toggle('error', Boolean(isError));
  }
  function describe(c) {
    const parts = [c.region, c.commune ? 'gm. ' + c.commune : null, c.county, c.voivodeship].filter(Boolean);
    return parts.join(', ');
  }
  function selectParcel(parcel) {
    state.parcel = parcel;
    state.point = null;
    $('parcel-candidates').hidden = true;
    $('parcel-selected').hidden = false;
    $('parcel-selected').textContent = 'Wybrana działka: ' + (parcel.number || parcel.id) + ' – ' + describe(parcel)
      + ' (' + num(parcel.area_ha, 2) + ' ha)';
    setMessage('parcel-message', '');
    $('submit').disabled = false;
    showParcelOnMap(parcel);
  }
  async function loadById(id) {
    setMessage('parcel-message', 'Pobieram granice działki…');
    const result = await getJson('/api/parcels/by-id?id=' + encodeURIComponent(id));
    if (result.status !== 'ok' || !result.parcel) throw new Error(result.reason || 'Nie znaleziono działki.');
    selectParcel(result.parcel);
  }
  async function searchParcel() {
    const query = $('parcel-query').value.trim();
    if (query.length < 2) { setMessage('parcel-message', 'Wpisz nazwę obrębu i numer działki.', true); return; }
    $('parcel-candidates').hidden = true;
    try {
      if (FULL_ID.test(query)) { await loadById(query); return; }
      setMessage('parcel-message', 'Szukam działki…');
      const result = await getJson('/api/parcels/search?q=' + encodeURIComponent(query));
      if (result.status !== 'ok') { setMessage('parcel-message', result.reason || 'Nie znaleziono działki.', true); return; }
      if (result.candidates.length === 1) { await loadById(result.candidates[0].id); return; }
      const list = $('parcel-candidates');
      list.replaceChildren(...result.candidates.map((c) => {
        const button = el('button', { type: 'button' }, el('strong', { text: 'Działka ' + (c.number || '') }),
          el('small', { text: describe(c) + ' · ' + c.id }));
        button.addEventListener('click', () => loadById(c.id).catch((e) => setMessage('parcel-message', e.message, true)));
        return button;
      }));
      list.hidden = false;
      setMessage('parcel-message', 'Znaleziono ' + result.candidates.length + ' działek o takim opisie'
        + (result.truncated ? ' (pokazano pierwsze 50, doprecyzuj nazwę obrębu)' : '') + '. Wybierz swoją:');
    } catch (error) {
      setMessage('parcel-message', error.message, true);
    }
  }
  $('parcel-search').addEventListener('click', searchParcel);
  $('parcel-query').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); searchParcel(); }
  });
  map.on('singleclick', async (event) => {
    const [lon, lat] = ol.proj.toLonLat(event.coordinate);
    setMessage('parcel-message', 'Sprawdzam, jaka działka leży w klikniętym miejscu…');
    try {
      const result = await getJson('/api/parcels/by-point?lon=' + lon.toFixed(6) + '&lat=' + lat.toFixed(6));
      if (result.status === 'ok' && result.parcel) { selectParcel(result.parcel); return; }
      if (result.status === 'error') {
        // ULDK nie odpowiada: raport da się policzyć dla samego punktu
        state.parcel = null;
        state.point = { lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) };
        showParcelOnMap(null);
        $('parcel-selected').hidden = false;
        $('parcel-selected').textContent = 'Wybrany punkt: ' + num(lat, 4) + '° N, ' + num(lon, 4) + '° E (bez granic działki)';
        $('submit').disabled = false;
        setMessage('parcel-message', 'Usługa działek nie odpowiada (' + (result.reason || '') + '). Raport policzymy dla wskazanego punktu.', true);
        return;
      }
      setMessage('parcel-message', result.reason || 'W tym miejscu nie ma działki.', true);
    } catch (error) {
      setMessage('parcel-message', error.message, true);
    }
  });

  // ---------- formularz ----------
  async function init() {
    const today = isoToday();
    const min = new Date(today); min.setFullYear(min.getFullYear() - 10);
    $('date').value = today; $('date').max = today; $('date').min = min.toISOString().slice(0, 10);
    try {
      const crops = await getJson('/api/crops');
      $('crop').replaceChildren(...crops.map((c) => el('option', { value: c.key, text: c.name })));
    } catch (error) {
      setMessage('progress', 'Nie udało się pobrać listy upraw: ' + error.message, true);
    }
    // Odnośnik do raportu: ?parcel=<identyfikator>&crop=<klucz>&date=RRRR-MM-DD (raport i tak liczy się od nowa)
    const params = new URLSearchParams(window.location.search);
    if (params.get('crop')) $('crop').value = params.get('crop');
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '')) $('date').value = params.get('date');
    if (params.get('parcel')) {
      $('parcel-query').value = params.get('parcel');
      try {
        await loadById(params.get('parcel'));
        $('form').requestSubmit();
      } catch (error) {
        setMessage('parcel-message', error.message, true);
      }
    }
  }
  $('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.parcel && !state.point) return;
    const body = { crop: $('crop').value, date: $('date').value };
    if (state.parcel) body.parcel_id = state.parcel.id; else body.point = state.point;
    const started = Date.now();
    $('submit').disabled = true;
    clearInterval(state.timer);
    const tick = () => setMessage('progress', 'Pobieram dane i liczę bilans wodny… ' + Math.round((Date.now() - started) / 1000) + ' s (zwykle do 30 s)');
    tick(); state.timer = setInterval(tick, 500);
    try {
      const report = await getJson('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      clearInterval(state.timer);
      setMessage('progress', 'Raport gotowy po ' + num((Date.now() - started) / 1000, 1) + ' s.');
      state.report = report;
      renderReport(report);
      $('report').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (report.terrain && report.terrain.status === 'pending' && report.terrain.endpoint) loadTerrain(report);
    } catch (error) {
      clearInterval(state.timer);
      setMessage('progress', error.message, true);
    } finally {
      $('submit').disabled = false;
    }
  });

  // ---------- rysowanie raportu ----------
  function gauge(result) {
    const taw = result.taw_mm || 1;
    const fill = Math.min(100, Math.max(0, 100 * result.depletion_mm / taw));
    const raw = Math.min(100, Math.max(0, 100 * result.raw_mm / taw));
    const bar = el('div', { class: 'bar', style: '--raw:' + raw + '%' },
      el('div', { class: 'fill', style: 'width:' + fill + '%' }),
      el('div', { class: 'mark', style: 'left:' + raw + '%', title: 'próg stresu (RAW)' }));
    return el('div', { class: 'gauge' }, bar,
      el('div', { class: 'labels' }, el('span', { text: '0 mm – pełny zapas' }),
        el('span', { text: 'próg stresu (RAW) ' + num(result.raw_mm) + ' mm' }),
        el('span', { text: num(result.taw_mm) + ' mm – brak wody dostępnej (TAW)' })),
      el('p', { class: 'small', text: 'Ciemny pasek: ile wody ubyło ze strefy korzeni (' + num(result.depletion_mm) + ' mm, '
        + num(result.depletion_pct_taw) + '% zapasu).' }));
  }

  function chart(series) {
    if (!series || series.length < 2) return null;
    const W = 760, H = 250, L = 46, R = 12, T = 14, B = 30;
    const taw = Math.max(...series.map((d) => d.taw_mm), 1);
    const maxRain = Math.max(10, ...series.map((d) => d.rain_mm));
    const x = (i) => L + (W - L - R) * i / (series.length - 1);
    const y = (mm) => T + (H - T - B) * Math.min(mm, taw) / taw;
    const rainH = (mm) => 70 * mm / maxRain;
    const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img',
      'aria-label': 'Wyczerpanie wody w strefie korzeni i opad w ostatnich miesiącach' });
    const rawPath = series.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d.raw_mm).toFixed(1)).join(' ');
    root.append(svg('path', { d: rawPath + ' L' + x(series.length - 1) + ' ' + y(taw) + ' L' + x(0) + ' ' + y(taw) + ' Z', fill: '#f9dedc' }));
    root.append(svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'none', stroke: '#b9c4be' }));
    series.forEach((d, i) => {
      if (d.rain_mm > 0.05) root.append(svg('rect', { x: (x(i) - 1.2).toFixed(1), y: T, width: 2.4, height: rainH(d.rain_mm).toFixed(1), fill: '#3b82c4' }));
    });
    root.append(svg('path', { d: rawPath, fill: 'none', stroke: '#c8641a', 'stroke-width': 1.2, 'stroke-dasharray': '5 3' }));
    root.append(svg('path', {
      d: series.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d.depletion_mm).toFixed(1)).join(' '),
      fill: 'none', stroke: '#1d2a24', 'stroke-width': 2.2,
    }));
    [0, 0.5, 1].forEach((f) => {
      root.append(svg('text', { x: L - 6, y: y(taw * f) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#5d6b64' }, num(taw * f) + ' mm'));
    });
    let lastMonth = '';
    series.forEach((d, i) => {
      const month = d.date.slice(0, 7);
      if (month !== lastMonth && i > 0) {
        root.append(svg('line', { x1: x(i), x2: x(i), y1: H - B, y2: H - B + 5, stroke: '#5d6b64' }));
        root.append(svg('text', { x: x(i) + 3, y: H - 10, 'font-size': 11, fill: '#5d6b64' }, d.date.slice(5, 7) + '.' + d.date.slice(0, 4)));
      }
      lastMonth = month;
    });
    return el('div', null, root, el('p', { class: 'chart-caption',
      text: 'Czarna linia: ubytek wody w strefie korzeni (im niżej, tym mniej wody). Linia przerywana: próg stresu (RAW); '
        + 'różowe pole: strefa niedoboru. Niebieskie słupki u góry: opad dobowy (najwyższy ' + num(maxRain, 0) + ' mm).' }));
  }

  function variantsTable(variants) {
    if (!variants || variants.length < 2) return null;
    return el('div', { class: 'table-wrap' }, el('table', null,
      el('thead', null, el('tr', null, ...['Wariant gleby', 'Pojemność polowa / punkt więdnięcia', 'TAW', 'RAW', 'Ubytek', 'Klasa']
        .map((t, i) => el('th', { class: i >= 2 && i <= 4 ? 'num' : null, text: t })))),
      el('tbody', null, ...variants.map((v) => el('tr', null,
        el('td', { text: v.label }),
        el('td', { text: num(v.field_capacity_vol_pct, 1) + '% / ' + num(v.wilting_point_vol_pct, 1) + '% obj.' }),
        el('td', { class: 'num', text: num(v.taw_mm) + ' mm' }),
        el('td', { class: 'num', text: num(v.raw_mm) + ' mm' }),
        el('td', { class: 'num', text: num(v.depletion_mm) + ' mm (' + num(v.depletion_pct_taw) + '%)' }),
        el('td', { text: v.class_label }))))));
  }

  function waterSection(report) {
    const ws = report.water_status;
    const section = el('section', { id: 'sec-water' }, el('h3', null, el('span', { class: 'order', text: '1.' }), 'Sytuacja wodna'));
    if (ws.status !== 'ok') { add(section, statusNote(ws)); return section; }
    add(section, el('div', { class: 'verdict ' + (ws.class_key || '') }, el('strong', { text: ws.headline }),
      el('span', { text: 'Stan na ' + dateText(ws.last_data_day) + ' · ' + report.crop.name + ' · ' + (report.crop.stage_name || '') })));
    add(section, ...paragraphs(ws.text));
    if (ws.result) add(section, gauge(ws.result));
    if (ws.uncertainty_text) add(section, el('p', { class: 'uncertainty', text: ws.uncertainty_text }));
    add(section, variantsTable(ws.variants));
    if (ws.climatic_water_balance) add(section, el('h4', { text: 'Klimatyczny bilans wodny (60 dni)' }), el('p', { text: ws.climatic_water_balance.text }));
    const drawn = chart(ws.series);
    if (drawn) add(section, el('h4', { text: 'Przebieg zapasu wody w glebie' }), drawn);

    add(section, el('h4', { text: 'Co widać z satelity (Sentinel-2)' }));
    const sat = report.satellite;
    add(section, statusNote(sat), ...paragraphs(sat.text));
    if (sat.observations && sat.observations.length) {
      add(section, el('details', null, el('summary', { text: 'Obserwacje użyte i odrzucone (' + sat.observations.length + ')' }),
        el('div', { class: 'table-wrap' }, el('table', null,
          el('thead', null, el('tr', null, ...['Data', 'Piksele z roślinnością', 'NDVI', 'NDMI', 'Uwagi'].map((t) => el('th', { text: t })))),
          el('tbody', null, ...sat.observations.map((o) => el('tr', null,
            el('td', { text: dateText(o.date) }), el('td', { text: o.valid_pixels + ' z ' + o.total_pixels + ' (' + num(o.coverage_pct) + '%)' }),
            el('td', { text: o.ndvi === null ? '–' : num(o.ndvi, 2) }), el('td', { text: o.ndmi === null ? '–' : num(o.ndmi, 2) }),
            el('td', { text: o.accepted ? 'użyta' : (o.reject_reason || 'odrzucona') }))))))));
    }

    add(section, el('h4', { text: 'Podatność na niedobory w ostatnich 10 latach' }));
    const history = report.history;
    add(section, statusNote(history), ...paragraphs(history.text));
    if (history.seasons && history.seasons.length) {
      const maxDays = Math.max(1, ...history.seasons.map((s) => s.stress_days_critical));
      add(section, el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { text: 'Sezon' }), el('th', { text: 'Okres krytyczny' }),
          el('th', { text: 'Dni stresu w okresie krytycznym' }), el('th', { class: 'num', text: 'Najdłużej z rzędu' }),
          el('th', { class: 'num', text: 'Największy ubytek zapasu' }))),
        el('tbody', null, ...history.seasons.map((s) => el('tr', null,
          el('td', { text: s.season + (s.complete ? '' : ' (trwa)') }),
          el('td', { text: dateText(s.critical_from).slice(0, 5) + '–' + dateText(s.critical_to).slice(0, 5) }),
          el('td', null, el('span', { class: 'bar-cell', style: 'width:' + Math.round(120 * s.stress_days_critical / maxDays) + 'px' }), String(s.stress_days_critical)),
          el('td', { class: 'num', text: s.longest_stress_run_days + ' dni' }),
          el('td', { class: 'num', text: num(s.max_depletion_pct_taw) + '%' })))))));
    }
    if (ws.last_season) add(section, el('h4', { text: 'Miniony sezon' }), el('p', { text: ws.last_season.text }));
    return section;
  }

  function causeNode(cause) {
    return el('div', { class: 'cause' }, el('strong', { text: cause.title }), el('span', { text: cause.text }));
  }
  function causesSection(report) {
    const causes = report.causes;
    const section = el('section', { id: 'sec-causes' }, el('h3', null, el('span', { class: 'order', text: '2.' }), 'Przyczyny niedoboru'));
    if (causes.status !== 'ok') { add(section, statusNote(causes)); return section; }
    if (causes.reason) add(section, el('p', { text: causes.reason }));
    add(section, el('div', { id: 'causes-list' }, ...causes.items.map(causeNode)), el('div', { id: 'causes-terrain' }));
    if (causes.windows.length) {
      add(section, el('h4', { text: 'Opad i parowanie na tle 10 lat' }), el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { text: 'Okres przed datą' }), el('th', { class: 'num', text: 'Opad' }),
          el('th', { class: 'num', text: 'Mediana opadu z 10 lat' }), el('th', { class: 'num', text: 'ET0 (parowanie wskaźnikowe)' }),
          el('th', { class: 'num', text: 'Mediana ET0 z 10 lat' }))),
        el('tbody', null, ...causes.windows.map((w) => el('tr', null,
          el('td', { text: w.days + ' dni' }),
          el('td', { class: 'num', text: num(w.rain_mm) + ' mm' + (w.rain_pct_of_median === null ? '' : ' (' + num(w.rain_pct_of_median) + '%)') }),
          el('td', { class: 'num', text: w.rain_median_mm === null ? '–' : num(w.rain_median_mm) + ' mm' }),
          el('td', { class: 'num', text: num(w.et0_mm) + ' mm' + (w.et0_pct_of_median === null ? '' : ' (' + num(w.et0_pct_of_median) + '%)') }),
          el('td', { class: 'num', text: w.et0_median_mm === null ? '–' : num(w.et0_median_mm) + ' mm' })))))));
    }
    add(section, el('div', { id: 'terrain-block' }));
    if (causes.not_assessed.length) {
      add(section, el('h4', { text: 'Czego nie dało się ocenić' }), el('ul', { class: 'plain', id: 'not-assessed' }, ...causes.not_assessed.map((t) => el('li', { text: t }))));
    }
    const hydro = report.hydrology;
    add(section, el('h4', { text: 'Wody w otoczeniu działki' }), statusNote(hydro), ...paragraphs(hydro.text));
    return section;
  }

  function recNode(rec) {
    return el('div', { class: 'rec' + (rec.category === 'field_check' ? ' check' : '') }, el('h4', { text: rec.title }),
      el('dl', null, el('dt', { text: 'Co zrobić' }), el('dd', { text: rec.what }),
        el('dt', { text: 'Gdzie' }), el('dd', { text: rec.where }),
        el('dt', { text: 'Dlaczego' }), el('dd', { text: rec.why }),
        el('dt', { text: 'Pewność' }), el('dd', { text: rec.confidence + ' – ' + rec.confidence_reason })));
  }
  function recsSections(report) {
    const recs = report.recommendations;
    const out = [];
    const make = (order, title, id, list, emptyText, extra) => {
      const section = el('section', { id }, el('h3', null, el('span', { class: 'order', text: order }), title));
      if (recs.status !== 'ok') { add(section, statusNote(recs)); return section; }
      add(section, el('div', { class: 'card-list', id: id + '-list' }, ...list.map(recNode)));
      if (!list.length) add(section, el('p', { class: 'small', id: id + '-empty', text: emptyText }));
      if (extra) add(section, extra);
      return section;
    };
    out.push(make('3.', 'Rekomendacje retencyjne', 'sec-retention', recs.retention,
      'Dane tej działki nie wskazują teraz działania retencyjnego.'));
    out.push(make('4.', 'Rekomendacje agrotechniczne', 'sec-agro', recs.agrotechnical,
      'Dane tej działki nie wskazują teraz zmiany w agrotechnice.'));
    out.push(make('5.', 'Nawadnianie (opcjonalne)', 'sec-irrigation', recs.irrigation,
      recs.irrigation_note || 'Nawadnianie nie jest teraz uzasadnione danymi.',
      recs.irrigation.length && recs.irrigation_note ? el('p', { class: 'small', text: recs.irrigation_note }) : null));
    if (recs.status === 'ok' && recs.field_checks.length) {
      out.push(el('section', { id: 'sec-checks' }, el('h3', { text: 'Co sprawdzić na polu' }),
        el('p', { class: 'small', text: 'Tam, gdzie dane nie rozstrzygają, zamiast rekomendacji podajemy, co obejrzeć i gdzie.' }),
        el('div', { class: 'card-list', id: 'sec-checks-list' }, ...recs.field_checks.map(recNode))));
    }
    return out;
  }

  function soilSection(report) {
    const soil = report.soil;
    const section = el('section', { id: 'sec-soil' }, el('h3', { text: 'Gleba działki (uzasadnienie bilansu)' }));
    add(section, statusNote(soil), ...paragraphs(soil.text));
    if (soil.layers && soil.layers.length) {
      add(section, ...soil.layers.map((layer) => el('div', { class: 'soil-layer' },
        layer.image ? el('img', { src: layer.image, alt: 'Ilustracja warstwy: ' + layer.texture_label, loading: 'lazy' }) : el('div'),
        el('div', null,
          el('div', { class: 'depth', text: layer.top_cm + '–' + layer.bottom_cm + ' cm · ' + layer.texture_label + ' (USDA: ' + layer.texture_usda + ')' }),
          el('div', { text: 'piasek ' + num(layer.sand_pct, 1) + '%, pył ' + num(layer.silt_pct, 1) + '%, ił ' + num(layer.clay_pct, 1) + '%'
            + (layer.soc_g_kg === null ? '' : ' · węgiel organiczny ' + num(layer.soc_g_kg, 1) + ' g/kg')
            + (layer.bulk_density_g_cm3 === null ? '' : ' · gęstość ' + num(layer.bulk_density_g_cm3, 2) + ' g/cm³') }),
          el('div', { class: 'small', text: 'pojemność polowa ' + num(layer.field_capacity_vol_pct, 1) + '%, punkt więdnięcia '
            + num(layer.wilting_point_vol_pct, 1) + '% obj. → ' + num(layer.available_water_mm) + ' mm wody dostępnej w tej warstwie'
            + (layer.sand_pct_range ? ' · przedział 5–95%: piasek ' + num(layer.sand_pct_range[0]) + '–' + num(layer.sand_pct_range[1])
              + '%, ił ' + num(layer.clay_pct_range[0]) + '–' + num(layer.clay_pct_range[1]) + '%' : '') })))));
      add(section, el('p', { class: 'small', text: 'Ilustracje warstw są umowne (dobrane po klasie uziarnienia), nie są zdjęciem gleby z tej działki.' }));
    }
    return section;
  }

  function sourcesSection(report) {
    const section = el('section', { id: 'sec-sources' }, el('h3', { text: 'Źródła danych i daty' }));
    add(section, el('div', { class: 'table-wrap' }, el('table', null,
      el('thead', null, el('tr', null, ...['Źródło', 'Stan', 'Dane z okresu', 'Rozdzielczość', 'Uwagi'].map((t) => el('th', { text: t })))),
      el('tbody', { id: 'sources-body' }, ...report.sources.map(sourceRow)))));
    add(section, el('p', { class: 'small', text: 'Raport wygenerowano ' + new Date(report.generated_at).toLocaleString('pl-PL')
      + ' w ' + num(report.elapsed_s, 1) + ' s. Wszystkie wartości policzono na żywo z danych pobranych dla tej działki i daty.' }));
    return section;
  }
  function sourceRow(s) {
    const period = s.data_from ? dateText(s.data_from) + '–' + dateText(s.data_to) : (s.data_date || '–');
    const notes = [s.reason, s.impact, ...(s.notes || []), s.license ? 'Licencja: ' + s.license : null,
      s.elapsed_s === null ? null : 'Czas pobrania: ' + num(s.elapsed_s, 1) + ' s' + (s.from_cache ? ' (z pamięci podręcznej)' : '')].filter(Boolean);
    return el('tr', null, el('td', { text: s.name }), el('td', null, el('span', { class: 'badge ' + s.status, text: STATUS_LABEL[s.status] || s.status })),
      el('td', { text: period }), el('td', { text: s.resolution || '–' }), el('td', null, ...notes.map((n) => el('div', { text: n }))));
  }

  function renderReport(report) {
    const root = $('report');
    const parcel = report.parcel;
    if (parcel) showParcelOnMap(parcel);
    const where = parcel
      ? 'Działka ' + (parcel.number || '') + ', ' + describe(parcel) + ' · ' + num(parcel.area_ha, 2) + ' ha · identyfikator ' + parcel.id
      : 'Punkt ' + num(report.request.point.lat, 4) + '° N, ' + num(report.request.point.lon, 4) + '° E (bez granic działki)';
    const printButton = el('button', { type: 'button', class: 'primary', style: 'width:auto' }, 'Drukuj lub zapisz jako PDF');
    printButton.addEventListener('click', () => window.print());
    const head = el('div', { class: 'report-head' },
      el('h2', { text: 'Raport wodny: ' + report.crop.name + ', ' + dateText(report.analysis_date) }),
      el('p', { class: 'meta', text: where }),
      ...paragraphs(report.summary),
      el('div', { class: 'actions' }, printButton, el('small', { text: 'W oknie drukowania wybierz drukarkę „Zapisz jako PDF”.' })));
    const limitations = el('section', { id: 'sec-limits' }, el('h3', { text: 'Ograniczenia i niepewność' }),
      el('ul', { class: 'plain', id: 'limits-list' }, ...report.limitations.map((t) => el('li', { text: t }))));
    const cropBox = el('section', { id: 'sec-crop' }, el('h3', { text: 'Założenia o uprawie' }),
      el('p', { text: report.crop.name + ': sezon ' + dateText(report.crop.season_from) + '–' + dateText(report.crop.season_to)
        + ', okres krytyczny dla plonu ' + dateText(report.crop.critical_from) + '–' + dateText(report.crop.critical_to) + '.' }),
      el('div', { class: 'table-wrap' }, el('table', null, el('tbody', null, ...report.crop.parameters.map((p) => el('tr', null,
        el('td', { text: p.name }), el('td', { text: p.value }), el('td', { class: 'small', text: p.source })))))),
      el('ul', { class: 'plain' }, ...report.crop.assumptions.map((t) => el('li', { class: 'small', text: t }))));
    root.replaceChildren(head, waterSection(report), causesSection(report), ...recsSections(report),
      soilSection(report), cropBox, sourcesSection(report), limitations);
    root.hidden = false;
    setTimeout(() => map.updateSize(), 50);
  }

  // ---------- teren i spływ (dociągane po raporcie) ----------
  async function loadTerrain(report) {
    const block = $('terrain-block');
    if (!block) return;
    block.replaceChildren(el('h4', { text: 'Teren i drogi spływu wody' }),
      el('p', { class: 'status-note', id: 'terrain-wait', text: 'Liczę spadki i drogi spływu z numerycznego modelu terenu (zwykle 15–30 s)…' }));
    let terrain;
    try {
      terrain = await getJson(report.terrain.endpoint);
    } catch (error) {
      terrain = { status: 'error', reason: error.message, text: [], causes: [], recommendations: [], limitations: [] };
    }
    if (state.report !== report) return;  // w międzyczasie powstał nowy raport
    block.replaceChildren();
    add(block, el('h4', { text: 'Teren i drogi spływu wody' }), statusNote(terrain), ...paragraphs(terrain.text));
    if (terrain.source && $('sources-body')) $('sources-body').append(sourceRow(terrain.source));
    if (terrain.status !== 'ok') return;
    for (const collection of [terrain.flow_paths, terrain.crossings]) {
      if (collection) terrainSource.addFeatures(geojson.readFeatures(collection, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
    }
    const legend = $('map-legend');
    legend.replaceChildren(
      el('span', null, el('i', { style: 'background:#35b6ff' }), 'droga spływu (powyżej ' + num(terrain.threshold_ha, 2) + ' ha zlewni)'),
      el('span', null, el('i', { class: 'dot', style: 'background:#1d6fd1' }), 'woda wpływa na działkę'),
      el('span', null, el('i', { class: 'dot', style: 'background:#d1331d' }), 'woda wypływa z działki'),
      el('span', { text: 'liczby: powierzchnia zasilająca punkt [ha], nie objętość wody' }));
    legend.hidden = false;
    if ($('causes-terrain')) $('causes-terrain').append(...terrain.causes.map(causeNode));
    const list = $('sec-retention-list');
    if (list && terrain.recommendations.length) {
      list.append(...terrain.recommendations.filter((r) => r.category === 'retention').map(recNode));
      const empty = $('sec-retention-empty');
      if (empty) empty.remove();
    }
    const checks = terrain.recommendations.filter((r) => r.category === 'field_check');
    if (checks.length && $('sec-checks-list')) $('sec-checks-list').append(...checks.map(recNode));
    if ($('limits-list')) $('limits-list').append(...(terrain.limitations || []).map((t) => el('li', { text: t })));
  }

  init();
})();
