// The chart: a song file turned into the gems that fly down the highway, plus the
// timing windows a hit is judged against.
// Pure functions, no browser APIs, so Node can test them (tests/chart.test.mjs).
//
// A song file looks like:
//   { "title", "artist", "bpm", "lanes": 5, "duration",
//     "guitar": [ { "t": 4.0, "lanes": [0, 2], "len": 0.75, "midi": 64 }, ... ],
//     "vocals": [ { "t": 4.0, "end": 4.5, "midi": 60 }, ... ],
//     "lyrics": [ { "t": 4.0, "text": "..." }, ... ] }
//
// `t` is seconds from the song's start, `lanes` the fret lanes a strum covers (a
// chord is more than one), and `len` the sustain in seconds (0 for a tap). `midi` is
// what the note actually sounds, so audio.js can play the tune the chart was written
// for; without it the lane decides the pitch and the chart is still playable.

// Judging windows, seconds either side of a gem's time. Generous on purpose: this
// is played on phones over a relay with ~128 ms of round trip, not on a plastic
// guitar wired to a console.
export const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.14 };
export const VERDICTS = ["perfect", "great", "good"];
// What each verdict is worth before the combo multiplier.
export const POINTS = { perfect: 50, great: 35, good: 20 };
// A sustain pays this per second held, at the current multiplier.
export const SUSTAIN_POINTS_PER_SECOND = 40;

// The verdict for being `off` seconds away from a gem, or null when that is a miss.
export function verdictFor(off) {
  const d = Math.abs(off);
  if (d <= WINDOWS.perfect) return "perfect";
  if (d <= WINDOWS.great) return "great";
  if (d <= WINDOWS.good) return "good";
  return null;
}

function fail(reason) {
  throw new Error(reason);
}

// Validates a song file and returns it normalised. Bad data throws with the reason
// and nothing is repaired, so a broken file never half-loads into a game.
export function parseSong(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) fail("the file must be a JSON object");
  if (typeof obj.title !== "string" || !obj.title.trim()) fail('"title" must be a non-empty string');
  const lanes = obj.lanes === undefined ? 5 : obj.lanes;
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > 6) fail('"lanes" must be a whole number from 1 to 6');
  if (typeof obj.bpm !== "number" || !(obj.bpm > 0) || obj.bpm > 400) fail('"bpm" must be a number above 0 and at most 400');
  if (!Array.isArray(obj.guitar)) fail('the file needs a "guitar" list (it may be empty)');
  if (obj.vocals !== undefined && !Array.isArray(obj.vocals)) fail('"vocals" must be a list when present');
  if (obj.lyrics !== undefined && !Array.isArray(obj.lyrics)) fail('"lyrics" must be a list when present');

  const guitar = obj.guitar.map((e, i) => {
    if (!e || typeof e !== "object") fail(`guitar ${i}: must be an object`);
    if (typeof e.t !== "number" || !(e.t >= 0)) fail(`guitar ${i}: "t" must be a number of 0 or more`);
    if (!Array.isArray(e.lanes) || e.lanes.length === 0) fail(`guitar ${i}: "lanes" must be a non-empty list`);
    const seen = new Set();
    for (const lane of e.lanes) {
      if (!Number.isInteger(lane) || lane < 0 || lane >= lanes) fail(`guitar ${i}: lane ${lane} is outside 0..${lanes - 1}`);
      if (seen.has(lane)) fail(`guitar ${i}: lane ${lane} is listed twice`);
      seen.add(lane);
    }
    const len = e.len === undefined ? 0 : e.len;
    if (typeof len !== "number" || !(len >= 0)) fail(`guitar ${i}: "len" must be a number of 0 or more`);
    let midi = null;
    if (e.midi !== undefined && e.midi !== null) {
      if (!Number.isInteger(e.midi) || e.midi < 0 || e.midi > 127) fail(`guitar ${i}: "midi" must be a whole 0..127`);
      midi = e.midi;
    }
    return { t: e.t, lanes: [...e.lanes].sort((a, b) => a - b), len, midi };
  });

  const vocals = (obj.vocals || []).map((n, i) => {
    if (!n || typeof n !== "object") fail(`vocal ${i}: must be an object`);
    if (typeof n.t !== "number" || typeof n.end !== "number" || !Number.isInteger(n.midi)) {
      fail(`vocal ${i}: needs numeric "t" and "end" and a whole "midi"`);
    }
    if (!(n.t >= 0 && n.t < n.end)) fail(`vocal ${i}: need 0 <= t < end`);
    if (n.midi < 0 || n.midi > 127) fail(`vocal ${i}: "midi" must be 0..127`);
    return { t: n.t, end: n.end, midi: n.midi };
  });

  const lyrics = (obj.lyrics || []).map((l, i) => {
    if (!l || typeof l.t !== "number" || !(l.t >= 0) || typeof l.text !== "string") {
      fail(`lyric ${i}: needs a time "t" of 0 or more and a string "text"`);
    }
    return { t: l.t, text: l.text };
  });

  guitar.sort((a, b) => a.t - b.t);
  vocals.sort((a, b) => a.t - b.t);
  lyrics.sort((a, b) => a.t - b.t);

  // The song runs to whatever the chart needs unless the file says it is longer.
  const charted = Math.max(
    0,
    ...guitar.map((e) => e.t + e.len),
    ...vocals.map((n) => n.end),
  );
  const duration = typeof obj.duration === "number" && obj.duration > charted ? obj.duration : charted;
  return {
    title: obj.title.trim(),
    artist: typeof obj.artist === "string" ? obj.artist.trim() : "",
    bpm: obj.bpm,
    lanes,
    duration,
    guitar,
    vocals,
    lyrics,
  };
}

// Expands the chart into one gem per lane per strum. Judging is per gem, so a
// chord pays for each lane you catch rather than all-or-nothing: kinder on a
// phone, and it keeps a near-miss on one finger from wiping the whole chord.
// Gems come back sorted by time, and each carries its chord's size so the
// renderer can draw chords as one bar.
export function buildGems(song) {
  const gems = [];
  song.guitar.forEach((e, index) => {
    for (const lane of e.lanes) {
      gems.push({
        id: gems.length,
        chord: index,
        chordSize: e.lanes.length,
        lane,
        t: e.t,
        len: e.len,
        midi: e.midi,
      });
    }
  });
  gems.sort((a, b) => a.t - b.t || a.lane - b.lane);
  // Re-id after sorting so ids run in time order; the play state indexes by id.
  gems.forEach((g, i) => { g.id = i; });
  return gems;
}

// The gems the camera can see: those between `behind` seconds past the hit line and
// `ahead` seconds before it. Linear over a time-sorted list, which is plenty for a
// chart of a few thousand gems and keeps the renderer free of its own index.
export function gemsInView(gems, t, ahead, behind) {
  const out = [];
  for (const g of gems) {
    if (g.t + g.len < t - behind) continue;
    if (g.t > t + ahead) break;
    out.push(g);
  }
  return out;
}

// The gem on `lane` nearest to `t` that is still judgeable, or null. `isOpen` lets
// the caller skip gems it has already settled without this module knowing the play
// state's shape.
export function nearestGem(gems, lane, t, isOpen) {
  let best = null;
  let bestOff = Infinity;
  for (const g of gems) {
    if (g.t - t > WINDOWS.good) break;        // sorted by time: nothing later can be nearer
    if (g.lane !== lane) continue;
    if (t - g.t > WINDOWS.good) continue;     // its window has closed
    if (!isOpen(g)) continue;
    const off = Math.abs(g.t - t);
    if (off < bestOff) { best = g; bestOff = off; }
  }
  return best;
}

// Seconds per beat, for drawing the beat lines that make the highway read as music.
export function beatSeconds(song) {
  return 60 / song.bpm;
}
