// What chord is sounding: FFT -> spectral peaks -> 12 note bars (chroma) -> best chord template.
// Serves: S6 (is the strum the chord), P3 (note bars and quiet notes), A1 (what was heard instead), A3 (too quiet),
// A6 (out of tune shows as a poor match).
// Pure functions, no browser APIs: the browser and the Node tests run the same code on the same samples.

import { NOTE_NAMES, candidateChords } from "./chords.js";

// In-place iterative radix-2 FFT. re and im are Float64Arrays of the same power-of-two length.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Hann-windowed magnitude spectrum of the last `size` samples (size is a power of two).
export function magnitudeSpectrum(samples, size) {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const offset = samples.length - size;
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    re[i] = (samples[offset + i] || 0) * w;
  }
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) {
    mag[k] = Math.hypot(re[k], im[k]);
  }
  return mag;
}

export function rms(samples, count) {
  const start = Math.max(0, samples.length - count);
  let sum = 0;
  for (let i = start; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (samples.length - start));
}

// Local maxima above relFloor of the loudest peak, frequency refined by a parabola through log magnitudes.
export function spectralPeaks(mag, sampleRate, size, options) {
  const { minHz, maxHz, peakRelFloor } = options;
  const lo = Math.max(2, Math.floor((minHz * size) / sampleRate));
  const hi = Math.min(mag.length - 2, Math.ceil((maxHz * size) / sampleRate));
  let top = 0;
  for (let k = lo; k <= hi; k++) {
    top = Math.max(top, mag[k]);
  }
  const peaks = [];
  if (top === 0) {
    return peaks;
  }
  for (let k = lo; k <= hi; k++) {
    if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] >= peakRelFloor * top) {
      const a = Math.log(mag[k - 1] + 1e-12);
      const b = Math.log(mag[k] + 1e-12);
      const c = Math.log(mag[k + 1] + 1e-12);
      const denom = a - 2 * b + c;
      const p = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      peaks.push({ hz: ((k + p) * sampleRate) / size, mag: mag[k] });
    }
  }
  return peaks;
}

// How far the whole sound sits off concert pitch, in semitones (-0.5..0.5): the magnitude-weighted circular mean of
// every peak's offset from its nearest note. A guitar tuned to itself but not to A440 is then still read right (A6).
export function tuningOffset(peaks) {
  let x = 0;
  let y = 0;
  for (const { hz, mag } of peaks) {
    const midi = 69 + 12 * Math.log2(hz / 440);
    const off = midi - Math.round(midi);
    const w = Math.sqrt(mag);
    x += w * Math.cos(2 * Math.PI * off);
    y += w * Math.sin(2 * Math.PI * off);
  }
  return x === 0 && y === 0 ? 0 : Math.atan2(y, x) / (2 * Math.PI);
}

// 12 note bars (index 0 = C). Each peak adds sqrt(magnitude) to its nearest note after the tuning offset is taken
// out, less the further it is off that note (a peak 50 cents off adds nothing). Largest bar = 1.
export function chromaFromPeaks(peaks) {
  const chroma = new Float64Array(12);
  const shift = tuningOffset(peaks);
  for (const { hz, mag } of peaks) {
    const midi = 69 + 12 * Math.log2(hz / 440) - shift;
    const nearest = Math.round(midi);
    const off = Math.abs(midi - nearest);
    const weight = Math.max(0, 1 - 2 * off);
    chroma[((nearest % 12) + 12) % 12] += Math.sqrt(mag) * weight;
  }
  const max = Math.max(...chroma);
  if (max > 0) {
    for (let i = 0; i < 12; i++) {
      chroma[i] /= max;
    }
  }
  return chroma;
}

// A plucked note puts energy on its harmonics too: h = 1..9 land 0, 12, 19, 24, 28, 31, 34, 36, 38 semitones up
// (h7 is the natural 7th: without it every bright note reads as a 7th chord).
const HARMONIC_SEMITONES = [0, 12, 19, 24, 28, 31, 34, 36, 38];

// Template note bars for a set of pitch classes, harmonics included. Weights come from the options (config).
export function chordTemplate(pcs, harmonicWeights) {
  const t = new Float64Array(12);
  for (const pc of pcs) {
    HARMONIC_SEMITONES.forEach((semi, h) => {
      t[(pc + semi) % 12] += harmonicWeights[h];
    });
  }
  return t;
}

// Cosine of the angle between two 12-bar vectors. The bars' overall length is loudness, which says nothing about
// which chord it is, so dropping it is the right comparison here.
export function similarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

let cachedCandidates = null;
let cachedWeightsKey = "";

// Ranks every candidate chord (24 triads plus the library's 7th chords) against the note bars.
// Returns [{ name, score }] best first.
export function rankChords(chroma, harmonicWeights) {
  const key = harmonicWeights.join(",");
  if (!cachedCandidates || key !== cachedWeightsKey) {
    cachedCandidates = candidateChords().map((c) => ({ ...c, template: chordTemplate(c.pcs, harmonicWeights) }));
    cachedWeightsKey = key;
  }
  return cachedCandidates
    .map((c) => ({ name: c.name, score: similarity(chroma, c.template) }))
    .sort((x, y) => y.score - x.score);
}

// Note bars for the last fftSize samples, or null when they are below the loudness floor (A3).
// before: the magnitude spectrum just before the strum, or null. ringSubtract of it is taken off first, so the last
// chord still ringing does not outvote the new one (S6 on a chord change).
export function analyse(samples, sampleRate, options, before) {
  if (rms(samples, options.fftSize) < options.minRms) {
    return null;
  }
  const mag = magnitudeSpectrum(samples, options.fftSize);
  if (before) {
    for (let k = 0; k < mag.length; k++) {
      mag[k] = Math.max(0, mag[k] - options.ringSubtract * before[k]);
    }
  }
  const peaks = spectralPeaks(mag, sampleRate, options.fftSize, options);
  return chromaFromPeaks(peaks);
}

// Average of several frames' note bars (frames after one strum), renormalised.
export function averageChroma(frames) {
  const sum = new Float64Array(12);
  for (const f of frames) {
    for (let i = 0; i < 12; i++) {
      sum[i] += f[i];
    }
  }
  const max = Math.max(...sum);
  if (max > 0) {
    for (let i = 0; i < 12; i++) {
      sum[i] /= max;
    }
  }
  return sum;
}

// The chord heard: the best-ranked candidate, if it clears the minimum score; otherwise null.
export function identify(chroma, options) {
  const ranked = rankChords(chroma, options.harmonicWeights);
  const best = ranked[0];
  return {
    name: best.score >= options.minScore ? best.name : null,
    score: best.score,
    runnerUp: ranked[1],
    ranked,
    chroma,
  };
}

// One strum, read two ways: as heard, and with the last chord's ring taken off (analyse's `before`). Taking it off
// helps when old strings still ring and hurts when a shared open string is struck again, so the reading that fits a
// chord better wins. Measured on all 210 chord changes (tests/core.test.mjs): damped 0 wrong; nothing damped, 2.
export function readStrum(plainFrames, ringOffFrames, options) {
  const a = plainFrames.length ? identify(averageChroma(plainFrames), options) : null;
  const b = ringOffFrames.length ? identify(averageChroma(ringOffFrames), options) : null;
  if (!a || !b) {
    return a || b;
  }
  return b.score > a.score ? b : a;
}

// The target chord's notes whose bars are under quietRatio of the loudest bar: a muted or missing string (P3).
export function quietNotes(chroma, pcs, quietRatio) {
  return pcs.filter((pc) => chroma[pc] < quietRatio).map((pc) => NOTE_NAMES[pc]);
}
