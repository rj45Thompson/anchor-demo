// look.js - this game's own look: the palette, the materials and every procedural mesh the board is drawn with. Nothing here is read
// from another project: every shape is built in code from boxes, cylinders, cones and extruded outlines, and every colour below is
// AUTHORED for this game (a bright, toy-like board with a soft glowing edge in each owner's colour, picked up by the bloom).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- palette (AUTHORED)
// A player's colour is the view's, by slot (the model only knows slots 0..3). Four hues far apart on the wheel and far from the grass
// green, so a wall, a hero and a territory fill read as one owner at a glance.
export const PLAYER_HEX = Object.freeze([0x3aa8ff, 0xff6a4d, 0xb072ff, 0xffc233]);
export const PLAYER_CSS = Object.freeze(['#3aa8ff', '#ff6a4d', '#b072ff', '#ffc233']);
export const PLAYER_COLOURS = PLAYER_HEX.map((h) => new THREE.Color(h));
export const NEUTRAL_WALL = new THREE.Color(0xe9e4d6);        // a wall no player owns (a map's own wall)
export const ENEMY_SHOT = new THREE.Color(0xff8a2a);

export const C = Object.freeze({
  sand: new THREE.Color(0xf2dca2), wetSand: new THREE.Color(0xd8bd7f), grass: new THREE.Color(0x7ccb5c), grassDark: new THREE.Color(0x5daf48),
  grassLight: new THREE.Color(0x9bdb6a), swamp: new THREE.Color(0x6f7d3c), seaBed: new THREE.Color(0x2a6d8a),
  shallow: new THREE.Color(0x46d6cf), deep: new THREE.Color(0x1b62b0), foam: new THREE.Color(0xffffff),
  stone: new THREE.Color(0xd9d2c3), stoneDark: new THREE.Color(0xa69d8c), roof: new THREE.Color(0x4a5a78), wood: new THREE.Color(0x9a6640),
  woodDark: new THREE.Color(0x6e4529), sail: new THREE.Color(0xfbf6ea), sailDark: new THREE.Color(0x9a9da6), iron: new THREE.Color(0x3b4048),
  leaf: new THREE.Color(0x3f9c4a), leafLight: new THREE.Color(0x63b955), rock: new THREE.Color(0x9a9a9e), rockDark: new THREE.Color(0x76767c),
  houseWall: new THREE.Color(0xf4ead2), houseRoof: new THREE.Color(0xc4553f), pit: new THREE.Color(0x2b1d17), ember: new THREE.Color(0xff6a1a),
  rubble: new THREE.Color(0xb3aa98), grave: new THREE.Color(0xbfc3c9), skin: new THREE.Color(0xf0c9a0), enemy: new THREE.Color(0x3d3f4c),
  enemyHelm: new THREE.Color(0xe6e0cf), banner: new THREE.Color(0x24262e),
});

// ---------------------------------------------------------------- materials
// Flat-shaded standard materials: the low-poly facets catch the light. One shared material per role; per-object tints use vertex
// colours (merged props) or instance colours (walls), so the draw-call count stays small.
export const mats = {
  vc: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, flatShading: true }),
  wall: new THREE.MeshStandardNodeMaterial({ roughness: 0.42, metalness: 0, flatShading: true }),
};
/** A glowing colour: values above 1 so the bloom picks it up (k = how hot). */
export const glow = (color, k) => new THREE.MeshBasicNodeMaterial({ color: color.clone().multiplyScalar(k) });
/** A see-through material whose opacity an effect animates. */
export const fade = (color, opacity, k = 1) => new THREE.MeshBasicNodeMaterial({ color: color.clone().multiplyScalar(k), transparent: true, opacity, depthWrite: false });

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
export function rubbleGeometry() {
  return merge([
    at(box(0.26, 0.12, 0.22, C.rubble), -0.16, 0.06, -0.1, 0, 0.4),
    at(box(0.2, 0.1, 0.18, C.stoneDark), 0.15, 0.05, 0.12, 0, -0.5),
    at(box(0.16, 0.08, 0.14, C.rubble), 0.12, 0.04, -0.18, 0, 0.9),
    at(box(0.14, 0.07, 0.16, C.stoneDark), -0.1, 0.035, 0.2, 0, 0.2),
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
