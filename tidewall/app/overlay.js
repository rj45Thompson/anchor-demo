// overlay.js - the page's own notes over the WebGPU canvas, for what only the page knows. The renderer draws the HUD and every menu
// screen from the ported HudViewModel and MenuModel; this layer adds what is not in the model: which devices sit in each seat on the
// join screen, whether phones can join (and why not, use case 2b), the keys, whether the browser is holding the sound back, and on
// the title the credits the CC-BY models ask for (app/credits.js). It only READS; it decides nothing. The page is rebuilt only when
// what it shows changed.
import { MODEL_CREDITS, CC_BY_4, OWN_MODELS } from './credits.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

  /** s = { screen, inDemo, attract, devices[], phones: {state, reason}, controls: 'local' | 'phones' | 'both', soundNote, scoresNote } */
  render(s) {
    const html = this.build(s);
    if (html === this.last) return;
    this.last = html;
    this.root.innerHTML = html;
  }

  build(s) {
    const S = this.Screen;
    const parts = [];
    if (!s.attract && s.screen === S.Setup) parts.push(this.seats(s));
    if (!s.attract && s.screen === S.Title && !s.inDemo) parts.push('<div class="keys foot">' + this.keyHelp.map(esc).join('<br>') + '<br>Gamepads and phones: stick or d-pad move, A place/fire, B rotate/back, Y ready, X held fast, START pause'
      + '<div class="credits">Models: ' + MODEL_CREDITS.map((c) => '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.title) + '</a> by ' + esc(c.author)).join('; ')
      + ' (<a href="' + CC_BY_4 + '" target="_blank" rel="noopener">CC BY 4.0</a>, from Sketchfab). ' + esc(OWN_MODELS) + '</div></div>');
    if (s.screen === S.HighScores && s.scoresNote) parts.push('<div class="note foot">' + esc(s.scoresNote) + '</div>');
    if (s.soundNote) parts.push('<div class="corner">' + esc(s.soundNote) + '</div>');
    return parts.join('');
  }

  seats(s) {
    let line = '';
    for (let seat = 0; seat < s.devices.length; seat++) {
      const d = s.devices[seat], dev = [];
      if (d.keyboard) dev.push(seat === 0 ? 'keys WASD' : 'keys arrows');
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
