// camera_rig.js - the chase camera, ported from USpringArmComponent::UpdateDesiredArmLocation (Engine/Private/GameFramework/
// SpringArmComponent.cpp:93-) with the car's own BackSpringArm/BackCamera values READ off the spawned pawn (tools/ue_camera.py ->
// data/camera.json). Unreal space (cm, Z up). Pure; runs in the browser and in node. Serves UC-2.2 (the player sees the car).
//   target rotation: the arm's world rotation with only the inherited axes (BackSpringArm inherits yaw only)
//   rotation lag: QInterpTo(previous, desired, dt, CameraRotationLagSpeed), substepped by CameraLagMaxTimeStep
//   location lag: VInterpTo(previous, origin, dt, CameraLagSpeed), substepped, then clamped to CameraLagMaxDistance of the origin
//   camera: lagged origin - rotation.X * TargetArmLength + rotation * SocketOffset (no collision test: do_collision_test false)
// AUTHORED: bUseCameraLagSubstepping and CameraLagMaxTimeStep are the component's C++ defaults, not read off the pawn.
export const AUTHORED = ['camera lag substepping at 1/60 s: USpringArmComponent C++ defaults (bUseCameraLagSubstepping true, CameraLagMaxTimeStep 1/60), not read off the pawn'];
const MAX_STEP = 1 / 60;

export function makeRig(arm) {
  return { arm, prevLoc: null, prevYaw: null };
}

// carPos cm, carAxes = [X, Y, Z] world vectors of the car body; returns {eye cm, look cm, yawDeg}
export function updateRig(rig, carPos, carAxes, dt) {
  const a = rig.arm;
  const [X, Y, Z] = carAxes;
  const rel = a.relative_location;                            // the arm hangs on the vehicle mesh at this offset (car space)
  const origin = [0, 1, 2].map((k) => carPos[k] + X[k] * rel[0] + Y[k] * rel[1] + Z[k] * rel[2]);
  const yawDesired = Math.atan2(X[1], X[0]) * 180 / Math.PI; // inherit yaw only (inherit_pitch / inherit_roll false)
  if (rig.prevLoc === null) { rig.prevLoc = origin.slice(); rig.prevYaw = yawDesired; }
  // a frame with no time (dt 0: two frames at one timestamp) moves nothing: RInterpTo/VInterpTo return Current for DeltaTime 0
  // (UnrealMath.cpp:2674), and the substep rates below divide by dt (measured: dt 0 turned the camera NaN for good)
  if (!(dt > 0)) dt = 0;
  // rotation lag (a yaw-only rotation: QInterpTo between two yaw quaternions is the slerp of the yaw angle)
  let yaw = rig.prevYaw;
  if (dt === 0) {
    // keep the previous yaw and location
  } else if (a.enable_camera_rotation_lag) {
    const step = shortest(yawDesired - rig.prevYaw) / dt;
    let target = rig.prevYaw, left = dt;
    while (left > 1e-4) {
      const h = Math.min(MAX_STEP, left);
      target += step * h; left -= h;
      yaw = yaw + shortest(target - yaw) * clamp01(h * a.camera_rotation_lag_speed);
    }
  } else yaw = yawDesired;
  rig.prevYaw = yaw;
  // location lag
  let loc = origin;
  if (dt === 0) {
    loc = rig.prevLoc.slice();
  } else if (a.enable_camera_lag) {
    const stepV = origin.map((v, k) => (v - rig.prevLoc[k]) / dt);
    let target = rig.prevLoc.slice(), cur = rig.prevLoc.slice(), left = dt;
    while (left > 1e-4) {
      const h = Math.min(MAX_STEP, left);
      target = target.map((v, k) => v + stepV[k] * h); left -= h;
      cur = vinterp(cur, target, h, a.camera_lag_speed);
    }
    loc = cur;
    const off = loc.map((v, k) => v - origin[k]), L = Math.hypot(...off);
    if (a.camera_lag_max_distance > 0 && L > a.camera_lag_max_distance) loc = origin.map((v, k) => v + off[k] * a.camera_lag_max_distance / L);
  }
  rig.prevLoc = loc;
  const r = yaw * Math.PI / 180, fx = [Math.cos(r), Math.sin(r), 0], fy = [-Math.sin(r), Math.cos(r), 0];
  const so = a.socket_offset;
  const eye = [0, 1, 2].map((k) => loc[k] - fx[k] * a.target_arm_length + fx[k] * so[0] + fy[k] * so[1] + (k === 2 ? so[2] : 0));
  const look = [0, 1, 2].map((k) => eye[k] + fx[k] * 1000);   // the camera looks along the arm (relative rotation 0)
  return { eye, look, yawDeg: yaw };
}

function vinterp(cur, target, dt, speed) {                    // FMath::VInterpTo (Core/Private/Math/UnrealMath.cpp:2584)
  if (speed <= 0) return target.slice();
  const d = target.map((v, k) => v - cur[k]);
  if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 1e-8) return target.slice();
  const f = clamp01(dt * speed);
  return cur.map((v, k) => v + d[k] * f);
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const shortest = (d) => ((d + 540) % 360) - 180;
