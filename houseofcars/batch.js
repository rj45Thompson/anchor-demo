// batch.js - static batching (graphics pass 11-08): a car model is drawn with one draw call per distinct material instead of one
// per mesh. Why, MEASURED 11-08 on RJ's PC (RTX 2080, Chrome 156 headless, WebGPU, the lot at 2560 x 1250 px, test harness
// D:/_houseofcars/GFX_REPORT.md): the lot drew 1,224 draw calls a frame for 20.6 ms of the page's JavaScript and 3.8 ms of GPU
// time. The frame is the CPU's cost of each draw in three's WebGPU renderer (about 20 us) times the draws, and the lot draws
// every car three times (the view, the pedestal tops' reflection, the key light's shadow map). The 2014 Rolls-Royce Ghost alone
// was 169 meshes over 22 materials: 557 draws a frame; the Wraith 66 meshes, the i8 59.
//
// Merging changes no pixel: each merged mesh is the same triangles in the model's own frame, drawn with a material that is
// identical in every property to each part's (materialKey), with the same shadow flags, render order and layers.
// Not merged, and why:
//  - a transparent material's meshes: three sorts transparent objects back to front every frame; one merged object would draw its
//    panes in one fixed order, and as the car turns on its turntable a far pane drawn after a near one fails the depth test
//  - skinned, morphed, instanced or batched meshes, multi-material meshes, geometry with a draw range: not one plain range
//  - hidden meshes (a part Unreal spawned hidden stays hidden), and every mesh under opts.keep (a car's wheels on the strip turn
//    on their own pivots)
//  - a group of one mesh: nothing to save
//
// Pure parts (no three; test/batch.test.mjs runs them in node): materialKey, mergeParts, toFloats. batchStatic(THREE, root, opts) wraps
// them in three.js objects.

// ---------------------------------------------------------------- materials (pure)
const SKIP_KEYS = new Set(['uuid', 'name', 'id', 'version', '_listeners', 'userData']);   // identity and bookkeeping, not looks
function stableJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJSON).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableJSON(v[k])).join(',') + '}';
}
const UNIQUE = Symbol('unique');
function valueKey(v) {
  if (v === null || v === undefined) return String(v);
  const t = typeof v;
  if (t === 'number') return Object.is(v, -0) ? '0' : String(v);
  if (t === 'string') return JSON.stringify(v);
  if (t === 'boolean' || t === 'bigint') return String(v);
  if (t === 'function' || t === 'symbol') return UNIQUE;               // a hook of its own: only the same material object merges
  if (v.isColor) return 'c(' + v.r + ',' + v.g + ',' + v.b + ')';
  if (v.isVector2 || v.isVector3 || v.isVector4 || v.isEuler || v.isQuaternion) return 'v(' + v.toArray().join(',') + ')';
  if (v.isMatrix3 || v.isMatrix4) return 'm(' + Array.from(v.elements).join(',') + ')';
  if (v.isTexture) return 'tex:' + v.uuid;                             // by identity: GLTFLoader shares one Texture per image + sampler
  if (v.isNode) return 'node:' + v.uuid;                               // a node graph by identity: the same object builds the same shader
  if (v.isPlane) return 'p(' + v.normal.toArray().join(',') + ',' + v.constant + ')';
  if (Array.isArray(v)) { const ks = v.map(valueKey); return ks.includes(UNIQUE) ? UNIQUE : '[' + ks.join(';') + ']'; }
  if (Object.getPrototypeOf(v) === Object.prototype) return stableJSON(v);   // e.g. defines
  return v.uuid ? 'obj:' + v.uuid : UNIQUE;                             // anything else is compared by identity
}
/** a string that is equal for two materials exactly when they draw the same: every own property but the name and the
 *  bookkeeping; textures, and a node material's nodes (colorNode, ...), by identity, so two node materials are equal only when
 *  they share every node or have none (the strip's plain coloured parts) */
export function materialKey(m) {
  const parts = [m.type];
  for (const k of Object.keys(m).sort()) {
    if (SKIP_KEYS.has(k)) continue;
    const vk = valueKey(m[k]);
    if (vk === UNIQUE) return 'uniq:' + m.uuid;
    parts.push(k + '=' + vk);
  }
  parts.push('userData=' + stableJSON(m.userData || {}));
  return parts.join(';');
}

// ---------------------------------------------------------------- geometry (pure)
// A 4 x 4 matrix is three's: 16 numbers, column-major.
function normalMatrixOf(e) {                                           // the inverse transpose of the upper 3 x 3
  // the 3 x 3 row-major: [[m00 m01 m02] [m10 m11 m12] [m20 m21 m22]] (column-major e: row r, column c is e[4c + r])
  const m00 = e[0], m10 = e[1], m20 = e[2], m01 = e[4], m11 = e[5], m21 = e[6], m02 = e[8], m12 = e[9], m22 = e[10];
  const c00 = m11 * m22 - m12 * m21, c01 = -(m10 * m22 - m12 * m20), c02 = m10 * m21 - m11 * m20;   // its cofactors
  const c10 = -(m01 * m22 - m02 * m21), c11 = m00 * m22 - m02 * m20, c12 = -(m00 * m21 - m01 * m20);
  const c20 = m01 * m12 - m02 * m11, c21 = -(m00 * m12 - m02 * m10), c22 = m00 * m11 - m01 * m10;
  const det = m00 * c00 + m01 * c01 + m02 * c02;
  if (!det) throw new Error('batch.js: a part\'s matrix is singular (scale 0): it cannot be merged');
  const s = 1 / det;                                                   // (M^-1)^T = cofactors / det, row-major
  return { det, n: [c00 * s, c01 * s, c02 * s, c10 * s, c11 * s, c12 * s, c20 * s, c21 * s, c22 * s] };
}
/** merges parts into one geometry's arrays.
 *  parts: [{ attrs: { name: { array: Float32Array, itemSize } }, index: Uint16Array|Uint32Array|null, matrix: 16 numbers }];
 *  every part has the same attribute names and item sizes (the caller groups them so). position is moved by the matrix, normal by
 *  its normal matrix, tangent's xyz by the matrix's 3 x 3 (and w flipped where the matrix mirrors); the rest are copied. A part
 *  with a mirroring matrix has its triangles' winding reversed, so its front faces stay front faces once the mirror is baked in.
 *  Returns { attrs: { name: { array: Float32Array, itemSize } }, index: Uint16Array (Uint32Array past 65,535 vertices),
 *  vertices, triangles } */
export function mergeParts(parts) {
  if (!parts.length) throw new Error('batch.js: nothing to merge');
  const names = Object.keys(parts[0].attrs).sort();
  if (!names.includes('position')) throw new Error('batch.js: a part has no position');
  const sig = (p) => Object.keys(p.attrs).sort().map((k) => k + p.attrs[k].itemSize).join(',');
  for (const p of parts) if (sig(p) !== sig(parts[0])) throw new Error('batch.js: parts with different attributes (' + sig(p) + ' / ' + sig(parts[0]) + ')');
  let nv = 0, ni = 0;
  for (const p of parts) {
    const c = p.attrs.position.array.length / 3;
    p._count = c; nv += c; ni += p.index ? p.index.length : c;
  }
  const out = {};
  for (const k of names) out[k] = { array: new Float32Array(nv * parts[0].attrs[k].itemSize), itemSize: parts[0].attrs[k].itemSize };
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vb = 0, ib = 0;
  for (const p of parts) {
    const e = p.matrix, { det, n } = normalMatrixOf(e), flip = det < 0;
    for (const k of names) {
      const src = p.attrs[k].array, sz = p.attrs[k].itemSize, dst = out[k].array, o = vb * sz;
      if (k === 'position') {
        for (let v = 0; v < p._count; v++) {
          const x = src[3 * v], y = src[3 * v + 1], z = src[3 * v + 2];
          dst[o + 3 * v] = e[0] * x + e[4] * y + e[8] * z + e[12];
          dst[o + 3 * v + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          dst[o + 3 * v + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        }
      } else if (k === 'normal' || (k === 'tangent' && sz === 4)) {
        const tan = k === 'tangent';
        for (let v = 0; v < p._count; v++) {
          const x = src[sz * v], y = src[sz * v + 1], z = src[sz * v + 2];
          let X, Y, Z;
          if (tan) { X = e[0] * x + e[4] * y + e[8] * z; Y = e[1] * x + e[5] * y + e[9] * z; Z = e[2] * x + e[6] * y + e[10] * z; }
          else { X = n[0] * x + n[1] * y + n[2] * z; Y = n[3] * x + n[4] * y + n[5] * z; Z = n[6] * x + n[7] * y + n[8] * z; }
          const l = Math.hypot(X, Y, Z) || 1;
          dst[o + sz * v] = X / l; dst[o + sz * v + 1] = Y / l; dst[o + sz * v + 2] = Z / l;
          if (tan) dst[o + sz * v + 3] = flip ? -src[sz * v + 3] : src[sz * v + 3];
        }
      } else dst.set(src, o);
    }
    const idx = p.index;
    const m = idx ? idx.length : p._count;
    if (m % 3) throw new Error('batch.js: a part\'s index is not whole triangles (' + m + ')');
    for (let t = 0; t < m; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      index[ib + t] = vb + a;
      index[ib + t + 1] = vb + (flip ? c : b);
      index[ib + t + 2] = vb + (flip ? b : c);
    }
    vb += p._count; ib += m;
    delete p._count;
  }
  return { attrs: out, index, vertices: nv, triangles: ni / 3 };
}

// ---------------------------------------------------------------- three.js
/** why a mesh cannot be merged, or null when it can */
function notBatchable(THREE, o) {
  if (o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh) return 'instanced, skinned or batched';
  if (Array.isArray(o.material)) return 'several materials';
  const g = o.geometry;
  if (!g || !g.attributes.position) return 'no positions';
  // geometry groups need no check: with one material three draws the whole index and ignores them (three's built-in box,
  // cylinder and cone geometries all carry groups), and the merged geometry has none
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return 'morph targets';
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return 'a draw range';
  if (o.material.transparent) return 'transparent: sorted per object';
  if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || o.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return 'a render hook';
  return null;
}
// three's denormalize (three.core.js r175): a normalized integer component as the float the GPU reads
const NORM = new Map([[Uint32Array, [4294967295, false]], [Uint16Array, [65535, false]], [Uint8Array, [255, false]],
  [Int32Array, [2147483647, true]], [Int16Array, [32767, true]], [Int8Array, [127, true]]]);
/** an attribute's components as floats, the values three's getX/getY/getZ/getW return: { array (any typed array), itemSize,
 *  normalized, stride (elements per vertex in array; itemSize when not interleaved), offset (first element), count } */
export function toFloats(a) {
  const { array, itemSize: sz, stride, offset, count } = a, out = new Float32Array(count * sz);
  if (!a.normalized || array instanceof Float32Array || array instanceof Float64Array) {
    for (let i = 0; i < count; i++) for (let c = 0; c < sz; c++) out[i * sz + c] = array[i * stride + offset + c];
    return out;
  }
  const n = NORM.get(array.constructor);
  if (!n) throw new Error('batch.js: a normalized attribute of ' + array.constructor.name + ' has no rule');
  const [d, signed] = n;
  for (let i = 0; i < count; i++) for (let c = 0; c < sz; c++) { const v = array[i * stride + offset + c] / d; out[i * sz + c] = signed ? Math.max(v, -1) : v; }
  return out;
}
const floatAttr = (a) => toFloats(a.isInterleavedBufferAttribute
  ? { array: a.data.array, itemSize: a.itemSize, normalized: a.normalized, stride: a.data.stride, offset: a.offset, count: a.count }
  : { array: a.array, itemSize: a.itemSize, normalized: a.normalized, stride: a.itemSize, offset: 0, count: a.count });
/** merges root's static meshes that draw alike into one mesh each, added to root at its own frame (identity); the merged meshes
 *  leave their parents, and parents left empty go too. A merged mesh draws with the first of its group's (identical) materials,
 *  so a caller that changes a material or a mesh later (swaps it, wets it, moves it) keeps those meshes out: opts.keep, objects
 *  whose subtrees stay as they are. Returns { meshes (drawn before), merged (meshes merged away), batches (meshes made), draws
 *  (meshes drawn after), skipped: { reason: count } } */
export function batchStatic(THREE, root, opts = {}) {
  const keep = new Set(opts.keep || []);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map(), skipped = {};
  let meshes = 0;
  const visit = (o, shown) => {
    if (keep.has(o)) { o.traverse((x) => { if (x.isMesh) { meshes++; skipped.kept = (skipped.kept || 0) + 1; } }); return; }
    const vis = shown && (o === root || o.visible);                    // hidden under root, not root itself (the strip is built hidden)
    if (o.isMesh) {
      meshes++;
      const why = vis ? notBatchable(THREE, o) : 'hidden';
      if (why) skipped[why] = (skipped[why] || 0) + 1;
      else {
        const g = o.geometry, attrSig = Object.keys(g.attributes).sort().map((k) => k + g.attributes[k].itemSize).join(',');
        const key = materialKey(o.material) + '|' + attrSig + '|' + o.castShadow + o.receiveShadow + '|' + o.renderOrder + '|' + o.layers.mask + '|' + o.frustumCulled;
        (groups.get(key) || groups.set(key, []).get(key)).push(o);
      }
    }
    for (const c of o.children.slice()) visit(c, vis);
  };
  visit(root, true);
  let merged = 0, batches = 0;
  const m4 = new THREE.Matrix4();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const parts = list.map((o) => {
      const g = o.geometry, attrs = {};
      for (const k of Object.keys(g.attributes)) attrs[k] = { array: floatAttr(g.attributes[k]), itemSize: g.attributes[k].itemSize };
      return { attrs, index: g.index ? g.index.array : null, matrix: m4.multiplyMatrices(inv, o.matrixWorld).elements.slice() };
    });
    const d = mergeParts(parts), geo = new THREE.BufferGeometry();
    for (const k of Object.keys(d.attrs)) geo.setAttribute(k, new THREE.BufferAttribute(d.attrs[k].array, d.attrs[k].itemSize));
    geo.setIndex(new THREE.BufferAttribute(d.index, 1));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const first = list[0], mesh = new THREE.Mesh(geo, first.material);
    mesh.name = 'batch:' + (first.material.name || first.material.type);
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = first.layers.mask; mesh.frustumCulled = first.frustumCulled;
    mesh.userData.batched = list.length;
    for (const o of list) {
      let p = o.parent; o.removeFromParent();
      while (p && p !== root && !p.children.length && !p.isMesh && !p.isLight && !p.isCamera && !keep.has(p)) { const up = p.parent; p.removeFromParent(); p = up; }
    }
    root.add(mesh);
    merged += list.length; batches++;
  }
  return { meshes, merged, batches, draws: meshes - merged + batches, skipped };
}
