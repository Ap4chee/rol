import { useEffect, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Callout } from '@/shared/ui/callout';
import { Segmented } from '@/shared/ui/segmented';
import { Switch } from '@/shared/ui/switch';
import { bordersLayer, ortoSource, parcelStyle, terrainStyle } from './layers.js';

const BASE_LAYERS = [{ value: 'orto', label: 'Zdjęcie lotnicze' }, { value: 'osm', label: 'Mapa' }];

// Legenda terenu w kolorach i kształtach z terrainStyle: linia spływu, koło dopływu i znak odpływu.
// Znak odpływu to kwadrat, nie romb: RegularShape (4 wierzchołki, angle π/4) stawia wierzchołki na przekątnych.
const TERRAIN_LEGEND = [
  { label: 'Drogi spływu', shape: 'niebieska linia',
    glyph: <path d="M1.5 10C4 5 6.5 5 8 7.5s4 2.5 6.5-2.5" fill="none" stroke="#41bbed" strokeWidth="2.5" strokeLinecap="round"/> },
  { label: 'Dopływ', shape: 'koło', glyph: <circle cx="8" cy="7.5" r="4.75" fill="#146b8c"/> },
  { label: 'Odpływ', shape: 'pomarańczowy kwadrat', glyph: <rect x="3.5" y="3" width="9" height="9" rx="1.25" fill="#bb581f"/> },
];

/**
 * Mapa jednej działki: zdjęcie lotnicze albo OSM z granicami działek, wybrana działka lub punkt i (w raporcie) drogi spływu.
 * Z `onPick` kliknięcie wskazuje działkę; `location` przybliża mapę do znalezionego adresu.
 */
export function ParcelMap({ parcel, terrain, point, onPick, location }) {
  const target = useRef(null);
  const instance = useRef(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [base, setBase] = useState('orto');
  const [boundaries, setBoundaries] = useState(Boolean(onPick));
  // czy mapa skończyła rysować bieżący kadr (kafle pobrane, dolot zakończony); na to czeka wydruk raportu
  const [rendered, setRendered] = useState(false);
  const focus = !onPick && Boolean(parcel?.geometry);
  const ol = window.ol;

  useEffect(() => {
    if (!ol) return;
    const parcelSource = new ol.source.Vector();
    const terrainSource = new ol.source.Vector();
    const maskSource = new ol.source.Vector();
    const locationSource = new ol.source.Vector();
    const orto = new ol.layer.Tile({ minZoom: 9, source: ortoSource(ol) });
    const osm = new ol.layer.Tile({ source: new ol.source.OSM(), maxZoom: 9 });
    const borders = bordersLayer(ol);
    const defaults = ol.control.defaults.defaults ?? ol.control.defaults;
    const interactionDefaults = ol.interaction.defaults.defaults ?? ol.interaction.defaults;
    // Mapa w raporcie pokazuje jedną działkę w stałej skali: bez przybliżania i oddalania (przesuwanie zostaje).
    // Mapa wyboru działki (onPick) musi dać się przybliżyć, żeby trafić w swoje pole.
    const fixedZoom = !pick.current;
    const map = new ol.Map({
      target: target.current,
      controls: defaults({ attributionOptions: { collapsible: false }, zoom: !fixedZoom }),
      interactions: interactionDefaults(fixedZoom
        ? { mouseWheelZoom: false, doubleClickZoom: false, pinchZoom: false, keyboard: false, shiftDragZoom: false }
        : {}),
      layers: [osm, orto, borders, new ol.layer.Vector({
        source: maskSource,
        style: new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(12, 22, 17, .74)' }) }),
      }), new ol.layer.Vector({
        source: parcelSource, style: parcelStyle(ol),
      }), new ol.layer.Vector({ source: terrainSource, style: (f) => terrainStyle(ol, f) }),
      new ol.layer.Vector({ source: locationSource, style: new ol.style.Style({
        image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: '#146b8c' }),
          stroke: new ol.style.Stroke({ color: '#fff', width: 2.5 }) }),
      }) })],
      view: new ol.View({ center: ol.proj.fromLonLat([19.4, 52.0]), zoom: 6, maxZoom: 20 }),
    });
    map.on('singleclick', ({ coordinate }) => {
      const [lon, lat] = ol.proj.toLonLat(coordinate);
      pick.current?.({ lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) });
    });
    map.on('movestart', () => setRendered(false));
    map.on('loadstart', () => setRendered(false));
    map.on('rendercomplete', () => setRendered(!map.getView().getAnimating()));
    instance.current = { map, osm, orto, borders, parcelSource, terrainSource, maskSource, locationSource, format: new ol.format.GeoJSON() };
    // Na wydruku ramka mapy ma inną szerokość niż na ekranie. Bez przeliczenia płótno zostaje w starym rozmiarze,
    // skaluje się do szerokości strony i pod zdjęciem zostaje szary pas. Kafle z ekranu wystarczają, bo widok się zwęża.
    const resize = () => { map.updateSize(); map.renderSync(); };
    window.addEventListener('beforeprint', resize);
    window.addEventListener('afterprint', resize);
    return () => {
      window.removeEventListener('beforeprint', resize);
      window.removeEventListener('afterprint', resize);
      instance.current = null; map.setTarget(undefined); map.dispose();
    };
  }, [ol]);

  useEffect(() => {
    const data = instance.current;
    if (!data) return;
    data.orto.setVisible(base === 'orto');
    data.osm.setMaxZoom(base === 'orto' ? 9 : Infinity);
    data.borders.setVisible(boundaries);
  }, [base, boundaries, ol]);

  useEffect(() => {
    const data = instance.current;
    if (!data) return;
    data.locationSource.clear();
    if (!location) return;
    const center = ol.proj.fromLonLat([location.point.lon, location.point.lat]);
    data.locationSource.addFeature(new ol.Feature(new ol.geom.Point(center)));
    const view = data.map.getView();
    const zoom = location.precise ? 16 : 14.75;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    view.cancelAnimations();
    if (reduced || view.getZoom() < 9) {
      view.setCenter(center);
      view.setZoom(reduced ? zoom : zoom - 1.75);
    }
    if (!reduced) view.animate({ center, zoom, duration: 420, easing: ol.easing.easeOut });
  }, [location, ol]);

  useEffect(() => {
    const data = instance.current;
    if (!data) return;
    data.parcelSource.clear();
    data.maskSource.clear();
    const geometry = parcel?.geometry ?? (point ? { type: 'Point', coordinates: [point.lon, point.lat] } : null);
    if (!geometry) return;
    const feature = data.format.readFeature({ type: 'Feature', geometry },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
    data.parcelSource.addFeature(feature);
    const view = data.map.getView();
    if (!focus) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      view.cancelAnimations();
      view.fit(feature.getGeometry().getExtent(),
        { maxZoom: 17, padding: [35, 35, 35, 35], duration: reduced ? 0 : 280, easing: ol.easing.easeOut });
      return;
    }
    // Widok jednej działki: wszystko poza jej granicą przyciemnione (maska z dziurą w kształcie działki).
    const polygons = feature.getGeometry().getType() === 'MultiPolygon'
      ? feature.getGeometry().getPolygons() : [feature.getGeometry()];
    const world = ol.proj.get('EPSG:3857').getExtent();
    const outer = [[world[0], world[1]], [world[2], world[1]], [world[2], world[3]], [world[0], world[3]], [world[0], world[1]]];
    data.maskSource.addFeature(new ol.Feature(new ol.geom.Polygon([outer, ...polygons.map((poly) => poly.getLinearRing(0).getCoordinates())])));
    const extent = feature.getGeometry().getExtent();
    // krótki dolot (400 ms zamiast 1,4 s: każdy pośredni poziom to nowe kafle do pobrania); bez ruchu przy ograniczonym ruchu
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) { view.setCenter(ol.extent.getCenter(extent)); view.setZoom(Math.max(12, view.getZoomForResolution(view.getResolutionForExtent(extent)) - 2)); }
    view.fit(extent, { padding: [28, 28, 28, 28], duration: reduced ? 0 : 400, easing: ol.easing.easeOut });
  }, [parcel, point, ol, focus]);

  useEffect(() => {
    const data = instance.current;
    if (!data) return;
    data.terrainSource.clear();
    if (terrain?.status !== 'ok') return;
    for (const collection of [terrain.flow_paths, terrain.crossings]) {
      if (collection) data.terrainSource.addFeatures(data.format.readFeatures(collection,
        { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
    }
    // Spływy sięgają cały bufor wokół działki; w raporcie (bez przybliżania) kadr obejmuje cały ten wycinek.
    if (!focus || data.terrainSource.isEmpty()) return;
    const extent = ol.extent.extend(data.terrainSource.getExtent().slice(), data.parcelSource.getExtent());
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    data.map.getView().cancelAnimations();
    data.map.getView().fit(extent, { padding: [16, 16, 16, 16], duration: reduced ? 0 : 400, easing: ol.easing.easeOut });
  }, [terrain, ol, focus]);

  if (!ol) return <Callout tone="neutral">Nie udało się uruchomić mapy. Możesz wyszukać działkę po numerze.</Callout>;
  // @container: pasek przełączników i wiersz podpowiedzi układają się według szerokości mapy, nie ekranu
  return <div className="parcel-map @container" data-print-pending={focus && !rendered ? '' : undefined}>
    <div className="relative">
      {/* Szklany pasek nad mapą (podkład, granice). W widoku jednej działki (raport) ukryty jak wcześniej.
          Na wąskiej mapie dwa rzędy przy prawej krawędzi, żeby nie wejść na przyciski powiększania. */}
      {!focus && <div className={'no-print absolute right-2.5 top-2.5 z-10 flex flex-col items-end gap-0.5 rounded-xl bg-white/90 p-1 '
        + 'shadow-raised ring-1 ring-black/[0.05] backdrop-blur-md @min-[30rem]:flex-row @min-[30rem]:items-center @min-[30rem]:gap-1'}>
        <Segmented options={BASE_LAYERS} value={base} onChange={setBase} label="Podkład mapy" className="[&>button]:px-2.5"/>
        <Switch label="Granice działek" checked={boundaries} onCheckedChange={setBoundaries} className="px-2 py-1"/>
      </div>}
      <div className="map-canvas" ref={target} tabIndex={0} aria-label={onPick ? 'Mapa wyboru działki' : 'Mapa działki'}/>
    </div>
    {/* Na wąskiej mapie podpowiedź i przycisk jeden pod drugim. Ujemny margines wyrównuje tekst przycisku do krawędzi
        mapy (lewej albo prawej), ::after powiększa pole dotyku do 40 px. */}
    {onPick && <div className="no-print mt-2 flex flex-col items-start gap-1 @min-[26rem]:flex-row @min-[26rem]:items-center @min-[26rem]:justify-between @min-[26rem]:gap-3">
      <p className="text-[13px] text-neutral-500">Przybliż mapę i kliknij swoje pole.</p>
      <Button variant="ghost" size="xs" icon={<Crosshair/>}
        className="-ml-2.5 after:absolute after:-inset-y-1.5 after:inset-x-0 @min-[26rem]:ml-0 @min-[26rem]:-mr-2.5" onClick={() => {
        const center = instance.current?.map.getView().getCenter();
        if (center) {
          const [lon, lat] = ol.proj.toLonLat(center);
          onPick({ lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) });
        }
      }}>Sprawdź środek mapy</Button>
    </div>}
    {terrain?.status === 'ok' && <ul aria-label="Legenda mapy" className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px] text-neutral-600">
      {TERRAIN_LEGEND.map((item) => <li key={item.label} className="inline-flex items-center gap-1.5">
        <svg viewBox="0 0 16 15" className="h-[15px] w-4 shrink-0" role="img" aria-label={item.shape}>{item.glyph}</svg>
        {item.label}
      </li>)}
    </ul>}
  </div>;
}
