// lot_light.js - UC-44.3 the lot's light follows the visitor: the slide in view is lit full, the others dimmed, and as the camera
// swings from one slide to the next the light hands over with it (the spot, its beam in the air, the pedestal's glowing rim and
// the slide's sign, app.js tickShow). Before (lot pass 11-08 pictures, shots/lotpass/b0_desk_*.png) every stand on the ring was lit
// alike, so the signs and cars beside the one in view were as bright as it and drew the eye away from it.
// The weight is the stand's angle from the camera's own angle on the ring (show.angle, which eases toward the slide chosen), so it
// moves exactly with the camera move, and the intro's fly-in and walking the lot (where the whole ring is in view) light every
// stand (app.js blends to 1). Changing a light's intensity or a uniform rebuilds no shader (the lot's warm-up, UC-30, still holds).
// Pure: test/lot_light.test.mjs.

// AUTHORED (looked at, 11-08 lot pass pictures): what an out-of-view stand keeps of its spot and beam, of its rim's glow (the rims
// stay the ring of light that reads as the lot from across it), and of its sign's brightness (still legible across the ring)
export const LIGHT = { SPOT_DIM: 0.3, RIM_DIM: 0.55, SIGN_DIM: 0.5 };

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** 1 for the stand the camera faces, easing (smoothstep) down to 0 one slide spacing away and beyond; angles in radians */
export function focusWeight(standAngle, viewAngle, spacing) {
  if (!(spacing > 0)) throw new Error('lot_light.focusWeight: spacing must be > 0, got ' + spacing);
  const t = Math.min(1, Math.abs(wrap(standAngle - viewAngle)) / spacing);
  return 1 - t * t * (3 - 2 * t);
}

/** a dimmed level: 1 at weight 1, `dim` at weight 0; `whole` (0..1, the intro's progress inverted, or 1 walking) lifts every
 *  stand back toward 1 */
export function level(weight, dim, whole = 0) {
  const w = weight + (1 - weight) * Math.min(1, Math.max(0, whole));
  return dim + (1 - dim) * w;
}
