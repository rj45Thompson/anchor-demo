// walk.js - walking the lot (UC-28): a person at standing eye height, moved by keys or a thumb, who cannot walk through a pedestal
// or off the lot, and who sees the car they face. Pure: no DOM and no three, so node (test/walk.test.mjs) runs the same rules.
// Metres and radians; yaw 0 looks along -Z (three's camera), positive yaw turns left. AUTHORED, for feel: the eye height, the
// speeds (a walk and a brisk walk), the body's radius and how near and how square-on a car must be to be "the one you face".
export const EYE_M = 1.7;
export const WALK_MS = 1.4;
export const FAST_MS = 3.6;
export const BODY_M = 0.35;
export const FACE = { near_m: 7.5, half_angle_deg: 28 };

export function makeWalker(x, z, yaw) { return { x, z, yaw, pitch: -0.08 }; }

/** one step: input { fwd, side } in -1..1 (side + is right), fast, turn (rad), lift (rad); obstacles [{ x, z, r }] are pedestals;
 *  bound { r } keeps the walker within r of the lot's middle. Moves, then pushes out of anything it walked into */
export function stepWalker(w, input, dt, obstacles, bound) {
  w.yaw += input.turn || 0;
  w.pitch = Math.max(-1.2, Math.min(0.9, w.pitch + (input.lift || 0)));
  const sp = (input.fast ? FAST_MS : WALK_MS) * dt, f = input.fwd || 0, s = input.side || 0, n = Math.hypot(f, s) || 1, k = Math.min(1, n) / n;
  const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw), rx = Math.cos(w.yaw), rz = -Math.sin(w.yaw);
  w.x += (fx * f + rx * s) * k * sp; w.z += (fz * f + rz * s) * k * sp;
  for (const o of obstacles) {
    const dx = w.x - o.x, dz = w.z - o.z, d = Math.hypot(dx, dz), min = o.r + BODY_M;
    if (d < min) { const u = d > 1e-6 ? 1 / d : 0; w.x = o.x + (d > 1e-6 ? dx * u : 1) * min; w.z = o.z + dz * u * min; }
  }
  const d = Math.hypot(w.x, w.z), max = bound.r - BODY_M;
  if (d > max) { w.x *= max / d; w.z *= max / d; }
  return w;
}

/** the car the walker faces: the nearest of points [{ x, z }] within FACE.near_m and FACE.half_angle_deg of the look, or -1 */
export function facing(w, points) {
  const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw), cos = Math.cos(FACE.half_angle_deg * Math.PI / 180);
  let best = -1, bestD = Infinity;
  points.forEach((p, i) => {
    if (!p) return;
    const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz);
    if (d > FACE.near_m || d < 1e-6) return;
    if ((dx * fx + dz * fz) / d < cos) return;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
