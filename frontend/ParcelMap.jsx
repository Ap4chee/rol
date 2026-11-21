import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

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
  const ol = window.ol;

  useEffect(() => {
    if (!ol) return;
    const parcelSource = new ol.source.Vector();
    const terrainSource = new ol.source.Vector();
    const orto = new ol.layer.Tile({ minZoom: 9, source: new ol.source.TileWMS({
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution',
      params: { LAYERS: 'Raster', FORMAT: 'image/jpeg', VERSION: '1.3.0' },
      attributions: 'Ortofotomapa: © GUGiK (Geoportal)',
    }) });
    const osm = new ol.layer.Tile({ source: new ol.source.OSM(), maxZoom: 9 });
    const borders = new ol.layer.Image({ minZoom: 14.5, source: new ol.source.ImageWMS({
      url: 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow',
      params: { LAYERS: 'dzialki,numery_dzialek', FORMAT: 'image/png', TRANSPARENT: 'TRUE', VERSION: '1.3.0' },
      ratio: 1.2, attributions: 'Granice działek: © GUGiK (KIEG)',
    }) });
    const defaults = ol.control.defaults.defaults ?? ol.control.defaults;
    const map = new ol.Map({
      target: target.current,
      controls: defaults({ attributionOptions: { collapsible: false } }),
      layers: [osm, orto, borders, new ol.layer.Vector({
        source: parcelSource,
        style: new ol.style.Style({
          stroke: new ol.style.Stroke({ color: '#fff1a2', width: 3 }),
          fill: new ol.style.Fill({ color: 'rgba(255,241,162,.18)' }),
          image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: '#205338' }),
            stroke: new ol.style.Stroke({ color: '#fff', width: 2 }) }),
        }),
      }), new ol.layer.Vector({ source: terrainSource, style: (f) => terrainStyle(ol, f) })],
      view: new ol.View({ center: ol.proj.fromLonLat([19.4, 52.0]), zoom: 6, maxZoom: 20 }),
    });
    map.on('singleclick', ({ coordinate }) => {
      const [lon, lat] = ol.proj.toLonLat(coordinate);
      pick.current?.({ lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) });
    });
    instance.current = { map, osm, orto, borders, parcelSource, terrainSource, format: new ol.format.GeoJSON() };
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
    const geometry = parcel?.geometry ?? (point ? { type: 'Point', coordinates: [point.lon, point.lat] } : null);
    if (!geometry) return;
    const feature = data.format.readFeature({ type: 'Feature', geometry },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
    data.parcelSource.addFeature(feature);
    data.map.getView().fit(feature.getGeometry().getExtent(), { maxZoom: 17, padding: [35, 35, 35, 35] });
  }, [parcel, point, ol]);

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

  if (!ol) return <p className="note">Nie udało się uruchomić mapy. Możesz wyszukać działkę po numerze.</p>;
  return <div className="parcel-map">
    <div className="map-controls no-print">
      <div role="group" aria-label="Podkład mapy" className="segments">
        <button type="button" aria-pressed={base === 'orto'} onClick={() => setBase('orto')}>Zdjęcie lotnicze</button>
        <button type="button" aria-pressed={base === 'osm'} onClick={() => setBase('osm')}>Mapa</button>
      </div>
      <button type="button" className="quiet-button" aria-pressed={boundaries} onClick={() => setBoundaries(!boundaries)}>
        <Icon name="layers" size={17}/> Granice działek
      </button>
    </div>
    <div className="map-canvas" ref={target} tabIndex={0} aria-label={onPick ? 'Mapa wyboru działki' : 'Mapa działki'}/>
    {onPick && <div className="map-hint">
      Przybliż mapę i wybierz pole.
      <button className="quiet-button" type="button" onClick={() => {
        const center = instance.current?.map.getView().getCenter();
        if (center) {
          const [lon, lat] = ol.proj.toLonLat(center);
          onPick({ lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) });
        }
      }}>Sprawdź środek mapy</button>
    </div>}
    {terrain?.status === 'ok' && <p className="map-hint">Niebieskie linie: drogi spływu. Koło: dopływ. Pomarańczowy romb: odpływ.</p>}
  </div>;
}
