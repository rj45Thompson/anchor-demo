// input.js - four seats, one screen. Seat n is player n. Each seat merges what drives it:
//   - the keyboard: seat 0 (left hand) and seat 1 (right hand), each its own key cluster (KEY_CLUSTERS);
//   - a real gamepad: navigator.getGamepads()[n] for n = 0..3, W3C "standard" mapping;
//   - a phone (PhonePad): the phone in seat n appears as a standard gamepad at index base + n (base = 4 with up to four real pads);
//   - player 1's on-screen touch controls (app/controls.js TouchPad), and a tap on the board (main.js reads the pointer).
// CONTROLS_SMOOTH_UC.md UC-C2: every device is SAMPLED - every SAMPLE_MS on a timer, at every key event and at each frame's poll() -
// and each sample is kept per seat as one moment (SeatLatch: what was pressed since the moment before, what was held then). Each game
// tick take(t)s the moments up to its own time t: a press or a push seen by any sample reaches the next tick even when it was let go
// before it, and a slow frame that runs several ticks at once gives each the input as it was at the moment that tick stands for
// (tickMoments), never a key held before it went down.
//
// The button meanings follow the original host's mapping (A confirm / place / fire / strike, B rotate and menu back, Y ready and
// switch mode, X held = move faster, START pause), on the W3C standard layout:
//   0 A, 1 B, 2 X, 3 Y, 5 right shoulder (also rotate), 9 Start, 12..15 d-pad up/down/left/right; axes[0], axes[1] the left stick
//   (+y is down, as the board's +y).

import { KeyBindings } from '../core/controller/KeyBindings.js';

export const SEATS = 4;
const STICK_FULL = 1000;              // the controller's stick scale: -1000..1000
const MENU_STEP = 500;                // a stick pushed past half way is one menu step, once per push
const mid = (pts) => ({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });
const spread = (pts) => Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
const TOUCH = 300;                    // stick travel that counts as a seat being touched (a bot seat hands over)
const RIGHT_DRAG = 6;                 // px of travel that make a right press a camera drag, not a grab / a turn
// how often every device is read between frames: 15 samples inside the pad run's 120 ms press. 11-11 the pads' buttons only; 11-13
// (UC-C2) every device, sticks too: a 300 ms push inside a 362 ms frame had moved the cursor 0 squares
const SAMPLE_MS = 8;
export const FINGER_DRAG = 10;       // AUTHORED (TOUCH_PLACE_UC.md UC-P4): px one finger travels before a touch is a drag, not a tap

/** CONTROLS_SMOOTH_UC.md UC-C2 step 6: the board square a MOUSE pointer names. It is picked (through the live camera) when the pointer
 *  moves or clicks, and kept while it is still: the camera moving under a still pointer does not move the square. Measured 11-13
 *  (run_page ctl, the RAID): the page picked it again every tick, the camera settled 0.7 of a square under a pointer that did not
 *  move, the hero's destination slid from (34,7) to (32,7) and the hero stood still for 5 frames half way, short of where it was
 *  sent. A finger's square was already picked once, at the touch (main.js pointerToPlay). */
export class PointerSquare {
  constructor() { this.cell = null; }
  /** p: the pointer since the last tick (InputHub.takePointer); pick(x, y): the board square under page point (x, y), or null.
   *  Returns the square the pointer names now, or null (none yet, or it last moved off the board). */
  at(p, pick) {
    if ((p.moved || p.click) && !Number.isNaN(p.x)) this.cell = pick(p.x, p.y);
    return this.cell;
  }
}

// The keyboard clusters live in core/controller/KeyBindings.js (UC-ST3, 11-10): the shipped keys and the player's rebinds. Every poll
// reads `bindings.clusters`, so a rebind acts on the next frame.
const clusterKeys = (c) => [...c.up, ...c.down, ...c.left, ...c.right, ...c.confirm, ...c.rotate, ...c.back, ...c.swap, ...c.ready, ...c.start, ...c.fast, ...c.grab, ...c.drop, ...c.trap, ...c.buy.flat()];

const PAD = Object.freeze({ A: 0, B: 1, X: 2, Y: 3, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 });

/** The presses a moment carries (true when pressed since the moment before; up..right are the direction steps the menus and the
 *  step phases take: a key, the d-pad, or the merged stick crossing MENU_STEP). */
const EDGES = Object.freeze(['confirm', 'rotate', 'ready', 'swap', 'back', 'start', 'info', 'tap', 'drop', 'pickUp', 'trap', 'up', 'down', 'left', 'right']);

/** UC-C2: one seat's devices at one moment `t` (performance.now() ms): what was pressed since the seat's moment before (EDGES, and buy:
 *  an ItemKind or -1) and what was HELD then (the merged stick, fast, and the bomb rule set's grab and defuse). take(t) gives a tick the
 *  presses of every moment up to t and the held state of the last of them. */
export class SeatLatch {
  constructor(t = -Infinity) {
    this.t = t;
    this.stickX = 0; this.stickY = 0; this.fast = false; this.grab = false; this.defuse = false;
    for (const k of EDGES) this[k] = false;   // info: H or a pad's X, the controls & credits panel (TITLE_UC.md UC-T1 step 3)
    this.buy = -1;
  }
  /** It carries a press, or holds something other than `before` held: worth keeping (a moment like the one before it is not). */
  differsFrom(before) {
    return this.buy >= 0 || EDGES.some((k) => this[k]) || this.stickX !== before.stickX || this.stickY !== before.stickY
      || this.fast !== before.fast || this.grab !== before.grab || this.defuse !== before.defuse;
  }
}

/** UC-C2 step 3: the moments (ms) the `n` ticks of one frame stand for. A frame that runs several ticks (catching up after a slow
 *  one) runs them all at once, but the last stands for `now` (its poll) and each earlier one for `tickMs` before the next: take(t) then
 *  gives each tick the input as it was at its own moment. tickMs is the tick's length in page time (1000 / ticks per second / speed). */
export function tickMoments(now, n, tickMs) {
  if (!(Number.isInteger(n) && n >= 0) || !(tickMs > 0)) throw new RangeError('tickMoments(now, n >= 0 whole, tickMs > 0), got ' + [now, n, tickMs]);
  const out = [];
  for (let k = 0; k < n; k++) out.push(now - (n - 1 - k) * tickMs);
  return out;
}

/** Which devices sit in a seat right now (the join screen and the HUD show it). */
export class SeatDevices {
  // keysUsed / mouseUsed: a key of the seat's cluster / the mouse has been pressed on this page (the join screen names only the
  // devices a player has used; `keyboard` stays the seat's presence, which never drops for a keyboard seat)
  constructor() { this.keyboard = false; this.pad = false; this.phone = false; this.touch = false; this.padId = ''; this.keysUsed = false; this.mouseUsed = false; }
  get any() { return this.keyboard || this.pad || this.phone || this.touch; }
}

export class InputHub {
  /** bindings: the KeyBindings the keyboard clusters are read from (main.js keeps the player's own; a test passes the shipped ones). */
  constructor(target = window, bindings = KeyBindings.defaults()) {
    if (!(bindings instanceof KeyBindings)) throw new TypeError('InputHub: bindings is a KeyBindings');
    this.bindings = bindings;
    this.captureKey = null;         // UC-ST3 step 2: while the KEYS panel waits for a key, the next key press goes here and is not played
    this.down = new Set();          // key codes held now
    this.pressed = new Set();       // key codes pressed since the last poll (edges)
    this.released = new Set();      // key codes let go since the last poll
    this.moments = Array.from({ length: SEATS }, () => []);         // UC-C2: each seat's sampled moments the ticks have not taken
    this.lastMoment = Array.from({ length: SEATS }, () => new SeatLatch());   // the newest moment sampled (kept or not)
    this.taken = Array.from({ length: SEATS }, () => new SeatLatch());        // the moment the last take ended on: held until a newer one
    this.lastT = -Infinity;         // moments are kept in time order: a sample is never stamped before the one before it
    this.devices = Array.from({ length: SEATS }, () => new SeatDevices());
    this.touched = new Array(SEATS).fill(false);
    this.prevStick = Array.from({ length: SEATS }, () => [0, 0]);
    this.padNow = new Map();        // gamepad slot -> pressed[] at the last sample
    this.padEdges = new Map();      // gamepad slot -> { rise, fall }: the buttons that went down / came up since the last sample
    // every device is SAMPLED on a timer as well as each frame (11-11 the pads' buttons, 11-13 everything): a frame the GPU holds for
    // 0.3-0.7 s (the page's own script idle) let a press and its release both fall between two polls, and the press was lost
    if (typeof setInterval === 'function') setInterval(() => this.sample(performance.now()), SAMPLE_MS);
    this.phonepad = null;           // the PhonePad host, once its room is open
    this.anyKey = false;            // any key or button at all since the last take (wakes the audio, leaves the demo)
    // a key is sampled the moment it goes down and the moment it comes up, so a tick sees it held for exactly as long as it was
    target.addEventListener('keydown', (e) => {
      if (this.captureKey && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); const f = this.captureKey; this.captureKey = null; f(e.code); this.anyKey = true; return; }
      if (this.ownKeys.has(e.code)) e.preventDefault();  // Tab must not move focus, Space must not scroll, Backspace must not navigate
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this.anyKey = true;
      this.sample(performance.now());
    });
    target.addEventListener('keyup', (e) => { this.down.delete(e.code); this.released.add(e.code); this.sample(performance.now()); });
    target.addEventListener('blur', () => { this.down.clear(); this.sample(performance.now()); });   // a key held while the window lost focus must not stick
    // the pointer (a mouse, a pen or a finger) for the menus: where it is, and whether it moved or pressed since the last take. A
    // press on a link or a control of the page (the credits, the front-page link) belongs to that control, not to the game.
    // confirm / rotate / ready: the buttons pressed since the last take, for play (a left click is BOTH a menu click and a play
    // confirm, as on the private model's host; main.js uses each only where it belongs). WHEEL_GAP: ms between two wheel turns, so a
    // trackpad's burst of wheel events is one turn.
    this.pointer = { x: NaN, y: NaN, ax: NaN, ay: NaN, moved: false, click: false, confirm: false, rotate: false, ready: false, swap: false, touch: false, tap: false, grabPulse: false };
    // the player's own camera since the last take (render/camera.js userInput): wheel steps, a drag's pan in px, a pinch ratio, the
    // whole-island toggle (Z). A right DRAG pans and a right CLICK turns the piece (decided when the button lifts: RIGHT_DRAG px of
    // travel make it a drag); two fingers that move pan and pinch, two that only tap turn the piece.
    this.cam = { wheel: 0, panX: 0, panY: 0, pinch: 1, toggle: false };
    const TWO_DRAG = 12;
    this.right = null;              // a right button held: { x, y, travel }
    this.fingerAt = new Map();      // where each finger on the board is (pointerId -> {x, y})
    this.twoTravel = 0;
    const own2 = (e) => !(e.target instanceof Element && e.target.closest('a, button, input, select, textarea, [data-nogame]'));
    // a finger on the board: the hero goes where it touches, and the tap acts when it LIFTS (so a second finger can still make it a
    // two-finger tap, which turns the piece instead). A tap that began outside play (the START tap) acts on nothing in play.
    this.fingers = new Set(); this.twoFinger = false; this.fingerInPlay = false;
    this.keysUsed = new Array(SEATS).fill(false); this.mouseUsed = false;
    this.bombMode = false;          // main.js: the match plays the bomb rule set (B grabs and defuses, a right click grabs instead of turning)
    this.playing = false;           // main.js says whether a match is being played, each tick
    this.enterReadies = false;      // main.js: in a match without player 2, Enter is player 1's READY
    this.bar = null;                // the on-screen action bar (app/actions.js), player 1's like the touch controls
    const lift = (e) => {
      if (e.pointerType !== 'touch') {
        if (e.button === 2 && this.right) {                                   // a right click turns the piece - or, with bombs, grabs
          if (this.right.travel < RIGHT_DRAG) { if (this.bombMode) this.pointer.tap = true; else this.pointer.rotate = true; }
          this.right = null;
        }
        return;
      }
      if (!this.fingers.has(e.pointerId)) return;
      this.fingers.delete(e.pointerId); this.fingerAt.delete(e.pointerId);
      if (this.fingers.size > 0) return;
      const p = this.pointer;
      if (this.twoFinger) { if (this.fingerInPlay && this.twoTravel < TWO_DRAG) p.rotate = true; }
      else if (e.type === 'pointerup' && this.fingerInPlay && this.playing) { p.x = e.clientX; p.y = e.clientY; p.moved = true; p.confirm = true; p.dragged = this.fingerTravel >= FINGER_DRAG; }
      this.twoFinger = false;
    };
    target.addEventListener('pointerup', lift);
    target.addEventListener('pointercancel', lift);
    target.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && this.fingerAt.has(e.pointerId)) {
        if (this.fingers.size >= 2) {                                   // two fingers: their middle pans, their spread zooms
          const pts = [...this.fingerAt.values()], m0 = mid(pts), d0 = spread(pts);
          this.fingerAt.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const pts1 = [...this.fingerAt.values()], m1 = mid(pts1), d1 = spread(pts1);
          this.cam.panX += m1.x - m0.x; this.cam.panY += m1.y - m0.y;
          if (d0 > 1 && d1 > 1) this.cam.pinch *= d1 / d0;
          this.twoTravel += Math.hypot(m1.x - m0.x, m1.y - m0.y) + Math.abs(d1 - d0);
          return;                                                       // the hero does not follow a two-finger gesture
        }
        const was = this.fingerAt.get(e.pointerId);
        this.fingerTravel += Math.hypot(e.clientX - was.x, e.clientY - was.y);   // UC-P4: one finger's travel since it went down
        this.fingerAt.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (this.right && (e.buttons & 2)) {                              // a right drag pans the camera
        const dx = e.clientX - this.right.x, dy = e.clientY - this.right.y;
        this.right.travel += Math.hypot(dx, dy); this.right.x = e.clientX; this.right.y = e.clientY;
        if (this.right.travel >= RIGHT_DRAG) { this.cam.panX += dx; this.cam.panY += dy; }
      }
      if (!own2(e)) return;
      // UC-C2 step 8: 'moved' is travel from where the pointer LAST counted as moved (ax, ay), not from the last event: a slow drag in
      // 1 px events never travelled 2 px from its previous event, so it never counted as moved and PointerSquare kept a stale square
      const p = this.pointer, far = !(Math.abs(e.clientX - p.ax) <= 2 && Math.abs(e.clientY - p.ay) <= 2);
      p.x = e.clientX; p.y = e.clientY; if (far) { p.moved = true; p.ax = e.clientX; p.ay = e.clientY; }
    });
    target.addEventListener('pointerdown', (e) => {
      if (!own2(e)) return;
      const p = this.pointer;
      this.anyKey = true;
      if (e.pointerType === 'touch') {
        this.fingers.add(e.pointerId); this.fingerAt.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.fingers.size === 1) { p.x = e.clientX; p.y = e.clientY; p.moved = true; p.click = true; p.touch = true; this.fingerInPlay = this.playing; this.fingerTravel = 0; }
        else { this.twoFinger = true; this.twoTravel = 0; }
        return;
      }
      p.x = e.clientX; p.y = e.clientY; p.moved = true; p.touch = false; this.mouseUsed = true;
      if (e.button === 0) { p.click = true; p.confirm = true; }           // the left button or a pen touch
      else if (e.button === 2) { this.right = { x: e.clientX, y: e.clientY, travel: 0 }; p.grabPulse = true; }   // right: turn the piece (a click) or pan (a drag)
      else if (e.button === 1) { p.ready = true; p.swap = true; e.preventDefault(); }    // middle: ready or swap tool, an extra (the action bar and keys do both) (and no auto-scroll)
    });
    target.addEventListener('contextmenu', (e) => { if (own2(e)) e.preventDefault(); });   // the right button turns, it opens no menu
    target.addEventListener('wheel', (e) => {                            // the wheel zooms the camera (down = out)
      if (!own2(e) || e.deltaY === 0) return;
      this.cam.wheel += Math.max(-3, Math.min(3, e.deltaY / (e.deltaMode === 1 ? 3 : 100)));
    }, { passive: true });
    target.addEventListener('keydown', (e) => { if (e.code === 'KeyZ' && !e.repeat) this.cam.toggle = true; });   // whole island
  }

  /** Every key a cluster uses now (its default is kept from the page's scroll, focus and back keys), rebuilt after a rebind. */
  get ownKeys() {
    const cl = this.bindings.clusters;
    if (this._ownFrom !== cl) { this._ownFrom = cl; this._own = new Set(cl.flatMap(clusterKeys)); }
    return this._own;
  }

  /** The player's camera input since the last call (render/camera.js userInput's fields); clears it. */
  takeCamera() { const c = this.cam; this.cam = { wheel: 0, panX: 0, panY: 0, pinch: 1, toggle: false }; return c; }

  /** The pointer since the last call: { x, y (CSS px in the window), moved, click, touch (a finger) }; clears moved and click. */
  takePointer() {
    const p = this.pointer;
    // grab: the right button is down and is not a camera drag (a press shorter than a tick still counts, grabPulse); tap: it was let go
    // dragging: one finger is down on the board and has travelled FINGER_DRAG px (UC-P4); dragged: the finger that just lifted did
    const dragging = this.fingers.size === 1 && !this.twoFinger && this.fingerInPlay && (this.fingerTravel ?? 0) >= FINGER_DRAG;
    const out = { x: p.x, y: p.y, moved: p.moved, click: p.click, confirm: p.confirm, rotate: p.rotate, ready: p.ready, swap: p.swap, touch: p.touch,
                  dragging, dragged: !!p.dragged,
                  grab: this.bombMode && (p.grabPulse || (this.right !== null && this.right.travel < RIGHT_DRAG)), tap: p.tap };
    p.moved = p.click = p.confirm = p.rotate = p.ready = p.swap = p.tap = p.grabPulse = p.dragged = false;
    return out;
  }

  /** The PhonePad host once its room is open (null when it closes): its phones are read as pads at index base() + seat. */
  attachPhones(phonepad) { this.phonepad = phonepad; }
  /** Player 1's on-screen touch controls (app/controls.js TouchPad). */
  attachTouch(touchpad) { this.touchpad = touchpad; }
  /** Player 1's on-screen action bar (app/actions.js ActionBar). */
  attachBar(bar) { this.bar = bar; }

  /** Read every device once; call each animation frame, before its ticks. `now`: performance.now() (the ticks' moments are counted
   *  back from it, tickMoments). */
  poll(now) {
    if (typeof now !== 'number' || Number.isNaN(now)) throw new TypeError('InputHub.poll(now): now is performance.now(), got ' + now);
    this.sample(now);
  }

  /** UC-C2 step 2: read every device NOW and keep, per seat, the moment `t` (performance.now() ms): what was pressed since that seat's
   *  moment before and what is held now. The timer, every key event and poll() call it; take(t) hands the moments to the ticks. */
  sample(t) {
    t = Math.max(t, this.lastT); this.lastT = t;
    const sticks = Array.from({ length: SEATS }, () => [0, 0]);
    const rec = Array.from({ length: SEATS }, () => new SeatLatch(t));
    const fast = new Array(SEATS).fill(false);
    for (const d of this.devices) { d.keyboard = false; d.pad = false; d.phone = false; d.touch = false; d.padId = ''; }

    for (const c of this.bindings.clusters) {
      const s = c.seat, L = rec[s], held = (keys) => keys.some((k) => this.down.has(k)), hit = (keys) => keys.some((k) => this.pressed.has(k));
      this.devices[s].keyboard = true;
      if (held(c.left)) sticks[s][0] -= STICK_FULL;
      if (held(c.right)) sticks[s][0] += STICK_FULL;
      if (held(c.up)) sticks[s][1] -= STICK_FULL;
      if (held(c.down)) sticks[s][1] += STICK_FULL;
      L.up ||= hit(c.up); L.down ||= hit(c.down); L.left ||= hit(c.left); L.right ||= hit(c.right);
      // Enter is also player 1's READY while player 2 is not in the match (it is player 2's place key when they are)
      const readyKeys = s === 0 && this.enterReadies && this.bindings.enterFree ? [...c.ready, 'Enter', 'NumpadEnter'] : c.ready;
      if (this.bombMode) {
        L.grab ||= held(c.grab); L.tap ||= this.released.has(c.grab[0]); L.drop ||= hit(c.drop); L.trap ||= hit(c.trap);
        c.buy.forEach((keys, item) => { if (hit(keys)) L.buy = item; });
        if (hit(c.grab) || hit(c.drop) || hit(c.trap) || c.buy.some(hit)) this.touched[s] = true;
      }
      L.confirm ||= hit(c.confirm); L.rotate ||= hit(c.rotate); L.back ||= hit(c.back); L.swap ||= hit(c.swap); L.ready ||= hit(readyKeys); L.start ||= hit(c.start);
      fast[s] ||= held(c.fast);
      if (s === 0) L.info ||= hit(['KeyH']);                         // no cluster uses H: it is player 1's, like the mouse
      if (hit(c.confirm) || hit(c.rotate) || hit(c.swap) || hit(readyKeys) || hit(c.start)) this.touched[s] = true;
      if ([c.up, c.down, c.left, c.right, c.confirm, c.rotate, c.back, c.swap, readyKeys, c.start].some(hit)) this.keysUsed[s] = true;
      this.devices[s].keysUsed = this.keysUsed[s]; this.devices[s].mouseUsed = s === 0 && this.mouseUsed;
    }
    this.pressed.clear(); this.released.clear();

    if (this.touchpad && this.touchpad.visible) {                     // the on-screen stick and buttons are player 1's
      const t = this.touchpad.take(), L = rec[0];
      this.devices[0].touch = true;
      sticks[0][0] += t.stickX; sticks[0][1] += t.stickY;
      L.confirm ||= t.confirm; L.rotate ||= t.rotate; L.back ||= t.back; L.ready ||= t.ready; L.swap ||= t.ready; L.start ||= t.start;   // Y: both (the phase picks)
      L.grab ||= t.grab; L.tap ||= t.tap;
      if (t.confirm || t.rotate || t.ready || t.start || t.grab || t.tap) this.touched[0] = true;
    }
    if (this.bar && this.bar.visible) {                               // the action bar: player 1's, for the mouse and the keyboard
      const t = this.bar.take(), L = rec[0];
      L.confirm ||= t.confirm; L.rotate ||= t.rotate; L.back ||= t.rotate; L.swap ||= t.swap; L.ready ||= t.ready;
      L.drop ||= t.drop; L.pickUp ||= t.pickUp; L.defuse ||= t.defuse; L.trap ||= t.trap; if (t.buy >= 0) L.buy = t.buy;
      if (t.confirm || t.rotate || t.swap || t.ready || t.drop || t.pickUp || t.defuse || t.trap || t.buy >= 0) this.touched[0] = true;
    }

    const list = this.samplePads();
    const base = this.phonepad ? this.phonepad.base() : 4;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g || !g.connected) continue;
      let seat, phone;
      if (i < 4) { seat = i; phone = false; }                         // a real pad in slot i drives seat i
      else if (this.phonepad && i >= base && i < base + SEATS) { seat = i - base; phone = true; }
      else continue;                                                  // a fifth real pad has no seat
      if (g.mapping !== 'standard') {
        // a pad the browser cannot lay out as standard: its buttons would mean nothing - say so in the seat, do not guess
        this.devices[seat].padId = 'unsupported layout: ' + g.id;
        continue;
      }
      if (phone) this.devices[seat].phone = true; else { this.devices[seat].pad = true; this.devices[seat].padId = g.id; }
      const now = this.padNow.get(i) || [], { rise, fall } = this.padEdges.get(i) || { rise: new Set(), fall: new Set() };
      this.padEdges.delete(i);
      const edge = (k) => rise.has(k);
      const L = rec[seat];
      let sx = Math.round((g.axes[0] || 0) * STICK_FULL), sy = Math.round((g.axes[1] || 0) * STICK_FULL);
      if (now[PAD.LEFT]) sx -= STICK_FULL;
      if (now[PAD.RIGHT]) sx += STICK_FULL;
      if (now[PAD.UP]) sy -= STICK_FULL;
      if (now[PAD.DOWN]) sy += STICK_FULL;
      sticks[seat][0] += sx; sticks[seat][1] += sy;
      L.up ||= edge(PAD.UP); L.down ||= edge(PAD.DOWN); L.left ||= edge(PAD.LEFT); L.right ||= edge(PAD.RIGHT);
      // with bombs B is grab (held) and tap (let go); the right shoulder still turns the piece
      if (this.bombMode) { L.grab ||= !!now[PAD.B] || edge(PAD.B); L.tap ||= fall.has(PAD.B); L.rotate ||= edge(PAD.RB); }
      else L.rotate ||= edge(PAD.B) || edge(PAD.RB);
      L.confirm ||= edge(PAD.A); L.back ||= edge(PAD.B);
      L.ready ||= edge(PAD.Y); L.swap ||= edge(PAD.Y); L.start ||= edge(PAD.START);
      fast[seat] ||= !!now[PAD.X];
      L.info ||= edge(PAD.X);                                         // X is held for fast in a match; at the menus a press is info
      if (rise.size) { this.touched[seat] = true; this.anyKey = true; }
    }

    for (let s = 0; s < SEATS; s++) {
      const L = rec[s];
      const sx = Math.max(-STICK_FULL, Math.min(STICK_FULL, sticks[s][0])), sy = Math.max(-STICK_FULL, Math.min(STICK_FULL, sticks[s][1]));
      const [px, py] = this.prevStick[s];
      // a stick pushed past half way counts as one menu step, once per push (key presses already gave their own edges above); the
      // crossing is between two SAMPLES, so a push seen by one sample counts even when the frames around it never saw it (UC-C2)
      L.up ||= sy < -MENU_STEP && py >= -MENU_STEP && !this.keyHeldDir(s, 'up');
      L.down ||= sy > MENU_STEP && py <= MENU_STEP && !this.keyHeldDir(s, 'down');
      L.left ||= sx < -MENU_STEP && px >= -MENU_STEP && !this.keyHeldDir(s, 'left');
      L.right ||= sx > MENU_STEP && px <= MENU_STEP && !this.keyHeldDir(s, 'right');
      this.prevStick[s] = [sx, sy];
      L.stickX = sx; L.stickY = sy; L.fast = fast[s];
      if (Math.abs(sx) > TOUCH || Math.abs(sy) > TOUCH) this.touched[s] = true;
      if (L.differsFrom(this.lastMoment[s])) this.moments[s].push(L);
      this.lastMoment[s] = L;
    }
  }

  /** Read every standard pad's buttons and keep what went down and came up since the last sample (sample() calls it); returns the
   *  browser's pad list. */
  samplePads() {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g || !g.connected || g.mapping !== 'standard') continue;
      const prev = this.padNow.get(i) || [], now = g.buttons.map((b) => b.pressed);
      let e = this.padEdges.get(i);
      if (!e) { e = { rise: new Set(), fall: new Set() }; this.padEdges.set(i, e); }
      for (let k = 0; k < now.length; k++) { if (now[k] && !prev[k]) e.rise.add(k); else if (!now[k] && prev[k]) e.fall.add(k); }
      this.padNow.set(i, now);
    }
    return list;
  }

  /** A key cluster's direction key is held: its press already made the menu edge, the stick crossing must not make a second. */
  keyHeldDir(seat, dir) {
    const c = this.bindings.clusters.find((k) => k.seat === seat);
    return !!c && c[dir].some((k) => this.down.has(k));
  }

  /**
   * What the tick standing for moment `t` takes (UC-C2 step 3; tickMoments): every seat's presses from all its moments up to t (a press
   * let go before the tick still counts), and what was HELD at the last of them - not at the poll, so a tick that stands for a moment
   * before a key went down does not see it held. As plain field sets the controller's PadInput and the menu's MenuInput are filled
   * from. Moments after t wait for a later tick; take() with no t takes them all.
   */
  take(t = Infinity) {
    if (typeof t !== 'number' || Number.isNaN(t)) throw new TypeError('InputHub.take(t): t is a moment in ms, got ' + t);
    const out = [];
    for (let s = 0; s < SEATS; s++) {
      const q = this.moments[s], E = new SeatLatch();
      let held = this.taken[s], n = 0, grabAny = false, defuseAny = false;
      while (n < q.length && q[n].t <= t) {
        const m = q[n++];
        for (const k of EDGES) E[k] ||= m[k];
        if (m.buy >= 0) E.buy = m.buy;
        grabAny ||= m.grab; defuseAny ||= m.defuse;   // the bomb rule set: a grab or defuse shorter than a tick still counts
        held = m;
      }
      q.splice(0, n);
      this.taken[s] = held;
      out.push({
        pad: { stickX: held.stickX, stickY: held.stickY, confirm: E.confirm, rotate: E.rotate, ready: E.ready, swap: E.swap, fast: held.fast,
               grab: held.grab || grabAny, defuse: held.defuse || defuseAny, tap: E.tap, drop: E.drop, pickUp: E.pickUp, trap: E.trap, buy: E.buy,
               // UC-C1: the same latched direction presses the menus step on, so the cursor steps a square per press in play
               stepX: (E.right ? 1 : 0) - (E.left ? 1 : 0), stepY: (E.down ? 1 : 0) - (E.up ? 1 : 0) },
        menu: { up: E.up, down: E.down, left: E.left, right: E.right, confirm: E.confirm, back: E.back, start: E.start },
        info: E.info,
      });
    }
    this.anyKey = false;
    return out;
  }

  /** Seats that pressed or pushed anything since the last call (and clears that). */
  takeTouched() { const t = this.touched.slice(); this.touched.fill(false); return t; }
}
