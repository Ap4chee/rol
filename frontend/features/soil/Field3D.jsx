import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Maximize2, Minimize2 } from 'lucide-react';
import { number } from '@/shared/format/number';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';
import { cropModel } from './field3d/plants.js';
import { inside, parcelShape } from './field3d/shape.js';
import { soilTexture } from './field3d/soilTexture.js';
import { CropTip, LayerTip } from './field3d/Tips.jsx';
import { layersWord, soilProfile } from './logic.js';

const SOIL = {             // kolor bazowy i ziarno faktury dla klas uziarnienia
  sand: ['#c9a774', 1.6], sandy_loam: ['#a88458', 1.2], loam: ['#7e5d3f', .9], silt_loam: ['#8b7457', .8], clay: ['#70483a', .6],
};

const layerDepth = (cm) => .18 + cm * .009;   // grubość warstwy w scenie (cienkie warstwy też widoczne)
const GAP = .3;                                // odstęp między rozłożonymi warstwami

/**
 * `cropArea`: opcjonalna geometria GeoJSON (EPSG:4326) części działki z uprawą; bez niej rośliny rosną na całej działce.
 * `toolbar`: element po lewej w pasku nad modelem (np. przełącznik widoku); `intro`: wejście tylko przy pierwszym pokazaniu.
 * `still`: miniatura (karta pola) — scena w stanie końcowym renderowana raz do obrazka, kontekst WebGL od razu zwalniany,
 * bez obracania, dymków i podpisu (przeglądarka trzyma tylko kilkanaście kontekstów WebGL naraz).
 */
export function Field3D({ report, height = 420, cropArea = null, toolbar = null, intro = false, still = false }) {
  const mount = useRef(null);
  const state = useRef({ exploded: true });
  const [exploded, setExploded] = useState(true);
  const [hovered, setHovered] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [live, setLive] = useState(false);   // miniatura pod kursorem myszy: żywa scena (tylko jeden kontekst WebGL naraz)
  const thumb = useRef(null);
  const down = useRef(null);
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
    const reduced = still || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    const dispose = () => {
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
      renderer.dispose();
    };
    if (still && !live) {
      renderer.render(scene, camera);
      setSnapshot(renderer.domElement.toDataURL('image/png'));
      dispose();
      renderer.forceContextLoss();
      return undefined;
    }
    el.appendChild(renderer.domElement);
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
    // obrazek chowany dopiero po pierwszej klatce sceny, żeby karta nie mrugnęła pustym polem
    if (thumb.current) thumb.current.style.visibility = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      dispose();
      if (still) renderer.forceContextLoss();
      if (thumb.current) thumb.current.style.visibility = '';
      el.removeChild(renderer.domElement);
    };
  }, [report.generated_at, height, live]);   // eslint-disable-line react-hooks/exhaustive-deps

  // miniatura: obrazek; pod kursorem myszy żywa scena do obracania (dotyk zostaje przy obrazku, żeby nie blokować przewijania).
  // Karta jest linkiem: kliknięcie kończące przeciąganie nie otwiera pola.
  if (still) {
    return <div ref={mount} style={{ height }} className="relative cursor-grab active:cursor-grabbing"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setLive(true)}
      onPointerLeave={() => setLive(false)}
      onPointerDown={(e) => { down.current = [e.clientX, e.clientY]; }}
      onClick={(e) => {
        const [x, y] = down.current ?? [e.clientX, e.clientY];
        if (Math.hypot(e.clientX - x, e.clientY - y) > 4) e.preventDefault();
      }}>
      {snapshot && <img ref={thumb} src={snapshot} alt="" className="absolute inset-0 size-full object-contain animate-in fade-in duration-300"/>}
    </div>;
  }

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
    <div className="mt-3">
      <p className="text-[13px] font-medium leading-snug text-neutral-700">
        {crop.name} · {label ?? crop.stage_name?.split(' (')[0] ?? 'faza nieznana'}
        {assumed && <span className="font-normal text-neutral-500"> · kształt umowny (raport dla punktu)</span>}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-500">
        {layers.length === 0 && <span>Brak profilu gleby · warstwa umowna</span>}
        {fill != null && rootCm > 0 && <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-water-500"/>
          <span>Zapas w strefie korzeni <span className="num font-medium text-neutral-700">{number(fill * 100)}%</span></span>
        </span>}
      </div>
    </div>
  </div>;
}

