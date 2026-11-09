// sound.js - plays the rules' synthesized sounds (the ported Synth: every sound made from numbers, no recorded file) through
// WebAudio. One voice per sound, at most VOICES_PER_TICK new voices in one game tick, so a volley of cannons is a roar and not a
// wall of clipping. The volumes are the original host's (measured there: cannons and crunches at 0.28 kept a full battle's mix
// under 1.0; everything else at 0.45; a menu move at 0.5; a menu pick at 0.8).
//
// Browsers start an AudioContext suspended until the person presses something on the page. Until then nothing is scheduled (a
// sound queued on a suspended context would all burst out at the first key); the page shows "press any key for sound" from
// `needsGesture` - the reason is reported, not hidden.

export const VOICES_PER_TICK = 3;
export const VOLUME = Object.freeze({ loud: 0.28, normal: 0.45, menuMove: 0.5, menuPick: 0.8 });

export class SoundPlayer {
  /** `synth` is the ported Synth class: { Sfx, SampleRate, make(sfx, variant), for(event) }. */
  constructor(synth) {
    for (const k of ['Sfx', 'SampleRate', 'make', 'for']) if (!(k in synth)) throw new TypeError('SoundPlayer needs the ported Synth\'s ' + k);
    this.synth = synth;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
    this.buffers = new Map();
    this.tick = -1; this.thisTick = 0;
    this.played = new Map();           // Sfx name -> count (a check reads it: "it makes sound" is a number)
    this.muted = false;
  }

  get rate() { return this.synth.SampleRate; }
  get needsGesture() { return this.ctx.state !== 'running'; }

  /** Call from a key or button handler: browsers only let audio start from a person's press. */
  wake() { if (this.ctx.state === 'suspended') return this.ctx.resume(); return Promise.resolve(); }

  buffer(sfx, variant) {
    const key = sfx * 16 + variant;
    let b = this.buffers.get(key);
    if (b) return b;
    const samples = this.synth.make(sfx, variant);
    if (!samples || !samples.length) throw new Error('the synth made no samples for sound ' + sfx + ' variant ' + variant);
    b = this.ctx.createBuffer(1, samples.length, this.rate);
    b.copyToChannel(samples instanceof Float32Array ? samples : Float32Array.from(samples), 0);
    this.buffers.set(key, b);
    return b;
  }

  play(sfx, tick, variant = 0, volume = VOLUME.normal) {
    if (this.muted || this.ctx.state !== 'running') return false;
    if (tick !== this.tick) { this.tick = tick; this.thisTick = 0; }
    if (++this.thisTick > VOICES_PER_TICK) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer(sfx, variant);
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
    const name = this.nameOf(sfx);
    this.played.set(name, (this.played.get(name) || 0) + 1);
    return true;
  }

  nameOf(sfx) { for (const [k, v] of Object.entries(this.synth.Sfx)) if (v === sfx) return k; throw new Error('no Sfx with value ' + sfx); }

  /** The sound an event makes, if any (the ported Synth decides; a fanfare is transposed by the closer's slot). */
  forEvent(e, LoopClosed) {
    const s = this.synth.for(e);
    if (s === null || s === undefined) return;
    const Sfx = this.synth.Sfx;
    const loud = s === Sfx.Cannon || s === Sfx.Crunch;
    this.play(s, e.tick, LoopClosed && e instanceof LoopClosed ? e.slot : 0, loud ? VOLUME.loud : VOLUME.normal);
  }
}
