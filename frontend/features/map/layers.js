// Warstwy i style OpenLayers wspólne dla map w aplikacji. OpenLayers jest ładowany globalnie (static/vendor/ol.js),
// więc każda funkcja dostaje obiekt `ol` jako argument.

/** Teren: drogi spływu jako linie, dopływy jako koła, odpływy jako kwadraty. */
export function terrainStyle(ol, feature) {
  if (feature.getGeometry().getType() === 'Point') {
    const fill = new ol.style.Fill({ color: feature.get('kind') === 'inflow' ? '#146b8c' : '#bb581f' });
    const stroke = new ol.style.Stroke({ color: '#fff', width: 2 });
    const image = feature.get('kind') === 'inflow' ? new ol.style.Circle({ radius: 6, fill, stroke })
      : new ol.style.RegularShape({ points: 4, radius: 8, angle: Math.PI / 4, fill, stroke });
    return new ol.style.Style({ image });
  }
  return new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#41bbed', width: 3 }) });
}

// Ortofotomapa z WMTS (gotowe kafle, ok. 0,1 s na kafel) zamiast WMS (każdy kafel renderowany na żądanie, ok. 1,5 s).
// Siatka EPSG:3857 z GetCapabilities GUGiK: poziomy 0–19, identyfikatory „EPSG:3857:z”, róg siatki jak w Google/OSM.
export function ortoSource(ol) {
  const extent3857 = ol.proj.get('EPSG:3857').getExtent();
  const zooms = Array.from({ length: 20 }, (_, z) => z);
  return new ol.source.WMTS({
    url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution',
    layer: 'ORTOFOTOMAPA', matrixSet: 'EPSG:3857', format: 'image/jpeg', style: 'default', requestEncoding: 'KVP',
    tileGrid: new ol.tilegrid.WMTS({
      origin: ol.extent.getTopLeft(extent3857),
      resolutions: zooms.map((z) => ol.extent.getWidth(extent3857) / 256 / 2 ** z),
      matrixIds: zooms.map((z) => `EPSG:3857:${z}`),
    }),
    attributions: 'Ortofotomapa: © GUGiK (Geoportal)',
  });
}

// Granice działek z KIEG jako kafle: doczytują się kawałkami przy przybliżaniu i przesuwaniu, zamiast jednego dużego obrazu
// po każdym ruchu. Węzeł integracja01 wprost: główny adres integracja.gugik.gov.pl przekierowuje (21.11.2026) na
// img.php bez parametrów i zwraca nie-obraz, który zasłaniał ortofotomapę na biało.
export function bordersLayer(ol, options = {}) {
  return new ol.layer.Tile({ minZoom: 14, ...options, source: new ol.source.TileWMS({
    url: 'https://integracja01.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow',
    params: { LAYERS: 'dzialki,numery_dzialek', FORMAT: 'image/png', TRANSPARENT: 'TRUE', VERSION: '1.3.0' },
    hidpi: false, transition: 0, attributions: 'Granice działek: © GUGiK (KIEG)',
  }) });
}

/** Wybrana działka: jasnożółty obrys z poświatą (widoczny na zdjęciu lotniczym), wskazany punkt jako zielona kropka. */
export function parcelStyle(ol) {
  return [new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,241,162,.35)', width: 9 }) }), new ol.style.Style({
    stroke: new ol.style.Stroke({ color: '#fff1a2', width: 3 }),
    fill: new ol.style.Fill({ color: 'rgba(255,241,162,.18)' }),
    image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: '#205338' }),
      stroke: new ol.style.Stroke({ color: '#fff', width: 2 }) }),
  })];
}
