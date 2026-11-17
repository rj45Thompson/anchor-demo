// The scene: game state turned into two flat instance buffers, one of quads and one
// of lines. Both backends (gpu.js, gl.js) draw the same buffers, so WebGPU and
// WebGL 2 show the same picture.
// Pure functions, no browser APIs (tests/scene.test.mjs).
import { LANE_COLORS } from "./input.js";
import { beatSeconds, gemsInView } from "./chart.js";
import { STAR_NEEDED } from "./scoring.js";
import { notesInView } from "./vocals.js";

// The highway, in world units.
export const LANE_WIDTH = 0.95;
export const SPEED = 15;          // world units a second of chart travels
export const VIEW_AHEAD = 2.3;    // seconds of chart drawn ahead of the hit line
export const VIEW_BEHIND = 0.35;  // and how far past it, so a hit is seen to land
export const HIT_Y = 0.02;        // gems float just clear of the surface
// The singer gets a band of their own above the highway, rather than a ribbon down
// it: anything standing at x = 0 runs through the middle of everyone else's view.
// Time runs left to right across the band and pitch sets the height, so the guitars
// keep the lanes and the singer keeps the band.
export const VOCAL_PANEL = { z: -4.6, halfX: 3.2, yLow: 2.85, yHigh: 4.15 };

// Quad styles, read by the fragment shader.
export const STYLE = { flat: 0, gem: 1, ring: 2, glow: 3, bar: 4 };

export const QUAD_FLOATS = 14;    // centre3, right3, up3, colour3, glow, style
export const LINE_FLOATS = 11;    // a3, b3, colour3, width, glow

// Where a gem at chart time `gt` sits when the song is at `now`. The hit line is
// z = 0 and the chart comes in from -z.
export function zFor(gt, now) {
  return -(gt - now) * SPEED;
}

// The z the view actually covers. Anything drawn with length down the track has to be
// clipped to this: a note that has part-passed otherwise spans from behind the camera
// to far ahead, and the quad is drawn straight through the viewer.
export const NEAR_Z = VIEW_BEHIND * SPEED;
export const FAR_Z = -VIEW_AHEAD * SPEED;
export function clampZ(z) {
  return Math.max(FAR_Z, Math.min(NEAR_Z, z));
}

export function laneX(lane, lanes) {
  return (lane - (lanes - 1) / 2) * LANE_WIDTH;
}

class List {
  constructor(stride, capacity = 512) {
    this.stride = stride;
    this.data = new Float32Array(stride * capacity);
    this.count = 0;
  }
  reset() { this.count = 0; }
  // Grows by doubling; a chart only ever needs this on the first busy frame.
  room() {
    if ((this.count + 1) * this.stride <= this.data.length) return;
    const bigger = new Float32Array(this.data.length * 2);
    bigger.set(this.data);
    this.data = bigger;
  }
  at(i) { return this.data.subarray(i * this.stride, (i + 1) * this.stride); }
  get bytes() { return this.data.subarray(0, this.count * this.stride); }
}

export class Scene {
  constructor() {
    this.quads = new List(QUAD_FLOATS);
    this.lines = new List(LINE_FLOATS, 1024);
  }
  reset() { this.quads.reset(); this.lines.reset(); }

  quad(cx, cy, cz, rx, ry, rz, ux, uy, uz, r, g, b, glow, style) {
    const L = this.quads; L.room();
    const o = L.count * QUAD_FLOATS, d = L.data;
    d[o] = cx; d[o + 1] = cy; d[o + 2] = cz;
    d[o + 3] = rx; d[o + 4] = ry; d[o + 5] = rz;
    d[o + 6] = ux; d[o + 7] = uy; d[o + 8] = uz;
    d[o + 9] = r; d[o + 10] = g; d[o + 11] = b;
    d[o + 12] = glow; d[o + 13] = style;
    L.count += 1;
  }
  // A quad lying flat on the highway, `halfW` across and `halfL` down the track.
  floorQuad(cx, cz, halfW, halfL, r, g, b, glow, style, y = HIT_Y) {
    this.quad(cx, y, cz, halfW, 0, 0, 0, 0, halfL, r, g, b, glow, style);
  }
  // A quad standing up facing the camera, for gems and flashes.
  faceQuad(cx, cy, cz, halfW, halfH, r, g, b, glow, style) {
    this.quad(cx, cy, cz, halfW, 0, 0, 0, halfH, 0, r, g, b, glow, style);
  }
  line(ax, ay, az, bx, by, bz, r, g, b, width, glow) {
    const L = this.lines; L.room();
    const o = L.count * LINE_FLOATS, d = L.data;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = az;
    d[o + 3] = bx; d[o + 4] = by; d[o + 5] = bz;
    d[o + 6] = r; d[o + 7] = g; d[o + 8] = b;
    d[o + 9] = width; d[o + 10] = glow;
    L.count += 1;
  }
}

// A stable pseudo-random number for the city, so the skyline is the same every run
// and the same in both backends.
function hash(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// The wireframe skyline either side of the highway, scrolling toward the camera. This
// is the flythrough: the song is a run through a city, not a flat chart.
export function addCity(scene, now, { lanes = 5, blocks = 26, spacing = 5.2, starLit = false } = {}) {
  const edge = laneX(lanes - 1, lanes) + LANE_WIDTH * 1.9;
  const travel = now * SPEED;
  const span = blocks * spacing;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < blocks; i++) {
      const seed = i * 7.3 + (side > 0 ? 101.5 : 0);
      // Each block holds its place in the city and comes round again behind us, so a
      // long song never runs out of town.
      const raw = i * spacing - (travel % span);
      const z = raw > spacing ? raw - span : raw;
      if (z > 12) continue;
      const depth = 1.1 + hash(seed) * 2.2;
      const w = 0.7 + hash(seed + 1) * 1.7;
      const h = 1.2 + hash(seed + 2) * 7.5;
      const x = side * (edge + 2.4 + hash(seed + 3) * 8);
      // Neon that leans to the lane colours, and goes gold under star power.
      const tint = LANE_COLORS[Math.floor(hash(seed + 4) * LANE_COLORS.length) % LANE_COLORS.length];
      const r = starLit ? 1.0 : tint[0] * 0.55 + 0.1;
      const g = starLit ? 0.85 : tint[1] * 0.55 + 0.1;
      const b = starLit ? 0.35 : tint[2] * 0.55 + 0.22;
      const glow = 0.5 + hash(seed + 5) * 0.5;
      const x0 = x - w, x1 = x + w, z0 = z - depth, z1 = z + depth;
      // Four uprights and the roof: a box in outline, which reads as a tower at speed.
      for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
        scene.line(cx, 0, cz, cx, h, cz, r, g, b, 1.1, glow);
      }
      scene.line(x0, h, z0, x1, h, z0, r, g, b, 1.1, glow);
      scene.line(x1, h, z0, x1, h, z1, r, g, b, 1.1, glow);
      scene.line(x1, h, z1, x0, h, z1, r, g, b, 1.1, glow);
      scene.line(x0, h, z1, x0, h, z0, r, g, b, 1.1, glow);
      // A lit band partway up, which gives the towers a sense of scale going past.
      const band = h * (0.35 + hash(seed + 6) * 0.3);
      scene.line(x0, band, z0, x1, band, z0, r, g, b, 2.0, glow * 1.5);
    }
  }
}

// The track itself: surface, lane edges, beat lines and the hit line.
export function addHighway(scene, song, now, { starLit = false } = {}) {
  const lanes = song.lanes;
  const halfW = (lanes * LANE_WIDTH) / 2;
  const farZ = zFor(now + VIEW_AHEAD, now);
  const nearZ = zFor(now - VIEW_BEHIND, now);
  const midZ = (farZ + nearZ) / 2;
  // The road, dark so the neon on top of it reads.
  scene.floorQuad(0, midZ, halfW, (nearZ - farZ) / 2, 0.025, 0.03, 0.07, 1, STYLE.flat, 0);

  // Lane edges, running the length of the view.
  for (let i = 0; i <= lanes; i++) {
    const x = laneX(i, lanes) - LANE_WIDTH / 2;
    scene.line(x, HIT_Y, farZ, x, HIT_Y, nearZ, 0.35, 0.45, 0.8, 1.0, 0.5);
  }
  // Beat lines, so the highway keeps time with the music.
  const beat = beatSeconds(song);
  const first = Math.ceil((now - VIEW_BEHIND) / beat);
  const last = Math.floor((now + VIEW_AHEAD) / beat);
  for (let b = first; b <= last; b++) {
    const bar = b % 4 === 0;
    const z = zFor(b * beat, now);
    scene.line(-halfW, HIT_Y, z, halfW, HIT_Y, z,
      bar ? 0.55 : 0.2, bar ? 0.6 : 0.26, bar ? 1.0 : 0.5, bar ? 2.4 : 1.2, bar ? 0.75 : 0.35);
  }
  // The hit line, where a gem has to be caught.
  const hr = starLit ? 1.0 : 0.85, hg = starLit ? 0.9 : 0.95, hb = starLit ? 0.4 : 1.0;
  scene.floorQuad(0, 0, halfW, 0.09, hr, hg, hb, 2.6, STYLE.bar);
}

// The fret targets at the hit line, one per lane, brighter while held.
export function addTargets(scene, song, held, { starLit = false } = {}) {
  const lanes = song.lanes;
  for (let lane = 0; lane < lanes; lane++) {
    const c = LANE_COLORS[lane % LANE_COLORS.length];
    const down = held.has(lane);
    const glow = down ? 3.2 : 0.85;
    const s = down ? 0.47 : 0.4;
    scene.faceQuad(laneX(lane, song.lanes), 0.3, 0.05, s, s,
      starLit ? Math.min(1, c[0] + 0.3) : c[0],
      starLit ? Math.min(1, c[1] + 0.25) : c[1],
      starLit ? c[2] * 0.6 : c[2], glow, STYLE.ring);
  }
}

// The gems coming down the lanes, with their sustain tails.
export function addGems(scene, song, gems, now, settled, { starLit = false } = {}) {
  const view = gemsInView(gems, now, VIEW_AHEAD, VIEW_BEHIND);
  for (const g of view) {
    if (settled && settled.has(g.id)) continue;      // caught or missed: stop drawing it
    const x = laneX(g.lane, song.lanes);
    const z = zFor(g.t, now);
    const c = LANE_COLORS[g.lane % LANE_COLORS.length];
    const r = starLit ? Math.min(1, c[0] + 0.35) : c[0];
    const gg = starLit ? Math.min(1, c[1] + 0.3) : c[1];
    const b = starLit ? c[2] * 0.5 : c[2];
    // The tail first, so the gem's head draws over it.
    if (g.len > 0) {
      const a = clampZ(z), bz = clampZ(zFor(g.t + g.len, now));
      if (Math.abs(a - bz) > 1e-4) {
        scene.floorQuad(x, (a + bz) / 2, LANE_WIDTH * 0.16, Math.abs(a - bz) / 2, r, gg, b, 1.5, STYLE.flat, HIT_Y + 0.01);
      }
    }
    // A chord draws wider, so two lanes at once read as one shape.
    const wide = g.chordSize > 1 ? 0.46 : 0.4;
    if (z > NEAR_Z) continue;                    // its head is past the camera
    scene.faceQuad(x, 0.3, z, wide, 0.33, r, gg, b, starLit ? 3.4 : 2.4, STYLE.gem);
  }
  return view.length;
}

// Flashes: a hit blooms at the hit line, a miss shows a dull bar. `effects` is a list
// of { lane, at, kind } the game appends to and trims.
export function addEffects(scene, song, effects, now, { life = 0.32 } = {}) {
  let drawn = 0;
  for (const e of effects) {
    const age = now - e.at;
    if (age < 0 || age > life) continue;
    const k = 1 - age / life;
    const x = laneX(e.lane, song.lanes);
    if (e.kind === "miss") {
      scene.faceQuad(x, 0.3, 0.06, 0.5, 0.06, 0.6, 0.12, 0.16, 1.6 * k, STYLE.bar);
    } else {
      const grow = 0.45 + (1 - k) * 0.85;
      const c = LANE_COLORS[e.lane % LANE_COLORS.length];
      scene.faceQuad(x, 0.3, 0.06, grow, grow, c[0], c[1], c[2], 3.5 * k * k, STYLE.glow);
    }
    drawn += 1;
  }
  return drawn;
}

// The singer's ribbon: the vocal line ahead, drawn above the highway, with a marker
// for what is actually coming out of the microphone.
export function addVocalRibbon(scene, song, vocalState, now) {
  if (!song.vocals.length) return 0;
  const P = VOCAL_PANEL;
  const t0 = now - 0.25, t1 = now + VIEW_AHEAD;
  const xOf = (t) => (-1 + (2 * (t - t0)) / (t1 - t0)) * P.halfX;
  const midis = song.vocals.map((n) => n.midi);
  const lo = Math.min(...midis) - 2, hi = Math.max(...midis) + 2;
  const yOf = (m) => P.yLow + ((m - lo) / Math.max(1, hi - lo)) * (P.yHigh - P.yLow);
  const midY = (P.yLow + P.yHigh) / 2, halfY = (P.yHigh - P.yLow) / 2;

  // The band itself, dark enough that the notes on it read.
  scene.faceQuad(0, midY, P.z, P.halfX + 0.25, halfY + 0.22, 0.05, 0.06, 0.15, 0.85, STYLE.flat);

  const notes = notesInView(song.vocals, now, VIEW_AHEAD, 0.25);
  for (const n of notes) {
    const a = Math.max(-P.halfX, xOf(n.t));
    const b = Math.min(P.halfX, xOf(n.end));
    if (b - a <= 1e-4) continue;
    const sungNow = vocalState && vocalState.target === n.midi && vocalState.sung !== null;
    const on = sungNow && Math.abs(vocalState.gap) <= 1.0;
    scene.faceQuad((a + b) / 2, yOf(n.midi), P.z + 0.01, (b - a) / 2, 0.07,
      on ? 0.3 : 0.7, on ? 1.0 : 0.5, on ? 0.6 : 0.95, on ? 2.8 : 1.2, STYLE.bar);
  }
  // Where the song is now, and where the voice actually is against it.
  scene.faceQuad(xOf(now), midY, P.z + 0.02, 0.022, halfY, 0.8, 0.85, 1.0, 1.6, STYLE.flat);
  if (vocalState && vocalState.sung !== null) {
    const good = vocalState.gap !== null && Math.abs(vocalState.gap) <= 1.0;
    scene.faceQuad(xOf(now), Math.max(P.yLow - 0.3, Math.min(P.yHigh + 0.3, yOf(vocalState.sung))),
      P.z + 0.03, 0.13, 0.13, good ? 0.5 : 1.0, good ? 1.0 : 0.6, good ? 0.7 : 0.3, 3.0, STYLE.glow);
  }
  return notes.length;
}

// The star-power meter, drawn as a bar floating over the track so a player can see it
// without looking away from the lanes.
export function addStarMeter(scene, song, seat, now) {
  const share = Math.min(1, seat.starCharge / STAR_NEEDED);
  const active = seat.starUntil > now;
  const halfW = (song.lanes * LANE_WIDTH) / 2;
  scene.faceQuad(0, 1.02, 0.4, halfW * 0.72, 0.045, 0.1, 0.12, 0.25, 0.9, STYLE.flat);
  if (share > 0 || active) {
    const w = halfW * 0.72 * (active ? 1 : share);
    scene.faceQuad(-halfW * 0.72 + w, 1.02, 0.41, w, 0.045,
      active ? 1.0 : 0.45, active ? 0.88 : 0.8, active ? 0.3 : 1.0, active ? 3.2 : 1.6, STYLE.flat);
  }
  return share;
}

// Builds the whole frame. `state` is what the game already holds, so the renderer
// keeps no copy of the game.
export function build(scene, state) {
  const { song, gems, now, held, settled, effects, vocalState, seat } = state;
  const starLit = !!(seat && seat.starUntil > now);
  scene.reset();
  addCity(scene, now, { lanes: song.lanes, starLit });
  addHighway(scene, song, now, { starLit });
  addGems(scene, song, gems, now, settled, { starLit });
  addTargets(scene, song, held || new Set(), { starLit });
  addEffects(scene, song, effects || [], now);
  addVocalRibbon(scene, song, vocalState, now);
  if (seat) addStarMeter(scene, song, seat, now);
  return scene;
}

// Where the camera sits. It eases back and lifts a little under star power, which is
// the cheapest way to make the music feel like it has opened up.
export function camera(song, now, { starLit = false } = {}) {
  const lift = starLit ? 0.55 : 0;
  const sway = Math.sin(now * 0.7) * 0.12;
  return {
    eye: [sway, 2.55 + lift, 5.4 + lift * 0.6],
    target: [sway * 0.3, 0.45, -11],
    up: [0, 1, 0],
    fov: (62 * Math.PI) / 180,
    near: 0.1,
    far: 260,
  };
}
