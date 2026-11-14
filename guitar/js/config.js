// Every tunable number in one place, each with where it came from.
// "synth-measured" = chosen from tests/chroma.test.mjs on synthesised strums; real-guitar values are NOT measured.

export const CONFIG = {
  analysis: {
    fftSize: 8192,            // 171 ms at 48 kHz: resolves 6 Hz, enough once peaks are interpolated (synth-measured)
    minHz: 70,                // just under low E (82.4 Hz)
    maxHz: 2000,              // harmonics above this add little (synth-measured)
    peakRelFloor: 0.04,       // peaks under 4% of the loudest are ignored (synth-measured)
    harmonicWeights: [1, 0.6, 0.45, 0.35, 0.25, 0.2, 0.15, 0.12, 0.1], // harmonics 1..9 (synth-measured)
    minScore: 0.8,            // below this the strum is "not a chord I know" (synth-measured)
    minRms: 0.004,            // absolute floor; the live floor is measured from room noise at start (A3)
    quietRatio: 0.2,          // a chord note under 20% of the loudest bar is named as quiet (P3)
    ringSubtract: 0.7,        // the second reading takes 70% of the pre-strum spectrum off (readStrum keeps the
                              // better fit). 210 changes, nothing damped: 50 wrong -> 2 (synth-measured)
  },
  strum: {
    hopMs: 20,                // how often the level is read
    riseRatio: 2.2,           // a strum: level jumps to 2.2x the recent average (synth-measured)
    floorRatio: 3,            // and to 3x the measured room-noise floor
    refractoryMs: 150,        // one strum per 150 ms at most
    judgeFromMs: 200,         // note bars are read from 200 ms after the strum (the old chord's ring has faded)
    judgeToMs: 500,           // to 500 ms after it: the verdict comes half a second after the strum
  },
  timing: {
    perfectMs: 120,           // S6 grades
    goodMs: 250,
    earlyMs: 250,             // a strum this early still counts for the chord
    lateFraction: 0.75,       // and up to 75% of the chord's length late (Keep time)
  },
  tuner: {                    // the same values tests/core.test.mjs checks each open string with (5 cents)
    pitchMinHz: 70,
    pitchMaxHz: 700,
    yinThreshold: 0.15,
    minRms: 0.01,
    window: 2048,
  },
  hands: {
    maxSamplesPerChord: 6,    // shapes remembered per chord (S7)
    matchRatio: 1.5,          // "clearly chord X": its distance x 1.5 is still under the nearest other chord's.
                              // NOT measured on a real hand; RJ's first session is the measurement.
  },
};
