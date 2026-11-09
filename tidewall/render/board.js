// board.js - the island and everything that stands on its squares: the land (a heightfield with gentle relief and a sand edge),
// the animated sea with shoreline foam, the territory fill painted into the land in each owner's colour (flashing when a ring
// closes), the walls (one toy block per square, each placed PIECE wrapped in a glowing outline in its owner's colour), and the
// props on the squares (rubble, rocks, trees, houses, pits, graveyards). It reads the model's GridModel and nothing else; every
// change is found by comparing the board's bytes with the last frame's, so a view can never drift from the rules.
import * as THREE from 'three/webgpu';
import { texture, uniform, vertexColor, positionWorld, positionLocal, vec2, vec3, vec4, float, mix, smoothstep, sin, fract, min, max, abs, step, clamp } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Terrain, Occupant, EnclosureRules, PieceMap, WallOutline, WallsPlaced, RingBuilt } from '../core/index.js';
import { C, NEUTRAL_WALL, mats, makeNoise, InstancedBatch, PropSet, pitGeometry, rubbleGeometry, graveGeometry } from './look.js';

export const MARGIN = 12;              // AUTHORED: squares of sea drawn round the board, so the island never sits on a hard edge
const SUB = 4;                         // AUTHORED: land vertices per square (the coast is smooth, not stepped)
const SDF_RANGE = 8;                   // the distance texture holds -8..+8 squares
const WALL_H = 0.5, WALL_W = 0.9;      // AUTHORED: a wall block, in squares
const FLASH_SECONDS = 1.4;             // AUTHORED: how long a closed ring's territory flashes

/** The squares the sea counts as water for drawing: open sea and an inland lake. */
const wet = (t) => t === Terrain.Water || t === Terrain.Lake;

export class Board {
  /** @param {THREE.Scene} scene  @param grid the model's GridModel  @param colours each player slot's colour (its seat's)
   *  @param propParts Map occupant -> the model parts a square holding it is drawn with (trees and rocks: models.js)
   *  @param decorParts { bush, rockSmall, rockLarge, oak }: the decoration's model parts (buildDecor) */
  constructor(scene, grid, colours, propParts, decorParts) {
    this.scene = scene; this.grid = grid; this.colours = colours; this.propParts = propParts; this.decorParts = decorParts;
    this.w = grid.width; this.h = grid.height;
    this.group = new THREE.Group(); this.group.name = 'board'; scene.add(this.group);
    this.noise = makeNoise(this.w * 131 + this.h * 7);
    this.uTime = uniform(0); this.uGrid = uniform(0);
    this.pieces = new PieceMap(this.w, this.h);
    const n = this.w * this.h;
    this.seen = { occ: new Int16Array(n).fill(-1), own: new Int16Array(n).fill(-1), hp: new Int16Array(n).fill(-1), ter: new Int16Array(n).fill(-1) };
    this.flash = new Float32Array(n);  // seconds of flash left per square
    this.territory = null;
    this.buildField();
    this.buildLand();
    this.buildSea();
    this.buildWalls();
    this.buildProps();
    this.buildDecor();
    this.sync(0, true);
  }

  // ------------------------------------------------------------------ the shape of the island
  /** Signed distance to the coast in squares (+ on land, - at sea), from the board's squares, with a little noise so the coast is
   *  not stepped. The noise is at most a quarter square, so a land square's centre is always on land and a sea square's at sea. */
  buildField() {
    const { w, h, grid } = this;
    const land = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) land[y * w + x] = wet(grid.terrainAt(x, y)) ? 0 : 1;
    this.land = land;
    const isLand = (x, y) => x >= 0 && y >= 0 && x < w && y < h && land[y * w + x] === 1;
    // the squares on either side of the coast: only they can be the nearest of the other kind
    const coastLand = [], coastSea = [];
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      const me = isLand(x, y);
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (isLand(x + dx, y + dy) !== me) edge = true;
      if (edge) (me ? coastLand : coastSea).push([x, y]);
    }
    const boxDist = (px, pz, list) => {
      let best = 1e9;
      for (const [x, y] of list) {
        const dx = Math.max(Math.abs(px - (x + 0.5)) - 0.5, 0), dz = Math.max(Math.abs(pz - (y + 0.5)) - 0.5, 0);
        const d = dx * dx + dz * dz; if (d < best) best = d;
      }
      return Math.sqrt(best);
    };
    this.sdf = (px, pz) => {
      const x = Math.floor(px), y = Math.floor(pz);
      const raw = isLand(x, y) ? boxDist(px, pz, coastSea) : -boxDist(px, pz, coastLand);
      if (coastLand.length === 0) return -SDF_RANGE;
      return raw + (this.noise(px * 0.45, pz * 0.45) - 0.5) * 0.45;
    };
    // the lattice the land mesh and the sea's distance texture share
    const M = MARGIN, lw = (w + 2 * M) * SUB + 1, lh = (h + 2 * M) * SUB + 1;
    const field = new Float32Array(lw * lh);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const px = -M + i / SUB, pz = -M + j / SUB;
      field[j * lw + i] = coastLand.length === 0 ? -SDF_RANGE : this.sdf(px, pz);
    }
    this.lattice = { lw, lh, field };
  }

  /** The land's height at a point (squares; the sea is y = 0). */
  heightOf(s, px, pz) {
    if (s < 0) return Math.max(s * 0.5, -0.7);
    const relief = (this.noise(px * 0.3 + 40, pz * 0.3 - 11) - 0.5) * 0.1 * THREE.MathUtils.smoothstep(s, 0.9, 2.6);
    return 0.06 * THREE.MathUtils.smoothstep(s, 0, 0.3) + 0.12 * THREE.MathUtils.smoothstep(s, 0.35, 2.6) + relief;
  }
  /** Where a thing standing on square (x, y) sits: the land's height at the square's centre. */
  groundAt(x, y) { const px = x + 0.5, pz = y + 0.5; return Math.max(0, this.heightOf(this.sdf(px, pz), px, pz)); }
  /** The same at any point (a hero walks between squares). */
  groundAtPoint(px, pz) { return Math.max(0, this.heightOf(this.sdf(px, pz), px, pz)); }

  buildLand() {
    const { lw, lh, field } = this.lattice, M = MARGIN, grid = this.grid, w = this.w, h = this.h;
    const pos = new Float32Array(lw * lh * 3), col = new Float32Array(lw * lh * 3), tmp = new THREE.Color();
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const k = j * lw + i, px = -M + i / SUB, pz = -M + j / SUB, s = field[k];
      pos[k * 3] = px; pos[k * 3 + 1] = this.heightOf(s, px, pz); pos[k * 3 + 2] = pz;
      const n = this.noise(px * 0.6 + 3, pz * 0.6 + 9);
      if (s < 0) tmp.copy(C.wetSand).lerp(C.seaBed, THREE.MathUtils.smoothstep(-s, 0, 1.2));
      else if (s < 0.5) tmp.copy(C.wetSand).lerp(C.sand, THREE.MathUtils.smoothstep(s, 0, 0.2));
      else {
        tmp.copy(C.grassDark).lerp(C.grassLight, n);
        tmp.lerp(C.sand, 1 - THREE.MathUtils.smoothstep(s, 0.5, 0.75));
        const x = Math.floor(px), y = Math.floor(pz);
        if (x >= 0 && y >= 0 && x < w && y < h && grid.terrainAt(x, y) === Terrain.Swamp) tmp.lerp(C.swamp, 0.8);
      }
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    }
    const idx = [];
    for (let j = 0; j < lh - 1; j++) for (let i = 0; i < lw - 1; i++) {
      const a = j * lw + i, b = a + 1, c = a + lw, d = c + 1;
      if (field[a] < -2.5 && field[b] < -2.5 && field[c] < -2.5 && field[d] < -2.5) continue;   // deep under the sea: never seen
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();

    // the territory: one texel per square, the owner's colour and how strongly it fills; a second texture holds the flash
    this.fillData = new Uint8Array(w * h * 4); this.flashData = new Uint8Array(w * h * 4);
    this.fillTex = new THREE.DataTexture(this.fillData, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.flashTex = new THREE.DataTexture(this.flashData, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [this.fillTex, this.flashTex]) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    const cellUv = positionWorld.xz.div(vec2(w, h));
    const inBoard = step(0, positionWorld.x).mul(step(positionWorld.x, w)).mul(step(0, positionWorld.z)).mul(step(positionWorld.z, h));
    const fill = texture(this.fillTex, cellUv), fl = texture(this.flashTex, cellUv);
    const base = vertexColor();
    const tint = mix(base, fill.rgb.mul(0.62).add(0.3), fill.a.mul(inBoard));   // a light wash of the owner's colour, not a dark stain
    // a faint square grid on the land, eased in while pieces are being placed (REPAIR) so a square is easy to aim at
    const gx = fract(positionWorld.x), gz = fract(positionWorld.z);
    const edge = min(min(gx, gx.oneMinus()), min(gz, gz.oneMinus()));
    const line = smoothstep(0.045, 0.0, edge).mul(this.uGrid).mul(inBoard).mul(smoothstep(0.03, 0.1, positionWorld.y));
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, flatShading: false });
    m.colorNode = tint.mul(float(1).sub(line.mul(0.28)));
    m.emissiveNode = fill.rgb.mul(fl.r).mul(inBoard).mul(1.6);
    this.landMesh = new THREE.Mesh(geo, m); this.landMesh.receiveShadow = true; this.landMesh.name = 'land';
    this.group.add(this.landMesh);
  }

  buildSea() {
    const { lw, lh, field } = this.lattice, M = MARGIN, w = this.w, h = this.h;
    // the signed distance as a texture, so the sea's shader knows how far from the coast each point is
    const tw = lw, th = lh, data = new Uint8Array(tw * th * 4);
    for (let k = 0; k < tw * th; k++) {
      const v = Math.round(THREE.MathUtils.clamp((field[k] + SDF_RANGE) / (2 * SDF_RANGE), 0, 1) * 255);
      data[k * 4] = v; data[k * 4 + 1] = v; data[k * 4 + 2] = v; data[k * 4 + 3] = 255;
    }
    const sdfTex = new THREE.DataTexture(data, tw, th, THREE.RGBAFormat, THREE.UnsignedByteType);
    sdfTex.magFilter = sdfTex.minFilter = THREE.LinearFilter; sdfTex.generateMipmaps = false; sdfTex.needsUpdate = true;
    this.sdfTex = sdfTex;
    const span = 400;                                                 // the sea runs past every camera's edge
    const geo = new THREE.PlaneGeometry(span, span, 160, 160); geo.rotateX(-Math.PI / 2); geo.translate(w / 2, 0, h / 2);
    const t = this.uTime;
    const suv = positionWorld.xz.add(M).div(vec2(w + 2 * M, h + 2 * M));
    const sdfN = texture(sdfTex, suv).r.mul(2 * SDF_RANGE).sub(SDF_RANGE);
    const off = sdfN.negate();                                        // squares out from the coast
    const ripple = sin(positionWorld.x.mul(0.9).add(t.mul(1.3))).mul(sin(positionWorld.z.mul(0.7).sub(t.mul(1.1)))).mul(0.5).add(0.5);
    const depth = smoothstep(0.0, 5.5, off);
    let col = mix(vec3(C.shallow.r, C.shallow.g, C.shallow.b), vec3(C.deep.r, C.deep.g, C.deep.b), depth);
    col = col.add(ripple.mul(0.05));
    const edgeFoam = smoothstep(0.42, 0.04, off);
    const band = smoothstep(0.72, 1.0, sin(off.mul(8.5).sub(t.mul(2.4)).add(ripple.mul(1.5)))).mul(smoothstep(1.6, 0.25, off));
    const foam = clamp(max(edgeFoam.mul(0.95), band.mul(0.75)), 0, 1);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0.0 });
    m.colorNode = mix(col, vec3(1, 1, 1), foam);
    m.emissiveNode = vec3(foam.mul(0.12));
    // a gentle swell, flattened at the coast so the beach line does not swim
    const swell = sin(positionLocal.x.mul(0.55).add(t.mul(1.2))).add(sin(positionLocal.z.mul(0.43).sub(t.mul(0.9)))).mul(0.018).mul(smoothstep(0.3, 2.5, off));
    m.positionNode = positionLocal.add(vec3(0, swell, 0));
    this.sea = new THREE.Mesh(geo, m); this.sea.receiveShadow = true; this.sea.name = 'sea';
    this.group.add(this.sea);
  }

  // ------------------------------------------------------------------ walls and props
  buildWalls() {
    const n = this.w * this.h;
    const geo = new RoundedBoxGeometry(WALL_W, WALL_H, WALL_W, 2, 0.07); geo.translate(0, WALL_H / 2, 0);
    this.walls = new InstancedBatch(this.group, geo, mats.wall, n, { colors: true, castShadow: true, receiveShadow: true, name: 'walls' });
    // the outline: thin glowing bars on every outer edge of a piece (WallOutline), coloured by the piece's owner
    const cap = n * 12;
    const bar = new THREE.BoxGeometry(1, 1, 1);
    const glowMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.6, 2.6, 2.6) });
    this.outline = new InstancedBatch(this.group, bar, glowMat, cap, { colors: true, name: 'wall outline' });
  }

  buildProps() {
    const n = this.w * this.h;
    // what the rules leave behind (rubble, a burning pit, a graveyard) is this game's own procedural shapes; the land a map names
    // (trees, houses, small and large rocks) is drawn with the CC-BY models
    const kinds = [[Occupant.Rubble, rubbleGeometry()], [Occupant.Pit, pitGeometry()], [Occupant.Graveyard, graveGeometry()]];
    this.props = new Map();
    for (const [occ, geo] of kinds) {
      this.props.set(occ, new InstancedBatch(this.group, geo, mats.vc, n, { castShadow: true, receiveShadow: true, name: 'props ' + occ }));
    }
    // (a House square has no drawing: the normal rules, the only ones this game runs, clear every house at load, MatchModel.plain)
    for (const occ of [Occupant.Tree, Occupant.RockSmall, Occupant.RockLarge]) {
      const parts = this.propParts.get(occ);
      if (!parts) throw new Error('board.js: no model parts for occupant ' + occ);
      this.props.set(occ, new PropSet(this.group, parts, n, { castShadow: true, receiveShadow: true, name: 'props ' + occ }));
    }
    // a pit glows (it burns); a separate emissive disc so the bloom picks it up
    this.embers = new InstancedBatch(this.group, new THREE.CircleGeometry(0.22, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: C.ember.clone().multiplyScalar(2.2) }), n, { name: 'embers' });
  }

  /** Feed the events the view was handed, in order: the piece map needs every placed piece and every built ring. */
  events(list, seconds) {
    for (const e of list) {
      if (e instanceof WallsPlaced || e instanceof RingBuilt) this.pieces.shown(e);
    }
  }

  /** A ring closed round castle `castleId`: its territory flashes. */
  flashRegionOf(cells) {
    if (!this.territory) return;
    const regions = new Set();
    for (const c of cells) { const r = this.territory.regionAt(c.x, c.y); if (r > 0) regions.add(r); }
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++)
      if (regions.has(this.territory.regionAt(x, y))) this.flash[y * this.w + x] = FLASH_SECONDS;
  }

  /** Compare the board with what is drawn; rebuild what changed. Returns true when the walls changed (the territory too). */
  sync(dt, force = false) {
    const g = this.grid, w = this.w, h = this.h, s = this.seen;
    let walls = force, props = force;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = g.occupantAt(x, y), ow = g.ownerAt(x, y), hp = g.healthAt(x, y), t = g.terrainAt(x, y);
      if (o !== s.occ[i] || ow !== s.own[i] || hp !== s.hp[i] || t !== s.ter[i]) {
        if (o === Occupant.Wall || s.occ[i] === Occupant.Wall) walls = true;
        props = true;
        s.occ[i] = o; s.own[i] = ow; s.hp[i] = hp; s.ter[i] = t;
      }
    }
    if (walls) { this.drawWalls(); this.territory = EnclosureRules.map(g); }
    if (props) this.drawProps();
    this.drawTerritory(dt);
    return walls;
  }

  drawWalls() {
    const g = this.grid, w = this.w, h = this.h, m = new THREE.Matrix4(), c = new THREE.Color();
    const top = new Float32Array(w * h);
    let k = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (g.occupantAt(x, y) !== Occupant.Wall) continue;
      const ow = g.ownerAt(x, y), hp = g.healthAt(x, y), gy = this.groundAt(x, y);
      const sy = hp <= 1 ? 0.68 : 1;                                   // a damaged wall (one hit left) stands lower
      m.makeScale(1, sy, 1).setPosition(x + 0.5, gy - 0.04, y + 0.5);
      c.copy(ow < 4 ? this.colourOf(ow) : NEUTRAL_WALL).lerp(C.foam, 0.28);
      if (hp <= 1) c.multiplyScalar(0.72);
      this.walls.set(k, m, c);
      top[y * w + x] = gy - 0.04 + WALL_H * sy;
      k++;
    }
    this.walls.commit(k);
    // the outline (WallOutline.build): bars inset a hair into the block so they sit on its faces
    const edges = WallOutline.build(g, this.pieces), T = 0.045, IN = (1 - WALL_W) / 2;
    let e = 0;
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (const ed of edges) {
      const cx = ed.cell % w, cy = Math.floor(ed.cell / w), ow = g.ownerAt(cx, cy), base = this.groundAt(cx, cy) - 0.04, tp = top[ed.cell];
      c.copy(ow < 4 ? this.colourOf(ow) : NEUTRAL_WALL);
      if (ed.kind === WallOutline.Kind.Upright) {
        const ix = ed.x0 > cx ? -IN : IN, iz = ed.y0 > cy ? -IN : IN;
        p.set(ed.x0 + ix, (base + tp) / 2, ed.y0 + iz); sc.set(T, tp - base, T);
      } else {
        let x0 = ed.x0, z0 = ed.y0, x1 = ed.x1, z1 = ed.y1;
        if (ed.side === 0) { z0 += IN; z1 += IN; } else if (ed.side === 2) { z0 -= IN; z1 -= IN; }
        else if (ed.side === 1) { x0 -= IN; x1 -= IN; } else { x0 += IN; x1 += IN; }
        const yy = ed.kind === WallOutline.Kind.Top ? tp : base + 0.06;
        p.set((x0 + x1) / 2, yy, (z0 + z1) / 2);
        sc.set(Math.max(Math.abs(x1 - x0), T), T, Math.max(Math.abs(z1 - z0), T));
      }
      q.identity(); m.compose(p, q, sc);
      this.outline.set(e, m, c); e++;
    }
    this.outline.commit(e);
  }

  drawProps() {
    const g = this.grid, counts = new Map(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let em = 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const o = g.occupantAt(x, y), im = this.props.get(o);
      if (o === Occupant.House) throw new Error('board.js: a house at ' + x + ',' + y + ': the normal rules clear houses (MatchModel.plain), and this board has no drawing for one');
      if (!im) continue;
      const k = counts.get(o) ?? 0; counts.set(o, k + 1);
      q.setFromAxisAngle(up, this.noise(x * 3.1, y * 2.7) * Math.PI * 2);
      const gy = this.groundAt(x, y);
      m.compose(new THREE.Vector3(x + 0.5, gy, y + 0.5), q, new THREE.Vector3(1, 1, 1));
      im.set(k, m);
      if (o === Occupant.Pit) { m.makeTranslation(x + 0.5, gy + 0.065, y + 0.5); this.embers.set(em++, m); }
    }
    for (const [o, im] of this.props) im.commit(counts.get(o) ?? 0);
    this.embers.commit(em);
  }

  // ------------------------------------------------------------------ decoration (no square of the rules)
  /** Rocks, bushes and a few oak islets, ONLY where nothing the rules move or place can ever be, read from the rules
   *  (core/match/MatchModel.js):
   *  - a ship can be on ANY water square joined to the board's edge: it is born on an edge square (_spawnWave), sails over water,
   *    4-connected (_actShip, PathRules.nextStep), and a lander heads for any water square beside land (_shoreWater). So no water
   *    square joined to the edge is decorated, and the sand band of the coast is on LAND squares (where walls, cannons, grunts and
   *    heroes go), so it is not either.
   *  - a grunt lands and walks on land squares only (_landGrunt, _actGrunt).
   *  What is left: a LAGOON (water no edge square reaches: no ship can ever enter it), whose rim gets bushes and small rocks low
   *  enough to hide nothing, and the open sea OUTSIDE the board (ships never leave the board), where rocks stand off the north, east
   *  and west coasts and a few carry an oak. Nothing is put south of the board: the camera looks from the south, so something
   *  there would stand in front of the ships on the board's south edge. Seeded by the board's own squares, so each map has its own
   *  and the same map always has the same. */
  buildDecor() {
    const g = this.grid, w = this.w, h = this.h, D = this.decorParts;
    let seed = 2166136261;                                        // FNV-1a over the terrain: one seed per map
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { seed ^= g.terrainAt(x, y) + 1; seed = Math.imul(seed, 16777619); }
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    // the water a ship can reach: every water square 4-joined to a water square on the board's edge
    const water = (x, y) => g.terrainAt(x, y) === Terrain.Water, reach = new Uint8Array(w * h), q = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && water(x, y)) { reach[y * w + x] = 1; q.push(y * w + x); }
    for (let i = 0; i < q.length; i++) {
      const c = q[i], x = c % w, y = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || reach[ny * w + nx] || !water(nx, ny)) continue;
        reach[ny * w + nx] = 1; q.push(ny * w + nx);
      }
    }
    const items = { bush: [], rockSmall: [], rockLarge: [], oak: [] };
    const put = (kind, x, z, y, scale) => items[kind].push({ x, z, y, scale, turn: rnd() * Math.PI * 2 });
    // lagoon squares: water the flood did not reach. A rim square (land beside it) gets a bush or a small rock now and then.
    let lagoon = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!water(x, y) || reach[y * w + x]) continue;
      lagoon++;
      let rim = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!wet(g.terrainAt(x + dx, y + dy))) rim = true;
      if (!rim || rnd() > 0.45) continue;
      const px = x + 0.25 + rnd() * 0.5, pz = y + 0.25 + rnd() * 0.5;
      put(rnd() < 0.6 ? 'bush' : 'rockSmall', px, pz, -0.04, 0.8 + rnd() * 0.4);
    }
    // the sea outside the board: off the north, east and west edges, 1.5 to 4.5 squares out
    const side = [];
    for (let x = 0; x < w; x += 3) side.push([x + rnd() * 3, -1.5 - rnd() * 3]);
    for (let y = 0; y < h; y += 3) { side.push([-1.5 - rnd() * 3, y + rnd() * 3]); side.push([w + 1.5 + rnd() * 3, y + rnd() * 3]); }
    let oaks = 0;
    for (const [px, pz] of side) {
      const r = rnd();
      if (r < 0.5) continue;                                      // about half the places stay open sea
      if (r < 0.62 && oaks < 4) { put('rockLarge', px, pz, -0.35, 1); put('oak', px, pz, 0.45, 0.8 + rnd() * 0.3); oaks++; }
      else if (r < 0.8) put('rockLarge', px, pz, -0.3, 0.7 + rnd() * 0.5);
      else put('rockSmall', px, pz, -0.08, 0.8 + rnd() * 0.6);
    }
    this.decor = {};
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const kind of Object.keys(items)) {
      const list = items[kind];
      if (!D[kind]) throw new Error('board.js: no decoration parts for ' + kind);
      const set = new PropSet(this.group, D[kind], Math.max(1, list.length), { castShadow: true, receiveShadow: true, name: 'decor ' + kind });
      list.forEach((it, i) => { qt.setFromAxisAngle(up, it.turn); m.compose(new THREE.Vector3(it.x, it.y, it.z), qt, new THREE.Vector3(it.scale, it.scale, it.scale)); set.set(i, m); });
      set.commit(list.length);
      this.decor[kind] = list.length;
    }
    this.decor.lagoonSquares = lagoon;
  }

  /** A player slot's colour; a slot the match does not have is an error, never a stand-in colour. */
  colourOf(slot) {
    const c = this.colours[slot];
    if (!c) throw new Error('board.js: no player in slot ' + slot + ' (the match has ' + this.colours.length + ')');
    return c;
  }

  drawTerritory(dt) {
    const t = this.territory, w = this.w, g = this.grid, d = this.fillData, f = this.flashData;
    let flashing = false;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, r = t ? t.regionAt(x, y) : 0, owner = r > 0 ? t.mainOwner(r) : -1;
      if (owner >= 0 && g.occupantAt(x, y) !== Occupant.Wall) {
        const c = this.colourOf(owner);
        d[i * 4] = c.r * 255; d[i * 4 + 1] = c.g * 255; d[i * 4 + 2] = c.b * 255; d[i * 4 + 3] = 150;
      } else { d[i * 4 + 3] = 0; }
      if (this.flash[i] > 0) { this.flash[i] = Math.max(0, this.flash[i] - dt); flashing = true; }
      const k = this.flash[i] / FLASH_SECONDS;
      f[i * 4] = Math.round(255 * k * k * (0.6 + 0.4 * Math.cos(k * 18)));
    }
    this.fillTex.needsUpdate = true;
    if (flashing || this._wasFlashing) this.flashTex.needsUpdate = true;
    this._wasFlashing = flashing;
  }

  update(dt, seconds, repairK) {
    this.uTime.value = seconds;
    this.uGrid.value = repairK;
    this.sync(dt);
  }

  /** The bounds of the land, in squares: what the camera frames. */
  landBounds() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.land[y * this.w + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < 0) return { x0: 0, y0: 0, x1: this.w, y1: this.h };
    return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }

  dispose() {
    this.scene.remove(this.group);
    // the model parts are the renderer's, shared by every level: disposing them here destroyed buffers the next level still drew
    // with (11-08: "[Buffer] used in submit while destroyed" x500 after a second match started)
    const shared = new Set();
    for (const parts of [...this.propParts.values(), ...Object.values(this.decorParts)]) for (const p of parts) shared.add(p.geometry);
    this.group.traverse((o) => { if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose(); });
    for (const t of [this.fillTex, this.flashTex, this.sdfTex]) t.dispose();
  }
}
