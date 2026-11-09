// look.js - this game's own look: the palette, the materials and every procedural mesh the board is drawn with. Nothing here is read
// from another project: every shape is built in code from boxes, cylinders, cones and extruded outlines, and every colour below is
// AUTHORED for this game (a bright, toy-like board with a soft glowing edge in each owner's colour, picked up by the bloom).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mrt, diffuseColor } from 'three/tsl';

// ---------------------------------------------------------------- palette (AUTHORED)
// A player's colour is the view's, by slot (the model only knows slots 0..3). Four hues far apart on the wheel and far from the grass
// green, so a wall, a hero and a territory fill read as one owner at a glance. Round 3 (tools/colour_check.py): round 2's sky blue
// and violet were 5.9 delta E apart for a deuteranope (one colour) and the blue 21 from the sea; the yellow was pale on sand. Now a
// deeper blue, an orchid purple, a full gold: every pair at least 35.8 apart in normal, protan, deutan and tritan vision, every
// colour at least 54 from grass, sand and sea.
export const PLAYER_HEX = Object.freeze([0x1957ff, 0xff5e4d, 0xcc52c2, 0xffcc00]);
export const PLAYER_CSS = Object.freeze(['#1957ff', '#ff5e4d', '#cc52c2', '#ffcc00']);
export const PLAYER_COLOURS = PLAYER_HEX.map((h) => new THREE.Color(h));
// HUD text (round 4, HUDTEXT): P1's deeper blue read 2.9:1 as text on the navy card. A player's colour as TEXT on a dark panel is
// its lighter tint below (PLAYER_TEXT_CSS: the colour mixed toward white, AUTHORED t = 0.44, 0.16, 0.30, 0), and text drawn ON a
// player-colour fill (the hero tag, a joined seat card) is the ink that reads on that fill (PLAYER_INK_CSS: white on the blue,
// navy on the other three). HUD_PANEL_CSS is the card and foot panel. tools/colour_check.py reads all three from this file and
// fails under WCAG 4.5:1 for any player label, the panel taken over a WHITE backdrop (the brightest the scene can put behind it).
export const PLAYER_TEXT_CSS = Object.freeze(['#7ea1ff', '#ff7869', '#db86d4', '#ffcc00']);
export const PLAYER_INK_CSS = Object.freeze(['#ffffff', '#0a1828', '#0a1828', '#0a1828']);
export const HUD_PANEL_CSS = 'rgba(10,26,44,0.9)';
export const NEUTRAL_WALL = new THREE.Color(0xe9e4d6);        // a wall no player owns (a map's own wall)
export const ENEMY_SHOT = new THREE.Color(0xff8a2a);

export const C = Object.freeze({
  sand: new THREE.Color(0xf2dca2), wetSand: new THREE.Color(0xd8bd7f), grass: new THREE.Color(0x7ccb5c), grassDark: new THREE.Color(0x5daf48),
  grassLight: new THREE.Color(0x9bdb6a), grassRoot: new THREE.Color(0x5aa944), grassTip: new THREE.Color(0xd2f08e),
  grassDry: new THREE.Color(0xb9d66a), grassDeep: new THREE.Color(0x3f9a4c), swamp: new THREE.Color(0x6f7d3c), seaBed: new THREE.Color(0x2a6d8a),
  shallow: new THREE.Color(0x3fd0d2), deep: new THREE.Color(0x1552a6), lagoon: new THREE.Color(0x8fe8d6), midSea: new THREE.Color(0x1e92c8), foam: new THREE.Color(0xffffff),
  stone: new THREE.Color(0xd9d2c3), stoneDark: new THREE.Color(0xa69d8c), roof: new THREE.Color(0x4a5a78), wood: new THREE.Color(0x9a6640),
  woodDark: new THREE.Color(0x6e4529), sail: new THREE.Color(0xfbf6ea), sailDark: new THREE.Color(0x9a9da6), iron: new THREE.Color(0x3b4048),
  leaf: new THREE.Color(0x3f9c4a), leafLight: new THREE.Color(0x63b955), rock: new THREE.Color(0x9a9a9e), rockDark: new THREE.Color(0x76767c),
  houseWall: new THREE.Color(0xf4ead2), houseRoof: new THREE.Color(0xc4553f), pit: new THREE.Color(0x2b1d17), ember: new THREE.Color(0xff6a1a),
  rubble: new THREE.Color(0xb3aa98), grave: new THREE.Color(0xbfc3c9), skin: new THREE.Color(0xf0c9a0), enemy: new THREE.Color(0x3d3f4c),
  enemyHelm: new THREE.Color(0xe6e0cf), banner: new THREE.Color(0x24262e),
});

// ---------------------------------------------------------------- light (AUTHORED)
// A warm low sun from the south-west (long shadows to the north-east read as 3D from the south-facing camera) and a cool sky fill
// that keeps the shadow side blue rather than black. Elevation in degrees above the horizon, azimuth from +x toward +z. The sea
// reflects the same sky (SKY.zenith, SKY.horizon) and glints toward the same sun.
export const SUN = Object.freeze({ color: 0xffe6c4, intensity: 3.1, elevation: 40, azimuth: 128 });
export const SKY = Object.freeze({ sky: 0xcfe8ff, ground: 0x6f8f5f, intensity: 0.95, zenith: new THREE.Color(0x5fa8ff), horizon: new THREE.Color(0xe4f4ff) });
/** The unit vector toward the sun (world space). */
export function sunDirection() {
  const el = THREE.MathUtils.degToRad(SUN.elevation), az = THREE.MathUtils.degToRad(SUN.azimuth);
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

// ---------------------------------------------------------------- materials
// Flat-shaded standard materials: the low-poly facets catch the light. One shared material per role; per-object tints use vertex
// colours (merged props) or instance colours (walls), so the draw-call count stays small.
export const mats = {
  vc: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, flatShading: true }),
};
/** Mark a material as one that GLOWS: its colour (with instance colours and opacity) is also written to the scene pass's `emissive`
 *  target, which is the ONLY thing the bloom reads (renderer.js). Everything lit by the sun writes black there, so a sunlit white
 *  wall never blooms; only what a material says glows does. */
export function glowing(mat) { mat.mrtNode = mrt({ emissive: diffuseColor }); return mat; }
/** A glowing colour: values above 1 (k = how hot), and written to the bloom's target. */
export const glow = (color, k) => glowing(new THREE.MeshBasicNodeMaterial({ color: color.clone().multiplyScalar(k) }));
/** A see-through material whose opacity an effect animates (it glows when k > 1). */
export const fade = (color, opacity, k = 1) => {
  const m = new THREE.MeshBasicNodeMaterial({ color: color.clone().multiplyScalar(k), transparent: true, opacity, depthWrite: false });
  return k > 1 ? glowing(m) : m;
};

// ---------------------------------------------------------------- geometry helpers
/** Paint every vertex of a geometry one colour (the merged props carry their colours this way). */
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const at = (geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return geo.applyMatrix4(m);
};
/** Merge painted parts into one geometry; a merge that fails is an error, never a partial mesh. */
function merge(parts, what) {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('look.js: the parts of "' + what + '" would not merge (attribute sets differ)');
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d, c) => paint(new THREE.BoxGeometry(w, h, d), c);
const cyl = (rt, rb, h, seg, c) => paint(new THREE.CylinderGeometry(rt, rb, h, seg), c);
const cone = (r, h, seg, c) => paint(new THREE.ConeGeometry(r, h, seg), c);
const ico = (r, detail, c) => paint(new THREE.IcosahedronGeometry(r, detail), c);

// ---------------------------------------------------------------- the board's props (unit = one square; y = 0 is the ground)
export function pitGeometry() {
  return merge([
    at(cyl(0.4, 0.42, 0.04, 10, C.rockDark), 0, 0.02, 0),
    at(cyl(0.3, 0.3, 0.05, 10, C.pit), 0, 0.03, 0),
  ], 'pit');
}
/** A broken wall block's rubble (graphics round 3: "wall rubble chunks that stay until rebuilt"): a heap of tumbled bricks the
 *  wall's own size and shades, two of them tipped up on end, a broken coping stone (white: board.js tints it with the owner's
 *  colour) and stone chips round the heap. It stands until the rules clear the square. All sizes AUTHORED. */
export function rubbleGeometry() {
  const st = C.stone, dk = C.stoneDark, white = new THREE.Color(0.95, 0.95, 0.95);
  return merge([
    at(box(0.34, 0.14, 0.2, st), -0.14, 0.07, -0.12, 0, 0.4),
    at(box(0.3, 0.13, 0.18, dk), 0.16, 0.065, 0.1, 0, -0.5),
    at(box(0.26, 0.12, 0.17, st.clone().multiplyScalar(0.9)), 0.02, 0.19, -0.02, 0.2, 1.2, 0.15),   // one on top of the heap
    at(box(0.18, 0.28, 0.14, dk), -0.24, 0.13, 0.18, 0.25, 0.3, -0.35),                            // tipped up on end
    at(box(0.15, 0.24, 0.13, st), 0.27, 0.11, -0.2, -0.3, 0.8, 0.3),
    at(box(0.3, 0.08, 0.22, white), 0.05, 0.05, 0.27, 0.12, -0.25, 0.08),                          // the broken coping stone
    at(box(0.08, 0.05, 0.07, dk), -0.36, 0.025, -0.3, 0, 0.6), at(box(0.07, 0.04, 0.06, st), 0.38, 0.02, 0.32, 0, 1.1),
    at(box(0.06, 0.04, 0.08, dk), 0.36, 0.02, -0.36, 0, 0.2), at(box(0.07, 0.05, 0.05, st), -0.32, 0.025, 0.37, 0, 2.0),
  ], 'rubble');
}
export function graveGeometry() {
  return merge([
    at(box(0.16, 0.24, 0.05, C.grave), -0.18, 0.12, 0),
    at(box(0.16, 0.2, 0.05, C.grave), 0.16, 0.1, 0.1, 0, 0.2),
    at(box(0.3, 0.03, 0.4, C.woodDark), 0, 0.015, 0),
  ], 'graveyard');
}
export function flagGeometry() {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.42, -0.09); s.lineTo(0, -0.2); s.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(s); g.translate(0.02, 0, 0);
  return g;
}
export function hammerGeometry() {
  return merge([at(cyl(0.02, 0.02, 0.36, 5, C.wood), 0, 0.18, 0), at(box(0.18, 0.09, 0.09, C.iron), 0, 0.36, 0)], 'hammer');
}
export function torchGeometry() {
  return merge([at(cyl(0.02, 0.025, 0.34, 5, C.wood), 0, 0.17, 0)], 'linstock');
}

/** A wall block's stone body (graphics round 2: "walls look like plain plastic tiles"): two courses of bevelled bricks laid in an
 *  alternating bond (the lower course runs north-south, the upper east-west, so each face shows a long brick over two short ones or
 *  the other way round), over a darker mortar core that shows in the joints. Each brick has its own shade (vertex colour); the whole
 *  block is tinted per instance (board.js: the owner's colour, a little, and a per-block variation). The owner-colour cap sits on top
 *  (wallCapGeometry). Footprint w x w, height h - cap; y = 0 is the ground. All sizes AUTHORED. */
export const WALL_CAP_H = 0.11;
export function wallStoneGeometry(w, h) {
  const body = h - WALL_CAP_H, course = body / 2, gap = 0.016, r = 0.026, bw = w - 0.02;
  const shades = [1.0, 0.9, 0.96, 0.86, 0.93].map((k) => C.stone.clone().multiplyScalar(k));
  const brick = (sx, sy, sz, c) => paint(new RoundedBoxGeometry(sx, sy, sz, 1, r), c);
  const half = (bw - gap) / 2, o = (half + gap) / 2;
  return merge([
    at(box(w - 0.07, body + WALL_CAP_H * 0.6, w - 0.07, C.stoneDark.clone().multiplyScalar(0.62)), 0, (body + WALL_CAP_H * 0.6) / 2, 0),   // the mortar core
    at(brick(half, course - gap, bw, shades[0]), -o, course / 2, 0), at(brick(half, course - gap, bw, shades[1]), o, course / 2, 0),
    at(brick(bw, course - gap, half, shades[2]), 0, course * 1.5, -o), at(brick(bw, course - gap, half, shades[3]), 0, course * 1.5, o),
  ], 'wall stone');
}
/** The cap on a wall block: two bevelled coping stones side by side with a dark groove between (the mortar core shows through),
 *  white (the instance colour is the owner's colour). From the near top-down REPAIR camera the caps ARE the wall, so the groove and
 *  the bevels are what make a run of blocks read as laid stones rather than one smooth tile; the per-block quarter turn (board.js)
 *  lays the grooves both ways. */
export function wallCapGeometry(w, h) {
  const gap = 0.024, half = (w - gap) / 2, o = (half + gap) / 2, y = h - WALL_CAP_H / 2, white = new THREE.Color(1, 1, 1);
  return merge([
    at(paint(new RoundedBoxGeometry(half, WALL_CAP_H, w, 1, 0.032), white), -o, y, 0),
    at(paint(new RoundedBoxGeometry(half, WALL_CAP_H, w, 1, 0.032), white.clone().multiplyScalar(0.93)), o, y, 0),
  ], 'wall cap');
}

/** A grass tuft: seven thin blades leaning out from one root, dark at the root and light at the tip (vertex colours), about a fifth of
 *  a square tall. y = 0 is the ground; the blades' height is TUFT_H (the sway in board.js bends them more toward the tip). */
export const TUFT_H = 0.24;
export function tuftGeometry() {
  const blades = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39996, lean = 0.3 + (i % 2) * 0.16, h = TUFT_H * (0.75 + ((i * 37) % 10) / 40);
    const g = new THREE.ConeGeometry(0.034, h, 3, 1).toNonIndexed(); g.translate(0, h / 2, 0);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      c.copy(C.grassRoot).lerp(C.grassTip, THREE.MathUtils.clamp(pos.getY(v) / h, 0, 1));
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
    blades.push(at(g, Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03, Math.sin(a) * lean, 0, -Math.cos(a) * lean));
  }
  return merge(blades, 'grass tuft');
}

// ---------------------------------------------------------------- deterministic noise for the land's relief and colour
/** Value noise on a lattice, hashed from integer coordinates and a seed: the same board always draws the same island. */
export function makeNoise(seed) {
  const h = (x, y) => {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const s = (t) => t * t * (3 - 2 * t);
  const v = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => v(x, y) * 0.6 + v(x * 2.1 + 17.3, y * 2.1 - 4.1) * 0.3 + v(x * 4.3 - 9.7, y * 4.3 + 2.9) * 0.1;
}

// ---------------------------------------------------------------- the noise texture the land and sea shaders sample
/** A tiling noise texture made in code once at start (no file): R = smooth fractal noise, G and B = its slope along x and y (0.5 =
 *  flat; the sea's waves are lit from these, so no shader works out a noise's slope itself), A = a second, finer noise. Sampling it
 *  costs the GPU a texture read where the shaders first evaluated 3D Perlin noise ten times per pixel of sea (11-09: twice the
 *  baseline's frame time at 3840 x 2160). NOISE_SLOPE: G and B hold slope / NOISE_SLOPE + 0.5. */
export const NOISE_SIZE = 256, NOISE_SLOPE = 24;
export function makeNoiseTexture() {
  const N = NOISE_SIZE;
  const lattice = (period, seed) => {                          // value noise on a period x period lattice that wraps, smoothstep blend
    const v = new Float32Array(period * period);
    let x = seed | 0;
    for (let i = 0; i < v.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) | 0; v[i] = (x >>> 8) / 16777216; }
    const s = (t) => t * t * (3 - 2 * t);
    return (u, w) => {                                          // u, w in 0..1 over the tile
      const fx = u * period, fy = w * period, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = s(fx - x0), ty = s(fy - y0);
      const a = v[(y0 % period) * period + (x0 % period)], b = v[(y0 % period) * period + ((x0 + 1) % period)];
      const c = v[((y0 + 1) % period) * period + (x0 % period)], d = v[((y0 + 1) % period) * period + ((x0 + 1) % period)];
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
  };
  const o1 = lattice(8, 11), o2 = lattice(16, 23), o3 = lattice(32, 37), f1 = lattice(32, 51), f2 = lattice(64, 67);
  const field = new Float32Array(N * N), fine = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, w = y / N;
    field[y * N + x] = o1(u, w) * 0.55 + o2(u, w) * 0.3 + o3(u, w) * 0.15;
    fine[y * N + x] = f1(u, w) * 0.6 + f2(u, w) * 0.4;
  }
  const data = new Uint8Array(N * N * 4), at = (x, y) => field[((y + N) % N) * N + ((x + N) % N)];
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, dx = (at(x + 1, y) - at(x - 1, y)) / 2 * N, dy = (at(x, y + 1) - at(x, y - 1)) / 2 * N;   // per tile
    data[i] = byte(field[y * N + x]); data[i + 1] = byte(dx / NOISE_SLOPE + 0.5); data[i + 2] = byte(dy / NOISE_SLOPE + 0.5); data[i + 3] = byte(fine[y * N + x]);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- instanced batches under the uniform-buffer limit
// three r175 (InstanceNode.setup, build/three.webgpu.js:13829) binds an InstancedMesh's WHOLE matrix array as a uniform buffer when
// the mesh's count is <= 1000 when its shader is first built, and WebGPU caps a uniform binding at 65536 bytes (1024 matrices). A
// mesh made with room for 1664 squares and drawn first with count 0 bound 106496 bytes and drew NOTHING (a black frame, a WebGPU
// validation warning each frame). So no InstancedMesh here ever has room for more than CHUNK instances: a big set is several meshes.
export const CHUNK = 1000;
export class InstancedBatch {
  /** Meshes are added a CHUNK at a time as instances are set, up to `capacity`. colors: each instance has its own colour. */
  constructor(parent, geo, mat, capacity, { colors = false, castShadow = false, receiveShadow = false, name = 'batch', renderOrder = 0 } = {}) {
    this.parent = parent; this.geo = geo; this.mat = mat; this.capacity = capacity;
    this.o = { colors, castShadow, receiveShadow, name, renderOrder };
    this.meshes = []; this.n = 0;
  }
  chunk(c) {
    while (this.meshes.length <= c) {
      const im = new THREE.InstancedMesh(this.geo, this.mat, CHUNK), o = this.o;
      if (o.colors) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CHUNK * 3), 3);
      im.count = 0; im.castShadow = o.castShadow; im.receiveShadow = o.receiveShadow; im.renderOrder = o.renderOrder;
      im.name = o.name + ' ' + this.meshes.length;
      im.frustumCulled = false;                                    // instances spread over the whole board; the mesh's own bounds do not
      this.parent.add(im); this.meshes.push(im);
    }
    return this.meshes[c];
  }
  set(i, matrix, color) {
    if (i >= this.capacity) throw new RangeError(this.o.name + ': instance ' + i + ' past its capacity ' + this.capacity);
    const im = this.chunk(Math.floor(i / CHUNK)), k = i % CHUNK;
    im.setMatrixAt(k, matrix);
    if (color) im.setColorAt(k, color);
  }
  /** Draw the first n instances. */
  commit(n) {
    this.n = n;
    this.meshes.forEach((im, c) => {
      im.count = Math.max(0, Math.min(CHUNK, n - c * CHUNK));
      im.visible = im.count > 0;                                   // r175 draws instance 0 of a count-0 mesh (a stray block at the origin)
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }
  setMaterial(m) { this.mat = m; for (const im of this.meshes) im.material = m; }
}

/** A model of several parts (one per material) drawn as plain meshes that share the parts' geometry and material, one mesh per part
 *  per square, made as they are first needed and hidden when not. NOT instanced, on purpose: three r175 builds the shader of an
 *  InstancedMesh whose count is over 1 per MESH (its cache key takes the mesh's uuid, build/three.webgpu.js RenderObject
 *  getMaterialCacheKey), so every level's new batches of the 13 prop parts were built again (11-08: a 2 s stall in the first second
 *  of play, where the original procedural props stalled 0.5 s). Plain meshes share one build per part, made by the renderer's
 *  warm-up while the page loads. A map holds a few dozen props at most (app/maps.js: up to four woods of seven trees, a few rocks
 *  and houses), so the draw calls stay in the low hundreds. The same set(i, matrix) / commit(n) as InstancedBatch. */
export class PropSet {
  constructor(parent, parts, capacity, { castShadow = false, receiveShadow = false, name = 'props' } = {}) {
    if (!parts.length) throw new Error('PropSet "' + name + '": no parts');
    this.parent = parent; this.parts = parts; this.capacity = capacity; this.o = { castShadow, receiveShadow, name };
    this.meshes = [];                                            // meshes[i] = the parts of the i-th prop
  }
  set(i, matrix) {
    if (i >= this.capacity) throw new RangeError(this.o.name + ': prop ' + i + ' past its capacity ' + this.capacity);
    while (this.meshes.length <= i) {
      const group = this.parts.map((p) => {
        const m = new THREE.Mesh(p.geometry, p.material);
        m.castShadow = this.o.castShadow; m.receiveShadow = this.o.receiveShadow; m.matrixAutoUpdate = false; m.name = this.o.name;
        this.parent.add(m); return m;
      });
      this.meshes.push(group);
    }
    for (const m of this.meshes[i]) { m.matrix.copy(matrix); m.matrixWorldNeedsUpdate = true; }
  }
  commit(n) { this.meshes.forEach((group, i) => { for (const m of group) m.visible = i < n; }); }
}
