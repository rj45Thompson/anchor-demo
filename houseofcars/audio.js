// audio.js - the drive's sound, synthesised in Web Audio (no recordings are shipped). The engine note's pitch follows the ported
// engine RPM (chaos_vehicle.js v.engineRPM, from the READ torque curve and gearbox) and its weight follows the throttle; the tyre
// noise follows Unreal's own IsSlipping / IsSkidding (v.wheels[i].slipping / .skidding, WheelSystem.h). The harmonics, filters,
// levels and the UI sounds are the page's own (AUTHORED: Unreal's template sounds are not ported). Serves UC-7.4, UC-7.4a.
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
  // engine: a sawtooth at the firing pitch, a square an octave below, through a drive shaper and a throttle-opened low-pass
  const engineBus = c.createGain(); engineBus.gain.value = 0;
  const shaper = c.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(2.4 * x); }
  shaper.curve = curve;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
  const saw = c.createOscillator(); saw.type = 'sawtooth';
  const sub = c.createOscillator(); sub.type = 'square';
  const sawG = c.createGain(); sawG.gain.value = 0.5;
  const subG = c.createGain(); subG.gain.value = 0.35;
  saw.connect(sawG).connect(shaper); sub.connect(subG).connect(shaper);
  shaper.connect(lp).connect(engineBus).connect(master);
  // intake: band-passed noise that rises with throttle and RPM
  const noise = noiseBuffer(c);
  const intake = c.createBufferSource(); intake.buffer = noise; intake.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
  const intakeG = c.createGain(); intakeG.gain.value = 0;
  intake.connect(bp).connect(intakeG).connect(master);
  // tyres: a resonant squeal band and a broad scrub, each gated by Unreal's slip rules
  const tyre = c.createBufferSource(); tyre.buffer = noise; tyre.loop = true;
  const sq = c.createBiquadFilter(); sq.type = 'bandpass'; sq.frequency.value = 1150; sq.Q.value = 9;
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
  for (const o of [saw, sub, intake, tyre, wind]) o.start();
  A.nodes = { master, engineBus, lp, saw, sub, bp, intakeG, sqG, scrubG, windG, noise };   // noise: the crack's too (UC-44.4)
}

// every frame of the drive: rpm (READ engine model), throttle 0..1, speed (cm/s), slide 0..1, gear
export function driveSound(A, s) {
  if (!A.ctx || !A.nodes) return;
  const n = A.nodes, t = A.ctx.currentTime, k = 0.03;
  const f = Math.max(28, s.rpm / 60 * 2);                     // firing pitch: two pulses a turn (AUTHORED voicing)
  n.saw.frequency.setTargetAtTime(f, t, k);
  n.sub.frequency.setTargetAtTime(f / 2, t, k);
  n.lp.frequency.setTargetAtTime(300 + 2600 * s.throttle + f * 2, t, 0.05);
  if (A.lastGear !== null && s.gear !== A.lastGear && s.gear > 0 && A.lastGear > 0) A.shiftUntil = t + 0.12;   // a gear change
  A.lastGear = s.gear;
  const dip = t < (A.shiftUntil || 0);                        // the shift's dip in the note
  const level = (0.16 + 0.22 * s.throttle) * (dip ? 0.25 : 1);
  n.engineBus.gain.setTargetAtTime(s.running ? level : 0, t, dip ? 0.01 : 0.06);
  n.bp.frequency.setTargetAtTime(500 + f * 4, t, 0.05);
  n.intakeG.gain.setTargetAtTime(s.running ? 0.05 * s.throttle : 0, t, 0.08);
  const kmh = Math.abs(s.speedCmS) * 0.036;
  // s.slide: the wheels' mean slide (effects.js slideAmount: zero unless IsSkidding / IsSlipping)
  n.sqG.gain.setTargetAtTime(kmh > 8 ? 0.3 * s.slide : 0, t, 0.05);
  n.scrubG.gain.setTargetAtTime(kmh > 3 ? 0.22 * s.slide : 0, t, 0.06);
  n.windG.gain.setTargetAtTime(Math.min(0.2, kmh / 900), t, 0.2);
}

export function silence(A) {
  if (!A.nodes) return;
  const t = A.ctx.currentTime, n = A.nodes;
  for (const g of [n.engineBus.gain, n.intakeG.gain, n.sqG.gain, n.scrubG.gain, n.windG.gain]) g.setTargetAtTime(0, t, 0.05);
}

// UC-34 4b the stick's recorded sounds (data/sfx, cut by tools/sfx.py from CC0 recordings; data/sfx/CREDITS.json names them):
// fetched and decoded once the audio has started, played through the master like everything else
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
// a gear the synchromesh refuses: no free recording of one was found, so the page's own (AUTHORED): a noise band buzzing at the
// rate the dog teeth hit each other, 0.4 s
export function grind(A) {
  if (!A.ctx || !A.nodes) return;
  const c = A.ctx, t = c.currentTime, src = c.createBufferSource(), bp = c.createBiquadFilter(), am = c.createGain(), lfo = c.createOscillator(), depth = c.createGain(), out = c.createGain();
  src.buffer = noiseBuffer(c); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 3;
  lfo.type = 'square'; lfo.frequency.value = 170; depth.gain.value = 0.5; am.gain.value = 0.5;
  out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.5, t + 0.02); out.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  lfo.connect(depth).connect(am.gain); src.connect(bp).connect(am).connect(out).connect(A.nodes.master);
  src.start(t); lfo.start(t); src.stop(t + 0.42); lfo.stop(t + 0.42);
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
  src.buffer = A.nodes.noise; lp.type = 'lowpass';   // the engine's own noise, made when the sound started (a new one at the first shift cost a frame) lp.frequency.value = 520; lp.Q.value = 6;
  const v = 0.12 + 0.4 * Math.max(0, Math.min(1, k)) ** 2;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  src.connect(lp).connect(g).connect(A.nodes.master); src.start(t, Math.random() * 1.5); src.stop(t + 0.18);
}
