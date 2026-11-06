// gates.js - the gate test the page and the offline sim share: does the car's box (READ bounds_cm) overlap a gate's box
// (BP_TrackGate's BoxComponent, READ in data/track.json)? Unreal answers it with ReceiveActorBeginOverlap; this is the same
// question asked of two boxes. The maths is app.js's overlapsGate and carAxes, copied exactly (no change), so a lap the sim
// counts is a lap the page counts. Pure: no DOM; runs in the browser and in node. Serves UC-2.3 and UC-9.2.

// chaos_vehicle.js v.rot: a nested 3x3, row i = world axis i, column j = the body's axis j (X forward, Y right, Z up) in world
export function carAxes(v) { const r = v.rot; return [0, 1, 2].map((j) => [r[0][j], r[1][j], r[2][j]]); }

// the car's box (READ bounds) against each gate's box: separating axes on the X/Y plane and Z (gates stand upright)
export function overlapsGate(v, box, g) {
  const [X, Y] = carAxes(v);
  const c = [0, 1, 2].map((k) => v.pos[k] + X[k] * box.origin[0] + Y[k] * box.origin[1]);
  const gy = g.yaw_deg * Math.PI / 180, GX = [Math.cos(gy), Math.sin(gy)], GY = [-Math.sin(gy), Math.cos(gy)];
  const d = [c[0] - g.center_cm[0], c[1] - g.center_cm[1]];
  if (Math.abs(v.pos[2] + box.origin[2] - g.center_cm[2]) > box.box_extent[2] + g.half_extent_cm[2]) return false;
  const axes = [GX, GY, [X[0], X[1]], [Y[0], Y[1]]];
  for (const a of axes) {
    const L = Math.hypot(a[0], a[1]); const u = [a[0] / L, a[1] / L];
    const rCar = box.box_extent[0] * Math.abs(X[0] * u[0] + X[1] * u[1]) + box.box_extent[1] * Math.abs(Y[0] * u[0] + Y[1] * u[1]);
    const rGate = g.half_extent_cm[0] * Math.abs(GX[0] * u[0] + GX[1] * u[1]) + g.half_extent_cm[1] * Math.abs(GY[0] * u[0] + GY[1] * u[1]);
    if (Math.abs(d[0] * u[0] + d[1] * u[1]) > rCar + rGate) return false;
  }
  return true;
}
