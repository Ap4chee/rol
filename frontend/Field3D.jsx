import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { IconArrowsMaximize, IconArrowsMinimize, IconRotate360 } from '@tabler/icons-react';
import { number } from './model.js';

const FIELD_SIZE = 10;            // najdłuższy bok działki w jednostkach sceny
const MAX_PLANTS = 1400;
const SOIL_COLORS = { sand: '#d2ad73', sandy_loam: '#b48552', loam: '#8f6640', silt_loam: '#7d6646', clay: '#6d4230' };

/** Kształt działki w metrach wokół środka (EPSG:4326 → lokalny układ równoodległościowy), przeskalowany do FIELD_SIZE. */
function parcelShape(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const area = (ring) => Math.abs(ring.reduce((s, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2);
  const polygon = polygons.sort((a, b) => area(b[0]) - area(a[0]))[0];
  if (!polygon) {
    const square = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    return { outer: square, holes: [], assumed: true };
  }
  const ring = polygon[0];
  const lon0 = ring.reduce((s, p) => s + p[0], 0) / ring.length, lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const project = (r) => r.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]);
  const rings = polygon.map(project);
  const xs = rings[0].map((p) => p[0]), ys = rings[0].map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = FIELD_SIZE / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const norm = rings.map((r) => r.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]));
  return { outer: norm[0], holes: norm.slice(1), assumed: false };
}

function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Wygląd uprawy w danej fazie: wysokość [jednostki sceny], kolory, kształt. Stylizacja, nie pomiar. */
function cropLook(key, stage, month) {
  const cereal = key === 'winter_wheat' || key === 'spring_barley';
  const afterHarvest = stage === 'off_season' && month >= 7 && month <= 10;
  if (stage === 'off_season') return cereal && afterHarvest ? { kind: 'stubble', h: .07, color: '#cdb57a' } : { kind: 'bare' };
  if (cereal) {
    if (stage === 'dormant' || stage === 'initial') return { kind: 'blades', h: .16, color: '#5f9e3c' };
    if (stage === 'development') return { kind: 'blades', h: .42, color: '#4f9a35' };
    if (stage === 'mid') return { kind: 'cereal', h: .7, color: '#6fa83a', ear: '#a9c45a' };
    return { kind: 'cereal', h: .72, color: '#c9a54a', ear: '#dfbf5e' };
  }
  if (key === 'maize') {
    if (stage === 'initial') return { kind: 'blades', h: .18, color: '#5aa33a' };
    if (stage === 'development') return { kind: 'maize', h: .8, color: '#4e9a33' };
    if (stage === 'mid') return { kind: 'maize', h: 1.6, color: '#3f8d2d', ear: '#e3c75a' };
    return { kind: 'maize', h: 1.55, color: '#bfa060', ear: '#d6b45a' };
  }
  if (key === 'winter_rapeseed') {
    if (stage === 'mid') return { kind: 'rapeseed', h: .95, color: '#5f9a3a', ear: '#f2d43a' };
    if (stage === 'late') return { kind: 'rapeseed', h: .95, color: '#8d9a4a', ear: '#9a9a55' };
    return { kind: 'bush', h: .16, color: '#4f8f3d' };
  }
  if (key === 'grassland') return { kind: 'blades', h: stage === 'dormant' ? .14 : .3, color: stage === 'dormant' ? '#7d9a5a' : '#58a63e' };
  // ziemniak, burak: kępy liści
  if (stage === 'initial' || stage === 'dormant') return { kind: 'bush', h: .14, color: '#5aa040' };
  if (stage === 'late') return { kind: 'bush', h: .38, color: '#a3a548' };
  return { kind: 'bush', h: .45, color: '#3f9a3a' };
}

function plantGeometries(look) {
  const parts = [];
  if (look.kind === 'cereal') {
    parts.push([new THREE.CylinderGeometry(.012, .016, 1, 4).translate(0, .5, 0), look.color]);
    parts.push([new THREE.CylinderGeometry(.03, .022, .16, 5).translate(0, 1.04, 0), look.ear]);
  } else if (look.kind === 'maize') {
    parts.push([new THREE.CylinderGeometry(.025, .035, 1, 5).translate(0, .5, 0), look.color]);
    const leaf = new THREE.BoxGeometry(.32, .012, .07).translate(.16, 0, 0);
    const leaves = [.35, .55, .75].map((y, i) => leaf.clone().rotateZ(-.5).rotateY(i * 2.1).translate(0, y, 0));
    parts.push([mergeGeometries(leaves), look.color]);
    if (look.ear) parts.push([new THREE.CylinderGeometry(.03, .03, .12, 5).translate(.04, .62, 0), look.ear]);
  } else if (look.kind === 'rapeseed') {
    parts.push([new THREE.CylinderGeometry(.015, .02, 1, 4).translate(0, .5, 0), look.color]);
    parts.push([new THREE.IcosahedronGeometry(.09, 0).scale(1, .6, 1).translate(0, 1, 0), look.ear]);
  } else if (look.kind === 'bush') {
    parts.push([new THREE.IcosahedronGeometry(.5, 0).scale(1, .8, 1).translate(0, .4, 0), look.color]);
  } else if (look.kind === 'blades' || look.kind === 'stubble') {
    parts.push([new THREE.ConeGeometry(.035, 1, 3).translate(0, .5, 0), look.color]);
  }
  return parts;
}

function mergeGeometries(list) {
  const positions = [], normals = [], indices = [];
  let offset = 0;
  for (const g of list) {
    const gi = g.index ? g : g.toNonIndexed();
    positions.push(...gi.attributes.position.array);
    normals.push(...gi.attributes.normal.array);
    if (gi.index) indices.push(...Array.from(gi.index.array, (i) => i + offset));
    offset += gi.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (indices.length) merged.setIndex(indices);
  return merged;
}

const layerDepth = (cm) => .2 + cm * .009;   // grubość w scenie: cienkie warstwy też widoczne

export function Field3D({ report, height = 420 }) {
  const mount = useRef(null);
  const state = useRef({ exploded: true });
  const [exploded, setExploded] = useState(true);
  const [hovered, setHovered] = useState(null);
  const layers = report.soil?.layers ?? [];
  const crop = report.crop;
  const month = Number(report.analysis_date.slice(5, 7));
  const look = cropLook(crop.key, crop.stage_key, month);
  const shapeInfo = parcelShape(report.parcel?.geometry);

  useEffect(() => {
    const el = mount.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, height);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, el.clientWidth / height, .1, 200);
    camera.position.set(11, 8, 12);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI * .62;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = .9;
    controls.target.set(0, -1.2, 0);
    scene.add(new THREE.HemisphereLight('#f4fbff', '#5a4a3a', 1.6));
    const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
    sun.position.set(8, 14, 6);
    scene.add(sun);

    const shape = new THREE.Shape(shapeInfo.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    shapeInfo.holes.forEach((h) => shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))));

    // warstwy gleby: wytłoczony kształt działki, od powierzchni w dół
    const soilGroup = new THREE.Group();
    scene.add(soilGroup);
    const meshes = [];
    let top = 0;
    const soil = layers.length ? layers : [{ top_cm: 0, bottom_cm: 30, texture_key: 'loam' }];
    soil.forEach((layer, i) => {
      const depth = layerDepth(layer.bottom_cm - layer.top_cm);
      const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).rotateX(Math.PI / 2);
      const material = new THREE.MeshLambertMaterial({ color: SOIL_COLORS[layer.texture_key] ?? '#8a6a48' });
      const mesh = new THREE.Mesh(geom, material);
      mesh.userData = { index: i, restY: -top, explodedY: -top - i * .28 };
      mesh.position.y = 0;
      soilGroup.add(mesh);
      meshes.push(mesh);
      top += depth;
    });
    // linia głębokości korzeni
    const rootCm = (report.soil?.root_depth_m ?? crop.root_depth_m ?? 0) * 100;
    let rootLine = null;
    if (rootCm > 0 && layers.length) {
      const pts = shapeInfo.outer.map(([x, y]) => new THREE.Vector3(x * 1.04, 0, y * 1.04));
      rootLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: '#e5f7a8', dashSize: .3, gapSize: .2 }));
      rootLine.computeLineDistances();
      scene.add(rootLine);
    }
    const rootY = (exp) => {
      let y = 0;
      for (const mesh of meshes) {
        const layer = soil[mesh.userData.index];
        if (rootCm >= layer.bottom_cm) continue;
        const frac = Math.max(0, (rootCm - layer.top_cm) / (layer.bottom_cm - layer.top_cm));
        y = (exp ? mesh.userData.explodedY : mesh.userData.restY) - frac * layerDepth(layer.bottom_cm - layer.top_cm);
        return y;
      }
      return exp ? meshes.at(-1).userData.explodedY : meshes.at(-1).userData.restY;
    };

    // rośliny: rzędy w granicach działki
    const plantGroup = new THREE.Group();
    scene.add(plantGroup);
    const spots = [];
    const xs = shapeInfo.outer.map((p) => p[0]), ys = shapeInfo.outer.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (look.kind !== 'bare') {
      const bushy = look.kind === 'bush' || look.kind === 'maize';
      const step = Math.sqrt((maxX - minX) * (maxY - minY) / MAX_PLANTS) * (bushy ? 1.5 : 1);
      for (let x = minX + step / 2; x < maxX; x += step * (bushy ? 1.4 : 1)) {
        for (let y = minY + step / 2; y < maxY; y += step * (bushy ? .8 : 1)) {
          const p = [x + (Math.random() - .5) * step * .3, y + (Math.random() - .5) * step * .3];
          if (inside(p, shapeInfo.outer) && !shapeInfo.holes.some((h) => inside(p, h))) spots.push(p);
        }
      }
    }
    const plantScale = look.kind === 'bush' ? Math.min(.9, Math.sqrt((maxX - minX) * (maxY - minY) / MAX_PLANTS) * 1.3) : 1;
    const instanced = plantGeometries(look).map(([geometry, color]) => {
      const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color }), spots.length);
      plantGroup.add(mesh);
      return mesh;
    });
    const seeds = spots.map(() => [Math.random() * Math.PI * 2, .8 + Math.random() * .4]);
    const dummy = new THREE.Object3D();
    const setPlants = (grow, sway) => {
      spots.forEach(([x, y], i) => {
        const [rot, size] = seeds[i];
        const delay = (x - minX) / (maxX - minX + .001) * .5;
        const g = Math.min(1, Math.max(0, (grow - delay) / .5));
        const h = look.h * size * (1 - (1 - g) ** 3);
        dummy.position.set(x, .001, y);
        dummy.rotation.set(Math.sin(sway + x * .6) * .05, rot, Math.cos(sway + y * .6) * .05);
        dummy.scale.set(plantScale * (look.kind === 'bush' ? size : 1), Math.max(h, .0001), plantScale * (look.kind === 'bush' ? size : 1));
        dummy.updateMatrix();
        instanced.forEach((m) => m.setMatrixAt(i, dummy.matrix));
      });
      instanced.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
    };
    setPlants(reduced ? 2 : 0, 0);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(9, 9);
    const onMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    };
    const onLeave = () => pointer.set(9, 9);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    const resize = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, height);
    });
    resize.observe(el);

    const clock = new THREE.Clock();
    let lastHover = null, frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const t = reduced ? 10 : clock.getElapsedTime();
      const open = state.current.exploded;
      meshes.forEach((mesh) => {
        const delay = .5 + mesh.userData.index * .18;
        const k = Math.min(1, Math.max(0, (t - delay) / .9));
        const target = open ? mesh.userData.explodedY : mesh.userData.restY;
        const start = t < 3 ? mesh.userData.restY : mesh.position.y;
        mesh.position.y = t < 3 ? start + (target - start) * (1 - (1 - k) ** 3) : mesh.position.y + (target - mesh.position.y) * .08;
      });
      if (rootLine) rootLine.position.y = rootLine.position.y + (rootY(open && t > 1) - rootLine.position.y) * .08;
      if (t < 4 || !reduced) setPlants(t - .2, t * 1.4);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes)[0]?.object.userData.index ?? null;
      if (hit !== lastHover) {
        meshes.forEach((m, i) => m.material.emissive.set(i === hit ? '#3a3a20' : '#000000'));
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
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [report.generated_at, height]);   // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    state.current.exploded = !state.current.exploded;
    setExploded(state.current.exploded);
  }

  const active = hovered != null ? layers[hovered] : null;
  return <div className="field3d">
    <div ref={mount} className="field3d-canvas" style={{ height }} role="img"
      aria-label={`Model działki: ${crop.name}, ${crop.stage_name ?? ''}; pod nią ${layers.length} warstw gleby`}/>
    <Group className="field3d-top no-print" gap={6}>
      <Badge variant="white" color="dark">{crop.name} · {crop.stage_name ?? 'faza nieznana'}</Badge>
      {shapeInfo.assumed && <Badge variant="white" color="gray">kształt umowny (raport dla punktu)</Badge>}
    </Group>
    <Stack className="field3d-info" gap={4}>
      {active ? <>
        <Text fw={700} size="sm">{active.top_cm}–{active.bottom_cm} cm · {active.texture_label}</Text>
        <Text size="xs">{number(active.available_water_mm)} mm wody dostępnej · pojemność polowa {number(active.field_capacity_vol_pct)}%</Text>
        <Text size="xs">piasek {number(active.sand_pct)}% · pył {number(active.silt_pct)}% · ił {number(active.clay_pct)}%</Text>
      </> : <Text size="xs">{layers.length ? 'Najedź na warstwę gleby. Przeciągnij, żeby obrócić.' : 'Brak profilu gleby: warstwa umowna.'}
        {' '}Przerywana linia: zasięg korzeni.</Text>}
    </Stack>
    <Group className="field3d-actions no-print" gap={6}>
      <Button size="compact-sm" variant="white" color="dark" leftSection={exploded ? <IconArrowsMinimize size={14}/> : <IconArrowsMaximize size={14}/>}
        onClick={toggle}>{exploded ? 'Złóż warstwy' : 'Rozłóż warstwy'}</Button>
      <IconRotate360 size={18} color="white" aria-hidden="true"/>
    </Group>
  </div>;
}
