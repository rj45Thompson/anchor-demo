// audio.js - the drive's sound, synthesised in Web Audio (no recordings are shipped). The engine note's pitch follows the ported
// engine RPM (chaos_vehicle.js v.engineRPM, from the READ torque curve and gearbox) and its weight follows the throttle; the tyre
// noise follows Unreal's own IsSlipping / IsSkidding (v.wheels[i].slipping / .skidding, WheelSystem.h). The harmonics, filters,
// levels and the UI sounds are the page's own (AUTHORED: Unreal's template sounds are not ported). Serves UC-7.4, UC-7.4a.
import { partials, cycleHz, TEMPLATE_VOICE } from './engine_voice.js';   // UC-50.2 the engine's voice from its cylinders
const STORE = 'hoc.muted';
const readMuted = () => { try { return localStorage.getItem(STORE) === '1'; } catch (e) { return false; } };

export function makeAudio() {
  const A = { ctx: null, muted: readMuted(), nodes: null, lastGear: null };
  A.start = () => {                                         // browsers allow sound only after a press (UC-7.4a)
    if (A.ctx) { if (A.ctx.state !== 'running') { A.ctx.resume(); unlockTick(A.ctx); } return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;                                       // no Web Audio: the page stays silent and says so on the button
    // UC-7.4b an iPhone (the owner 11-09: "No sound on iPhone"). WebKit puts Web Audio in the ringer's 'ambient' session, which the
    // silent switch mutes; the Audio Session API (Safari 16.4) moves it to 'playback', as a game's sound is. The page's own Sound
    // pill is how a visitor silences it. Elsewhere navigator.audioSession does not exist and nothing changes
    if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    A.ctx = new Ctx();
    unlockTick(A.ctx);
    build(A);
  };
  A.running = () => !!A.ctx && A.ctx.state === 'running';
  /** UC-50.2 the car's voice: { cyl, layout, turbo } (engine_voice.js engineOf of its listing's engine line), or null: the template's */
  A.setVoice = (v) => { A.voice = v || null; if (A.nodes) applyVoice(A); };
  /** a context of the caller's own (an OfflineAudioContext: test/sound_lab.html renders a run to a file to listen to) */
  A.startWith = (ctx) => { A.ctx = ctx; build(A); };
  A.setMuted = (m) => {
    A.muted = m;
    try { localStorage.setItem(STORE, m ? '1' : '0'); } catch (e) { /* per-viewer convenience only */ }
    if (A.nodes) A.nodes.master.gain.setTargetAtTime(m ? 0 : 0.8, A.ctx.currentTime, 0.05);
  };
  A.available = () => !!(window.AudioContext || window.webkitAudioContext);
  return A;
}

// UC-7.4b iOS starts a context only from inside a press's own handler, and only when something plays in it: one silent sample, played
// there (WebKit's audio unlock); resume() alone in a pointerdown left it suspended on iPhones
function unlockTick(ctx) {
  const b = ctx.createBuffer(1, 1, ctx.sampleRate), src = ctx.createBufferSource();
  src.buffer = b; src.connect(ctx.destination); src.start(0);
  if (ctx.state !== 'running') ctx.resume();
}

function noiseBuffer(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function build(A) {
  const c = A.ctx;
  const master = c.createGain(); master.gain.value = A.muted ? 0 : 0.8;
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(c.destination);
  // UC-50.2 the engine (the owner 11-09: "better engine revving sound"): one oscillator playing the car's own cycle (engine_voice.js: its
  // cylinders and layout READ from the listing, the harmonics its firing makes), driven harder into a soft clip the more the throttle is
  // open, through a low-pass the throttle and the revs open, and an exhaust body (a broad lift near 150 Hz). Was a sawtooth at two
  // firings a turn and a square an octave down: the same buzz for every car. Levels and filters AUTHORED (the page's voicing)
  const engineBus = c.createGain(); engineBus.gain.value = 0;
  const eng = c.createOscillator(), drive = c.createGain(); drive.gain.value = 1;
  const shaper = c.createWaveShaper(), curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(1.8 * x); }
  shaper.curve = curve;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.4;
  const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 150; body.Q.value = 0.9; body.gain.value = 7;
  eng.connect(drive).connect(shaper).connect(lp).connect(body).connect(engineBus).connect(master);
  // the intake's roar: band-passed noise beating at the firing frequency (an oscillator on its gain), louder with throttle and revs
  const noise = noiseBuffer(c);
  const intake = c.createBufferSource(); intake.buffer = noise; intake.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
  const beat = c.createGain(); beat.gain.value = 0.55;
  const pulse = c.createOscillator(), pulseDepth = c.createGain(); pulseDepth.gain.value = 0.45;
  pulse.connect(pulseDepth).connect(beat.gain);
  const intakeG = c.createGain(); intakeG.gain.value = 0;
  intake.connect(bp).connect(beat).connect(intakeG).connect(master);
  // a turbo's whine, for a car whose engine line says turbo (READ): a thin tone that climbs with the revs under load
  const whine = c.createOscillator(); whine.type = 'sine';
  const whineG = c.createGain(); whineG.gain.value = 0;
  whine.connect(whineG).connect(master);
  // UC-50.3 the tyres (the owner 11-09: "better tires screech"): a squeal, two tones a little apart that waver as rubber does (two slow
  // oscillators on their pitch), its pitch climbing with the slip; under it a resonant hiss and a broad scrub. Each follows the wheels'
  // slide (effects.js slideAmount: zero unless Unreal's IsSkidding / IsSlipping). Was one band of noise
  const sq1 = c.createOscillator(); sq1.type = 'triangle';
  const sq2 = c.createOscillator(); sq2.type = 'sine';
  const wob1 = c.createOscillator(), wob2 = c.createOscillator(); wob1.frequency.value = 5.3; wob2.frequency.value = 7.9;
  const wobG = c.createGain(); wobG.gain.value = 26;
  wob1.connect(wobG); wob2.connect(wobG); wobG.connect(sq1.frequency); wobG.connect(sq2.frequency);
  const sqToneG = c.createGain(); sqToneG.gain.value = 0;
  const sq2G = c.createGain(); sq2G.gain.value = 0.45;
  sq1.connect(sqToneG); sq2.connect(sq2G).connect(sqToneG); sqToneG.connect(master);
  const tyre = c.createBufferSource(); tyre.buffer = noise; tyre.loop = true;
  const sq = c.createBiquadFilter(); sq.type = 'bandpass'; sq.frequency.value = 1150; sq.Q.value = 7;
  const sqG = c.createGain(); sqG.gain.value = 0;
  tyre.connect(sq).connect(sqG).connect(master);
  const scrub = c.createBiquadFilter(); scrub.type = 'lowpass'; scrub.frequency.value = 700;
  const scrubG = c.createGain(); scrubG.gain.value = 0;
  tyre.connect(scrub).connect(scrubG).connect(master);
  // wind: low noise that grows with speed
  const wind = c.createBufferSource(); wind.buffer = noise; wind.loop = true;
  const wl = c.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 380;
  const windG = c.createGain(); windG.gain.value = 0;
  wind.connect(wl).connect(windG).connect(master);
  for (const o of [eng, pulse, intake, whine, sq1, sq2, wob1, wob2, tyre, wind]) o.start();
  A.nodes = { master, engineBus, eng, drive, lp, bp, pulse, intakeG, whine, whineG, sq1, sq2, sqToneG, sqG, scrubG, windG, noise };   // noise: the crack's too (UC-44.4)
  applyVoice(A);
}
// UC-50.2 the car's voice on the engine's oscillator (a race calls setVoice with engine_voice.js engineOf of its listing's engine line)
function applyVoice(A) {
  const p = partials(A.voice || TEMPLATE_VOICE);
  A.nodes.eng.setPeriodicWave(A.ctx.createPeriodicWave(p.real, p.imag));
}

// every frame of the drive: rpm (READ engine model), throttle 0..1, speed (cm/s), slide 0..1, gear
export function driveSound(A, s) {
  if (!A.ctx || !A.nodes) return;
  const n = A.nodes, t = A.ctx.currentTime, k = 0.03, v = A.voice || TEMPLATE_VOICE;
  const fc = Math.max(3, cycleHz(s.rpm)), f = fc * v.cyl;              // the cycle and the firing (engine_voice.js)
  n.eng.frequency.setTargetAtTime(fc, t, k);
  n.pulse.frequency.setTargetAtTime(f, t, k);
  n.drive.gain.setTargetAtTime(0.9 + 1.6 * s.throttle, t, 0.05);       // more of the clip's grit under load
  n.lp.frequency.setTargetAtTime(Math.min(9000, 260 + 2400 * s.throttle + f * 1.6), t, 0.05);
  if (A.lastGear !== null && s.gear !== A.lastGear && s.gear > 0 && A.lastGear > 0) A.shiftUntil = t + 0.12;   // a gear change
  A.lastGear = s.gear;
  const dip = t < Math.max(A.shiftUntil || 0, A.duckUntil || 0);   // the shift's dip in the note; UC-55.1 under a grind
  const level = (0.15 + 0.25 * s.throttle) * (dip ? 0.25 : 1);
  n.engineBus.gain.setTargetAtTime(s.running ? level : 0, t, dip ? 0.01 : 0.06);
  const revs = Math.min(1, s.rpm / 7000);
  n.bp.frequency.setTargetAtTime(380 + f * 2.4, t, 0.05);
  n.intakeG.gain.setTargetAtTime(s.running ? 0.07 * s.throttle * (0.35 + 0.65 * revs) : 0, t, 0.08);
  n.whine.frequency.setTargetAtTime(1700 + s.rpm * 0.42, t, 0.08);
  n.whineG.gain.setTargetAtTime(s.running && v.turbo ? 0.011 * s.throttle * revs * revs : 0, t, 0.12);
  const kmh = Math.abs(s.speedCmS) * 0.036, sl = Math.max(0, Math.min(1, s.slide));
  // s.slide: the wheels' mean slide (effects.js slideAmount: zero unless IsSkidding / IsSlipping)
  const fs = 640 + 460 * sl + Math.min(220, kmh * 1.1);                // the squeal climbs with the slip, a little with the speed
  n.sq1.frequency.setTargetAtTime(fs, t, 0.04); n.sq2.frequency.setTargetAtTime(fs * 2.03, t, 0.04);
  n.sqToneG.gain.setTargetAtTime(kmh > 5 ? 0.2 * Math.pow(sl, 1.3) : 0, t, 0.05);
  n.sqG.gain.setTargetAtTime(kmh > 8 ? 0.14 * sl : 0, t, 0.05);
  n.scrubG.gain.setTargetAtTime(kmh > 3 ? 0.2 * sl : 0, t, 0.06);
  n.windG.gain.setTargetAtTime(Math.min(0.2, kmh / 900), t, 0.2);
}

export function silence(A) {
  if (!A.nodes) return;
  const t = A.ctx.currentTime, n = A.nodes;
  for (const g of [n.engineBus.gain, n.intakeG.gain, n.whineG.gain, n.sqToneG.gain, n.sqG.gain, n.scrubG.gain, n.windG.gain]) g.setTargetAtTime(0, t, 0.05);
}

export const SFX = ['gear_in_1', 'gear_in_2', 'gear_in_3', 'gear_out', 'gate', 'clutch_floor'];
export async function loadSfx(A) {
  if (!A.ctx || A.sfx) return;
  const got = {};
  await Promise.all(SFX.map(async (n) => { const r = await fetch('data/sfx/' + n + '.wav'); if (!r.ok) throw new Error('data/sfx/' + n + '.wav: ' + r.status); got[n] = await A.ctx.decodeAudioData(await r.arrayBuffer()); }));
  A.sfx = got;
}
export function sfx(A, name, gain = 0.8, rate = 1) {
  if (!A.ctx || !A.nodes || !A.sfx) return;
  const b = A.sfx[name]; if (!b) throw new Error('audio.js: no recorded sound called ' + name);
  const s = A.ctx.createBufferSource(), g = A.ctx.createGain(); s.buffer = b; s.playbackRate.value = rate; g.gain.value = gain;
  s.connect(g).connect(A.nodes.master); s.start();
}
// UC-55.1 a gear the synchromesh refuses (the owner 11-10: "Make the gear scrapping much louder to show you messed up"): no free
// recording of one was found, so the page's own (AUTHORED, every number here): the engine's own noise through two narrow metal bands,
// chopped at a ragged 38-62 Hz (the dog teeth skipping over each other), three detuned square partials for the ring of the metal, at
// driven into a soft clip (a noise burst loud enough by its peaks alone clipped the output: a peak of 1.5 for twice the gear clip's
// level, measured offline), full level for 0.35 s then fading by 0.7 s, the engine ducked under it. UC-55.2 one at a time: a new grind cuts the last one off
export const GRIND = { PEAK: 0.8, DRIVE: 4, HOLD_S: 0.35, END_S: 0.7, BANDS: [[1700, 2.5], [3300, 4]], CHOP_HZ: [38, 62], CHOP_STEP_S: 0.035, RING_HZ: [1131, 1597, 2389], RING_GAIN: 0.05 };
let SOFT = null;
const softClip = () => SOFT || (SOFT = Float32Array.from({ length: 1025 }, (_, i) => Math.tanh(3 * (i / 512 - 1)) / Math.tanh(3)));   // -1..1 onto -1..1, rounded off
export function grind(A) {
  if (!A.ctx || !A.nodes) return;
  const c = A.ctx, t = c.currentTime, G = GRIND;
  if (A.grindVoice) A.grindVoice.cut(t);
  const out = c.createGain(), chop = c.createGain(), lfo = c.createOscillator(), depth = c.createGain(), src = c.createBufferSource(), stops = [src, lfo];
  out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(G.PEAK, t + 0.01); out.gain.setValueAtTime(G.PEAK, t + G.HOLD_S);
  out.gain.exponentialRampToValueAtTime(0.001, t + G.END_S);
  lfo.type = 'sawtooth'; depth.gain.value = 0.5; chop.gain.value = 0.5;      // the chop: 0..1 under a sawtooth, a tooth's hit then its drag
  for (let k = 0, at = t; at < t + G.END_S; k++, at += G.CHOP_STEP_S) lfo.frequency.setValueAtTime(G.CHOP_HZ[0] + Math.random() * (G.CHOP_HZ[1] - G.CHOP_HZ[0]), at);
  lfo.connect(depth).connect(chop.gain);
  src.buffer = A.nodes.noise;                                                // the engine's own noise, made when the sound started
  for (const [f, q] of G.BANDS) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; src.connect(bp).connect(chop); }
  for (const f of G.RING_HZ) {
    const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.97, t + G.END_S);
    g.gain.value = G.RING_GAIN; o.connect(g).connect(chop); stops.push(o);
  }
  const drive = c.createGain(), clip = c.createWaveShaper(); drive.gain.value = G.DRIVE; clip.curve = softClip(); clip.oversample = '2x';
  chop.connect(drive).connect(clip).connect(out).connect(A.nodes.master);
  for (const n of stops) { n.start(t, n === src ? Math.random() * 1.2 : undefined); n.stop(t + G.END_S + 0.02); }
  A.duckUntil = t + G.END_S;                                                 // the engine under it (driveSound)
  const voice = { cut(at) { out.gain.cancelScheduledValues(at); out.gain.setTargetAtTime(0, at, 0.005); for (const n of stops) n.stop(at + 0.03); if (A.grindVoice === voice) A.grindVoice = null; } };
  A.grindVoice = voice;
  src.onended = () => { if (A.grindVoice === voice) A.grindVoice = null; };
}

// short UI sounds: the countdown's beeps (a higher one on GO), a gate tick, the lap chime
export function blip(A, kind) {
  if (!A.ctx || !A.nodes) return;
  const c = A.ctx, t = c.currentTime;
  const tone = (freq, dur, vol, type = 'sine', at = 0) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(vol, t + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    o.connect(g).connect(A.nodes.master); o.start(t + at); o.stop(t + at + dur + 0.02);
  };
  if (kind === 'count') tone(660, 0.18, 0.35, 'triangle');
  else if (kind === 'go') { tone(990, 0.45, 0.4, 'triangle'); tone(1485, 0.35, 0.15, 'sine'); }
  else if (kind === 'gate') tone(1320, 0.12, 0.18, 'sine');
  else if (kind === 'lap') { tone(784, 0.25, 0.3, 'triangle'); tone(988, 0.25, 0.3, 'triangle', 0.12); tone(1319, 0.5, 0.3, 'triangle', 0.24); }
  else if (kind === 'best') { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.4, 0.28, 'triangle', i * 0.1)); }
  else if (kind === 'lose') { tone(523, 0.3, 0.26, 'triangle'); tone(392, 0.55, 0.26, 'triangle', 0.18); }   // UC-44.4 crossed second: two falling notes (AUTHORED)
  else throw new Error('audio.js: no sound called ' + kind);
}
// UC-44.4 an upshift's exhaust crack: a short burst of low noise as the drive is cut and comes back, louder the higher the revs it left
// (k 0..1, the shift's rpm over the redline). AUTHORED voicing, like the engine's; no recording
export function crack(A, k) {
  if (!A.ctx || !A.nodes) return;
  const c = A.ctx, t = c.currentTime, src = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = A.nodes.noise; lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 6;   // the engine's own noise, made when the sound started (a new one at the first shift cost a frame); the filter's two settings had sat inside this comment
  const v = 0.12 + 0.4 * Math.max(0, Math.min(1, k)) ** 2;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  src.connect(lp).connect(g).connect(A.nodes.master); src.start(t, Math.random() * 1.5); src.stop(t + 0.18);
}
