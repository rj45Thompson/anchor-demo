// app.js - House of Cars: the showroom (a ring of slides you fly between, like the site's 3D fly-through) and the Time Trial lap,
// drawn with three.js WebGPURenderer (WebGPU, or its WebGL 2 backend where WebGPU is absent). Everything it shows about a car or the
// track is READ out of Unreal (data/*.json, built by tools/build_site.py); the physics is the Chaos port (chaos_vehicle.js), the
// rules are the Time Trial Blueprints' port (rules.js), the world is the landscape + road read from the level (world.js).
// Serves UC-1.1..1.4, UC-1.1a, UC-1.2a, UC-2.1..2.5, UC-2.2a (D:/_houseofcars/USE_CASES.md).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as Rules from './rules.js';
import { loadWorld } from './world.js';
import { rotatorAxes, threeMatrix, threeMatrixFromAxes, toThreePoint, toThreeDir, verticalFovDeg } from './ue_space.js';
import { makeRig, updateRig } from './camera_rig.js';
import { SLIDES } from './slides.js';
import { svgIcon, drawIcon } from './icons.js';
import { studioEnvironment, upgradePaint, polishedTops, glowMaterial, makePost, physicalSky, skyEnv, setPaint, paint, groundDetail, lightBeam, asphaltRoad, concreteWall, contactShadow, showroomFloor, plinthMaterial } from './fx.js';
import { freeRects, fitSubject, mergeGroups, FRAME } from './lot_frame.js';            // UC-44.3: the subject framed where the panels leave room
import { focusWeight, level, LIGHT } from './lot_light.js';                             // UC-44.3: the light follows the slide in view
import { buildRain, wetRoad, sunTracker, overcast, buildShafts } from './weather.js';        // UC-40: rain, a wet road, a grey sky, the strip's shafts (the circuit's: fx.js makePost)
import { makeAudio, driveSound, silence, blip, loadSfx, sfx, grind, crack } from './audio.js';
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
import * as Sim from './drag_sim.js';
import { pickRival, rivalLine, leader, SHORT, SAY_S, DRIVERS } from './rivals.js';             // UC-38 the rival in the other lane                                                       // UC-34: the clutch pedal, the H gate
import { clusterSVG, bindCluster, powerReserve } from './gauges.js';                          // UC-36: each car's own cluster
import { buildScenery } from './scenery.js';
import { traction } from './traction.js';                                                    // UC-39: the launch read off the tyres                                                  // UC-37.4: grass, trees and hills past the walls
import { knowHTML, knownSpecsHTML } from './know.js';                                                   // UC-14: Know this car (know.js)                  // the page's own driver (UC-9.2): the sim's ghosts, and the page check's lap
import { dragyHUD } from './dragstats.js';                                                  // UC-21: Dragy owners' runs (dragstats.js)
import { ScoreBoard, HOUSE_NAME, checkName, checkEmail, ranked, qualifies, boardHTML, lastName, keepName } from './scores.js';   // UC-25: the shared boards
import * as Replay from './drag_replay.js';                                 // UC-46: a drag run's inputs step by step, so a first place can be run again before its coffee (tools/verify_claim.mjs)
import { mark, timed, ResolutionGovernor } from './perf.js';                                                   // UC-30: ?perf logs where the time goes
import { batchStatic } from './batch.js';                                                  // GFX 11-08: a car's meshes drawn one draw per material (batch.js)
import { makeLotFocus } from './lot_focus.js';                                             // GFX 11-08: the tops' reflection draws only the slides near the one in view
import { KICK, makeKick, stepKick, kickLens, frameAccel, buildSmoke, emitSmoke, haloMaterial, haloLook, raceResult, verdictWords, FINISH } from './drag_fx.js';   // UC-44.4 / 44.5 the run's drama, read off the sim
import { warmSlices, warmSteps, drawnInEveryPass } from './warm.js';                                  // UC-44.2: shaders built before they are seen (warm.js)
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
// the panels are drawn once, so the face is awaited before the first one (UC-44.1: asked for now, awaited at the stands; until then the
// renderer starts and the data arrives instead of waiting on the font)
const fontsReady = Promise.all(['800 88px "Open Sans"', '700 32px "Open Sans"', '600 40px "Open Sans"'].map((f) => document.fonts.load(f)));
const jsonCache = new Map();                            // each data file is fetched once (the track preloads them behind the lot)
const fetchJson = (f) => {
  if (!jsonCache.has(f)) jsonCache.set(f, fetch('data/' + f).then((r) => { if (!r.ok) throw new Error('data/' + f + ': ' + r.status); return r.json(); }));
  return jsonCache.get(f);
};
// UC-44.1 every data file the lot awaits below, asked for at once, now: the lot used to ask in four rounds, each after the one before
// had arrived and after the renderer had started (on a 70 ms line, four round trips in a row). The same promises are awaited below
for (const f of ['showroom.json', 'track.json', 'timetrial_rules.json', 'camera.json', 'input.json', 'listings.json', 'models.json', 'glb_bytes.json', 'ghosts/index.json',
  'scores.json', 'sale_specs.json', 'reviews.json', 'recalls.json', 'colours.json', 'photos.json', 'dragy.json']) fetchJson(f);
const fetchBin = (f) => fetch('data/' + f).then((r) => { if (!r.ok) throw new Error('data/' + f + ': ' + r.status); return r.arrayBuffer(); });
const canvas = $('view');
const loader = new GLTFLoader();
const glbCache = new Map();
const prog = new Map();                          // UC-4.2b: the loading bar shows real bytes, per file, as they arrive
// UC-20 against each model's own size (data/glb_bytes.json, tools/glb_sizes.py): GitHub Pages sends models gzipped, and a progress
// event counts the unpacked bytes loaded against the packed length, so the bar passed 100 % (READ 11-07: the i8's 6.1 MB as 4.4)
let GLB_BYTES = null;
// UC-48 the load as the screen tells it (the owner 11-09: "a freeze on iPhone, lag at 100 percent", "more loading stats"). The bar
// was the bytes alone, so it sat at 100 % while the lot was still being built and its shaders prepared, the longest part on a phone.
// Now the bytes fill DL_SHARE of it and the build's own steps the rest (loadStage), so 100 % is the lot ready; under it, the line's
// speed and the time left while bytes come (DERIVED from the bytes of the last 2 s), then the stage and its count
const DL_SHARE = 0.8;                                    // AUTHORED: the bytes' share of the bar; the build's steps fill the rest
const LOAD = { samples: [], stage: null, done: 0, total: 0 };
const STAGE = { build: 'Building the lot', warm: 'Preparing the paint and the light', gpu: 'The graphics card is finishing the shaders', open: '' };
function loadStage(stage, done = 0, total = 0) {
  if (!(stage in STAGE)) throw new Error('loadStage: no stage ' + stage);
  LOAD.stage = stage; LOAD.done = done; LOAD.total = total; showProgress();
}
function showProgress() {
  let l = 0, t = 0;
  for (const v of prog.values()) { l += v.l; t += v.t; }
  const bar = document.querySelector('#bar i');
  if (!bar || !t) return;
  const now = performance.now(), S = LOAD.samples;
  S.push([now, l]); while (S.length > 2 && now - S[0][0] > 2000) S.shift();
  // the lot's first load splits the bar; once the lot is open, a later load (the track, the strip) is its bytes alone, as before
  const lot = LOAD.stage !== 'open', dl = l / t, build = LOAD.total ? LOAD.done / LOAD.total : 0, frac = lot ? DL_SHARE * dl + (1 - DL_SHARE) * build : dl;
  bar.style.width = (100 * frac).toFixed(0) + '%';
  $('lmb').textContent = Math.floor(100 * frac) + ' % · ' + (l / 1e6).toFixed(1) + ' / ' + (t / 1e6).toFixed(1) + ' MB';
  const rate = now > S[0][0] ? (l - S[0][1]) / ((now - S[0][0]) / 1000) : 0;   // bytes a second, the last 2 s
  $('lstat').textContent = dl < 1 ? (rate > 0 ? 'Downloading the 3D models · ' + (rate / 1e6).toFixed(1) + ' MB/s · about ' + Math.max(1, Math.ceil((t - l) / rate)) + ' s left' : 'Downloading the 3D models…')
    : lot && LOAD.stage ? STAGE[LOAD.stage] + (LOAD.stage === 'warm' ? ': ' + LOAD.done + ' of ' + (LOAD.total - 1) : '') + '…' : '';
}
// UC-44.1 a model's bytes and its unpacking are two steps: a car for sale comes down the line while the lot warms up, and is unpacked
// (GLTFLoader.parse, on the main thread: up to 250 ms a car on the desktop profile, MEASURED 11-08 in ?perf's long animation frames)
// only when its turn to join comes, after the lot has opened. bar: whether its bytes count on the loading screen's bar (the lot's own
// cars do, the cars for sale fetched behind it do not: the lot does not wait for them)
const bytesCache = new Map();
function glbBytes(url, bar = true) {
  const size = GLB_BYTES[url];
  if (size === undefined) throw new Error(url + ' is not in data/glb_bytes.json: run py tools/glb_sizes.py');
  if (!bytesCache.has(url)) {
    mark('glb asked', url);
    bytesCache.set(url, fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      const reader = r.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        if (bar) { prog.set(url, { l: got, t: size }); showProgress(); }   // UC-4.2b: unpacked bytes against the unpacked size, as before
      }
      const buf = new Uint8Array(got);
      for (let o = 0, k = 0; k < parts.length; o += parts[k].length, k++) buf.set(parts[k], o);
      mark('glb fetched', url);
      return buf.buffer;
    }));
  }
  return bytesCache.get(url);
}
const loadGlb = (url) => {
  if (!glbCache.has(url)) glbCache.set(url, glbBytes(url).then((b) => loader.parseAsync(b, url.slice(0, url.lastIndexOf('/') + 1))).then((g) => { mark('glb parsed', url); upgradePaint(g.scene); return g; }));
  return glbCache.get(url);
};
const meshUrl = (assetPath) => 'data/meshes/' + assetPath.split('/').pop().split('.').pop() + '.glb';   // "/Game/X/SM_A.SM_A" or "/Game/X/SM_A"
// UC-44.1 the lot's own cars' parts (the 'car' slides of slides.js, their parts in showroom.json): their bytes are asked for the moment
// the two files that name them are in, so they come down the line while the renderer starts; buildCar unpacks them (loadGlb)
const lotOwnUrls = (show) => [...new Set(SLIDES.filter((d) => d.kind === 'car').map((d) => {
  const e = show.cars.find((c) => c.name === d.car); if (!e) throw new Error('slides.js names a car showroom.json lacks: ' + d.car); return e;
}).flatMap((e) => (e.drivable ? e.parts.map((p) => meshUrl(p.mesh)) : [meshUrl(e.mesh)])))];
const lotOwnBytes = Promise.all([fetchJson('showroom.json'), fetchJson('glb_bytes.json')]).then(([S, G]) => { GLB_BYTES = G.bytes; return Promise.all(lotOwnUrls(S).map((u) => glbBytes(u))); });

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
// the scenery's and the weather's level of detail: low on a phone or without WebGPU, where they cost most (scenery.js, weather.js)
const GFX_Q = BACKEND !== 'WebGPU' || matchMedia('(pointer: coarse)').matches ? 'low' : 'high';
// UC-30 the first full frame builds every shader it meets: 11-07 ?perf on WebGL 2, the lot's first frame took 8.3 s, and with one
// frame drawn behind the loading screen first, the next took 26 ms. So the lot is drawn behind the loading screen a piece at a time
// (each piece's shaders in a frame of their own, the loading game drawn in between), and the cars' models join it one at a time
// (UC-32). Tried first and dropped: renderer.compileAsync, aimed at the canvas and then at the post pass's target; the real frame
// did not reuse what it built (the pedestal tops' reflection and the shadow map draw the scene again, each with its own shaders)
const pause = (ms) => new Promise((r) => setTimeout(r, ms));   // a timer, not a frame: it still runs in a tab in the background
// UC-44.2 a new animation frame since frame f (renderer.info.frame, moved by the renderer's own loop): three draws a post pass's scene
// once a frame (warm.js 3), so a piece drawn in the same frame as the one before it is never drawn. A tab in the background
// draws no frames: the warm-up then waits for the visitor to look, and the lot opens with its shaders built
const frameAfter = (f) => new Promise((res) => { const go = () => (renderer.info.frame !== f ? res() : requestAnimationFrame(go)); requestAnimationFrame(go); });
const drawables = (o) => { const m = []; o.traverse((x) => { if (x.isMesh || x.isSprite || x.isLine || x.isPoints) m.push(x); }); return m; };
// a scene drawn behind its loading screen a piece at a time, so its first visible frame builds nothing; a piece drawn once is not
// drawn again (the track and the strip are warmed on the first race only, the car of each race on its own). 11-07: the strip's first
// frame froze the page for longer than the page check's 30 s click wait, the lot's had for 8.3 s
// UC-44.2 the GPU's half of a build. With the WGSL written, the first draw of a pipeline also waits for the GPU to compile it
// (MEASURED 11-08, desktop: frames of 400 to 700 ms while a car warmed, of which 100 to 300 ms was script). So a warming mesh is not
// drawn: three's own compile path (the one renderer.compileAsync uses: _createObjectPipeline, createRenderPipelineAsync) prepares it
// in the very pass and render target that is drawing (its shaders, its reflection's and its shadow map's, which that path runs too),
// and it is drawn once every pipeline it asked for is ready. These are three r175 internals, so they are checked here and the page
// stops, said, if the importmap ever loads a three without them
const warming = new Map();                                   // a mesh being warmed -> the promises of the pipelines it asked for; .only: a pass test (the mesh is prepared only where it passes)
{
  const R = renderer, direct = R._renderObjectDirect;
  if (typeof direct !== 'function' || typeof R._createObjectPipeline !== 'function' || R._handleObjectFunction !== direct || R._compilationPromises !== null)
    throw new Error('three.js internals the warm-up uses (Renderer._renderObjectDirect, _createObjectPipeline, _handleObjectFunction, _compilationPromises) are not as in r175: the importmap must load three@0.175.0');
  R._renderObjectDirect = R._handleObjectFunction = function (object, ...rest) {
    const asked = warming.get(object);
    if (!asked) return direct.call(this, object, ...rest);
    if (asked.only && !asked.only()) return;                   // not prepared in this pass (warmModel: the reflection first)
    const was = this._compilationPromises; this._compilationPromises = asked;
    try { return this._createObjectPipeline(object, ...rest); } finally { this._compilationPromises = was; }
  };
}
// AUTHORED: pipelines not ready this long after they were asked for are a failure, thrown (three's createRenderPipelineAsync wrapper
// never settles when the GPU refuses a pipeline: without a limit the page would wait for ever)
const PIPELINES_S = 60;
/** every pipeline the meshes asked for while warming, ready; resolves with how many */
async function pipelinesReady(meshes, what) {
  const asked = meshes.flatMap((m) => warming.get(m));
  let late = null;
  const r = await Promise.race([Promise.all(asked), new Promise((res) => { late = setTimeout(res, PIPELINES_S * 1000, 'late'); })]).finally(() => clearTimeout(late));
  if (r === 'late') throw new Error(what + ': ' + asked.length + ' GPU pipelines not ready ' + PIPELINES_S + ' s after their shaders were written');
  return asked.length;
}
const warmed = new WeakSet();
// UC-44.2 the pieces' meshes are warmed a frame at a time, each frame at most one lit material (warm.js warmSteps). A warming mesh is
// prepared, not drawn (warming), so a warm-up frame draws next to nothing and stays cheap even in software: the reason for the old cap
// (WARM_STEPS 8 frames, 11-07: the strip's 56 pieces, one a frame, took 60 s in software, each frame drawing everything warmed so
// far). MEASURED 11-08, phone profile: the old step holding the three template cars held the loading screen still for 9.2 s
async function warmPieces(scene, render, label, before, told = null) {   // told(done, total): UC-48 the steps as they go
  const pieces = scene.children.filter((p) => !warmed.has(p) && drawables(p).length), was = new Map();
  if (!pieces.length) return;
  for (const piece of pieces) for (const m of drawables(piece)) { was.set(m, [m.visible, m.frustumCulled]); m.visible = false; warming.set(m, []); }   // the lights stay on: shaders depend on them; UC-44.2 prepared, not drawn, until its pipelines are ready
  try {
    for (const p of pieces) warmed.add(p);
    const steps = warmSteps(warmSlices([...was.keys()].filter((m) => was.get(m)[0])));   // a part hidden in its model stays hidden
    let f = renderer.info.frame;
    if (before) before();
    for (const [k, ms] of steps.entries()) {
      if (told) told(k, steps.length + 1);                         // UC-48: the GPU's wait below is the last step
      for (const m of ms) { m.visible = true; m.frustumCulled = false; }   // unculled, so a piece out of view is built too
      await frameAfter(f); f = renderer.info.frame;               // UC-44.2: in a frame of its own (was a 16 ms timer: two steps could share a frame)
      await timed('warmed ' + label, ms.length + ' meshes', () => { render(); });
      for (const m of ms) m.frustumCulled = was.get(m)[1];
    }
    if (told) told(steps.length, steps.length + 1);
    mark('pipelines ready', label + ' (' + await pipelinesReady([...was.keys()], label) + ')');   // UC-44.2: compiled by the GPU while the loading screen ran on
  } finally { for (const m of was.keys()) warming.delete(m); }
}
const warmLot = () => warmPieces(show.scene, () => showPost.render(), 'lot', () => tickShow(0),   // tickShow: the camera where the lot opens
  (done, total) => loadStage(done < total - 1 ? 'warm' : 'gpu', done, total));   // UC-48
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
// UC-40 the weather: rain (the default, RJ 11-07) or dry, kept on this device; with the clutch the tyres follow the wet or dry curve
const WEATHER = { rain: (() => { try { return localStorage.getItem('hoc.weather') !== 'dry'; } catch (e) { return true; } })() };
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
window.HOC.weather = WEATHER;                                                 // UC-40 for the page check
window.HOC.renderer = renderer;                                               // the page check and devtools: renderer.info (draw calls, triangles)

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
const DOME = { horizon: 0x202a38, top: 0x07090c };          // the dome's colours (AUTHORED look); UC-44.3 the floor fades into its horizon
{ // the room (AUTHORED look): a dark dome, a glossy floor, an orange light ring, a key light and soft fill
  const g = new THREE.SphereGeometry(160, 48, 24), col = [];
  for (let i = 0; i < g.attributes.position.count; i++) {
    const h = Math.max(0, g.attributes.position.getY(i) / 160);
    const c = new THREE.Color(DOME.horizon).lerp(new THREE.Color(DOME.top), Math.pow(h, 0.45));
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
const SPOT_I = 140;                                            // each pedestal's spot (AUTHORED look); UC-44.3 dimmed off the slide in view (lot_light.js)
const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 128), showroomFloor(80, 0x07080a, DOME.horizon, RING + 16));   // UC-44.3 slabs, and no edge against the dome (fx.js); AUTHORED: the fade starts 16 m past the ring, beyond every slide
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
  batchStatic(THREE, body, { keep: wheels.filter(Boolean).map((x) => x.steer) });   // GFX 11-08: the body one draw per material, the wheels left on their pivots
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
// UC-44.2 a joining car is prepared before it is seen (warm.js 2 and 4): hung on warmHold (scaled to 0, so no triangle has area; on
// the lot's own scene, so its lights and environment are the ones the car will be lit by; outside every slide, so lot_focus never hides
// it from the reflection) and prepared one material a frame, each in a frame of the lot that ran the main view, the tops' reflection and
// the key light's shadow map (warm.js drawnInEveryPass); once the GPU has its pipelines it rolls onto its pedestal, and that frame
// builds nothing. While the visitor is away from the lot (a race, the strip) no lot frame is drawn, and the car waits for the lot
const warmHold = new THREE.Group(); warmHold.name = 'warm-hold'; warmHold.scale.setScalar(0); show.scene.add(warmHold);
const lotDrawn = { frame: -1 };                                  // the last frame tickShow / tickWalk drew the lot in (renderer.info.frame)
const lotFrameAfter = (after) => new Promise((res) => {
  const go = () => (drawnInEveryPass(after, { lot: lotDrawn.frame, reflect: lotFocus.reflectFrame, shadow: lotFocus.shadowFrame }) ? res() : requestAnimationFrame(go));
  requestAnimationFrame(go);
});
async function warmModel(g) {
  const ms = drawables(g), was = new Map(ms.map((m) => [m, [m.visible, m.frustumCulled]]));
  for (const m of ms) { m.visible = false; warming.set(m, []); }
  warmHold.add(g);
  try {
    // each step in two frames: the tops' reflection first, then the main view and the shadow map. Each camera keeps a built shader of its
    // own (warm.js 1), so preparing both in one frame built every lit material twice in it (MEASURED 11-08, desktop ?perf: frames of up to
    // 490 ms of script while a car warmed)
    const reflectOnly = () => lotFocus.reflecting;
    for (const step of warmSteps(warmSlices(ms.filter((m) => was.get(m)[0])))) {   // a part hidden in the model stays hidden, and is never drawn
      for (const m of step) { m.visible = true; m.frustumCulled = false; warming.get(m).only = reflectOnly; }   // unculled: the holder's bounds are a point
      await lotFrameAfter(renderer.info.frame);
      for (const m of step) warming.get(m).only = null;
      await lotFrameAfter(renderer.info.frame);
    }
    mark('pipelines ready', g.name + ' (' + await pipelinesReady(ms, g.name) + ')');   // every pipeline it asked for, in every pass
  } finally {
    for (const [m, [v, c]] of was) { m.visible = v; m.frustumCulled = c; warming.delete(m); }
    warmHold.remove(g);
  }
}
const ringGap = (i) => { const n = show.slides.length, d = Math.abs(i - show.index); return Math.min(d, n - d); };
const joinOrder = (a, b) => (b.urgent || 0) - (a.urgent || 0) || ringGap(a.i) - ringGap(b.i);
function wantModel(key) { const it = modelQ.items.find((x) => x.key === key); if (it) it.urgent = performance.now(); pumpDownloads(); pumpModels(); }
// UC-44.1 / UC-32.2 a car for sale's model is fetched once the lot's own cars are in (lotOwn: the lot cannot open without them, and the
// seven models asked for beside them took the line from them: 25.6 of the 34.0 MB of models the lot asked for, READ data/glb_bytes.json),
// then in the order the cars join, DOWNLOADS at a time, so the car that joins first is the one that arrives first.
// AUTHORED: 2 keeps the line busy while one model is being unpacked on the main thread, and still gives the first car half the line
const DOWNLOADS = 2;
function fetchBytes(it) {                                        // its bytes only; a failure is reported when its turn comes (fetchModel)
  if (!it.bytes) it.bytes = glbBytes('data/meshes/' + it.model.glb, false).then(() => {}, () => {}).then(() => { it.fetched = true; pumpDownloads(); });
  return it.bytes;
}
function fetchModel(it) {                                        // unpacked, at its turn to join: { g } or { e }
  fetchBytes(it);
  if (!it.ready) it.ready = saleModel(it.model).then((g) => { g.name = it.key; batchStatic(THREE, g); return { g }; }).catch((e) => ({ e }));   // GFX 11-08: batched (batch.js)
  return it.ready;
}
function pumpDownloads() {
  if (!modelQ.lotOwnIn) return;
  const busy = modelQ.items.filter((x) => x.bytes && !x.fetched).length;
  for (const it of modelQ.items.filter((x) => !x.bytes).sort(joinOrder).slice(0, Math.max(0, DOWNLOADS - busy))) fetchBytes(it);
}
async function pumpModels() {
  if (modelQ.busy || !modelQ.open) return;
  const next = modelQ.items.filter((x) => x.state === 'wait').sort(joinOrder)[0];
  if (!next) { if (modelQ.items.every((x) => x.state === 'on' || x.state === 'failed')) preloadTrack(); return; }   // UC-44.1: then the track
  modelQ.busy = true; next.state = 'joining';
  const got = await fetchModel(next);                            // in flight already, or asked for now (the visitor went to it)
  const fail = (e, say) => { next.state = 'failed'; if (next.caption) { next.caption.material.map = captionTex(say); next.caption.material.needsUpdate = true; } reportError(e); };
  if (got.e) fail(got.e, '3D model did not load');
  else {
    let warm = null;
    // UC-44.2 its unpacking (just done: GLTFLoader.parse and batching, up to 1.3 s of script on the phone profile) and its first build
    // in frames of their own: MEASURED 11-08, phone profile, the two in one frame made the longest frames after the lot opened (2.4 to 3.5 s)
    await frameAfter(renderer.info.frame);
    try { await timed('warmed model', next.key, () => warmModel(got.g)); } catch (e) { warm = e; }   // UC-44.2: its shaders built before it shows
    if (warm) fail(warm, '3D model did not draw');               // said on its pedestal and reported, never shown half-built
    else {
      next.turn.add(got.g);
      if (next.card) { next.stand.remove(next.card, next.caption); next.card.material.map.dispose(); }
      next.state = 'on'; HOC.saleModels.on.push(next.key); mark('model on its pedestal', next.key); perfFirst.push(next.key);
    }
  }
  await pause(120);                                              // a beat between two cars joining (UC-32.2: never two in one frame)
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
await fontsReady;                                         // the panels below are drawn in the face
// UC-44.1 the lot's own cars' parts, every file at once (buildCar below asks for a car's parts one after another, each once the one
// before has arrived and been unpacked; their bytes were asked for at the top: lotOwnBytes); the cars for sale only once these are in
const lotOwn = lotOwnBytes.then(() => Promise.all(lotOwnUrls(SHOW).map(loadGlb)));
lotOwn.then(() => { modelQ.lotOwnIn = true; pumpDownloads(); });   // a part that fails fails the lot itself: buildCar awaits the same promise
loadStage('build');                                       // UC-48: the bytes are in or coming; the stands and the cars are built
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
  const tints = [];                                                     // UC-44.3 the colours the light's focus dims: [colour, its full value, its dim level] (lightSlides)
  const tint = (col, dim) => tints.push([col, col.clone(), dim]);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(onPed ? 5.0 : 6.2, onPed ? 2.8 : 3.5), new THREE.MeshBasicNodeMaterial({ map: car || !onPed ? panelTexture(def, car) : salePanel(def) }));   // UC-44.3 dimmed through its own colour (lightSlides)
  panel.position.set(0, onPed ? 4.0 : 2.6, onPed ? -4.2 : 0);
  stand.add(panel);
  let turn = null, spot = null, photo = null;
  if (onPed) {
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.3, 0.3, 64), new THREE.MeshStandardNodeMaterial({ color: 0x14161a, roughness: 0.45, metalness: 0.3 }));
    ped.position.y = 0.15; ped.receiveShadow = true; stand.add(ped);
    const top = new THREE.Mesh(new THREE.CircleGeometry(3.1, 64), tops.material);
    top.rotation.x = -Math.PI / 2; top.position.y = 0.301; top.receiveShadow = true; stand.add(top);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.03, 8, 128), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(PAL.accent).multiplyScalar(8) }));   // glowMaterial's accent x 8, as a colour the focus can dim
    tint(rim.material.color, LIGHT.RIM_DIM);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.31; stand.add(rim);
    spot = new THREE.SpotLight(0xffffff, SPOT_I, 18, 0.55, 0.6, 1.6);
    spot.position.set(0, 9, 3); spot.target.position.set(0, 0.6, 0); stand.add(spot, spot.target);
    const beam = lightBeam(spot.position, spot.target.position, 3.4, 0xfff4e6, 0.09); stand.add(beam);   // its beam in the air (fx.js)
    tint(beam.material.color, LIGHT.SPOT_DIM);
    turn = new THREE.Group();
    if (car) {
      const { group } = await buildCar(car);
      batchStatic(THREE, group);                                   // GFX 11-08: on the lot nothing of it moves but the turntable (batch.js)
      if (car.drivable) turn.position.y = 0.3 - Math.min(...car.wheels.map((w) => w.bone_location[2] - w.radius)) / 100;   // wheels on the pedestal
      else turn.position.y = 0.3 - (car.bounds_cm.origin[2] - car.bounds_cm.box_extent[2]) / 100;
      turn.add(group);
    } else {
      // UC-8.3a: none, and the panel says so. A model loads behind the lot (about 4-6 MB each, seven of them): the lot opens at
      // once and each car rolls onto its pedestal as it arrives; a model that fails is a page error, never a silent empty pedestal
      if (def.model) {
        turn.position.y = 0.3; HOC.saleModels.want.push(saleKey);
        const { card, caption } = photoCard(saleKey);
        if (card) stand.add(card); stand.add(caption); photo = card;   // UC-44.3 framed with the pedestal until the model joins
        modelQ.items.push({ i, key: saleKey, turn, stand, card, caption, state: 'wait', model: def.model, ready: null });   // UC-44.1: fetched by pumpDownloads
      } else { turn.add(soonSign()); HOC.saleModels.soon.push(saleKey); }   // UC-26: the empty pedestal says why
    }
    stand.add(turn);
  } else {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.12, 0.9), plinthMaterial(0x14161a, PAL.accent));   // UC-44.3 (fx.js): dark, its front edge lit
    tint(plinth.material.emissive, LIGHT.RIM_DIM);
    plinth.position.set(0, 0.06, 0); stand.add(plinth);
  }
  show.scene.add(stand);
  tint(panel.material.color, LIGHT.SIGN_DIM);
  show.slides.push({ def, car, stand, turn, angle: a, spot, photo, tints, signH: onPed ? 0 : 3.5 });   // signH: a sign slide's sign, framed (UC-44.3)
}
// GFX 11-08 (lot_focus.js): the tops' reflection draws only the slides near the one in view; on once the lot is warmed
const lotFocus = makeLotFocus(THREE, { renderer, light: key, reflector: tops.reflector, planeY: tops.target.position.y, scene: show.scene, stands: show.slides.map((s) => s.stand) });
window.HOC.lotFocus = lotFocus;

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
  walk.fov = showCam.fov; showCam.fov = 70; showCam.clearViewOffset(); showCam.updateProjectionMatrix();   // UC-44.3: no lens shift on foot
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
  lotFocus.update(walk.w.x, walk.w.z, true);                             // GFX 11-08: a walker can look across the ring: nothing culled
  lightSlides(1);                                                        // UC-44.3: every stand lit for a walker
  if (i !== walk.faced) {
    walk.faced = i; if (i >= 0) { walk.lastFaced = i; const d = show.slides[i].def; if (d.kind === 'listing' || d.kind === 'unlisted') wantModel((d.listing || d.unlisted).key); }   // UC-32.3
    const el = $('walklabel'); el.hidden = i < 0;
    if (i >= 0) el.innerHTML = slideName(i) + '<span>' + (matchMedia('(pointer:coarse)').matches ? 'Tap to see this car' : 'Enter: see this car') + '</span>';
  }
  showPost.render(); lotDrawn.frame = renderer.info.frame;               // UC-44.2: a frame of the lot (a joining car warms in it)
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
// UC-44.3 the panels' boxes (the header's row, the card, the nav's row, the footer, the sales chat, the WebGL note), read off the page
// only when one changes, and the rectangles they leave free (lot_frame.js); the chat is another script's (sales_chat.js): a page
// without it has one panel fewer
const lotFrame = { rects: null, s: 1, dx: 0, dy: 0, last: null };
window.HOC.lotFrame = lotFrame;                             // the page check and devtools: the last fit (UC-44.3)
function readPanels() {
  const box = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? [r.left, r.top, r.right, r.bottom] : null; };   // hidden: no size
  const boxes = {}, put = (k, e) => { const b = e && box(e); if (b) boxes[k] = b; };
  document.querySelectorAll('header > *').forEach((e, i) => put('header:' + i, e));
  document.querySelectorAll('#showroom .nav > *').forEach((e, i) => put('nav:' + i, e));
  for (const id of ['card', 'foot', 'gpunote']) put(id, $(id));
  put('chat', document.querySelector('#salechat'));
  lotFrame.rects = freeRects({ w: innerWidth, h: innerHeight }, mergeGroups(boxes), FRAME.GAP);
}
const panelWatch = new ResizeObserver(() => { lotFrame.rects = null; });
for (const e of [document.querySelector('header'), $('card'), document.querySelector('#showroom .nav'), $('foot'), $('gpunote'), document.querySelector('#salechat')]) if (e) panelWatch.observe(e);
addEventListener('resize', () => { lotFrame.rects = null; });
// the slide's subject on screen (CSS px) under the authored camera: a pedestal and what stands on it (a cylinder round the
// pedestal, as tall as its car, so the box does not breathe as the turntable turns), or a sign slide's sign; null when a point is
// behind the camera (nothing to frame)
const SUBJ = Array.from({ length: 16 }, () => new THREE.Vector3()), subBox = new THREE.Box3();
function subjectRect(c) {
  let n = 0;
  if (c.turn) {
    subBox.setFromObject(c.turn);
    const top = Math.max(0.3, subBox.isEmpty() ? 0 : subBox.max.y, c.photo && c.photo.parent ? c.photo.position.y + 1.65 : 0);   // photoCard: 3.3 m tall at 2.5
    for (let k = 0; k < 8; k++) for (const y of [0, top]) SUBJ[n++].set(Math.sin(k * Math.PI / 4) * PED_R, y, Math.cos(k * Math.PI / 4) * PED_R);
  } else for (const x of [-3.1, 3.1]) for (const y of [2.6 - c.signH / 2, 2.6 + c.signH / 2]) SUBJ[n++].set(x, y, 0);   // the sign: 6.2 m wide at 2.6 (the stand loop)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) {
    const p = c.stand.localToWorld(SUBJ[k]).project(showCam);
    if (p.z > 1 || p.z < -1) return null;
    const x = (p.x + 1) / 2 * innerWidth, y = (1 - p.y) / 2 * innerHeight;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}
// the authored camera pulled back by 1 / s from what it looks at, and the picture shifted (dx, dy) px by a lens shift (the pose, the
// ring behind and the light stay the authored ones); the intro flies in unframed and lands framed (weight e). AUTHORED: it settles in
// about a second; with Motion off it moves at once (no animated zoom)
function frameSubject(dt, e, still, target) {
  showCam.clearViewOffset(); showCam.updateMatrixWorld();
  if (!lotFrame.rects) readPanels();
  const sub = e > 0 ? subjectRect(show.slides[show.index]) : null;
  lotFrame.sub = sub;                                       // the page check and devtools: what was framed
  const f = lotFrame.last = sub ? fitSubject(sub, lotFrame.rects, { w: innerWidth, h: innerHeight }) : { s: 1, dx: 0, dy: 0, fits: false };
  const k = still ? 1 : Math.min(1, dt * 3);
  lotFrame.s += (1 + (f.s - 1) * e - lotFrame.s) * k; lotFrame.dx += (f.dx * e - lotFrame.dx) * k; lotFrame.dy += (f.dy * e - lotFrame.dy) * k;
  showCam.position.sub(target).divideScalar(lotFrame.s).add(target);
  if (Math.abs(lotFrame.dx) > 0.5 || Math.abs(lotFrame.dy) > 0.5) showCam.setViewOffset(innerWidth, innerHeight, -lotFrame.dx, -lotFrame.dy, innerWidth, innerHeight);
}
// UC-44.3 the light follows the slide in view (lot_light.js): its spot, beam, rim and sign full, the others dimmed; whole (0..1) lifts
// every stand back up (the intro's fly-in, walking the lot)
const litAt = { angle: NaN, whole: NaN };
function lightSlides(whole) {
  // the camera at rest: nothing to change. MEASURED (lot pass, profile_lot.py, the Ghost's slide): writing the levels every frame
  // re-uploaded 13 lights' and about 50 materials' uniforms every frame, since show.angle creeps toward its target forever.
  // AUTHORED: 1e-4 rad is 3 mm of the camera's travel round the ring
  if (Math.abs(show.angle - litAt.angle) < 1e-4 && whole === litAt.whole) return;
  litAt.angle = show.angle; litAt.whole = whole;
  const sp = 2 * Math.PI / show.slides.length;
  for (const c of show.slides) {
    const w = focusWeight(c.angle, show.angle, sp);
    for (const [col, full, dim] of c.tints) col.copy(full).multiplyScalar(level(w, dim, whole));   // the materials' own colours: no extra uniform
    if (c.spot) c.spot.intensity = SPOT_I * level(w, LIGHT.SPOT_DIM, whole);
  }
}
const showTarget = new THREE.Vector3();
function tickShow(dt) {
  show.angle += (show.targetAngle - show.angle) * Math.min(1, dt * 2.6);
  intro = Math.min(1, intro + dt / 3.2);
  const aspect = innerWidth / innerHeight;
  const a = show.angle, R = RING + 10.5 * (aspect < 1 ? Math.min(2.2, 0.85 / aspect) : 1);   // portrait: back off so the slide fits the width
  const still = REDUCED || !MOTION.on;                       // UC-44 alternates: the OS's reduced motion or the Motion pill off: no sway
  const bob = still ? 0 : Math.sin(performance.now() / 2400) * 0.12;
  const e = ease(intro), sweep = (1 - e) * 1.4;              // the intro: down from above the lot, swinging in
  const ea = a - sweep, Rr = R + (1 - e) * 26;
  const lift = aspect < 1 ? 1.4 : 0, aim = aspect < 1 ? 0.2 : 1.6;   // portrait: look down on the car a little more
  showCam.position.set(Math.sin(ea) * Rr, 2.5 + lift + bob + (1 - e) * 24, Math.cos(ea) * Rr);
  showTarget.set(Math.sin(a) * RING * e, aim - (1 - e) * aim, Math.cos(a) * RING * e);
  showCam.lookAt(showTarget);
  frameSubject(dt, e, still, showTarget);                    // UC-44.3 (lot_frame.js): replaces the 1.6 m step left over 900 px wide
  show.holdSpin = Math.max(0, show.holdSpin - dt);             // a drag holds the turntable for a few seconds
  show.slides.forEach((c, i) => { if (c.turn && i === show.index && !show.drag && show.holdSpin === 0) c.turn.rotation.y += dt * 0.35; });
  lightSlides(1 - e);                                         // UC-44.3: every stand lit while the intro flies in, then the one in view
  lotFocus.update(Math.sin(show.angle) * RING, Math.cos(show.angle) * RING, e < 1);   // GFX 11-08: the slide the camera is turned to; the whole ring while the intro flies in
  showPost.render(); lotDrawn.frame = renderer.info.frame;               // UC-44.2: a frame of the lot (a joining car warms in it)
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
  // UC-40 the road's two materials as node materials, so weather.js wetRoad can wet them: three's own conversion of a glTF material
  // (renderer.library.fromMaterial, the one the renderer makes on every build of it, so the road draws as it did), one per material
  const nodeOf = new Map(), ROADS = new Set(['MI_TrackEdge_Inst', 'MI_TrackEdge']), roads = new Set();
  t.traverse((o) => {
    if (!o.isMesh) return;
    if (/SkySphere/i.test(o.name) || /SkySphere/i.test(o.material?.name || '')) { o.visible = false; return; }   // see AUTHORED: sky
    o.castShadow = true; o.receiveShadow = true;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (o.material && o.material[k]) o.material[k].anisotropy = renderer.getMaxAnisotropy();   // UC-33.3
    if (o.material && ROADS.has(o.material.name)) {
      if (!o.material.isNodeMaterial) {
        if (!nodeOf.has(o.material)) nodeOf.set(o.material, renderer.library.fromMaterial(o.material));
        o.material = nodeOf.get(o.material);
      }
      roads.add(o.material);
    }
    if (o.material && !o.material.userData.restyled) {                    // UC-33: the template's grid road and tinted walls, restyled (fx.js)
      if (o.material.name === 'MI_TrackEdge_Inst') { asphaltRoad(o.material, false); o.material.userData.restyled = 'asphalt'; }
      else if (o.material.name === 'MI_TrackEdge') { asphaltRoad(o.material, true); o.material.userData.restyled = 'shoulder'; }
      else if (o.material.name === 'M_TintCol') { concreteWall(o.material); o.material.userData.restyled = 'concrete'; }
    }
  });
  for (const n of ROADS) if (![...roads].some((m) => m.name === n)) throw new Error('data/' + TRACK.glb + ' has no ' + n + ': UC-40 would have no road to wet');
  for (const m of roads) rainDay.road(m);                                    // UC-40: the asphalt and its shoulders get wet
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

// ---------------------------------------------------------------- UC-40 a rain day on the track's scene (weather.js)
// The circuit and the strip share the track's scene, so they share one rain day: weather.js's rain around the race camera, every road
// registered with road() made wet (the circuit's asphalt and shoulders, the strip's asphalt and launch pad), the sky greyed and the
// paint's light probe rebuilt from that grey sky (fx.js skyEnv), and the light shafts in the run's post chain (rays(), handed to fx.js
// makePost). set() puts all of it on, or takes all of it off, at the start of a run (startRace / startDrag): a switch mid-run waits for
// the next one. Dry, nothing of it is left: the rain out of the scene, every road undone, the clear sky and its own probe back
const rainDay = {
  on: false, roads: [], shafts: [], wet: new Map(), rain: null, sky: null, sunT: null, envDry: null, envWet: null,
  road(mat) { this.roads.push(mat); },
  shaft(s) { this.shafts.push(s); s.mesh.visible = this.on; },   // UC-40.4 a scene's own shafts (weather.js buildShafts): shown on a rain day
  set(want) {                                          // -> whether anything changed (its shaders are then new)
    const tv = trackView;
    let changed = false;
    if (!this.sunT) { this.sunT = sunTracker(THREE, tv.sun); this.envDry = tv.scene.environment; }
    for (const m of this.roads) {                      // a road registered since the last run (the strip) is set too
      if (want && !this.wet.has(m)) { this.wet.set(m, wetRoad(THREE, m, { quality: GFX_Q })); changed = true; }
      if (!want && this.wet.has(m)) { this.wet.get(m).undo(); this.wet.delete(m); changed = true; }
    }
    for (const s of this.shafts) if (s.mesh.visible !== want) { s.mesh.visible = want; changed = true; }
    if (want === this.on) return changed;
    if (want) {
      if (!this.rain) this.rain = buildRain(THREE, { quality: GFX_Q });
      tv.scene.add(this.rain.group);
      this.sky = overcast(THREE, tv.sky.material);
      if (!this.envWet) {                              // the probe of the grey sky: a clone of the sky the camera sees shares its material
        const s = tv.sky.clone(); s.position.set(0, 0, 0); s.scale.setScalar(100);
        this.envWet = skyEnv(renderer, s, TRACK.landscape_material.ground_col);
      }
      tv.scene.environment = this.envWet;
    } else {
      tv.scene.remove(this.rain.group);
      this.sky.undo(); this.sky = null;
      tv.scene.environment = this.envDry;
    }
    this.on = want;
    return true;
  },
  rays() { return this.on ? { sun: this.sunT, quality: GFX_Q } : null; },
  frame(camera, dt) { if (this.on) { this.rain.update(camera, dt); this.sunT.update(camera); for (const s of this.shafts) if (s.mesh.parent && s.mesh.parent.visible) s.update(camera); } },   // each frame, before the post renders
};
window.HOC.rainDay = rainDay;                                                  // UC-40 for the page check

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
// UC-44.1 the track loads behind the lot once every car for sale has joined (pumpModels). It started 1.5 s after the stands were built:
// its 9.1 MB (READ: the sizes of track.glb, collision.bin and ground_*.bin) and its scene build then ran beside the lot's own loading, its warm-up and
// the cars' joining (MEASURED 11-08, phone profile: its build began 23 s before the lot opened). A drive asked for sooner starts it
// at once: startRace and startDrag await the same promise, and show any error
const preloadTrack = () => prepareTrack().catch((e) => { console.error(e); });
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
  const wxChanged = rainDay.set(WEATHER.rain);           // UC-40: rain or dry, as the switch says at the start of the run
  race.post = makePost(renderer, trackView.scene, race.camera, { bloomStrength: 0.25, bloomRadius: 0.3, bloomThreshold: 1.2, vignette: 0.45, bloomCap: 6, saturation: 1.08, godRays: rainDay.rays() });   // UC-37.5, UC-40
  await warmPieces(trackView.scene, () => race.post.render(), 'track');   // UC-30: behind the loading screen
  if (wxChanged) race.post.render();                      // UC-40: the weather's new shaders built behind the loading screen too
  await loadingDone();                                    // UC-20.3: a game in play ends when its player says, not under a countdown
  audio.start();
  window.HOC.state = race;
  mode = 'race';
  race.selfDrive = false; syncAuto();                                 // UC-45: AUTO there to press
  $('showroom').style.display = 'none'; $('race').style.display = 'block'; document.body.classList.add('inrun');
  $('t-best').textContent = '—';
}
// the visitor is on the lot (not leaving it for a race or the strip, which may still be loading): the sales chat's moment
let onLot = true;
function backToShowroom() {
  leaveOnline();                                                       // UC-42: off the strip, out of the lobby
  mode = 'show'; onLot = true;
  window.dispatchEvent(new CustomEvent('hoc:lot-open'));              // the sales chat belongs to the lot: it greets the first time, shows its tab after
  if (dragView && trackView) setDragScene(false);
  silence(audio);
  $('showroom').style.display = ''; $('race').style.display = 'none'; document.body.classList.remove('inrun');
}

// keys, as IMC_Vehicle_Default maps them (data: ue_out/bp/IMC_Vehicle_Default.t3d), plus Esc and G for the page
const keys = new Set();
let startSpace = false;
const PAD_CLUTCH_FULL = 0.9;                                          // UC-34.1e: a pad's left trigger at 90 % or more is the clutch on the floor (tickDrag)                                               // UC-22.1b: the Space press that started the tree, until it is let go
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
function syncMotion() { $('motion').textContent = 'Motion ' + (MOTION.on ? 'on' : 'off'); $('motion').setAttribute('aria-pressed', String(MOTION.on)); document.body.classList.toggle('motionoff', !MOTION.on); }   // UC-44: the CSS's own motion (the slip's reveal) follows the switch too
function toggleMotion() { MOTION.on = !MOTION.on; try { localStorage.setItem('hoc.motion', MOTION.on ? 'on' : 'off'); } catch (e) { /* not kept */ } syncMotion(); }
$('motion').addEventListener('click', toggleMotion); syncMotion();
function syncDragCam() { $('dcam').textContent = 'Camera: ' + (DRAGCAM.film ? 'filmed' : 'chase'); $('dcam').setAttribute('aria-pressed', String(DRAGCAM.film)); }
function toggleDragCam() { DRAGCAM.film = !DRAGCAM.film; try { localStorage.setItem('hoc.dragcam', DRAGCAM.film ? 'film' : 'chase'); } catch (e) { /* not kept */ } syncDragCam(); }
$('dcam').addEventListener('click', toggleDragCam); syncDragCam();
// UC-40.3 the Rain pill (and U, in a race or on the strip): rain or dry, kept on this device. It takes effect at the next run (rainDay
// is set at a run's start); on the strip that is now, a new run, as the Clutch pill does
function syncWeather() { $('rain').textContent = 'Rain ' + (WEATHER.rain ? 'on' : 'off'); $('rain').setAttribute('aria-pressed', String(WEATHER.rain)); }
function toggleWeather() { WEATHER.rain = !WEATHER.rain; try { localStorage.setItem('hoc.weather', WEATHER.rain ? 'rain' : 'dry'); } catch (e) { /* not kept */ } syncWeather(); if (mode === 'drag') dragRerun(); }
$('rain').addEventListener('click', toggleWeather); syncWeather();
window.HOC.dragCam = DRAGCAM;
window.HOC.motion = MOTION;
function syncMute() { $('mute').textContent = !audio.available() ? 'No sound' : audio.muted ? 'Sound off' : 'Sound on'; $('mute').setAttribute('aria-pressed', String(!audio.muted)); if (audio.muted && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }   // UC-27.4: the talk station's voice too
$('mute').addEventListener('click', () => { audio.start(); audio.setMuted(!audio.muted); syncMute(); });
syncMute();
// UC-7.4b the sound starts with the first press that a browser lets start it. iOS counts the END of a touch (or a click), not its
// start, so the page asks again on every press until the context runs (it was once, on pointerdown: an iPhone stayed silent)
const soundOn = () => { audio.start(); if (audio.running()) for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click']) removeEventListener(ev, soundOn, true); };
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click']) addEventListener(ev, soundOn, true);
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
    if (race.clutchMode && !race.selfDrive && !e.repeat && (/^Digit[0-9]$/.test(e.code) || e.key === 'n' || e.key === 'N')) { requestGear(race, /^Digit/.test(e.code) ? +e.code.slice(5) : 0); return; }   // UC-34.1a the gate on keys: 1..7, N or 0 neutral
    if (e.key === 'g' || e.key === 'G') { toggleDragBox(); return; }
    if (e.key === 'q' || e.key === 'Q') { if (!e.repeat) dragPress('down'); return; }
    // UC-22.1b START, then gas (UC-34.1d). The press that starts the tree is START only: gas from it crept the car a few cm on the
    // tree, which set the run's first motion there and put the tree's 4.5 s into the slip's 0-100 (measured 11-08: 7.84 s for 3.2).
    // Let go and press again for gas
    if (e.code === 'Space' && !race.over && !race.run.done) { e.preventDefault(); if (!race.armed && !e.repeat) { armDrag(); startSpace = true; } if (!startSpace) keys.add('Space'); return; }
    if (e.key === 'Enter' && !race.armed && !race.over) { e.preventDefault(); armDrag(); return; }   // UC-22.1b START
    if ((e.key === 'r' || e.key === 'R' || e.key === 'Enter' || e.code === 'Space') && (race.over || race.run.done || race.v.stalled)) { e.preventDefault(); if (!e.repeat) dragRerun(); return; }   // a held Space past the line is not a rerun
    if (e.key === 'p' || e.key === 'P') { savePicture(race.entry.name + '-drag'); return; }
    if (e.key === 'c' || e.key === 'C') { toggleDragCam(); return; }   // UC-35.3a
    if (e.key === 'u' || e.key === 'U') { toggleWeather(); return; }   // UC-40.3: a new run in the other weather
    keys.add(e.code); return;
  }
  if (e.key === 'Escape') { backToShowroom(); return; }
  if (e.key === 'p' || e.key === 'P') { savePicture(race.entry.name + '-drive'); return; }
  if (e.key === 'u' || e.key === 'U') { toggleWeather(); return; }     // UC-40.3: from the next race
  // Tab: the template's FrontSpringArm. A car for sale is a Meshy shell with no cabin, and that camera sits inside it (11-06:
  // the view was the inside of the body), so it keeps the chase camera
  if (e.key === 'Tab') { e.preventDefault(); if (!race.entry.sim) race.front = !race.front; return; }
  if (e.key === 'g' || e.key === 'G') { trackView.gates.visible = !trackView.gates.visible; return; }
  if (e.key === 'Backspace') { e.preventDefault(); doReset(); return; }
  keys.add(e.code);
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'Space') startSpace = false; });
$('back').addEventListener('click', () => backToShowroom());   // UC-5.6: a phone has no Esc
// UC-47 a phone as the controller (phone_controller.js, the PhonePad session's): the pill opens the room and its QR code, and closes
// it again; the phone is then a standard gamepad (gamepad.js, the pad pill), so nothing else here changes
$('phonepill').addEventListener('click', () => {
  const P = window.HOC_PHONE, b = $('phonepill');
  if (!P) throw new Error('phone_controller.js did not load (index.html names it)');
  if (P.pads) { P.stop(); b.textContent = 'Phone pad'; b.setAttribute('aria-pressed', 'false'); return; }
  b.textContent = 'Phone pad: opening…';
  P.start().then(() => { b.textContent = 'Phone pad: on'; b.setAttribute('aria-pressed', 'true'); },
    (e) => { b.textContent = 'Phone pad'; b.setAttribute('aria-pressed', 'false'); reportError(e); });
});
document.querySelectorAll('#touch button').forEach((b) => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (k === 'reset') doReset(); else touch[k] = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { if (k !== 'reset') touch[k] = false; });
});
function readInput() {
  const on = (...c) => c.some((x) => keys.has(x));
  const k = {
    throttle: on('KeyW', 'ArrowUp') || touch.throttle || (mode === 'drag' && (on('Space') || mouseGas.size > 0)) ? 1 : 0,   // UC-34.1d the strip's gas
    brake: on('KeyS', 'ArrowDown') || touch.brake ? 1 : 0,
    steering: (on('KeyD', 'ArrowRight') || touch.right ? 1 : 0) - (on('KeyA', 'ArrowLeft') || touch.left ? 1 : 0),
    handbrake: on('Space') && mode !== 'drag' ? 1 : 0,                  // on the strip Space is gas
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
  rainDay.frame(cam, dt);                                // UC-40: the rain around this camera, the sun on its screen
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
  const scenery = buildScenery(THREE, { quality: GFX_Q, seed: 1107, anisotropy: 8, fog: scene.fog, groundColour: M.ground_col });
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
  asphalt.material.name = 'strip-asphalt'; pad.material.name = 'strip-pad';
  rainDay.road(asphalt.material); rainDay.road(pad.material);                         // UC-40: the strip's road gets wet, the launch pad too
  // UC-40.4 the sun's shafts over the strip: Elami's GodRayShaft quads along the sun's own direction (weather.js buildShafts). They
  // replace the screen-space LSPP pass here (the owner 11-08: "god rays ... not visible, do shafts"; Elami replaced it the same way)
  const shafts = buildShafts(THREE, { light: trackView.sun }); g.add(shafts.mesh); rainDay.shaft(shafts);
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
    // UC-44.4 the lamp's glow in the haze (drag_fx.js HALO): a soft sprite in front of each bulb, shown only while the bulb is lit
    const halo = haloMaterial(THREE, color), halos = [-0.42, 0.42].map((z) => { const h = new THREE.Sprite(halo.material); h.position.set(-0.14 - r, y, z); h.visible = false; h.renderOrder = 4; tree.add(h); return h; });
    lamps[name] = { list, on, off, halos, halo, r };
  };
  lamp('prestage', 3.5, '#ffd27a', 0.09); lamp('stage', 3.3, '#ffd27a', 0.09);
  lamp('a1', 2.9, '#ffb020', 0.15); lamp('a2', 2.5, '#ffb020', 0.15); lamp('a3', 2.1, '#ffb020', 0.15);
  lamp('green', 1.6, '#3dff7a', 0.16); lamp('red', 1.15, '#ff3b30', 0.16);
  // GFX 11-08 (batch.js): the strip's static parts one draw per material; kept as they are: the tree's lamps (their materials swap),
  // the roads and the grass (the rain and the scenery re-material them), the shafts and the scenery (already a few draws)
  // UC-44.4 the tyre smoke: one pool, one draw call, as many puffs as the page's quality allows (drag_fx.js SMOKE)
  const smoke = buildSmoke(THREE, { quality: GFX_Q }); g.add(smoke.mesh);
  batchStatic(THREE, g, { keep: [scenery.group, shafts.mesh, grass, asphalt, pad, smoke.mesh, ...Object.values(lamps).flatMap((L) => [...L.list, ...L.halos])] });
  scene.add(g);
  // the halos' size and strength for the day (drag_fx.js haloLook): wider and brighter in the rain, set at the start of a run
  const halo = (rain) => { const H = haloLook(rain); for (const L of Object.values(lamps)) { L.halo.strength.value = H.strength; for (const h of L.halos) h.scale.setScalar(H.size * L.r / 0.15); } };
  // the smoke, the glows and the lamps' lit material are not drawn until the run needs them, so the warm-up would never build them: shown
  // for it (the smoke with nothing in it; behind the loading screen), then put back (tickDrag sets the lamps every frame)
  const warmFx = (on) => { smoke.mesh.visible = on; for (const L of Object.values(lamps)) { for (const h of L.halos) h.visible = on; for (const m of L.list) m.material = on ? L.on : L.off; } };
  return { group: g, lamps, smoke, halo, warmFx };
}
function setLamp(dv, name, lit) { const L = dv.lamps[name]; for (const m of L.list) m.material = lit ? L.on : L.off; for (const h of L.halos) h.visible = lit; }   // UC-44.4 its glow with it
// the track's own pieces hide while the strip shows, and come back as they were
function setDragScene(on) {
  const parts = [trackView.ground, trackView.track, trackView.gates, trackView.marker, trackView.dressing];   // the dressing is the track's, not the strip's
  if (on) { trackView.beforeDrag = parts.map((o) => o.visible); parts.forEach((o) => { o.visible = false; }); }
  else if (trackView.beforeDrag) { parts.forEach((o, i) => { o.visible = trackView.beforeDrag[i]; }); trackView.beforeDrag = null; }
  if (dragView) dragView.group.visible = on;
  document.body.classList.toggle('dragmode', on); if (!on) document.body.classList.remove('dragover');   // UC-22.5 the run-over look ends with the strip
  $('drag').hidden = !on;
}
const dragTimeRows = [['rt', 'Reaction'], ['sixty', '60 ft'], ['kmh100', '0-100 km/h'], ['eighth', '1/8 mile'], ['quarter', '1/4 mile']];
// UC-38 the rivals' cars, in the lot's order (rivals.js DRIVERS has one for each), and how many strips have been entered from the lot
const RIVAL_CARS = LISTINGS.cars.map((c) => c.key).filter((k) => DRIVERS[k]);
let rivalN = 0;
async function startDrag(entry, o = {}) {
  onLot = false; if (window.HOC_SALES) window.HOC_SALES.hide();                      // not over the strip's dials
  if (entry.sim) wantModel(entry.name);                  // UC-32.3
  loadingShow('Rolling the car to the strip…', entry.name);
  await prepareTrack();
  if (!dragView) dragView = buildDragStrip(trackView.scene);
  window.HOC.dragView = dragView;                                       // UC-44.4 the page check: the smoke pool, the tree's glows
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
  const stage = Replay.stagePoint(carJson, DRAG_LANE_Y_CM);           // the nose on the line, in the left lane (drag_replay.js: a claim's check stages it the same way)
  const settle = (v) => Replay.settle(Chaos, v, stage, strip, STEP);  // reset at the stage, settled on its springs (drag_replay.js, shared with the check)
  const v = settle(Chaos.makeVehicle(carJson, opts));
  const best = Drag.bestRun(Chaos, settle(Chaos.makeVehicle(carJson, opts)), strip);   // the sim's own best run, for the slip (DERIVED)
  const houseOpts = DRAGBOX.clutch ? { road: WEATHER.rain ? 'wet' : 'dry' } : undefined;
  const house = Drag.houseRun(Chaos, settle(Chaos.makeVehicle(carJson, opts)), strip, null, houseOpts);   // UC-40: the house car on the same road // UC-25.2: R.J.Thompson's run on this car's board (DERIVED)
  // UC-38 the car in the other lane: a rival (rivals.js), another car of the lot with its own driver, its own house run on the same
  // road, replayed a human reaction after the green. A rerun is a rematch with the same driver; a strip entered from the lot brings
  // the next one
  const kept = o.rematch && race && race.opp && race.opp.rival && race.entry && race.entry.name === entry.name ? race.opp.rival : null;
  const rival = entry.sim && !o.online ? kept || pickRival(entry.name, RIVAL_CARS, rivalN++) : null;
  const opp = o.online ? await onlineOpp(o.online, gravity, strip) : rival ? await rivalRun(rival, gravity, strip, houseOpts) : null;   // UC-42
  const camKey = entry.sim ? 'SportsCar' : entry.name;
  const arm = CAMS.cars[camKey].BackSpringArm, cam = CAMS.cars[camKey].BackCamera;
  race = { kind: 'drag', entry, car, carJson, v, strip, best, house, pts: best.points, run: Drag.makeRun(), x0: v.pos[0], now: 0, rig: makeRig(arm), fov: cam.field_of_view,
           wheelWidths: carJson.wheels.map((w) => w.setup.wheel_width.value), throttle: 0, camKey, presses: [], gradeT: 0, front: false, slipShown: false, padPrev: {},
           director: makeDirector(), body: carJson.bounds_cm.value };   // UC-35: the filmed run, framed on the car's own READ bounds
  race.opp = opp;                                                      // UC-38
  race.kick = makeKick(); race.fxSpeed = null; race.fxGear = 0; race.fxRpm01 = 0; race.fin = null;   // UC-44.4 the camera's answer to the car, the shifts heard, the line
  $('dfin').hidden = true; $('dphoto').hidden = true; document.body.classList.remove('dragfin');
  race.online = o.online || null; race.onlineGo = false; race.sentFinish = false; race.onlineResult = null;   // UC-42 an online match
  race.clutchMode = DRAGBOX.clutch;                                    // UC-34: in neutral, the pedal up, the gate drawn
  race.road = WEATHER.rain ? 'wet' : 'dry';                           // UC-40: the run's road, kept for the run (the rain switch starts a new run)
  race.tape = entry.sim ? Replay.makeTape({ car: entry.name, clutch: race.clutchMode, road: race.clutchMode ? race.road : null }) : null;   // UC-46: the run as the sim takes it, for a first place's coffee
  race.selfDrive = false;                                             // UC-45: the visitor drives until they press AUTO
  if (race.clutchMode) { const layout = Sim.gateLayout(v.cfg.trans.forward.length); race.gate = { layout, knob: Sim.knobFor(0, layout), gear: 0 }; race.pedal = { depth: 0, held: false, anchor: 0, prev: 0 }; race.cut = null; }
  document.body.classList.toggle('clutchmode', race.clutchMode); drawGate(race); drawPedal(race);
  race.armed = false; race.over = null; document.body.classList.remove('dragover'); $('dfail').hidden = true; $('dstart').hidden = !!race.online;   // UC-22.1b staged, the tree dark (UC-42: the lobby's Ready instead)
  race.cluster = await buildCluster(entry, v, race.pts);              // UC-36: the car's own cluster, or the page's tach (36.1a)
  const tachEl = $('hud-speed'); tachEl.querySelector('svg.tach')?.remove();
  race.tach = buildTach(tachEl, v.cfg.engine.maxRPM, Math.min(...race.pts));   // the red band from the earliest derived shift point
  $('dslip').hidden = true; $('dgrade').textContent = '';
  $('dtimes').innerHTML = dragTimeRows.map(([k, l]) => '<div data-k="' + k + '"><span>' + l + '</span><b>--</b></div>').join('');
  race.title = entry.sim ? (LOT_CARS.find((c) => c.key === entry.name) || {}).title || entry.name : entry.name;
  const vsName = o.online ? o.online.name : opp ? opp.rival.name : null, vsCar = o.online ? o.online.car : opp ? opp.rival.key : null;
  $('dcar').textContent = vsName ? (SHORT[entry.name] || race.title) + ' vs ' + vsName.toUpperCase() + ' · ' + SHORT[vsCar] : race.title;   // UC-38.1 / UC-42 who you race
  $('dsayn').textContent = opp && opp.rival ? opp.rival.name.toUpperCase() + ' · ' + SHORT[opp.rival.key] : '';
  $('dkeys').hidden = false; mouseGas.clear();                          // UC-34.1d the controls, while staged
  syncAuto(); prizeTease(race);                                       // UC-45 AUTO there to press; UC-46.1 the coffee's time to beat, while staged
  race.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
  const wxChanged = rainDay.set(WEATHER.rain);                          // UC-40: rain or dry, as the switch says at the start of the run
  dragView.halo(WEATHER.rain); dragView.smoke.clear();                  // UC-44.4 the tree's glow for the day; no smoke left from the last run
  race.post = makePost(renderer, trackView.scene, race.camera, { bloomStrength: 0.35, bloomRadius: 0.3, bloomThreshold: 1.2, vignette: 0.45, bloomCap: 6, saturation: 1.08 });   // UC-40.4 the strip's shafts are in its scene, not the post
  const warmFx = !warmed.has(dragView.group); if (warmFx) dragView.warmFx(true);   // UC-44.4 the smoke's and the glows' shaders built here too
  // UC-44.4 / UC-30 / UC-44.2 the strip behind the loading screen, a step a frame (the old warm-up's steps 16 ms apart fell inside one frame,
  // so only the first drew anything: measured 11-08 by both the strip's and the speed pass), and the loading screen goes once the GPU has
  // every pipeline the warm-up asked for (warmPieces' pipelinesReady)
  await warmPieces(trackView.scene, () => race.post.render(), 'strip');
  if (warmFx) dragView.warmFx(false);
  if (wxChanged) race.post.render();                                    // UC-40: the weather's new shaders built behind the loading screen too
  await loadingDone();
  audio.start();
  loadSfx(audio).catch((e) => reportError(e));                         // UC-34 4b the stick's sounds
  window.HOC.state = race;
  mode = 'drag';
  $('showroom').style.display = 'none'; $('race').style.display = 'block'; document.body.classList.add('inrun');
}
document.querySelectorAll('#dtouch button[data-d]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); dragPress(b.dataset.d); }));   // a phone's shift buttons
{ const gas = $('dgas');                                     // UC-35 6b: the strip's gas, on the left, held as the race's own gas button
  gas.addEventListener('pointerdown', (e) => { e.preventDefault(); touch.throttle = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) gas.addEventListener(ev, () => { touch.throttle = false; }); }
// UC-41 the sales chat: what is on the visitor's page (relay rules.js readPage checks every field) and the two things it may do
window.HOC.salesPage = () => {
  const lot = show.slides[show.index], lotCar = lot && lot.def.kind === 'listing' ? lot.def.listing.key : null;
  const view = mode === 'drag' ? 'drag' : mode === 'drive' ? 'drive' : 'lot';
  const page = { view, car: view === 'drag' && race ? race.entry.name : lotCar };
  if (lastDrag) page.run = Object.fromEntries(Object.entries(lastDrag).filter(([, v]) => v !== null && v !== undefined));
  return page;
};
window.HOC.salesAct = (a) => {
  if (a.name === 'drag_race') { startDrag({ name: a.car, sim: true, drivable: true }).catch((e) => reportError(e)); return; }
  if (a.name === 'show_car') {
    const i = show.slides.findIndex((s) => s.def.kind === 'listing' && s.def.listing.key === a.car);
    if (i < 0) throw new Error('salesAct: ' + a.car + ' is not on the lot');
    if (mode !== 'show') backToShowroom();
    select(i); return;
  }
  throw new Error('salesAct: the page cannot ' + a.name);
};
window.HOC.dragBot = () => { if (race && race.kind === 'drag') { race.bot = true; armDrag(); } };   // the bot presses START too
// UC-45 AUTO (the owner 11-08: "add a button to go to automatic driving but when they press the button tell them that you can't have
// a leaderboard score in automatic mode that's cheating!"): the car drives itself, the house driver on the strip (both gearboxes, from
// wherever the run is) and the sim's driver on the circuit; the run is marked AUTO and never goes on a board or a record
function autoDrive() {
  const r = race;
  if (!r || r.selfDrive || r.online) return;
  if (r.kind === 'drag') { if (mode !== 'drag' || r.over || r.run.done) return; r.bot = true; if (!r.armed) armDrag(); }
  else { if (mode !== 'race') return; r.auto = AI.makeDriver(trackView.line, r.v); }
  r.selfDrive = true; syncAuto();
  const el = $('autonote');
  el.innerHTML = '<b>AUTO:</b> the car drives itself. You can\'t have a leaderboard score in automatic mode' + (r.kind === 'drag' && r.prizeOpen ? ', or the coffee' : '') + ': that\'s cheating!';
  el.hidden = false; clearTimeout(autoDrive.t); autoDrive.t = setTimeout(() => { el.hidden = true; }, 5000);   // AUTHORED: 5 s to read it
}
function syncAuto() {                                                  // UC-45 the button: there while a run can still be handed over
  const b = $('auto'), r = race, on = !!(r && r.selfDrive);
  b.hidden = !r || !!r.online || (r.kind === 'drag' && !on && (!!r.over || r.run.done));
  b.textContent = on ? 'AUTO ON' : 'AUTO'; b.setAttribute('aria-pressed', String(on)); b.disabled = on;
}
tapOn($('auto'), autoDrive);
// UC-22.1b the tree waits for the driver: the strip opens staged with the tree dark; START (Space or Enter) begins it
function armDrag() {                                                  // UC-42: online, only GO starts the tree
  if (!(mode === 'drag' && race && race.kind === 'drag') || race.armed || race.over || (race.online && !race.onlineGo)) return;
  race.armed = true; $('dstart').hidden = true; $('dprize').hidden = true; blip(audio, 'count'); if (race.opp && race.opp.say && race.opp.say.moment === 'stage') race.opp.say = null;
}
// UC-22.5 a run that failed (a stall, a red light): FAIL, why in a word, and one RESTART; the driving HUD goes
function showFail(r, why) {
  r.over = 'fail'; $('dstart').hidden = true; document.body.classList.add('dragover'); $('dfailw').textContent = why; $('dfail').hidden = false; blip(audio, 'count');
  if (r.online) sendOnlineFinish(r);                                   // UC-42.5 a stall or a red light is a finish too
  const o = r.opp, line = o && o.rival ? rivalSay(r, why === 'Stalled' ? 'stall' : 'red') : null;   // UC-38.4 the rival has a word
  $('dfailq').hidden = !line; $('dfailq').textContent = line ? o.rival.name + ': "' + line + '"' : '';
  lastDrag = { car: r.entry.name, foul: !!r.run.foul, stalled: why === 'Stalled', result: 'none', rival: o && o.rival ? { name: o.rival.name, car: o.rival.key } : null };   // UC-41 for the chat
}   // the page check: gas on the green, every shift at its derived point, through the same presses
window.HOC.dragTick = (dt) => tickDrag(dt);                                      // the page check steps frames itself (a background page draws few)
function dragPress(dir, bot = false) {
  if (!(mode === 'drag' && race && race.kind === 'drag' && !race.run.done) || (race.selfDrive && !bot)) return;   // UC-45: under AUTO only the house driver shifts
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
    '<rect x="2" y="2" width="96" height="96" rx="12" fill="url(#gplate)" opacity=".45"/><rect x="2" y="2" width="96" height="96" rx="12" fill="url(#gbrush)"/>' +   // see-through (11-08, RJ: "increase transparency")
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
// UC-34.1d a computer's clutch is the mouse wheel (drag_sim.js wheelDepth: down presses it in, and it stays where the wheel leaves it)
// and its gas a held mouse button on the strip's picture, either one (the owner 11-08: "lets use the mousewheel as the clutch, left
// right click as gas"); the mouse also drags the gate's knob
const mouseGas = new Set();
addEventListener('wheel', (e) => {
  if (!(mode === 'drag' && race && race.clutchMode && race.pedal) || race.over || race.bot) return;
  if (e.target.closest && e.target.closest('#dslip, header, #salechat')) return;
  e.preventDefault(); race.pedal.wheel = true; race.pedal.depth = Sim.wheelDepth(race.pedal.depth, e.deltaY, e.deltaMode);
}, { passive: false });
// capture phase: the gate's own handler redraws it (drawGate sets innerHTML), which detaches the element the press landed on, and a
// detached target is in no #dgate any more, so a knob press read as gas (measured 11-08: throttle 0.99 while dragging the knob)
addEventListener('pointerdown', (e) => {
  if (!(mode === 'drag' && race) || e.pointerType !== 'mouse' || (e.button !== 0 && e.button !== 2) || race.over) return;
  if (e.target.closest && e.target.closest('button, a, input, #dslip, #dgate, header, #salechat')) return;
  mouseGas.add(e.button); e.preventDefault();
}, true);
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => { if (e.pointerType === 'mouse') mouseGas.delete(e.button); });
addEventListener('blur', () => mouseGas.clear());
addEventListener('contextmenu', (e) => { if (mode === 'drag') e.preventDefault(); });   // the right button is gas on the strip

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
  gt.addEventListener('pointerdown', (e) => { if (!(race && race.clutchMode) || race.run.done || race.selfDrive) return; e.preventDefault(); gt.setPointerCapture(e.pointerId); dragging = true; at(e); });
  gt.addEventListener('pointermove', (e) => { if (dragging) at(e); });
  for (const ev of ['pointerup', 'pointercancel']) gt.addEventListener(ev, () => { dragging = false; if (race && race.gate) { race.gate.knob = Sim.knobFor(race.gate.gear, race.gate.layout); drawGate(race); } }); }
function syncDragBox() { $('dbox').textContent = DRAGBOX.clutch ? 'Clutch on' : 'Clutch off'; $('dbox').setAttribute('aria-pressed', String(DRAGBOX.clutch)); }
function toggleDragBox() { DRAGBOX.clutch = !DRAGBOX.clutch; try { localStorage.setItem('hoc.gearbox', DRAGBOX.clutch ? 'clutch' : 'paddles'); } catch (e) { /* not kept */ } syncDragBox(); dragRerun(); }   // a new run with the other gearbox
// UC-22.1b alt 3: a race button pressed while the other hand holds the clutch. A phone does not make a click of a second finger's
// tap while the first holds the slider (measured 11-08: START stayed up, the slider's finger let go, the car stalled), so each
// pointer's own press and lift on the button is the press: down and up on it, any finger, not cancelled (a scroll cancels it).
// The keyboard's click (Enter or Space on the focused button) still counts
function tapOn(el, fn) {
  const down = new Set();
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; e.preventDefault(); down.add(e.pointerId); });
  el.addEventListener('pointerup', (e) => { if (down.delete(e.pointerId)) fn(); });
  el.addEventListener('pointercancel', (e) => down.delete(e.pointerId));
  addEventListener('pointerup', (e) => { if (!el.contains(e.target)) down.delete(e.pointerId); }, true);   // a mouse's one id, let go elsewhere
  el.addEventListener('click', (e) => { if (e.detail === 0) fn(); });
}
$('dbox').addEventListener('click', toggleDragBox); syncDragBox(); tapOn($('dstart'), () => armDrag()); tapOn($('dfailr'), () => dragRerun());
window.HOC.dragBox = DRAGBOX;
window.HOC.audio = audio;                                                     // the page check: the stick's sounds loaded (UC-34 4b)
function dragRerun() {
  if (race && race.kind === 'drag' && race.online) { openOnline().catch((e) => reportError(e)); return; }   // UC-42: a rematch online is a new challenge in the lobby
  if (race && race.kind === 'drag') startDrag(race.entry, { rematch: true }).catch((e) => reportError(e));   // UC-38: the same rival
}
function fmt(s, d = 3) { return s === null || s === undefined ? '--' : s.toFixed(d); }
function tickDrag(dt) {
  const r = race, v = r.v, c = v.cfg, run = r.run;
  const raw = readInput();
  // the pad's shift buttons, edges only: RB up, Y down (no Unreal binding: the page's own)
  const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected && p.mapping === 'standard') : null;
  if (pad) { for (const [b, dir] of [[5, 'up'], [3, 'down']]) { const d = !!(pad.buttons[b] && pad.buttons[b].pressed); if (d && !r.padPrev[b]) dragPress(dir); r.padPrev[b] = d; } }
  const finished = run.done;
  if (r.bot && !r.clutchMode && run.green !== null && !finished) { raw.throttle = 1; const gg = v.trans.target; if (gg >= 1 && gg < c.trans.forward.length && v.trans.current === gg && v.trans.engineRPM >= r.pts[gg - 1] && !r.presses.length) dragPress('up', true); }
  if (r.clutchMode) {                                                  // UC-34: the pedal springs up when let go; the bot drives it
    // UC-34.1e a pad's left trigger is the clutch here (a phone's left pedal, labelled "Brake / clutch" by index.html for PhonePad): a drag
    // car has no use for the brake before the line, and a manual car's left pedal is its clutch. The pad holds the pedal where it is
    // pressed and lets it up when let go; its trigger is then not also the brake (the keys' S and the down arrow still are)
    // PAD_CLUTCH_FULL (AUTHORED): a press of 90 % of the trigger or more is the pedal on the floor. A thumb on the phone's pedal tops
    // out at 0.955 (MEASURED 11-09, test/phone_drive.py), and the clutch at 0.955 still passes 4.5 % of the engine's torque: in first at
    // full gas the E 63 S crept 3.6 m in 3 s, the i8 3.0 m, the Wraith 2.0 m (MEASURED, node, the sim's own cars): past the 1 ft
    // roll-out, a red light on the tree. Below it the pedal follows the trigger in proportion
    const padClutch = !r.bot && !finished && pad && pad.buttons[6] ? Math.min(1, pad.buttons[6].value / PAD_CLUTCH_FULL) : 0;
    if (r.bot && !finished) botClutch(r, raw, dt);
    else if (padClutch > 0 || r.pedal.pad) { r.pedal.depth = padClutch; r.pedal.pad = padClutch > 0; raw.brake = keys.has('KeyS') || keys.has('ArrowDown') || touch.brake ? 1 : 0; }
    else if (!r.pedal.held && !r.pedal.wheel) r.pedal.depth = Sim.pedalRelease(r.pedal.depth, dt);   // a wheel-set pedal stays
    if (finished) r.pedal.depth = 1;                                   // past the line the clutch goes in: it coasts, it cannot stall
    if (r.pedal.depth >= 0.5 && r.pedal.prev < 0.5 && r.gate.gear >= 1) r.cut = { gear: r.gate.gear, rpm: v.engine.rpm };   // the drive cut: the shift's rpm
    if (r.pedal.depth >= 0.98 && r.pedal.prev < 0.98 && !finished) sfx(audio, 'clutch_floor', 0.45, 0.7);   // UC-34 4b the pedal at the floor
    r.pedal.prev = r.pedal.depth; drawPedal(r);
    if (v.stalled && !r.over) showFail(r, 'Stalled');                 // UC-34.3a a lost run
  }
  // past the line the car shuts down: off the gas, coasting on its own READ idle brake and engine braking, and only below 30 km/h
  // the brake (AUTHORED): a brake press at speed is a FULL brake in Unreal's reverse-as-brake model, the wheels locked (no ABS) and
  // the tyre smoke filled the screen (11-06)
  const shut = finished && v.forwardSpeedCmS * 0.036 < 30;
  if (r.selfDrive) { raw.brake = 0; raw.steering = 0; if (!r.clutchMode && run.green === null) raw.throttle = 0; }   // UC-45 AUTO: the visitor's keys do not drive (the house driver sets the gas)
  const input = { throttle: finished ? 0 : raw.throttle, brake: finished ? (shut ? 1 : 0) : raw.brake, steering: raw.steering, handbrake: 0, transmission: 'manual' };
  if (r.clutchMode) { input.clutch = r.pedal.depth; input.gear = r.gate.gear; input.road = r.road; }   // UC-40 the wet or dry curve   // UC-34 (chaos_vehicle.js A11)
  acc += Math.min(dt, 0.1);
  let stepped = 0, crossed = false;                                    // UC-44.4: the physics time this frame ran, and the line crossed in it
  while (acc >= STEP) {
    const p = r.presses.shift(), gear = v.trans.target, rpm = v.trans.engineRPM;
    if (p === 'up' && gear >= 1 && gear < c.trans.forward.length) { gradeShift(r, gear, rpm); sfx(audio, 'gear_in_' + (1 + Math.floor(Math.random() * 3)), 0.7); }
    const took = r.tape && !run.done ? Replay.recordStep(r.tape, input, p, r.armed) : Object.assign({}, input, { gearUp: p === 'up', gearDown: p === 'down' });   // UC-46: recorded as the sim takes it
    Chaos.stepVehicle(v, took, STEP, r.strip);
    const ev = Drag.tick(run, { dt: r.armed ? STEP : 0, distM: (v.pos[0] - r.x0) / 100, speedKmh: v.forwardSpeedCmS * 0.036, rpm: v.trans.engineRPM, gear: v.trans.target, maxRPM: c.engine.maxRPM });
    for (const e of ev) {
      if (e === 'green') blip(audio, 'go');
      if (e === 'red') blip(audio, 'count');
      if (e === 'finish') crossed = true;
    }
    r.now += STEP; acc -= STEP; stepped += STEP;
  }
  // UC-44.4 an upshift heard: the sim's gear went up this frame (the crack as loud as the revs it left)
  if (v.trans.target > r.fxGear && r.fxGear >= 1) crack(audio, r.fxRpm01);
  r.fxGear = v.trans.target; r.fxRpm01 = v.engineRPM / c.engine.maxRPM;
  // the tree
  const T = r.armed ? run.tree : { prestage: false, stage: false, ambers: 0, green: false, red: run.tree.red };   // UC-22.1b dark until START
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
  if (r.opp) { placeOpponent(r); rivalTalk(r); }                         // UC-38
  if (r.online && online) online.sendPose({ t: run.t, pos: v.pos, axes: [0, 1, 2].map((j) => [v.rot[0][j], v.rot[1][j], v.rot[2][j]]), w: v.wheels.map((ws) => [ws.steerDeg, ws.spinRad, ws.suspensionOffsetCm]) });   // UC-42.4 (20 a second at most, online.js)
  if (!$('dkeys').hidden && r.armed && r.run.t > 3) $('dkeys').hidden = true;   // UC-34.1d the controls go 3 s after START
  const cam = r.camera, rig = updateRig(r.rig, v.pos, [X, Y, Z], dt);     // the chase rig runs either way, so C switches back to it settled
  const sf = stepSpeedFx(r.speedfx || (r.speedfx = makeSpeedFx()), v.forwardSpeedCmS * 0.036, dt, MOTION.on);   // UC-33.1 / 33.4
  // UC-44.4 the camera's answer to the car (drag_fx.js stepKick): its acceleration measured off the sim over the physics time this frame
  // ran (the launch, the clutch biting after a shift), the share of the driven tyres the sim says are spinning, the revs on the line
  const driven = v.w.map((w, i) => (w.engine ? i : -1)).filter((i) => i >= 0);
  const spin = driven.filter((i) => v.wheels[i].slipping && v.wheels[i].inContact).length / driven.length;
  const kick = stepKick(r.kick, { accel: frameAccel(r.fxSpeed, v.forwardSpeedCmS, stepped), spin, rpm01: v.engineRPM / c.engine.maxRPM, throttle: r.throttle, standing: run.leave === null }, dt, MOTION.on);
  if (stepped > 0) r.fxSpeed = v.forwardSpeedCmS;
  r.kickOut = kick;                                                     // the page check reads what the camera was given
  const B = r.body, centre = [0, 1, 2].map((k) => v.pos[k] + X[k] * B.origin[0] + Y[k] * B.origin[1] + Z[k] * B.origin[2]);
  stepDirector(r.director, { left: run.leave !== null, distM: (v.pos[0] - r.x0) / 100, carX: centre[0], quarterX: Drag.MARKS.quarter * 100 }, dt);   // UC-35.1-4
  r.shot = DRAGCAM.film ? shotId(r.director) : 'chase';
  if (DRAGCAM.film) {
    const f = framing(r.director, { c: centre, len: B.box_extent[0] * 2, halfWidth: B.box_extent[1], height: B.box_extent[2] * 2 }, { laneY: DRAG_LANE_Y_CM, quarterX: Drag.MARKS.quarter * 100, aspect: cam.aspect,
      other: r.opp && r.opp.centre ? { c: r.opp.centre, len: B.box_extent[0] * 2, halfWidth: B.box_extent[1], height: B.box_extent[2] * 2 } : undefined });   // UC-38.3: both cars while near
    cam.position.fromArray(toThreePoint(f.eye)); cam.up.set(0, 1, 0); cam.lookAt(...toThreePoint(f.look));
    const kw = f.mounted ? 1 : KICK.FIXED_SHARE;                       // UC-44.4 the kick: whole riding with the car, half standing beside it (its lens punches in)
    cam.fov = verticalFor(f.hfovDeg + (f.mounted ? sf.fovDeg : 0) + kickLens(kick.fovDeg, f.mounted), cam.aspect);   // UC-35.3b: a camera riding with the car widens and shakes with it
    if (f.mounted) { cam.rotateX(sf.pitchDeg * DEG); cam.rotateZ(sf.rollDeg * DEG); cam.rotateY(sf.yawDeg * DEG); }
    cam.rotateX(kick.pitchDeg * kw * DEG); cam.rotateZ(kick.rollDeg * kw * DEG); cam.rotateY(kick.yawDeg * kw * DEG);
  } else {
    cam.position.fromArray(toThreePoint(rig.eye)); cam.up.set(0, 1, 0); cam.lookAt(...toThreePoint(rig.look));
    cam.fov = verticalFovDeg(r.fov + sf.fovDeg + kick.fovDeg, cam.aspect); cam.rotateX((sf.pitchDeg + kick.pitchDeg) * DEG); cam.rotateZ((sf.rollDeg + kick.rollDeg) * DEG); cam.rotateY((sf.yawDeg + kick.yawDeg) * DEG);
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
  drawTraction(r);                                                      // UC-39
  const g = v.trans.target, sl = g >= 1 && g < c.trans.forward.length ? Drag.shiftLight(v.engineRPM, r.pts[g - 1]) : { fill: 0, shift: false };
  const leds = document.querySelectorAll('#dleds i'), lit = Math.round(sl.fill * leds.length);
  leds.forEach((el, i) => { el.classList.toggle('on', i < lit); el.classList.toggle('flash', sl.shift); });
  $('hud-speed').querySelector('#shift').classList.toggle('on', sl.shift);
  // the slip, once, at the line
  // filmed, it waits for the finish camera to see the car through the line and past it (about a second, UC-35.4)
  if (crossed) finishMoment(r);                                         // UC-44.4 the line
  if (run.done && !r.slipShown && !r.over && (!DRAGCAM.film || r.shot === 'roll') && !(r.fin && r.fin.hold > 0)) { r.slipShown = true; if (run.foul) showFail(r, 'Red light: gone before the green'); else showDragSlip(r); }   // UC-22.5
  laySkids(trackView.skids, v, Y, r.wheelWidths, dt, { smoke: false, markAlpha: DRAG_MARK_ALPHA });   // UC-44.4 the strip's smoke is its own (below)
  // UC-44.4 tyre smoke from each driven tyre the sim says is spinning (drag_fx.js emitSmoke), as hard as it slides, thrown back along the car
  if (stepped > 0) {
    const fwd = toThreeDir(X), carVel = toThreeDir(v.vel).map((x) => x / 100), P = dragView.smoke.pool;
    for (const i of driven) {
      const ws = v.wheels[i];
      if (!ws.inContact || !ws.contactCm || !ws.slipping) { P.acc[i] = 0; continue; }
      emitSmoke(P, i, toThreePoint(ws.contactCm), fwd.map((x) => x * ws.slipCmS / 100), carVel, slideAmount(ws), stepped, Math.random);
    }
  }
  cam.updateMatrixWorld(); dragView.smoke.update(cam, dt);
  r.throttle += (input.throttle - r.throttle) * Math.min(1, dt * 8);
  const slide = v.wheels.reduce((a, w) => a + slideAmount(w), 0) / v.wheels.length;
  driveSound(audio, { rpm: v.engineRPM, throttle: r.throttle, speedCmS: v.forwardSpeedCmS, slide, gear: v.gear, running: true });
  // UC-44.4 the held frame at the line (drag_fx.js FINISH): the crossing frame stays on screen as a copy (#dphoto) and nothing is drawn
  // under it while it holds; a resize ends it (the copy would be stretched)
  const F = r.fin;
  if (F && F.hold > 0 && F.drawn) { F.hold -= dt; if (canvas.width !== F.w || canvas.height !== F.h) F.hold = 0; if (F.hold > 0) return; $('dphoto').hidden = true; }
  rainDay.frame(cam, dt);                                               // UC-40: the rain around this camera, the sun on its screen
  r.post.render();
  if (F && !F.drawn) { F.drawn = true; if (F.hold > 0) holdPhoto(); }
}
// the crossing frame copied off the canvas in the task that drew it, while the browser still holds it (WebGL's drawing buffer and
// WebGPU's current texture are only readable then): what a held canvas shows when nothing is drawn depends on how the browser presents
// it (measured 11-08: WebGL 2 kept an older frame), a copy does not
function holdPhoto() {
  const p = $('dphoto');
  if (p.width !== canvas.width || p.height !== canvas.height) { p.width = canvas.width; p.height = canvas.height; }
  p.getContext('2d').drawImage(canvas, 0, 0); p.hidden = false;
}
// UC-44.4 / 44.5 the line: the frame the visitor's car crosses it is held (drag_fx.js FINISH) with a flash and the result over it, who
// crossed first and by how much (dragResult: the two slips on the run's clock), and a win or a loss heard. A red light holds nothing:
// the fail panel says it (showFail)
const DRAG_MARK_ALPHA = 0.55;                                          // AUTHORED: the strip's rubber at full slide (the circuit's 0.34 vanished on the wet launch pad)
function finishMoment(r) {
  const s = Drag.slip(r.run), res = dragResult(r, s);
  r.fin = { res, hold: s.foul ? 0 : FINISH.hold_s, drawn: false, w: canvas.width, h: canvas.height };
  if (s.foul) return;
  const W = autoWords(r, verdictWords(res, r.online ? r.online.name : r.opp && r.opp.rival ? r.opp.rival.name : null));
  $('dfinv').textContent = W.head; $('dfinl').textContent = W.line; $('dfinet').textContent = fmt(s.quarter_s) + ' s @ ' + Math.round(s.quarter_kmh) + ' km/h';
  $('dfin').className = 'v-' + res.kind; $('dfin').hidden = false; document.body.classList.add('dragfin');
  if (MOTION.on && !REDUCED) { const f = $('dflash'); f.style.animationDuration = FINISH.flash_s + 's'; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }   // the photo's flash: not with Motion off
  blip(audio, res.kind === 'win' ? 'best' : res.kind === 'lose' ? 'lose' : 'lap');
}
// UC-39 the traction bar (traction.js reads the driven tyres off the sim: left of the band the engine bogs, in it the tyres grip,
// right of it they spin). Shown for the launch: staging, and until a second past 60 ft
function drawTraction(r) {
  const el = $('dtrac'), run = r.run, t = traction(r.v), on = !run.done && (run.marks.sixty === undefined || run.t - run.leave - run.marks.sixty < 1);
  el.classList.toggle('on', on);
  if (!on || t.bar === null) return;
  // three fixed zones (AUTHORED: thirds), the marker by the measure each uses: bogging, the revs against the car's bog rpm (its
  // torque curve's peak); gripping, the drive asked against the tyres' grip (bar + 1, 0..1) and slip within the threshold;
  // spinning, the slip past the threshold up to the bar's end
  const c01 = (q) => Math.max(0, Math.min(1, q));
  const x = t.state === 'bog' ? 0.33 * c01(t.rpm / t.bogRPM)
    : t.state === 'spin' ? 0.67 + 0.33 * c01((t.bar - 1) / Math.max(1e-6, t.barRange[1] - 1))
    : 0.33 + 0.34 * c01(t.bar < 0 ? t.bar + 1 : 1);
  el.style.setProperty('--x', x.toFixed(3)); el.style.setProperty('--lo', '0.33'); el.style.setProperty('--hi', '0.67');
  el.dataset.state = t.state;
  $('dtracw').textContent = t.state === 'spin' ? 'WHEELSPIN' : t.state === 'bog' ? (t.stalled ? 'STALLED' : 'BOGGING') : t.state === 'grip' ? 'HOOKED' : 'TRACTION';
}
// UC-38 the other lane's car at the run's clock: between the two recorded poses either side of it (positions blended, the axes and
// the wheels the nearer one's), moved to the other lane; the last pose once the recording ends
function placeOpponent(r) {
  const o = r.opp, rec = o.rec, g = r.run.greenAt, late = o.rival ? o.rival.reaction : 0;
  const t = late && g !== undefined && g !== null && r.run.t > g ? Math.max(g, r.run.t - late) : r.run.t;   // UC-38.2 a human reaction after the green
  while (o.i < rec.length - 2 && rec[o.i + 1].t <= t) o.i++;
  const a = rec[o.i], b = rec[Math.min(o.i + 1, rec.length - 1)], u = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0, n = u < 0.5 ? a : b;
  const pos = [0, 1, 2].map((k) => a.pos[k] + (b.pos[k] - a.pos[k]) * u + (k === 1 ? o.laneShift : 0));
  o.car.group.matrix.fromArray(threeMatrixFromAxes(n.axes, [1, 1, 1], pos));
  o.car.wheels.forEach((w, i) => { if (w) poseWheel(w, n.w[i][0], n.w[i][1], n.w[i][2]); });
  const B = o.body || r.body, X = n.axes[0], Y = n.axes[1], Z = n.axes[2];
  o.centre = [0, 1, 2].map((k) => pos[k] + X[k] * B.origin[0] + Y[k] * B.origin[1] + Z[k] * B.origin[2]);
  o.distM = (pos[0] - o.x0) / 100;                                     // along the strip from its own staged nose, as the player's
}
// UC-38 the rival's car and run: its own READ car file and body, staged in the left lane as the player's car is, its house run on the
// same road (drag.js houseRun, DERIVED) recorded for the replay, shown 12 m to the right. finishT: when it crosses the quarter on the
// run's clock, its reaction included
async function stageCar(key, gravity, strip) {                        // a lot car staged in the left lane, settled, as the player's is
  wantModel(key);
  const rJson = await fetchJson('sim_cars/' + key + '.json'), unexported = await fetchJson('sim_cars/' + key + '.unexported.json');
  const opts = { gravityZ: gravity, unexported, angularDampingOnGround: RULES.angular_damping.on_ground, angularDampingInAir: RULES.angular_damping.in_air };
  const B = rJson.bounds_cm.value, stage = [-(B.origin[0] + B.box_extent[0]), DRAG_LANE_Y_CM, 60];
  const v = Chaos.makeVehicle(rJson, opts); Chaos.resetVehicle(v, stage, 0);
  for (let i = 0; i < 240; i++) Chaos.stepVehicle(v, { throttle: 0, brake: 0, steering: 0, handbrake: 0, transmission: 'manual' }, STEP, strip);
  return { rJson, B, v, x0: v.pos[0] };
}
async function rivalRun(rival, gravity, strip, houseOpts) {
  const key = rival.key, { rJson, B, v, x0 } = await stageCar(key, gravity, strip);
  const rec = [], run = Drag.houseRun(Chaos, v, strip, rec, houseOpts);
  const body = await simBody(key, rJson); body.group.matrixAutoUpdate = false; trackView.scene.add(body.group);
  const fin = rec.find((p) => (p.pos[0] - x0) / 100 >= Drag.MARKS.quarter);
  if (!fin) throw new Error('rivals: the ' + key + ' house run never reached the quarter mile in its recording');
  return { car: body, rec, i: 0, laneShift: -2 * DRAG_LANE_Y_CM, rival, x0, body: B, slip: run.slip, finishT: fin.t + rival.reaction, distM: 0, lead: null, lines: 0, said: [], say: null };
}
// UC-38.3 the rival talks: a taunt while staged (it stays until START), a line when the lead changes after the green (3 a run at
// most, one at a time), a word at the finish or a failure; shown in a bubble over its car
function rivalSay(r, moment) {
  const o = r.opp, line = rivalLine(o.rival, moment, r.entry.name);
  o.said.push(moment); o.say = { moment, line, until: moment === 'stage' ? Infinity : performance.now() + SAY_S * 1000 };
  $('dsayw').textContent = line;
  return line;
}
function rivalTalk(r) {
  const o = r.opp;
  if (!o.rival) return;
  if (!o.said.length && !r.armed) rivalSay(r, 'stage');
  if (r.run.green !== null && !r.run.done && !r.over && !(o.say && performance.now() < o.say.until)) {
    const L = leader((r.v.pos[0] - r.x0) / 100, o.distM);
    if (L && L !== o.lead) { if (o.lead && o.lines < 3) { rivalSay(r, L === 'rival' ? 'ahead' : 'passed'); o.lines++; } o.lead = L; }
  }
  const el = $('dsay'), on = !!(o.say && performance.now() < o.say.until && !r.over && mode === 'drag' && o.noRoom !== o.say);   // UC-49.4 a line with no room is held back
  el.hidden = !on;
  if (on && (o.placed !== o.say || !sayClear(el))) { o.placed = o.say; placeSay(r, el); }   // re-placed when the HUD moves onto it
}
// where a line goes, once per line: over the rival's car when that spot is clear of the HUD, else the clear spot nearest it, with no
// tail (11-08, a phone on its side: the car parks behind the times panel and the bubble covered it). Clear: 6 px from every HUD box
const HUD_BOXES = ['back', 'auto', 'dpanel', 'dleds', 'dtrac', 'dstart', 'dkeys', 'dcluster', 'dgate', 'dtree', 'dslider', 'dgas', 'dpedal', 'dgasm', 'dpedalk', 'dgasmk', 'hud-speed', 'dgrade', 'dhelp'];
// the HUD's boxes now (measured 11-08: placed once, the bubble sat on START and the controls on two phones, laid out after it)
const hudBoxes = () => HUD_BOXES.map((id) => document.getElementById(id)).filter((e) => e && !e.hidden && getComputedStyle(e).display !== 'none')
  .map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0);
const clearOf = (boxes, x0, y0, x1, y1) => x0 >= 8 && x1 <= innerWidth - 8 && y0 >= 52 && y1 <= innerHeight - 8 &&
  !boxes.some((b) => x0 < b.right + 6 && x1 > b.left - 6 && y0 < b.bottom + 6 && y1 > b.top - 6);
function sayClear(el) { const b = el.getBoundingClientRect(); return clearOf(hudBoxes(), b.left, b.top, b.right, b.bottom); }
// UC-49.4 a small phone (measured 11-09, test/layout9.py: at 740 x 360 the long line found no clear spot and its last resort, over the
// car, covered the Lot and AUTO buttons, the tree, the shift lights and START): the line is tried smaller and narrower first, and with
// no room even then it is held back, never laid over the HUD (the rival still has its word on the slip, rivalBlock)
function placeSay(r, el) {
  el.classList.remove('tight');
  let spot = saySpot(r, el);
  if (!spot) { el.classList.add('tight'); spot = saySpot(r, el); }
  if (!spot) { r.opp.noRoom = r.opp.say; el.hidden = true; return; }
  el.style.left = Math.round(spot.cx) + 'px'; el.style.top = Math.round(spot.top) + 'px'; el.classList.toggle('free', !spot.over);
}
function saySpot(r, el) {
  const w = el.offsetWidth, h = el.offsetHeight, W = innerWidth, H = innerHeight, boxes = hudBoxes();
  const clear = (cx, top) => clearOf(boxes, cx - w / 2, top, cx + w / 2, top + h);
  const p = new THREE.Vector3().setFromMatrixPosition(r.opp.car.group.matrix).project(r.camera);
  const seen = p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1, ax = (p.x + 1) / 2 * W, ay = (1 - p.y) / 2 * H - 60;
  let best = seen && clear(ax, ay - h) ? { cx: ax, top: ay - h, over: true } : null;
  if (!best) for (let gy = 0.1; gy <= 0.75; gy += 0.025) for (let gx = 0.08; gx <= 0.92; gx += 0.02) {
    const cx = gx * W, top = gy * H;
    if (!clear(cx, top)) continue;
    const d = seen ? (cx - ax) ** 2 + (top + h - ay) ** 2 : (cx - W / 2) ** 2 + (top - H * 0.2) ** 2;
    if (!best || d < best.d) best = { cx, top, over: false, d };
  }
  return best;
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
    else if (f === 'rpm') st['text:' + t.id] = Math.round(v.engineRPM).toLocaleString('en-CA') + ' RPM';   // a cluster with no tachometer (the Rolls-Royces)
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
  const isBest = !s.foul && !r.selfDrive && s.quarter_s !== null && writeDragBest(key, s.quarter_s);   // UC-45.2: an AUTO run is not the visitor's best
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
// UC-38.4 the rival on the slip: who crossed the quarter first on the run's clock (reaction and ET both count), its reaction and
// its 1/4 mile, and its word; also what the sales chat is told about the run (UC-41)
let lastDrag = null;
// UC-42 race someone online (online.js, loaded only when asked: it fetches Trystero from jsDelivr, so a static import would take the
// page down with the CDN). The other lane is the other driver's own car, its poses streamed onto race.opp.rec for placeOpponent;
// START becomes the lobby's Ready and GO starts both trees; at the line each sends its slip and both learn who won
let online = null;
const ONLINE_APP = 'houseofcars-drag-1';
function onlineSay(t) { $('donlinemsg').textContent = t; }
async function openOnline() {
  $('donline').hidden = false;
  if (online) return;
  const box = $('donlinebox'), me = race && race.kind === 'drag' && mode === 'drag' ? race.entry.name : null;
  if (!me || !RIVAL_CARS.includes(me)) { onlineSay('Take one of the lot\'s cars to the strip first.'); return; }
  let Online;
  try { Online = await import('./online.js'); } catch (e) { onlineSay('The online lobby could not load: ' + e.message); return; }
  const nickname = await Online.askNickname(box);
  online = Online.createOnline({ appId: ONLINE_APP, nickname, car: me,
    onMatch: (m) => {
      if (!RIVAL_CARS.includes(m.car)) { onlineSay('Their car is not one of this lot\'s, so it cannot be drawn.'); return; }
      onlineSay(''); startDrag({ name: me, sim: true, drivable: true }, { online: m }).catch((e) => reportError(e));
    },
    onGo: () => { if (race && race.online) { race.onlineGo = true; armDrag(); $('donline').hidden = true; } },
    onPose: (p) => { if (race && race.online && race.opp) race.opp.rec.push(p); },
    onFinish: (f) => { if (!(race && race.online)) return; race.onlineResult = f; const el = document.querySelector('#dslip .rival'); if (el) el.outerHTML = onlineBlock(race);
      const vd = document.querySelector('#dslip .verdict'); if (vd) vd.outerHTML = verdictHTML(race, Drag.slip(race.run)); },   // UC-44.5 the verdict, once both times are in
    onLeave: (l) => { if (race && race.online && race.online.peerId === l.peerId) onlineSay((l.name || 'The other driver') + ' left' + (l.during === 'go' || l.during === 'racing' ? ': the run goes on alone.' : '.')); },
    onError: (e) => onlineSay('Online, ' + e.where + ': ' + e.message) });
  Online.mountLobby(box, online, { carName: (k) => SHORT[k] || k });
}
$('donlinebtn').addEventListener('click', () => openOnline().catch((e) => reportError(e)));
$('donlinex').addEventListener('click', () => { $('donline').hidden = true; });
function leaveOnline() { if (online) { online.leave(); online = null; } $('donlinebox').innerHTML = ''; onlineSay(''); $('donline').hidden = true; }
// the other driver's car staged in the left lane as the player's is (its READ car file and body), shown 12 m to the right; its first
// pose the staged one (placeOpponent reads rec[0]), the rest streamed
async function onlineOpp(m, gravity, strip) {
  const s = await stageCar(m.car, gravity, strip), v = s.v;
  const rec = [{ t: 0, pos: v.pos.slice(), axes: [0, 1, 2].map((j) => [v.rot[0][j], v.rot[1][j], v.rot[2][j]]), w: v.wheels.map((w) => [w.steerDeg, w.spinRad, w.suspensionOffsetCm]) }];
  const body = await simBody(m.car, s.rJson); body.group.matrixAutoUpdate = false; trackView.scene.add(body.group);
  return { car: body, rec, i: 0, laneShift: -2 * DRAG_LANE_Y_CM, rival: null, x0: s.x0, body: s.B, slip: null, finishT: null, distM: 0, lead: null, lines: 0, said: [], say: null };
}
function sendOnlineFinish(r) {
  if (r.sentFinish || !online) return;
  r.sentFinish = true;                                                 // once: online.js throws on a second finish
  const s = Drag.slip(r.run);
  online.sendFinish({ reaction_s: s.reaction_s, sixty_s: s.sixty_s, eighth_s: s.eighth_s, quarter_s: s.quarter_s,
    quarterAt: r.run.move !== null && r.run.quarterAt !== null ? r.run.move + r.run.quarterAt : null, foul: !!r.run.foul });   // the run's clock at the line
}
function onlineBlock(r) {
  const n = esc(r.online.name), f = r.onlineResult, car = esc(SHORT[r.online.car] || r.online.car);
  if (!f) return '<div class="rival"><p class="kick">' + n + ' in the ' + car + '</p><p>Waiting for their time...</p></div>';
  const head = { win: 'You beat ' + n, lose: 'Beaten by ' + n, tie: 'A dead heat with ' + n, solo: n + ' left the race', none: 'Nobody reached the line' }[f.result] || esc(f.result);
  const t = f.theirs || {}, num = (x) => (typeof x === 'number' ? fmt(x) : '--');
  return '<div class="rival ' + (f.result === 'win' ? 'won' : f.result === 'lose' ? 'lost' : '') + '"><p class="kick">' + head + ' in the ' + car + '</p>' +
    '<p>' + n + ': reaction ' + num(t.reaction_s) + ' s · 1/4 mile ' + num(t.quarter_s) + ' s' + (typeof f.margin_s === 'number' ? ' · by ' + fmt(f.margin_s) + ' s' : '') + '</p>' +
    '<p class="q">' + esc(f.why || '') + '</p></div>';
}
function rivalBlock(r, s) {
  const o = r.opp;
  lastDrag = { car: r.entry.name, reaction: s.reaction_s, sixty: s.sixty_s, eighth: s.eighth_s, quarter: s.quarter_s, foul: !!s.foul, stalled: false, result: 'none', rival: null };
  if (r.online) { sendOnlineFinish(r); return onlineBlock(r); }        // UC-42.5 (a person's name never goes to the sales chat)
  if (!o || !o.rival) return '';
  // UC-44.5 the same result the verdict and the line show (dragResult). Was: against the rival's first RECORDED pose past the line (1/60 s
  // apart, up to one physics step late); now its own slip, at the physics' own step, as the visitor's
  const res = dragResult(r, s), won = res.kind === 'win', rs = o.slip, rt = rs.reaction_s === null ? null : rs.reaction_s + o.rival.reaction;
  const line = rivalSay(r, won ? 'lose' : 'win');
  lastDrag.result = won ? 'win' : 'lose'; lastDrag.rival = { name: o.rival.name, car: o.rival.key, quarter: rs.quarter_s };
  return '<div class="rival ' + (won ? 'won' : res.kind === 'tie' ? '' : 'lost') + '"><p class="kick">' + (won ? 'You beat ' : res.kind === 'tie' ? 'A dead heat with ' : 'Beaten by ') + esc(o.rival.name) + ' in the ' + esc(SHORT[o.rival.key]) + '</p>' +
    '<p>' + esc(o.rival.name) + ': reaction ' + (rt === null ? '--' : fmt(rt)) + ' s · 1/4 mile ' + (rs.quarter_s === null ? '--' : fmt(rs.quarter_s)) + ' s</p>' +
    '<p class="q">' + esc(o.rival.name) + ': "' + esc(line) + '"</p></div>';
}
// UC-44.5 who crossed first and by how much (drag_fx.js raceResult): the visitor's slip against the rival's own (its house run's slip, its
// driver's reaction added); online, the result the two pages agreed (online.js); alone, the time itself
function dragResult(r, s) {
  if (r.online) {
    const f = r.onlineResult;
    if (f && (f.result === 'win' || f.result === 'lose' || f.result === 'tie') && typeof f.margin_s === 'number') return { kind: f.result, margin_s: f.margin_s, holeshot: false, et: s.quarter_s };
    return raceResult(s, null);
  }
  const o = r.opp;
  return raceResult(s, o && o.rival ? { reaction_s: o.slip.reaction_s + o.rival.reaction, quarter_s: o.slip.quarter_s } : null);
}
// the slip's verdict: the result in a word, the margin, the time and the trap speed, big, above the table (UC-44.5)
// UC-45.2 an AUTO run: the house driver drove it, so the verdict is the car's (the strip agent's question 11-09: an AUTO run said YOU WIN)
function autoWords(r, W) { return r.selfDrive && W.head === 'YOU WIN' ? Object.assign({}, W, { head: 'AUTO WINS', note: 'The car drove itself: a win, but not yours to keep.' }) : W; }
function verdictHTML(r, s) {
  const res = dragResult(r, s), W = autoWords(r, verdictWords(res, r.online ? r.online.name : r.opp && r.opp.rival ? r.opp.rival.name : null));
  if (!W.head) return '';
  return '<div class="verdict v-' + res.kind + '"><b>' + esc(W.head) + '</b><span>' + esc(W.line) + '</span><p>' + fmt(s.quarter_s) + ' s @ ' + Math.round(s.quarter_kmh) + ' km/h · reaction ' +
    (s.reaction_s >= 0 ? '+' : '') + fmt(s.reaction_s) + '</p>' + (W.note ? '<p class="hs">' + esc(W.note) + '</p>' : '') + '</div>';
}
function showDragSlip(r) {
  const s = Drag.slip(r.run), b = r.best.slip;
  const dg = DRAGY.cars[r.entry.name], q = dg && dg.tests['1/4 mile'], e8 = dg && dg.tests['1/8 mile'], z = dg && dg.tests['0-100 km/h'];
  const own = (rec) => rec && rec.kind === 'READ' ? (rec.no_mods_listed || rec.all) : null;
  const ownQ = own(q), own8 = own(e8), ownZ = own(z);
  const row = (label, you, sim, owners) => '<tr><th>' + label + '</th><td>' + you + '</td><td>' + sim + '</td><td>' + owners + '</td></tr>';
  const kmh = (x) => (x === null || x === undefined ? '' : ' @ ' + Math.round(x) + ' km/h');
  const grades = s.shifts.map((x) => '<span class="g-' + x.grade.toLowerCase() + '">' + x.from + '→' + (x.from + 1) + ' ' + x.grade.toLowerCase() + '</span>').join('');
  r.over = 'slip'; document.body.classList.add('dragover');            // UC-22.5 the slip alone, RACE AGAIN on top of it
  $('dslip').innerHTML = '<div class="slipgo"><button class="act go" id="drerun">RACE AGAIN<small>R</small></button><button class="act" id="dlot">Lot<small>Esc</small></button></div>' +
    verdictHTML(r, s) + '<p class="kick">Time slip</p><h3>' + esc(r.title) + (r.selfDrive ? ' <span class="autotag">AUTO</span>' : '') + '</h3>' + rivalBlock(r, s) +
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
    sellHTML(r, s);
  $('dslip').hidden = false;
  tapOn($('drerun'), dragRerun); $('dlot').onclick = () => backToShowroom();
  $('dslip').querySelectorAll('button[data-dragto]').forEach((b) => { b.onclick = () => startDrag({ name: b.dataset.dragto, sim: true, drivable: true }).catch((e) => reportError(e)); });   // UC-23.3
  quarterBoard(r, s);
}
// UC-46 the coffee (the owner 11-08: "say if you get the top high score you win a free Tim Hortons coffee. Which will email me if it
// happens. Let them enter their email."). The words are the page's own; the prize is the page's maker's, not House of Cars' or Tim
// Hortons'. It is offered only while the board's server says it takes claims (tools/scores_server.gs), and only on a car for sale,
// whose run the owner can run again from its tape (tools/verify_claim.mjs) before the coffee goes out
const PRIZE = {
  tease: (t) => '&#9749; Beat <b>' + t.toFixed(3) + ' s</b> for a free Tim Hortons coffee',
  board: '&#9749; First place on this car\'s board wins a free Tim Hortons coffee from the maker of this page.',
  terms: 'Your email goes only to the maker of this page, to send the coffee: never on the board, never shared. Your run\'s replay is checked first. One coffee per person. Not from House of Cars or Tim Hortons.'
};
function prizeTease(r) {                                               // UC-46.1 while staged: the time to beat for the coffee
  const el = $('dprize'); el.hidden = true; r.prizeOpen = false;
  if (!r.entry.sim || r.online) return;
  SCORES.board('drag.' + r.entry.name).then(({ rows, claims }) => {
    if (race !== r || !claims) return;
    r.prizeOpen = true;
    if (r.armed) return;
    el.innerHTML = PRIZE.tease(ranked(rows, { name: HOUSE_NAME, score: r.house.slip.quarter_s }, true)[0].score); el.hidden = false;
  }, (e) => { el.dataset.why = e.message; });                         // no offer without the board; the slip's board block says why it could not be read (UC-25.3a)
}
// UC-25 this car's quarter-mile board, shared by everyone (scores.js): R.J.Thompson's house run first, then the names people save.
// A board that cannot be reached says so and keeps the run nowhere else (UC-25.3a); a red light never goes on it (UC-25.1a), nor a
// run the car drove itself (UC-45.2). UC-46.2: a run that takes first place claims the coffee
function quarterBoard(r, s) {
  const run = r.run, id = 'drag.' + r.entry.name, el = $('dboard');
  const house = { name: HOUSE_NAME, score: r.house.slip.quarter_s, kmh: r.house.slip.quarter_kmh, at: '' };
  const fmt = (x) => x.score.toFixed(3) + ' s' + (x.kmh ? ' @ ' + Math.round(x.kmh) + ' km/h' : '');
  const show = (rows, mine) => { $('dbrows').innerHTML = boardHTML(ranked(rows, house, true), fmt, mine); };
  const live = () => race === r && r.run === run;       // the slip still shows this run (not a rerun or another car)
  el.innerHTML = '<p class="kick">Quarter-mile board: everyone in this car</p><p id="dbprize" hidden>' + PRIZE.board + '</p><div id="dbrows"></div>' +
    '<form id="dbform" hidden><label for="dbname">Your name for the board</label><div><input id="dbname" maxlength="16" autocomplete="nickname" spellcheck="false"><button class="act go" type="submit">Save</button></div></form>' +
    '<form id="dbcoffee" hidden novalidate><label for="dbemail">First place! Your email, for the coffee</label><div><input id="dbemail" type="email" maxlength="120" autocomplete="email" spellcheck="false"><button class="act go" type="submit">Claim</button></div><p class="fine">' + PRIZE.terms + '</p></form>' +
    '<p id="dbmsg" aria-live="polite">Reading the board…</p>';
  show([]);
  const msg = (t) => { $('dbmsg').textContent = t; };
  SCORES.board(id).then(({ rows, claims }) => {
    if (!live()) return;
    show(rows);
    const prize = claims && !!r.tape;                                    // UC-46.1: the server takes claims and this run has a tape to check
    $('dbprize').hidden = !prize;
    if (r.selfDrive) { msg('AUTO: no leaderboard score' + (prize ? ' and no coffee' : '') + ' in automatic mode. That would be cheating!'); return; }   // UC-45.2
    if (s.foul || s.quarter_s === null) { msg(s.foul ? 'A red light does not go on the board.' : ''); return; }
    if (!qualifies(rows, house, true, s.quarter_s)) { msg(s.quarter_s < house.score ? '' : 'Beat ' + HOUSE_NAME + '’s ' + house.score.toFixed(3) + ' s: every shift on the light.'); return; }
    msg('You made the top ten.'); $('dbform').hidden = false;
    const box = $('dbname'); box.value = lastName(); box.focus(); box.select();
    $('dbform').onsubmit = (e) => {
      e.preventDefault();
      const c = checkName(box.value); if (!c.ok) { msg(c.why); return; }
      const entry = { name: c.name, score: Math.round(s.quarter_s * 1000) / 1000, kmh: Math.round(s.quarter_kmh * 10) / 10, at: new Date().toISOString() };
      $('dbform').hidden = true; msg('Saving…');
      SCORES.submit(id, entry).then((after) => {
        if (!live()) return; keepName(c.name); show(after, entry); msg('Saved. You are on the board.');
        const first = ranked(after, house, true)[0];
        if (prize && first && !first.house && first.name === entry.name && first.score === entry.score) coffee(r, id, entry, msg);   // UC-46.2 first place
      }, (err) => { if (!live()) return; $('dbform').hidden = false; msg(err.message + '. Not saved: try again.'); });
    };
  }, (e) => { if (live()) msg(e.message + '. Your run is not on it.'); });
}
// UC-46.2-3 first place: the visitor's email for the coffee, sent with the run's tape so the owner can run it again first
function coffee(r, id, entry, msg) {
  const tape = Replay.encode(r.tape);
  if (tape.length > Replay.TAPE.maxChars) { msg('First place! But this run\'s replay is too long to send (' + tape.length + ' characters), so it cannot be checked for the coffee.'); return; }
  const f = $('dbcoffee'), box = $('dbemail');
  f.hidden = false; msg('First place on this car. Claim your coffee:'); box.focus();
  f.onsubmit = (e) => {
    e.preventDefault();
    const c = checkEmail(box.value); if (!c.ok) { msg(c.why); return; }
    f.hidden = true; msg('Sending your claim…');
    SCORES.claim(id, { name: entry.name, score: entry.score, kmh: entry.kmh, email: c.email, tape }).then(
      () => { if (race === r) msg('Claimed! Your run\'s replay is checked, then ' + c.email + ' hears about the coffee.'); },
      (err) => { if (race !== r) return; f.hidden = false; msg(err.message + '. Not claimed: try again.'); });
  };
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
  const isBest = !r.selfDrive && lapS < bestBefore;                  // UC-45.2: an AUTO lap is not called a best
  const rec = readRecord(r.entry.name), isRecord = !r.selfDrive && (rec === null || lapS < rec);   // UC-45.2: a lap the car drove itself is never a record
  if (isRecord && writeRecord(r.entry.name, lapS)) $('t-rec').textContent = Rules.formatTime(lapS, RULES);
  if (isRecord) { const g = saveGhost(r.entry.name, r.rec, lapS); if (r.ghostPick === 'mine') { r.ghost = g; showGhostLine(r); } }
  r.rec = makeRecorder();                                // the next lap starts on the clock the rules just restarted
  const vs = r.ghost && r.ghostPick !== 'mine' ? (lapS <= r.ghost.lap ? 'You beat the ' : 'The ') + r.ghostLabel + (lapS <= r.ghost.lap ? ' by ' : ' was faster by ') + Math.abs(lapS - r.ghost.lap).toFixed(3) + ' s' : null;
  lapBanner($('lapb'), Rules.formatTime(lapS, RULES), bestBefore !== RULES.best_time_default.value ? lapS - bestBefore : null, isBest, [isRecord ? 'Record on this device' : null, r.selfDrive ? 'AUTO: not a record' : null, vs].filter(Boolean).join(' · ') || null);
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
await warmLot();                                         // UC-30: behind the loading screen
loadStage('open');                                       // UC-48: 100 % is the lot ready
lotFocus.active = true;                                  // GFX 11-08: the warm-up drew every piece in every pass; from here the reflection follows the view
mark('lot warmed');
loadingDone().then(() => { mark('lot open'); modelQ.open = true; pumpModels(); if (BACKEND !== 'WebGPU') gpuNotice().catch((e) => reportError(e)); if (onLot) window.dispatchEvent(new CustomEvent('hoc:lot-open')); });   // the sales chat (sales_chat.js) greets once the lot is open (a race or the strip opened by a link: when the visitor reaches the lot)   // UC-20.3: closes now, or when a player says; UC-31 then the notice, once the lot is in view
// UC-7.2a: the page lowers its own resolution when frames run steadily slow AND fewer pixels make them quicker (perf.js
// ResolutionGovernor: a step that buys no time is undone), raises it again when they are quick, and says which it chose
const governor = new ResolutionGovernor([0.75, 0.85, 1, 1.25, 1.5, 2].filter((x) => x <= Math.min(devicePixelRatio, 2) + 1e-6));
window.HOC.resolution = governor;                         // the page check and devtools: governor.log says what it did and why
function setQuality() { renderer.setPixelRatio(governor.ratio); resize(); $('quality').textContent = 'Resolution ' + governor.ratio + 'x'; }
function adapt(dt) { if (governor.frame(dt)) setQuality(); }
setQuality();
renderer.setAnimationLoop(() => {
  const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (mode === 'show') { padShow(); tickShow(dt); } else if (mode === 'walk') tickWalk(dt); else if (mode === 'drag') tickDrag(dt); else tickRace(dt);
  while (perfFirst.length) mark('first frame drawn with', perfFirst.shift() + ' (' + Math.round(performance.now() - t) + ' ms frame)');
  if (photoReq) takePicture();
  adapt(dt);
});
