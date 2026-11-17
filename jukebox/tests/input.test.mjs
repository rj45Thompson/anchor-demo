//   node jukebox/tests/input.test.mjs
import { suite } from "./harness.mjs";
import {
  LANE_BUTTONS, LANE_COLORS, LANE_KEYS, LANE_NAMES, STAR_BUTTONS,
  anyDown, createTracker, dropSeat, edges, lanesDown, lanesDownFromKeys,
  readPads, seatFromPadId, update,
} from "../js/input.js";

const t = suite("input");

// A button array with the given indices held.
const held = (...indices) => {
  const a = [];
  for (let i = 0; i <= 17; i++) a[i] = { pressed: indices.includes(i) };
  return a;
};
const set = (...v) => new Set(v);
const sorted = (s) => [...s].sort((a, b) => a - b);

// --- the table itself --------------------------------------------------------
t.eq("five lanes", LANE_BUTTONS.length, 5);
t.eq("a name per lane", LANE_NAMES.length, 5);
t.eq("a colour per lane", LANE_COLORS.length, 5);
t.check("every lane has at least one button", LANE_BUTTONS.every((b) => b.length >= 1));
t.check("no button serves two lanes", (() => {
  const all = LANE_BUTTONS.flat();
  return new Set(all).size === all.length;
})());
t.check("star power is not also a fret", !LANE_BUTTONS.flat().some((b) => STAR_BUTTONS.includes(b)));
t.check("a key per lane", LANE_KEYS.every((k) => k.length >= 1));

// --- seat names --------------------------------------------------------------
t.eq("player 1", seatFromPadId("PhonePad player 1 (relay)"), 1);
t.eq("player 4", seatFromPadId("PhonePad player 4 (direct)"), 4);
t.eq("double digits", seatFromPadId("PhonePad player 12 x"), 12);
t.eq("a real controller is ignored", seatFromPadId("Xbox 360 Controller (XInput STANDARD GAMEPAD)"), null);
t.eq("a lookalike is ignored", seatFromPadId("NotPhonePad player 1"), null);
t.eq("no id", seatFromPadId(undefined), null);
t.eq("player 0 is not a seat", seatFromPadId("PhonePad player 0 x"), null);

// --- which lanes are down ----------------------------------------------------
t.deep("d-pad left is lane 0", sorted(lanesDown(held(14))), [0]);
t.deep("X is lane 3", sorted(lanesDown(held(2))), [3]);
t.deep("A is lane 4", sorted(lanesDown(held(0))), [4]);
t.deep("a chord of two", sorted(lanesDown(held(14, 2))), [0, 3]);
t.deep("nothing held", sorted(lanesDown(held())), []);
t.deep("LB doubles for lane 0", sorted(lanesDown(held(4))), [0]);
t.deep("RB doubles for lane 4", sorted(lanesDown(held(5))), [4]);
t.deep("both buttons for one lane is still one lane", sorted(lanesDown(held(0, 5))), [4]);
t.deep("star power is not a lane", sorted(lanesDown(held(3))), []);
t.deep("a narrower chart ignores the high lanes", sorted(lanesDown(held(14, 0), 3)), [0]);
t.eq("star power is seen", anyDown(held(3), STAR_BUTTONS), true);
t.eq("star power is not seen when up", anyDown(held(0), STAR_BUTTONS), false);

// Raw shapes a Gamepad can present.
t.deep("bare booleans work", sorted(lanesDown([true, false, false])), [4]);
t.deep("analogue values work", sorted(lanesDown([{ value: 0.9 }])), [4]);
t.deep("a half-pressed analogue is up", sorted(lanesDown([{ value: 0.2 }])), []);
t.deep("a missing array is nothing", sorted(lanesDown(undefined)), []);

// --- keys --------------------------------------------------------------------
t.deep("Digit1 is lane 0", sorted(lanesDownFromKeys(new Set(["Digit1"]))), [0]);
t.deep("KeyA is lane 0 too", sorted(lanesDownFromKeys(new Set(["KeyA"]))), [0]);
t.deep("a two-key chord", sorted(lanesDownFromKeys(new Set(["KeyA", "KeyF"]))), [0, 3]);
t.deep("an unrelated key does nothing", sorted(lanesDownFromKeys(new Set(["KeyZ"]))), []);

// --- edges -------------------------------------------------------------------
t.deep("a new lane is a press", edges(set(), set(1)), { pressed: [1], released: [] });
t.deep("a dropped lane is a release", edges(set(1), set()), { pressed: [], released: [1] });
t.deep("held is neither", edges(set(1), set(1)), { pressed: [], released: [] });
t.deep("swapping lanes is both", edges(set(1), set(2)), { pressed: [2], released: [1] });
t.deep("edges come out sorted", edges(set(), set(4, 0, 2)), { pressed: [0, 2, 4], released: [] });

// --- the tracker -------------------------------------------------------------
{
  const tr = createTracker();
  t.deep("first sight of a seat presses", update(tr, 1, set(0)).pressed, [0]);
  t.deep("holding does not repeat", update(tr, 1, set(0)).pressed, []);
  t.deep("letting go releases", update(tr, 1, set()).released, [0]);
  // Two seats do not see each other's buttons.
  t.deep("seat 2 is independent", update(tr, 2, set(3)).pressed, [3]);
  t.deep("seat 1 is unaffected", update(tr, 1, set()).pressed, []);
}
{
  const tr = createTracker();
  t.eq("star power is an edge", update(tr, 1, set(), { starDown: true }).star, true);
  t.eq("holding star power does not retrigger", update(tr, 1, set(), { starDown: true }).star, false);
  t.eq("releasing then pressing triggers again", (() => {
    update(tr, 1, set(), { starDown: false });
    return update(tr, 1, set(), { starDown: true }).star;
  })(), true);
  t.eq("pause is an edge too", update(tr, 1, set(), { pauseDown: true }).pause, true);
  t.eq("and does not retrigger", update(tr, 1, set(), { pauseDown: true }).pause, false);
}
{
  // A phone that sleeps must not leave a sustain held for ever.
  const tr = createTracker();
  update(tr, 1, set(0, 3));
  t.deep("dropping a seat releases what it held", dropSeat(tr, 1).released, [0, 3]);
  t.deep("dropping it again releases nothing", dropSeat(tr, 1).released, []);
  t.deep("it comes back fresh", update(tr, 1, set(0)).pressed, [0]);
}

// --- reading the pads --------------------------------------------------------
{
  const pads = [
    { id: "PhonePad player 1 (direct)", connected: true, buttons: held(14) },
    { id: "PhonePad player 2 (relay)", connected: true, buttons: held(2, 3) },
    { id: "PhonePad player 3 (relay)", connected: false, buttons: held(0) },
    { id: "Some Other Pad", connected: true, buttons: held(0) },
    null,
  ];
  const read = readPads(() => pads);
  t.eq("only connected PhonePads are read", read.size, 2);
  t.deep("seat 1's lane", sorted(read.get(1).down), [0]);
  t.deep("seat 2's lane", sorted(read.get(2).down), [3]);
  t.eq("seat 2 is holding star power", read.get(2).starDown, true);
  t.eq("seat 1 is not", read.get(1).starDown, false);
  t.eq("a disconnected pad is absent", read.has(3), false);
  t.eq("an empty list is fine", readPads(() => []).size, 0);
  t.eq("a null list is fine", readPads(() => null).size, 0);
}

t.done();
