// full.js - what the full rules (core/match/MatchModel.js, GameOptions type Full; test/parity/NAMES.md) add to the picture, drawn from
// the model every frame: the serpent (its humps and head while it is up, a dark swirl on the water while it is under), the players'
// kites (a diamond on a line over their 3 x 3, in the owner's colour), the treasure squares (gold plates that pulse), and the
// parts of a big ship (a gunboat's and the dreadnought's: a lit gun port over each gun still firing, a smoking black mark over each
// part destroyed; a weak spot shows only once it is struck, as the rules keep it hidden). The events start the bursts (a rising or
// diving serpent's splash, a hit, a recruit's flash, a treasure taken). Everything here is procedural; every particle is fx.js's.
// It only draws: the rules never see it.
import * as THREE from 'three/webgpu';
import { PartRole, SerpentRose, SerpentDove, SerpentHit, ShipRecruited, TreasureTaken, ShipPartHit, KitePlaced, MortarPlaced } from '../core/index.js';
import { C, glow } from './look.js';

// AUTHORED (FULL-RENDER, 11-11): the serpent's green and its belly, its humps' count, size and spacing in squares, how high its head
// stands when up, how fast it rises and sinks (per second, of the way), and its rim (the enemy's red, as every enemy has)
// (LOOKED at shots/full/full_close.png, 11-11: at 0.42 a hump and a head of 0.42 were lost among the ships at the whole-island zoom;
// a serpent is the size of a big ship: humps 0.7, the head 1.6x)
const SERPENT = new THREE.Color(0x2fae66), BELLY = new THREE.Color(0xd8e88a), HUMPS = 3, HUMP_R = 0.7, HUMP_GAP = 1.25, HEAD_UP = 2.2, HEAD_K = 1.6, RISE_RATE = 3;
const SWIRL = new THREE.Color(0x0a2a3a);
// a kite's height over its square, its size, its sway; a treasure plate's size and pulse; a gun port's and a wreck mark's size
const KITE_UP = 3.6, KITE_SIZE = 1.7, GOLD = new THREE.Color(0xffd24a), PLATE = 0.78, PORT = 0.16;

export class FullView {
  /** @param units the Units this belongs to (its board, ships, colours, effects and group are used). */
  constructor(units) {
    this.units = units;
    this.group = new THREE.Group(); this.group.name = 'full rules'; units.group.add(this.group);
    const kite = new THREE.Shape(); kite.moveTo(0, KITE_SIZE * 0.6); kite.lineTo(KITE_SIZE * 0.38, 0); kite.lineTo(0, -KITE_SIZE * 0.5); kite.lineTo(-KITE_SIZE * 0.38, 0); kite.closePath();
    this.geo = {
      hump: new THREE.TorusGeometry(HUMP_R, HUMP_R * 0.42, 8, 16, Math.PI), head: new THREE.SphereGeometry(0.42, 14, 10).scale(1, 0.85, 1.5),
      eye: new THREE.SphereGeometry(0.07, 6, 4), swirl: new THREE.RingGeometry(0.5, 1.8, 32).rotateX(-Math.PI / 2),
      kite: new THREE.ShapeGeometry(kite), plate: new THREE.PlaneGeometry(PLATE, PLATE).rotateX(-Math.PI / 2),
      port: new THREE.SphereGeometry(PORT, 8, 6), mark: new THREE.CircleGeometry(0.28, 12).rotateX(-Math.PI / 2),
    };
    this.mat = {
      body: new THREE.MeshStandardNodeMaterial({ color: SERPENT, roughness: 0.45, metalness: 0.1 }),
      belly: new THREE.MeshStandardNodeMaterial({ color: BELLY, roughness: 0.6 }),
      eye: glow(new THREE.Color(0xffe040), 2.4), swirl: new THREE.MeshBasicNodeMaterial({ color: SWIRL, transparent: true, opacity: 0.6, depthWrite: false }),
      gold: glow(GOLD, 1.8), port: glow(new THREE.Color(0xff8a2a), 2.6), weak: glow(new THREE.Color(0xff2a1f), 2.6),
      wreck: new THREE.MeshBasicNodeMaterial({ color: 0x141414 }),
      line: new THREE.LineBasicNodeMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.7 }),
    };
    this.kiteMats = units.colours.map((c) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.5, side: THREE.DoubleSide }));
    this.serpents = new Map(); this.kites = new Map(); this.plates = new Map(); this.parts = new Map();
  }

  // ------------------------------------------------------------------ the serpent
  makeSerpent(s) {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    for (let i = 0; i < HUMPS; i++) {
      const h = new THREE.Mesh(this.geo.hump, this.mat.body); h.position.x = -(i + 1) * HUMP_GAP; h.scale.setScalar(1 - i * 0.18); h.castShadow = true; body.add(h);
    }
    const head = new THREE.Group(); head.position.set(0.4, 0, 0); head.scale.setScalar(HEAD_K); body.add(head);
    const skull = new THREE.Mesh(this.geo.head, this.mat.body); skull.castShadow = true; head.add(skull);
    const jaw = new THREE.Mesh(this.geo.head, this.mat.belly); jaw.scale.set(0.8, 0.45, 0.85); jaw.position.set(0, -0.2, 0.12); head.add(jaw);
    for (const side of [-1, 1]) { const e = new THREE.Mesh(this.geo.eye, this.mat.eye); e.position.set(side * 0.2, 0.2, 0.45); head.add(e); }
    head.rotation.y = Math.PI / 2;                                  // the head's +z (its snout) faces the body's +x
    const swirl = new THREE.Mesh(this.geo.swirl, this.mat.swirl); swirl.position.y = 0.04; g.add(swirl);
    this.group.add(g);
    return { g, body, head, swirl, rise: 0, hit: 0, model: s };
  }

  updateSerpents(dt, seconds) {
    const seen = new Set();
    for (const s of this.units.match.serpents) {
      if (!s.alive) continue;
      seen.add(s.id);
      let e = this.serpents.get(s.id);
      if (!e) { e = this.makeSerpent(s); this.serpents.set(s.id, e); }
      e.g.position.set(s.at.x + 0.5, 0, s.at.y + 0.5);
      e.rise += ((s.up ? 1 : 0) - e.rise) * Math.min(1, dt * RISE_RATE);
      e.body.position.y = -1.4 + e.rise * (1.4 + HEAD_UP * 0.25);
      e.head.position.y = e.rise * HEAD_UP * 0.75;
      e.body.visible = e.rise > 0.02;
      e.body.rotation.y = seconds * 0.35 + s.id;                    // it circles slowly where it is
      e.head.rotation.z = Math.sin(seconds * 2.4 + s.id) * 0.15;
      e.swirl.rotation.y = -seconds * 0.8; e.swirl.visible = e.rise < 0.6;
      e.hit = Math.max(0, e.hit - dt * 3); e.body.scale.setScalar(1 + e.hit * 0.12);
    }
    for (const [id, e] of this.serpents) if (!seen.has(id)) { this.group.remove(e.g); this.serpents.delete(id); this.units.fxs.splash(e.g.position.clone(), 2); }
  }

  // ------------------------------------------------------------------ kites
  updateKites(seconds) {
    const seen = new Set();
    for (const k of this.units.match.kites) {
      if (k.used) continue;
      seen.add(k.id);
      let e = this.kites.get(k.id);
      if (!e) {
        const g = new THREE.Group(), gy = this.units.board.groundAt(k.topLeft.x + 1, k.topLeft.y + 1);
        g.position.set(k.topLeft.x + 1.5, gy, k.topLeft.y + 1.5);
        const kite = new THREE.Mesh(this.geo.kite, this.kiteMats[k.owner]); kite.castShadow = true; g.add(kite);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, KITE_UP, 0)]), this.mat.line);
        line.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0]), 3));
        g.add(line);
        const base = new THREE.Mesh(this.geo.mark, this.units.slotGlow(k.owner)); base.position.y = 0.04; base.scale.setScalar(2.4); g.add(base);
        this.group.add(g);
        e = { g, kite, line }; this.kites.set(k.id, e);
      }
      const sway = Math.sin(seconds * 1.6 + k.id) * 0.35, x = sway, y = KITE_UP + Math.sin(seconds * 2.1 + k.id) * 0.15;
      e.kite.position.set(x, y, 0); e.kite.rotation.set(0, 0, sway * 0.3);
      const pos = e.line.geometry.attributes.position; pos.setXYZ(1, x, y - KITE_SIZE * 0.5, 0); pos.needsUpdate = true;
    }
    for (const [id, e] of this.kites) if (!seen.has(id)) { this.group.remove(e.g); this.kites.delete(id); }
  }

  // ------------------------------------------------------------------ treasure squares
  updateTreasure(seconds) {
    const want = new Set();
    for (const c of this.units.match.treasureCells) {
      const key = c.x + ',' + c.y; want.add(key);
      let p = this.plates.get(key);
      if (!p) {
        p = new THREE.Mesh(this.geo.plate, this.mat.gold);
        p.position.set(c.x + 0.5, this.units.board.groundAt(c.x, c.y) + 0.05, c.y + 0.5); p.renderOrder = 2;
        this.group.add(p); this.plates.set(key, p);
      }
      p.scale.setScalar(0.85 + 0.15 * Math.sin(seconds * 4 + c.x + c.y));
    }
    for (const [key, p] of this.plates) if (!want.has(key)) { this.group.remove(p); this.plates.delete(key); }
  }

  // ------------------------------------------------------------------ the parts of a big ship
  updateParts() {
    const seen = new Set();
    for (const s of this.units.match.ships) {
      if (!s.alive || !s.parts) continue;
      seen.add(s.id);
      const shown = this.units.ships.get(s.id);
      if (!shown) continue;
      let e = this.parts.get(s.id);
      if (!e) {
        e = { g: new THREE.Group(), marks: [] };
        for (let i = 0; i < s.parts.length; i++) {
          const port = new THREE.Mesh(this.geo.port, s.roles[i] === PartRole.WeakSpot ? this.mat.weak : this.mat.port);
          const wreck = new THREE.Mesh(this.geo.mark, this.mat.wreck);
          e.g.add(port, wreck); e.marks.push({ port, wreck, smoke: 0 });
        }
        this.group.add(e.g); this.parts.set(s.id, e);
      }
      // the marks follow the ship as it is DRAWN (it glides between squares), laid on its square footprint
      const n = s.size, x0 = shown.pos.x - n / 2, z0 = shown.pos.z - n / 2;
      for (let i = 0; i < s.parts.length; i++) {
        const m = e.marks[i], px = x0 + (i % n) + 0.5, pz = z0 + Math.floor(i / n) + 0.5, alive = s.parts[i] > 0, role = s.roles[i];
        m.port.position.set(px, 1.05, pz); m.wreck.position.set(px, 0.95, pz);
        m.port.visible = alive && role === PartRole.Gun;           // a gun still firing; a weak spot stays hidden while whole
        m.wreck.visible = !alive;
      }
    }
    for (const [id, e] of this.parts) if (!seen.has(id)) { this.group.remove(e.g); this.parts.delete(id); }
  }

  /** One event from the model, as it is shown. */
  event(e, cellAt) {
    const fxs = this.units.fxs;
    if (e instanceof SerpentRose) fxs.splash(cellAt(e.at, 0.1), 2.2);
    else if (e instanceof SerpentDove) { const s = this.serpents.get(e.serpentId); if (s) fxs.splash(s.g.position.clone(), 1.8); }
    else if (e instanceof SerpentHit) { const s = this.serpents.get(e.serpentId); if (s) { s.hit = 1; fxs.chunks(s.g.position.clone().add(new THREE.Vector3(0, 1, 0)), SERPENT, 6, 0.9); } }
    else if (e instanceof ShipRecruited) { const sh = this.units.ships.get(e.shipId); if (sh) fxs.flash(sh.pos.clone().add(new THREE.Vector3(0, 1, 0)), this.units.colours[e.slot], 1.6); }
    else if (e instanceof TreasureTaken) fxs.flash(cellAt(e.at, 0.3), GOLD, 1.2);
    else if (e instanceof ShipPartHit) {
      const sh = this.units.ships.get(e.shipId);
      if (sh) fxs.chunks(sh.pos.clone().add(new THREE.Vector3(0, 0.7, 0)), e.role === PartRole.WeakSpot ? new THREE.Color(0xff2a1f) : C.wood, 6, 0.9);
    } else if (e instanceof KitePlaced || e instanceof MortarPlaced) fxs.dust(cellAt({ x: e.topLeft.x + 1, y: e.topLeft.y + 1 }, 0.1), 1.4);
  }

  update(view, dt, seconds) {
    this.updateSerpents(dt, seconds);
    this.updateKites(seconds);
    this.updateTreasure(seconds);
    this.updateParts();
  }

  dispose() { this.units.group.remove(this.group); }
}
