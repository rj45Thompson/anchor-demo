// overlay.js - the page's own notes over the WebGPU canvas, for what only the page knows. The renderer draws the HUD and every menu
// screen from the ported HudViewModel and MenuModel; this layer adds what is not in the model: which devices sit in each seat on the
// join screen, whether phones can join (and why not, use case 2b), the keys, whether the browser is holding the sound back, and on
// the title the credits the CC-BY models ask for (app/credits.js). It only READS; it decides nothing. The page is rebuilt only when
// what it shows changed.
import { MODEL_CREDITS, CC_BY_4, OWN_MODELS, SOUND_CREDITS, CC0 } from './credits.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Small line icons for the how-to card (24-unit view box, drawn in the text colour): this game's own, built here.
const ICON = Object.freeze({
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h1M10 10h1M14 10h1M18 10h0M7 14h10"/>',
  mouse: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v6"/>',
  touch: '<path d="M9 11V5a1.5 1.5 0 0 1 3 0v6M12 10V9a1.5 1.5 0 0 1 3 0v2M15 11a1.5 1.5 0 0 1 3 0v3a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L9 15"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
});
const icon = (k) => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>';

/** What each kind of control does, one line each (the how-to card on the join screen). The bindings are the page's own: keys
 *  app/input.js KEY_CLUSTERS (P1's), mouse input.js (left acts, right click turns, middle is ready, the wheel zooms), touch
 *  controls.js TouchPad, phones PhonePad's A/B/Y. */
const HOWTO_ROWS = Object.freeze({
  keys: 'WASD move, Space place / fire / bomb, R turn, Tab tool, F grab bomb (hold: defuse), 1-4 shop',
  mouse: 'Click place / fire / bomb, right click grab a bomb (hold: defuse), the buttons below: tool, shop, ready',
  touch: 'Stick move, A place / fire / bomb, B grab bomb (hold: defuse), Y tool / ready; pinch to zoom',
  phone: 'Scan the code, A joins; A place / fire / bomb, B grab bomb (hold: defuse), Y tool / ready',
});

/** The devices the how-to card explains for a CONTROLS mode on this device (touchFirst: a phone or tablet, controls.js). */
export function howtoDevices(mode, touchFirst) {
  const here = touchFirst ? ['touch'] : ['keys', 'mouse'];
  if (mode === 'local') return here;
  if (mode === 'phones') return ['phone'];
  if (mode === 'both') return [...here, 'phone'];
  throw new Error('overlay.js: no how-to for controls mode "' + mode + '"');
}

/** The first match's hint for each phase (by the ported Phase name), and how to do it with a touch screen or a desk. */
export const PHASE_HINTS = Object.freeze({
  Claim: { say: 'Pick a castle', touch: 'tap one', desk: 'click one, or walk there and press Space / A' },
  Cannons: { say: 'Place cannons inside your walls', touch: 'tap inside, then Y', desk: 'click inside, then Ready (E / Y)' },
  Battle: { say: 'Fire at ships', touch: 'tap a ship; Y takes out bombs', desk: 'click a ship, or aim and press Space; Tab or Q takes out bombs' },
  Repair: { say: 'Close the ring with pieces', touch: 'tap to place; hold B to defuse bombs', desk: 'click to place, R turns; hold right click to defuse a bomb; 1-4 shop' },
});

/** The first-match hint strip: one line under the top bar in the first round of the first match a player plays on this page, the
 *  phase's goal and how to do it; it fades out when that round ends and does not come back. It is its own element (not the overlay's
 *  rebuilt HTML) so it can fade, and its screen rect is one of the camera's cover rects (main.js), so the camera frames round it. */
export class HintStrip {
  constructor(parent) {
    const el = document.createElement('div');
    el.className = 'hint'; el.hidden = true; el.setAttribute('role', 'status');
    parent.appendChild(el);
    this.el = el; this.text = ''; this.on = false;
  }
  /** phase: the Phase name or null (nothing to say); touch: say it for a touch screen; fading: the hint round is over. */
  set(phase, touch, fading) {
    const h = phase ? PHASE_HINTS[phase] : null;
    const text = h ? h.say + '|' + (touch ? h.touch : h.desk) : '';
    if (text && text !== this.text) {
      const [say, how] = text.split('|');
      this.el.innerHTML = '<b>' + esc(say) + '</b><span>' + esc(how) + '</span>';
    }
    if (text) this.text = text;
    const on = !!text && !fading;
    if (on !== this.on) { this.on = on; this.el.classList.toggle('gone', !on); }
    this.el.hidden = !this.text;
  }
  /** Put the strip `top` CSS px down, centred, then below every rect in `avoid` (DOM rects: the on-screen controls) it would cross. */
  place(top, avoid) {
    let y = top;
    for (let pass = 0; pass < 3; pass++) {
      this.el.style.top = y + 'px';
      const r = this.el.getBoundingClientRect();
      const hit = avoid.filter((a) => a.left < r.right && a.right > r.left && a.top < r.bottom && a.bottom > r.top);
      if (!hit.length) return;
      y = Math.max(...hit.map((a) => a.bottom)) + 6;
    }
    throw new Error('overlay.js: the hint strip found no place clear of the on-screen controls');
  }
  /** Shown (not fading): its rect is kept clear by the camera. */
  get covering() { return this.on && !this.el.hidden; }
  rect() { return this.el.getBoundingClientRect(); }
}

export class Overlay {
  /**
   * @param root      the #ui element
   * @param colours   the players' CSS colours by seat (the renderer's palette: one source)
   * @param Screen    the ported MenuModel's Screen enum
   * @param keyHelp   one line per keyboard cluster
   */
  constructor(root, colours, Screen, keyHelp) {
    this.root = root; this.colours = colours; this.Screen = Screen; this.keyHelp = keyHelp;
    this.last = '';
  }

  /** s = { screen, inDemo, attract, devices[], phones: {state, reason}, controls: 'local' | 'phones' | 'both', touchControls, touchFirst,
   *  soundNote, soundError (a sound file that did not load, or unreadable sound settings: on the title footer), scoresNote } */
  render(s) {
    const html = this.build(s);
    if (html !== this.last) { this.last = html; this.root.innerHTML = html; }
    // the foot's height, for the how-to card that stands above it on a narrow screen (style.css --foot-h)
    const f = this.root.querySelector('.foot'), h = f ? f.offsetHeight : 0;
    if (h !== this.footH) { this.footH = h; this.root.style.setProperty('--foot-h', h + 'px'); }
  }

  build(s) {
    const S = this.Screen;
    const parts = [];
    if (!s.attract && s.screen === S.Setup) parts.push(this.seats(s), this.howto(s));
    if (!s.attract && s.screen === S.Title && !s.inDemo) parts.push('<div class="keys foot">' + this.keyHelp.map(esc).join('<br>') + '<br>Gamepads and phones: stick or d-pad move, A place/fire, B rotate/back, Y ready, X held fast, START pause'
      + '<div class="credits">Models: ' + MODEL_CREDITS.map((c) => '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.title) + '</a> by ' + esc(c.author)).join('; ')
      + ' (<a href="' + CC_BY_4 + '" target="_blank" rel="noopener">CC BY 4.0</a>, from Sketchfab). ' + esc(OWN_MODELS)
      + '<br>Sounds: ' + SOUND_CREDITS.map((c) => '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.title) + '</a> by ' + esc(c.author)).join('; ')
      + ' (<a href="' + CC0 + '" target="_blank" rel="noopener">CC0</a>).</div>'
      + (s.soundError ? '<div class="note sounderr">' + esc(s.soundError) + '</div>' : '') + '</div>');
    if (s.screen === S.HighScores && s.scoresNote) parts.push('<div class="note foot">' + esc(s.scoresNote) + '</div>');
    if (s.soundNote) parts.push('<div class="corner">' + esc(s.soundNote) + '</div>');
    return parts.join('');
  }

  /** The how-to card on the join screen: the goal in one line, then what each control of the chosen CONTROLS mode does. */
  howto(s) {
    const rows = howtoDevices(s.controls, s.touchFirst)
      .map((k) => '<div class="hrow" data-dev="' + k + '">' + icon(k) + '<span>' + esc(HOWTO_ROWS[k]) + '</span></div>').join('');
    return '<div class="howto"><div class="hhead">HOW TO PLAY</div><div class="hgoal">Wall in a castle, place cannons, sink the ships,'
      + ' defuse raider bombs, then close the ring before the bell.</div>' + rows + '</div>';
  }

  seats(s) {
    let line = '';
    for (let seat = 0; seat < s.devices.length; seat++) {
      const d = s.devices[seat], dev = [];
      // only what a player has used is named (a phone's join screen said "P1: keys WASD" with no keyboard in sight)
      if (seat === 0 && s.touchControls) dev.push('touch controls');
      if (d.keysUsed) dev.push(seat === 0 ? 'keys WASD' : 'keys arrows');
      if (d.mouseUsed) dev.push('mouse');
      if (d.pad) dev.push('gamepad');
      if (d.phone) dev.push('phone');
      if (d.touch) dev.push('touch');
      if (d.padId && !d.pad) dev.push(d.padId);
      line += '<span class="dev" style="color:' + this.colours[seat] + '">P' + (seat + 1) + ': ' + esc(dev.length ? dev.join(' + ') : 'no controller yet') + '</span>';
    }
    const phones = s.phones.state === 'open' ? 'Phones: scan the code, then press A on the phone to join its seat.'
      : s.phones.state === 'opening' ? 'Phones: opening a room...'
      : s.phones.state === 'off' ? 'Phones: off. Choose PHONES or BOTH to let phones join with a QR code (C switches).'
      : 'Phones unavailable: ' + s.phones.reason + ' Keyboard and gamepads still work.';
    const ctl = '<div class="ctl">CONTROLS ' + ['local', 'phones', 'both'].map((k) => '<button data-controls="' + k + '" class="'
      + (s.controls === k ? 'on' : '') + '">' + ({ local: 'LOCAL', phones: 'PHONES', both: 'BOTH' })[k] + '</button>').join('') + '</div>';
    return '<div class="foot">' + ctl + '<div class="devs">' + line + '</div>'
      + '<div class="' + (s.phones.state === 'failed' ? 'note' : 'sub') + '">' + esc(phones) + '</div></div>';
  }
}
