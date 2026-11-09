// controls.js - which controls this page plays with, and the on-screen touch controls.
//
// ControlsChoice: the CONTROLS choice on the join screen. LOCAL = this device's keyboard, mouse, touch and gamepads; PHONES = phones
// joining by QR code through PhonePad; BOTH. The phone room (and with it every request to the relay) exists only under PHONES or
// BOTH. The first choice is LOCAL on a touch-first device (a coarse pointer, or an Android or iOS browser: a phone is the controller
// there, not a remote) and BOTH elsewhere; a choice made is remembered in this browser when it lets the page keep it.
//
// TouchPad: player 1's controls on a touch screen under LOCAL or BOTH, in play: a stick on the left, A (place / fire / confirm),
// B (rotate / back) and Y (ready / swap) on the right, and a pause button. Every finger is its own pointer, so the stick and a
// button work at once. A tap on the board itself is read by input.js (the hero goes to the tapped square and acts there).

const MODES = Object.freeze(['local', 'phones', 'both']);
export const CONTROL_WORDS = Object.freeze({ local: 'LOCAL', phones: 'PHONES', both: 'BOTH' });

export class ControlsChoice {
  /** @param key the localStorage key  @param env { coarse, userAgent } of this browser (main.js reads them; a test passes its own) */
  constructor(key, env) {
    this.key = key;
    this.touchFirst = env.coarse || /Android|iPhone|iPad|iPod/i.test(env.userAgent);
    this.note = '';
    let saved = null;
    try { saved = localStorage.getItem(key); }
    catch (e) { this.note = 'The controls choice is not kept in this browser: ' + e.message; }
    // a stored value that is not one of the three is not used (and left as it is): the device's own first choice applies
    this.mode = MODES.includes(saved) ? saved : (this.touchFirst ? 'local' : 'both');
  }
  get usesPhones() { return this.mode !== 'local'; }
  get showsTouch() { return this.touchFirst && this.mode !== 'phones'; }
  set(mode) {
    if (!MODES.includes(mode)) throw new Error('controls.js: no controls mode "' + mode + '" (' + MODES.join(', ') + ')');
    this.mode = mode;
    try { localStorage.setItem(this.key, mode); }
    catch (e) { this.note = 'The controls choice is not kept in this browser: ' + e.message; }
  }
  next() { this.set(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]); }
}

const STICK_FULL = 1000;              // the controller's stick scale (input.js)

export class TouchPad {
  /** @param parent the element the controls are added to (document.body) */
  constructor(parent) {
    const el = document.createElement('div');
    el.className = 'tpad'; el.dataset.nogame = '1'; el.hidden = true;
    el.innerHTML = '<div class="tstick" data-nogame="1"><div class="tknob"></div></div>'
      + '<div class="tbtns" data-nogame="1"><button class="tb tb-y" data-b="ready" aria-label="Y: ready or swap">Y</button>'
      + '<button class="tb tb-b" data-b="rotate" aria-label="B: rotate or back">B</button>'
      + '<button class="tb tb-a" data-b="confirm" aria-label="A: place, fire or confirm">A</button></div>'
      + '<button class="tpause" data-b="start" data-nogame="1" aria-label="Pause">II</button>'
      + '<button class="tframe" data-nogame="1" aria-label="Whole island or close camera">&#x26F6;</button>'
      + '<button class="tshop" data-nogame="1" aria-label="Open or close the shop" hidden>SHOP</button>';
    parent.appendChild(el);
    this.el = el; this.visible = false;
    this.stickX = 0; this.stickY = 0; this.edges = { confirm: false, rotate: false, back: false, ready: false, start: false };
    // the bomb rule set (set by main.js): B is held (grab, and at the defuse time a defuse) and, let go, a tap (pick up / turn); A drops
    // or throws a bomb, Y swaps the tool. grabbing: B is down now; tapped: it was let go since the last take.
    this.bombs = false; this.grabbing = false; this.tapped = false;
    this.frameTap = false;            // the frame button: whole island <-> the close camera (render/camera.js)
    const fb = el.querySelector('.tframe');
    fb.addEventListener('pointerdown', (e) => { e.preventDefault(); this.frameTap = true; });
    this.shopTap = false;             // the shop button (the bomb rule set's REPAIR): the shop row opens and closes
    this.shopBtn = el.querySelector('.tshop');
    this.shopBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.shopTap = true; });
    const stick = el.querySelector('.tstick'), knob = el.querySelector('.tknob');
    let finger = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect(), rad = r.width / 2;
      let dx = (e.clientX - (r.left + rad)) / rad, dy = (e.clientY - (r.top + rad)) / rad;
      const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
      this.stickX = Math.round(dx * STICK_FULL); this.stickY = Math.round(dy * STICK_FULL);
      knob.style.transform = 'translate(' + (dx * rad * 0.55) + 'px,' + (dy * rad * 0.55) + 'px)';
    };
    const release = (e) => {
      if (e.pointerId !== finger) return;
      finger = null; this.stickX = 0; this.stickY = 0; knob.style.transform = '';
    };
    stick.addEventListener('pointerdown', (e) => { e.preventDefault(); finger = e.pointerId; stick.setPointerCapture(e.pointerId); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === finger) move(e); });
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
    for (const b of el.querySelectorAll('[data-b]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const k = b.dataset.b;
        if (k === 'rotate' && this.bombs) { this.grabbing = true; b.classList.add('down'); return; }
        this.edges[k] = true;
        if (k === 'rotate') this.edges.back = true;       // B turns the piece in play and goes back in a menu, as on a pad
        b.classList.add('down');
      });
      const up = (e) => {
        b.classList.remove('down');
        if (b.dataset.b === 'rotate' && this.grabbing) { this.grabbing = false; if (e.type === 'pointerup') this.tapped = true; }
      };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
  }

  show(on) {
    if (on === this.visible) return;
    this.visible = on; this.el.hidden = !on;
    if (!on) { this.stickX = 0; this.stickY = 0; }
  }

  /** The bomb rule set on or off: the buttons are captioned with what they do now (A drops or throws, B grabs, Y swaps the tool). */
  setBombs(on) {
    if (on === this.bombs) return;
    this.bombs = on;
    const caps = on ? { confirm: 'DROP', rotate: 'GRAB', ready: 'TOOL' } : {};
    for (const b of this.el.querySelectorAll('.tb')) { const c = caps[b.dataset.b]; if (c) b.dataset.cap = c; else delete b.dataset.cap; }
    if (!on) this.grabbing = false;
  }

  /** The shop button shown or not (REPAIR in the bomb rule set), and whether the shop is open. */
  setShop(shown, open) { this.shopBtn.hidden = !shown; this.shopBtn.textContent = open ? 'CLOSE' : 'SHOP'; this.shopBtn.classList.toggle('on', open); }
  /** The shop button was tapped since the last call (cleared). */
  takeShop() { const t = this.shopTap; this.shopTap = false; return t; }

  /** The frame button was tapped since the last call (cleared). */
  takeFrame() { const t = this.frameTap; this.frameTap = false; return t; }
  /** The screen rects of the controls that sit over the board (the camera keeps its frame clear of them). */
  coverRects() { return [...this.el.querySelectorAll('.tstick, .tbtns, .tpause, .tframe, .tshop:not([hidden])')].map((e) => e.getBoundingClientRect()); }

  /** The stick now and the buttons pressed since the last take (cleared). */
  take() {
    const out = Object.assign({ stickX: this.stickX, stickY: this.stickY, grab: this.grabbing, tap: this.tapped }, this.edges);
    this.tapped = false;
    for (const k of Object.keys(this.edges)) this.edges[k] = false;
    return out;
  }
}
