// ai_driver.js - the page's own driver (UC-9.2): it drives the ported Chaos car round the Time Trial track so each car can set a lap
// and leave a ghost. Two parts:
//   the LINE   - the road's centre line, READ: the landscape spline Unreal built the road from (data/road_spline.json, made by
//                tools/road_spline.mjs out of ue_out/level.t3d), evaluated with Unreal's own curve maths, run in the race direction
//                (the player start's READ yaw) from the player start, through the gates in Next Marker order;
//   the DRIVER - pure pursuit toward a look-ahead point on the line, a target speed from the line's curvature and a braking distance,
//                and a recovery (reverse out) when the car stalls against something. It reads only the vehicle state and the
//                vehicle's own READ setup (v.cfg: wheel positions, steering angles, input curve, gravity), never the world.
// Every driver number is AUTHORED (DRIVER below, each with its reason in AUTHORED); none of them is a property of the car or the
// track. Errors throw. Pure ES module: no DOM, no clock; runs in node and the browser.
import { steeringAngle, graphEvaluateY } from './chaos_vehicle.js';
import { carAxes } from './gates.js';
import * as Rules from './rules.js';

// The driver's parameters. Units: cm, s, g (multiples of the READ gravity).
export const DRIVER = Object.freeze({
  sample_cm: 100,             // spacing of the resampled line
  curvature_span_cm: 400,     // the chord over which the line's curvature is measured (k samples either side)
  lookahead_min_cm: 900,      // pure-pursuit look-ahead at standstill
  lookahead_s: 0.55,          // ... plus this many seconds of the current speed
  lookahead_max_cm: 3200,     // ... capped here
  lat_g: 1.7,                 // the lateral acceleration the speed plan allows in a corner (see AUTHORED: tuning)
  brake_g: 1.2,               // the deceleration the speed plan allows before a corner
  crest_g: 0.6,               // over a crest the plan keeps v^2 * vertical curvature below this (the car stays on the road)
  preview_s: 0.35,            // the target speed is the lowest planned speed this far ahead (input rise time + reaction)
  speed_band_cmps: 120,       // slower than the target by less than this: throttle in proportion; faster than it: coast
  brake_over_cmps: 250,       // faster than the target by more than this = brake (any brake input is a full stop request, below)
  brake_min_cmps: 300,        // never brake below this speed (reverse-as-brake would select reverse)
  stall_cmps: 120,            // slower than this with the throttle on ...
  stall_s: 1.2,               // ... for this long = stalled: reverse out
  reverse_s: 1.6,             // how long the reverse-out lasts
  search_back: 20,            // the nearest-point search window on the line, in samples behind ...
  search_ahead: 80,           // ... and ahead of the last nearest point
  reacquire_cm: 4000,         // further than this from the line: search the whole line again
  time_limit_s: 240,          // the sim gives up (refuses the ghost) when a lap takes longer than this after GO
});

export const AUTHORED = [
  'line: the READ landscape-spline centre line (data/road_spline.json) is evaluated with Unreal\'s FInterpCurve CIM_CurveUser maths and resampled every sample_cm by arc length (linear between 25 cm evaluations); the race starts at the line point nearest the READ player start and runs the way its READ yaw faces. The driver follows the centre; it does not cut corners',
  'line half-width per sample: the READ interp points\' Left/Right offsets, interpolated by distance between the two interp points nearest the sample (the sim refuses a lap that leaves it; the driver does not steer by it)',
  'line curvature: signed plan-view curvature of the circle through the samples curvature_span_cm either side (the spline is smooth, so a 4 m chord measures it without noise)',
  'steering: pure pursuit from the rear axle (READ wheel rest positions) to the line point lookahead_min_cm + lookahead_s x speed ahead (capped at lookahead_max_cm); the bicycle angle atan(wheelbase x curvature) is turned into a steering input by inverting the car\'s own READ steering (Ackermann angles, speed-scale curve, squared input curve)',
  'speed plan: corner speed sqrt(lat_g x g / curvature), crest speed sqrt(crest_g x g / vertical curvature), then braking distance brake_g x g backwards round the loop; the target is the lowest planned speed preview_s ahead',
  'pedals: full throttle when slower than the target by more than speed_band_cmps, proportional inside the band, coasting above it, and the brake pedal fully down when faster by more than brake_over_cmps (never below brake_min_cmps). Full, not partial: with the template\'s READ reverse-as-brake, Chaos turns ANY brake input into full braking while moving forward and selects reverse (chaos_vehicle.js CalcThrottleBrakeInput, UE ChaosVehicleMovementComponent.cpp:1017-1088), so a light touch is not a light brake. The handbrake is never used',
  'recovery: throttle on but slower than stall_cmps for stall_s = stalled (a wall, a spin); then brake (Chaos reverse-as-brake selects reverse) with opposite lock for reverse_s, and drive on',
  'progress: the nearest line sample is searched search_back..search_ahead samples round the last one (3D distance), the whole line when further than reacquire_cm',
  'every number in DRIVER is the page\'s own choice for this driver; none is a property of a car or the track',
  'tuning (2026-11-06, tools/sim_ghost.mjs on both template cars): lat_g/brake_g 0.85/0.75 lapped clean but slow (47.6 s / 50.4 s); both cars stayed clean up to 2.0/1.3 and both touched the tunnel wall at 2.4/1.4, so 1.7/1.2 keeps a margin (3 m or more inside the road edge); look-ahead and preview changed 20 to 30 % either way stay clean at 1.7/1.2. The template tyres\' READ friction_force_multiplier is 3 to 4, which is why more than 1 g corners',
];

// ------------------------------------------------------------------------------------------------ Unreal's curve maths
// FMath::CubicInterp, UE: Engine/Source/Runtime/Core/Public/Math/UnrealMathUtility.h:1212-1218, per component
export function cubicInterp(P0, T0, P1, T1, A) {
  const A2 = A * A, A3 = A2 * A;
  return P0.map((_, k) => ((2 * A3) - (3 * A2) + 1) * P0[k] + (A3 - (2 * A2) + A) * T0[k] + (A3 - A2) * T1[k] + ((-2 * A3) + (3 * A2)) * P1[k]);
}
// FInterpCurve::Eval between two CIM_CurveUser keys (InVal 0 and 1, so Diff = 1): UE: Core/Public/Math/InterpCurve.h:361-374
export const evalSegment = (h, a) => cubicInterp(h.p0, h.t0, h.p1, h.t1, a);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const need = (x, what) => { if (x === undefined || x === null || (typeof x === 'number' && !Number.isFinite(x))) throw new Error('ai_driver: ' + what + ' is missing'); return x; };

// ------------------------------------------------------------------------------------------------ the line
// spline: data/road_spline.json; track: data/track.json (player_start, gates). Returns the closed line in race order from the start.
export function buildRacingLine(spline, track, params = DRIVER) {
  const P = { ...DRIVER, ...params };
  if (!spline || !Array.isArray(spline.segments) || !spline.segments.length) throw new Error('ai_driver: road_spline has no segments');
  // 1. dense points along Unreal's curve, segment by segment in Unreal's chain order (the shared control point once)
  const dense = [];
  for (const s of spline.segments) {
    const h = need(s.hermite, 'road_spline segment ' + s.name + ' hermite');
    const n = Math.max(8, Math.ceil(dist(h.p0, h.p1) * 1.5 / 25));
    for (let i = dense.length ? 1 : 0; i <= n; i++) dense.push(evalSegment(h, i / n));
  }
  if (dist(dense[0], dense[dense.length - 1]) > 1) throw new Error('ai_driver: the road spline does not close');
  dense.pop();
  // the READ interp points (centre, half-widths) on the same chain, to carry the road width
  const C = need(spline.center, 'road_spline center'), Lf = need(spline.left, 'road_spline left'), Rt = need(spline.right, 'road_spline right');
  // 2. the race direction and the start: the dense point nearest the READ player start, the way its READ yaw faces
  const ps = need(track.player_start, 'track.player_start'), start = need(ps.location_cm, 'player_start.location_cm');
  const yaw = need(ps.yaw_deg, 'player_start.yaw_deg') * Math.PI / 180, fwd = [Math.cos(yaw), Math.sin(yaw), 0];
  let i0 = 0;
  for (let i = 1; i < dense.length; i++) if (dist(dense[i], start) < dist(dense[i0], start)) i0 = i;
  const N = dense.length, tan = sub(dense[(i0 + 1) % N], dense[(i0 - 1 + N) % N]);
  const forward = dot(tan, fwd) > 0;
  const ordered = [];
  for (let k = 0; k < N; k++) ordered.push(dense[forward ? (i0 + k) % N : (i0 - k + N) % N]);
  const startOffsetCm = dist(dense[i0], start);
  // 3. resample by arc length, every sample_cm (the last step closes the loop)
  const cum = [0];
  for (let k = 1; k <= N; k++) cum.push(cum[k - 1] + dist(ordered[k - 1], ordered[k % N]));
  const length = cum[N], n = Math.round(length / P.sample_cm), ds = length / n;
  const pts = [];
  for (let i = 0, j = 0; i < n; i++) {
    const s = i * ds;
    while (cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j]), a = ordered[j], b = ordered[(j + 1) % N];
    pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  // 4. curvature (plan view, signed: + turns right in Unreal's left-handed X/Y) and vertical curvature (- over a crest)
  const k = Math.max(1, Math.round(P.curvature_span_cm / ds));
  const kappa = [], kappaV = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - k + n) % n], b = pts[i], c = pts[(i + k) % n];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ac = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    kappa.push(2 * cr / (ab * bc * ac));
    kappaV.push((c[2] - 2 * b[2] + a[2]) / ((k * ds) * (k * ds)));
  }
  // 5. the road half-width at each sample: the READ interp points' offsets, between the two interp points nearest the sample
  const hwL = C.map((c, i) => dist(Lf[i], c)), hwR = C.map((c, i) => dist(Rt[i], c));
  const halfWidth = pts.map((p) => {
    let best = 0;
    for (let q = 1; q < C.length; q++) if (dist(C[q], p) < dist(C[best], p)) best = q;
    const nb = [(best + 1) % C.length, (best - 1 + C.length) % C.length].sort((x, y) => dist(C[x], p) - dist(C[y], p))[0];
    const d0 = dist(C[best], p), d1 = dist(C[nb], p), f = d0 / (d0 + d1 || 1);
    return Math.min(hwL[best] + (hwL[nb] - hwL[best]) * f, hwR[best] + (hwR[nb] - hwR[best]) * f);
  });
  return {
    pts, kappa, kappaV, halfWidth, n, ds, length,
    src: (spline.src ? spline.src.slice(0, 120) + '...' : 'road_spline.json') + '; evaluated with FInterpCurve CIM_CurveUser (InterpCurve.h:374), '
      + (forward ? 'in' : 'against') + ' Unreal\'s chain order, from the point ' + startOffsetCm.toFixed(0) + ' cm from the READ player start (see AUTHORED: line)',
  };
}

// the point at arc length s (wraps round the loop), linear between samples
export function lineAt(line, s) {
  const L = line.length, u = ((s % L) + L) % L, f = u / line.ds, i = Math.floor(f) % line.n, j = (i + 1) % line.n, t = f - Math.floor(f);
  const a = line.pts[i], b = line.pts[j];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// is a point inside a gate's box (READ center, yaw, half extents; the box stands upright)?
export function pointInGate(p, g) {
  const y = g.yaw_deg * Math.PI / 180, dx = p[0] - g.center_cm[0], dy = p[1] - g.center_cm[1];
  const lx = dx * Math.cos(y) + dy * Math.sin(y), ly = -dx * Math.sin(y) + dy * Math.cos(y);
  return Math.abs(lx) <= g.half_extent_cm[0] && Math.abs(ly) <= g.half_extent_cm[1] && Math.abs(p[2] - g.center_cm[2]) <= g.half_extent_cm[2];
}

// walk the line once from the start (sub-sample steps) and list where it enters each gate's box, in order
export function lineGateEntries(line, gates, stepCm = 25) {
  const inside = gates.map(() => false), out = [];
  for (let s = 0; s <= line.length; s += stepCm) {
    const p = lineAt(line, Math.min(s, line.length - 1e-6));
    gates.forEach((g, i) => { const now = pointInGate(p, g); if (now && !inside[i]) out.push({ gate: i, s }); inside[i] = now; });
  }
  return out;
}

// does following the line count every gate, in Next Marker order, and finish the lap? Judged by the ported Blueprint rules.
export function checkLineGates(line, gates, R) {
  const race = Rules.enableTimer(Rules.makeRace(gates, R), 0);
  const counted = [];
  for (const e of lineGateEntries(line, gates)) if (Rules.gateOverlapBegin(race, e.gate, e.s)) counted.push(e.gate);
  const expected = gates.map((_, k) => (race.finish + 1 + k) % gates.length);
  return { ok: race.laps === 1 && counted.length === gates.length && counted.every((g, k) => g === expected[k]), counted, expected, laps: race.laps };
}

// ------------------------------------------------------------------------------------------------ the speed plan
export function speedPlan(line, gravityZ, params = DRIVER) {
  const P = { ...DRIVER, ...params }, g = Math.abs(need(gravityZ, 'gravityZ'));
  const v = line.kappa.map((kp, i) => {
    let lim = Math.sqrt(P.lat_g * g / Math.max(Math.abs(kp), 1e-9));
    if (line.kappaV[i] < 0) lim = Math.min(lim, Math.sqrt(P.crest_g * g / -line.kappaV[i]));
    return lim;
  });
  const a = P.brake_g * g, n = line.n;
  for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % n] ** 2 + 2 * a * line.ds));
  return v;
}

// ------------------------------------------------------------------------------------------------ the driver
const CmSToMPH = (cms) => cms * 2236.94185 / 100000;     // UE: ChaosVehiclesCore/Public/VehicleUtility.h:199-202 (as chaos_vehicle.js)

export function makeDriver(line, v, params = DRIVER) {
  const P = { ...DRIVER, ...params }, c = need(v && v.cfg, 'vehicle cfg');
  const steered = c.wheels.filter((w) => w.steering), fixed = c.wheels.filter((w) => !w.steering);
  if (!steered.length || !fixed.length) throw new Error('ai_driver: pure pursuit needs steered and unsteered wheels');
  const mean = (ws, k) => ws.reduce((a, w) => a + w.rest[k], 0) / ws.length;
  const rearX = mean(fixed, 0), wheelbase = mean(steered, 0) - rearX;
  if (!(wheelbase > 0)) throw new Error('ai_driver: the steered wheels are not ahead of the others');
  const fn = c.rates.steering.fn;
  if (fn !== 0 && fn !== 1) throw new Error('ai_driver: steering input curve ' + fn + ' is not invertible here (LINEAR or SQUARED only)');
  // the car's bicycle angle (deg, mean of its steered wheels) for a normalised steering n in [-1, 1]: Chaos's own steering function
  const table = [];
  for (let q = 0; q <= 400; q++) { const n = -1 + q / 200; table.push([n, steered.reduce((a, w) => a + steeringAngle(c.steer, n, w.maxSteer, w.rest[1]), 0) / steered.length]); }
  for (let q = 1; q < table.length; q++) if (!(table[q][1] > table[q - 1][1])) throw new Error('ai_driver: the car\'s steering angle is not monotonic in its input');
  const plan = speedPlan(line, need(c.gravityZ, 'cfg.gravityZ'), P);
  const d = { P, line, plan, rearX, wheelbase, table, fn, speedGraph: c.steer.speedGraph, idx: nearest(line, v.pos, 0, line.n), mode: 'drive', stallT: 0, revT: 0,
              recoveries: 0, progress: 0, last: null };
  return d;
}

function nearest(line, p, from, count) {
  let best = -1, bd = Infinity;
  for (let k = 0; k < count; k++) { const i = (((from + k) % line.n) + line.n) % line.n, dd = dist(line.pts[i], p); if (dd < bd) { bd = dd; best = i; } }
  return best;
}

// the steering input that gives the bicycle angle deltaDeg at this speed (inverse of Chaos's steering: angle table, speed scale, input curve)
function steeringFor(d, deltaDeg, forwardSpeedCmS) {
  const t = d.table;
  let n;
  if (deltaDeg <= t[0][1]) n = -1; else if (deltaDeg >= t[t.length - 1][1]) n = 1;
  else { let q = 1; while (t[q][1] < deltaDeg) q++; const f = (deltaDeg - t[q - 1][1]) / (t[q][1] - t[q - 1][1]); n = t[q - 1][0] + (t[q][0] - t[q - 1][0]) * f; }
  const scale = graphEvaluateY(d.speedGraph, CmSToMPH(forwardSpeedCmS));     // UE: ChaosWheeledVehicleMovementComponent.cpp:726 (as chaos_vehicle.js)
  const want = Math.max(-1, Math.min(1, n / scale));
  return d.fn === 1 ? Math.sign(want) * Math.sqrt(Math.abs(want)) : want;      // SQUARED_FUNCTION: input x|input|; LINEAR: input
}

// one step: the vehicle state in, {throttle, brake, steering, handbrake} out. Call only while the rules enable input.
export function drive(d, v, dt) {
  const P = d.P, line = d.line;
  const [X, Y] = carAxes(v);
  const speed = v.forwardSpeedCmS;
  // progress along the line
  let i = nearest(line, v.pos, d.idx - P.search_back, P.search_back + P.search_ahead + 1);
  if (dist(line.pts[i], v.pos) > P.reacquire_cm) i = nearest(line, v.pos, 0, line.n);
  let step = i - d.idx; if (step > line.n / 2) step -= line.n; if (step < -line.n / 2) step += line.n;
  d.progress += step * line.ds; d.idx = i;
  // pure pursuit from the rear axle
  const Ld = Math.min(P.lookahead_max_cm, P.lookahead_min_cm + Math.abs(speed) * P.lookahead_s);
  const target = lineAt(line, i * line.ds + Ld);
  const rear = [0, 1, 2].map((k) => v.pos[k] + X[k] * d.rearX);
  const dv = sub(target, rear), xl = dot(dv, X), yl = dot(dv, Y);
  const delta = xl <= 0 ? Math.sign(yl || 1) * 90 : Math.atan(d.wheelbase * 2 * yl / (xl * xl + yl * yl)) * 180 / Math.PI;
  let steering = steeringFor(d, delta, speed);
  // the speed plan, preview_s ahead
  const ahead = Math.max(1, Math.ceil(Math.max(0, speed) * P.preview_s / line.ds));
  let vt = Infinity;
  for (let k = 0; k <= ahead; k++) vt = Math.min(vt, d.plan[(i + k) % line.n]);
  const e = vt - speed;
  let throttle, brake;
  if (e >= P.speed_band_cmps) { throttle = 1; brake = 0; }
  else if (e >= 0) { throttle = e / P.speed_band_cmps; brake = 0; }
  else { throttle = 0; brake = -e > P.brake_over_cmps && speed > P.brake_min_cmps ? 1 : 0; }
  // recovery: stalled with the throttle on -> reverse out with opposite lock
  if (d.mode === 'drive') {
    d.stallT = throttle > 0.5 && speed < P.stall_cmps ? d.stallT + dt : 0;
    if (d.stallT > P.stall_s) { d.mode = 'reverse'; d.revT = 0; d.recoveries++; }
  }
  if (d.mode === 'reverse') {
    d.revT += dt;
    throttle = 0; brake = 1; steering = -Math.sign(delta || 1);
    if (d.revT > P.reverse_s) { d.mode = 'drive'; d.stallT = 0; }
  }
  d.last = { i, Ld, delta, vt, speed, mode: d.mode };
  return { throttle, brake, steering, handbrake: 0 };
}
