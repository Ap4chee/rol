import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries as mergeRaw } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { balanceText, layersWord, number, soilProfile } from './model.js';

const FIELD_SIZE = 10;     // dłuższy bok działki w jednostkach sceny
const SOIL = {             // kolor bazowy i ziarno faktury dla klas uziarnienia
  sand: ['#c9a774', 1.6], sandy_loam: ['#a88458', 1.2], loam: ['#7e5d3f', .9], silt_loam: ['#8b7457', .8], clay: ['#70483a', .6],
};

// ---------- kształt działki ----------

/** Obrys działki w metrach (EPSG:4326 → lokalny układ równoodległościowy), obrócony dłuższą osią wzdłuż X i przeskalowany. */
function parcelShape(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const area = (ring) => Math.abs(ring.reduce((s, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2);
  const polygon = [...polygons].sort((a, b) => area(b[0]) - area(a[0]))[0];
  if (!polygon) return { outer: [[-5, -3.5], [5, -3.5], [5, 3.5], [-5, 3.5]], holes: [], assumed: true };
  const ring = polygon[0];
  const lon0 = ring.reduce((s, p) => s + p[0], 0) / ring.length, lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
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

function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ---------- faktury gleby (generowane w przeglądarce, bez plików) ----------

function soilTexture(hex, grain, plowed = false) {
  const size = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(hex);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  const shade = (k) => { const c = base.clone().multiplyScalar(k); return `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`; };
  for (let i = 0; i < 1400; i++) {           // plamy wilgoci i próchnicy
    ctx.globalAlpha = .08;
    ctx.fillStyle = shade(.6 + Math.random() * .7);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 2 + Math.random() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 5000 * grain; i++) {   // ziarna
    ctx.globalAlpha = .5;
    ctx.fillStyle = shade(.55 + Math.random() * .9);
    const r = Math.random() * grain * 1.3;
    ctx.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
  if (plowed) {                               // bruzdy na powierzchni pola bez uprawy
    ctx.globalAlpha = .18;
    for (let y = 0; y < size; y += 16) { ctx.fillStyle = shade(.55); ctx.fillRect(0, y, size, 5); }
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(.35, .35);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// ---------- rośliny ----------

function paint(g, base, tip) {
  const p = g.attributes.position, colors = [];
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const a = new THREE.Color(base), b = new THREE.Color(tip), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(a).lerp(b, Math.min(1, Math.max(0, (p.getY(i) - min.y) / (max.y - min.y || 1))));
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Liść: zwężający się, wygięty pasek o wysokości 1, z kolorem od nasady do czubka. */
function leaf(width, bend, base, tip, segments = 5) {
  const g = new THREE.PlaneGeometry(width, 1, 1, segments).translate(0, .5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) * (1 - y * .8));
    p.setZ(i, bend * y * y);
  }
  g.computeVertexNormals();
  return paint(g, base, tip);
}

// three.js łączy tylko siatki tego samego rodzaju, więc sprowadzamy wszystkie do nieindeksowanych
const mergeGeometries = (list) => mergeRaw(list.map((g) => (g.index ? g.toNonIndexed() : g)));
const solid = (g, color) => paint(g, color, color);
const around = (g, angle, tilt = 0, y = 0) => g.rotateX(tilt).rotateY(angle).translate(0, y, 0);

/** Geometria jednej rośliny (wysokość 1, skalowana na instancji) i jej wysokość w scenie dla uprawy i fazy. Stylizacja, nie pomiar. */
function cropModel(key, stage, month) {
  const cereal = key === 'winter_wheat' || key === 'spring_barley';
  const tuft = (n, w, bend, base, tip) => mergeGeometries(Array.from({ length: n }, (_, i) =>
    around(leaf(w, bend * (.7 + .3 * (i % 2)), base, tip).scale(1, .75 + .25 * ((i * 7) % 3) / 2, 1), i * 2.4 + .3, .12 * (i % 3))));
  if (stage === 'off_season') {
    if (cereal && month >= 7 && month <= 10) {
      return { h: .09, density: .55, label: 'ściernisko po zbiorze', geometry: mergeGeometries([0, 1, 2].map((i) =>
        solid(new THREE.CylinderGeometry(.006, .008, 1, 4).translate(.03 * i, .5, .02 * (i % 2)), '#d8c48c'))) };
    }
    return { bare: true, h: 0, label: 'pole bez uprawy' };
  }
  if (cereal) {
    if (stage === 'dormant' || stage === 'initial') return { h: .16, density: 1, geometry: tuft(3, .035, .25, '#2f5d20', '#6fae45') };
    if (stage === 'development') return { h: .42, density: 1, geometry: tuft(4, .035, .3, '#2c5a1e', '#74b04a') };
    const ripe = stage === 'late';
    const stem = solid(new THREE.CylinderGeometry(.006, .009, 1, 4).translate(0, .5, 0), ripe ? '#cfae5c' : '#5f9a3a');
    const ear = solid(new THREE.CylinderGeometry(.016, .01, .16, 6).translate(0, 1.06, 0), ripe ? '#e2c370' : '#a7c25c');
    const leaves = tuft(2, .03, .35, ripe ? '#9c8442' : '#2f5f22', ripe ? '#d5b462' : '#6aa940').scale(1, .6, 1);
    return { h: .72, density: 1, geometry: mergeGeometries([stem, ear, leaves]) };
  }
  if (key === 'maize') {
    if (stage === 'initial') return { h: .2, density: .6, geometry: tuft(4, .06, .35, '#2f6a24', '#6fb048') };
    const ripe = stage === 'late';
    const [baseC, tipC] = ripe ? ['#8c7448', '#cdb072'] : ['#2b5f20', '#5fa63b'];
    const parts = [solid(new THREE.CylinderGeometry(.018, .026, 1, 6).translate(0, .5, 0), ripe ? '#a99060' : '#4b8a30')];
    [.22, .36, .5, .64, .78].forEach((y, i) => parts.push(around(leaf(.09, .45, baseC, tipC).scale(1, .55, 1), i * 2.5, -.9, y)));
    if (stage !== 'development') {
      parts.push(solid(new THREE.ConeGeometry(.03, .14, 5).translate(0, 1.06, 0), '#c9b27a'));
      parts.push(solid(new THREE.CylinderGeometry(.026, .022, .14, 6).rotateZ(.35).translate(.04, .55, 0), ripe ? '#b9965a' : '#9cc16a'));
    }
    return { h: stage === 'development' ? .8 : 1.5, density: .22, geometry: mergeGeometries(parts) };
  }
  if (key === 'winter_rapeseed' && (stage === 'mid' || stage === 'late')) {
    const flower = stage === 'mid' ? '#f3d23a' : '#8a8f48';
    const parts = [solid(new THREE.CylinderGeometry(.008, .012, 1, 4).translate(0, .5, 0), '#5d8f3a'),
      around(leaf(.08, .3, '#2f5d27', '#5e9a42').scale(1, .35, 1), 0, -.7, .15),
      around(leaf(.08, .3, '#2f5d27', '#5e9a42').scale(1, .35, 1), 3, -.7, .25)];
    for (let i = 0; i < 6; i++) parts.push(solid(new THREE.IcosahedronGeometry(.035, 0).translate(Math.cos(i) * .04, .95 + (i % 3) * .04, Math.sin(i) * .04), flower));
    return { h: 1, density: .9, geometry: mergeGeometries(parts) };
  }
  if (key === 'grassland') {
    const dry = stage === 'dormant';
    return { h: dry ? .12 : .26, density: 1.3, geometry: tuft(5, .03, .35, dry ? '#4d5f34' : '#2e6322', dry ? '#97a76a' : '#7ec052') };
  }
  // rozeta liści: ziemniak, burak, rzepak przed kwitnieniem
  const yellow = stage === 'late';
  const n = key === 'potato' ? 8 : 7;
  const parts = Array.from({ length: n }, (_, i) =>
    around(leaf(.26, .55, yellow ? '#6d6a2c' : '#24561f', yellow ? '#b6ad4c' : '#5fa344'), i * (Math.PI * 2 / n), -.75 - (i % 2) * .25));
  const h = stage === 'initial' || stage === 'dormant' ? .16 : key === 'winter_rapeseed' ? .2 : .42;
  return { h, density: .35, geometry: mergeGeometries(parts) };
}

const layerDepth = (cm) => .18 + cm * .009;   // grubość warstwy w scenie (cienkie warstwy też widoczne)
const GAP = .3;                                // odstęp między rozłożonymi warstwami

/** `cropArea`: opcjonalna geometria GeoJSON (EPSG:4326) części działki z uprawą; bez niej rośliny rosną na całej działce. */
/** `toolbar`: element po lewej w pasku nad modelem (np. przełącznik widoku); `intro`: wejście tylko przy pierwszym pokazaniu. */
export function Field3D({ report, height = 420, cropArea = null, toolbar = null, intro = false }) {
  const mount = useRef(null);
  const state = useRef({ exploded: true });
  const [exploded, setExploded] = useState(true);
  const [hovered, setHovered] = useState(null);
  const box = useRef(null);
  const profile = soilProfile(report);   // to samo znaczenie warstw i zasięgu co w tabeli gleby
  const { layers } = profile;
  const crop = report.crop;
  const month = Number(report.analysis_date.slice(5, 7));
  const label = cropModel(crop.key, crop.stage_key, month).label;
  const assumed = !report.parcel?.geometry;
  const rootCm = profile.balanceCm;   // strefa bilansu (stała); korzenie z dnia analizy: profile.rootsNowCm
  const result = report.water_status?.result;
  const fill = result && result.taw_mm > 0 ? Math.min(1, Math.max(0, result.available_mm / result.taw_mm)) : null;

  useEffect(() => {
    const el = mount.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const model = cropModel(crop.key, crop.stage_key, month);
    const shapeInfo = parcelShape(report.parcel?.geometry);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, height);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a7a66', 1.5));
    const sun = new THREE.DirectionalLight('#fff3df', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 });
    sun.shadow.bias = -.0005;
    scene.add(sun, sun.target);

    const shape = new THREE.Shape(shapeInfo.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    shapeInfo.holes.forEach((h) => shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))));

    // warstwy gleby: wytłoczony kształt działki, od powierzchni w dół
    const soil = layers.length ? layers : [{ top_cm: 0, bottom_cm: 30, texture_key: 'loam' }];
    const meshes = [];
    let depthSum = 0;
    soil.forEach((layer, i) => {
      const depth = layerDepth(layer.bottom_cm - layer.top_cm);
      const [color, grain] = SOIL[layer.texture_key] ?? ['#806048', 1];
      const tint = new THREE.Color(color).multiplyScalar(layer.top_cm < 30 ? .78 : 1);   // próchnica przyciemnia wierzch
      // warstwy w zasięgu korzeni zabarwione według zapasu z bilansu (jedna wartość dla całej strefy, jak w FAO-56)
      if (fill != null && layer.balance !== 'none') tint.lerp(new THREE.Color('#3a6a8f'), .25 * fill);
      const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: .015, bevelSize: .015, bevelSegments: 1 })
        .rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ map: soilTexture(`#${tint.getHexString()}`, grain, i === 0 && model.bare) }));
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.userData = { index: i, restY: -depthSum, explodedY: -depthSum - i * GAP };
      mesh.position.y = reduced ? mesh.userData.explodedY : mesh.userData.restY;
      scene.add(mesh);
      meshes.push(mesh);
      depthSum += depth;
    });
    const bottom = -depthSum - (soil.length - 1) * GAP;

    // korzenie widoczne na ściankach bloku gleby (jak w odkrywce profilu), do głębokości z dnia analizy
    const rootNowCm = profile.rootsNowCm ?? 0;
    if (rootNowCm > 0 && !model.bare && layers.length) {
      const ring = shapeInfo.outer;
      const signed = ring.reduce((sum, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return sum + x1 * y2 - x2 * y1; }, 0);
      const edges = ring.map((p, i) => [p, ring[(i + 1) % ring.length]]).filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6);
      const perimeter = edges.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
      const spacing = perimeter / 150;
      const strands = [];
      let carry = Math.random() * spacing;
      for (const [a, b] of edges) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const n = signed > 0 ? [t[1], -t[0]] : [-t[1], t[0]];   // normalna na zewnątrz działki
        for (let u = carry; u < len; u += spacing) {
          const base = [a[0] + t[0] * u + n[0] * .03, a[1] + t[1] * u + n[1] * .03];
          const depth = rootNowCm * (.35 + .65 * Math.sqrt(Math.random()));
          const main = [[0, 0]];
          for (let d = 0, lat = 0; d < depth;) {
            d = Math.min(depth, d + depth / 10);
            lat += (Math.random() - .5) * .035;
            main.push([d, lat]);
          }
          strands.push({ base, t, points: main });
          for (let k = 0; k < 2; k++) {   // boczne odgałęzienia
            const from = main[1 + Math.floor(Math.random() * (main.length - 2))];
            if (!from) continue;
            const dir = Math.random() < .5 ? -1 : 1, len2 = depth * (.15 + Math.random() * .25);
            strands.push({ base, t, points: [from, [from[0] + len2 * .7, from[1] + dir * (.03 + Math.random() * .05)]] });
          }
        }
        carry = (carry - len) % spacing;
        if (carry < 0) carry += spacing;
      }
      soil.forEach((layer, i) => {
        const positions = [];
        const thick = layer.bottom_cm - layer.top_cm, depth = layerDepth(thick);
        const put = (strand, [d, lat]) => positions.push(strand.base[0] + strand.t[0] * lat, -(d - layer.top_cm) / thick * depth,
          strand.base[1] + strand.t[1] * lat);
        for (const strand of strands) {
          for (let j = 1; j < strand.points.length; j++) {
            let [a, b] = [strand.points[j - 1], strand.points[j]];
            if (b[0] <= layer.top_cm || a[0] >= layer.bottom_cm) continue;
            const clip = (p, q, d) => [d, p[1] + (q[1] - p[1]) * (d - p[0]) / (q[0] - p[0] || 1)];
            if (a[0] < layer.top_cm) a = clip(a, b, layer.top_cm);
            if (b[0] > layer.bottom_cm) b = clip(a, b, layer.bottom_cm);
            put(strand, a);
            put(strand, b);
          }
        }
        if (!positions.length) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#e2d2ad', transparent: true, opacity: .7 }));
        lines.raycast = () => {};   // korzenie nie przechwytują najechania (dymek dotyczy warstwy)
        meshes[i].add(lines);
      });
    }

    // miękki cień pod modelem, żeby stał na tle strony
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: .14 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = bottom - .6;
    ground.receiveShadow = true;
    scene.add(ground);

    // linia zasięgu korzeni
    const rootY = (open) => {
      for (const mesh of meshes) {
        const layer = soil[mesh.userData.index];
        if (rootCm >= layer.bottom_cm) continue;
        const frac = Math.max(0, (rootCm - layer.top_cm) / (layer.bottom_cm - layer.top_cm));
        return (open ? mesh.userData.explodedY : mesh.userData.restY) - frac * layerDepth(layer.bottom_cm - layer.top_cm);
      }
      return open ? meshes.at(-1).userData.explodedY : meshes.at(-1).userData.restY;
    };
    let rootLine = null;
    if (rootCm > 0 && layers.length) {
      const pts = shapeInfo.outer.map(([x, y]) => new THREE.Vector3(x * 1.03, 0, y * 1.03));
      rootLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: '#2c7a40', dashSize: .25, gapSize: .15 }));
      rootLine.computeLineDistances();
      rootLine.position.y = rootY(true);
      scene.add(rootLine);
    }

    // rośliny: rzędy w granicach działki
    const spots = [];
    const xs = shapeInfo.outer.map((p) => p[0]), ys = shapeInfo.outer.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let plants = null;
    const sownPolygons = cropArea?.type === 'Polygon' ? [cropArea.coordinates] : cropArea?.type === 'MultiPolygon' ? cropArea.coordinates : null;
    const sown = sownPolygons && shapeInfo.project ? sownPolygons.map((poly) => poly[0].map(shapeInfo.project)) : null;
    if (!model.bare) {
      const target = 9000 * model.density;
      const step = Math.sqrt((maxX - minX) * (maxY - minY) / target);
      const rowGap = step * (model.density < .5 ? 1.8 : 1.15), along = step / (model.density < .5 ? 1.8 : 1.15);
      for (let y = minY + rowGap / 2; y < maxY; y += rowGap) {
        for (let x = minX + along / 2; x < maxX; x += along) {
          const p = [x + (Math.random() - .5) * along * .8, y + (Math.random() - .5) * rowGap * .25];
          if (inside(p, shapeInfo.outer) && !shapeInfo.holes.some((h) => inside(p, h))
            && (!sown || sown.some((ring) => inside(p, ring)))) spots.push(p);
        }
      }
      plants = new THREE.InstancedMesh(model.geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), spots.length);
      plants.castShadow = true;
      plants.receiveShadow = true;
      const tint = new THREE.Color();
      spots.forEach((_, i) => plants.setColorAt(i, tint.setScalar(.82 + Math.random() * .3)));
      meshes[0].add(plants);   // rośliny są częścią wierzchniej warstwy: wysuwają się i rozkładają razem z nią
    }
    const seeds = spots.map(() => [Math.random() * Math.PI * 2, .8 + Math.random() * .4, (Math.random() - .5) * .25, (Math.random() - .5) * .25]);
    const dummy = new THREE.Object3D();
    const grow = (t) => {
      if (!plants) return;
      spots.forEach(([x, y], i) => {
        const [rot, size, tx, tz] = seeds[i];
        const k = Math.min(1, Math.max(0, (t - (x - minX) / (maxX - minX + .001) * .6) / .7));
        dummy.position.set(x, 0, y);
        dummy.rotation.set(tx, rot, tz);
        dummy.scale.set(size * .9 + .1, Math.max(model.h * size * (1 - (1 - k) ** 3), .0001), size * .9 + .1);
        dummy.updateMatrix();
        plants.setMatrixAt(i, dummy.matrix);
      });
      plants.instanceMatrix.needsUpdate = true;
      plants.boundingSphere = null;   // three.js zapamiętuje sferę z pierwszego trafienia; po wzroście trzeba ją przeliczyć
      plants.boundingBox = null;
    };
    grow(reduced ? 9 : 0);

    // kamera: stały widok z przodu i z lekkiej góry, dopasowany do modelu
    const camera = new THREE.PerspectiveCamera(30, el.clientWidth / height, .1, 200);
    const center = new THREE.Vector3(0, (model.h + bottom) / 2 - .15, 0);
    const fit = () => {
      const halfW = (maxX - minX) / 2 + .6, halfH = (model.h - bottom) / 2 + 1;
      const vFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const hFov = Math.atan(Math.tan(vFov) * camera.aspect);
      const dist = Math.max(halfH / Math.tan(vFov), halfW / Math.tan(hFov)) * 1.18 + (maxY - minY) / 2;
      camera.position.copy(center).add(new THREE.Vector3(.3, .45, 1).normalize().multiplyScalar(dist));
      camera.lookAt(center);
    };
    fit();
    sun.position.set(6, center.y + 16, 8);
    sun.target.position.copy(center);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = Math.PI * .18;
    controls.maxPolarAngle = Math.PI * .5;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(9, 9);
    let moved = false;
    const onMove = (event) => {
      moved = true;
      const rect = renderer.domElement.getBoundingClientRect();
      const px = event.clientX - rect.left, py = event.clientY - rect.top;
      pointer.set(px / rect.width * 2 - 1, -py / rect.height * 2 + 1);
      // dymek jedzie za kursorem; przy prawej krawędzi przechodzi na lewą stronę kursora
      const host = box.current;
      if (host) {
        host.style.setProperty('--tip-x', `${px}px`);
        host.style.setProperty('--tip-y', `${py}px`);
        host.dataset.tipSide = px > rect.width - 300 ? 'left' : 'right';
      }
    };
    const onLeave = () => { pointer.set(9, 9); moved = true; };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    const resize = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, height);
      fit();
      controls.update();
      renderer.render(scene, camera);   // od razu: setSize czyści bufor i bez tego model mignąłby pustą klatką
    });
    resize.observe(el);

    const clock = new THREE.Clock();
    let lastHover = null, frame = 0, grown = reduced;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const open = state.current.exploded;
      meshes.forEach((mesh) => {
        const target = open && (reduced || t > .4 + mesh.userData.index * .15) ? mesh.userData.explodedY : mesh.userData.restY;
        mesh.position.y += (target - mesh.position.y) * (reduced ? 1 : .07);
        // warstwa pod kursorem wysuwa się w stronę patrzącego jak szuflada
        mesh.position.z += ((mesh.userData.index === lastHover ? .5 : 0) - mesh.position.z) * (reduced ? 1 : .15);
      });
      if (rootLine) rootLine.position.y += (rootY(open) - rootLine.position.y) * .07;
      if (!grown) { grow(t * 1.2); grown = t > 2; }
      let hit = lastHover;
      if (moved) {   // promień liczony tylko po ruchu kursora (rośliny to tysiące instancji)
        moved = false;
        raycaster.setFromCamera(pointer, camera);
        const object = raycaster.intersectObjects(meshes, true)[0]?.object;
        hit = object == null ? null : object === plants ? 'crop' : object.userData.index ?? null;
      }
      if (hit !== lastHover) {
        meshes.forEach((m, i) => m.material.emissive.set(i === hit ? '#2a2414' : '#000000'));
        plants?.material.emissive.set(hit === 'crop' ? '#1c2a12' : '#000000');
        lastHover = hit;
        setHovered(hit);
        renderer.domElement.style.cursor = hit == null ? 'grab' : 'pointer';
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [report.generated_at, height]);   // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    state.current.exploded = !state.current.exploded;
    setExploded(state.current.exploded);
  }

  const active = typeof hovered === 'number' ? layers[hovered] : null;
  return <div className="field3d" ref={box}>
    {/* na komputerze w prawym górnym rogu nad modelem, na telefonie nad nim (nie zasłania sceny) */}
    <div className={cn('no-print mb-2 flex flex-wrap items-center gap-3',
      toolbar ? 'justify-between' : 'justify-end md:absolute md:right-0 md:top-0 md:z-[2] md:mb-0')}>
      {toolbar}
      {/* stała szerokość: przy zmianie napisu ramka przycisku nie skacze */}
      <Button variant="secondary" size="xs" className="min-w-32" icon={exploded ? <Minimize2/> : <Maximize2/>} onClick={toggle}>
        {exploded ? 'Złóż warstwy' : 'Rozłóż warstwy'}</Button>
    </div>
    {/* dymki stoją w punkcie --tip-x/--tip-y liczonym od rogu płótna, więc leżą w jednym pudełku z płótnem */}
    <div className="relative">
      <div ref={mount} className={cn('field3d-canvas', intro && 'intro')} style={{ height }} role="img"
        aria-label={`Model działki: ${crop.name}, ${crop.stage_name ?? ''}; pod nią ${layers.length} ${layersWord(layers.length)} gleby`}/>
      {hovered === 'crop' && <CropTip report={report} rootCm={rootCm}/>}
      {active && <LayerTip layer={active} profile={profile}/>}
    </div>
    <div className="mt-3 min-h-12">
      <p className="text-[13px] font-medium leading-snug text-neutral-700">
        {crop.name} · {label ?? crop.stage_name?.split(' (')[0] ?? 'faza nieznana'}
        {assumed && <span className="font-normal text-neutral-500"> · kształt umowny (raport dla punktu)</span>}
      </p>
      <p className="mt-1 max-w-[72ch] text-[12px] leading-relaxed text-neutral-500">
        {layers.length ? `${layers.length} ${layersWord(layers.length)} gleby (SoilGrids). ` : 'Brak profilu gleby: warstwa umowna. '}
        {fill != null && rootCm > 0 ? `Niebieski odcień do ${number(rootCm)} cm: zapas wody w strefie korzeni (${number(fill * 100)}%). ` : ''}
        {/* wskazówka do myszy nie ma sensu na papierze */}
        <span className="no-print">Najedź na uprawę albo warstwę gleby, żeby zobaczyć szczegóły.</span>
      </p>
    </div>
  </div>;
}

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const TEXTURE = [['sand_pct', 'bg-sand'], ['silt_pct', 'bg-silt'], ['clay_pct', 'bg-clay']];
const TIP_TITLE = 'mt-1.5 text-[15px] font-semibold leading-tight tracking-tight text-neutral-950 first-letter:uppercase';   // „glina” → „Glina” (tylko wyświetlanie)
const TIP_RULE = 'border-t border-black/[0.06] pt-2';   // włosowa linia między nagłówkiem dymka a liczbami

/**
 * Dymek warstwy gleby. Położenie przy kursorze, kreska z kropką i wejście: `.layer-tip` w app.css.
 * Ten sam element zostaje przy przejściu na sąsiednią warstwę, więc kolejne dymki pokazują się od razu, bez animacji.
 */
function LayerTip({ layer, profile }) {
  return <div className="layer-tip" role="tooltip">
    {/* głębokość jako mikro-etykieta, informacja o korzeniach zwykłym pismem (wersalikami nie mieści się w jednej linii) */}
    <p className="eyebrow num">{layer.top_cm}–{layer.bottom_cm} cm
      {layer.balance !== 'none' && <span className="font-sans text-[11px] font-medium normal-case tracking-normal text-brand-700"> · {balanceText(layer, profile.balanceCm)}</span>}</p>
    <p className={TIP_TITLE}>{layer.texture_label}</p>
    {/* uziarnienie: odcinki w proporcji piasek / pył / ił, rozdzielone szczeliną zamiast obramowania */}
    <div className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      {TEXTURE.filter(([key]) => layer[key] > 0).map(([key, swatch]) =>
        <i key={key} className={cn('basis-0', swatch)} style={{ flexGrow: layer[key] }}/>)}
    </div>
    <p className="num mt-1.5 text-[12px] text-neutral-500">piasek {number(layer.sand_pct)}% · pył {number(layer.silt_pct)}% · ił {number(layer.clay_pct)}%</p>
    <dl className={TIP_RULE}>
      <dt>Woda dostępna</dt><dd>{number(layer.available_water_mm)} mm</dd>
      <dt>Pojemność polowa</dt><dd>{number(layer.field_capacity_vol_pct)}%</dd>
      <dt>Punkt więdnięcia</dt><dd>{number(layer.wilting_point_vol_pct)}%</dd>
      {layer.soc_g_kg != null && <><dt>Węgiel organiczny</dt><dd>{number(layer.soc_g_kg, 1)} g/kg</dd></>}
    </dl>
  </div>;
}

function CropTip({ report, rootCm }) {
  const crop = report.crop;
  const need = report.irrigation_need;
  const today = report.water_status?.series?.at(-1);
  const short = (iso) => iso?.slice(5).split('-').reverse().join('.');
  return <div className="layer-tip crop-tip" role="tooltip">
    <p className="eyebrow">{crop.stage_name?.split(' (')[0] ?? 'faza nieznana'}</p>
    <p className={TIP_TITLE}>{crop.name}</p>
    <dl className={TIP_RULE}>
      {today && crop.in_season !== false && <><dt>Zużycie wody dziś</dt><dd>{number(today.etc_mm, 1)} mm</dd></>}
      {crop.kc != null && <><dt>Współczynnik Kc</dt><dd>{number(crop.kc, 2)}</dd></>}
      <dt>Korzenie teraz</dt><dd>{crop.root_depth_now_m != null ? `ok. ${number(crop.root_depth_now_m * 100)} cm` : 'brak'}</dd>
      <dt>Strefa w bilansie</dt><dd>do {number(rootCm)} cm</dd>
      {crop.critical_from && <><dt>Okres krytyczny</dt><dd>{short(crop.critical_from)}–{short(crop.critical_to)}</dd></>}
    </dl>
    {need?.status === 'ok' && <>
      <p className={cn('mt-3 text-[12px] font-semibold text-neutral-900', TIP_RULE)}>Potrzeba nawadniania (netto)</p>
      <dl>
        {need.so_far_mm != null && <><dt>Ten sezon do dziś</dt><dd>{number(need.so_far_mm)} mm</dd></>}
        {need.typical_mm != null && <><dt>Typowy sezon</dt><dd>{number(need.typical_mm)} mm</dd></>}
        {need.dry_mm != null && <><dt>Suchy rok</dt><dd>{number(need.dry_mm)} mm</dd></>}
      </dl>
      {need.monthly?.some((m) => m.mm > 0) && <NeedBars monthly={need.monthly}/>}
    </>}
  </div>;
}

/** Typowa potrzeba nawadniania w kolejnych miesiącach: wąskie słupki na wspólnej linii bazowej. */
function NeedBars({ monthly }) {
  const max = Math.max(1, ...monthly.map((m) => m.mm));
  return <div className="mt-2.5 grid auto-cols-fr grid-flow-col" role="img" aria-label="Typowa potrzeba nawadniania w miesiącach">
    {monthly.map((m) => <div key={m.month} className="flex flex-col items-center gap-1">
      <div className="flex h-10 w-full items-end justify-center border-b border-black/10">
        <span className="w-3/5 max-w-3 rounded-t-[2px] bg-water-500" style={{ height: `${Math.max(2, 100 * m.mm / max)}%` }}/>
      </div>
      <small className="text-[9px] leading-none text-neutral-500">{MONTHS[m.month - 1]}</small>
    </div>)}
  </div>;
}
