// drag_fx.js - UC-44.4 / 44.5 the drag run's drama, every effect fired by a real event of the run and read off the sim, never fed
// back into it: tyre smoke where the sim says a driven tyre is spinning, a camera that answers the car's measured acceleration (the
// launch, the clutch biting after a shift), the tree's lamps glowing through the rain, and the finish: who crossed first and by how
// much, from the two slips. Like weather.js, the pure parts (no three, no DOM) run in node (test/drag_fx.test.mjs); buildSmoke and
// buildHalos take the caller's three/webgpu namespace and its node functions from THREE.TSL.
//
// READ / DERIVED / AUTHORED, each said where it is set:
//   READ: the tyres' slip and its slipping flag (chaos_vehicle.js v.wheels[i]: IsSlipping as the port publishes it), the contact
//     point, the car's velocity and forward speed, the engine rpm and the gear; the slips' reaction and elapsed times (drag.js slip).
//   DERIVED: the acceleration (the forward speed's change over the physics time between two frames), the margin (the two crossings
//     on the run's clock, each the green plus its reaction plus its ET, drag.js tick), a holeshot (the winner's ET the slower one).
//   AUTHORED: every look and feel number below (sizes, rates, lives, gains, springs, the hold at the line), labelled where it is set.

// ---------------------------------------------------------------- the camera's answer to the car (UC-44.4: the launch, a shift)
// The car's forward acceleration, measured off the sim, is split into its slow part and its sudden part (the launch, the clutch
// biting after a shift, the drive cut for one): the sudden part kicks a damped spring that pitches the view and opens the lens a
// little, the way a camera on a body that surges is thrown back. While the driven tyres spin the picture shudders, and while the car
// sits on the line at high revs it trembles. All AUTHORED, for feel; all of it off with the page's Motion switch (UC-33.4a).
export const KICK = {
  FAST_TAU_S: 0.03,        // the measured acceleration lightly smoothed (two physics steps a frame make it a little stepped)
  SLOW_TAU_S: 0.4,         // ...and its slow part: what is left over is the jolt
  PITCH_DEG_PER_MS2: 0.09, // the spring's rest pitch per m/s^2 of jolt (an 8 m/s^2 launch: about seven tenths of a degree)
  SPRING_HZ: 2.6, DAMPING: 0.42,   // a quick kick that settles in about half a second, with one small overshoot
  PITCH_MAX_DEG: 1.2,
  FOV_DEG_PER_MS2: 0.6,    // the lens moves with a forward jolt (the surge read as speed), never for a backward one
  FOV_MAX_DEG: 5,
  FOV_TAU_S: 0.12,         // and eases back
  SPIN_DEG: 0.12, SPIN_HZ: 23,     // the shudder at full wheelspin (every driven tyre slipping)
  REV_DEG: 0.1, REV_FROM: 0.6,     // the tremble on the line: from 60 % of the redline, the full amount at the redline, on the gas
  JOLT_MAX_MS2: 25,        // a measured jolt is never taken as more than this (a reset or a cut is not a launch)
  FIXED_SHARE: 0.5,        // a camera standing beside the strip (not riding with the car) feels half of it, and its lens punches IN
};                         // on the car (narrows) where a camera riding with the car opens up: kickLens below
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function makeKick() { return { fast: null, slow: null, pitch: 0, vel: 0, fov: 0, t: 0 }; }
/** one frame. s: { accel (m/s^2, forward, DERIVED off the sim; null when no physics step ran this frame), spin (0..1: the share of
 *  the driven tyres the sim says are slipping), rpm01 (the engine's rpm over its redline), throttle (0..1), standing (the car not yet
 *  rolling) }. on: the Motion switch. Returns degrees to add: pitchDeg, rollDeg, yawDeg, and fovDeg to the horizontal field of view */
export function stepKick(k, s, dt, on) {
  if (!(dt > 0)) return { pitchDeg: on ? k.pitch : 0, rollDeg: 0, yawDeg: 0, fovDeg: on ? k.fov : 0 };
  k.t += dt;
  let jolt = 0;
  if (s.accel !== null && Number.isFinite(s.accel)) {
    const a = clamp(s.accel, -KICK.JOLT_MAX_MS2, KICK.JOLT_MAX_MS2);
    if (k.fast === null) { k.fast = a; k.slow = a; }
    k.fast += (a - k.fast) * (1 - Math.exp(-dt / KICK.FAST_TAU_S));
    k.slow += (k.fast - k.slow) * (1 - Math.exp(-dt / KICK.SLOW_TAU_S));
    jolt = k.fast - k.slow;
  }
  // the spring (semi-implicit Euler, stable at a frame's step): x'' = -w^2 (x - rest) - 2 z w x'
  const w = 2 * Math.PI * KICK.SPRING_HZ, rest = KICK.PITCH_DEG_PER_MS2 * jolt;    // a surge throws the view up (three's rotateX: + looks up), a cut drops it
  k.vel += (-w * w * (k.pitch - rest) - 2 * KICK.DAMPING * w * k.vel) * dt;
  k.pitch = clamp(k.pitch + k.vel * dt, -KICK.PITCH_MAX_DEG, KICK.PITCH_MAX_DEG);
  const fovWant = clamp(KICK.FOV_DEG_PER_MS2 * Math.max(0, jolt), 0, KICK.FOV_MAX_DEG);
  k.fov += (fovWant - k.fov) * (1 - Math.exp(-dt / KICK.FOV_TAU_S));
  if (!on) return { pitchDeg: 0, rollDeg: 0, yawDeg: 0, fovDeg: 0 };
  const n = (a, b, c) => 0.55 * Math.sin(2 * Math.PI * a * k.t + b) + 0.45 * Math.sin(2 * Math.PI * c * k.t + 2 * b);   // two unrelated sines (speedfx.js)
  const spin = KICK.SPIN_DEG * clamp(s.spin || 0, 0, 1);
  const rev = s.standing ? KICK.REV_DEG * clamp(((s.rpm01 || 0) - KICK.REV_FROM) / (1 - KICK.REV_FROM), 0, 1) ** 2 * clamp(s.throttle || 0, 0, 1) : 0;
  const amp = spin + rev;
  return { pitchDeg: k.pitch + amp * n(KICK.SPIN_HZ, 0.4, KICK.SPIN_HZ * 1.37), rollDeg: amp * 0.7 * n(KICK.SPIN_HZ * 0.81, 1.9, KICK.SPIN_HZ * 1.21),
           yawDeg: amp * 0.3 * n(KICK.SPIN_HZ * 1.13, 2.7, KICK.SPIN_HZ * 0.73), fovDeg: k.fov };
}
/** the degrees a shot adds to its horizontal field of view for the kick: a camera riding with the car opens up (the surge as speed), one
 *  standing beside the strip punches in on the car by FIXED_SHARE of it (opening would push a car coming at it further away) */
export const kickLens = (fovDeg, mounted) => (mounted ? fovDeg : -KICK.FIXED_SHARE * fovDeg);
/** the forward acceleration between two frames (m/s^2), DERIVED: the change in the sim's forward speed (cm/s) over the physics time
 *  that ran between them (s, the steps' own sum, not the frame's wall time); null when no step ran */
export function frameAccel(prevCmS, nowCmS, physicsS) {
  if (prevCmS === null || !(physicsS > 0)) return null;
  return (nowCmS - prevCmS) / 100 / physicsS;
}

// ---------------------------------------------------------------- tyre smoke (UC-44.4: wheelspin at the launch)
// Puffs are born only at a driven tyre's contact point while the sim publishes it as slipping (chaos_vehicle.js: on the clutch's slip
// curve, past the curve's peak slip; on the paddles, past the wheel's READ SlipThreshold), as many as the slide's strength asks
// (effects.js slideAmount, the page's curve of the published slip). Thrown back off the tyre, carried a little by the car, they rise,
// slow in the air, spread and fade. AUTHORED, every number; the counts and rates follow the page's quality (GFX_Q: 'low' on a phone or
// without WebGPU). One draw call for the whole pool, whatever its size.
export const SMOKE = {
  count: { high: 192, low: 72 },      // the pool (the oldest puff is reused when it is full: by then it has nearly faded)
  rate: { high: 16, low: 6 },          // puffs a second from one tyre at full slide
  from: 0.2,                           // no smoke under this much slide (a scrub, not a spin)
  life: [2.2, 3.4],                    // s
  size: [0.55, 4.2],                   // m across: at birth, at the end of its life (grows as the square root of its age)
  alpha: 0.6, fadeIn: 0.12,            // its most opaque, and how long it takes to get there (s)
  throw: 0.22,                         // of the tyre's slip speed, thrown back along the car
  carry: 0.3,                          // of the car's own velocity it keeps at birth
  rise: [0.35, 0.9], spread: 0.6,      // m/s up at birth; m/s of random spread sideways
  drag_tau: 0.7, buoyancy: 0.25,       // s for the air to take its speed; m/s^2 up
  spinRad: 0.6,                        // rad/s it turns at most (either way)
  colour: [0.8, 0.8, 0.82],            // linear: a light grey (spray on the wet road, rubber smoke on the dry)
  depthFade: 0.6,                      // m: a puff fades where it meets the road or the car instead of cutting into it
};
const QK = (q) => { if (!SMOKE.count[q]) throw new Error('drag_fx.js: no quality "' + q + '" (high, low)'); return q; };
export function makeSmoke(quality) {
  const n = SMOKE.count[QK(quality)];
  return { n, quality, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), age: new Float32Array(n), life: new Float32Array(n), ang: new Float32Array(n),
           spin: new Float32Array(n), next: 0, acc: [], live: 0 };
}
/** a tyre's puffs this frame: at (m, three space), its spin back along the car (m/s, three space: the slip speed, signed, times the
 *  car's forward axis), the car's velocity (m/s), the slide 0..1. rnd: () => 0..1. Returns how many were born */
export function emitSmoke(P, wheel, at, slipVel, carVel, slide, dt, rnd) {
  if (!(slide >= SMOKE.from) || !(dt > 0)) { P.acc[wheel] = 0; return 0; }
  P.acc[wheel] = (P.acc[wheel] || 0) + SMOKE.rate[P.quality] * slide * dt;
  let born = 0;
  while (P.acc[wheel] >= 1) {
    P.acc[wheel] -= 1; born++;
    const i = P.next; P.next = (P.next + 1) % P.n;
    const sp = () => (rnd() - 0.5) * 2 * SMOKE.spread;
    P.pos.set([at[0] + (rnd() - 0.5) * 0.3, at[1] + 0.15, at[2] + (rnd() - 0.5) * 0.3], 3 * i);
    P.vel.set([-slipVel[0] * SMOKE.throw + carVel[0] * SMOKE.carry + sp(), SMOKE.rise[0] + (SMOKE.rise[1] - SMOKE.rise[0]) * rnd(), -slipVel[2] * SMOKE.throw + carVel[2] * SMOKE.carry + sp()], 3 * i);
    P.age[i] = 0; P.life[i] = SMOKE.life[0] + (SMOKE.life[1] - SMOKE.life[0]) * rnd();
    P.ang[i] = rnd() * 2 * Math.PI; P.spin[i] = (rnd() - 0.5) * 2 * SMOKE.spinRad;
  }
  return born;
}
/** the pool one frame on: each puff ages, moves, slows in the air, rises; a puff past its life is gone. Returns how many are alive */
export function stepSmoke(P, dt) {
  let live = 0;
  const drag = Math.exp(-dt / SMOKE.drag_tau);
  for (let i = 0; i < P.n; i++) {
    if (!(P.life[i] > 0)) continue;
    P.age[i] += dt;
    if (P.age[i] >= P.life[i]) { P.life[i] = 0; continue; }
    live++;
    for (let k = 0; k < 3; k++) { P.vel[3 * i + k] *= drag; P.pos[3 * i + k] += P.vel[3 * i + k] * dt; }
    P.vel[3 * i + 1] += SMOKE.buoyancy * dt;
    P.ang[i] += P.spin[i] * dt;
  }
  P.live = live;
  return live;
}
/** how a puff looks at its age: { size (m), alpha } (0 when dead) */
export function smokeLook(age, life) {
  if (!(life > 0) || age >= life) return { size: 0, alpha: 0 };
  const u = age / life;
  return { size: SMOKE.size[0] + (SMOKE.size[1] - SMOKE.size[0]) * Math.sqrt(u), alpha: SMOKE.alpha * Math.min(1, age / SMOKE.fadeIn) * (1 - u) ** 1.5 };
}
export function clearSmoke(P) { P.life.fill(0); P.acc = []; P.live = 0; }

// the pool as one mesh: four corners a puff, turned to the camera in the vertex stage (the camera's right and up, set each frame),
// a generated puff texture (soft blobs inside a round falloff: the page's own, no image file), faded where it meets the scene
export function buildSmoke(THREE, opts = {}) {
  const T = THREE.TSL, P = makeSmoke(opts.quality || 'high'), n = P.n;
  const centre = new Float32Array(n * 12), corner = new Float32Array(n * 8), prm = new Float32Array(n * 16), index = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) { corner.set([0, 0, 1, 0, 1, 1, 0, 1], 8 * i); index.set([0, 1, 2, 0, 2, 3].map((j) => j + 4 * i), 6 * i); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3));   // unused: the shader places them
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 12), 3));     // unlit (as weather.js's shafts): three asks for one
  const aC = new THREE.BufferAttribute(centre, 3).setUsage(THREE.DynamicDrawUsage), aP = new THREE.BufferAttribute(prm, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('centre', aC); geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2)); geo.setAttribute('prm', aP);
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const uRight = T.uniform(new THREE.Vector3(1, 0, 0)), uUp = T.uniform(new THREE.Vector3(0, 1, 0));
  const c = T.attribute('corner', 'vec2'), p = T.attribute('prm', 'vec4');            // prm: size (m), alpha, angle (rad), unused
  const q = c.sub(0.5), ca = T.cos(p.z), sa = T.sin(p.z);
  const rx = q.x.mul(ca).sub(q.y.mul(sa)), ry = q.x.mul(sa).add(q.y.mul(ca));
  const pos = T.attribute('centre', 'vec3').add(uRight.mul(rx.mul(p.x))).add(uUp.mul(ry.mul(p.x)));
  const vUv = T.varying(c, 'v_smokeUv'), vA = T.varying(p.y, 'v_smokeA');
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  mat.forceSinglePass = true;
  mat.positionNode = pos;                                                               // the mesh stays at the origin, unturned
  const tex = T.texture(puffTexture(THREE), vUv);
  const sceneZ = T.perspectiveDepthToViewZ(T.viewportDepthTexture(T.screenUV).x, T.cameraNear, T.cameraFar).negate();
  const soft = T.saturate(sceneZ.sub(T.positionView.z.negate()).div(SMOKE.depthFade));
  mat.colorNode = T.vec3(...SMOKE.colour).mul(tex.rgb);
  mat.opacityNode = T.saturate(tex.a.mul(vA).mul(soft));
  mat.name = 'drag-smoke';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = 'drag-smoke'; mesh.visible = false;
  function update(camera, dt) {
    stepSmoke(P, dt);
    mesh.visible = P.live > 0;
    if (!mesh.visible) return;
    const e = camera.matrixWorld.elements; uRight.value.set(e[0], e[1], e[2]).normalize(); uUp.value.set(e[4], e[5], e[6]).normalize();
    for (let i = 0; i < n; i++) {
      const L = smokeLook(P.age[i], P.life[i]);
      for (let k = 0; k < 4; k++) { centre.set([P.pos[3 * i], P.pos[3 * i + 1], P.pos[3 * i + 2]], 12 * i + 3 * k); prm.set([L.size, L.alpha, P.ang[i], 0], 16 * i + 4 * k); }
    }
    aC.needsUpdate = true; aP.needsUpdate = true;
  }
  return { mesh, pool: P, update, clear() { clearSmoke(P); mesh.visible = false; } };
}
// the puff: a round falloff filled with soft blobs, lighter at the top (AUTHORED; drawn once on a canvas, the page's own)
export function rng(seed) {                             // mulberry32 (weather.js makeRng's): the same puff every visit
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
function puffTexture(THREE) {
  const S = 128, c = document.createElement('canvas'), R = rng(4404); c.width = c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const a = R() * 2 * Math.PI, d = R() * 0.24 * S, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, r = (0.16 + R() * 0.14) * S;
    const shade = Math.round(205 + 50 * (1 - y / S));                                   // lighter toward the top
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(' + shade + ',' + shade + ',' + shade + ',0.55)'); rg.addColorStop(1, 'rgba(' + shade + ',' + shade + ',' + shade + ',0)');
    g.fillStyle = rg; g.fillRect(0, 0, S, S);
  }
  g.globalCompositeOperation = 'destination-in';                                        // and nothing past the round edge
  const edge = g.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S / 2);
  edge.addColorStop(0, 'rgba(0,0,0,1)'); edge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = edge; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- the tree's lamps in the haze (UC-44.4: staging, the tree)
// A lit lamp gets a soft glow around it, as a lamp seen through rain does; on a rain day the glow is wider and brighter (the drops
// scatter the light). Shown and hidden with the lamp itself (app.js setLamp), so it is exactly the tree's own state. AUTHORED.
export const HALO = {
  size: { dry: 0.45, wet: 0.8 },       // m across, for a 0.15 m bulb (an amber; the others scale with their own size)
  strength: { dry: 0.55, wet: 0.8 },   // x the lamp's own colour (additive)
};
export const haloLook = (rain) => ({ size: rain ? HALO.size.wet : HALO.size.dry, strength: rain ? HALO.strength.wet : HALO.strength.dry });
let haloTex = null;
export function haloMaterial(THREE, hex) {
  if (!haloTex) {
    const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.1, 'rgba(255,255,255,0.5)'); r.addColorStop(0.3, 'rgba(255,255,255,0.14)'); r.addColorStop(0.6, 'rgba(255,255,255,0.04)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, S, S);
    haloTex = new THREE.CanvasTexture(c); haloTex.colorSpace = THREE.SRGBColorSpace;
  }
  const T = THREE.TSL, k = T.uniform(1);
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  m.colorNode = T.vec4(T.color(new THREE.Color(hex)).mul(T.texture(haloTex).a).mul(k), 1);   // the glow in the texture's alpha (its colour is white throughout)
  m.name = 'tree-halo';
  return { material: m, strength: k };
}

// ---------------------------------------------------------------- the result (UC-44.5: who won, by how much)
/** who crossed the quarter first, and by how much, from the two slips on the run's own clock. mine: drag.js slip ({ reaction_s,
 *  quarter_s, foul }); rival: null (no one in the other lane) or { reaction_s: when it left after the green (its driver's own
 *  reaction included), quarter_s: its ET }. A crossing is the green plus the reaction plus the ET (drag.js tick: leave is the green
 *  plus the reaction, the quarter mark is the ET from the leave), the same rule for both, each at the physics' own step. */
export function raceResult(mine, rival) {
  if (!mine || mine.foul) return { kind: 'foul', margin_s: null, holeshot: false, et: mine ? mine.quarter_s : null };
  if (mine.quarter_s === null || mine.quarter_s === undefined || mine.reaction_s === null || mine.reaction_s === undefined) return { kind: 'none', margin_s: null, holeshot: false, et: null };
  const at = mine.reaction_s + mine.quarter_s;
  if (!rival) return { kind: 'solo', margin_s: null, holeshot: false, et: mine.quarter_s, at };
  for (const k of ['reaction_s', 'quarter_s']) if (!Number.isFinite(rival[k])) throw new Error('drag_fx.js raceResult: the rival\'s ' + k + ' is ' + rival[k]);
  const theirs = rival.reaction_s + rival.quarter_s, d = theirs - at;               // + : mine crossed first
  const kind = Math.abs(d) < 1e-9 ? 'tie' : d > 0 ? 'win' : 'lose';
  // a holeshot: the winner's ET was the slower one, so the start won it (a drag strip's word for it)
  const holeshot = (kind === 'win' && mine.quarter_s > rival.quarter_s) || (kind === 'lose' && rival.quarter_s > mine.quarter_s);
  return { kind, margin_s: Math.abs(d), holeshot, et: mine.quarter_s, at, theirs };
}
/** the verdict's words (AUTHORED): head (one or two words), and the line under it */
export function verdictWords(res, rivalName) {
  const by = (x) => 'by ' + x.toFixed(3) + ' s';
  if (res.kind === 'win') return { head: 'YOU WIN', line: by(res.margin_s) + (rivalName ? ' over ' + rivalName : ''), note: res.holeshot ? 'A holeshot: ' + rivalName + ' ran the quicker ET, your start won it.' : '' };
  if (res.kind === 'lose') return { head: rivalName ? rivalName.toUpperCase() + ' WINS' : 'BEATEN', line: by(res.margin_s), note: res.holeshot ? 'Your ET was the quicker one: the start lost it.' : '' };
  if (res.kind === 'tie') return { head: 'DEAD HEAT', line: 'the same thousandth', note: '' };
  if (res.kind === 'solo') return { head: res.et.toFixed(3) + ' s', line: 'the quarter mile', note: '' };
  return { head: '', line: '', note: '' };
}

// ---------------------------------------------------------------- the line (UC-44.4: the finish)
// The frame the visitor's car crosses the line is held on screen for hold_s of the run's time (a copy of it: the sim runs on under it
// and nothing is drawn, so it costs one copy), with a flash and the result over it, before the finish camera's roll-down takes over.
// AUTHORED.
export const FINISH = { hold_s: 0.6, flash_s: 0.35 };
