// rise.js - the castle rise (CASTLE_RISE_UC.md UC-L8): a ring the board's territory shows closed round a secured castle is built
// upward - two courses of chunky stone blocks over its walls, cut into Tetris pieces that drop in one after another (UC-L3's drop:
// its timing, squash and dust), battlements on alternate squares, and a tier of blocks round the castle's roof - and it comes down
// where it is breached: a broken square's blocks tumble off as debris at once, and an opened ring loses its rise square by square
// outward from the breach. What is closed is read from the board (its territory) and the castles (units.js updateCastles), never
// decided here; the cut is render/riseplan.js. It only draws: the rules never see it.
import * as THREE from 'three/webgpu';
import { Occupant } from '../core/index.js';
import { WALL_DROP } from './board.js';
import { C, NEUTRAL_WALL, CHUNK, InstancedBatch, riseBlockGeometry, riseClothGeometry, RISE_BLOCK_W } from './look.js';
import { RISE, RiseError, ringOf, runsOf, cutRun, keepRing, unravelSteps, squareHash, pieceTint, KEEP_KINDS, thunkRate } from './riseplan.js';

// AUTHORED (UC-L8 step 4): each piece's paint is riseplan.js pieceTint (its Tetris kind's colour); a block is tinted OWNER_TINT
// toward its owner (less than the coping's CAP_OWNER, 0.18, board.js: the cloth band carries the owner, and more would muddy the
// kinds apart); a landing piece glows toward HOT, FLASH_PEAK of the way at its landing, gone RISE.flash later.
const OWNER_TINT = 0.1, HOT = new THREE.Color(1.7, 1.7, 1.6), FLASH_PEAK = 0.6;
const tintOf = (kind, j) => new THREE.Color(...pieceTint(kind, j)), STONE = tintOf('stone', 0);
// AUTHORED (5a): a block falling off a broken wall: its pull (squares/s^2; from a crown 1.3 squares up it is down in ~0.33 s, the
// pace of UC-L3's 0.2 s drop from 0.9), its throw (outward and up, squares/s), its spin (rad/s), and how long it takes to sink away
// once down (s); a breach also throws DEBRIS_CHIPS of fx.js's chunks
const DEBRIS_G = 24, DEBRIS_OUT = [0.6, 1.6], DEBRIS_UP = [0.8, 2.0], DEBRIS_SPIN = [3, 8], DEBRIS_FADE = 0.3, DEBRIS_CHIPS = 3;
// MEASURED + AUTHORED: a batch's shader is built for its room (look.js roomFor: the room is written into the shader), so a room
// outgrown mid-match is a new shader compiled then. Every level's batches are made at one fixed room from the start - the resting ones
// with room for four claimed rings (a claim ring was 28 squares in run_page rise, 11-13: 28 x 2 courses + 14 merlons + the keep's 24 =
// 94 blocks a castle, 376 for four: room 512), the moving ones for a ring coming down - so no batch outgrows its room in play.
const ROOM_REST = 512, ROOM_MOVING = 128;
// MEASURED 11-13 (tools probe diffing renderer._pipelines' programs before and after a claim): three r175 writes each InstancedMesh's
// own matrix buffer's node id into its vertex shader (NodeBuffer_<id>), so no two meshes ever share one and a new level's batches
// compile their own at their first draw, whatever was warmed. So each batch draws one zero-scale block (nothing shows) for the
// level's first PRIME_FRAMES frames: its shaders, the shadow pass's too (the map is redrawn every other frame, renderer.js
// SHADOW_EVERY 2), compile as the match starts, where the level is built anyway, not in the middle of the first ring's rise.
// Measured over a one-player claim's 6 s: growing from the default room, the rise compiled 17 new pipelines, with 7 frames of
// 44-115 ms; at fixed rooms still 14; primed, no vertex program beyond the 9 the board's own new batches compile at the claim
// (the same 9 on the build before the rise), and no frame over 30 ms while the ring rose.
const PRIME_FRAMES = 3, ZERO = new THREE.Matrix4().makeScale(0, 0, 0), WHITE = new THREE.Color(1, 1, 1);
// what each drawn instance is (the page check reads it: drawnColumns)
export const RISE_KIND = Object.freeze({ course: 0, merlon: 1, keep: 2, debris: 3 });

/** Where a piece is in its drop (UC-L3's curve, board.js dropOf, from RISE.height): null while its turn has not come (not drawn: a
 *  waiting block drawn flat lit BLACK, 11-10), else { fall: squares over its rest, squash: the share of its height it stands at }. */
function dropOf(pc, now) {
  const t = now - pc.at;
  if (t < -WALL_DROP.seconds) return null;
  const fall = t < 0 ? RISE.height * (1 - Math.pow(1 + t / WALL_DROP.seconds, 2)) : 0;
  const squash = t >= 0 && t < WALL_DROP.squashSeconds ? 1 - WALL_DROP.squash * Math.sin(Math.PI * t / WALL_DROP.squashSeconds) : 1;
  return { fall, squash };
}

const ROOFS = new WeakMap();
/** The castle model's roof (UC-L8 step 2), READ from the model's vertices: the highest twentieth of its height whose vertices still
 *  spread over half the model both ways (above it stand only its middle spire and its flag), as { y, cx, cz, halfX, halfZ } in the
 *  model's own units. Measured 11-13 on assets/models/castle.glb: y 0.335 of -0.832..0.835, half 0.70 x 0.62. */
function roofOf(M) {
  if (ROOFS.has(M)) return ROOFS.get(M);
  const pts = [], v = new THREE.Vector3(), B = 20;
  M.scene.updateMatrixWorld(true);
  M.scene.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.y, v.z); }
  });
  const y0 = M.box.min.y, y1 = M.box.max.y;
  for (let b = B - 1; b >= 0; b--) {
    const lo = y0 + (y1 - y0) * b / B, hi = y0 + (y1 - y0) * (b + 1) / B;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const y = pts[i + 1];
      if (y < lo || y > hi) continue;
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 2]); z1 = Math.max(z1, pts[i + 2]); top = Math.max(top, y);
    }
    if (x1 - x0 >= 0.5 * M.size.x && z1 - z0 >= 0.5 * M.size.z) {
      const r = { y: top, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, halfX: (x1 - x0) / 2, halfZ: (z1 - z0) / 2 };
      ROOFS.set(M, r);
      return r;
    }
  }
  throw new RiseError('rise.js: the castle model has no band of vertices as wide as half the model: no roof to build the keep on');
}

export class RiseView {
  /** @param units the Units this belongs to (its board, castles, models, effects and group are used). */
  constructor(units) {
    const b = units.board, g = units.match.grid;
    this.units = units; this.board = b; this.grid = g; this.w = g.width;
    this.group = new THREE.Group(); this.group.name = 'castle rise'; units.group.add(this.group);
    // every square of the board risen, every castle's tier, and as many again tumbling: InstancedBatch's limit, never reached in play
    const cap = 2 * (g.width * g.height * (RISE.courses + 1) + g.castles.length * 24);
    // two pairs of batches: the blocks at rest cast the sun's shadow; the ones on the move (falling, squashing, tumbling) cast none.
    // The shadow map is redrawn every other frame (renderer.js SHADOW_EVERY), and a block falling 0.25 squares a frame sat in the
    // shadow of where it had been: its top drew dark slate (LOOKED at shots/rise/claim_rise_mid.png, 11-13)
    const block = riseBlockGeometry(RISE.course), band = riseClothGeometry(RISE.course);
    this.stone = new InstancedBatch(this.group, block, b.look.wallStone, cap, { colors: true, castShadow: true, receiveShadow: true, name: 'rise stone' });
    this.cloth = new InstancedBatch(this.group, band, b.look.wallTrim, cap, { colors: true, receiveShadow: true, name: 'rise cloth' });
    this.stoneMoving = new InstancedBatch(this.group, block, b.look.wallStone, cap, { colors: true, receiveShadow: true, name: 'rise stone moving' });
    this.clothMoving = new InstancedBatch(this.group, band, b.look.wallTrim, cap, { colors: true, receiveShadow: true, name: 'rise cloth moving' });
    this.prime = PRIME_FRAMES;
    for (const [bt, room] of this.rooms()) { bt.set(room - 1, ZERO, WHITE); bt.commit(room); this.lay(bt, 0); }   // made at its room
    this.blocks = new Map();       // square -> its blocks [{ course (RISE.courses: its merlon), piece }]
    this.keeps = new Map();        // castle id -> { e (units' castle), blocks [{ x, z, y, s, h, piece }] }
    this.pending = new Map();      // square -> the board-clock second its blocks fall (5b: an opened ring, square by square)
    this.live = [];                // pieces whose dust is still to rise (they have not landed)
    this.landed = 0;               // pieces landed this level (the page check reads it: R2b)
    this.landings = [];            // the thunk rates of pieces landed since app/main.js last took them (takeLandings)
    this.debris = [];
    this.ring = new Set();         // the squares the closed rings raise now (riseplan.js ringOf)
    this.base = new Float32Array(g.width * g.height);   // each square's wall top the last frame drew on (a broken one's blocks fall from it)
    this.lift = new Float32Array(g.width * g.height);   // how far each square's landed rise stands over its wall: the pennants ride on it
    this.liftWas = new Float32Array(g.width * g.height);
    b.lift = this.lift;
    this.roof = roofOf(units.models.castle);
    this.terr = undefined; this.key = null; this.top = null;
    this.until = -1;               // the last piece planned has landed and squashed by then
    this.now = 0; this.draws = 0; this.kinds = []; this.kindsMoving = [];
  }

  rooms() { return [[this.stone, ROOM_REST], [this.cloth, ROOM_REST], [this.stoneMoving, ROOM_MOVING], [this.clothMoving, ROOM_MOVING]]; }

  /** Commit batch bt's first n blocks; while the level primes (PRIME_FRAMES), an empty batch still draws one zero-scale block. */
  lay(bt, n) {
    if (n === 0 && this.prime > 0) { bt.set(0, ZERO, WHITE); bt.commit(1); }
    else bt.commit(n);
  }

  /** The renderer's warm-up (renderer.js warmFirstUse): one block of each batch drawn at m (at its fixed room, ROOM_REST /
   *  ROOM_MOVING), so their shaders are compiled while the page loads, not when a ring first closes; redraw() puts them back. */
  warm(m) {
    const c = new THREE.Color(1, 1, 1);
    for (const [bt] of this.rooms()) { bt.set(0, m, c); bt.commit(1); }
  }

  update(dt, seconds) {
    this.now = seconds;
    const primed = this.prime > 0 && --this.prime === 0;               // the level's first frames are over: lay what is really there
    const b = this.board, secured = [];
    for (const e of this.units.castles.values()) if (e.secured) secured.push(e);
    const key = secured.map((e) => e.castle.id).join(',');
    let all = false;
    if (b.territory !== this.terr || key !== this.key) { this.terr = b.territory; this.key = key; this.retarget(secured); all = true; }
    if (b.wallTop !== this.top) {                                   // the walls were drawn again: a risen square's top may have moved
      this.top = b.wallTop;
      for (const s of this.blocks.keys()) if (!(b.wallTop[s] === this.base[s])) { all = true; break; }   // (a hit elsewhere: not)
    }
    for (const [s, at] of this.pending) if (at <= seconds) { this.pending.delete(s); this.fall(s); all = true; }
    if (this.debris.length) this.stepDebris(dt);
    if (this.live.length) this.raiseDust();
    if (all || primed || seconds <= this.until + 0.05) this.draw();  // something placed, broken or still falling or squashing
    // only debris moves (a breach in BATTLE): the resting blocks stay as committed and only the moving batches are laid again (a
    // 4-player battle's breaches tumble debris for most of its frames; the resting blocks change only when a piece lands or a wall changes)
    else if (this.debris.length || this.stoneMoving.n) this.drawDebris();
  }

  /** The closed rings changed (a wall placed or broken, a castle secured or lost): what rises, what falls (UC-L8 1, 2, 5a-5c). */
  retarget(secured) {
    const g = this.grid, w = this.w, now = this.now;
    const want = this.terr ? ringOf(g, this.terr, secured.map((e) => e.castle)) : new Set();
    const wall = (s) => g.occupantAt(s % w, Math.floor(s / w)) === Occupant.Wall;
    for (const s of [...this.pending.keys()]) {
      if (!wall(s)) this.pending.set(s, now);                        // 5a: broken while it waited to unravel: at once
      else if (want.has(s)) this.pending.delete(s);                  // closed again before it fell: it stays
    }
    // 5a, 5b: the squares that leave the ring - a broken one at once, the rest square by square outward from the breach
    const lost = [...this.blocks.keys()].filter((s) => !want.has(s) && !this.pending.has(s));
    if (lost.length) {
      const broken = lost.filter((s) => !wall(s));
      const steps = unravelSteps(lost, broken.length ? broken : [Math.min(...lost)], w);
      for (const s of lost) this.pending.set(s, now + steps.get(s) * RISE.unravel);
    }
    const ids = new Set(secured.map((e) => e.castle.id));
    for (const [id, kp] of this.keeps) if (!ids.has(id)) { this.keepFalls(kp); this.keeps.delete(id); }   // 5b: the tier first
    // 2, 3: the squares new to the ring rise with pieces of their own once their own blocks are down (UC-L3), then the new keeps
    const start = Math.max(now, this.board.dropUntil);
    let at = this.plan([...want].filter((s) => !this.blocks.has(s)), start);
    for (const e of secured) if (!this.keeps.has(e.castle.id)) at = this.planKeep(e, at);
    if (at > start) this.until = Math.max(this.until, at + Math.max(WALL_DROP.squashSeconds, RISE.flash));   // squashed and its flash gone   // (nothing planned: no frames of building)
    this.ring = want;
  }

  /** UC-L8 2, 3: the new squares' courses cut into pieces along their runs (half the runs cut from the far end: riseplan.js cutRun),
   *  landing RISE.stagger apart (closer for a big ring: all within RISE.spread), then their merlons WALL_DROP.stagger apart. Returns
   *  the second the last one lands. */
  plan(squares, start) {
    if (!squares.length) return start;
    const w = this.w, runs = runsOf(squares, w), cut = [];
    for (const run of runs) {
      for (const p of cutRun(run.length, (i, r) => squareHash(run[i], r), (squareHash(run[0], 99) & 1) === 1)) cut.push({ kind: p.kind, cells: p.cells.map(([i, r]) => [run[i], r]) });
    }
    const step = Math.min(RISE.stagger, RISE.spread / cut.length);
    let at = start + WALL_DROP.seconds - step;
    cut.forEach(({ kind, cells }, j) => {
      at += step;
      const pc = { at, low: Math.min(...cells.map((c) => c[1])), tint: tintOf(kind, j), rate: thunkRate(j, cut.length), cells, gone: false };
      for (const [s, r] of cells) this.listOf(s).push({ course: r, piece: pc });
      this.live.push(pc);
    });
    for (const run of runs) for (const s of run) {
      if ((s % w + Math.floor(s / w)) % 2 !== 0) continue;           // the battlements: a merlon where x + y is even
      at += WALL_DROP.stagger;
      this.listOf(s).push({ course: RISE.courses, piece: { at, low: RISE.courses, tint: STONE, cells: null, gone: false } });
    }
    return at;
  }

  listOf(s) { let l = this.blocks.get(s); if (!l) { l = []; this.blocks.set(s, l); } return l; }

  /** UC-L8 2, 3: castle e's tier - keepSide x keepSide blocks round its roof (read from the model, at the scale and lift units.js gave
   *  its body), four L pieces RISE.stagger apart after `after`, then its merlons. Returns the second the last one lands. */
  planKeep(e, after) {
    const M = this.roof, sc = e.body.scale.x, n = RISE.keepSide, side = 2 * Math.min(M.halfX, M.halfZ) * sc, s = side / n;
    const ox = e.g.position.x + M.cx * sc - side / 2, oz = e.g.position.z + M.cz * sc - side / 2;
    const y = e.g.position.y + e.body.position.y + M.y * sc;
    const { cells, pieces, merlons } = keepRing(n), kp = { e, blocks: [] };
    let at = after;
    for (const [pi, p] of pieces.entries()) {
      at += RISE.stagger;
      const pc = { at, low: 0, tint: tintOf(KEEP_KINDS[pi % KEEP_KINDS.length], 0), rate: RISE.thunk[1], pts: p.map((i) => [ox + (cells[i][0] + 0.5) * s, y, oz + (cells[i][1] + 0.5) * s]), gone: false };
      for (const i of p) kp.blocks.push({ x: ox + (cells[i][0] + 0.5) * s, z: oz + (cells[i][1] + 0.5) * s, y, s, h: s, piece: pc });
      this.live.push(pc);
    }
    for (const i of merlons) {
      at += WALL_DROP.stagger;
      const pc = { at, low: 0, tint: STONE, gone: false };
      kp.blocks.push({ x: ox + (cells[i][0] + 0.5) * s, z: oz + (cells[i][1] + 0.5) * s, y: y + s, s: s * RISE.merlonW / RISE_BLOCK_W, h: s * RISE.merlonH / RISE.course, piece: pc });
    }
    this.keeps.set(e.castle.id, kp);
    return at;
  }

  /** A landed piece raises its dust (UC-L3: at the landing, not at the event). */
  raiseDust() {
    const left = [];
    for (const pc of this.live) {
      if (pc.at > this.now) { left.push(pc); continue; }
      if (pc.gone) continue;
      this.landed++; this.landings.push(pc.rate);                   // UC-L8 3: heard as it lands (app/main.js plays it)
      if (pc.pts) { const c = pc.pts.reduce((a, p) => a.add(new THREE.Vector3(...p)), new THREE.Vector3()).divideScalar(pc.pts.length); this.units.fxs.dust(c, 0.45); continue; }
      const w = this.w, c = new THREE.Vector3();
      for (const [s] of pc.cells) c.add(new THREE.Vector3(s % w + 0.5, this.base[s] + pc.low * RISE.course, Math.floor(s / w) + 0.5));
      this.units.fxs.dust(c.divideScalar(pc.cells.length), 0.6);
    }
    this.live = left;
  }

  /** UC-L8 3: the thunk rates of the pieces landed since the last call, in landing order (app/main.js plays them, not in the demo). */
  takeLandings() { const l = this.landings; this.landings = []; return l; }

  /** 5a, 5b: square s's blocks fall: those drawn (falling or down) tumble off as debris from where they are, from its last drawn
   *  wall top (a broken wall's square has none now); those still waiting for their turn are never drawn. */
  fall(s) {
    const list = this.blocks.get(s);
    this.blocks.delete(s);
    if (!list) throw new RiseError('rise.js: square ' + s + ' was to fall but has no blocks');
    const w = this.w, x = s % w, y = Math.floor(s / w), base = this.base[s];
    let n = 0;
    for (const k of list) {
      if (k.piece.cells) k.piece.gone = true;
      const d = dropOf(k.piece, this.now);
      if (!d) continue;
      const merlon = k.course === RISE.courses, h = merlon ? RISE.merlonH : RISE.course, sw = merlon ? RISE.merlonW : RISE_BLOCK_W;
      this.throwBlock(s, n++, x + 0.5, base + k.course * RISE.course + d.fall, y + 0.5, sw, h, k.piece.tint);
    }
    if (n) this.units.fxs.chunks(new THREE.Vector3(x + 0.5, base + RISE.course, y + 0.5), C.stone, DEBRIS_CHIPS, 0.7);
  }

  keepFalls(kp) {
    let n = 0;
    for (const k of kp.blocks) {
      k.piece.gone = true;
      const d = dropOf(k.piece, this.now);
      if (d) this.throwBlock(kp.e.castle.id * 977, n++, k.x, k.y + d.fall, k.z, k.s, k.h, k.piece.tint, kp.e);
    }
  }

  /** A block thrown off as debris: outward at a hashed angle and speed, up, spinning, in its own piece's paint. */
  throwBlock(s, i, x, y, z, sw, h, tint, castle = null) {
    const r = (k) => squareHash(s, 100 + i * 7 + k) / 4294967296, a = r(0) * Math.PI * 2, sp = DEBRIS_OUT[0] + r(1) * (DEBRIS_OUT[1] - DEBRIS_OUT[0]);
    const owner = castle ? this.keepOwner(castle) : this.ownerColour(s);
    this.debris.push({ p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(Math.cos(a) * sp, DEBRIS_UP[0] + r(2) * (DEBRIS_UP[1] - DEBRIS_UP[0]), Math.sin(a) * sp),
                       axis: new THREE.Vector3(r(3) - 0.5, r(4) - 0.5, r(5) - 0.5).normalize(), spin: DEBRIS_SPIN[0] + r(6) * (DEBRIS_SPIN[1] - DEBRIS_SPIN[0]),
                       rot: 0, t: 0, down: -1, k: 1, sw, h, tint, owner: owner.clone(), ground: this.board.groundAtPoint(x, z) });
  }

  stepDebris(dt) {
    const keep = [];
    for (const d of this.debris) {
      d.t += dt;
      if (d.down < 0) {
        d.v.y -= DEBRIS_G * dt; d.p.addScaledVector(d.v, dt); d.rot += d.spin * dt;
        // the land under where it was thrown from, read once at the throw (board.groundAtPoint walks the coast field, board.js
        // drawTufts: so it is not paid per block per frame); it lands within ~1 square of there, where the relief (heightOf) is 0.05
        if (d.p.y <= d.ground) { d.p.y = d.ground; d.down = d.t; }
      }
      d.k = d.down < 0 ? 1 : 1 - (d.t - d.down) / DEBRIS_FADE;
      if (d.k > 0) keep.push(d);
    }
    this.debris = keep;
  }

  ownerColour(s) { const ow = this.grid.ownerAt(s % this.w, Math.floor(s / this.w)); return ow < 4 ? this.board.colourOf(ow) : NEUTRAL_WALL; }
  keepOwner(e) { const o = this.units.castleOwner(e.castle).slot; return o >= 0 ? this.board.colourOf(o) : NEUTRAL_WALL; }

  /** Lay every block where it is now: the courses on each square's drawn wall top (board.wallTop: a damaged block's is lower), the
   *  keeps on their roofs, the debris where it tumbles; then the pennants again if the landed rise under them changed. */
  draw() {
    const g = this.grid, w = this.w, top = this.board.wallTop, now = this.now, H = RISE.course;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), S = new THREE.Vector3(), c = new THREE.Color();
    let n = 0, nm = 0;
    this.kinds.length = 0; this.kindsMoving.length = 0;
    this.lift.fill(0);
    const glow = (pc) => { const t = now - pc.at; return t >= 0 && t < RISE.flash ? FLASH_PEAK * (1 - t / RISE.flash) : 0; };
    const put = (kind, tint, owner, moving, hot = 0) => {
      c.copy(tint).lerp(owner, OWNER_TINT);
      if (hot > 0) c.lerp(HOT, hot);
      if (moving) { this.stoneMoving.set(nm, m, c); this.clothMoving.set(nm, m, owner); this.kindsMoving.push(kind); nm++; }
      else { this.stone.set(n, m, c); this.cloth.set(n, m, owner); this.kinds.push(kind); n++; }
    };
    for (const [s, list] of this.blocks) {
      const x = s % w, y = Math.floor(s / w);
      if (g.occupantAt(x, y) !== Occupant.Wall) throw new RiseError('rise.js: square ' + x + ',' + y + ' has risen blocks but no wall under them');
      const base = top[s];
      if (Number.isNaN(base)) continue;                              // its own wall block has not dropped in yet (board.js drawWalls)
      this.base[s] = base;
      const own = this.ownerColour(s);
      for (const k of list) {
        const d = dropOf(k.piece, now);
        if (!d) continue;
        const merlon = k.course === RISE.courses, h = merlon ? RISE.merlonH : H, low = base + k.piece.low * H, y0 = base + k.course * H;
        const sw = merlon ? RISE.merlonW / RISE_BLOCK_W : 1;          // every block its own bevel and gap: stacked bricks (step 4)
        m.makeScale(sw, h / H * d.squash, sw).setPosition(x + 0.5, low + (y0 - low) * d.squash + d.fall, y + 0.5);
        const still = d.fall === 0 && d.squash === 1;
        put(merlon ? RISE_KIND.merlon : RISE_KIND.course, k.piece.tint, own, !still, glow(k.piece));
        if (still) this.lift[s] = Math.max(this.lift[s], y0 + h - base);
      }
    }
    for (const kp of this.keeps.values()) {
      const own = this.keepOwner(kp.e);
      for (const k of kp.blocks) {
        const d = dropOf(k.piece, now);
        if (!d) continue;
        m.makeScale(k.s / RISE_BLOCK_W, k.h / H * d.squash, k.s / RISE_BLOCK_W).setPosition(k.x, k.y + d.fall, k.z);
        put(RISE_KIND.keep, k.piece.tint, own, !(d.fall === 0 && d.squash === 1), glow(k.piece));
      }
    }
    for (const d of this.debris) {
      m.compose(d.p, q.setFromAxisAngle(d.axis, d.rot), S.set(d.sw / RISE_BLOCK_W * d.k, d.h / H * d.k, d.sw / RISE_BLOCK_W * d.k));
      put(RISE_KIND.debris, d.tint, d.owner, true);
    }
    this.lay(this.stone, n); this.lay(this.cloth, n); this.lay(this.stoneMoving, nm); this.lay(this.clothMoving, nm);
    this.draws++;
    let moved = false;
    for (let i = 0; i < this.lift.length; i++) if (this.lift[i] !== this.liftWas[i]) { moved = true; break; }
    if (moved) { this.liftWas.set(this.lift); this.board.drawPennants(top); }
  }

  /** Lay the debris alone in the moving batches (nothing else is moving: drawn only after every piece has landed and squashed). */
  drawDebris() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), S = new THREE.Vector3(), c = new THREE.Color(), H = RISE.course;
    let nm = 0;
    this.kindsMoving.length = 0;
    for (const d of this.debris) {
      m.compose(d.p, q.setFromAxisAngle(d.axis, d.rot), S.set(d.sw / RISE_BLOCK_W * d.k, d.h / H * d.k, d.sw / RISE_BLOCK_W * d.k));
      c.copy(d.tint).lerp(d.owner, OWNER_TINT);
      this.stoneMoving.set(nm, m, c); this.clothMoving.set(nm, m, d.owner); this.kindsMoving.push(RISE_KIND.debris); nm++;
    }
    this.lay(this.stoneMoving, nm); this.lay(this.clothMoving, nm);
  }

  /** Draw what is laid now (the renderer's warm-up drew its own block into the batches). */
  redraw() { this.draw(); }

  /** UC-L8 R3 (the page check reads it): what is DRAWN, read back from the stone batches' own instance matrices: each square with a
   *  course or a merlon drawn over it as [x, y, courses, merlons, top (the highest drawn block's top, squares)], the keep blocks drawn
   *  by castle id, and the debris; with the planner's own counts beside them (ring squares, squares waiting to unravel, draws). */
  drawnColumns() {
    const cols = new Map(), keeps = {}, e = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let debris = 0;
    for (const [bt, kinds] of [[this.stone, this.kinds], [this.stoneMoving, this.kindsMoving]]) for (let i = 0; i < bt.n; i++) {
      const im = bt.meshes[Math.floor(i / CHUNK)];
      e.fromArray(im.instanceMatrix.array, (i % CHUNK) * 16).decompose(p, q, s);
      const kind = kinds[i];
      if (kind === undefined) continue;                              // the zero-scale block a priming batch draws (lay): nothing shows
      if (kind === RISE_KIND.debris) { debris++; continue; }
      if (kind === RISE_KIND.keep) {
        let best = null, bd = Infinity;
        for (const k of this.units.castles.values()) { const dd = Math.hypot(k.g.position.x - p.x, k.g.position.z - p.z); if (dd < bd) { bd = dd; best = k.castle.id; } }
        keeps[best] = (keeps[best] || 0) + 1;
        continue;
      }
      const x = Math.floor(p.x), y = Math.floor(p.z), key = y * this.w + x, top = p.y + s.y * RISE.course;
      const col = cols.get(key) || [x, y, 0, 0, 0];
      if (kind === RISE_KIND.course) col[2]++; else col[3]++;
      col[4] = Math.max(col[4], top);
      cols.set(key, col);
    }
    return { cols: [...cols.values()], keeps, debris, ring: this.ring.size, pending: this.pending.size, draws: this.draws };
  }

  dispose() {
    this.units.group.remove(this.group);
    this.stone.geo.dispose(); this.cloth.geo.dispose();                // its own two geometries; the materials are the board look's
  }
}
