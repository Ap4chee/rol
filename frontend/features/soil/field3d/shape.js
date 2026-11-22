// Kształt działki do modelu 3D: obrys w lokalnym układzie sceny i test „czy punkt jest w środku”. Bez three.js.

/** Dłuższy bok działki w jednostkach sceny. */
export const FIELD_SIZE = 10;
// metry na stopień długości na równiku i szerokości geograficznej (przybliżenie wystarczające dla jednej działki)
const M_PER_DEG_LON = 111320;
const M_PER_DEG_LAT = 110540;

/** Obrys działki w metrach (EPSG:4326 → lokalny układ równoodległościowy), obrócony dłuższą osią wzdłuż X i przeskalowany. */
export function parcelShape(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const area = (ring) => Math.abs(ring.reduce((s, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2);
  const polygon = [...polygons].sort((a, b) => area(b[0]) - area(a[0]))[0];
  if (!polygon) return { outer: [[-5, -3.5], [5, -3.5], [5, 3.5], [-5, 3.5]], holes: [], assumed: true };
  const ring = polygon[0];
  const lon0 = ring.reduce((s, p) => s + p[0], 0) / ring.length, lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = M_PER_DEG_LON * Math.cos(lat0 * Math.PI / 180), ky = M_PER_DEG_LAT;
  let rings = polygon.map((r) => r.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]));
  // główna oś (PCA) → obrót tak, żeby działka leżała poziomo na ekranie
  const pts = rings[0];
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let cxx = 0, cyy = 0, cxy = 0;
  pts.forEach(([x, y]) => { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); });
  const angle = .5 * Math.atan2(2 * cxy, cxx - cyy), c = Math.cos(-angle), s = Math.sin(-angle);
  rings = rings.map((r) => r.map(([x, y]) => [(x - mx) * c - (y - my) * s, (x - mx) * s + (y - my) * c]));
  const xs = rings[0].map((p) => p[0]), ys = rings[0].map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = FIELD_SIZE / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const norm = rings.map((r) => r.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]));
  // to samo przekształcenie dla innych geometrii w EPSG:4326 (np. obszaru zasiewu w obrębie działki)
  const project = ([lon, lat]) => {
    const x = (lon - lon0) * kx - mx, y = (lat - lat0) * ky - my;
    return [(x * c - y * s - cx) * scale, (x * s + y * c - cy) * scale];
  };
  return { outer: norm[0], holes: norm.slice(1), assumed: false, project };
}


/** Czy punkt [x, y] leży w pierścieniu (test promienia, parzysta liczba przecięć = na zewnątrz). */
export function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
