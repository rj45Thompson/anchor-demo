// input.js - four seats, one screen. Seat n is player n. Each seat merges what drives it:
//   - the keyboard: seat 0 (left hand) and seat 1 (right hand), each its own key cluster (KEY_CLUSTERS);
//   - a real gamepad: navigator.getGamepads()[n] for n = 0..3, W3C "standard" mapping;
//   - a phone (PhonePad): the phone in seat n appears as a standard gamepad at index base + n (base = 4 with up to four real pads);
//   - player 1's on-screen touch controls (app/controls.js TouchPad), and a tap on the board (main.js reads the pointer).
// Every animation frame poll() reads them; presses are LATCHED until the next game tick take()s them, because the page draws faster
// than the rules tick and a press that fell between two ticks would otherwise be lost.
//
// The button meanings follow the original host's mapping (A confirm / place / fire / strike, B rotate and menu back, Y ready and
// switch mode, X held = move faster, START pause), on the W3C standard layout:
//   0 A, 1 B, 2 X, 3 Y, 5 right shoulder (also rotate), 9 Start, 12..15 d-pad up/down/left/right; axes[0], axes[1] the left stick
//   (+y is down, as the board's +y).

export const SEATS = 4;
const STICK_FULL = 1000;              // the controller's stick scale: -1000..1000
const MENU_STEP = 500;                // a stick pushed past half way is one menu step, once per push
const TOUCH = 300;                    // stick travel that counts as a seat being touched (a bot seat hands over)

/** Keyboard clusters: KeyboardEvent.code values per action. */
export const KEY_CLUSTERS = Object.freeze([
  Object.freeze({
    seat: 0, label: 'Player 1 keys',
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    confirm: ['Space'], rotate: ['KeyR'], back: ['Backspace'], ready: ['Tab'], start: ['Escape'], fast: ['ShiftLeft'],
    help: 'WASD move, Space place/fire, R rotate, Tab ready, Left Shift fast, Esc pause, Backspace back',
  }),
  Object.freeze({
    seat: 1, label: 'Player 2 keys',
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    confirm: ['Enter', 'NumpadEnter'], rotate: ['ShiftRight'], back: ['ShiftRight'], ready: ['Slash'], start: ['Backslash'], fast: ['ControlRight'],
    help: 'Arrows move, Enter place/fire, Right Shift rotate/back, / ready, Right Ctrl fast, \\ pause',
  }),
]);

const PAD = Object.freeze({ A: 0, B: 1, X: 2, Y: 3, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 });

/** What one seat's devices said since the last tick: the match pad and the menu buttons (edges latched, the stick as now). */
export class SeatLatch {
  constructor() { this.clear(); this.stickX = 0; this.stickY = 0; this.fast = false; }
  clear() {
    this.confirm = false; this.rotate = false; this.ready = false;
    this.up = false; this.down = false; this.left = false; this.right = false; this.back = false; this.start = false;
  }
}

/** Which devices sit in a seat right now (the join screen and the HUD show it). */
export class SeatDevices {
  constructor() { this.keyboard = false; this.pad = false; this.phone = false; this.touch = false; this.padId = ''; }
  get any() { return this.keyboard || this.pad || this.phone || this.touch; }
}

export class InputHub {
  constructor(target = window) {
    this.down = new Set();          // key codes held now
    this.pressed = new Set();       // key codes pressed since the last poll (edges)
    this.latch = Array.from({ length: SEATS }, () => new SeatLatch());
    this.devices = Array.from({ length: SEATS }, () => new SeatDevices());
    this.touched = new Array(SEATS).fill(false);
    this.prevStick = Array.from({ length: SEATS }, () => [0, 0]);
    this.prevButtons = new Map();   // gamepad slot key -> pressed[] of the last poll
    this.phonepad = null;           // the PhonePad host, once its room is open
    this.anyKey = false;            // any key or button at all since the last take (wakes the audio, leaves the demo)
    const own = new Set(KEY_CLUSTERS.flatMap((c) => [...c.up, ...c.down, ...c.left, ...c.right, ...c.confirm, ...c.rotate, ...c.back, ...c.ready, ...c.start, ...c.fast]));
    this.ownKeys = own;
    target.addEventListener('keydown', (e) => {
      if (own.has(e.code)) e.preventDefault();          // Tab must not move focus, Space must not scroll, Backspace must not navigate
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this.anyKey = true;
    });
    target.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    target.addEventListener('blur', () => this.down.clear());   // a key held while the window lost focus must not stick
    // the pointer (a mouse, a pen or a finger) for the menus: where it is, and whether it moved or pressed since the last take. A
    // press on a link or a control of the page (the credits, the front-page link) belongs to that control, not to the game.
    // confirm / rotate / ready: the buttons pressed since the last take, for play (a left click is BOTH a menu click and a play
    // confirm, as on the private model's host; main.js uses each only where it belongs). WHEEL_GAP: ms between two wheel turns, so a
    // trackpad's burst of wheel events is one turn.
    this.pointer = { x: NaN, y: NaN, moved: false, click: false, confirm: false, rotate: false, ready: false, lastWheel: -1e9 };
    const WHEEL_GAP = 160;
    const own2 = (e) => !(e.target instanceof Element && e.target.closest('a, button, input, select, textarea, [data-nogame]'));
    // a finger on the board: the hero goes where it touches, and the tap acts when it LIFTS (so a second finger can still make it a
    // two-finger tap, which turns the piece instead). A tap that began outside play (the START tap) acts on nothing in play.
    this.fingers = new Set(); this.twoFinger = false; this.fingerInPlay = false;
    this.playing = false;           // main.js says whether a match is being played, each tick
    const lift = (e) => {
      if (e.pointerType !== 'touch' || !this.fingers.has(e.pointerId)) return;
      this.fingers.delete(e.pointerId);
      if (this.fingers.size > 0) return;
      const p = this.pointer;
      if (this.twoFinger) { if (this.fingerInPlay) p.rotate = true; }
      else if (e.type === 'pointerup' && this.fingerInPlay && this.playing) { p.x = e.clientX; p.y = e.clientY; p.moved = true; p.confirm = true; }
      this.twoFinger = false;
    };
    target.addEventListener('pointerup', lift);
    target.addEventListener('pointercancel', lift);
    target.addEventListener('pointermove', (e) => {
      if (!own2(e)) return;
      const p = this.pointer, far = !(Math.abs(e.clientX - p.x) <= 2 && Math.abs(e.clientY - p.y) <= 2);
      p.x = e.clientX; p.y = e.clientY; if (far) p.moved = true;
    });
    target.addEventListener('pointerdown', (e) => {
      if (!own2(e)) return;
      const p = this.pointer;
      this.anyKey = true;
      if (e.pointerType === 'touch') {
        this.fingers.add(e.pointerId);
        if (this.fingers.size === 1) { p.x = e.clientX; p.y = e.clientY; p.moved = true; p.click = true; this.fingerInPlay = this.playing; }
        else this.twoFinger = true;
        return;
      }
      p.x = e.clientX; p.y = e.clientY; p.moved = true;
      if (e.button === 0) { p.click = true; p.confirm = true; }           // the left button or a pen touch
      else if (e.button === 2) p.rotate = true;                           // right: turn the piece
      else if (e.button === 1) { p.ready = true; e.preventDefault(); }    // middle: ready / swap tool (and no auto-scroll)
    });
    target.addEventListener('contextmenu', (e) => { if (own2(e)) e.preventDefault(); });   // the right button turns, it opens no menu
    target.addEventListener('wheel', (e) => {
      if (!own2(e) || e.deltaY === 0) return;
      const p = this.pointer, now = performance.now();
      if (now - p.lastWheel >= WHEEL_GAP) { p.rotate = true; p.lastWheel = now; }
    }, { passive: true });
  }

  /** The pointer since the last call: { x, y (CSS px in the window), moved, click }; clears moved and click. */
  takePointer() {
    const p = this.pointer, out = { x: p.x, y: p.y, moved: p.moved, click: p.click, confirm: p.confirm, rotate: p.rotate, ready: p.ready };
    p.moved = p.click = p.confirm = p.rotate = p.ready = false;
    return out;
  }

  /** The PhonePad host once its room is open (null when it closes): its phones are read as pads at index base() + seat. */
  attachPhones(phonepad) { this.phonepad = phonepad; }
  /** Player 1's on-screen touch controls (app/controls.js TouchPad). */
  attachTouch(touchpad) { this.touchpad = touchpad; }

  /** Read every device once; call each animation frame. */
  poll() {
    const sticks = Array.from({ length: SEATS }, () => [0, 0]);
    const fast = new Array(SEATS).fill(false);
    for (const d of this.devices) { d.keyboard = false; d.pad = false; d.phone = false; d.touch = false; d.padId = ''; }

    for (const c of KEY_CLUSTERS) {
      const s = c.seat, L = this.latch[s], held = (keys) => keys.some((k) => this.down.has(k)), hit = (keys) => keys.some((k) => this.pressed.has(k));
      this.devices[s].keyboard = true;
      if (held(c.left)) sticks[s][0] -= STICK_FULL;
      if (held(c.right)) sticks[s][0] += STICK_FULL;
      if (held(c.up)) sticks[s][1] -= STICK_FULL;
      if (held(c.down)) sticks[s][1] += STICK_FULL;
      L.up ||= hit(c.up); L.down ||= hit(c.down); L.left ||= hit(c.left); L.right ||= hit(c.right);
      L.confirm ||= hit(c.confirm); L.rotate ||= hit(c.rotate); L.back ||= hit(c.back); L.ready ||= hit(c.ready); L.start ||= hit(c.start);
      fast[s] ||= held(c.fast);
      if (hit(c.confirm) || hit(c.rotate) || hit(c.ready) || hit(c.start)) this.touched[s] = true;
    }
    this.pressed.clear();

    if (this.touchpad && this.touchpad.visible) {                     // the on-screen stick and buttons are player 1's
      const t = this.touchpad.take(), L = this.latch[0];
      this.devices[0].touch = true;
      sticks[0][0] += t.stickX; sticks[0][1] += t.stickY;
      L.confirm ||= t.confirm; L.rotate ||= t.rotate; L.back ||= t.back; L.ready ||= t.ready; L.start ||= t.start;
      if (t.confirm || t.rotate || t.ready || t.start) this.touched[0] = true;
    }

    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
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
      const key = (phone ? 'phone' : 'pad') + i;
      const prev = this.prevButtons.get(key) || [];
      const now = g.buttons.map((b) => b.pressed);
      const edge = (k) => !!now[k] && !prev[k];
      const L = this.latch[seat];
      let sx = Math.round((g.axes[0] || 0) * STICK_FULL), sy = Math.round((g.axes[1] || 0) * STICK_FULL);
      if (now[PAD.LEFT]) sx -= STICK_FULL;
      if (now[PAD.RIGHT]) sx += STICK_FULL;
      if (now[PAD.UP]) sy -= STICK_FULL;
      if (now[PAD.DOWN]) sy += STICK_FULL;
      sticks[seat][0] += sx; sticks[seat][1] += sy;
      L.up ||= edge(PAD.UP); L.down ||= edge(PAD.DOWN); L.left ||= edge(PAD.LEFT); L.right ||= edge(PAD.RIGHT);
      L.confirm ||= edge(PAD.A); L.rotate ||= edge(PAD.B) || edge(PAD.RB); L.back ||= edge(PAD.B);
      L.ready ||= edge(PAD.Y); L.start ||= edge(PAD.START);
      fast[seat] ||= !!now[PAD.X];
      if (now.some((p, k) => p && !prev[k])) { this.touched[seat] = true; this.anyKey = true; }
      this.prevButtons.set(key, now);
    }

    for (let s = 0; s < SEATS; s++) {
      const L = this.latch[s];
      const sx = Math.max(-STICK_FULL, Math.min(STICK_FULL, sticks[s][0])), sy = Math.max(-STICK_FULL, Math.min(STICK_FULL, sticks[s][1]));
      const [px, py] = this.prevStick[s];
      // a stick pushed past half way counts as one menu step, once per push (key presses already gave their own edges above)
      L.up ||= sy < -MENU_STEP && py >= -MENU_STEP && !this.keyHeldDir(s, 'up');
      L.down ||= sy > MENU_STEP && py <= MENU_STEP && !this.keyHeldDir(s, 'down');
      L.left ||= sx < -MENU_STEP && px >= -MENU_STEP && !this.keyHeldDir(s, 'left');
      L.right ||= sx > MENU_STEP && px <= MENU_STEP && !this.keyHeldDir(s, 'right');
      this.prevStick[s] = [sx, sy];
      L.stickX = sx; L.stickY = sy; L.fast = fast[s];
      if (Math.abs(sx) > TOUCH || Math.abs(sy) > TOUCH) this.touched[s] = true;
    }
  }

  /** A key cluster's direction key is held: its press already made the menu edge, the stick crossing must not make a second. */
  keyHeldDir(seat, dir) {
    const c = KEY_CLUSTERS.find((k) => k.seat === seat);
    return !!c && c[dir].some((k) => this.down.has(k));
  }

  /**
   * What the next tick takes: every seat's latched presses and its stick now, as plain field sets the controller's PadInput and
   * the menu's MenuInput are filled from. Clears the latches.
   */
  take() {
    const out = [];
    for (let s = 0; s < SEATS; s++) {
      const L = this.latch[s];
      out.push({
        pad: { stickX: L.stickX, stickY: L.stickY, confirm: L.confirm, rotate: L.rotate, ready: L.ready, fast: L.fast },
        menu: { up: L.up, down: L.down, left: L.left, right: L.right, confirm: L.confirm, back: L.back, start: L.start },
      });
      L.clear();
    }
    this.anyKey = false;
    return out;
  }

  /** Seats that pressed or pushed anything since the last call (and clears that). */
  takeTouched() { const t = this.touched.slice(); this.touched.fill(false); return t; }
}
