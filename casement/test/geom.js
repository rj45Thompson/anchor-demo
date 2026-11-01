/* ---------- photo geometry: pure functions, so they can be tested on images with a known answer ---------- */
function solveH(src, dst) {
  const A = [], b = [], n = 8;
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (f) { for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
  }
  const h = new Array(8);
  for (let r = n - 1; r >= 0; r--) { let t = b[r]; for (let k = r + 1; k < n; k++) t -= A[r][k] * h[k]; h[r] = t / A[r][r]; }
  return [...h, 1];
}
function applyH(H, p) {
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w];
}
const dist2d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// Width over height of a rectangle seen in perspective, from its four corners alone (Zhang and He, whiteboard scanning).
// Corners TL TR BR BL in pixels; (cx, cy) the image centre; L the image's long side. Near straight-on the focal length
// cannot be recovered, but there the ratio barely depends on it, so a typical phone lens (0.75 L, 26 mm on a 36 mm frame) stands in.
function quadAspect(q, cx, cy, L) {
  const m = [q[0], q[1], q[3], q[2]].map(p => [p[0] - cx, p[1] - cy, 1]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c14 = cross(m[0], m[3]);
  const k2 = dot(c14, m[2]) / dot(cross(m[1], m[3]), m[2]), k3 = dot(c14, m[1]) / dot(cross(m[2], m[3]), m[1]);
  const n2 = m[1].map((v, i) => k2 * v - m[0][i]), n3 = m[2].map((v, i) => k3 * v - m[0][i]);
  let f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  if (!(f2 > (0.4 * L) ** 2 && f2 < (2.5 * L) ** 2)) f2 = (0.75 * L) ** 2;
  return Math.sqrt(((n2[0] ** 2 + n2[1] ** 2) / f2 + n2[2] ** 2) / ((n3[0] ** 2 + n3[1] ** 2) / f2 + n3[2] ** 2));
}
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function grayAt(im, x, y) {
  const X = Math.max(0, Math.min(im.w - 1.001, x)), Y = Math.max(0, Math.min(im.h - 1.001, y)), i = X | 0, j = Y | 0, fx = X - i, fy = Y - j, o = j * im.w + i, d = im.data;
  return (d[o] * (1 - fx) + d[o + 1] * fx) * (1 - fy) + (d[o + im.w] * (1 - fx) + d[o + im.w + 1] * fx) * fy;
}
// Gradient across the side at one place along it, averaged along the side to steady it against noise.
function crossGradient(im, x, y, u, n, R) {
  const size = 2 * R + 1, v = new Float32Array(size), A = 3;
  for (let k = 0; k < size; k++) {
    let s = 0; const kk = k - R;
    for (let j = -A; j <= A; j++) s += grayAt(im, x + n[0] * kk + u[0] * j * 1.5, y + n[1] * kk + u[1] * j * 1.5);
    v[k] = s / (2 * A + 1);
  }
  const g = new Float32Array(size);
  for (let k = 1; k < size - 1; k++) g[k] = Math.abs(v[k + 1] - v[k - 1]) / 2;
  return g;
}
function peakAt(g, k) {       // sub-pixel position of a gradient peak
  const a = g[k - 1], b = g[k], c = g[k + 1], d = a - 2 * b + c;
  return k + (d < 0 ? Math.max(-.5, Math.min(.5, (a - c) / (2 * d))) : 0);
}
// Find the real edge near a rough side: gather every strong edge across it, take straight lines many samples agree on,
// and of those the innermost, since a frame has several parallel edges and the opening is the first one met from inside.
// Measured on simulated photos: taking the one nearest the rough side locked onto the sash edge on 4 of 48 corners, 1.1 in out.
// The normal points inward for corners listed clockwise. Then re-measure close in and fit.
function refineSide(im, p, q, R, rand) {
  const len = dist2d(p, q); if (len < 12) return null;
  const u = [(q[0] - p[0]) / len, (q[1] - p[1]) / len], n = [-u[1], u[0]];
  const N = Math.min(64, Math.max(14, Math.floor(len / 14))), cand = [];
  for (let i = 0; i < N; i++) {
    const s = len * (.07 + .86 * i / (N - 1)), g = crossGradient(im, p[0] + u[0] * s, p[1] + u[1] * s, u, n, R);
    let top = 0; for (let k = 2; k < g.length - 2; k++) if (g[k] > top) top = g[k];
    const floor = Math.max(4, top * .3);
    for (let k = 2; k < g.length - 2; k++) if (g[k] >= floor && g[k] >= g[k - 1] && g[k] > g[k + 1]) cand.push({ i, s, k: peakAt(g, k) - R });
  }
  if (cand.length < 6) return null;
  const lines = [];
  for (let t = 0; t < 500; t++) {
    const c1 = cand[Math.floor(rand() * cand.length)], c2 = cand[Math.floor(rand() * cand.length)];
    if (c1.i === c2.i) continue;
    const b = (c2.k - c1.k) / (c2.s - c1.s), a = c1.k - b * c1.s;
    if (Math.abs(b) > Math.min(.35, 2 * R / len)) continue;
    const seen = new Set();
    for (const c of cand) if (Math.abs(a + b * c.s - c.k) < 1.3) seen.add(c.i);
    lines.push({ a, b, count: seen.size });
  }
  if (!lines.length) return null;
  const best = Math.max(...lines.map(l => l.count));
  if (best < Math.max(6, N * .35)) return null;
  const mid = l => l.a + l.b * len / 2;
  const line = lines.filter(l => l.count >= best * .7).sort((x, y) => mid(y) - mid(x))[0];
  // close in: a denser pass, a small window, least squares with outliers trimmed
  const p2 = [p[0] + n[0] * line.a, p[1] + n[1] * line.a], q2 = [q[0] + n[0] * (line.a + line.b * len), q[1] + n[1] * (line.a + line.b * len)];
  const len2 = dist2d(p2, q2), u2 = [(q2[0] - p2[0]) / len2, (q2[1] - p2[1]) / len2], n2 = [-u2[1], u2[0]];
  const N2 = Math.min(180, Math.max(20, Math.floor(len2 / 5))), pts = [], r2 = 5;
  for (let i = 0; i < N2; i++) {
    const s = len2 * (.05 + .9 * i / (N2 - 1)), g = crossGradient(im, p2[0] + u2[0] * s, p2[1] + u2[1] * s, u2, n2, r2);
    let bk = -1, bv = 3;
    for (let k = 2; k < g.length - 2; k++) if (g[k] > bv && g[k] >= g[k - 1] && g[k] > g[k + 1]) { const w = g[k] / (1 + Math.abs(k - r2) * .4); if (w > bv) { bv = w; bk = k; } }
    if (bk >= 0) pts.push({ s, k: peakAt(g, bk) - r2 });
  }
  if (pts.length < 8) return null;
  let A = 0, B = 0, keep = pts, rms = 0;
  for (let round = 0; round < 3; round++) {
    let sw = 0, ss = 0, sk = 0, ssk = 0, sxy = 0;
    for (const c of keep) { sw++; ss += c.s; sk += c.k; ssk += c.s * c.s; sxy += c.s * c.k; }
    const det = sw * ssk - ss * ss; if (Math.abs(det) < 1e-9) break;
    B = (sw * sxy - ss * sk) / det; A = (sk - B * ss) / sw;
    let e = 0; for (const c of keep) e += (A + B * c.s - c.k) ** 2;
    rms = Math.sqrt(e / keep.length);
    const lim = Math.max(.6, 2.5 * rms);
    const next = pts.filter(c => Math.abs(A + B * c.s - c.k) <= lim);
    if (next.length < 6) break;
    keep = next;
  }
  const P = [p2[0] + n2[0] * A, p2[1] + n2[1] * A], Q = [q2[0] + n2[0] * (A + B * len2), q2[1] + n2[1] * (A + B * len2)];
  const near = keep.filter(c => c.s > len2 * .42 && c.s < len2 * .58).map(c => c.k - (A + B * c.s)).sort((x, y) => x - y);
  const midShift = near.length >= 3 ? near[near.length >> 1] : 0;
  return { P, Q, n: n2, rms, count: keep.length, midShift, sigma: Math.sqrt(rms * rms / keep.length + .3 * .3) };
}
function intersect(a, b) {
  const x1 = a.P[0], y1 = a.P[1], x2 = a.Q[0], y2 = a.Q[1], x3 = b.P[0], y3 = b.P[1], x4 = b.Q[0], y4 = b.Q[1];
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (Math.abs(d) < 1e-9) return null;
  const c1 = x1 * y2 - y1 * x2, c2 = x3 * y4 - y3 * x4;
  return [(c1 * (x3 - x4) - (x1 - x2) * c2) / d, (c1 * (y3 - y4) - (y1 - y2) * c2) / d];
}
// A rough quad (TL TR BR BL) to the edges really in the image. A side with no clear edge stays where it was, and says so.
function refineQuad(im, quad, R, seed) {
  const rand = seeded(seed || 7), sides = [];
  for (let i = 0; i < 4; i++) {
    const p = quad[i], q = quad[(i + 1) % 4], side = refineSide(im, p, q, R, rand);
    const len = dist2d(p, q);
    sides.push(side || { P: p, Q: q, n: [-(q[1] - p[1]) / len, (q[0] - p[0]) / len], rms: 0, count: 0, midShift: 0, sigma: 2.5, rough: true });
  }
  const out = [];
  for (let i = 0; i < 4; i++) {
    const c = intersect(sides[(i + 3) % 4], sides[i]);
    out.push(c && dist2d(c, quad[i]) < R * 2.2 ? c : quad[i]);
  }
  const mids = sides.map((s, i) => {
    const a = out[i], b = out[(i + 1) % 4];
    return [(a[0] + b[0]) / 2 + s.n[0] * s.midShift, (a[1] + b[1]) / 2 + s.n[1] * s.midShift];
  });
  return { q: out, m: mids, sig: sides.map(s => s.sigma), found: sides.filter(s => !s.rough).length };
}
function liteMeasures(H, q, m) {
  const P = q.map(p => applyH(H, p)), M = m.map(p => applyH(H, p));
  return { wT: dist2d(P[0], P[1]), wB: dist2d(P[3], P[2]), wM: dist2d(M[3], M[1]), hL: dist2d(P[0], P[3]), hR: dist2d(P[1], P[2]), hC: dist2d(M[0], M[2]), d1: dist2d(P[1], P[3]), d2: dist2d(P[0], P[2]) };
}
const PAPER_LONG = 11, PAPER_SHORT = 8.5;     // US letter, inches
function photoRaw(ph, gauss, useRef) {
  const L = Math.max(ph.w, ph.h), nz = p => [p[0] / L, p[1] / L];
  const jit = (p, s) => gauss ? [p[0] + gauss() * s, p[1] + gauss() * s] : p;
  const corner = (sig, i) => Math.hypot(sig[i], sig[(i + 3) % 4]);
  const lites = ph.lites.map(l => ({ q: l.q.map((p, i) => jit(p, corner(l.sig, i))), m: l.m.map((p, i) => jit(p, l.sig[i] * 1.2)) }));
  let H, unit;
  if (useRef === 'paper' && ph.paper) {
    const q = ph.paper.q.map((p, i) => jit(p, corner(ph.paper.sig, i)));
    const wide = dist2d(q[0], q[1]) + dist2d(q[3], q[2]) > dist2d(q[0], q[3]) + dist2d(q[1], q[2]);
    const W = wide ? PAPER_LONG : PAPER_SHORT, T = wide ? PAPER_SHORT : PAPER_LONG;
    H = solveH(q.map(nz), [[0, 0], [W, 0], [W, T], [0, T]]); unit = 'inches';
  } else {
    const q = lites[0].q, r = quadAspect(q, ph.w / 2, ph.h / 2, L);
    H = solveH(q.map(nz), [[0, 0], [r, 0], [r, 1], [0, 1]]); unit = 'relative';
  }
  if (!H) return { raw: {}, unit, bad: true };
  const raw = {};
  lites.forEach((l, i) => { const v = liteMeasures(H, l.q.map(nz), l.m.map(nz)); for (const k of Object.keys(v)) raw['L' + i + '_' + k] = v[k]; });
  return { raw, unit };
}
const medianOf = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
// The photo's figures in sixteenths with a margin. The margin is what the edge-finding uncertainty does to each figure when
// the corners are jittered by it, 95 of 100 times; it cannot include a reference out of plane or lens bend. Tape readings
// on the same drawing fix the scale, and how far the photo was off before that is reported.
// A letter sheet is 11 by 8.5 whatever the angle: if the four corners found do not rectify to that, they are wrong, and a
// plane built on them would be wrong by feet (measured: one missed side gave 38 in of error), so the paper is refused, not used.
function paperLooksRight(ph) {
  if (!ph.paper) return false;
  const L = Math.max(ph.w, ph.h), r = quadAspect(ph.paper.q, ph.w / 2, ph.h / 2, L), ratio = r > 1 ? r : 1 / r;
  return Math.abs(ratio / (PAPER_LONG / PAPER_SHORT) - 1) < .035;
}
function photoSolve(ph, tape) {
  const ids0 = Object.keys(photoRaw(ph, null, 'none').raw), readings = ids0.filter(id => tape && tape[id] != null);
  const wantPaper = ph.useRef === 'paper' && !readings.length;
  if (wantPaper && !paperLooksRight(ph)) return { values: {}, badPaper: true };
  const mode = wantPaper ? 'paper' : 'none', nominal = photoRaw(ph, null, mode), ids = Object.keys(nominal.raw);
  const scaleOf = raw => readings.length ? medianOf(readings.map(id => tape[id] / 16 / raw[id])) : (nominal.unit === 'inches' ? 1 : null);
  const S = scaleOf(nominal.raw);
  if (S == null) return { values: {}, needsReading: true };
  const rand = seeded(11), gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const spread = Object.fromEntries(ids.map(id => [id, []]));
  for (let t = 0; t < 160; t++) {
    const d = photoRaw(ph, gauss, mode), s = scaleOf(d.raw);
    for (const id of ids) spread[id].push(Math.abs(d.raw[id] * s - nominal.raw[id] * S) * 16);
  }
  const values = {};
  for (const id of ids) {
    const a = spread[id].sort((x, y) => x - y);
    values[id] = { v: Math.round(nominal.raw[id] * S * 16), e: Math.max(1, Math.ceil(a[Math.floor(a.length * .95)])) };
  }
  const paperRaw = readings.length && ph.paper && paperLooksRight(ph) ? photoRaw(ph, null, 'paper').raw : null;
  const calib = readings.length ? {
    n: readings.length,
    before: paperRaw ? readings.map(id => ({ id, photo: Math.round(paperRaw[id] * 16), tape: tape[id] })) : null,
    left: Math.max(...readings.map(id => Math.abs(Math.round(nominal.raw[id] * S * 16) - tape[id]))),
  } : null;
  return { values, calib };
}
