// drag_sim.js - UC-34, the manual drag car's controls: an H-pattern shift gate for any number of forward gears, where the knob can
// go, which gear a knob position selects, and whether a gear goes in. Pure: no DOM, no three; node (test/drag_sim.test.mjs) and the
// page run the same rules, and the lightweight loop's repros (closed_loop/drag_sim/spec_check) hold them to the spec.
// The rules are the spec's (closed_loop/drag_sim/SPEC.txt), each named:
//   R2  the clutch input is 0 engaged, 1 pressed (Unreal ClutchModule.cpp:29);
//   R6  the clutch decouples the gearbox for a gear change; R9 a change without the clutch fully in is one the synchromesh fights;
//   R8  without the clutch, a gear goes in only when the engine's rpm matches the road speed in it.
// AUTHORED, each said: FULL_CLUTCH 0.95 (how far down counts as "fully" pressed: a finger never reaches exactly 1), MATCH_RPM 3 %
// (how near "the exact speed" must be: an rpm reading is never exact), the gate's shape (two gears to a slot, first top left, as
// most H gates are; neutral the middle row) and the knob's travel in the unit square it draws in.
export const FULL_CLUTCH = 0.95;
export const MATCH_RPM = 0.03;
const ROW = { top: 0.12, mid: 0.5, bottom: 0.88 };
// UC-34.1f AUTHORED (the owner 11-09: "shifting to third is really hard"): a finger this far sideways of the knob's slot (in the gate's
// unit square; the slots of a 7-gear gate are 0.24 apart) takes the knob out of the slot to the middle row, where its next move carries
// it across and into the slot the finger is over. It was held in the slot, so a pull from 2nd up and right towards 3rd went straight up
// the slot into 1st
export const SLOT_EXIT = 0.1;
// UC-50.5 AUTHORED (the owner 11-09: "I can't shift"): the detent, how far from a slot's end the knob may stop and still be in that gear,
// in the gate's unit square (the slot runs 0.38 from the middle row to its end). Was 0.04: the thumb had to reach the very end of the
// slot, and the bottom gears' end sits near the screen's bottom edge, where a phone's home bar takes the touch
export const DETENT = 0.16;

/** the gate for n forward gears: one slot per pair, left to right; slot.x in 0..1, the gear at the top and the one at the bottom */
export function gateLayout(n) {
  if (!(n >= 1 && n <= 12)) throw new Error('drag_sim: a gate for ' + n + ' gears');
  const slots = [];
  const k = Math.ceil(n / 2);
  for (let i = 0; i < k; i++) slots.push({ x: k === 1 ? 0.5 : 0.14 + (0.72 * i) / (k - 1), up: 2 * i + 1, down: 2 * i + 2 <= n ? 2 * i + 2 : null });
  return { n, slots, row: ROW };
}

/** where the knob ends up when the finger asks for `want` ({x, y} in 0..1), moving only along the gate: across the middle row, and
 *  up or down only inside a slot. From inside a slot it first comes back to the middle row */
export function moveKnob(knob, want, layout) {
  const near = layout.slots.reduce((a, s) => (Math.abs(s.x - knob.x) < Math.abs(a.x - knob.x) ? s : a));
  const inSlot = Math.abs(knob.y - ROW.mid) > 0.02;
  if (inSlot) {                                            // in a slot: only up and down it, and out to the middle row
    if (Math.abs(want.x - near.x) > SLOT_EXIT) return { x: near.x, y: ROW.mid };   // UC-34.1f the finger has gone sideways: out to the middle row
    const lo = near.down ? ROW.bottom : ROW.mid;
    return { x: near.x, y: Math.max(ROW.top, Math.min(lo, want.y)) };
  }
  const x = Math.max(layout.slots[0].x, Math.min(layout.slots[layout.slots.length - 1].x, want.x));
  const at = layout.slots.find((s) => Math.abs(s.x - x) < 0.06);   // close to a slot: it can turn into it
  if (at && Math.abs(want.y - ROW.mid) > 0.05) {
    const lo = at.down ? ROW.bottom : ROW.mid;
    return { x: at.x, y: Math.max(ROW.top, Math.min(lo, want.y)) };
  }
  return { x, y: ROW.mid };
}

/** the gear the knob selects: the slot's top gear at the top, its bottom gear at the bottom, else 0 (neutral) */
export function gearAt(knob, layout) {
  const s = layout.slots.find((q) => Math.abs(q.x - knob.x) < 0.02);
  if (!s) return 0;
  if (knob.y <= ROW.top + DETENT) return s.up;
  if (s.down && knob.y >= ROW.bottom - DETENT) return s.down;
  return 0;
}
/** the knob's place for a gear (0: the middle of the neutral row) */
export function knobFor(gear, layout) {
  if (!gear) return { x: 0.5, y: ROW.mid };
  const s = layout.slots.find((q) => q.up === gear || q.down === gear);
  if (!s) throw new Error('drag_sim: no gear ' + gear + ' in a ' + layout.n + '-gear gate');
  return { x: s.x, y: s.up === gear ? ROW.top : ROW.bottom };
}

/** does the gear go in? clutch 0..1 (R2); rpm the engine's; rpmInGear the engine speed the road speed means in that gear.
 *  Neutral always goes in (it engages nothing). R6/R9: the clutch fully in, it goes in; R8: otherwise only with the revs matched */
export function shiftOutcome(gear, clutch, rpm, rpmInGear) {
  if (gear === 0) return { ok: true, why: 'neutral' };
  if (clutch >= FULL_CLUTCH) return { ok: true, why: 'clutch in' };
  if (rpmInGear > 0 && Math.abs(rpm - rpmInGear) <= MATCH_RPM * rpmInGear) return { ok: true, why: 'revs matched' };
  return { ok: false, why: 'grind: the clutch is not fully in and the revs do not match' };
}

// R2's pedal from a pointer (UC-34 1b / 1c). AUTHORED, the page's own: the mouse held and pulled down TRAVEL_PX takes the pedal
// to the floor and it holds wherever the mouse holds it; let go, it springs up over RETURN_S (a foot lifted off); a phone's slider
// maps its track to the same travel. Depth 0 the pedal up (engaged), 1 the floor (R2)
export const PEDAL = { TRAVEL_PX: 220, RETURN_S: 0.12 };
/** where the drag starts from so the pedal carries on from its depth (no jump when it is grabbed while springing up) */
export const pedalGrab = (depth, y) => y - depth * PEDAL.TRAVEL_PX;
/** the depth for the pointer at y, grabbed at anchor */
export const pedalDrag = (anchor, y) => Math.max(0, Math.min(1, (y - anchor) / PEDAL.TRAVEL_PX));
/** let go: the pedal comes up */
export const pedalRelease = (depth, dt) => Math.max(0, depth - (dt > 0 ? dt : 0) / PEDAL.RETURN_S);
// UC-34.1d a computer's clutch on the mouse wheel (the owner 11-08: "I can't hit clutch with mouse AND gate", then "lets use the
// mousewheel as the clutch, left right click as gas"): scrolling down presses the pedal in, up lets it out, and it stays where the
// wheel leaves it (a wheel is not held, so nothing springs back), so the launch is as slow or as quick as the scroll. A notch is
// 100 px of deltaY in Chrome and Edge on Windows; FULL_PX: 8 notches from the top to the floor (AUTHORED). Lines and pages
// (deltaMode 1, 2: Firefox, some mice) count as LINE_PX and PAGE_PX each
export const WHEEL = { FULL_PX: 300, LINE_PX: 33, PAGE_PX: 300 };   // UC-52.1 3 notches (the owner 11-09: "too much rolling to be fast"; it was 8)
export const wheelPx = (deltaY, deltaMode) => deltaY * (deltaMode === 1 ? WHEEL.LINE_PX : deltaMode === 2 ? WHEEL.PAGE_PX : 1);
export const wheelDepth = (depth, deltaY, deltaMode = 0) => Math.max(0, Math.min(1, depth + wheelPx(deltaY, deltaMode) / WHEEL.FULL_PX));
// UC-34.1f AUTHORED (the owner 11-09: "the clutch should engage gears over 75 depressed ... that button is close to the bottom of the
// screen. My finger can't get to the bottom"): the floor is 75 % of the way down the slider's track, and the last quarter is the floor
// too. On the floor (depth 1) a gear goes in (FULL_CLUTCH) and the drive is fully cut, so a car held there on the tree does not creep
export const SLIDER_FULL = 0.75;
/** a slider's depth for a finger at y on a track from top (the pedal up) to bottom: the floor at SLIDER_FULL of the way down */
export const sliderDepth = (y, top, bottom) => Math.max(0, Math.min(1, (y - top) / ((bottom - top) * SLIDER_FULL)));
