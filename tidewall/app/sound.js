// sound.js - plays the game's sound through WebAudio (UC-S2, SOUND_PLAN.md): recorded effects, music and ambience from the one table
// app/soundbank.js, and the ported Synth's samples where the soundbank keeps a synth sound on purpose.
//
// Three buses (R4) - music, effects (fx), ambience - each with its own volume, all under a master gain (the mute) and a limiter.
// At most VOICES_PER_TICK new effect voices start in one game tick, so a volley of cannons is a roar and not a wall of clipping.
// Music crossfades over CROSSFADE_SEC when what is on screen changes (R3); a loop plays between its file's loopStart and loopEnd
// (the build pads every loop so the codec's edges never touch its seam). The ambience bus is ducked in battle.
//
// Browsers start an AudioContext suspended until the person presses something on the page. Until then nothing is scheduled (a
// sound queued on a suspended context would all burst out at the first key); the page shows "press any key for sound" from
// `needsGesture` - the reason is reported, not hidden.
//
// A file that fails to load or decode (UC-S2 1b) is NEVER replaced by another sound: load() collects every failure and throws a
// SoundLoadError naming each file and why; the page shows it on the title footer, and in development it stops the page.
import { SOUNDS, EVENT_SOUNDS, MENU_SOUNDS, AMBIENCE, BUSES, soundForEvent } from './soundbank.js';
import { ShotFired, ShotLanded, LoopClosed } from '../core/match/Events.js';

export const VOICES_PER_TICK = 3;
export const CROSSFADE_SEC = 1;               // R3: about 1 s between two pieces of music
export const DUCK = 0.35;                     // AUTHORED: the ambience bus in battle (-9 dB)
export const SYNTH_VOLUME = 0.45;             // the original host's "normal" synth level (measured there)
export const SETTINGS_DEFAULT = Object.freeze({ muted: false, music: 1, fx: 1, ambience: 1 });

export class SoundLoadError extends Error {
  constructor(failures) {
    super('sound files failed to load: ' + failures.map((f) => f.file + ' (' + f.why + ')').join('; '));
    this.name = 'SoundLoadError';
    this.failures = failures;
  }
}

export class SoundPlayer {
  /** `synth` is the ported Synth class ({ Sfx, SampleRate, make }); `settings` = { muted, music, fx, ambience } (0..1 each). */
  constructor(synth, settings = SETTINGS_DEFAULT) {
    for (const k of ['Sfx', 'SampleRate', 'make']) if (!(k in synth)) throw new TypeError('SoundPlayer needs the ported Synth\'s ' + k);
    for (const r of EVENT_SOUNDS) {
      if (r.sound && !SOUNDS[r.sound]) throw new Error('soundbank: event rule names a sound that is not in SOUNDS: ' + r.sound);
      if (r.synth && !(r.synth in synth.Sfx)) throw new Error('soundbank: event rule names a synth sound the Synth does not have: ' + r.synth);
    }
    this.synth = synth;
    this.ctx = new AudioContext();
    this.limiter = this.ctx.createDynamicsCompressor();          // AUTHORED: a gentle limiter so a full battle cannot clip
    this.limiter.threshold.value = -6; this.limiter.knee.value = 6; this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.25;
    this.master = this.ctx.createGain();
    this.master.connect(this.limiter).connect(this.ctx.destination);
    this.bus = {};
    for (const b of Object.keys(BUSES)) { this.bus[b] = this.ctx.createGain(); this.bus[b].connect(this.master); }
    this.settings = { ...SETTINGS_DEFAULT, ...settings };
    this.buffers = new Map();          // file -> AudioBuffer
    this.synthBuffers = new Map();
    this.loadErrors = [];              // { file, why } for every file that did not load (shown on the title footer)
    this.loaded = false;
    this.tick = -1; this.thisTick = 0;
    this.nextVariant = new Map();      // key -> index of the next variant (round robin)
    this.played = new Map();           // sound key -> count (a check reads it: "it makes sound" is a number)
    this.shots = new Map();            // shotId -> fired by a ship (a ShotLanded is told apart by who fired)
    this.music = null;                 // { key, src, gain }
    this.musicKey = null;              // what should be playing
    this.musicLog = [];                // { key, at (ctx seconds) } each time a piece starts (the page check reads it)
    this.bed = null;
    this.duck = false;
    this.nextCall = 0;
    this.applySettings(0);
  }

  get rate() { return this.synth.SampleRate; }
  get needsGesture() { return this.ctx.state !== 'running'; }
  get muted() { return this.settings.muted; }

  /** Call from a key or button handler: browsers only let audio start from a person's press. */
  wake() { if (this.ctx.state === 'suspended') return this.ctx.resume(); return Promise.resolve(); }

  /** Fetch and decode every file in the soundbank. Throws SoundLoadError listing every file that failed (none is substituted). */
  async load(fetchFn = fetch) {
    const all = [];
    for (const s of Object.values(SOUNDS)) for (const f of s.files) all.push(f);
    const failures = [];
    await Promise.all(all.map(async (f) => {
      let why = null;
      try {
        const res = await fetchFn(f.file);
        if (!res.ok) why = 'HTTP ' + res.status;
        else {
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          // the decoded length must be the length the build measured (resampled to this context's rate)
          const want = Math.round(f.frames * this.ctx.sampleRate / 48000);
          if (Math.abs(buf.length - want) > 1) why = 'decoded ' + buf.length + ' frames, the build measured ' + want;
          else this.buffers.set(f.file, buf);
        }
      } catch (e) { why = (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e)); }
      if (why !== null) failures.push({ file: f.file, why });
    }));
    this.loaded = true;
    if (failures.length) { this.loadErrors = failures; throw new SoundLoadError(failures); }
  }

  /** Settings changed (mute or a volume): ramp the master and bus gains there over `secs`. */
  applySettings(secs = 0.05) {
    const t = this.ctx.currentTime, set = (param, v) => { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, Math.max(0.001, secs / 3)); };
    set(this.master.gain, this.settings.muted ? 0 : 1);
    set(this.bus.music.gain, BUSES.music * this.settings.music);
    set(this.bus.fx.gain, BUSES.fx * this.settings.fx);
    set(this.bus.ambience.gain, BUSES.ambience * this.settings.ambience * (this.duck ? DUCK : 1));
  }

  toggleMute() { this.settings = { ...this.settings, muted: !this.settings.muted }; this.applySettings(); return this.settings.muted; }

  /** A new match: forget the shots of the last one. */
  newMatch() { this.shots.clear(); }

  _count(key) { this.played.set(key, (this.played.get(key) || 0) + 1); }

  _buffer(file) {
    const b = this.buffers.get(file);
    if (b) return b;
    if (this.loadErrors.some((f) => f.file === file)) return null;   // it failed to load: said on the title footer; nothing stands in
    throw new Error('sound file ' + file + ' was never loaded (load() must finish before the game runs)');
  }

  /** One effect voice of a soundbank key (UC-S2 steps 2-3). `rate` shifts its pitch (a player's ring jingle). */
  play(key, tick, rate = 1) {
    if (this.settings.muted || this.ctx.state !== 'running') return false;
    if (tick !== this.tick) { this.tick = tick; this.thisTick = 0; }
    if (++this.thisTick > VOICES_PER_TICK) return false;
    const s = SOUNDS[key];
    if (!s) throw new Error('no sound ' + key + ' in the soundbank');
    const i = this.nextVariant.get(key) || 0;
    this.nextVariant.set(key, (i + 1) % s.files.length);
    const buf = this._buffer(s.files[i].file);
    if (buf === null) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = s.vol;
    src.connect(g).connect(this.bus[s.bus]);
    src.start();
    this._count(key);
    return true;
  }

  /** A sound of the ported Synth that the soundbank keeps on purpose. Counted as "synth:<Sfx name>". */
  playSynth(name, tick, variant = 0) {
    if (this.settings.muted || this.ctx.state !== 'running') return false;
    if (tick !== this.tick) { this.tick = tick; this.thisTick = 0; }
    if (++this.thisTick > VOICES_PER_TICK) return false;
    const sfx = this.synth.Sfx[name], key = sfx * 16 + variant;
    let b = this.synthBuffers.get(key);
    if (!b) {
      const samples = this.synth.make(sfx, variant);
      if (!samples || !samples.length) throw new Error('the synth made no samples for ' + name + ' variant ' + variant);
      b = this.ctx.createBuffer(1, samples.length, this.rate);
      b.copyToChannel(samples instanceof Float32Array ? samples : Float32Array.from(samples), 0);
      this.synthBuffers.set(key, b);
    }
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = b; g.gain.value = SYNTH_VOLUME;
    src.connect(g).connect(this.bus.fx);
    src.start();
    this._count('synth:' + name);
    return true;
  }

  /** The sound an event makes, if any (app/soundbank.js decides). `audible` false (the silent demo) still follows who fired what. */
  forEvent(e, audible) {
    if (e instanceof ShotFired) this.shots.set(e.shotId, e.fromSlot < 0);
    const landed = e instanceof ShotLanded;
    if (audible) {
      const r = soundForEvent(e, { byShip: (id) => { const v = this.shots.get(id); if (v === undefined) throw new Error('sound: shot ' + id + ' landed, but no ShotFired for it was seen'); return v; } });
      if (r !== null) {
        if (r.synth) this.playSynth(r.synth, e.tick);
        else this.play(r.sound, e.tick, SOUNDS[r.sound].transposeBySlot && e instanceof LoopClosed ? Math.pow(2, (e.slot * 2) / 12) : 1);
      }
    }
    if (landed) this.shots.delete(e.shotId);
  }

  /** A menu move or pick (app/main.js). */
  menu(which, tick) { return this.play(MENU_SOUNDS[which], tick); }

  _startMusic(key) {
    const s = SOUNDS[key];
    if (!s) throw new Error('no music ' + key + ' in the soundbank');
    const f = s.files[0], buf = this._buffer(f.file);
    const t = this.ctx.currentTime, gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(s.vol, t + CROSSFADE_SEC);
    gain.connect(this.bus.music);
    let src = null;
    if (buf !== null) {
      src = this.ctx.createBufferSource();
      src.buffer = buf;
      if (s.mode === 'loop') {
        src.loop = true;
        src.loopStart = f.loopStart / 48000; src.loopEnd = f.loopEnd / 48000;
        src.start(t, src.loopStart);
      } else src.start(t);
      src.connect(gain);
      this._count(key);
      this.musicLog.push({ key, at: t });
    }
    this.music = { key, src, gain };
  }

  _stopMusic() {
    if (!this.music) return;
    const { src, gain } = this.music, t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_SEC);
    if (src) src.stop(t + CROSSFADE_SEC + 0.05);
    this.music = null;
  }

  /** Each animation frame: what is on screen decides the music (crossfaded) and whether the ambience is ducked; the sea bed runs
   *  under everything and a gull calls now and then. Nothing starts before the browser lets audio run. */
  update(scene) {
    this.musicKey = scene.music;
    if (scene.duck !== this.duck) { this.duck = scene.duck; this.applySettings(0.5); }
    if (this.ctx.state !== 'running' || !this.loaded) return;
    if (!this.music || this.music.key !== this.musicKey) { this._stopMusic(); if (this.musicKey !== null) this._startMusic(this.musicKey); }
    if (!this.bed) {
      const s = SOUNDS[AMBIENCE.bed], f = s.files[0], buf = this._buffer(f.file);
      const g = this.ctx.createGain();
      g.gain.value = s.vol; g.connect(this.bus.ambience);
      this.bed = { gain: g, src: null };
      if (buf !== null) {
        const src = this.ctx.createBufferSource();
        src.buffer = buf; src.loop = true; src.loopStart = f.loopStart / 48000; src.loopEnd = f.loopEnd / 48000;
        src.connect(g); src.start(this.ctx.currentTime, src.loopStart);
        this.bed.src = src;
        this._count(AMBIENCE.bed);
      }
      this.nextCall = this.ctx.currentTime + this._gap();
    }
    if (this.ctx.currentTime >= this.nextCall) {
      this.nextCall = this.ctx.currentTime + this._gap();
      if (!this.settings.muted) {
        const s = SOUNDS[AMBIENCE.calls], i = this.nextVariant.get(AMBIENCE.calls) || 0;
        this.nextVariant.set(AMBIENCE.calls, (i + 1) % s.files.length);
        const buf = this._buffer(s.files[i].file);
        if (buf !== null) {
          const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
          src.buffer = buf; g.gain.value = s.vol;
          src.connect(g).connect(this.bus.ambience); src.start();
          this._count(AMBIENCE.calls);
        }
      }
    }
  }

  /** Seconds to the next gull: anywhere in the soundbank's gap (view-only randomness; the rules never see it). */
  _gap() { const [lo, hi] = AMBIENCE.callGapSec; return lo + Math.random() * (hi - lo); }
}
