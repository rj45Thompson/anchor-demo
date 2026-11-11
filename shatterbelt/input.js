// input.js: keyboard, gamepad and touch, turned into one byte of Input bits per game step.
//
// The game only ever sees sample(): what is held right now, plus anything pressed and let go since the
// last step, so a quick tap between two steps is never lost. Menu keys (start, pause, mute) are not
// game input; they go to the callback the page gives, as named actions.
import { Input } from './core.js';

const KEYS = {
  ArrowLeft: Input.Left, KeyA: Input.Left,
  ArrowRight: Input.Right, KeyD: Input.Right,
  ArrowUp: Input.Thrust, KeyW: Input.Thrust,
  Space: Input.Fire, KeyJ: Input.Fire,
  ShiftLeft: Input.Hyperspace, ShiftRight: Input.Hyperspace, KeyH: Input.Hyperspace,
};
const ACTIONS = { Enter: 'start', KeyP: 'pause', Escape: 'pause', KeyM: 'mute', KeyN: 'music', KeyR: 'restart' };

// Standard gamepad layout: A fires, B jumps, the right trigger or up thrusts, Start pauses.
const PAD = { fire: 0, jump: 1, thrust: 7, up: 12, left: 14, right: 15, start: 9 };
const DEAD_ZONE = 0.35;

export class Controls {
  // wantsKeys(): true while the game should take its keys from the page (the game is on screen)
  constructor({ wantsKeys, onAction, touchRoot }) {
    this.wantsKeys = wantsKeys;
    this.onAction = onAction;
    this.held = 0;          // bits held on the keyboard and the touch buttons
    this.tapped = 0;        // bits pressed since the last sample, held or not
    this.touchHeld = 0;
    this.padWas = { start: false, fire: false };
    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    window.addEventListener('blur', () => { this.held = 0; this.touchHeld = 0; });
    if (touchRoot) this.bindTouch(touchRoot);
  }

  key(event, down) {
    if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (!this.wantsKeys()) return;
    const bit = KEYS[event.code];
    const action = ACTIONS[event.code];
    if (bit === undefined && action === undefined) return;
    event.preventDefault(); // arrows and space would scroll the page
    if (bit !== undefined) {
      if (down) { this.held |= bit; this.tapped |= bit; } else this.held &= ~bit;
    }
    if (action && down && !event.repeat) this.onAction(action);
    if (event.code === 'Space' && down && !event.repeat) this.onAction('start'); // Space also starts from a menu
  }

  // On-screen buttons: each has data-input="Left" (or Right, Thrust, Fire, Hyperspace).
  bindTouch(root) {
    for (const button of root.querySelectorAll('[data-input]')) {
      const bit = Input[button.dataset.input];
      const press = e => {
        e.preventDefault();
        button.setPointerCapture?.(e.pointerId);
        this.touchHeld |= bit;
        this.tapped |= bit;
        button.classList.add('down');
      };
      const lift = e => {
        e.preventDefault();
        this.touchHeld &= ~bit;
        button.classList.remove('down');
      };
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', lift);
      button.addEventListener('pointercancel', lift);
      button.addEventListener('lostpointercapture', lift);
      button.addEventListener('contextmenu', e => e.preventDefault());
    }
  }

  // The first connected gamepad's bits, and its Start and A buttons as menu actions.
  readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find(p => p && p.connected);
    if (!pad) return 0;
    const pressed = i => !!pad.buttons[i] && pad.buttons[i].pressed;
    const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
    let bits = 0;
    if (x < -DEAD_ZONE || pressed(PAD.left)) bits |= Input.Left;
    if (x > DEAD_ZONE || pressed(PAD.right)) bits |= Input.Right;
    if (y < -0.6 || pressed(PAD.up) || pressed(PAD.thrust)) bits |= Input.Thrust;
    if (pressed(PAD.fire)) bits |= Input.Fire;
    if (pressed(PAD.jump)) bits |= Input.Hyperspace;
    for (const [name, action] of [['start', 'pause'], ['fire', 'start']]) {
      const now = pressed(PAD[name]);
      if (now && !this.padWas[name]) this.onAction(action, 'pad');
      this.padWas[name] = now;
    }
    return bits;
  }

  // One step's input. Call once per game step.
  sample() {
    const bits = this.held | this.touchHeld | this.tapped | this.readPad();
    this.tapped = 0;
    return bits;
  }

  // The pad's menu buttons while no game steps run (paused): sample() reads the pad only inside a step, so
  // without this the Start button could pause a game but never carry it on. Call once per frame.
  pollPad() {
    this.readPad();
  }

  // Forget everything held, for example when a game starts or pauses.
  clear() {
    this.held = this.touchHeld = this.tapped = 0;
  }
}
