// Simulated phone photos with a known answer: a twin casement on a wall, paper on the glass, a real camera model, blur, sensor noise.
// The rough corners get random error, as a vision model's would. usage: node sim_photo.js <geom.js> [trials]
const fs = require('fs');
const G = new Function(fs.readFileSync(process.argv[2], 'utf8') + '; return {solveH,applyH,refineQuad,photoSolve,photoRaw,seeded,quadAspect,dist2d};')();
const { refineQuad, photoSolve, seeded, dist2d } = G;
function mat3inv(m) { const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C; return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(x => x / det); }
function scene(opts, rand) {   // plane coords in inches, origin at the opening set's top left
  const { W, H, mull, paper } = opts, lites = [[0, 0, W, H], [W + mull, 0, W, H]];
  const N = 64, tex = new Float32Array(N * N).map(() => rand());
  const noise = (u, v, sc) => { const x = (u / sc % N + N) % N, y = (v / sc % N + N) % N, i = x | 0, j = y | 0, fx = x - i, fy = y - j, t = (a, b) => tex[((b + N) % N) * N + ((a + N) % N)]; return (t(i, j) * (1 - fx) + t(i + 1, j) * fx) * (1 - fy) + (t(i, j + 1) * (1 - fx) + t(i + 1, j + 1) * fx) * fy; };
  return (u, v) => {
    if (paper && u > paper[0] && u < paper[0] + paper[2] && v > paper[1] && v < paper[1] + paper[3]) return 238;
    for (const [x, y, w, h] of lites) if (u > x && u < x + w && v > y && v < y + h) return 55 + 110 * noise(u, v, 7) + 30 * noise(u, v, 1.3);  // the view through the glass
    for (const [x, y, w, h] of lites) if (u > x - 1.1 && u < x + w + 1.1 && v > y - 1.1 && v < y + h + 1.1) return 205;                        // sash, its own edge 1.1 in out from the opening
    if (u > -3 && u < 2 * W + mull + 3 && v > -3 && v < H + 3) return 180;                                                                    // frame
    return 120 + 40 * noise(u, v, 11);                                                                                                         // wall
  };
}
function render(opts, cam, rand) {
  const { w, h, f, k1 } = cam, S = scene(opts, rand), cx = w / 2, cy = h / 2;
  const [yaw, pitch, dist, ox, oy] = [cam.yaw, cam.pitch, cam.dist, cam.ox, cam.oy];
  const cy1 = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const r1 = [cy1, 0, -sy], r2 = [sy * sp, cp, cy1 * sp], t = [-(ox * r1[0] + oy * r2[0]), -(ox * r1[1] + oy * r2[1]), dist - (ox * r1[2] + oy * r2[2])];
  const P = [f * r1[0] + cx * r1[2], f * r2[0] + cx * r2[2], f * t[0] + cx * t[2], f * r1[1] + cy * r1[2], f * r2[1] + cy * r2[2], f * t[1] + cy * t[2], r1[2], r2[2], t[2]];
  const Pi = mat3inv(P), data = new Uint8Array(w * h), L = Math.max(w, h);
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - cx) / L, dy = (y - cy) / L, r2d = dx * dx + dy * dy, c = 1 + k1 * r2d, X = cx + dx * L * c, Y = cy + dy * L * c;   // the lens bends the image
    const z = Pi[6] * X + Pi[7] * Y + Pi[8];
    gray[y * w + x] = S((Pi[0] * X + Pi[1] * Y + Pi[2]) / z, (Pi[3] * X + Pi[4] * Y + Pi[5]) / z);
  }
  const tmp = new Float32Array(w * h), K = [.27, .46, .27];        // optical blur, about 1 px
  for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) tmp[y * w + x] = K[0] * gray[y * w + x - 1] + K[1] * gray[y * w + x] + K[2] * gray[y * w + x + 1];
  for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) { const n = (rand() + rand() + rand() - 1.5) * 8; data[y * w + x] = Math.max(0, Math.min(255, K[0] * tmp[(y - 1) * w + x] + K[1] * tmp[y * w + x] + K[2] * tmp[(y + 1) * w + x] + n)); }
  const proj = (u, v) => {       // plane to pixel, through the lens: a few fixed-point steps on the distortion
    const z = P[6] * u + P[7] * v + P[8]; const X = (P[0] * u + P[1] * v + P[2]) / z, Y = (P[3] * u + P[4] * v + P[5]) / z;
    let x = X, y = Y; for (let i = 0; i < 6; i++) { const dx = (x - cx) / L, dy = (y - cy) / L, c = 1 + k1 * (dx * dx + dy * dy); x = cx + (X - cx) / c; y = cy + (Y - cy) / c; }
    return [x, y];
  };
  return { im: { w, h, data }, proj };
}
if (process.env.EXPORT_DIR) {       // one test photo with its answer, for driving the real page
  const rand = seeded(77), opts = { W: 30.25, H: 48.5, mull: 2.75, paper: [5, 18, 8.5, 11] }, totalW = 2 * opts.W + opts.mull;
  const w = 3024, h = 4032, L = h, f = .75 * L, span = Math.max(totalW + 8, (opts.H + 8) * w / h);
  const cam = { w, h, f, k1: 0, yaw: .05, pitch: .035, dist: span * f / (w * .92), ox: totalW / 2, oy: opts.H / 2 };
  const { im, proj } = render(opts, cam, rand);
  const rect = (x, y, W, H) => [[x, y], [x + W, y], [x + W, y + H], [x, y + H]];
  const rough = q => { const c = q.map(p => { const r = proj(p[0], p[1]); return [Math.round((r[0] + (rand() - .5) * L * .024) / w * 1000), Math.round((r[1] + (rand() - .5) * L * .024) / h * 1000)]; }); return { tl: c[0], tr: c[1], br: c[2], bl: c[3] }; };
  fs.writeFileSync(process.env.EXPORT_DIR + '/test_gray.raw', Buffer.from(im.data));
  fs.writeFileSync(process.env.EXPORT_DIR + '/test_truth.json', JSON.stringify({ w, h, W: opts.W, H: opts.H, diag: Math.hypot(opts.W, opts.H),
    found: { lites: [rough(rect(0, 0, opts.W, opts.H)), rough(rect(opts.W + opts.mull, 0, opts.W, opts.H))], paper: rough(rect(...opts.paper)), what: 'A simulated twin casement with a sheet of paper on the left lite.', confidence: 'high' },
    corners: rect(0, 0, opts.W, opts.H).map(p => proj(p[0], p[1])) }));
  console.log('exported'); process.exit(0);
}
const trials = Number(process.argv[3] || 6), rows = { paper: [], tape: [], paper_tape: [] }; let cover = 0, coverN = 0, wrong = 0, refused = 0;
for (let tr = 0; tr < trials; tr++) {
  const rand = seeded(1000 + tr);
  const opts = { W: 24.25 + Math.floor(rand() * 6) * .5, H: 48.5 + Math.floor(rand() * 6) * .5, mull: 2.75, paper: null };
  const totalW = 2 * opts.W + opts.mull;
  opts.paper = [opts.W * .15, opts.H * .35, 8.5, 11];
  const w = 3024, h = 4032, L = h, f = .75 * L;
  const span = Math.max(totalW + 8, (opts.H + 8) * w / h);
  const cam = { w, h, f, k1: tr % 3 === 2 ? -0.012 : 0, yaw: (rand() - .5) * .22, pitch: (rand() - .5) * .16, dist: span * f / (w * .92), ox: totalW / 2, oy: opts.H / 2 };
  const { im, proj } = render(opts, cam, rand);
  const rough = q => q.map(p => { const c = proj(p[0], p[1]); return [c[0] + (rand() - .5) * L * .024, c[1] + (rand() - .5) * L * .024]; });
  const rect = (x, y, W, H) => [[x, y], [x + W, y], [x + W, y + H], [x, y + H]];
  const litesTrue = [rect(0, 0, opts.W, opts.H), rect(opts.W + opts.mull, 0, opts.W, opts.H)];
  const R = Math.round(L * .03);
  const lites = litesTrue.map((q, i) => refineQuad(im, rough(q), R, 21 + i));
  const paper = refineQuad(im, rough(rect(...opts.paper)), Math.round(L * .028), 31);
  lites.forEach((l, i) => l.q.forEach((c, j) => { const t = proj(...litesTrue[i][j]); if (dist2d(c, t) > 8) wrong++; }));
  const truth = {}; litesTrue.forEach((_, i) => { const d = Math.hypot(opts.W, opts.H); Object.assign(truth, { ['L' + i + '_wT']: opts.W, ['L' + i + '_wM']: opts.W, ['L' + i + '_wB']: opts.W, ['L' + i + '_hL']: opts.H, ['L' + i + '_hC']: opts.H, ['L' + i + '_hR']: opts.H, ['L' + i + '_d1']: d, ['L' + i + '_d2']: d }); });
  const run = (label, useRef, tape) => {
    const res = photoSolve({ w, h, useRef, paper, lites }, tape); if (res.badPaper) { rows[label].push({ med: 0, p90: 0, max: 0, meanE: 0, refused: true }); refused++; return; }
    const errs = Object.keys(res.values).filter(id => !(tape && tape[id] != null)).map(id => { const er = Math.abs(res.values[id].v - truth[id] * 16); if (label === 'paper') { coverN++; if (er <= res.values[id].e + .5) cover++; } return er; });
    errs.sort((a, b) => a - b); rows[label].push({ med: errs[errs.length >> 1], p90: errs[Math.floor(errs.length * .9)], max: errs[errs.length - 1], meanE: Object.values(res.values).reduce((s, x) => s + x.e, 0) / Object.keys(res.values).length });
  };
  run('paper', 'paper', null);
  run('tape', 'none', { L0_wM: Math.round(opts.W * 16) });
  run('paper_tape', 'paper', { L0_wM: Math.round(opts.W * 16) });
  const a = rows.paper.at(-1), b = rows.tape.at(-1);
  console.log(`trial ${tr}: yaw ${(cam.yaw * 57.3).toFixed(1)} pitch ${(cam.pitch * 57.3).toFixed(1)} k1 ${cam.k1} found ${lites.map(l => l.found).join('+')}/8 sides, paper ${paper.found}/4; errors in 1/16 in (median/90%/max): paper ${a.med}/${a.p90}/${a.max} tape ${b.med}/${b.p90}/${b.max}`);
}
for (const k of Object.keys(rows)) {
  const r = rows[k], s = a => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`${k.padEnd(11)} mean of median ${s(r.map(x => x.med)).toFixed(1)}/16, mean 90% ${s(r.map(x => x.p90)).toFixed(1)}/16, worst ${Math.max(...r.map(x => x.max)).toFixed(0)}/16, stated margin avg ${s(r.map(x => x.meanE)).toFixed(1)}/16`);
}
console.log('paper refused as wrong:', refused, '| corners off by more than 8 px:', wrong, 'of', trials * 8, '| paper-mode figures inside their stated margin:', cover, 'of', coverN);
