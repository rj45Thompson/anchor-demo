// world.js - what a wheel's suspension trace or the car's body can hit, in Unreal space (cm, X forward, Y right, Z up):
//   the landscape: heights and normals READ by a line trace at every landscape vertex (tools/ue_ground.py, data/ground_*.bin)
//   the road, tunnel and boundary walls: triangles out of track.glb (tools/build_site.py collision_mesh, data/collision.bin)
// trace(start, end) answers what Chaos's suspension trace answers: the nearest hit along the segment, its point, normal, distance
// and the surface friction of what was hit (data/track.json surface_friction, READ). Pure: no DOM; runs in the browser and node.
// Serves UC-2.1 (the car sits on the track) and UC-2.2 (it drives on it, through the tunnel under the hill).
//
// AUTHORED (said in AUTHORED below, not presented as Unreal's): between landscape vertices the height and normal are interpolated
// bilinearly (Unreal triangulates each quad); render triangles stand in for Unreal's simple collision shapes, which were not exported.
export const AUTHORED = [
  'landscape height and normal between READ vertices: bilinear interpolation (Unreal triangulates each 50 cm quad)',
  'road, tunnel and wall collision: the exported render triangles stand in for the simple collision shapes, which were not exported',
];

const CELL = 400;   // cm: the triangle grid's cell; a bookkeeping size for speed, not a value of the game

export function makeWorld({ grid, heights, normals, tris, kinds, friction }) {
  const { nx, ny, step_cm: step } = grid;
  const [ox, oy] = grid.origin_cm;
  if (heights.length !== nx * ny || normals.length !== 3 * nx * ny) throw new Error('world: ground arrays do not match the grid');
  const nTri = tris.length / 9;
  if (!Number.isInteger(nTri) || kinds.length !== nTri) throw new Error('world: collision arrays do not match');

  // the triangle grid over X/Y: each triangle in every cell its X/Y box touches
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < nTri * 9; i += 3) { minX = Math.min(minX, tris[i]); maxX = Math.max(maxX, tris[i]); minY = Math.min(minY, tris[i + 1]); maxY = Math.max(maxY, tris[i + 1]); }
  const gx = Math.max(1, Math.ceil((maxX - minX) / CELL)), gy = Math.max(1, Math.ceil((maxY - minY) / CELL));
  const cells = Array.from({ length: gx * gy }, () => []);
  const cx = (x) => Math.min(gx - 1, Math.max(0, Math.floor((x - minX) / CELL)));
  const cy = (y) => Math.min(gy - 1, Math.max(0, Math.floor((y - minY) / CELL)));
  for (let t = 0; t < nTri; t++) {
    const b = t * 9;
    const x0 = Math.min(tris[b], tris[b + 3], tris[b + 6]), x1 = Math.max(tris[b], tris[b + 3], tris[b + 6]);
    const y0 = Math.min(tris[b + 1], tris[b + 4], tris[b + 7]), y1 = Math.max(tris[b + 1], tris[b + 4], tris[b + 7]);
    for (let j = cy(y0); j <= cy(y1); j++) for (let i = cx(x0); i <= cx(x1); i++) cells[j * gx + i].push(t);
  }
  const stamp = new Uint32Array(nTri);
  let query = 0;

  function ground(x, y) {          // bilinear height and normal, or null off the landscape
    const fx = (x - ox) / step, fy = (y - oy) / step;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return null;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy));
    const u = fx - i, v = fy - j;
    const k = (a, b) => (j + b) * nx + (i + a);
    const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
    const ks = [k(0, 0), k(1, 0), k(0, 1), k(1, 1)];
    let z = 0, n0 = 0, n1 = 0, n2 = 0;
    for (let q = 0; q < 4; q++) { z += w[q] * heights[ks[q]]; n0 += w[q] * normals[3 * ks[q]]; n1 += w[q] * normals[3 * ks[q] + 1]; n2 += w[q] * normals[3 * ks[q] + 2]; }
    const L = Math.hypot(n0, n1, n2);
    return { z, normal: [n0 / L, n1 / L, n2 / L] };
  }

  function traceGround(s, e) {     // first crossing of the segment into the landscape: march, then bisect
    const len = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
    const n = Math.max(2, Math.ceil(len / (step / 2)));
    const at = (t) => [s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t, s[2] + (e[2] - s[2]) * t];
    const above = (p) => { const g = ground(p[0], p[1]); return g === null ? null : p[2] - g.z; };
    let t0 = 0, d0 = above(s);
    if (d0 !== null && d0 < 0) return null;          // starts under the landscape (in the tunnel): the landscape is not below it
    for (let k = 1; k <= n; k++) {
      const t1 = k / n, d1 = above(at(t1));
      if (d0 !== null && d1 !== null && d1 <= 0) {
        let a = t0, b = t1;
        for (let it = 0; it < 20; it++) { const m = (a + b) / 2, dm = above(at(m)); if (dm !== null && dm > 0) a = m; else b = m; }
        const p = at(b), g = ground(p[0], p[1]);
        return { point: [p[0], p[1], g.z], normal: g.normal, distance: b * len, friction: friction.landscape, kind: 'landscape' };
      }
      t0 = t1; d0 = d1;
    }
    return null;
  }

  function traceTris(s, e) {       // Moller-Trumbore over the triangles in the cells the segment's box touches
    const d = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    query = (query + 1) >>> 0 || 1;
    let best = null;
    for (let j = cy(Math.min(s[1], e[1])); j <= cy(Math.max(s[1], e[1])); j++) {
      for (let i = cx(Math.min(s[0], e[0])); i <= cx(Math.max(s[0], e[0])); i++) {
        for (const t of cells[j * gx + i]) {
          if (stamp[t] === query) continue;
          stamp[t] = query;
          const b = t * 9;
          const e1 = [tris[b + 3] - tris[b], tris[b + 4] - tris[b + 1], tris[b + 5] - tris[b + 2]];
          const e2 = [tris[b + 6] - tris[b], tris[b + 7] - tris[b + 1], tris[b + 8] - tris[b + 2]];
          const p = cross(d, e2), det = dot(e1, p);
          if (Math.abs(det) < 1e-9) continue;
          const tv = [s[0] - tris[b], s[1] - tris[b + 1], s[2] - tris[b + 2]];
          const u = dot(tv, p) / det; if (u < 0 || u > 1) continue;
          const q = cross(tv, e1), v = dot(d, q) / det; if (v < 0 || u + v > 1) continue;
          const tt = dot(e2, q) / det; if (tt < 0 || tt > 1) continue;
          if (best && tt >= best.t) continue;
          let nrm = cross(e1, e2); const L = Math.hypot(nrm[0], nrm[1], nrm[2]); nrm = [nrm[0] / L, nrm[1] / L, nrm[2] / L];
          if (dot(nrm, d) > 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];   // face the trace
          best = { t: tt, normal: nrm, kind: kinds[t] };
        }
      }
    }
    if (!best) return null;
    return { point: [s[0] + d[0] * best.t, s[1] + d[1] * best.t, s[2] + d[2] * best.t], normal: best.normal, distance: best.t * len,
             friction: best.kind === 'road' ? friction.road : friction.landscape, kind: best.kind };
  }

  function trace(start, end) {
    const a = traceTris(start, end), b = traceGround(start, end);
    if (!a) return b;
    if (!b) return a;
    return a.distance <= b.distance ? a : b;
  }
  return { trace, ground, triangles: nTri, tris, kinds };   // tris/kinds: the page's minimap draws the road from them
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

// the world from the page's data files (browser: fetch; node: a reader passed in). kinds per triangle from track.json's runs.
export async function loadWorld(read, track) {
  const g = track.ground.grid;
  const heights = new Float32Array(await read('ground_height.bin'));
  const normals = new Float32Array(await read('ground_normal.bin'));
  const tris = new Float32Array(await read(track.collision.file));
  const kinds = new Array(track.collision.triangles);
  for (const r of track.collision.runs) for (let k = 0; k < r.count; k++) kinds[r.first + k] = r.kind;
  return makeWorld({ grid: g, heights, normals, tris, kinds, friction: track.surface_friction });
}
