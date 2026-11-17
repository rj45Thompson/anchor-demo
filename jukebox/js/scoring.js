// Scoring: what a press is worth, how the combo multiplier climbs, and when star
// power is ready. One play state holds every seat, because in this game all the
// guitar seats read the same chart and compete on the same gems.
// Pure functions, no browser APIs, so Node can test them (tests/scoring.test.mjs).
import { POINTS, SUSTAIN_POINTS_PER_SECOND, WINDOWS, nearestGem, verdictFor } from "./chart.js";

// Combo thresholds, in the Guitar Hero shape: every ten notes buys another
// multiplier, up to four.
export const MULTIPLIER_STEPS = [10, 20, 30];
export const MAX_MULTIPLIER = MULTIPLIER_STEPS.length + 1;
// Star power: perfect hits fill the meter, and spending it doubles the multiplier.
export const STAR_NEEDED = 25;
export const STAR_SECONDS = 8;
export const STAR_FACTOR = 2;

export function multiplierFor(combo) {
  let m = 1;
  for (const step of MULTIPLIER_STEPS) if (combo >= step) m += 1;
  return m;
}

function newSeat(id, role, name) {
  return {
    id, role, name,
    score: 0,
    combo: 0,
    bestCombo: 0,
    hits: { perfect: 0, great: 0, good: 0, miss: 0 },
    overpresses: 0,
    starCharge: 0,
    starUntil: 0,      // song time star power runs out, 0 when not active
    settled: new Set(), // gem ids this seat has finished with, hit or missed
    missCursor: 0,      // first gem whose window has not closed yet, so advance() is O(1) a frame
    holding: new Map(), // gem id -> song time its sustain was last paid up to
    sustainHeld: 0,     // seconds of sustain this seat has held, for the summary
    lastVerdict: null,  // what the HUD flashes
    lastVerdictAt: -1,
  };
}

export function createPlay(song, gems, seatConfigs) {
  const seats = new Map();
  for (const c of seatConfigs) {
    if (seats.has(c.id)) throw new Error(`seat ${c.id} is listed twice`);
    if (c.role !== "guitar" && c.role !== "vocals") throw new Error(`seat ${c.id}: role must be guitar or vocals`);
    seats.set(c.id, newSeat(c.id, c.role, c.name || `Player ${seats.size + 1}`));
  }
  return { song, gems, seats, time: 0, started: false };
}

export function seatOf(play, seatId) {
  const s = play.seats.get(seatId);
  if (!s) throw new Error(`no seat ${seatId}`);
  return s;
}

// The multiplier a seat is scoring at right now, star power included.
export function activeMultiplier(play, seat) {
  const base = multiplierFor(seat.combo);
  return seat.starUntil > play.time ? base * STAR_FACTOR : base;
}

// Credit a cleanly finished note: counts the verdict, climbs the combo, pays at the
// current multiplier and charges star power on a perfect. Shared by the fret lanes
// and by vocals.js, so there is one ladder in the game rather than two.
export function creditNote(play, seat, verdict) {
  seat.hits[verdict] += 1;
  seat.combo += 1;
  seat.bestCombo = Math.max(seat.bestCombo, seat.combo);
  const points = POINTS[verdict] * activeMultiplier(play, seat);
  seat.score += points;
  // Only a clean hit charges the meter, so star power is earned by playing well
  // rather than by mashing through a passage.
  if (verdict === "perfect" && seat.starCharge < STAR_NEEDED) seat.starCharge += 1;
  seat.lastVerdict = verdict;
  seat.lastVerdictAt = play.time;
  return points;
}

// Drop a seat's combo: a missed gem, an overpress, or a vocal phrase gone wrong.
export function failNote(seat, play) {
  seat.combo = 0;
  seat.lastVerdict = "miss";
  seat.lastVerdictAt = play.time;
}

// A seat pressed `lane` at song time `t`. Returns what happened, so the caller can
// flash the lane and play a sound without reading the state back.
export function press(play, seatId, lane, t) {
  const seat = seatOf(play, seatId);
  if (seat.role !== "guitar") return { verdict: null, reason: "not a guitar seat" };
  play.time = Math.max(play.time, t);
  const gem = nearestGem(play.gems, lane, t, (g) => !seat.settled.has(g.id));
  if (!gem) {
    // Pressing a lane with nothing on it breaks the combo. It is the genre's own
    // penalty and it is what stops mashing, but it costs no points.
    seat.overpresses += 1;
    failNote(seat, play);
    return { verdict: null, reason: "nothing there", lane };
  }
  const verdict = verdictFor(gem.t - t);
  if (!verdict) {
    seat.overpresses += 1;
    failNote(seat, play);
    return { verdict: null, reason: "outside the window", lane };
  }
  seat.settled.add(gem.id);
  const points = creditNote(play, seat, verdict);
  // A sustain starts paying from the moment it is caught, for as long as it is held.
  if (gem.len > 0) seat.holding.set(gem.id, Math.max(t, gem.t));
  return { verdict, gemId: gem.id, lane, points, combo: seat.combo, multiplier: activeMultiplier(play, seat), off: gem.t - t };
}

// A seat let go of `lane`. Any sustain it was holding on that lane stops paying.
export function release(play, seatId, lane, t) {
  const seat = seatOf(play, seatId);
  if (seat.role !== "guitar") return { ended: [] };
  play.time = Math.max(play.time, t);
  const ended = [];
  for (const [id, paidTo] of seat.holding) {
    const gem = play.gems[id];
    if (!gem || gem.lane !== lane) continue;
    paySustain(play, seat, gem, Math.min(t, gem.t + gem.len), paidTo);
    seat.holding.delete(id);
    ended.push(id);
  }
  return { ended };
}

function paySustain(play, seat, gem, upTo, paidTo) {
  const held = Math.max(0, Math.min(upTo, gem.t + gem.len) - paidTo);
  if (held <= 0) return 0;
  const points = held * SUSTAIN_POINTS_PER_SECOND * activeMultiplier(play, seat);
  seat.score += points;
  seat.sustainHeld += held;
  return points;
}

// Moves the clock to `t`: pays whatever sustains are still held, lets star power run
// out, and misses any gem whose window has closed untouched. Call it once a frame
// before drawing, and the state is correct even on a long frame or after a stall.
export function advance(play, t) {
  if (t < play.time) return { missed: [] };
  play.time = t;
  const missed = [];
  for (const seat of play.seats.values()) {
    if (seat.role !== "guitar") continue;
    for (const [id, paidTo] of [...seat.holding]) {
      const gem = play.gems[id];
      const end = gem.t + gem.len;
      paySustain(play, seat, gem, Math.min(t, end), paidTo);
      if (t >= end) seat.holding.delete(id);
      else seat.holding.set(id, Math.min(t, end));
    }
    // Gems are time-sorted, so the cursor only ever moves forward: everything
    // before it has closed, and the first gem at or after it still has a window.
    while (seat.missCursor < play.gems.length) {
      const gem = play.gems[seat.missCursor];
      if (gem.t > t - WINDOWS.good) break;
      if (!seat.settled.has(gem.id)) {
        seat.settled.add(gem.id);
        seat.hits.miss += 1;
        failNote(seat, play);
        missed.push({ seat: seat.id, gemId: gem.id });
      }
      seat.missCursor += 1;
    }
  }
  return { missed };
}

// Spend a full meter. Does nothing unless it is full and not already running, so the
// caller can wire it to a button without guarding.
export function activateStar(play, seatId, t) {
  const seat = seatOf(play, seatId);
  if (seat.starCharge < STAR_NEEDED || seat.starUntil > t) return { started: false };
  seat.starCharge = 0;
  seat.starUntil = t + STAR_SECONDS;
  return { started: true, until: seat.starUntil };
}

export function starReady(seat) {
  return seat.starCharge >= STAR_NEEDED;
}

// How much of the chart a seat caught, 0..1, which is what the results screen leads
// with. Sustain points are left out so the figure stays a share of notes.
export function accuracy(seat, totalGems) {
  const hit = seat.hits.perfect + seat.hits.great + seat.hits.good;
  const judged = hit + seat.hits.miss;
  if (judged === 0) return totalGems === 0 ? 1 : 0;
  return hit / judged;
}

export function summary(play) {
  const total = play.gems.length;
  return [...play.seats.values()]
    .map((seat) => ({
      id: seat.id,
      name: seat.name,
      role: seat.role,
      score: Math.round(seat.score),
      bestCombo: seat.bestCombo,
      hits: { ...seat.hits },
      overpresses: seat.overpresses,
      accuracy: accuracy(seat, total),
      sustainHeld: Math.round(seat.sustainHeld * 100) / 100,
    }))
    .sort((a, b) => b.score - a.score);
}
