// speedfx.js - UC-33, speed you can feel: the view widens with speed and, fast, the road shakes it a little. Pure (no DOM, no three):
// node (test/speedfx.test.mjs) and the page run the same numbers. READ: the strongest measured cue is the field of view (Holm,
// Skovhus and Kraus 2016, doi 10.1007/978-3-319-55834-9_14; Diels and Parkes 2010, a rendered view 1.22x the screen's removed a ~10 %
// underestimate of speed). AUTHORED, for feel: the widening (FOV_BOOST_DEG horizontal at BOOST_KMH, eased in, followed with a TAU_S
// lag so it never pumps with the throttle) and the shake (from SHAKE_FROM_KMH, SHAKE_DEG at BOOST_KMH, the "trauma" squared as
// GDC 2016's camera-shake talk does, at about SHAKE_HZ). Both off with the page's Motion switch.
export const FX = { FOV_BOOST_DEG: 10, BOOST_KMH: 250, TAU_S: 0.3, SHAKE_FROM_KMH: 150, SHAKE_DEG: 0.15, SHAKE_HZ: 17 };
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export function makeSpeedFx() { return { boost: 0, t: 0 }; }
/** one frame: kmh the car's speed, on the Motion switch. Returns the degrees to add to the horizontal field of view and the shake */
export function stepSpeedFx(s, kmh, dt, on) {
  s.t += dt;
  const want = on ? FX.FOV_BOOST_DEG * smooth(Math.abs(kmh) / FX.BOOST_KMH) : 0;
  s.boost += (want - s.boost) * (1 - Math.exp(-dt / FX.TAU_S));
  const trauma = on ? smooth((Math.abs(kmh) - FX.SHAKE_FROM_KMH) / (FX.BOOST_KMH - FX.SHAKE_FROM_KMH)) : 0;
  const amp = FX.SHAKE_DEG * trauma * trauma, w = 2 * Math.PI * FX.SHAKE_HZ, t = s.t;
  const noise = (a, b, c) => 0.55 * Math.sin(w * t * a + b) + 0.45 * Math.sin(w * t * c + 2 * b);   // two unrelated sines: no visible beat
  return { fovDeg: s.boost, pitchDeg: amp * noise(1, 0.3, 1.618), rollDeg: amp * 0.6 * noise(0.83, 1.7, 1.414), yawDeg: amp * 0.4 * noise(1.13, 2.9, 0.707) };
}
