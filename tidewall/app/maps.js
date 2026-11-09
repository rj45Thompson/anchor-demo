// The islands this game is played on: an ORIGINAL seeded generator. No map is copied from anywhere; every board is made here
// from a seed, as rows of text in the board format the rules read (GridModel.fromAscii):
//   '~' sea, '.' land, 'C' castle (2x2, on land), 'T' tree, 'r' small rock, 'R' large rock, 'H' house.
// What makes a board playable is the rules' own MapCheck (castle ring areas whole plain land, every ring within a ship's range
// of sea that a ship can reach from the edge). The generator places castles by those same constraints, and tools/check_maps.mjs
// runs the ported MapCheck over generated boards. A seed that cannot give a playable board after its attempts is REFUSED with
// the reason, never patched with a stand-in board.
//
// Runs in the browser and in Node (no DOM). Integer PRNG and plain float arithmetic only (no Math.sin/cos), so a seed gives the
// same island on every engine.

/** Board limits and placement constants. Where a number is the rules' own, it is passed in from the ported GameRules. */
export const MAP_LIMITS = Object.freeze({
  maxWidth: 64, maxHeight: 64,      // the rules' MapCheck refuses larger boards
  minCastles: 5,                    // four players each need a home castle, plus at least one more to fight over
  maxCastles: 7,
  castleSize: 2,                    // a castle is 2x2 squares (the board format's 'C' block)
  attempts: 40,                     // sub-seeds tried before a seed is refused
});

/** mulberry32: a small 32-bit integer generator. Same numbers on every JS engine. */
export class IslandRandom {
  constructor(seed) { this.s = seed | 0; }
  nextU32() {
    this.s = (this.s + 0x6D2B79F5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** 0 <= n < max */
  int(max) { if (!(max > 0)) throw new RangeError('IslandRandom.int needs max > 0, got ' + max); return this.nextU32() % max; }
  /** lo <= n <= hi */
  range(lo, hi) { return lo + this.int(hi - lo + 1); }
  /** 0 <= x < 1 */
  unit() { return this.nextU32() / 4294967296; }
}

/** Smooth value noise on an integer lattice: deterministic, no trig. */
class ValueNoise {
  constructor(rng, w, h, cell) {
    this.cell = cell;
    this.gw = Math.floor(w / cell) + 2; this.gh = Math.floor(h / cell) + 2;
    this.v = new Float64Array(this.gw * this.gh);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rng.unit();
  }
  at(x, y) {
    const fx = x / this.cell, fy = y / this.cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (a, b) => this.v[b * this.gw + a];
    const top = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * sx;
    const bot = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * sx;
    return top + (bot - top) * sy;   // 0..1
  }
}

/** One generated island: its rows, and what the generator decided (for a check or a caption). */
export class Island {
  constructor(seed, attempt, rows, castles) {
    this.seed = seed; this.attempt = attempt; this.rows = Object.freeze(rows); this.castles = castles;
    this.width = rows[0].length; this.height = rows.length;
  }
}

/**
 * The island generator. `rules` gives the two numbers placement must honour, read from the ported GameRules:
 * ringRadius (the free starting ring's distance from a castle) and shipRange (Manhattan squares a ship's gun reaches).
 */
export class IslandGenerator {
  constructor(rules) {
    if (!rules || !Number.isInteger(rules.ringRadius) || !Number.isInteger(rules.shipRange))
      throw new TypeError('IslandGenerator needs the rules\' ringRadius and shipRange (whole numbers), got ' + JSON.stringify(rules));
    this.ringRadius = rules.ringRadius;
    this.shipRange = rules.shipRange;
  }

  /** The island for a seed. Tries sub-seeds in a fixed order; refuses the seed (throws) when none gives enough castles. */
  generate(seed) {
    if (!Number.isInteger(seed)) throw new TypeError('an island seed is a whole number, got ' + seed);
    const reasons = [];
    for (let attempt = 0; attempt < MAP_LIMITS.attempts; attempt++) {
      const made = this.tryOnce(seed, attempt);
      if (made.island) return made.island;
      reasons.push('attempt ' + attempt + ': ' + made.why);
    }
    throw new Error('seed ' + seed + ' gave no playable island in ' + MAP_LIMITS.attempts + ' attempts (' + reasons.slice(-3).join('; ') + ')');
  }

  tryOnce(seed, attempt) {
    const rng = new IslandRandom(Math.imul(seed, 0x9E3779B1) ^ Math.imul(attempt + 1, 0x85EBCA77));
    const W = 44 + 2 * rng.int(5);           // 44..52
    const H = 28 + 2 * rng.int(4);           // 28..34
    const land = this.shape(rng, W, H);
    this.carveBays(rng, land, W, H);
    this.smooth(land, W, H, 2);
    this.keepLargestIsland(land, W, H);
    this.addLakes(rng, land, W, H);
    this.fillTinyPonds(land, W, H);
    const sea = this.seaReach(land, W, H);
    const castles = this.placeCastles(rng, land, sea, W, H);
    if (castles.length < MAP_LIMITS.minCastles) return { why: 'only ' + castles.length + ' castle sites (need ' + MAP_LIMITS.minCastles + ')' };
    const grid = [];
    for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) row.push(land[y * W + x] ? '.' : '~'); grid.push(row); }
    for (const c of castles) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) grid[c.y + dy][c.x + dx] = 'C';
    this.addThings(rng, grid, castles, W, H);
    return { island: new Island(seed, attempt, grid.map((r) => r.join('')), castles) };
  }

  /** An elliptical island bent by two octaves of noise; two squares of open sea all round the edge. */
  shape(rng, W, H) {
    const n1 = new ValueNoise(rng, W, H, 9), n2 = new ValueNoise(rng, W, H, 4);
    const cx = (W - 1) / 2 + (rng.unit() - 0.5) * 4, cy = (H - 1) / 2 + (rng.unit() - 0.5) * 3;
    const rx = W * (0.44 + rng.unit() * 0.05), ry = H * (0.44 + rng.unit() * 0.05);
    const land = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      const f = 1 - d + (n1.at(x, y) - 0.5) * 0.6 + (n2.at(x, y) - 0.5) * 0.25;
      if (f > 0.05) land[y * W + x] = 1;
    }
    return land;
  }

  /** Bays: a few tapering inlets cut from the open sea toward the middle. */
  carveBays(rng, land, W, H) {
    const bays = rng.range(1, 3);
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    for (let b = 0; b < bays; b++) {
      // start on the border band at a random point, walk toward the centre with some wander
      const side = rng.int(4);
      let x = side === 0 ? 2 : side === 1 ? W - 3 : 2 + rng.int(W - 4);
      let y = side === 2 ? 2 : side === 3 ? H - 3 : 2 + rng.int(H - 4);
      const length = rng.range(5, 10);
      let width = rng.range(2, 3);
      let inLand = 0;
      for (let step = 0; step < 60 && inLand < length; step++) {
        for (let oy = -1; oy < width - 1; oy++) for (let ox = -1; ox < width - 1; ox++) {
          const px = x + ox, py = y + oy;
          if (px >= 0 && py >= 0 && px < W && py < H) land[py * W + px] = 0;
        }
        if (land[y * W + x] === 0 && this.landAround(land, W, H, x, y) > 0) inLand++;
        const toX = Math.sign(cx - x), toY = Math.sign(cy - y);
        if (rng.int(3) === 0) { if (rng.int(2) === 0) x += toX || 1; else y += toY || 1; }
        else if (Math.abs(cx - x) * H > Math.abs(cy - y) * W) x += toX; else y += toY;
        x = Math.max(1, Math.min(W - 2, x)); y = Math.max(1, Math.min(H - 2, y));
        if (inLand === Math.floor(length * 0.6) && width > 1) width--;   // the inlet narrows
      }
    }
  }

  landAround(land, W, H, x, y) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx, py = y + dy;
      if (px >= 0 && py >= 0 && px < W && py < H && land[py * W + px]) n++;
    }
    return n;
  }

  /** Majority smoothing: ragged single squares become sea or land with their neighbours. The border band stays sea. */
  smooth(land, W, H, passes) {
    for (let p = 0; p < passes; p++) {
      const next = new Uint8Array(land);
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const n = this.landAround(land, W, H, x, y);
        next[y * W + x] = n >= 5 ? 1 : 0;
      }
      land.set(next);
    }
  }

  /** One island: land not 4-connected to the largest landmass goes back to sea. */
  keepLargestIsland(land, W, H) {
    const comp = new Int32Array(W * H).fill(-1);
    const sizes = [];
    for (let i = 0; i < W * H; i++) {
      if (!land[i] || comp[i] >= 0) continue;
      const id = sizes.length; let size = 0; const stack = [i]; comp[i] = id;
      while (stack.length) {
        const j = stack.pop(); size++;
        const x = j % W, y = (j - x) / W;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (land[k] && comp[k] < 0) { comp[k] = id; stack.push(k); }
        }
      }
      sizes.push(size);
    }
    if (!sizes.length) return;
    let best = 0; for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[best]) best = k;
    for (let i = 0; i < W * H; i++) if (land[i] && comp[i] !== best) land[i] = 0;
  }

  /** Lakes: zero to two small ponds well inside the land (the rules treat any water as open to the flood, so a pond inside a
   *  ring leaves that ring open - they are kept clear of castle sites, which are chosen after this on land only). */
  addLakes(rng, land, W, H) {
    const lakes = rng.int(3);
    for (let k = 0; k < lakes; k++) {
      for (let tries = 0; tries < 30; tries++) {
        const x = 4 + rng.int(W - 8), y = 4 + rng.int(H - 8);
        let inland = true;
        for (let dy = -3; dy <= 3 && inland; dy++) for (let dx = -3; dx <= 3; dx++) if (!land[(y + dy) * W + x + dx]) { inland = false; break; }
        if (!inland) continue;
        const r = rng.range(1, 2);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 1) land[(y + dy) * W + x + dx] = 0;
        break;
      }
    }
  }

  /** Inland water of one or two squares left by the noise is filled; real lakes (3+ squares) stay. */
  fillTinyPonds(land, W, H) {
    const sea = this.seaReach(land, W, H);
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (land[i] || sea[i] || seen[i]) continue;
      const cells = [i]; seen[i] = 1;
      for (let q = 0; q < cells.length; q++) {
        const j = cells[q], x = j % W, y = (j - x) / W;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const k = ny * W + nx;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && !land[k] && !seen[k]) { seen[k] = 1; cells.push(k); }
        }
      }
      if (cells.length < 3) for (const j of cells) land[j] = 1;
    }
  }

  /** Water a ship can reach: 4-connected from the water on the board's edge (the rules spawn ships there). */
  seaReach(land, W, H) {
    const reach = new Uint8Array(W * H); const stack = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && !land[y * W + x]) { reach[y * W + x] = 1; stack.push(y * W + x); }
    while (stack.length) {
      const j = stack.pop(), x = j % W, y = (j - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && !land[k] && !reach[k]) { reach[k] = 1; stack.push(k); }
      }
    }
    return reach;
  }

  /** Manhattan distance from every square to the nearest reachable sea (a breadth-first flood over the whole board). */
  seaDistance(sea, W, H) {
    const d = new Int32Array(W * H).fill(-1); const q = [];
    for (let i = 0; i < W * H; i++) if (sea[i]) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const j = q[h], x = j % W, y = (j - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && d[k] < 0) { d[k] = d[j] + 1; q.push(k); }
      }
    }
    return d;
  }

  /**
   * Castle sites: a 2x2 castle whose whole ring area (every square within ringRadius of it, Chebyshev) is land, with some square
   * of the ring itself within shipRange of reachable sea - the rules' MapCheck constraints. Sites are spread out: each new one
   * is the candidate farthest from those already chosen, and no two ring areas touch.
   */
  placeCastles(rng, land, sea, W, H) {
    const r = this.ringRadius, s = MAP_LIMITS.castleSize;
    const dist = this.seaDistance(sea, W, H);
    const cands = [];
    for (let y = r; y + s - 1 + r < H; y++) for (let x = r; x + s - 1 + r < W; x++) {
      let ok = true, nearest = Infinity;
      for (let py = y - r; py <= y + s - 1 + r && ok; py++) for (let px = x - r; px <= x + s - 1 + r; px++) {
        if (!land[py * W + px]) { ok = false; break; }
        const dx = px < x ? x - px : px > x + s - 1 ? px - (x + s - 1) : 0;
        const dy = py < y ? y - py : py > y + s - 1 ? py - (y + s - 1) : 0;
        if (Math.max(dx, dy) === r) nearest = Math.min(nearest, dist[py * W + px]);
      }
      if (ok && nearest <= this.shipRange) cands.push({ x, y, coast: nearest });
    }
    if (!cands.length) return [];
    const gap = s + 2 * r + 1;        // top-left to top-left: ring areas separated by at least one square
    const chosen = [];
    // first castle: a random coastal candidate; then farthest-point picks
    const coastal = cands.filter((c) => c.coast <= Math.max(2, Math.floor(this.shipRange / 2)));
    const first = (coastal.length ? coastal : cands)[rng.int((coastal.length ? coastal : cands).length)];
    chosen.push(first);
    while (chosen.length < MAP_LIMITS.maxCastles) {
      let best = null, bestScore = -1;
      for (const c of cands) {
        let minD = Infinity, clash = false;
        for (const k of chosen) {
          const cheb = Math.max(Math.abs(c.x - k.x), Math.abs(c.y - k.y));
          if (cheb < gap) { clash = true; break; }
          minD = Math.min(minD, Math.abs(c.x - k.x) + Math.abs(c.y - k.y));
        }
        if (clash) continue;
        const score = minD * 4 - c.coast;     // spread first, then nearer the shore (ships must threaten every castle)
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (!best) break;
      chosen.push(best);
    }
    return chosen.map((c) => ({ x: c.x, y: c.y }));
  }

  /** Trees in small woods, rocks and a few houses: only on open land outside every castle's ring area (plus one square). */
  addThings(rng, grid, castles, W, H) {
    const r = this.ringRadius + 1, s = MAP_LIMITS.castleSize;
    const free = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H || grid[y][x] !== '.') return false;
      for (const c of castles) if (x >= c.x - r && x <= c.x + s - 1 + r && y >= c.y - r && y <= c.y + s - 1 + r) return false;
      return true;
    };
    const woods = rng.range(2, 4);
    for (let w = 0; w < woods; w++) {
      let x = rng.int(W), y = rng.int(H), placed = 0;
      for (let step = 0; step < 24 && placed < 7; step++) {
        if (free(x, y)) { grid[y][x] = 'T'; placed++; }
        x += rng.int(3) - 1; y += rng.int(3) - 1;
      }
    }
    const put = (ch, count) => {
      for (let k = 0, tries = 0; k < count && tries < 200; tries++) {
        const x = rng.int(W), y = rng.int(H);
        if (free(x, y)) { grid[y][x] = ch; k++; }
      }
    };
    put('r', rng.range(2, 4));
    put('R', rng.range(1, 2));
    put('H', rng.range(1, 3));
  }
}

/**
 * The campaign's islands, in play order: original names (PascalCase, as the rules carry map names) and the seed each is made
 * from. Two waves are fought on each before the next island (the rules' round table decides when the map changes).
 */
export const CAMPAIGN_ISLANDS = Object.freeze([
  Object.freeze({ name: 'GullrockIsle', seed: 4127 }),
  Object.freeze({ name: 'SaltspireReach', seed: 9311 }),
  Object.freeze({ name: 'KelpmoorBay', seed: 22051 }),
  Object.freeze({ name: 'DriftwoodAtoll', seed: 60413 }),
]);

/**
 * The named map source the rules load boards from: name -> rows. Built once per rules object (the ring radius and ship range
 * shape the castle sites), cached by name. An unknown name is refused with the known names listed.
 */
export class MapSource {
  constructor(rules, islands = CAMPAIGN_ISLANDS) {
    this.generator = new IslandGenerator(rules);
    this.islands = islands;
    this.cache = new Map();
  }
  get names() { return this.islands.map((i) => i.name); }
  island(name) {
    let made = this.cache.get(name);
    if (made) return made;
    const spec = this.islands.find((i) => i.name === name);
    if (!spec) throw new Error("no island named '" + name + "' (known: " + this.names.join(', ') + ')');
    made = this.generator.generate(spec.seed);
    this.cache.set(name, made);
    return made;
  }
  byName(name) { return this.island(name).rows; }
}
