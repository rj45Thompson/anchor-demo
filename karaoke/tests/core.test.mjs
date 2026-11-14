// Tests for the pure functions in js/pitch.js and js/phrases.js.
// No browser, no mic: tones are synthesised, so this runs anywhere Node does.
//   node karaoke/tests/core.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectPitch, foldSemitones, hzToMidi, midiToHz, noteName } from "../js/pitch.js";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, "..", "config.json"), "utf8"));
// app.js builds this same object in init(); keep the two in step.
const options = {
  pitchMinHz: cfg.pitchMinHz,
  pitchMaxHz: cfg.pitchMaxHz,
  yinThreshold: cfg.yinThreshold,
  minRms: cfg.minRms,
  window: cfg.pitchWindow,
};

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; } else { failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
function near(name, got, want, tol, unit = "") {
  check(name, got !== null && Math.abs(got - want) <= tol,
    `got ${got === null ? "null" : got.toFixed(3)}${unit}, wanted ${want.toFixed(3)}${unit} +/-${tol}${unit}`);
}

// A voice-like tone: fundamental plus decaying harmonics, which is what YIN is built for.
function tone(hz, sampleRate, length, amp = 0.3, harmonics = 5) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let v = 0;
    for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * hz * h * (i / sampleRate)) / h;
    out[i] = amp * v;
  }
  return out;
}

const RATES = [44100, 48000];
// Across the configured 80-1000 Hz range, low notes to high.
const NOTES = [
  ["G2", 98.00], ["D3", 146.83], ["A3", 220.00], ["C4", 261.63],
  ["A4", 440.00], ["E5", 659.25], ["A5", 880.00],
];

for (const rate of RATES) {
  for (const [label, hz] of NOTES) {
    const got = detectPitch(tone(hz, rate, 4096), rate, options);
    // Within a fifth of a semitone - well inside the 0.75 semitone judging tolerance.
    const tol = hz * (Math.pow(2, 0.2 / 12) - 1);
    near(`detect ${label} @${rate}Hz`, got, hz, tol, "Hz");
  }
}

// Silence and near-silence are not notes (A6), and no-mic frames are not either (A4).
check("silence -> null", detectPitch(new Float32Array(4096), 48000, options) === null);
check("below minRms -> null",
  detectPitch(tone(440, 48000, 4096, cfg.minRms / 4), 48000, options) === null);
check("too few samples -> null", detectPitch(tone(440, 48000, 256), 48000, options) === null);

// Loud white noise has no clear period; it must not be reported as a confident note.
const noise = new Float32Array(4096);
let seed = 12345;
for (let i = 0; i < noise.length; i++) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  noise[i] = (seed / 0x7fffffff) * 2 - 1;
}
const noiseHz = detectPitch(noise, 48000, options);
check("noise -> null or in-range", noiseHz === null || (noiseHz >= cfg.pitchMinHz && noiseHz <= cfg.pitchMaxHz),
  `got ${noiseHz}`);

// Note maths.
near("hzToMidi(440) = 69", hzToMidi(440), 69, 1e-9);
near("midiToHz(69) = 440", midiToHz(69), 440, 1e-9);
near("hz/midi round trip @ 329.63", midiToHz(hzToMidi(329.63)), 329.63, 1e-6);
check("noteName(69) = A4", noteName(69) === "A4", `got ${noteName(69)}`);
check("noteName(60) = C4", noteName(60) === "C4", `got ${noteName(60)}`);
check("noteName(61) = C#4", noteName(61) === "C#4", `got ${noteName(61)}`);
check("noteName(59) = B3", noteName(59) === "B3", `got ${noteName(59)}`);

// Octave folding: an octave out is in tune for this check (S9).
check("fold(13) = 1", foldSemitones(13) === 1, `got ${foldSemitones(13)}`);
check("fold(-11) = 1", foldSemitones(-11) === 1, `got ${foldSemitones(-11)}`);
check("fold(0) = 0", foldSemitones(0) === 0);
check("fold(12) = 0", foldSemitones(12) === 0, `got ${foldSemitones(12)}`);
check("fold(6) = 6", foldSemitones(6) === 6, `got ${foldSemitones(6)}`);
check("fold(7) = -5", foldSemitones(7) === -5, `got ${foldSemitones(7)}`);
check("fold stays in (-6,6]", [...Array(60)].every((_, i) => {
  const f = foldSemitones(i - 30);
  return f > -6 && f <= 6;
}));

// An octave error would still pass the judging tolerance after folding, so check it directly.
const a4 = detectPitch(tone(440, 48000, 4096), 48000, options);
check("no octave error on A4", a4 !== null && Math.abs(hzToMidi(a4) - 69) < 0.5,
  `got midi ${a4 === null ? "null" : hzToMidi(a4).toFixed(2)}`);

console.log(`${pass + failures.length} checks, ${failures.length} failed.`);
for (const f of failures) console.log(`FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
