// drag_replay.js - UC-46: a drag run as a tape of the inputs the sim took, step by step, so the run can be run again in the page's own
// sim (chaos_vehicle.js) and its time checked before a prize goes out (tools/verify_claim.mjs). The page records every fixed step of
// tickDrag from the staged car to the quarter mile. A tape holds inputs only, never a time: the time is what the sim makes of them,
// so a tape cannot claim a time its inputs do not drive.
// Rows are run-length coded: [n, throttle, brake, steering, clutch, gear, press, armed], n steps alike. A gearbox without a clutch
// writes clutch and gear as null (its input has neither). Numbers are kept exactly: JSON round-trips a finite double, and -0 is
// written as 0 both in the tape and in the input the live sim takes (inputOf builds both), so the two runs see the same numbers.
//
// Pure (no three, no page): test/drag_replay.test.mjs runs a tape recorded here against the sim in node.

export const TAPE = { version: 1, maxChars: 45000 };   // AUTHORED: a claim stores the tape in one Google Sheets cell, which holds at most 50,000 characters (READ: Google's sheet limits)
export const STAGE_SETTLE_STEPS = 240;                 // the staged car settles on its springs before the run (app.js startDrag, as it always has)
const PRESS = { up: 1, down: 2 };
const num = (x, what) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('drag_replay: the ' + what + ' is not a finite number (' + x + ')'); return x + 0; };   // x + 0: -0 becomes 0

/** meta: { car (the sim car's key), clutch (the clutch gearbox, UC-34), road ('wet' | 'dry' with the clutch, else null) } */
export function makeTape(meta) {
  if (!meta || typeof meta.car !== 'string' || !meta.car) throw new Error('drag_replay: a tape needs its car');
  const clutch = !!meta.clutch;
  if (clutch && meta.road !== 'wet' && meta.road !== 'dry') throw new Error('drag_replay: a clutch tape needs its road, wet or dry');
  return { v: TAPE.version, car: meta.car, clutch, road: clutch ? meta.road : null, rows: [] };
}

/** the input the sim takes for a row (the live run and a replay both build theirs here) */
export function inputOf(tape, row) {
  const i = { throttle: row[1], brake: row[2], steering: row[3], handbrake: 0, transmission: 'manual', gearUp: row[6] === PRESS.up, gearDown: row[6] === PRESS.down };
  if (tape.clutch) { i.clutch = row[4]; i.gear = row[5]; i.road = tape.road; }
  return i;
}

/** records one step and returns the input the sim must take for it. input: tickDrag's input this frame; press: 'up', 'down' or
 *  undefined (the step's queued paddle press); armed: the tree has been started (its clock runs) */
export function recordStep(tape, input, press, armed) {
  if (tape.clutch && input.road !== tape.road) throw new Error('drag_replay: the road changed mid-run (' + tape.road + ' to ' + input.road + ')');
  if (!tape.clutch && (input.clutch !== undefined || input.gear !== undefined)) throw new Error('drag_replay: a clutch input on a paddle tape');
  if (press !== undefined && !PRESS[press]) throw new Error('drag_replay: an unknown press ' + press);
  const row = [1, num(input.throttle, 'throttle'), num(input.brake, 'brake'), num(input.steering, 'steering'),
    tape.clutch ? num(input.clutch, 'clutch') : null, tape.clutch ? num(input.gear, 'gear') : null, PRESS[press] || 0, armed ? 1 : 0];
  const last = tape.rows[tape.rows.length - 1];
  if (last && row.every((x, k) => k === 0 || x === last[k])) last[0]++; else tape.rows.push(row);
  return inputOf(tape, row);
}

export function steps(tape) { return tape.rows.reduce((n, r) => n + r[0], 0); }
export function encode(tape) { return JSON.stringify(tape); }

/** a tape from its text, every field checked; throws with the reason in words */
export function decode(text) {
  let t; try { t = JSON.parse(text); } catch (e) { throw new Error('drag_replay: the tape is not JSON'); }
  if (!t || t.v !== TAPE.version) throw new Error('drag_replay: not a version ' + TAPE.version + ' tape');
  if (typeof t.car !== 'string' || !/^[a-z0-9_]{1,64}$/.test(t.car)) throw new Error('drag_replay: the tape names no car');
  if (typeof t.clutch !== 'boolean') throw new Error('drag_replay: the tape does not say its gearbox');
  if (t.clutch ? t.road !== 'wet' && t.road !== 'dry' : t.road !== null) throw new Error('drag_replay: the tape\'s road does not fit its gearbox');
  if (!Array.isArray(t.rows) || !t.rows.length) throw new Error('drag_replay: the tape has no steps');
  for (const r of t.rows) {
    const ok = Array.isArray(r) && r.length === 8 && Number.isInteger(r[0]) && r[0] >= 1 && [1, 2, 3].every((k) => Number.isFinite(r[k])) &&
      (t.clutch ? Number.isFinite(r[4]) && Number.isInteger(r[5]) : r[4] === null && r[5] === null) && [0, 1, 2].includes(r[6]) && (r[7] === 0 || r[7] === 1);
    if (!ok) throw new Error('drag_replay: a malformed row ' + JSON.stringify(r).slice(0, 80));
  }
  return t;
}

/** where a car stages: its nose on the start line, in the left lane (cm, Unreal axes) */
export function stagePoint(carJson, laneY) { const B = carJson.bounds_cm.value; return [-(B.origin[0] + B.box_extent[0]), laneY, 60]; }
/** a vehicle reset at the stage and settled on its springs, as every drag run starts (app.js startDrag) */
export function settle(Chaos, v, stage, strip, step) {
  Chaos.resetVehicle(v, stage, 0);
  for (let i = 0; i < STAGE_SETTLE_STEPS; i++) Chaos.stepVehicle(v, { throttle: 0, brake: 0, steering: 0, handbrake: 0, transmission: 'manual' }, step, strip);
  return v;
}

/** runs a tape again, as tickDrag ran it. w: { Chaos, Drag, carJson, opts (makeVehicle's), strip, laneY, step }. Returns { slip
 *  (Drag.slip), steps (run), done (the quarter was reached) } */
export function runTape(tape, w) {
  const v = settle(w.Chaos, w.Chaos.makeVehicle(w.carJson, w.opts), stagePoint(w.carJson, w.laneY), w.strip, w.step);
  const run = w.Drag.makeRun(), x0 = v.pos[0], maxRPM = v.cfg.engine.maxRPM;
  let n = 0;
  for (const row of tape.rows) {
    for (let i = 0; i < row[0]; i++) {
      w.Chaos.stepVehicle(v, inputOf(tape, row), w.step, w.strip);   // a fresh object each step, as the live run hands the sim
      w.Drag.tick(run, { dt: row[7] ? w.step : 0, distM: (v.pos[0] - x0) / 100, speedKmh: v.forwardSpeedCmS * 0.036, rpm: v.trans.engineRPM, gear: v.trans.target, maxRPM });
      n++;
      if (run.done) return { slip: w.Drag.slip(run), steps: n, done: true };
    }
  }
  return { slip: w.Drag.slip(run), steps: n, done: false };
}
