//   node jukebox/tests/chart.test.mjs
import { suite } from "./harness.mjs";
import { WINDOWS, beatSeconds, buildGems, gemsInView, nearestGem, parseSong, verdictFor } from "../js/chart.js";

const t = suite("chart");

const good = {
  title: "  Test  ", artist: "Nobody", bpm: 120, lanes: 5,
  guitar: [
    { t: 2, lanes: [0] },
    { t: 1, lanes: [1, 3], len: 0.5 },
    { t: 3, lanes: [4], len: 2 },
  ],
  vocals: [{ t: 1, end: 1.5, midi: 60 }],
  lyrics: [{ t: 1, text: "la" }],
};

// --- parseSong ---------------------------------------------------------------
const song = parseSong(good);
t.eq("title is trimmed", song.title, "Test");
t.eq("artist kept", song.artist, "Nobody");
t.eq("lanes kept", song.lanes, 5);
t.eq("guitar sorted by time", song.guitar[0].t, 1);
t.deep("chord lanes sorted", song.guitar[0].lanes, [1, 3]);
t.eq("missing len defaults to 0", song.guitar[1].len, 0);
// duration comes from the chart: the last gem at t=3 with a 2 s tail.
t.eq("duration spans the chart", song.duration, 5);
t.eq("lanes default to 5", parseSong({ ...good, lanes: undefined }).lanes, 5);
t.eq("a longer stated duration wins", parseSong({ ...good, duration: 90 }).duration, 90);
t.eq("a shorter stated duration is ignored", parseSong({ ...good, duration: 1 }).duration, 5);
t.eq("vocals optional", parseSong({ ...good, vocals: undefined }).vocals.length, 0);
t.eq("lyrics optional", parseSong({ ...good, lyrics: undefined }).lyrics.length, 0);

t.throws("rejects a non-object", () => parseSong(null), "JSON object");
t.throws("rejects an array", () => parseSong([]), "JSON object");
t.throws("rejects a blank title", () => parseSong({ ...good, title: "  " }), "title");
t.throws("rejects bpm 0", () => parseSong({ ...good, bpm: 0 }), "bpm");
t.throws("rejects absurd bpm", () => parseSong({ ...good, bpm: 10000 }), "bpm");
t.throws("rejects fractional lanes", () => parseSong({ ...good, lanes: 2.5 }), "lanes");
t.throws("rejects a missing guitar list", () => parseSong({ ...good, guitar: undefined }), "guitar");
t.throws("rejects a lane past the count", () => parseSong({ ...good, lanes: 3, guitar: [{ t: 0, lanes: [4] }] }), "outside");
t.throws("rejects a repeated lane", () => parseSong({ ...good, guitar: [{ t: 0, lanes: [1, 1] }] }), "twice");
t.throws("rejects an empty lane list", () => parseSong({ ...good, guitar: [{ t: 0, lanes: [] }] }), "non-empty");
t.throws("rejects a negative time", () => parseSong({ ...good, guitar: [{ t: -1, lanes: [0] }] }), '"t"');
t.throws("rejects a negative sustain", () => parseSong({ ...good, guitar: [{ t: 0, lanes: [0], len: -1 }] }), "len");
t.throws("rejects end before start in vocals", () => parseSong({ ...good, vocals: [{ t: 2, end: 1, midi: 60 }] }), "t < end");
t.throws("rejects midi out of range", () => parseSong({ ...good, vocals: [{ t: 0, end: 1, midi: 200 }] }), "midi");
t.throws("rejects a lyric with no text", () => parseSong({ ...good, lyrics: [{ t: 0 }] }), "lyric");

// --- buildGems ---------------------------------------------------------------
const gems = buildGems(song);
t.eq("a chord becomes one gem per lane", gems.length, 4);
t.check("gems are time-sorted", gems.every((g, i) => i === 0 || gems[i - 1].t <= g.t));
t.deep("ids run in time order", gems.map((g) => g.id), [0, 1, 2, 3]);
t.eq("chord size recorded", gems[0].chordSize, 2);
t.eq("a single note has chord size 1", gems[2].chordSize, 1);
t.check("the two chord gems share a chord id", gems[0].chord === gems[1].chord);
t.eq("sustain length carried", gems.find((g) => g.lane === 4).len, 2);

// --- gemsInView --------------------------------------------------------------
t.eq("nothing in view before the chart", gemsInView(gems, 0, 0.5, 0.5).length, 0);
t.eq("the look-ahead window selects", gemsInView(gems, 0, 1.0, 0.1).length, 2);
t.check("a sustain stays in view while it sounds",
  gemsInView(gems, 4.5, 0.1, 0.1).some((g) => g.lane === 4));
t.eq("a passed tap drops out of view", gemsInView(gems, 2.9, 0.05, 0.1).length, 0);

// --- nearestGem --------------------------------------------------------------
const open = () => true;
t.eq("finds the gem on its lane", nearestGem(gems, 0, 2.0, open).lane, 0);
t.eq("nothing on an empty lane", nearestGem(gems, 2, 2.0, open), null);
t.eq("nothing outside the window", nearestGem(gems, 0, 2.0 + WINDOWS.good + 0.01, open), null);
t.check("inside the window is found", nearestGem(gems, 0, 2.0 + WINDOWS.good - 0.001, open) !== null);
t.eq("isOpen can rule a gem out", nearestGem(gems, 0, 2.0, (g) => g.lane !== 0), null);
// Two gems on one lane close together: the nearer one wins whichever side it is on.
const pair = buildGems(parseSong({ ...good, guitar: [{ t: 1, lanes: [0] }, { t: 1.1, lanes: [0] }] }));
t.near("picks the nearer of two", nearestGem(pair, 0, 1.08, open).t, 1.1, 1e-9);
t.near("picks the nearer of two, other side", nearestGem(pair, 0, 1.02, open).t, 1.0, 1e-9);

// --- verdictFor --------------------------------------------------------------
t.eq("dead on is perfect", verdictFor(0), "perfect");
t.eq("perfect edge", verdictFor(WINDOWS.perfect), "perfect");
t.eq("just past perfect is great", verdictFor(WINDOWS.perfect + 1e-6), "great");
t.eq("great edge", verdictFor(-WINDOWS.great), "great");
t.eq("just past great is good", verdictFor(WINDOWS.great + 1e-6), "good");
t.eq("good edge", verdictFor(WINDOWS.good), "good");
t.eq("past good is a miss", verdictFor(WINDOWS.good + 1e-6), null);
t.check("windows widen in order", WINDOWS.perfect < WINDOWS.great && WINDOWS.great < WINDOWS.good);

t.near("beat seconds at 120 bpm", beatSeconds(song), 0.5, 1e-9);

t.done();
