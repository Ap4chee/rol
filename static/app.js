/* Frontend raportu. Zasada: przeglądarka tylko rysuje to, co zwróciło API (bez własnych obliczeń i wniosków).
   Napisy z API trafiają do strony wyłącznie przez textContent (pomocnik el), nigdy przez innerHTML. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const FULL_ID = /^\d{6}_\d\.\d{4}\.(AR_\d+\.)?[0-9A-Za-z\/._-]+$/;
  const STATUS_LABEL = { ok: 'Dane są', no_data: 'Brak danych', error: 'Błąd źródła', pending: 'W toku' };
  const LEVELS = ['none', 'watch', 'moderate', 'severe'];
  const LEVEL_ICON = { none: 'check', watch: 'eye', moderate: 'warn', severe: 'stop' };
  const CAUSE_ICON = { rain_deficit: 'rain', high_et0: 'sun', low_soil_capacity: 'layers', high_demand_stage: 'sprout', carry_over: 'history' };
  const CONFIDENCE_BARS = { wysoka: 3, 'średnia': 2, niska: 1 };
  const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const state = { parcel: null, point: null, report: null, timer: null, charts: [], reopened: [] };

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
    return add(node, ...children);
  }
  function add(parent, ...nodes) {
    for (const node of nodes.flat()) {
      if (node === null || node === undefined || node === false) continue;
      parent.append(node.nodeType ? node : document.createTextNode(String(node)));
    }
    return parent;
  }
  function svg(tag, attrs, ...children) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  // Ikony: własne proste rysunki liniowe (siatka 24 × 24), zawsze obok napisu, nigdy zamiast niego.
  const ICONS = {
    drop: [['path', { d: 'M12 3.5c0 0-6.5 7-6.5 11.5a6.5 6.5 0 0 0 13 0C18.5 10.5 12 3.5 12 3.5z' }]],
    check: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M8 12.5l3 3 5-6' }]],
    eye: [['path', { d: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z' }], ['circle', { cx: 12, cy: 12, r: 2.8 }]],
    warn: [['path', { d: 'M12 4l9 15.5H3z' }], ['path', { d: 'M12 10v4.5' }], ['path', { d: 'M12 17.1v.4' }]],
    stop: [['path', { d: 'M8.3 3.5h7.4l4.8 4.8v7.4l-4.8 4.8H8.3l-4.8-4.8V8.3z' }], ['path', { d: 'M12 8v5' }], ['path', { d: 'M12 16.1v.4' }]],
    info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v5.5' }], ['path', { d: 'M12 7.5v.4' }]],
    question: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.9' }], ['path', { d: 'M12 16.8v.4' }]],
    pin: [['path', { d: 'M12 21s-6.5-6.3-6.5-11a6.5 6.5 0 0 1 13 0c0 4.7-6.5 11-6.5 11z' }], ['circle', { cx: 12, cy: 10, r: 2.3 }]],
    area: [['path', { d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' }]],
    hash: [['path', { d: 'M9.5 4l-2 16M16.5 4l-2 16M4.5 9h16M3.5 15h16' }]],
    calendar: [['rect', { x: 4, y: 5, width: 16, height: 15, rx: 2 }], ['path', { d: 'M4 10h16M8 3v4M16 3v4' }]],
    sprout: [['path', { d: 'M12 21V11' }], ['path', { d: 'M12 13.5c0-4-2.8-6.5-7-6.5 0 4 2.8 6.5 7 6.5z' }], ['path', { d: 'M12 11c0-3.5 2.5-5.5 6.5-5.5 0 3.500-2.500 5.500-6.500 5.500z' }]],
    printer: [['path', { d: 'M7 8V4h10v4' }], ['rect', { x: 4, y: 8, width: 16, height: 8, rx: 2 }], ['path', { d: 'M7 14h10v6H7z' }]],
    orbit: [['circle', { cx: 12, cy: 12, r: 3.4 }], ['ellipse', { cx: 12, cy: 12, rx: 10, ry: 4.4, transform: 'rotate(-30 12 12)' }]],
    history: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3.5 2' }]],
    rain: [['path', { d: 'M7 16h10a4 4 0 0 0 .6-7.960A5.500 5.500 0 0 0 7 7a4.500 4.500 0 0 0 0 9z' }], ['path', { d: 'M9 19.5l-.8 1.600M13 19.500l-.800 1.600M17 19.500l-.800 1.600' }]],
    sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.800 1.800M16.900 16.900l1.800 1.800M5.300 18.700l1.800-1.800M16.900 7.100l1.800-1.800' }]],
    layers: [['path', { d: 'M12 3l9 5-9 5-9-5z' }], ['path', { d: 'M3 12.5l9 5 9-5' }], ['path', { d: 'M3 17l9 5 9-5' }]],
    mountain: [['path', { d: 'M2.5 19.5l6.5-11 4 6.500 2.500-3.500 6 8z' }]],
    waves: [['path', { d: 'M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0' }], ['path', { d: 'M3 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0' }], ['path', { d: 'M3 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0' }]],
    database: [['ellipse', { cx: 12, cy: 6, rx: 7, ry: 3 }], ['path', { d: 'M5 6v12c0 1.7 3.1 3 7 3s7-1.300 7-3V6' }], ['path', { d: 'M5 12c0 1.700 3.100 3 7 3s7-1.300 7-3' }]],
    shield: [['path', { d: 'M12 3l7.5 3v5.500c0 4.500-3 8-7.500 9.500-4.500-1.500-7.500-5-7.500-9.500V6z' }], ['path', { d: 'M12 8.5V13' }], ['path', { d: 'M12 16v.4' }]],
    clipboard: [['rect', { x: 5, y: 5, width: 14, height: 16, rx: 2 }], ['path', { d: 'M9 5V3.5h6V5' }], ['path', { d: 'M9 13l2.2 2.200L15.500 11' }]],
    spinner: [['path', { d: 'M12 3a9 9 0 1 0 9 9' }]],
    chart: [['path', { d: 'M4 19.500h16' }], ['path', { d: 'M5.500 15l4.500-4.500 3 3 5.500-6.500' }]],
  };
  function icon(name, extraClass) {
    const shapes = ICONS[name] || ICONS.info;
    return svg('svg', { viewBox: '0 0 24 24', class: 'icon' + (extraClass ? ' ' + extraClass : ''), 'aria-hidden': 'true', focusable: 'false' },
      shapes.map(([tag, attrs]) => svg(tag, attrs)));
  }

  const missing = (value) => value === null || value === undefined;
  const num = (value, digits = 0) => (value === null || value === undefined) ? '–'
    : Number(value).toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const dateText = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('.') : '–';
  const paragraphs = (lines) => (lines || []).map((line) => el('p', { text: line }));
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  // Komunikat o stanie sekcji: zawsze z nazwą stanu i powodem podanym przez API.
  function statusNote(section, fallback) {
    if (!section || section.status === 'ok') return null;
    const kind = section.status === 'error' ? ' error' : section.status === 'pending' ? ' pending' : '';
    const symbol = section.status === 'error' ? 'stop' : section.status === 'pending' ? 'spinner' : 'question';
    return el('div', { class: 'note' + kind }, icon(symbol),
      el('p', null, el('strong', { text: (STATUS_LABEL[section.status] || section.status) + ': ' }), section.reason || fallback || ''));
  }
  function subheading(iconName, text) {
    return el('h4', null, icon(iconName), text);
  }

  // ---------- mapa ----------
  const parcelSource = new ol.source.Vector();
  const terrainSource = new ol.source.Vector();
  const OVERVIEW_MAX_ZOOM = 9;  // poniżej tego przybliżenia zamiast zdjęcia lotniczego pokazujemy mapę przeglądową
  const orto = new ol.layer.Tile({
    minZoom: OVERVIEW_MAX_ZOOM,
    source: new ol.source.TileWMS({
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution',
      params: { LAYERS: 'Raster', FORMAT: 'image/jpeg', VERSION: '1.3.0' },
      attributions: 'Ortofotomapa: © GUGiK (geoportal.gov.pl)',
    }),
  });
  const osm = new ol.layer.Tile({ source: new ol.source.OSM(), maxZoom: OVERVIEW_MAX_ZOOM });
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
      // dopływ = niebieskie koło, odpływ = pomarańczowy kwadrat: różnią się kształtem, nie tylko kolorem
      const inflow = kind === 'inflow';
      const stroke = new ol.style.Stroke({ color: '#fff', width: 2.5 });
      return new ol.style.Style({
        image: inflow
          ? new ol.style.Circle({ radius: 8, fill: new ol.style.Fill({ color: '#0369A1' }), stroke })
          : new ol.style.RegularShape({ points: 4, radius: 10, angle: Math.PI / 4, fill: new ol.style.Fill({ color: '#C2410C' }), stroke }),
        text: new ol.style.Text({
          text: feature.get('label') || '', offsetY: -22, font: '700 14px "Source Sans 3", system-ui, sans-serif',
          fill: new ol.style.Fill({ color: '#111827' }),
          backgroundFill: new ol.style.Fill({ color: 'rgba(255,255,255,0.94)' }),
          backgroundStroke: new ol.style.Stroke({ color: '#475569', width: 1 }), padding: [2, 6, 1, 6],
        }),
      });
    }
    return [
      new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.85)', width: (Number(feature.get('width')) || 2) + 2.5 }) }),
      new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#0284C7', width: Number(feature.get('width')) || 2 }) }),
    ];
  }
  const controlDefaults = (ol.control.defaults && ol.control.defaults.defaults) ? ol.control.defaults.defaults : ol.control.defaults;
  const map = new ol.Map({
    target: 'map',
    controls: controlDefaults({ attributionOptions: { collapsible: false } }),
    layers: [
      osm, orto, parcelsWms,
      new ol.layer.Vector({
        source: parcelSource,
        style: [
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#111827', width: 6 }) }),
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#FDE047', width: 3.5 }), fill: new ol.style.Fill({ color: 'rgba(253,224,71,0.10)' }) }),
        ],
      }),
      // drogi spływu i punkty nad obrysem działki, żeby etykiety nie chowały się pod żółtą linią
      new ol.layer.Vector({ source: terrainSource, style: terrainStyle }),
    ],
    view: new ol.View({ center: ol.proj.fromLonLat([19.4, 52.0]), zoom: 6, maxZoom: 20 }),
  });
  map.getView().fit(ol.proj.transformExtent([14.1, 49.0, 24.2, 54.9], 'EPSG:4326', 'EPSG:3857'), { padding: [16, 16, 16, 16] });
  const geojson = new ol.format.GeoJSON();

  document.querySelectorAll('[data-base]').forEach((button) => {
    button.addEventListener('click', () => {
      const base = button.getAttribute('data-base');
      orto.setVisible(base === 'orto');
      osm.setMaxZoom(base === 'orto' ? OVERVIEW_MAX_ZOOM : Infinity);
      document.querySelectorAll('[data-base]').forEach((b) => {
        b.classList.toggle('active', b === button);
        b.setAttribute('aria-pressed', String(b === button));
      });
    });
  });
  $('toggle-parcels').addEventListener('click', () => {
    const on = !parcelsWms.getVisible();
    parcelsWms.setVisible(on);
    $('toggle-parcels').classList.toggle('active', on);
    $('toggle-parcels').setAttribute('aria-pressed', String(on));
  });

  const PARCEL_FIT = { padding: [70, 70, 70, 70], maxZoom: 18 };
  // keepView: gdy ta sama działka jest już na mapie (raport po wyborze działki), nie ruszamy widoku ustawionego przez rolnika
  function showParcelOnMap(parcel, keepView) {
    terrainSource.clear();
    $('map-legend').hidden = true;
    if (!parcel) { parcelSource.clear(); state.shownParcelId = null; return; }
    if (keepView && state.shownParcelId === parcel.id && parcelSource.getFeatures().length) return;
    parcelSource.clear();
    const feature = geojson.readFeature({ type: 'Feature', geometry: parcel.geometry },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
    parcelSource.addFeature(feature);
    state.shownParcelId = parcel.id;
    map.getView().fit(feature.getGeometry().getExtent(), Object.assign({ duration: reducedMotion() ? 0 : 300 }, PARCEL_FIT));
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
    $('map-hint').hidden = true;
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
        $('parcel-candidates').hidden = true;
        $('parcel-selected').hidden = false;
        $('parcel-selected').textContent = 'Wybrany punkt: ' + num(lat, 4) + '° N, ' + num(lon, 4) + '° E (bez granic działki)';
        $('submit').disabled = false;
        $('map-hint').hidden = true;
        setMessage('parcel-message', 'Usługa działek nie odpowiada (' + (result.reason || '') + '). Raport policzymy dla wskazanego punktu.', true);
        return;
      }
      setMessage('parcel-message', result.reason || 'W tym miejscu nie ma działki.', true);
    } catch (error) {
      setMessage('parcel-message', error.message, true);
    }
  });

  // ---------- formularz ----------
  function setLoading(on) {
    $('progress-panel').classList.toggle('is-loading', on);
    $('report').setAttribute('aria-busy', String(on));
    $('submit').disabled = on || !(state.parcel || state.point);
  }
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
    clearInterval(state.timer);
    setLoading(true);
    // komunikat dla czytnika ekranu pada raz; licznik sekund jest tylko wizualny, żeby nie był odczytywany co pół sekundy
    setMessage('progress', 'Pobieram dane i liczę bilans wodny (zwykle do 30 s)…');
    const tick = () => { $('progress-timer').textContent = 'Minęło ' + Math.round((Date.now() - started) / 1000) + ' s'; };
    tick(); state.timer = setInterval(tick, 500);
    try {
      const report = await getJson('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      clearInterval(state.timer);
      $('progress-timer').textContent = '';
      setMessage('progress', 'Raport gotowy po ' + num((Date.now() - started) / 1000, 1) + ' s.');
      state.report = report;
      renderReport(report);
      const heading = $('report-title');
      $('report').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      if (heading) heading.focus({ preventScroll: true });
      if (report.satellite && report.satellite.status === 'pending' && report.satellite.endpoint) loadSatellite(report);
      if (report.terrain && report.terrain.status === 'pending' && report.terrain.endpoint) loadTerrain(report);
    } catch (error) {
      clearInterval(state.timer);
      $('progress-timer').textContent = '';
      setMessage('progress', error.message, true);
    } finally {
      setLoading(false);
    }
  });

  // ---------- sytuacja wodna ----------
  function verdict(report) {
    const ws = report.water_status;
    const level = LEVELS.indexOf(ws.class_key);
    const box = el('div', { class: 'verdict ' + (level >= 0 ? ws.class_key : '') },
      el('span', { class: 'verdict-icon' }, icon(LEVEL_ICON[ws.class_key] || 'question')),
      el('div', null, el('strong', { text: ws.headline }),
        el('span', { class: 'verdict-meta', text: 'Stan na ' + dateText(ws.last_data_day) + ' · ' + report.crop.name
          + (report.crop.stage_name ? ' · ' + report.crop.stage_name : '') })));
    if (level >= 0) {
      add(box, el('div', { class: 'scale' },
        el('span', { class: 'scale-dots', 'aria-hidden': 'true' }, LEVELS.map((key, i) => el('i', { class: i <= level ? 'on' : null }))),
        el('span', { text: 'Poziom ' + (level + 1) + ' z ' + LEVELS.length })));
    }
    return box;
  }

  function tile(label, value, unit, sub) {
    return el('div', { class: 'tile' }, el('div', { class: 'tile-label', text: label }),
      el('div', { class: 'tile-value' }, value, unit ? el('small', { text: unit }) : null),
      sub ? el('div', { class: 'tile-sub', text: sub }) : null);
  }
  function tiles(ws) {
    const r = ws.result;
    if (!r) return null;
    const cwb = ws.climatic_water_balance;
    return el('div', { class: 'tiles' },
      tile('Woda dostępna teraz', num(r.available_mm), 'mm', 'z ' + num(r.taw_mm) + ' mm możliwych (TAW)'),
      tile('Ubytek wody', num(r.depletion_mm), 'mm', num(r.depletion_pct_taw) + '% zapasu'),
      tile('Próg stresu (RAW)', num(r.raw_mm), 'mm', 'powyżej tego ubytku roślinom trudno pobierać wodę'),
      cwb ? tile('Opad minus parowanie', num(cwb.balance_mm), 'mm', 'z ' + cwb.days + ' dni: opad ' + num(cwb.rain_mm) + ' mm, ET0 ' + num(cwb.et0_mm) + ' mm') : null);
  }

  // Wskaźnik: położenie ubytku wody na osi od pełnego zapasu (0) do braku wody dostępnej (TAW).
  function gauge(result) {
    const taw = result.taw_mm || 1;
    const fill = Math.min(100, Math.max(0, 100 * result.depletion_mm / taw));
    const raw = Math.min(100, Math.max(0, 100 * result.raw_mm / taw));
    const labelClass = 'marker-label' + (fill < 14 ? ' at-start' : fill > 86 ? ' at-end' : '');
    const bar = el('div', { class: 'bar' },
      // opisy stref stoją przy końcach paska; znikają, gdy strefa jest za wąska albo zasłoniłby je znacznik
      el('div', { class: 'zone safe', style: 'width:' + raw + '%' }, raw >= 22 && fill > 16 ? 'bez stresu' : null),
      el('div', { class: 'zone stress', style: 'left:' + raw + '%;width:' + (100 - raw) + '%' }, (100 - raw) >= 22 && fill < 84 ? 'niedobór' : null),
      el('div', { class: 'marker', style: 'left:' + fill + '%' }),
      el('div', { class: labelClass, style: 'left:' + fill + '%', text: 'teraz: ' + num(result.depletion_mm) + ' mm' }));
    const rawTick = Math.min(78, Math.max(20, raw));
    return el('div', { class: 'gauge', role: 'img',
      'aria-label': 'Ubytek wody ' + num(result.depletion_mm) + ' mm z ' + num(result.taw_mm) + ' mm, próg stresu ' + num(result.raw_mm) + ' mm' },
      el('p', { class: 'gauge-title', text: 'Ile wody ubyło ze strefy korzeni: ' + num(result.depletion_mm) + ' mm (' + num(result.depletion_pct_taw) + '% zapasu)' }),
      bar,
      el('div', { class: 'ticks', 'aria-hidden': 'true' },
        el('span', { class: 't-start' }, '0 mm', el('br'), 'pełny zapas'),
        el('span', { class: 't-raw', style: 'left:' + rawTick + '%' }, 'próg stresu', el('br'), num(result.raw_mm) + ' mm'),
        el('span', { class: 't-end' }, num(result.taw_mm) + ' mm', el('br'), 'brak wody dostępnej')));
  }

  // Wykres liniowy (inline SVG): ubytek wody na tle progu stresu oraz opad dobowy w osobnym pasie.
  // Linie różnią się także krojem (ciągła / przerywana), a strefa niedoboru ma kreskowanie: czytelne bez koloru.
  function drawChart(host, series, forcedWidth) {
    const W = Math.max(320, Math.round(forcedWidth || host.clientWidth || 760));
    const compact = W < 560;
    const fs = compact ? 11 : 12.5;
    const L = compact ? 38 : 50, R = compact ? 10 : 16;
    const rainTop = 22, rainH = compact ? 42 : 54;
    const mainTop = rainTop + rainH + 30, mainH = compact ? 170 : 220;
    const H = mainTop + mainH + 34;
    const n = series.length;
    const taw = Math.max(...series.map((d) => d.taw_mm), 1);
    const maxRain = Math.max(10, ...series.map((d) => d.rain_mm));
    const x = (i) => L + (W - L - R) * i / (n - 1);
    const y = (mm) => mainTop + mainH * Math.min(Math.max(mm, 0), taw) / taw;
    const pid = 'hatch-' + Math.random().toString(36).slice(2, 8);
    const first = series[0], last = series[n - 1];
    const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'font-size': fs,
      'aria-label': 'Wykres od ' + dateText(first.date) + ' do ' + dateText(last.date) + ': ubytek wody w strefie korzeni na tle progu stresu oraz opad dobowy. '
        + 'Ostatni dzień: ubytek ' + num(last.depletion_mm) + ' mm, próg stresu ' + num(last.raw_mm) + ' mm.' });
    root.append(svg('defs', null, svg('pattern', { id: pid, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      svg('rect', { width: 7, height: 7, fill: '#FFEDD5' }), svg('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: '#C2410C', 'stroke-opacity': 0.45, 'stroke-width': 2 }))));

    // pas opadu
    root.append(svg('text', { x: L, y: rainTop - 8, fill: '#334155', 'font-weight': 600 }, 'Opad dobowy [mm]'));
    root.append(svg('line', { x1: L, x2: W - R, y1: rainTop + rainH, y2: rainTop + rainH, stroke: '#64748B' }));
    root.append(svg('line', { x1: L, x2: W - R, y1: rainTop, y2: rainTop, stroke: '#CBD5E1', 'stroke-dasharray': '2 4' }));
    root.append(svg('text', { x: L - 6, y: rainTop + 4, 'text-anchor': 'end', fill: '#475569' }, num(maxRain)));
    root.append(svg('text', { x: L - 6, y: rainTop + rainH + 4, 'text-anchor': 'end', fill: '#475569' }, '0'));
    const barW = Math.max(1.4, Math.min(4, (W - L - R) / n * 0.7));
    series.forEach((d, i) => {
      if (d.rain_mm > 0.05) {
        const h = rainH * d.rain_mm / maxRain;
        root.append(svg('rect', { x: (x(i) - barW / 2).toFixed(1), y: (rainTop + rainH - h).toFixed(1), width: barW.toFixed(1), height: h.toFixed(1), fill: '#0284C7' }));
      }
    });

    // pas ubytku wody
    const rawLine = series.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d.raw_mm).toFixed(1)).join(' ');
    root.append(svg('text', { x: L, y: mainTop - 8, fill: '#334155', 'font-weight': 600 }, 'Ubytek wody w strefie korzeni [mm]'));
    root.append(svg('path', { d: rawLine + ' L' + x(n - 1).toFixed(1) + ' ' + mainTop + ' L' + x(0).toFixed(1) + ' ' + mainTop + ' Z', fill: '#DCFCE7' }));
    root.append(svg('path', { d: rawLine + ' L' + x(n - 1).toFixed(1) + ' ' + (mainTop + mainH) + ' L' + x(0).toFixed(1) + ' ' + (mainTop + mainH) + ' Z', fill: 'url(#' + pid + ')' }));
    root.append(svg('rect', { x: L, y: mainTop, width: W - L - R, height: mainH, fill: 'none', stroke: '#64748B' }));
    [0, 0.5, 1].forEach((f) => {
      root.append(svg('text', { x: L - 6, y: y(taw * f) + 4, 'text-anchor': 'end', fill: '#475569' }, num(taw * f)));
      if (f === 0.5) root.append(svg('line', { x1: L, x2: W - R, y1: y(taw * f), y2: y(taw * f), stroke: '#94A3B8', 'stroke-opacity': 0.5, 'stroke-dasharray': '2 4' }));
    });
    const rawFirstY = y(first.raw_mm);
    if (rawFirstY - mainTop > 30) {
      root.append(svg('text', { x: L + 8, y: mainTop + 17, fill: '#14532D', 'font-weight': 600 }, compact ? 'bez stresu' : 'woda łatwo dostępna (bez stresu)'));
    }
    if (mainTop + mainH - rawFirstY > 30) {
      root.append(svg('text', { x: L + 8, y: mainTop + mainH - 9, fill: '#7C2D12', 'font-weight': 600, stroke: '#FFF7ED', 'stroke-width': 3, 'paint-order': 'stroke' },
        compact ? 'strefa niedoboru' : 'strefa niedoboru (woda trudno dostępna)'));
    }
    root.append(svg('path', { d: rawLine, fill: 'none', stroke: '#9A3412', 'stroke-width': 1.6, 'stroke-dasharray': '6 4' }));
    root.append(svg('path', {
      d: series.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d.depletion_mm).toFixed(1)).join(' '),
      fill: 'none', stroke: '#111827', 'stroke-width': 2.4, 'stroke-linejoin': 'round',
    }));
    const lastX = x(n - 1), lastY = y(last.depletion_mm);
    root.append(svg('circle', { cx: lastX, cy: lastY, r: 4.5, fill: '#111827', stroke: '#FFFFFF', 'stroke-width': 2 }));
    root.append(svg('text', { x: lastX - 9, y: lastY - mainTop > 26 ? lastY - 10 : lastY + 20, 'text-anchor': 'end', fill: '#111827', 'font-weight': 700,
      stroke: '#FFFFFF', 'stroke-width': 3.5, 'paint-order': 'stroke' }, 'teraz ' + num(last.depletion_mm) + ' mm'));

    // oś czasu: początki miesięcy
    const starts = [];
    series.forEach((d, i) => { if (i > 0 && d.date.slice(0, 7) !== series[i - 1].date.slice(0, 7)) starts.push(i); });
    const skip = compact && starts.length > 5 ? 2 : 1;
    starts.forEach((i, k) => {
      const d = series[i];
      root.append(svg('line', { x1: x(i), x2: x(i), y1: mainTop + mainH, y2: mainTop + mainH + 5, stroke: '#475569' }));
      if (k % skip === 0 && x(i) < W - R - 20) {
        const month = Number(d.date.slice(5, 7));
        const label = MONTHS[month - 1] + (month === 1 || k === 0 ? ' ' + d.date.slice(0, 4) : '');
        root.append(svg('text', { x: x(i) + 2, y: mainTop + mainH + 20, fill: '#475569' }, label));
      }
    });
    host.replaceChildren(root);
  }
  function chartBlock(series) {
    if (!series || series.length < 2) return null;
    const host = el('div', { class: 'chart-host' });
    state.charts.push({ host, series });
    const sample = (draw) => svg('svg', { viewBox: '0 0 30 12', 'aria-hidden': 'true', focusable: 'false' }, draw);
    const legend = el('ul', { class: 'chart-legend' },
      el('li', null, sample(svg('line', { x1: 1, y1: 6, x2: 29, y2: 6, stroke: '#111827', 'stroke-width': 2.6 })), 'ubytek wody (im niżej, tym mniej wody)'),
      el('li', null, sample(svg('line', { x1: 1, y1: 6, x2: 29, y2: 6, stroke: '#9A3412', 'stroke-width': 1.8, 'stroke-dasharray': '6 4' })), 'próg stresu (RAW)'),
      el('li', null, sample([svg('rect', { x: 1, y: 1, width: 28, height: 10, fill: '#FFEDD5', stroke: '#C2410C' }),
        svg('path', { d: 'M5 11l8-10M13 11l8-10M21 11l8-10', stroke: '#C2410C', 'stroke-opacity': 0.6, 'stroke-width': 1.6 })]), 'strefa niedoboru'),
      el('li', null, sample(svg('rect', { x: 12, y: 1, width: 5, height: 10, fill: '#0284C7' })), 'opad dobowy'));
    const rows = [];
    for (let i = series.length - 1; i >= 0; i -= 10) rows.push(series[i]);
    const table = el('details', { class: 'no-print' }, el('summary', { text: 'Pokaż dane wykresu w tabeli (co 10 dni)' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { text: 'Dzień' }), el('th', { class: 'num', text: 'Ubytek wody' }),
          el('th', { class: 'num', text: 'Próg stresu (RAW)' }), el('th', { class: 'num', text: 'Opad tego dnia' }))),
        el('tbody', null, rows.map((d) => el('tr', null, el('td', { text: dateText(d.date) }),
          el('td', { class: 'num', text: num(d.depletion_mm) + ' mm' }), el('td', { class: 'num', text: num(d.raw_mm) + ' mm' }),
          el('td', { class: 'num', text: num(d.rain_mm, 1) + ' mm' })))))));
    return el('div', null, host, legend, table);
  }
  function redrawCharts(forcedWidth) {
    for (const job of state.charts) if (job.host.isConnected) drawChart(job.host, job.series, forcedWidth);
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

  // Blok satelitarny: rysowany z raportu, a przy stanie „pending” jeszcze raz po dociągnięciu zdjęć.
  function satelliteNodes(sat) {
    const nodes = [statusNote(sat), el('div', { class: 'stack' }, paragraphs(sat.text))];
    if (sat.observations && sat.observations.length) {
      nodes.push(el('details', null, el('summary', { text: 'Obserwacje użyte i odrzucone (' + sat.observations.length + ')' }),
        el('div', { class: 'table-wrap' }, el('table', null,
          el('thead', null, el('tr', null, ...['Data', 'Piksele z roślinnością', 'NDVI', 'NDMI', 'Uwagi'].map((t) => el('th', { text: t })))),
          el('tbody', null, ...sat.observations.map((o) => el('tr', null,
            el('td', { text: dateText(o.date) }), el('td', { text: o.valid_pixels + ' z ' + o.total_pixels + ' (' + num(o.coverage_pct) + '%)' }),
            el('td', { text: (o.ndvi === null || o.ndvi === undefined) ? '–' : num(o.ndvi, 2) }),
            el('td', { text: (o.ndmi === null || o.ndmi === undefined) ? '–' : num(o.ndmi, 2) }),
            el('td', { text: o.accepted ? 'użyta' : (o.reject_reason || 'odrzucona') }))))))));
    }
    return nodes;
  }

  function sectionShell(id, order, title, iconName) {
    const badge = order ? el('span', { class: 'order', text: order }) : el('span', { class: 'order plain' }, icon(iconName || 'info'));
    return el('section', { id, class: 'card section' }, el('h3', { class: 'section-title' }, badge, el('span', { text: title })));
  }

  function waterSection(report) {
    const ws = report.water_status;
    const section = sectionShell('sec-water', '1', 'Sytuacja wodna');
    if (ws.status !== 'ok') { add(section, statusNote(ws)); return section; }
    add(section, verdict(report), el('div', { class: 'stack' }, paragraphs(ws.text)), tiles(ws));
    if (ws.result) add(section, gauge(ws.result));
    if (ws.uncertainty_text) add(section, el('div', { class: 'note info' }, icon('info'), el('p', { text: ws.uncertainty_text })));
    add(section, variantsTable(ws.variants));
    if (ws.climatic_water_balance) {
      add(section, subheading('rain', 'Klimatyczny bilans wodny (' + ws.climatic_water_balance.days + ' dni)'), el('p', { text: ws.climatic_water_balance.text }));
    }
    const drawn = chartBlock(ws.series);
    if (drawn) add(section, subheading('chart', 'Przebieg zapasu wody w glebie'), drawn);

    add(section, subheading('orbit', 'Co widać z satelity (Sentinel-2)'),
      el('div', { id: 'satellite-block' }, satelliteNodes(report.satellite)));

    add(section, subheading('history', 'Podatność na niedobory w ostatnich 10 latach'));
    const history = report.history;
    add(section, statusNote(history), el('div', { class: 'stack' }, paragraphs(history.text)));
    if (history.seasons && history.seasons.length) {
      const maxDays = Math.max(1, ...history.seasons.map((s) => s.stress_days_critical));
      add(section, el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { text: 'Sezon' }), el('th', { text: 'Okres krytyczny' }),
          el('th', { text: 'Dni stresu w okresie krytycznym' }), el('th', { class: 'num', text: 'Najdłużej z rzędu' }),
          el('th', { class: 'num', text: 'Największy ubytek zapasu' }))),
        el('tbody', null, ...history.seasons.map((s) => el('tr', { class: s.complete ? null : 'current' },
          el('td', null, el('strong', { text: s.season }), s.complete ? null : el('span', { class: 'sub', text: 'sezon trwa' })),
          el('td', { text: dateText(s.critical_from).slice(0, 5) + '–' + dateText(s.critical_to).slice(0, 5) }),
          el('td', null, el('div', { class: 'bar-cell' },
            el('span', { class: 'track' }, el('span', { class: 'fill', style: 'width:' + Math.round(100 * s.stress_days_critical / maxDays) + '%' })),
            el('span', { class: 'val', text: String(s.stress_days_critical) }))),
          el('td', { class: 'num', text: s.longest_stress_run_days + ' dni' }),
          el('td', { class: 'num', text: num(s.max_depletion_pct_taw) + '%' })))))));
    }
    if (ws.last_season) add(section, subheading('calendar', 'Miniony sezon'), el('p', { text: ws.last_season.text }));
    return section;
  }

  // ---------- przyczyny ----------
  function causeNode(cause, fallbackIcon) {
    return el('div', { class: 'cause' }, icon(CAUSE_ICON[cause.key] || fallbackIcon || 'warn'),
      el('div', null, el('strong', { text: cause.title }), el('span', { text: cause.text })));
  }
  function causesSection(report) {
    const causes = report.causes;
    const section = sectionShell('sec-causes', '2', 'Przyczyny niedoboru');
    if (causes.status !== 'ok') { add(section, statusNote(causes)); return section; }
    if (causes.reason) add(section, el('p', { text: causes.reason }));
    add(section, el('div', { id: 'causes-list' }, ...causes.items.map((c) => causeNode(c))), el('div', { id: 'causes-terrain' }));
    if (causes.windows.length) {
      add(section, subheading('rain', 'Opad i parowanie na tle 10 lat'), el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { text: 'Okres przed datą' }), el('th', { class: 'num', text: 'Opad' }),
          el('th', { class: 'num', text: 'Mediana opadu z 10 lat' }), el('th', { class: 'num', text: 'ET0 (parowanie wskaźnikowe)' }),
          el('th', { class: 'num', text: 'Mediana ET0 z 10 lat' }))),
        el('tbody', null, ...causes.windows.map((w) => el('tr', null,
          el('td', { text: w.days + ' dni' }),
          el('td', { class: 'num' }, num(w.rain_mm) + ' mm', missing(w.rain_pct_of_median) ? null : el('span', { class: 'sub', text: num(w.rain_pct_of_median) + '% mediany' })),
          el('td', { class: 'num', text: missing(w.rain_median_mm) ? '–' : num(w.rain_median_mm) + ' mm' }),
          el('td', { class: 'num' }, num(w.et0_mm) + ' mm', missing(w.et0_pct_of_median) ? null : el('span', { class: 'sub', text: num(w.et0_pct_of_median) + '% mediany' })),
          el('td', { class: 'num', text: missing(w.et0_median_mm) ? '–' : num(w.et0_median_mm) + ' mm' })))))));
    }
    add(section, el('div', { id: 'terrain-block' }));
    if (causes.not_assessed.length) {
      add(section, subheading('question', 'Czego nie dało się ocenić'), el('ul', { class: 'plain', id: 'not-assessed' }, ...causes.not_assessed.map((t) => el('li', { text: t }))));
    }
    const hydro = report.hydrology;
    add(section, subheading('waves', 'Wody w otoczeniu działki'), statusNote(hydro), el('div', { class: 'stack' }, paragraphs(hydro.text)));
    return section;
  }

  // ---------- rekomendacje ----------
  function confidencePill(rec) {
    const bars = CONFIDENCE_BARS[String(rec.confidence || '').toLowerCase()] || 0;
    return el('span', { class: 'confidence' }, el('i', { 'aria-hidden': 'true' }, [1, 2, 3].map((k) => el('b', { class: k <= bars ? 'on' : null }))), rec.confidence);
  }
  function recNode(rec) {
    const kind = rec.category === 'field_check' ? ' check' : rec.category === 'agrotechnical' ? ' agrotechnical' : rec.category === 'irrigation' ? ' irrigation' : '';
    return el('div', { class: 'rec' + kind, 'data-key': rec.key }, el('h4', { text: rec.title }),
      el('dl', null, el('dt', { text: 'Co zrobić' }), el('dd', { text: rec.what }),
        el('dt', { text: 'Gdzie' }), el('dd', { text: rec.where }),
        el('dt', { text: 'Dlaczego' }), el('dd', { text: rec.why }),
        el('dt', { text: 'Pewność' }), el('dd', null, confidencePill(rec), rec.confidence_reason)));
  }
  function recsSections(report) {
    const recs = report.recommendations;
    const out = [];
    const make = (order, title, id, list, emptyText, extra) => {
      const section = sectionShell(id, order, title);
      if (recs.status !== 'ok') { add(section, statusNote(recs)); return section; }
      add(section, el('div', { class: 'card-list', id: id + '-list' }, ...list.map(recNode)));
      if (!list.length) add(section, el('p', { class: 'small', id: id + '-empty', text: emptyText }));
      if (extra) add(section, extra);
      return section;
    };
    out.push(make('3', 'Rekomendacje retencyjne', 'sec-retention', recs.retention,
      'Dane tej działki nie wskazują teraz działania retencyjnego.'));
    out.push(make('4', 'Rekomendacje agrotechniczne', 'sec-agro', recs.agrotechnical,
      'Dane tej działki nie wskazują teraz zmiany w agrotechnice.'));
    out.push(make('5', 'Nawadnianie (opcjonalne)', 'sec-irrigation', recs.irrigation,
      recs.irrigation_note || 'Nawadnianie nie jest teraz uzasadnione danymi.',
      recs.irrigation.length && recs.irrigation_note ? el('p', { class: 'small', text: recs.irrigation_note }) : null));
    if (recs.status === 'ok') {
      // sekcja istnieje zawsze, żeby teren mógł dopisać do niej punkty; pusta jest ukryta
      const checks = sectionShell('sec-checks', null, 'Co sprawdzić na polu', 'clipboard');
      add(checks, el('p', { class: 'small', text: 'Tam, gdzie dane nie rozstrzygają, zamiast rekomendacji podajemy, co obejrzeć i gdzie.' }),
        el('div', { class: 'card-list', id: 'sec-checks-list' }, ...recs.field_checks.map(recNode)));
      checks.hidden = recs.field_checks.length === 0;
      out.push(checks);
    }
    return out;
  }

  // ---------- gleba, uprawa, źródła ----------
  function soilSection(report) {
    const soil = report.soil;
    const section = sectionShell('sec-soil', null, 'Gleba działki (uzasadnienie bilansu)', 'layers');
    add(section, statusNote(soil), el('div', { class: 'stack' }, paragraphs(soil.text)));
    if (soil.layers && soil.layers.length) {
      add(section, el('div', { class: 'soil-profile' }, soil.layers.map((layer) => el('div', { class: 'soil-layer' },
        layer.image ? el('img', { src: layer.image, alt: 'Ilustracja warstwy: ' + layer.texture_label, loading: 'lazy', width: 1200, height: 400 })
          : el('div', { class: 'swatch', 'aria-hidden': 'true' }),
        el('div', null,
          el('div', { class: 'depth', text: layer.top_cm + '–' + layer.bottom_cm + ' cm · ' + layer.texture_label + ' (USDA: ' + layer.texture_usda + ')' }),
          el('div', { text: 'piasek ' + num(layer.sand_pct, 1) + '%, pył ' + num(layer.silt_pct, 1) + '%, ił ' + num(layer.clay_pct, 1) + '%'
            + (missing(layer.soc_g_kg) ? '' : ' · węgiel organiczny ' + num(layer.soc_g_kg, 1) + ' g/kg')
            + (missing(layer.bulk_density_g_cm3) ? '' : ' · gęstość ' + num(layer.bulk_density_g_cm3, 2) + ' g/cm³') }),
          el('div', { class: 'small', text: 'pojemność polowa ' + num(layer.field_capacity_vol_pct, 1) + '%, punkt więdnięcia '
            + num(layer.wilting_point_vol_pct, 1) + '% obj. → ' + num(layer.available_water_mm) + ' mm wody dostępnej w tej warstwie'
            + (layer.sand_pct_range && layer.clay_pct_range ? ' · przedział 5–95%: piasek ' + num(layer.sand_pct_range[0]) + '–' + num(layer.sand_pct_range[1])
              + '%, ił ' + num(layer.clay_pct_range[0]) + '–' + num(layer.clay_pct_range[1]) + '%' : '') }))))));
      add(section, el('p', { class: 'small', text: 'Ilustracje warstw są umowne (dobrane po klasie uziarnienia), nie są zdjęciem gleby z tej działki.' }));
    }
    return section;
  }

  function cropSection(report) {
    const crop = report.crop;
    const section = sectionShell('sec-crop', null, 'Założenia o uprawie', 'sprout');
    if (crop.season_from) {
      add(section, el('p', { text: crop.name + ': sezon ' + dateText(crop.season_from) + '–' + dateText(crop.season_to)
        + ', okres krytyczny dla plonu ' + dateText(crop.critical_from) + '–' + dateText(crop.critical_to) + '.' }));
    }
    if (crop.parameters && crop.parameters.length) {
      add(section, el('div', { class: 'table-wrap' }, el('table', { class: 'stacked' },
        el('thead', null, el('tr', null, ...['Parametr', 'Wartość', 'Skąd pochodzi'].map((t) => el('th', { text: t })))),
        el('tbody', null, ...crop.parameters.map((p) => el('tr', null,
          el('td', { class: 'lead-cell', text: p.name }), el('td', { 'data-label': 'Wartość', text: p.value }),
          el('td', { 'data-label': 'Skąd pochodzi', text: p.source })))))));
    }
    if (crop.assumptions && crop.assumptions.length) {
      add(section, el('ul', { class: 'plain' }, ...crop.assumptions.map((t) => el('li', { class: 'small', text: t }))));
    }
    return section;
  }

  function sourceRow(s) {
    const period = s.data_from ? dateText(s.data_from) + '–' + dateText(s.data_to) : (s.data_date || '–');
    const notes = [s.reason, s.impact, ...(s.notes || []), s.license ? 'Licencja: ' + s.license : null,
      (s.elapsed_s === null || s.elapsed_s === undefined) ? null
        : 'Czas pobrania: ' + num(s.elapsed_s, 1) + ' s' + (s.from_cache ? ' (z pamięci podręcznej)' : '')].filter(Boolean);
    return el('tr', { 'data-key': s.key }, el('td', { class: 'lead-cell', text: s.name }),
      el('td', { 'data-label': 'Stan' }, el('span', { class: 'badge ' + s.status, text: STATUS_LABEL[s.status] || s.status })),
      el('td', { 'data-label': 'Dane z okresu', text: period }), el('td', { 'data-label': 'Rozdzielczość', text: s.resolution || '–' }),
      el('td', { 'data-label': 'Uwagi' }, ...notes.map((n) => el('div', { text: n }))));
  }
  function sourcesSection(report) {
    const section = sectionShell('sec-sources', null, 'Źródła danych i daty', 'database');
    add(section, el('div', { class: 'table-wrap' }, el('table', { class: 'stacked' },
      el('thead', null, el('tr', null, ...['Źródło', 'Stan', 'Dane z okresu', 'Rozdzielczość', 'Uwagi'].map((t) => el('th', { text: t })))),
      el('tbody', { id: 'sources-body' }, ...report.sources.map(sourceRow)))));
    add(section, el('p', { class: 'small', text: 'Raport wygenerowano ' + new Date(report.generated_at).toLocaleString('pl-PL')
      + ' w ' + num(report.elapsed_s, 1) + ' s. Wszystkie wartości policzono na żywo z danych pobranych dla tej działki i daty.' }));
    return section;
  }

  // ---------- raport ----------
  function reportNav(report) {
    const recsOk = report.recommendations.status === 'ok';
    const items = [['sec-water', '1. Sytuacja wodna'], ['sec-causes', '2. Przyczyny'], ['sec-retention', '3. Retencja'],
      ['sec-agro', '4. Agrotechnika'], ['sec-irrigation', '5. Nawadnianie'],
      recsOk ? ['sec-checks', 'Co sprawdzić na polu'] : null,
      ['sec-soil', 'Gleba'], ['sec-sources', 'Źródła danych'], ['sec-limits', 'Ograniczenia']].filter(Boolean);
    return el('nav', { class: 'report-nav no-print', 'aria-label': 'Części raportu' },
      el('ul', null, items.map(([id, text]) => {
        const item = el('li', { id: 'nav-' + id }, el('a', { href: '#' + id, text }));
        if (id === 'sec-checks' && report.recommendations.field_checks.length === 0) item.hidden = true;
        return item;
      })));
  }

  function renderReport(report) {
    const root = $('report');
    const parcel = report.parcel;
    state.charts = [];
    if (parcel) showParcelOnMap(parcel, true);
    const printButton = el('button', { type: 'button', class: 'btn btn-primary' }, icon('printer'), 'Drukuj lub zapisz jako PDF');
    printButton.addEventListener('click', () => window.print());
    const meta = parcel
      ? [el('li', null, icon('pin'), 'Działka ' + (parcel.number || '') + ', ' + describe(parcel)),
        el('li', null, icon('area'), num(parcel.area_ha, 2) + ' ha'),
        el('li', null, icon('hash'), 'identyfikator ' + parcel.id)]
      : [el('li', null, icon('pin'), 'Punkt ' + num(report.request.point.lat, 4) + '° N, ' + num(report.request.point.lon, 4) + '° E (bez granic działki)')];
    const head = el('div', { class: 'card report-head' },
      el('p', { class: 'eyebrow', text: 'Raport wodny' }),
      el('div', { class: 'report-title' },
        el('h2', { id: 'report-title', tabindex: '-1', text: report.crop.name }),
        el('span', { class: 'date-chip' }, icon('calendar'), dateText(report.analysis_date))),
      el('ul', { class: 'meta-list' }, meta),
      el('div', { class: 'summary' }, paragraphs(report.summary)),
      el('div', { class: 'actions' }, printButton, el('small', { text: 'W oknie drukowania wybierz drukarkę „Zapisz jako PDF”.' })));
    const limitations = sectionShell('sec-limits', null, 'Ograniczenia i niepewność', 'shield');
    add(limitations, el('ul', { class: 'plain', id: 'limits-list' }, ...report.limitations.map((t) => el('li', { text: t }))));
    root.replaceChildren(head, reportNav(report), waterSection(report), causesSection(report), ...recsSections(report),
      soilSection(report), cropSection(report), sourcesSection(report), limitations);
    root.hidden = false;
    redrawCharts();
    setTimeout(() => map.updateSize(), 50);
  }

  // ---------- części dociągane po raporcie ----------
  // Wpis źródła: zastępuje wiersz o tym samym kluczu (np. „satellite” ze stanem „liczę”) albo dopisuje nowy.
  function upsertSourceRow(source) {
    const body = $('sources-body');
    if (!body || !source) return;
    const existing = Array.from(body.children).find((row) => row.getAttribute('data-key') === source.key);
    if (existing) existing.replaceWith(sourceRow(source)); else body.append(sourceRow(source));
  }
  // Oględziny pola dopisywane do listy; sekcja i jej pozycja w nawigacji przestają być ukryte.
  function appendFieldChecks(checks) {
    const list = $('sec-checks-list');
    if (!list || !checks || !checks.length) return;
    const known = new Set(Array.from(list.children).map((node) => node.getAttribute('data-key')));
    add(list, checks.filter((rec) => !known.has(rec.key)).map(recNode));
    $('sec-checks').hidden = false;
    if ($('nav-sec-checks')) $('nav-sec-checks').hidden = false;
  }

  // Zdjęcia satelitarne, gdy nie zdążyły się wczytać razem z raportem (wolne łącze do archiwum zdjęć).
  async function loadSatellite(report) {
    let result;
    try {
      result = await getJson(report.satellite.endpoint);
    } catch (error) {
      result = { satellite: { status: 'error', reason: error.message, text: [], observations: [] }, source: null, field_checks: [] };
    }
    if (state.report !== report) return;  // w międzyczasie powstał nowy raport
    const block = $('satellite-block');
    if (block && result.satellite) {
      block.replaceChildren();
      add(block, satelliteNodes(result.satellite));
    }
    upsertSourceRow(result.source);
    appendFieldChecks(result.field_checks);
  }

  // Teren i spływ: liczone osobno, bo wycinek modelu terenu pobiera się kilkanaście sekund.
  async function loadTerrain(report) {
    const block = $('terrain-block');
    if (!block) return;
    block.replaceChildren(subheading('mountain', 'Teren i drogi spływu wody'),
      el('div', { class: 'note pending', id: 'terrain-wait' }, icon('spinner'),
        el('p', { text: 'Liczę spadki i drogi spływu z numerycznego modelu terenu (zwykle 15–30 s)…' })));
    let terrain;
    try {
      terrain = await getJson(report.terrain.endpoint);
    } catch (error) {
      terrain = { status: 'error', reason: error.message, text: [], causes: [], recommendations: [], limitations: [] };
    }
    if (state.report !== report) return;  // w międzyczasie powstał nowy raport
    block.replaceChildren();
    add(block, subheading('mountain', 'Teren i drogi spływu wody'), statusNote(terrain), el('div', { class: 'stack' }, paragraphs(terrain.text)));
    upsertSourceRow(terrain.source);
    if (terrain.status !== 'ok') return;
    for (const collection of [terrain.flow_paths, terrain.crossings]) {
      if (collection) terrainSource.addFeatures(geojson.readFeatures(collection, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
    }
    const legend = $('map-legend');
    legend.replaceChildren(
      el('span', null, el('i', { style: 'background:#0284C7' }), 'droga spływu (powyżej ' + num(terrain.threshold_ha, 2) + ' ha zlewni)'),
      el('span', null, el('i', { class: 'dot', style: 'background:#0369A1' }), 'koło: woda wpływa na działkę'),
      el('span', null, el('i', { class: 'dot square', style: 'background:#C2410C' }), 'kwadrat: woda wypływa z działki'),
      el('span', { class: 'legend-note', text: 'liczby przy punktach: powierzchnia zasilająca punkt [ha], nie objętość wody' }));
    legend.hidden = false;
    if ($('causes-terrain')) add($('causes-terrain'), (terrain.causes || []).map((c) => causeNode(c, 'mountain')));
    const recs = terrain.recommendations || [];
    const list = $('sec-retention-list');
    const retention = recs.filter((r) => r.category === 'retention');
    if (list && retention.length) {
      add(list, retention.map(recNode));
      const empty = $('sec-retention-empty');
      if (empty) empty.remove();
    }
    appendFieldChecks(recs.filter((r) => r.category === 'field_check'));
    if ($('limits-list')) add($('limits-list'), (terrain.limitations || []).map((t) => el('li', { text: t })));
  }

  // ---------- zmiana szerokości i druk ----------
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => redrawCharts(), 150);
  });
  // Mapa w druku: płótno zostaje w rozmiarze ekranowym (zmiana rozmiaru w chwili druku wyczyściłaby je),
  // a arkusz do druku tylko je skaluje. Wymiary ekranowe trafiają do zmiennych CSS przy każdej zmianie rozmiaru.
  const PRINT_MAP_MAX_W = 700;  // px CSS: szerokość kolumny tekstu na A4
  const PRINT_MAP_MAX_H = 420;  // px CSS: ok. 110 mm
  let printing = false;
  function updatePrintMapVars() {
    if (printing) return;
    const size = map.getSize();
    if (!size || !size[0] || !size[1]) return;
    const frame = document.querySelector('.map-frame');
    frame.style.setProperty('--print-map-w', size[0] + 'px');
    frame.style.setProperty('--print-map-h', size[1] + 'px');
    frame.style.setProperty('--print-map-scale', String(Math.min(1, PRINT_MAP_MAX_W / size[0], PRINT_MAP_MAX_H / size[1])));
  }
  map.on('change:size', updatePrintMapVars);
  updatePrintMapVars();

  window.addEventListener('beforeprint', () => {
    // w druku rozwijamy zwinięte tabele (np. obserwacje satelitarne) i rysujemy wykres w szerokości kartki
    printing = true;
    state.reopened = Array.from(document.querySelectorAll('#report details:not([open]):not(.no-print)'));
    state.reopened.forEach((d) => { d.open = true; });
    redrawCharts(PRINT_MAP_MAX_W);
    const view = map.getView();
    if (view.getAnimating()) {
      // druk w trakcie dojazdu mapy do działki: kończymy dojazd od razu
      view.cancelAnimations();
      const feature = parcelSource.getFeatures()[0];
      if (feature) view.fit(feature.getGeometry().getExtent(), PARCEL_FIT);
    }
    map.renderSync();
  });
  window.addEventListener('afterprint', () => {
    printing = false;
    state.reopened.forEach((d) => { d.open = false; });
    state.reopened = [];
    redrawCharts();
    map.updateSize();
    updatePrintMapVars();
  });

  init();
})();
