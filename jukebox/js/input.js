// Input: a phone (through PhonePad) or the keyboard, turned into lane presses.
// Pure functions over snapshots, so the whole mapping is testable with no phone,
// no relay and no browser (tests/input.test.mjs).
//
// PhonePad hands the page ordinary Gamepad API devices, one per seat, named
// "PhonePad player N ...". Its 'pad' layout has the usual buttons, so the frets are
// a table of button indices rather than anything PhonePad-specific.

// The fret lanes, left to right, in Guitar Hero's colours.
export const LANE_NAMES = ["GREEN", "RED", "YELLOW", "BLUE", "ORANGE"];
export const LANE_COLORS = [
  [0.19, 0.95, 0.38],
  [0.98, 0.21, 0.25],
  [0.99, 0.86, 0.17],
  [0.23, 0.56, 1.0],
  [1.0, 0.56, 0.14],
];

// Held in two hands: the left thumb takes the first three lanes on the d-pad, the
// right thumb the last two on the face buttons, and star power sits under the right
// thumb on Y. Shoulders double up on the outer lanes for anyone who would rather use
// an index finger. Change this table if the reach is wrong; nothing else depends on it.
export const LANE_BUTTONS = [
  [14, 4],   // GREEN  - d-pad left,  LB
  [12],      // RED    - d-pad up
  [15],      // YELLOW - d-pad right
  [2],       // BLUE   - X
  [0, 5],    // ORANGE - A, RB
];
export const STAR_BUTTONS = [3];       // Y
export const PAUSE_BUTTONS = [9];      // Start

// Keyboard, for playing at the desk and for the tests: two rows that both work.
export const LANE_KEYS = [
  ["Digit1", "KeyA"],
  ["Digit2", "KeyS"],
  ["Digit3", "KeyD"],
  ["Digit4", "KeyF"],
  ["Digit5", "KeyG"],
];
export const STAR_KEYS = ["Space", "KeyB"];

// PhonePad names its pads "PhonePad player 1 ...". Returns the 1-based seat, or null
// for any other gamepad, so a real controller plugged into the PC is left alone.
export function seatFromPadId(id) {
  const m = /^PhonePad player (\d+)\b/.exec(String(id || ""));
  if (!m) return null;
  const seat = Number(m[1]);
  return seat >= 1 ? seat : null;
}

// True when `button` is held. Accepts a GamepadButton, a bare boolean or a number,
// which is what makes a snapshot easy to write in a test.
function isDown(button) {
  if (button == null) return false;
  if (typeof button === "boolean") return button;
  if (typeof button === "number") return button > 0.5;
  if (typeof button.pressed === "boolean") return button.pressed;
  if (typeof button.value === "number") return button.value > 0.5;
  return false;
}

// Which lanes a button array is holding down.
export function lanesDown(buttons, laneCount = LANE_BUTTONS.length) {
  const down = new Set();
  for (let lane = 0; lane < laneCount; lane++) {
    for (const index of LANE_BUTTONS[lane]) {
      if (isDown(buttons?.[index])) { down.add(lane); break; }
    }
  }
  return down;
}

export function anyDown(buttons, indices) {
  return indices.some((i) => isDown(buttons?.[i]));
}

// Which lanes a set of held keys is holding down.
export function lanesDownFromKeys(heldCodes, laneCount = LANE_KEYS.length) {
  const down = new Set();
  for (let lane = 0; lane < laneCount; lane++) {
    if (LANE_KEYS[lane].some((code) => heldCodes.has(code))) down.add(lane);
  }
  return down;
}

// The edges between two snapshots of the same seat. This is the whole point of the
// module: the game acts on edges, never on "is held", so one press is one note.
export function edges(prev, next) {
  const pressed = [];
  const released = [];
  for (const lane of next) if (!prev.has(lane)) pressed.push(lane);
  for (const lane of prev) if (!next.has(lane)) released.push(lane);
  pressed.sort((a, b) => a - b);
  released.sort((a, b) => a - b);
  return { pressed, released };
}

// Tracks every seat's held lanes between frames.
export function createTracker() {
  return { seats: new Map() };
}

// Feeds one seat's current state in and gets its edges out. `starDown` and
// `pauseDown` are reported as edges too, so a held button does not retrigger.
export function update(tracker, seatId, down, { starDown = false, pauseDown = false } = {}) {
  let prev = tracker.seats.get(seatId);
  if (!prev) {
    prev = { lanes: new Set(), star: false, pause: false };
    tracker.seats.set(seatId, prev);
  }
  const { pressed, released } = edges(prev.lanes, down);
  const star = starDown && !prev.star;
  const pause = pauseDown && !prev.pause;
  tracker.seats.set(seatId, { lanes: new Set(down), star: starDown, pause: pauseDown });
  return { seat: seatId, pressed, released, star, pause };
}

// A seat that goes away (a phone that slept, PhonePad says, lets go of everything)
// must not leave lanes stuck down, or a sustain would pay for ever.
export function dropSeat(tracker, seatId) {
  const prev = tracker.seats.get(seatId);
  tracker.seats.delete(seatId);
  return { released: prev ? [...prev.lanes].sort((a, b) => a - b) : [] };
}

// Reads the live gamepads into per-seat snapshots. The only impure function here,
// and the only one that touches navigator.
export function readPads(getGamepads, laneCount = LANE_BUTTONS.length) {
  const out = new Map();
  for (const pad of getGamepads() || []) {
    if (!pad || !pad.connected) continue;
    const seat = seatFromPadId(pad.id);
    if (seat === null) continue;
    out.set(seat, {
      down: lanesDown(pad.buttons, laneCount),
      starDown: anyDown(pad.buttons, STAR_BUTTONS),
      pauseDown: anyDown(pad.buttons, PAUSE_BUTTONS),
    });
  }
  return out;
}
