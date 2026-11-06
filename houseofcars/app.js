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
import { svgIcon, drawIcon } from './icons.js';
import { studioEnvironment, upgradePaint, polishedTops, glowMaterial, makePost, physicalSky, setPaint, paint, groundDetail, lightBeam } from './fx.js';
import { makeAudio, driveSound, silence, blip } from './audio.js';
import { buildTach, updateTach, popCountdown, lapBanner, readRecord, writeRecord, buildMinimap, drawMinimap } from './hud.js';
import { makeSkids, clearSkids, laySkids, slideAmount } from './effects.js';
import { makeGamepad, readGamepad, readPadRaw } from './gamepad.js';
import { makeRecorder, record, saveGhost, loadGhost, ghostPose } from './ghost.js';
import { overlapsGate, carAxes } from './gates.js';   // one gate test for the page and the sim (tools/sim_ghost.mjs)
import { loadHoles, withHoles } from './ground_holes.js';
import * as AI from './ai_driver.js';
import { lotCars, leadsFor, compareHTML, priceVsPace } from './sale.js';                  // the page's own driver (UC-9.2): the sim's ghosts, and the page check's lap

// AUTHORED for the page itself (look and layout, never presented as Unreal's): see AUTHORED in the report
export const AUTHORED = [
  'showroom: the ring, its radius, the pedestals, the slide panels, the turntable spin and the fly speed are the page\'s own layout',
  'look (fx.js): a studio light environment, clear-coated paint, polished reflective pedestal tops, bloom on the accent lights, a vignette and 4x multisampling are the page\'s own',
  'lighting: an environment map, a hemisphere light and a sun whose DIRECTION is the level\'s DirectionalLight rotator (READ) but whose intensity is the page\'s (Unreal\'s Lumen lighting is not ported)',
  'sky: three.js SkyMesh (physical scattering) lit from the READ sun direction, distance fog, and the same sky as the paint\'s light probe, all the page\'s own. The level\'s SM_SkySphere baked to black in the glTF export (measured: a black sky in the first race screenshot); the sky Unreal shows comes from SkyAtmosphere and VolumetricCloud, which glTF cannot carry',
  'gates are invisible in Unreal (a BoxComponent each); the G key draws them for review only. The floating marker over the NEXT gate (the rules\' target) is the page\'s own',
  'sound (audio.js): a synthesised engine note on the ported RPM and throttle, tyre noise on Unreal\'s IsSkidding / IsSlipping, wind, beeps and chimes; the voicing is the page\'s own (no Unreal sound is ported)',
  'instruments (hud.js): the tachometer drawing (its scale and red band are the READ max and change-up RPM), the countdown motion, the lap banner with its split, the minimap, and the device record (the Blueprint\'s Best Time lasts one play)',
  'skid marks and tyre smoke (effects.js): laid where Unreal\'s IsSkidding / IsSlipping hold, at the wheel trace hit, READ wheel_width wide; their darkness, soft edges, fading and amount are the page\'s',
  'ghost (ghost.js): the best lap driven on this device, recorded on the rules\' lap clock and replayed as a see-through car; the page\'s own',
  'ground detail (fx.js groundDetail): a two-scale noise over M_Landscape\'s READ colours, the page\'s own (Unreal\'s landscape layers are not ported)',
  'touch controls: on-screen buttons of the page\'s own (Unreal\'s UI_Touch_Vehicle widget is not ported)',
  'gamepad: the bindings and dead zones are READ (data/input.json); the W3C standard layout they are matched to is the browser\'s. In the showroom (no Unreal binding): the d-pad or stick browses, A drives',
  'showroom light beams (fx.js lightBeam) and the save-picture button are the page\'s own',
  'intro: the camera sweep onto the lot and the card motion are the page\'s own (none when the OS asks for reduced motion)',
  'cars for sale: their physics are tools/sim_car.py (READ factory numbers on the template SportsCar, every stand-in named in data/sim_cars); their bodies are Meshy models; they ride the SportsCar\'s cameras',
  'selling tools (sale.js): the leads-the-lot badges, compare table and price-vs-pace chart are DERIVED from READ figures and the sim laps; the share link, QR code and kiosk tour are the page\'s own',
  'paint picker: the colours are the page\'s own; Factory is the colour Unreal\'s glTF export baked. Dragging a car turns it on its pedestal',
  'resolution: the page picks its own pixel ratio from the frame time (the Resolution pill says which)',
  'physics runs at a fixed 120 Hz on the page (Unreal ticks Chaos with the engine\'s own substepping)',
];

const $ = (id) => document.getElementById(id);
const CSSV = (n) => { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); if (!v) throw new Error('index.html :root lacks ' + n); return v; };
const PAL = { accent: CSSV('--accent'), soft: CSSV('--accent-soft'), ink: CSSV('--ink'), bg: CSSV('--bg'), bg2: CSSV('--bg2'), slate: CSSV('--slate') };   // UC-6.1
await Promise.all(['800 88px "Open Sans"', '700 32px "Open Sans"', '600 40px "Open Sans"'].map((f) => document.fonts.load(f)));   // the panels are drawn once, so wait for the face
const jsonCache = new Map();                            // each data file is fetched once (the track preloads them behind the lot)
const fetchJson = (f) => {
  if (!jsonCache.has(f)) jsonCache.set(f, fetch('data/' + f).then((r) => { if (!r.ok) throw new Error('data/' + f + ': ' + r.status); return r.json(); }));
  return jsonCache.get(f);
};
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
  if (!glbCache.has(url)) glbCache.set(url, loader.loadAsync(url, (e) => { prog.set(url, { l: e.loaded, t: e.total || e.loaded }); showProgress(); }).then((g) => { upgradePaint(g.scene); return g; }));
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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;      // the track's
const studioTex = studioEnvironment(renderer, PAL.accent);                  // the showroom's (fx.js)

const [SHOW, TRACK, RULES, CAMS, INPUT, LISTINGS, MODELS] = await Promise.all([fetchJson('showroom.json'), fetchJson('track.json'), fetchJson('timetrial_rules.json'),
  fetchJson('camera.json'), fetchJson('input.json'), fetchJson('listings.json'), fetchJson('models.json')]);
const GHOSTS = await fetchJson('ghosts/index.json');      // UC-9.3: the simulated laps (tools/ghost_index.py)
const SALE_SPECS = await fetchJson('sale_specs.json');    // UC-9.1: each car for sale's factory numbers, READ with sources (tools/sale_specs.py)
// UC-8: the lot's slides, with `listings` expanded into one slide per car for sale (data/listings.json) and per pick the site lacks
const LOT = SLIDES.flatMap((d) => d.kind !== 'listings' ? [d]
  : [...LISTINGS.cars.map((l) => ({ kind: 'listing', listing: l })), ...LISTINGS.absent.map((x) => ({ kind: 'unlisted', unlisted: x }))]);
const pad = makeGamepad(INPUT);                                    // UC-7.5a: the IMC's gamepad bindings (gamepad.js)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;   // UC-7.2b
const START_HASH = decodeURIComponent(location.hash);     // read once: select() rewrites the hash to follow the slide
const KIOSK = START_HASH === '#kiosk';                     // UC-11.5
window.HOC = { BACKEND, SHOW, TRACK, RULES, state: null, paint, saleModels: { want: [], on: [] } };   // for the page check (test/page_check.py) and for review in devtools; saleModels: the Meshy models asked for and those on their pedestals

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
const show = { scene: new THREE.Scene(), slides: [], index: 0, angle: 0, targetAngle: 0, lastCar: 'SportsCar', paint: {}, drag: null, holdSpin: 0 };
// the paint picker's colours (AUTHORED; Factory = the baked colour of Unreal's export, see fx.js)
const PAINTS = [{ name: 'Factory', hex: null }, { name: 'Arctic white', hex: '#e9ecef' }, { name: 'Obsidian', hex: '#15171b' }, { name: 'Graphite', hex: '#545b63' },
  { name: 'Racing blue', hex: '#2766ee' }, { name: 'Crimson', hex: '#b0102c' }, { name: 'Lime', hex: '#8cd23f' }, { name: 'Sunburst', hex: '#f2a516' }];
show.scene.environment = studioTex;
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
const RING = Math.max(15, LOT.length * 9.4 / (2 * Math.PI));   // m (layout, AUTHORED): ~9.4 m of ring per slide, so pedestals never touch
const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 128), new THREE.MeshStandardNodeMaterial({ color: 0x07080a, roughness: 0.55, metalness: 0.0 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; show.scene.add(floor);
const tops = polishedTops(0.301, 0x0a0b0d);                   // every pedestal top shares one reflector (fx.js)
show.scene.add(tops.target);
const ringLight = new THREE.Mesh(new THREE.TorusGeometry(RING, 0.05, 8, 256), glowMaterial(PAL.accent, 8));
ringLight.rotation.x = Math.PI / 2; ringLight.position.y = 0.03; show.scene.add(ringLight);
const showCam = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
const showPost = makePost(renderer, show.scene, showCam, { bloomStrength: 0.6, bloomRadius: 0.4, bloomThreshold: 1.2, vignette: 0.6 });

function panelTexture(def, car) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 576;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1024, 576); grd.addColorStop(0, PAL.bg2); grd.addColorStop(1, PAL.bg);
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 576);
  g.fillStyle = PAL.slate; g.globalAlpha = 0.35; g.fillRect(0, 520, 1024, 56); g.globalAlpha = 1;
  g.strokeStyle = PAL.accent; g.lineWidth = 6; g.strokeRect(6, 6, 1012, 564);
  g.fillStyle = PAL.accent; g.fillRect(48, 70, 12, 132);
  const kicker = car ? (car.drivable ? 'On the lot · drivable' : 'On the lot · showroom only') : def.kicker;
  const title = car ? car.name.replace(/([a-z])([A-Z])/g, '$1 $2') : def.title;
  const icon = car ? (car.drivable ? (car.name === 'OffroadCar' ? 'offroad' : 'coupe') : 'concept') : def.icon;
  drawIcon(g, icon, 868, 62, 108, PAL.accent);
  g.fillStyle = PAL.soft; g.font = '700 32px "Open Sans", sans-serif'; g.fillText(kicker.toUpperCase(), 80, 102);
  let tsize = 84;                                  // the title fits left of the icon (measured: 'Pick your body style' ran into it)
  do { g.font = '800 ' + tsize + 'px "Open Sans", sans-serif'; tsize -= 2; } while (g.measureText(title).width > 770 && tsize > 48);
  g.fillStyle = PAL.ink; g.fillText(title, 76, 188);
  let lines = def.lines;
  if (car) {
    const pick = (l) => car.specs.find((s) => s.label === l);
    lines = (car.drivable ? ['Max torque', 'Peak power', 'Top gear at redline', 'Drive'] : ['Length x width x height', 'Engine, gears, wheels'])
      .map((l) => { const s = pick(l); return s ? l + ': ' + s.value + (s.unit ? ' ' + s.unit : '') : null; }).filter(Boolean);
  }
  g.font = '600 40px "Open Sans", sans-serif'; g.fillStyle = '#d9dddf';
  if (def.picks) def.picks.forEach((p, i) => { drawIcon(g, p.icon, 80, 252 + i * 74, 44, PAL.accent); g.fillText(p.label + '  →  ' + p.car.replace(/([a-z])([A-Z])/g, '$1 $2'), 146, 290 + i * 74); });
  else lines.forEach((l, i) => g.fillText(l, 80, 290 + i * 62));
  g.fillStyle = PAL.soft; g.font = '600 24px "Open Sans", sans-serif'; g.fillText('HOUSE OF CARS · 3D LOT CONCEPT · UNOFFICIAL', 80, 556);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------------------------------------------------------------- the cars for sale (UC-8)
const V = (f) => (f && (f.kind === 'READ' || f.kind === 'DERIVED') ? f.value : null);   // a listing field's value (READ, or DERIVED from READ), or null when ABSENT
const money = (n, cur) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: cur || 'CAD', maximumFractionDigits: 0 }).format(n);
const readDay = new Date(LISTINGS.read_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
const saleTitle = (l) => V(l.display) || [V(l.year), V(l.make), V(l.model)].filter(Boolean).join(' ');
function salePanel(def) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 576;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1024, 576); grd.addColorStop(0, PAL.bg2); grd.addColorStop(1, PAL.bg);
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 576);
  g.strokeStyle = PAL.accent; g.lineWidth = 6; g.strokeRect(6, 6, 1012, 564);
  g.fillStyle = PAL.accent; g.fillRect(48, 70, 12, 132);
  drawIcon(g, 'tag', 868, 62, 108, PAL.accent);
  let kicker, title, lines;
  if (def.kind === 'listing') {
    const l = def.listing;
    kicker = 'For sale · ' + (V(l.store) === V(l.city) ? V(l.city) : V(l.city) + ', ' + V(l.store));
    title = saleTitle(l);
    lines = [V(l.price) !== null ? money(V(l.price), V(l.currency)) + (V(l.km) !== null ? '  ·  ' + V(l.km).toLocaleString('en-CA') + ' km' : '') : 'Price not listed',
             [V(l.trim), V(l.engine)].filter(Boolean).join(' · '), 'As listed on houseofcars.com, ' + readDay];
  } else {
    kicker = 'In the showroom · not listed online'; title = def.unlisted.key === 'audi_s7' ? 'Audi S7' : def.unlisted.key;
    lines = ['No listing on houseofcars.com', 'on ' + readDay + ': no price shown.', ''];
  }
  g.fillStyle = PAL.soft; g.font = '700 32px "Open Sans", sans-serif'; g.fillText(kicker.toUpperCase(), 80, 102);
  let ts = 76; do { g.font = '800 ' + ts + 'px "Open Sans", sans-serif'; ts -= 2; } while (g.measureText(title).width > 770 && ts > 44);
  g.fillStyle = PAL.ink; g.fillText(title, 76, 188);
  g.font = '800 46px "Open Sans", sans-serif'; g.fillStyle = PAL.ink; g.fillText(lines[0], 80, 290);
  g.font = '600 34px "Open Sans", sans-serif'; g.fillStyle = '#d9dddf';
  let el = lines[1]; while (g.measureText(el).width > 860 && el.length > 8) el = el.slice(0, -2);
  g.fillText(el === lines[1] ? el : el + '…', 80, 350); g.fillText(lines[2], 80, 404);
  if (!def.model && def.kind === 'listing') { g.fillStyle = PAL.soft; g.font = '600 28px "Open Sans", sans-serif'; g.fillText('3D model not made yet', 80, 470); }
  g.fillStyle = PAL.soft; g.font = '600 24px "Open Sans", sans-serif'; g.fillText('HOUSE OF CARS · 3D LOT CONCEPT · UNOFFICIAL', 80, 556);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// a car for sale in the race: its Meshy model, nose along the body's X, standing on the car's ground line and centred on its
// wheelbase (data/sim_cars: the wheels are the physics', not drawn separately; the model carries its own)
async function simBody(key, carJson) {
  const m = MODELS.models[key];
  if (!m) throw new Error('no 3D model of ' + key + ' yet: it can be raced as a ghost, not driven');
  const body = await saleModel(m);
  const w = carJson.wheels.map((x) => x.bone_location.value);
  const ground = Math.min(...carJson.wheels.map((x, i) => w[i][2] - x.setup.wheel_radius.value));
  const cx = w.reduce((a, p) => a + p[0], 0) / w.length;
  body.position.set(cx / 100, ground / 100, 0);
  const g = new THREE.Group(); g.add(body);
  return { group: g, wheels: [] };
}
// a Meshy model of a car for sale, on its pedestal: scaled so its length is the car's READ length (data/models.json says where
// the length came from), its lowest point on the pedestal top, its nose along +X like the Unreal cars
async function saleModel(m) {
  const g = (await loadGlb('data/meshes/' + m.glb)).scene.clone(true);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  if (m.yaw_deg) g.rotation.y = m.yaw_deg * Math.PI / 180;
  const b2 = new THREE.Box3().setFromObject(g), c = b2.getCenter(new THREE.Vector3()), size = b2.getSize(new THREE.Vector3());
  if (Math.abs(Math.max(size.x, size.z) - m.length_m.value) > 0.02) throw new Error(m.glb + ' is ' + Math.max(size.x, size.z).toFixed(3) + ' m long, not its READ ' + m.length_m.value + ' m: re-run tools/import_models.py');
  g.position.set(-c.x, -b2.min.y, -c.z);
  const wrap = new THREE.Group(); wrap.add(g); return wrap;
}
const carEntry = (name) => { const e = SHOW.cars.find((c) => c.name === name); if (!e) throw new Error('slides.js names a car showroom.json lacks: ' + name); return e; };
for (let i = 0; i < LOT.length; i++) {
  const def = LOT[i];
  const a = (i / LOT.length) * Math.PI * 2;
  const stand = new THREE.Group();
  stand.position.set(Math.sin(a) * RING, 0, Math.cos(a) * RING);
  stand.rotation.y = a;
  const car = def.kind === 'car' ? carEntry(def.car) : null;
  const onPed = car || def.kind === 'listing' || def.kind === 'unlisted';       // a slide with a pedestal (a car, or a car for sale)
  const saleKey = def.kind === 'listing' ? def.listing.key : def.kind === 'unlisted' ? def.unlisted.key : null;
  if (saleKey) def.model = MODELS.models[saleKey] || null;   // UC-8.3: a model of THAT car, or none; looked up before its panel says which
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(onPed ? 5.0 : 6.2, onPed ? 2.8 : 3.5), new THREE.MeshBasicNodeMaterial({ map: car || !onPed ? panelTexture(def, car) : salePanel(def) }));
  panel.position.set(0, onPed ? 4.0 : 2.6, onPed ? -4.2 : 0);
  stand.add(panel);
  let turn = null;
  if (onPed) {
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.3, 0.3, 64), new THREE.MeshStandardNodeMaterial({ color: 0x14161a, roughness: 0.45, metalness: 0.3 }));
    ped.position.y = 0.15; ped.receiveShadow = true; stand.add(ped);
    const top = new THREE.Mesh(new THREE.CircleGeometry(3.1, 64), tops.material);
    top.rotation.x = -Math.PI / 2; top.position.y = 0.301; top.receiveShadow = true; stand.add(top);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.03, 8, 128), glowMaterial(PAL.accent, 8));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.31; stand.add(rim);
    const spot = new THREE.SpotLight(0xffffff, 140, 18, 0.55, 0.6, 1.6);
    spot.position.set(0, 9, 3); spot.target.position.set(0, 0.6, 0); stand.add(spot, spot.target);
    stand.add(lightBeam(spot.position, spot.target.position, 3.4, 0xfff4e6, 0.09));             // its beam in the air (fx.js)
    turn = new THREE.Group();
    if (car) {
      const { group } = await buildCar(car);
      if (car.drivable) turn.position.y = 0.3 - Math.min(...car.wheels.map((w) => w.bone_location[2] - w.radius)) / 100;   // wheels on the pedestal
      else turn.position.y = 0.3 - (car.bounds_cm.origin[2] - car.bounds_cm.box_extent[2]) / 100;
      turn.add(group);
    } else {
      // UC-8.3a: none, and the panel says so. A model loads behind the lot (about 4-6 MB each, seven of them): the lot opens at
      // once and each car rolls onto its pedestal as it arrives; a model that fails is a page error, never a silent empty pedestal
      if (def.model) {
        turn.position.y = 0.3; const t = turn; HOC.saleModels.want.push(saleKey);
        saleModel(def.model).then((g) => { t.add(g); HOC.saleModels.on.push(saleKey); }, (e) => reportError(e));
      }
    }
    stand.add(turn);
  } else {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.12, 0.9), new THREE.MeshStandardNodeMaterial({ color: 0x14161a, roughness: 0.22, metalness: 0.25 }));
    plinth.position.set(0, 0.06, 0); stand.add(plinth);
  }
  show.scene.add(stand);
  show.slides.push({ def, car, stand, turn, angle: a });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SIMS = new Set(GHOSTS.ghosts.map((g) => g.car));
// ---------------------------------------------------------------- the salesperson's tools (UC-11): leaders, compare, share, QR, kiosk
const LOT_CARS = lotCars(LISTINGS, SALE_SPECS, GHOSTS, { money: (v) => money(v, 'CAD'), time: (v) => Rules.formatTime(v, RULES) });
const carLink = (key) => location.origin + location.pathname + '#car=' + key;
function openCompare(focus) {
  $('cmpbody').innerHTML = compareHTML(LOT_CARS, focus) + priceVsPace(LOT_CARS, focus, PAL.accent);
  $('compare').hidden = false; $('cmpclose').focus();
}
$('cmpclose').addEventListener('click', () => { $('compare').hidden = true; });
$('compare').addEventListener('click', (e) => { if (e.target.id === 'compare') $('compare').hidden = true; });
async function shareCar(key, btn) {
  const url = carLink(key), title = (LOT_CARS.find((c) => c.key === key) || {}).title;
  if (navigator.share) { try { await navigator.share({ title: title + ' · House of Cars 3D lot (concept)', url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  await navigator.clipboard.writeText(url);
  btn.textContent = 'Link copied'; setTimeout(() => { btn.innerHTML = svgIcon('link', 16) + ' Share this car'; }, 2200);
}
async function openAR(key, title) {
  const m = MODELS.models[key]; if (!m) return;
  if (!customElements.get('model-viewer')) await import('model-viewer');
  const t = title || LOT_CARS.find((c) => c.key === key).title;
  $('arbody').innerHTML = '<model-viewer src="data/meshes/' + esc(m.glb) + '" alt="' + esc(t) + ', 3D model" ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed" camera-controls auto-rotate shadow-intensity="1" exposure="1.1" environment-image="neutral"><button slot="ar-button" class="act">See it in your driveway</button></model-viewer>' +
    '<p class="cmpnote">' + esc(t) + ' at its real length (' + esc(String(m.length_m.value)) + ' m, ' + esc(m.length_m.src) + '). On a phone, the button puts it in your driveway; on a computer, drag to turn it.</p>';
  $('ar').hidden = false; $('arclose').focus();
}
$('arclose').addEventListener('click', () => { $('ar').hidden = true; $('arbody').innerHTML = ''; });
async function drawQR(key, el) {                          // a QR code of the car's own link, for a buyer's phone (qrcode-generator, MIT)
  const { default: qrcode } = await import('qrcode-generator');
  const q = qrcode(0, 'M'); q.addData(carLink(key)); q.make();
  el.innerHTML = q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }) + '<span>Scan for this car</span>';
}
let pendingGhost = null;                                  // the ghost a 'Race its ghost' press asked for (localStorage may be off)
function saleCard(s, card) {
  const d = s.def;
  if (d.kind === 'unlisted') {
    card.innerHTML = '<p class="kick">In the showroom · not listed online</p><h2>' + svgIcon('tag', 22) + 'Audi S7</h2>' +
      '<p>houseofcars.com lists no Audi S7 on ' + esc(readDay) + ', so this page shows no price for it: it never types one in.</p>' +
      (d.model ? '<div class="acts"><button class="pick2" id="aropen">' + svgIcon('lot', 16) + ' In your driveway (AR)</button></div>' : '') +
      '<div id="srcline">' + (d.model ? '3D model: ' + esc(d.model.src) + ' Length: ' + esc(d.model.length_m.src) + '<br>' : '3D model not made yet.<br>') +
      d.unlisted.searched.map(esc).join('<br>') + '</div>';
    if ($('aropen')) $('aropen').addEventListener('click', () => openAR(d.unlisted.key, 'Audi S7'));
    return;
  }
  const l = d.listing;
  const row = (label, f, fmt) => '<dt>' + esc(label) + '</dt><dd>' + (V(f) === null ? '<span class="abs" title="' + esc(f.why) + '">not listed</span>' : esc(fmt ? fmt(V(f)) : V(f))) + '</dd>';
  const leads = leadsFor(l.key, LOT_CARS);
  card.innerHTML = '<p class="kick">For sale · ' + esc(V(l.city)) + (V(l.store) !== V(l.city) ? ' · ' + esc(V(l.store)) : '') + ' store</p><h2>' + esc(saleTitle(l)) + '</h2>' +
    (leads.length ? '<div class="leads" title="Best of the ' + LOT_CARS.length + ' cars for sale on this lot, from their published figures and simulated laps">' + leads.map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>' : '') +
    (V(l.trim) ? '<div class="sub">' + esc(V(l.trim)) + '</div>' : '') + '<div class="price">' + (V(l.price) !== null ? esc(money(V(l.price), V(l.currency))) : 'Price not listed') + '<small>as listed on houseofcars.com, ' + esc(readDay) + '</small></div>' +
    '<dl>' + row('Kilometres', l.km, (v) => v.toLocaleString('en-CA') + ' km') + row('Engine', l.engine) + row('Colour', l.colour) + row('Interior', l.interior) +
    row('VIN', l.vin) + row('Stock', l.stock) + '</dl>' +
    specRows(l.key) + simLine(l.key) +
    '<div class="acts">' + (MODELS.models[l.key] && SIMS.has(l.key) ? '<button class="act" data-drive="' + l.key + '">Test drive it</button>' : '') +
    (GHOSTS.ghosts.some((g) => g.car === l.key) ? '<button class="act" data-race="' + l.key + '">Race its ghost</button>' : '') +
    '<a class="act" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + svgIcon('link', 16) + ' See it on houseofcars.com</a></div>' +
    '<div class="sell"><button class="pick2" id="cmpopen">' + svgIcon('numbers', 16) + ' Compare the lot</button><button class="pick2" id="share">' + svgIcon('link', 16) + ' Share this car</button>' +
    (MODELS.models[l.key] ? '<button class="pick2" id="aropen">' + svgIcon('lot', 16) + ' In your driveway (AR)</button>' : '') + '</div>' +
    '<div class="qr" id="qr"></div>' +
    '<div id="srcline">' + (d.model ? '3D model: ' + esc(d.model.src) : '3D model not made yet.') + ' Listing: ' + esc(l.name.src) + '</div>';
  card.querySelectorAll('button.src').forEach((b) => b.addEventListener('click', () => { $('srcline').textContent = SALE_SPECS.cars[l.key].rows[+b.dataset.k].src; }));
  card.querySelectorAll('button[data-race]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem(GHOST_KEY, b.dataset.race + '.json'); } catch (e) { /* the picker still shows it in the race */ }
    pendingGhost = b.dataset.race + '.json'; startRace(carEntry('SportsCar'));
  }));
  card.querySelectorAll('button[data-drive]').forEach((b) => b.addEventListener('click', () => startRace({ name: b.dataset.drive, sim: true, drivable: true })));
  $('cmpopen').addEventListener('click', () => openCompare(l.key));
  if ($('aropen')) $('aropen').addEventListener('click', () => openAR(l.key));
  $('share').addEventListener('click', (e) => shareCar(l.key, e.currentTarget));
  drawQR(l.key, $('qr'));
}
function specRows(key) {
  const sp = SALE_SPECS.cars[key];
  if (!sp || !sp.rows) return '<p class="abs">Factory figures not read yet.</p>';
  return '<p class="kick" style="margin-top:12px">Factory figures</p><dl>' + sp.rows.map((r, k) => '<dt>' + esc(r.label) + '</dt><dd>' + esc(r.value) +
    '<button class="src k-' + r.kind + '" data-k="' + k + '" title="' + r.kind + ': where this came from">' + r.kind + '</button></dd>').join('') + '</dl>';
}
function simLine(key) {
  const g = GHOSTS.ghosts.find((x) => x.car === key);
  if (!g) return '';
  const sports = GHOSTS.ghosts.find((x) => x.car === 'SportsCar');
  return '<div class="simlap"><b>' + esc(Rules.formatTime(g.lap, RULES)) + '</b><span>simulated Time Trial lap: its own weight, power, torque, gears and drag, on the template\'s tyres, the page\'s driver' +
    (sports ? ' (template Sports Car: ' + esc(Rules.formatTime(sports.lap, RULES)) + ')' : '') + '</span></div>';
}
function renderCard() {
  const s = show.slides[show.index], d = s.def, card = $('card');
  if (d.kind === 'listing' || d.kind === 'unlisted') saleCard(s, card);
  else if (s.car) {
    const e = s.car;
    const rows = e.specs.map((sp, k) => '<dt>' + esc(sp.label) + '</dt><dd>' + esc(sp.value) + (sp.unit ? ' ' + esc(sp.unit) : '') +
      '<button class="src k-' + sp.kind + '" data-k="' + k + '" title="' + sp.kind + ': where this came from">' + sp.kind + '</button></dd>').join('');
    const chosen = show.paint[e.name] ?? null;
    const sw = PAINTS.map((c, k) => '<button class="sw' + ((c.hex ?? null) === chosen ? ' on' : '') + '" data-p="' + k + '" title="' + esc(c.name) + '" aria-label="Paint: ' + esc(c.name) +
      '" style="--c:' + (c.hex ?? '#' + paint[e.name].factory.toString(16).padStart(6, '0')) + '"></button>').join('');
    card.innerHTML = '<p class="kick">' + (e.drivable ? 'On the lot · drivable' : 'On the lot · showroom only') + '</p><h2>' + esc(e.name.replace(/([a-z])([A-Z])/g, '$1 $2')) +
      '</h2><div class="sub">' + esc(e.drivable ? e.blueprint : e.mesh) + '</div><div class="paint"><span id="pname">Paint · ' + esc((PAINTS.find((c) => (c.hex ?? null) === chosen) || PAINTS[0]).name) +
      '</span><div>' + sw + '</div></div><dl>' + rows + '</dl><div id="srcline">Press a badge to see where the number came from. Drag the car to turn it.</div>' +
      '<button class="photo" id="photo" title="Save what the 3D view shows as a PNG (P)">' + svgIcon('camera', 16) + ' Save a picture</button>';
    $('photo').addEventListener('click', () => savePicture(e.name));
    card.querySelectorAll('button.src').forEach((b) => b.addEventListener('click', () => { $('srcline').textContent = e.specs[+b.dataset.k].src; }));
    card.querySelectorAll('button.sw').forEach((b) => b.addEventListener('click', () => {
      const c = PAINTS[+b.dataset.p]; show.paint[e.name] = c.hex; setPaint(e.name, c.hex);
      card.querySelectorAll('button.sw').forEach((x) => x.classList.toggle('on', x === b)); $('pname').textContent = 'Paint · ' + c.name;
    }));
  } else {
    if (d.kind === 'sale') d.picks = LISTINGS.cars.map((l) => ({ label: V(l.make), icon: 'tag', sale: l.key, sub: V(l.price) !== null ? money(V(l.price), V(l.currency)) : '' }));
    const picks = (d.picks || []).map((p) => p.sale ? '<button class="pick" data-sale="' + p.sale + '">' + svgIcon(p.icon, 26) + '<b>' + esc(p.label) + '</b><small>' + esc(p.sub) + '</small></button>' : '<button class="pick" data-car="' + p.car + '">' + svgIcon(p.icon, 30) + '<b>' + esc(p.label) + '</b><small>' + esc(p.car.replace(/([a-z])([A-Z])/g, '$1 $2')) + '</small></button>').join('');
    const pts = (d.points || []).map((q) => '<li>' + svgIcon(q.icon, 22) + '<div><b>' + esc(q.title) + '</b><span>' + esc(q.text) + '</span></div></li>').join('');
    let acts = (d.actions || []).map((a, k) => a.href ? '<a class="act" href="' + esc(a.href) + '">' + esc(a.label) + '</a>' : '<button class="act" data-a="' + k + '">' + esc(a.label) + '</button>').join('');
    if (d.drives) acts += SHOW.cars.filter((c) => c.drivable).map((c) => '<button class="act" data-car="' + c.name + '">Drive the ' + esc(c.name.replace(/([a-z])([A-Z])/g, '$1 $2')) + '</button>').join('');
    card.innerHTML = '<p class="kick">' + esc(d.kicker) + '</p><h2>' + svgIcon(d.icon, 22) + esc(d.title) + '</h2>' + (d.body || []).map((p) => '<p>' + esc(p) + '</p>').join('') +
      (pts ? '<ul class="pts">' + pts + '</ul>' : '') +
      (picks ? '<div class="picks">' + picks + '</div>' : '') + (acts ? '<div class="acts">' + acts + '</div>' : '');
    if (d.kind === 'sale') { card.insertAdjacentHTML('beforeend', '<div class="sell"><button class="pick2" id="cmpopen">' + svgIcon('numbers', 16) + ' Compare the lot</button></div>'); $('cmpopen').addEventListener('click', () => openCompare(null)); }
    card.querySelectorAll('button.pick').forEach((b) => b.addEventListener('click', () => select(show.slides.findIndex((x) =>
      b.dataset.sale ? x.def.kind === 'listing' && x.def.listing.key === b.dataset.sale : x.car && x.car.name === b.dataset.car))));
    card.querySelectorAll('button.act').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.car) { startRace(carEntry(b.dataset.car)); return; }
      const a = d.actions[+b.dataset.a];
      if (a.go) select(show.index + a.go);
      if (a.drive) startRace(carEntry(show.lastCar));
    }));
  }
  const sale = d.kind === 'listing' || d.kind === 'unlisted';
  const saleDrive = d.kind === 'listing' && MODELS.models[d.listing.key] && SIMS.has(d.listing.key);
  const drivable = sale ? !!saleDrive : s.car ? s.car.drivable : s.def.kind === 'drive';
  $('drive').disabled = !drivable;
  $('drive').textContent = sale && !saleDrive ? 'FOR SALE' : s.car && !s.car.drivable ? 'SHOWROOM ONLY' : 'TEST DRIVE';
  $('drive').title = drivable ? 'Race the Time Trial lap in ' + (s.car ? s.car.name : show.lastCar) : 'This car is a static mesh in Unreal: nothing to drive';
  $('pos').textContent = (show.index + 1) + ' / ' + show.slides.length;
  card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
}
function select(i) {
  show.index = (i + show.slides.length) % show.slides.length;
  const s = show.slides[show.index];
  const h = s.def.kind === 'listing' ? '#car=' + s.def.listing.key : s.def.kind === 'unlisted' ? '#car=' + s.def.unlisted.key : KIOSK ? '#kiosk' : '';
  if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
  if (s.car && s.car.drivable) show.lastCar = s.car.name;
  let d = s.angle - show.targetAngle;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  show.targetAngle += d;
  renderCard();
}
$('prev').onclick = () => select(show.index - 1);
$('next').onclick = () => select(show.index + 1);
$('drive').onclick = () => {
  const s = show.slides[show.index];
  if (s.def.kind === 'listing') { startRace({ name: s.def.listing.key, sim: true, drivable: true }); return; }
  startRace(s.car ? s.car : carEntry(show.lastCar));
};
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
canvas.addEventListener('click', (ev) => {
  if (suppressClick) { suppressClick = false; return; }
  if (mode !== 'show') return;
  ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, showCam);
  const hit = ray.intersectObjects(show.slides.map((c) => c.stand), true)[0];
  if (hit) { const i = show.slides.findIndex((c) => { let o = hit.object; while (o) { if (o === c.stand) return true; o = o.parent; } return false; }); if (i >= 0 && i !== show.index) select(i); }
});
let dragX = null;
canvas.addEventListener('pointerdown', (e) => {
  dragX = e.clientX; show.drag = null;
  const s = show.slides[show.index];
  if (mode !== 'show' || !s.turn) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, showCam);
  if (ray.intersectObject(s.turn, true).length) { show.drag = { x: e.clientX, rot: s.turn.rotation.y, moved: false }; canvas.setPointerCapture(e.pointerId); }
});
canvas.addEventListener('pointermove', (e) => {
  if (!show.drag) return;
  const dx = e.clientX - show.drag.x;
  if (Math.abs(dx) > 4) show.drag.moved = true;
  show.slides[show.index].turn.rotation.y = show.drag.rot + dx * 0.012; show.holdSpin = 4;
});
canvas.addEventListener('pointerup', (e) => {
  if (show.drag) { if (show.drag.moved) suppressClick = true; show.drag = null; dragX = null; return; }
  if (mode === 'show' && dragX !== null && Math.abs(e.clientX - dragX) > 60) { select(show.index + (e.clientX < dragX ? 1 : -1)); suppressClick = true; }
  dragX = null;
});
let suppressClick = false;
window.HOC.show = show;
window.HOC.autopilot = () => { race.auto = AI.makeDriver(trackView.line, race.v); };   // the page check drives a lap with the sim's driver
// the page check drives a lap's RULES without driving skill: it puts the car in each gate in turn (the rules decide the rest)
window.HOC.teleport = (i) => { const p = trackView.gateGroundUe[i]; Chaos.resetVehicle(race.v, [p[0], p[1], p[2] + 60], TRACK.gates[i].yaw_deg + 90); };
window.HOC.carScreen = () => {                           // the current car's centre on screen, CSS px (page check: drag-turn)
  const t = show.slides[show.index].turn; if (!t) return null;
  const p = new THREE.Vector3(0, 0.6, 0); t.localToWorld(p); p.project(showCam);
  return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight];
};

const padMenu = { prev: {} };
function padShow() {                                    // edges only: one press, one slide
  const p = readPadRaw(); if (!p) return;
  const on = { left: p.buttons[14]?.pressed || p.axes[0] < -0.5, right: p.buttons[15]?.pressed || p.axes[0] > 0.5, a: p.buttons[0]?.pressed };
  if (on.left && !padMenu.prev.left) select(show.index - 1);
  if (on.right && !padMenu.prev.right) select(show.index + 1);
  if (on.a && !padMenu.prev.a && !$('drive').disabled) $('drive').click();
  padMenu.prev = on;
}
let intro = REDUCED ? 1 : 0;
const ease = (t) => 1 - Math.pow(1 - t, 3);
function tickShow(dt) {
  show.angle += (show.targetAngle - show.angle) * Math.min(1, dt * 2.6);
  intro = Math.min(1, intro + dt / 3.2);
  const aspect = innerWidth / innerHeight;
  const a = show.angle, R = RING + 10.5 * (aspect < 1 ? Math.min(2.2, 0.85 / aspect) : 1);   // portrait: back off so the slide fits the width
  const side = innerWidth > 900 ? 1.6 : 0;      // desktop: look a little left of the slide so the card on the right does not cover it
  const bob = REDUCED ? 0 : Math.sin(performance.now() / 2400) * 0.12;
  const e = ease(intro), sweep = (1 - e) * 1.4;              // the intro: down from above the lot, swinging in
  const ea = a - sweep, Rr = R + (1 - e) * 26;
  const lift = aspect < 1 ? 1.4 : 0, aim = aspect < 1 ? 0.2 : 1.6;   // portrait: aim low so the car sits above the card (measured: the card hid it)
  showCam.position.set(Math.sin(ea) * Rr + Math.cos(ea) * side, 2.5 + lift + bob + (1 - e) * 24, Math.cos(ea) * Rr - Math.sin(ea) * side);
  showCam.lookAt(Math.sin(a) * RING * e + Math.cos(a) * side, aim - (1 - e) * aim, Math.cos(a) * RING * e - Math.sin(a) * side);
  show.holdSpin = Math.max(0, show.holdSpin - dt);             // a drag holds the turntable for a few seconds
  show.slides.forEach((c, i) => { if (c.turn && i === show.index && !show.drag && show.holdSpin === 0) c.turn.rotation.y += dt * 0.35; });
  showPost.render();
}

// ---------------------------------------------------------------- the Time Trial (UC-2.1..2.5)
let race = null;
async function buildTrack() {
  const scene = new THREE.Scene();
  // the sun: Unreal's DirectionalLight shines along its rotator's X axis (READ: track actors)
  const L = (await fetchJson('track_lights.json')).directional;
  const dir = toThreePoint(rotatorAxes(L.rotation)[0].map((v) => v * 100));
  const sky = physicalSky(renderer, dir);                                  // fx.js; see AUTHORED: sky
  sky.mesh.name = 'page-sky'; sky.mesh.frustumCulled = false; sky.mesh.renderOrder = -1;
  scene.add(sky.mesh);
  scene.environment = sky.env; scene.environmentIntensity = 0.8;
  scene.fog = new THREE.Fog(0xb9cbdc, 160, 2200);                           // haze (AUTHORED): distance reads as distance
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a4036, 0.7));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 400 });
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
  // the landscape's holes (the tunnel mouths, READ from Unreal's game collision: ground_holes.js) are not drawn either
  const holes = await loadHoles(fetchBin, fetchJson, G);
  const idxAll = new Uint32Array((G.nx - 1) * (G.ny - 1) * 6);
  let q = 0;
  for (let j = 0; j < G.ny - 1; j++) for (let i = 0; i < G.nx - 1; i++) {
    if (holes.isHole(G.origin_cm[0] + (i + 0.5) * G.step_cm, G.origin_cm[1] + (j + 0.5) * G.step_cm)) continue;
    const a = j * G.nx + i, b = a + 1, c = a + G.nx, d = c + 1;
    idxAll.set([a, c, b, b, c, d], q); q += 6;
  }
  const idx = idxAll.subarray(0, q);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const ground = new THREE.Mesh(geo, groundDetail(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: M.roughness, metalness: 0, side: THREE.DoubleSide })));
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
      new THREE.MeshBasicNodeMaterial({ color: g.finish ? 0xffffff : new THREE.Color(PAL.accent), transparent: true, opacity: 0.18, depthWrite: false }));
    box.matrixAutoUpdate = false;
    box.matrix.fromArray(threeMatrix({ pitch: g.pitch_deg, yaw: g.yaw_deg, roll: g.roll_deg }, [1, 1, 1], g.center_cm));
    gates.add(box);
  }
  scene.add(gates);
  // the next gate's marker (AUTHORED): a glowing chevron and a light beam over the rules' current target
  const marker = new THREE.Group();
  const chev = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 4), glowMaterial(PAL.accent, 5));
  chev.rotation.x = Math.PI; chev.position.y = 7; marker.add(chev);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 40, 8, 1, true),
    new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(PAL.accent), transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
  beam.position.y = 20; marker.add(beam);
  scene.add(marker);
  const skids = makeSkids(scene);
  return { scene, sun, sunDir: dir, gates, sky: sky.mesh, marker, chev, skids, gateGround: [] };
}

let trackView = null, world = null, Chaos = null;
// the save-picture button (AUTHORED): the 3D view as a PNG, read off the canvas right after the frame that drew it
let photoReq = null;
function savePicture(carName) { photoReq = 'house-of-cars-concept-' + carName.toLowerCase() + '.png'; }
function takePicture() {
  const name = photoReq; photoReq = null;
  canvas.toBlob((b) => {
    if (!b) throw new Error('the canvas gave no picture');
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}
let trackReady = null;
function prepareTrack() {                               // once: the physics module, the track, the world, the minimap, the gate points
  if (!trackReady) trackReady = (async () => {
    Chaos = await import('./chaos_vehicle.js');
    const tv = await buildTrack(); trackView = tv;
    world = withHoles(await loadWorld(fetchBin, TRACK), await loadHoles(fetchBin, fetchJson, TRACK.ground.grid));   // the tunnel mouths are holes (UC-2.2)
    trackView.minimap = buildMinimap($('minimap'), world, TRACK.gates);
    trackView.gateGroundUe = TRACK.gates.map((g) => {          // where each gate's marker stands: the ground under its centre (UE cm)
      const c = g.center_cm, hit = world.trace([c[0], c[1], c[2] + g.half_extent_cm[2]], [c[0], c[1], c[2] - g.half_extent_cm[2]]);
      if (!hit) throw new Error('no ground under gate ' + g.label);
      return hit.point;
    });
    trackView.gateGround = trackView.gateGroundUe.map(toThreePoint);
    trackView.line = AI.buildRacingLine(await fetchJson('road_spline.json'), TRACK);   // the road's own spline (READ), as the sim drives it
    await Promise.all(['cars.json', 'physics.json', 'chaos_unexported.json'].map(fetchJson));
    window.HOC.trackPreloaded = true;
  })();
  return trackReady;
}
async function startRace(entry) {
  $('loading').style.display = 'grid'; $('lt').textContent = 'Rolling the car out to the track…';
  await prepareTrack();
  clearSkids(trackView.skids);
  window.HOC.track = trackView;
  if (race && race.car) { trackView.scene.remove(race.car.group); if (race.ghostCar) trackView.scene.remove(race.ghostCar); }
  mode = 'show';                                          // (a ghost pick in flight must not draw a half-built race)
  const carJson = entry.sim ? await fetchJson('sim_cars/' + entry.name + '.json') : (await fetchJson('cars.json')).cars[entry.name];
  const car = entry.sim ? await simBody(entry.name, carJson) : await buildCar(entry);
  trackView.scene.add(car.group);
  car.group.matrixAutoUpdate = false;
  const gravity = (await fetchJson('physics.json')).gravity_z.value;
  const unexported = entry.sim ? await fetchJson('sim_cars/' + entry.name + '.unexported.json') : (await fetchJson('chaos_unexported.json')).cars[entry.name];   // tools/ue_unexported.mjs: the .uasset chain
  const v = Chaos.makeVehicle(carJson, { gravityZ: gravity, unexported, angularDampingOnGround: RULES.angular_damping.on_ground, angularDampingInAir: RULES.angular_damping.in_air });
  const start = TRACK.player_start;
  Chaos.resetVehicle(v, start.location_cm, start.yaw_deg);
  const camKey = entry.sim ? 'SportsCar' : entry.name;    // a car for sale rides the template SportsCar's cameras (STAND-IN: AUTHORED list)
  const arm = CAMS.cars[camKey].BackSpringArm, cam = CAMS.cars[camKey].BackCamera;
  race = { entry, car, v, rules: Rules.makeRace(TRACK.gates, RULES), now: 0, rig: makeRig(arm), fov: cam.field_of_view,
           inside: TRACK.gates.map(() => false), carBox: carJson.bounds_cm.value, front: false,
           wheelWidths: carJson.wheels.map((w) => w.setup.wheel_width.value), throttle: 0, camKey };
  const tachEl = $('hud-speed'); tachEl.querySelector('svg.tach')?.remove();
  race.tach = buildTach(tachEl, carJson.engine.max_rpm.value, carJson.transmission.change_up_rpm.value);   // READ scale and red band
  // the ghost (ghost.js, UC-9.3): the device's best lap in this car, or a car's simulated lap (data/ghosts, tools/sim_ghost.mjs)
  race.rec = makeRecorder();
  fillGhostPicker();
  await applyGhostPick();
  const rec = readRecord(entry.name);
  $('t-rec').textContent = rec === null ? '—' : Rules.formatTime(rec, RULES);
  $('lapb').classList.remove('show');
  audio.start();
  window.HOC.state = race;
  race.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
  race.post = makePost(renderer, trackView.scene, race.camera, { bloomStrength: 0.25, bloomRadius: 0.3, bloomThreshold: 1.2, vignette: 0.45 });
  mode = 'race';
  $('showroom').style.display = 'none'; $('race').style.display = 'block'; $('loading').style.display = 'none';
  $('t-best').textContent = '—';
}
function backToShowroom() {
  mode = 'show';
  silence(audio);
  $('showroom').style.display = ''; $('race').style.display = 'none';
}

// keys, as IMC_Vehicle_Default maps them (data: ue_out/bp/IMC_Vehicle_Default.t3d), plus Esc and G for the page
const keys = new Set();
const touch = { throttle: false, brake: false, left: false, right: false };
const audio = makeAudio();
function syncMute() { $('mute').textContent = !audio.available() ? 'No sound' : audio.muted ? 'Sound off' : 'Sound on'; $('mute').setAttribute('aria-pressed', String(!audio.muted)); }
$('mute').addEventListener('click', () => { audio.start(); audio.setMuted(!audio.muted); syncMute(); });
syncMute();
addEventListener('pointerdown', () => audio.start(), { once: true });
addEventListener('keydown', (e) => {
  audio.start();
  if (e.key === 'm' || e.key === 'M') { audio.setMuted(!audio.muted); syncMute(); return; }
  if (mode === 'show') {
    if (e.key === 'ArrowLeft') select(show.index - 1);
    if (e.key === 'ArrowRight') select(show.index + 1);
    if (e.key === 'Enter' && !$('drive').disabled) $('drive').click();
    return;
  }
  if (e.key === 'Escape') { backToShowroom(); return; }
  if (e.key === 'p' || e.key === 'P') { savePicture(race.entry.name + '-drive'); return; }
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
  const k = {
    throttle: on('KeyW', 'ArrowUp') || touch.throttle ? 1 : 0,
    brake: on('KeyS', 'ArrowDown') || touch.brake ? 1 : 0,
    steering: (on('KeyD', 'ArrowRight') || touch.right ? 1 : 0) - (on('KeyA', 'ArrowLeft') || touch.left ? 1 : 0),
    handbrake: on('Space') ? 1 : 0,
  };
  const g = readGamepad(pad);                            // the IMC maps both to the same actions: the larger input wins
  $('padpill').textContent = pad.id ? 'Gamepad' : pad.nonstandard ? 'Gamepad: unknown layout' : '';
  $('padpill').style.display = pad.id || pad.nonstandard ? '' : 'none';
  if (!g) return k;
  if (g.pressed.has('IA_Reset')) doReset();
  if (g.pressed.has('IA_ToggleCamera')) race.front = !race.front;
  const big = (a, b) => (Math.abs(a) >= Math.abs(b) ? a : b);
  return { throttle: Math.max(k.throttle, g.throttle), brake: Math.max(k.brake, g.brake), steering: big(k.steering, g.steering), handbrake: Math.max(k.handbrake, g.handbrake) };
}
function doReset() {                                   // IA_Reset / Manual_Reset (rules.resetPose): here, +offset, yaw only, stopped
  const [X] = carAxes(race.v);
  const p = Rules.resetPose(race.v.pos, Math.atan2(X[1], X[0]) * 180 / Math.PI, RULES);
  Chaos.resetVehicle(race.v, p.pos, p.yawDeg);
}

const STEP = 1 / 120;
let acc = 0;
function tickRace(dt) {
  const r = race;
  Rules.tickCountdown(r.rules, dt, r.now);
  const raw = readInput();
  const input = Rules.inputEnabled(r.rules) ? raw : { throttle: 0, brake: 0, steering: 0, handbrake: 0 };
  r.lastInput = input;                                   // for the page check (gamepad dead zone)
  acc += Math.min(dt, 0.1);
  while (acc >= STEP) {
    Chaos.stepVehicle(r.v, r.auto && Rules.inputEnabled(r.rules) ? AI.drive(r.auto, r.v, STEP) : input, STEP, world);   // the page check's autopilot: one decision a step, as the sim
    r.now += STEP; acc -= STEP;
    TRACK.gates.forEach((g, i) => {
      const inNow = overlapsGate(r.v, r.carBox, g);
      if (inNow && !r.inside[i]) {                                               // ReceiveActorBeginOverlap
        const laps = r.rules.laps, offset = r.rules.timeOffset, best = r.rules.bestTime;
        if (Rules.gateOverlapBegin(r.rules, i, r.now)) {
          if (r.rules.laps > laps) lapDone(r, r.rules.timeOffset - offset, best); else blip(audio, 'gate');
        }
      }
      r.inside[i] = inNow;
    });
  }
  const [X, Y, Z] = carAxes(r.v);
  if (Rules.tickFlipCheck(r.rules, dt, Z[2])) doReset();
  // the ghost: record this lap, replay the best one at the same lap time
  if (r.rules.startTimer) {
    const tLap = r.now - r.rules.timeOffset;
    record(r.rec, tLap, r.v.pos, [X, Y, Z]);
    const gp = r.ghost && r.ghostCar && ghostPose(r.ghost, tLap);
    if (r.ghostCar) r.ghostCar.visible = !!gp;
    if (gp) r.ghostCar.matrix.fromArray(threeMatrixFromAxes(gp.axes, [1, 1, 1], gp.pos));
  }
  // draw the car
  r.car.group.matrix.fromArray(threeMatrixFromAxes([X, Y, Z], [1, 1, 1], r.v.pos));
  r.car.wheels.forEach((w, i) => { if (w) { const s = r.v.wheels[i]; poseWheel(w, s.steerDeg, s.spinRad, s.suspensionOffsetCm); } });
  // the camera: BackSpringArm (or FrontSpringArm on Tab)
  const cam = r.camera;
  if (r.front) {
    const fa = CAMS.cars[r.camKey].FrontSpringArm.relative_location;
    const e = [0, 1, 2].map((k) => r.v.pos[k] + X[k] * fa[0] + Y[k] * fa[1] + Z[k] * fa[2]);
    const l = [0, 1, 2].map((k) => e[k] + X[k] * 1000);
    cam.position.fromArray(toThreePoint(e)); cam.up.fromArray([Z[0], Z[2], Z[1]]); cam.lookAt(...toThreePoint(l));
    cam.fov = verticalFovDeg(CAMS.cars[r.camKey].FrontCamera.field_of_view, cam.aspect);
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
  // HUD: UI_Vehicle (speed, gear), UI_Timetrial (time, best), UI_Start (countdown); the drawing is hud.js
  $('speed').textContent = Rules.speedText(r.v.forwardSpeedCmS, RULES);
  $('unit').textContent = RULES.speed.unit;
  $('gear').textContent = Rules.gearText(r.v.gear, RULES);
  $('t-now').textContent = Rules.timeText(r.rules, r.now);
  if (r.rules.bestText) $('t-best').textContent = r.rules.bestText;
  const cd = r.rules.countdown.removed ? '' : r.rules.countdown.text;
  if (popCountdown($('countdown'), cd) && cd) blip(audio, cd === 'GO' ? 'go' : 'count');
  updateTach(r.tach, r.v.engineRPM);
  // the next gate's marker and the minimap
  const tg = trackView.gateGround[r.rules.target], tnow = performance.now() / 1000;
  trackView.marker.position.set(tg[0], tg[1] + Math.sin(tnow * 2.2) * 0.4, tg[2]);
  trackView.chev.rotation.y = tnow * 1.6;
  drawMinimap(trackView.minimap, r.v.pos, Math.atan2(X[1], X[0]) * 180 / Math.PI, r.rules.target, PAL.accent);
  // the tyres and the sound
  laySkids(trackView.skids, r.v, Y, r.wheelWidths, dt);
  r.throttle += (input.throttle - r.throttle) * Math.min(1, dt * 8);
  const slide = r.v.wheels.reduce((a, w) => a + slideAmount(w), 0) / r.v.wheels.length;
  driveSound(audio, { rpm: r.v.engineRPM, throttle: r.throttle, speedCmS: r.v.forwardSpeedCmS, slide, gear: r.v.gear, running: true });
  r.post.render();
}

// ---------------------------------------------------------------- the ghost picker (UC-9.3)
const GHOST_KEY = 'hoc.ghostpick';
function fillGhostPicker() {
  const sel = $('ghostpick'), keep = (() => { try { return localStorage.getItem(GHOST_KEY); } catch (e) { return null; } })() || 'mine';
  sel.innerHTML = '<option value="mine">Ghost: your best lap</option>' + GHOSTS.ghosts.map((g) =>
    '<option value="' + esc(g.file) + '">Ghost: ' + esc(g.label) + ' (sim, ' + esc(Rules.formatTime(g.lap, RULES)) + ')</option>').join('') + '<option value="none">No ghost</option>';
  const want = pendingGhost || keep; pendingGhost = null;
  sel.value = [...sel.options].some((o) => o.value === want) ? want : 'mine';
}
async function ghostBody(name) {                         // the ghost looks like ITS car when the page has that car's model
  const e = SHOW.cars.find((c) => c.name === name);
  if (e) return (await buildCar(e)).group;
  const l = LISTINGS.cars.find((c) => c.key === name), m = MODELS.models[name];
  if (l && m) return saleModel(m);
  return race.car.group.clone(true);                    // no model of that car on the page: the driven car's shape, and the label says whose lap it is
}
async function applyGhostPick() {
  const r = race, pick = $('ghostpick').value;
  try { localStorage.setItem(GHOST_KEY, pick); } catch (e) { /* a per-viewer convenience */ }
  r.ghostPick = pick;
  if (r.ghostCar) trackView.scene.remove(r.ghostCar);
  r.ghostCar = null; r.ghost = null; r.ghostLabel = '';
  if (pick === 'none') { showGhostLine(r); return; }
  let body;
  if (pick === 'mine') { r.ghost = loadGhost(r.entry.name); r.ghostLabel = 'your best'; body = r.car.group.clone(true); }
  else {
    const g = GHOSTS.ghosts.find((x) => x.file === pick);
    r.ghost = await fetchJson('ghosts/' + g.file); r.ghostLabel = g.label; body = await ghostBody(g.car);
  }
  const mat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(PAL.soft), transparent: true, opacity: 0.26, depthWrite: false });
  body.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; } });
  const holder = new THREE.Group(); holder.add(body);
  holder.matrixAutoUpdate = false; holder.visible = false; trackView.scene.add(holder);
  r.ghostCar = holder;
  showGhostLine(r);
}
function showGhostLine(r) { $('t-ghost').textContent = r.ghost ? ' · Ghost ' + Rules.formatTime(r.ghost.lap, RULES) + (r.ghostPick !== 'mine' ? ' (' + r.ghostLabel + ')' : '') : ''; }
$('ghostpick').addEventListener('change', () => { applyGhostPick(); $('ghostpick').blur(); });

// a lap is done (Increment_Lap_Count ran): the banner, the chime, and the device record (hud.js)
function lapDone(r, lapS, bestBefore) {
  const isBest = lapS < bestBefore;
  const rec = readRecord(r.entry.name), isRecord = rec === null || lapS < rec;
  if (isRecord && writeRecord(r.entry.name, lapS)) $('t-rec').textContent = Rules.formatTime(lapS, RULES);
  if (isRecord) { const g = saveGhost(r.entry.name, r.rec, lapS); if (r.ghostPick === 'mine') { r.ghost = g; showGhostLine(r); } }
  r.rec = makeRecorder();                                // the next lap starts on the clock the rules just restarted
  const vs = r.ghost && r.ghostPick !== 'mine' ? (lapS <= r.ghost.lap ? 'You beat the ' : 'The ') + r.ghostLabel + (lapS <= r.ghost.lap ? ' by ' : ' was faster by ') + Math.abs(lapS - r.ghost.lap).toFixed(3) + ' s' : null;
  lapBanner($('lapb'), Rules.formatTime(lapS, RULES), bestBefore !== RULES.best_time_default.value ? lapS - bestBefore : null, isBest, [isRecord ? 'Record on this device' : null, vs].filter(Boolean).join(' · ') || null);
  blip(audio, isBest ? 'best' : 'lap');
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
// UC-11.1: a link to one car opens the lot on it; a car no longer listed opens 'For sale now' and says so (UC-11.1a). Also when
// the page is already open and only the link's #car= changes (a second QR scan in the same tab): select() itself rewrites the
// hash with replaceState, which fires no hashchange, so this follows only links from outside
function openCarLink(hash) {
  const m = /^#car=([\w-]+)$/.exec(hash);
  if (!m) return;
  const k = show.slides.findIndex((x) => (x.def.kind === 'listing' && x.def.listing.key === m[1]) || (x.def.kind === 'unlisted' && x.def.unlisted.key === m[1]));
  if (k >= 0) select(k);
  else { select(show.slides.findIndex((x) => x.def.kind === 'sale')); $('card').insertAdjacentHTML('afterbegin', '<p class="gone">That car is no longer on this lot\'s list (read ' + esc(readDay) + ').</p>'); }
}
openCarLink(START_HASH);
window.addEventListener('hashchange', () => { if (mode === 'show') openCarLink(decodeURIComponent(location.hash)); });
// UC-11.5 kiosk (#kiosk): an unattended tour of the cars for sale, one every 9 s; a touch or key pauses it for 45 s
if (KIOSK) {
  const sale = show.slides.map((x, k) => (x.def.kind === 'listing' ? k : -1)).filter((k) => k >= 0);
  let hold = 0, at = 0;
  const poke = () => { hold = performance.now() + 45000; };
  addEventListener('pointerdown', poke); addEventListener('keydown', poke);
  select(sale[0]);
  setInterval(() => { if (mode === 'show' && performance.now() > hold) { at = (at + 1) % sale.length; select(sale[at]); } }, 9000);
  document.body.classList.add('kiosk');
}
setTimeout(() => prepareTrack().catch((e) => { console.error(e); }), 1500);   // behind the lot; startRace awaits the same promise and shows any error
$('loading').style.display = 'none';
// UC-7.2a: the page lowers its own resolution when frames run slow, raises it again when they are quick, and says which it chose
const DPR = [0.75, 0.85, 1, 1.25, 1.5, 2].filter((x) => x <= Math.min(devicePixelRatio, 2) + 1e-6);
let dprI = DPR.length - 1;
const ft = { sum: 0, n: 0, t: 0, good: 0 };
function setQuality() { renderer.setPixelRatio(DPR[dprI]); resize(); $('quality').textContent = 'Resolution ' + DPR[dprI] + 'x'; }
function adapt(dt) {
  ft.sum += dt; ft.n++; ft.t += dt;
  if (ft.t < 2) return;
  const avg = ft.sum / ft.n; ft.sum = 0; ft.n = 0; ft.t = 0;
  if (avg > 1 / 45 && dprI > 0) { dprI--; ft.good = 0; setQuality(); }
  else if (avg < 1 / 57) { if (++ft.good >= 3 && dprI < DPR.length - 1) { dprI++; ft.good = 0; setQuality(); } }
  else ft.good = 0;
}
setQuality();
renderer.setAnimationLoop(() => {
  const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (mode === 'show') { padShow(); tickShow(dt); } else tickRace(dt);
  if (photoReq) takePicture();
  adapt(dt);
});
