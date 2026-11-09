// renderer.js - the game's WebGPU renderer (three.js WebGPURenderer from the CDN, three@0.175.0). The contract (PLAN.md):
//   const r = await createRenderer(canvas, { hud })  throws NoWebGpuError when the browser has no WebGPU (no WebGL stand-in);
//                                             hud: 'all' (default: HUD, menus and hero tags) or 'tags' (only the tags over the heroes,
//                                             for a page that draws its own HUD and menus)
//   r.setMatch(match, seats)                  on a new match; seats = HudViewModel.seatOfSlot (null: seat = slot), the seat each
//                                             player slot sits at, which picks its colour (a later view with other seats rebuilds)
//   r.frame(view, dt)                         each animation frame, dt = seconds since the last frame;
//                                             view = { match, controllers[], hud, menu, events[], alpha, camera? }; camera (the
//                                             page's, optional) = { humans: [slot], pointerSlot, cover: [DOMRect of each on-screen
//                                             control over the canvas], input: CameraRig.userInput's fields }; without it (or with
//                                             no human) the camera shows the whole island
//   r.screenTurn                              the camera's quarter turns (0 or 1): the page turns each stick with it
//   r.cameraReport()                          the free rect, the framed targets on screen, how tight, settled (the page check)
//   await r.settle()                          draw the match as it was set and wait for the GPU: its pipelines are built before play
//   r.resize(w, h)                            CSS pixels
//   r.screenshot()                            -> Promise<Blob> (the 3D frame with the HUD drawn over it)
// It reads the model and the view models and never changes them. A new level (the model swaps its board) is picked up by itself.
import * as THREE from 'three/webgpu';
import { uniform, pass, mrt, output, emissive, normalView, vec3, vec4, float, uv, length, smoothstep, oneMinus, mix, renderOutput, saturation,
         luminance, clamp, nodeObject } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import BloomNode from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { Phase, Occupant, WallBroken, CannonDestroyed, ShipSunk, Screen } from '../core/index.js';
import { GAME_TITLE } from '../app/title.js';
import { Board, BoardLook } from './board.js';
import { Units, gruntFigure, shipModel } from './units.js';
import { CameraRig, CameraDirector } from './camera.js';
import { Hud } from './hud.js';
import { Fx } from './fx.js';
import { Sky } from './sky.js';
import { PLAYER_CSS, PLAYER_HEX, PLAYER_COLOURS } from './look.js';
import { Models, tintArmour } from './models.js';
import { PropSet, SUN, SKY, sunDirection } from './look.js';

export { PLAYER_CSS, PLAYER_HEX };

/** The browser cannot run WebGPU: the page shows its notice; nothing else draws. */
export class NoWebGpuError extends Error {
  constructor(why) { super('WebGPU is not available: ' + why); this.name = 'NoWebGpuError'; }
}

/** A view handed to frame() that breaks the contract (a missing field, a match setMatch was not told about). */
export class RenderContractError extends Error {
  constructor(why) { super(why); this.name = 'RenderContractError'; }
}

const BG = 0x1f5f9e;                       // AUTHORED: the sea's far colour behind everything
// AUTHORED quality settings (Q on the keyboard switches; ?quality=low starts low). high: 4x MSAA, ambient occlusion, a 4096 shadow
// map, the sea's second wave octave, up to 2 device pixels per CSS pixel. low (slower GPUs): FXAA instead of MSAA, no AO, a 2048
// shadow map, one wave octave, 1 device pixel per CSS pixel.
const QUALITY = Object.freeze({
  high: { msaa: 4, ao: true, shadow: 4096, waterDetail: 1, maxPixelRatio: 2 },
  low: { msaa: 0, ao: false, shadow: 2048, waterDetail: 0, maxPixelRatio: 1 },
});
const EXPOSURE = 0.72;                     // AUTHORED: into the ACES filmic curve (three scales it by 1/0.6 inside)
// AUTHORED grade after the tone map (display values): a little more colour, a touch of contrast, shadows nudged cool and highlights
// warm, and the vignette's strength
const GRADE = { saturation: 1.12, contrast: 1.06, cool: [-0.012, 0.004, 0.03], warm: [0.035, 0.015, -0.02], vignette: 0.3 };
// AUTHORED ambient occlusion (GTAO, three's GTAONode): radius in world units (a square is 1), drawn at half resolution, and how much
// of it is applied (1 = all). Contact shading where walls, castles, cannons and figures meet the ground.
const BLOOM = { strength: 0.4, radius: 0.2, threshold: 0.6 };   // AUTHORED: over the glow target only
// AUTHORED (graphics round 3, perf): the bloom blurs BLOOM_MIPS of three's five mip levels, and the shadow map is drawn again every
// SHADOW_EVERY frames (the sun never moves; what moves is figures, a frame of shadow lag at 60 fps). Measured with
// tools/perf_battle.py --ablate (shots/aaa3/perf_*.txt): the bloom's 13 passes and the shadow pass were the two largest costs.
const BLOOM_MIPS = 3, SHADOW_EVERY = 2;

/** three's BloomNode with fewer blur levels: its passes cost more CPU than GPU here (13 renders a frame), and the two widest levels
 *  (1/16 and 1/32 of the screen) add a faint wide haze the game's small glows barely reach. The composite sums the levels kept,
 *  with three's own weights (lerpBloomFactor: mix(f, 1.2 - f, radius)) and the two dropped levels' share given to the widest kept. */
class LeanBloom extends BloomNode {
  constructor(input, strength, radius, threshold, mips) {
    super(input, strength, radius, threshold);
    if (!(mips >= 1 && mips <= 5)) throw new RenderContractError('LeanBloom: 1..5 blur levels, got ' + mips);
    this._nMips = mips;
  }
  setup(builder) {
    const out = super.setup(builder);
    const F = [1.0, 0.8, 0.6, 0.4, 0.2], tex = [this._textureNodeBlur0, this._textureNodeBlur1, this._textureNodeBlur2, this._textureNodeBlur3, this._textureNodeBlur4];
    const w = (f) => mix(float(f), float(1.2 - f), this.radius);
    let sum = null;
    for (let i = 0; i < this._nMips; i++) {
      let k = w(F[i]);
      if (i === this._nMips - 1) for (let j = this._nMips; j < 5; j++) k = k.add(w(F[j]));   // the dropped levels' weight
      const c = k.mul(tex[i]);
      sum = sum ? sum.add(c) : c;
    }
    this._compositeMaterial.fragmentNode = sum.mul(this.strength).context(builder.getSharedContext());
    this._compositeMaterial.needsUpdate = true;
    return out;
  }
}
const AO = { radius: 0.6, thickness: 1, scale: 0.5, strength: 0.85 };
const WIPE_SECONDS = 0.7;                  // AUTHORED: the light sweep across the picture when the phase or the menu screen changes
// the menu screens the game's island drifts behind on the low menu camera (camera.js); an untouched title that shows the demo full
// screen (menu.inDemo) is play, and keeps the game's camera
const DRIFT_SCREENS = new Set([Screen.Title, Screen.Setup, Screen.HighScores, Screen.Results, Screen.Initials]);
export async function createRenderer(canvas, opts = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new RenderContractError('createRenderer needs a <canvas>');
  if (!navigator.gpu) throw new NoWebGpuError('this browser has no navigator.gpu (Chrome or Edge 113+ on Windows, macOS or ChromeOS have it)');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new NoWebGpuError('the browser gave the page no graphics adapter (see chrome://gpu)');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new NoWebGpuError('three.js started its WebGL 2 backend, not WebGPU');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;                     // applied in the post chain (renderOutput), then the grade
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const models = await Models.load();                                     // the models; one that does not load stops here
  if (opts.quality !== undefined && !(opts.quality in QUALITY)) throw new RenderContractError("createRenderer: quality is 'high' or 'low', got " + opts.quality);
  const r = new Renderer(canvas, renderer, opts, models);
  r.warmUp();
  await renderer.backend.device.queue.onSubmittedWorkDone();             // the GPU has built what the warm-up asked for before play starts
  return r;
}

class Renderer {
  constructor(canvas, renderer, opts, models) {
    this.canvas = canvas; this.renderer = renderer; this.models = models;
    // the land's props, baked once (sizes in squares, AUTHORED): an oak with a bush at its foot, rocks. The normal rules clear these
    // squares at load (MatchModel.plain), so in this game the same models show as the board's decoration (Board.buildDecor).
    this.propParts = new Map([
      [Occupant.Tree, [...models.parts('oak', { height: 1.15 }), ...models.parts('bush', { width: 0.5, at: [0.26, 0.24] })]],
      [Occupant.RockSmall, models.parts('rockSmall', { width: 0.5 })],
      [Occupant.RockLarge, models.parts('rockLarge', { width: 0.95 })],
    ]);
    this.decorParts = { bush: models.parts('bush', { width: 0.45 }), rockSmall: models.parts('rockSmall', { width: 0.5 }),
                        rockLarge: models.parts('rockLarge', { width: 1.2 }), oak: models.parts('oak', { height: 1.3 }) };
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG);
    this.rig = new CameraRig(1);
    // light: the sun (soft shadows, PCFSoftShadowMap, its box fitted to each island in fitSun) and the sky's hemisphere fill
    const hemi = new THREE.HemisphereLight(SKY.sky, SKY.ground, SKY.intensity); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
    sun.castShadow = true; sun.shadow.mapSize.set(QUALITY.high.shadow, QUALITY.high.shadow); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    this.scene.add(sun, sun.target); this.sun = sun;
    this.look = new BoardLook();                                            // the land's and sea's materials, shared by every level
    this.scene.add(this.look.tufts);
    this.sky = new Sky(this.scene, this.look.noiseTex);                     // the dome, the haze and the cloud shadows (before any draw)
    this.fx = new Fx(this.scene, uniform(0));                               // the particles, shared by every level
    this.buildPost();
    // the HUD layer: a 2D canvas laid exactly over the WebGPU one
    const hc = document.createElement('canvas');
    hc.className = 'render-hud';
    hc.style.cssText = 'position:absolute;pointer-events:none;';
    if (!canvas.parentElement) throw new RenderContractError('the canvas must be in the page (the HUD layer sits beside it)');
    canvas.parentElement.appendChild(hc);
    this.hudCanvas = hc;
    this.hud = new Hud(hc, GAME_TITLE);
    if (opts.hud !== undefined && opts.hud !== 'all' && opts.hud !== 'tags') throw new RenderContractError("createRenderer: hud is 'all' or 'tags', got " + opts.hud);
    this.hudMode = opts.hud ?? 'all';
    this.board = null; this.units = null; this.match = null; this.grid = null; this.seatsKey = null;
    this.clock = 0;
    this.wipeKey = null; this.wipeT = WIPE_SECONDS;                         // what the last frame showed; seconds into the wipe
    this.setQuality(opts.quality ?? 'high'); this.toast = null;
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  /** The post chain. The scene pass writes three targets at once (MRT): the lit colour, what GLOWS (look.js glowing(): only those
   *  materials write it, so the bloom never catches a sunlit wall) and the view-space normal the ambient occlusion reads with the
   *  depth. colour x AO + bloom(glow), then a soft vignette. */
  buildPost() {
    const cam = this.rig.camera;
    this.post = new THREE.PostProcessing(this.renderer);
    this.post.outputColorTransform = false;                                // the tone map and sRGB happen inside the chain, before the grade
    this.grade = (hdr) => {
      let c = renderOutput(hdr).rgb;                                        // ACES filmic + sRGB
      c = saturation(c, GRADE.saturation);
      c = c.sub(0.5).mul(GRADE.contrast).add(0.5);
      const l = luminance(c);
      c = c.add(vec3(...GRADE.cool).mul(oneMinus(l))).add(vec3(...GRADE.warm).mul(l));
      const vig = oneMinus(smoothstep(0.45, 0.95, length(uv().sub(0.5))).mul(GRADE.vignette));
      return vec4(clamp(c, 0, 1).mul(vig), 1);
    };
    this.chains = { high: this.makeChain(QUALITY.high), low: this.makeChain(QUALITY.low) };
  }

  /** One post chain for a quality's settings (msaa, ao; bloom unless q.bloom === false). Also what tools/perf_battle.py --ablate
   *  builds its variants with, so a measured "without X" is the same chain with one stage left out, not a re-typed copy. */
  makeChain(q) {
    const cam = this.rig.camera, grade = this.grade;
    const sp = pass(this.scene, cam, q.msaa ? { samples: q.msaa } : {});
    // every chain writes the SAME targets: a material's shader is built for the targets of the pass that first drew it and three
    // r175 reuses it for the other pass, so a 2-target low chain made the 3-target high chain's pipelines invalid after Q, Q
    // (11-09: 111 "Invalid RenderPipeline" warnings and no picture, present since round 1)
    // (the AO cannot read its normals from the depth instead: three r175's GTAONode getNormalFromDepth calls textureDimensions on the
    // MULTISAMPLED depth, which WGSL refuses - 11-09, round 3: "no matching call to textureDimensions(texture_depth_multisampled_2d)")
    sp.setMRT(mrt({ output, emissive, normal: normalView }));
    sp.getTextureNode('normal'); sp.getTextureNode('emissive');          // a pass makes a target only when it is asked for one
    let lit = sp.getTextureNode('output').rgb;
    if (q.ao) {
      const aoPass = ao(sp.getTextureNode('depth'), sp.getTextureNode('normal'), cam);
      aoPass.resolutionScale = AO.scale; aoPass.radius.value = AO.radius; aoPass.thickness.value = AO.thickness;
      const z = sp.getViewZNode().negate();                              // the AO fades out into the haze (sky.js hazeAt)
      lit = lit.mul(mix(float(1), aoPass.getTextureNode().r, float(AO.strength).mul(oneMinus(this.sky.hazeAt(z)))));
    }
    if (q.bloom !== false) lit = lit.add(nodeObject(new LeanBloom(sp.getTextureNode('emissive'), BLOOM.strength, BLOOM.radius, BLOOM.threshold, q.bloomMips ?? BLOOM_MIPS)).rgb);
    const out = grade(vec4(lit, 1));
    return q.msaa ? out : fxaa(out);                                      // no MSAA: FXAA on the graded picture
  }

  /** The quality setting: 'high' or 'low' (QUALITY). Switches the post chain, the sea's detail and the pixel ratio; the shadow map's
   *  size is the starting quality's (?quality=low starts with the small one). */
  setQuality(name) {
    const q = QUALITY[name];
    if (!q) throw new RenderContractError("setQuality: 'high' or 'low', got " + name);
    this.quality = name;
    this.post.outputNode = this.chains[name]; this.post.needsUpdate = true;
    // the shadow map's size is chosen ONCE, by the quality the page starts with: resizing it under a running scene left the old
    // map bound for a frame (11-09: "Destroyed texture [4096x4096 Depth24Plus] used in a submit" after Q)
    if (this.shadowSize === undefined) { this.shadowSize = q.shadow; this.sun.shadow.mapSize.set(q.shadow, q.shadow); }
    this.look.uWaterDetail.value = q.waterDetail;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxPixelRatio));
    if (this.cssW) this.resize(this.cssW, this.cssH);
    this.toast = { text: 'GRAPHICS: ' + name.toUpperCase() + '  (Q to switch)', until: this.clock + 2.2 };
  }
  /** Q: high <-> low. */
  cycleQuality() { this.setQuality(this.quality === 'high' ? 'low' : 'high'); }

  /** The sun's shadow box fitted to the island: the board plus its decoration margin, from the ground to the tallest figure, seen
   *  from the sun; every texel of the shadow map lands on something the camera can show. */
  fitSun() {
    const w = this.grid.width, h = this.grid.height, M = 5, TOP = 3;          // AUTHORED: squares of sea round the board that cast
    const dir = sunDirection();                                               // (rock islets), tallest thing
    const centre = new THREE.Vector3(w / 2, 0, h / 2), far = Math.max(w, h) * 2;
    this.sun.position.copy(centre).addScaledVector(dir, far); this.sun.target.position.copy(centre);
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(this.sun.position, centre, new THREE.Vector3(0, 1, 0));
    view.setPosition(this.sun.position); view.invert();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const x of [-M, w + M]) for (const z of [-M, h + M]) for (const y of [-1, TOP]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(view);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    }
    const sc = this.sun.shadow.camera;
    sc.left = x0; sc.right = x1; sc.bottom = y0; sc.top = y1; sc.near = Math.max(0.1, -z1 - 1); sc.far = -z0 + 1;
    sc.updateProjectionMatrix();
  }

  /** Draw one of every model once, through the same passes a match draws with (shadow, scene, bloom), before the page starts: the
   *  GPU pipelines are built here, while the page is still loading, instead of in the first second of play (11-08: a 1.4 s stall
   *  there swallowed a short gamepad tap, and the page check's pad run failed). */
  warmUp() {
    const g = new THREE.Group(), m = this.models, pose = (fig, clip) => { fig.actions[clip].play(); fig.mixer.update(0.1); return fig.root; };
    const knight = m.figure('knight'); tintArmour(knight.root, PLAYER_COLOURS[0]);
    const items = [pose(knight, 'Combat_Stance'), pose(gruntFigure(m), 'Walking'), shipModel(m, false), shipModel(m, true), m.instance('castle'), m.instance('cannon')];
    items.forEach((o, i) => { o.position.set(i * 2, 0, 0); g.add(o); });
    let i = items.length;
    for (const parts of [...this.propParts.values(), ...Object.values(this.decorParts)]) {
      const b = new PropSet(g, parts, 1, { castShadow: true, receiveShadow: true, name: 'warm-up' });
      b.set(0, new THREE.Matrix4().makeTranslation(i++ * 2, 0, 0)); b.commit(1);
    }
    this.scene.add(g);
    const cam = this.rig.camera, was = cam.position.clone();
    cam.position.set(i, 6, 12); cam.lookAt(i, 0, 0);
    this.post.render();
    this.scene.remove(g);
    cam.position.copy(was);
    knight.mixer.stopAllAction();
  }

  /** One picture through the post chain: the shadow map is redrawn every SHADOW_EVERY-th call (and whenever asked: a new level,
   *  the warm-up), the rest of the chain every call. tools/perf_battle.py times this same call. */
  renderFrame() {
    const sh = this.sun.shadow;
    sh.autoUpdate = false;
    this.frameNo = (this.frameNo ?? -1) + 1;
    if (this.frameNo % (this.shadowEvery ?? SHADOW_EVERY) === 0) sh.needsUpdate = true;
    this.post.render();
  }

  /** Draw the level setMatch built, once, and wait until the GPU has done it: the page calls this before its loop starts, so the
   *  board's and figures' pipelines are built while it is still loading (a stall in the first second of play swallows input). */
  async settle() {
    if (!this.match) throw new RenderContractError('settle() needs a match: call setMatch first');
    this.post.render();
    await this.renderer.backend.device.queue.onSubmittedWorkDone();
  }

  /** The board square under a point of the page (CSS px, clientX/Y), through the live camera, or null when that point sees no
   *  ground (above the horizon, or no level yet). The ray meets the ground's own height (the land's relief, board.groundAtPoint),
   *  found by stepping from the sea plane: three steps settle it to well under a hundredth of a square. Squares off the board are
   *  returned as they are (the controller keeps a cursor on the map). */
  pickCell(clientX, clientY) {
    if (!this.board) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.rig.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y > -1e-6) return null;
    let h = 0, p = null;
    for (let i = 0; i < 3; i++) {
      const t = (h - o.y) / d.y;
      if (t < 0) return null;
      p = o.clone().addScaledVector(d, t);
      h = this.board.groundAtPoint(p.x, p.z);
    }
    return { x: Math.floor(p.x), y: Math.floor(p.z) };
  }

  /** Where the centre of square (x, y) is on the page (CSS px from the canvas's top-left), at the ground's height, through the live
   *  camera: the page check clicks the board with it. */
  screenOfCell(x, y) {
    if (!this.board) throw new RenderContractError('screenOfCell needs a level: call setMatch first');
    const v = new THREE.Vector3(x + 0.5, this.board.groundAt(x, y), y + 0.5).project(this.rig.camera);
    return { x: (v.x + 1) / 2 * this.cssW, y: (1 - v.y) / 2 * this.cssH };
  }

  /** The camera's quarter turns (camera.js lookOf): 1 = it looks east, so a stick's up must move the cursor east (main.js). */
  get screenTurn() { return this.rig.turn; }

  /** The free screen rect (CSS px): the canvas minus the HUD's top bar and its card row (Hud.matchLayout, the numbers it draws
   *  with) and minus each on-screen control (`cover`, DOM rects), each cut from the side that leaves the most area. */
  freeRect(view, cover) {
    const W = this.cssW, H = this.cssH, n = view.hud ? view.hud.players.filter((p) => p.present).length : 0, L = Hud.matchLayout(W, H, n);
    const f = { x0: 0, y0: L.barH + 4, x1: W, y1: n > 0 ? L.cardsTop - 4 : H };
    const cr = this.canvas.getBoundingClientRect();
    for (const c of cover || []) {
      const x0 = c.left - cr.left, x1 = c.right - cr.left, y0 = c.top - cr.top, y1 = c.bottom - cr.top;
      if (x1 <= f.x0 || x0 >= f.x1 || y1 <= f.y0 || y0 >= f.y1) continue;
      const cuts = [{ ...f, x0: x1 }, { ...f, x1: x0 }, { ...f, y0: y1 }, { ...f, y1: y0 }].filter((g) => g.x1 > g.x0 && g.y1 > g.y0);
      if (!cuts.length) throw new RenderContractError('an on-screen control covers the whole free rect: ' + JSON.stringify(c));
      cuts.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
      Object.assign(f, cuts[0]);
    }
    return f;
  }

  /** What the camera shows, for the page check: the free rect, every target it framed as a screen point, how many it left out
   *  (past the land), the squares across the free rect and the squares the targets needed, its state, and whether it has settled. */
  cameraReport() {
    const cam = this.rig.camera, W = this.cssW, H = this.cssH, a = this.aim;
    const sp = (p) => { const v = new THREE.Vector3(p.x, this.board.groundAtPoint(p.x, p.z), p.z).project(cam); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H }; };
    return { free: { ...this.rig.free }, targets: a ? a.points.map(sp) : [], dropped: a ? a.dropped : 0, across: this.rig.last.across,
             needed: this.rig.last.needed, state: this.rig.state, settled: !!this.rig.settled, turn: this.rig.turn,
             userZoom: this.rig.user.zoom, userPan: this.rig.user.pan.length() };
  }

  /** A new match, built now (the level's build and its first draw belong to the moment a match starts, not to the first second of
   *  play). seatOfSlot: the HUD's seat for each player slot (a player's colour is their seat's); null means seat = slot. */
  setMatch(match, seatOfSlot = null) {
    if (!match || !match.grid) throw new RenderContractError('setMatch needs a match with a grid');
    this.match = match;
    this.buildLevel(Renderer.seatsOf(seatOfSlot, match));
  }

  /** seats[slot]: the seat each player slot sits at (HudViewModel.seatOfSlot; null there means seat = slot). */
  static seatsOf(seatOfSlot, match) {
    if (seatOfSlot === null) return Array.from({ length: match.playerCount }, (_, s) => s);
    if (seatOfSlot.length !== match.playerCount) throw new RenderContractError('seatOfSlot names ' + seatOfSlot.length + ' seats for ' + match.playerCount + ' players');
    return seatOfSlot.slice();
  }

  buildLevel(seats) {
    if (this.board) this.board.dispose();
    if (this.units) this.units.dispose();
    this.grid = this.match.grid;
    this.seatsKey = seats.join(',');
    const colours = seats.map((s) => PLAYER_COLOURS[s]);
    this.board = new Board(this.scene, this.grid, colours, this.propParts, this.decorParts, this.look);
    this.fx.clear();
    this.units = new Units(this.scene, this.board, this.match, this.models, seats, this.fx);
    this.fitSun();
    this.sun.shadow.needsUpdate = true;                                      // a new level's casters are drawn into the map now
    this.rig.pose = null; this.rig.key = null; this.rig.cur = null;
    this.director = new CameraDirector();
  }

  frame(view, dt) {
    if (!view || !(typeof dt === 'number' && dt >= 0)) throw new RenderContractError('frame(view, dt): a view and the seconds since the last frame');
    for (const f of ['controllers', 'events']) if (!Array.isArray(view[f])) throw new RenderContractError('view.' + f + ' must be an array');
    dt = Math.min(dt, 0.1);                                                  // a stalled tab does not jump every animation at once
    this.clock += dt;
    const seconds = this.clock;
    const m = view.match;
    if (m) {
      if (m !== this.match) throw new RenderContractError('frame() was handed a match that setMatch() was not');
      if (typeof view.alpha !== 'number') throw new RenderContractError('view.alpha (0..1 between ticks) is required with a match');
      if (!view.hud) throw new RenderContractError('view.hud (the HudViewModel) is required with a match');
      if (view.controllers.length !== 1) throw new RenderContractError('view.controllers holds the match\'s one MatchController, got ' + view.controllers.length);
      const seats = Renderer.seatsOf(view.hud.seatOfSlot, m);
      if (m.grid !== this.grid || seats.join(',') !== this.seatsKey) this.buildLevel(seats);   // a new match or level, or new seats
      const building = m.phase === Phase.Repair;
      this.fx.uTime.value = seconds;
      this.board.events(view.events);
      this.board.update(dt, seconds, this.rig.k);
      this.units.events(view.events);
      this.units.update(view, dt, seconds);
      this.fx.commit();
      for (const e of view.events) {                                        // a gentle shake on the big hits (AUTHORED strengths)
        if (e instanceof CannonDestroyed) this.rig.shake = Math.max(this.rig.shake, 0.6);
        else if (e instanceof WallBroken) this.rig.shake = Math.max(this.rig.shake, 0.45);
        else if (e instanceof ShipSunk) this.rig.shake = Math.max(this.rig.shake, 0.35);
      }
      const drift = !!view.menu && DRIFT_SCREENS.has(view.menu.screen) && !(view.menu.screen === Screen.Title && view.menu.inDemo);
      const camIn = view.camera || null;
      this.rig.free = this.freeRect(view, camIn ? camIn.cover : []);
      if (camIn && camIn.input) this.rig.userInput(camIn.input, this.cssH);
      this.aim = drift ? null : this.director.targets(m, view.controllers[0], this.units, this.board, camIn, view.events, seconds, dt);
      this.rig.update(dt, this.board.landBounds(), building, this.aim, drift, this.cssW, this.cssH);
      this.sky.update(this.rig.camera, this.rig.pose.target, seconds);
      this.scene.visible = true;
    } else {
      this.scene.visible = false;                                           // no match: the menus over the plain sea colour
    }
    this.renderFrame();
    const cam = this.rig.camera, W = this.cssW, H = this.cssH;
    const project = (v) => { const p = v.clone().project(cam); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H, visible: p.z < 1 && p.z > -1 }; };
    this.hud.draw(view, project, m ? this.units.heroTags() : [], seconds, this.hudMode === 'all');
    // the chevrons for enemy ships outside the free rect, in play only (a menu over the match hides them)
    const sc0 = view.menu ? view.menu.screen : Screen.Playing;
    if (m && this.hudMode === 'all' && (sc0 === Screen.Playing || (sc0 === Screen.Title && view.menu.inDemo)) && this.rig.m === 0) {
      const f = this.rig.free, marks = [];
      for (const sh of m.ships) {
        if (!sh.alive) continue;
        const p = project(new THREE.Vector3(sh.at.x + sh.size / 2, 0.4, sh.at.y + sh.size / 2));
        if (!p.visible || p.x < f.x0 || p.x > f.x1 || p.y < f.y0 || p.y > f.y1) marks.push(p);
      }
      this.hud.shipMarks(marks, f, seconds);
    }
    // the wipe: when the match's phase (or round) or the menu screen changes, after the first frame
    // (a phase change of the demo playing behind a menu is not one: only a match the player is watching wipes on its phases)
    const sc = view.menu ? view.menu.screen : Screen.Playing, watched = sc === Screen.Playing || sc === Screen.Decide || (sc === Screen.Title && view.menu.inDemo);
    const key = (m && watched ? m.round + ':' + m.phase : '-') + '|' + (view.menu ? view.menu.screen + ':' + view.menu.inDemo : '-');
    if (this.wipeKey !== null && key !== this.wipeKey) this.wipeT = 0;
    this.wipeKey = key;
    if (this.wipeT < WIPE_SECONDS && this.hudMode === 'all') { this.hud.wipe(this.wipeT / WIPE_SECONDS); this.wipeT += dt; }
    if (this.toast && this.clock < this.toast.until) this.hud.toast(this.toast.text, Math.min(1, (this.toast.until - this.clock) * 2));
  }

  resize(w, h) {
    if (!(w > 0 && h > 0)) throw new RenderContractError('resize(w, h) needs a positive size, got ' + w + 'x' + h);
    this.cssW = w; this.cssH = h;
    this.renderer.setSize(w, h);
    this.rig.setAspect(w / h);
    const dpr = this.renderer.getPixelRatio();
    this.hud.resize(w, h, dpr);
    const s = this.hudCanvas.style;
    s.left = this.canvas.offsetLeft + 'px'; s.top = this.canvas.offsetTop + 'px'; s.width = w + 'px'; s.height = h + 'px';
  }

  /** The frame as a PNG: the WebGPU canvas drawn again this instant and the HUD over it. */
  async screenshot() {
    const out = document.createElement('canvas');
    out.width = this.canvas.width; out.height = this.canvas.height;
    const g = out.getContext('2d');
    this.post.render();
    g.drawImage(this.canvas, 0, 0);                                         // same task as the render: the drawing buffer is still this frame
    g.drawImage(this.hudCanvas, 0, 0, out.width, out.height);
    return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('screenshot: the canvas gave no PNG'))), 'image/png'));
  }
}

