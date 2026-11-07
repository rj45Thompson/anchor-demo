// chaos_vehicle.js - Unreal Engine 5.7 Chaos wheeled-vehicle simulation, ported to one plain ES module (no imports; browser + node).
// Serves UC-2.2 (USE_CASES.md): "The car accelerates by its torque curve, gear ratios and wheel radius READ from Unreal".
//
// Every formula and constant carries `// UE: <file>:<line>`. Paths are short forms of:
//   Core  = Engine/Source/Runtime/Experimental/ChaosVehicles/ChaosVehiclesCore/{Private,Public}
//   Glue  = Engine/Plugins/Experimental/ChaosVehiclesPlugin/Source/ChaosVehicles/{Private,Public}
//   Math  = Engine/Source/Runtime/Core/Public/Math ; Curves = Engine/Source/Runtime/Engine/{Private,Classes}/Curves
// Every car number comes from carJson (ue_out/cars.json, READ out of the Unreal assets) or opts.unexported
// (data/chaos_unexported.json, READ by tools/ue_unexported.mjs from the .uasset files for the properties cars.json lacks).
// A field missing from both, or carrying an error marker, throws with its path. Stand-ins are listed in AUTHORED.
// Units are Unreal's: cm, kg, s; X forward, Y right, Z up. Forces are kg*cm/s^2, torques kg*cm^2/s^2 (as Chaos uses them).
// Arithmetic is double precision; Unreal uses float (where float accumulation decides a loop count, Math.fround mirrors it).

export const AUTHORED = [
  'A1 rigid body: semi-implicit Euler with a Rodrigues rotation update stands in for the Chaos PBD rigid-body solver; no body linear damping (the physics asset body instance\'s LinearDamping is ABSENT); angular damping is the ported Blueprint value (opts), applied by Chaos\'s ether-drag rule',
  'A2 fixed 1/120 s substeps inside stepVehicle; the game-thread half of Chaos (UpdateState input rates + reverse-as-brake gear logic) is run once per substep, where Unreal runs it once per game frame',
  'A3 suspension force: Chaos\'s force-based path (taken when p.Vehicle.DisableConstraintSuspension=1, ChaosWheeledVehicleMovementComponent.cpp:648-651); UE 5.7\'s default instead solves an FSuspensionConstraint inside the PBD solver (PBDSuspensionConstraints.cpp:357-480, stiffness SpringRate*100*0.25, damping DampingRatio*5, hard stop), which needs the Chaos solver itself',
  'A4 inertia tensor: a solid box of READ bounds_cm (full size) and READ mass, times READ inertia_tensor_scale; Chaos uses the physics asset shapes (ABSENT)',
  'A5 center of mass when enable_center_of_mass_override is false: the READ bounds_cm origin (the physics asset mass properties are ABSENT); when true, COMNudge (a physics asset body field, ABSENT) is taken as zero',
  'A6 body frame = actor frame: wheel rest positions are the READ bone_location (actor space) + offset + additional_offset; Chaos measures them relative to the physics asset root body bone (ABSENT), equal only if that bone sits at the actor origin',
  'A7 chassis-vs-ground contact: 8 corners of a box (READ bounds_cm X/Y and top, bottom at the highest READ wheel-centre height), each traced from the centre of mass with world.trace; velocity impulse with restitution 0, Coulomb friction using the hit\'s friction, and a position push-out of the deepest corner; Chaos collides the physics asset shapes (ABSENT)',
  'A8 vehicle sleeping (ProcessSleeping, sleep_threshold, sleep_slope_limit) is not simulated: the body never sleeps',
  'A10 a gear press (input.gearUp / gearDown) reaches the gearbox once, on the next substep; Unreal applies GearUpInput on every physics tick it is held (ChaosWheeledVehicleMovementComponent.cpp:769-779)',
  'A11 a friction clutch between the engine and the gearbox (UC-34), only when the input names one (input.clutch: 0 the pedal up .. 1 the floor; input.gear: the gate\'s gear, set at once by the driver\'s hand; without them every step is as before). Locked, the step is Unreal\'s own. Slipping, it passes its hold (CLUTCH_STRENGTH x (1 - clutch) x the engine\'s maximum torque, from ClutchModule.cpp:30\'s ClutchValue) signed by which side spins faster: that torque loads the free-running engine (EngineSystem.cpp\'s free branch) and drives the wheels through the gearbox (TorqueSimModule.cpp:40). It locks when the two speeds meet with the engine\'s torque within its hold, and slips when the pedal takes the hold under the torque. An engine dragged under STALL_FRACTION of its idle stalls (Wikipedia, Stall (engine), rev 1349070313). Unreal\'s wheeled path, the template\'s, has no clutch: this is its modular system\'s clutch, ported onto that path',
  'A9 suspension hard stop: when a wheel compresses past suspension_max_raise, a frictionless contact at the wheel stops the approach and pushes the body out (push-out capped at the READ Chaos CVars min(MaxPushout 5 cm, MaxPushoutVelocity 100 cm/s * dt)), with the constraint geometry; it stands in for the hard-stop manifold of FPBDSuspensionConstraints (PBDSuspensionConstraints.cpp:213-293), which the PBD solver iterates',
];

// ------------------------------------------------------------------------------------------------ constants
const UE_PI = 3.1415926535897932;          // UE: Math/UnrealMathUtility.h:129
const SMALL_NUMBER = 1.e-8;                // UE: Math/UnrealMathUtility.h:130
const KINDA_SMALL_NUMBER = 1.e-4;          // UE: Math/UnrealMathUtility.h:131
const HALF_PI = 1.57079632679;             // UE: Math/UnrealMathUtility.h:151
const TWO_PI = 6.28318530717;              // UE: Math/UnrealMathUtility.h:152
const MAX_FLT = 3.402823466e+38;           // UE: FRealCurve DefaultValue(MAX_flt), Curves/RealCurve.h:130
const NUM_SUS_AVERAGING = 10;              // UE: Core/Public/SuspensionSystem.h:25
const SUBSTEP = 1 / 120;                   // AUTHORED: A2 fixed substep

const RPMToOmega = (rpm) => rpm * UE_PI / 30;                      // UE: Core/Public/VehicleUtility.h:175-178
const OmegaToRPM = (w) => w * 30 / UE_PI;                          // UE: Core/Public/VehicleUtility.h:181-184
const CmSToMPH = (cms) => cms * 2236.94185 / 100000;               // UE: Core/Public/VehicleUtility.h:199-202
const CmToM = (cm) => cm * 0.01;                                   // UE: Core/Public/VehicleUtility.h:223-226
const MToCmScaling = () => 100;                                    // UE: Core/Public/VehicleUtility.h:164-167
const MToCm = (m) => m * 100;                                      // UE: Core/Public/VehicleUtility.h:235-238
const Cm2ToM2 = (c) => c / (100 * 100);                            // UE: Core/Public/VehicleUtility.h:272-275
const DegToRad = (d) => d * UE_PI / 180;                           // UE: Core/Public/VehicleUtility.h:277-280
const RadToDeg = (r) => r * 180 / UE_PI;                           // UE: Core/Public/VehicleUtility.h:282-285
const Sqr = (x) => x * x;                                          // UE: Core/Public/VehicleUtility.h:287-290
const TorqueMToCm = (t) => t * 10000;                              // UE: Core/Public/VehicleUtility.h:292-295
const TorqueCmToM = (t) => t / 10000;                              // UE: Core/Public/VehicleUtility.h:297-300
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);      // FMath::Clamp
const toInt = (x) => Math.trunc(x);                                // C++ float -> int/uint16/uint32 conversion truncates
const modfFrac = (x) => x - Math.trunc(x);                         // UE: FMath::Modf = modff (GenericPlatformMath.h:467-470)

// ------------------------------------------------------------------------------------------------ vectors (FVector)
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];   // FVector::CrossProduct
const len = (a) => Math.sqrt(dot(a, a));
function safeNormal(a) {                                           // UE: Math/Vector.h:2060-2074 GetSafeNormal(UE_SMALL_NUMBER)
  const s = dot(a, a);
  if (s === 1) return a.slice();
  if (s < SMALL_NUMBER) return v3();
  return scl(a, 1 / Math.sqrt(s));
}
// 3x3 row-major; columns are the body X (forward), Y (right), Z (up) axes in world. FTransform::TransformVector = R*v.
const mulMV = (m, a) => [m[0][0] * a[0] + m[0][1] * a[1] + m[0][2] * a[2], m[1][0] * a[0] + m[1][1] * a[1] + m[1][2] * a[2], m[2][0] * a[0] + m[2][1] * a[1] + m[2][2] * a[2]];
const mulMtV = (m, a) => [m[0][0] * a[0] + m[1][0] * a[1] + m[2][0] * a[2], m[0][1] * a[0] + m[1][1] * a[1] + m[2][1] * a[2], m[0][2] * a[0] + m[1][2] * a[1] + m[2][2] * a[2]];
const axis = (m, c) => [m[0][c], m[1][c], m[2][c]];               // FTransform::GetUnitAxis(EAxis::X/Y/Z)
// FRotator(0, Yaw, 0): UE: Math/RotationTranslationMatrix.h:72-85 (rows = images of X, Y, Z); Core/Private/Math/UnrealMath.cpp:565-574
function rotateYaw(yawDeg, a) {
  const S = Math.sin(DegToRad(yawDeg)), C = Math.cos(DegToRad(yawDeg));
  return [a[0] * C - a[1] * S, a[0] * S + a[1] * C, a[2]];          // RotateVector = V * M
}
function unrotateYaw(yawDeg, a) {
  const S = Math.sin(DegToRad(yawDeg)), C = Math.cos(DegToRad(yawDeg));
  return [a[0] * C + a[1] * S, -a[0] * S + a[1] * C, a[2]];         // UnrotateVector = V * M^T
}
function yawMatrix(yawDeg) {
  const S = Math.sin(DegToRad(yawDeg)), C = Math.cos(DegToRad(yawDeg));
  return [[C, -S, 0], [S, C, 0], [0, 0, 1]];                        // columns = rotated X, Y, Z (RotationTranslationMatrix.h:72-85)
}

// ------------------------------------------------------------------------------------------------ input reading (no fallbacks)
function leafAt(obj, path) {
  let o = obj;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (o === null || typeof o !== 'object' || !(part in o)) return undefined;
    o = o[part];
  }
  return o;
}
function makeReader(carJson, unexported) {
  const src = {};
  return {
    src,
    need(path) {
      const a = leafAt(carJson, path), b = unexported ? unexported[path] : undefined;
      if (a !== undefined && b !== undefined) throw new Error('chaos_vehicle: ' + path + ' is in both cars.json and opts.unexported');
      const leaf = a !== undefined ? a : b;
      if (leaf === undefined) throw new Error('chaos_vehicle: missing input field ' + path);
      if (leaf === null || typeof leaf !== 'object' || !('value' in leaf) || 'error' in leaf || !('src' in leaf)) {
        throw new Error('chaos_vehicle: input field ' + path + ' is not a READ {value, src} leaf: ' + JSON.stringify(leaf).slice(0, 200));
      }
      // a car for sale (tools/sim_car.py, sim_car: true) also carries DERIVED, STAND-IN and AUTHORED leaves, each saying so in its src
      const ok = carJson.sim_car === true ? /^READ|^native default|^DERIVED |^STAND-IN |^AUTHORED / : /^READ|^native default/;
      if (!ok.test(leaf.src)) throw new Error('chaos_vehicle: input field ' + path + ' is not READ: ' + leaf.src);
      src[path] = leaf.src;
      return leaf.value;
    },
    raw(path) {                       // a non-leaf input object (curves); presence required
      const a = leafAt(carJson, path);
      if (a === undefined || a === null) throw new Error('chaos_vehicle: missing input field ' + path);
      if (typeof a === 'object' && 'error' in a) throw new Error('chaos_vehicle: input field ' + path + ' has an error marker: ' + a.error);
      return a;
    },
  };
}
const num = (x, path) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('chaos_vehicle: ' + path + ' is not a finite number'); return x; };
const vec = (x, path) => { if (!Array.isArray(x) || x.length !== 3) throw new Error('chaos_vehicle: ' + path + ' is not a 3-vector'); x.forEach((c, i) => num(c, path + '[' + i + ']')); return x.slice(); };
const flag = (x, path) => { if (typeof x !== 'boolean') throw new Error('chaos_vehicle: ' + path + ' is not a boolean'); return x; };

// ------------------------------------------------------------------------------------------------ FRichCurve (linear keys)
// T3D text of an FRichCurve "(Keys=((Time=..,Value=..),..),PreInfinityExtrap=..)": fields left out equal the defaults of
// FRichCurveKey() (Curves/RichCurve.h:120-130: InterpMode RCIM_Linear, Time 0, Value 0) and FRealCurve() (Curves/RealCurve.h:128-133).
function splitTop(s) {                // split "a=(..),b=c" at top-level commas
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.length) out.push(cur);
  return out;
}
function groupAfter(text, label) {    // the balanced "( ... )" following label=
  const i = text.indexOf(label + '=(');
  if (i < 0) return null;
  let depth = 0, j = i + label.length + 1;
  for (let k = j; k < text.length; k++) {
    if (text[k] === '(') depth++;
    if (text[k] === ')') { depth--; if (depth === 0) return text.slice(j + 1, k); }
  }
  throw new Error('chaos_vehicle: unbalanced T3D group after ' + label);
}
function parseRichCurveT3D(body, where) {
  const curve = { keys: [], defaultValue: MAX_FLT, pre: 'RCCE_Constant', post: 'RCCE_Constant' };
  for (const field of splitTop(body)) {
    const eq = field.indexOf('='); const k = field.slice(0, eq), val = field.slice(eq + 1);
    if (k === 'Keys') {
      for (const keyText of splitTop(val.slice(1, -1))) {
        const key = { time: 0, value: 0, interp: 'RCIM_Linear' };                   // UE: Curves/RichCurve.h:120-130
        for (const kv of splitTop(keyText.slice(1, -1))) {
          const [kk, vv] = kv.split('=');
          if (kk === 'Time') key.time = Number(vv);
          else if (kk === 'Value') key.value = Number(vv);
          else if (kk === 'InterpMode') key.interp = vv;
          else if (['TangentMode', 'TangentWeightMode', 'ArriveTangent', 'LeaveTangent', 'ArriveTangentWeight', 'LeaveTangentWeight'].includes(kk)) key[kk] = vv;
          else throw new Error('chaos_vehicle: ' + where + ': unknown curve key field ' + kk);
        }
        if (key.interp !== 'RCIM_Linear') throw new Error('chaos_vehicle: ' + where + ': key InterpMode ' + key.interp + ' is not ported (only RCIM_Linear)');
        if (!Number.isFinite(key.time) || !Number.isFinite(key.value)) throw new Error('chaos_vehicle: ' + where + ': bad key ' + keyText);
        curve.keys.push(key);
      }
    } else if (k === 'DefaultValue') curve.defaultValue = Number(val);
    else if (k === 'PreInfinityExtrap') curve.pre = val;
    else if (k === 'PostInfinityExtrap') curve.post = val;
    else throw new Error('chaos_vehicle: ' + where + ': unknown curve field ' + k);
  }
  for (const e of [curve.pre, curve.post]) if (e !== 'RCCE_Constant' && e !== 'RCCE_Linear') throw new Error('chaos_vehicle: ' + where + ': extrapolation ' + e + ' is not ported');
  return curve;
}
const curveFromPairs = (pairs) => ({ keys: pairs.map(([t, v]) => ({ time: t, value: v, interp: 'RCIM_Linear' })), defaultValue: MAX_FLT, pre: 'RCCE_Constant', post: 'RCCE_Constant' });
// UE: Curves/RichCurve.cpp:1159-1249 FRichCurve::Eval (RemapTimeValue :1100-1140 is a no-op for Constant/Linear extrapolation)
export function richCurveEval(c, t, inDefault = 0) {
  const K = c.keys, n = K.length;
  let v = c.defaultValue === MAX_FLT ? inDefault : c.defaultValue;                // UE: RichCurve.cpp:1168
  if (n === 0) return v;                                                         // UE: RichCurve.cpp:1170-1173
  if (n < 2 || t < K[0].time) {                                                  // UE: RichCurve.cpp:1174-1197
    if (c.pre === 'RCCE_Linear' && n > 1) {
      const dt = K[1].time - K[0].time;
      v = Math.abs(dt) <= SMALL_NUMBER ? K[0].value : (K[1].value - K[0].value) / dt * (t - K[0].time) + K[0].value;
    } else v = K[0].value;
  } else if (t <= K[n - 1].time) {                                               // UE: RichCurve.cpp:1198-1221 lower bound
    let first = 1, count = n - 1 - first;
    while (count > 0) {
      const step = Math.trunc(count / 2), middle = first + step;
      if (t >= K[middle].time) { first = middle + 1; count -= step + 1; } else count = step;
    }
    const k1 = K[first - 1], k2 = K[first], diff = k2.time - k1.time;            // UE: Curves/CurveEvaluation.cpp:205-249
    v = diff > 0 ? k1.value + (t - k1.time) / diff * (k2.value - k1.value) : k1.value;
  } else {                                                                       // UE: RichCurve.cpp:1223-1245
    if (c.post === 'RCCE_Linear') {
      const dt = K[n - 2].time - K[n - 1].time;
      v = Math.abs(dt) <= SMALL_NUMBER ? K[n - 1].value : (K[n - 2].value - K[n - 1].value) / dt * (t - K[n - 1].time) + K[n - 1].value;
    } else v = K[n - 1].value;
  }
  return v;
}
function richCurveValueRange(c) {                                                // UE: Curves/RichCurve.cpp:639-666 (linear keys)
  if (c.keys.length === 0) return [0, 0];
  let lo = c.keys[0].value, hi = c.keys[0].value;
  for (const k of c.keys) { lo = Math.min(lo, k.value); hi = Math.max(hi, k.value); }
  return [lo, hi];
}
function richCurveLastKey(c, where) {                                            // UE: Curves/RichCurve.cpp:283-287 check(Keys.Num() > 0)
  if (c.keys.length === 0) throw new Error('chaos_vehicle: ' + where + ' has no keys: FRichCurve::GetLastKey would fail its check() (RichCurve.cpp:285)');
  return c.keys[c.keys.length - 1];
}
const richCurveTimeRange = (c) => (c.keys.length ? [c.keys[0].time, c.keys[c.keys.length - 1].time] : [0, 0]);   // UE: RichCurve.cpp:587-599

// FNormalisedGraph - UE: Core/Public/VehicleUtility.h:53-86
export function normalisedGraphValue(graph, inX, maxX = 1, maxY = 1) {
  const step = maxX / (graph.length - 1);
  const startIndex = toInt(inX / step);
  const ramp = (inX - startIndex * step) / step;
  const y = startIndex >= graph.length - 1 ? graph[graph.length - 1] : graph[startIndex] * (1 - ramp) + graph[startIndex + 1] * ramp;
  return y * maxY;
}
// FGraph - UE: Core/Private/VehicleUtility.cpp:169-223
function graphAdd(g, x, y) {
  g.pts.push([x, y]);
  if (x < g.bx0) g.bx0 = x;
  if (x > g.bx1) g.bx1 = x;
}
export function graphEvaluateY(g, inX) {
  if (g.pts.length === 0) return 0;
  const range = g.bx1 - g.bx0, step = range / (g.pts.length - 1), start = (inX - g.bx0) / step;
  if (inX <= g.bx0 || start < 0) return g.pts[0][1];
  if (inX >= g.bx1) return g.pts[g.pts.length - 1][1];
  const i = toInt(start);
  if (i >= g.pts.length - 1) return g.pts[g.pts.length - 1][1];
  const ramp = (inX - g.pts[i][0]) / step;
  return g.pts[i][1] * (1 - ramp) + g.pts[i + 1][1] * ramp;
}
const newGraph = () => ({ pts: [], bx0: Number.MAX_VALUE, bx1: -Number.MAX_VALUE });   // UE: VehicleUtility.h:96-103 Empty()

// the curve a FRuntimeFloatCurve resolves to: GetRichCurveConst picks the ExternalCurve's FloatCurve if set (Curves/CurveFloat.cpp:28-38)
function runtimeCurve(R, path) {
  const c = R.raw(path);
  if (c.external !== undefined) {
    const body = groupAfter(c.t3d, 'FloatCurve');
    if (body === null) throw new Error('chaos_vehicle: ' + path + '.t3d holds no FloatCurve=(...)');
    R.src[path] = c.src;
    return parseRichCurveT3D(body, path + '.t3d');
  }
  if (typeof c.t3d_value === 'string') {
    const inner = groupAfter(c.t3d_value, 'EditorCurveData');
    if (inner === null) throw new Error('chaos_vehicle: ' + path + '.t3d_value holds no EditorCurveData=(...)');
    if (inner === '') {
      // T3D writes "EditorCurveData=()" when the struct is not Identical to its archetype's yet no exported member differs
      // (UScriptStruct::ExportText, CoreUObject/Private/UObject/Class.cpp:3600-3656; only the transient KeyHandlesToIndices,
      // Curves/IndexedCurve.h:98, compared by unique handle, KeyHandle.h:95, differs). So the keys are the archetype's: READ
      // separately (opts.unexported) by tools/ue_unexported.mjs from the .uasset chain. It is NOT an empty curve.
      return curveFromPairs(R.need(path + '.keys'));
    }
    R.src[path] = c.src;
    return parseRichCurveT3D(inner, path + '.t3d_value');
  }
  throw new Error('chaos_vehicle: ' + path + ' is neither an external CurveFloat nor inline T3D');
}

// ------------------------------------------------------------------------------------------------ makeVehicle (setup)
const DIFF = { UNDEFINED_DRIVE: 0, ALL_WHEEL_DRIVE: 1, FRONT_WHEEL_DRIVE: 2, REAR_WHEEL_DRIVE: 3 };   // UE: Core/Public/TransmissionSystem.h:30-36
const AXLE = { UNDEFINED: 0, FRONT: 1, REAR: 2 };                                                      // UE: Glue/Public/ChaosVehicleWheel.h:43-48 / Core WheelSystem.h:68-73
const STEER = { SINGLE_ANGLE: 0, ANGLE_RATIO: 1, ACKERMANN: 2 };                                       // UE: Glue/Public/ChaosWheeledVehicleMovementComponent.h:432-438
const INPUT_FN = { LINEAR_FUNCTION: 0, SQUARED_FUNCTION: 1, CUSTOM_CURVE: 2 };                         // UE: Glue/Public/ChaosVehicleMovementComponent.h:361-366

export function makeVehicle(carJson, opts) {
  if (!opts || typeof opts !== 'object') throw new Error('chaos_vehicle: opts {gravityZ, unexported, angularDampingOnGround, angularDampingInAir} is required');
  const gravityZ = num(opts.gravityZ, 'opts.gravityZ');
  if (!opts.unexported || typeof opts.unexported !== 'object') throw new Error('chaos_vehicle: opts.unexported (data/chaos_unexported.json cars.<Name>) is required');
  const R = makeReader(carJson, opts.unexported);
  // BP_VehicleAdvPawnBase.ReceiveTick s1: Mesh.SetAngularDamping(SelectFloat(A, B, IsMovingOnGround())) - A and B are READ by the
  // caller from that graph (ue_out/bp_code/BP_VehicleAdvPawnBase.ngl:3-5)
  const cfg = { gravityZ, angularDampingOnGround: num(opts.angularDampingOnGround, 'opts.angularDampingOnGround'), angularDampingInAir: num(opts.angularDampingInAir, 'opts.angularDampingInAir') };

  // movement component
  const m = (k) => R.need('movement.' + k);
  cfg.mass = num(m('mass'), 'movement.mass');
  cfg.comOverride = flag(m('enable_center_of_mass_override'), 'movement.enable_center_of_mass_override');
  cfg.comOverrideValue = vec(m('center_of_mass_override'), 'movement.center_of_mass_override');
  cfg.inertiaScale = vec(m('inertia_tensor_scale'), 'movement.inertia_tensor_scale');
  cfg.dragArea = num(m('chassis_width'), 'movement.chassis_width') * num(m('chassis_height'), 'movement.chassis_height');   // UE: Glue/Private/ChaosVehicleMovementComponent.cpp:1534
  cfg.aero = {
    areaM2: Cm2ToM2(cfg.dragArea),                                        // UE: Glue/Public/ChaosVehicleMovementComponent.h:1294
    drag: num(m('drag_coefficient'), 'movement.drag_coefficient'),        // UE: ChaosVehicleMovementComponent.h:1292
    down: num(m('downforce_coefficient'), 'movement.downforce_coefficient'),
  };
  cfg.aero.dragK = 0.5 * cfg.aero.areaM2 * cfg.aero.drag;                 // UE: Core/Private/AerodynamicsSystem.cpp:18
  cfg.aero.liftK = 0.5 * cfg.aero.areaM2 * cfg.aero.down;                 // UE: Core/Private/AerodynamicsSystem.cpp:19
  cfg.idleBrakeInput = num(m('idle_brake_input'), 'movement.idle_brake_input');
  cfg.stopThreshold = num(m('stop_threshold'), 'movement.stop_threshold');
  cfg.wrongDirectionThreshold = num(m('wrong_direction_threshold'), 'movement.wrong_direction_threshold');
  cfg.reverseAsBrake = flag(m('reverse_as_brake'), 'movement.reverse_as_brake');
  cfg.throttleAsBrake = flag(m('throttle_as_brake'), 'movement.throttle_as_brake');
  cfg.parkEnabled = flag(m('park_enabled'), 'movement.park_enabled');
  cfg.legacyFrictionPosition = flag(m('legacy_wheel_friction_position'), 'movement.legacy_wheel_friction_position');
  cfg.mechanicalSim = flag(m('mechanical_sim_enabled'), 'movement.mechanical_sim_enabled');
  for (const k of ['suspension_enabled', 'wheel_friction_enabled']) {
    if (flag(m(k), 'movement.' + k) !== true) throw new Error('chaos_vehicle: movement.' + k + ' = false is not ported');
  }
  for (const k of ['torque_control_enabled', 'target_rotation_control_enabled', 'stabilize_control_enabled']) {
    if (flag(m(k), 'movement.' + k) !== false) throw new Error('chaos_vehicle: movement.' + k + ' = true is not ported (ApplyTorqueControl, ChaosVehicleMovementComponent.cpp:378-492)');
  }
  for (const k of ['aerofoil_count', 'thruster_count']) if (num(m(k), 'movement.' + k) !== 0) throw new Error('chaos_vehicle: movement.' + k + ' > 0 is not ported');
  cfg.rates = {};
  for (const r of ['throttle', 'brake', 'steering', 'handbrake']) {
    const p = r + '_input_rate.';
    const fn = m(p + 'input_curve_function');
    if (!(fn in INPUT_FN)) throw new Error('chaos_vehicle: movement.' + p + 'input_curve_function ' + fn + ' unknown');
    if (fn === 'CUSTOM_CURVE') throw new Error('chaos_vehicle: movement.' + p + 'input_curve_function CUSTOM_CURVE is not ported (its UserCurve was not exported)');
    cfg.rates[r] = { rise: num(m(p + 'rise_rate'), 'movement.' + p + 'rise_rate'), fall: num(m(p + 'fall_rate'), 'movement.' + p + 'fall_rate'), fn: INPUT_FN[fn] };
  }

  // engine - FillEngineSetup, UE: Glue/Public/ChaosWheeledVehicleMovementComponent.h:286-305
  const maxRPMf = num(R.need('engine.max_rpm'), 'engine.max_rpm');
  const torqueCurve = runtimeCurve(R, 'engine.torque_curve');
  cfg.torqueCurveRich = torqueCurve;
  if (torqueCurve.keys.length === 0) cfg.mechanicalSim = false;             // UE: Glue/Private/ChaosWheeledVehicleMovementComponent.cpp:1487-1497
  const [, maxVal] = richCurveValueRange(torqueCurve);
  const graph = [];
  const numSamples = 20;                                                     // UE: ChaosWheeledVehicleMovementComponent.h:291
  for (let X = 0; X <= maxRPMf; X = Math.fround(X + Math.fround(maxRPMf / numSamples))) {   // UE: ChaosWheeledVehicleMovementComponent.h:292-298
    graph.push(richCurveEval(torqueCurve, X) / maxVal);
  }
  cfg.engine = {
    graph,
    maxTorque: num(R.need('engine.max_torque'), 'engine.max_torque'),                        // UE: ChaosWheeledVehicleMovementComponent.h:299
    maxRPM: toInt(maxRPMf),                                                                  // uint16 (Core/Public/EngineSystem.h:43), UE: .h:300
    idleRPM: toInt(num(R.need('engine.engine_idle_rpm'), 'engine.engine_idle_rpm')),       // uint16 (EngineSystem.h:44), UE: .h:301
    brakeEffect: num(R.need('engine.engine_brake_effect'), 'engine.engine_brake_effect'),  // UE: .h:302
    revUpMOI: num(R.need('engine.engine_rev_up_moi'), 'engine.engine_rev_up_moi'),         // UE: .h:303
    revDownRate: num(R.need('engine.engine_rev_down_rate'), 'engine.engine_rev_down_rate'),// UE: .h:304
  };

  // transmission - FillTransmissionSetup, UE: Glue/Public/ChaosWheeledVehicleMovementComponent.h:403-423
  const t = (k) => R.need('transmission.' + k);
  cfg.trans = {
    automatic: flag(t('use_automatic_gears'), 'transmission.use_automatic_gears'),          // UE: .h:405
    autoReverse: flag(t('use_auto_reverse'), 'transmission.use_auto_reverse'),              // UE: .h:406 - copied, never read by FSimpleTransmissionSim
    changeUpRPM: toInt(num(t('change_up_rpm'), 'transmission.change_up_rpm')),              // uint32 (Core/Public/TransmissionSystem.h:77), UE: .h:407
    changeDownRPM: toInt(num(t('change_down_rpm'), 'transmission.change_down_rpm')),        // uint32 (TransmissionSystem.h:78), UE: .h:408
    gearChangeTime: num(t('gear_change_time'), 'transmission.gear_change_time'),            // UE: .h:409
    finalRatio: num(t('final_ratio'), 'transmission.final_ratio'),                          // UE: .h:410
    efficiency: num(t('transmission_efficiency'), 'transmission.transmission_efficiency'),  // UE: .h:412
    forward: t('forward_gear_ratios').map((x, i) => num(x, 'transmission.forward_gear_ratios[' + i + ']')),
    reverse: t('reverse_gear_ratios').map((x, i) => num(x, 'transmission.reverse_gear_ratios[' + i + ']')),
  };

  // differential - FillDifferentialSetup, UE: ChaosWheeledVehicleMovementComponent.h:212-216
  const dt = R.need('differential.differential_type');
  if (!(dt in DIFF)) throw new Error('chaos_vehicle: differential.differential_type ' + dt + ' unknown');
  cfg.diff = { type: DIFF[dt], frontRearSplit: num(R.need('differential.front_rear_split'), 'differential.front_rear_split') };

  // wheels + suspension - FillWheelSetup / FillSuspensionSetup, UE: Glue/Public/ChaosVehicleWheel.h:341-403
  const wheelsIn = R.raw('wheels');
  if (!Array.isArray(wheelsIn) || wheelsIn.length === 0) throw new Error('chaos_vehicle: wheels must be a non-empty array');
  cfg.wheels = wheelsIn.map((w, i) => {
    const s = (k) => R.need('wheels[' + i + '].setup.' + k);
    const p = 'wheels[' + i + '].';
    if (typeof w.bone !== 'string' || typeof w.class !== 'string') throw new Error('chaos_vehicle: ' + p + 'bone/class missing');
    const axle = s('axle_type'); if (!(axle in AXLE)) throw new Error('chaos_vehicle: ' + p + 'setup.axle_type ' + axle + ' unknown');
    const etc = s('external_torque_combine_method');
    if (etc !== 'None') throw new Error('chaos_vehicle: ' + p + 'setup.external_torque_combine_method ' + etc + ' is not ported (Core/Private/WheelSystem.cpp:62-75)');
    const sweep = s('sweep_shape');
    // PerformSuspensionTraces: only Spherecast sweeps; Raycast and every other value take the line trace (Glue/Private/ChaosWheeledVehicleMovementComponent.cpp:471-494)
    if (sweep === 'Spherecast') throw new Error('chaos_vehicle: ' + p + 'setup.sweep_shape Spherecast is not ported (world.trace is a ray)');
    if (sweep !== 'Raycast' && sweep !== 'Shapecast') throw new Error('chaos_vehicle: ' + p + 'setup.sweep_shape ' + sweep + ' unknown');
    s('sweep_type');                                                          // SimpleSweep/ComplexSweep only picks what the caller's trace hits
    const latKeys = s('lateral_slip_graph_keys');
    const latCurve = curveFromPairs(latKeys);
    const lat = newGraph();                                                   // UE: ChaosVehicleWheel.h:368-381
    const [, maxTime] = richCurveTimeRange(latCurve);
    if (maxTime > 0) for (let X = 0; X <= maxTime; X = Math.fround(X + Math.fround(maxTime / 20))) graphAdd(lat, X, richCurveEval(latCurve, X) * 10000);
    const smoothing = toInt(num(s('suspension_smoothing'), p + 'setup.suspension_smoothing'));
    if (smoothing < 0 || smoothing > NUM_SUS_AVERAGING) throw new Error('chaos_vehicle: ' + p + 'setup.suspension_smoothing out of the averaging array (SuspensionSystem.h:232)');
    const wheel = {
      bone: w.bone, cls: w.class,
      offset: vec(s('offset'), p + 'setup.offset'),
      radius: num(s('wheel_radius'), p + 'setup.wheel_radius'),               // UE: ChaosVehicleWheel.h:347
      mass: num(s('wheel_mass'), p + 'setup.wheel_mass'),                     // UE: ChaosVehicleWheel.h:349
      maxSteer: toInt(num(s('max_steer_angle'), p + 'setup.max_steer_angle')),// int MaxSteeringAngle (Core/Public/WheelSystem.h:120), UE: ChaosVehicleWheel.h:350
      maxBrake: num(s('max_brake_torque'), p + 'setup.max_brake_torque'),     // UE: ChaosVehicleWheel.h:351
      handbrake: num(s('max_hand_brake_torque'), p + 'setup.max_hand_brake_torque'),   // UE: ChaosVehicleWheel.h:352
      steering: flag(s('affected_by_steering'), p + 'setup.affected_by_steering'),     // UE: ChaosVehicleWheel.h:353
      brake: flag(s('affected_by_brake'), p + 'setup.affected_by_brake'),              // UE: ChaosVehicleWheel.h:354
      handbrakeOn: flag(s('affected_by_handbrake'), p + 'setup.affected_by_handbrake'),// UE: ChaosVehicleWheel.h:355
      engine: flag(s('affected_by_engine'), p + 'setup.affected_by_engine'),           // UE: ChaosVehicleWheel.h:356
      abs: flag(s('abs_enabled'), p + 'setup.abs_enabled'),                            // UE: ChaosVehicleWheel.h:358
      tc: flag(s('traction_control_enabled'), p + 'setup.traction_control_enabled'),   // UE: ChaosVehicleWheel.h:359
      maxSpin: num(s('max_wheelspin_rotation'), p + 'setup.max_wheelspin_rotation'),   // UE: ChaosVehicleWheel.h:360
      axle: AXLE[axle],                                                                // UE: ChaosVehicleWheel.h:361
      frictionMult: num(s('friction_force_multiplier'), p + 'setup.friction_force_multiplier'),   // UE: ChaosVehicleWheel.h:362
      cornering: num(s('cornering_stiffness'), p + 'setup.cornering_stiffness') * 10000,          // UE: ChaosVehicleWheel.h:363
      sideSlip: num(s('side_slip_modifier'), p + 'setup.side_slip_modifier'),                     // UE: ChaosVehicleWheel.h:364
      slipThreshold: num(s('slip_threshold'), p + 'setup.slip_threshold'),                        // UE: ChaosVehicleWheel.h:365
      skidThreshold: num(s('skid_threshold'), p + 'setup.skid_threshold'),                        // UE: ChaosVehicleWheel.h:366
      lateralGraph: lat,
      rollbar: num(s('rollbar_scaling'), p + 'setup.rollbar_scaling'),
      torqueRatio: 0,                                                                             // UE: ChaosVehicleWheel.h:357
      sus: {
        axis: vec(s('suspension_axis'), p + 'setup.suspension_axis'),                             // UE: ChaosVehicleWheel.h:387
        forceOffset: vec(s('suspension_force_offset'), p + 'setup.suspension_force_offset'),      // UE: ChaosVehicleWheel.h:389
        maxRaise: num(s('suspension_max_raise'), p + 'setup.suspension_max_raise'),               // UE: ChaosVehicleWheel.h:390
        maxDrop: num(s('suspension_max_drop'), p + 'setup.suspension_max_drop'),                  // UE: ChaosVehicleWheel.h:391
        springRate: MToCm(num(s('spring_rate'), p + 'setup.spring_rate')),                        // UE: ChaosVehicleWheel.h:392
        springPreload: MToCm(num(s('spring_preload'), p + 'setup.spring_preload')),               // UE: ChaosVehicleWheel.h:393 (used only by the constraint path)
        dampingRatio: num(s('suspension_damping_ratio'), p + 'setup.suspension_damping_ratio'),   // UE: ChaosVehicleWheel.h:395
        wheelLoadRatio: num(s('wheel_load_ratio'), p + 'setup.wheel_load_ratio'),                // UE: ChaosVehicleWheel.h:396
        smoothing,                                                                                // UE: ChaosVehicleWheel.h:398
        raycastSafetyMargin: 0,      // UE: Core/Public/SuspensionSystem.h:43 config default; FillSuspensionSetup never sets it
      },
    };
    // SetupVehicle: AxleType overrides EngineEnabled from the differential type, UE: Glue/Private/ChaosWheeledVehicleMovementComponent.cpp:1417-1438
    if (wheel.axle !== AXLE.UNDEFINED) {
      let en = false;
      if (wheel.axle === AXLE.FRONT) en = cfg.diff.type === DIFF.ALL_WHEEL_DRIVE || cfg.diff.type === DIFF.FRONT_WHEEL_DRIVE;
      else if (wheel.axle === AXLE.REAR) en = cfg.diff.type === DIFF.ALL_WHEEL_DRIVE || cfg.diff.type === DIFF.REAR_WHEEL_DRIVE;
      wheel.engine = en;
    }
    // GetWheelRestingPosition = LocateBoneOffset(bone, wheel Offset + AdditionalOffset), UE: ChaosWheeledVehicleMovementComponent.cpp:1643-1647
    wheel.rest = add(vec(R.need(p + 'bone_location'), p + 'bone_location'), add(wheel.offset, vec(R.need(p + 'additional_offset'), p + 'additional_offset')));   // AUTHORED: A6 body frame = actor frame
    wheel.sus.maxLength = wheel.sus.maxDrop + wheel.sus.maxRaise;            // UE: ChaosWheeledVehicleMovementComponent.cpp:1587
    return wheel;
  });

  // mechanical sim: IsWheelPowered + GetTorqueRatioForWheel, UE: ChaosWheeledVehicleMovementComponent.cpp:1511-1521
  if (cfg.mechanicalSim) {
    for (const w of cfg.wheels) w.engine = isWheelPowered(cfg.diff.type, w.axle, w.engine);
    cfg.wheels.forEach((w, i) => { w.torqueRatio = torqueRatioForWheel(cfg.diff, i, cfg.wheels); });
  }

  // axles: one per wheel class (AxleToWheelMap, UE: ChaosWheeledVehicleMovementComponent.cpp:1620-1641, 1465-1482)
  cfg.axles = [];
  for (let i = 0; i < cfg.wheels.length; i++) {
    let a = cfg.axles.find((x) => x.cls === cfg.wheels[i].cls);
    if (!a) { a = { cls: cfg.wheels[i].cls, wheels: [], rollbar: cfg.wheels[i].rollbar }; cfg.axles.push(a); }
    a.wheels.push(i);
  }

  // steering - FillSteeringSetup, UE: Glue/Public/ChaosWheeledVehicleMovementComponent.h:487-506
  const st = R.need('steering.steering_type'); if (!(st in STEER)) throw new Error('chaos_vehicle: steering.steering_type ' + st + ' unknown');
  const sCurve = runtimeCurve(R, 'steering.steering_curve');
  const [, sMax] = richCurveValueRange(sCurve);
  const sMaxX = richCurveLastKey(sCurve, 'steering.steering_curve').time;
  const speedGraph = newGraph();
  for (let X = 0; X <= sMaxX; X = Math.fround(X + Math.fround(sMaxX / 20))) graphAdd(speedGraph, X, richCurveEval(sCurve, X) / sMax);
  // WheelTrackDimensions = CalculateWheelLayoutDimensions, UE: ChaosWheeledVehicleMovementComponent.cpp:1675-1702
  let mx = 0, my = 0;
  for (const w of cfg.wheels) { if (Math.abs(w.rest[1]) > my) my = Math.abs(w.rest[1]); if (Math.abs(w.rest[0]) > mx) mx = Math.abs(w.rest[0]); }
  cfg.steer = { type: STEER[st], angleRatio: num(R.need('steering.angle_ratio'), 'steering.angle_ratio'), speedGraph, trackWidth: my * 2, wheelBase: mx * 2 };
  cfg.steer.ack = ackermannSetup(cfg.steer.trackWidth, cfg.steer.wheelBase);

  // sprung masses + damping + resting force - SetupSuspension, UE: ChaosWheeledVehicleMovementComponent.cpp:1570-1618
  let sprung = computeSprungMasses(cfg.wheels.map((w) => w.rest), cfg.mass);
  if (!sprung) sprung = cfg.wheels.map(() => cfg.mass / cfg.wheels.length);   // UE: ChaosWheeledVehicleMovementComponent.cpp:1596-1603 (Unreal's own fallback)
  cfg.wheels.forEach((w, i) => {
    w.sus.sprungMass = sprung[i];
    w.sus.damping = computeDamping(w.sus.springRate, sprung[i], w.sus.dampingRatio);   // UE: .cpp:1610, 1613-1614
    w.sus.restingForce = sprung[i] * -gravityZ;                                         // UE: .cpp:1615
  });

  // rigid body
  const b = R.need('bounds_cm');
  const origin = vec(b.origin, 'bounds_cm.origin'), ext = vec(b.box_extent, 'bounds_cm.box_extent');
  cfg.com = cfg.comOverride ? cfg.comOverrideValue.slice() : origin.slice();                // UE: ChaosVehicleMovementComponent.cpp:1519-1524 when overridden; AUTHORED: A5 otherwise (bounds origin), COMNudge 0
  const [dx, dy, dz] = [2 * ext[0], 2 * ext[1], 2 * ext[2]];
  cfg.inertia = [                                                                           // AUTHORED: A4 box; the scale: UE: ChaosVehicleMovementComponent.cpp:1513-1517
    cfg.mass / 12 * (dy * dy + dz * dz) * cfg.inertiaScale[0],
    cfg.mass / 12 * (dx * dx + dz * dz) * cfg.inertiaScale[1],
    cfg.mass / 12 * (dx * dx + dy * dy) * cfg.inertiaScale[2],
  ];
  const bottom = Math.max(...cfg.wheels.map((w) => w.rest[2]));
  cfg.chassisCorners = [];                                                                  // AUTHORED: A7 contact box
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [bottom, origin[2] + ext[2]]) cfg.chassisCorners.push([origin[0] + sx * ext[0], origin[1] + sy * ext[1], z]);

  const v = { cfg, src: R.src, name: carJson.blueprint };
  resetVehicle(v, [0, 0, 0], 0);
  return v;
}

// FTransmissionUtility, UE: Core/Private/TransmissionUtility.cpp:8-123
function isWheelPowered(diffType, axle, engineEnabled) {
  if (diffType === DIFF.UNDEFINED_DRIVE || axle === AXLE.UNDEFINED) return engineEnabled;
  if (diffType === DIFF.ALL_WHEEL_DRIVE) return true;
  if (diffType === DIFF.FRONT_WHEEL_DRIVE) return axle === AXLE.FRONT;
  if (diffType === DIFF.REAR_WHEEL_DRIVE) return axle === AXLE.REAR;
  return engineEnabled;
}
function torqueRatioForWheel(diff, i, wheels) {
  const w = wheels[i];
  const onAxle = (a) => wheels.filter((x) => x.axle === a).length;
  if (diff.type === DIFF.UNDEFINED_DRIVE || w.axle === AXLE.UNDEFINED) return w.engine ? 1 / wheels.filter((x) => x.engine).length : 0;
  if (diff.type === DIFF.ALL_WHEEL_DRIVE) return (w.axle === AXLE.FRONT ? 1 - diff.frontRearSplit : diff.frontRearSplit) / onAxle(w.axle);
  if (diff.type === DIFF.FRONT_WHEEL_DRIVE && w.axle === AXLE.FRONT) return 1 / onAxle(AXLE.FRONT);
  if (diff.type === DIFF.REAR_WHEEL_DRIVE && w.axle === AXLE.REAR) return 1 / onAxle(AXLE.REAR);
  return 0;
}

// FSuspensionUtility, UE: Core/Private/SuspensionUtility.cpp:7-236 (positions are passed as-is: SetupSuspension hands it actor-local
// spring positions through the overload that assumes they are already relative to the centre of mass, .cpp:1596)
export function computeSprungMasses(P, total) {
  const n = P.length;
  if (n < 1 || !(total > SMALL_NUMBER)) return null;
  if (n === 1) return [total];
  if (n === 2) {
    const ax = P[0][0], ay = P[0][1], ddx = P[1][0] - ax, ddy = P[1][1] - ay, d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d <= SMALL_NUMBER) return [total * 0.5, total * 0.5];
    const m0 = -total * (ddx / d * ax + ddy / d * ay) / d;
    return m0 >= 0 && total - m0 >= 0 ? [m0, total - m0] : null;
  }
  const avg = total / n;
  let sx = 0, sy = 0, xx = 0, yy = 0, xy = 0;
  for (const p of P) { sx += p[0]; sy += p[1]; xx += p[0] * p[0]; yy += p[1] * p[1]; xy += p[0] * p[1]; }
  const det = xx * yy * n + 2 * xy * sx * sy - yy * sx * sx - xx * sy * sy - xy * n;     // UE: SuspensionUtility.cpp:185-190 (as written)
  if (!(det > SMALL_NUMBER || det < -SMALL_NUMBER)) return null;
  const inv = 1 / det;
  const i00 = (n * yy - sy * sy) * inv, i01 = (sx * sy - n * xy) * inv, i02 = (sy * xy - sx * yy) * inv;
  const i11 = (n * xx - sx * sx) * inv, i12 = (sx * xy - sy * xx) * inv, i22 = (xx * yy - xy * xy) * inv;
  const b0 = 2 * avg * sx, b1 = 2 * avg * sy, b2 = 2 * avg * n - 2 * total;
  const l0 = i00 * b0 + i01 * b1 + i02 * b2, l1 = i01 * b0 + i11 * b1 + i12 * b2, l2 = i02 * b0 + i12 * b1 + i22 * b2;
  const out = [];
  for (const p of P) { const mm = avg - 0.5 * (p[0] * l0 + p[1] * l1 + l2); if (mm < 0) return null; out.push(mm); }
  return out;
}
const computeDamping = (k, m, ratio) => clamp(ratio, 0, 1) * 2 * m * Math.sqrt(k / m);      // UE: Core/Public/SuspensionUtility.h:53-58

// FSteeringUtility + FAckermannSim, UE: Core/Public/SteeringUtility.h:27-108, Core/Private/SteeringSystem.cpp:8-52
function intersectTwoCircles(R1, R2, D) {
  if (D > R1 + R2 || D < R1 - R2) return [0, 0];
  const twoD = D * 2, r1s = R1 * R1, r2s = R2 * R2, ds = D * D;
  return [(ds - r2s + r1s) / twoD, Math.sqrt(4 * ds * r1s - Sqr(ds - r2s + r1s)) / twoD];
}
function akermannAngle(flip, input, C2, R1, R2) {                     // UE: SteeringUtility.h:62-87
  if (flip) input = -input;
  const c1 = [input, 0], rel = [C2[0] - c1[0], C2[1] - c1[1]];
  const angle = RadToDeg(Math.atan2(rel[1], rel[0]));
  const D = Math.hypot(rel[0], rel[1]);
  const it = intersectTwoCircles(R1, R2, D); it[1] = -it[1];
  const S = Math.sin(DegToRad(angle)), C = Math.cos(DegToRad(angle));  // FVector2D::GetRotated, UE: Math/Vector2D.h:1129-1137
  const arm = [C * it[0] - S * it[1], S * it[0] + C * it[1]];
  const pt = [c1[0] + arm[0], c1[1] + arm[1]];
  return RadToDeg(Math.atan2(C2[0] - pt[0], C2[1] - pt[1]));
}
function ackermannSetup(T, W) {
  const beta = RadToDeg(Math.atan2(T * 0.5, W));                       // UE: SteeringUtility.h:89-92
  const Rr = T / 8, H = Rr * Math.cos(DegToRad(beta)), S = T - 2 * Rr * Math.sin(DegToRad(beta));   // UE: SteeringUtility.h:99-108, SteeringSystem.cpp:41
  const a = { C2: [T * 0.5, H], R1: S * 0.5, R2: Rr, scaling: 10 };   // UE: SteeringSystem.cpp:46 SteerInputScaling
  a.rest = akermannAngle(false, 0, a.C2, a.R1, a.R2);                  // UE: SteeringSystem.cpp:43
  const [l, r] = ackermannLR(a, 1);
  a.max = Math.max(Math.abs(l), Math.abs(r));                          // UE: SteeringSystem.cpp:48-51
  return a;
}
function ackermannLR(a, input) {                                       // UE: SteeringSystem.cpp:8-15
  return [akermannAngle(true, input * a.scaling, a.C2, a.R1, a.R2) - a.rest, akermannAngle(false, input * a.scaling, a.C2, a.R1, a.R2) - a.rest];
}
export function steeringAngle(steer, inNorm, maxAngle, wheelSide) {   // UE: Core/Public/SteeringSystem.h:92-127
  if (steer.type === STEER.ANGLE_RATIO) {
    const outside = inNorm * wheelSide > 0;
    return inNorm * (outside ? maxAngle : maxAngle * steer.angleRatio);
  }
  if (steer.type === STEER.ACKERMANN) {
    const [l, r] = ackermannLR(steer.ack, -inNorm);
    return (wheelSide < 0 ? -l : r) * (maxAngle / steer.ack.max);
  }
  return maxAngle * inNorm;
}

// ------------------------------------------------------------------------------------------------ simulation state
export function resetVehicle(v, position, yawDegrees) {
  // ResetVehicleState: clear raw input, stop, recreate the physics state, neutral (UE: Glue/Private/ChaosVehicleMovementComponent.cpp:1787-1798)
  vec(position, 'resetVehicle position'); num(yawDegrees, 'resetVehicle yawDegrees');
  const c = v.cfg;
  v.rot = yawMatrix(yawDegrees);
  v.comPos = add(position, mulMV(v.rot, c.com));
  v.vel = v3(); v.angVel = v3();
  v.accum = 0; v.substeps = 0;
  v.movingOnGround = isMovingOnGround(); v.angularDamping = v.movingOnGround ? c.angularDampingOnGround : c.angularDampingInAir;
  v.input ={ steering: 0, throttle: 0, brake: 0, handbrake: 0 };   // interpolated inputs (UChaosVehicleMovementComponent members)
  v.gtTargetGear = 0;                                                // UChaosVehicleMovementComponent::TargetGear (SetTargetGear(0, true))
  v.engine = c.mechanicalSim ? {                                     // UE: Core/Private/EngineSystem.cpp:13-25
    maxTorque: c.engine.maxTorque, throttle: 0, targetSpeed: 0, rpm: 0, omega: 0, started: true, freeRunning: false,
    idleSpeed: RPMToOmega(c.engine.idleRPM), maxSpeed: RPMToOmega(c.engine.maxRPM),
  } : null;
  v.trans = c.mechanicalSim ? { current: 0, target: 0, changeTime: 0, engineRPM: 0, allowed: true, automatic: c.trans.automatic } : null;   // UE: TransmissionSystem.cpp:11-17
  v.w = c.wheels.map((w) => ({                                       // UE: Core/Private/WheelSystem.cpp:11-50
    Re: w.radius, omega: 0, inertia: 0.5 * w.mass * w.radius * w.radius, drive: 0, brake: 0, load: 0, ground: v3(), angPos: 0, steer: 0,
    friction: 1, massPerWheel: 250, slipAngle: 0, inContact: false, engineBraking: false, force: v3(), grip: 0, clipping: false, abs: false,
    engine: w.engine,
  }));
  v.s = c.wheels.map(() => ({ disp: 0, lastDisp: 0, springDisp: 0, force: 0, avg: new Array(NUM_SUS_AVERAGING).fill(0), avgCount: 0, avgNum: 0 }));   // UE: SuspensionSystem.h:105-119
  v.hits = c.wheels.map(() => null);
  v.out = { currentGear: 0, targetGear: 0 };
  v.pendingGear = { up: 0, down: 0 };                               // gear presses waiting for the next substep (A10 in AUTHORED)
  v.clutch = { locked: true, slip: 0 }; v.stalled = false;           // A11: read only when the input names a clutch
  publish(v, c.wheels.map(() => 0));
}

// FVehicleInputRateConfig, UE: Glue/Public/ChaosVehicleMovementComponent.h:400-449
function interpInput(rate, dt, cur, target) {
  const d = target - cur;
  const rising = ((d > 0) === (cur > 0)) || (d !== 0 && cur === 0);
  const maxD = dt * (rising ? rate.rise : rate.fall);
  return cur + clamp(d, -maxD, maxD);
}
const controlFn = (rate, x) => (rate.fn === INPUT_FN.SQUARED_FUNCTION ? (x < 0 ? -x * x : x * x) : x);

// FSimpleEngineSim, UE: Core/Public/EngineSystem.h + Core/Private/EngineSystem.cpp
function engineTorqueFromRPM(v, rpm, limitToIdle = true) {           // UE: EngineSystem.cpp:29-42
  const e = v.engine, c = v.cfg.engine;
  if (!e.started || Math.abs(rpm - c.maxRPM) < 1 || c.maxRPM === 0) return 0;
  if (limitToIdle) rpm = clamp(rpm, c.idleRPM, c.maxRPM);
  return normalisedGraphValue(c.graph, rpm, c.maxRPM, e.maxTorque);
}
const engineTorque = (v) => (v.engine.started ? v.engine.throttle * engineTorqueFromRPM(v, v.engine.rpm) : 0);   // UE: EngineSystem.h:99-107
// AUTHORED: A11 (UC-34) the clutch's numbers. CLUTCH_STRENGTH: FClutchSettings' default (ClutchModule.h:18, READ). LOCK_RPM: the slip under
// which the plates grip (AUTHORED: an rpm reading's own grain). STALL_FRACTION: how far under its idle an engine dies (AUTHORED: the
// source says an engine stalls when it turns too slowly to keep running, not how slowly)
// GOV_BAND_RPM: under its idle an engine's governor opens the throttle, fully this far under (AUTHORED; its authority, the engine's
// own full torque at idle, is READ off the car's torque curve: a car pulls away on a slowly let-out clutch without gas, Wikipedia
// Stall (engine), and one that cannot hold its idle stalls)
// ENGINE_MOI: the engine's turning mass with the clutch (11-07, RJ: "fix the simulation controls"). Every car carries the template's
// EngineRevUpMOI 5.0, about twenty times a real engine's: free it revved 1,000 rpm a second and a dropped clutch never stalled. No
// figure was READ for these engines (research/ENGINE_INERTIA.md); this is the largest READ for a named production engine, a 2.0
// TDI's crank, rods and dual-mass flywheel with clutch: Ubysz A., 'Problems of rotational mass in passenger vehicles', Transport
// Problems 5(1) 2010, p.35 Table 1 row 6 (https://delibra.bg.polsl.pl//Content/27480/BCPS_31096_-_Problems-of-rotation_0000.pdf).
// A STAND-IN still (another engine's), used only with a clutch: without one the step is Unreal's, at the car's own 5.0
export const CLUTCH = { CLUTCH_STRENGTH: 1.0, LOCK_RPM: 30, STALL_FRACTION: 0.5, GOV_BAND_RPM: 150, ENGINE_MOI: 0.246 };
function engineSimulate(v, dt) {                                      // UE: EngineSystem.cpp:44-76
  const e = v.engine, c = v.cfg.engine;
  if (!e.started) return;
  if (e.freeRunning) {
    e.omega += engineTorque(v) * dt / c.revUpMOI;
    const decel = c.revDownRate * Sqr((e.omega - 0.5 * e.idleSpeed) / e.maxSpeed);
    e.omega -= decel * dt;
  } else {
    e.omega += (e.targetSpeed - e.omega) * 4.0 * dt;
  }
  if (e.omega < e.idleSpeed) e.omega = e.idleSpeed;
  e.rpm = OmegaToRPM(e.omega);
}
// A11 the clutch before the engine steps: locked (Unreal's path), or slipping with the torque it passes. pedal 0..1, fromWheel the
// engine rpm the driven wheels mean in the current gear
function clutchState(v, pedal, fromWheel) {
  const e = v.engine, cl = v.clutch;
  const hold = (1 - pedal) * CLUTCH.CLUTCH_STRENGTH * e.maxTorque;          // ClutchValue x the engine's torque, UE: ClutchModule.cpp:30
  if (outOfGear(v.trans) || !e.started) { cl.locked = false; cl.slip = 0; return { locked: false, torque: 0, hold }; }
  if (cl.locked && (hold <= 0 || Math.abs(engineTorque(v)) > hold)) cl.locked = false;   // the pedal down past what the torque needs
  if (cl.locked) return { locked: true, torque: 0, hold };
  cl.slip = e.omega - RPMToOmega(Math.abs(fromWheel));                      // the engine's side less the gearbox's (rad/s)
  return { locked: false, torque: Math.sign(cl.slip) * hold, hold };
}
// A11 the idle governor: the torque it adds under idle, from none at idle to the engine's full torque at idle GOV_BAND_RPM below it
function governor(v, rpm) {
  const c = v.cfg.engine, u = clamp((c.idleRPM - rpm) / CLUTCH.GOV_BAND_RPM, 0, 1);
  return u > 0 ? u * engineTorqueFromRPM(v, c.idleRPM) : 0;
}
// A11 the engine while the clutch slips: free-running (EngineSystem.cpp's free branch) with the clutch's torque as its load and the
// governor under idle; no idle floor while a load drags it, so a load the governor cannot carry stalls it
function slipEngine(v, dt, load) {
  const e = v.engine, c = v.cfg.engine;
  if (!e.started) return;
  const T = Math.max(engineTorque(v), governor(v, e.rpm));
  e.omega += (T - load) * dt / CLUTCH.ENGINE_MOI;
  e.omega -= c.revDownRate * Sqr((e.omega - 0.5 * e.idleSpeed) / e.maxSpeed) * dt;
  if (load === 0 && e.omega < e.idleSpeed) e.omega = e.idleSpeed;
  if (e.omega > e.maxSpeed) e.omega = e.maxSpeed;                          // the fuel cut at the car's READ limit (a light flywheel overshoots it in a step)
  e.rpm = OmegaToRPM(e.omega);
}
// A11 the clutch after the engine stepped: grips when the speeds meet (or cross) with the torque within its hold; a stall
function clutchAfter(v, st, fromWheel) {
  const e = v.engine, cl = v.clutch, g = RPMToOmega(Math.abs(fromWheel)), now = e.omega - g;
  if (!e.started) return;                                                   // a stalled engine grips nothing
  if (st.hold > 0 && Math.max(Math.abs(engineTorque(v)), governor(v, e.rpm)) <= st.hold && (Math.sign(now) !== Math.sign(cl.slip) || Math.abs(now) < RPMToOmega(CLUTCH.LOCK_RPM))) {
    cl.locked = true; e.omega = Math.max(g, e.idleSpeed); e.rpm = OmegaToRPM(e.omega);
  }
  if (e.omega < CLUTCH.STALL_FRACTION * e.idleSpeed) stall(v);
}
function stall(v) { const e = v.engine; e.started = false; e.omega = 0; e.rpm = 0; v.clutch.locked = false; v.stalled = true; }

// FSimpleTransmissionSim, UE: Core/Private/TransmissionSystem.cpp + Core/Public/TransmissionSystem.h
const correctGear = (v, g) => clamp(g, -v.cfg.trans.reverse.length, v.cfg.trans.forward.length);   // UE: TransmissionSystem.h:220-223
export function gearRatio(v, g) {                                     // UE: TransmissionSystem.cpp:41-57
  const t = v.cfg.trans; g = correctGear(v, g);
  if (g > 0) return t.forward[g - 1] * t.finalRatio;
  if (g < 0) return -t.reverse[Math.abs(g) - 1] * t.finalRatio;
  return 0;
}
export function setGear(v, g, immediate = false) {                   // UE: TransmissionSystem.cpp:21-39
  const tr = v.trans; g = correctGear(v, g);
  tr.target = g;
  if (tr.target !== tr.current) {
    if (immediate || v.cfg.trans.gearChangeTime === 0) tr.current = tr.target;
    else { tr.current = 0; tr.changeTime = v.cfg.trans.gearChangeTime; }
  }
}
export function transmissionSimulate(v, dt) {                         // UE: TransmissionSystem.cpp:59-100
  const tr = v.trans, c = v.cfg.trans;
  if (tr.automatic) {
    if (tr.current === tr.target && tr.allowed) {
      if (tr.engineRPM >= c.changeUpRPM) {
        if (tr.current > 0) setGear(v, tr.target + 1); else setGear(v, tr.target - 1);
      } else if (tr.engineRPM <= c.changeDownRPM && Math.abs(tr.current) > 1) {
        if (tr.current > 0) setGear(v, tr.target - 1); else setGear(v, tr.target + 1);
      }
    }
  }
  if (tr.current !== tr.target) {
    tr.changeTime -= dt;
    if (tr.changeTime <= 0) { tr.changeTime = 0; tr.current = tr.target; }
  }
}
const outOfGear = (tr) => tr.current === 0 || tr.current !== tr.target;   // UE: TransmissionSystem.h:170-173

// FSimpleSuspensionSim, UE: Core/Public/SuspensionSystem.h + Core/Private/SuspensionSystem.cpp
function setSuspensionLength(s, cs, length, radius) {                // UE: SuspensionSystem.h:124-129
  s.disp = Math.max(0, length - cs.raycastSafetyMargin - radius);
  s.springDisp = cs.maxLength - s.disp;
}
function springLength(s, cs) {                                        // UE: SuspensionSystem.cpp:8-41
  if (cs.smoothing) {
    const nv = s.springDisp - cs.maxLength;
    if (s.avgNum < cs.smoothing) s.avgNum++;
    s.avg[s.avgCount++] = nv;
    if (s.avgCount >= cs.smoothing) s.avgCount = 0;
    let tot = 0; for (let i = 0; i < s.avgNum; i++) tot += s.avg[i];
    return tot / s.avgNum;
  }
  return s.springDisp - cs.maxLength;
}

// FSimpleWheelSim::Simulate, UE: Core/Private/WheelSystem.cpp:54-247
function calculateSlipAngle(y, x) {                                   // UE: Core/Public/VehicleUtility.h:146-161
  let val = 0;
  if (Math.abs(y) > 0.05) { val = Math.abs(Math.atan2(y, x)); if (val > HALF_PI) val = UE_PI - val; }
  return val;
}
function setWheelLoadForce(w, f) { w.load = f; w.inContact = f > SMALL_NUMBER; }   // UE: Core/Public/WheelSystem.h:228-240
function wheelSimulate(w, cw, dt) {
  const K = 0.4, TCS = 0.98;                                          // UE: WheelSystem.cpp:56-57
  w.slipAngle = calculateSlipAngle(w.ground[1], w.ground[0]);         // UE: WheelSystem.cpp:60
  let drive = w.drive / w.Re, brake = w.brake / w.Re;                 // UE: WheelSystem.cpp:80-81
  w.grip = w.load * w.friction * cw.frictionMult;                     // UE: WheelSystem.cpp:84
  let lon = 0, excess = 0, lat = 0;
  const braking = w.brake > Math.abs(w.drive);                        // UE: WheelSystem.cpp:92
  let locked = false; w.abs = false;
  if (w.load > SMALL_NUMBER) {                                        // UE: WheelSystem.cpp:98
    if (cw.abs && braking && Math.abs(brake) > w.grip) {              // UE: WheelSystem.cpp:101-112
      if ((braking && cw.abs) || (!braking && cw.tc)) {
        brake = w.grip * TCS * (brake > 0 ? 1 : -1);
        if (Math.abs(w.ground[0]) > 5.0) w.abs = true;
      }
    }
    if (Math.abs(drive) > w.grip) {                                   // UE: WheelSystem.cpp:114-125
      excess = (Math.abs(drive) - w.grip) * w.Re * (drive < 0 ? -1 : 1);
      if (cw.tc && !braking) drive = w.grip * TCS * (drive > 0 ? 1 : -1);
    }
    if (braking) {                                                    // UE: WheelSystem.cpp:127-144
      const stop = w.massPerWheel * K * w.ground[0] / dt;
      lon = clamp(brake, -Math.abs(stop), Math.abs(stop));
      if (w.ground[0] > 0) lon = -lon;
    } else lon = drive;                                               // UE: WheelSystem.cpp:145-148
    const stopLat = -(w.massPerWheel * K * w.ground[1]) / dt;         // UE: WheelSystem.cpp:150
    if (cw.lateralGraph.pts.length === 0) lat = Math.abs(w.slipAngle) * cw.cornering;   // UE: WheelSystem.cpp:153-158 (the clipped angle is computed and unused)
    else lat = graphEvaluateY(cw.lateralGraph, RadToDeg(w.slipAngle)) * 1.0;            // UE: WheelSystem.cpp:161 (LateralSlipGraphMultiplier 1.0, WheelSystem.h:101; FillWheelSetup never sets it)
    if (lat > Math.abs(stopLat)) lat = Math.abs(stopLat);             // UE: WheelSystem.cpp:164-167
    if (w.ground[1] > 0) lat = -lat;                                  // UE: WheelSystem.cpp:168-171
    const l2 = lon * lon + lat * lat;                                 // UE: WheelSystem.cpp:177-198 friction circle
    w.clipping = false;
    if (l2 > 0.05) {
      const clip = w.grip / Math.sqrt(l2);
      if (clip < 1) {
        if (braking && !w.engineBraking) locked = true;
        w.clipping = true;
        lon *= clip; lat *= clip;
        lon *= cw.sideSlip; lat *= cw.sideSlip;
      }
    }
  } else if (Math.abs(w.omega) < cw.maxSpin) excess = w.drive;        // UE: WheelSystem.cpp:200-207
  let slipOmega = excess / w.inertia * dt;                            // UE: WheelSystem.cpp:209-210
  slipOmega = clamp(slipOmega, -cw.maxSpin, cw.maxSpin);
  if (locked) w.omega *= 0.9;                                         // UE: WheelSystem.cpp:212-215
  else if (w.inContact) w.omega += (w.ground[0] / Math.max(w.Re, KINDA_SMALL_NUMBER) - w.omega + slipOmega);   // UE: WheelSystem.cpp:218-222
  else w.omega += slipOmega;                                          // UE: WheelSystem.cpp:225
  w.angPos += w.omega * dt;                                           // UE: WheelSystem.cpp:230
  w.angPos = modfFrac(w.angPos / TWO_PI) * TWO_PI;                    // UE: WheelSystem.cpp:233-234
  w.force = w.inContact ? [lon, lat, 0] : v3();                       // UE: WheelSystem.cpp:236-244
}
const wheelIsSlipping = (w, cw) => Math.abs(w.omega * w.Re - w.ground[0]) > cw.slipThreshold;   // UE: Core/Public/WheelSystem.h:319-322, 386-396

// ------------------------------------------------------------------------------------------------ stepVehicle
export function stepVehicle(v, input, dt, world) {
  for (const k of ['throttle', 'brake', 'steering', 'handbrake']) num(input && input[k], 'input.' + k);
  num(dt, 'dt'); if (dt < 0) throw new Error('chaos_vehicle: dt < 0');
  if (!world || typeof world.trace !== 'function') throw new Error('chaos_vehicle: world.trace(start, end) is required');
  // AUTHORED: A8 no ProcessSleeping: the body is simulated every substep
  // the gearbox inputs (UC-22 drag mode): input.transmission 'manual' | 'automatic' (UE's FControlInputs TransmissionType, set
  // by SetUseAutomaticGears) and input.gearUp / gearDown (SetChangeUpInput / SetChangeDownInput).
  // AUTHORED: A10 a press reaches the gearbox ONCE, on the next substep, where Unreal applies it on every physics tick the key is
  // held (a held key would run through the gears); the page sends a press, not a hold
  if (input.transmission !== undefined && input.transmission !== 'manual' && input.transmission !== 'automatic') throw new Error('chaos_vehicle: input.transmission must be manual or automatic');
  if (input.gearUp) v.pendingGear.up++;
  if (input.gearDown) v.pendingGear.down++;
  if (input.clutch !== undefined && !(input.clutch >= 0 && input.clutch <= 1)) throw new Error('chaos_vehicle: input.clutch must be 0 (the pedal up) to 1 (the floor)');
  if (input.gear !== undefined && (input.clutch === undefined || !Number.isInteger(input.gear))) throw new Error('chaos_vehicle: input.gear is a whole gear, and only with a clutch (A11)');
  v.accum += dt;
  const n = Math.floor(v.accum / SUBSTEP + 1e-9);        // dt = 1/120 is exactly one substep; the remainder carries to the next call
  v.accum = Math.max(0, v.accum - n * SUBSTEP);
  for (let i = 0; i < n; i++) substep(v, input, SUBSTEP, world);
  v.substeps += n;
  return v;
}

// UChaosVehicleMovementComponent (via UPawnMovementComponent) inherits UNavMovementComponent::IsMovingOnGround, which returns
// false (UE: Engine/Classes/GameFramework/NavMovementComponent.h:199-202); no class in ChaosVehiclesPlugin/Source overrides it
// (no "IsMovingOnGround" in that tree). So the Blueprint's SelectFloat always takes its B (in-air) value in UE 5.7.
const isMovingOnGround = () => false;

function substep(v, input, dt, world) {
  const c = v.cfg;
  // AUTHORED: A2 the game-thread half runs here, once per substep
  // ---------------- game thread: UChaosVehicleMovementComponent::UpdateState (Glue/Private/ChaosVehicleMovementComponent.cpp:1152-1236)
  const fwd0 = axis(v.rot, 0);
  const gtForwardSpeed = dot(v.vel, fwd0);                                   // FVehicleState::CaptureState, UE: .cpp:97
  const raw = {
    throttle: clamp(input.throttle, -1, 1), brake: clamp(input.brake, -1, 1), steering: clamp(input.steering, -1, 1),   // UE: .cpp:873-896
    handbrake: input.handbrake !== 0,                                        // SetHandbrakeInput(bool), UE: .cpp:913-916
  };
  const currentGear = v.out.currentGear;                                     // GetCurrentGear = PVehicleOutput->CurrentGear, UE: .cpp:981-984
  const setTargetGear = (g, immediate) => {                                  // UE: .cpp:948-967
    if (v.trans && g !== v.out.targetGear) { setGear(v, g, immediate); v.out.targetGear = v.trans.target; }
    if (v.trans && g !== v.out.targetGear) return;
    v.gtTargetGear = g;
  };
  if (input.gear !== undefined && v.trans) {                               // A11: the gate's gear, by the driver's hand, at once
    if (input.gear !== v.trans.target) setTargetGear(input.gear, true);
  } else if (c.reverseAsBrake) {                                             // UE: .cpp:1183-1198
    if (raw.brake > KINDA_SMALL_NUMBER && currentGear >= 0 && v.gtTargetGear >= 0) setTargetGear(-1, true);
    else if (raw.throttle > KINDA_SMALL_NUMBER && currentGear <= 0 && v.gtTargetGear <= 0) setTargetGear(1, true);
  } else if (c.trans.automatic) {                                            // UE: .cpp:1199-1211
    if (raw.throttle > KINDA_SMALL_NUMBER && currentGear === 0 && v.gtTargetGear === 0) setTargetGear(1, true);
  }
  // CalcThrottleBrakeInput, UE: .cpp:1017-1088
  let thr = raw.throttle, brk = raw.brake;
  if (c.reverseAsBrake) {
    if (raw.throttle > 0) {
      if (c.throttleAsBrake && gtForwardSpeed < -c.wrongDirectionThreshold) { brk = 1; thr = 0; }
    } else if (raw.brake > 0) {
      if (gtForwardSpeed > c.wrongDirectionThreshold) { brk = 1; thr = 0; }
      else if (v.gtTargetGear < 0) { thr = raw.brake; brk = 0; }
    } else if (raw.brake > 0 && v.gtTargetGear < 0) {
      thr = raw.brake;
    } else if (!(gtForwardSpeed < c.stopThreshold && gtForwardSpeed > -c.stopThreshold)) {
      brk = c.idleBrakeInput;
    }
    thr = clamp(thr, 0, 1); brk = clamp(brk, 0, 1);
  } else {
    brk = Math.abs(raw.brake);
    if (raw.brake < SMALL_NUMBER && raw.throttle < SMALL_NUMBER && gtForwardSpeed < c.stopThreshold && gtForwardSpeed > -c.stopThreshold) brk = 1;
  }
  v.input.steering = interpInput(c.rates.steering, dt, v.input.steering, raw.steering);   // UE: .cpp:1218-1224
  v.input.throttle = interpInput(c.rates.throttle, dt, v.input.throttle, thr);
  v.input.brake = interpInput(c.rates.brake, dt, v.input.brake, brk);
  v.input.handbrake = interpInput(c.rates.handbrake, dt, v.input.handbrake, raw.handbrake ? 1 : 0);
  // BP_VehicleAdvPawnBase.ReceiveTick s1 (game thread, every tick): Mesh.SetAngularDamping(SelectFloat(OnGround, InAir, IsMovingOnGround()))
  v.movingOnGround = isMovingOnGround();
  v.angularDamping = v.movingOnGround ? c.angularDampingOnGround : c.angularDampingInAir;   // SelectFloat, UE: Engine/Classes/Kismet/KismetMathLibrary.inl:3757-3760
  // UChaosVehicleMovementComponent::Update: what crosses to the physics thread, UE: .cpp:1763-1773
  const ci = {
    throttle: controlFn(c.rates.throttle, v.input.throttle), brake: controlFn(c.rates.brake, v.input.brake),
    steering: controlFn(c.rates.steering, v.input.steering), handbrake: v.input.handbrake, parking: c.parkEnabled,
    clutch: input.clutch,                                                    // A11 (UC-34): a pedal, not rate-limited
  };

  // ---------------- physics thread: TickVehicle -> UpdateState, ApplyInput, UpdateSimulation (Glue/Private/ChaosVehicleMovementComponent.cpp:164-177)
  const T = { rot: v.rot, pos: sub(v.comPos, mulMV(v.rot, c.com)) };        // FTransform(R, X): the actor (body) frame
  const up = axis(v.rot, 2), right = axis(v.rot, 1), fwd = axis(v.rot, 0);
  const forwardSpeed = dot(v.vel, fwd);                                      // UE: .cpp:130
  const toWorld = (p) => add(T.pos, mulMV(T.rot, p));
  const velAt = (p) => sub(v.vel, cross(sub(p, v.comPos), v.angVel));       // GetVelocityAtPoint, UE: Glue/Private/ChaosWheeledVehicleMovementComponent.cpp:148-160
  const forces = [];                                                          // deferred: [force, position|null]
  // wheel state + traces, UE: ChaosWheeledVehicleMovementComponent.cpp:185-261
  const ws = c.wheels.map((cw) => {
    const world_ = toWorld(cw.rest);
    const vw = velAt(world_);
    return { world: world_, local: mulMtV(T.rot, vw) };                       // UE: .cpp:121-129
  });
  let onGround = 0;
  c.wheels.forEach((cw, i) => {
    const w = v.w[i];
    const dir = mulMV(T.rot, cw.sus.axis);                                    // UpdateWorldRaycastLocation, UE: Core/Public/SuspensionSystem.h:164-172
    const start = sub(ws[i].world, scl(dir, cw.sus.maxRaise + cw.sus.raycastSafetyMargin));
    const end = add(ws[i].world, scl(dir, cw.sus.maxDrop + w.Re));
    const hit = world.trace(start, end);                                      // LineTraceSingleByChannel, UE: .cpp:489-494
    if (hit !== null) {
      if (!hit || typeof hit !== 'object') throw new Error('chaos_vehicle: world.trace returned ' + hit);
      vec(hit.point, 'hit.point'); vec(hit.normal, 'hit.normal'); num(hit.distance, 'hit.distance'); num(hit.friction, 'hit.friction');
    }
    v.hits[i] = hit;
    w.inContact = hit !== null;                                               // SetOnGround(bBlockingHit), UE: .cpp:250
    if (w.inContact) onGround++;
  });
  v.inAir = onGround === 0;                                                   // UE: .cpp:245-258

  // ApplyInput, UE: ChaosWheeledVehicleMovementComponent.cpp:750-823
  let engineBraking = 0;
  if (v.engine && v.trans) {
    if (input.transmission !== undefined) v.trans.automatic = input.transmission === 'automatic';   // UE: .cpp:764-767
    if (v.pendingGear.up) { setGear(v, v.trans.target + 1); v.pendingGear.up--; }      // ChangeUp = SetGear(TargetGear + 1), UE: .cpp:769-773 + Core/Public/TransmissionSystem.h:103-106
    if (v.pendingGear.down) { setGear(v, v.trans.target - 1); v.pendingGear.down--; }  // ChangeDown, UE: .cpp:775-779 + Core/Public/TransmissionSystem.h:109-112
  }
  if (v.engine) {
    v.engine.throttle = clamp(ci.throttle * ci.throttle, 0, 1);              // SetThrottle(T*T), UE: .cpp:789 + Core/Public/EngineSystem.h:75-79
    engineBraking = (v.engine.started ? v.engine.rpm : 0) * c.engine.brakeEffect;   // UE: .cpp:792
  }
  c.wheels.forEach((cw, i) => {
    const w = v.w[i];
    let ebf = 0;
    if (ci.throttle < SMALL_NUMBER && Math.abs(forwardSpeed) > SMALL_NUMBER && w.engine) ebf = engineBraking;   // UE: .cpp:799-803
    if (ci.clutch !== undefined && (!v.clutch.locked || outOfGear(v.trans))) ebf = 0;   // A11: an open clutch passes no engine braking (its slip torque does)
    if (cw.brake) {
      const bf = cw.maxBrake * ci.brake;
      w.brake = TorqueMToCm(bf + ebf); w.engineBraking = Math.abs(ebf) > Math.abs(bf);   // UE: .cpp:805-809
    } else { w.brake = TorqueMToCm(engineBraking); w.engineBraking = true; }              // UE: .cpp:810-813
    if ((ci.handbrake && cw.handbrakeOn) || ci.parking) {                                 // UE: .cpp:815-819
      w.brake = TorqueMToCm(ci.parking ? cw.handbrake : ci.handbrake * cw.handbrake); w.engineBraking = false;
    }
  });

  // UpdateSimulation: base stages first (UE: ChaosWheeledVehicleMovementComponent.cpp:268), aerodynamics, UE: ChaosVehicleMovementComponent.cpp:283-293
  {
    const vel = CmToM(forwardSpeed), sign = vel < 0 ? 1 : -1;                // UE: Core/Private/AerodynamicsSystem.cpp:22-29
    const common = 1.225 * vel * vel * sign;                                 // AirDensity, UE: Core/Public/VehicleUtility.h:31-34
    const local = scl([c.aero.dragK * common, 0, c.aero.liftK * common], MToCmScaling());
    forces.push([mulMV(T.rot, local), null]);
  }

  // ProcessMechanicalSimulation, UE: ChaosWheeledVehicleMovementComponent.cpp:842-892
  if (v.engine) {
    let wheelRPM = 0;
    v.w.forEach((w) => { if (w.engine) wheelRPM = Math.abs(OmegaToRPM(w.omega)); });   // UE: .cpp:852-859
    const fromWheel = wheelRPM * gearRatio(v, v.trans.current);               // GetEngineRPMFromWheelRPM, UE: TransmissionSystem.h:208-211
    const wheelSpeedRPM = Math.abs(fromWheel);
    const cl = ci.clutch === undefined ? null : clutchState(v, ci.clutch, fromWheel);   // A11: null = no clutch, Unreal's own step
    const slipping = cl !== null && !cl.locked && !outOfGear(v.trans);
    v.engine.freeRunning = outOfGear(v.trans) || slipping;                   // SetEngineRPM, UE: Core/Public/EngineSystem.h:85-92
    if (!v.engine.freeRunning) v.engine.targetSpeed = RPMToOmega(clamp(Math.abs(fromWheel), c.engine.idleRPM, c.engine.maxRPM));
    if (slipping) { slipEngine(v, dt, cl.torque); clutchAfter(v, cl, fromWheel); }   // A11
    else if (cl !== null && outOfGear(v.trans)) slipEngine(v, dt, 0);       // A11: with a clutch, free in neutral at the clutch's inertia too
    else engineSimulate(v, dt);
    if (cl && cl.locked && v.engine.started && Math.abs(fromWheel) < CLUTCH.STALL_FRACTION * c.engine.idleRPM) stall(v);   // A11: a locked engine turns with the wheels
    v.trans.engineRPM = v.engine.started ? v.engine.rpm : 0;                 // UE: .cpp:865
    v.trans.allowed = !v.inAir && !v.w.some((w, i) => wheelIsSlipping(w, c.wheels[i]));   // UE: .cpp:866 + IsWheelSpinning .cpp:825-840
    transmissionSimulate(v, dt);                                             // UE: .cpp:869
    const locked = cl !== null && cl.locked && !outOfGear(v.trans) && v.engine.started;
    let tt = (slipping ? cl.torque : locked ? Math.max(engineTorque(v), governor(v, Math.abs(fromWheel))) : engineTorque(v)) * gearRatio(v, v.trans.current) * c.trans.efficiency;   // GetTransmissionTorque, UE: TransmissionSystem.h:196-199; A11 slipping: the clutch's torque
    if (wheelSpeedRPM > c.engine.maxRPM) tt = 0;                             // UE: .cpp:872-875
    c.wheels.forEach((cw, i) => { v.w[i].drive = v.w[i].engine ? TorqueMToCm(tt) * cw.torqueRatio : 0; });   // UE: .cpp:878-889
  }

  // ApplySuspensionForces, UE: ChaosWheeledVehicleMovementComponent.cpp:583-706 
  // AUTHORED: A3 the force-based path is the one ported
  const susForces = c.wheels.map(() => 0);
  c.wheels.forEach((cw, i) => {
    const w = v.w[i], s = v.s[i], hit = v.hits[i];
    if (w.inContact) {
      setSuspensionLength(s, cw.sus, hit.distance, w.Re);                    // UE: .cpp:632-636
      const damping = s.springDisp < s.lastDisp ? cw.sus.damping : cw.sus.damping;   // Compression/Rebound both = Damping, UE: Core/Private/SuspensionSystem.cpp:45 + .cpp:1613-1614
      const springSpeed = (s.lastDisp - s.springDisp) / dt;                  // UE: Core/Private/SuspensionSystem.cpp:46-51
      s.force = s.springDisp * cw.sus.springRate - springSpeed * damping;
      s.lastDisp = s.springDisp;
      forces.push([scl(up, s.force), add(ws[i].world, cw.sus.forceOffset)]); // UE: .cpp:643-651
      const load = cw.sus.wheelLoadRatio * s.force + (1 - cw.sus.wheelLoadRatio) * cw.sus.restingForce;   // UE: .cpp:653
      setWheelLoadForce(w, load);
      w.massPerWheel = c.mass / c.wheels.length;                             // UE: .cpp:655
      susForces[i] = load;
    } else {
      setSuspensionLength(s, cw.sus, cw.sus.maxRaise + cw.sus.raycastSafetyMargin + cw.sus.maxDrop + w.Re, cw.radius);   // GetTraceLength, UE: SuspensionSystem.h:174-177; .cpp:676
      setWheelLoadForce(w, 0);
    }
  });
  for (const a of c.axles) {                                                  // rollbars, UE: .cpp:683-705
    if (a.wheels.length !== 2) continue;
    const [A, B] = a.wheels, diff = susForces[A] - susForces[B];
    forces.push([scl(up, diff * a.rollbar), add(ws[A].world, c.wheels[A].sus.forceOffset)]);
    forces.push([scl(up, diff * -a.rollbar), add(ws[B].world, c.wheels[B].sus.forceOffset)]);
  }
  // AUTHORED: A9 suspension hard stop. Its geometry is the constraint's: target = ImpactPoint + Radius * UpAxis (UE: .cpp:618),
  // axis = -SuspensionAxis and MinLength = -SuspensionMaxRaise (UE: .cpp:1226-1228), Distance and the push along the contact normal
  // (UE: Experimental/Chaos/Private/Chaos/PBDSuspensionConstraints.cpp:240-250), frictionless (:261), the push-out capped at
  // min(Chaos_Suspension_MaxPushout, Chaos_Suspension_MaxPushoutVelocity * Dt) (:17-21, :325)
  const hardstops = [];
  c.wheels.forEach((cw, i) => {
    const hit = v.hits[i];
    if (!v.w[i].inContact || hit === null) return;
    const target = add(hit.point, scl(up, v.w[i].Re));
    const axisW = mulMV(T.rot, scl(cw.sus.axis, -1));
    const distance = dot(sub(ws[i].world, target), axisW);
    const hard = -cw.sus.maxRaise - distance;
    const depth = dot(scl(axisW, hard), hit.normal);
    if (hard > 0 && depth > 0) hardstops.push({ p: ws[i].world, n: hit.normal, depth: Math.min(depth, Math.min(5.0, 100.0 * dt)), mu: 0, wheel: i });
  });
  v.hardstops = hardstops.map((h) => h.wheel);

  // ProcessSteering, UE: ChaosWheeledVehicleMovementComponent.cpp:708-748
  c.wheels.forEach((cw, i) => {
    const w = v.w[i];
    if (cw.steering) {
      const speedScale = graphEvaluateY(c.steer.speedGraph, CmSToMPH(forwardSpeed));   // UE: .cpp:726 + Core/Public/SteeringSystem.h:87-90
      w.steer = steeringAngle(c.steer, ci.steering * speedScale, cw.maxSteer, cw.rest[1]);
    } else w.steer = 0;
  });

  // ApplyWheelFrictionForces, UE: ChaosWheeledVehicleMovementComponent.cpp:501-581
  c.wheels.forEach((cw, i) => {
    const w = v.w[i], hit = v.hits[i];
    if (w.inContact) {
      w.friction = hit.friction;                                              // HitResult.PhysMaterial->Friction, UE: .cpp:512-515
      w.ground = unrotateYaw(w.steer, ws[i].local);                           // UE: .cpp:518-522
      wheelSimulate(w, cw, dt);
      const fl = rotateYaw(w.steer, w.force);                                 // UE: .cpp:526-527
      const gz = hit.normal, gx = cross(right, gz), gy = cross(gz, gx);       // UE: .cpp:529-531
      const f = add(add(scl(gx, fl[0]), scl(gy, fl[1])), scl(gz, fl[2]));    // FMatrix(X,Y,Z,W).TransformVector, UE: Math/Matrix.inl:37-43, 204-207
      forces.push([f, c.legacyFrictionPosition ? ws[i].world : hit.point]);   // UE: .cpp:537-544
    } else {
      w.ground = v3(); setWheelLoadForce(w, 0); wheelSimulate(w, cw, dt);    // UE: .cpp:575-577
    }
  });

  // ---------------- integration. AUTHORED: A1 semi-implicit Euler
  let F = [0, 0, c.mass * c.gravityZ], Tq = v3();
  for (const [f, p] of forces) {
    F = add(F, f);
    if (p) Tq = add(Tq, cross(sub(p, v.comPos), f));                         // AddForceAtPosition, UE: Glue/Private/DeferredForces.cpp:26-35
  }
  const Iw = worldInertia(v.rot, c.inertia);
  v.vel = add(v.vel, scl(F, dt / c.mass));
  const Lw = mulMV(Iw, v.angVel);
  v.angVel = add(v.angVel, scl(solve3(Iw, sub(Tq, cross(v.angVel, Lw))), dt));
  // angular damping: FBodyInstance::AngularDamping -> particle AngularEtherDrag (UE: Engine/Private/PhysicsEngine/BodyInstance.cpp:3494-3504,
  // PhysicsCore/Private/ChaosEngineInterface.cpp:841-845), applied after the velocity integration as
  // W *= max(0, 1 - AngularEtherDrag*Dt) (UE: Experimental/Chaos/Private/Chaos/PBDRigidsEvolutionGBF.cpp:912-915; override off, PerParticleEtherDrag.cpp:12)
  v.angVel = scl(v.angVel, Math.max(0, 1 - v.angularDamping * dt));
  solveContacts(v, world, Iw, hardstops);
  v.comPos = add(v.comPos, scl(v.vel, dt));
  v.rot = rotateMatrix(v.rot, v.angVel, dt);

  // ---------------- FillOutputState, UE: ChaosWheeledVehicleMovementComponent.cpp:1030-1080
  v.out.currentGear = v.trans ? v.trans.current : 0;
  v.out.targetGear = v.trans ? v.trans.target : 0;
  publish(v, c.wheels.map((cw, i) => cw.sus.maxRaise + springLength(v.s[i], cw.sus)));   // GetSuspensionOffset, UE: Core/Public/SuspensionSystem.h:194-197
}

function publish(v, suspensionOffsets) {
  const c = v.cfg;
  v.pos = sub(v.comPos, mulMV(v.rot, c.com));
  v.forwardSpeedCmS = dot(v.vel, axis(v.rot, 0));
  v.engineRPM = v.engine && v.engine.started ? v.engine.rpm : 0;            // GetEngineRPM, UE: Core/Public/EngineSystem.h:124-132
  v.gear = v.out.currentGear;
  if (v.inAir === undefined) v.inAir = true;
  v.wheels = c.wheels.map((cw, i) => ({
    bone: cw.bone, steerDeg: v.w[i].steer, spinRad: v.w[i].angPos, suspensionOffsetCm: suspensionOffsets[i], inContact: v.w[i].inContact,
    omega: v.w[i].omega, springForce: v.s[i].force, load: v.w[i].load, driveTorqueNm: TorqueCmToM(v.w[i].drive), brakeTorqueNm: TorqueCmToM(v.w[i].brake),
    engineEnabled: v.w[i].engine, torqueRatio: cw.torqueRatio,
    // GetSlipMagnitude / GetSkidMagnitude and IsSlipping / IsSkidding, UE: Core/Public/WheelSystem.h:319-327, 386-404 (read by the
    // page's tyre sound and skid marks; Unreal's template shows neither), and the wheel trace's hit point (cm, world)
    slipCmS: v.w[i].omega * v.w[i].Re - v.w[i].ground[0], skidCmS: v.w[i].ground[1],
    slipping: Math.abs(v.w[i].omega * v.w[i].Re - v.w[i].ground[0]) > cw.slipThreshold, skidding: Math.abs(v.w[i].ground[1]) > cw.skidThreshold,
    contactCm: v.hits && v.hits[i] ? v.hits[i].point : null,
  }));
}

// ------------------------------------------------------------------------------------------------ rigid-body helpers (AUTHORED: A1)
function worldInertia(R, d) {               // R diag(d) R^T
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i][j] = R[i][0] * d[0] * R[j][0] + R[i][1] * d[1] * R[j][1] + R[i][2] * d[2] * R[j][2];
  return out;
}
function solve3(M, b) {                     // M x = b (Cramer)
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(M); const out = [];
  for (let c = 0; c < 3; c++) { const m = M.map((row, r) => row.map((x, k) => (k === c ? b[r] : x))); out.push(det(m) / d); }
  return out;
}
function rotateMatrix(R, w, dt) {           // Rodrigues: R <- exp([w]x dt) R
  const ang = len(w) * dt;
  if (ang < 1e-12) return R;
  const k = scl(w, 1 / len(w)), s = Math.sin(ang), co = 1 - Math.cos(ang);
  const K = [[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]];
  const K2 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let l = 0; l < 3; l++) K2[i][j] += K[i][l] * K[l][j];
  const Q = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((row, i) => row.map((x, j) => x + s * K[i][j] + co * K2[i][j]));
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let l = 0; l < 3; l++) out[i][j] += Q[i][l] * R[l][j];
  return out;
}
// AUTHORED: A7 chassis box corners against world.trace, solved together with the A9 hard stops
function solveContacts(v, world, Iw, extra) {
  // order-independent: every contact's impulse and push-out is computed from the same state, then the mean is applied (a
  // sequential solve would break left/right symmetry by contact order). The push-out moves the body at the contact point
  // (translation and rotation through the contact's effective mass), as a position-based contact does.
  const c = v.cfg, T = sub(v.comPos, mulMV(v.rot, c.com));
  const contacts = extra.slice();
  for (const corner of c.chassisCorners) {
    const p = add(T, mulMV(v.rot, corner));
    const hit = world.trace(v.comPos, p);
    if (hit === null) continue;
    vec(hit.point, 'hit.point'); vec(hit.normal, 'hit.normal'); num(hit.friction, 'hit.friction');
    const depth = dot(sub(hit.point, p), hit.normal);
    if (depth > 0) contacts.push({ p, n: hit.normal, depth, mu: hit.friction });
  }
  v.chassisContacts = contacts.length - extra.length;
  if (!contacts.length) return;
  const inv = 1 / contacts.length;
  for (const k of contacts) { k.r = sub(k.p, v.comPos); k.kn = 1 / c.mass + dot(k.n, cross(solve3(Iw, cross(k.r, k.n)), k.r)); }
  for (let it = 0; it < 8; it++) {                      // Jacobi passes: each from the same velocity, the mean applied
    let dV = v3(), dW = v3();
    for (const k of contacts) {
      const vp = add(v.vel, cross(v.angVel, k.r)), vn = dot(vp, k.n);
      if (vn >= 0) continue;
      let J = scl(k.n, -vn / k.kn);
      const vt = sub(vp, scl(k.n, vn)), vtl = len(vt);
      if (k.mu > 0 && vtl > 1e-9) {
        const t = scl(vt, 1 / vtl), kt = 1 / c.mass + dot(t, cross(solve3(Iw, cross(k.r, t)), k.r));
        J = add(J, scl(t, -Math.min(vtl / kt, k.mu * (-vn / k.kn))));
      }
      dV = add(dV, scl(J, 1 / c.mass)); dW = add(dW, solve3(Iw, cross(k.r, J)));
    }
    v.vel = add(v.vel, scl(dV, inv)); v.angVel = add(v.angVel, scl(dW, inv));
  }
  let dX = v3(), dR = v3();
  for (const k of contacts) { const P = scl(k.n, k.depth / k.kn); dX = add(dX, scl(P, 1 / c.mass)); dR = add(dR, solve3(Iw, cross(k.r, P))); }
  v.comPos = add(v.comPos, scl(dX, inv)); v.rot = rotateMatrix(v.rot, scl(dR, inv), 1);
}

// internals, for the tests
export const _internal = { engineTorqueFromRPM, richCurveEval, normalisedGraphValue, graphEvaluateY, setGear, transmissionSimulate, gearRatio, steeringAngle, computeSprungMasses, SUBSTEP };
