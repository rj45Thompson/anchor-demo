// drag.js - the drag strip (UC-22): a quarter mile, the start tree, the timing slip and the shift coach. Pure: no DOM and no three,
// so the page and node (test/drag.test.mjs) run the same code. Units: Unreal's (cm, X forward, Z up) for the world; metres, km/h
// and seconds on the slip.
//
// READ / DERIVED / AUTHORED, each said here:
//   the distances are DERIVED from their definitions (1 ft = 0.3048 m exactly: 60 ft, 1/8 mile = 660 ft, 1/4 mile = 1320 ft);
//   the tree is READ: a Sportsman tree lights its three ambers 0.5 s apart and the green 0.5 s after the last; a foul (red light)
//   is crossing the line before the green (https://en.wikipedia.org/wiki/Christmas_tree_(drag_racing), read 2026-11-06);
//   the road grip is READ (data/track.json surface_friction.road, the template's own road);
//   the best shift point of each gear is DERIVED from the car's own torque curve and gear ratios (shiftPoints);
//   AUTHORED: the 1 ft roll-out before the clock starts (Dragy reports a "(1ft)" roll-out time beside its 0-100), the shift
//   grades' margins (GRADE), the shift light's span (LIGHT_SPAN_RPM), the pre-stage and stage times and the strip's width.
export const FT = 0.3048;
export const MARKS = { rollout: 1 * FT, sixty: 60 * FT, eighth: 660 * FT, quarter: 1320 * FT };   // metres
export const TREE = { prestage: 1.0, stage: 1.0, amber_gap: 0.5, green_after: 0.5, src: 'https://en.wikipedia.org/wiki/Christmas_tree_(drag_racing)' };
export const GRADE = { perfect_below: 250, perfect_above: 150, limiter_s: 0.15 };   // rpm either side of the best shift point; s on the limiter
export const LIGHT_SPAN_RPM = 1500;                                                  // the shift light fills over the last 1500 rpm
export const MOVE_M = 0.01;                                                          // AUTHORED: moved 1 cm = the car has started (Dragy's standstill start)

/** the strip's ground for the physics: a flat plane at z = 0 (cm) under the whole run, with the track's own road grip */
export function flatStrip(friction) {
  if (!(friction > 0)) throw new Error('drag.js: the strip needs the road friction (data/track.json surface_friction.road)');
  return {
    trace(s, e) {                      // the nearest hit of the segment s -> e on z = 0, as world.trace answers
      if (!(s[2] >= 0 && e[2] <= 0) || s[2] === e[2]) return null;
      const t = s[2] / (s[2] - e[2]);
      const len = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
      return { point: [s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t, 0], normal: [0, 0, 1], distance: len * t, friction };
    },
  };
}

/** the best upshift rpm of each gear: the rpm at which the next gear gives more wheel torque at the same road speed
 *  (torque(r) x ratio_n < torque(r x ratio_n+1 / ratio_n) x ratio_n+1), or the redline when this gear stays ahead to it.
 *  torqueAt(rpm) is the engine's full-throttle torque (the port's own curve); ratios are the forward gears (final drive
 *  cancels). DERIVED; the gear change's own torque gap (gear_change_time) is not counted, so the real best is a little later. */
export function shiftPoints(torqueAt, ratios, idleRPM, maxRPM) {
  if (!ratios.length || !(maxRPM > idleRPM)) throw new Error('drag.js: shiftPoints needs gear ratios and an rpm range');
  const out = [];
  for (let n = 0; n < ratios.length - 1; n++) {
    const k = ratios[n + 1] / ratios[n];
    let best = maxRPM;
    for (let r = idleRPM; r <= maxRPM; r += 10) {
      const next = r * k;
      if (next < idleRPM) continue;
      if (torqueAt(r) * ratios[n] < torqueAt(next) * ratios[n + 1]) { best = r; break; }
    }
    out.push(Math.round(best));
  }
  return out;                                               // out[g-1]: the best rpm to leave gear g
}

/** a shift's grade against the gear's best point: PERFECT within the margins, EARLY below, LATE above or after the limiter */
export function gradeShift(rpm, best, maxRPM, limiterS) {
  if (limiterS >= GRADE.limiter_s) return 'LATE';
  const top = best >= maxRPM - 1 ? maxRPM : best + GRADE.perfect_above;
  if (rpm < best - GRADE.perfect_below) return 'EARLY';
  if (rpm > top) return 'LATE';
  return 'PERFECT';
}

/** the shift light: 0 (off) to 1 (all lit) over the LIGHT_SPAN_RPM before the gear's best point; 'shift' at or past it */
export function shiftLight(rpm, best) {
  if (rpm >= best) return { fill: 1, shift: true };
  return { fill: Math.max(0, Math.min(1, 1 - (best - rpm) / LIGHT_SPAN_RPM)), shift: false };
}

/** one run: the tree, the launch, the timing marks, the shifts. tick() is fed the physics' own distance and speed each step */
export function makeRun() {
  return { t: 0, phase: 'prestage', green: null, foul: false, leave: null, move: null, marks: {}, speeds: {}, kmh100: null, kmh100s: null, quarterAt: null, shifts: [], limiter: 0,
           tree: { prestage: false, stage: false, ambers: 0, green: false, red: false }, done: false, dist0: null };
}
export function treeAt(run) {                               // what the tree shows at the run's clock
  const T = TREE, t = run.t;
  const ambersFrom = T.prestage + T.stage;
  run.tree.prestage = t >= 0; run.tree.stage = t >= T.prestage;
  run.tree.ambers = t < ambersFrom ? 0 : Math.min(3, 1 + Math.floor((t - ambersFrom) / T.amber_gap));
  const greenAt = ambersFrom + 2 * T.amber_gap + T.green_after;
  run.greenAt = greenAt;                                    // when the green lights (or would have, after a foul)
  run.tree.green = t >= greenAt && !run.foul;
  run.tree.red = run.foul;
  return greenAt;
}
/** s: { dt, distM (along the strip from the start line), speedKmh, rpm, gear, maxRPM }. Returns the events of this step */
export function tick(run, s) {
  const ev = [];
  run.t += s.dt;
  const greenAt = treeAt(run);
  if (run.green === null && run.t >= greenAt) { run.green = greenAt; if (!run.foul) ev.push('green'); }
  if (run.dist0 === null) run.dist0 = s.distM;
  const d = s.distM - run.dist0;
  if (run.move === null && d >= MOVE_M) run.move = run.t;                 // the first motion: where Dragy starts its 0-100
  if (run.leave === null && d >= MARKS.rollout) {
    run.leave = run.t;
    if (run.green === null || run.t < run.green) { run.foul = true; run.tree.red = true; run.tree.green = false; ev.push('red'); }
    run.phase = 'running'; ev.push('leave');
  }
  if (run.leave !== null && !run.done) {
    const et = run.t - run.leave;
    for (const k of ['sixty', 'eighth', 'quarter']) {
      if (run.marks[k] === undefined && d >= MARKS[k]) { run.marks[k] = et; run.speeds[k] = s.speedKmh; ev.push(k); if (k === 'quarter') run.quarterAt = run.t - run.move; }
    }
    if (run.kmh100 === null && s.speedKmh >= 100) { run.kmh100 = et; run.kmh100s = run.t - run.move; ev.push('100'); }
    if (s.rpm >= s.maxRPM - 1) run.limiter += s.dt; else if (s.gear !== run.lastGear) run.limiter = 0;
    if (run.marks.quarter !== undefined) { run.done = true; run.phase = 'finished'; ev.push('finish'); }
  }
  run.lastGear = s.gear;
  return ev;
}
/** an upshift press: graded against the gear it leaves */
export function noteShift(run, gear, rpm, best, maxRPM) {
  const g = gradeShift(rpm, best, maxRPM, run.limiter);
  run.shifts.push({ from: gear, rpm: Math.round(rpm), best, grade: g });
  run.limiter = 0;
  return g;
}
/** the slip's lines, as a drag strip prints them */
export function slip(run) {
  const rt = run.leave !== null && run.greenAt !== undefined ? run.leave - run.greenAt : null;   // negative: left before the green
  return { reaction_s: rt, foul: run.foul, sixty_s: run.marks.sixty ?? null, kmh100_s: run.kmh100, kmh100_standing_s: run.kmh100s, eighth_s: run.marks.eighth ?? null, eighth_kmh: run.speeds.eighth ?? null,
           quarter_s: run.marks.quarter ?? null, quarter_standing_s: run.quarterAt, quarter_kmh: run.speeds.quarter ?? null, shifts: run.shifts };
}

/** the sim's own best run: on green, full throttle, every upshift at its derived point, one press each, on the port's physics
 *  (the page shows it beside the visitor's run, the test holds it to the marks). Chaos is the port module; v a fresh vehicle on
 *  the strip, settled; returns the slip and the shift points */
export function bestRun(Chaos, v, world) {
  const best = carShiftPoints(Chaos, v);
  return { slip: runShiftingAt(Chaos, v, world, best, best), points: best };
}
/** the house run every car's board starts with (UC-25.2): the same car and physics as bestRun, every upshift at the late edge of
 *  PERFECT (the light's point plus GRADE.perfect_above, at most the redline), so a run shifted on the light beats it. Not the
 *  early edge: 11-07 a sweep found shifting EARLY quicker than the light on the E 63 S, the i8 and the 911 (the E 63 S 500 rpm
 *  early: 10.750 s against 10.825 s), so an early-edge house run beat the light on those three. DERIVED from the car's own torque
 *  curve and gear ratios; GRADE's margin is AUTHORED (above) */
export function houseRun(Chaos, v, world) {
  const best = carShiftPoints(Chaos, v), at = best.map((p) => Math.min(p + GRADE.perfect_above, v.cfg.engine.maxRPM));
  return { slip: runShiftingAt(Chaos, v, world, at, best), points: at };
}
function carShiftPoints(Chaos, v) {
  const c = v.cfg, torque = (r) => Chaos._internal.engineTorqueFromRPM(v, r, true);
  return shiftPoints(torque, c.trans.forward, c.engine.idleRPM, c.engine.maxRPM);
}
/** on green, full throttle, one press per upshift as the rpm reaches at[gear-1]; each shift graded against best[gear-1] */
function runShiftingAt(Chaos, v, world, at, best) {
  const c = v.cfg, DT = Chaos._internal.SUBSTEP, idle = { throttle: 0, brake: 0, steering: 0, handbrake: 0, transmission: 'manual' };
  const run = makeRun(), x0 = v.pos[0];
  for (let i = 0; i < 120 * 60 && !run.done; i++) {
    const green = run.green !== null, gear = v.trans.target, rpm = v.trans.engineRPM;
    const up = green && gear >= 1 && gear < c.trans.forward.length && v.trans.current === gear && rpm >= at[gear - 1];
    if (up) noteShift(run, gear, rpm, best[gear - 1], c.engine.maxRPM);
    Chaos.stepVehicle(v, Object.assign({}, idle, { throttle: green ? 1 : 0, gearUp: up }), DT, world);
    tick(run, { dt: DT, distM: (v.pos[0] - x0) / 100, speedKmh: v.forwardSpeedCmS * 0.036, rpm: v.trans.engineRPM, gear: v.trans.target, maxRPM: c.engine.maxRPM });
  }
  if (!run.done) throw new Error('drag.js: the run did not reach the quarter mile in 60 s');
  return slip(run);
}
