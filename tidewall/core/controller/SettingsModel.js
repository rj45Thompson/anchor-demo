// SettingsModel.js - this game's own (no original in the private model): the values the SETTINGS screen shows and changes
// (SETTINGS_UC.md UC-ST1). Engine-free, so a test can walk it: three volumes as whole percents, mute, and the graphics quality.
//
// The sound settings are stored in the format app/sound.js plays from and app/main.js has always saved:
//   {"muted":false,"music":1,"fx":1,"ambience":1}   (key order and numbers exactly as before; a volume is its percent / 100)
// A stored volume that is not a whole percent is refused as unreadable (nothing in the game writes one), never rounded.
// The graphics quality is shown and changed here but not stored (the page starts on high, or ?quality=low), as before.
// MOTION (SETTINGS_UC.md UC-ST2, 11-10): 'full' or 'reduced' (no camera shake, a dimmer capture flash). The page stores it under its
// own key as the bare word (parseMotion reads it back) and, with nothing stored, starts from the system's prefers-reduced-motion.
// TEXT SIZE (UC-ST4, 11-10): 100, 125 or 150 percent, stored under its own key as the bare number (parseText reads it back).

export class SettingsError extends Error {
  constructor(why) { super(why); this.name = 'SettingsError'; }
}

const QUALITIES = Object.freeze(['high', 'low']);
const MOTIONS = Object.freeze(['full', 'reduced']);
const TEXTS = Object.freeze([100, 125, 150]);         // AUTHORED (UC-ST4): the text sizes, percent

function percent(name, v) {
  if (!Number.isInteger(v) || v < 0 || v > SettingsModel.Max) throw new SettingsError(name + ' is ' + v + ', want a whole percent from 0 to ' + SettingsModel.Max);
  return v;
}

export class SettingsModel {
  static Step = 10;                // AUTHORED (TASKS SOUND-UI): one press moves a volume ten percent
  static Max = 100;
  static Volumes = Object.freeze(['music', 'fx', 'ambience']);

  /** { music, fx, ambience: whole percents 0..100, muted: boolean, quality: 'high' | 'low' }; every field is required. motion:
   *  'full' | 'reduced', or left out for 'full' (the game as it was before the setting existed; the page always passes the motion it
   *  resolved, UC-ST2 step 1). */
  constructor(v) {
    if (v === null || typeof v !== 'object') throw new SettingsError('SettingsModel needs { music, fx, ambience, muted, quality }');
    for (const k of SettingsModel.Volumes) this[k] = percent(k, v[k]);
    if (typeof v.muted !== 'boolean') throw new SettingsError('muted is ' + v.muted + ', want true or false');
    if (!QUALITIES.includes(v.quality)) throw new SettingsError('quality is ' + v.quality + ', want high or low');
    this.muted = v.muted; this.quality = v.quality;
    if (v.motion !== undefined && !MOTIONS.includes(v.motion)) throw new SettingsError('motion is ' + v.motion + ', want full or reduced');
    this.motion = v.motion === undefined ? 'full' : v.motion;
    if (v.text !== undefined && !TEXTS.includes(v.text)) throw new SettingsError('text size is ' + v.text + ', want ' + TEXTS.join(', '));
    this.text = v.text === undefined ? 100 : v.text;
  }

  static TextSizes = TEXTS;

  /** The stored text size (the bare number the page saved, '125'). Throws SettingsError on anything else (UC-ST4 step 3). */
  static parseText(text) {
    const n = Number(text);
    if (String(n) !== String(text) || !TEXTS.includes(n)) throw new SettingsError('text size is ' + JSON.stringify(String(text).slice(0, 40)) + ', want ' + TEXTS.join(', '));
    return n;
  }

  /** Left / right (or confirm, dir 1, round from the largest to 100) through the text sizes. Returns whether it changed. */
  stepText(dir, wrap = false) {
    const i = TEXTS.indexOf(this.text), j = wrap ? (i + dir + TEXTS.length) % TEXTS.length : Math.max(0, Math.min(TEXTS.length - 1, i + dir));
    this.text = TEXTS[j];
    return j !== i;
  }

  /** The stored motion setting (the bare word the page saved). Throws SettingsError on anything else (UC-ST2 alternate 1a). */
  static parseMotion(text) {
    if (!MOTIONS.includes(text)) throw new SettingsError('motion is ' + JSON.stringify(String(text).slice(0, 40)) + ', want full or reduced');
    return text;
  }

  /** The settings a first visit plays with: every volume full, sound on, the quality the page started with. */
  static defaults(quality, motion, text) { return new SettingsModel({ music: SettingsModel.Max, fx: SettingsModel.Max, ambience: SettingsModel.Max, muted: false, quality, motion, text }); }

  /** Reads the stored sound settings (the text save() wrote). Throws SettingsError saying what is wrong; never half-reads. */
  static parse(text, quality, motion, textSize) {
    let v;
    try { v = JSON.parse(text); } catch (e) { throw new SettingsError('not JSON: ' + e.message); }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new SettingsError('not an object');
    if (typeof v.muted !== 'boolean') throw new SettingsError('muted is ' + v.muted + ', want true or false');
    const out = { muted: v.muted, quality, motion, text: textSize };
    for (const k of SettingsModel.Volumes) {
      const x = v[k];
      if (typeof x !== 'number' || !(x >= 0 && x <= 1)) throw new SettingsError(k + ' is ' + x + ', want a volume from 0 to 1');
      const p = Math.round(x * SettingsModel.Max);
      if (Math.abs(x * SettingsModel.Max - p) > 1e-9) throw new SettingsError(k + ' is ' + x + ', not a whole percent');
      out[k] = p;
    }
    return new SettingsModel(out);
  }

  /** The stored text: the sound settings only, in the format sound.js reads (save() then parse() gives the same values back). */
  save() { return JSON.stringify(this.sound()); }

  /** The SoundPlayer's settings: { muted, music, fx, ambience }, each volume 0..1. */
  sound() { return { muted: this.muted, music: this.music / SettingsModel.Max, fx: this.fx / SettingsModel.Max, ambience: this.ambience / SettingsModel.Max }; }

  /** Left / right on a volume: ten percent down or up, stopping at 0 and at 100. A value between two steps (73) moves to the step
   *  in that direction (80 up, 70 down). Returns whether it changed. */
  step(name, dir) {
    if (!SettingsModel.Volumes.includes(name)) throw new SettingsError('no volume ' + name);
    if (dir !== 1 && dir !== -1) throw new SettingsError('a step is 1 or -1, got ' + dir);
    const S = SettingsModel.Step, v = this[name];
    const next = dir > 0 ? Math.min(SettingsModel.Max, (Math.floor(v / S) + 1) * S) : Math.max(0, (Math.ceil(v / S) - 1) * S);
    this[name] = next;
    return next !== v;
  }

  /** Confirm on a volume: ten percent up, and from 100 round to 0 (the setup rows cycle on confirm the same way). */
  cycle(name) {
    if (!SettingsModel.Volumes.includes(name)) throw new SettingsError('no volume ' + name);
    if (this[name] >= SettingsModel.Max) this[name] = 0;
    else this.step(name, 1);
  }

  toggleMute() { this.muted = !this.muted; return this.muted; }
  toggleQuality() { this.quality = this.quality === 'high' ? 'low' : 'high'; return this.quality; }
  toggleMotion() { this.motion = this.motion === 'full' ? 'reduced' : 'full'; return this.motion; }
  get reducedMotion() { return this.motion === 'reduced'; }
}
