// drag_cam.js - the filmed drag run (UC-35): which camera shoots the run at each moment, where it stands and how far it zooms.
// Pure; runs in the browser and in node. Unreal space (cm; X down the strip, Y right, Z up), the start line at X = 0, as app.js
// buildDragStrip lays the strip out. The strip is straight and nobody steers on it (RJ 11-07), so the camera is free to film.
// AUTHORED, all of it: the page's own cinematography, a broadcast's grammar (cameras riding beside and ahead of the car, fixed
// trackside cameras that zoom on it as it comes and pan as it passes, a slow orbit after the line). No number here is read
// from a source; each is a choice, and test/drag_cam.test.mjs holds the choices to UC-35.7 (the car in frame, the camera never
// inside the car, under the road or in a wall, no wall between them, every shot held long enough to read) and to UC-38.3 (the car
// in the other lane held in the shot with the visitor's while the two are near: RACE, pairWeight).

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
  { id: 'trackside', to_m: 215, at_m: 210 },            // a fixed camera at 210 m, past the eighth-mile board, between two poles
  { id: 'nose', to_m: 320 },
  { id: 'finish', cut_before_m: 20 },                   // a fixed camera FINISH_CAM_PAST_LINE_M past the line; cut this far before the car reaches it
  { id: 'roll' },                                       // UC-35.4
];
export const FINISH_CAM_PAST_LINE_M = 45;
// the trackside camera's stand: 24 m out from the centre line and 4 m up. 11-07 (RJ: "camera popping") a camera a few metres from a car
// at 200 km/h has to swing 10 degrees a frame as it passes: a pop, not a pan. So the cameras that watch the car come stand far out,
// and the one it heads straight for is cut before the car reaches it (test/drag_cam.test.mjs holds every shot to 4 degrees a frame)
export const STAND = { y_m: 24, z_m: 4 };
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
      : cur.id === 'finish' ? s.carX > s.quarterX + (FINISH_CAM_PAST_LINE_M - cur.cut_before_m) * 100
      : s.distM >= cur.to_m;
    if (!done) break;
    dir.i++;
  }
  if (dir.i !== before) { dir.since = 0; return true; }
  dir.since += dt > 0 ? dt : 0;
  return false;
}

/** where the camera stands for the current shot. car: { c (cm, the body's centre), len, halfWidth, height (cm) }; ctx: { laneY,
 *  quarterX (cm), aspect (the screen's width / height), other (optional, UC-38: the car in the other lane, the same shape as car:
 *  its body's centre in the other lane and its size. Pass it on EVERY frame of a race: the cameras stand differently while the two
 *  are near, so dropping it mid-shot while they are near jumps the camera) }. Returns { eye, look (cm: the point the camera looks
 *  at, already composed), hfovDeg (horizontal, as Unreal's cameras), mounted (rides with the car: the speed's widening and shake
 *  apply), fixedAt (a camera standing still on the strip, or null) } */
export function framing(dir, car, ctx) {
  const id = SHOTS[dir.i].id, c = car.c, t = dir.since, L = car.len, upright = (ctx.aspect || 16 / 9) < 1;
  const ease = (x) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
  const lerp = (a, b, u) => a + (b - a) * u;
  const wallIn = (STRIP.wall_y_m - STRIP.wall_thick_m / 2) * 100 - 60;   // the nearest a camera on the strip stands to a wall (cm)
  const wallOut = (STRIP.wall_y_m + STRIP.wall_thick_m / 2) * 100 + 150;  // a camera outside the near wall
  // UC-38.3 the other car, on a screen on its side only (upright, measured 11-07: holding both put the visitor's car out of the
  // narrow frame on six of the seven shots, so upright films the visitor's alone). w: 1 while the two are near, 0 once one is well
  // clear (pairWeight); d: the other car's lead along the strip (cm, + ahead), faded by w, so every term below that moves a camera
  // for the race is 0 when w is, and the shot is exactly UC-35's
  const other = ctx.other && !upright ? checkedCar(ctx.other) : null;
  const w = other ? pairWeight(other.c[0] - c[0]) : 0, d = other ? w * (other.c[0] - c[0]) : 0;
  let eye, look, fill, lens = 8, mounted = false, fixed = false;
  if (id === 'stage') {                                  // behind the car and between the lanes, down the strip: the car on the left,
    eye = [c[0] - L / 2 - 850 - RACE.stage_back_cm * w + 300 * ease(t / 4), (ctx.laneY + 420) * (1 - w), 95];   // the tree on the
    const k = (ctx.aspect || 16 / 9) >= 1 ? 0.5 : 0.15;   // right; pushing in for 4 s. Raced: further back, on the centre line, both
    look = [c[0] + (TREE_X_CM - c[0]) * k, ctx.laneY * (1 - k) * (1 - w), 60];   // cars and the tree between them. Upright the
    fill = 0.3; lens = 64;                                                        // frame is narrow: it looks at the car, the tree beside it
  } else if (id === 'launch' && upright) {              // upright (11-07, the lightweight loop: a car side-on overflowed the narrow
    eye = [4500, ctx.laneY + 260, 70];                   // frame): low and far down the strip, the car coming head-on, cut before it arrives
    look = [c[0], c[1], c[2] - 10];
    fill = 0.5; lens = 20; fixed = true;
  } else if (id === 'launch') {                          // low beside the strip 14 m down it: the car comes at it and past it. Raced:
    const up = Math.min(1, 2 * w), out = Math.max(0, 2 * w - 1);   // on the trackside stand (from 5.6 m beside the lane a car past the
    eye = [1400, lerp(ctx.laneY - 560, -STAND.y_m * 100, out), lerp(42, STAND.z_m * 100, up)];   // camera and one still coming do
    look = [c[0], c[1], c[2] - 10];                      // not fit one frame), risen first and then out, so it passes OVER the near wall
    fill = 0.5; lens = 40; fixed = true;
  } else if (id === 'side' && upright) {                // upright: riding behind and above the car's outer quarter, so its length
    eye = [c[0] - L / 2 - 520 + 160 * ease(t / 3.5), c[1] - 260, 175];   // runs into the picture instead of across it
    look = [c[0] + 60, c[1], c[2]];
    fill = 0.6; mounted = true;
  } else if (id === 'side') {                            // riding beside the car, the car slowly pulling ahead of it. Raced: further
    eye = [c[0] + 260 - 320 * ease(t / 3.5) - RACE.side_back_cm * w - d, c[1] - 520, 72 + RACE.side_up_cm * w];   // back and up,
    look = [c[0], c[1], c[2] - 5];                       // sliding back by the other car's lead (ahead by its deficit) so both stay on
    fill = 0.62; mounted = true;                         // one side of the camera; the height shows the other car over this one's roof
  } else if (id === 'trackside') {                       // on a stand far outside the near wall, over it: zooms on the car (raced too:
    eye = [SHOTS.find((x) => x.id === 'trackside').at_m * 100, -STAND.y_m * 100, STAND.z_m * 100];   // from 24 m out both fit)
    look = [c[0], c[1], c[2] - 10];
    fill = 0.32; fixed = true;
  } else if (id === 'nose') {                            // ahead of the car looking back at it, the car gaining on the camera. Raced
    const lead = Math.max(0, d);                         // with the other car AHEAD: the camera stays ahead of it too, and moves in to
    eye = [c[0] + L / 2 + 900 - 380 * ease(t / 3) + RACE.nose_ahead * lead,   // the centre line, so the car level with it is not off
      lerp(c[1] - 240, 0, Math.min(1, lead / (RACE.near_m * 100))), 105];     // the frame's edge (behind: as alone, it fits)
    look = [c[0], c[1], c[2]];
    fill = 0.5; mounted = true;
  } else if (id === 'finish') {                          // 25 m past the line, on the shoulder inside the wall: under the gantry. Raced:
    eye = [ctx.quarterX + FINISH_CAM_PAST_LINE_M * 100, lerp(ctx.laneY - 500, -STAND.y_m * 100, w), lerp(140, STAND.z_m * 100, w)];
    look = [c[0], c[1], c[2] - 10];                      // out on the trackside stand (the leader can reach the camera while the other is
    fill = 0.3; lens = 10; fixed = true;                 // 20 m short of it); it starts above the wall's top, so the move clears it
  } else {                                               // the roll-down: a slow orbit from behind and outside (upright: higher and
    const R = Math.min(upright ? 560 : 580, wallIn - Math.abs(ctx.laneY)), th = -2.2 + ORBIT_RAD_S * t;   // looking down, so the
    eye = [c[0] + R * Math.cos(th) - d, c[1] + R * Math.sin(th), (upright ? 640 : 230) - RACE.roll_down_cm * w];   // car fits the
    look = [c[0], c[1], c[2]];                           // narrow frame). Raced: sliding along the strip as the side shot does, lower
    fill = 0.55;
  }
  // compose (UC-35.6): the camera pitched down so what it looks at sits RISE of the half-height above the frame's centre, clear of
  // the dials along the bottom, the lens opened until the whole car is inside the frame. Raced (UC-38.3), the other car's box is held
  // too: turned toward it about the vertical (the visitor's car keeps its height in the frame) and the lens opened for both
  const aspect = ctx.aspect || 16 / 9, rise = lerp(riseFor(aspect), RACE.rise, w);
  // the other car as framed: slid from the visitor's car to the other one by w, so the box held moves continuously from one frame to
  // the next through the ramp (w 0: the visitor's own box, nothing added)
  const pair = w > 0 ? { c: c.map((v, k) => lerp(v, other.c[k], w)), len: other.len, halfWidth: other.halfWidth, height: other.height } : null;
  if (pair) look = turnedTo(eye, look, [car, pair], w);
  // the smallest lens from the fit up that holds the whole car, by bisection: continuous from one frame to the next (11-07: opened
  // in 7 % steps, the lens jumped between frames as the car neared the frame's edge)
  const aimFor = (h) => pitched(eye, look, rise * verticalFor(h, aspect) / 2);
  const fits = (h) => { const a = aimFor(h); return boxInFrame(eye, a, h, aspect, car, 0.94) && (!pair || boxInFrame(eye, a, h, aspect, pair, 0.94)); };
  let lo = fitHfov(eye, look, car, fill, lens), hfov = lo;
  if (!fits(lo)) {
    let hi = HFOV_MAX;
    if (fits(hi)) { for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; } }
    hfov = hi;
  }
  return { eye, look: aimFor(hfov), hfovDeg: hfov, mounted, fixedAt: fixed ? eye.slice() : null };
}
// the tree stands 5 m past the start line between the lanes (app.js buildDragStrip)
export const TREE_X_CM = 500;
/** where the car sits up the frame (a fraction of the half-height above the centre): on a screen on its side the dials take the
 *  bottom half's middle, so the car sits in the top half; upright, the dials take the top and the bottom, so it sits mid-frame */
export const riseFor = (aspect) => (aspect >= 1 ? 0.36 : 0.08);
export const HFOV_MAX = 82;

// UC-38.3 the race: the car in the other lane (R.J.Thompson's house run, replayed) is held in the shots with the visitor's while the
// two are near along the strip, and drops out once one is well clear. AUTHORED, every number. Each alternative named below was
// MEASURED 11-07 on every car on the lot, the visitor going on the green, 0.25 / 0.5 / 1 s late and 0.25 / 0.5 / 1 s early, against
// test/drag_cam.test.mjs's checks ("shown": the share of the other car's box not behind the visitor's, on frames within NEAR)
export const RACE = {
  near_m: 20,          // within it (centre to centre, along the strip) both whole cars are framed: the test holds every such frame
  clear_m: 40,         // past it only the visitor's ("well clear"). The 20 m between is the ramp: the gap there changes at up to
                       // 9.9 m/s, so the ramp takes 2 s at its quickest. A 10 m ramp put the lens at 7.7 % a frame against the
                       // test's 8 % limit; a 5 m one at 14.6 % and the aim at 6.3 deg a frame (pops)
  rise: 0.28,          // where the visitor's car sits up a landscape frame while both are held (0.36 alone): the other car, further
                       // off, sits above it; at 0.36 it went out of the top of a 19.5:9 frame (side and roll). Still above the
                       // dials: the test holds the car's centre at 0.2 or higher
  stage_back_cm: 400,  // the staging camera pulled back, onto the centre line, behind both cars: 1.5 m back left both partly out
                       // of the frame, 3 m held them; 4 m for the margin
  side_back_cm: 1000,  // the side camera rides this much further back and SIDE_UP higher. Beside the car as alone, the other car,
  side_up_cm: 150,     // level with it, hid behind it (under half shown on 50 % of near frames; 0 % with these; 1 m up: 16 %);
                       // 2.5 m up put it out of the top of the frame
  nose_ahead: 1.5,     // with the other car ahead, the nose camera rides ahead of it by this many times its lead: at 1 x the
                       // visitor's car shrank to 17.4 % of the frame's width, near the test's 16 % floor; at 1.5 x, 20.3 %
  roll_down_cm: 30,    // the orbit lower: at its own height the other car went out of the top of a 19.5:9 frame (43 frames);
                       // 15 cm lower held too, 30 for the margin
};
/** UC-38.3: how much the other car is held in the shot, from its distance along the strip (cm, either way): 1 within RACE.near_m,
 *  0 past RACE.clear_m, eased between so the lens and the aim move without a pop */
export function pairWeight(gapCm) {
  const u = Math.max(0, Math.min(1, (Math.abs(gapCm) / 100 - RACE.near_m) / (RACE.clear_m - RACE.near_m)));
  return 1 - u * u * (3 - 2 * u);
}
/** the look turned about the vertical through the eye, by w of the turn that centres the boxes' horizontal extent (seen from eye) in
 *  the frame: its height, and so where the visitor's car sits up the frame, is kept */
export function turnedTo(eye, look, boxes, w) {
  const az = (x, y) => Math.atan2(y - eye[1], x - eye[0]), a0 = az(look[0], look[1]);
  let lo = Infinity, hi = -Infinity;
  for (const b of boxes) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const a = az(b.c[0] + sx * b.len / 2, b.c[1] + sy * b.halfWidth) - a0, wrapped = Math.atan2(Math.sin(a), Math.cos(a));
    lo = Math.min(lo, wrapped); hi = Math.max(hi, wrapped);
  }
  const r = w * (lo + hi) / 2, dx = look[0] - eye[0], dy = look[1] - eye[1];
  return [eye[0] + dx * Math.cos(r) - dy * Math.sin(r), eye[1] + dx * Math.sin(r) + dy * Math.cos(r), look[2]];
}
// the other car as the page passes it: every number there, or the race cannot be framed (a NaN would frame nothing and say nothing)
function checkedCar(o) {
  const ok = Array.isArray(o.c) && o.c.length === 3 && o.c.every(Number.isFinite) && [o.len, o.halfWidth, o.height].every((x) => Number.isFinite(x) && x > 0);
  if (!ok) throw new Error('drag_cam.js framing: ctx.other needs c [x, y, z] and len, halfWidth, height (cm), got ' + JSON.stringify(o));
  return o;
}

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
