//   node jukebox/tests/vocals.test.mjs
import { suite } from "./harness.mjs";
import { midiToHz } from "../../karaoke/js/pitch.js";
import { POINTS, buildGems, parseSong } from "../js/chart.js";
import { createPlay, seatOf } from "../js/scoring.js";
import {
  TOLERANCE_SEMITONES, VERDICT_SHARE, VOCAL_POINTS_PER_SECOND,
  createVocals, feed, finish, gapTo, noteAt, notesInView, onPitch, verdictForShare,
} from "../js/vocals.js";

const t = suite("vocals");

const song = parseSong({
  title: "V", bpm: 120, guitar: [{ t: 1, lanes: [0] }],
  vocals: [{ t: 1, end: 1.5, midi: 60 }, { t: 2, end: 2.5, midi: 67 }],
});
const seats = [{ id: 1, role: "vocals", name: "Singer" }, { id: 2, role: "guitar", name: "Axe" }];
const fresh = () => {
  const play = createPlay(song, buildGems(song), seats);
  return { play, st: createVocals(song) };
};

// --- note lookup -------------------------------------------------------------
t.eq("the note sounding", noteAt(song.vocals, 1.2).midi, 60);
t.eq("the start is inclusive", noteAt(song.vocals, 1.0).midi, 60);
t.eq("the end is exclusive", noteAt(song.vocals, 1.5), null);
t.eq("a rest between notes", noteAt(song.vocals, 1.75), null);
t.eq("before the line", noteAt(song.vocals, 0), null);

// --- the pitch gap, with octave folding --------------------------------------
t.eq("dead on", gapTo(60, 60), 0);
t.eq("a semitone flat", gapTo(60, 59), 1);
t.eq("a semitone sharp", gapTo(60, 61), -1);
t.eq("an octave down is not wrong", gapTo(60, 48), 0);
t.eq("an octave up is not wrong", gapTo(60, 72), 0);
t.eq("two octaves is not wrong either", gapTo(60, 84), 0);
t.eq("a fifth out is a fifth out", gapTo(60, 67), 5);
t.check("the fold never exceeds a tritone", [...Array(49)].every((_, i) => Math.abs(gapTo(60, 36 + i)) <= 6));

t.eq("inside tolerance is on pitch", onPitch(60, 60.9), true);
t.eq("outside tolerance is not", onPitch(60, 61.5), false);
t.eq("an octave out is still on pitch", onPitch(60, 48.5), true);
t.eq("the tolerance edge counts", onPitch(60, 60 + TOLERANCE_SEMITONES), true);

// --- verdict from the share held ---------------------------------------------
t.eq("all of it is perfect", verdictForShare(1), "perfect");
t.eq("the perfect edge", verdictForShare(VERDICT_SHARE.perfect), "perfect");
t.eq("just under is great", verdictForShare(VERDICT_SHARE.perfect - 1e-9), "great");
t.eq("the good edge", verdictForShare(VERDICT_SHARE.good), "good");
t.eq("under the good share is a miss", verdictForShare(VERDICT_SHARE.good - 1e-9), null);
t.eq("silence is a miss", verdictForShare(0), null);

// --- feeding the microphone --------------------------------------------------
{
  const { play, st } = fresh();
  const seat = seatOf(play, 1);
  // Sing C4 right through the first note, then step off it so the note settles.
  for (const time of [1.0, 1.1, 1.2, 1.3, 1.4]) feed(st, play, 1, midiToHz(60), time);
  t.near("on-pitch seconds are paid as they are sung", seat.score, 0.4 * VOCAL_POINTS_PER_SECOND, 1e-6);
  t.eq("nothing is settled while the note sounds", seat.hits.perfect, 0);
  const out = feed(st, play, 1, null, 1.6);   // a rest: the note is over
  t.eq("the note settles on the rest", out.finished.verdict, "perfect");
  t.eq("and counts as a perfect", seat.hits.perfect, 1);
  t.eq("the combo climbs", seat.combo, 1);
  t.near("the hit pays on top of the held seconds", seat.score, 0.4 * VOCAL_POINTS_PER_SECOND + POINTS.perfect, 1e-6);
}
{
  const { play, st } = fresh();
  const seat = seatOf(play, 1);
  // Silence through the whole note: not singing is not the same as singing it right.
  for (const time of [1.0, 1.1, 1.2, 1.3, 1.4]) feed(st, play, 1, null, time);
  feed(st, play, 1, null, 1.6);
  t.eq("a note sung through silence is missed", seat.hits.miss, 1);
  t.eq("it pays nothing", seat.score, 0);
  t.eq("and breaks the combo", seat.combo, 0);
}
{
  const { play, st } = fresh();
  const seat = seatOf(play, 1);
  // Half on pitch, half a fifth out: over the good share, under great.
  for (const time of [1.0, 1.1, 1.2]) feed(st, play, 1, midiToHz(60), time);
  for (const time of [1.3, 1.4]) feed(st, play, 1, midiToHz(66), time);
  const out = feed(st, play, 1, null, 1.6);
  t.near("the share is what was held", out.finished.share, 0.5, 0.01);
  t.eq("half on pitch is a good", out.finished.verdict, "good");
  t.eq("counted as a good", seat.hits.good, 1);
}
{
  const { play, st } = fresh();
  const seat = seatOf(play, 1);
  // An octave below the written line scores as if it were written there.
  for (const time of [1.0, 1.1, 1.2, 1.3, 1.4]) feed(st, play, 1, midiToHz(48), time);
  feed(st, play, 1, null, 1.6);
  t.eq("singing it an octave down is a perfect", seat.hits.perfect, 1);
}
{
  const { play, st } = fresh();
  // Moving straight from one note to the next settles the first without a rest.
  for (const time of [1.0, 1.2, 1.4]) feed(st, play, 1, midiToHz(60), time);
  const out = feed(st, play, 1, midiToHz(67), 2.0);
  t.eq("the first note settles on the second", out.finished.verdict, "perfect");
  t.eq("and the second is now current", out.note.midi, 67);
}
{
  const { play, st } = fresh();
  const seat = seatOf(play, 1);
  // The song ends mid-note: finish() scores it rather than dropping it.
  for (const time of [1.0, 1.2, 1.4]) feed(st, play, 1, midiToHz(60), time);
  t.eq("not settled yet", seat.hits.perfect, 0);
  t.eq("finish settles the last note", finish(st, play, 1).verdict, "perfect");
  t.eq("now it counts", seat.hits.perfect, 1);
  t.eq("finishing twice does nothing", finish(st, play, 1), null);
}
{
  const { play, st } = fresh();
  t.eq("a guitar seat cannot sing", feed(st, play, 2, midiToHz(60), 1.0).ok, false);
  t.eq("and says why", feed(st, play, 2, midiToHz(60), 1.0).reason, "not a vocal seat");
  t.eq("an unknown seat is refused", feed(st, play, 99, null, 1).ok, false);
}
{
  // A rest pays nothing, however well it is sung.
  const { play, st } = fresh();
  feed(st, play, 1, midiToHz(60), 1.75);
  feed(st, play, 1, midiToHz(60), 1.85);
  t.eq("singing through a rest pays nothing", seatOf(play, 1).score, 0);
  t.eq("and there is no target", st.target, null);
}
{
  // The HUD fields.
  const { play, st } = fresh();
  feed(st, play, 1, midiToHz(60), 1.0);
  feed(st, play, 1, midiToHz(61), 1.1);
  t.eq("target is the written note", st.target, 60);
  t.near("gap says which way to move", st.gap, -1, 0.01);
  t.check("sung is a midi number", typeof st.sung === "number");
}

// --- what the ribbon draws ---------------------------------------------------
t.eq("notes in view ahead", notesInView(song.vocals, 1.0, 1.5, 0.2).length, 2);
t.eq("only the near one", notesInView(song.vocals, 1.0, 0.2, 0.2).length, 1);
t.eq("a note just passed is still in view", notesInView(song.vocals, 1.6, 0.1, 0.2).length, 1);
t.eq("nothing in view", notesInView(song.vocals, 10, 0.5, 0.5).length, 0);

t.done();
