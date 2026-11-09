// camera.js - the one shared camera (TASKS.md "CAMERA" is its spec). Two classes:
//   CameraDirector  WHAT to show: per phase, the points each focus player needs to see (their hero, their castles and territory,
//                   the free castles near them, the threats coming at them, the piece they hold), boxed and clamped to the land.
//   CameraRig       HOW to show it: the box fitted into the FREE screen rect (the canvas minus the HUD's bar and cards and the
//                   on-screen touch controls) at a 3/4 angle for play and near top-down while pieces are placed (REPAIR), moved by
//                   critically damped springs with a dead zone, turned a quarter in portrait so the island's long axis runs up
//                   the screen, with the player's own zoom and pan on top (wheel, pinch, drags) that springs back when left alone.
// Behind the menus (title, join, scores) it drops to a low wide angle that shows the horizon and the sky (sky.js) and drifts slowly
// round the island (graphics round 2). A match with no human player (the attract demo) shows the whole island.
import * as THREE from 'three/webgpu';
import { Phase, ShipSunk, CastleRuined } from '../core/index.js';

export const FOV = 38;                                          // AUTHORED: vertical field of view, degrees
// AUTHORED: degrees down from level for play and for REPAIR, landscape and portrait (portrait looks flatter so the frame is used)
const PITCH = { land: [54, 80], port: [48, 76] };
// AUTHORED (round 4, phone pass): on a small screen (short side under SMALL_SCREEN CSS px: a phone) REPAIR looks less steeply down.
// Measured with the 80 / 76 degree REPAIR angle: the hero stood 8 px tall in phone landscape and 11 px in portrait (run_page
// `camera`, shots/aaa3/run_page_camera2.txt), too small to find; the play angle is unchanged.
const SMALL_SCREEN = 560, PITCH_SMALL = { land: [54, 64], port: [48, 60] };
const SWING_SECONDS = 1.1;                                      // AUTHORED: the swing between the play and REPAIR angles
const FIT_MARGIN = 0.04;                                        // AUTHORED: fraction of the free rect kept clear inside its edges
// AUTHORED framing (squares): a target box is padded by PAD, at least MIN_ACROSS across the free rect, never past the board;
// LOOK_AHEAD seconds of the hero's motion lead the frame (at most LOOK_MAX squares)
const PAD = 1.5, MIN_ACROSS = 15, LOOK_AHEAD = 0.5, LOOK_MAX = 3;
const CLAIM_NEAR = 18, CLAIM_CASTLES = 2;                       // AUTHORED: free castles near a hero framed in CLAIM
// SHIPS_FRAMED: afloat ships framed in BATTLE (nearest to the player's castles); SPREAD_ARC: radians of directions past which only
// the nearest one is
const SHIPS_FRAMED = 3, SPREAD_ARC = THREE.MathUtils.degToRad(150);
const THREAT_SHIP = 10, THREAT_GRUNT = 4, EVENT_NEAR = 10, EVENT_SECONDS = 1.8;   // AUTHORED: squares and seconds
// AUTHORED motion: spring stiffness (1/s) for the ground target and for the distance (slower: pan faster than zoom), the dead zone
// (squares of target, fraction of distance) inside which the goal does not move, and the player's own camera
const PAN_OMEGA = 4.2, ZOOM_OMEGA = 2.6, DEAD_ZONE = 1.0, DEAD_ZOOM = 0.06;
const USER_RETURN = 4, USER_EASE = 1.6, USER_ZOOM = [0.45, 2.6], WHEEL_STEP = 0.12;
// AUTHORED (round 2): the menu camera. 13 degrees down with a 46-degree field puts the top of the picture 10 degrees above the
// horizon, MENU_CLOSER of the distance that fits the whole island (it fills the picture and its edges drift in and out); it sways
// MENU_SWAY radians either side of the south view over MENU_PERIOD seconds and breathes in and out a little; MENU_SECONDS is the
// glide between it and the game's camera
const MENU_PITCH = 13, MENU_FOV = 46, MENU_SWAY = 0.32, MENU_PERIOD = 70, MENU_SECONDS = 1.6, MENU_CLOSER = 0.8;

/** The horizontal look direction for a quarter turn: 0 looks north (row 0 at the top of the screen), 1 looks east (column 0 at the
 *  bottom: the island's long axis up a portrait screen). Screen-right on the ground is (-d.z, 0, d.x). */
const lookOf = (turn) => (turn === 1 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1));

/** One critically damped spring step (implicit, stable at any dt): returns [x, v]. */
function spring(x, v, goal, w, dt) {
  const f = 1 + 2 * dt * w, oo = w * w, hoo = dt * oo, det = 1 / (f + dt * hoo);
  return [(f * x + dt * v + dt * hoo * goal) * det, (v + hoo * (goal - x)) * det];
}

export class CameraDirector {
  constructor() { this.prev = new Map(); this.focusEvents = []; }

  /** The points (world x, z) the camera must frame this frame, and what it dropped. hints: { humans: [slot], pointerSlot }.
   *  Returns null when there is no human to frame (the whole island is shown). */
  targets(match, ctl, units, board, hints, events, seconds, dt) {
    const humans = (hints && hints.humans || []).filter((s) => match.player(s).connected);
    if (!humans.length || !ctl) return null;
    const g = match.grid, pts = [], area = new Map();
    const terr = board.territory;
    // each focus player's own area: the squares of the regions they hold and their castles
    for (const s of humans) {
      const a = [];
      if (terr) for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
        const r = terr.regionAt(x, y);
        if (r > 0 && terr.mainOwner(r) === s) a.push({ x: x + 0.5, z: y + 0.5 });
      }
      for (const e of units.castles.values()) if (!e.castle.ruined && units.castleOwner(e.castle).slot === s) a.push({ x: e.g.position.x, z: e.g.position.z });
      area.set(s, a);
    }
    const near = (p, list, d) => list.some((q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.z - q.z)) <= d);
    const claimed = new Set(); for (let s = 0; s < match.playerCount; s++) if (match.player(s).claimedCastle) claimed.add(match.player(s).claimedCastle);
    for (const s of humans) {
      const own = area.get(s), pointer = hints.pointerSlot === s, hero = units.heroes[s];
      // the hero, led by its motion (not the pointer player's: its hero follows a still pointer, so the camera would chase it)
      if (hero && hero.g.visible && !pointer) {
        const at = hero.at, was = this.prev.get(s) || at.clone(), v = dt > 0 ? at.clone().sub(was).divideScalar(dt) : new THREE.Vector3();
        this.prev.set(s, at.clone());
        const lead = v.multiplyScalar(LOOK_AHEAD); if (lead.length() > LOOK_MAX) lead.setLength(LOOK_MAX);
        pts.push({ x: at.x, z: at.z }, { x: at.x + lead.x, z: at.z + lead.z });
      }
      switch (match.phase) {
        case Phase.Claim: {
          const hp = hero ? { x: hero.at.x, z: hero.at.z } : null;
          const free = [...units.castles.values()].filter((e) => !e.castle.ruined && !claimed.has(e.castle.id)).map((e) => ({ x: e.g.position.x, z: e.g.position.z }));
          if (pointer || !hp) pts.push(...free);
          else pts.push(...free.filter((c) => Math.hypot(c.x - hp.x, c.z - hp.z) <= CLAIM_NEAR)
                            .sort((a, b) => Math.hypot(a.x - hp.x, a.z - hp.z) - Math.hypot(b.x - hp.x, b.z - hp.z)).slice(0, CLAIM_CASTLES));
          const home = match.player(s).claimedCastle;
          for (const e of units.castles.values()) if (e.castle.id === home) pts.push({ x: e.g.position.x, z: e.g.position.z });
          break;
        }
        case Phase.Cannons: pts.push(...own); break;
        case Phase.Battle: {
          pts.push(...own);
          // the ships the player must shoot at: the nearest SHIPS_FRAMED afloat ships by distance to their castles (the lead,
          // 11-09: "the ships they must shoot are off screen"); ships spread round the castle (their directions span more than
          // SPREAD_ARC) frame only the nearest one, the rest get edge chevrons. Framing them moves the frame toward their sea.
          const homes = [...units.castles.values()].filter((e) => !e.castle.ruined && units.castleOwner(e.castle).slot === s).map((e) => ({ x: e.g.position.x, z: e.g.position.z }));
          const from = homes.length ? homes : own.length ? own : hero ? [{ x: hero.at.x, z: hero.at.z }] : [];
          const dist = (p) => Math.min(...from.map((q) => Math.hypot(p.x - q.x, p.z - q.z)));
          const afloat = match.ships.filter((sh) => sh.alive && g.in(sh.at.x, sh.at.y)).map((sh) => ({ x: sh.at.x + sh.size / 2, z: sh.at.y + sh.size / 2 }));
          if (from.length && afloat.length) {
            let pick = afloat.sort((a, b) => dist(a) - dist(b)).slice(0, SHIPS_FRAMED);
            const cx = from.reduce((a, q) => a + q.x, 0) / from.length, cz = from.reduce((a, q) => a + q.z, 0) / from.length;
            const ang = pick.map((p) => Math.atan2(p.z - cz, p.x - cx)).sort((a, b) => a - b);
            let gap = ang.length > 1 ? ang[0] + 2 * Math.PI - ang[ang.length - 1] : 2 * Math.PI;
            for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
            if (2 * Math.PI - gap > SPREAD_ARC) pick = pick.slice(0, 1);
            pts.push(...pick);
          }
          for (const sh of match.ships) { const p = { x: sh.at.x + sh.size / 2, z: sh.at.y + sh.size / 2 }; if (sh.alive && near(p, own, THREAT_SHIP)) pts.push(p); }
          for (const sh of match.shots) {
            const t = { x: sh.target.x + 0.5, z: sh.target.y + 0.5 };
            if (near(t, own, 1)) pts.push(t, { x: sh.origin.x + 0.5, z: sh.origin.y + 0.5 });
          }
          for (const gr of match.grunts) { const p = { x: gr.at.x + 0.5, z: gr.at.y + 0.5 }; if (gr.alive && near(p, own, THREAT_GRUNT)) pts.push(p); }
          break;
        }
        case Phase.Repair: {
          pts.push(...own);
          if (!pointer) { const gh = ctl.ghostOf(s); if (gh.cells) for (const c of gh.cells) pts.push({ x: c.x + 0.5, z: c.y + 0.5 }); }
          break;
        }
        default: pts.push(...own);
      }
    }
    // an event near a focus area holds the camera's attention for a moment (it only widens the frame)
    const all = [...area.values()].flat();
    for (const e of events) {
      let p = null;
      if (e instanceof ShipSunk) p = { x: e.at.x + 0.5, z: e.at.y + 0.5 };
      else if (e instanceof CastleRuined) { const k = units.castles.get(e.castleId); if (k) p = { x: k.g.position.x, z: k.g.position.z }; }
      if (p && near(p, all, EVENT_NEAR)) this.focusEvents.push({ p, until: seconds + EVENT_SECONDS });
    }
    this.focusEvents = this.focusEvents.filter((f) => f.until > seconds);
    for (const f of this.focusEvents) pts.push(f.p);
    // clamp to the board (nothing the rules move ever leaves it): a point past it is not framed
    const L = board.landBounds();
    const inside = (p) => p.x >= -1 && p.x <= g.width + 1 && p.z >= -1 && p.z <= g.height + 1;
    const framed = pts.filter(inside);
    return { points: framed, dropped: pts.length - framed.length, land: L };
  }
}

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 400);
    this.k = 0; this.kWant = 0;        // 0 = play angle, 1 = REPAIR angle
    this.pose = null;                  // the drawn camera's position and look target (after the menu blend)
    this.shake = 0;
    this.m = 0; this.time = 0;         // m: 0 = the game's camera, 1 = the menu camera (eased); time: the menu drift's clock
    this.turn = 0;                     // quarter turns (0 north, 1 east): a stick is turned with it (renderer.screenTurn)
    this.free = null;                  // the free screen rect, CSS px {x0, y0, x1, y1}
    this.cur = null;                   // the springs: ground target t, its velocity vt, distance d, its velocity vd
    this.goal = null;                  // { t, d } where the springs are pulled to (the dead zone moves it)
    this.user = { zoom: 1, pan: new THREE.Vector3(), last: -1e9 };
    this.whole = false;                // the player's "whole island" toggle (Z, the frame button)
    this.clock = 0; this.state = 'menu'; this.last = { across: 0, needed: 0 };
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  /** The player's own camera this frame: wheel steps (+ out), a pan in CSS px (the drag's motion: the world follows the finger),
   *  a pinch ratio (> 1 = fingers apart = closer), and the whole-island toggle. */
  userInput({ wheel = 0, panX = 0, panY = 0, pinch = 1, toggle = false }, H) {
    if (toggle) { this.whole = !this.whole; this.user.zoom = 1; this.user.pan.set(0, 0, 0); }
    if (!wheel && !panX && !panY && pinch === 1) return;
    this.user.last = this.clock;
    if (wheel) this.user.zoom *= Math.exp(wheel * WHEEL_STEP);
    if (pinch !== 1) this.user.zoom /= pinch;
    this.user.zoom = Math.min(USER_ZOOM[1], Math.max(USER_ZOOM[0], this.user.zoom));
    if ((panX || panY) && this.cur) {
      const p = THREE.MathUtils.degToRad(this.pitchNow()), per = 2 * this.cur.d * this.user.zoom * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / H;
      const d = lookOf(this.turn), r = new THREE.Vector3(-d.z, 0, d.x);
      this.user.pan.addScaledVector(r, -panX * per).addScaledVector(d, panY * per / Math.max(0.3, Math.sin(p)));
    }
  }

  pitchNow() { const P = this.pitches || PITCH[this.turn ? 'port' : 'land'], s = this.k * this.k * (3 - 2 * this.k); return P[0] + (P[1] - P[0]) * s; }

  /** Place the camera for a ground target, distance and pitch (degrees). */
  place(cam, t, dist, pitchDeg, turn) {
    const p = THREE.MathUtils.degToRad(pitchDeg), d = lookOf(turn);
    const fwd = new THREE.Vector3(d.x * Math.cos(p), -Math.sin(p), d.z * Math.cos(p));
    cam.position.copy(t).addScaledVector(fwd, -dist);
    cam.up.set(0, 1, 0); cam.lookAt(t); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  }

  /** Fit `box` ({x0,y0,x1,y1} squares, heights 0..top) into the free rect (NDC {x0,x1,y0,y1}) at a pitch: the nearest distance at
   *  which every corner projects inside it, the target moved so the box is centred in it. -> { t, d } */
  fit(box, pitchDeg, top, ndc, turn, fov = FOV) {
    const cam = this.camera, fovWas = cam.fov; cam.fov = fov;
    const pts = [];
    for (const x of [box.x0, box.x1]) for (const z of [box.y0, box.y1]) for (const y of [0, top]) pts.push(new THREE.Vector3(x, y, z));
    const t = new THREE.Vector3((box.x0 + box.x1) / 2, 0, (box.y0 + box.y1) / 2);
    const wantX = (ndc.x0 + ndc.x1) / 2, wantY = (ndc.y0 + ndc.y1) / 2, halfX = (ndc.x1 - ndc.x0) / 2, halfY = (ndc.y1 - ndc.y0) / 2;
    const d = lookOf(turn), r = new THREE.Vector3(-d.z, 0, d.x), sp = Math.max(0.2, Math.sin(THREE.MathUtils.degToRad(pitchDeg)));
    const v = new THREE.Vector3();
    const extent = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of pts) { v.copy(q).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
      return { x0, x1, y0, y1 };
    };
    let dist = 30;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 2, hi = 400;
      for (let i = 0; i < 26; i++) {
        dist = (lo + hi) / 2; this.place(cam, t, dist, pitchDeg, turn);
        const e = extent();
        if ((e.x1 - e.x0) / 2 <= halfX && (e.y1 - e.y0) / 2 <= halfY) hi = dist; else lo = dist;
      }
      dist = hi; this.place(cam, t, dist, pitchDeg, turn);
      const e = extent(), hh = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * dist, hw = hh * cam.aspect;
      t.addScaledVector(r, ((e.x0 + e.x1) / 2 - wantX) * hw).addScaledVector(d, ((e.y0 + e.y1) / 2 - wantY) * hh / sp);
    }
    cam.fov = fovWas; cam.updateProjectionMatrix();
    return { t, d: dist };
  }

  /** The free rect in NDC, shrunk by FIT_MARGIN. */
  ndc(W, H) {
    const f = this.free || { x0: 0, y0: 0, x1: W, y1: H }, mx = (f.x1 - f.x0) * FIT_MARGIN, my = (f.y1 - f.y0) * FIT_MARGIN;
    return { x0: (f.x0 + mx) / W * 2 - 1, x1: (f.x1 - mx) / W * 2 - 1, y0: 1 - (f.y1 - my) / H * 2, y1: 1 - (f.y0 + my) / H * 2 };
  }

  /** One frame. land: the land's box; building: REPAIR; aim: CameraDirector.targets() (null = no human: the whole island);
   *  menu: the drifting menu camera. W, H: the canvas in CSS px. */
  update(dt, land, building, aim, menu, W, H) {
    this.clock += dt;
    const freeW = this.free ? this.free.x1 - this.free.x0 : W, freeH = this.free ? this.free.y1 - this.free.y0 : H;
    const turn = freeH > freeW * 1.05 && (land.x1 - land.x0) > (land.y1 - land.y0) ? 1 : 0;
    if (turn !== this.turn) { this.turn = turn; this.cur = null; this.pose = null; }
    this.kWant = building ? 1 : 0;
    const step = dt / SWING_SECONDS;
    this.k = this.kWant > this.k ? Math.min(this.kWant, this.k + step) : Math.max(this.kWant, this.k - step);
    const P = (Math.min(W, H) < SMALL_SCREEN ? PITCH_SMALL : PITCH)[turn ? 'port' : 'land'], s = this.k * this.k * (3 - 2 * this.k);
    this.pitches = P;
    // WHAT: the box to frame
    const whole = { x0: land.x0 - 1, y0: land.y0 - 1, x1: land.x1 + 1, y1: land.y1 + 1 };
    let box = whole, state = 'whole';
    if (aim && aim.points.length && !this.whole) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of aim.points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      box = { x0: x0 - PAD, y0: z0 - PAD, x1: x1 + PAD, y1: z1 + PAD };
      state = 'action';
    }
    const q = (v) => Math.round(v * 4) / 4;                         // a quarter square: the solve is redone only when the box moves
    const ndc = this.ndc(W, H);
    const key = [box.x0, box.y0, box.x1, box.y1].map(q).join(',') + '|' + Object.values(ndc).map((v) => v.toFixed(3)).join(',') + '|' + this.camera.aspect.toFixed(4) + '|' + turn + '|' + P.join(',');
    if (key !== this.key) {
      this.key = key;
      // the box fitted at both angles; then never closer than MIN_ACROSS squares across the free rect at the target (a small
      // target set still shows the ground round it). need: the distance the targets alone ask for (the report's yardstick)
      this.want = [this.fit(box, P[0], 1.6, ndc, turn), this.fit(box, P[1], 1.6, ndc, turn)];
      this.need = this.want.map((w) => w.d);
      if (state === 'action') { const dMin = MIN_ACROSS * H / (freeW * 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))); for (const w of this.want) w.d = Math.max(w.d, dMin); }
      this.menuPose = this.fit(whole, MENU_PITCH, 1.6, { x0: -0.92, x1: 0.92, y0: -0.8, y1: 0.8 }, 0, MENU_FOV);
    }
    const want = { t: this.want[0].t.clone().lerp(this.want[1].t, s), d: this.want[0].d + (this.want[1].d - this.want[0].d) * s };
    // the dead zone: the goal moves only when the wanted target leaves DEAD_ZONE of it; zooming OUT is never held back (the box
    // must fit), zooming in waits for DEAD_ZOOM
    if (!this.cur) {
      this.cur = { t: want.t.clone(), vt: new THREE.Vector3(), d: want.d, vd: 0 };
      this.goal = { t: want.t.clone(), d: want.d };
    } else {
      const diff = want.t.clone().sub(this.goal.t), len = diff.length();
      if (len > DEAD_ZONE) this.goal.t.addScaledVector(diff, 1 - DEAD_ZONE / len);
      if (want.d > this.goal.d || want.d < this.goal.d * (1 - DEAD_ZOOM)) this.goal.d = want.d;
    }
    const c = this.cur;
    for (const ax of ['x', 'z']) { const [x, v] = spring(c.t[ax], c.vt[ax], this.goal.t[ax], PAN_OMEGA, dt); c.t[ax] = x; c.vt[ax] = v; }
    [c.d, c.vd] = spring(c.d, c.vd, this.goal.d, ZOOM_OMEGA, dt);
    // the player's own zoom and pan, eased back to none once they leave it alone for USER_RETURN seconds
    const u = this.user, idle = this.clock - u.last > USER_RETURN;
    if (idle) { const e = Math.exp(-dt * USER_EASE); u.zoom = 1 + (u.zoom - 1) * e; u.pan.multiplyScalar(e); }
    const userOn = Math.abs(u.zoom - 1) > 0.02 || u.pan.length() > 0.05;
    this.state = this.whole ? 'whole' : userOn ? 'user' : state;
    const t = c.t.clone().add(u.pan), dist = c.d * u.zoom, pitch = P[0] + (P[1] - P[0]) * s;
    const cam = this.camera;
    this.place(cam, t, dist, pitch, turn);
    const pos = cam.position.clone();
    // the menu camera: the low pose swung round the island's centre and breathing in and out, eased in and out of the game's
    const mStep = dt / MENU_SECONDS;
    this.m = menu ? Math.min(1, this.m + mStep) : Math.max(0, this.m - mStep);
    const target = t.clone();
    if (this.m > 0) {
      this.time += dt;
      const sm = this.m * this.m * (3 - 2 * this.m), w = this.time * 2 * Math.PI / MENU_PERIOD;
      this.place(cam, this.menuPose.t, this.menuPose.d, MENU_PITCH, 0);
      const mt = this.menuPose.t, off = cam.position.clone().sub(mt).multiplyScalar(MENU_CLOSER * (1 + 0.05 * Math.sin(w * 1.7)));
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), MENU_SWAY * Math.sin(w));
      pos.lerp(mt.clone().add(off), sm); target.lerp(mt, sm);
      cam.fov = FOV + (MENU_FOV - FOV) * sm;
      this.state = 'menu';
    } else cam.fov = FOV;
    cam.updateProjectionMatrix();
    this.pose = { pos: pos.clone(), target: target.clone() };
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const j = this.shake * this.shake * 0.25, tt = performance.now() / 1000;
    cam.position.copy(pos).add(new THREE.Vector3(Math.sin(tt * 61) * j, Math.sin(tt * 47) * j, Math.sin(tt * 53) * j));
    cam.up.set(0, 1, 0); cam.lookAt(target); cam.updateMatrixWorld();
    // across: the squares the free rect spans at the target (the report's measure of how tight the frame is)
    const acrossAt = (dd) => (freeW / H) * 2 * dd * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.last.across = acrossAt(dist); this.last.needed = acrossAt(this.need[0] + (this.need[1] - this.need[0]) * s);
    this.settled = this.m === 0 && this.k === this.kWant && c.vt.length() < 0.05 && Math.abs(c.vd) < 0.05
      && c.t.distanceTo(this.goal.t) < 0.05 && Math.abs(c.d - this.goal.d) < 0.05;
    return s;
  }
}
