import { useEffect, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';

const BASE_LAYERS = [{ value: 'orto', label: 'Zdjęcie lotnicze' }, { value: 'osm', label: 'Mapa' }];

// Legenda terenu w kolorach i kształtach z terrainStyle: linia spływu, koło dopływu i znak odpływu.
// Znak odpływu to kwadrat, nie romb: RegularShape (4 wierzchołki, angle π/4) stawia wierzchołki na przekątnych.
const TERRAIN_LEGEND = [
  { label: 'Drogi spływu', shape: 'niebieska linia',
    glyph: <path d="M1.5 10C4 5 6.5 5 8 7.5s4 2.5 6.5-2.5" fill="none" stroke="#41bbed" strokeWidth="2.5" strokeLinecap="round"/> },
  { label: 'Dopływ', shape: 'koło', glyph: <circle cx="8" cy="7.5" r="4.75" fill="#146b8c"/> },
  { label: 'Odpływ', shape: 'pomarańczowy kwadrat', glyph: <rect x="3.5" y="3" width="9" height="9" rx="1.25" fill="#bb581f"/> },
];

function terrainStyle(ol, feature) {
  if (feature.getGeometry().getType() === 'Point') {
    const fill = new ol.style.Fill({ color: feature.get('kind') === 'inflow' ? '#146b8c' : '#bb581f' });
    const stroke = new ol.style.Stroke({ color: '#fff', width: 2 });
    const image = feature.get('kind') === 'inflow' ? new ol.style.Circle({ radius: 6, fill, stroke })
      : new ol.style.RegularShape({ points: 4, radius: 8, angle: Math.PI / 4, fill, stroke });
    return new ol.style.Style({ image });
  }
  return new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#41bbed', width: 3 }) });
}

export function ParcelMap({ parcel, terrain, point, onPick }) {
  const target = useRef(null);
  const instance = useRef(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [base, setBase] = useState('orto');
  const [boundaries, setBoundaries] = useState(Boolean(onPick));
  const focus = !onPick && Boolean(parcel?.geometry);
  const ol = window.ol;

  useEffect(() => {
    if (!ol) return;
    const parcelSource = new ol.source.Vector();
    const terrainSource = new ol.source.Vector();
    const maskSource = new ol.source.Vector();
    // Ortofotomapa z WMTS (gotowe kafle, ok. 0,1 s na kafel) zamiast WMS (każdy kafel renderowany na żądanie, ok. 1,5 s).
    // Siatka EPSG:3857 z GetCapabilities GUGiK: poziomy 0–19, identyfikatory „EPSG:3857:z”, róg siatki jak w Google/OSM.
    const extent3857 = ol.proj.get('EPSG:3857').getExtent();
    const zooms = Array.from({ length: 20 }, (_, z) => z);
    const orto = new ol.layer.Tile({ minZoom: 9, source: new ol.source.WMTS({
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution',
      layer: 'ORTOFOTOMAPA', matrixSet: 'EPSG:3857', format: 'image/jpeg', style: 'default', requestEncoding: 'KVP',
      tileGrid: new ol.tilegrid.WMTS({
        origin: ol.extent.getTopLeft(extent3857),
        resolutions: zooms.map((z) => ol.extent.getWidth(extent3857) / 256 / 2 ** z),
        matrixIds: zooms.map((z) => `EPSG:3857:${z}`),
      }),
      attributions: 'Ortofotomapa: © GUGiK (Geoportal)',
    }) });
    const osm = new ol.layer.Tile({ source: new ol.source.OSM(), maxZoom: 9 });
    // Granice działek z KIEG jako kafle: doczytują się kawałkami przy przybliżaniu i przesuwaniu, zamiast jednego dużego obrazu
    // po każdym ruchu. Węzeł integracja01 wprost: główny adres integracja.gugik.gov.pl przekierowuje (21.11.2026) na
    // img.php bez parametrów i zwraca nie-obraz, który zasłaniał ortofotomapę na biało.
    const borders = new ol.layer.Tile({ minZoom: 14, source: new ol.source.TileWMS({
      url: 'https://integracja01.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow',
      params: { LAYERS: 'dzialki,numery_dzialek', FORMAT: 'image/png', TRANSPARENT: 'TRUE', VERSION: '1.3.0' },
      hidpi: false, transition: 0, attributions: 'Granice działek: © GUGiK (KIEG)',
    }) });
    const defaults = ol.control.defaults.defaults ?? ol.control.defaults;
    const map = new ol.Map({
      target: target.current,
      controls: defaults({ attributionOptions: { collapsible: false } }),
      layers: [osm, orto, borders, new ol.layer.Vector({
        source: maskSource,
        style: new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(12, 22, 17, .74)' }) }),
      }), new ol.layer.Vector({
        source: parcelSource,
        style: [new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,241,162,.35)', width: 9 }) }), new ol.style.Style({
          stroke: new ol.style.Stroke({ color: '#fff1a2', width: 3 }),
          fill: new ol.style.Fill({ color: 'rgba(255,241,162,.18)' }),
          image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: '#205338' }),
            stroke: new ol.style.Stroke({ color: '#fff', width: 2 }) }),
        })],
      }), new ol.layer.Vector({ source: terrainSource, style: (f) => terrainStyle(ol, f) })],
      view: new ol.View({ center: ol.proj.fromLonLat([19.4, 52.0]), zoom: 6, maxZoom: 20 }),
    });
    map.on('singleclick', ({ coordinate }) => {
      const [lon, lat] = ol.proj.toLonLat(coordinate);
      pick.current?.({ lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) });
    });
    instance.current = { map, osm, orto, borders, parcelSource, terrainSource, maskSource, format: new ol.format.GeoJSON() };
    return () => { instance.current = null; map.setTarget(undefined); map.dispose(); };
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
    data.parcelSource.clear();
    data.maskSource.clear();
    const geometry = parcel?.geometry ?? (point ? { type: 'Point', coordinates: [point.lon, point.lat] } : null);
    if (!geometry) return;
    const feature = data.format.readFeature({ type: 'Feature', geometry },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
    data.parcelSource.addFeature(feature);
    const view = data.map.getView();
    if (!focus) {
      view.fit(feature.getGeometry().getExtent(), { maxZoom: 17, padding: [35, 35, 35, 35] });
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
  }, [terrain, ol]);

  if (!ol) return <Callout tone="neutral">Nie udało się uruchomić mapy. Możesz wyszukać działkę po numerze.</Callout>;
  // @container: pasek przełączników i wiersz podpowiedzi układają się według szerokości mapy, nie ekranu
  return <div className="parcel-map @container">
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
