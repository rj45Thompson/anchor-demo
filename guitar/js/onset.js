// Strum detection from the input level, read every hop.
// Serves: S6 (when the strum happened), A2 (no strum = nothing), A3 (room noise is not a strum),
// A8 (the page's own sound is ignored: app.js stops feeding levels while it plays).
// Pure: the caller passes levels and times; Node tests drive it with synthesised levels.

export class StrumDetector {
  // options: { riseRatio, floorRatio, refractoryMs } from config.js
  constructor(options) {
    this.options = options;
    this.floor = 0;
    this.average = 0;
    this.lastStrumMs = -Infinity;
  }

  // The measured room-noise level (RMS), from the first second with the mic on.
  setFloor(level) {
    this.floor = level;
  }

  // Returns true when this level is a new strum.
  push(level, timeMs) {
    const { riseRatio, floorRatio, refractoryMs } = this.options;
    const before = this.average;
    this.average = before * 0.8 + level * 0.2;
    const loudEnough = level > this.floor * floorRatio;
    const jumped = level > before * riseRatio;
    if (loudEnough && jumped && timeMs - this.lastStrumMs >= refractoryMs) {
      this.lastStrumMs = timeMs;
      return true;
    }
    return false;
  }
}
