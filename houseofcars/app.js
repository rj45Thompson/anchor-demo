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
import { studioEnvironment, upgradePaint, polishedTops, glowMaterial, makePost, physicalSky, setPaint, paint, groundDetail, lightBeam, asphaltRoad, concreteWall, contactShadow } from './fx.js';
import { makeAudio, driveSound, silence, blip, loadSfx, sfx, grind } from './audio.js';
import { Radio } from './radio.js';                                                       // UC-27: the car radio
import { makeWalker, stepWalker, facing, EYE_M } from './walk.js';                        // UC-28: walking the lot
import { buildDressing } from './dress.js';                                                // UC-33: kerbs, lines, posts, gantries
import { makeSpeedFx, stepSpeedFx } from './speedfx.js';                                   // UC-33: the view widens with speed, a shake when fast
import { buildTach, updateTach, popCountdown, lapBanner, readRecord, writeRecord, buildMinimap, drawMinimap } from './hud.js';
import { makeSkids, clearSkids, laySkids, slideAmount } from './effects.js';
import { makeGamepad, readGamepad, readPadRaw } from './gamepad.js';
import { makeRecorder, record, saveGhost, loadGhost, ghostPose } from './ghost.js';
import { overlapsGate, carAxes } from './gates.js';   // one gate test for the page and the sim (tools/sim_ghost.mjs)
import { loadHoles, withHoles } from './ground_holes.js';
import * as AI from './ai_driver.js';
import { lotCars, leadsFor, compareHTML, priceVsPace } from './sale.js';
import { loadingShow, loadingDone } from './loading.js';
import * as Drag from './drag.js';                                                          // UC-22: the drag strip's rules
import { STRIP, makeDirector, stepDirector, framing, shotId, verticalFor } from './drag_cam.js';   // UC-35: the filmed run
import * as Sim from './drag_sim.js';                                                       // UC-34: the clutch pedal, the H gate
import { clusterSVG, bindCluster, powerReserve } from './gauges.js';                          // UC-36: each car's own cluster
import { buildScenery } from './scenery.js';                                                  // UC-37.4: grass, trees and hills past the walls
import { knowHTML, knownSpecsHTML } from './know.js';                                                   // UC-14: Know this car (know.js)                  // the page's own driver (UC-9.2): the sim's ghosts, and the page check's lap
import { dragyHUD } from './dragstats.js';                                                  // UC-21: Dragy owners' runs (dragstats.js)
import { ScoreBoard, HOUSE_NAME, checkName, ranked, qualifies, boardHTML, lastName, keepName } from './scores.js';   // UC-25: the shared boards
import { mark, timed } from './perf.js';                                                   // UC-30: ?perf logs where the time goes
mark('app.js running');
const perfFirst = [];                                   // UC-30: the models just added, marked again once a frame has drawn them (declared first: a model can arrive while the page is still setting up)

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
  'cars for sale: their physics are tools/sim_car.py (READ factory numbers on the template SportsCar, every stand-in named in data/sim_cars); their bodies are 3D models, made in Meshy or hand-made by Sketchfab artists (each credited on its card, data/models.json) and painted the car\'s own colour; they ride the SportsCar\'s cameras',
  'loading screen (loading.js): the photo is the listing\'s own (shown from the dealer\'s image server); the rock shooter and its numbers are the page\'s own',
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
// UC-20 against each model's own size (data/glb_bytes.json, tools/glb_sizes.py): GitHub Pages sends models gzipped, and a progress
// event counts the unpacked bytes loaded against the packed length, so the bar passed 100 % (READ 11-07: the i8's 6.1 MB as 4.4)
let GLB_BYTES = null;
function showProgress() {
  let l = 0, t = 0;
  for (const v of prog.values()) { l += v.l; t += v.t; }
  const bar = document.querySelector('#bar i');
  if (bar && t) { bar.style.width = (100 * l / t).toFixed(0) + '%'; $('lmb').textContent = (100 * l / t).toFixed(0) + ' % · ' + (l / 1e6).toFixed(1) + ' / ' + (t / 1e6).toFixed(1) + ' MB'; }
}
const loadGlb = (url) => {
  const size = GLB_BYTES[url];
  if (size === undefined) throw new Error(url + ' is not in data/glb_bytes.json: run py tools/glb_sizes.py');
  if (!glbCache.has(url)) { mark('glb asked', url); glbCache.set(url, loader.loadAsync(url, (e) => { prog.set(url, { l: e.loaded, t: size }); showProgress(); }).then((g) => { mark('glb parsed', url); upgradePaint(g.scene); return g; })); }
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
mark('renderer ready', BACKEND);
// UC-30 the first full frame builds every shader it meets: 11-07 ?perf on WebGL 2, the lot's first frame took 8.3 s, and with one
// frame drawn behind the loading screen first, the next took 26 ms. So the lot is drawn behind the loading screen a piece at a time
// (each piece's shaders in a frame of their own, the loading game drawn in between), and the cars' models join it one at a time
// (UC-32). Tried first and dropped: renderer.compileAsync, aimed at the canvas and then at the post pass's target; the real frame
// did not reuse what it built (the pedestal tops' reflection and the shadow map draw the scene again, each with its own shaders)
const pause = (ms) => new Promise((r) => setTimeout(r, ms));   // a timer, not a frame: it still runs in a tab in the background
const drawables = (o) => { const m = []; o.traverse((x) => { if (x.isMesh || x.isSprite || x.isLine || x.isPoints) m.push(x); }); return m; };
// a scene drawn behind its loading screen a piece at a time, so its first visible frame builds nothing; a piece drawn once is not
// drawn again (the track and the strip are warmed on the first race only, the car of each race on its own). 11-07: the strip's first
// frame froze the page for longer than the page check's 30 s click wait, the lot's had for 8.3 s
const warmed = new WeakSet();
const WARM_STEPS = 8;                                             // AUTHORED: at most 8 frames per warm-up (11-07: the strip's 56 pieces, one a frame, took 60 s in software)
async function warmPieces(scene, render, label, before) {
  const pieces = scene.children.filter((p) => !warmed.has(p) && drawables(p).length), was = new Map();
  if (!pieces.length) return;
  for (const piece of pieces) for (const m of drawables(piece)) { was.set(m, [m.visible, m.frustumCulled]); m.visible = false; }   // the lights stay on: shaders depend on them
  if (before) before();
  const per = Math.ceil(pieces.length / WARM_STEPS);
  for (let i = 0; i < pieces.length; i += per) {
    const step = pieces.slice(i, i + per), ms = step.flatMap(drawables);
    for (const p of step) warmed.add(p);
    for (const m of ms) { m.visible = was.get(m)[0]; m.frustumCulled = false; }   // unculled, so a piece out of view is built too
    await timed('warmed ' + label, step.length + ' pieces', () => { render(); });
    for (const m of ms) m.frustumCulled = was.get(m)[1];
    await pause(16);
  }
}
const warmLot = () => warmPieces(show.scene, () => showPost.render(), 'lot', () => tickShow(0));   // tickShow: the camera where the lot opens
// UC-31 not on WebGPU: say so, with the reason the browser gives and what would run it (Chrome's own release notes, linked)
async function gpuNotice() {
  try { if (localStorage.getItem('hoc.gpunote') === BACKEND) return; } catch (e) { /* a private window: shown each visit */ }
  let why;
  if (!navigator.gpu) why = 'this browser has no WebGPU';
  else {
    let adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { why = 'WebGPU refused the page (' + e.message + ')'; }
    if (!why) why = adapter ? 'WebGPU would not start with this graphics adapter' : 'this browser has WebGPU but gave the page no graphics adapter: Chrome keeps WebGPU off on graphics chips it has not cleared';
  }
  const android = /Android/i.test(navigator.userAgent), chromium = /Chrome\/|Edg\//.test(navigator.userAgent);
  const fix = android
    ? 'On Android, WebGPU runs in Chrome 121 or newer on Android 12 or newer with a Qualcomm or ARM graphics chip (<a href="https://developer.chrome.com/blog/new-in-webgpu-121" target="_blank" rel="noopener">Chrome&rsquo;s notes</a>): update Chrome, or open the lot on a computer in Chrome or Edge.'
    : navigator.gpu && chromium
      ? 'This browser can run WebGPU, so the graphics chip, its driver or the browser&rsquo;s hardware acceleration is holding it back: type chrome://gpu in the address bar to see which, update the graphics driver, or open the lot on another computer.'
      : 'WebGPU runs in Chrome or Edge 113 or newer on Windows, macOS and ChromeOS (<a href="https://developer.chrome.com/blog/webgpu-release" target="_blank" rel="noopener">Chrome&rsquo;s notes</a>): open the lot there.';
  $('gpunotetext').innerHTML = '<b>You are not seeing the best version of this page.</b> It is built for WebGPU and is running on ' + BACKEND + ' here, because ' + esc(why) + '. ' + fix;
  $('gpunote').hidden = false;
  $('gpunoteok').onclick = () => { $('gpunote').hidden = true; try { localStorage.setItem('hoc.gpunote', BACKEND); } catch (e) { /* not kept */ } };
}
$('renderer').textContent = BACKEND;
renderer.toneMapping = THREE.NeutralToneMapping;              // UC-37.1 (AUTHORED): Khronos PBR Neutral: a hot highlight rolls off to its own colour (ACES bleached it white; AgX left the picture grey)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;      // the track's
const studioTex = studioEnvironment(renderer, PAL.accent);                  // the showroom's (fx.js)

const [SHOW, TRACK, RULES, CAMS, INPUT, LISTINGS, MODELS, GLBS] = await Promise.all([fetchJson('showroom.json'), fetchJson('track.json'), fetchJson('timetrial_rules.json'),
  fetchJson('camera.json'), fetchJson('input.json'), fetchJson('listings.json'), fetchJson('models.json'), fetchJson('glb_bytes.json')]);
GLB_BYTES = GLBS.bytes;
const GHOSTS = await fetchJson('ghosts/index.json');      // UC-9.3: the simulated laps (tools/ghost_index.py)
const SCORES = new ScoreBoard(await fetchJson('scores.json'));   // UC-25: where the shared boards live (null: not set up, and said)
// UC-26 a car's model, or null when it has none or its model is withdrawn ("withheld": why, a model that cannot be fixed). Every
// lookup goes through here, so a withdrawn model leaves the whole page at once and its car says SOON instead of showing it
const modelOf = (key) => { const m = MODELS.models[key]; return m && !m.withheld ? m : null; };
const SOON = 'No model yet · coming soon';
// UC-33.4a / 1a the Motion switch: the speed widening and the shake on or off, kept on this device
const MOTION = { on: (() => { try { return localStorage.getItem('hoc.motion') !== 'off'; } catch (e) { return true; } })() };
// UC-35.3a the strip's camera: filmed (drag_cam.js, the default) or the chase camera, kept on this device
const DRAGCAM = { film: (() => { try { return localStorage.getItem('hoc.dragcam') !== 'chase'; } catch (e) { return true; } })() };
// UC-34 the strip's gearbox: the clutch and the H gate (the default), or the paddles of UC-22, kept on this device
const DRAGBOX = { clutch: (() => { try { return localStorage.getItem('hoc.gearbox') !== 'paddles'; } catch (e) { return true; } })() };
const DEG = Math.PI / 180;
const SALE_SPECS = await fetchJson('sale_specs.json');    // UC-9.1: each car for sale's factory numbers, READ with sources (tools/sale_specs.py)
const [REVIEWS, RECALLS, COLOURS, PHOTOS, DRAGY] = await Promise.all([fetchJson('reviews.json'), fetchJson('recalls.json'), fetchJson('colours.json'), fetchJson('photos.json'), fetchJson('dragy.json')]);   // UC-14: ratings, owner reports, mods, clubs (tools/reviews.py); recalls (tools/recalls.py)
// UC-8: the lot's slides, with `listings` expanded into one slide per car for sale (data/listings.json) and per pick the site lacks
const LOT = SLIDES.flatMap((d) => d.kind !== 'listings' ? [d]
  : [...LISTINGS.cars.map((l) => ({ kind: 'listing', listing: l })), ...LISTINGS.absent.map((x) => ({ kind: 'unlisted', unlisted: x }))]);
const pad = makeGamepad(INPUT);                                    // UC-7.5a: the IMC's gamepad bindings (gamepad.js)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;   // UC-7.2b
const START_HASH = decodeURIComponent(location.hash);     // read once: select() rewrites the hash to follow the slide
const KIOSK = START_HASH === '#kiosk';                     // UC-11.5
window.HOC = { BACKEND, SHOW, TRACK, RULES, state: null, paint, saleModels: { want: [], on: [], soon: [] } };   // saleModels.on: in the order they joined (UC-32)   // for the page check (test/page_check.py) and for review in devtools; saleModels: the Meshy models asked for and those on their pedestals

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
  if (w.sale) {   // a car for sale's cut-out wheel (simBody): in the body's frame +X is forward, +Y up, +Z right (ue_space)
    w.steer.rotation.y = w.steers ? -steerDeg * Math.PI / 180 : 0;   // Unreal yaw + is a right turn; about three's +Y that is -
    w.spin.rotation.z = -spinRad;                                    // rolling forward turns the top forward: clockwise seen from +Z
    w.steer.position.y = w.restY + suspensionCm / 100;
    return;
  }
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
  if (!def.model && def.kind === 'listing') { g.fillStyle = PAL.accent; g.font = '800 30px "Open Sans", sans-serif'; g.fillText(SOON.toUpperCase(), 80, 470); }   // UC-26
  g.fillStyle = PAL.soft; g.font = '600 24px "Open Sans", sans-serif'; g.fillText('HOUSE OF CARS · 3D LOT CONCEPT · UNOFFICIAL', 80, 556);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// a car for sale in the race: its 3D model (Meshy's or hand-made), nose along the body's X, standing on the car's ground line and centred on its
// wheelbase (data/sim_cars: the wheels are the physics', not drawn separately; the model carries its own)
async function simBody(key, carJson) {
  const m = modelOf(key);
  if (!m) throw new Error('no 3D model of ' + key + ' yet: it can be raced as a ghost, not driven');
  const body = await saleModel(m);
  const w = carJson.wheels.map((x) => x.bone_location.value);
  const ground = Math.min(...carJson.wheels.map((x, i) => w[i][2] - x.setup.wheel_radius.value));
  const cx = w.reduce((a, p) => a + p[0], 0) / w.length;
  body.position.set(cx / 100, ground / 100, 0);
  const g = new THREE.Group(); g.add(body);
  const B = carJson.bounds_cm.value, cs = contactShadow(B.box_extent[0] * 2 / 100, B.box_extent[1] * 2 / 100);   // UC-37.3
  cs.position.set((B.origin[0]) / 100, ground / 100 + 0.012, 0); g.add(cs);
  // UC-15.4: the wheels import_models.py cut out of a Meshy body or took from a hand-made model's own parts (models.json wheels: the node, its sim wheel, its centre in
  // the model's real-size frame); each hangs on a steer pivot (about up) holding a spin pivot (about the axle, the body's Z),
  // both at the wheel's centre, so the physics turns them as it turns the template cars' wheels. No wheels = the reason is
  // models.json wheels_why, and none are drawn turning.
  const wheels = [];
  g.updateMatrixWorld(true);
  const scene = body.children[0];
  for (const w of m.wheels || []) {
    const mesh = scene.getObjectByName(w.node);
    if (!mesh) throw new Error(m.glb + ' has no node ' + w.node + ', which data/models.json names as a wheel: re-run tools/import_models.py');
    const c = body.worldToLocal(scene.localToWorld(new THREE.Vector3(...w.centre_m)));
    const steer = new THREE.Group(), spin = new THREE.Group();
    steer.position.copy(c); body.add(steer); steer.add(spin); g.updateMatrixWorld(true);
    spin.attach(mesh);
    wheels[w.sim_wheel] = { sale: true, steer, spin, steers: w.steers, restY: c.y };
  }
  return { group: g, wheels };
}
// a 3D model of a car for sale (Meshy's or hand-made), on its pedestal: scaled so its length is the car's READ length (data/models.json says where
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
// UC-26 the sign on the pedestal of a car with no model: SOON on a lit card standing where the car would
function soonSign() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,10,10,.82)'; g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = PAL.accent; g.lineWidth = 10; g.strokeRect(5, 5, 1014, 246);
  g.textAlign = 'center'; g.fillStyle = '#fefefe'; g.font = '800 96px "Open Sans", sans-serif'; g.fillText('NO MODEL YET', 512, 120);
  g.fillStyle = PAL.accent; g.font = '800 64px "Open Sans", sans-serif'; g.fillText('COMING SOON', 512, 210);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 1.0), new THREE.MeshBasicNodeMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
  m.position.set(0, 1.4, 0); m.name = 'soon_sign'; return m;
}
const carEntry = (name) => { const e = SHOW.cars.find((c) => c.name === name); if (!e) throw new Error('slides.js names a car showroom.json lacks: ' + name); return e; };
// UC-32 the cars' models join the lot one at a time, the car on show first, then those beside it round the ring; a car the visitor
// heads for (select, a link, walking up to it, a drive) goes to the front. Every model downloads at once; only the joining is
// queued, so no two cars' shaders are built in one frame. Until its model joins, a car stands as its own first listing photo
const modelQ = { items: [], busy: false };
const ringGap = (i) => { const n = show.slides.length, d = Math.abs(i - show.index); return Math.min(d, n - d); };
function wantModel(key) { const it = modelQ.items.find((x) => x.key === key); if (it) it.urgent = performance.now(); pumpModels(); }
async function pumpModels() {
  if (modelQ.busy || !modelQ.open) return;
  const next = modelQ.items.filter((x) => x.state === 'wait').sort((a, b) => (b.urgent || 0) - (a.urgent || 0) || ringGap(a.i) - ringGap(b.i))[0];
  if (!next) return;
  modelQ.busy = true; next.state = 'joining';
  const got = await next.ready;                                  // { g } or { e }
  if (got.e) { next.state = 'failed'; if (next.caption) { next.caption.material.map = captionTex('3D model did not load'); next.caption.material.needsUpdate = true; } reportError(got.e); }
  else {
    next.turn.add(got.g);
    if (next.card) { next.stand.remove(next.card, next.caption); next.card.material.map.dispose(); }
    next.state = 'on'; HOC.saleModels.on.push(next.key); mark('model on its pedestal', next.key); perfFirst.push(next.key);
  }
  await pause(120);                                              // the frame that builds its shaders, and one more, before the next
  modelQ.busy = false; pumpModels();
}
function captionTex(text) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,10,10,.8)'; g.fillRect(0, 0, 1024, 96); g.fillStyle = PAL.soft; g.font = '700 46px "Open Sans", sans-serif'; g.textAlign = 'center'; g.fillText(text, 512, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// the car's own first listing photo (UC-18: the dealer's image server, which serves it to any page: Access-Control-Allow-Origin *)
function photoCard(key) {
  const ph = PHOTOS.cars[key] && PHOTOS.cars[key].photos[0];
  const caption = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.41), new THREE.MeshBasicNodeMaterial({ map: captionTex('3D model on its way'), transparent: true, side: THREE.DoubleSide }));
  caption.position.set(0, 0.62, 0.02);
  if (!ph) return { card: null, caption };                       // UC-32.1a: no photo, the line alone
  const tex = new THREE.TextureLoader().setCrossOrigin('anonymous').load(ph.full, undefined, undefined, () => reportError(new Error('the listing photo did not load: ' + ph.full)));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.3), new THREE.MeshBasicNodeMaterial({ map: tex, side: THREE.DoubleSide }));   // both faces: across the ring it is seen from behind
  card.position.set(0, 2.5, 0); card.name = 'photo_' + key;
  return { card, caption };
}
for (let i = 0; i < LOT.length; i++) {
  const def = LOT[i];
  const a = (i / LOT.length) * Math.PI * 2;
  const stand = new THREE.Group();
  stand.position.set(Math.sin(a) * RING, 0, Math.cos(a) * RING);
  stand.rotation.y = a;
  const car = def.kind === 'car' ? carEntry(def.car) : null;
  const onPed = car || def.kind === 'listing' || def.kind === 'unlisted';       // a slide with a pedestal (a car, or a car for sale)
  const saleKey = def.kind === 'listing' ? def.listing.key : def.kind === 'unlisted' ? def.unlisted.key : null;
  if (saleKey) def.model = modelOf(saleKey);   // UC-8.3: a model of THAT car, or none; looked up before its panel says which
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
        turn.position.y = 0.3; HOC.saleModels.want.push(saleKey);
        const { card, caption } = photoCard(saleKey);
        if (card) stand.add(card); stand.add(caption);
        modelQ.items.push({ i, key: saleKey, turn, stand, card, caption, state: 'wait',
          ready: saleModel(def.model).then((g) => { g.name = saleKey; return { g }; }, (e) => ({ e })) });   // an error is reported when its turn comes
      } else { turn.add(soonSign()); HOC.saleModels.soon.push(saleKey); }   // UC-26: the empty pedestal says why
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
  const m = modelOf(key); if (!m) return;
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
      '<div class="acts">' + (d.model ? '<button class="pick2" id="aropen">' + svgIcon('lot', 16) + ' In your driveway (AR)</button>' : '') +
      '<a class="act" href="details.html#car=' + esc(d.unlisted.key) + '">Full details</a></div>' +      // UC-16.1: the car's own page (details.js)
      (d.model ? '' : '<p class="soon">' + SOON + '</p>') +   // UC-26
      '<div id="srcline">' + (d.model ? '3D model: ' + esc(d.model.src) + ' Length: ' + esc(d.model.length_m.src) + '<br>' : '') +
      d.unlisted.searched.map(esc).join('<br>') + '</div>' + knownSpecsHTML(d.unlisted.key, REVIEWS) + dragyHUD(d.unlisted.key, DRAGY, 'card') + knowHTML(d.unlisted.key, REVIEWS, RECALLS);
    card.querySelectorAll('button.src').forEach((b) => b.addEventListener('click', () => { $('srcline').textContent = b.title; }));
    if ($('aropen')) $('aropen').addEventListener('click', () => openAR(d.unlisted.key, 'Audi S7'));
    return;
  }
  const l = d.listing;
  const row = (label, f, fmt) => '<dt>' + esc(label) + '</dt><dd>' + (V(f) === null ? '<span class="abs" title="' + esc(f.why) + '">not listed</span>' : esc(fmt ? fmt(V(f)) : V(f))) + '</dd>';
  const leads = leadsFor(l.key, LOT_CARS);
  card.innerHTML = '<p class="kick">For sale · ' + esc(V(l.city)) + (V(l.store) !== V(l.city) ? ' · ' + esc(V(l.store)) : '') + ' store</p><h2>' + esc(saleTitle(l)) + '</h2>' +
    (leads.length ? '<div class="leads" title="Best of the ' + LOT_CARS.length + ' cars for sale on this lot, from their published figures and simulated laps">' + leads.map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>' : '') +
    (V(l.trim) ? '<div class="sub">' + esc(V(l.trim)) + '</div>' : '') + (modelOf(l.key) ? '' : '<p class="soon">' + SOON + '</p>') + '<div class="price">' + (V(l.price) !== null ? esc(money(V(l.price), V(l.currency))) : 'Price not listed') + '<small>as listed on houseofcars.com, ' + esc(readDay) + '</small></div>' +
    '<dl>' + row('Kilometres', l.km, (v) => v.toLocaleString('en-CA') + ' km') + row('Engine', l.engine) + row('Colour', COLOURS.cars[l.key] || l.colour) + row('Interior', l.interior) +
    row('VIN', l.vin) + row('Stock', l.stock) + '</dl>' +
    specRows(l.key) + simLine(l.key) +
    '<div class="acts">' + (modelOf(l.key) && SIMS.has(l.key) ? '<button class="act go" data-drag="' + l.key + '">Drag race it</button><button class="act" data-drive="' + l.key + '">Lap the track</button>' : '') +
    (GHOSTS.ghosts.some((g) => g.car === l.key) ? '<button class="act" data-race="' + l.key + '">Race its ghost</button>' : '') +
    '<a class="act" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + svgIcon('link', 16) + ' See it on houseofcars.com</a>' +
    '<a class="act" href="details.html#car=' + esc(l.key) + '">Full details</a>' +      // UC-16.1: the car's own page (details.js)
    (modelOf(l.key) && modelOf(l.key).interior ? '<a class="act" href="details.html#car=' + esc(l.key) + '&inside">Look inside</a>' : '') + '</div>' +   // UC-17: a model with a cabin
    '<div class="sell"><button class="pick2" id="cmpopen">' + svgIcon('numbers', 16) + ' Compare the lot</button><button class="pick2" id="share">' + svgIcon('link', 16) + ' Share this car</button>' +
    (modelOf(l.key) ? '<button class="pick2" id="aropen">' + svgIcon('lot', 16) + ' In your driveway (AR)</button>' : '') + '</div>' +
    photoStrip(l.key) +
    dragyHUD(l.key, DRAGY, 'card') + knowHTML(l.key, REVIEWS, RECALLS) +
    '<div class="qr" id="qr"></div>' +
    '<div id="srcline">' + (d.model ? '3D model: ' + esc(d.model.src) : '3D model not made yet.') + ' Listing: ' + esc(l.name.src) + '</div>';
  card.querySelectorAll('button.src').forEach((b) => b.addEventListener('click', () => { $('srcline').textContent = SALE_SPECS.cars[l.key].rows[+b.dataset.k].src; }));
  card.querySelectorAll('button[data-race]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem(GHOST_KEY, b.dataset.race + '.json'); } catch (e) { /* the picker still shows it in the race */ }
    pendingGhost = b.dataset.race + '.json'; startRace(carEntry('SportsCar'));
  }));
  card.querySelectorAll('button[data-drive]').forEach((b) => b.addEventListener('click', () => startRace({ name: b.dataset.drive, sim: true, drivable: true })));
  card.querySelectorAll('button[data-drag]').forEach((b) => b.addEventListener('click', () => startDrag({ name: b.dataset.drag, sim: true, drivable: true }).catch((e) => reportError(e))));   // UC-22
  $('cmpopen').addEventListener('click', () => openCompare(l.key));
  if ($('aropen')) $('aropen').addEventListener('click', () => openAR(l.key));
  $('share').addEventListener('click', (e) => shareCar(l.key, e.currentTarget));
  drawQR(l.key, $('qr'));
}
// UC-18: the car's own listing photos (data/photos.json, tools/photos.py), shown from the dealer's image server and credited;
// each opens the details page's gallery
function photoStrip(key) {
  const p = PHOTOS.cars[key];
  if (!p) return '';
  return '<p class="kick" style="margin-top:12px">This car&#39;s photos</p><div class="pstrip">' +
    p.photos.slice(0, 8).map((x, i) => '<a href="details.html#car=' + key + '" title="Listing photo ' + (i + 1) + ' of ' + p.count + '"><img loading="lazy" src="' + esc(x.thumb) + '" alt="Listing photo ' + (i + 1) + ' of ' + p.count + '"></a>').join('') +
    '</div><p class="pcred"><a href="details.html#car=' + key + '">All ' + p.count + ' photos</a> · <a href="' + esc(p.listing) + '" target="_blank" rel="noopener">' + esc(p.credit) + '</a></p>';
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
  const saleDrive = d.kind === 'listing' && modelOf(d.listing.key) && SIMS.has(d.listing.key);
  const drivable = sale ? !!saleDrive : s.car ? s.car.drivable : s.def.kind === 'drive';
  $('drive').disabled = !drivable;
  $('drive').textContent = sale && !saleDrive ? 'FOR SALE' : sale ? 'DRAG RACE' : s.car && !s.car.drivable ? 'SHOWROOM ONLY' : 'TEST DRIVE';
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
  pumpModels();                                          // UC-32.3: the queue reorders round the car now on show
}
$('prev').onclick = () => select(show.index - 1);
$('next').onclick = () => select(show.index + 1);
$('drive').onclick = () => {
  const s = show.slides[show.index];
  if (s.def.kind === 'listing') { startDrag({ name: s.def.listing.key, sim: true, drivable: true }).catch((e) => reportError(e)); return; }   // UC-23.1: a car for sale races the strip
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

// ---------------------------------------------------------------- walking the lot (UC-28, walk.js): the lot's own camera at a standing
// eye height, among the same pedestals; the pedestals' radius is the one built above (CylinderGeometry 3.3 at its foot)
const PED_R = 3.3;
const walk = { w: null, faced: -1, lastFaced: -1, stick: { x: 0, y: 0 }, dyaw: 0, dpitch: 0, look: null, move: null, fov: 40 };
const walkTargets = () => show.slides.map((c) => (c.turn && (c.car || c.def.model) ? { x: c.stand.position.x, z: c.stand.position.z } : null));
const walkObstacles = () => show.slides.filter((c) => c.turn).map((c) => ({ x: c.stand.position.x, z: c.stand.position.z, r: PED_R }));
function slideName(i) {
  const d = show.slides[i].def;
  if (d.kind === 'listing') { const l = d.listing; return '<b>' + esc(saleTitle(l)) + '</b>' + (V(l.price) !== null ? ' · ' + esc(money(V(l.price), V(l.currency))) : ''); }
  if (d.kind === 'unlisted') return '<b>' + esc(saleTitle(d.unlisted)) + '</b>';
  return '<b>' + esc(show.slides[i].car ? show.slides[i].car.name : '') + '</b> · Unreal Engine 5.7 template car';
}
function startWalk() {
  if (mode !== 'show') return;
  const a = show.slides[show.index].angle, out = RING + 7.5;           // just outside the ring, facing the car on show
  walk.w = makeWalker(Math.sin(a) * out, Math.cos(a) * out, a);
  walk.fov = showCam.fov; showCam.fov = 70; showCam.updateProjectionMatrix();
  walk.faced = -1; walk.lastFaced = show.index; walk.stick = { x: 0, y: 0 }; keys.clear();
  mode = 'walk'; document.body.classList.add('walking'); $('walkhud').hidden = false; $('walklabel').hidden = true;
}
function endWalk(open) {
  showCam.fov = walk.fov; showCam.updateProjectionMatrix();
  mode = 'show'; document.body.classList.remove('walking'); $('walkhud').hidden = true; $('walklabel').hidden = true; keys.clear();
  intro = 1; select(open >= 0 ? open : walk.lastFaced);                // UC-28.3 / 28.4: that car's card, or the one last looked at
}
function tickWalk(dt) {
  const k = (c) => keys.has(c);
  const fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) - walk.stick.y;
  const side = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + walk.stick.x;
  const turn = ((k('ArrowLeft') ? 1 : 0) - (k('ArrowRight') ? 1 : 0)) * 1.8 * dt;   // AUTHORED: a turn of about 100 degrees a second
  stepWalker(walk.w, { fwd, side, fast: k('ShiftLeft') || k('ShiftRight'), turn: turn + walk.dyaw, lift: walk.dpitch }, dt, walkObstacles(), { r: RING + 16 });
  walk.dyaw = 0; walk.dpitch = 0;
  showCam.position.set(walk.w.x, EYE_M, walk.w.z);
  showCam.rotation.set(walk.w.pitch, walk.w.yaw, 0, 'YXZ');
  const i = facing(walk.w, walkTargets());
  if (i !== walk.faced) {
    walk.faced = i; if (i >= 0) { walk.lastFaced = i; const d = show.slides[i].def; if (d.kind === 'listing' || d.kind === 'unlisted') wantModel((d.listing || d.unlisted).key); }   // UC-32.3
    const el = $('walklabel'); el.hidden = i < 0;
    if (i >= 0) el.innerHTML = slideName(i) + '<span>' + (matchMedia('(pointer:coarse)').matches ? 'Tap to see this car' : 'Enter: see this car') + '</span>';
  }
  showPost.render();
}
$('walk').onclick = () => startWalk();
$('walkexit').onclick = () => endWalk(-1);
$('walklabel').onclick = () => { if (walk.faced >= 0) endWalk(walk.faced); };
// looking: a drag (a mouse anywhere, a finger on the right half); walking on a phone: a finger on the left half is a thumb stick
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'walk') return;
  if (e.pointerType === 'touch' && e.clientX < innerWidth / 2) walk.move = { id: e.pointerId, x: e.clientX, y: e.clientY };
  else walk.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (mode !== 'walk') return;
  if (walk.look && e.pointerId === walk.look.id) { walk.dyaw -= (e.clientX - walk.look.x) * 0.005; walk.dpitch -= (e.clientY - walk.look.y) * 0.004; walk.look.x = e.clientX; walk.look.y = e.clientY; }
  if (walk.move && e.pointerId === walk.move.id) walk.stick = { x: Math.max(-1, Math.min(1, (e.clientX - walk.move.x) / 60)), y: Math.max(-1, Math.min(1, (e.clientY - walk.move.y) / 60)) };
});
const walkUp = (e) => { if (walk.look && e.pointerId === walk.look.id) walk.look = null; if (walk.move && e.pointerId === walk.move.id) { walk.move = null; walk.stick = { x: 0, y: 0 }; } };
canvas.addEventListener('pointerup', walkUp); canvas.addEventListener('pointercancel', walkUp);
window.HOC.walk = walk; window.HOC.startWalk = startWalk; window.HOC.walkTick = (dt) => tickWalk(dt);   // the page check steps the walk by its own clock
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
  const sky = physicalSky(renderer, dir, 0.32, TRACK.landscape_material.ground_col);   // fx.js; see AUTHORED: sky; UC-37.2 the ground in the probe
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
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (o.material && o.material[k]) o.material[k].anisotropy = renderer.getMaxAnisotropy();   // UC-33.3
    if (o.material && !o.material.userData.restyled) {                    // UC-33: the template's grid road and tinted walls, restyled (fx.js)
      if (o.material.name === 'MI_TrackEdge_Inst') { asphaltRoad(o.material, false); o.material.userData.restyled = 'asphalt'; }
      else if (o.material.name === 'MI_TrackEdge') { asphaltRoad(o.material, true); o.material.userData.restyled = 'shoulder'; }
      else if (o.material.name === 'M_TintCol') { concreteWall(o.material); o.material.userData.restyled = 'concrete'; }
    }
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
  return { scene, sun, sunDir: dir, gates, sky: sky.mesh, marker, chev, skids, gateGround: [], ground, track: t };   // ground and track: hidden on the drag strip
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
    mark('track: start');
    Chaos = await timed('track: physics module', 'chaos_vehicle.js', () => import('./chaos_vehicle.js'));
    const tv = await timed('track: scene', 'buildTrack', () => buildTrack()); trackView = tv;
    world = await timed('track: world', 'collision + ground', async () => withHoles(await loadWorld(fetchBin, TRACK), await loadHoles(fetchBin, fetchJson, TRACK.ground.grid)));   // the tunnel mouths are holes (UC-2.2)
    trackView.minimap = await timed('track: minimap', '', async () => buildMinimap($('minimap'), await fetchJson('road_spline.json'), TRACK.gates));
    trackView.gateGroundUe = TRACK.gates.map((g) => {          // where each gate's marker stands: the ground under its centre (UE cm)
      const c = g.center_cm, hit = world.trace([c[0], c[1], c[2] + g.half_extent_cm[2]], [c[0], c[1], c[2] - g.half_extent_cm[2]]);
      if (!hit) throw new Error('no ground under gate ' + g.label);
      return hit.point;
    });
    trackView.gateGround = trackView.gateGroundUe.map(toThreePoint);
    trackView.line = AI.buildRacingLine(await fetchJson('road_spline.json'), TRACK);   // the road's own spline (READ), as the sim drives it
    trackView.dressing = await timed('track: dressing', '', async () => buildDressing(THREE, toThreePoint, await fetchJson('road_spline.json'), await fetchJson('track_dress.json'), TRACK.gates, trackView.gateGroundUe, renderer.getMaxAnisotropy()));
    trackView.scene.add(trackView.dressing);                // UC-33.2 / 33.3
    await Promise.all(['cars.json', 'physics.json', 'chaos_unexported.json'].map(fetchJson));
    window.HOC.trackPreloaded = true;
  })();
  return trackReady;
}
async function startRace(entry) {
  onLot = false; if (window.HOC_SALES) window.HOC_SALES.hide();                      // not over a race (its corner is the minimap's)
  loadingShow('Rolling the car out to the track…', entry.name);   // UC-20: the car's own listing photo, and the game
  await prepareTrack();
  if (dragView) setDragScene(false);                      // back from the strip: the track as it was
  clearSkids(trackView.skids);
  window.HOC.track = trackView;
  if (race && race.car) { trackView.scene.remove(race.car.group); if (race.ghostCar) trackView.scene.remove(race.ghostCar); if (race.opp) trackView.scene.remove(race.opp.car.group); }
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
  race.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
  race.post = makePost(renderer, trackView.scene, race.camera, { bloomStrength: 0.25, bloomRadius: 0.3, bloomThreshold: 1.2, vignette: 0.45, bloomCap: 6, saturation: 1.08 });   // UC-37.5
  await warmPieces(trackView.scene, () => race.post.render(), 'track');   // UC-30: behind the loading screen
  await loadingDone();                                    // UC-20.3: a game in play ends when its player says, not under a countdown
  audio.start();
  window.HOC.state = race;
  mode = 'race';
  $('showroom').style.display = 'none'; $('race').style.display = 'block';
  $('t-best').textContent = '—';
}
// the visitor is on the lot (not leaving it for a race or the strip, which may still be loading): the sales chat's moment
let onLot = true;
function backToShowroom() {
  mode = 'show'; onLot = true;
  window.dispatchEvent(new CustomEvent('hoc:lot-open'));              // the sales chat belongs to the lot: it greets the first time, shows its tab after
  if (dragView && trackView) setDragScene(false);
  silence(audio);
  $('showroom').style.display = ''; $('race').style.display = 'none';
}

// keys, as IMC_Vehicle_Default maps them (data: ue_out/bp/IMC_Vehicle_Default.t3d), plus Esc and G for the page
const keys = new Set();
const touch = { throttle: false, brake: false, left: false, right: false };
const audio = makeAudio();
// UC-27 the radio: the button names the station, a change puts its name across the top for a moment, as a car game shows one
const radio = new Radio(audio, (st, note) => {
  $('radio').textContent = st ? 'Radio: ' + st.name : note === 'no sound' ? 'Radio: no sound' : 'Radio off';
  $('radio').setAttribute('aria-pressed', String(!!st));
  const b = $('rbanner'); b.innerHTML = st ? '<b>' + esc(st.name) + '</b><span>' + esc(note || st.tag) + '</span>' : '<b>Radio off</b>';
  b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
});
window.HOC.radio = radio; window.HOC.modelQ = modelQ;   // UC-32: the page check reads the queue
$('radio').addEventListener('click', () => radio.next());
function syncMotion() { $('motion').textContent = 'Motion ' + (MOTION.on ? 'on' : 'off'); $('motion').setAttribute('aria-pressed', String(MOTION.on)); }
function toggleMotion() { MOTION.on = !MOTION.on; try { localStorage.setItem('hoc.motion', MOTION.on ? 'on' : 'off'); } catch (e) { /* not kept */ } syncMotion(); }
$('motion').addEventListener('click', toggleMotion); syncMotion();
function syncDragCam() { $('dcam').textContent = 'Camera: ' + (DRAGCAM.film ? 'filmed' : 'chase'); $('dcam').setAttribute('aria-pressed', String(DRAGCAM.film)); }
function toggleDragCam() { DRAGCAM.film = !DRAGCAM.film; try { localStorage.setItem('hoc.dragcam', DRAGCAM.film ? 'film' : 'chase'); } catch (e) { /* not kept */ } syncDragCam(); }
$('dcam').addEventListener('click', toggleDragCam); syncDragCam();
window.HOC.dragCam = DRAGCAM;
window.HOC.motion = MOTION;
function syncMute() { $('mute').textContent = !audio.available() ? 'No sound' : audio.muted ? 'Sound off' : 'Sound on'; $('mute').setAttribute('aria-pressed', String(!audio.muted)); if (audio.muted && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }   // UC-27.4: the talk station's voice too
$('mute').addEventListener('click', () => { audio.start(); audio.setMuted(!audio.muted); syncMute(); });
syncMute();
addEventListener('pointerdown', () => audio.start(), { once: true });
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;   // a name being typed (UC-25.3) drives nothing: R would rerun, E shift
  audio.start();
  if (e.key === 'm' || e.key === 'M') { audio.setMuted(!audio.muted); syncMute(); return; }
  if (e.key === 'n' || e.key === 'N') { radio.next(); return; }
  if (e.key === 'v' || e.key === 'V') { toggleMotion(); return; }   // UC-33.4a   // UC-27.2: the next station, or the one before
  if (e.key === 'b' || e.key === 'B') { radio.back(); return; }
  if (mode === 'walk') {                                  // UC-28: walking keys; Enter opens the car faced, Esc leaves
    if (e.key === 'Escape') { endWalk(-1); return; }
    if (e.key === 'Enter') { if (walk.faced >= 0) endWalk(walk.faced); return; }
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    keys.add(e.code); return;
  }
  if (mode === 'show') {
    if (e.key === 'k' || e.key === 'K') { startWalk(); return; }
    if (e.key === 'ArrowLeft') select(show.index - 1);
    if (e.key === 'ArrowRight') select(show.index + 1);
    if (e.key === 'Enter' && !$('drive').disabled) $('drive').click();
    return;
  }
  if (mode === 'drag') {                                  // UC-22 the strip's keys (the page's own: Unreal's template has no manual gears)
    if (e.key === 'Escape') { backToShowroom(); return; }
    if (e.key === 'e' || e.key === 'E' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { e.preventDefault(); if (!e.repeat) dragPress('up'); return; }
    if (race.clutchMode && !e.repeat && (/^Digit[0-9]$/.test(e.code) || e.key === 'n' || e.key === 'N')) { requestGear(race, /^Digit/.test(e.code) ? +e.code.slice(5) : 0); return; }   // UC-34.1a the gate on keys: 1..7, N or 0 neutral
    if (e.key === 'g' || e.key === 'G') { toggleDragBox(); return; }
    if (e.key === 'q' || e.key === 'Q') { if (!e.repeat) dragPress('down'); return; }
    if ((e.key === 'r' || e.key === 'R' || e.key === 'Enter') && (race.run.done || race.v.stalled)) { dragRerun(); return; }
    if (e.key === 'p' || e.key === 'P') { savePicture(race.entry.name + '-drag'); return; }
    if (e.key === 'c' || e.key === 'C') { toggleDragCam(); return; }   // UC-35.3a
    keys.add(e.code); return;
  }
  if (e.key === 'Escape') { backToShowroom(); return; }
  if (e.key === 'p' || e.key === 'P') { savePicture(race.entry.name + '-drive'); return; }
  // Tab: the template's FrontSpringArm. A car for sale is a Meshy shell with no cabin, and that camera sits inside it (11-06:
  // the view was the inside of the body), so it keeps the chase camera
  if (e.key === 'Tab') { e.preventDefault(); if (!race.entry.sim) race.front = !race.front; return; }
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
  if (g.pressed.has('IA_Reset') && mode !== 'drag') doReset();          // the strip has no reset: Run again
  if (g.pressed.has('IA_ToggleCamera') && !race.entry.sim) race.front = !race.front;   // as Tab: no cabin camera in a car for sale
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
    const sf = stepSpeedFx(r.speedfx || (r.speedfx = makeSpeedFx()), r.v.forwardSpeedCmS * 0.036, dt, MOTION.on);   // UC-33.1 / 33.4
    cam.fov = verticalFovDeg(r.fov + sf.fovDeg, cam.aspect);
    cam.rotateX(sf.pitchDeg * DEG); cam.rotateZ(sf.rollDeg * DEG); cam.rotateY(sf.yawDeg * DEG);
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

// ---------------------------------------------------------------- the drag strip (UC-22): a quarter mile, the tree, shift by hand
// drag.js holds the strip's rules (the marks, the tree, the timing, the shift points); this draws the strip in the track's own scene
// (its sky, sun and haze; the track itself hidden while it is shown), runs the car on drag.js flatStrip with the gearbox in manual,
// and shows the tree, the shift lights and the slip. The strip's look is the page's own (AUTHORED): two lanes, 24 m wide, 700 m
// of shut-down after the quarter mile, the landscape's own ground colour for the grass.
const DRAG_LANE_Y_CM = -600;                                 // the left lane's centre (UE Y, cm): the strip is 24 m wide, two lanes
let dragView = null;
function dragBoard(text, w, h, bg, fg) {                    // a sign on the strip: a canvas texture, the page's own lettering
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = '800 ' + Math.round(h * 0.52) + 'px "Open Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function buildDragStrip(scene) {
  const g = new THREE.Group(); g.visible = false; g.name = 'drag-strip';
  const Q = Drag.MARKS.quarter, END = Q + 700, W = STRIP.width_m, behind = 30;     // 700 m to coast down from 200+ km/h on the idle brake
  const mat = (color, rough) => new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(color), roughness: rough, metalness: 0 });
  const M = TRACK.landscape_material;
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), mat(new THREE.Color(...M.ground_col), 1));   // the landscape's READ ground colour
  grass.rotation.x = -Math.PI / 2; grass.position.set(END / 2, -0.03, 0); grass.receiveShadow = true; g.add(grass);
  // UC-37.4 past the walls: mown grass, groves and hills in the haze (scenery.js; low on a phone or without WebGPU, where it costs most)
  const scenery = buildScenery(THREE, { quality: BACKEND !== 'WebGPU' || matchMedia('(pointer: coarse)').matches ? 'low' : 'high', seed: 1107, anisotropy: 8, fog: scene.fog, groundColour: M.ground_col });
  grass.material = scenery.grassMaterial; g.add(scenery.group);
  // the asphalt: a fine noise of the page's own, tiled every 4 m (fx.js groundDetail is the landscape's, and 11-06 it went white
  // this far from the track's own ground)
  const grain = document.createElement('canvas'); grain.width = grain.height = 256;
  { const c = grain.getContext('2d'), im = c.createImageData(256, 256); for (let i = 0; i < 256 * 256; i++) { const n = 38 + Math.random() * 22; im.data.set([n, n + 1, n + 3, 255], 4 * i); } c.putImageData(im, 0, 0); }
  const gt = new THREE.CanvasTexture(grain); gt.colorSpace = THREE.SRGBColorSpace; gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set((END + behind) / 4, W / 4); gt.anisotropy = 8;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(END + behind, W), new THREE.MeshStandardNodeMaterial({ map: gt, roughness: 0.88, metalness: 0 }));
  asphalt.rotation.x = -Math.PI / 2; asphalt.position.set((END - behind) / 2, 0, 0); asphalt.receiveShadow = true; g.add(asphalt);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(110, W), mat(0x47494c, 0.8));   // the launch pad: the first 100 m, lighter
  pad.rotation.x = -Math.PI / 2; pad.position.set(45, 0.005, 0); pad.receiveShadow = true; g.add(pad);
  const line = (x0, x1, z, w, color = 0xf2f2f2) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, w), mat(color, 0.6)); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.01, z); g.add(m); };
  line(-behind, END, -W / 2 + 0.3, 0.2); line(-behind, END, W / 2 - 0.3, 0.2); line(-behind, END, 0, 0.18, 0xffd400);   // the lane edges and the centre line
  line(-0.15, 0.15, -W / 4, W / 2 - 0.8); line(-0.15, 0.15, W / 4, W / 2 - 0.8);                                       // the start line, both lanes
  line(Drag.MARKS.eighth - 0.15, Drag.MARKS.eighth + 0.15, 0, W - 0.8, 0xd9d9d9);                                     // the 1/8 mile
  const check = document.createElement('canvas'); check.width = 64; check.height = 512;
  { const c = check.getContext('2d'); for (let j = 0; j < 32; j++) for (let i = 0; i < 4; i++) { c.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; c.fillRect(i * 16, j * 16, 16, 16); } }
  const ct = new THREE.CanvasTexture(check); ct.colorSpace = THREE.SRGBColorSpace;
  const fin = new THREE.Mesh(new THREE.PlaneGeometry(2, W - 0.8), new THREE.MeshStandardNodeMaterial({ map: ct, roughness: 0.7 }));
  fin.rotation.x = -Math.PI / 2; fin.position.set(Q, 0.012, 0); g.add(fin);                                           // the finish, checkered
  // the finish gantry and the distance boards
  const post = (x, z, h) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, h, 10), mat(0x9aa0a6, 0.4)); p.position.set(x, h / 2, z); p.castShadow = true; g.add(p); };
  post(Q, -W / 2 - 1, 7); post(Q, W / 2 + 1, 7);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, W + 2.4), [mat(0x222, 0.5), mat(0x222, 0.5), mat(0x222, 0.5), mat(0x222, 0.5),
    new THREE.MeshBasicNodeMaterial({ map: dragBoard('FINISH · 1/4 MILE', 1024, 96, '#0a0a0a', PAL.accent) }), new THREE.MeshBasicNodeMaterial({ map: dragBoard('HOUSE OF CARS', 1024, 96, '#0a0a0a', '#fefefe') })]);
  bar.position.set(Q, 6.6, 0); g.add(bar);
  for (const [x, label] of [[Drag.MARKS.sixty, '60 FT'], [Drag.MARKS.eighth, '1/8 MILE'], [Q - 0.5, '1/4 MILE']]) {
    post(x, W / 2 + 2.2, 2.6);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), new THREE.MeshBasicNodeMaterial({ map: dragBoard(label, 512, 176, '#f4f4f4', '#0a0a0a'), side: THREE.DoubleSide }));
    b.position.set(x, 2.8, W / 2 + 2.2); b.rotation.y = -Math.PI / 2; g.add(b);
  }
  // UC-35.5 walls along both sides and light poles outside them, so the speed shows as things flashing past (drag_cam.js STRIP;
  // AUTHORED, the page's own): concrete with the page's orange band and its name every 12 m, readable from inside the strip
  const wc = document.createElement('canvas'); wc.width = 1024; wc.height = 128;
  { const c = wc.getContext('2d'), im = c.createImageData(1024, 128);
    for (let i = 0; i < 1024 * 128; i++) { const n = 150 + Math.random() * 26; im.data.set([n, n - 2, n - 6, 255], 4 * i); }
    c.putImageData(im, 0, 0); c.fillStyle = PAL.accent; c.fillRect(0, 0, 1024, 22);
    c.fillStyle = 'rgba(20,20,20,.82)'; c.font = '800 54px "Open Sans", sans-serif'; c.textBaseline = 'middle'; c.fillText('HOUSE OF CARS', 40, 78); c.fillText('HOUSE OF CARS', 552, 78); }
  const wt = new THREE.CanvasTexture(wc); wt.colorSpace = THREE.SRGBColorSpace; wt.wrapS = THREE.RepeatWrapping; wt.anisotropy = 8; wt.repeat.set((END + behind) / 24, 1);
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(END + behind, STRIP.wall_top_m, STRIP.wall_thick_m), new THREE.MeshStandardNodeMaterial({ map: wt, roughness: 0.9, metalness: 0 }));
    w.position.set((END - behind) / 2, STRIP.wall_top_m / 2, side * STRIP.wall_y_m); w.castShadow = w.receiveShadow = true; g.add(w);
  }
  const nPoles = Math.floor(END / STRIP.pole_every_m) + 1, poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.16, STRIP.pole_h_m, 8), mat(0x8d9399, 0.45), nPoles * 2);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.22, 1.6), glowMaterial('#fff4dc', 2.5), nPoles * 2), m4 = new THREE.Matrix4();
  for (let i = 0; i < nPoles; i++) for (const [j, side] of [[0, -1], [1, 1]]) {
    const x = i * STRIP.pole_every_m, z = side * STRIP.pole_y_m;
    poles.setMatrixAt(i * 2 + j, m4.makeTranslation(x, STRIP.pole_h_m / 2, z));
    heads.setMatrixAt(i * 2 + j, m4.makeTranslation(x, STRIP.pole_h_m - 0.1, z - side * 0.7));   // the lamp leans out over the strip
  }
  poles.castShadow = true; g.add(poles, heads);
  // the tree: a post between the lanes behind the start line; each lamp an unlit and a lit material, swapped by the run
  const tree = new THREE.Group(); tree.position.set(5, 0, 0); g.add(tree);          // just past the start line, facing the cars, as on a strip
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 0.5), mat(0x15171a, 0.6)); pole.position.y = 1.7; tree.add(pole);
  const lamps = {}, off = new THREE.MeshStandardNodeMaterial({ color: 0x1b1b1b, roughness: 0.3 });
  const lamp = (name, y, color, r) => {
    const on = glowMaterial(color, 7), list = [];
    for (const z of [-0.42, 0.42]) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), off); m.position.set(-0.12, y, z); tree.add(m); list.push(m); }
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.2, r * 2.6, 1.4), mat(0x0d0e10, 0.5)); housing.position.set(0, y, 0); tree.add(housing);
    lamps[name] = { list, on, off };
  };
  lamp('prestage', 3.5, '#ffd27a', 0.09); lamp('stage', 3.3, '#ffd27a', 0.09);
  lamp('a1', 2.9, '#ffb020', 0.15); lamp('a2', 2.5, '#ffb020', 0.15); lamp('a3', 2.1, '#ffb020', 0.15);
  lamp('green', 1.6, '#3dff7a', 0.16); lamp('red', 1.15, '#ff3b30', 0.16);
  scene.add(g);
  return { group: g, lamps };
}
function setLamp(dv, name, lit) { const L = dv.lamps[name]; for (const m of L.list) m.material = lit ? L.on : L.off; }
// the track's own pieces hide while the strip shows, and come back as they were
function setDragScene(on) {
  const parts = [trackView.ground, trackView.track, trackView.gates, trackView.marker, trackView.dressing];   // the dressing is the track's, not the strip's
  if (on) { trackView.beforeDrag = parts.map((o) => o.visible); parts.forEach((o) => { o.visible = false; }); }
  else if (trackView.beforeDrag) { parts.forEach((o, i) => { o.visible = trackView.beforeDrag[i]; }); trackView.beforeDrag = null; }
  if (dragView) dragView.group.visible = on;
  document.body.classList.toggle('dragmode', on);
  $('drag').hidden = !on;
}
const dragTimeRows = [['rt', 'Reaction'], ['sixty', '60 ft'], ['kmh100', '0-100 km/h'], ['eighth', '1/8 mile'], ['quarter', '1/4 mile']];
async function startDrag(entry) {
  onLot = false; if (window.HOC_SALES) window.HOC_SALES.hide();                      // not over the strip's dials
  if (entry.sim) wantModel(entry.name);                  // UC-32.3
  loadingShow('Rolling the car to the strip…', entry.name);
  await prepareTrack();
  if (!dragView) dragView = buildDragStrip(trackView.scene);
  window.HOC.track = trackView;
  if (race && race.car) { trackView.scene.remove(race.car.group); if (race.ghostCar) trackView.scene.remove(race.ghostCar); if (race.opp) trackView.scene.remove(race.opp.car.group); }
  mode = 'show';
  setDragScene(true);
  clearSkids(trackView.skids);
  const carJson = entry.sim ? await fetchJson('sim_cars/' + entry.name + '.json') : (await fetchJson('cars.json')).cars[entry.name];
  const car = entry.sim ? await simBody(entry.name, carJson) : await buildCar(entry);
  trackView.scene.add(car.group);
  car.group.matrixAutoUpdate = false;
  const gravity = (await fetchJson('physics.json')).gravity_z.value;
  const unexported = entry.sim ? await fetchJson('sim_cars/' + entry.name + '.unexported.json') : (await fetchJson('chaos_unexported.json')).cars[entry.name];
  const opts = { gravityZ: gravity, unexported, angularDampingOnGround: RULES.angular_damping.on_ground, angularDampingInAir: RULES.angular_damping.in_air };
  const strip = Drag.flatStrip(TRACK.surface_friction.road);                // the template road's READ grip
  const front = carJson.bounds_cm.value.origin[0] + carJson.bounds_cm.value.box_extent[0];   // the nose, ahead of the car's origin (cm)
  const stage = [-front, DRAG_LANE_Y_CM, 60];
  const settle = (v) => { Chaos.resetVehicle(v, stage, 0); for (let i = 0; i < 240; i++) Chaos.stepVehicle(v, { throttle: 0, brake: 0, steering: 0, handbrake: 0, transmission: 'manual' }, STEP, strip); return v; };
  const v = settle(Chaos.makeVehicle(carJson, opts));
  const best = Drag.bestRun(Chaos, settle(Chaos.makeVehicle(carJson, opts)), strip);   // the sim's own best run, for the slip (DERIVED)
  const houseRec = [];
  const house = Drag.houseRun(Chaos, settle(Chaos.makeVehicle(carJson, opts)), strip, houseRec); // UC-25.2: R.J.Thompson's run on this car's board (DERIVED)
  // UC-38 that run is the car in the other lane: the same car, replayed from its recording (no second physics), 12 m to the right
  const oppCar = entry.sim ? await simBody(entry.name, carJson) : null;
  if (oppCar) { oppCar.group.matrixAutoUpdate = false; trackView.scene.add(oppCar.group); }
  const camKey = entry.sim ? 'SportsCar' : entry.name;
  const arm = CAMS.cars[camKey].BackSpringArm, cam = CAMS.cars[camKey].BackCamera;
  race = { kind: 'drag', entry, car, carJson, v, strip, best, house, pts: best.points, run: Drag.makeRun(), x0: v.pos[0], now: 0, rig: makeRig(arm), fov: cam.field_of_view,
           wheelWidths: carJson.wheels.map((w) => w.setup.wheel_width.value), throttle: 0, camKey, presses: [], gradeT: 0, front: false, slipShown: false, padPrev: {},
           director: makeDirector(), body: carJson.bounds_cm.value };   // UC-35: the filmed run, framed on the car's own READ bounds
  race.opp = oppCar ? { car: oppCar, rec: houseRec, i: 0, laneShift: -2 * DRAG_LANE_Y_CM } : null;   // UC-38
  race.clutchMode = DRAGBOX.clutch;                                    // UC-34: in neutral, the pedal up, the gate drawn
  if (race.clutchMode) { const layout = Sim.gateLayout(v.cfg.trans.forward.length); race.gate = { layout, knob: Sim.knobFor(0, layout), gear: 0 }; race.pedal = { depth: 0, held: false, anchor: 0, prev: 0 }; race.cut = null; }
  document.body.classList.toggle('clutchmode', race.clutchMode); $('dagain').hidden = true; drawGate(race); drawPedal(race);
  race.cluster = await buildCluster(entry, v, race.pts);              // UC-36: the car's own cluster, or the page's tach (36.1a)
  const tachEl = $('hud-speed'); tachEl.querySelector('svg.tach')?.remove();
  race.tach = buildTach(tachEl, v.cfg.engine.maxRPM, Math.min(...race.pts));   // the red band from the earliest derived shift point
  $('dslip').hidden = true; $('dgrade').textContent = '';
  $('dtimes').innerHTML = dragTimeRows.map(([k, l]) => '<div data-k="' + k + '"><span>' + l + '</span><b>--</b></div>').join('');
  $('dcar').textContent = entry.sim ? (LOT_CARS.find((c) => c.key === entry.name) || {}).title || entry.name : entry.name;
  race.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
  race.post = makePost(renderer, trackView.scene, race.camera, { bloomStrength: 0.35, bloomRadius: 0.3, bloomThreshold: 1.2, vignette: 0.45, bloomCap: 6, saturation: 1.08 });
  await warmPieces(trackView.scene, () => race.post.render(), 'strip');   // UC-30: behind the loading screen
  await loadingDone();
  audio.start();
  loadSfx(audio).catch((e) => reportError(e));                         // UC-34 4b the stick's sounds
  window.HOC.state = race;
  mode = 'drag';
  $('showroom').style.display = 'none'; $('race').style.display = 'block';
}
document.querySelectorAll('#dtouch button[data-d]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); dragPress(b.dataset.d); }));   // a phone's shift buttons
{ const gas = $('dgas');                                     // UC-35 6b: the strip's gas, on the left, held as the race's own gas button
  gas.addEventListener('pointerdown', (e) => { e.preventDefault(); touch.throttle = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) gas.addEventListener(ev, () => { touch.throttle = false; }); }
window.HOC.dragBot = () => { if (race && race.kind === 'drag') race.bot = true; };   // the page check: gas on the green, every shift at its derived point, through the same presses
window.HOC.dragTick = (dt) => tickDrag(dt);                                      // the page check steps frames itself (a background page draws few)
function dragPress(dir) {
  if (!(mode === 'drag' && race && race.kind === 'drag' && !race.run.done)) return;
  if (race.clutchMode) requestGear(race, race.gate.gear + (dir === 'up' ? 1 : -1)); else race.presses.push(dir);   // UC-34: through the gate
}
function gradePop(text, kind) { const el = $('dgrade'); el.textContent = text; el.className = 'g-' + kind; void el.offsetWidth; el.classList.add('pop'); }
function gradeShift(r, gear, rpm) {                                   // UC-22.3 an upshift graded against the gear it leaves
  const grade = Drag.noteShift(r.run, gear, rpm, r.pts[gear - 1], r.v.cfg.engine.maxRPM);
  gradePop(grade === 'PERFECT' ? 'PERFECT SHIFT' : (grade === 'EARLY' ? 'EARLY · ' : 'LATE · ') + Math.round(rpm) + ' rpm', grade.toLowerCase());
  blip(audio, grade === 'PERFECT' ? 'go' : 'gate');
}
// UC-34.4 a gear asked for through the gate: in, if the clutch is down (or the revs match); a grind, and the gear stays, if not
function requestGear(r, g) {
  const v = r.v, n = v.cfg.trans.forward.length; g = Math.max(0, Math.min(n, g));
  if (g === r.gate.gear || r.run.done) return true;
  const wheel = v.w.find((w) => w.engine), wheelRpm = wheel ? Math.abs(wheel.omega) * 30 / Math.PI : 0;
  const out = Sim.shiftOutcome(g, r.pedal.depth, v.engine.rpm, g ? wheelRpm * Math.abs(Chaos.gearRatio(v, g)) : 0);
  if (!out.ok) { gradePop('GRIND · clutch in to shift', 'late'); grind(audio); r.gate.knob = Sim.knobFor(r.gate.gear, r.gate.layout); drawGate(r); return false; }
  const from = r.gate.gear; r.gate.gear = g; r.gate.knob = Sim.knobFor(g, r.gate.layout);
  if (g === 0) sfx(audio, 'gear_out', 0.7); else { sfx(audio, 'gate', 0.35); sfx(audio, 'gear_in_' + (1 + Math.floor(Math.random() * 3)), 0.85); }   // UC-34 4b
  if (from >= 1 && g === from + 1 && from < n && r.cut && r.cut.gear === from) gradeShift(r, from, r.cut.rpm);   // graded at the rpm the drive was cut
  drawGate(r); return true;
}
// the page check's driver for the clutch (as HOC.dragBot for the paddles): revs up with the clutch in, lets it out over 1.2 s on the
// green, and shifts at the car's derived points through the clutch: in, the next gear, out over 0.25 s. AUTHORED, its timings
function botClutch(r, raw, dt) {
  const v = r.v, b = r.botState || (r.botState = { phase: 'stage', t: 0 }), n = v.cfg.trans.forward.length;
  b.t += dt; raw.throttle = 1;
  if (b.phase === 'stage') { r.pedal.depth = 1; raw.throttle = 0.7; if (r.gate.gear === 0) requestGear(r, 1); if (r.run.green !== null) { b.phase = 'launch'; b.t = 0; } }
  else if (b.phase === 'launch' || b.phase === 'engage') { r.pedal.depth = Math.max(0, 1 - b.t / (b.phase === 'launch' ? 1.2 : 0.25)); if (r.pedal.depth === 0 && v.clutch.locked) { b.phase = 'run'; b.t = 0; } }
  else if (b.phase === 'run') { const g = r.gate.gear; if (g < n && v.clutch.locked && v.engine.rpm >= r.pts[g - 1]) { b.phase = 'shift'; b.t = 0; r.pedal.depth = 1; raw.throttle = 0; } }
  else if (b.phase === 'shift') { r.pedal.depth = 1; raw.throttle = 0; if (b.t >= 0.08) { requestGear(r, r.gate.gear + 1); b.phase = 'engage'; b.t = 0; } }
}
// the gate, drawn: its slots, the gears at their ends, the knob where it is (a phone drags it; a computer shows it)
function drawGate(r) {
  const el = $('dgate'); if (!r.clutchMode) { el.innerHTML = ''; return; }
  const L = r.gate.layout, X = (x) => (8 + x * 84).toFixed(1), Y = (y) => (8 + y * 84).toFixed(1), k = r.gate.knob;
  // UC-34 1d a shift plate: brushed metal, the slots cut into it (a dark groove with a lit lower lip), and a knob: a polished
  // ball on a leather boot, a black top insert with the gear in the car's orange (AUTHORED, the page's drawing)
  let path = 'M' + X(L.slots[0].x) + ' ' + Y(L.row.mid) + 'H' + X(L.slots[L.slots.length - 1].x);
  for (const q of L.slots) path += 'M' + X(q.x) + ' ' + Y(L.row.top) + 'V' + Y(q.down ? L.row.bottom : L.row.mid);
  let s = '<svg viewBox="0 0 100 100" aria-label="Shift gate: gear ' + (r.gate.gear || 'N') + '"><defs>' +
    '<linearGradient id="gplate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b3f46"/><stop offset=".5" stop-color="#1d2025"/><stop offset="1" stop-color="#2c3036"/></linearGradient>' +
    '<pattern id="gbrush" width="100" height="1.4" patternUnits="userSpaceOnUse"><rect width="100" height=".5" fill="#fff" opacity=".035"/></pattern>' +
    '<radialGradient id="gknob" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".18" stop-color="#d9dde3"/><stop offset=".55" stop-color="#7d838c"/><stop offset="1" stop-color="#2a2d32"/></radialGradient>' +
    '<radialGradient id="gboot" cx=".5" cy=".45" r=".55"><stop offset=".55" stop-color="#121315"/><stop offset="1" stop-color="#050505" stop-opacity="0"/></radialGradient>' +
    '<filter id="gsh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="1" dy="2.2" stdDeviation="1.6" flood-color="#000" flood-opacity=".75"/></filter></defs>' +
    '<rect x="2" y="2" width="96" height="96" rx="12" fill="url(#gplate)"/><rect x="2" y="2" width="96" height="96" rx="12" fill="url(#gbrush)"/>' +
    '<path d="' + path + '" class="lip"/><path d="' + path + '" class="slot"/>';
  for (const q of L.slots) { s += '<text x="' + X(q.x) + '" y="' + (+Y(L.row.top) - 1.5) + '" class="' + (r.gate.gear === q.up ? 'on' : '') + '">' + q.up + '</text>'; if (q.down) s += '<text x="' + X(q.x) + '" y="' + (+Y(L.row.bottom) + 7.5) + '" class="' + (r.gate.gear === q.down ? 'on' : '') + '">' + q.down + '</text>'; }
  const kx = X(k.x), ky = Y(k.y);
  s += '<ellipse cx="' + kx + '" cy="' + (+ky + 2.5) + '" rx="12" ry="10" fill="url(#gboot)"/>' +
    '<g filter="url(#gsh)"><circle cx="' + kx + '" cy="' + ky + '" r="9.5" fill="url(#gknob)"/>' +
    '<circle cx="' + kx + '" cy="' + ky + '" r="5.6" fill="#0b0c0e" stroke="#9aa0a8" stroke-width=".5"/></g>' +
    '<text class="kn" x="' + kx + '" y="' + (+ky + 2.4) + '">' + (r.gate.gear || 'N') + '</text>' +
    '<ellipse cx="' + (+kx - 3) + '" cy="' + (+ky - 4.2) + '" rx="3.2" ry="1.6" fill="#fff" opacity=".55"/></svg>';
  el.innerHTML = s;
}
function drawPedal(r) {                                              // the clutch pedal, as far down as it is (a computer's and a phone's)
  const d = r.clutchMode ? r.pedal.depth : 0;
  for (const el of document.querySelectorAll('.clutchdepth')) el.style.setProperty('--d', d.toFixed(3));
  $('dgasm').style.setProperty('--d', (r.throttle || 0).toFixed(3));                 // the gas meter, right of the clutch (UC-34 1d)
  $('dpedal').setAttribute('aria-valuenow', String(Math.round(d * 100)));
}
// UC-34.1b the mouse pushes the clutch: held anywhere on the strip's picture and pulled down; let go, it springs up
addEventListener('pointerdown', (e) => {
  if (!(mode === 'drag' && race && race.clutchMode) || e.pointerType !== 'mouse' || e.button !== 0) return;
  if (e.target.closest && e.target.closest('button, a, input, #dslip, #dgate, header')) return;
  race.pedal.held = true; race.pedal.anchor = Sim.pedalGrab(race.pedal.depth, e.clientY); e.preventDefault();
});
addEventListener('pointermove', (e) => { if (mode === 'drag' && race && race.clutchMode && race.pedal.held && e.pointerType === 'mouse') race.pedal.depth = Sim.pedalDrag(race.pedal.anchor, e.clientY); });
for (const ev of ['pointerup', 'pointercancel', 'blur']) addEventListener(ev, (e) => { if (race && race.pedal && (ev === 'blur' || e.pointerType === 'mouse')) race.pedal.held = false; });
// UC-34.1c a phone's clutch: a slider on the left beside the gas, held where the finger is, springing up when it lifts
{ const sl = $('dslider');
  const at = (e) => { const b = sl.getBoundingClientRect(); race.pedal.depth = Sim.sliderDepth(e.clientY, b.top, b.bottom); };
  sl.addEventListener('pointerdown', (e) => { if (!(race && race.clutchMode)) return; e.preventDefault(); sl.setPointerCapture(e.pointerId); race.pedal.held = true; at(e); });
  sl.addEventListener('pointermove', (e) => { if (race && race.clutchMode && race.pedal.held) at(e); });
  for (const ev of ['pointerup', 'pointercancel']) sl.addEventListener(ev, () => { if (race && race.pedal) race.pedal.held = false; }); }
// UC-34.1 a phone's gate: the knob dragged along the slots; a gear the gearbox refuses leaves it where it was
{ const gt = $('dgate'); let dragging = false;
  const at = (e) => { const b = gt.getBoundingClientRect(), r = race, want = { x: ((e.clientX - b.left) / b.width * 100 - 8) / 84, y: ((e.clientY - b.top) / b.height * 100 - 8) / 84 };
    r.gate.knob = Sim.moveKnob(r.gate.knob, want, r.gate.layout); const g = Sim.gearAt(r.gate.knob, r.gate.layout);
    if (g !== r.gate.gear && (g !== 0 || Math.abs(r.gate.knob.y - r.gate.layout.row.mid) < 0.02)) { if (!requestGear(r, g)) dragging = false; } drawGate(r); };
  gt.addEventListener('pointerdown', (e) => { if (!(race && race.clutchMode) || race.run.done) return; e.preventDefault(); gt.setPointerCapture(e.pointerId); dragging = true; at(e); });
  gt.addEventListener('pointermove', (e) => { if (dragging) at(e); });
  for (const ev of ['pointerup', 'pointercancel']) gt.addEventListener(ev, () => { dragging = false; if (race && race.gate) { race.gate.knob = Sim.knobFor(race.gate.gear, race.gate.layout); drawGate(race); } }); }
function syncDragBox() { $('dbox').textContent = DRAGBOX.clutch ? 'Clutch on' : 'Clutch off'; $('dbox').setAttribute('aria-pressed', String(DRAGBOX.clutch)); }
function toggleDragBox() { DRAGBOX.clutch = !DRAGBOX.clutch; try { localStorage.setItem('hoc.gearbox', DRAGBOX.clutch ? 'clutch' : 'paddles'); } catch (e) { /* not kept */ } syncDragBox(); dragRerun(); }   // a new run with the other gearbox
$('dbox').addEventListener('click', toggleDragBox); syncDragBox(); $('dagain').addEventListener('click', () => dragRerun());
window.HOC.dragBox = DRAGBOX;
window.HOC.audio = audio;                                                     // the page check: the stick's sounds loaded (UC-34 4b)
function dragRerun() { if (race && race.kind === 'drag') startDrag(race.entry).catch((e) => reportError(e)); }
function fmt(s, d = 3) { return s === null || s === undefined ? '--' : s.toFixed(d); }
function tickDrag(dt) {
  const r = race, v = r.v, c = v.cfg, run = r.run;
  const raw = readInput();
  // the pad's shift buttons, edges only: RB up, Y down (no Unreal binding: the page's own)
  const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected && p.mapping === 'standard') : null;
  if (pad) { for (const [b, dir] of [[5, 'up'], [3, 'down']]) { const d = !!(pad.buttons[b] && pad.buttons[b].pressed); if (d && !r.padPrev[b]) dragPress(dir); r.padPrev[b] = d; } }
  const finished = run.done;
  if (r.bot && !r.clutchMode && run.green !== null && !finished) { raw.throttle = 1; const gg = v.trans.target; if (gg >= 1 && gg < c.trans.forward.length && v.trans.current === gg && v.trans.engineRPM >= r.pts[gg - 1] && !r.presses.length) dragPress('up'); }
  if (r.clutchMode) {                                                  // UC-34: the pedal springs up when let go; the bot drives it
    if (r.bot && !finished) botClutch(r, raw, dt); else if (!r.pedal.held) r.pedal.depth = Sim.pedalRelease(r.pedal.depth, dt);
    if (finished) r.pedal.depth = 1;                                   // past the line the clutch goes in: it coasts, it cannot stall
    if (r.pedal.depth >= 0.5 && r.pedal.prev < 0.5 && r.gate.gear >= 1) r.cut = { gear: r.gate.gear, rpm: v.engine.rpm };   // the drive cut: the shift's rpm
    if (r.pedal.depth >= 0.98 && r.pedal.prev < 0.98 && !finished) sfx(audio, 'clutch_floor', 0.45, 0.7);   // UC-34 4b the pedal at the floor
    r.pedal.prev = r.pedal.depth; drawPedal(r);
    if (v.stalled && !r.stallShown) { r.stallShown = true; gradePop('STALLED', 'late'); $('dagain').hidden = false; blip(audio, 'count'); }   // UC-34.3a a lost run
  }
  // past the line the car shuts down: off the gas, coasting on its own READ idle brake and engine braking, and only below 30 km/h
  // the brake (AUTHORED): a brake press at speed is a FULL brake in Unreal's reverse-as-brake model, the wheels locked (no ABS) and
  // the tyre smoke filled the screen (11-06)
  const shut = finished && v.forwardSpeedCmS * 0.036 < 30;
  const input = { throttle: finished ? 0 : raw.throttle, brake: finished ? (shut ? 1 : 0) : raw.brake, steering: raw.steering, handbrake: 0, transmission: 'manual' };
  if (r.clutchMode) { input.clutch = r.pedal.depth; input.gear = r.gate.gear; }   // UC-34 (chaos_vehicle.js A11)
  acc += Math.min(dt, 0.1);
  while (acc >= STEP) {
    const p = r.presses.shift(), gear = v.trans.target, rpm = v.trans.engineRPM;
    if (p === 'up' && gear >= 1 && gear < c.trans.forward.length) { gradeShift(r, gear, rpm); sfx(audio, 'gear_in_' + (1 + Math.floor(Math.random() * 3)), 0.7); }
    Chaos.stepVehicle(v, Object.assign({}, input, { gearUp: p === 'up', gearDown: p === 'down' }), STEP, r.strip);
    const ev = Drag.tick(run, { dt: STEP, distM: (v.pos[0] - r.x0) / 100, speedKmh: v.forwardSpeedCmS * 0.036, rpm: v.trans.engineRPM, gear: v.trans.target, maxRPM: c.engine.maxRPM });
    for (const e of ev) {
      if (e === 'green') blip(audio, 'go');
      if (e === 'red') blip(audio, 'count');
    }
    r.now += STEP; acc -= STEP;
  }
  // the tree
  const T = run.tree;
  setLamp(dragView, 'prestage', T.prestage); setLamp(dragView, 'stage', T.stage);
  setLamp(dragView, 'a1', T.ambers >= 1 && !T.green); setLamp(dragView, 'a2', T.ambers >= 2 && !T.green); setLamp(dragView, 'a3', T.ambers >= 3 && !T.green);
  setLamp(dragView, 'green', T.green); setLamp(dragView, 'red', T.red);
  document.querySelectorAll('#dtree i').forEach((el) => { const k = el.dataset.l; el.classList.toggle('on', k === 'prestage' ? T.prestage : k === 'stage' ? T.stage : k === 'green' ? T.green : k === 'red' ? T.red : T.ambers >= +k.slice(1) && !T.green); });
  // the times as they come
  const s = Drag.slip(run);
  const val = { rt: s.reaction_s, sixty: s.sixty_s, kmh100: s.kmh100_s, eighth: s.eighth_s, quarter: s.quarter_s };
  for (const [k] of dragTimeRows) { const el = document.querySelector('#dtimes [data-k="' + k + '"] b'); const t = val[k]; el.textContent = t === null || t === undefined ? '--' : (k === 'rt' && t >= 0 ? '+' : '') + t.toFixed(3); el.parentNode.classList.toggle('foul', k === 'rt' && run.foul); }
  // the car, the camera, the sun
  const [X, Y, Z] = carAxes(v);
  r.car.group.matrix.fromArray(threeMatrixFromAxes([X, Y, Z], [1, 1, 1], v.pos));
  r.car.wheels.forEach((w, i) => { if (w) { const ws = v.wheels[i]; poseWheel(w, ws.steerDeg, ws.spinRad, ws.suspensionOffsetCm); } });
  if (r.opp) placeOpponent(r);                                          // UC-38
  const cam = r.camera, rig = updateRig(r.rig, v.pos, [X, Y, Z], dt);     // the chase rig runs either way, so C switches back to it settled
  const sf = stepSpeedFx(r.speedfx || (r.speedfx = makeSpeedFx()), v.forwardSpeedCmS * 0.036, dt, MOTION.on);   // UC-33.1 / 33.4
  const B = r.body, centre = [0, 1, 2].map((k) => v.pos[k] + X[k] * B.origin[0] + Y[k] * B.origin[1] + Z[k] * B.origin[2]);
  stepDirector(r.director, { left: run.leave !== null, distM: (v.pos[0] - r.x0) / 100, carX: centre[0], quarterX: Drag.MARKS.quarter * 100 }, dt);   // UC-35.1-4
  r.shot = DRAGCAM.film ? shotId(r.director) : 'chase';
  if (DRAGCAM.film) {
    const f = framing(r.director, { c: centre, len: B.box_extent[0] * 2, halfWidth: B.box_extent[1], height: B.box_extent[2] * 2 }, { laneY: DRAG_LANE_Y_CM, quarterX: Drag.MARKS.quarter * 100, aspect: cam.aspect,
      other: r.opp && r.opp.centre ? { c: r.opp.centre, len: B.box_extent[0] * 2, halfWidth: B.box_extent[1], height: B.box_extent[2] * 2 } : undefined });   // UC-38.3: both cars while near
    cam.position.fromArray(toThreePoint(f.eye)); cam.up.set(0, 1, 0); cam.lookAt(...toThreePoint(f.look));
    cam.fov = verticalFor(f.hfovDeg + (f.mounted ? sf.fovDeg : 0), cam.aspect);   // UC-35.3b: a camera riding with the car widens and shakes with it
    if (f.mounted) { cam.rotateX(sf.pitchDeg * DEG); cam.rotateZ(sf.rollDeg * DEG); cam.rotateY(sf.yawDeg * DEG); }
  } else {
    cam.position.fromArray(toThreePoint(rig.eye)); cam.up.set(0, 1, 0); cam.lookAt(...toThreePoint(rig.look));
    cam.fov = verticalFovDeg(r.fov + sf.fovDeg, cam.aspect); cam.rotateX(sf.pitchDeg * DEG); cam.rotateZ(sf.rollDeg * DEG); cam.rotateY(sf.yawDeg * DEG);
  }
  cam.updateProjectionMatrix();
  $('drag').classList.toggle('running', run.leave !== null);   // UC-35.6: the tree steps back once the car has left
  const cp = toThreePoint(v.pos);
  trackView.sky.position.copy(cam.position);
  trackView.sun.target.position.set(cp[0], cp[1], cp[2]);
  trackView.sun.position.set(cp[0] - trackView.sunDir[0] * 1.5, cp[1] - trackView.sunDir[1] * 1.5, cp[2] - trackView.sunDir[2] * 1.5);
  // the cluster: speed, gear, tach, and the shift light for the gear the car is in
  $('speed').textContent = Rules.speedText(v.forwardSpeedCmS, RULES); $('unit').textContent = RULES.speed.unit;
  $('gear').textContent = Rules.gearText(v.gear, RULES);
  updateTach(r.tach, v.engineRPM);
  if (r.cluster) updateCluster(r);                                      // UC-36
  const g = v.trans.target, sl = g >= 1 && g < c.trans.forward.length ? Drag.shiftLight(v.engineRPM, r.pts[g - 1]) : { fill: 0, shift: false };
  const leds = document.querySelectorAll('#dleds i'), lit = Math.round(sl.fill * leds.length);
  leds.forEach((el, i) => { el.classList.toggle('on', i < lit); el.classList.toggle('flash', sl.shift); });
  $('hud-speed').querySelector('#shift').classList.toggle('on', sl.shift);
  // the slip, once, at the line
  // filmed, it waits for the finish camera to see the car through the line and past it (about a second, UC-35.4)
  if (run.done && !r.slipShown && (!DRAGCAM.film || r.shot === 'roll')) { r.slipShown = true; showDragSlip(r); }
  laySkids(trackView.skids, v, Y, r.wheelWidths, dt);
  r.throttle += (input.throttle - r.throttle) * Math.min(1, dt * 8);
  const slide = v.wheels.reduce((a, w) => a + slideAmount(w), 0) / v.wheels.length;
  driveSound(audio, { rpm: v.engineRPM, throttle: r.throttle, speedCmS: v.forwardSpeedCmS, slide, gear: v.gear, running: true });
  r.post.render();
}
// UC-38 the other lane's car at the run's clock: between the two recorded poses either side of it (positions blended, the axes and
// the wheels the nearer one's), moved to the other lane; the last pose once the recording ends
function placeOpponent(r) {
  const o = r.opp, rec = o.rec, t = r.run.t;
  while (o.i < rec.length - 2 && rec[o.i + 1].t <= t) o.i++;
  const a = rec[o.i], b = rec[Math.min(o.i + 1, rec.length - 1)], u = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0, n = u < 0.5 ? a : b;
  const pos = [0, 1, 2].map((k) => a.pos[k] + (b.pos[k] - a.pos[k]) * u + (k === 1 ? o.laneShift : 0));
  o.car.group.matrix.fromArray(threeMatrixFromAxes(n.axes, [1, 1, 1], pos));
  o.car.wheels.forEach((w, i) => { if (w) poseWheel(w, n.w[i][0], n.w[i][1], n.w[i][2]); });
  const B = r.body, X = n.axes[0], Y = n.axes[1], Z = n.axes[2];
  o.centre = [0, 1, 2].map((k) => pos[k] + X[k] * B.origin[0] + Y[k] * B.origin[1] + Z[k] * B.origin[2]);
}
// UC-36 the car's own cluster (data/clusters.json: its facts READ, its drawing the page's): built at the start, its red band from the car's
// own derived shift points where its redline was not read, the Power Reserve the share of the power not in use (gauges.js)
let CLUSTERS = null;
async function buildCluster(entry, v, pts) {
  if (!CLUSTERS) CLUSTERS = (await fetchJson('clusters.json')).cars;
  const src = entry.sim && CLUSTERS[entry.name], el = $('dcluster');
  document.body.classList.toggle('hascluster', !!src);
  if (!src) { el.innerHTML = ''; return null; }
  const spec = JSON.parse(JSON.stringify(src));
  for (const d of spec.dials) if (d.red_from === 'derived') d.red_from = Math.min(...pts);
  el.innerHTML = clusterSVG(spec, 'c' + entry.name.length);
  el.title = 'Drawn after this car\'s own cluster. Read from: ' + spec.read_from.join(' ; ') + '. The page\'s own: ' + spec.authored.join(' ; ');
  requestAnimationFrame(() => document.body.style.setProperty('--clh', Math.round(el.getBoundingClientRect().height) + 'px'));
  return { spec, b: bindCluster(el, spec) };
}
addEventListener('resize', () => { const el = document.getElementById('dcluster'); if (el && el.firstChild) document.body.style.setProperty('--clh', Math.round(el.getBoundingClientRect().height) + 'px'); });
function updateCluster(r) {
  const v = r.v, kmh = v.forwardSpeedCmS * 0.036, run = r.run, cl = r.cluster;
  const st = { rpm: v.engineRPM, speed: Math.max(0, kmh), speed_mph: Math.max(0, kmh) / 1.609344, reserve: 100 * powerReserve(v.engine.throttle, v.engine.started) };
  const et = run.leave === null ? 0 : run.done ? run.marks.quarter : run.t - run.leave, gear = Rules.gearText(v.gear, RULES), now = new Date();
  for (const t of cl.spec.texts || []) {
    const f = t.fmt;
    if (f === 'speed') st['text:' + t.id] = String(Math.round(Math.max(0, cl.spec.dials.some((d) => d.id === 'speed_mph') ? st.speed_mph : kmh)));
    else if (f === 'gear') st['text:' + t.id] = gear;
    else if (f === 'gear_s') st['text:' + t.id] = (/^\d/.test(gear) ? 'S ' : '') + gear;
    else if (f === 'time') st['text:' + t.id] = et.toFixed(3);
    else if (f === 'clock') st['text:' + t.id] = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }
  cl.b.update(st);
}
// UC-23.3 the slip sells: this car's own listing (price, kilometres, where it is) and your best quarter mile in every car on the lot,
// ranked, each one a race away. The bests are this device's own (localStorage), as the lap record (hud.js readRecord)
const DRAG_BEST = (k) => 'hoc.drag.best.' + k;
function readDragBest(k) { try { const v = localStorage.getItem(DRAG_BEST(k)); return v === null ? null : +v; } catch (e) { return null; } }
function writeDragBest(k, t) { try { const b = readDragBest(k); if (b === null || t < b) { localStorage.setItem(DRAG_BEST(k), String(t)); return true; } } catch (e) { /* a private window keeps none */ } return false; }
function sellHTML(r, s) {
  const key = r.entry.name, L = LISTINGS.cars.find((c) => c.key === key);
  const isBest = !s.foul && s.quarter_s !== null && writeDragBest(key, s.quarter_s);
  const cars = LOT_CARS.filter((c) => SIMS.has(c.key) && modelOf(c.key));
  const board = cars.map((c) => ({ c, t: readDragBest(c.key) })).sort((a, b) => (a.t === null) - (b.t === null) || (a.t || 0) - (b.t || 0));
  const listing = L ? '<div class="sellbox"><div><p class="kick">This car is for sale</p><b>' + esc(V(L.price) !== null ? money(V(L.price), V(L.currency)) : 'Price not listed') + '</b>' +
    (V(L.km) !== null ? ' · ' + esc(V(L.km).toLocaleString('en-CA')) + ' km' : '') + (V(L.store) ? ' · ' + esc(V(L.store)) : '') + '</div>' +
    '<div class="acts"><a class="act go" href="' + esc(L.url) + '" target="_blank" rel="noopener">See it at House of Cars</a><a class="act" href="details.html#car=' + esc(key) + '">Full details</a></div></div>' : '';
  const rows = board.map((x, i) => '<li class="' + (x.c.key === key ? 'me' : '') + '"><span class="n">' + (x.t === null ? '-' : i + 1) + '</span><span class="nm">' + esc(x.c.title) + '</span>' +
    '<b>' + (x.t === null ? 'not run yet' : x.t.toFixed(3) + ' s') + '</b>' + (x.c.key === key ? '' : '<button class="act" data-dragto="' + esc(x.c.key) + '">Race it</button>') + '</li>').join('');
  return (isBest ? '<p class="newbest">Your best in this car</p>' : '') + listing + '<p class="kick">Your quarter mile, every car on the lot</p><ol class="board">' + rows + '</ol>';
}
// UC-23.2 how near the sim car is to the real one: fitted to its owners' Dragy runs (tools/drag_fit.mjs), or why it is not
function fitHTML(r) {
  const f = r.carJson && r.carJson.drag_fit;
  if (!f) return '<p class="fit">This car is not fitted to its owners&#39; runs: it is the sim car as built.</p>';
  if (!f.fitted) return '<p class="fit">Not fitted to its owners&#39; runs: ' + esc(f.why.replace(/^not fitted: /, '')) + '. Its driveline and tyres are the template&#39;s.</p>';
  if (f.accepted === false) return '<p class="fit"><b>Fit rejected:</b> ' + esc(f.why.replace(/^fit rejected: /, '')) + '. The real car runs slower than this sim one; the owners&#39; times beside it show by how much.</p>';
  const res = f.residuals.map((x) => { const kmh = /km\/h/.test(x.name); return esc(x.name.replace(/ \(.*\)/, '')) + ' ' + (x.off >= 0 ? '+' : '') + x.off.toFixed(kmh ? 1 : 2) + (kmh ? ' km/h' : ' s'); }).join(', ');
  return '<p class="fit">Sim fitted to its owners&#39; Dragy runs: driveline efficiency ' + f.best.efficiency + ', tyre grip x' + f.best.friction + ' (off by ' + res + ')' +
    (f.near_bound && (f.near_bound.efficiency || f.near_bound.friction) ? '. <b>Near the edge of the search:</b> the fit stretches a stand-in to cover something the sim lacks' : '') + '.</p>';
}
function showDragSlip(r) {
  const s = Drag.slip(r.run), b = r.best.slip;
  const dg = DRAGY.cars[r.entry.name], q = dg && dg.tests['1/4 mile'], e8 = dg && dg.tests['1/8 mile'], z = dg && dg.tests['0-100 km/h'];
  const own = (rec) => rec && rec.kind === 'READ' ? (rec.no_mods_listed || rec.all) : null;
  const ownQ = own(q), own8 = own(e8), ownZ = own(z);
  const row = (label, you, sim, owners) => '<tr><th>' + label + '</th><td>' + you + '</td><td>' + sim + '</td><td>' + owners + '</td></tr>';
  const kmh = (x) => (x === null || x === undefined ? '' : ' @ ' + Math.round(x) + ' km/h');
  const grades = s.shifts.map((x) => '<span class="g-' + x.grade.toLowerCase() + '">' + x.from + '→' + (x.from + 1) + ' ' + x.grade.toLowerCase() + '</span>').join('');
  $('dslip').innerHTML = '<p class="kick">Time slip</p><h3>' + esc($('dcar').textContent) + '</h3>' +
    (s.foul ? '<p class="foul">RED LIGHT: left ' + fmt(-s.reaction_s) + ' s before the green</p>' : '') +
    '<table><tr><th></th><td>You</td><td>Sim, best shifts</td><td>Dragy owners</td></tr>' +
    row('Reaction', s.reaction_s === null ? '--' : (s.reaction_s >= 0 ? '+' : '') + fmt(s.reaction_s), fmt(b.reaction_s), '') +
    row('60 ft', fmt(s.sixty_s), fmt(b.sixty_s), '') +
    row('0-100 km/h', fmt(s.kmh100_standing_s, 2), fmt(b.kmh100_standing_s, 2), ownZ ? fmt(ownZ.median_s, 2) : '--') +   // from a standstill, as Dragy's board times it
    row('1/8 mile', fmt(s.eighth_s) + kmh(s.eighth_kmh), fmt(b.eighth_s) + kmh(b.eighth_kmh), own8 ? fmt(own8.median_s, 2) + kmh(own8.median_trap_kmh) : '--') +
    row('1/4 mile', fmt(s.quarter_s) + kmh(s.quarter_kmh), fmt(b.quarter_s) + kmh(b.quarter_kmh), ownQ ? fmt(ownQ.median_s, 2) + kmh(ownQ.median_trap_kmh) : '--') + '</table>' +
    '<div class="grades">' + (grades || '<span>no shifts</span>') + '</div>' +
    '<div id="dboard"></div>' +
    '<p class="dimp">Sim: the same car and physics, every shift at its best point (from the car\'s own torque curve and gear ratios). Dragy owners: the median of the runs ' +
    'Dragy users uploaded that list no mods' + (dg ? ' (<a href="' + esc(dg.board) + '" target="_blank" rel="noopener">their leaderboard</a>)' : '') + '. 0-100 from a standstill, as Dragy times it; 60 ft, 1/8 and 1/4 from 1 ft of roll-out, as a strip times them (Dragy does not say which its 1/4 uses).</p>' +
    fitHTML(r) +
    sellHTML(r, s) +
    '<div class="acts"><button class="act go" id="drerun">Run again (R)</button><button class="act" id="dlot">Back to the lot (Esc)</button></div>';
  $('dslip').hidden = false;
  $('drerun').onclick = dragRerun; $('dlot').onclick = () => backToShowroom();
  $('dslip').querySelectorAll('button[data-dragto]').forEach((b) => { b.onclick = () => startDrag({ name: b.dataset.dragto, sim: true, drivable: true }).catch((e) => reportError(e)); });   // UC-23.3
  quarterBoard(r, s);
}
// UC-25 this car's quarter-mile board, shared by everyone (scores.js): R.J.Thompson's house run first, then the names people save.
// A board that cannot be reached says so and keeps the run nowhere else (UC-25.3a); a red light never goes on it (UC-25.1a)
function quarterBoard(r, s) {
  const run = r.run, id = 'drag.' + r.entry.name, el = $('dboard');
  const house = { name: HOUSE_NAME, score: r.house.slip.quarter_s, kmh: r.house.slip.quarter_kmh, at: '' };
  const fmt = (x) => x.score.toFixed(3) + ' s' + (x.kmh ? ' @ ' + Math.round(x.kmh) + ' km/h' : '');
  const show = (rows, mine) => { $('dbrows').innerHTML = boardHTML(ranked(rows, house, true), fmt, mine); };
  const live = () => race === r && r.run === run;       // the slip still shows this run (not a rerun or another car)
  el.innerHTML = '<p class="kick">Quarter-mile board: everyone in this car</p><div id="dbrows"></div>' +
    '<form id="dbform" hidden><label for="dbname">Your name for the board</label><div><input id="dbname" maxlength="16" autocomplete="nickname" spellcheck="false"><button class="act go" type="submit">Save</button></div></form><p id="dbmsg" aria-live="polite">Reading the board…</p>';
  show([]);
  const msg = (t) => { $('dbmsg').textContent = t; };
  SCORES.top(id).then((rows) => {
    if (!live()) return;
    show(rows);
    if (s.foul || s.quarter_s === null) { msg(s.foul ? 'A red light does not go on the board.' : ''); return; }
    if (!qualifies(rows, house, true, s.quarter_s)) { msg(s.quarter_s < house.score ? '' : 'Beat ' + HOUSE_NAME + '’s ' + house.score.toFixed(3) + ' s: every shift on the light.'); return; }
    msg('You made the top ten.'); $('dbform').hidden = false;
    const box = $('dbname'); box.value = lastName(); box.focus(); box.select();
    $('dbform').onsubmit = (e) => {
      e.preventDefault();
      const c = checkName(box.value); if (!c.ok) { msg(c.why); return; }
      const entry = { name: c.name, score: Math.round(s.quarter_s * 1000) / 1000, kmh: Math.round(s.quarter_kmh * 10) / 10, at: new Date().toISOString() };
      $('dbform').hidden = true; msg('Saving…');
      SCORES.submit(id, entry).then((after) => { if (!live()) return; keepName(c.name); show(after, entry); msg('Saved. You are on the board.'); },
        (err) => { if (!live()) return; $('dbform').hidden = false; msg(err.message + '. Not saved: try again.'); });
    };
  }, (e) => { if (live()) msg(e.message + '. Your run is not on it.'); });
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
  const l = LISTINGS.cars.find((c) => c.key === name), m = modelOf(name);
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
  if (race && race.camera) { race.camera.aspect = innerWidth / innerHeight; }   // a race being built has no camera yet (the loading screen may be up)
}
addEventListener('resize', resize); resize();
select(0);
// UC-11.1: a link to one car opens the lot on it; a car no longer listed opens 'For sale now' and says so (UC-11.1a). Also when
// the page is already open and only the link's #car= changes (a second QR scan in the same tab): select() itself rewrites the
// hash with replaceState, which fires no hashchange, so this follows only links from outside
function openCarLink(hash) {
  const m = /^#car=([\w-]+)(&drag)?$/.exec(hash);
  if (!m) return;
  if (m[2] && SIMS.has(m[1]) && modelOf(m[1])) { startDrag({ name: m[1], sim: true, drivable: true }).catch((e) => reportError(e)); return; }   // UC-23.1
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
await warmLot();                                         // UC-30: behind the loading screen
mark('lot warmed');
loadingDone().then(() => { mark('lot open'); modelQ.open = true; pumpModels(); if (BACKEND !== 'WebGPU') gpuNotice().catch((e) => reportError(e)); if (onLot) window.dispatchEvent(new CustomEvent('hoc:lot-open')); });   // the sales chat (sales_chat.js) greets once the lot is open (a race or the strip opened by a link: when the visitor reaches the lot)   // UC-20.3: closes now, or when a player says; UC-31 then the notice, once the lot is in view
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
  if (mode === 'show') { padShow(); tickShow(dt); } else if (mode === 'walk') tickWalk(dt); else if (mode === 'drag') tickDrag(dt); else tickRace(dt);
  while (perfFirst.length) mark('first frame drawn with', perfFirst.shift() + ' (' + Math.round(performance.now() - t) + ' ms frame)');
  if (photoReq) takePicture();
  adapt(dt);
});
