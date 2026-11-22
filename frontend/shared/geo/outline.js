// Obrys działki z GeoJSON (EPSG:4326) jako ścieżka SVG w kwadracie 100×100. Bez Reacta, żeby dało się to testować.

const BOX = 100;
const FILL = 84;   // kształt zajmuje 84% kwadratu, reszta to margines na obrys

/** Pierścienie wielokąta (Polygon albo MultiPolygon) z co najmniej trzema punktami; inna geometria to pusta lista. */
export function polygonRings(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.flat().filter((ring) => ring.length > 2);
}

/**
 * Ścieżka `d` sylwetki: długość × cos szerokości (żeby działka nie była rozciągnięta w poziomie), północ u góry,
 * kształt wyśrodkowany. Bez pierścieni null.
 */
export function outlinePath(geometry) {
  const rings = polygonRings(geometry);
  if (!rings.length) return null;
  const kx = Math.cos(rings[0][0][1] * Math.PI / 180);
  const points = rings.map((ring) => ring.map(([lon, lat]) => [lon * kx, -lat]));
  const xs = points.flat().map(([x]) => x), ys = points.flat().map(([, y]) => y);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX, h = Math.max(...ys) - minY;
  const k = FILL / (Math.max(w, h) || 1);
  const ox = (BOX - w * k) / 2, oy = (BOX - h * k) / 2;
  return points.map((ring) => 'M' + ring.map(([x, y]) => `${((x - minX) * k + ox).toFixed(1)},${((y - minY) * k + oy).toFixed(1)}`).join('L') + 'Z').join('');
}
