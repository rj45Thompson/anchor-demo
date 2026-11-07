// drag_cam.js - the filmed drag run (UC-35): which camera shoots the run at each moment, where it stands and how far it zooms.
// Pure; runs in the browser and in node. Unreal space (cm; X down the strip, Y right, Z up), the start line at X = 0, as app.js
// buildDragStrip lays the strip out. The strip is straight and nobody steers on it (RJ 11-07), so the camera is free to film.
// AUTHORED, all of it: the page's own cinematography, a broadcast's grammar (cameras riding beside and ahead of the car, fixed
// trackside cameras that zoom on it as it comes and pan as it passes, a slow orbit after the line). No number here is read
// from a source; each is a choice, and test/drag_cam.test.mjs holds the choices to UC-35.7 (the car in frame, the camera never
// inside the car, under the road or in a wall, no wall between them, every shot held long enough to read).

// the strip's walls and light poles (app.js buildDragStrip builds them from these, the cameras keep clear of them)
export const STRIP = {
  width_m: 24,                 // two lanes, as UC-22 drew it
  wall_y_m: 12.6,              // the wall's centre line, either side: 0.6 m past the asphalt's edge
  wall_thick_m: 0.5,
  wall_top_m: 0.85,
  pole_y_m: 15.8,              // the light poles stand outside the walls and the distance boards (at 14.2 m)
  pole_every_m: 40,
  pole_h_m: 10,
};

// the shots, in the order a run plays them. `to_m`: the car's distance down the strip (m from where it staged) at which the next
// shot takes over. The director only moves forward through this list, so a car that rolls back never cuts back.
export const SHOTS = [
  { id: 'stage' },                                      // until the car leaves (UC-35.1): no cut at the green
  { id: 'launch', to_m: 30 },                           // UC-35.2
  { id: 'side', to_m: 110 },                            // UC-35.3
  { id: 'trackside', to_m: 215, at_m: 200 },            // a fixed camera at 200 m, just past the eighth-mile board
  { id: 'nose', to_m: 320 },
  { id: 'finish', past_m: 32 },                         // a fixed camera 25 m past the line; holds until the car is this far past it
  { id: 'roll' },                                       // UC-35.4
];
export const FINISH_CAM_PAST_LINE_M = 25;
const ORBIT_RAD_S = 0.22;

export function makeDirector() { return { i: 0, since: 0 }; }
export const shotId = (dir) => SHOTS[dir.i].id;

/** s: { left (the car has passed its roll-out: run.leave), distM (from where it staged), carX (cm: the car's centre), quarterX (cm:
 *  the finish line) }. Moves to the next shot when its moment has come; returns true on a cut */
export function stepDirector(dir, s, dt) {
  const before = dir.i;
  for (;;) {
    const cur = SHOTS[dir.i];
    if (dir.i === SHOTS.length - 1) break;
    const done = cur.id === 'stage' ? s.left
      : cur.id === 'finish' ? s.carX > s.quarterX + (FINISH_CAM_PAST_LINE_M + cur.past_m) * 100
      : s.distM >= cur.to_m;
    if (!done) break;
    dir.i++;
  }
  if (dir.i !== before) { dir.since = 0; return true; }
  dir.since += dt > 0 ? dt : 0;
  return false;
}

/** where the camera stands for the current shot. car: { c (cm, the body's centre), len, halfWidth, height (cm) }; ctx: { laneY,
 *  quarterX (cm), aspect (the screen's width / height) }. Returns { eye, look (cm: the point the camera looks at, already composed),
 *  hfovDeg (horizontal, as Unreal's cameras), mounted (rides with the car: the speed's widening and shake apply), fixedAt (a camera
 *  standing still on the strip, or null) } */
export function framing(dir, car, ctx) {
  const id = SHOTS[dir.i].id, c = car.c, t = dir.since, L = car.len;
  const ease = (x) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
  const wallIn = (STRIP.wall_y_m - STRIP.wall_thick_m / 2) * 100 - 60;   // the nearest a camera on the strip stands to a wall (cm)
  const wallOut = (STRIP.wall_y_m + STRIP.wall_thick_m / 2) * 100 + 150;  // a camera outside the near wall
  let eye, look, fill, lens = 8, mounted = false, fixed = false;
  if (id === 'stage') {                                  // behind the car and between the lanes, down the strip: the car on the left,
    eye = [c[0] - L / 2 - 850 + 300 * ease(t / 4), ctx.laneY + 420, 95];   // the tree on the right; pushing in for 4 s
    const k = (ctx.aspect || 16 / 9) >= 1 ? 0.5 : 0.15;   // upright the frame is narrow: it looks at the car, the tree beside it
    look = [c[0] + (TREE_X_CM - c[0]) * k, ctx.laneY * (1 - k), 60];
    fill = 0.3; lens = 64;
  } else if (id === 'launch') {                          // low beside the strip 14 m down it: the car comes at it and past it
    eye = [1400, ctx.laneY - 560, 42];
    look = [c[0], c[1], c[2] - 10];
    fill = 0.5; lens = 40; fixed = true;
  } else if (id === 'side') {                            // riding beside the car, the car slowly pulling ahead of it
    eye = [c[0] + 260 - 320 * ease(t / 3.5), c[1] - 520, 72];
    look = [c[0], c[1], c[2] - 5];
    fill = 0.62; mounted = true;
  } else if (id === 'trackside') {                       // outside the near wall at 200 m, high enough to see over it: zooms on the car
    eye = [SHOTS.find((x) => x.id === 'trackside').at_m * 100, -wallOut, 175];
    look = [c[0], c[1], c[2] - 10];
    fill = 0.32; fixed = true;
  } else if (id === 'nose') {                            // ahead of the car looking back at it, the car gaining on the camera
    eye = [c[0] + L / 2 + 900 - 380 * ease(t / 3), c[1] - 240, 105];
    look = [c[0], c[1], c[2]];
    fill = 0.5; mounted = true;
  } else if (id === 'finish') {                          // 25 m past the line, on the shoulder inside the wall: under the gantry
    eye = [ctx.quarterX + FINISH_CAM_PAST_LINE_M * 100, ctx.laneY - 500, 140];
    look = [c[0], c[1], c[2] - 10];
    fill = 0.3; lens = 10; fixed = true;
  } else {                                               // the roll-down: a slow orbit from behind and outside
    const R = Math.min(580, wallIn - Math.abs(ctx.laneY)), th = -2.2 + ORBIT_RAD_S * t;
    eye = [c[0] + R * Math.cos(th), c[1] + R * Math.sin(th), 230];
    look = [c[0], c[1], c[2]];
    fill = 0.55;
  }
  // compose (UC-35.6): the camera pitched down so what it looks at sits RISE of the half-height above the frame's centre, clear of
  // the dials along the bottom, the lens opened until the whole car is inside the frame
  const aspect = ctx.aspect || 16 / 9, rise = riseFor(aspect);
  let hfov = fitHfov(eye, look, car, fill, lens), aim = look;
  for (let k = 0; k < 16; k++) {
    const v = verticalFor(hfov, aspect);
    aim = pitched(eye, look, rise * v / 2);
    if (hfov >= HFOV_MAX || boxInFrame(eye, aim, hfov, aspect, car, 0.94)) break;
    hfov = Math.min(HFOV_MAX, hfov * 1.07);
  }
  return { eye, look: aim, hfovDeg: hfov, mounted, fixedAt: fixed ? eye.slice() : null };
}
// the tree stands 5 m past the start line between the lanes (app.js buildDragStrip)
export const TREE_X_CM = 500;
/** where the car sits up the frame (a fraction of the half-height above the centre): on a screen on its side the dials take the
 *  bottom half's middle, so the car sits in the top half; upright, the dials take the top and the bottom, so it sits mid-frame */
export const riseFor = (aspect) => (aspect >= 1 ? 0.36 : 0.08);
export const HFOV_MAX = 82;

/** the horizontal field of view that shows the whole car with it taking `fill` of the frame's width, wider when the camera does
 *  not look straight at it (the stage shot looks past it, at the tree); never narrower than the shot's lens. 8 to 82 deg */
export function fitHfov(eye, look, car, fill, lens = 8) {
  const ang = carAngles(eye, look, car);
  const need = Math.max(ang.size / fill, 2 * (ang.off + ang.size / 2) * 1.15, lens);
  return Math.max(8, Math.min(HFOV_MAX, need));
}
/** the point the camera looks at once pitched down by deg (its up stays the world's) */
export function pitched(eye, look, deg) {
  const d = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]], n = norm(d), f = d.map((x) => x / n);
  const u0 = [-f[2] * f[0], -f[2] * f[1], 1 - f[2] * f[2]], un = norm(u0), u = u0.map((x) => x / un);   // world up, square to f
  const r = deg * Math.PI / 180, g = f.map((x, k) => x * Math.cos(r) - u[k] * Math.sin(r));
  return [eye[0] + g[0] * n, eye[1] + g[1] * n, eye[2] + g[2] * n];
}
/** the car's box (its 8 corners, square to the world: the strip is straight) inside `margin` of the frame's edges */
export function boxInFrame(eye, aim, hfov, aspect, car, margin) {
  const v = verticalFor(hfov, aspect), h = 2 * Math.atan(Math.tan(v * Math.PI / 360) * aspect) * 180 / Math.PI;
  const f = unit(sub(aim, eye)), r = unit(cross([0, 0, 1], f)), u = cross(f, r);
  const tx = Math.tan(h * Math.PI / 360), ty = Math.tan(v * Math.PI / 360), c = car.c;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = sub([c[0] + sx * car.len / 2, c[1] + sy * car.halfWidth, c[2] + sz * car.height / 2], eye), z = dot(p, f);
    if (z <= 0 || Math.abs(dot(p, r) / z / tx) > margin || Math.abs(dot(p, u) / z / ty) > margin) return false;
  }
  return true;
}
/** three.js wants a vertical field of view: Unreal's rule keeps the horizontal one (ue_space.js verticalFovDeg), which on an upright
 *  phone opens the vertical past a fish-eye, so it stops at VFOV_MAX (UC-35 6a) */
export const VFOV_MAX = 100;
export function verticalFor(hfovDeg, aspect) {
  return Math.min(VFOV_MAX, 2 * Math.atan(Math.tan(hfovDeg * Math.PI / 360) / aspect) * 180 / Math.PI);
}
/** the car seen from eye: its angular size (the largest of its length, width and height, in degrees) and how far off the view's
 *  centre its centre is (degrees) */
export function carAngles(eye, look, car) {
  const c = car.c, d = (p) => [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) * 180 / Math.PI;
  const along = (k, h) => angle(d(c.map((v, i) => v + (i === k ? h : 0))), d(c.map((v, i) => v - (i === k ? h : 0))));
  const size = Math.max(along(0, car.len / 2), along(1, car.halfWidth), along(2, car.height / 2));
  return { size, off: angle(d(look), d(c)) };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
