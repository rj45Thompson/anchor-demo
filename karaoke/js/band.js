// The backing band: drums on every beat, a bass note and a chord on every bar, from the song file (C3).
// Pure: it lists the sounds due in a time window, and app.js plays them. Serves: C3.
import { CHORD } from "./phrases.js";

const ROOTS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHAPES = { "": [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11] };

// The chord's notes, voiced from C3 up (the root is MIDI 48 to 59).
export function chordMidis(name) {
  const m = /^([A-G])([#b]?)(m7|maj7|m|7)?$/.exec(name);
  if (!m || !CHORD.test(name)) {
    throw new Error(`unknown chord "${name}"`);
  }
  const root = (ROOTS[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  return SHAPES[m[3] || ""].map((step) => 48 + root + step);
}

// When the band stops: the end of its last bar (4 beats a bar).
export function bandEnd(band) {
  return band.start + band.chords.length * 4 * (60 / band.bpm);
}

// The sounds due in [t0, t1): kick on beats 1 and 3, snare on 2 and 4, a hi-hat every half beat, and on beats
// 1 and 3 a bass note (the root, then the fifth); the chord sounds on beat 1 for the whole bar.
export function bandEvents(band, t0, t1) {
  const half = 30 / band.bpm;
  const total = band.chords.length * 8;
  const out = [];
  for (let h = Math.max(0, Math.ceil((t0 - band.start) / half - 1e-9)); h < total; h++) {
    const t = band.start + h * half;
    if (t >= t1) {
      break;
    }
    if (t < t0) {
      continue;
    }
    out.push({ t, kind: "hat" });
    if (h % 2 !== 0) {
      continue;
    }
    const beatInBar = (h / 2) % 4;
    const chord = chordMidis(band.chords[Math.floor(h / 8)]);
    out.push({ t, kind: beatInBar % 2 === 0 ? "kick" : "snare" });
    if (beatInBar === 0) {
      out.push({ t, kind: "chord", midis: chord, dur: 8 * half });
      out.push({ t, kind: "bass", midi: chord[0] - 12, dur: 4 * half });
    } else if (beatInBar === 2) {
      out.push({ t, kind: "bass", midi: chord[0] - 12 + 7, dur: 4 * half });
    }
  }
  return out;
}
