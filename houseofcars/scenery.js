// scenery.js - past the drag strip's walls (UC-37.4): a mown verge and a patchwork of fields, groves and shelterbelts of low-poly
// trees, and a ring of low hills in the haze, so the world does not end at a flat colour. Built once (no per-frame work); the
// caller adds `group` to the strip's scene and puts `grassMaterial` on its own grass plane (app.js buildDragStrip: 4000 x 4000 m
// at y = -0.03, centred on x = END / 2).
//
// READ, each from where it is said:
//   the strip's length: drag.js MARKS.quarter, and app.js buildDragStrip's `behind = 30` and `END = Q + 700` (restated below as
//   STRIP_X0 / STRIP_X1, because app.js does not export them; test/scenery.test.mjs checks them against app.js's source): the
//   strip runs x = -30 .. 1102.3 m along z = 0, its walls (drag_cam.js STRIP) at z = +-12.6 m, well inside the 40 m clearance;
//   the strip camera's far plane, 3000 m (app.js startDrag: new THREE.PerspectiveCamera(60, ..., 0.1, 3000)): every hill vertex
//   stays inside it seen from anywhere on the strip, so the far plane never cuts a ridge;
//   the haze: the caller's own THREE.Fog (opts.fog), read live by reference, so the scenery matches the rest of the scene.
// AUTHORED, all the rest: every colour, size, count, distance, the noise and the crops are the page's own choices, none is read
// from a source. The level's ground is grey (data/track.json landscape_material.ground_col, the Unreal template's); green is
// the page's choice for the strip's grass. opts.groundColour (that READ grey) is used only where the far ridge fades into the
// haze. The haze is the scene fog's wherever the strip itself can be (within ~1.2 km of a camera) and is capped beyond, so the
// hills 1.5-2.9 km out keep a shape instead of all going to the fog's one colour past its 2200 m far distance.
// Clearances (AUTHORED, held by test/scenery.test.mjs): nothing within 40 m of the strip's centre line, crowns included (the
// strip's cameras stand up to ~16 m from it); trees 60-900 m out; the hills from 1.5 km out to the far-plane limit.
//
// Pure parts (no three, no DOM; test/scenery.test.mjs runs them in node): makeRng, distToStrip, layoutTrees, treeGeometryData,
// hillGeometryData, hillOuterRadius, grassDetailPixels, grassMacroPixels, sceneryBudget. buildScenery(THREE, opts) wraps them in
// three.js objects; it takes the three/webgpu namespace from the caller and its node functions from THREE.TSL.
import { MARKS } from './drag.js';

// ---------------------------------------------------------------- the strip, as app.js builds it (READ, see the header)
export const STRIP_X0 = -30;                                   // app.js buildDragStrip: `behind = 30` behind the start line
export const STRIP_X1 = MARKS.quarter + 700;                   // app.js buildDragStrip: `END = Q + 700`
export const PLANE = { cx: STRIP_X1 / 2, cz: 0, size: 4000, y: -0.03 };   // app.js buildDragStrip's grass plane
export const CAMERA_FAR_M = 3000;                              // app.js startDrag: the strip camera's far plane

// ---------------------------------------------------------------- the page's own choices (AUTHORED)
export const CLEAR_M = 40;                                     // nothing nearer the strip's centre line than this, crowns included
export const TREE_BAND = [60, 900];                            // a trunk's distance from the strip (m)
export const FAR_D = 400;                                      // at 'high', trees this far out use the far variants
export const VIEW_LIMIT_M = CAMERA_FAR_M - 50;                 // the hills stay this close to both strip ends (50 m spare for the
                                                               // cameras' 16 m off the line and the hills' height)
export const HILLS = { r_in: 1500, r_out_max: 3500, foot_y: -4 };   // from the grass plane's centre (m)
export const HAZE = { cap0: 0.48, cap1: 0.74, from_m: 1000, to_m: 3000 };   // the cap on the scene fog's factor, by view depth
export const BUDGET = { high: { drawCalls: 6, triangles: 60000 }, low: { drawCalls: 3, triangles: 30000 } };
export const QUALITY = {
  high: { variants: ['conifer', 'broadleaf', 'shrub', 'coneFar', 'roundFar'], hillAngular: 256, hillRadial: 16, grassPx: 512 },
  low: { variants: ['conifer', 'broadleaf'], hillAngular: 160, hillRadial: 10, grassPx: 256, keepNear: 0.8, keepFar: 0.3, treeTris: 24000 },
};
export const TREE_TRIS_HIGH = { near: 14000, far: 36500 };     // the layout's caps at 'high', near and far of FAR_D
// linear RGB albedos (AUTHORED): a summer lawn, straw where it dries, spruce, aspen-like broadleaf, scrub; the crops; the hills' forest
export const COLOURS = {
  grass: [0.05, 0.1, 0.026], dry: [0.12, 0.11, 0.045],
  coniferLeaf: [0.018, 0.04, 0.022], coniferBark: [0.05, 0.033, 0.02],
  broadLeaf: [0.052, 0.098, 0.022], broadBark: [0.15, 0.14, 0.11], shrub: [0.035, 0.068, 0.02],
  hillForest: [0.02, 0.04, 0.02],
  crops: [[0.06, 0.105, 0.03], [0.2, 0.15, 0.055], [0.13, 0.1, 0.062], [0.27, 0.22, 0.03], [0.038, 0.08, 0.024]],
  // pasture, ripening wheat, stubble, canola, a dark green crop; chosen by a field's hash at these thresholds:
  cropAt: [0, 0.3, 0.55, 0.78, 0.87],
};
export const GRASS = {
  blade_tile_m: 2.4, blade_tile2_m: 6.7, blade_turn: 0.61,      // the blade texture, twice at two sizes and angles: no visible repeat
  macro_tile_m: 173, macro_tile2_m: 41,                          // broad lush and dry patches, two sizes
  stripe_w_m: 7, stripe_amp: 0.07, stripe_base: 0.02, stripe_wave_m: 0.9,   // mowing stripes along x, lighter where the blades
                                                                             // lean away from the eye; the mower's lines wander
  mown_z_m: [55, 110], mown_x_pad_m: 160,                        // the mown verge around the strip
  stripe_fade_m: [260, 700],                                     // stripes fade with the camera's distance (no shimmer far off)
};
export const FIELDS = { u_m: 420, v_m: 290, from_m: [150, 280], margin_m: [3, 8] };   // the field grid (cells), where fields begin

// ---------------------------------------------------------------- seeded randomness and noise (pure)
/** a seeded RNG (mulberry32): the same seed gives the same sequence everywhere */
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(ix, iy, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
/** value noise in [0, 1); `period` (cells) makes it tile */
function valueNoise(seed, period = 0) {
  const w = (i) => (period ? ((i % period) + period) % period : i);
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = fade(x - ix), fy = fade(y - iy);
    const a = hash3(w(ix), w(iy), seed), b = hash3(w(ix + 1), w(iy), seed), c = hash3(w(ix), w(iy + 1), seed), d = hash3(w(ix + 1), w(iy + 1), seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
/** fractal sum of value noise in ~[0, 1); with `period`, each octave tiles (period doubles per octave) */
function fbm(seed, octaves, period = 0) {
  const ns = Array.from({ length: octaves }, (_, o) => valueNoise(seed + o * 1013, period ? period << o : 0));
  return (x, y) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (const n of ns) { s += amp * n(x * f, y * f); norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** a point's distance (m) from the strip's centre line: the segment x = STRIP_X0..STRIP_X1 on z = 0 */
export function distToStrip(x, z) {
  const cx = Math.min(Math.max(x, STRIP_X0), STRIP_X1);
  return Math.hypot(x - cx, z);
}

// ---------------------------------------------------------------- tree geometry (pure; a unit tree: base at 0, 1 high)
// Each variant is one merged mesh with vertex colours (bark, foliage shaded darker toward its underside), drawn as one
// InstancedMesh; an instance scales it by (height * width, height, height * width) and turns it about y. The far variants are a
// few triangles each: at 400 m and more a tree is a few dozen pixels, and the groves out there are what makes the forest.
const TREE_SPEC = {
  conifer: {
    high: { trunkSides: 3, seg: 6, tiers: [[0.1, 0.62, 0.2], [0.36, 0.84, 0.152], [0.6, 1, 0.1]] },   // [bottom, top, radius]
    low: { trunkSides: 3, seg: 5, tiers: [[0.1, 0.7, 0.2], [0.45, 1, 0.13]] },
    trunk: [0.022, 0.24],
  },
  broadleaf: {
    high: { trunkSides: 3, blobs: [[0, 0.62, 0, 0.3, 0.33], [0.07, 0.8, -0.05, 0.21, 0.21]] },          // [x, y, z, rxz, ry]
    low: { trunkSides: 3, blobs: [[0, 0.66, 0, 0.3, 0.34]] },
    trunk: [0.03, 0.46],
  },
  shrub: { high: { trunkSides: 0, blobs: [[0, 0.46, 0, 0.5, 0.5]] }, trunk: [0, 0] },
  coneFar: { high: { seg: 5, y0: 0.08, r: 0.21 } },
  roundFar: { high: { ring: 4, y: [0.16, 0.56, 1], r: 0.33 } },
};
const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_V = [[-1, ICO_T, 0], [1, ICO_T, 0], [-1, -ICO_T, 0], [1, -ICO_T, 0], [0, -1, ICO_T], [0, 1, ICO_T], [0, -1, -ICO_T], [0, 1, -ICO_T], [ICO_T, 0, -1], [ICO_T, 0, 1], [-ICO_T, 0, -1], [-ICO_T, 0, 1]]
  .map((v) => { const l = Math.hypot(...v); return v.map((c) => c / l); });
const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

function meshBuilder() {
  const P = [], N = [], C = [], I = [];
  const vert = (p, n, c) => { const l = Math.hypot(...n) || 1; P.push(...p); N.push(n[0] / l, n[1] / l, n[2] / l); C.push(...c); return P.length / 3 - 1; };
  // a triangle wound so its face normal points along `out` (counter-clockwise seen from there, three.js's front face)
  const tri = (a, b, c, out) => {
    const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
    const ux = P[3 * b] - ax, uy = P[3 * b + 1] - ay, uz = P[3 * b + 2] - az, vx = P[3 * c] - ax, vy = P[3 * c + 1] - ay, vz = P[3 * c + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) I.push(a, b, c); else I.push(a, c, b);
  };
  const done = () => ({ position: new Float32Array(P), normal: new Float32Array(N), color: new Float32Array(C), index: new Uint16Array(I) });
  return { vert, tri, done };
}
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function addTrunk(m, sides, r, h, bark) {
  if (!sides) return;
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2, n = [Math.cos(a), 0, Math.sin(a)];
    ring.push([m.vert([r * n[0], 0, r * n[2]], n, scale3(bark, 0.7)), m.vert([r * 0.8 * n[0], h, r * 0.8 * n[2]], n, bark), n]);
  }
  for (let i = 0; i < sides; i++) {
    const [a0, a1, na] = ring[i], [b0, b1, nb] = ring[(i + 1) % sides], out = [na[0] + nb[0], 0, na[2] + nb[2]];
    m.tri(a0, b0, b1, out); m.tri(a0, b1, a1, out);
  }
}
// one cone's sides from y0 to y1 at radius r (and its underside, a shallow fan up into it, when `under`)
function addCone(m, rng, seg, y0, y1, r, turn, leaf, under) {
  const h = y1 - y0, ring = [], sn = (a) => [Math.cos(a) * h, r, Math.sin(a) * h];
  for (let i = 0; i < seg; i++) {
    const a = turn + (i / seg) * Math.PI * 2;
    ring.push({ a, p: [r * (0.88 + 0.24 * rng()) * Math.cos(a), y0 - 0.025 * rng(), r * (0.88 + 0.24 * rng()) * Math.sin(a)] });
  }
  const mid = under ? m.vert([0, y0 + h * 0.28, 0], [0, -1, 0], scale3(leaf, 0.32)) : -1;
  for (let i = 0; i < seg; i++) {
    const A = ring[i], B = ring[(i + 1) % seg], am = A.a + Math.PI / seg;
    const a0 = m.vert(A.p, sn(A.a), scale3(leaf, 0.62)), b0 = m.vert(B.p, sn(B.a), scale3(leaf, 0.62)), tip = m.vert([0, y1, 0], sn(am), scale3(leaf, 1.08));
    m.tri(a0, b0, tip, [Math.cos(am), 0.3, Math.sin(am)]);
    if (under) { const a1 = m.vert(A.p, [0, -1, 0], scale3(leaf, 0.45)), b1 = m.vert(B.p, [0, -1, 0], scale3(leaf, 0.45)); m.tri(a1, b1, mid, [0, -1, 0]); }
  }
}
/** the vertex arrays of one tree variant at one quality: { position, normal, color, index (Uint16), triangles, extentXZ (the
 *  widest reach from the trunk, unit tree) } */
export function treeGeometryData(variant, quality) {
  const spec = TREE_SPEC[variant], q = spec && spec[quality];
  if (!q) throw new Error('scenery: no tree variant ' + variant + ' at quality ' + quality);
  const rng = makeRng(1 + Object.keys(TREE_SPEC).indexOf(variant) * 12);   // the variant's own fixed irregularity
  const m = meshBuilder();
  if (variant === 'conifer') {
    addTrunk(m, q.trunkSides, spec.trunk[0], spec.trunk[1], COLOURS.coniferBark);
    q.tiers.forEach(([y0, y1, r], k) => addCone(m, rng, q.seg, y0, y1, r, (k * Math.PI) / q.seg, COLOURS.coniferLeaf, true));
  } else if (variant === 'coneFar') {
    addCone(m, rng, q.seg, q.y0, 1, q.r, 0, COLOURS.coniferLeaf, false);
  } else if (variant === 'roundFar') {                          // a lumpy bipyramid: a ring, a top and a bottom
    const leaf = COLOURS.broadLeaf, [yb, ym, yt] = q.y, top = m.vert([0, yt, 0], [0, 1, 0], scale3(leaf, 1.05)), bot = m.vert([0, yb, 0], [0, -1, 0], scale3(leaf, 0.45));
    const ring = [];
    for (let i = 0; i < q.ring; i++) {
      const a = (i / q.ring) * Math.PI * 2, rr = q.r * (0.85 + 0.3 * rng());
      ring.push(m.vert([rr * Math.cos(a), ym + 0.06 * (rng() - 0.5), rr * Math.sin(a)], [Math.cos(a), 0.15, Math.sin(a)], scale3(leaf, 0.75)));
    }
    for (let i = 0; i < q.ring; i++) {
      const a = ((i + 0.5) / q.ring) * Math.PI * 2, o = [Math.cos(a), 0, Math.sin(a)];
      m.tri(ring[i], ring[(i + 1) % q.ring], top, [o[0], 0.6, o[2]]); m.tri(ring[i], ring[(i + 1) % q.ring], bot, [o[0], -0.6, o[2]]);
    }
  } else {
    const leaf = variant === 'shrub' ? COLOURS.shrub : COLOURS.broadLeaf;
    addTrunk(m, q.trunkSides, spec.trunk[0], spec.trunk[1], COLOURS.broadBark);
    for (const [bx, by, bz, rxz, ry] of q.blobs) {
      const ids = ICO_V.map((v) => {
        const j = 0.9 + 0.2 * rng(), p = [bx + v[0] * rxz * j, by + v[1] * ry * j, bz + v[2] * rxz * j];
        return m.vert(p, [v[0] / rxz, v[1] / ry, v[2] / rxz], scale3(leaf, 0.5 + 0.55 * (v[1] * 0.5 + 0.5)));   // darker underneath
      });
      for (const f of ICO_F) {
        const v = f.map((k) => ICO_V[k]);
        m.tri(ids[f[0]], ids[f[1]], ids[f[2]], [v[0][0] + v[1][0] + v[2][0], v[0][1] + v[1][1] + v[2][1], v[0][2] + v[1][2] + v[2][2]]);
      }
    }
  }
  const d = m.done();
  let ext = 0;
  for (let i = 0; i < d.position.length; i += 3) ext = Math.max(ext, Math.hypot(d.position[i], d.position[i + 2]));
  return { ...d, triangles: d.index.length / 3, extentXZ: ext };
}

// ---------------------------------------------------------------- the trees' layout (pure)
export const VARIANTS = ['conifer', 'broadleaf', 'shrub', 'coneFar', 'roundFar'];
/** which variant draws a tree of this species at this quality, `far` when it stands FAR_D or more from the strip */
export const variantFor = (species, far, quality) =>
  quality === 'low' || species === 'shrub' || !far ? species : species === 'conifer' ? 'coneFar' : 'roundFar';
const KIND = {   // [species, height range m, width factor range]
  spruce: ['conifer', [14, 27], [0.88, 1.12]],
  broad: ['broadleaf', [11, 19], [0.85, 1.2]],
  poplar: ['broadleaf', [17, 26], [0.42, 0.52]],
  solitary: ['broadleaf', [13, 20], [1.1, 1.35]],
  shrub: ['shrub', [1.6, 3.4], [0.8, 1.25]],
};
const FEATURES = { near: { treelines: 12, groves: 8, solitary: 16 }, far: { treelines: 26, groves: 56 } };
let geoCache = null;
const geoInfo = () => geoCache || (geoCache = Object.fromEntries(['high', 'low'].map((q) => [q, Object.fromEntries(VARIANTS.filter((v) => TREE_SPEC[v][q])
  .map((v) => { const g = treeGeometryData(v, q); return [v, { triangles: g.triangles, extentXZ: g.extentXZ }]; }))])));

/** the trees: deterministic from the seed; the same groves at both qualities ('low' keeps a fixed share, no shrubs, under its
 *  triangle cap). Returns { count, x, z, y, height, width (the crown's factor), yaw, variant (index into VARIANTS), tint (rgb per
 *  tree), crown (m: the widest reach from the trunk), dist (m from the strip), perVariant: { name: count }, field: the field grid
 *  { angle, u_m, v_m, offU, offV } that the shelterbelts follow and the grass material paints } */
export function layoutTrees(seed, quality) {
  const Q = QUALITY[quality];
  if (!Q) throw new Error('scenery: quality must be high or low, not ' + quality);
  if (!Number.isInteger(seed)) throw new Error('scenery: seed must be an integer, not ' + seed);
  const G = geoInfo(), rng = makeRng(seed), gapNoise = valueNoise(seed + 77);
  const reach = (sp) => Math.max(...VARIANTS.filter((v) => v === sp || variantFor(sp, true, 'high') === v).map((v) => G.high[v].extentXZ));
  const field = { angle: (rng() - 0.5) * 0.24, u_m: FIELDS.u_m, v_m: FIELDS.v_m, offU: rng() * FIELDS.u_m, offV: rng() * FIELDS.v_m };
  const ca = Math.cos(field.angle), sa = Math.sin(field.angle);
  const toUV = (x, z) => [x * ca + z * sa - field.offU, z * ca - x * sa - field.offV], fromUV = (u, v) => [(u + field.offU) * ca - (v + field.offV) * sa, (u + field.offU) * sa + (v + field.offV) * ca];
  const trees = [], cell = 10, hash = new Map(), used = { near: 0, far: 0 };
  const crowded = (x, z, r, isShrub) => {
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
    for (let i = ix - 2; i <= ix + 2; i++) for (let k = iz - 2; k <= iz + 2; k++) for (const t of hash.get(i + ',' + k) || []) {
      if (Math.hypot(t.x - x, t.z - z) < (isShrub || t.species === 'shrub' ? 0.45 : 0.72) * (r + t.crown)) return true;
    }
    return false;
  };
  const plant = (kind, x, z, tint, hk = 1) => {
    const [species, [h0, h1], [w0, w1]] = KIND[kind], d = distToStrip(x, z), far = d >= FAR_D;
    if (d < TREE_BAND[0] || d > TREE_BAND[1] || (species === 'shrub' && far)) return;
    const height = (h0 + (h1 - h0) * rng()) * hk, width = (w0 + (w1 - w0) * rng()) * (far ? 1.12 : 1), crown = reach(species) * height * width;
    const cls = far ? 'far' : 'near', tris = G.high[variantFor(species, far, 'high')].triangles;
    if (used[cls] + tris > TREE_TRIS_HIGH[cls]) return;                     // this side of FAR_D is full
    if (d - crown < CLEAR_M || crowded(x, z, crown, species === 'shrub')) return;
    const j = 0.08, t = tint.map((c) => c * (1 + j * (rng() - 0.5)));
    const tree = { i: trees.length, species, far, x, z, d, height, width, crown, yaw: rng() * Math.PI * 2, tint: t, rank: rng() };
    trees.push(tree); used[cls] += tris;
    const key = Math.floor(x / cell) + ',' + Math.floor(z / cell);
    (hash.get(key) || hash.set(key, []).get(key)).push(tree);
  };
  const bx0 = STRIP_X0 - TREE_BAND[1], bx1 = STRIP_X1 + TREE_BAND[1];
  const centre = (dMin, dMax, weight) => {
    for (let k = 0; k < 400; k++) {
      const x = bx0 + (bx1 - bx0) * rng(), z = (rng() * 2 - 1) * TREE_BAND[1], d = distToStrip(x, z);
      if (d >= dMin && d <= dMax && rng() < weight(d)) return [x, z, d];
    }
    return null;                                                             // a feature that found no place is not planted
  };
  const groveTint = () => { const l = 0.82 + 0.34 * rng(), y = (rng() - 0.5) * 0.22; return [l * (1 + y), l, l * (1 - y)]; };
  const jobs = [];
  for (const [band, f] of Object.entries(FEATURES)) for (const [job, n] of Object.entries(f)) for (let i = 0; i < n; i++) jobs.push([job, band]);
  for (let i = jobs.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); [jobs[i], jobs[k]] = [jobs[k], jobs[i]]; }
  const dRange = { near: [75, FAR_D - 20], far: [FAR_D + 10, 880] };
  const weight = { near: () => 1, far: (d) => 0.35 + 0.65 * smooth(FAR_D, 800, d) };   // denser far away
  jobs.forEach(([job, band], fi) => {
    const c = centre(dRange[band][0], dRange[band][1], weight[band]); if (!c) return;
    const farK = band === 'far' ? 1 : 0;
    if (job === 'solitary') { plant('solitary', c[0], c[1], groveTint()); return; }
    if (job === 'treeline') {                                                // a shelterbelt along a field edge
      const alongU = rng() < 0.5, [u, v] = toUV(c[0], c[1]);
      const [sx, sz] = alongU ? fromUV(u, Math.round(v / field.v_m) * field.v_m) : fromUV(Math.round(u / field.u_m) * field.u_m, v);
      const a = field.angle + (alongU ? 0 : Math.PI / 2), dx = Math.cos(a), dz = Math.sin(a);
      const len = 110 + (200 + 380 * farK) * rng(), step = 5.5 + 2 * rng(), rows = rng() < 0.35 + 0.3 * farK ? 2 : 1;
      const poplars = rng() < 0.4, tint = poplars ? [0.8, 0.95, 0.85] : groveTint();
      for (let s = -len / 2; s <= len / 2; s += step) {
        if (gapNoise(fi * 7.3, (s + len) * 0.045) < 0.22) continue;          // the gaps a real belt has
        for (let r = 0; r < rows; r++) {
          const off = (r - (rows - 1) / 2) * 4.6 + (rng() - 0.5) * 1.6, along = s + (rng() - 0.5) * 1.8;
          const x = sx + dx * along - dz * off, z = sz + dz * along + dx * off;
          plant(poplars ? 'poplar' : rng() < 0.33 ? 'spruce' : 'broad', x, z, tint);
          if (rng() < 0.45) plant('shrub', x - dz * (off >= 0 ? 3 : -3), z + dx * (off >= 0 ? 3 : -3), tint);
        }
      }
      return;
    }
    // a grove: an irregular round stand, taller inside, scrub round its edge; far out they are big
    const R = farK ? 28 + 62 * rng() : 14 + 24 * rng(), spruce = rng() < 0.35, tint = groveTint();
    const edge = valueNoise(seed + 300 + fi), step = farK ? 7.5 + 2 * rng() : 5.4 + 2 * rng(), tries = Math.round((Math.PI * R * R) / (step * step) * 1.7);
    for (let k = 0; k < tries; k++) {
      const ang = rng() * Math.PI * 2, rr = Math.sqrt(rng()), lim = R * (0.7 + 0.45 * edge(Math.cos(ang) * 2 + 9, Math.sin(ang) * 2 + 9));
      plant(spruce ? (rng() < 0.82 ? 'spruce' : 'broad') : (rng() < 0.85 ? 'broad' : 'spruce'), c[0] + Math.cos(ang) * rr * lim, c[1] + Math.sin(ang) * rr * lim, tint, 0.78 + 0.34 * (1 - rr));
    }
    for (let k = 0, n = Math.round(R * 0.5); k < n; k++) {
      const ang = rng() * Math.PI * 2, rr = R * (0.95 + 0.25 * rng());
      plant('shrub', c[0] + Math.cos(ang) * rr, c[1] + Math.sin(ang) * rr, tint);
    }
  });
  let kept = trees;
  if (quality === 'low') {                                                   // a fixed share, the cheapest first to go
    const pri = (t) => t.rank / (t.far ? Q.keepFar : Q.keepNear);
    const cand = trees.filter((t) => t.species !== 'shrub' && pri(t) <= 1).sort((a, b) => pri(a) - pri(b));
    let tris = 0; kept = [];
    for (const t of cand) { const n = G.low[t.species].triangles; if (tris + n > Q.treeTris) break; tris += n; kept.push(t); }
    kept.sort((a, b) => a.i - b.i);
  }
  const n = kept.length, out = {
    count: n, x: new Float32Array(n), z: new Float32Array(n), y: new Float32Array(n), height: new Float32Array(n), width: new Float32Array(n),
    yaw: new Float32Array(n), variant: new Uint8Array(n), tint: new Float32Array(3 * n), crown: new Float32Array(n), dist: new Float32Array(n),
    perVariant: Object.fromEntries(Q.variants.map((v) => [v, 0])), field,
  };
  kept.forEach((t, i) => {
    const v = variantFor(t.species, t.far, quality);
    out.x[i] = t.x; out.z[i] = t.z; out.y[i] = PLANE.y - (t.species === 'shrub' ? 0.35 : 0.25);   // sunk a little: no tree floats
    out.height[i] = t.height; out.width[i] = t.width; out.yaw[i] = t.yaw; out.variant[i] = VARIANTS.indexOf(v);
    out.tint.set(t.tint, 3 * i); out.crown[i] = t.crown; out.dist[i] = t.d; out.perVariant[v]++;
  });
  return out;
}

// ---------------------------------------------------------------- the hills (pure)
/** how far out (m, from the grass plane's centre, along the angle theta from +x toward +z) the hills may reach and still be
 *  inside VIEW_LIMIT_M of both ends of the strip, so the strip camera's far plane never cuts a ridge */
export function hillOuterRadius(theta) {
  const ux = Math.cos(theta);
  let R = HILLS.r_out_max;
  for (const ex of [STRIP_X0, STRIP_X1]) {
    const wx = PLANE.cx - ex, wu = wx * ux;
    R = Math.min(R, -wu + Math.sqrt(wu * wu - wx * wx + VIEW_LIMIT_M * VIEW_LIMIT_M));
  }
  return R;
}

/** the ring of hills: a polar grid from HILLS.r_in out to hillOuterRadius, a low near range and a higher far ridge behind it,
 *  both shaped by noise around the ring; meadow and forest by vertex colour. Returns { position, normal, color, index (Uint16),
 *  triangles, maxY } */
export function hillGeometryData(seed, quality, groundColour) {
  const Q = QUALITY[quality];
  if (!Q) throw new Error('scenery: quality must be high or low, not ' + quality);
  const nA = Q.hillAngular, nR = Q.hillRadial;
  const n1 = fbm(seed + 501, 5), n2 = fbm(seed + 502, 5), det = fbm(seed + 503, 4), wood = fbm(seed + 504, 4);
  const bump = (t, c, w) => Math.exp(-(((t - c) / w) ** 2));
  const P = new Float32Array(nA * nR * 3), C = new Float32Array(nA * nR * 3), N = new Float32Array(nA * nR * 3);
  const foot = COLOURS.crops[0], far = groundColour || null;
  let maxY = -Infinity;
  for (let a = 0; a < nA; a++) {
    const th = (a / nA) * Math.PI * 2, ca = Math.cos(th), sa = Math.sin(th), Rout = hillOuterRadius(th);
    const A1 = 14 + 70 * n1(ca * 2.4 + 7, sa * 2.4 + 3) ** 1.5, A2 = 50 + 160 * n2(ca * 3.4 + 5, sa * 3.4 + 17) ** 1.3;
    const c2 = 0.74 + 0.12 * (n1(ca * 1.3 + 40, sa * 1.3 + 40) - 0.5);
    for (let r = 0; r < nR; r++) {
      const t = r / (nR - 1), R = HILLS.r_in + t * (Rout - HILLS.r_in), x = PLANE.cx + R * ca, z = PLANE.cz + R * sa;
      const rise = smooth(0, 0.07, t);
      const y = HILLS.foot_y + rise * (-HILLS.foot_y + A1 * bump(t, 0.3, 0.2) + A2 * bump(t, c2, 0.27) + (det(x / 320, z / 320) - 0.5) * 34 * smooth(0.05, 0.3, t));
      const k = 3 * (a * nR + r);
      P[k] = x; P[k + 1] = y; P[k + 2] = z; maxY = Math.max(maxY, y);
      const forest = smooth(0.4, 0.52, wood(x / 380, z / 380)) * smooth(0.02, 0.1, t);
      let col = foot.map((f, i) => f + (COLOURS.hillForest[i] - f) * forest);
      if (far) { const fk = 0.4 * smooth(0.6, 1, t); col = col.map((v, i) => v + (far[i] - v) * fk); }   // the far ridge: toward the READ grey
      C[k] = col[0]; C[k + 1] = col[1]; C[k + 2] = col[2];
    }
  }
  const at = (a, r) => 3 * (((a + nA) % nA) * nR + Math.min(nR - 1, Math.max(0, r)));
  for (let a = 0; a < nA; a++) for (let r = 0; r < nR; r++) {
    const pa = at(a + 1, r), pb = at(a - 1, r), pc = at(a, r + 1), pd = at(a, r - 1);
    const tx = P[pa] - P[pb], ty = P[pa + 1] - P[pb + 1], tz = P[pa + 2] - P[pb + 2];   // around the ring
    const rx = P[pc] - P[pd], ry = P[pc + 1] - P[pd + 1], rz = P[pc + 2] - P[pd + 2];   // outward
    let nx = rz * ty - ry * tz, ny = rx * tz - rz * tx, nz = ry * tx - rx * ty;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz), k = at(a, r);
    N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l;
  }
  const I = new Uint16Array(nA * (nR - 1) * 6);
  let q = 0;
  for (let a = 0; a < nA; a++) for (let r = 0; r < nR - 1; r++) {
    const i0 = a * nR + r, i1 = ((a + 1) % nA) * nR + r, i2 = i0 + 1, i3 = i1 + 1;
    I[q++] = i0; I[q++] = i1; I[q++] = i2; I[q++] = i1; I[q++] = i3; I[q++] = i2;   // up-facing (checked in the test)
  }
  return { position: P, normal: N, color: C, index: I, triangles: I.length / 3, maxY };
}

// ---------------------------------------------------------------- the grass textures (pure pixels; tiling)
/** the blade texture: size x size RGBA bytes, tiling, linear data (not colour): blades as short strokes leaning mostly along x
 *  over a fine grain. `norm` scales a texel back so the texture's mean is exactly 1 per channel (far off it averages to the
 *  material's base colour) */
export function grassDetailPixels(seed, size) {
  // clumps at three scales (8-30 cm, and 80 cm): what is left of grass once the blades are smaller than a pixel
  const rng = makeRng(seed + 9001), clump = fbm(seed + 9002, 3, 8), tuft = fbm(seed + 9003, 2, 3);
  const v = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, w = y / size, c = clump(u * 8, w * 8), t = tuft(u * 3, w * 3), k = 3 * (y * size + x);
    const g = 0.42 + 1.05 * c + 0.7 * (t - 0.5) + 0.12 * (rng() - 0.5), dryTip = Math.max(0, t - 0.55) * 0.5;
    v[k] = g * (0.97 + dryTip); v[k + 1] = g; v[k + 2] = g * (0.95 - dryTip);
  }
  const blades = Math.round(size * size * 0.075), px = size / GRASS.blade_tile_m;   // texels per metre
  for (let b = 0; b < blades; b++) {
    let x = rng() * size, y = rng() * size;
    const ang = (rng() - 0.5) * 1.6 + (rng() < 0.5 ? 0 : Math.PI), len = (0.012 + 0.03 * rng()) * px, dx = Math.cos(ang), dy = Math.sin(ang);
    const light = rng() < 0.55, k0 = light ? 1.2 + 0.35 * rng() : 0.4 + 0.25 * rng(), tip = light && rng() < 0.3;
    for (let s = 0; s < len; s++) {
      const ix = ((Math.floor(x) % size) + size) % size, iy = ((Math.floor(y) % size) + size) % size, k = 3 * (iy * size + ix), f = s / len;
      const kk = 1 + (k0 - 1) * (0.6 + 0.4 * f);
      v[k] = v[k] * 0.35 + 0.65 * kk * (tip ? 1.12 : 0.96); v[k + 1] = v[k + 1] * 0.35 + 0.65 * kk; v[k + 2] = v[k + 2] * 0.35 + 0.65 * kk * (tip ? 0.78 : 0.94);
      x += dx; y += dy;
    }
  }
  const data = new Uint8ClampedArray(size * size * 4), sum = [0, 0, 0];
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 4; c++) {
    const b = c === 3 ? 255 : Math.round(Math.min(2, Math.max(0, v[3 * i + c])) * 127.5);
    data[4 * i + c] = b; if (c < 3) sum[c] += b / 255;
  }
  return { data, size, norm: sum.map((s) => (size * size) / s) };
}
/** broad variation, tiling, linear data: R lush (darker, greener) against thin and B the wander of the mower's lines, both ~0.5
 *  on average; G the dry patches, a sparse mask (mostly 0) */
export function grassMacroPixels(seed, size) {
  const lush = fbm(seed + 9101, 4, 4), dry = fbm(seed + 9102, 4, 3), wander = fbm(seed + 9103, 3, 6), data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = 4 * (y * size + x), u = x / size, w = y / size;
    data[i] = Math.round(255 * Math.min(1, Math.max(0, (lush(u * 4, w * 4) - 0.5) * 1.9 + 0.5)));
    data[i + 1] = Math.round(255 * smooth(0.5, 0.7, dry(u * 3, w * 3)));
    data[i + 2] = Math.round(255 * wander(u * 6, w * 6)); data[i + 3] = 255;
  }
  return { data, size };
}

// ---------------------------------------------------------------- the budget (pure)
/** what buildScenery will draw at this seed and quality: { drawCalls, triangles, trees, perVariant, hillTriangles } */
export function sceneryBudget(seed, quality) {
  const Q = QUALITY[quality], L = layoutTrees(seed, quality), hills = hillGeometryData(seed, quality);
  let triangles = hills.triangles, drawCalls = 1;
  for (const v of Q.variants) if (L.perVariant[v] > 0) { drawCalls++; triangles += L.perVariant[v] * treeGeometryData(v, quality === 'low' ? 'low' : 'high').triangles; }
  return { drawCalls, triangles, trees: L.count, perVariant: L.perVariant, hillTriangles: hills.triangles };
}

// ---------------------------------------------------------------- three.js
/** opts: { quality: 'high'|'low', seed (integer), anisotropy (the renderer's, >= 1), fog (the scene's THREE.Fog: the scenery's haze
 *  follows it), groundColour ([r, g, b] linear, optional: data/track.json landscape_material.ground_col, the far ridge fades
 *  toward it) }. Returns { group, grassMaterial, budget, dispose() }; nothing in it moves, casts a shadow or needs a per-frame
 *  update. grassMaterial and the scenery's own materials take their haze from opts.fog, not from scene.fog (material.fog = false) */
export function buildScenery(THREE, opts) {
  const o = opts || {};
  if (!QUALITY[o.quality]) throw new Error('scenery: opts.quality must be high or low, not ' + o.quality);
  if (!Number.isInteger(o.seed)) throw new Error('scenery: opts.seed must be an integer');
  if (!(o.anisotropy >= 1)) throw new Error('scenery: opts.anisotropy must be the renderer\'s (>= 1), not ' + o.anisotropy);
  if (!(o.fog && o.fog.isFog)) throw new Error('scenery: opts.fog must be the scene\'s THREE.Fog (the scenery\'s haze follows it)');
  if (o.groundColour !== undefined && !(Array.isArray(o.groundColour) && o.groundColour.length === 3 && o.groundColour.every(Number.isFinite)))
    throw new Error('scenery: opts.groundColour must be [r, g, b]');
  const T = THREE.TSL, Q = QUALITY[o.quality], geoQ = o.quality === 'low' ? 'low' : 'high', owned = [];
  const keep = (x) => { owned.push(x); return x; };
  const group = new THREE.Group(); group.name = 'scenery';
  const L = layoutTrees(o.seed, o.quality);

  // the haze: the scene fog's factor (smoothstep on view depth, as three.js applies THREE.Fog), capped past HAZE.from_m
  const fogCol = T.reference('color', 'color', o.fog), viewZ = T.positionView.z.negate();
  const fogF = T.smoothstep(T.reference('near', 'float', o.fog), T.reference('far', 'float', o.fog), viewZ);
  const haze = T.min(fogF, T.float(HAZE.cap0).add(T.smoothstep(HAZE.from_m, HAZE.to_m, viewZ).mul(HAZE.cap1 - HAZE.cap0)));
  const hazed = (mat, k) => { mat.fog = false; mat.outputNode = T.vec4(T.mix(T.output.rgb, fogCol, k), T.output.a); return mat; };

  // the grass: the blade texture twice (two sizes, two angles) times broad patches; mowing stripes on the verge round the strip;
  // past FIELDS.from_m, a patchwork of crops on the field grid the shelterbelts stand on, with grass margins between fields
  const tex = (px) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = px.size;
    cv.getContext('2d').putImageData(new ImageData(px.data, px.size, px.size), 0, 0);
    const t = keep(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = o.anisotropy;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
    return t;
  };
  const det = grassDetailPixels(o.seed, Q.grassPx), detTex = tex(det), macroTex = tex(grassMacroPixels(o.seed, 256));
  const G = GRASS, F = L.field, p = T.positionWorld.xz, x = T.positionWorld.x, z = T.positionWorld.z;
  const turn = (v, a) => T.vec2(v.x.mul(Math.cos(a)).sub(v.y.mul(Math.sin(a))), v.x.mul(Math.sin(a)).add(v.y.mul(Math.cos(a))));
  const norm = T.vec3(...det.norm);
  const blades = T.texture(detTex, p.div(G.blade_tile_m)).rgb.mul(0.58).add(T.texture(detTex, turn(p, G.blade_turn).div(G.blade_tile2_m)).rgb.mul(0.42)).mul(norm);
  const m1 = T.texture(macroTex, p.div(G.macro_tile_m)), m2 = T.texture(macroTex, turn(p, -0.4).div(G.macro_tile2_m));
  const m3 = T.texture(macroTex, turn(p, 1.1).div(9.3));                                          // mid-scale, ~1.5 m patches
  const lush = m1.r.mul(0.65).add(m2.r.mul(0.35)), dry = m1.g.mul(0.7).add(m2.g.mul(0.3)), mid = T.float(0.84).add(m3.r.mul(0.32));
  const mown = T.float(1).sub(T.smoothstep(G.mown_z_m[0], G.mown_z_m[1], T.abs(z)))
    .mul(T.smoothstep(STRIP_X0 - G.mown_x_pad_m - 60, STRIP_X0 - G.mown_x_pad_m, x)).mul(T.float(1).sub(T.smoothstep(STRIP_X1 + G.mown_x_pad_m, STRIP_X1 + G.mown_x_pad_m + 60, x)));
  const zz = z.add(m1.b.sub(0.5).mul(2 * G.stripe_wave_m));
  const band = T.smoothstep(-0.3, 0.3, T.sin(zz.mul(Math.PI / G.stripe_w_m))).mul(2).sub(1);      // +1 mown toward +x, -1 back
  const toFrag = T.positionWorld.sub(T.cameraPosition), view = T.normalize(toFrag);
  const near = T.float(1).sub(T.smoothstep(G.stripe_fade_m[0], G.stripe_fade_m[1], T.length(toFrag)));
  const stripe = T.float(1).add(band.mul(view.x.mul(G.stripe_amp).add(G.stripe_base)).mul(mown).mul(near));
  const grassCol = T.mix(T.vec3(...COLOURS.grass), T.vec3(...COLOURS.dry), dry.mul(T.float(0.55).sub(mown.mul(0.4)))).mul(T.float(0.8).add(lush.mul(0.4)));
  // the fields: a crop per cell of the grid, by a hash of the cell
  const ca = Math.cos(F.angle), sa = Math.sin(F.angle);
  const u = x.mul(ca).add(z.mul(sa)).sub(F.offU), v = z.mul(ca).sub(x.mul(sa)).sub(F.offV);
  const cu = T.floor(u.div(F.u_m)), cv = T.floor(v.div(F.v_m));
  const h = T.fract(T.sin(cu.mul(12.9898).add(cv.mul(78.233))).mul(43758.5453));
  let crop = T.vec3(...COLOURS.crops[0]);
  COLOURS.crops.forEach((c, i) => { if (i) crop = T.mix(crop, T.vec3(...c), T.step(COLOURS.cropAt[i], h)); });
  const rows = T.texture(detTex, T.vec2(u.div(14), v.div(1.3))).g.mul(det.norm[1]);               // a crop's rows, along the field
  const fu = T.fract(u.div(F.u_m)).mul(F.u_m), fv = T.fract(v.div(F.v_m)).mul(F.v_m);
  const edgeD = T.min(T.min(fu, T.float(F.u_m).sub(fu)), T.min(fv, T.float(F.v_m).sub(fv)));
  const margin = T.float(1).sub(T.smoothstep(FIELDS.margin_m[0], FIELDS.margin_m[1], edgeD));
  const fieldCol = T.mix(crop.mul(T.float(0.7).add(rows.mul(0.3))).mul(T.float(0.82).add(lush.mul(0.36))), grassCol, margin);
  const sx = T.clamp(x, STRIP_X0, STRIP_X1), dStrip = T.length(T.vec2(x.sub(sx), z));
  const inField = T.smoothstep(FIELDS.from_m[0], FIELDS.from_m[1], dStrip);
  const grassMaterial = keep(hazed(new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 }), haze));
  grassMaterial.colorNode = T.mix(grassCol.mul(stripe), fieldCol, inField).mul(blades).mul(mid);
  grassMaterial.roughnessNode = T.float(0.86).add(blades.g.mul(0.08));
  grassMaterial.name = 'scenery-grass';

  // the trees: one InstancedMesh per variant, vertex-coloured, tinted per tree; no shadows (the sun's map covers only the car)
  const treeMat = keep(hazed(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), haze));
  treeMat.name = 'scenery-trees';
  const geo = (d) => {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.computeBoundingSphere();
    return g;
  };
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color();
  const budget = { drawCalls: 0, triangles: 0, trees: L.count, perVariant: { ...L.perVariant } };
  for (const vname of Q.variants) {
    const n = L.perVariant[vname]; if (!n) continue;
    const data = treeGeometryData(vname, geoQ), mesh = new THREE.InstancedMesh(geo(data), treeMat, n), vi = VARIANTS.indexOf(vname);
    let k = 0;
    for (let i = 0; i < L.count; i++) {
      if (L.variant[i] !== vi) continue;
      const hh = L.height[i], w = hh * L.width[i];
      m4.compose(pos.set(L.x[i], L.y[i], L.z[i]), qt.setFromAxisAngle(up, L.yaw[i]), scl.set(w, hh, w));
      mesh.setMatrixAt(k, m4); mesh.setColorAt(k, col.setRGB(L.tint[3 * i], L.tint[3 * i + 1], L.tint[3 * i + 2], THREE.LinearSRGBColorSpace)); k++;
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = 'scenery-' + vname; mesh.matrixAutoUpdate = false;
    mesh.computeBoundingSphere();
    group.add(mesh);
    budget.drawCalls++; budget.triangles += n * data.triangles;
  }

  // the hills: the same haze, a little thinner up their slopes, so the ridges read against the sky
  const H = hillGeometryData(o.seed, o.quality, o.groundColour);
  const hillMat = keep(hazed(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }),
    haze.mul(T.float(1).sub(T.smoothstep(20, 190, T.positionWorld.y).mul(0.2)))));
  hillMat.name = 'scenery-hills';
  const hills = new THREE.Mesh(geo(H), hillMat);
  hills.castShadow = false; hills.receiveShadow = false; hills.frustumCulled = false; hills.name = 'scenery-hills'; hills.matrixAutoUpdate = false;
  group.add(hills);
  budget.drawCalls++; budget.triangles += H.triangles;

  return {
    group, grassMaterial, budget,
    dispose() { for (const x of owned) x.dispose(); owned.length = 0; group.clear(); },
  };
}
