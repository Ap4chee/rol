// Rośliny do modelu 3D: jedna stylizowana roślina na uprawę i fazę, powielana na polu jako instancje. Stylizacja, nie pomiar.
import * as THREE from 'three';
import { mergeGeometries as mergeRaw } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
export function cropModel(key, stage, month) {
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

