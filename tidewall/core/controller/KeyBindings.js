// KeyBindings.js - this game's own (no original in the private model): which keyboard key does which action for the two key
// clusters (SETTINGS_UC.md UC-ST3). Engine-free, so a test can walk it. app/input.js reads `clusters` on every poll, so a rebind
// acts on the next frame; the CONTROLS page, the join screen and the action bar name the keys through `label` and `help`.
//
// The shipped keys are DEFAULT_KEYS (they were input.js KEY_CLUSTERS until 11-10, unchanged). Only the MOVABLE actions can be given
// another key; back, start (pause), trap and the shop keys stay where they are, and the page's own keys (RESERVED) can never be
// taken. Invariants every change keeps (KeyBindingsTests): no key does two movable actions, and every movable action keeps a key.
//
// Stored as the actions that differ from the shipped keys: {"0":{"confirm":["KeyJ"]},"1":{}} (localStorage tidewall-keys).

export class KeyBindingsError extends Error {
  constructor(why) { super(why); this.name = 'KeyBindingsError'; }
}

export const DEFAULT_KEYS = Object.freeze([
  Object.freeze({
    seat: 0,
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    confirm: ['Space'], rotate: ['KeyR'], back: ['Backspace'], swap: ['Tab', 'KeyQ'], ready: ['KeyE'], start: ['Escape'], fast: ['ShiftLeft'],
    grab: ['KeyF'], drop: ['KeyB'], trap: ['KeyT'], buy: [['Digit1'], ['Digit2'], ['Digit3'], ['Digit4']],
  }),
  Object.freeze({
    seat: 1,
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    confirm: ['Enter', 'NumpadEnter'], rotate: ['ShiftRight'], back: ['ShiftRight'], swap: ['Period'], ready: ['Slash'], start: ['Backslash'], fast: ['ControlRight'],
    grab: ['Comma'], drop: ['Quote'], trap: ['Numpad0'], buy: [['Numpad1'], ['Numpad2'], ['Numpad3'], ['Numpad4']],
  }),
]);

/** The actions a player can move to another key, in the order the KEYS panel lists them, with the words it shows. */
export const MOVABLE = Object.freeze(['up', 'down', 'left', 'right', 'confirm', 'rotate', 'ready', 'swap', 'drop', 'grab', 'fast']);
export const ACTION_WORDS = Object.freeze({ up: 'MOVE UP', down: 'MOVE DOWN', left: 'MOVE LEFT', right: 'MOVE RIGHT', confirm: 'PLACE / FIRE',
  rotate: 'ROTATE', ready: 'READY', swap: 'SWAP TOOL', drop: 'DROP BOMB', grab: 'PICK UP / DEFUSE', fast: 'MOVE FAST' });
const FIXED_WORDS = Object.freeze({ back: 'BACK', start: 'PAUSE', trap: 'SET TRAP', buy: 'the shop' });

/** Keys the page keeps for itself whoever's cluster asks (app/main.js and input.js listen for them on every screen). */
export const RESERVED = Object.freeze({ KeyH: 'controls & credits', KeyM: 'mute', KeyG: 'graphics', KeyZ: 'the whole-island camera',
  KeyC: 'the join screen\'s CONTROLS', Escape: 'pause' });
// browser and system keys a page cannot keep from the browser (or should not): refused with this reason
const SYSTEM = /^(Meta|Alt|OS|F\d+$|ContextMenu|PrintScreen|ScrollLock|Pause|NumLock|CapsLock|Fn)/;
const CODE = /^[A-Za-z][A-Za-z0-9]*$/;

const NAMES = Object.freeze({ Space: 'Space', Enter: 'Enter', NumpadEnter: 'Numpad Enter', Tab: 'Tab', Escape: 'Esc', Backspace: 'Backspace',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', ArrowUp: 'Up', ArrowDown: 'Down',
  ArrowLeft: 'Left', ArrowRight: 'Right', Period: '.', Comma: ',', Quote: "'", Slash: '/', Backslash: '\\', Semicolon: ';', BracketLeft: '[',
  BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'Page Up',
  PageDown: 'Page Down', NumpadAdd: 'Numpad +', NumpadSubtract: 'Numpad -', NumpadMultiply: 'Numpad *', NumpadDivide: 'Numpad /', NumpadDecimal: 'Numpad .' });

/** A KeyboardEvent.code as the player reads it on the key cap: 'KeyW' -> 'W', 'Digit1' -> '1', 'ShiftLeft' -> 'Left Shift'. */
export function keyName(code) {
  if (typeof code !== 'string' || !CODE.test(code)) throw new KeyBindingsError('not a key code: ' + JSON.stringify(code));
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'Numpad ' + m[1];
  return NAMES[code] ?? code;
}

const copyLists = (c) => { const o = {}; for (const a of MOVABLE) o[a] = c[a].slice(); return o; };

export class KeyBindings {
  static Seats = DEFAULT_KEYS.length;

  /** overrides: { [seat]: { [movable action]: [codes] } } as save() writes them, or undefined for the shipped keys. Throws
   *  KeyBindingsError on anything a save() could not have written (an unknown action, a key twice, a reserved key). */
  constructor(overrides) {
    this.map = DEFAULT_KEYS.map(copyLists);
    if (overrides !== undefined) {
      if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) throw new KeyBindingsError('not an object');
      for (const [seat, acts] of Object.entries(overrides)) {
        const s = Number(seat);
        if (!(String(s) === seat && s >= 0 && s < KeyBindings.Seats)) throw new KeyBindingsError('no key cluster ' + JSON.stringify(seat));
        if (acts === null || typeof acts !== 'object' || Array.isArray(acts)) throw new KeyBindingsError('cluster ' + seat + ' is not an object');
        for (const [a, keys] of Object.entries(acts)) {
          if (!MOVABLE.includes(a)) throw new KeyBindingsError('cluster ' + seat + ': ' + JSON.stringify(a) + ' is not an action that can move');
          if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k) => typeof k === 'string' && CODE.test(k)))
            throw new KeyBindingsError('cluster ' + seat + ' ' + a + ': want a list of key codes, got ' + JSON.stringify(keys));
          for (const k of keys) { const why = this.refusal(s, a, k); if (why) throw new KeyBindingsError('cluster ' + seat + ' ' + a + ': ' + why); }
          this.map[s][a] = keys.slice();
        }
      }
      const seen = new Map();
      for (let s = 0; s < KeyBindings.Seats; s++) for (const a of MOVABLE) for (const k of this.map[s][a]) {
        const at = seen.get(k);
        if (at) throw new KeyBindingsError(keyName(k) + ' does two actions (' + at + ' and P' + (s + 1) + ' ' + a + ')');
        seen.set(k, 'P' + (s + 1) + ' ' + a);
      }
    }
    this._clusters = null;
  }

  static defaults() { return new KeyBindings(); }

  /** Reads what save() wrote. Throws KeyBindingsError saying what is wrong; never half-reads. */
  static parse(text) {
    let v;
    try { v = JSON.parse(text); } catch (e) { throw new KeyBindingsError('not JSON: ' + e.message); }
    return new KeyBindings(v);
  }

  /** The actions that differ from the shipped keys, as the constructor reads them. */
  save() {
    const out = {};
    for (let s = 0; s < KeyBindings.Seats; s++) {
      const o = {};
      for (const a of MOVABLE) if (this.map[s][a].join() !== DEFAULT_KEYS[s][a].join()) o[a] = this.map[s][a].slice();
      out[s] = o;
    }
    return JSON.stringify(out);
  }

  /** Every cluster as input.js reads it: the shipped fields with the movable actions' keys now. Rebuilt after a change. */
  get clusters() {
    if (!this._clusters) this._clusters = DEFAULT_KEYS.map((d, s) => Object.freeze(Object.assign({}, d, this.map[s])));
    return this._clusters;
  }

  keys(seat, action) {
    const c = this.clusters[seat];
    if (!c || !(action in c) || action === 'seat') throw new KeyBindingsError('no action ' + action + ' for cluster ' + seat);
    return c[action];
  }

  /** The keys of an action as the player reads them: 'Tab / Q'. */
  label(seat, action) { return this.keys(seat, action).map(keyName).join(' / '); }

  /** Why `code` cannot be the key of cluster `seat`'s `action` (null when it can). A key of the action's own shipped list is never
   *  refused (going back to what shipped always works, even where it shares with a fixed action: P2's Right Shift). */
  refusal(seat, action, code) {
    if (DEFAULT_KEYS[seat][action].includes(code)) return null;
    if (RESERVED[code]) return keyName(code) + ' is kept for ' + RESERVED[code];
    if (SYSTEM.test(code)) return keyName(code) + ' belongs to the browser';
    for (let s = 0; s < KeyBindings.Seats; s++) {
      const d = DEFAULT_KEYS[s];
      for (const f of Object.keys(FIXED_WORDS)) {
        const keys = f === 'buy' ? d.buy.flat() : d[f];
        if (keys.includes(code)) return keyName(code) + ' is P' + (s + 1) + '\'s ' + FIXED_WORDS[f];
      }
    }
    return null;
  }

  /** Give cluster `seat`'s movable `action` the one key `code`. Returns { ok: true, moved: null | { seat, action } } (moved: the
   *  action that had the key and was given this action's old key, or lost just that one of its keys), or { ok: false, why }. */
  bind(seat, action, code) {
    if (!(Number.isInteger(seat) && seat >= 0 && seat < KeyBindings.Seats)) throw new KeyBindingsError('no key cluster ' + seat);
    if (!MOVABLE.includes(action)) throw new KeyBindingsError(action + ' is not an action that can move');
    if (typeof code !== 'string' || !CODE.test(code)) return { ok: false, why: 'that key cannot be read' };
    const why = this.refusal(seat, action, code);
    if (why) return { ok: false, why };
    const old = this.map[seat][action];
    let moved = null;
    for (let s = 0; s < KeyBindings.Seats && !moved; s++) for (const a of MOVABLE) {
      if ((s === seat && a === action) || !this.map[s][a].includes(code)) continue;
      const rest = this.map[s][a].filter((k) => k !== code);
      this.map[s][a] = rest.length > 0 ? rest : old.filter((k) => k !== code);
      moved = { seat: s, action: a };
      break;
    }
    this.map[seat][action] = [code];
    this._clusters = null;
    return { ok: true, moved };
  }

  /** Every action back to the keys it shipped with. */
  reset() { this.map = DEFAULT_KEYS.map(copyLists); this._clusters = null; }

  /** Enter is none of player 1's movable keys, so input.js may make it their READY in a match without player 2. */
  get enterFree() { return !MOVABLE.some((a) => this.map[0][a].includes('Enter')); }

  get isDefault() { return this.save() === new KeyBindings().save(); }

  /** The join screen's word for a cluster's move keys: 'WASD', 'arrows' (the shipped arrow keys) or the four keys now. */
  moveWord(seat) {
    const d = ['up', 'left', 'down', 'right'].map((a) => this.label(seat, a));
    if (d.join() === 'Up,Left,Down,Right') return 'arrows';
    return d.every((k) => k.length === 1) ? d.join('') : d.join(' ');
  }

  /** The how-to card's keyboard line (player 1's keys now). */
  howto() {
    const L = (a) => this.label(0, a);
    // BOMBER_UC.md: one tool a beat, no tool to swap (the swap key is the no-bomb rules' sword alone, ?bombs=0)
    return this.moveWord(0) + ' move, ' + L('confirm') + ' place / fire / bomb, ' + L('rotate') + ' turn, ' + L('grab')
      + ' grab bomb (hold: defuse), 1-4 shop';
  }

  /** One line of the CONTROLS page for a cluster, from its keys now. enterReadies: Enter is also player 1's READY (input.js). */
  help(seat) {
    const L = (a) => this.label(seat, a), dirs = ['up', 'left', 'down', 'right'].map(L);
    const move = dirs.every((d) => d.length === 1) ? dirs.join('') : dirs.join(' ');
    const ready = seat === 0 && this.enterFree ? L('ready') + ' or Enter' : L('ready');
    const fixed = (f) => DEFAULT_KEYS[seat][f].map(keyName).join(' / ');
    const buy = DEFAULT_KEYS[seat].buy.map((k) => keyName(k[0]));
    return move + ' move, ' + L('confirm') + ' place/fire/drop bomb, ' + L('rotate') + ' rotate, '
      + L('drop') + ' drop bomb, ' + L('grab') + ' pick up (hold: defuse), ' + buy[0] + '-' + buy[3].replace(/^Numpad /, '') + ' buy, '
      + fixed('trap') + ' trap, ' + ready + ' ready, ' + L('fast') + ' fast, ' + fixed('start') + ' pause, ' + fixed('back') + ' back';
  }
}
