// traction.js - the launch traction bar's measurement (UC-39): the driven tyres' slip read off the port's own tyre model, and the
// engine's bog read off the car's own torque curve. Pure: no DOM, no three; the page and node (test/traction.test.mjs) run the
// same code. Reads a vehicle made by chaos_vehicle.js after a stepVehicle; writes nothing to it. Units: Unreal's (cm, s), rpm.
//
// TWO TYRE MODELS, as the step ran (v.tyreCurve, set by chaos_vehicle.js each step):
//
// WITH THE CLUTCH (v.tyreCurve true): THE SLIP CURVE, chaos_vehicle.js A12 (UC-39). A driven tyre's road force is its grip G times
// Pacejka's Magic Formula shape of its slip, the shape READ (MathWorks, 'Tire-Road Interaction (Magic Formula)'; chaos_vehicle.js
// TYRES, research/TYRE_CURVE.md), its row the step's road (A13, UC-40.2, input.road; v.road, null when the step named none):
//   row           Dry tarmac B 10, C 1.9, E 0.97 (TYRE: no road named, or 'dry'); Wet tarmac B 12, C 2.3, E 1 (TYRE_WET, 'wet')
//   G             no road named: A12's, load x friction x FrictionForceMultiplier; a road named: the curve's own, D x load x friction
//   slip          k = (omega x Re - ground speed) / max(|ground speed|, VXLOW 1 m/s), within -1.5..1.5   v.wheels[i].slipRatio
//   road force    G x shape(k); shape rises from 0 to exactly 1 at the peak slip and falls past it   chaos_vehicle.js magicShape
//   the wheel     turns by the torque the road does not take (I dOmega/dt = drive - Re x force)      chaos_vehicle.js tyreSpin
// THE BAND is the active row's rising side, slip in [0, kPeak], kPeak DERIVED from that row's READ B, C, E (chaos_vehicle.js
// TYRE.kPeak 0.1802 dry, TYRE_WET.kPeak 0.0882 wet): there more slip gives more force. Past it the force falls as the slip grows:
// the tyre is spinning, and a wheel asked for more than its grip runs away up the falling side (the wet row falls to 0.78 of its
// peak at k = 1, the dry to 0.91). The slip and the row are read off the vehicle as the step left them (v.wheels[i].slipRatio,
// v.tyre = the row, set by chaos_vehicle.js each clutch step); no import, so the page still loads the physics module when it asks.
//
// WITH THE PADDLES (no clutch, v.tyreCurve false): THE TEMPLATE'S GRIP-LIMITED TYRE, Unreal's own (chaos_vehicle.js wheelSimulate
// = UE Core/Private/WheelSystem.cpp:54-247), not a slip curve:
//   asked force   F = DriveTorque / Re                                    (WheelSystem.cpp:80-81)
//   grip          G = load x surface friction x FrictionForceMultiplier   (WheelSystem.cpp:84)
//   F > G: the excess torque (F - G) x Re goes to spinning the wheel      (WheelSystem.cpp:114-125)
//   the road force is F, clipped to G by the friction circle and then
//   multiplied by SideSlipModifier once clipped                           (WheelSystem.cpp:177-198)
//   omega = ground speed / Re + clamp(excess x dt / I, +-MaxWheelspin)    (WheelSystem.cpp:209-222)
//   slip = omega x Re - ground speed (cm/s); slipping past SlipThreshold  (UE Core/Public/WheelSystem.h:319-327, 386-396)
// The force has NO peak in slip: it saturates at the grip. Its band is where the tyre is at its grip AND the sim does not call it
// slipping: slip in [0, SlipThreshold] cm/s, SlipThreshold READ per wheel (wheels[i].setup.slip_threshold, its own src).
//
// Either way, left of the band the tyre has grip to spare: the drive falls short of the grip, read as F / G - 1 (-1 no drive, 0 at
// the grip). F and G are the vehicle's own per-step values (v.w[i].drive, .Re, .grip).
//
// THE BOG, READ: FillEngineSetup samples engine.torque_curve at 21 points over 0..max_rpm (chaos_vehicle.js:325-329 = UE
// ChaosWheeledVehicleMovementComponent.h:292-298) and the engine's torque IS that graph (chaos_vehicle.js:614-620 = UE
// EngineSystem.cpp:29-42, EngineSystem.h:99-107). bogRPM = the lowest rpm at which that graph reaches its peak; under it the curve
// falls away toward idle. Per car: E 63 S 2800, i8 3500, 911 4500, Ghost / Wraith / Flying Spur 1750 rpm.
//
// AUTHORED (each a definition, no number chosen):
//   - "bogging" = the engine turning under bogRPM while it drives the wheels (UC-39.3: "the revs fall under the speed it pulls
//     from"); a stalled engine (chaos_vehicle.js:682-684) reads 'bog' too, it is where a held bog ends (UC-34.3a).
//   - the bar's one axis joins the two READ sides at the grip: F / G - 1 left of it, the slip over the band's edge in and past the
//     band (|k| / kPeak on the curve, slip / SlipThreshold on the paddles), so the band is [0, 1] on every car and wheel (bar.band);
//     its right end is where the model stops the slip: on the curve min(KPUMAX, MaxWheelspin x Re / max(|ground speed|, VXLOW)) / kPeak,
//     on the paddles MaxWheelspin x Re / SlipThreshold.
//   - on the curve 'spin' is a driven tyre past the curve's peak slip; on the paddles it is the sim's own slipping flag.
//   - the bar reads the driven tyre furthest along that axis (the first to spin); a tyre that is braking (brake > |drive|, the
//     model's own test, chaos_vehicle.js:810) or off the ground is not read.
//   - 'idle' = no driven tyre on the ground taking drive (neutral, the clutch on the floor, off the gas, in the air).

/** the rpm under which the car's torque, as the engine runs it, falls away from its peak (READ, see the header) */
export function bogRPM(v) {
  if (!v.engine) throw new Error('traction.js: the vehicle has no engine (mechanical sim off): nothing to bog');
  const g = v.cfg.engine.graph;
  const i = g.indexOf(Math.max(...g));
  return i * v.cfg.engine.maxRPM / (g.length - 1);         // the graph's step, as normalisedGraphValue reads it (chaos_vehicle.js:217)
}

/** one driven tyre on the model's own numbers this step; null for a wheel the engine does not drive */
export function tyre(v, i) {
  const w = v.w[i], cw = v.cfg.wheels[i], pub = v.wheels[i];
  if (!w.engine) return null;
  const asked = Math.abs(w.drive) / w.Re;                      // F (kg cm/s^2), the drive asked of the road
  const ground = w.inContact && w.grip > 0;
  const driving = ground && w.drive !== 0 && !(w.brake > Math.abs(w.drive));
  const demand = ground ? asked / w.grip : null;               // F / G: 1 = the grip
  if (v.tyreCurve) {                                           // with the clutch: the slip curve (chaos_vehicle.js A12), the step's row (A13)
    const T = v.tyre, k = pub.slipRatio, peak = T.kPeak, over = Math.abs(k) > peak;   // the slip as A12 read it, published
    const bar = demand === null ? null : over ? Math.abs(k) / peak : demand < 1 ? demand - 1 : Math.abs(k) / peak;
    const kMax = Math.min(T.KPUMAX, cw.maxSpin * w.Re / Math.max(Math.abs(w.ground[0]), T.VXLOW_CMS));
    return { i, model: 'curve', slip: k, demand, bar, band: [0, peak], slipping: over, ground, driving, barMax: kMax / peak, src: T.src };
  }
  if (!(cw.slipThreshold > 0)) throw new Error('traction.js: wheel ' + i + ' slip_threshold ' + cw.slipThreshold + ' is no band edge');
  const slip = pub.slipCmS;                                    // omega x Re - ground speed (cm/s)
  const bar = demand === null ? null : demand < 1 ? demand - 1 : Math.abs(slip) / cw.slipThreshold;
  return { i, model: 'grip', slip, demand, bar, band: [0, cw.slipThreshold], slipping: pub.slipping, ground, driving,
           barMax: cw.maxSpin * w.Re / cw.slipThreshold, src: v.src['wheels[' + i + '].setup.slip_threshold'] };
}

/** the bar's reading this frame: { slip (cm/s), band [lo, hi] (cm/s), state, bar (the one axis), ... } of the tyre it reads */
export function traction(v) {
  if (!v.engine) throw new Error('traction.js: the vehicle has no engine (mechanical sim off)');
  const tyres = v.w.map((_, i) => tyre(v, i)).filter((t) => t !== null);
  if (!tyres.length) throw new Error('traction.js: no wheel is driven by the engine');
  const bog = bogRPM(v), rpm = v.engine.rpm;
  const read = tyres.filter((t) => t.driving);
  const lead = read.reduce((a, t) => (a === null || t.bar > a.bar ? t : a), null);
  let state;
  if (v.stalled) state = 'bog';
  else if (lead === null) state = 'idle';
  else if (read.some((t) => t.slipping)) state = 'spin';      // past the curve's peak slip; on the paddles the sim's own flag
  else if (rpm < bog) state = 'bog';
  else state = 'grip';
  const zone = lead === null ? null : lead.bar < 0 ? 'under' : lead.bar <= 1 ? 'band' : 'over';
  return {
    state, zone, stalled: v.stalled, rpm, bogRPM: bog,
    model: v.tyreCurve ? 'curve' : 'grip', road: v.tyreCurve ? v.road : null, slip: lead ? lead.slip : null, band: lead ? lead.band : null, demand: lead ? lead.demand : null,
    bar: lead ? lead.bar : null, barBand: [0, 1], barRange: lead ? [-1, lead.barMax] : null,
    wheel: lead ? lead.i : null, tyres,
  };
}

/** UC-39.5: how long the launch spent spinning, bogging, gripping, idle, and in the band */
export function makeTally() { return { spin: 0, bog: 0, grip: 0, idle: 0, band: 0 }; }
export function tally(t, reading, dt) {
  t[reading.state] += dt;
  if (reading.zone === 'band') t.band += dt;
  return t;
}
