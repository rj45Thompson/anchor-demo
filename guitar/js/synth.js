// Plucked-string synthesiser (Karplus-Strong) for Listen, the demo, and the Node tests.
// Serves: P2 (hear the chord), A8 (the page knows when it is making sound), A10 (demo), tests.
// Pure functions: they return sample arrays; app.js turns them into an AudioBuffer.

import { shapeMidiNotes } from "./chords.js";

// Small seeded generator so a test strum is the same every run.
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One plucked string. decay sets how long it rings (closer to 1 rings longer).
// Loop: y[i] = burst[i] + decay * average(z[i], z[i-1]), z = y delayed by (period - 0.5) samples with linear
// interpolation. The average adds half a sample, so the loop is exactly one period long and the pitch is freqHz.
export function pluck(freqHz, sampleRate, seconds, decay, random) {
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  const period = sampleRate / freqHz;
  const delay = period - 0.5;
  const d0 = Math.floor(delay);
  const f = delay - d0;
  const burst = Math.round(period);
  const at = (i) => (i >= 0 ? out[i] : 0);
  let zPrev = 0;
  for (let i = 0; i < out.length; i++) {
    const z = (1 - f) * at(i - d0) + f * at(i - d0 - 1);
    const excite = i < burst ? random() * 2 - 1 : 0;
    out[i] = excite + decay * 0.5 * (z + zPrev);
    zPrev = z;
  }
  return out;
}

// A downstroke across the shape's strings, low to high, staggerMs apart.
// detuneCents shifts every string (the out-of-tune case).
export function strum(shape, sampleRate, options) {
  const { seconds, staggerMs, decay, detuneCents, seed } = options;
  const random = seededRandom(seed);
  const notes = shapeMidiNotes(shape);
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  notes.forEach((midi, i) => {
    const hz = 440 * Math.pow(2, (midi - 69 + detuneCents / 100) / 12);
    const start = Math.floor((i * staggerMs * sampleRate) / 1000);
    const string = pluck(hz, sampleRate, seconds, decay, random);
    for (let j = 0; j + start < out.length; j++) {
      out[j + start] += string[j] / notes.length;
    }
  });
  return out;
}
