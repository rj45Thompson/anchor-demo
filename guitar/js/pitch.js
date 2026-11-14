// Pitch detection (YIN) and note maths, copied from the karaoke singing check (D:/code/karaoke/web/js/pitch.js).
// Serves here: S3 (the tuner reads one plucked string).
// Pure functions, no browser APIs, so Node can test them (tests/core.test.mjs).

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteName(midi) {
  const rounded = Math.round(midi);
  return `${NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

// Octave folding: 13 and -11 both become 1. Returns a value in (-6, 6].
export function foldSemitones(semitones) {
  const mod = ((semitones % 12) + 12) % 12;
  return mod > 6 ? mod - 12 : mod;
}

// Returns the fundamental in Hz, or null when the frame is too quiet or has no clear period.
// `samples` is a Float32Array of time-domain samples. `options` comes from config.json (no defaults here).
export function detectPitch(samples, sampleRate, options) {
  const { pitchMinHz: minHz, pitchMaxHz: maxHz, yinThreshold: threshold, minRms, window } = options;
  const tauMin = Math.floor(sampleRate / maxHz);
  const tauMax = Math.ceil(sampleRate / minHz);
  const w = Math.min(window, samples.length - tauMax);
  if (w < tauMax) {
    return null;
  }

  let energy = 0;
  for (let j = 0; j < w; j++) {
    energy += samples[j] * samples[j];
  }
  if (Math.sqrt(energy / w) < minRms) {
    return null;
  }

  // Difference function d(tau) and its cumulative mean normalised form (YIN steps 2 and 3).
  const diff = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const d = samples[j] - samples[j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += diff[tau];
    cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }

  // First dip under the threshold, walked down to its local minimum (YIN step 4).
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      let bottom = tau;
      while (bottom + 1 <= tauMax && cmnd[bottom + 1] < cmnd[bottom]) {
        bottom++;
      }
      best = bottom;
      break;
    }
  }
  if (best < 0) {
    return null;
  }

  // Parabolic interpolation around the minimum (YIN step 5).
  let refined = best;
  if (best > 0 && best < tauMax) {
    const s0 = cmnd[best - 1];
    const s1 = cmnd[best];
    const s2 = cmnd[best + 1];
    const denom = 2 * (2 * s1 - s0 - s2);
    if (denom !== 0) {
      refined = best + (s2 - s0) / denom;
    }
  }
  return sampleRate / refined;
}
