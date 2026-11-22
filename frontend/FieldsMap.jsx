import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Eyebrow } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { StatusDot } from '@/components/ui/status';
import { cn } from '@/lib/utils';
import { fieldsCount, fieldTeryt, LEVELS, unitRole } from './fieldsMap.js';
import { fieldHref, number } from './model.js';
import { bordersLayer, ortoSource, parcelStyle } from './ParcelMap.jsx';
import { statusTone } from './ui.jsx';

const DURATION_MS = 900;
const PROJ = { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' };
const CHILDREN = ['Województwa', 'Powiaty', 'Gminy'];
const OF_CHILDREN = ['województw', 'powiatów', 'gmin'];                                    // „13 z 16 województw”
const IN_UNITS = [['województwie', 'województwach'], ['powiecie', 'powiatach'], ['gminie', 'gminach']];
const ENTER = 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300 ease-out motion-reduce:animate-none';

// Wygląd jednostki w roli: wypełnienie i obrys [r, g, b, a] (paleta brand/neutral z app.css), obrys w px
// i krycie plakietki z liczbą pól. W przejściu między poziomami każda jednostka płynnie miesza stary wygląd z nowym.
const LOOK = {
  filled: { fill: [141, 197, 159, 1], stroke: [255, 255, 255, 1], width: 1.5, badge: 1 },      // brand-300
  hover: { fill: [94, 166, 118, 1], stroke: [255, 255, 255, 1], width: 1.5, badge: 1 },        // brand-400
  empty: { fill: [219, 219, 212, 1], stroke: [255, 255, 255, 1], width: 1.25, badge: 0 },
  context: { fill: [236, 234, 227, 0], stroke: [214, 214, 207, .9], width: 1, badge: 0 },     // sam cienki kontur, bez tła
  self: { fill: [141, 197, 159, .08], stroke: [37, 92, 59, 1], width: 2.5, badge: 0 },          // obrys brand-700
};
const Z = { context: 0, active: 1, self: 2 };
const hidden = (look) => ({ ...look, fill: [...look.fill.slice(0, 3), 0], stroke: [...look.stroke.slice(0, 3), 0], badge: 0 });
const lerp = (a, b, t) => a + (b - a) * t;

function lookOf(unit, code, hover) {
  const role = unitRole(unit.get('kod'), code);
  if (role !== 'active') return role && LOOK[role];
  return !unit.get('fields').length ? LOOK.empty : unit.get('kod') === hover ? LOOK.hover : LOOK.filled;
}

/** Biała plakietka z liczbą pól w punkcie etykiety; przy wejściu rośnie razem z kryciem. */
function badge(ol, geometry, count, alpha) {
  const scale = .6 + .4 * alpha, radius = (count > 99 ? 15.5 : 12.5) * scale;
  return [
    new ol.style.Style({ geometry, zIndex: 10, image: new ol.style.Circle({ radius: radius + 3.5, fill: new ol.style.Fill({ color: [13, 35, 23, .1 * alpha] }) }) }),
    new ol.style.Style({ geometry, zIndex: 11,
      image: new ol.style.Circle({ radius, fill: new ol.style.Fill({ color: [255, 255, 255, alpha] }),
        stroke: new ol.style.Stroke({ color: [37, 92, 59, alpha], width: 1.5 }) }),
      text: new ol.style.Text({ text: String(count), font: '600 12.5px Inter, sans-serif', scale, offsetY: 1,
        fill: new ol.style.Fill({ color: [31, 75, 49, alpha] }) }) }),
  ];
}

function unitStyle(ol, unit, { from, to, t, hover }) {
  const a = lookOf(unit, from, hover), b = lookOf(unit, to, hover);
  if (!a && !b) return null;
  const start = a ?? hidden(b), end = b ?? hidden(a);
  const z = Z[unitRole(unit.get('kod'), to)] ?? Z[unitRole(unit.get('kod'), from)] ?? 0;
  const styles = [new ol.style.Style({ zIndex: z,
    fill: new ol.style.Fill({ color: start.fill.map((v, i) => lerp(v, end.fill[i], t)) }),
    stroke: new ol.style.Stroke({ color: start.stroke.map((v, i) => lerp(v, end.stroke[i], t)), width: lerp(start.width, end.width, t), lineJoin: 'round' }),
  })];
  const alpha = lerp(start.badge, end.badge, t), count = unit.get('fields').length;
  return count && alpha > .01 ? styles.concat(badge(ol, unit.get('label'), count, alpha)) : styles;
}

/** Pole: zarys działki i znacznik w środku (widać go także wtedy, gdy działka ma kilka pikseli). Tylko w widoku gminy. */
function fieldStyle(ol, feature, byCode, { from, to, t, hover }) {
  const shown = (code) => (code.length === 7 && byCode.get(code)?.get('fields').includes(feature) ? 1 : 0);
  const alpha = lerp(shown(from), shown(to), t);
  if (alpha < .01) return null;
  const marker = feature.get('marker');
  const active = hover === feature.get('field').id;
  const styles = [new ol.style.Style({ geometry: marker, zIndex: 2, image: new ol.style.Circle({
    radius: (active ? 8.5 : 7) * (.6 + .4 * alpha), fill: new ol.style.Fill({ color: [37, 92, 59, alpha] }),
    stroke: new ol.style.Stroke({ color: [255, 255, 255, alpha], width: 2.5 }) }) })];
  if (feature.getGeometry() === marker) return styles;
  return [
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: [255, 255, 255, .9 * alpha], width: 5 }) }),
    new ol.style.Style({ fill: new ol.style.Fill({ color: [62, 138, 89, (active ? .55 : .4) * alpha] }),
      stroke: new ol.style.Stroke({ color: [31, 75, 49, alpha], width: 2 }) }),
    ...styles,
  ];
}

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const unitName = (unit) => (unit.kod.length === 2 ? `województwo ${unit.nazwa}` : unit.nazwa);

/**
 * Mapa pól: Polska → województwo → powiat → gmina. Jednostki z polami są zielone z liczbą pól, bez pól szare;
 * w gminie widać same pola. Poziom jest w adresie (`#mapa/<kod TERYT>`), więc „wstecz” wraca poziom wyżej.
 * Granice z static/mapa (PRG GUGiK, uproszczone przez scripts/build_admin_map.py), województwo doczytywane po wejściu.
 *
 * Z `onPick` ta sama mapa służy do wskazania działki w formularzu: poziom trzyma sama (nie w adresie), przybliża się do każdej
 * jednostki (nie tylko z polami), a w gminie pokazuje zdjęcie lotnicze z granicami działek; kliknięcie w gminie to `onPick`.
 * Wybrana działka (`parcel`) albo punkt (`point`) są zaznaczone, a mapa sama przechodzi do gminy działki.
 */
export function FieldsMap({ code: routeCode = '', fields = [], onAdd, onPick, parcel, point }) {
  const picker = Boolean(onPick);
  const parcelGmina = parcel ? fieldTeryt({ report: { parcel } }) : null;
  const [pickerCode, setPickerCode] = useState(parcelGmina ?? '');
  const code = picker ? pickerCode : routeCode;
  const go = (kod) => { if (picker) setPickerCode(kod); else window.location.hash = kod ? `mapa/${kod}` : 'mapa'; };
  const actions = useRef(null);   // dla zdarzeń mapy, które powstają raz
  actions.current = { go, onPick };
  const target = useRef(null);
  const instance = useRef(null);
  const anim = useRef({ from: '', to: '', t: 1, hover: null });
  const [units, setUnits] = useState([]);   // wczytane jednostki: { kod, nazwa, fields }
  const [error, setError] = useState('');
  const [hover, setHover] = useState(null);
  const [tip, setTip] = useState(null);
  const ol = window.ol;
  const woj = code.slice(0, 2);

  // pola przypisane do jednostek: po kodzie TERYT działki, a bez działki po punkcie w granicy
  // shortcut: punkt tuż przy granicy może trafić do sąsiedniej jednostki (granice uproszczone), dotyczy tylko pól bez działki
  function assign(data) {
    const located = data.fieldSource.getFeatures();
    for (const unit of data.byCode.values()) {
      const kod = unit.get('kod'), geometry = unit.getGeometry();
      unit.set('fields', located.filter((feature) => feature.get('teryt')
        ? feature.get('teryt').startsWith(kod) : geometry.intersectsCoordinate(feature.get('marker').getCoordinates())), true);
    }
    setUnits([...data.byCode.values()].map((unit) => ({ kod: unit.get('kod'), nazwa: unit.get('nazwa'),
      fields: unit.get('fields').map((feature) => feature.get('field')) })));
    data.adminLayer.changed();
  }

  useEffect(() => {
    if (!ol) return;
    const admin = new ol.source.Vector({ attributions: 'Granice: © GUGiK (PRG)' });
    const fieldSource = new ol.source.Vector();
    const byCode = new Map();
    // podkład w gminie: na stronie przygaszony OSM, przy wskazywaniu działki zdjęcie lotnicze z granicami działek
    const overlays = picker
      ? [new ol.layer.Tile({ source: ortoSource(ol), className: 'fields-map-photo', opacity: 0, visible: false }),
        bordersLayer(ol, { className: 'fields-map-borders', opacity: 0, visible: false })]
      : [new ol.layer.Tile({ source: new ol.source.OSM(), className: 'fields-map-base', opacity: 0, visible: false })];
    const pickSource = new ol.source.Vector();
    const adminLayer = new ol.layer.Vector({ source: admin, style: (unit) => unitStyle(ol, unit, anim.current),
      updateWhileAnimating: true, updateWhileInteracting: true });
    const fieldLayer = new ol.layer.Vector({ source: fieldSource, style: (feature) => fieldStyle(ol, feature, byCode, anim.current),
      updateWhileAnimating: true, updateWhileInteracting: true });
    // podkład tylko w granicy wybranej gminy (także gdy wchodzi i wychodzi), poza nią strona zostaje czysta
    const clip = new ol.style.Style({ fill: new ol.style.Fill({ color: '#000' }) });
    for (const layer of overlays) layer.on('postrender', (event) => {
      const gmina = byCode.get([anim.current.to, anim.current.from].find((kod) => kod.length === 7));
      if (!gmina) return;
      event.context.globalCompositeOperation = 'destination-in';
      ol.render.getVectorContext(event).drawFeature(gmina, clip);
      event.context.globalCompositeOperation = 'source-over';
    });
    const controls = ol.control.defaults.defaults ?? ol.control.defaults;
    const interactions = ol.interaction.defaults.defaults ?? ol.interaction.defaults;
    const map = new ol.Map({
      target: target.current,
      layers: [...overlays, adminLayer, fieldLayer, new ol.layer.Vector({ source: pickSource, style: parcelStyle(ol) })],
      controls: controls({ attributionOptions: { collapsible: false } }),
      interactions: interactions({ altShiftDragRotate: false, pinchRotate: false }),
      view: new ol.View({ center: ol.proj.fromLonLat([19.4, 52.0]), zoom: 6, minZoom: 5, maxZoom: 18 }),
    });
    // pod kursorem: pole (warstwa na wierzchu) albo jednostka bieżącego poziomu
    const hit = (pixel) => map.forEachFeatureAtPixel(pixel, (feature, layer) => {
      if (layer === fieldLayer) return { field: feature.get('field') };
      return unitRole(feature.get('kod'), anim.current.to) === 'active' ? { unit: feature } : undefined;
    }, { hitTolerance: 3 });
    map.on('pointermove', (event) => {
      if (event.dragging) return;
      const found = hit(event.pixel);
      const count = found?.unit?.get('fields').length;
      const choosing = picker && anim.current.to.length === 7;   // w gminie kliknięcie wskazuje działkę
      map.getTargetElement().style.cursor = choosing ? 'crosshair' : found?.field || (found?.unit && (picker || count)) ? 'pointer' : '';
      setHover(found?.field?.id ?? found?.unit?.get('kod') ?? null);
      setTip(found ? { x: event.pixel[0], y: event.pixel[1], ...(found.field
        ? { title: found.field.name, text: picker ? 'Pole już dodane' : 'Otwórz raport' }
        : { title: cap(unitName({ kod: found.unit.get('kod'), nazwa: found.unit.get('nazwa') })), text: count ? fieldsCount(count) : 'Brak pól' }) } : null);
    });
    map.on('singleclick', (event) => {
      if (picker && anim.current.to.length === 7) {
        const [lon, lat] = ol.proj.toLonLat(event.coordinate);
        actions.current.onPick({ lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) });
        return;
      }
      const found = hit(event.pixel);
      if (found?.field) window.location.hash = fieldHref(found.field.id);
      else if (found?.unit && (picker || found.unit.get('fields').length)) actions.current.go(found.unit.get('kod'));
    });
    map.getViewport().addEventListener('pointerleave', () => { setHover(null); setTip(null); });
    instance.current = { map, admin, fieldSource, adminLayer, fieldLayer, overlays, pickSource, byCode, files: {}, fitted: false, format: new ol.format.GeoJSON() };
    return () => { instance.current = null; map.setTarget(undefined); map.dispose(); };
  }, [ol]);

  useEffect(() => {
    const data = instance.current;
    if (!data) return;
    data.fieldSource.clear();
    data.fieldSource.addFeatures(fields.flatMap((field) => {
      // raport może się jeszcze liczyć (report: null): wtedy położenie z danych pola, bez obrysu działki
      const parcel = field.report?.parcel, point = parcel?.centroid ?? field.report?.request?.point ?? field.input?.point;
      const teryt = fieldTeryt(field);
      if (!point && !teryt) return [];
      const marker = point && new ol.geom.Point(ol.proj.fromLonLat([point.lon, point.lat]));
      const geometry = parcel?.geometry ? data.format.readGeometry(parcel.geometry, PROJ) : marker;
      return [new ol.Feature({ geometry, marker, field, teryt })];
    }));
    assign(data);
  }, [fields, ol]);

  // Wybrana działka albo punkt na mapie; działka z innej gminy przenosi mapę do tej gminy (przejście dolatuje wtedy do działki).
  useEffect(() => {
    const data = instance.current;
    if (!data) return;
    data.pickSource.clear();
    const geometry = parcel?.geometry ?? (point ? { type: 'Point', coordinates: [point.lon, point.lat] } : null);
    if (geometry) data.pickSource.addFeature(new ol.Feature(data.format.readGeometry(geometry, PROJ)));
    data.focus = parcel?.geometry && parcelGmina ? { gmina: parcelGmina, extent: data.pickSource.getExtent() } : null;
    if (!picker || !data.focus) return;
    if (anim.current.to === parcelGmina && data.fitted) data.map.getView().fit(data.focus.extent, { maxZoom: 17, padding: [44, 44, 44, 44], duration: 500 });
    else setPickerCode(parcelGmina);
  }, [parcel, point, ol]);

  // granice: województwa od razu, powiaty i gminy województwa po wejściu w nie (każdy plik raz)
  useEffect(() => {
    const data = instance.current;
    if (!data) return;
    const load = (name) => (data.files[name] ??= fetch(`/mapa/${name}.json`)
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((json) => {
        for (const unit of data.format.readFeatures(json, PROJ)) {
          unit.set('label', new ol.geom.Point(ol.proj.fromLonLat(unit.get('lp'))));
          unit.set('fields', []);
          data.byCode.set(unit.get('kod'), unit);
          data.admin.addFeature(unit);
        }
        assign(data);
      })
      .catch((reason) => { delete data.files[name]; throw reason; }));
    let active = true;
    load('wojewodztwa').then(() => woj && data.byCode.has(woj) && load(`woj/${woj}`))
      .then(() => active && setError(''))
      .catch(() => active && setError('Nie udało się wczytać granic gmin i powiatów. Odśwież stronę, żeby spróbować ponownie.'));
    return () => { active = false; };
  }, [woj, ol]);

  // Poziom do pokazania: null, dopóki granice województwa się wczytują (mapa zostaje wtedy na poprzednim poziomie).
  const known = (kod) => units.some((unit) => unit.kod === kod);
  const waiting = !units.length || (woj && known(woj) && !units.some((unit) => unit.kod.length === 4 && unit.kod.startsWith(woj)));
  const shown = waiting ? null : known(code) ? code : '';
  const last = useRef('');
  if (shown !== null) last.current = shown;
  const at = shown ?? last.current;

  // Przejście: widok dolatuje do jednostki, a w tym samym czasie i z tym samym tempem poprzedni poziom
  // przenika w nowy (kolory, plakietki, podkład w gminie). Bez animacji przy pierwszym wejściu i przy ograniczonym ruchu.
  useEffect(() => {
    const data = instance.current;
    if (!data || shown === null) return;
    const unit = data.byCode.get(shown);
    const instant = !data.fitted || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    data.fitted = true;
    setHover(null);   // lista poprzedniego poziomu znika spod kursora bez zdarzenia mouseleave
    setTip(null);
    const state = anim.current;
    Object.assign(state, { from: state.to, to: shown, t: instant ? 1 : 0 });
    const view = data.map.getView();
    view.cancelAnimations();
    // margines większy niż wygaszenie krawędzi w app.css (28 px), więc wybrana jednostka nigdy nie blednie
    const padding = data.map.getSize()?.[0] < 520 ? [32, 32, 32, 32] : [44, 44, 44, 44];
    const focus = picker && data.focus?.gmina === shown ? data.focus.extent : null;   // działka wybrana w tej gminie
    view.fit(focus ?? (unit ? unit.getGeometry().getExtent() : data.admin.getExtent()),
      { padding, maxZoom: focus ? 17 : undefined, duration: instant ? 0 : DURATION_MS, easing: ol.easing.inAndOut });
    let frame = 0;
    const start = performance.now();
    const step = (now) => {
      const progress = instant ? 1 : Math.min(1, (now - start) / DURATION_MS);
      state.t = ol.easing.inAndOut(progress);
      const baseOpacity = lerp(state.from.length === 7 ? 1 : 0, shown.length === 7 ? 1 : 0, state.t);
      for (const layer of data.overlays) {
        layer.setOpacity(baseOpacity);
        layer.setVisible(baseOpacity > 0);
      }
      data.adminLayer.changed();
      data.fieldLayer.changed();
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    step(start);
    return () => cancelAnimationFrame(frame);
  }, [shown, ol]);

  useEffect(() => {
    anim.current.hover = hover;
    instance.current?.adminLayer.changed();
    instance.current?.fieldLayer.changed();
  }, [hover]);

  if (!ol) return <Callout tone="neutral">Nie udało się uruchomić mapy w tej przeglądarce.</Callout>;

  const depth = LEVELS.indexOf(at.length) + 1;
  const current = units.find((unit) => unit.kod === at);
  const trail = LEVELS.filter((size) => size < at.length).map((size) => units.find((unit) => unit.kod === at.slice(0, size))).filter(Boolean);
  const children = units.filter((unit) => unitRole(unit.kod, at) === 'active');
  const withFields = children.filter((unit) => unit.fields.length)
    .sort((a, b) => b.fields.length - a.fields.length || a.nazwa.localeCompare(b.nazwa, 'pl'));
  const regions = units.filter((unit) => unit.kod.length === 2);
  const here = current ? current.fields : regions.flatMap((unit) => unit.fields);
  const missing = units.length ? fields.length - regions.reduce((sum, unit) => sum + unit.fields.length, 0) : 0;
  const summary = depth === 3 ? `${fieldsCount(here.length)} w tej gminie`
    : `${fieldsCount(here.length)} w ${withFields.length} ${IN_UNITS[depth][withFields.length === 1 ? 0 : 1]}`;
  const hoverProps = (id) => ({ onMouseEnter: () => setHover(id), onMouseLeave: () => setHover(null), onFocus: () => setHover(id), onBlur: () => setHover(null) });
  const rowClass = (id) => cn('group flex items-center gap-3 rounded-xl px-2 py-2 transition-[background-color] duration-150 hover:bg-neutral-100',
    hover === id && 'bg-neutral-100');

  // Okruszki: na stronie jednostki nadrzędne (bieżąca jest w tytule), w formularzu także bieżąca, bo tytułu nie ma.
  const crumbs = [{ kod: '', label: 'Polska' }, ...[...trail, ...(picker && current ? [current] : [])]
    .map((unit) => ({ kod: unit.kod, label: cap(unitName(unit)) }))];
  const crumbClass = 'rounded-md px-0.5 font-medium transition-[color] duration-150 hover:text-neutral-950';
  const breadcrumb = <nav aria-label="Poziomy mapy">
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[13px] text-neutral-500">
      {crumbs.map((item, i) => <li key={item.kod} className="flex items-center gap-1">
        {i > 0 && <ChevronRight aria-hidden className="size-3.5 text-neutral-400"/>}
        {picker && item.kod === at ? <span aria-current="location" className="px-0.5 font-medium text-neutral-900">{item.label}</span>
          : picker ? <button type="button" onClick={() => go(item.kod)} className={crumbClass}>{item.label}</button>
            : <a href={item.kod ? `#mapa/${item.kod}` : '#mapa'} className={crumbClass}>{item.label}</a>}
      </li>)}
    </ol>
  </nav>;

  const mapView = <div className="relative min-w-0">
    <div ref={target} tabIndex={0} className={cn('map-canvas fields-map', picker && 'fields-map-picker')}
      style={picker ? undefined : { height: 'clamp(360px, 68svh, 760px)' }}
      aria-label={picker ? 'Mapa wyboru działki: wybierz województwo, powiat i gminę, potem kliknij swoje pole'
        : 'Mapa pól: kliknij zielone województwo, powiat albo gminę, żeby przybliżyć'}/>
    {tip && <div aria-hidden className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-white/95 px-2.5 py-1.5 text-[12.5px] leading-tight shadow-raised ring-1 ring-black/[0.06] backdrop-blur-md"
      style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, calc(-100% - 14px))' }}>
      <span className="block font-medium text-neutral-900">{tip.title}</span>
      <span className="block text-neutral-500">{tip.text}</span>
    </div>}
    {/* w formularzu okruszki stoją na mapie w tym samym miejscu co pasek podkładu w ParcelMap, więc mapa zaczyna się równo z wyszukiwarką */}
    {picker && <div className="no-print absolute right-2.5 top-2.5 z-10 max-w-[calc(100%-4.5rem)] rounded-xl bg-white/90 px-3 py-1.5 shadow-raised ring-1 ring-black/[0.05] backdrop-blur-md">
      {breadcrumb}</div>}
    {shown === null && !error && <div role="status" className={cn(picker ? 'top-14' : 'top-2.5', 'absolute right-2.5 flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-[12.5px] text-neutral-600 shadow-raised ring-1 ring-black/[0.05] backdrop-blur-md')}>
      <Spinner/> Wczytuję granice…</div>}
    <ul aria-label="Legenda mapy" className="pointer-events-none absolute bottom-2.5 left-2.5 flex items-center gap-3 rounded-lg bg-white/90 px-2.5 py-1.5 text-[12px] text-neutral-600 ring-1 ring-black/[0.05] backdrop-blur-md">
      {depth === 3 ? <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-brand-700 ring-2 ring-white"/>
        {picker ? 'Pole już dodane' : 'Twoje pole'}</li> : <>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-brand-300"/>z polami</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-[#dbdbd4]"/>bez pól</li>
      </>}
    </ul>
  </div>;

  if (picker) return <div>
    {mapView}
    <p className="no-print mt-2 text-[13px] text-neutral-500">{depth === 3 ? 'Przybliż mapę i kliknij swoje pole.'
      : `Kliknij ${['województwo', 'powiat', 'gminę'][depth]}, w której leży pole, albo wyszukaj działkę po numerze.`}</p>
    {error && <Callout tone="danger" role="alert" className="mt-3">{error}</Callout>}
  </div>;

  return <div className="flex flex-col gap-6">
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {at ? breadcrumb : <Eyebrow>Mapa pól</Eyebrow>}
        <h1 key={at} className={cn('mt-2 font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]', ENTER)}>
          {current ? cap(unitName(current)) : 'Polska'}</h1>
        {units.length > 0 && fields.length > 0 && <p className="mt-2 text-[14px] text-neutral-600">{summary}</p>}
      </div>
      <Button icon={<Plus/>} onClick={onAdd}>Dodaj pole</Button>
    </header>

    {error && <Callout tone="danger" role="alert">{error}</Callout>}

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {mapView}

      <aside key={at} aria-label={depth === 3 ? 'Pola w gminie' : `${CHILDREN[depth]} z polami`} className={cn('surface self-start p-5', ENTER)}>
        {!fields.length ? <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900">Nie masz jeszcze pól</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">Dodaj pole, a jego województwo, powiat i gmina zazielenią się na mapie.</p>
          <Button variant="secondary" size="sm" icon={<Plus/>} onClick={onAdd} className="mt-4">Dodaj pole</Button>
        </div> : <>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900">{depth === 3 ? 'Pola w gminie' : `${CHILDREN[depth]} z polami`}</h2>
            <span className="num text-[12.5px] text-neutral-400">{depth === 3 ? here.length : withFields.length}</span>
          </div>
          {depth === 3 ? <ul className="-mx-2 mt-3 flex flex-col gap-0.5">{here.map((field) =>
            <li key={field.id}><a href={fieldHref(field.id)} {...hoverProps(field.id)} className={rowClass(field.id)}>
              <StatusDot tone={statusTone(field.report?.water_status)}/>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-neutral-900">{field.name}</span>
                {field.report?.parcel && <span className="num block truncate text-[12px] text-neutral-500">
                  Działka {field.report.parcel.number ?? field.report.parcel.id} · {number(field.report.parcel.area_ha, 2)} ha</span>}
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-neutral-400 transition-transform duration-150 group-hover:translate-x-0.5"/>
            </a></li>)}
          </ul> : <>
            <ul className="-mx-2 mt-3 flex flex-col gap-0.5">{withFields.map((unit) =>
              <li key={unit.kod}><a href={`#mapa/${unit.kod}`} {...hoverProps(unit.kod)} className={rowClass(unit.kod)}>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-neutral-900">{cap(unit.nazwa)}</span>
                <span className="num rounded-full bg-brand-50 px-2 py-0.5 text-[12px] font-semibold text-brand-800 ring-1 ring-inset ring-brand-200">
                  {unit.fields.length}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-neutral-400 transition-transform duration-150 group-hover:translate-x-0.5"/>
              </a></li>)}
            </ul>
            {children.length > 0 && <p className="mt-3 border-t border-black/[0.06] pt-3 text-[12.5px] text-neutral-500">
              {children.length - withFields.length} z {children.length} {OF_CHILDREN[depth]} bez pól</p>}
          </>}
          {depth === 0 && missing > 0 && <p className="mt-2 text-[12.5px] text-neutral-500">
            Bez położenia na mapie: {fieldsCount(missing)} (raport bez działki ewidencyjnej).</p>}
        </>}
      </aside>
    </div>
  </div>;
}
