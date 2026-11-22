// Tryb testowy (widoczny z ?test w adresie): kształt działki do zabawy w wybranym punkcie.
// Analiza i tak liczy się na żywo dla tego punktu; podmieniony jest tylko obrys działki i obszar zasiewu w widoku.

const arc = (cx, cy, r, from, to, n = 32) => Array.from({ length: n + 1 }, (_, i) => {
  const a = (from + (to - from) * i / n) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});

export function testParcel(lat, lon) {
  const toLonLat = ([x, y]) => [lon + x / (111320 * Math.cos(lat * Math.PI / 180)), lat + y / 110540];
  const R = 20, W = 10, L = 80, G = 13;   // metry: dwa koła u podstawy, trzon, szersza zaokrąglona końcówka
  const outline = [[W, 17.3], [W, L], [G, L], ...arc(0, L, G, 0, 180), [-G, L], [-W, L], [-W, 17.3],
    ...arc(-R, 0, R, 60, 360), ...arc(R, 0, R, 180, 480)];
  const area = Math.abs(outline.reduce((s, [x1, y1], i) => { const [x2, y2] = outline[(i + 1) % outline.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2);
  return {
    parcel: { id: 'TEST', number: 'testowa', area_ha: area / 10000, centroid: { lat, lon },
      geometry: { type: 'Polygon', coordinates: [[...outline, outline[0]].map(toLonLat)] } },
    cropArea: { type: 'MultiPolygon', coordinates: [[arc(-R, 0, R - 1, 0, 360, 48).map(toLonLat)], [arc(R, 0, R - 1, 0, 360, 48).map(toLonLat)]] },
  };
}
