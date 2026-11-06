// ghost.js - a ghost of the best lap driven on this device: the car's pose recorded through a lap (on the lap clock the rules keep:
// now - TimeOffset), kept beside the device record, and replayed as a see-through car on the next laps. The ghost and its look are
// the page's own (AUTHORED); the template has none. Serves UC-7.6.
const HZ = 20;                                          // poses kept per second of lap
const KEY = (car) => 'hoc.ghost.' + car;

export function makeRecorder() { return { t: [], p: [], last: -1 }; }

// one pose: posCm (UE), axes [X, Y, Z] (UE, the body's), tLap s since the lap clock started
export function record(R, tLap, posCm, axes) {
  if (tLap - R.last < 1 / HZ) return;
  R.last = tLap; R.t.push(+tLap.toFixed(3));
  R.p.push(posCm.map((v) => +v.toFixed(1)), [...axes[0], ...axes[2]].map((v) => +v.toFixed(4)));
}

export function saveGhost(car, R, lapS) {
  const g = { lap: lapS, t: R.t, p: R.p };
  try { localStorage.setItem(KEY(car), JSON.stringify(g)); return g; } catch (e) { return g; }   // too big or blocked: kept for this play only
}
export function loadGhost(car) {
  try { const s = localStorage.getItem(KEY(car)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}

// the pose at tLap, linear between the two kept poses around it; null past the ghost's own lap
export function ghostPose(g, tLap) {
  const t = g.t;
  if (!t.length || tLap > t[t.length - 1]) return null;
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tLap) lo = m; else hi = m; }
  const f = t[hi] === t[lo] ? 0 : Math.max(0, Math.min(1, (tLap - t[lo]) / (t[hi] - t[lo])));
  const P0 = g.p[2 * lo], P1 = g.p[2 * hi], A0 = g.p[2 * lo + 1], A1 = g.p[2 * hi + 1];
  const pos = P0.map((v, k) => v + (P1[k] - v) * f);
  const ax = A0.map((v, k) => v + (A1[k] - v) * f);
  const X = norm(ax.slice(0, 3)), Z0 = ax.slice(3, 6);
  const Y = norm(cross(Z0, X)), Z = cross(X, Y);         // re-orthonormalised: X forward, Y right, Z up (UE, left-handed)
  return { pos, axes: [X, Y, Z] };
}
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
