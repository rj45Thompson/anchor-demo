//   node jukebox/tests/scoring.test.mjs
import { suite } from "./harness.mjs";
import { POINTS, SUSTAIN_POINTS_PER_SECOND, WINDOWS, buildGems, parseSong } from "../js/chart.js";
import {
  MAX_MULTIPLIER, STAR_FACTOR, STAR_NEEDED, STAR_SECONDS,
  accuracy, activateStar, activeMultiplier, advance, createPlay, multiplierFor,
  press, release, seatOf, starReady, summary,
} from "../js/scoring.js";

const t = suite("scoring");

// A chart of taps on lane 0 every half second from 1 s, plus one sustain on lane 1.
function taps(count, { sustain = null } = {}) {
  const guitar = [];
  for (let i = 0; i < count; i++) guitar.push({ t: 1 + i * 0.5, lanes: [0] });
  if (sustain) guitar.push(sustain);
  return parseSong({ title: "T", bpm: 120, guitar });
}
function play(count, opts, seats = [{ id: 1, role: "guitar", name: "A" }]) {
  const song = taps(count, opts);
  return createPlay(song, buildGems(song), seats);
}

// --- multiplier ladder -------------------------------------------------------
t.eq("combo 0 is 1x", multiplierFor(0), 1);
t.eq("combo 9 is still 1x", multiplierFor(9), 1);
t.eq("combo 10 is 2x", multiplierFor(10), 2);
t.eq("combo 20 is 3x", multiplierFor(20), 3);
t.eq("combo 30 is 4x", multiplierFor(30), 4);
t.eq("combo 300 is capped", multiplierFor(300), MAX_MULTIPLIER);

// --- verdicts ----------------------------------------------------------------
{
  const p = play(4);
  t.eq("a dead-on press is perfect", press(p, 1, 0, 1.0).verdict, "perfect");
  t.eq("inside the great window", press(p, 1, 0, 1.5 + WINDOWS.great - 0.001).verdict, "great");
  t.eq("inside the good window", press(p, 1, 0, 2.0 + WINDOWS.good - 0.001).verdict, "good");
  const seat = seatOf(p, 1);
  t.eq("three hits counted", seat.hits.perfect + seat.hits.great + seat.hits.good, 3);
  t.eq("combo is three", seat.combo, 3);
}
{
  const p = play(4);
  const r = press(p, 1, 1, 1.0);          // lane 1 has nothing on it
  t.eq("an empty lane is no verdict", r.verdict, null);
  t.eq("and says why", r.reason, "nothing there");
  t.eq("it counts as an overpress", seatOf(p, 1).overpresses, 1);
}
{
  const p = play(4);
  press(p, 1, 0, 1.0);
  press(p, 1, 0, 1.0);                     // the same gem twice
  t.eq("a settled gem cannot be hit again", seatOf(p, 1).hits.perfect, 1);
  t.eq("the second press breaks the combo", seatOf(p, 1).combo, 0);
}

// --- scoring and the multiplier ---------------------------------------------
{
  const p = play(12);
  for (let i = 0; i < 9; i++) press(p, 1, 0, 1 + i * 0.5);
  const seat = seatOf(p, 1);
  t.eq("nine perfects at 1x", seat.score, 9 * POINTS.perfect);
  t.eq("still 1x at combo 9", activeMultiplier(p, seat), 1);
  press(p, 1, 0, 1 + 9 * 0.5);             // the tenth
  t.eq("the tenth note scores at 2x", seat.score, 9 * POINTS.perfect + 2 * POINTS.perfect);
  t.eq("multiplier is now 2x", activeMultiplier(p, seat), 2);
}
{
  const p = play(4);
  press(p, 1, 0, 1.0);
  press(p, 1, 0, 1.5);
  t.eq("combo climbs", seatOf(p, 1).combo, 2);
  press(p, 1, 1, 1.6);                     // overpress on an empty lane
  t.eq("an overpress resets the combo", seatOf(p, 1).combo, 0);
  t.eq("but costs no points", seatOf(p, 1).score, 2 * POINTS.perfect);
  t.eq("best combo is remembered", seatOf(p, 1).bestCombo, 2);
}

// --- misses ------------------------------------------------------------------
{
  const p = play(4);
  advance(p, 1.0 + WINDOWS.good + 0.001);
  t.eq("a gem whose window closed is missed", seatOf(p, 1).hits.miss, 1);
  advance(p, 1.0 + WINDOWS.good + 0.002);
  t.eq("it is only missed once", seatOf(p, 1).hits.miss, 1);
  advance(p, 10);
  t.eq("the rest of the chart is missed too", seatOf(p, 1).hits.miss, 4);
  t.eq("combo is zero after misses", seatOf(p, 1).combo, 0);
}
{
  const p = play(4);
  press(p, 1, 0, 1.0);                     // hit the first
  advance(p, 10);
  t.eq("a hit gem is not also missed", seatOf(p, 1).hits.miss, 3);
  t.eq("the hit still counts", seatOf(p, 1).hits.perfect, 1);
}
t.eq("advance backwards does nothing", (() => {
  const p = play(4); advance(p, 5); const before = seatOf(p, 1).hits.miss;
  advance(p, 1); return seatOf(p, 1).hits.miss - before;
})(), 0);

// --- sustains ----------------------------------------------------------------
{
  const p = play(1, { sustain: { t: 1, lanes: [1], len: 2 } });
  t.eq("catching a sustain scores the hit", press(p, 1, 1, 1.0).verdict, "perfect");
  const seat = seatOf(p, 1);
  t.eq("hit points only, so far", seat.score, POINTS.perfect);
  advance(p, 2.0);
  t.near("a second held pays once", seat.score, POINTS.perfect + SUSTAIN_POINTS_PER_SECOND, 1e-6);
  advance(p, 2.0);
  t.near("holding is not paid twice for the same second", seat.score, POINTS.perfect + SUSTAIN_POINTS_PER_SECOND, 1e-6);
  release(p, 1, 1, 2.5);
  t.near("releasing pays up to the release", seat.score, POINTS.perfect + 1.5 * SUSTAIN_POINTS_PER_SECOND, 1e-6);
  advance(p, 9);
  t.near("a released sustain stops paying", seat.score, POINTS.perfect + 1.5 * SUSTAIN_POINTS_PER_SECOND, 1e-6);
  t.near("seconds held are recorded", seat.sustainHeld, 1.5, 1e-6);
}
{
  const p = play(1, { sustain: { t: 1, lanes: [1], len: 2 } });
  press(p, 1, 1, 1.0);
  advance(p, 9);                            // never released, run past the end
  const seat = seatOf(p, 1);
  t.near("a sustain pays only to its end", seat.score, POINTS.perfect + 2 * SUSTAIN_POINTS_PER_SECOND, 1e-6);
  t.eq("and is let go of", seat.holding.size, 0);
}

// --- star power --------------------------------------------------------------
{
  const p = play(40);
  const seat = seatOf(p, 1);
  t.eq("the meter starts empty", seat.starCharge, 0);
  t.eq("not ready yet", starReady(seat), false);
  t.eq("activating an empty meter does nothing", activateStar(p, 1, 1).started, false);
  for (let i = 0; i < STAR_NEEDED; i++) press(p, 1, 0, 1 + i * 0.5);
  t.eq("perfect hits fill the meter", seat.starCharge, STAR_NEEDED);
  t.eq("ready now", starReady(seat), true);
  const before = activeMultiplier(p, seat);
  t.eq("activating spends it", activateStar(p, 1, p.time).started, true);
  t.eq("the meter empties", seat.starCharge, 0);
  t.eq("the multiplier doubles", activeMultiplier(p, seat), before * STAR_FACTOR);
  t.eq("it cannot be activated twice", activateStar(p, 1, p.time).started, false);
  advance(p, p.time + STAR_SECONDS + 0.01);
  t.eq("it runs out", activeMultiplier(p, seat), 1); // misses in between broke the combo
}
{
  // A miss does not charge the meter, so star power is earned by playing cleanly.
  const p = play(40);
  advance(p, 30);
  t.eq("misses charge nothing", seatOf(p, 1).starCharge, 0);
}

// --- roles, accuracy, summary ------------------------------------------------
{
  const p = play(4, {}, [{ id: 1, role: "guitar", name: "A" }, { id: 2, role: "vocals", name: "B" }]);
  t.eq("a vocal seat ignores frets", press(p, 2, 0, 1.0).verdict, null);
  t.eq("and says why", press(p, 2, 0, 1.0).reason, "not a guitar seat");
  advance(p, 10);
  t.eq("a vocal seat is never missed at for frets", seatOf(p, 2).hits.miss, 0);
}
t.throws("an unknown seat throws", () => seatOf(play(1), 99), "no seat");
t.throws("a repeated seat id throws", () => play(1, {}, [{ id: 1, role: "guitar" }, { id: 1, role: "guitar" }]), "twice");
t.throws("a bad role throws", () => play(1, {}, [{ id: 1, role: "drums" }]), "guitar or vocals");
{
  const p = play(4);
  press(p, 1, 0, 1.0); press(p, 1, 0, 1.5);
  advance(p, 10);
  const seat = seatOf(p, 1);
  t.near("accuracy is hits over judged", accuracy(seat, 4), 0.5, 1e-9);
}
{
  const p = play(4, {}, [{ id: 1, role: "guitar", name: "A" }, { id: 2, role: "guitar", name: "B" }]);
  press(p, 1, 0, 1.0);
  press(p, 2, 0, 1.0);
  press(p, 2, 0, 1.5);                      // B is ahead
  advance(p, 10);
  const rows = summary(p);
  t.eq("both seats appear", rows.length, 2);
  t.eq("the leader is first", rows[0].name, "B");
  t.check("scores are whole numbers", rows.every((r) => Number.isInteger(r.score)));
  t.eq("seats judge the same chart independently", rows[0].hits.perfect, 2);
  t.eq("and the other seat keeps its own tally", rows[1].hits.perfect, 1);
}

t.done();
