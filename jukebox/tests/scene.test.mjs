//   node jukebox/tests/scene.test.mjs
import { suite } from "./harness.mjs";
import { buildGems, parseSong } from "../js/chart.js";
import { createPlay, seatOf, STAR_NEEDED } from "../js/scoring.js";
import { createVocals } from "../js/vocals.js";
import { transform, viewProjection } from "../js/mat4.js";
import {
  LANE_WIDTH, QUAD_FLOATS, SPEED, STYLE, Scene, VIEW_AHEAD,
  addCity, addEffects, addGems, addHighway, addStarMeter, addTargets, addVocalRibbon,
  build, camera, laneX, zFor,
} from "../js/scene.js";

const t = suite("scene");

const song = parseSong({
  title: "S", bpm: 120, lanes: 5,
  guitar: [
    { t: 1, lanes: [0] },
    { t: 1.5, lanes: [2, 4] },
    { t: 2, lanes: [1], len: 1 },
    { t: 30, lanes: [3] },          // far away, should never be in view early
  ],
  vocals: [{ t: 1, end: 1.5, midi: 60 }, { t: 1.6, end: 2.2, midi: 64 }],
});
const gems = buildGems(song);

// --- the maths ---------------------------------------------------------------
t.near("a gem at now sits on the hit line", zFor(5, 5), 0, 1e-12);
t.near("a gem a second out is SPEED away", zFor(6, 5), -SPEED, 1e-9);
t.check("a passed gem is behind the line", zFor(4, 5) > 0);
t.near("the middle lane of five is centred", laneX(2, 5), 0, 1e-9);
t.check("lanes run left to right", laneX(0, 5) < laneX(1, 5) && laneX(3, 5) < laneX(4, 5));
t.near("lanes are a lane width apart", laneX(1, 5) - laneX(0, 5), LANE_WIDTH, 1e-9);
t.near("an even lane count still centres", laneX(1, 4) + laneX(2, 4), 0, 1e-9);

// --- the buffers grow ---------------------------------------------------------
{
  const s = new Scene();
  const start = s.quads.data.length;
  for (let i = 0; i < start / QUAD_FLOATS + 50; i++) s.faceQuad(0, 0, 0, 1, 1, 1, 1, 1, 1, STYLE.gem);
  t.check("the quad buffer grew", s.quads.data.length > start);
  t.eq("every quad is counted", s.quads.count, start / QUAD_FLOATS + 50);
  t.eq("the slice is the right length", s.quads.bytes.length, s.quads.count * QUAD_FLOATS);
  s.reset();
  t.eq("reset empties it", s.quads.count, 0);
  t.check("but keeps the memory", s.quads.data.length > start);
}

// --- gems --------------------------------------------------------------------
{
  const s = new Scene();
  const drawn = addGems(s, song, gems, 1.0, null);
  t.check("the gems near the line are drawn", drawn >= 3);
  t.check("the far gem is not", drawn < gems.length);
  // The first gem is on lane 0 at the hit line.
  const q = s.quads.at(0);
  t.near("it sits on its lane", q[0], laneX(0, 5), 1e-6);
  t.near("and on the hit line", q[2], 0, 1e-6);
  t.eq("drawn as a gem", q[13], STYLE.gem);
}
{
  const s = new Scene();
  const settled = new Set(gems.filter((g) => g.t === 1).map((g) => g.id));
  addGems(s, song, gems, 1.0, settled);
  const xs = [];
  for (let i = 0; i < s.quads.count; i++) xs.push(s.quads.at(i)[0]);
  t.check("a settled gem is not drawn", !xs.some((x) => Math.abs(x - laneX(0, 5)) < 1e-6));
}
{
  // A sustain draws a tail as well as a head.
  const s = new Scene();
  addGems(s, song, gems.filter((g) => g.len > 0), 2.0, null);
  t.eq("a sustain is a tail and a head", s.quads.count, 2);
  const tail = s.quads.at(0), head = s.quads.at(1);
  t.eq("the tail lies flat", tail[8] !== 0 && tail[7] === 0, true);
  t.eq("the head stands up", head[7] !== 0, true);
  t.near("the tail reaches back up the track", tail[2], -SPEED * 0.5, 1e-5);
}
{
  // A chord draws wider than a single note.
  const s1 = new Scene(); addGems(s1, song, gems.filter((g) => g.chordSize === 1 && g.len === 0), 1.0, null);
  const s2 = new Scene(); addGems(s2, song, gems.filter((g) => g.chordSize > 1), 1.5, null);
  t.check("a chord gem is wider", s2.quads.at(0)[3] > s1.quads.at(0)[3]);
}

// --- highway, targets, effects ------------------------------------------------
{
  const s = new Scene();
  addHighway(s, song, 4.0);
  t.check("the road and the hit line are drawn", s.quads.count >= 2);
  t.check("lane edges and beat lines are drawn", s.lines.count >= song.lanes + 1);
  // At 120 bpm a beat is half a second, so the view holds a known number of them.
  const beats = s.lines.count - (song.lanes + 1);
  t.check("roughly one beat line every half second", beats >= 4 && beats <= 8, `got ${beats}`);
}
{
  const s = new Scene();
  addTargets(s, song, new Set([1]));
  t.eq("a target per lane", s.quads.count, song.lanes);
  const lit = s.quads.at(1), dark = s.quads.at(0);
  t.check("the held lane glows brighter", lit[12] > dark[12]);
  t.check("both are rings", lit[13] === STYLE.ring && dark[13] === STYLE.ring);
}
{
  const s = new Scene();
  const effects = [{ lane: 0, at: 1.0, kind: "hit" }, { lane: 1, at: 1.0, kind: "miss" }, { lane: 2, at: 0.0, kind: "hit" }];
  t.eq("fresh effects draw, stale ones do not", addEffects(s, song, effects, 1.05), 2);
  t.eq("nothing draws long after", addEffects(new Scene(), song, effects, 9), 0);
  t.eq("nothing draws before it happened", addEffects(new Scene(), song, [{ lane: 0, at: 5, kind: "hit" }], 1), 0);
}

// --- the city ----------------------------------------------------------------
{
  const a = new Scene(); addCity(a, 3.0);
  const b = new Scene(); addCity(b, 3.0);
  t.check("the city is drawn with lines", a.lines.count > 50);
  t.eq("the same moment gives the same city", a.lines.bytes.join(","), b.lines.bytes.join(","));
  const c = new Scene(); addCity(c, 3.5);
  t.check("a later moment moves it", a.lines.bytes.join(",") !== c.lines.bytes.join(","));
  // It stands either side of the highway, never on it.
  let onTrack = 0;
  for (let i = 0; i < a.lines.count; i++) {
    const l = a.lines.at(i);
    if (Math.abs(l[0]) < (song.lanes * LANE_WIDTH) / 2) onTrack += 1;
  }
  t.eq("no tower stands on the road", onTrack, 0);
  // It keeps going: a long way into the song there is still a city.
  const late = new Scene(); addCity(late, 600);
  t.check("the city does not run out", late.lines.count > 50);
}

// --- the vocal ribbon ---------------------------------------------------------
{
  const s = new Scene();
  t.eq("the ribbon draws the notes in view", addVocalRibbon(s, song, null, 1.0), 2);
  const quiet = new Scene();
  addVocalRibbon(quiet, song, { target: 60, sung: null, gap: null }, 1.0);
  const singing = new Scene();
  addVocalRibbon(singing, song, { target: 60, sung: 60, gap: 0 }, 1.0);
  t.check("the band stays clear of the fret lanes", (() => {
    for (let i = 0; i < singing.quads.count; i++) if (singing.quads.at(i)[1] < 2.5) return false;
    return true;
  })());
  t.check("singing adds the voice marker", singing.quads.count > quiet.quads.count);
  const flat = new Scene();
  addVocalRibbon(flat, song, { target: 60, sung: 55, gap: 5 }, 1.0);
  t.eq("the marker is drawn whether or not it is on pitch", flat.quads.count, singing.quads.count);
  const none = parseSong({ title: "N", bpm: 120, guitar: [{ t: 1, lanes: [0] }] });
  t.eq("a song with no vocal line draws no ribbon", addVocalRibbon(new Scene(), none, null, 1), 0);
}

// --- the star meter -----------------------------------------------------------
{
  const play = createPlay(song, gems, [{ id: 1, role: "guitar" }]);
  const seat = seatOf(play, 1);
  const empty = new Scene();
  t.eq("an empty meter reads zero", addStarMeter(empty, song, seat, 0), 0);
  seat.starCharge = STAR_NEEDED;
  const full = new Scene();
  t.eq("a full meter reads one", addStarMeter(full, song, seat, 0), 1);
  t.check("a full meter draws more than an empty one", full.quads.count > empty.quads.count);
}

// --- the whole frame ----------------------------------------------------------
{
  const play = createPlay(song, gems, [{ id: 1, role: "guitar" }]);
  const seat = seatOf(play, 1);
  const s = new Scene();
  const state = { song, gems, now: 1.2, held: new Set([0]), settled: new Set(), effects: [], vocalState: createVocals(song), seat };
  build(s, state);
  t.check("a frame has quads", s.quads.count > 5);
  t.check("a frame has lines", s.lines.count > 20);
  // Building twice at the same moment gives the same frame: no state leaks between frames.
  const again = new Scene();
  build(again, state);
  t.eq("a frame is reproducible", s.quads.bytes.join(","), again.quads.bytes.join(","));
  // Star power changes the look.
  seat.starUntil = 99;
  const lit = new Scene();
  build(lit, state);
  t.check("star power changes the frame", lit.quads.bytes.join(",") !== s.quads.bytes.join(","));
  seat.starUntil = 0;
  // Every style the shaders are asked for is one they know.
  const known = new Set(Object.values(STYLE));
  let bad = 0;
  for (let i = 0; i < s.quads.count; i++) if (!known.has(s.quads.at(i)[13])) bad += 1;
  t.eq("no quad asks for an unknown style", bad, 0);
  // No NaN anywhere: one would silently blank a draw call on the GPU.
  t.check("the quad buffer is all finite", s.quads.bytes.every(Number.isFinite));
  t.check("the line buffer is all finite", s.lines.bytes.every(Number.isFinite));
}

// --- the camera ---------------------------------------------------------------
{
  const c = camera(song, 1.0);
  t.check("the camera is behind the hit line", c.eye[2] > 0);
  t.check("and above the road", c.eye[1] > 0.5);
  t.check("looking down the track", c.target[2] < 0);
  const lit = camera(song, 1.0, { starLit: true });
  t.check("star power lifts the camera", lit.eye[1] > c.eye[1]);
  // The hit line and the furthest drawn gem are both on screen, in both depth ranges.
  for (const depth01 of [true, false]) {
    const vp = viewProjection(c.eye, c.target, c.up, c.fov, 16 / 9, c.near, c.far, depth01);
    const hit = transform(vp, [0, 0.3, 0]);
    t.check(`the hit line is on screen (depth01=${depth01})`,
      hit[3] > 0 && Math.abs(hit[0] / hit[3]) < 1 && Math.abs(hit[1] / hit[3]) < 1);
    const far = transform(vp, [0, 0.3, zFor(VIEW_AHEAD, 0)]);
    t.check(`the far end of the view is on screen (depth01=${depth01})`,
      far[3] > 0 && Math.abs(far[0] / far[3]) < 1 && Math.abs(far[1] / far[3]) < 1);
    // The outermost lane fits across.
    const edge = transform(vp, [laneX(4, 5), 0.3, 0]);
    t.check(`the outer lane fits on screen (depth01=${depth01})`, Math.abs(edge[0] / edge[3]) < 1);
  }
}

t.done();
