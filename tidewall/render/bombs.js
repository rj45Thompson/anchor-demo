// bombs.js - what the bomb rule set (core/match/Bombs.js, BOMBS_SPEC.md) adds to the picture, drawn from the model every frame:
// lit bombs (the Sketchfab "Round Bomb", CC BY 4.0, credited on the title screen: a dark iron sphere with its fuse; a spark at the
// fuse's tip, read from the model's vertices; pulsing faster as the fuse burns down, with a ring on the ground that
// shrinks to the bomb in its owner's colour, or red for a grunt's), bombs carried over a hero's hands and bombs in the air on their
// arc, spike traps, the stars over a stunned hero, and the ring that fills while a hero holds to put a bomb out. The events start
// the bursts (the blast and its cross of flame, puffs, splashes). The bomb is the model (renderer.js bakes its parts once and reads
// its radius and fuse tip); the traps, rings and stars are procedural; every particle is fx.js's.
//
// The RAID (BOMBER_UC.md, 11-13): a blast's burning squares are drawn from the model's fires as COLUMNS OF FIRE standing along each arm
// while they burn (match.fires, the same squares that catch what walks in), shrinking as they burn out; a power-up is a spinning
// token over a ring in its kind's colour and shape (FIRE a flame, BOMB a bomb, SPEED a double chevron), shown once its fire is out;
// a broken soft block bursts into chunks of what it was (SoftBlockBroken).
import * as THREE from 'three/webgpu';
import { BombExploded, BombDropped, BombPickedUp, BombThrown, BombLanded, BombSank, BombDefused, BombFumbled, PlayerStunned, ItemBought,
         TrapPlaced, TrapSprung, TrapRemoved, MetalPlaced, PowerUpRevealed, PowerUpTaken, PowerUpBurned, SoftBlockBroken, PowerKind,
         Occupant } from '../core/index.js';
import { C, STEEL, mats, glow, trapGeometry, HERO_HEIGHT } from './look.js';

// AUTHORED (BOMBER_UC.md R17): the fire columns - radius and height in squares at full burn, how far they shrink as they burn out,
// their flicker - and the power-ups' colours (far apart from each other and from the grass), sizes and spin
const FIRE_R = 0.4, FIRE_H = 1.25, FIRE_MIN = 0.35, FIRE_FLICKER = 0.18;
const FIRE_OUTER = new THREE.Color(0xff5a14), FIRE_INNER = new THREE.Color(0xffd070);
const POWER_COLOUR = Object.freeze({ [PowerKind.Fire]: new THREE.Color(0xff6a1a), [PowerKind.Bomb]: new THREE.Color(0x3d8bff), [PowerKind.Speed]: new THREE.Color(0x12a88f) });   // a deep teal: a light one bloomed to white under the white chevrons
const POWER_LIFT = 0.75, POWER_BOB = 0.1, POWER_SPIN = 2.2, POWER_RING = 1.5;   // (11-13 frames: at the raid's zoom a 0.3-square token read as a speck)
const POWER_KINDS_DRAWN = Object.freeze([PowerKind.Fire, PowerKind.Bomb, PowerKind.Speed]);
/** A flat symbol lying face up (a THREE.Shape in the x / -z plane: its +y is up the screen from the south-facing camera). */
const flatIcon = (shape) => new THREE.ShapeGeometry(shape, 8).rotateX(-Math.PI / 2);
/** FIRE: a flame of three tongues, the middle one tallest, round at its foot, with a hole where its hot core is (the disc's colour
 *  shows through). BOMBER_UC step 10: a lone teardrop read as a water drop (LOOKED at shots/bombs/raid_05_power_up.png, 11-13). */
function flameIcon() {
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.27);
  sh.bezierCurveTo(0.2, -0.27, 0.29, -0.12, 0.23, 0.03);
  sh.quadraticCurveTo(0.21, 0.13, 0.26, 0.22);                // the right tongue's tip
  sh.quadraticCurveTo(0.13, 0.15, 0.1, 0.05);
  sh.quadraticCurveTo(0.1, 0.2, 0, 0.34);                     // the middle tongue's tip
  sh.quadraticCurveTo(-0.1, 0.2, -0.1, 0.05);
  sh.quadraticCurveTo(-0.13, 0.15, -0.26, 0.22);              // the left tongue's tip
  sh.quadraticCurveTo(-0.21, 0.13, -0.23, 0.03);
  sh.bezierCurveTo(-0.29, -0.12, -0.2, -0.27, 0, -0.27);
  const core = new THREE.Path();
  core.moveTo(0, -0.17); core.bezierCurveTo(0.11, -0.17, 0.1, -0.02, 0, 0.1); core.bezierCurveTo(-0.1, -0.02, -0.11, -0.17, 0, -0.17);
  sh.holes.push(core);
  return sh;
}
/** BOMB: a round bomb with its fuse. */
function bombIcon() {
  const sh = new THREE.Shape();
  sh.absarc(-0.03, -0.04, 0.2, 0, Math.PI * 2, false);
  const fuse = new THREE.Shape(); fuse.moveTo(0.09, 0.11); fuse.lineTo(0.2, 0.25); fuse.lineTo(0.25, 0.21); fuse.lineTo(0.14, 0.07); fuse.lineTo(0.09, 0.11);
  return [sh, fuse];
}
/** SPEED: a double chevron pointing ahead (>>). */
function chevrons() {
  const one = (x) => { const sh = new THREE.Shape(); sh.moveTo(x, 0.22); sh.lineTo(x + 0.17, 0); sh.lineTo(x, -0.22); sh.lineTo(x - 0.08, -0.22); sh.lineTo(x + 0.09, 0); sh.lineTo(x - 0.08, 0.22); sh.lineTo(x, 0.22); return sh; };
  return [one(-0.17), one(0.03)];
}
/** What a broken soft block bursts into (its own palette colours). */
const SOFT_CHUNKS = Object.freeze({ [Occupant.Tree]: [C.leaf, C.wood], [Occupant.RockSmall]: [C.rock, C.rockDark], [Occupant.House]: [C.houseWall, C.houseRoof] });

const HOT = new THREE.Color(0xff3020), SPARK = new THREE.Color(0xffb040), GOLD = new THREE.Color(0xffd24a);
const BIG_SCALE = 1.45;                         // AUTHORED: a big bomb's size against a normal one's
const HOLD_STEPS = 12;                          // the defuse hold is 12 ticks (rules.defuseHoldTicks): one ring drawing per tick
const CARRY_LIFT = 0.3;                         // AUTHORED: squares a carried bomb floats over the hand
const ARC_BASE = 0.9, ARC_PER_CELL = 0.22;      // AUTHORED: a thrown bomb's arc height: squares, plus this much per square thrown
const SPARK_EVERY = 0.08;                       // AUTHORED: seconds between embers off a fuse
const STAR_COUNT = 3, STAR_HEIGHT = HERO_HEIGHT + 0.15;   // AUTHORED: stars over a stunned hero, a little over its head

export class BombsView {
  /** @param units the Units this belongs to (its heroes, grunts, board, colours and materials are used). */
  constructor(units) {
    this.units = units;
    const B = units.bomb;                         // { parts, big, radius, tip } (renderer.js), the bomb model's baked parts
    this.radius = B.radius; this.tip = B.tip;
    this.group = new THREE.Group(); this.group.name = 'bombs'; units.group.add(this.group);
    this.geo = {
      trap: trapGeometry(),
      hot: new THREE.SphereGeometry(B.radius * 1.07, 12, 8).translate(0, B.radius, 0), spark: new THREE.SphereGeometry(0.08, 6, 4),
      ring: new THREE.RingGeometry(0.46, 0.5, 40).rotateX(-Math.PI / 2), trapRing: new THREE.RingGeometry(0.44, 0.5, 24).rotateX(-Math.PI / 2),
      star: new THREE.OctahedronGeometry(0.1, 0), hold: [],
    };
    for (let i = 1; i <= HOLD_STEPS; i++) this.geo.hold.push(new THREE.RingGeometry(0.62, 0.74, 32, 1, Math.PI / 2, -2 * Math.PI * i / HOLD_STEPS).rotateX(-Math.PI / 2));
    this.mat = { hot: glow(HOT, 2.4), spark: glow(SPARK, 3), star: glow(GOLD, 2.6), fireOuter: glow(FIRE_OUTER, 2.2), fireInner: glow(FIRE_INNER, 3.2) };
    // the RAID: a fire column (an open, tapering tube, and a thinner hot core) and the power-up tokens
    this.geo.fireOuter = new THREE.CylinderGeometry(FIRE_R * 0.45, FIRE_R, 1, 10, 1, true).translate(0, 0.5, 0);
    this.geo.fireInner = new THREE.CylinderGeometry(FIRE_R * 0.2, FIRE_R * 0.55, 0.8, 8, 1, true).translate(0, 0.4, 0);
    // a power-up: a flat disc in its kind's colour with a white symbol lying on its face, read from the RAID's steep camera (an upright
    // spinning coin was seen edge-on, a thin bar, in the 11-13 frames)
    this.geo.token = new THREE.CylinderGeometry(0.44, 0.44, 0.1, 28);
    this.geo.flame = flatIcon(flameIcon());
    this.geo.ball = flatIcon(bombIcon());
    this.geo.chevron = flatIcon(chevrons());
    this.mat.fireOuter.side = THREE.DoubleSide; this.mat.fireInner.side = THREE.DoubleSide;   // open tubes: seen from inside too
    this.mat.power = Object.fromEntries(Object.entries(POWER_COLOUR).map(([k, c]) => [k, glow(c, 1.8)]));
    this.mat.tokenFace = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xfff6e0) });
    this.columns = []; this.powers = new Map();
    this.bombs = new Map(); this.traps = new Map(); this.stars = []; this.holds = [];
    const n = units.match.playerCount;
    for (let s = 0; s < n; s++) {
      const stars = new THREE.Group(); stars.visible = false;
      for (let i = 0; i < STAR_COUNT; i++) stars.add(new THREE.Mesh(this.geo.star, this.mat.star));
      const hold = new THREE.Mesh(this.geo.hold[0], units.glowP[s]); hold.visible = false;
      this.group.add(stars, hold); this.stars.push(stars); this.holds.push(hold);
    }
    this.tmp = new THREE.Vector3();
  }

  ground(c) { return this.units.board.groundAt(c.x, c.y); }

  makeBomb(b) {
    const g = new THREE.Group();
    const body = new THREE.Group();
    for (const p of b.big ? this.units.bomb.big : this.units.bomb.parts) { const mesh = new THREE.Mesh(p.geometry, p.material); mesh.castShadow = true; body.add(mesh); }
    const hot = new THREE.Mesh(this.geo.hot, this.mat.hot);
    const spark = new THREE.Mesh(this.geo.spark, this.mat.spark); spark.position.copy(this.tip);
    const ring = new THREE.Mesh(this.geo.ring, b.owner < 0 ? this.units.glowGrunt : this.units.slotGlow(b.owner)); ring.renderOrder = 2;
    const sc = b.big ? BIG_SCALE : 1;
    g.add(body, hot, spark); g.scale.setScalar(sc);
    this.group.add(g, ring);
    return { g, body, hot, spark, ring, owner: b.owner, big: b.big, sparkIn: 0 };
  }

  /** Where a bomb is drawn now, and the ground point under it (for its ring). */
  place(b, e, alpha) {
    const u = this.units, p = e.g.position, under = this.tmp;
    if (b.carriedBy >= 0) {
      const h = u.heroes[b.carriedBy];
      if (!h.g.visible) { e.g.visible = e.ring.visible = false; return; }
      h.g.updateMatrixWorld(true); h.hand.getWorldPosition(p); p.y += CARRY_LIFT;
      under.set(h.pos.x, h.pos.y, h.pos.z);
    } else if (b.flightLeft > 0) {
      const t = Math.min(1, (b.flightTicks - b.flightLeft + alpha) / b.flightTicks), from = b.flightFrom, to = b.flightTo;
      const y0 = this.ground(from) + ARC_BASE, y1 = this.ground(to), dist = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      p.set(from.x + 0.5 + (to.x - from.x) * t, y0 + (y1 - y0) * t + (ARC_BASE + ARC_PER_CELL * dist) * 4 * t * (1 - t), from.y + 0.5 + (to.y - from.y) * t);
      under.set(to.x + 0.5, this.ground(to), to.y + 0.5);
    } else {
      p.set(b.at.x + 0.5, this.ground(b.at), b.at.y + 0.5);
      under.copy(p);
    }
    e.g.visible = e.ring.visible = true;
    e.ring.position.set(under.x, under.y + 0.04, under.z);
  }

  update(view, dt, seconds) {
    const m = this.units.match, alpha = view.alpha ?? 0, fuse = m.rules.bombFuse, seen = new Set();
    for (const b of m.bombs) {
      if (!b.alive) continue;
      seen.add(b.id);
      let e = this.bombs.get(b.id);
      if (!e) { e = this.makeBomb(b); this.bombs.set(b.id, e); }
      this.place(b, e, alpha);
      if (!e.g.visible) continue;
      const frac = Math.max(0, Math.min(1, b.fuseLeft / fuse)), freq = 2 + 11 * (1 - frac) * (1 - frac), beat = Math.sin(seconds * freq * 2 * Math.PI) * 0.5 + 0.5;
      const sc = (e.big ? BIG_SCALE : 1) * (1 + 0.09 * beat * (1.4 - frac));
      e.g.scale.setScalar(sc);
      e.hot.visible = beat > 0.62 - 0.2 * (1 - frac);                  // the iron flashes red on the beat, more often as it burns down
      e.spark.scale.setScalar(0.8 + 0.7 * Math.abs(Math.sin(seconds * 31 + b.id)));
      e.ring.scale.setScalar((0.34 + 0.66 * frac) * 1.5 * (e.big ? 1.5 : 1));
      e.ring.visible = e.ring.visible && (frac > 0.25 || beat > 0.4);   // the last quarter second of fuse flickers the ring
      e.sparkIn -= dt;
      if (e.sparkIn <= 0) { e.sparkIn = SPARK_EVERY; this.units.fxs.fuseSpark(e.g.localToWorld(this.tip.clone())); }
    }
    for (const [id, e] of this.bombs) if (!seen.has(id)) { this.group.remove(e.g, e.ring); this.bombs.delete(id); }
    this.updateTraps(m);
    this.updateFires(m, seconds);
    this.updatePowerUps(m, seconds);
    this.updateHeroes(view, seconds);
  }

  /** The renderer's warm-up (renderer.warmFirstUse): one fire column and a token of each power-up kind in view at `at` for its one
   *  draw, so their pipelines are built before play; returns what takes them away again. */
  warm(at) {
    const c = { x: Math.floor(at.x), y: Math.floor(at.z) }, fake = {
      rules: this.units.match.rules, fires: [{ left: 1, cells: [c] }],
      powerUps: POWER_KINDS_DRAWN.map((kind, i) => ({ id: -1 - i, kind, at: { x: c.x + i + 1, y: c.y }, shown: true })),
    };
    this.updateFires(fake, 0); this.updatePowerUps(fake, 0);
    return () => { const none = { rules: fake.rules, fires: [], powerUps: [] }; this.updateFires(none, 0); this.updatePowerUps(none, 0); };
  }

  /** A column of fire on every square that burns now (match.fires), scaled by how much of its burn is left, flickering. */
  updateFires(m, seconds) {
    const span = Math.max(1, m.rules.blastTicks - 1);
    let n = 0;
    for (const f of m.fires) {
      const k = FIRE_MIN + (1 - FIRE_MIN) * Math.min(1, f.left / span);
      for (const c of f.cells) {
        if (n === this.columns.length) {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(this.geo.fireOuter, this.mat.fireOuter), new THREE.Mesh(this.geo.fireInner, this.mat.fireInner));
          g.renderOrder = 4; this.group.add(g); this.columns.push(g);
        }
        const g = this.columns[n++], fl = 1 + FIRE_FLICKER * Math.sin(seconds * 31 + c.x * 1.7 + c.y * 2.3);
        g.visible = true;
        g.position.set(c.x + 0.5, this.ground(c), c.y + 0.5);
        g.scale.set(k, FIRE_H * k * fl, k);
        g.rotation.y = seconds * 3 + c.x;
      }
    }
    for (let i = n; i < this.columns.length; i++) this.columns[i].visible = false;
  }

  /** Every shown power-up: a disc in its colour with its kind's symbol on its face (FIRE a flame, BOMB a bomb, SPEED a double
   *  chevron), bobbing and rocking over a pulsing ring. */
  updatePowerUps(m, seconds) {
    const seen = new Set();
    for (const u of m.powerUps) {
      if (!u.shown) continue;
      seen.add(u.id);
      let e = this.powers.get(u.id);
      if (!e) {
        const g = new THREE.Group(), mat = this.mat.power[u.kind];
        if (!mat) throw new Error('bombs.js: no look for power-up kind ' + u.kind);
        const token = new THREE.Mesh(this.geo.token, mat);
        const icon = new THREE.Mesh(u.kind === PowerKind.Fire ? this.geo.flame : u.kind === PowerKind.Bomb ? this.geo.ball : this.geo.chevron, this.mat.tokenFace);
        icon.position.y = 0.056; icon.renderOrder = 3;
        g.add(token, icon);
        const ring = new THREE.Mesh(this.geo.ring, mat); ring.renderOrder = 2;
        const y = this.ground(u.at);
        ring.position.set(u.at.x + 0.5, y + 0.04, u.at.y + 0.5); ring.scale.setScalar(POWER_RING);
        this.group.add(g, ring);
        e = { g, ring, y, at: u.at };
        this.powers.set(u.id, e);
      }
      e.g.position.set(e.at.x + 0.5, e.y + POWER_LIFT + Math.sin(seconds * 3 + u.id) * POWER_BOB, e.at.y + 0.5);
      e.g.rotation.set(Math.sin(seconds * POWER_SPIN + u.id) * 0.18, 0, Math.cos(seconds * POWER_SPIN * 0.8 + u.id) * 0.18);   // it rocks
      e.ring.scale.setScalar(POWER_RING * (0.92 + 0.12 * Math.sin(seconds * 4 + u.id)));
    }
    for (const [id, e] of this.powers) if (!seen.has(id)) { this.group.remove(e.g, e.ring); this.powers.delete(id); }
  }

  updateTraps(m) {
    const seen = new Set();
    for (const t of m.traps) {
      seen.add(t.id);
      if (this.traps.has(t.id)) continue;
      const g = new THREE.Group(), y = this.ground(t.at);
      g.position.set(t.at.x + 0.5, y, t.at.y + 0.5);
      const plate = new THREE.Mesh(this.geo.trap, mats.vc); plate.castShadow = true;
      const ring = new THREE.Mesh(this.geo.trapRing, this.units.slotGlow(t.owner)); ring.position.y = 0.025;
      g.add(plate, ring); this.group.add(g); this.traps.set(t.id, g);
    }
    for (const [id, g] of this.traps) if (!seen.has(id)) { this.group.remove(g); this.traps.delete(id); }
  }

  /** The stars over a stunned hero and the filling ring round a hero who holds to defuse. */
  updateHeroes(view, seconds) {
    const u = this.units, m = u.match, ctl = view.controllers[0];
    for (let s = 0; s < this.stars.length; s++) {
      const h = u.heroes[s], p = m.player(s), stars = this.stars[s], hold = this.holds[s];
      stars.visible = h.g.visible && p.stunLeft > 0;
      if (stars.visible) {
        stars.position.set(h.pos.x, h.pos.y + STAR_HEIGHT, h.pos.z);
        stars.children.forEach((c, i) => { const a = seconds * 5 + i * 2 * Math.PI / STAR_COUNT; c.position.set(Math.cos(a) * 0.38, Math.sin(seconds * 9 + i) * 0.06, Math.sin(a) * 0.38); c.rotation.y = seconds * 6; });
      }
      const k = h.g.visible ? ctl.holdProgress(s) : 0, step = Math.min(HOLD_STEPS, Math.ceil(k * HOLD_STEPS));
      hold.visible = step > 0;
      if (step > 0) { hold.geometry = this.geo.hold[step - 1]; hold.position.set(h.pos.x, h.pos.y + 0.06, h.pos.z); }
    }
  }

  /** The bursts of the bomb events (units.events has already dropped the stale ones); cellAt(cell, lift) is the square's centre. */
  event(e, cellAt) {
    const u = this.units, fxs = u.fxs, hero = (slot) => u.heroes[slot];
    if (e instanceof BombExploded) {
      const k = e.big ? 1.5 : 1.1;
      fxs.explosion(cellAt(e.at, 0.3), C.iron, k);
      fxs.scorch(cellAt(e.at, 0), k);
      for (const c of e.arms) { fxs.flame(cellAt(c, 0.15), e.big ? 1.15 : 1); fxs.scorch(cellAt(c, 0), 0.8); }
    } else if (e instanceof BombDropped) {
      fxs.dust(cellAt(e.at, 0), 0.6);
      if (e.owner >= 0) { u.slash(e.owner); u.gesture(e.owner, 'drop'); }
      else for (const gr of u.grunts.values()) if (gr.model.alive && gr.model.at.x === e.at.x && gr.model.at.y === e.at.y) gr.setDown = 1;   // the grunt that set it down
    } else if (e instanceof BombPickedUp) {
      u.gesture(e.slot, 'lift');
      u.fxs.flash(hero(e.slot).at.clone().add(new THREE.Vector3(0, 1.0, 0)), u.colours[e.slot], 0.35);
    } else if (e instanceof BombThrown) {
      u.slash(e.slot); u.gesture(e.slot, 'toss');
    } else if (e instanceof BombLanded) {
      fxs.dust(cellAt(e.at, 0), 0.7);
    } else if (e instanceof BombSank) {
      fxs.splash(cellAt(e.at, 0), 0.7);
    } else if (e instanceof BombDefused) {
      const b = this.bombs.get(e.id);
      fxs.puff(b ? b.g.position.clone().add(new THREE.Vector3(0, 0.3, 0)) : hero(e.slot).at.clone().add(new THREE.Vector3(0, 0.4, 0)));
    } else if (e instanceof BombFumbled) {
      fxs.chunks(cellAt(e.at, 0.4), C.iron, 4, 0.5);
    } else if (e instanceof PlayerStunned) {
      fxs.flash(hero(e.slot).at.clone().add(new THREE.Vector3(0, 1.2, 0)), GOLD, 0.7);
    } else if (e instanceof ItemBought) {
      fxs.flash(hero(e.slot).at.clone().add(new THREE.Vector3(0, 1.1, 0)), u.colours[e.slot], 0.6);
    } else if (e instanceof TrapPlaced) {
      fxs.dust(cellAt(e.at, 0), 0.7);
    } else if (e instanceof TrapSprung) {
      fxs.explosion(cellAt(e.at, 0.3), C.iron, 0.6);
    } else if (e instanceof TrapRemoved) {
      fxs.chunks(cellAt(e.at, 0.2), C.iron, 3, 0.4);
    } else if (e instanceof MetalPlaced) {
      for (const c of e.cells) fxs.flash(cellAt(c, 0.5), STEEL.clone().multiplyScalar(1.6), 0.3);
    } else if (e instanceof SoftBlockBroken) {                      // the RAID: a tree, a rock or a house blown apart
      const look = SOFT_CHUNKS[e.was];
      if (!look) throw new Error('bombs.js: no chunks for a broken ' + e.was + ' (a soft block is a tree, a small rock or a house)');
      const [a, b] = look;
      fxs.chunks(cellAt(e.at, 0.4), a, 9, 1.1); fxs.chunks(cellAt(e.at, 0.3), b, 6, 0.9); fxs.dust(cellAt(e.at, 0), 1.2);
    } else if (e instanceof PowerUpRevealed) {
      fxs.flash(cellAt(e.at, 0.6), POWER_COLOUR[e.kind], 0.6);
    } else if (e instanceof PowerUpTaken) {
      fxs.flash(cellAt(e.at, 0.8), POWER_COLOUR[e.kind], 1); u.gesture(e.slot, 'lift');
    } else if (e instanceof PowerUpBurned) {
      fxs.puff(cellAt(e.at, 0.4));
    }
  }

  dispose() {
    // (the bomb model's parts are the renderer's, shared by every level: not disposed here)
    for (const g of [this.geo.trap, this.geo.hot, this.geo.spark, this.geo.ring, this.geo.trapRing, this.geo.star, ...this.geo.hold,
                     this.geo.fireOuter, this.geo.fireInner, this.geo.token, this.geo.flame, this.geo.ball, this.geo.chevron]) g.dispose();
    this.units.group.remove(this.group);
  }
}
