// port of model/Audio/Synth.cs
//
// Every sound the game makes, synthesized from numbers (no recorded file: no licence question, and the same samples on every
// machine): a fanfare when a castle is enclosed (transposed per player), the cease-fire call, a snare drum that warns the repair
// time is running out, cannon fire, splashes, explosions, the zap that prints walls, the menus. Mono samples in -1..1 at
// SampleRate as a Float32Array (the C# float[]); the app's audio layer plays them.
//
// Arithmetic follows the C#: double maths in the same operation order, rounded to float32 exactly where the C# stores or multiplies
// floats; the noise is a 32-bit xorshift on whole numbers, so its sequence is the C# one bit for bit.
//
// Public-build change: Sfx 10 and 11 are named Horn and Rumble (the private names belonged to extended-mode enemies the public build
// does not have); the numbers and the sounds are unchanged. Synth.for maps only events the normal rules emit.
import { Phase } from '../match/Entities.js';
import {
  ShotFired, ShotLanded, ShipSunk, WallsPlaced, WallBroken, LoopClosed, LastPieceGrace, PhaseChanged,
} from '../match/Events.js';

const SampleRate = 48000;

const Sfx = Object.freeze({
  Cannon: 0, Splash: 1, Explosion: 2, Zap: 3, Crunch: 4, Fanfare: 5, CeaseFire: 6, Drum: 7, MenuMove: 8, MenuPick: 9,
  Horn: 10, Rumble: 11, Victory: 12, GameOver: 13, Boulder: 14, Recruit: 15,
});

const Wave = Object.freeze({ Square: 0, Saw: 1, Triangle: 2 });

const cache = new Map();

/** float Osc(Wave, double): the C# returns a float. */
function osc(w, phase) {
  const p = phase - Math.floor(phase);
  switch (w) {
    case Wave.Square: return p < 0.5 ? 1 : -1;
    case Wave.Saw: return Math.fround(2 * p - 1);
    default: return Math.fround(4 * Math.abs(p - 0.5) - 1);
  }
}

/** A falling sine thump with a fast attack and an exponential tail (cannon, explosion). `seed` is unused, as in the C#. */
function boom(seconds, f0, f1, gain, seed) {
  const n = Math.trunc(seconds * SampleRate); const o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SampleRate, u = t / seconds;
    const f = f1 + (f0 - f1) * Math.exp(-u * 5);
    ph += f / SampleRate;
    const env = Math.min(1, t * 400) * Math.exp(-u * 4.5);
    o[i] = Math.sin(ph * 2 * Math.PI) * env * gain;          // Float32Array store = the C# (float) cast
  }
  return o;
}

/** Noise through a one-pole low-pass that sweeps from `hi` to `lo` Hz (splash, crunch, rumble). Seeded: always the same. */
function noise(seconds, gain, seed, hi, lo) {
  const n = Math.trunc(seconds * SampleRate); const o = new Float32Array(n);
  // C#: uint x = (uint)(seed * 2654435761u + 1) - an int times a uint is a long; the cast keeps the low 32 bits
  let x = (Math.imul(seed, 2654435761 | 0) + 1) >>> 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x = (x ^ (x << 13)) >>> 0; x = (x ^ (x >>> 17)) >>> 0; x = (x ^ (x << 5)) >>> 0;
    const white = (x & 0xFFFF) / 32768.0 - 1;
    const u = i / n, cut = hi + (lo - hi) * u, a = 1 - Math.exp(-2 * Math.PI * cut / SampleRate);
    y += a * (white - y);
    const env = Math.min(1, i / (0.004 * SampleRate)) * Math.pow(1 - u, 2);
    o[i] = y * env * gain * 2;
  }
  return o;
}

function chirp(seconds, f0, f1, gain, w) {
  const n = Math.trunc(seconds * SampleRate); const o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n; ph += (f0 + (f1 - f0) * u) / SampleRate;
    const env = Math.min(1, i / (0.003 * SampleRate)) * (1 - u);
    o[i] = osc(w, ph) * Math.fround(env * gain);            // float * float: exact in double, rounded once on store
  }
  return o;
}

/** A run of notes (semitones over `root`), each `step` long, the last held `tail` longer. */
function notes(semis, step, tail, root, w, gain, vibrato = 0) {
  const total = step * semis.length + tail;
  const n = Math.trunc(total * SampleRate); const o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SampleRate;
    const k = Math.min(semis.length - 1, Math.trunc(t / step));
    const local = t - k * step, len = k === semis.length - 1 ? step + tail : step;
    const f = root * Math.pow(2, semis[k] / 12.0) * (1 + 0.006 * Math.sin(t * vibrato * 2 * Math.PI));
    ph += f / SampleRate;
    const env = Math.min(1, local / 0.008) * Math.max(0, 1 - local / len * 0.85);
    o[i] = osc(w, ph) * Math.fround(env * gain);
  }
  return o;
}

function mix(a, b) {
  const o = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < o.length; i++) {
    const v = Math.fround((i < a.length ? a[i] : 0) + (i < b.length ? b[i] : 0));   // float + float
    o[i] = Math.max(-1, Math.min(1, v));
  }
  return o;
}

function build(s, v) {
  switch (s) {
    case Sfx.Cannon: return mix(boom(0.55, 70, 38, 0.9, 11), noise(0.18, 0.5, 21, 2600, 400));
    case Sfx.Splash: return noise(0.6, 0.55, 31, 2200, 900);
    case Sfx.Explosion: return mix(boom(1.3, 55, 25, 1.0, 41), noise(1.1, 0.7, 43, 1800, 200));
    case Sfx.Zap: return chirp(0.14, 2400, 600, 0.35, Wave.Square);
    case Sfx.Crunch: return mix(noise(0.3, 0.6, 51, 3200, 1200), boom(0.25, 140, 80, 0.5, 52));
    case Sfx.Fanfare: return notes([0, 4, 7, 12], 0.11, 0.35, 523.25 * Math.pow(2, (v * 2) / 12.0), Wave.Triangle, 0.45);
    case Sfx.CeaseFire: return mix(notes([7, 0], 0.45, 0.25, 220, Wave.Saw, 0.3, 5), notes([11, 4], 0.45, 0.25, 220, Wave.Saw, 0.2, 5));
    case Sfx.Drum: return mix(noise(0.12, 0.6, 61, 5000, 1500), boom(0.1, 190, 150, 0.4, 62));
    case Sfx.MenuMove: return chirp(0.05, 900, 1100, 0.25, Wave.Square);
    case Sfx.MenuPick: return notes([0, 7], 0.06, 0.05, 880, Wave.Square, 0.3);
    case Sfx.Horn: return mix(notes([0], 2.2, 0.6, 73.4, Wave.Saw, 0.45, 3), notes([7], 2.2, 0.6, 73.4, Wave.Saw, 0.3, 3));
    case Sfx.Rumble: return mix(chirp(1.4, 90, 45, 0.5, Wave.Saw), noise(1.4, 0.35, 71, 600, 80));
    case Sfx.Victory: return notes([0, 4, 7, 12, 7, 12, 16, 19], 0.14, 0.6, 392, Wave.Triangle, 0.45);
    case Sfx.GameOver: return notes([7, 3, 0, -5], 0.3, 0.7, 220, Wave.Saw, 0.35);
    case Sfx.Boulder: return mix(boom(0.7, 50, 30, 0.9, 81), noise(0.5, 0.6, 82, 1500, 150));
    case Sfx.Recruit: return notes([0, 5, 9, 12], 0.08, 0.3, 659.25, Wave.Triangle, 0.35);
  }
  throw new RangeError('no sound ' + s);
}

export class Synth {
  static SampleRate = SampleRate;
  static Sfx = Sfx;

  /** The samples of a sound (a shared, cached Float32Array: do not write into it); `variant` shifts it (a player's fanfare is
   *  transposed by slot). */
  static make(s, variant = 0) {
    if (!Number.isInteger(s) || !Number.isInteger(variant)) throw new TypeError('Synth.make takes whole numbers');
    const key = s * 16 + variant;
    const have = cache.get(key);
    if (have !== undefined) return have;
    const made = build(s, variant);
    cache.set(key, made);
    return made;
  }

  /** The sound an event makes, or null (most events are silent). One place, so the app and a test agree. */
  static for(e) {
    if (e instanceof ShotFired) return Sfx.Cannon;
    if (e instanceof ShotLanded) return e.hit ? Sfx.Crunch : Sfx.Splash;
    if (e instanceof ShipSunk) return Sfx.Explosion;
    if (e instanceof WallsPlaced) return Sfx.Zap;
    if (e instanceof WallBroken) return Sfx.Crunch;
    if (e instanceof LoopClosed) return Sfx.Fanfare;
    if (e instanceof LastPieceGrace) return Sfx.Drum;
    if (e instanceof PhaseChanged && e.phase === Phase.Score) return Sfx.CeaseFire;
    if (e instanceof PhaseChanged && e.phase === Phase.Victory) return Sfx.Victory;
    if (e instanceof PhaseChanged && e.phase === Phase.GameOver) return Sfx.GameOver;
    return null;
  }
}
