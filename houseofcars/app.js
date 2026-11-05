// app.js - House of Cars: the showroom (a ring of slides you fly between, like the site's 3D fly-through) and the Time Trial lap,
// drawn with three.js WebGPURenderer (WebGPU, or its WebGL 2 backend where WebGPU is absent). Everything it shows about a car or the
// track is READ out of Unreal (data/*.json, built by tools/build_site.py); the physics is the Chaos port (chaos_vehicle.js), the
// rules are the Time Trial Blueprints' port (rules.js), the world is the landscape + road read from the level (world.js).
// Serves UC-1.1..1.4, UC-1.1a, UC-1.2a, UC-2.1..2.5, UC-2.2a (D:/_houseofcars/USE_CASES.md).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as Rules from './rules.js';
import { loadWorld } from './world.js';
import { rotatorAxes, threeMatrix, threeMatrixFromAxes, toThreePoint, verticalFovDeg } from './ue_space.js';
import { makeRig, updateRig } from './camera_rig.js';
import { SLIDES } from './slides.js';

// AUTHORED for the page itself (look and layout, never presented as Unreal's): see AUTHORED in the report
export const AUTHORED = [
  'showroom: the ring, its radius, the pedestals, the slide panels, the turntable spin and the fly speed are the page\'s own layout',
  'lighting: an environment map, a hemisphere light and a sun whose DIRECTION is the level\'s DirectionalLight rotator (READ) but whose intensity is the page\'s (Unreal\'s Lumen lighting is not ported)',
  'sky: a plain gradient of the page\'s own. The level\'s SM_SkySphere baked to black in the glTF export (measured: a black sky in the first race screenshot); the sky Unreal shows comes from SkyAtmosphere and VolumetricCloud, which glTF cannot carry',
  'gates are invisible in Unreal (a BoxComponent each); the G key draws them for review only',
  'touch controls: on-screen buttons of the page\'s own (Unreal\'s UI_Touch_Vehicle widget is not ported)',
  'physics runs at a fixed 120 Hz on the page (Unreal ticks Chaos with the engine\'s own substepping)',
];

const $ = (id) => document.getElementById(id);
const fetchJson = (f) => fetch('data/' + f).then((r) => { if (!r.ok) throw new Error('data/' + f + ': ' + r.status); return r.json(); });
const fetchBin = (f) => fetch('data/' + f).then((r) => { if (!r.ok) throw new Error('data/' + f + ': ' + r.status); return r.arrayBuffer(); });
const canvas = $('view');
const loader = new GLTFLoader();
const glbCache = new Map();
const prog = new Map();                          // UC-4.2b: the loading bar shows real bytes, per file, as they arrive
function showProgress() {
  let l = 0, t = 0;
  for (const v of prog.values()) { l += v.l; t += v.t; }
  const bar = document.querySelector('#bar i');
  if (bar && t) { bar.style.width = (100 * l / t).toFixed(0) + '%'; $('lmb').textContent = (l / 1e6).toFixed(1) + ' / ' + (t / 1e6).toFixed(1) + ' MB'; }
}
const loadGlb = (url) => {
  if (!glbCache.has(url)) glbCache.set(url, loader.loadAsync(url, (e) => { prog.set(url, { l: e.loaded, t: e.total || e.loaded }); showProgress(); }));
  return glbCache.get(url);
};
const meshUrl = (assetPath) => 'data/meshes/' + assetPath.split('/').pop().split('.').pop() + '.glb';   // "/Game/X/SM_A.SM_A" or "/Game/X/SM_A"

// ---------------------------------------------------------------- renderer (UC-1.1, UC-1.1a)
function webgl2Available() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } }
if (!navigator.gpu && !webgl2Available()) {
  $('nogpu').style.display = 'grid';
  $('loading').remove();
  throw new Error('House of Cars: no WebGPU and no WebGL 2');
}
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
await renderer.init();
const BACKEND = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
$('renderer').textContent = BACKEND;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const [SHOW, TRACK, RULES, CAMS] = await Promise.all([fetchJson('showroom.json'), fetchJson('track.json'), fetchJson('timetrial_rules.json'), fetchJson('camera.json')]);
window.HOC = { BACKEND, SHOW, TRACK, RULES, state: null };   // for the page check (test/page_check.mjs) and for review in devtools

// ---------------------------------------------------------------- a car out of its Unreal parts (UC-1.2)
// Each part's mesh is the glTF Unreal exported; it hangs at the transform READ off the spawned pawn (actor space).
async function buildCar(entry) {
  const car = new THREE.Group();
  car.name = entry.name;
  const wheels = [];
  if (entry.drivable) {
    for (const p of entry.parts) {
      const g = await loadGlb(meshUrl(p.mesh));
      const node = new THREE.Group();
      node.add(g.scene.clone(true));
      node.matrixAutoUpdate = false;
      node.matrix.fromArray(threeMatrix(p.rotation, p.scale, p.location));
      if (!p.visible) node.visible = false;
      car.add(node);
      const w = entry.wheels.findIndex((x) => x.bone === p.attach_socket || x.bone.replace('Phys', 'Vis') === p.attach_socket || 'VisWheel' + x.bone.slice(-3) === p.attach_socket);
      if (w >= 0) wheels[w] = { node, part: p };
    }
  } else {
    const g = await loadGlb(meshUrl(entry.mesh));
    car.add(g.scene.clone(true));
  }
  car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: car, wheels };
}

// wheel pose: the READ rest transform, spun about the car's Y (the axle) and steered about its Z, at the bone + suspension offset
function poseWheel(w, steerDeg, spinRad, suspensionCm) {
  const rest = rotatorAxes(w.part.rotation).map((a, i) => a.map((v) => v * w.part.scale[i]));
  const spin = rotatorAxes({ pitch: -spinRad * 180 / Math.PI, yaw: 0, roll: 0 });
  const steer = rotatorAxes({ pitch: 0, yaw: steerDeg, roll: 0 });
  const apply = (M, v) => [0, 1, 2].map((k) => M[0][k] * v[0] + M[1][k] * v[1] + M[2][k] * v[2]);
  const axes = rest.map((v) => apply(steer, apply(spin, v)));
  const loc = [w.part.location[0], w.part.location[1], w.part.location[2] + suspensionCm];
  w.node.matrix.fromArray(threeMatrixFromAxes(axes, [1, 1, 1], loc));
}

// ---------------------------------------------------------------- the flyout: every section of the lot is a slide on a ring (UC-1, UC-5)
// The order is a dealership homepage's (slides.js); the car slides are the cars READ out of Unreal (data/showroom.json).
const show = { scene: new THREE.Scene(), slides: [], index: 0, angle: 0, targetAngle: 0, lastCar: 'SportsCar' };
show.scene.environment = envTex;
show.scene.background = new THREE.Color(0x07090c);
{ // the room (AUTHORED look): a dark dome, a glossy floor, an orange light ring, a key light and soft fill
  const g = new THREE.SphereGeometry(160, 48, 24), col = [];
  for (let i = 0; i < g.attributes.position.count; i++) {
    const h = Math.max(0, g.attributes.position.getY(i) / 160);
    const c = new THREE.Color(0x202a38).lerp(new THREE.Color(0x07090c), Math.pow(h, 0.45));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  show.scene.add(new THREE.Mesh(g, new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false })));
}
show.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1410, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.8);
key.position.set(10, 22, 14); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 90 });
show.scene.add(key);
const RING = 15;                                      // m (layout, AUTHORED): ten slides round the ring
const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 128), new THREE.MeshStandardNodeMaterial({ color: 0x0a0c0f, roughness: 0.14, metalness: 0.7 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; show.scene.add(floor);
const ringLight = new THREE.Mesh(new THREE.TorusGeometry(RING, 0.05, 8, 256), new THREE.MeshBasicNodeMaterial({ color: 0xff6a1a }));
ringLight.rotation.x = Math.PI / 2; ringLight.position.y = 0.03; show.scene.add(ringLight);
const showCam = new THREE.PerspectiveCamera(40, 1, 0.1, 500);

function panelTexture(def, car) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 576;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 576); grd.addColorStop(0, '#171b22'); grd.addColorStop(1, '#0e1116');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 576);
  g.strokeStyle = 'rgba(255,106,26,.75)'; g.lineWidth = 6; g.strokeRect(6, 6, 1012, 564);
  g.fillStyle = '#ff6a1a'; g.fillRect(48, 70, 12, 132);
  const kicker = car ? (car.drivable ? 'On the lot · drivable' : 'On the lot · showroom only') : def.kicker;
  const title = car ? car.name.replace(/([a-z])([A-Z])/g, '$1 $2') : def.title;
  g.fillStyle = '#ffb07f'; g.font = '600 34px system-ui, sans-serif'; g.fillText(kicker.toUpperCase(), 80, 102);
  g.fillStyle = '#eef1f5'; g.font = '800 88px system-ui, sans-serif'; g.fillText(title, 78, 190);
  let lines = def.lines;
  if (car) {
    const pick = (l) => car.specs.find((s) => s.label === l);
    lines = (car.drivable ? ['Max torque', 'Peak power', 'Top gear at redline', 'Drive'] : ['Length x width x height', 'Engine, gears, wheels'])
      .map((l) => { const s = pick(l); return s ? l + ': ' + s.value + (s.unit ? ' ' + s.unit : '') : null; }).filter(Boolean);
  }
  g.font = '500 40px system-ui, sans-serif'; g.fillStyle = '#d7dde5';
  lines.forEach((l, i) => g.fillText(l, 80, 290 + i * 62));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

const carEntry = (name) => { const e = SHOW.cars.find((c) => c.name === name); if (!e) throw new Error('slides.js names a car showroom.json lacks: ' + name); return e; };
for (let i = 0; i < SLIDES.length; i++) {
  const def = SLIDES[i];
  const a = (i / SLIDES.length) * Math.PI * 2;
  const stand = new THREE.Group();
  stand.position.set(Math.sin(a) * RING, 0, Math.cos(a) * RING);
  stand.rotation.y = a;
  const car = def.kind === 'car' ? carEntry(def.car) : null;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(car ? 5.0 : 6.2, car ? 2.8 : 3.5), new THREE.MeshBasicNodeMaterial({ map: panelTexture(def, car) }));
  panel.position.set(0, car ? 4.0 : 2.6, car ? -4.2 : 0);
  stand.add(panel);
  let turn = null;
  if (car) {
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.3, 0.3, 64), new THREE.MeshStandardNodeMaterial({ color: 0x23272e, roughness: 0.3, metalness: 0.6 }));
    ped.position.y = 0.15; ped.receiveShadow = true; stand.add(ped);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.03, 8, 128), new THREE.MeshBasicNodeMaterial({ color: 0xff6a1a }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.31; stand.add(rim);
    const spot = new THREE.SpotLight(0xffffff, 140, 18, 0.55, 0.6, 1.6);
    spot.position.set(0, 9, 3); spot.target.position.set(0, 0.6, 0); stand.add(spot, spot.target);
    const { group } = await buildCar(car);
    turn = new THREE.Group();
    if (car.drivable) turn.position.y = 0.3 - Math.min(...car.wheels.map((w) => w.bone_location[2] - w.radius)) / 100;   // wheels on the pedestal
    else turn.position.y = 0.3 - (car.bounds_cm.origin[2] - car.bounds_cm.box_extent[2]) / 100;
    turn.add(group); stand.add(turn);
  } else {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.12, 0.9), new THREE.MeshStandardNodeMaterial({ color: 0x23272e, roughness: 0.3, metalness: 0.6 }));
    plinth.position.set(0, 0.06, 0); stand.add(plinth);
  }
  show.scene.add(stand);
  show.slides.push({ def, car, stand, turn, angle: a });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderCard() {
  const s = show.slides[show.index], d = s.def, card = $('card');
  if (s.car) {
    const e = s.car;
    const rows = e.specs.map((sp, k) => '<dt>' + esc(sp.label) + '</dt><dd>' + esc(sp.value) + (sp.unit ? ' ' + esc(sp.unit) : '') +
      '<button class="src k-' + sp.kind + '" data-k="' + k + '" title="' + sp.kind + ': where this came from">' + sp.kind + '</button></dd>').join('');
    card.innerHTML = '<p class="kick">' + (e.drivable ? 'On the lot · drivable' : 'On the lot · showroom only') + '</p><h2>' + esc(e.name.replace(/([a-z])([A-Z])/g, '$1 $2')) +
      '</h2><div class="sub">' + esc(e.drivable ? e.blueprint : e.mesh) + '</div><dl>' + rows + '</dl><div id="srcline">Press a badge to see where the number came from.</div>';
    card.querySelectorAll('button.src').forEach((b) => b.addEventListener('click', () => { $('srcline').textContent = e.specs[+b.dataset.k].src; }));
  } else {
    const picks = (d.picks || []).map((p) => '<button class="pick" data-car="' + p.car + '">' + esc(p.label) + ' &rarr; ' + esc(p.car.replace(/([a-z])([A-Z])/g, '$1 $2')) + '</button>').join('');
    let acts = (d.actions || []).map((a, k) => a.href ? '<a class="act" href="' + esc(a.href) + '">' + esc(a.label) + '</a>' : '<button class="act" data-a="' + k + '">' + esc(a.label) + '</button>').join('');
    if (d.drives) acts += SHOW.cars.filter((c) => c.drivable).map((c) => '<button class="act" data-car="' + c.name + '">Drive the ' + esc(c.name.replace(/([a-z])([A-Z])/g, '$1 $2')) + '</button>').join('');
    card.innerHTML = '<p class="kick">' + esc(d.kicker) + '</p><h2>' + esc(d.title) + '</h2>' + d.body.map((p) => '<p>' + esc(p) + '</p>').join('') +
      (picks ? '<div class="picks">' + picks + '</div>' : '') + (acts ? '<div class="acts">' + acts + '</div>' : '');
    card.querySelectorAll('button.pick').forEach((b) => b.addEventListener('click', () => select(show.slides.findIndex((x) => x.car && x.car.name === b.dataset.car))));
    card.querySelectorAll('button.act').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.car) { startRace(carEntry(b.dataset.car)); return; }
      const a = d.actions[+b.dataset.a];
      if (a.go) select(show.index + a.go);
      if (a.drive) startRace(carEntry(show.lastCar));
    }));
  }
  const drivable = s.car ? s.car.drivable : s.def.kind === 'drive';
  $('drive').disabled = !drivable;
  $('drive').textContent = s.car && !s.car.drivable ? 'SHOWROOM ONLY' : 'TEST DRIVE';
  $('drive').title = drivable ? 'Race the Time Trial lap in ' + (s.car ? s.car.name : show.lastCar) : 'This car is a static mesh in Unreal: nothing to drive';
  $('pos').textContent = (show.index + 1) + ' / ' + show.slides.length;
}
function select(i) {
  show.index = (i + show.slides.length) % show.slides.length;
  const s = show.slides[show.index];
  if (s.car && s.car.drivable) show.lastCar = s.car.name;
  let d = s.angle - show.targetAngle;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  show.targetAngle += d;
  renderCard();
}
$('prev').onclick = () => select(show.index - 1);
$('next').onclick = () => select(show.index + 1);
$('drive').onclick = () => { const s = show.slides[show.index]; startRace(s.car ? s.car : carEntry(show.lastCar)); };
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
canvas.addEventListener('click', (ev) => {
  if (mode !== 'show') return;
  ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, showCam);
  const hit = ray.intersectObjects(show.slides.map((c) => c.stand), true)[0];
  if (hit) { const i = show.slides.findIndex((c) => { let o = hit.object; while (o) { if (o === c.stand) return true; o = o.parent; } return false; }); if (i >= 0 && i !== show.index) select(i); }
});
let dragX = null;
canvas.addEventListener('pointerdown', (e) => { dragX = e.clientX; });
canvas.addEventListener('pointerup', (e) => { if (mode === 'show' && dragX !== null && Math.abs(e.clientX - dragX) > 60) select(show.index + (e.clientX < dragX ? 1 : -1)); dragX = null; });

function tickShow(dt) {
  show.angle += (show.targetAngle - show.angle) * Math.min(1, dt * 2.6);
  const aspect = innerWidth / innerHeight;
  const a = show.angle, R = RING + 10.5 * (aspect < 1 ? Math.min(2.2, 0.85 / aspect) : 1);   // portrait: back off so the slide fits the width
  const side = innerWidth > 900 ? 1.6 : 0;      // desktop: look a little left of the slide so the card on the right does not cover it
  const bob = Math.sin(performance.now() / 2400) * 0.12;
  showCam.position.set(Math.sin(a) * R + Math.cos(a) * side, 2.5 + bob, Math.cos(a) * R - Math.sin(a) * side);
  showCam.lookAt(Math.sin(a) * RING + Math.cos(a) * side, 1.6, Math.cos(a) * RING - Math.sin(a) * side);
  show.slides.forEach((c, i) => { if (c.turn && i === show.index) c.turn.rotation.y += dt * 0.35; });
  renderer.render(show.scene, showCam);
}

// ---------------------------------------------------------------- the Time Trial (UC-2.1..2.5)
let race = null;
async function buildTrack() {
  const scene = new THREE.Scene();
  scene.environment = envTex;
  scene.background = new THREE.Color(0x9fb6cf);
  const skyGeo = new THREE.SphereGeometry(2500, 32, 16), skyCol = [];
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const h = Math.max(0, skyGeo.attributes.position.getY(i) / 2500);       // 0 at the horizon, 1 overhead
    const c = new THREE.Color(0xdfe7ee).lerp(new THREE.Color(0x4f7fb5), Math.pow(h, 0.6));
    skyCol.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyCol, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
  sky.renderOrder = -1; sky.frustumCulled = false; sky.name = 'page-sky';
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a4036, 0.9));
  // the sun: Unreal's DirectionalLight shines along its rotator's X axis (READ: track actors)
  const L = (await fetchJson('track_lights.json')).directional;
  const dir = toThreePoint(rotatorAxes(L.rotation)[0].map((v) => v * 100));
  const sun = new THREE.DirectionalLight(0xfff3e0, 3.0);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 400 });
  scene.add(sun, sun.target);
  // the ground: the traced heights and normals, coloured by M_Landscape's own graph (data/track.json landscape_material)
  const G = TRACK.ground.grid, M = TRACK.landscape_material;
  const H = new Float32Array(await fetchBin('ground_height.bin')), N = new Float32Array(await fetchBin('ground_normal.bin'));
  const n = G.nx * G.ny, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    const k = j * G.nx + i;
    const p = toThreePoint([G.origin_cm[0] + i * G.step_cm, G.origin_cm[1] + j * G.step_cm, H[k]]);
    pos.set(p, 3 * k);
    nor.set([N[3 * k], N[3 * k + 2], N[3 * k + 1]], 3 * k);
    const up = N[3 * k] * M.slope_axis[0] + N[3 * k + 1] * M.slope_axis[1] + N[3 * k + 2] * M.slope_axis[2];
    const a = Math.pow(Math.max(up, 0), M.slope_exponent);              // lerp(RoadCol, GroundCol, pow(dot(N, axis), exponent))
    for (let c = 0; c < 3; c++) col[3 * k + c] = M.road_col[c] + (M.ground_col[c] - M.road_col[c]) * a;
  }
  const idx = new Uint32Array((G.nx - 1) * (G.ny - 1) * 6);
  let q = 0;
  for (let j = 0; j < G.ny - 1; j++) for (let i = 0; i < G.nx - 1; i++) {
    const a = j * G.nx + i, b = a + 1, c = a + G.nx, d = c + 1;
    idx.set([a, c, b, b, c, d], q); q += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: M.roughness, metalness: 0, side: THREE.DoubleSide }));
  ground.receiveShadow = true;
  scene.add(ground);
  // the road, tunnel, cones, walls and sky, as Unreal's glTF exporter wrote them
  const trk = await loadGlb('data/' + TRACK.glb);
  const t = trk.scene.clone(true);
  t.traverse((o) => {
    if (!o.isMesh) return;
    if (/SkySphere/i.test(o.name) || /SkySphere/i.test(o.material?.name || '')) { o.visible = false; return; }   // see AUTHORED: sky
    o.castShadow = true; o.receiveShadow = true;
  });
  scene.add(t);
  // the gates (G toggles; invisible in Unreal)
  const gates = new THREE.Group(); gates.visible = false;
  for (const g of TRACK.gates) {
    const he = g.half_extent_cm;
    const box = new THREE.Mesh(new THREE.BoxGeometry(2 * he[0] / 100, 2 * he[2] / 100, 2 * he[1] / 100),
      new THREE.MeshBasicNodeMaterial({ color: g.finish ? 0xffffff : 0xff6a1a, transparent: true, opacity: 0.18, depthWrite: false }));
    box.matrixAutoUpdate = false;
    box.matrix.fromArray(threeMatrix({ pitch: g.pitch_deg, yaw: g.yaw_deg, roll: g.roll_deg }, [1, 1, 1], g.center_cm));
    gates.add(box);
  }
  scene.add(gates);
  return { scene, sun, sunDir: dir, gates, sky };
}

let trackView = null, world = null, Chaos = null;
async function startRace(entry) {
  $('loading').style.display = 'grid'; $('lt').textContent = 'Rolling the car out to the track…';
  if (!Chaos) Chaos = await import('./chaos_vehicle.js');
  if (!trackView) { trackView = await buildTrack(); world = await loadWorld(fetchBin, TRACK); }
  if (race && race.car) trackView.scene.remove(race.car.group);
  const carJson = (await fetchJson('cars.json')).cars[entry.name];
  const car = await buildCar(entry);
  trackView.scene.add(car.group);
  car.group.matrixAutoUpdate = false;
  const gravity = (await fetchJson('physics.json')).gravity_z.value;
  const unexported = (await fetchJson('chaos_unexported.json')).cars[entry.name];   // tools/ue_unexported.mjs: the .uasset chain
  const v = Chaos.makeVehicle(carJson, { gravityZ: gravity, unexported, angularDampingOnGround: RULES.angular_damping.on_ground, angularDampingInAir: RULES.angular_damping.in_air });
  const start = TRACK.player_start;
  Chaos.resetVehicle(v, start.location_cm, start.yaw_deg);
  const arm = CAMS.cars[entry.name].BackSpringArm, cam = CAMS.cars[entry.name].BackCamera;
  race = { entry, car, v, rules: Rules.makeRace(TRACK.gates, RULES), now: 0, rig: makeRig(arm), fov: cam.field_of_view,
           inside: TRACK.gates.map(() => false), carBox: carJson.bounds_cm.value, front: false };
  window.HOC.state = race;
  race.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
  mode = 'race';
  $('showroom').style.display = 'none'; $('race').style.display = 'block'; $('loading').style.display = 'none';
  $('t-best').textContent = '—';
}
function backToShowroom() {
  mode = 'show';
  $('showroom').style.display = ''; $('race').style.display = 'none';
}

// keys, as IMC_Vehicle_Default maps them (data: ue_out/bp/IMC_Vehicle_Default.t3d), plus Esc and G for the page
const keys = new Set();
const touch = { throttle: false, brake: false, left: false, right: false };
addEventListener('keydown', (e) => {
  if (mode === 'show') {
    if (e.key === 'ArrowLeft') select(show.index - 1);
    if (e.key === 'ArrowRight') select(show.index + 1);
    if (e.key === 'Enter' && !$('drive').disabled) $('drive').click();
    return;
  }
  if (e.key === 'Escape') { backToShowroom(); return; }
  if (e.key === 'Tab') { e.preventDefault(); race.front = !race.front; return; }
  if (e.key === 'g' || e.key === 'G') { trackView.gates.visible = !trackView.gates.visible; return; }
  if (e.key === 'Backspace') { e.preventDefault(); doReset(); return; }
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
$('back').addEventListener('click', () => backToShowroom());   // UC-5.6: a phone has no Esc
document.querySelectorAll('#touch button').forEach((b) => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (k === 'reset') doReset(); else touch[k] = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { if (k !== 'reset') touch[k] = false; });
});
function readInput() {
  const on = (...c) => c.some((x) => keys.has(x));
  return {
    throttle: on('KeyW', 'ArrowUp') || touch.throttle ? 1 : 0,
    brake: on('KeyS', 'ArrowDown') || touch.brake ? 1 : 0,
    steering: (on('KeyD', 'ArrowRight') || touch.right ? 1 : 0) - (on('KeyA', 'ArrowLeft') || touch.left ? 1 : 0),
    handbrake: on('Space') ? 1 : 0,
  };
}
// chaos_vehicle.js v.rot: a nested 3x3, row i = world axis i, column j = the body's axis j (X forward, Y right, Z up) in world
function carAxes(v) { const r = v.rot; return [0, 1, 2].map((j) => [r[0][j], r[1][j], r[2][j]]); }
function doReset() {                                   // IA_Reset / Manual_Reset (rules.resetPose): here, +offset, yaw only, stopped
  const [X] = carAxes(race.v);
  const p = Rules.resetPose(race.v.pos, Math.atan2(X[1], X[0]) * 180 / Math.PI, RULES);
  Chaos.resetVehicle(race.v, p.pos, p.yawDeg);
}

// the car's box (READ bounds) against each gate's box: separating axes on the X/Y plane and Z (gates stand upright)
function overlapsGate(v, box, g) {
  const [X, Y] = carAxes(v);
  const c = [0, 1, 2].map((k) => v.pos[k] + X[k] * box.origin[0] + Y[k] * box.origin[1]);
  const gy = g.yaw_deg * Math.PI / 180, GX = [Math.cos(gy), Math.sin(gy)], GY = [-Math.sin(gy), Math.cos(gy)];
  const d = [c[0] - g.center_cm[0], c[1] - g.center_cm[1]];
  if (Math.abs(v.pos[2] + box.origin[2] - g.center_cm[2]) > box.box_extent[2] + g.half_extent_cm[2]) return false;
  const axes = [GX, GY, [X[0], X[1]], [Y[0], Y[1]]];
  for (const a of axes) {
    const L = Math.hypot(a[0], a[1]); const u = [a[0] / L, a[1] / L];
    const rCar = box.box_extent[0] * Math.abs(X[0] * u[0] + X[1] * u[1]) + box.box_extent[1] * Math.abs(Y[0] * u[0] + Y[1] * u[1]);
    const rGate = g.half_extent_cm[0] * Math.abs(GX[0] * u[0] + GX[1] * u[1]) + g.half_extent_cm[1] * Math.abs(GY[0] * u[0] + GY[1] * u[1]);
    if (Math.abs(d[0] * u[0] + d[1] * u[1]) > rCar + rGate) return false;
  }
  return true;
}

const STEP = 1 / 120;
let acc = 0;
function tickRace(dt) {
  const r = race;
  Rules.tickCountdown(r.rules, dt, r.now);
  const raw = readInput();
  const input = Rules.inputEnabled(r.rules) ? raw : { throttle: 0, brake: 0, steering: 0, handbrake: 0 };
  acc += Math.min(dt, 0.1);
  while (acc >= STEP) {
    Chaos.stepVehicle(r.v, input, STEP, world);
    r.now += STEP; acc -= STEP;
    TRACK.gates.forEach((g, i) => {
      const inNow = overlapsGate(r.v, r.carBox, g);
      if (inNow && !r.inside[i]) Rules.gateOverlapBegin(r.rules, i, r.now);    // ReceiveActorBeginOverlap
      r.inside[i] = inNow;
    });
  }
  const [X, Y, Z] = carAxes(r.v);
  if (Rules.tickFlipCheck(r.rules, dt, Z[2])) doReset();
  // draw the car
  r.car.group.matrix.fromArray(threeMatrixFromAxes([X, Y, Z], [1, 1, 1], r.v.pos));
  r.car.wheels.forEach((w, i) => { if (w) { const s = r.v.wheels[i]; poseWheel(w, s.steerDeg, s.spinRad, s.suspensionOffsetCm); } });
  // the camera: BackSpringArm (or FrontSpringArm on Tab)
  const cam = r.camera;
  if (r.front) {
    const fa = CAMS.cars[r.entry.name].FrontSpringArm.relative_location;
    const e = [0, 1, 2].map((k) => r.v.pos[k] + X[k] * fa[0] + Y[k] * fa[1] + Z[k] * fa[2]);
    const l = [0, 1, 2].map((k) => e[k] + X[k] * 1000);
    cam.position.fromArray(toThreePoint(e)); cam.up.fromArray([Z[0], Z[2], Z[1]]); cam.lookAt(...toThreePoint(l));
    cam.fov = verticalFovDeg(CAMS.cars[r.entry.name].FrontCamera.field_of_view, cam.aspect);
  } else {
    const rig = updateRig(r.rig, r.v.pos, [X, Y, Z], dt);
    cam.position.fromArray(toThreePoint(rig.eye)); cam.up.set(0, 1, 0); cam.lookAt(...toThreePoint(rig.look));
    cam.fov = verticalFovDeg(r.fov, cam.aspect);
  }
  cam.updateProjectionMatrix();
  // the sun's shadow and the sky follow the car
  const cp = toThreePoint(r.v.pos);
  trackView.sky.position.copy(cam.position);
  trackView.sun.target.position.set(cp[0], cp[1], cp[2]);
  trackView.sun.position.set(cp[0] - trackView.sunDir[0] * 1.5, cp[1] - trackView.sunDir[1] * 1.5, cp[2] - trackView.sunDir[2] * 1.5);
  // HUD: UI_Vehicle (speed, gear), UI_Timetrial (time, best), UI_Start (countdown)
  $('speed').textContent = Rules.speedText(r.v.forwardSpeedCmS, RULES);
  $('unit').textContent = RULES.speed.unit;
  $('gear').textContent = Rules.gearText(r.v.gear, RULES);
  $('t-now').textContent = Rules.timeText(r.rules, r.now);
  if (r.rules.bestText) $('t-best').textContent = r.rules.bestText;
  $('countdown').textContent = r.rules.countdown.removed ? '' : r.rules.countdown.text;
  renderer.render(trackView.scene, cam);
}

// ---------------------------------------------------------------- the loop
let mode = 'show', last = performance.now();
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  showCam.aspect = innerWidth / innerHeight; showCam.updateProjectionMatrix();
  if (race) { race.camera.aspect = innerWidth / innerHeight; }
}
addEventListener('resize', resize); resize();
select(0);
$('loading').style.display = 'none';
renderer.setAnimationLoop(() => {
  const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (mode === 'show') tickShow(dt); else tickRace(dt);
});
