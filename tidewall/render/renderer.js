// renderer.js - the game's WebGPU renderer (three.js WebGPURenderer from the CDN, three@0.175.0). The contract (PLAN.md):
//   const r = await createRenderer(canvas, { hud })  throws NoWebGpuError when the browser has no WebGPU (no WebGL stand-in);
//                                             hud: 'all' (default: HUD, menus and hero tags) or 'tags' (only the tags over the heroes,
//                                             for a page that draws its own HUD and menus)
//   r.setMatch(match, seats)                  on a new match; seats = HudViewModel.seatOfSlot (null: seat = slot), the seat each
//                                             player slot sits at, which picks its colour (a later view with other seats rebuilds)
//   r.frame(view, dt)                         each animation frame, dt = seconds since the last frame;
//                                             view = { match, controllers[], hud, menu, events[], alpha }
//   await r.settle()                          draw the match as it was set and wait for the GPU: its pipelines are built before play
//   r.resize(w, h)                            CSS pixels
//   r.screenshot()                            -> Promise<Blob> (the 3D frame with the HUD drawn over it)
// It reads the model and the view models and never changes them. A new level (the model swaps its board) is picked up by itself.
import * as THREE from 'three/webgpu';
import { pass, vec3, vec4, uv, length, smoothstep, oneMinus, min } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { Phase, Occupant, WallBroken, CannonDestroyed } from '../core/index.js';
import { GAME_TITLE } from '../app/title.js';
import { Board } from './board.js';
import { Units } from './units.js';
import { CameraRig } from './camera.js';
import { Hud } from './hud.js';
import { PLAYER_CSS, PLAYER_HEX, PLAYER_COLOURS } from './look.js';
import { Models, tintArmour, shade } from './models.js';
import { PropSet } from './look.js';

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

export async function createRenderer(canvas, opts = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new RenderContractError('createRenderer needs a <canvas>');
  if (!navigator.gpu) throw new NoWebGpuError('this browser has no navigator.gpu (Chrome or Edge 113+ on Windows, macOS or ChromeOS have it)');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new NoWebGpuError('the browser gave the page no graphics adapter (see chrome://gpu)');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new NoWebGpuError('three.js started its WebGL 2 backend, not WebGPU');
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const models = await Models.load();                                     // the models; one that does not load stops here
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
    // light: a warm sun from the south-west (shadows to the north-east read as 3D in both camera angles) and a sky fill
    const hemi = new THREE.HemisphereLight(0xdff3ff, 0x6a8a5a, 1.35); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target); this.sun = sun;
    // the post chain (the pattern of the site's other WebGPU pages): the scene pass, bloom on what glows (values above 1), a soft vignette
    this.post = new THREE.PostProcessing(renderer);
    const scenePass = pass(this.scene, this.rig.camera, { samples: 4 });
    const col = scenePass.getTextureNode('output');
    const b = bloom(min(col, vec4(5, 5, 5, 1)), 0.55, 0.32, 0.95);
    const vig = oneMinus(smoothstep(0.45, 0.95, length(uv().sub(0.5))).mul(0.35));
    this.post.outputNode = vec4(col.rgb.add(b.rgb).mul(vig), 1);
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
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  /** Draw one of every model once, through the same passes a match draws with (shadow, scene, bloom), before the page starts: the
   *  GPU pipelines are built here, while the page is still loading, instead of in the first second of play (11-08: a 1.4 s stall
   *  there swallowed a short gamepad tap, and the page check's pad run failed). */
  warmUp() {
    const g = new THREE.Group(), m = this.models, pose = (fig, clip) => { fig.actions[clip].play(); fig.mixer.update(0.1); return fig.root; };
    const knight = m.figure('knight'); tintArmour(knight.root, PLAYER_COLOURS[0]);
    const lander = m.instance('ship'); shade(lander, new THREE.Color(0.6, 0.6, 0.6));
    const items = [pose(knight, 'Combat_Stance'), pose(m.figure('goblin'), 'Walking'), m.instance('ship'), lander, m.instance('castle'), m.instance('cannon')];
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

  /** Draw the level setMatch built, once, and wait until the GPU has done it: the page calls this before its loop starts, so the
   *  board's and figures' pipelines are built while it is still loading (a stall in the first second of play swallows input). */
  async settle() {
    if (!this.match) throw new RenderContractError('settle() needs a match: call setMatch first');
    this.post.render();
    await this.renderer.backend.device.queue.onSubmittedWorkDone();
  }

  /** Follow framing: the camera frames every hero with room round them instead of the whole island. */
  set follow(on) { this.rig.follow = !!on; }
  get follow() { return this.rig.follow; }

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
    this.board = new Board(this.scene, this.grid, colours, this.propParts, this.decorParts);
    this.units = new Units(this.scene, this.board, this.match, this.models, seats);
    // the sun's shadow box covers the board and its margin
    const w = this.grid.width, h = this.grid.height, r = Math.max(w, h) * 0.75;
    this.sun.position.set(w / 2 - r * 0.6, r * 1.1, h / 2 + r * 0.8);
    this.sun.target.position.set(w / 2, 0, h / 2);
    const sc = this.sun.shadow.camera; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = r * 4; sc.updateProjectionMatrix();
    this.rig.pose = null; this.rig.key = null;
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
      this.board.events(view.events);
      this.board.update(dt, seconds, this.rig.k);
      this.units.events(view.events);
      this.units.update(view, dt, seconds);
      for (const e of view.events) if (e instanceof WallBroken || e instanceof CannonDestroyed) this.rig.shake = Math.max(this.rig.shake, 0.5);
      this.rig.update(dt, this.board.landBounds(), building, this.units.heroSpots());
      this.scene.visible = true;
    } else {
      this.scene.visible = false;                                           // no match: the menus over the plain sea colour
    }
    this.post.render();
    const cam = this.rig.camera, W = this.cssW, H = this.cssH;
    const project = (v) => { const p = v.clone().project(cam); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H, visible: p.z < 1 && p.z > -1 }; };
    this.hud.draw(view, project, m ? this.units.heroTags() : [], seconds, this.hudMode === 'all');
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

