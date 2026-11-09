// units.js - everything on the board that moves or belongs to a player: castles (the Meshy castle) with their owner's flag and
// ring, cannons (the Meshy cannon) that turn to aim at their owner's target, ships (the Meshy ship; a two-sail lander bigger and
// darker) that sail square to square and sink, grunts (the Meshy goblin: walking, punching what it bites), shots that arc and land
// with a splash or a hit flash, each player's hero (the hero IS the cursor: the Meshy knight with its armour in the player's colour,
// idle, running, slashing with the sword, a hammer in hand for building, or a lit match for the cannons), and the ghost of what the
// confirm button would place. Positions come from the model every frame (cells, never a float the rules hold) and are eased on
// screen; the events only start effects. Colours follow the player's SEAT (seats[slot]), as the HUD's cards do.
import * as THREE from 'three/webgpu';
import { GameRules, Phase, Terrain, Occupant, ShipKind, ShotFired, ShotLanded, ShipSunk, ShipDamaged, GruntKilled, WallBroken,
         CannonDamaged, LoopClosed, CastleClaimed, SwordSwung, WallsPlaced, CannonPlaced } from '../core/index.js';
import { uv, length, smoothstep } from 'three/tsl';
import { C, PLAYER_COLOURS, ENEMY_SHOT, mats, glow, glowing, fade, flagGeometry, hammerGeometry, torchGeometry } from './look.js';
import { boneEndingWith, tintArmour, shade, rimFigure, setFlash } from './models.js';
import { Effects } from './fx.js';

const SHIP_SPEED = 3.0, GRUNT_SPEED = 2.4, HERO_SPEED = 9.0;   // AUTHORED: squares per second the drawn figures may cover easing to the model
const SINK_SECONDS = 2.4, DIE_SECONDS = 1.1;
const BUBBLE_EVERY = 0.045;                                      // AUTHORED: seconds between bubbles over a sinking ship
const TRAIL_STEP = 0.12;                                         // AUTHORED: squares a shot flies between two puffs of its trail
const WAKE_STEP = 0.2;                                           // AUTHORED: squares a ship sails between two puffs of wake
// AUTHORED figure sizes in squares (a square is one unit): a hero a little taller than a square, a grunt a little shorter, a ship
// one square long plus its bow and stern (a two-sail lander a third bigger and darker, so the two kinds read apart), a castle over
// its footprint and a cannon over its 2x2 squares
// Round 2 ("knights and goblins are specks" at the island-wide zoom): the hero 1.3 -> 1.9 squares tall and the grunt 0.95 -> 1.35;
// the camera looks down at 54 degrees, so a figure's height shows foreshortened and its footprint stays near its own square
const HERO_HEIGHT = 1.9, GRUNT_HEIGHT = 1.35, SHIP_LENGTH = 1.8, LANDER_SCALE = 1.35, LANDER_TINT = new THREE.Color(0.62, 0.58, 0.6);
const CASTLE_MARGIN = 0.8, CANNON_WIDTH = 0.78;                 // castle: footprint + margin; cannon: width per square of its size
const SLASH_SPEED = 2.2;                                         // AUTHORED: the 1.5 s slash clip played in about 0.7 s, a quick swing
const RUN_FROM = 2.5;                                            // squares per second above which a hero runs instead of walking
const STALE_TICKS = GameRules.TicksPerSecond;                    // AUTHORED: an event older than a second when it is shown starts no effect
                                                                // (a tab that stalled, or a test that stepped ahead, must not fire them all at once)                   // AUTHORED: how long a sinking ship and a fallen grunt stay on screen
const towards = (v, target, maxStep) => {                        // move a Vector3 toward a target by at most maxStep
  const d = target.clone().sub(v), len = d.length();
  if (len <= maxStep || len < 1e-6) { v.copy(target); return len; }
  v.addScaledVector(d, maxStep / len); return len;
};
// AUTHORED (round 2): the enemy's rim and ground ring (a grunt's red; a ship's the enemy shot's orange-red), the soft blob shadow
// under every figure (its darkness at the centre), how long a hit flash lasts, and a castle's stone lifted out of the dark (the
// Meshy castle's texture is a dark grey that read as a blot on open grass: lead_live_check.png, round 1)
const GRUNT_RED = new THREE.Color(0xff2a1f), BLOB_ALPHA = 0.42, FLASH_SECONDS = 0.28, CASTLE_LIFT = new THREE.Color(1.6, 1.55, 1.45);
const NEUTRAL_BANNER = new THREE.Color(0xe8e2d2), NEUTRAL_GLOW = new THREE.Color(0xfff1d0);
// the goblin's and the ship's rimmed materials, made once for the page and shared by every level (one shader each, built by the
// renderer's warm-up through gruntFigure and shipModel)
const GRUNT_MATS = new Map(), SHIP_MATS = new Map();
/** A grunt figure, outlined red (the renderer's warm-up draws one, so its shader is built before play). */
export function gruntFigure(models) { const fig = models.figure('goblin'); rimFigure(fig.root, GRUNT_RED, GRUNT_MATS); return fig; }
/** A ship (the lander darker), outlined in the enemy's colour. */
export function shipModel(models, lander) {
  const mdl = models.instance('ship');
  if (lander) shade(mdl, LANDER_TINT);
  rimFigure(mdl, ENEMY_SHOT.clone().multiplyScalar(0.7), SHIP_MATS);
  return mdl;
}
const yawTo = (cur, want, k) => { let d = want - cur; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return cur + d * k; };

export class Units {
  /** seats[slot] = the controller seat each player slot sits at (HudViewModel.seatOfSlot); it picks the slot's colour. */
  constructor(scene, board, match, models, seats, fx) {
    this.scene = scene; this.board = board; this.match = match; this.models = models;
    if (!fx) throw new Error('units.js: the particle pools (fx.js Fx) are required');
    this.fx = fx; this.fxs = new Effects(fx);
    if (!Array.isArray(seats) || seats.length !== match.playerCount) throw new Error('units.js: seats must name a seat for each of the ' + match.playerCount + ' players, got ' + seats);
    this.colours = seats.map((seat) => { if (!PLAYER_COLOURS[seat]) throw new Error('units.js: no colour for seat ' + seat); return PLAYER_COLOURS[seat]; });
    this.group = new THREE.Group(); this.group.name = 'units'; scene.add(this.group);
    this.geo = {
      flag: flagGeometry(), hammer: hammerGeometry(), torch: torchGeometry(),
      ball: new THREE.IcosahedronGeometry(0.13, 1), ring: new THREE.RingGeometry(0.42, 0.5, 32).rotateX(-Math.PI / 2),
      disc: new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2), pip: new THREE.SphereGeometry(0.06, 8, 6),
      puff: new THREE.IcosahedronGeometry(0.2, 0), blade: new THREE.BoxGeometry(0.035, 0.46, 0.08).translate(0, 0.23, 0),
      cube: new THREE.BoxGeometry(1, 1, 1), trim: new THREE.TorusGeometry(0.62, 0.05, 6, 24).rotateX(Math.PI / 2),
    };
    this.flagMats = this.colours.map((c) => new THREE.MeshStandardNodeMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.5 }));
    this.flagNeutral = new THREE.MeshStandardNodeMaterial({ color: NEUTRAL_BANNER, side: THREE.DoubleSide, roughness: 0.6 });
    this.glowP = this.colours.map((c) => glow(c, 2.4));
    this.glowEnemy = glow(ENEMY_SHOT, 2.6);
    this.glowGrunt = glow(GRUNT_RED, 1.7);
    this.glowNeutral = glow(NEUTRAL_GLOW, 1.25);
    // the soft round shadow under a figure: dark at the centre, gone at the rim (a figure's own cast shadow falls to the side, long,
    // from the low sun; this keeps its feet on the ground from the camera's angle)
    this.blobMat = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthWrite: false });
    this.blobMat.opacityNode = smoothstep(0.5, 0.08, length(uv().sub(0.5))).mul(BLOB_ALPHA);
    // the pale pad a castle no one holds stands on (a claimed castle stands in its owner's light territory fill)
    this.padMat = new THREE.MeshBasicNodeMaterial({ color: NEUTRAL_GLOW.clone().multiplyScalar(1.1), transparent: true, depthWrite: false });
    this.padMat.opacityNode = smoothstep(0.5, 0.3, length(uv().sub(0.5))).mul(0.4);
    this.pipEmpty = fade(new THREE.Color(0x333333), 0.6);
    this.castles = new Map(); this.cannons = new Map(); this.ships = new Map(); this.grunts = new Map(); this.shots = new Map();
    this.heroes = []; this.ghosts = [];
    this.buildCastles();
    for (let s = 0; s < match.playerCount; s++) { this.heroes.push(this.makeHero(s)); this.ghosts.push(this.makeGhost(s)); }
    this.dryNearest = this.nearestDry();
  }

  // ------------------------------------------------------------------ castles
  buildCastles() {
    for (const k of this.match.grid.castles) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, gy = 0;
      for (const c of k.cells) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); gy = Math.max(gy, this.board.groundAt(c.x, c.y)); }
      const fw = x1 - x0 + 1, fd = y1 - y0 + 1, g = new THREE.Group();
      g.position.set(x0 + fw / 2, gy - 0.03, y0 + fd / 2);
      const M = this.models.castle, sc = (Math.max(fw, fd) + CASTLE_MARGIN) / Math.max(M.size.x, M.size.z);
      const body = this.models.instance('castle'); body.scale.setScalar(sc); body.position.y = -M.box.min.y * sc - 0.04; g.add(body);
      shade(body, CASTLE_LIFT);
      const top = (M.box.max.y - M.box.min.y) * sc - 0.04;           // the top of the model's middle spire, over the footprint's centre
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.75, 5), mats.vc); pole.position.set(0, top + 0.2, 0);
      pole.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pole.geometry.attributes.position.count * 3).fill(0.3), 3));
      g.add(pole);
      const flag = new THREE.Mesh(this.geo.flag, this.flagNeutral); flag.position.set(0, top + 0.56, 0); flag.castShadow = true; g.add(flag);
      // the home marker: a glowing ring at the castle's foot in its claimer's colour
      const rr = (Math.max(fw, fd) + CASTLE_MARGIN) / 2 + 0.2;            // just outside the model's plinth (inside it, it was hidden)
      const ring = new THREE.Mesh(new THREE.RingGeometry(rr, rr + 0.09, 48).rotateX(-Math.PI / 2), this.glowP[0]);
      ring.position.y = 0.05; ring.visible = false; g.add(ring);
      const pad = new THREE.Mesh(this.geo.disc, this.padMat); pad.scale.setScalar((Math.max(fw, fd) + CASTLE_MARGIN) * 1.5); pad.position.y = 0.035;
      pad.renderOrder = 1; pad.visible = false; g.add(pad);
      this.group.add(g);
      this.castles.set(k.id, { castle: k, g, body, pole, flag, ring, pad, cells: k.cells, half: (Math.max(fw, fd) + CASTLE_MARGIN) / 2 });
    }
  }

  /** Who flies the flag: the player who claimed it as home, else the main owner of the land it stands in, else nobody. */
  castleOwner(k) {
    for (let s = 0; s < this.match.playerCount; s++) if (this.match.player(s).claimedCastle === k.id) return { slot: s, home: true };
    const t = this.board.territory, c = k.cells[0];
    const r = t ? t.regionAt(c.x, c.y) : 0;
    const o = r > 0 ? t.mainOwner(r) : -1;
    return { slot: o, home: false };
  }

  updateCastles(seconds) {
    for (const e of this.castles.values()) {
      const ruined = e.castle.ruined;
      e.body.visible = !ruined; e.flag.visible = !ruined; e.pole.visible = !ruined;
      const own = this.castleOwner(e.castle);
      e.flag.material = own.slot >= 0 ? this.flagMats[own.slot] : this.flagNeutral;
      e.flag.rotation.y = Math.sin(seconds * 2.2 + e.castle.id) * 0.35 - 0.3;
      // a castle no one holds: a neutral banner as big as a home's, a pale ring and pad, so it reads as a castle to take, not a hole
      const free = own.slot < 0;
      e.flag.scale.setScalar(own.home || free ? 1.8 : 1.3);
      e.ring.visible = (own.home || free) && !ruined;
      e.ring.material = own.home ? this.glowP[own.slot] : this.glowNeutral;
      e.pad.visible = free && !ruined;
    }
  }

  // ------------------------------------------------------------------ cannons
  makeCannon(c) {
    const g = new THREE.Group(), size = c.size, gy = this.board.groundAt(c.topLeft.x, c.topLeft.y);
    g.position.set(c.topLeft.x + size / 2, gy, c.topLeft.y + size / 2);
    g.scale.setScalar(size / 2);
    const trim = new THREE.Mesh(this.geo.trim, this.slotGlow(c.owner)); trim.position.y = 0.04; trim.scale.setScalar(1.5); g.add(trim);
    // the whole Meshy cannon turns to aim (its platform is round); its muzzle (-x in the file) is turned to +z, the aim direction
    const M = this.models.cannon, k = CANNON_WIDTH * 2 / Math.max(M.size.x, M.size.z);
    const yaw = new THREE.Group(); g.add(yaw);
    const barrel = new THREE.Group(); yaw.add(barrel);
    const mdl = this.models.instance('cannon'); mdl.rotation.y = Math.PI / 2; mdl.scale.setScalar(k); mdl.position.y = -M.box.min.y * k; barrel.add(mdl);
    this.group.add(g);
    return { g, yaw, barrel, trim, recoil: 0, aim: 0, model: c };
  }

  updateCannons(view, dt) {
    const m = this.match, seen = new Set(), ctl = view.controllers;
    for (const c of m.cannons) {
      if (!c.alive) continue;
      seen.add(c.id);
      let e = this.cannons.get(c.id);
      if (!e) { e = this.makeCannon(c); this.cannons.set(c.id, e); }
      // aim: at the owner's target square in battle (the cursor), else toward the open sea in front of the castle
      let want = e.aim;
      if (m.phase === Phase.Battle && ctl.length) {
        const t = ctl[0].cursorExact(c.owner);
        want = Math.atan2(t.x - e.g.position.x, t.y - e.g.position.z);
      }
      e.aim = yawTo(e.aim, want, Math.min(1, dt * 8));
      e.yaw.rotation.y = e.aim;
      e.recoil = Math.max(0, e.recoil - dt * 2.5);
      e.barrel.position.z = -0.22 * Math.sin(Math.min(1, e.recoil) * Math.PI);
      const loaded = c.inFlight === 0 && c.reloadLeft === 0;
      e.trim.visible = m.phase !== Phase.Battle || loaded || Math.sin(performance.now() / 90) > 0;   // a reloading gun's ring blinks
    }
    for (const [id, e] of this.cannons) if (!seen.has(id)) { this.group.remove(e.g); this.cannons.delete(id); this.fxs.explosion(e.g.position.clone().add(new THREE.Vector3(0, 0.4, 0)), C.iron, 1.2); }
  }

  // ------------------------------------------------------------------ ships
  makeShip(s) {
    const g = new THREE.Group(), two = s.kind === ShipKind.TwoSail;
    // the Meshy ship, bow (-x in the file) turned to +x, the direction the yaw below steers; its keel a quarter of its height under
    // the water line
    const M = this.models.ship, k = SHIP_LENGTH * s.size * (two ? LANDER_SCALE : 1) / M.size.x;
    const hull = new THREE.Group(); g.add(hull);
    const mdl = shipModel(this.models, two); mdl.rotation.y = Math.PI; mdl.scale.setScalar(k); mdl.position.y = -M.box.min.y * k - M.size.y * k * 0.25;
    hull.add(mdl);
    const pips = new THREE.Group(); pips.position.y = M.size.y * k * 0.75 + 0.2; g.add(pips);
    const p = this.shipCentre(s); g.position.copy(p);
    this.group.add(g);
    return { g, hull, pips, pos: p.clone(), yaw: Math.atan2(this.board.w / 2 - p.x, this.board.h / 2 - p.z) - Math.PI / 2, sink: -1, hp: -1, hit: 0, model: s, len: SHIP_LENGTH * s.size * (two ? LANDER_SCALE : 1), wake: 0, bubble: 0 };
  }
  shipCentre(s) { return new THREE.Vector3(s.at.x + s.size / 2, 0, s.at.y + s.size / 2); }

  updateShips(dt, seconds) {
    const seen = new Set();
    for (const s of this.match.ships) {
      let e = this.ships.get(s.id);
      if (!s.alive) { if (e && e.sink < 0) e.sink = 0; continue; }
      seen.add(s.id);
      if (!e) { e = this.makeShip(s); this.ships.set(s.id, e); }
      const target = this.shipCentre(s), before = e.pos.clone();
      const left = towards(e.pos, target, SHIP_SPEED * dt);
      const d = e.pos.clone().sub(before);
      if (d.lengthSq() > 1e-8) e.yaw = yawTo(e.yaw, Math.atan2(-d.z, d.x), Math.min(1, dt * 6));   // bow (+x) along the motion
      e.wake += d.length();
      while (e.wake > WAKE_STEP) { e.wake -= WAKE_STEP; this.wakeOf(e); }
      if (e.hp !== s.health) { this.pips(e, s); e.hp = s.health; }
    }
    for (const [id, e] of this.ships) {
      if (!seen.has(id) && e.sink < 0) e.sink = 0;
      const bob = Math.sin(seconds * 1.7 + id) * 0.03;
      e.g.position.set(e.pos.x, bob, e.pos.z);
      e.g.rotation.set(Math.sin(seconds * 1.3 + id) * 0.05, e.yaw, Math.sin(seconds * 1.1 + id * 2) * 0.04);
      e.hit = Math.max(0, e.hit - dt * 3);
      e.hull.scale.setScalar(1 + e.hit * 0.08);
      setFlash(e.hull, e.hit * e.hit * 0.8);                            // a hit flashes the hull white, fading with the bump
      if (e.sink >= 0) {
        e.sink += dt;
        const k = Math.min(1, e.sink / SINK_SECONDS);
        e.g.position.y = -1.1 * k * k;
        e.g.rotation.z += 0.9 * k; e.g.rotation.x += 0.5 * k;
        e.pips.visible = false;
        e.bubble += dt;
        while (e.bubble > BUBBLE_EVERY) { e.bubble -= BUBBLE_EVERY; this.fxs.bubbles(e.pos, e.len / SHIP_LENGTH); }
        if (k >= 1) { this.group.remove(e.g); this.ships.delete(id); }
      }
    }
  }
  /** A puff of the ship's wake: foam left at the stern that spreads to both sides (a V behind a moving ship) and fades. */
  wakeOf(e) {
    const fx = this.fx.flat, c = Math.cos(e.yaw), sn = Math.sin(e.yaw), fwd = [c, -sn], side = [sn, c];
    const stern = { x: e.pos.x - fwd[0] * e.len * 0.42, y: 0.03, z: e.pos.z - fwd[1] * e.len * 0.42 };
    for (const k of [-1, 1]) {
      fx.emit({ at: { x: stern.x + side[0] * k * 0.12, y: 0.03, z: stern.z + side[1] * k * 0.12 },
                vel: [side[0] * k * 0.32 - fwd[0] * 0.08, 0, side[1] * k * 0.32 - fwd[1] * 0.08], drag: 0.6,
                life: 2.2, size: [0.22 * e.len, 0.75 * e.len], color: C.foam, alpha: 0.55, spin: k * 0.4, fadeIn: 0.04 });
    }
  }
  pips(e, s) {
    e.pips.clear();
    if (s.maxHealth <= 1) return;
    for (let i = 0; i < s.maxHealth; i++) {
      const p = new THREE.Mesh(this.geo.pip, i < s.health ? this.glowEnemy : this.pipEmpty);
      p.position.set(0, 0, (i - (s.maxHealth - 1) / 2) * 0.16); e.pips.add(p);
    }
  }

  // ------------------------------------------------------------------ grunts
  makeGrunt(gr) {
    const g = new THREE.Group(), fig = gruntFigure(this.models);
    fig.root.scale.setScalar(GRUNT_HEIGHT / this.models.goblin.size.y); g.add(fig.root);
    const ring = new THREE.Mesh(this.geo.ring, this.glowGrunt); ring.position.y = 0.03; ring.scale.setScalar(1.15); g.add(ring);
    const blob = new THREE.Mesh(this.geo.disc, this.blobMat); blob.position.y = 0.02; blob.scale.setScalar(1.15); blob.renderOrder = 1; g.add(blob);
    const p = new THREE.Vector3(gr.at.x + 0.5, this.board.groundAt(gr.at.x, gr.at.y), gr.at.y + 0.5);
    g.position.copy(p); this.group.add(g);
    const e = { g, fig, ring, blob, state: null, pos: p.clone(), yaw: 0, die: -1 };
    this.play(e, 'Walking', 0);
    const w = fig.actions.Walking; w.time = ((gr.id * 0.37) % 1) * w.getClip().duration;   // grunts landed together do not step in step
    return e;
  }
  /** The square a grunt bites, if any: the rule MatchModel._actGrunt applies (a wall, cannon or castle on one of its four sides, in
   *  the model's order +x, -x, +y, -y as DX4/DY4), read here only to turn the goblin to it and punch. */
  biteTarget(gr) {
    const g = this.match.grid;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = gr.at.x + dx, y = gr.at.y + dy;
      if (!g.in(x, y)) continue;
      const o = g.occupantAt(x, y);
      if (o === Occupant.Wall || o === Occupant.Cannon || o === Occupant.Castle) return { x, y };
    }
    return null;
  }
  updateGrunts(dt) {
    const seen = new Set();
    for (const gr of this.match.grunts) {
      let e = this.grunts.get(gr.id);
      if (!gr.alive) { if (e && e.die < 0) e.die = 0; continue; }
      seen.add(gr.id);
      if (!e) { e = this.makeGrunt(gr); this.grunts.set(gr.id, e); }
      const target = new THREE.Vector3(gr.at.x + 0.5, this.board.groundAt(gr.at.x, gr.at.y), gr.at.y + 0.5), before = e.pos.clone();
      towards(e.pos, target, GRUNT_SPEED * dt);
      const d = e.pos.clone().sub(before), moving = d.lengthSq() > 1e-8, bite = moving ? null : this.biteTarget(gr);
      if (moving) {
        e.yaw = yawTo(e.yaw, Math.atan2(d.x, d.z), Math.min(1, dt * 10));
        this.play(e, 'Walking', 0.2); e.fig.actions.Walking.timeScale = 1.4;
      } else if (bite) {
        e.yaw = yawTo(e.yaw, Math.atan2(bite.x + 0.5 - e.pos.x, bite.y + 0.5 - e.pos.z), Math.min(1, dt * 10));
        this.play(e, 'Punch_Combo', 0.25);
      } else {
        this.play(e, 'Walking', 0.3); e.fig.actions.Walking.timeScale = 0.25;   // AUTHORED: waiting for its next step, it shuffles
      }
    }
    for (const [id, e] of this.grunts) {
      if (!seen.has(id) && e.die < 0) e.die = 0;
      e.g.position.copy(e.pos);
      e.g.rotation.set(0, e.yaw, 0);
      if (e.die >= 0) {
        e.die += dt;
        setFlash(e.fig.root, Math.max(0, 1 - e.die / FLASH_SECONDS));   // the hit: a white flash as it falls
        e.ring.visible = false; e.blob.visible = e.die < 0.3;
        const k = Math.min(1, e.die / DIE_SECONDS);
        e.g.rotation.x = -1.4 * Math.min(1, k * 3);
        e.g.position.y -= 0.3 * k;
        if (k >= 1) { this.group.remove(e.g); e.fig.mixer.stopAllAction(); this.grunts.delete(id); }
      } else e.fig.mixer.update(dt);
    }
  }

  /** Cross-fade a figure to one of its clips (looping), unless it is already playing it. */
  play(e, name, fade) {
    if (e.state === name) return;
    const next = e.fig.actions[name];
    if (!next) throw new Error('units.js: the figure has no clip ' + name);
    next.reset(); next.setLoop(THREE.LoopRepeat, Infinity); next.timeScale = 1; next.play();
    if (e.state && fade > 0) e.fig.actions[e.state].crossFadeTo(next, fade, false);
    else if (e.state) e.fig.actions[e.state].stop();
    e.state = name;
  }

  // ------------------------------------------------------------------ shots
  shotOrigin(sh) {
    if (sh.fromSlot >= 0) {
      const c = this.cannons.get(sh.cannonId);
      if (c) return c.g.position.clone().add(new THREE.Vector3(0, 0.6 * c.g.scale.x, 0));
    }
    return new THREE.Vector3(sh.origin.x + 0.5, sh.fromShip > 0 ? 0.5 : this.board.groundAt(sh.origin.x, sh.origin.y) + 0.4, sh.origin.y + 0.5);
  }
  updateShots(alpha) {
    const m = this.match, seen = new Set();
    for (const sh of m.shots) {
      seen.add(sh.id);
      let e = this.shots.get(sh.id);
      if (!e) {
        const mat = sh.fromSlot >= 0 ? this.slotGlow(sh.fromSlot) : this.glowEnemy;
        const ball = new THREE.Mesh(this.geo.ball, mat);
        const trail = { colour: sh.fromSlot >= 0 ? this.colours[sh.fromSlot] : ENEMY_SHOT, last: null };
        const from = this.shotOrigin(sh);
        const tg = sh.target, wetT = this.board.grid.terrainAt(tg.x, tg.y) === Terrain.Water;
        const to = new THREE.Vector3(tg.x + 0.5, wetT ? 0.05 : this.board.groundAt(tg.x, tg.y) + 0.25, tg.y + 0.5);
        e = { ball, trail, from, to, total: Number(m.tick - sh.firedTick) + sh.ticksLeft };
        this.group.add(ball); this.shots.set(sh.id, e);
      }
      const k = Math.min(1, Math.max(0, (Number(m.tick - sh.firedTick) + alpha) / e.total));
      const arc = 0.8 + e.from.distanceTo(e.to) * 0.16;
      const at = (q) => e.from.clone().lerp(e.to, q).add(new THREE.Vector3(0, 4 * arc * q * (1 - q), 0));
      e.ball.position.copy(at(k));
      const tr = e.trail;                                                 // a puff of trail every TRAIL_STEP squares of flight
      if (!tr.last) tr.last = e.ball.position.clone();
      for (let d = tr.last.distanceTo(e.ball.position); d > TRAIL_STEP; d -= TRAIL_STEP) {
        tr.last.lerp(e.ball.position, TRAIL_STEP / d);
        this.fxs.trail(tr.last, tr.colour);
      }
    }
    for (const [id, e] of this.shots) if (!seen.has(id)) { this.group.remove(e.ball); this.shots.delete(id); }
  }

  // ------------------------------------------------------------------ heroes (the cursor)
  makeHero(s) {
    const g = new THREE.Group(), fig = this.models.figure('knight');
    tintArmour(fig.root, this.colours[s]);
    fig.root.scale.setScalar(HERO_HEIGHT / this.models.knight.size.y); g.add(fig.root);
    // what the hero holds rides on the right hand bone; `hand` cancels the bone's own scale so the tools keep their size in squares
    const bone = boneEndingWith(fig.root, 'RightHand');
    g.updateMatrixWorld(true);
    const hand = new THREE.Group(); hand.scale.setScalar(0.8 / bone.getWorldScale(new THREE.Vector3()).x);
    hand.rotation.set(Math.PI / 2, 0, 0); bone.add(hand);
    const blade = new THREE.Mesh(this.geo.blade, this.glowP[s]); blade.scale.set(1.5, 1.5, 1.5); hand.add(blade);   // AUTHORED: a sword half a square long
    const hammer = new THREE.Mesh(this.geo.hammer, mats.vc); hand.add(hammer);
    const torch = new THREE.Group(); torch.add(new THREE.Mesh(this.geo.torch, mats.vc));
    const tip = new THREE.Mesh(this.geo.pip, glow(new THREE.Color(0xffa040), 3)); tip.position.y = 0.36; torch.add(tip); hand.add(torch);
    const ring = new THREE.Mesh(this.geo.ring, this.glowP[s]); ring.scale.setScalar(1.4);
    const shadow = new THREE.Mesh(this.geo.disc, this.blobMat); shadow.scale.setScalar(1.3); shadow.renderOrder = 1;
    const reticle = new THREE.Group();
    const r1 = new THREE.Mesh(this.geo.ring, this.glowP[s]); reticle.add(r1);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(this.geo.cube, this.glowP[s]); b.scale.set(0.05, 0.02, 0.28); b.position.set(Math.sin(i * Math.PI / 2) * 0.5, 0, Math.cos(i * Math.PI / 2) * 0.5); b.rotation.y = i * Math.PI / 2; reticle.add(b); }
    this.group.add(g, ring, shadow, reticle);
    const e = { g, fig, state: null, blade, hammer, torch, hand, ring, shadow, reticle, pos: null, yaw: 0, swing: 0, at: new THREE.Vector3() };
    this.play(e, 'Combat_Stance', 0);
    return e;
  }

  /** For every sea square, the nearest dry square (a hero aiming out to sea stands on the shore beneath its target). */
  nearestDry() {
    const g = this.match.grid, w = g.width, h = g.height, near = new Int32Array(w * h).fill(-1), q = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g.terrainAt(x, y) !== Terrain.Water) { near[y * w + x] = y * w + x; q.push(y * w + x); }
    for (let i = 0; i < q.length; i++) {
      const c = q[i], x = c % w, y = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx; if (near[n] >= 0) continue; near[n] = near[c]; q.push(n);
      }
    }
    return near;
  }

  updateHeroes(view, dt, seconds) {
    const m = this.match, ctl = view.controllers[0], playing = !(m.ended || m.phase === Phase.Decide);
    for (let s = 0; s < this.heroes.length; s++) {
      const e = this.heroes[s], p = m.player(s), show = playing && p.connected;
      e.g.visible = e.ring.visible = e.shadow.visible = show;
      e.reticle.visible = false;
      if (!show) continue;
      const cur = ctl.cursorExact(s), cx = Math.floor(cur.x), cy = Math.floor(cur.y), g = m.grid;
      // where the hero stands: the cursor, or over open sea the nearest shore square beneath it
      let tx = cur.x, tz = cur.y;
      if (g.in(cx, cy) && g.terrainAt(cx, cy) === Terrain.Water) {
        const n = this.dryNearest[cy * g.width + cx];
        if (n >= 0) { tx = (n % g.width) + 0.5; tz = Math.floor(n / g.width) + 0.5; }
      }
      // over a standing castle the hero waits at the castle's south foot: the castle model is taller than the hero and would hide it,
      // and the camera looks from the south (the tag, the ghost and the reticle still show the cursor itself)
      for (const k of this.castles.values()) {
        if (k.castle.ruined) continue;
        const c = k.g.position, half = k.half;
        if (Math.abs(tx - c.x) < half && Math.abs(tz - c.z) < half) { tz = c.z + half + 0.2; tx = Math.min(Math.max(tx, c.x - half + 0.3), c.x + half - 0.3); }
      }
      const target = new THREE.Vector3(tx, this.board.groundAtPoint(tx, tz), tz);
      if (!e.pos) e.pos = target.clone();
      const before = e.pos.clone(); towards(e.pos, target, HERO_SPEED * dt);
      const d = e.pos.clone().sub(before), moving = d.lengthSq() > 1e-7, speed = dt > 0 ? d.length() / dt : 0;
      const aiming = m.phase === Phase.Battle && !p.sword;
      if (moving) e.yaw = yawTo(e.yaw, Math.atan2(d.x, d.z), Math.min(1, dt * 12));
      else if (aiming) e.yaw = yawTo(e.yaw, Math.atan2(cur.x - e.pos.x, cur.y - e.pos.z), Math.min(1, dt * 8));
      // the clip: a sword slash plays to its end (SwordSwung starts it); else running or walking while it moves, the stance when still
      e.swing = Math.max(0, e.swing - dt);
      if (e.state === 'Right_Hand_Sword_Slash' && e.swing > 0) { /* the slash plays out */ }
      else if (moving && speed > RUN_FROM) { this.play(e, 'Running', 0.15); e.fig.actions.Running.timeScale = Math.min(1.6, Math.max(0.8, speed / 6)); }
      else if (moving) this.play(e, 'Walking', 0.15);
      else this.play(e, 'Combat_Stance', 0.25);
      e.fig.mixer.update(dt);
      e.g.position.copy(e.pos);
      e.g.rotation.set(0, e.yaw, 0);
      e.ring.position.set(e.pos.x, e.pos.y + 0.03, e.pos.z); e.ring.scale.setScalar(1.4 + Math.sin(seconds * 4 + s) * 0.06);
      e.shadow.position.set(e.pos.x, e.pos.y + 0.02, e.pos.z);
      // the tool in hand: the sword when it is out (REPAIR and BATTLE), else the phase's tool
      const slashing = e.state === 'Right_Hand_Sword_Slash' && e.swing > 0;           // a slash shows the sword to its end
      const sword = slashing || (p.sword && (m.phase === Phase.Repair || m.phase === Phase.Battle));
      e.blade.visible = sword; e.hammer.visible = !sword && (m.phase === Phase.Repair || m.phase === Phase.Cannons); e.torch.visible = aiming && !sword;
      if (aiming) {
        e.reticle.visible = true;
        const wetC = !g.in(cx, cy) || g.terrainAt(cx, cy) === Terrain.Water;
        e.reticle.position.set(cur.x, wetC ? 0.06 : this.board.groundAtPoint(cur.x, cur.y) + 0.06, cur.y);
        e.reticle.rotation.y = seconds * 1.5; e.reticle.scale.setScalar(1 + Math.sin(seconds * 6) * 0.06);
      }
      e.at.copy(e.g.position);
    }
  }

  heroTags() {
    const out = [];
    this.heroes.forEach((e, s) => { if (e.g.visible) out.push({ slot: s, at: e.at.clone().add(new THREE.Vector3(0, HERO_HEIGHT + 0.35, 0)) }); });
    return out;
  }

  // ------------------------------------------------------------------ ghosts (what confirm would place)
  makeGhost(s) {
    const col = this.colours[s];
    const ok = glowing(new THREE.MeshBasicNodeMaterial({ color: col.clone().multiplyScalar(1.4), transparent: true, opacity: 0.5, depthWrite: false }));
    const bad = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xff2b2b), transparent: true, opacity: 0.35, depthWrite: false });
    const geo = new THREE.BoxGeometry(0.9, 0.5, 0.9).translate(0, 0.25, 0);
    const im = new THREE.InstancedMesh(geo, ok, 16); im.count = 0; im.visible = false; im.renderOrder = 3; im.frustumCulled = false;
    const castleRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.42, 40).rotateX(-Math.PI / 2), this.glowP[s]); castleRing.visible = false;
    this.group.add(im, castleRing);
    return { im, ok, bad, castleRing };
  }
  updateGhosts(view, seconds) {
    const m = this.match, ctl = view.controllers[0], mat = new THREE.Matrix4();
    for (let s = 0; s < this.ghosts.length; s++) {
      const e = this.ghosts[s], p = m.player(s);
      e.im.count = 0; e.im.visible = false; e.castleRing.visible = false;
      if (!p.connected || m.ended) continue;
      if (m.phase === Phase.Claim) {
        if (p.claimedCastle !== 0) continue;
        const cur = ctl.cursor(s);
        for (const k of this.castles.values()) {
          if (!k.cells.some((c) => Math.abs(c.x + 0.5 - (cur.x + 0.5)) <= 1.5 && Math.abs(c.y + 0.5 - (cur.y + 0.5)) <= 1.5)) continue;
          e.castleRing.visible = true; e.castleRing.position.set(k.g.position.x, k.g.position.y + 0.06, k.g.position.z);
          e.castleRing.scale.setScalar(1 + Math.sin(seconds * 6 + s) * 0.06);
        }
        continue;
      }
      if (m.phase !== Phase.Repair && m.phase !== Phase.Cannons) continue;
      if (m.phase === Phase.Repair && p.sword) continue;
      if (m.phase === Phase.Cannons && p.cannonsToPlace === 0) continue;
      const gh = ctl.ghostOf(s);
      if (!gh.cells) continue;
      e.im.material = gh.legal ? e.ok : e.bad;
      const hover = 0.12 + Math.sin(seconds * 5 + s) * 0.05, low = m.phase === Phase.Cannons ? 0.45 : 1;
      let k = 0;
      for (const c of gh.cells) {
        if (!m.grid.in(c.x, c.y)) continue;
        mat.makeScale(1, low, 1).setPosition(c.x + 0.5, this.board.groundAt(c.x, c.y) + hover, c.y + 0.5);
        e.im.setMatrixAt(k++, mat);
      }
      e.im.count = k; e.im.visible = k > 0; e.im.instanceMatrix.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ effects (started by events; fx.js Effects draws them)
  events(list) {
    const m = this.match, g = m.grid;
    const cellAt = (c, lift = 0.3) => new THREE.Vector3(c.x + 0.5, (g.terrainAt(c.x, c.y) === Terrain.Water ? 0 : this.board.groundAt(c.x, c.y)) + lift, c.y + 0.5);
    for (const e of list) {
      if (Number(m.tick - e.tick) > STALE_TICKS) continue;
      if (e instanceof ShotFired) {
        const c = this.cannons.get(e.cannonId);
        if (e.fromSlot >= 0 && c) {
          c.recoil = 1;
          const dir = new THREE.Vector3(Math.sin(c.aim), 0, Math.cos(c.aim)), sc = c.g.scale.x;
          this.fxs.muzzle(c.g.position.clone().addScaledVector(dir, 0.95 * sc).add(new THREE.Vector3(0, 0.62 * sc, 0)), dir, this.colours[e.fromSlot], sc);
        } else if (e.fromShip > 0) {
          const sh = this.ships.get(e.fromShip);
          if (sh) {
            const dir = new THREE.Vector3(e.target.x + 0.5 - sh.pos.x, 0, e.target.y + 0.5 - sh.pos.z).normalize();
            this.fxs.muzzle(sh.pos.clone().addScaledVector(dir, 0.35).add(new THREE.Vector3(0, 0.45, 0)), dir, ENEMY_SHOT, 0.7);
          }
        }
      } else if (e instanceof ShotLanded) {
        const wetT = g.terrainAt(e.target.x, e.target.y) === Terrain.Water;
        if (wetT && !e.hit) this.fxs.splash(cellAt(e.target, 0));
        else if (e.hit) this.fxs.explosion(cellAt(e.target, 0.35), wetT ? C.wood : C.stoneDark, 0.8);
        else this.fxs.dust(cellAt(e.target, 0), 0.9);
      } else if (e instanceof WallBroken) {
        const ow = g.ownerAt(e.at.x, e.at.y);
        this.fxs.explosion(cellAt(e.at, 0.3), ow < this.colours.length ? this.colours[ow].clone().lerp(C.foam, 0.28) : C.stone, 1);
      }
      else if (e instanceof ShipDamaged) { const sh = this.ships.get(e.shipId); if (sh) { sh.hit = 1; this.fxs.chunks(sh.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), C.wood, 5, 0.8); } }
      else if (e instanceof ShipSunk) {
        const sh = this.ships.get(e.shipId); if (sh && sh.sink < 0) sh.sink = 0;
        const at = new THREE.Vector3(e.at.x + 0.5, 0, e.at.y + 0.5), k = sh ? sh.len / SHIP_LENGTH : 1;
        this.fxs.explosion(at.clone().add(new THREE.Vector3(0, 0.5, 0)), C.wood, 1.1 * k);
        this.fxs.splash(at, 1.4 * k);
      }
      else if (e instanceof GruntKilled) { this.fxs.dust(cellAt(e.at, 0), 0.8, new THREE.Color(0.62, 0.58, 0.68)); }
      else if (e instanceof CannonDamaged) { const c = this.cannons.get(e.cannonId); if (c) this.fxs.explosion(c.g.position.clone().add(new THREE.Vector3(0, 0.5, 0)), C.iron, 0.7); }
      else if (e instanceof WallsPlaced) { for (const c of e.cells) this.fxs.dust(cellAt(c, 0), 0.75); }
      else if (e instanceof CannonPlaced) { this.fxs.dust(new THREE.Vector3(e.topLeft.x + 1, this.board.groundAt(e.topLeft.x, e.topLeft.y), e.topLeft.y + 1), 1.6); }
      else if (e instanceof LoopClosed) {
        const k = this.castles.get(e.castleId);
        if (k) {
          const swept = this.board.flashRegionOf(k.cells);              // the capture glow sweeps out from the castle
          const col = this.colours[e.slot] ?? C.foam;
          for (const q of swept) if (this.fxs.rnd() < 0.5) this.fxs.sparkle(new THREE.Vector3(q.x + 0.2 + this.fxs.rnd() * 0.6, this.board.groundAt(q.x, q.y) + 0.1, q.y + 0.2 + this.fxs.rnd() * 0.6), col, q.delay);
        }
      } else if (e instanceof SwordSwung) {
        const h = this.heroes[e.slot];
        if (h) {                                                            // the slash clip, sped up to a quick swing, from its start
          if (h.state === 'Right_Hand_Sword_Slash') h.fig.actions.Right_Hand_Sword_Slash.reset();   // a second swing starts it again
          this.play(h, 'Right_Hand_Sword_Slash', 0.08);
          const a = h.fig.actions.Right_Hand_Sword_Slash;
          a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = SLASH_SPEED;
          h.swing = a.getClip().duration / SLASH_SPEED;
        }
        this.fxs.flash(cellAt(e.at, 0.4), this.colours[e.slot], 0.5);
      } else if (e instanceof CastleClaimed) {
        const k = this.castles.get(e.castleId);
        if (k) this.fxs.flash(k.g.position.clone().add(new THREE.Vector3(0, 1.2, 0)), this.colours[e.slot], 1.2);
      }
    }
  }

  update(view, dt, seconds) {
    const alpha = view.alpha ?? 0;
    this.updateCastles(seconds);
    this.updateCannons(view, dt);
    this.updateShips(dt, seconds);
    this.updateGrunts(dt);
    this.updateShots(alpha);
    this.updateHeroes(view, dt, seconds);
    this.updateGhosts(view, seconds);
  }

  /** The glowing material of a player slot's colour; a slot the match does not have is an error. */
  slotGlow(slot) {
    const m = this.glowP[slot];
    if (!m) throw new Error('units.js: no player in slot ' + slot + ' (the match has ' + this.glowP.length + ')');
    return m;
  }

  dispose() {
    for (const e of this.heroes) e.fig.mixer.stopAllAction();
    for (const e of this.grunts.values()) e.fig.mixer.stopAllAction();
    this.scene.remove(this.group);
  }
}
