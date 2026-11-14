// riseplan.js - the castle rise's plan (CASTLE_RISE_UC.md UC-L8), pure data: which wall squares a closed ring raises, how their new
// courses are cut into Tetris pieces and in what order those drop, the keep's tier, and the order an opened ring loses its rise in.
// render/rise.js draws it; test/unit/RisePlanTests.mjs holds it to the use case. Nothing here is a rule (what is closed is the
// board's territory, EnclosureRules.map, and the castles it shows secured), and nothing reads a clock or a random source: every
// choice is hashed from its square, so the same board always cuts the same pieces.
import { Occupant } from '../core/index.js';

// AUTHORED (UC-L8): RISE.courses new courses of RISE.course squares over a 0.5 wall block (board.js WALL_H) and a merlon of merlonH
// on alternate squares, so a risen wall stands 0.5 + 0.82 squares: about three quarters of the castle model's body (its roof is 1.72
// squares up at a 2 x 2 castle, read in rise.js), a curtain wall round it. At the whole-island pitch (54 degrees, camera.js PITCH) the
// rise hides 0.6 of a square more behind a south wall (0.82 / tan 54), so a hero or a cannon one square inside the ring stays in view.
// A piece falls from `height` squares over its rest: more than the finished crown, so it is seen coming down onto what is already
// there. The ring's pieces land `stagger` apart (one every 5-6 frames at 60 fps: each landing is its own moment), the whole ring's
// within `spread`; an opened ring loses a square every `unravel` seconds outward from the breach. The keep's tier is a ring of
// keepSide x keepSide blocks: 16 at 5, four L pieces exactly (keepRing).
// AUTHORED (UC-L8 3 and 4, cycle 3): `flash` - how long a landed piece glows toward white (s); `alt` - the darker tone every other
// piece takes, so two pieces of one kind side by side read apart; `thunk` - the playback rates the ring's first and last landing
// thunks are played at (about a fifth up: the build climbs by ear, still the same stone).
export const RISE = Object.freeze({ courses: 2, course: 0.3, merlonW: 0.5, merlonH: 0.22, height: 1.5, stagger: 0.09, spread: 2.4, unravel: 0.07, keepSide: 5, flash: 0.16, alt: 0.78, thunk: Object.freeze([0.9, 1.35]) });

/** UC-L8 3: the rate piece j of a ring's n pieces is heard at as it lands, rising from RISE.thunk[0] to RISE.thunk[1]. */
export function thunkRate(j, n) {
  const [lo, hi] = RISE.thunk;
  return n <= 1 ? lo : lo + (hi - lo) * j / (n - 1);
}

// AUTHORED (UC-L8 4, R2a; RJ 11-13 "like minecraft tetrix bricks"): each piece painted its Tetris kind's colour - I teal, O gold,
// L orange, J blue, the guideline hues - at a painted-stone strength. These multiply the block's own pale stone vertex colour
// (look.js C.stone 0xd9d2c3, lighter top, darker rim), so a pure hue lands muted, as paint on stone. The domino and the merlons are
// plain stone: they are not tetrominoes. Cycle 1's four stone shades ~10 % apart read as pale slabs at the whole-island zoom
// (LOOKED at shots/rise/claim_rise_settled.png, 11-13).
export const PIECE_TINT = Object.freeze({
  I: Object.freeze([0.45, 1.05, 1.15]), O: Object.freeze([1.25, 1.05, 0.35]), L: Object.freeze([1.3, 0.62, 0.3]), J: Object.freeze([0.5, 0.68, 1.35]),
  D: Object.freeze([1.0, 0.98, 0.94]), stone: Object.freeze([1.0, 0.98, 0.94]),
});
export const KEEP_KINDS = Object.freeze(['I', 'O', 'L', 'J']);   // the keep's four L pieces take the four colours in turn

/** The tint of piece number j (in the order its ring's pieces are laid) of `kind`: its colour, the darker tone on odd j. */
export function pieceTint(kind, j) {
  const t = PIECE_TINT[kind];
  if (!t) throw new RiseError('riseplan.js: no tint for piece kind ' + kind);
  const k = j % 2 === 1 ? RISE.alt : 1;
  return [t[0] * k, t[1] * k, t[2] * k];
}

export class RiseError extends Error {
  constructor(why) { super(why); this.name = 'RiseError'; }
}

/** A square's hash for choice k (32 bits): the cut's piece order and a merlon's stone shade are picked with it. */
export function squareHash(s, k) {
  let h = Math.imul((s ^ 0x9e3779b9) | 0, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16;
  return h >>> 0;
}

/** UC-L8 step 1: the squares a closed ring raises, as indexes y * width + x: every wall square on one of the 8 neighbours of a square
 *  of an enclosed area that holds one of `castles` (the castles drawn secured: units.js updateCastles, every cell of each in an
 *  enclosed area). The 8 neighbours are EnclosureRules.map's own rule for whose walls ring an area. */
export function ringOf(grid, territory, castles) {
  const w = grid.width, h = grid.height, areas = new Set(), out = new Set();
  for (const k of castles) {
    const r = territory.regionAt(k.cells[0].x, k.cells[0].y);
    if (r <= 0) throw new RiseError('ringOf: castle ' + k.id + ' is drawn secured but stands in no enclosed area');
    areas.add(r);
  }
  if (!areas.size) return out;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!areas.has(territory.regionAt(x, y))) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && grid.occupantAt(nx, ny) === Occupant.Wall) out.add(ny * w + nx);
    }
  }
  return out;
}

/** UC-L8 step 2: squares cut into RUNS, paths of side-joined squares, for the courses to be laid along. The squares are put in the
 *  order of their angle about their middle; a run starts at the first square not yet in one and steps each time to the side neighbour
 *  that comes next in that order, so a ring is one run, walked once round. A square joined to the rest only at a corner, or a spur
 *  the walk passed, starts a run of its own. */
export function runsOf(squares, w) {
  const list = [...squares];
  if (!list.length) return [];
  let cx = 0, cy = 0;
  for (const s of list) { cx += s % w + 0.5; cy += Math.floor(s / w) + 0.5; }
  cx /= list.length; cy /= list.length;
  const ang = new Map(list.map((s) => [s, Math.atan2(Math.floor(s / w) + 0.5 - cy, s % w + 0.5 - cx)]));
  list.sort((a, b) => ang.get(a) - ang.get(b) || a - b);
  const rank = new Map(list.map((s, i) => [s, i])), n = list.length, left = new Set(list), runs = [];
  const ahead = (cur, q) => (rank.get(q) - rank.get(cur) + n) % n;
  for (const s0 of list) {
    if (!left.has(s0)) continue;
    const run = [s0];
    left.delete(s0);
    for (let cur = s0; ;) {
      const row = Math.floor(cur / w);
      const nb = [cur + 1, cur - 1, cur + w, cur - w].filter((q, i) => left.has(q) && (i > 1 || Math.floor(q / w) === row));
      if (!nb.length) break;
      nb.sort((a, b) => ahead(cur, a) - ahead(cur, b));
      cur = nb[0]; run.push(cur); left.delete(cur);
    }
    runs.push(run);
  }
  return runs;
}

// The tetrominoes that can be laid in a strip two courses tall and dropped straight down, each as [kind, cells [column, course]]
// listed from its first cell in the cut's scan order (column, then course), which is at column 0. L and J each come both ways up
// (three below and one over an end, or three above and one under an end). A vertical I (four courses tall) cannot stand in two, and
// T, S and Z cannot be laid at all: each leaves a single block between two filled ones that no later piece can reach (measured
// 11-13: offered to the cut, 0 of 8400 pieces over runs of 1..40 squares were T, S or Z).
export const TETROMINOES = Object.freeze([
  ['I', [[0, 0], [1, 0], [2, 0], [3, 0]]], ['I', [[0, 1], [1, 1], [2, 1], [3, 1]]], ['O', [[0, 0], [0, 1], [1, 0], [1, 1]]],
  ['L', [[0, 0], [1, 0], [2, 0], [2, 1]]], ['L', [[0, 0], [0, 1], [1, 1], [2, 1]]], ['J', [[0, 0], [0, 1], [1, 0], [2, 0]]],
  ['J', [[0, 1], [1, 1], [2, 0], [2, 1]]],
]);
// an odd run's two left-over blocks (2n blocks is not a multiple of 4): the one piece that is not a tetromino
const DOMINOES = [['D', [[0, 0], [0, 1]]], ['D', [[0, 0], [1, 0]]], ['D', [[0, 1], [1, 1]]]];

/** UC-L8 step 2: a run of n squares' two new courses cut into pieces, in the order they drop. The strip is filled at its first empty
 *  block (the lower course of the first column not yet full) by the first piece - in an order hash(column, course) shuffles - that
 *  fits there, rests on the wall or on blocks already placed (so it drops straight down in its turn: no block of it over a gap), and
 *  leaves the rest of the strip tileable (the search backs out of a dead end; a dead end is remembered by the column, the next four
 *  columns' fill and the dominoes left). flip: the same cut laid from the run's other end, its mirror (an L for each J): filled from
 *  the first column on, an L that stands three over one can never be laid (its lower block is the first a column needs), so a ring
 *  shows both only when half its runs are cut from the far end. Returns [{ kind, cells: [[column, course], ...] }]. */
export function cutRun(n, hash, flip = false) {
  if (RISE.courses !== 2) throw new RiseError('cutRun: the tetromino table is for 2 courses, RISE.courses is ' + RISE.courses);
  if (!(n >= 1)) throw new RiseError('cutRun: a run of ' + n + ' squares');
  const full = new Uint8Array(n * 2), out = [], dead = new Set();
  const at = (c, r) => full[c * 2 + r];
  const fits = (cells) => cells.every(([c, r]) => c < n && !at(c, r) && (r === 0 || at(c, 0) || cells.some(([c2, r2]) => c2 === c && r2 === 0)));
  const go = (from, spare) => {
    let i = from;
    while (i < n && at(i, 0) && at(i, 1)) i++;
    if (i === n) return true;
    const r = at(i, 0) ? 1 : 0;
    const key = i + ':' + spare + ':' + [1, 2, 3].map((d) => (i + d < n ? at(i + d, 0) + 2 * at(i + d, 1) : 9)).join('') + at(i, 0);
    if (dead.has(key)) return false;
    const h = hash(i, r), keys = TETROMINOES.map((_, j) => squareHash(h, j));
    const order = [...TETROMINOES.map((t, j) => [keys[j], t]).sort((a, b) => a[0] - b[0]).map((e) => e[1]), ...(spare ? DOMINOES : [])];
    for (const [kind, shape] of order) {
      if (shape[0][1] !== r) continue;
      const cells = shape.map(([c, q]) => [i + c, q]);
      if (!fits(cells)) continue;
      for (const [c, q] of cells) full[c * 2 + q] = 1;
      out.push({ kind, cells });
      if (go(i, spare - (kind === 'D' ? 1 : 0))) return true;
      out.pop();
      for (const [c, q] of cells) full[c * 2 + q] = 0;
    }
    dead.add(key);
    return false;
  };
  if (!go(0, n % 2)) throw new RiseError('cutRun: no cut for a run of ' + n + ' squares');
  if (!flip) return out;
  return out.map(({ kind, cells }) => ({ kind: kind === 'L' ? 'J' : kind === 'J' ? 'L' : kind, cells: cells.map(([c, r]) => [n - 1 - c, r]) }));
}

/** UC-L8 step 2: the keep's tier, a ring of side x side blocks round the castle's roof: its cells [i, j] (0..side-1) walked round from a
 *  corner, the pieces (four cells running round the ring from two before a corner, so each holds one corner: four L pieces at side
 *  5) and the merlons (every other cell, the corners among them), both as indexes into the cells. */
export function keepRing(side) {
  if (side !== 5) throw new RiseError('keepRing: cut into L pieces for a side of 5, not ' + side);
  const cells = [], m = side - 1;
  for (let i = 0; i < m; i++) cells.push([i, 0]);
  for (let j = 0; j < m; j++) cells.push([m, j]);
  for (let i = m; i > 0; i--) cells.push([i, m]);
  for (let j = m; j > 0; j--) cells.push([0, j]);
  const n = cells.length, pieces = [];
  for (let s = n - 2; pieces.length < n / 4; s += 4) pieces.push([0, 1, 2, 3].map((d) => (s + d) % n));
  return { cells, pieces, merlons: cells.map((_, i) => i).filter((i) => i % 2 === 0) };
}

/** UC-L8 5b: how many steps from the breach each square of an opened ring loses its rise at: 0 at the sources (the broken squares),
 *  one more for each 8-joined step over the squares. A part the steps cannot reach (joined to the breach by no square) is walked the
 *  same way after, from its first square, counting on from the farthest step so far. Returns a Map index -> steps. */
export function unravelSteps(lost, sources, w) {
  const set = new Set([...lost, ...sources]), out = new Map();
  const walk = (seeds, from) => {
    const q = [];
    for (const s of seeds) { out.set(s, from); q.push(s); }
    for (let i = 0; i < q.length; i++) {
      const s = q[i], x = s % w, d = out.get(s);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= w) continue;
        const t = s + dy * w + dx;
        if (set.has(t) && !out.has(t)) { out.set(t, d + 1); q.push(t); }
      }
    }
  };
  walk(sources, 0);
  for (const s of [...lost].sort((a, b) => a - b)) if (!out.has(s)) walk([s], out.size ? Math.max(...out.values()) + 1 : 0);
  return out;
}
