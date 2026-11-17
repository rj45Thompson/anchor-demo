//   node jukebox/tests/audio.test.mjs
import { readFileSync } from "node:fs";
import { suite } from "./harness.mjs";
import { parseSong, beatSeconds } from "../js/chart.js";
import { backingBetween, eventsBetween, melodyBetween, midiToHz } from "../js/audio.js";

const t = suite("audio");
const song = parseSong(JSON.parse(readFileSync(new URL("../songs/neon-run.json", import.meta.url), "utf8")));
const beat = beatSeconds(song);

t.near("A4 is 440", midiToHz(69), 440, 1e-9);
t.near("an octave down halves it", midiToHz(57), 220, 1e-9);

// --- the backing band ---------------------------------------------------------
{
  const bar = backingBetween(song, 0, beat * 4);
  const kinds = bar.map((e) => e.kind);
  t.check("there is a kick", kinds.includes("kick"));
  t.check("there is a snare", kinds.includes("snare"));
  t.check("there are hats", kinds.filter((k) => k === "hat").length >= 4);
  t.check("there is a bass note", kinds.includes("bass"));
  t.check("events come out in time order", bar.every((e, i) => i === 0 || bar[i - 1].t <= e.t));
  t.check("every event is inside the window", bar.every((e) => e.t >= 0 && e.t < beat * 4));
  // The backbeat: kick on 1 and 3, snare on 2 and 4.
  const at = (b) => bar.filter((e) => Math.abs(e.t - b * beat) < 1e-6).map((e) => e.kind);
  t.check("kick on one", at(0).includes("kick"));
  t.check("snare on two", at(1).includes("snare"));
  t.check("kick on three", at(2).includes("kick"));
  t.check("snare on four", at(3).includes("snare"));
}
{
  // Windows tile: scheduling in slices must produce each event exactly once.
  const whole = backingBetween(song, 0, 10);
  let pieces = [];
  for (let x = 0; x < 10; x += 0.37) pieces = pieces.concat(backingBetween(song, x, Math.min(10, x + 0.37)));
  t.eq("slicing the timeline loses nothing", pieces.length, whole.length);
  t.eq("and duplicates nothing",
    pieces.map((e) => `${e.t.toFixed(6)}:${e.kind}`).sort().join("|"),
    whole.map((e) => `${e.t.toFixed(6)}:${e.kind}`).sort().join("|"));
}
t.eq("an empty window is empty", backingBetween(song, 2.0, 2.0).length, 0);
t.eq("before the song there is nothing to play", backingBetween(song, -5, -1).length, 0);

// --- the guitar line ----------------------------------------------------------
{
  const all = melodyBetween(song, 0, song.duration);
  t.eq("one lead note per strum", all.length, song.guitar.length);
  t.check("every lead note has a pitch", all.every((e) => Number.isFinite(e.midi)));
  t.check("every lead note has length", all.every((e) => e.len > 0));
  t.check("a chord sounds as one note, not a cluster",
    all.filter((e) => Math.abs(e.t - song.guitar.find((g) => g.lanes.length > 1).t) < 1e-9).length === 1);
  // The pitches are the ones the chart asks for.
  const first = song.guitar[0];
  t.eq("the lead follows the chart's pitch", all[0].midi, first.midi);
}
{
  let pieces = [];
  for (let x = 0; x < song.duration; x += 0.41) pieces = pieces.concat(melodyBetween(song, x, x + 0.41));
  t.eq("slicing the melody loses nothing", pieces.length, song.guitar.length);
}

// --- the two together ---------------------------------------------------------
{
  const win = eventsBetween(song, 4, 6);
  t.check("both band and guitar are in the window", win.some((e) => e.kind === "lead") && win.some((e) => e.kind === "kick" || e.kind === "hat"));
  t.check("sorted by time", win.every((e, i) => i === 0 || win[i - 1].t <= e.t));
  t.check("nothing escapes the window", win.every((e) => e.t >= 4 && e.t < 6));
}

t.done();
