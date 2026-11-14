// units.js - everything on the board that moves or belongs to a player: castles (the Meshy castle) with their owner's flag and
// ring, cannons (the Meshy cannon) that turn to aim at their owner's target, ships (the Meshy ship; a two-sail lander bigger and
// darker) that sail square to square and sink, grunts (the Meshy goblin: walking, punching what it bites), shots that arc and land
// with a splash or a hit flash, each player's hero (the hero IS the cursor: the Meshy knight with its armour in the player's colour,
// idle, running, slashing with the sword, a hammer in hand for building, or a lit match for the cannons), and the ghost of what the
// confirm button would place. Positions come from the model every frame (cells, never a float the rules hold) and are eased on
// screen; the events only start effects. Colours follow the player's SEAT (seats[slot]), as the HUD's cards do.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GameRules, Phase, Terrain, Occupant, ShipKind, ShotFired, ShotLanded, ShipSunk, ShipDamaged, GruntKilled, WallBroken,
         CannonDamaged, LoopClosed, CastleClaimed, SwordSwung, WallsPlaced, CannonPlaced, PlacementRejected, CommandRejected, CommandKind,
         EnclosureRules, HudViewModel, RingBuilt, CastleBitten, CastleRuined, CastleRestored, ShotModel, GunKind } from '../core/index.js';
import { wallLandsAfter } from './board.js';
import { FullView } from './full.js';
import { RiseView } from './rise.js';
import { uv, length, smoothstep } from 'three/tsl';
import { C, PLAYER_COLOURS, ENEMY_SHOT, mats, glow, glowing, fade, flagGeometry, hammerGeometry, torchGeometry, drawAllRoom, HERO_HEIGHT } from './look.js';
import { boneEndingWith, tintArmour, shade, rimFigure, setFlash, tintSails, outlineFigure } from './models.js';
import { Effects } from './fx.js';
import { BombsView } from './bombs.js';

const SHIP_SPEED = 3.0, GRUNT_SPEED = 2.4, HERO_SPEED = 9.0, BOMB_HERO_SPEED = 16.0;   // AUTHORED: squares per second the drawn figures may cover easing to the model
const SINK_SECONDS = 2.4, DIE_SECONDS = 1.1;
const FLAG_RATE = 3.5;                                           // AUTHORED: 1/s the flag eases up (secured) or down its pole
const REFUSED_SECONDS = 1.6;
// UC-P3 (AUTHORED, tuned on run_page `smooth`): the drawn hero's spring stiffness (1/s: at a 10 squares/s walk it trails the rules'
// hero by 2v/w ~ 1 square, and settles in ~0.3 s from a stop), the distance it is snapped instead of walked (a new map), its top
// speed (squares/s: 1.8x the rules' 10, so a jump in its target is walked quickly, never flown), the speed under which it
// stands, how fast it turns (1/s), and the speeds at which the Walking and Running clips' feet do not slide (squares/s at timeScale 1)
const CASTLE_SOUTH = 0.6;                                        // AUTHORED: squares of preference for a castle's south (camera) side
const HERO_OMEGA = 18, HERO_SNAP = 12, HERO_MAX = 18, IDLE_BELOW = 0.35, TURN_RATE = 10, WALK_NATURAL = 2.2, RUN_NATURAL = 6;
// AUTHORED: how long each bomb gesture takes (s)
const GESTURE = Object.freeze({ drop: 0.32, lift: 0.45, toss: 0.4 });                                     // AUTHORED: how long a refused confirm's reason flashes at the ghost
const BUBBLE_EVERY = 0.045;                                      // AUTHORED: seconds between bubbles over a sinking ship
const TRAIL_STEP = 0.12;                                         // AUTHORED: squares a shot flies between two puffs of its trail
const WAKE_STEP = 0.2;                                           // AUTHORED: squares a ship sails between two puffs of wake
// AUTHORED figure sizes in squares (a square is one unit): a hero a little taller than a square, a grunt a little shorter, a ship
// one square long plus its bow and stern (a two-sail lander a third bigger and darker, so the two kinds read apart), a castle over
// its footprint and a cannon over its 2x2 squares
// Round 2 ("knights and goblins are specks" at the island-wide zoom): the hero 1.3 -> 1.9 squares tall and the grunt 0.95 -> 1.35;
// the camera looks down at 54 degrees, so a figure's height shows foreshortened and its footprint stays near its own square
// Round 3 (the lead: "ships are the enemy, but at the default zoom they're tiny"): a ship 1.8 -> 2.3 squares long, the lander 1.3x
// that; sails by kind (a gunship's black, a lander's deep green: the normal game has no red ships, PLAN.md), a red threat rim
// (the off-screen chevrons' red) and a wake tinted with it
// UC-L1 (11-09): the hero is drawn 0.7 of that, HERO_HEIGHT (look.js), with a chunky dark outline (models.js outlineFigure); what it
// holds, its ring and its blob shadow shrink with it (TOOLS_AT: the hero height the tools were sized against, round 2)
// AUTHORED (CASTLE_DAMAGE_UC.md UC-L5): a hurt castle smokes at two thirds of its health or less and burns at a third or less; its
// stone darkens toward SCORCH with the share it has lost; its bar is BAR_W squares wide over the flag, red at a third or less; a wisp
// of smoke every SMOKE_EVERY seconds, a flame every FLAME_EVERY
const CASTLE_SMOKES = 2 / 3, CASTLE_BURNS = 1 / 3, SCORCH = new THREE.Color(0.5, 0.45, 0.4), BAR_W = 2.2, BAR_H = 0.2;   // (1.6 x 0.17 read as a sliver at whole-island zoom, 11-10)
const BAR_UP = new THREE.Vector3();   // scratch: the camera's up, for the bar's offset
const SMOKE_EVERY = 0.35, FLAME_EVERY = 0.16, BAR_LOW = new THREE.Color(0xff3b2f);
const GRUNT_HEIGHT = 1.35, SHIP_LENGTH = 2.3, LANDER_SCALE = 1.3, LANDER_TINT = new THREE.Color(0.62, 0.58, 0.6);
const TOOLS_AT = 1.9, HERO_RING = 1.1, HERO_BLOB = 1.0;
// SAIL by kind: a gunship's black, a lander's deep green, a boss's royal purple (BOSS_UC.md UC-B1: it reads apart from both at a
// glance); BOSS_TINT darkens its hull, BOSS_SCALE is its length over a ship's per square of its size (2 x 2: ~4 squares long)
const SHIP_RIM = new THREE.Color(0xff3a1f), SAIL = [new THREE.Color(0.16, 0.17, 0.2), new THREE.Color(0.2, 0.42, 0.25), new THREE.Color(0.42, 0.12, 0.5)];
// (11-11, LOOKED at shots/boss/boss_volley.png: at 0.9 and with the tint alone the boss could not be told from the ships round it at
// the whole-island zoom - every hull reads dark red under the enemy rim; now larger and ringed in pulsing purple, BOSS_RING)
const BOSS_TINT = new THREE.Color(0.5, 0.44, 0.5), BOSS_SCALE = 1.15, BOSS_RING = new THREE.Color(0xc45ad8);
// FULL-RENDER (11-11, the full rules' ships; AUTHORED, each told apart at the whole-island zoom by its sails): a fireship's flame
// orange, a gunboat's iron grey (2 x 2), the dreadnought's black (3 x 3, ringed like the boss: it is the full rules' boss), a
// recruited ship's white sails with a gold rim instead of the enemy's red (it fights for the players); an ironclad keeps its kind's
// sails on a hull darkened toward iron
SAIL.push(new THREE.Color(0.85, 0.32, 0.08), new THREE.Color(0.36, 0.38, 0.42), new THREE.Color(0.07, 0.07, 0.08), new THREE.Color(0.95, 0.93, 0.86));
const LOOK = Object.freeze({ ship: 0, lander: 1, boss: 2, fireship: 3, gunboat: 4, dreadnought: 5, allied: 6 });
const MORTAR_SHADE = new THREE.Color(0.55, 0.5, 0.52);
const BOULDER_TRAIL = new THREE.Color(0x8a8478), FIRE_TRAIL = new THREE.Color(0xff5a10);
const IRONCLAD_TINT = new THREE.Color(0.42, 0.42, 0.46), ALLY_RIM = new THREE.Color(0xffd24a), DREAD_TINT = new THREE.Color(0.38, 0.34, 0.32);
/** The look a ship is drawn with (a recruited ship is the allied look whatever its kind). */
export function lookOf(s) {
  if (s.allied) return LOOK.allied;
  switch (s.kind) {
    case ShipKind.OneSail: return LOOK.ship;
    case ShipKind.TwoSail: return LOOK.lander;
    case ShipKind.Boss: return LOOK.boss;
    case ShipKind.Fireship: return LOOK.fireship;
    case ShipKind.Gunboat: return LOOK.gunboat;
    case ShipKind.Dreadnought: return LOOK.dreadnought;
  }
  throw new Error('units.js: no look for ship kind ' + s.kind);
}
const WAKE = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0xff3a1f), 0.3);
const SINK_PITCH = 1.25, SINK_ROLL = 0.5, SINK_DEPTH = 1.6;       // AUTHORED: radians the bow dips and the hull rolls, squares it goes down
const SINK_FOAM_EVERY = 0.14;                                    // AUTHORED: seconds between foam rings round a sinking ship
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
const GRUNT_MATS = new Map(), SHIP_MATS = Array.from({ length: 7 }, () => new Map()), IRONCLAD_MATS = Array.from({ length: 7 }, () => new Map());
/** A grunt figure, outlined red (the renderer's warm-up draws one, so its shader is built before play). */
export function gruntFigure(models) { const fig = models.figure('goblin'); rimFigure(fig.root, GRUNT_RED, GRUNT_MATS); return fig; }
/** A ship, outlined in the enemy's colour. look (LOOK): 0 a gunship, 1 a lander (darker), 2 a boss (purple sails, darkest hull),
 *  3 a fireship, 4 a gunboat, 5 the dreadnought, 6 a recruited ship (gold rim); ironclad darkens the hull toward iron. */
export function shipModel(models, look, ironclad = false) {
  if (!Number.isInteger(look) || look < 0 || look >= SAIL.length) throw new Error('units.js: a ship look is 0..' + (SAIL.length - 1) + ' (LOOK), got ' + look);
  const mdl = models.instance('ship');
  const hull = look === 1 ? LANDER_TINT : look === 2 ? BOSS_TINT : look === 5 ? DREAD_TINT : new THREE.Color(1, 1, 1);
  if (ironclad) hull.multiply(IRONCLAD_TINT);
  const rim = look === LOOK.allied ? ALLY_RIM.clone().multiplyScalar(0.42) : SHIP_RIM.clone().multiplyScalar(0.42);
  tintSails(mdl, SAIL[look], hull, rim, (ironclad ? IRONCLAD_MATS : SHIP_MATS)[look]);
  return mdl;
}
/** The aiming reticle: a ring with four ticks on its rim, merged into one geometry (graphics round 3: it was five meshes per hero,
 *  20 draws a frame for four players, and the draws are what the frame's CPU time goes on). */
function reticleGeometry() {
  const parts = [new THREE.RingGeometry(0.42, 0.5, 32).rotateX(-Math.PI / 2)];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.BoxGeometry(1, 1, 1), m = new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(i * Math.PI / 2) * 0.5, 0, Math.cos(i * Math.PI / 2) * 0.5),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * Math.PI / 2), new THREE.Vector3(0.05, 0.02, 0.28));
    parts.push(b.applyMatrix4(m));
  }
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('units.js: the reticle parts would not merge');
  return g;
}
const yawTo = (cur, want, k) => { let d = want - cur; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return cur + d * k; };

export class Units {
  /** seats[slot] = the controller seat each player slot sits at (HudViewModel.seatOfSlot); it picks the slot's colour.
   *  bomb: the bomb model's baked parts and what was read from them (renderer.js: { parts, big, radius, tip }), shared by every level. */
  constructor(scene, board, match, models, seats, fx, bomb) {
    if (match.options.bombs && !(bomb && bomb.parts && bomb.big)) throw new Error('units.js: the bomb rule set needs the bomb model parts');
    this.bomb = bomb;
    this.scene = scene; this.board = board; this.match = match; this.models = models;
    if (!fx) throw new Error('units.js: the particle pools (fx.js Fx) are required');
    this.fx = fx; this.fxs = new Effects(fx);
    this.dustDue = [];                       // a dropping block's dust, raised when it lands (WALL_DROP_UC.md UC-L3): { at, k, due }
    if (!Array.isArray(seats) || seats.length !== match.playerCount) throw new Error('units.js: seats must name a seat for each of the ' + match.playerCount + ' players, got ' + seats);
    this.colours = seats.map((seat) => { if (!PLAYER_COLOURS[seat]) throw new Error('units.js: no colour for seat ' + seat); return PLAYER_COLOURS[seat]; });
    this.group = new THREE.Group(); this.group.name = 'units'; scene.add(this.group);
    this.geo = {
      flag: flagGeometry(), hammer: hammerGeometry(), torch: torchGeometry(),
      ball: new THREE.IcosahedronGeometry(0.13, 1), ring: new THREE.RingGeometry(0.42, 0.5, 32).rotateX(-Math.PI / 2),
      disc: new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2), pip: new THREE.SphereGeometry(0.06, 8, 6),
      puff: new THREE.IcosahedronGeometry(0.2, 0), blade: new THREE.BoxGeometry(0.035, 0.46, 0.08).translate(0, 0.23, 0),
      cube: new THREE.BoxGeometry(1, 1, 1), reticle: reticleGeometry(), trim: new THREE.TorusGeometry(0.62, 0.05, 6, 24).rotateX(Math.PI / 2),
    };
    this.flagMats = this.colours.map((c) => new THREE.MeshStandardNodeMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.5 }));
    this.flagNeutral = new THREE.MeshStandardNodeMaterial({ color: NEUTRAL_BANNER, side: THREE.DoubleSide, roughness: 0.6 });
    this.glowP = this.colours.map((c) => glow(c, 2.4));
    this.glowEnemy = glow(ENEMY_SHOT, 2.6);
    this.glowAlly = glow(ALLY_RIM, 2.6); this.boulderMat = new THREE.MeshStandardNodeMaterial({ color: BOULDER_TRAIL, roughness: 0.92, flatShading: true });   // FULL-RENDER: a recruited ship's ball; the serpent's boulder
    this.glowGrunt = glow(GRUNT_RED, 1.7);
    this.glowBoss = glow(BOSS_RING, 2.8);                            // UC-B1: the ring on the water round a boss
    this.glowNeutral = glow(NEUTRAL_GLOW, 1.25);
    // the soft round shadow under a figure: dark at the centre, gone at the rim (a figure's own cast shadow falls to the side, long,
    // from the low sun; this keeps its feet on the ground from the camera's angle)
    this.blobMat = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthWrite: false });
    this.blobMat.opacityNode = smoothstep(0.5, 0.08, length(uv().sub(0.5))).mul(BLOB_ALPHA);
    // the pale pad a castle no one holds stands on (a claimed castle stands in its owner's light territory fill)
    this.padMat = new THREE.MeshBasicNodeMaterial({ color: NEUTRAL_GLOW.clone().multiplyScalar(1.1), transparent: true, depthWrite: false });
    this.padMat.opacityNode = smoothstep(0.5, 0.3, length(uv().sub(0.5))).mul(0.4);
    this.pipEmpty = fade(new THREE.Color(0x333333), 0.6);
    // a hurt castle's health bar (UC-L5): a dark back and a fill that grows from its left end, drawn over everything round it
    this.barBackMat = new THREE.MeshBasicNodeMaterial({ color: 0x1c1410, depthTest: false, depthWrite: false, transparent: true, opacity: 0.85, fog: false });
    this.geo.barBack = new THREE.PlaneGeometry(BAR_W + 0.08, BAR_H + 0.08);
    this.geo.barFill = new THREE.PlaneGeometry(1, BAR_H).translate(0.5, 0, 0);
    this.camera = null;                                              // the renderer's camera: the bars face it (renderer.js buildLevel)
    this.castles = new Map(); this.cannons = new Map(); this.ships = new Map(); this.grunts = new Map(); this.shots = new Map();
    this.heroes = []; this.ghosts = [];
    this.badOutline = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xff1010), depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
    this.clock = 0;                                                  // seconds, the renderer's clock (update() sets it)
    this.buildCastles();
    for (let s = 0; s < match.playerCount; s++) { this.heroes.push(this.makeHero(s)); this.ghosts.push(this.makeGhost(s)); }
    this.dryNearest = this.nearestDry();
    this.bombs = match.options.bombs ? new BombsView(this) : null;   // the bomb rule set's bombs, traps and stun (bombs.js)
    this.full = match.options.full ? new FullView(this) : null;        // the full rules' serpent, kites, treasure, ship parts (full.js)
    this.rise = new RiseView(this);                                    // a closed ring built upward in Tetris pieces (rise.js, UC-L8)
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
      // UC-L5: the castle's own stone (shade() made it its own materials) and the colour each had, to scorch them as it is hurt
      const stone = [];
      body.traverse((o) => { if (o.isMesh && !stone.some((s) => s.m === o.material)) stone.push({ m: o.material, base: o.material.color.clone() }); });
      const bar = new THREE.Group(); bar.position.set(0, top + 2.1, 0); bar.visible = false;   // above the flag: at top + 1.25 the close REPAIR camera drew it across the roof (11-10) bar.renderOrder = 5;
      const back = new THREE.Mesh(this.geo.barBack, this.barBackMat); back.renderOrder = 5; bar.add(back);
      const fillMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, fog: false });
      const fill = new THREE.Mesh(this.geo.barFill, fillMat); fill.position.set(-BAR_W / 2, 0, 0.001); fill.renderOrder = 6; bar.add(fill);
      g.add(bar);
      this.group.add(g);
      this.castles.set(k.id, { castle: k, g, body, pole, flag, ring, pad, cells: k.cells, half: (Math.max(fw, fd) + CASTLE_MARGIN) / 2,
                               flagTop: top + 0.56, flagLow: top + 0.08, raise: 0, secured: false,
                               top, stone, bar, fill, fillMat, health: -1, stage: 0, pulse: 0, smokeT: 0, flameT: 0 });
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

  /** UC-P2: whether the board shows castle `id` secured (a closed ring round it: every square of it in an enclosed area of the
   *  board's territory, EnclosureRules' own rule for enclosedCastleIds) and how far its flag is up (0 lowered .. 1 at the top). */
  castleShown(id) { const e = this.castles.get(id); return e ? { secured: e.secured, raise: e.raise } : null; }

  updateCastles(seconds, dt = 0) {
    const t = this.board.territory;
    for (const e of this.castles.values()) {
      const ruined = e.castle.ruined;
      e.body.visible = !ruined; e.flag.visible = !ruined; e.pole.visible = !ruined;
      // UC-P2: a castle inside a closed ring flies its flag at the top of the pole and its ring glows; an open one lowers it
      e.secured = !ruined && !!t && e.cells.every((c) => t.regionAt(c.x, c.y) > 0);
      e.raise += ((e.secured ? 1 : 0) - e.raise) * Math.min(1, dt * FLAG_RATE);
      e.flag.position.y = e.flagLow + (e.flagTop - e.flagLow) * e.raise;
      const own = this.castleOwner(e.castle);
      e.flag.material = own.slot >= 0 ? this.flagMats[own.slot] : this.flagNeutral;
      e.flag.rotation.y = Math.sin(seconds * 2.2 + e.castle.id) * 0.35 - 0.3;
      // a castle no one holds: a neutral banner as big as a home's, a pale ring and pad, so it reads as a castle to take, not a hole
      const free = own.slot < 0;
      e.flag.scale.setScalar(own.home || free ? 1.8 : 1.3);
      e.ring.visible = (own.home || free || e.secured) && !ruined;
      e.ring.material = own.slot >= 0 && (own.home || e.secured) ? this.glowP[own.slot] : this.glowNeutral;
      e.ring.scale.setScalar(e.secured ? 1 + 0.05 * Math.sin(seconds * 3 + e.castle.id) : 1);
      e.pad.visible = free && !ruined;
      this.castleDamage(e, own, ruined, dt);
    }
  }

  /** UC-L5: how hurt castle e is, from the model (match.castleHealthOf): its bar, its stage (0 whole, 1 smoking, 2 burning), its
   *  scorched stone and its smoke and fire. Nothing shows at full health or once it is ruined (the board draws its graveyard). */
  castleDamage(e, own, ruined, dt) {
    const max = this.match.rules.castleHealth, h = ruined ? 0 : this.match.castleHealthOf(e.castle.id), r = h / max;
    const hurt = !ruined && h < max;
    const stage = !hurt ? 0 : r <= CASTLE_BURNS ? 2 : r <= CASTLE_SMOKES ? 1 : 0;
    if (h !== e.health) {
      e.health = h;
      const d = hurt ? 1 - r : 0;                                     // the stone darkens with the share it has lost
      for (const s of e.stone) s.m.color.copy(s.base).lerp(s.base.clone().multiply(SCORCH), d);
    }
    e.stage = stage;
    e.bar.visible = hurt;
    if (hurt) {
      e.fill.scale.set(Math.max(0.001, BAR_W * r), 1, 1);
      e.fillMat.color.copy(r <= CASTLE_BURNS ? BAR_LOW : own.slot >= 0 ? this.colours[own.slot] : NEUTRAL_GLOW);
      e.pulse = Math.max(0, e.pulse - dt * 3);
      e.bar.scale.setScalar(1 + 0.25 * e.pulse);
      if (this.camera) {
        // facing the camera, and past the castle up the SCREEN (along the camera's up), so at any pitch it stands clear of the roof:
        // 11-10, raised only in height, the near top-down REPAIR camera still drew it across the castle's back wall
        e.bar.quaternion.copy(this.camera.quaternion);
        BAR_UP.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
        e.bar.position.set(0, e.top * 0.5, 0).addScaledVector(BAR_UP, e.half + 0.3);
      }
    }
    if (stage >= 1) {
      const at = (y) => new THREE.Vector3(e.g.position.x + (this.fxs.rnd() - 0.5) * e.half, e.g.position.y + y, e.g.position.z + (this.fxs.rnd() - 0.5) * e.half);
      e.smokeT += dt;
      while (e.smokeT > SMOKE_EVERY) { e.smokeT -= SMOKE_EVERY; this.fxs.smokeWisp(at(e.top * 0.8), stage === 2 ? 1.25 : 0.9); }
      if (stage === 2) { e.flameT += dt; while (e.flameT > FLAME_EVERY) { e.flameT -= FLAME_EVERY; this.fxs.flame(at(e.top * 0.55), 0.8); } }
    } else { e.smokeT = 0; e.flameT = 0; }
  }

  /** UC-L5 (the page check reads it): what castle `id` shows of its health: { bar, health, stage, body }. */
  castleDamageShown(id) {
    const e = this.castles.get(id);
    return e ? { bar: e.bar.visible, health: e.bar.visible ? e.health : null, stage: e.stage, body: e.body.visible } : null;
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
    if (c.kind === GunKind.Mortar) shade(mdl, MORTAR_SHADE);         // FULL-RENDER: a mortar (3 x 3, so 1.5x by its size) reads darker iron
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
    const g = new THREE.Group(), two = s.kind === ShipKind.TwoSail, boss = s.kind === ShipKind.Boss || s.kind === ShipKind.Dreadnought;
    // the Meshy ship, bow (-x in the file) turned to +x, the direction the yaw below steers; its keel a quarter of its height under
    // the water line
    const M = this.models.ship, k = SHIP_LENGTH * s.size * (two ? LANDER_SCALE : boss ? BOSS_SCALE : 1) / M.size.x;
    const hull = new THREE.Group(); g.add(hull);
    const look = lookOf(s), mdl = shipModel(this.models, look, s.ironclad); mdl.rotation.y = Math.PI; mdl.scale.setScalar(k); mdl.position.y = -M.box.min.y * k - M.size.y * k * 0.25;
    hull.add(mdl);
    const pips = new THREE.Group(); pips.position.y = M.size.y * k * 0.75 + 0.2; g.add(pips);
    let ring = null;
    if (boss) { ring = new THREE.Mesh(this.geo.ring, this.glowBoss); ring.position.y = 0.05; ring.scale.setScalar(SHIP_LENGTH * s.size * BOSS_SCALE * 0.62); g.add(ring); }
    const p = this.shipCentre(s); g.position.copy(p);
    this.group.add(g);
    return { g, hull, pips, look, pos: p.clone(), yaw: Math.atan2(this.board.w / 2 - p.x, this.board.h / 2 - p.z) - Math.PI / 2, sink: -1, hp: -1, hit: 0, model: s, ring, len: SHIP_LENGTH * s.size * (two ? LANDER_SCALE : boss ? BOSS_SCALE : 1), wake: 0, bubble: 0 };
  }
  shipCentre(s) { return new THREE.Vector3(s.at.x + s.size / 2, 0, s.at.y + s.size / 2); }

  updateShips(dt, seconds) {
    const seen = new Set();
    for (const s of this.match.ships) {
      let e = this.ships.get(s.id);
      if (!s.alive) { if (e && e.sink < 0) e.sink = 0; continue; }
      seen.add(s.id);
      if (e && e.look !== lookOf(s)) { const was = e; this.group.remove(was.g); e = this.makeShip(s); e.pos.copy(was.pos); e.yaw = was.yaw; this.ships.set(s.id, e); }   // recruited: its new sails
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
      if (e.ring) { e.ring.visible = e.sink < 0; e.ring.scale.setScalar(SHIP_LENGTH * e.model.size * BOSS_SCALE * 0.62 * (1 + 0.06 * Math.sin(seconds * 4))); }
      setFlash(e.hull, e.hit * e.hit * 0.8);                            // a hit flashes the hull white, fading with the bump
      if (e.sink >= 0) {
        // the sink: the bow dips first (the hull tips up by the stern), it rolls onto its side, then it slides under; foam rings
        // and bubbles where it goes, planks left floating at the start (units.events ShipSunk)
        e.sink += dt;
        const k = Math.min(1, e.sink / SINK_SECONDS), tip = Math.min(1, k * 2.2), down = k * k;
        e.g.position.y = -SINK_DEPTH * down;
        e.hull.rotation.set(SINK_ROLL * tip * tip, 0, -SINK_PITCH * tip * (1 - 0.3 * down));   // bow (+x) down: about the hull's z
        e.pips.visible = false;
        e.bubble += dt; e.foam = (e.foam ?? 0) + dt;
        while (e.bubble > BUBBLE_EVERY) { e.bubble -= BUBBLE_EVERY; this.fxs.bubbles(e.pos, e.len / SHIP_LENGTH); }
        while (e.foam > SINK_FOAM_EVERY) { e.foam -= SINK_FOAM_EVERY; this.fxs.foamRing(e.pos, e.len * (0.5 + k)); }
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
                life: 2.2, size: [0.22 * e.len, 0.75 * e.len], color: WAKE, alpha: 0.6, spin: k * 0.4, fadeIn: 0.04 });
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
    const e = { g, fig, ring, blob, model: gr, base: GRUNT_HEIGHT / this.models.goblin.size.y, setDown: 0, state: null, pos: p.clone(), yaw: 0, die: -1 };
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
      const d = e.pos.clone().sub(before), moving = d.lengthSq() > 1e-8, bite = moving || this.match.options.bombs ? null : this.biteTarget(gr);   // a bomb-rule grunt drops a bomb instead of biting
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
      // a grunt that has just set a bomb down crouches over it (a squash that lasts half a second), then runs as the model says
      if (e.setDown > 0) { e.setDown = Math.max(0, e.setDown - dt * 2); const k = Math.sin(Math.PI * (1 - e.setDown)); e.fig.root.scale.y = e.base * (1 - 0.3 * k); e.g.position.y -= 0.12 * k; }
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
        // FULL-RENDER: a recruited ship's ball is gold (it fights for the players), the serpent's boulder a grey stone twice a ball's
        // size, an incendiary ball (a fireship's, the dreadnought's, a mortar's) trails fire
        const ally = sh.fromSlot === ShotModel.FromAlly, boulder = sh.fromSlot === ShotModel.FromSerpent;
        const mat = sh.fromSlot >= 0 ? this.slotGlow(sh.fromSlot) : ally ? this.glowAlly : boulder ? this.boulderMat : this.glowEnemy;
        const ball = new THREE.Mesh(this.geo.ball, mat);
        if (boulder) ball.scale.setScalar(2.2);
        const trail = { colour: sh.fromSlot >= 0 ? this.colours[sh.fromSlot] : ally ? ALLY_RIM : boulder ? BOULDER_TRAIL : sh.incendiary ? FIRE_TRAIL : ENEMY_SHOT, last: null };
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
    outlineFigure(fig.root);                                           // UC-L1: the chunky dark outline
    // what the hero holds rides on the right hand bone; `hand` cancels the bone's own scale so the tools keep their size in squares,
    // scaled with the hero (they were sized for a TOOLS_AT-square hero)
    const bone = boneEndingWith(fig.root, 'RightHand');
    g.updateMatrixWorld(true);
    const hand = new THREE.Group(); hand.scale.setScalar(0.8 * (HERO_HEIGHT / TOOLS_AT) / bone.getWorldScale(new THREE.Vector3()).x);
    hand.rotation.set(Math.PI / 2, 0, 0); bone.add(hand);
    // what the tool-out hero holds: a sword half a square long, or in the bomb rule set the bomb model (AUTHORED sizes)
    const bombs = this.match.options.bombs;
    let armed;
    if (bombs) {
      armed = new THREE.Group();
      for (const p of this.bomb.parts) armed.add(new THREE.Mesh(p.geometry, p.material));
      armed.scale.setScalar(0.55); armed.position.y = -0.12;
    } else { armed = new THREE.Mesh(this.geo.blade, this.glowP[s]); armed.scale.set(1.5, 1.5, 1.5); }
    hand.add(armed);
    const hammer = new THREE.Mesh(this.geo.hammer, mats.vc); hand.add(hammer);
    const torch = new THREE.Group(); torch.add(new THREE.Mesh(this.geo.torch, mats.vc));
    const tip = new THREE.Mesh(this.geo.pip, glow(new THREE.Color(0xffa040), 3)); tip.position.y = 0.36; torch.add(tip); hand.add(torch);
    const ring = new THREE.Mesh(this.geo.ring, this.glowP[s]); ring.scale.setScalar(HERO_RING);
    const shadow = new THREE.Mesh(this.geo.disc, this.blobMat); shadow.scale.setScalar(HERO_BLOB); shadow.renderOrder = 1;
    const reticle = new THREE.Mesh(this.geo.reticle, this.glowP[s]);   // the ring and its four ticks, one draw
    this.group.add(g, ring, shadow, reticle);
    const e = { g, fig, state: null, armed, tip: 0, hammer, torch, hand, ring, shadow, reticle, pos: null, vel: new THREE.Vector3(), yaw: 0, swing: 0,
                at: new THREE.Vector3(), baseScale: g.scale.clone(), gest: null, holdK: 0 };
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
    const m = this.match, ctl = view.controllers[0], playing = !(m.ended || m.phase === Phase.Decide), bombs = m.options.bombs;
    const raid = m.phase === Phase.Raid;   // BOMBER_UC.md: in the RAID the drawn hero IS the rules' hero, on the board while it has one
    for (let s = 0; s < this.heroes.length; s++) {
      const e = this.heroes[s], p = m.player(s), show = playing && p.connected && !(raid && p.heroAt === null);
      e.g.visible = e.ring.visible = e.shadow.visible = show;
      e.reticle.visible = false;
      if (!show) continue;
      const cur = ctl.cursorExact(s), cx = Math.floor(cur.x), cy = Math.floor(cur.y), g = m.grid;
      // where the hero stands: the cursor (in the bomb rule set the hero walks to it on land: the controller's hero), or over open
      // sea the nearest shore square beneath it. UC-P3: read BETWEEN the rules' ticks at this frame's alpha (heroAt / cursorAt), so
      // the target moves every display frame; until 11-09 it jumped once a tick and the drawn hero (eased toward it faster than the
      // rules walk) caught it and stood still until the next tick - a walk of starts and stops at 30 Hz
      const alpha = view.alpha ?? 1;
      const stand = bombs ? ctl.heroAt(s, alpha) : ctl.cursorAt(s, alpha), sx = Math.floor(stand.x), sy = Math.floor(stand.y);
      let tx = stand.x, tz = stand.y;
      if (g.in(sx, sy) && g.terrainAt(sx, sy) === Terrain.Water) {
        const n = this.dryNearest[sy * g.width + sx];
        if (n >= 0) { tx = (n % g.width) + 0.5; tz = Math.floor(n / g.width) + 0.5; }
      }
      // over a standing castle the hero waits at the castle's foot: the castle model is taller than the hero and would hide it (the
      // tag, the ghost and the reticle still show the cursor itself). UC-P3: pushed out to the NEAREST side (the south one, the
      // camera's, preferred by CASTLE_SOUTH squares), so walking past a castle slides the hero round it instead of jumping it to the
      // south foot and back
      const t0x = tx, t0z = tz;
      for (const k of this.castles.values()) {
        if (k.castle.ruined) continue;
        const c = k.g.position, half = k.half + 0.2;
        if (Math.abs(tx - c.x) >= half || Math.abs(tz - c.z) >= half) continue;
        const side = [['s', c.z + half - tz - CASTLE_SOUTH], ['n', tz - (c.z - half)], ['e', c.x + half - tx], ['w', tx - (c.x - half)]].sort((a, b) => a[1] - b[1])[0][0];
        if (side === 's') tz = c.z + half; else if (side === 'n') tz = c.z - half; else if (side === 'e') tx = c.x + half; else tx = c.x - half;
      }
      e.adjusted = tx !== t0x || tz !== t0z || sx !== Math.floor(tx) || sy !== Math.floor(tz);   // drawn away from the rules' point (a page check reads it)
      // UC-P3: the drawn hero is a body with a velocity pulled to that point by a critically damped spring (HERO_OMEGA): it speeds
      // up from a stand, slows into a stop, carries no step of the rules' grid, and at a steady walk keeps a steady small lag. A
      // jump the rules make (a new map, the castle's foot) is too far to walk: it is taken at once (HERO_SNAP)
      if (!e.pos || Math.hypot(tx - e.pos.x, tz - e.pos.z) > HERO_SNAP) { e.pos = new THREE.Vector3(tx, 0, tz); e.vel = new THREE.Vector3(); }
      if (raid) {
        // the RAID's grid walk is already smooth (the rules' hero read between ticks at this frame's alpha); a spring's lag would draw
        // the hero a square behind the square the rules catch it on, so it is drawn exactly there, its velocity read off the motion
        const h = Math.max(dt, 1e-3);
        e.vel.set((tx - e.pos.x) / h, 0, (tz - e.pos.z) / h); e.pos.x = tx; e.pos.z = tz;
      } else {
        const h = Math.min(dt, 0.05), w = HERO_OMEGA, f = 1 + 2 * h * w, hh = h * w * w;
        for (const [ax, goal] of [['x', tx], ['z', tz]]) {             // the implicit (stable at any frame time) critically damped step
          const det = f + h * hh, x0 = e.pos[ax], v0 = e.vel[ax];
          e.vel[ax] = (v0 + hh * (goal - x0)) / det;
        }
        // never faster than HERO_MAX: a target that jumps (round a castle to its foot, off the sea to the shore) is walked to, not
        // flown to - the spring alone would cover a 4-square jump at ~70 squares/s, which reads as a teleport
        const vlen = Math.hypot(e.vel.x, e.vel.z);
        if (vlen > HERO_MAX) { e.vel.x *= HERO_MAX / vlen; e.vel.z *= HERO_MAX / vlen; }
        e.pos.x += e.vel.x * h; e.pos.z += e.vel.z * h;
      }
      e.pos.y = this.board.groundAtPoint(e.pos.x, e.pos.z);
      const speed = Math.hypot(e.vel.x, e.vel.z), moving = speed > IDLE_BELOW;
      const aiming = m.phase === Phase.Battle && !p.sword;
      // turning: toward the way it walks, eased (no snap round when the input turns)
      if (moving) e.yaw = yawTo(e.yaw, Math.atan2(e.vel.x, e.vel.z), Math.min(1, dt * TURN_RATE));
      else if (aiming) e.yaw = yawTo(e.yaw, Math.atan2(cur.x - e.pos.x, cur.y - e.pos.z), Math.min(1, dt * 8));
      // the clip from the REAL speed: the stance standing, walking, running; each played at the rate its feet need (AUTHORED rates)
      e.swing = Math.max(0, e.swing - dt);
      if (e.state === 'Right_Hand_Sword_Slash' && e.swing > 0) { /* the slash plays out */ }
      else if (moving && speed > RUN_FROM) { this.play(e, 'Running', 0.2); e.fig.actions.Running.timeScale = Math.min(1.6, Math.max(0.8, speed / RUN_NATURAL)); }
      else if (moving) { this.play(e, 'Walking', 0.2); e.fig.actions.Walking.timeScale = Math.min(1.5, Math.max(0.6, speed / WALK_NATURAL)); }
      else this.play(e, 'Combat_Stance', 0.3);
      e.fig.mixer.update(dt);
      e.g.position.copy(e.pos);
      // the bomb verbs' gestures (view only, the Zelda-style polish): a dip to set a bomb down, a crouch and lift to pick one up, a
      // wind-up and throw, a crouch held while putting one out, and a dizzy wobble while stunned
      const gs = this.gestureOf(e, p, ctl.holdProgress ? ctl.holdProgress(s) : 0, seconds, dt);
      // a stunned hero (bomb rule set) is knocked half over and wobbles dizzily; getting up eases back
      e.tip += ((bombs && p.stunLeft > 0 ? 1 : 0) - e.tip) * Math.min(1, dt * 10);
      const dizzy = e.tip * Math.sin(seconds * 7.5) * 0.28;
      e.g.rotation.set(gs.lean, e.yaw + e.tip * Math.sin(seconds * 3.1) * 0.6, e.tip * 0.55 + dizzy, 'YXZ');
      e.g.position.y += gs.lift - e.tip * 0.2;
      e.g.scale.set(e.baseScale.x * gs.wide, e.baseScale.y * gs.tall, e.baseScale.z * gs.wide);
      e.ring.position.set(e.pos.x, e.pos.y + 0.03, e.pos.z); e.ring.scale.setScalar(HERO_RING + Math.sin(seconds * 4 + s) * 0.05);
      e.shadow.position.set(e.pos.x, e.pos.y + 0.02, e.pos.z);
      // the tool in hand: the sword (bombs, in the bomb rule set) when it is out (REPAIR and BATTLE), else the phase's tool
      const slashing = !bombs && e.state === 'Right_Hand_Sword_Slash' && e.swing > 0;  // a slash shows the sword to its end
      const sword = slashing || (p.sword && (m.phase === Phase.Repair || m.phase === Phase.Battle) && !(bombs && p.carrying > 0));   // a carried bomb floats over the hand
      e.armed.visible = sword || (raid && p.carrying === 0 && p.bombs > 0);   // the RAID's one tool: a bomb in hand while one is free e.hammer.visible = !sword && (m.phase === Phase.Repair || m.phase === Phase.Cannons); e.torch.visible = aiming && !sword;
      if (aiming) {
        e.reticle.visible = true;
        const wetC = !g.in(cx, cy) || g.terrainAt(cx, cy) === Terrain.Water;
        e.reticle.position.set(cur.x, wetC ? 0.06 : this.board.groundAtPoint(cur.x, cur.y) + 0.06, cur.y);
        e.reticle.rotation.y = seconds * 1.5; e.reticle.scale.setScalar(1 + Math.sin(seconds * 6) * 0.06);
      }
      e.at.copy(e.g.position);
    }
  }

  /** A hero's bomb gesture now (view only): { lean (pitch, + forward), lift (y), tall, wide (scale factors) }. A one-shot gesture
   *  (drop, lift, toss) runs GESTURE[kind].secs from gesture(); the defuse crouch is held while the hold ring fills. */
  gestureOf(e, p, hold, seconds, dt) {
    const out = { lean: 0, lift: 0, tall: 1, wide: 1 };
    const crouch = (k) => { out.lean += 0.45 * k; out.lift -= 0.12 * k; out.tall *= 1 - 0.16 * k; out.wide *= 1 + 0.06 * k; };
    e.holdK += ((hold > 0 ? 1 : 0) - e.holdK) * Math.min(1, dt * 14);
    if (e.holdK > 0.01) { crouch(e.holdK); out.lean += e.holdK * Math.sin(seconds * 18) * 0.03; }   // a busy little shake of the hands
    const gst = e.gest;
    if (gst) {
      const k = (seconds - gst.t0) / GESTURE[gst.kind];
      if (k >= 1 || k < 0) e.gest = null;
      else if (gst.kind === 'drop') crouch(Math.sin(Math.PI * k));                                   // down and up again
      else if (gst.kind === 'lift') {                                                               // crouch, then rise tall
        if (k < 0.45) crouch(Math.sin(Math.PI * k / 0.9)); else { const u = (k - 0.45) / 0.55; crouch(Math.max(0, 1 - u * 2)); out.tall *= 1 + 0.08 * Math.sin(Math.PI * u); out.lift += 0.08 * Math.sin(Math.PI * u); }
      } else if (gst.kind === 'toss') out.lean += k < 0.35 ? -0.35 * Math.sin(Math.PI * k / 0.7) : 0.5 * Math.sin(Math.PI * (k - 0.35) / 0.65);   // wind up back, throw forward
    }
    return out;
  }
  /** Start a bomb gesture on slot's hero: 'drop' (set a bomb down), 'lift' (pick one up) or 'toss' (throw it). */
  gesture(slot, kind) {
    const e = this.heroes[slot];
    if (!e || !(kind in GESTURE)) throw new Error('units.js: no hero gesture "' + kind + '" for slot ' + slot);
    e.gest = { kind, t0: this.clock };
  }

  heroTags() {
    const out = [];
    this.heroes.forEach((e, s) => { if (e.g.visible) out.push({ slot: s, at: e.at.clone().add(new THREE.Vector3(0, HERO_HEIGHT + 0.35, 0)) }); });
    return out;
  }

  // ------------------------------------------------------------------ ghosts (what confirm would place)
  makeGhost(s) {
    const col = this.colours[s];
    // AUTHORED (round 4, phone pass): lightened toward white and less see-through, so the piece reads from the near top-down REPAIR
    // camera on a phone, where a square is ~15 px and the deeper P1 blue at half opacity sank into the grass
    const ok = glowing(new THREE.MeshBasicNodeMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.3).multiplyScalar(1.4), transparent: true, opacity: 0.72, depthWrite: false }));
    const bad = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xff2b2b), transparent: true, opacity: 0.6, depthWrite: false });
    const geo = new THREE.BoxGeometry(0.9, 0.5, 0.9).translate(0, 0.25, 0);
    // UC-C2: the legal piece and the refused one are two meshes, never one mesh whose material is swapped: three r175 builds an
    // InstancedMesh's shader per mesh AND material at its first draw, so a swap built the refused one when a piece first went red
    // (measured 11-13, as CANNONS began); two meshes are both drawn by the renderer's one warm-up draw (warmGhosts)
    const im = new THREE.InstancedMesh(geo, ok, 16); drawAllRoom(im, 0); im.renderOrder = 3; im.frustumCulled = false;
    const imBad = new THREE.InstancedMesh(geo, bad, 16); drawAllRoom(imBad, 0); imBad.renderOrder = 3; imBad.frustumCulled = false;
    // UC-P1: the squares behind a refusal, outlined in red over everything (a square frame: a 4-sided ring turned to the grid)
    const frame = new THREE.RingGeometry(0.6, 0.72, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2);
    const outline = new THREE.InstancedMesh(frame, this.badOutline, 16); drawAllRoom(outline, 0); outline.renderOrder = 5; outline.frustumCulled = false;
    const castleRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.42, 40).rotateX(-Math.PI / 2), this.glowP[s]); castleRing.visible = false;
    this.group.add(im, imBad, outline, castleRing);
    return { im, imBad, ok, bad, outline, castleRing, shown: null, refused: null };
  }
  /** CONTROLS_SMOOTH_UC.md UC-C2: every player's ghost in view at matrix m for renderer.prepareLevel's draw. A ghost's legal and
   *  refused pieces and its refusal outline are InstancedMeshes made with the level, so three builds their shaders at their first draw
   *  (measured 11-13: built as CANNONS began after the first claim), and the castle ring showed first at the claim. updateGhosts lays
   *  them out again from the next frame; the returned undo hides them until it does. */
  warmGhosts(m) {
    const meshes = (e) => [e.im, e.imBad, e.outline];
    for (const e of this.ghosts) { for (const im of meshes(e)) { im.setMatrixAt(0, m); drawAllRoom(im, 1); } e.castleRing.visible = true; }
    return () => { for (const e of this.ghosts) { for (const im of meshes(e)) drawAllRoom(im, 0); e.castleRing.visible = false; } };
  }
  /** What each player's ghost shows this frame (UC-P1), for the HUD's note and the page check: the squares drawn, whether legal,
   *  the model's verdict (kind + result: MatchController.ghostOf), the squares outlined red, the words, and the last refusal's
   *  reason (flashed at the ghost for REFUSED_SECONDS). null = no ghost drawn. */
  ghostShown(s) { return this.ghosts[s].shown; }
  updateGhosts(view, seconds) {
    const m = this.match, ctl = view.controllers[0], mat = new THREE.Matrix4();
    const terr = m.phase === Phase.Cannons ? EnclosureRules.map(m.grid) : null;
    const at = (c) => (m.grid.in(c.x, c.y) ? this.board.groundAt(c.x, c.y) : 0);   // a square off the board is drawn on the sea
    for (let s = 0; s < this.ghosts.length; s++) {
      const e = this.ghosts[s], p = m.player(s);
      e.im.visible = false; e.imBad.visible = false; e.outline.visible = false; e.castleRing.visible = false; e.shown = null;
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
      const gh = ctl.ghostOf(s, terr);
      if (!gh.cells) continue;
      const im = gh.legal ? e.im : e.imBad;   // the legal piece or the refused one (two meshes, makeGhost)
      const hover = 0.12 + Math.sin(seconds * 5 + s) * 0.05, low = m.phase === Phase.Cannons ? 0.45 : 1;
      // EVERY square of the piece, on the board or not (until 11-09 squares off the board were skipped, so a piece hanging off the
      // edge showed as a shorter red piece with nothing to say why: UC-P1)
      let k = 0, top = 0, cx = 0, cz = 0;
      for (const c of gh.cells) {
        const gy = at(c);
        mat.makeScale(1, low, 1).setPosition(c.x + 0.5, gy + hover, c.y + 0.5);
        im.setMatrixAt(k++, mat);
        top = Math.max(top, gy + hover + 0.5 * low); cx += c.x + 0.5; cz += c.y + 0.5;
      }
      drawAllRoom(im, k);                       // all 16 drawn, the unused scaled to nothing (look.js: the shader's bound array)
      let n = 0;
      for (const c of gh.bad) { mat.makeTranslation(c.x + 0.5, at(c) + 0.72 + hover, c.y + 0.5); e.outline.setMatrixAt(n++, mat); }
      drawAllRoom(e.outline, n);
      const refused = e.refused && seconds - e.refused.t < REFUSED_SECONDS ? e.refused : null;
      e.shown = { cells: gh.cells.map((c) => [c.x, c.y]), legal: gh.legal, kind: gh.kind, result: gh.result, bad: gh.bad.map((c) => [c.x, c.y]),
                  text: HudViewModel.ghostWords(gh, m.grid), refused, at: new THREE.Vector3(cx / k, top + 0.25, cz / k) };
    }
  }
  /** The ghosts' notes for the HUD (UC-P1): the reason at a red ghost, and a refusal's reason flashed there. */
  ghostNotes(seconds) {
    const out = [];
    this.ghosts.forEach((e, s) => {
      const g = e.shown;
      if (!g) return;
      const flash = g.refused !== null, text = flash ? g.refused.text : g.text;
      if (text) out.push({ slot: s, at: g.at, text, strong: flash ? 1 - (seconds - g.refused.t) / REFUSED_SECONDS : 0 });
    });
    return out;
  }
  /** A refusal of a ghost's confirm (PlacementRejected, or a CommandRejected of a cannon), remembered to flash at the ghost. */
  refusedAt(slot, kind, reason, seconds) {
    const e = this.ghosts[slot];
    if (!e) return;
    const bad = e.shown && e.shown.result === reason ? e.shown.bad.map(([x, y]) => ({ x, y })) : [];
    e.refused = { kind, code: reason, text: HudViewModel.ghostWords({ legal: false, kind, result: reason, bad }, this.match.grid), t: seconds };
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
        this.fxs.splash(at, 1.6 * k);
        this.fxs.planks(at, C.wood, 7, k);                                   // debris left floating on the water
      }
      else if (e instanceof GruntKilled) { this.fxs.dust(cellAt(e.at, 0), 0.8, new THREE.Color(0.62, 0.58, 0.68)); }
      else if (e instanceof CannonDamaged) { const c = this.cannons.get(e.cannonId); if (c) this.fxs.explosion(c.g.position.clone().add(new THREE.Vector3(0, 0.5, 0)), C.iron, 0.7); }
      else if (e instanceof CastleBitten || e instanceof CastleRuined || e instanceof CastleRestored) {   // UC-L5
        const k = this.castles.get(e.castleId);
        if (k) {
          const at = k.g.position.clone().add(new THREE.Vector3(0, k.top * 0.5, 0)), foot = k.g.position.clone();
          if (e instanceof CastleBitten) { this.fxs.chunks(at, C.stone, 4, 0.7); this.fxs.dust(foot, 0.7); k.pulse = 1; }
          else if (e instanceof CastleRuined) { this.fxs.explosion(at, C.stone, 1.4); this.fxs.chunks(at, C.stone, 12, 1.3); this.fxs.dust(foot, 2.2); }
          else for (let i = 0; i < 8; i++) this.fxs.sparkle(at.clone().add(new THREE.Vector3(Math.cos(i * 0.785) * k.half, 0, Math.sin(i * 0.785) * k.half)), NEUTRAL_GLOW, i * 0.04);
        }
      }
      else if (e instanceof WallsPlaced || e instanceof RingBuilt) {   // the dust waits for each block to land (board.js WALL_DROP)
        const n = e.cells.length, k = e instanceof WallsPlaced ? 0.75 : 0.55;
        e.cells.forEach((c, i) => this.dustDue.push({ at: cellAt(c, 0), k, due: this.clock + wallLandsAfter(i, n) }));
      }
      else if (e instanceof CannonPlaced) { this.fxs.dust(new THREE.Vector3(e.topLeft.x + 1, this.board.groundAt(e.topLeft.x, e.topLeft.y), e.topLeft.y + 1), 1.6); }
      else if (e instanceof LoopClosed) {
        const k = this.castles.get(e.castleId);
        if (k) {
          const swept = this.board.flashRegionOf(k.cells);              // the capture glow sweeps out from the castle
          const col = this.colours[e.slot] ?? C.foam;
          for (const q of swept) if (this.fxs.rnd() < 0.5) this.fxs.sparkle(new THREE.Vector3(q.x + 0.2 + this.fxs.rnd() * 0.6, this.board.groundAt(q.x, q.y) + 0.1, q.y + 0.2 + this.fxs.rnd() * 0.6), col, q.delay);
        }
      } else if (e instanceof PlacementRejected) {
        if (e.slot >= 0 && e.slot < this.ghosts.length) this.refusedAt(e.slot, 'wall', e.reason, this.clock);
      } else if (e instanceof CommandRejected && e.kind === CommandKind.PlaceCannon) {
        if (e.slot >= 0 && e.slot < this.ghosts.length) this.refusedAt(e.slot, 'cannon', e.reason, this.clock);
      } else if (e instanceof SwordSwung) {
        this.slash(e.slot);
        this.fxs.flash(cellAt(e.at, 0.4), this.colours[e.slot], 0.5);
      } else if (e instanceof CastleClaimed) {
        const k = this.castles.get(e.castleId);
        if (k) this.fxs.flash(k.g.position.clone().add(new THREE.Vector3(0, 1.2, 0)), this.colours[e.slot], 1.2);
      } else if (this.bombs) this.bombs.event(e, cellAt);
      if (this.full) this.full.event(e, cellAt);
    }
  }

  /** A hero's arm swing (the slash clip, sped up to a quick swing, from its start): a sword strike, or in the bomb rule set a bomb
   *  dropped or thrown. */
  slash(slot) {
    const h = this.heroes[slot];
    if (!h) return;
    if (h.state === 'Right_Hand_Sword_Slash') h.fig.actions.Right_Hand_Sword_Slash.reset();   // a second swing starts it again
    this.play(h, 'Right_Hand_Sword_Slash', 0.08);
    const a = h.fig.actions.Right_Hand_Sword_Slash;
    a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = SLASH_SPEED;
    h.swing = a.getClip().duration / SLASH_SPEED;
  }

  update(view, dt, seconds) {
    this.clock = seconds;
    if (this.dustDue.length) {
      const left = [];
      for (const d of this.dustDue) { if (d.due <= seconds) this.fxs.dust(d.at, d.k); else left.push(d); }
      this.dustDue = left;
    }
    const alpha = view.alpha ?? 0;
    this.updateCastles(seconds, dt);
    this.rise.update(dt, seconds);                                    // after the castles: it reads which are secured (UC-L8)
    this.updateCannons(view, dt);
    this.updateShips(dt, seconds);
    this.updateGrunts(dt);
    this.updateShots(alpha);
    this.updateHeroes(view, dt, seconds);
    if (this.bombs) this.bombs.update(view, dt, seconds);
    if (this.full) this.full.update(view, dt, seconds);
    this.updateGhosts(view, seconds);
  }

  /** The glowing material of a player slot's colour; a slot the match does not have is an error. */
  slotGlow(slot) {
    const m = this.glowP[slot];
    if (!m) throw new Error('units.js: no player in slot ' + slot + ' (the match has ' + this.glowP.length + ')');
    return m;
  }

  dispose() {
    if (this.bombs) this.bombs.dispose();
    if (this.full) this.full.dispose();
    this.rise.dispose();
    for (const e of this.heroes) e.fig.mixer.stopAllAction();
    for (const e of this.grunts.values()) e.fig.mixer.stopAllAction();
    this.scene.remove(this.group);
  }
}
