// dress.js - UC-33, the track dressed as a finished game's: painted edge lines, red-and-white kerbs at the tight corners, rubber laid
// down along the line the cars drive, posts at the road's edges for the speed to show against, and a gantry over every gate. Built
// from the road's own landscape spline (data/road_spline.json, READ out of Unreal's level; the collision mesh's road reaches its
// left and right edges, measured 11-07) and tools/track_dress.mjs's per-point record (data/track_dress.json: tunnels, kerb sides,
// the ground each post stands on). Positions are Unreal's (cm) until toThreePoint. AUTHORED, for the look, every size below
// (a painted line 15 cm wide, 50 cm in from the edge; a kerb 70 cm; rubber 2.4 m; posts 1 m with a 9 cm reflector band; gantries
// 6.5 m high) and the colours.
const LINE = { inset: 50, width: 15, lift: 2 }, KERB = { width: 70, lift: 3, stripe_m: 1 }, RUBBER = { width: 240, lift: 1.5 };
const POST = { h: 100, w: 12, band: 9, band_at: 82 }, GANTRY = { h: 650, beam: 60, pillar: 40, banner_h: 140 };

function unit2(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
/** a flat strip along `pts` (UE cm): each point's two corners at a and b cm in from it along `inward[i]`, lifted `lift` cm */
function ribbon(THREE, toThree, pts, inward, a, b, lift, closed) {
  const pos = [], uv = [], idx = [];
  let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], w = inward[i];
    if (i) { const q = pts[i - 1]; u += Math.hypot(p[0] - q[0], p[1] - q[1]) / 100; }
    for (const d of [a, b]) { pos.push(...toThree([p[0] + w[0] * d, p[1] + w[1] * d, p[2] + lift])); uv.push(u, d === a ? 0 : 1); }
  }
  const n = pts.length, seg = closed ? n : n - 1;
  for (let i = 0; i < seg; i++) { const j = (i + 1) % n; idx.push(2 * i, 2 * j, 2 * i + 1, 2 * i + 1, 2 * j, 2 * j + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function canvasTex(THREE, w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const decal = (THREE, o) => Object.assign(new THREE.MeshStandardNodeMaterial(o), { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

/** the dressing, one Group; gateGround: the ground under each gate (UE cm), as the page works it out (app.js prepareTrack) */
export function buildDressing(THREE, toThree, spline, dress, gates, gateGround, anisotropy) {
  const C = spline.center, n = C.length, root = new THREE.Group(); root.name = 'dressing';
  if (dress.spline_points !== n) throw new Error('dress.js: track_dress.json was made for ' + dress.spline_points + ' spline points, the spline has ' + n + ': re-run tools/track_dress.mjs');
  const inwardOf = (E) => E.map((e, i) => unit2(C[i][0] - e[0], C[i][1] - e[1]));
  const sides = { left: { E: spline.left, w: inwardOf(spline.left) }, right: { E: spline.right, w: inwardOf(spline.right) } };
  // painted edge lines, the whole loop, both sides
  const paint = decal(THREE, { color: 0xf2f2ee, roughness: 0.55 });
  for (const s of Object.values(sides)) root.add(new THREE.Mesh(ribbon(THREE, toThree, s.E, s.w, LINE.inset, LINE.inset + LINE.width, LINE.lift, true), paint));
  // rubber laid down along the centre, the line the page's driver takes (ai_driver.js follows the centre)
  const rub = decal(THREE, { color: 0x0b0b0c, roughness: 0.9, transparent: true, opacity: 0.32, depthWrite: false });
  root.add(new THREE.Mesh(ribbon(THREE, toThree, C, sides.left.w, -RUBBER.width / 2, RUBBER.width / 2, RUBBER.lift, true), rub));   // across: the left edge's inward
  // kerbs: each run of points marked for one side, a point either end, red and white every KERB.stripe_m
  const stripes = canvasTex(THREE, 64, 8, (g, w, h) => { g.fillStyle = '#d3202a'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#f4f4f0'; g.fillRect(w / 2, 0, w / 2, h); });
  stripes.wrapS = THREE.RepeatWrapping; stripes.repeat.set(1 / (2 * KERB.stripe_m), 1); stripes.anisotropy = anisotropy;
  const kerbMat = decal(THREE, { map: stripes, roughness: 0.6 });
  let kerbs = 0;
  for (const side of ['left', 'right']) {
    for (let i = 0; i < n; i++) {
      if (dress.points[i].kerb !== side || (i > 0 && dress.points[i - 1].kerb === side)) continue;
      let j = i; while (j + 1 < n && dress.points[j + 1].kerb === side) j++;
      const from = Math.max(0, i - 1), to = Math.min(n - 1, j + 1), s = sides[side];
      root.add(new THREE.Mesh(ribbon(THREE, toThree, s.E.slice(from, to + 1), s.w.slice(from, to + 1), 0, KERB.width, KERB.lift, false), kerbMat));
      kerbs++;
    }
  }
  // posts on the ground outside the edges, with an orange reflector band: one InstancedMesh each
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(POST.w / 100, POST.h / 100, POST.w / 100), new THREE.MeshStandardNodeMaterial({ color: 0xf4f4f0, roughness: 0.45 }), dress.posts.length);
  const band = new THREE.InstancedMesh(new THREE.BoxGeometry((POST.w + 1) / 100, POST.band / 100, (POST.w + 1) / 100), new THREE.MeshStandardNodeMaterial({ color: 0xff6a1f, emissive: 0xff5a10, emissiveIntensity: 1.4, roughness: 0.3 }), dress.posts.length);
  const m4 = new THREE.Matrix4();
  dress.posts.forEach((p, k) => {
    const [x, y, z] = toThree(p.at);
    body.setMatrixAt(k, m4.makeTranslation(x, y + POST.h / 200, z)); band.setMatrixAt(k, m4.makeTranslation(x, y + POST.band_at / 100, z));
  });
  body.castShadow = true; root.add(body, band);
  // a gantry over every gate: two pillars past the gate's ends and a beam with the lot's name on it, both faces
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x24272c, roughness: 0.4, metalness: 0.7 });
  const banner = canvasTex(THREE, 1024, 128, (g, w, h) => { g.fillStyle = '#0d0f12'; g.fillRect(0, 0, w, h); g.fillStyle = '#f25827'; g.fillRect(0, h - 10, w, 10); g.font = '800 70px "Open Sans", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fefefe'; g.fillText('HOUSE OF CARS', w / 2, 88); });
  banner.anisotropy = anisotropy;
  const bannerMat = new THREE.MeshBasicNodeMaterial({ map: banner });   // one face each way, so the name reads the right way round from both
  gates.forEach((gate, i) => {
    const yaw = gate.yaw_deg * Math.PI / 180, [hx, hy] = gate.half_extent_cm;
    const [ux, uy, half] = hx >= hy ? [Math.cos(yaw), Math.sin(yaw), hx] : [-Math.sin(yaw), Math.cos(yaw), hy];
    const g0 = gateGround[i], span = half + 150;
    const ends = [-1, 1].map((sgn) => [g0[0] + ux * span * sgn, g0[1] + uy * span * sgn, g0[2]]);
    for (const e of ends) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(GANTRY.pillar / 100, GANTRY.h / 100, GANTRY.pillar / 100), steel);
      const [x, y, z] = toThree(e); pil.position.set(x, y + GANTRY.h / 200, z); pil.castShadow = true; root.add(pil);
    }
    const mid = toThree([g0[0], g0[1], g0[2] + GANTRY.h - GANTRY.beam / 2]), len = 2 * span / 100;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(len, GANTRY.beam / 100, GANTRY.beam / 100), steel);
    beam.position.set(...mid); beam.rotation.y = -Math.atan2(uy, ux); beam.castShadow = true; root.add(beam);
    for (const flip of [0, Math.PI]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(len * 0.7, 14), GANTRY.banner_h / 100), bannerMat);
      sign.position.set(mid[0], mid[1] - (GANTRY.beam + GANTRY.banner_h) / 200, mid[2]); sign.rotation.y = -Math.atan2(uy, ux) + flip; root.add(sign);
    }
  });
  root.userData.counts = { lines: 2, kerbs, posts: dress.posts.length, gantries: gates.length };
  return root;
}
