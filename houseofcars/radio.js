// radio.js - the car radio (UC-27): stations whose music is made in the browser while it plays, from each station's own seeded
// pattern (its chords, its tune, its drums), so no recording and nobody's song is used. The sound goes through the page's own
// master (audio.js), so the sound switch silences the radio with the engine. Every tempo, scale, voice and level here is AUTHORED
// (for feel); the music theory is the usual one (equal temperament, A4 = 440 Hz). The talk station speaks with the browser's own
// voice (speechSynthesis) and says so when the device has none (UC-27.3a).
export const STATIONS = [
  { id: 'hocfm', name: 'HOC FM 104.7', tag: 'Synthwave for the night shift', style: 'synth', bpm: 100, root: 57, seed: 7 },
  { id: 'redline', name: 'Redline 99', tag: 'Drum and bass at the limiter', style: 'dnb', bpm: 172, root: 53, seed: 11 },
  { id: 'lofi', name: 'Lo-Fi Lot', tag: 'Beats to browse cars to', style: 'lofi', bpm: 80, root: 60, seed: 3 },
  { id: 'talk', name: 'Torque Talk 1310', tag: 'All talk, no test drive', style: 'talk', bpm: 70, root: 48, seed: 5 },
];
// the talk station's lines: the page's own parody of dealership radio (no real person, business or advert)
export const TALK = [
  'You are listening to Torque Talk, thirteen ten. Today’s topic: is the extended warranty a lifestyle?',
  'Our caller says his trade-in has character. Sir, character is not a resale value.',
  'A reminder from the newsroom: the doc fee is not a doctor. Nobody knows what it is.',
  'Traffic on the Whitemud: a Rolls-Royce is doing the speed limit and everyone is filming it.',
  'This hour is brought to you by undercoating. Undercoating: because your car has an under.',
  'Up next: shift on the light, or shift by feel? Our panel says whatever beats R.J. Thompson.',
  'Breaking: a sales manager has gone to talk to his manager. He has been gone for three days.',
  'Weather: clear skies, with a ninety percent chance of a four-year finance plan.',
];
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10] };
// each style's chords as scale degrees (0 = the root's chord), four bars round
const PROGRESSIONS = { synth: [0, 5, 2, 6], dnb: [0, 5, 0, 3], lofi: [1, 4, 0, 5], talk: [0, 3, 4, 3] };
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** a small seeded random (mulberry32), so a station plays the same tune every time it is tuned in */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** a station's four bars: per 16th step, the chord's notes, the bass note and the tune's note (or null), all MIDI numbers */
export function composition(st) {
  const scale = st.style === 'lofi' ? SCALES.dorian : SCALES.minor, rnd = seeded(st.seed), prog = PROGRESSIONS[st.style];
  const deg = (d) => st.root + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];
  const bars = prog.map((c) => {
    const chord = [deg(c), deg(c + 2), deg(c + 4)].concat(st.style === 'lofi' ? [deg(c + 6)] : []);
    const tune = Array.from({ length: 16 }, (_, i) => (rnd() < (i % 4 === 0 ? 0.7 : 0.3) ? deg(c + [0, 2, 4, 7][Math.floor(rnd() * 4)]) + 12 : null));
    return { chord, bass: deg(c) - 12, tune };
  });
  return { bars, stepS: 60 / st.bpm / 4 };
}

export class Radio {
  constructor(audio, onChange) {
    this.audio = audio; this.onChange = onChange || (() => {});
    this.index = -1;                                        // -1: off
    this.timer = 0; this.talkTimer = 0; this.bus = null;
  }
  get station() { return this.index < 0 ? null : STATIONS[this.index]; }
  next() { this.tune(this.index + 1 >= STATIONS.length ? -1 : this.index + 1); }
  back() { this.tune(this.index - 1 < -1 ? STATIONS.length - 1 : this.index - 1); }
  /** tune to station i (-1: off) */
  tune(i) {
    this.stopPlaying();
    this.index = i;
    this.audio.start();
    const A = this.audio;
    if (!A.ctx || !A.nodes) { this.onChange(this.station, 'no sound'); return; }   // UC-27.1a
    this.staticBurst();
    if (i < 0) { this.onChange(null, ''); return; }
    const st = STATIONS[i];
    if (!this.bus) { this.bus = A.ctx.createGain(); this.bus.gain.value = 0.28; this.bus.connect(A.nodes.master); }
    this.song = composition(st); this.step = 0; this.at = A.ctx.currentTime + 0.3;
    this.timer = setInterval(() => this.schedule(), 25);    // the usual Web Audio look-ahead: notes booked 0.15 s ahead
    let note = '';
    if (st.style === 'talk') note = this.talk();
    this.onChange(st, note);
  }
  stopPlaying() {
    clearInterval(this.timer); this.timer = 0; clearTimeout(this.talkTimer); this.talkTimer = 0;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }
  schedule() {
    const c = this.audio.ctx, st = this.station;
    if (!st) return;
    while (this.at < c.currentTime + 0.15) {
      const bar = this.song.bars[Math.floor(this.step / 16) % this.song.bars.length], s = this.step % 16;
      this.play(st.style, bar, s, this.at, this.song.stepS);
      this.at += this.song.stepS * (st.style === 'lofi' && s % 2 === 0 ? 1.18 : st.style === 'lofi' ? 0.82 : 1);   // lo-fi swings its 16ths
      this.step++;
    }
  }
  /** one 16th step of a station: its drums, its bass, its chords and its tune */
  play(style, bar, s, t, d) {
    if (style === 'synth') {
      if (s % 4 === 0) this.kick(t, 0.9); if (s === 4 || s === 12) this.snare(t, 0.5, true); if (s % 2 === 1) this.hat(t, 0.12);
      if (s % 2 === 0) this.voice('sawtooth', midiHz(bar.bass), t, d * 1.8, 0.22, 380);
      if (s === 0) bar.chord.forEach((m) => this.voice('sawtooth', midiHz(m), t, d * 16, 0.06, 1400, 0.5));
      this.voice('square', midiHz(bar.chord[s % 3] + 12), t, d * 0.9, 0.05, 2400);   // the arpeggio
      if (bar.tune[s] !== null) this.voice('triangle', midiHz(bar.tune[s]), t, d * 2, 0.08, 3000);
    } else if (style === 'dnb') {
      if (s === 0 || s === 10) this.kick(t, 1); if (s === 4 || s === 12) this.snare(t, 0.7); this.hat(t, s % 2 ? 0.08 : 0.14);
      if (s % 4 === 0) this.voice('sawtooth', midiHz(bar.bass - 12), t, d * 3.5, 0.3, 240 + 300 * Math.random());
      if (s === 0) bar.chord.forEach((m) => this.voice('triangle', midiHz(m + 12), t, d * 16, 0.04, 2000, 1));
      if (bar.tune[s] !== null && s % 2 === 0) this.voice('square', midiHz(bar.tune[s]), t, d * 1.5, 0.05, 1800);
    } else if (style === 'lofi') {
      if (s === 0 || s === 7 || s === 10) this.kick(t, 0.7); if (s === 4 || s === 12) this.snare(t, 0.35); if (s % 2 === 0) this.hat(t, 0.06);
      if (s === 0 || s === 8) bar.chord.forEach((m) => this.keys(midiHz(m), t, d * 7, 0.07));
      if (s === 0 || s === 6 || s === 8) this.voice('sine', midiHz(bar.bass), t, d * 3, 0.28, 600);
      if (bar.tune[s] !== null && s % 4 === 2) this.keys(midiHz(bar.tune[s]), t, d * 3, 0.05);
      if (Math.random() < 0.3) this.crackle(t);
    } else if (style === 'talk') {                          // a soft bed under the voice
      if (s === 0) bar.chord.forEach((m) => this.voice('sine', midiHz(m), t, d * 16, 0.035, 900, 1));
      if (s % 8 === 0) this.voice('sine', midiHz(bar.bass), t, d * 6, 0.12, 400);
    }
  }
  /** the talk station: the next line, spoken, every few seconds; or why it cannot speak */
  talk() {
    if (typeof speechSynthesis === 'undefined' || !speechSynthesis.getVoices) return 'This device has no speech voice for the talk station.';
    let n = 0;
    const say = () => {
      if (this.station && this.station.style === 'talk' && !this.audio.muted) {
        const u = new SpeechSynthesisUtterance(TALK[n % TALK.length]); n++;
        u.rate = 1.05; u.pitch = 0.9; u.volume = 0.9;
        u.onend = () => { this.talkTimer = setTimeout(say, 1800); };
        speechSynthesis.speak(u);
      } else this.talkTimer = setTimeout(say, 1500);
    };
    this.talkTimer = setTimeout(say, 600);
    return '';
  }
  // ---- the instruments, each a few Web Audio nodes that free themselves when the note ends
  env(g, t, v, a, d) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  voice(type, f, t, dur, vol, cutoff, attack = 0.005) {
    const c = this.audio.ctx, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = cutoff;
    this.env(g, t, vol, Math.min(attack, dur / 2), dur);
    o.connect(lp).connect(g).connect(this.bus); o.start(t); o.stop(t + dur + attack + 0.05);
  }
  keys(f, t, dur, vol) {                                    // an electric piano: a sine with a sine modulating it, fading
    const c = this.audio.ctx, o = c.createOscillator(), m = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    o.frequency.value = f; m.frequency.value = f * 2; mg.gain.setValueAtTime(f * 1.2, t); mg.gain.exponentialRampToValueAtTime(1, t + dur);
    m.connect(mg).connect(o.frequency); this.env(g, t, vol, 0.005, dur);
    o.connect(g).connect(this.bus); o.start(t); m.start(t); o.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
  }
  kick(t, vol) {
    const c = this.audio.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, vol, 0.002, 0.25); o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.3);
  }
  noise(t, dur, vol, type, freq, q = 1) {
    const c = this.audio.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    if (!this.noiseBuf) { const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = b; }
    src.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    this.env(g, t, vol, 0.002, dur); src.connect(f).connect(g).connect(this.bus); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  snare(t, vol, gated) { this.noise(t, gated ? 0.22 : 0.14, vol, 'bandpass', 1800, 0.7); this.voice('triangle', 185, t, 0.08, vol * 0.4, 2000); }
  hat(t, vol) { this.noise(t, 0.04, vol, 'highpass', 7000); }
  crackle(t) { this.noise(t + Math.random() * 0.1, 0.006, 0.05, 'highpass', 3000); }
  staticBurst() {                                           // between stations: a burst of static, as a tuner sweeps
    if (!this.bus) { const A = this.audio; this.bus = A.ctx.createGain(); this.bus.gain.value = 0.28; this.bus.connect(A.nodes.master); }
    this.noise(this.audio.ctx.currentTime, 0.3, 0.25, 'bandpass', 2500, 0.5);
  }
}
