// look.js - this game's own look: the palette, the materials and every procedural mesh the board is drawn with. Nothing here is read
// from another project: every shape is built in code from boxes, cylinders, cones and extruded outlines, and every colour below is
// AUTHORED for this game. The look (UC-L1, LOOK_UC_L1.md, 11-09: a cartoon castle-builder, no more laser look): a bright cartoon
// castle-builder - chunky rounded stone walls with lighter tops and the owner's cloth and pennants, bright tiled grass; only fire,
// sparks and the players' markers glow, never a wall.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mrt, diffuseColor } from 'three/tsl';

// ---------------------------------------------------------------- palette (AUTHORED)
// A player's colour is the view's, by slot (the model only knows slots 0..3). Four hues far apart on the wheel and far from the grass
// green, so a wall, a hero and a territory fill read as one owner at a glance. Round 3 (tools/colour_check.py): round 2's sky blue
// and violet were 5.9 delta E apart for a deuteranope (one colour) and the blue 21 from the sea; the yellow was pale on sand. Now a
// deeper blue, an orchid purple, a full gold: every pair at least 35.8 apart in normal, protan, deutan and tritan vision, every
// colour at least 54 from grass, sand and sea.
export const PLAYER_HEX = Object.freeze([0x1957ff, 0xff5e4d, 0xcc52c2, 0xffcc00]);
export const PLAYER_CSS = Object.freeze(['#1957ff', '#ff5e4d', '#cc52c2', '#ffcc00']);
export const PLAYER_COLOURS = PLAYER_HEX.map((h) => new THREE.Color(h));
// HUD text (round 4, HUDTEXT): P1's deeper blue read 2.9:1 as text on the navy card. A player's colour as TEXT on a dark panel is
// its lighter tint below (PLAYER_TEXT_CSS: the colour mixed toward white, AUTHORED t = 0.44, 0.16, 0.30, 0), and text drawn ON a
// player-colour fill (the hero tag, a joined seat card) is the ink that reads on that fill (PLAYER_INK_CSS: white on the blue,
// navy on the other three). HUD_PANEL_CSS is the card's planks and the foot panel. tools/colour_check.py reads all three from this file and
// fails under WCAG 4.5:1 for any player label, the panel taken over a WHITE backdrop (the brightest the scene can put behind it).
export const PLAYER_TEXT_CSS = Object.freeze(['#7ea1ff', '#ff7869', '#db86d4', '#ffcc00']);
export const PLAYER_INK_CSS = Object.freeze(['#ffffff', '#0a1828', '#0a1828', '#0a1828']);
export const HUD_PANEL_CSS = 'rgba(58,36,18,0.94)';                // UC-L1: dark planks (was a navy glass, rgba(10,26,44,0.9))
/** UC-L1 UI colours (AUTHORED): the stone frame round a panel (light at its top, dark at its foot), the planks (light, dark), the
 *  ink line round the chunky shapes, and the gold of the numerals and the chosen rows. app/style.css carries the same values. */
export const UI = Object.freeze({ stoneLight: '#cfc6b2', stoneDark: '#8c8372', woodLight: '#8a5a30', woodDark: '#4e2f16', ink: '#1c1410', gold: '#ffd24a' });
export const NEUTRAL_WALL = new THREE.Color(0xe9e4d6);        // a wall no player owns (a map's own wall)
export const ENEMY_SHOT = new THREE.Color(0xff8a2a);

export const C = Object.freeze({
  // the grass (UC-L1): a brighter, yellower lawn green than round 4's (0x7ccb5c / 0x5daf48 / 0x9bdb6a)
  sand: new THREE.Color(0xf2dca2), wetSand: new THREE.Color(0xd8bd7f), grass: new THREE.Color(0x86cf45), grassDark: new THREE.Color(0x6cc23a),
  grassLight: new THREE.Color(0xa2dc58), grassRoot: new THREE.Color(0x5aa944), grassTip: new THREE.Color(0xd2f08e),
  grassDry: new THREE.Color(0xb9d66a), grassDeep: new THREE.Color(0x3f9a4c), swamp: new THREE.Color(0x6f7d3c), seaBed: new THREE.Color(0x2a6d8a),
  shallow: new THREE.Color(0x3fd0d2), deep: new THREE.Color(0x1552a6), lagoon: new THREE.Color(0x8fe8d6), midSea: new THREE.Color(0x1e92c8), foam: new THREE.Color(0xffffff),
  stone: new THREE.Color(0xd9d2c3), stoneDark: new THREE.Color(0xa69d8c), roof: new THREE.Color(0x4a5a78), wood: new THREE.Color(0x9a6640),
  woodDark: new THREE.Color(0x6e4529), sail: new THREE.Color(0xfbf6ea), sailDark: new THREE.Color(0x9a9da6), iron: new THREE.Color(0x3b4048),
  leaf: new THREE.Color(0x3f9c4a), leafLight: new THREE.Color(0x63b955), rock: new THREE.Color(0x9a9a9e), rockDark: new THREE.Color(0x76767c),
  houseWall: new THREE.Color(0xf4ead2), houseRoof: new THREE.Color(0xc4553f), pit: new THREE.Color(0x2b1d17), ember: new THREE.Color(0xff6a1a),
  rubble: new THREE.Color(0xb3aa98), grave: new THREE.Color(0xbfc3c9), skin: new THREE.Color(0xf0c9a0), enemy: new THREE.Color(0x3d3f4c),
  enemyHelm: new THREE.Color(0xe6e0cf), banner: new THREE.Color(0x24262e),
  // UC-L1 stone walls: the sides a mid warm grey, the coping on top lighter, the mortar between stones dark; dirt paths and the
  // flowers dotted through the lawn (board.js BoardLook.makeLand); the pennants' poles and their gold knobs
  wallSide: new THREE.Color(0x9f9686), wallTop: new THREE.Color(0xe6dcc6), mortar: new THREE.Color(0x5e564c),
  path: new THREE.Color(0xd3b07a), flowerA: new THREE.Color(0xfff6e0), flowerB: new THREE.Color(0xffd84a), flowerC: new THREE.Color(0xff8fb8),
  pennantPole: new THREE.Color(0x7a5232), pennantKnob: new THREE.Color(0xf2c64a),
});

// AUTHORED (UC-L1, RJ 11-09 "maybe the main character is a little bit smaller too"): the hero's drawn height in squares, 0.7 of
// round 2's 1.9 (units.js draws the knight this tall; bombs.js puts the stun stars over it)
export const HERO_HEIGHT = 1.33;

// ---------------------------------------------------------------- light (AUTHORED)
// A warm low sun from the south-west (long shadows to the north-east read as 3D from the south-facing camera) and a cool sky fill
// that keeps the shadow side blue rather than black. Elevation in degrees above the horizon, azimuth from +x toward +z. The sea
// reflects the same sky (SKY.zenith, SKY.horizon) and glints toward the same sun.
export const SUN = Object.freeze({ color: 0xffe6c4, intensity: 3.1, elevation: 40, azimuth: 128 });
export const SKY = Object.freeze({ sky: 0xcfe8ff, ground: 0x6f8f5f, intensity: 0.95, zenith: new THREE.Color(0x5fa8ff), horizon: new THREE.Color(0xe4f4ff) });
/** The unit vector toward the sun (world space). */
export function sunDirection() {
  const el = THREE.MathUtils.degToRad(SUN.elevation), az = THREE.MathUtils.degToRad(SUN.azimuth);
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

// ---------------------------------------------------------------- materials
// Flat-shaded standard materials: the low-poly facets catch the light. One shared material per role; per-object tints use vertex
// colours (merged props) or instance colours (walls), so the draw-call count stays small.
export const mats = {
  vc: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, flatShading: true }),
};
/** Mark a material as one that GLOWS: its colour (with instance colours and opacity) is also written to the scene pass's `emissive`
 *  target, which is the ONLY thing the bloom reads (renderer.js). Everything lit by the sun writes black there, so a sunlit white
 *  wall never blooms; only what a material says glows does. */
export function glowing(mat) { mat.mrtNode = mrt({ emissive: diffuseColor }); return mat; }
/** A glowing colour: values above 1 (k = how hot), and written to the bloom's target. */
export const glow = (color, k) => glowing(new THREE.MeshBasicNodeMaterial({ color: color.clone().multiplyScalar(k) }));
/** A see-through material whose opacity an effect animates (it glows when k > 1). */
export const fade = (color, opacity, k = 1) => {
  const m = new THREE.MeshBasicNodeMaterial({ color: color.clone().multiplyScalar(k), transparent: true, opacity, depthWrite: false });
  return k > 1 ? glowing(m) : m;
};

// ---------------------------------------------------------------- geometry helpers
/** Paint every vertex of a geometry one colour (the merged props carry their colours this way). */
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const at = (geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return geo.applyMatrix4(m);
};
/** Merge painted parts into one geometry; a merge that fails is an error, never a partial mesh. */
function merge(parts, what) {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('look.js: the parts of "' + what + '" would not merge (attribute sets differ)');
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d, c) => paint(new THREE.BoxGeometry(w, h, d), c);
const cyl = (rt, rb, h, seg, c) => paint(new THREE.CylinderGeometry(rt, rb, h, seg), c);
const cone = (r, h, seg, c) => paint(new THREE.ConeGeometry(r, h, seg), c);
const ico = (r, detail, c) => paint(new THREE.IcosahedronGeometry(r, detail), c);

// ---------------------------------------------------------------- the board's props (unit = one square; y = 0 is the ground)
export function pitGeometry() {
  return merge([
    at(cyl(0.4, 0.42, 0.04, 10, C.rockDark), 0, 0.02, 0),
    at(cyl(0.3, 0.3, 0.05, 10, C.pit), 0, 0.03, 0),
  ], 'pit');
}
/** A broken wall block's rubble (graphics round 3: "wall rubble chunks that stay until rebuilt"): a heap of tumbled bricks the
 *  wall's own size and shades, two of them tipped up on end, a broken coping stone (white: board.js tints it with the owner's
 *  colour) and stone chips round the heap. It stands until the rules clear the square. All sizes AUTHORED. */
export function rubbleGeometry() {
  const st = C.stone, dk = C.stoneDark, white = new THREE.Color(0.95, 0.95, 0.95);
  return merge([
    at(box(0.34, 0.14, 0.2, st), -0.14, 0.07, -0.12, 0, 0.4),
    at(box(0.3, 0.13, 0.18, dk), 0.16, 0.065, 0.1, 0, -0.5),
    at(box(0.26, 0.12, 0.17, st.clone().multiplyScalar(0.9)), 0.02, 0.19, -0.02, 0.2, 1.2, 0.15),   // one on top of the heap
    at(box(0.18, 0.28, 0.14, dk), -0.24, 0.13, 0.18, 0.25, 0.3, -0.35),                            // tipped up on end
    at(box(0.15, 0.24, 0.13, st), 0.27, 0.11, -0.2, -0.3, 0.8, 0.3),
    at(box(0.3, 0.08, 0.22, white), 0.05, 0.05, 0.27, 0.12, -0.25, 0.08),                          // the broken coping stone
    at(box(0.08, 0.05, 0.07, dk), -0.36, 0.025, -0.3, 0, 0.6), at(box(0.07, 0.04, 0.06, st), 0.38, 0.02, 0.32, 0, 1.1),
    at(box(0.06, 0.04, 0.08, dk), 0.36, 0.02, -0.36, 0, 0.2), at(box(0.07, 0.05, 0.05, st), -0.32, 0.025, 0.37, 0, 2.0),
  ], 'rubble');
}
export function graveGeometry() {
  return merge([
    at(box(0.16, 0.24, 0.05, C.grave), -0.18, 0.12, 0),
    at(box(0.16, 0.2, 0.05, C.grave), 0.16, 0.1, 0.1, 0, 0.2),
    at(box(0.3, 0.03, 0.4, C.woodDark), 0, 0.015, 0),
  ], 'graveyard');
}
export function flagGeometry() {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.42, -0.09); s.lineTo(0, -0.2); s.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(s); g.translate(0.02, 0, 0);
  return g;
}
export function hammerGeometry() {
  return merge([at(cyl(0.02, 0.02, 0.36, 5, C.wood), 0, 0.18, 0), at(box(0.18, 0.09, 0.09, C.iron), 0, 0.36, 0)], 'hammer');
}
export function torchGeometry() {
  return merge([at(cyl(0.02, 0.025, 0.34, 5, C.wood), 0, 0.17, 0)], 'linstock');
}

/** Paint a geometry one colour (times shade(normal, position) per vertex when given) KEEPING its own normals, so a rounded stone
 *  stays round (paint() makes a geometry flat-faceted: its merge recomputes the normals). */
function paintSmooth(geo0, color, shade = null) {
  const geo = geo0.index ? geo0.toNonIndexed() : geo0;           // one form for every part (RoundedBoxGeometry is unindexed)
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count, a = new Float32Array(n * 3);
  const N = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const k = shade ? shade(N.fromBufferAttribute(nrm, i), P.fromBufferAttribute(pos, i)) : 1;
    a[i * 3] = color.r * k; a[i * 3 + 1] = color.g * k; a[i * 3 + 2] = color.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}
/** Merge smooth-painted parts, keeping each part's normals (no recompute: a rounded box's own normals are its roundness). */
function mergeSmooth(parts, what) {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('look.js: the parts of "' + what + '" would not merge (attribute sets differ)');
  return g;
}

/** A wall block (UC-L1, "chunky rounded stone blocks"): two courses of big, well rounded stones in an alternating bond (the lower
 *  course split east-west, the upper north-south, so a run of blocks reads as laid stone, never as one plastic slab) over a dark
 *  mortar core that shows in the soft grooves. Every stone is lit lighter where it faces up and darker underneath and toward the
 *  ground (vertex colours), so the block's sides read darker than its top. The coping on top is wallCapGeometry; the owner's cloth
 *  band and the contact shadow are wallTrimGeometry and wallShadowGeometry. Footprint w x w, height h - WALL_CAP_H; y = 0 is the
 *  ground. All sizes AUTHORED. */
export const WALL_CAP_H = 0.13;
/** A stone's vertex shade: lighter facing up, darker facing down, and darker toward the ground (AUTHORED strengths). */
const stoneShade = (top) => (n, p) => (1 + 0.14 * Math.max(0, n.y) - 0.22 * Math.max(0, -n.y)) * (0.8 + 0.2 * Math.min(1, p.y / top));
export function wallStoneGeometry(w, h) {
  const body = h - WALL_CAP_H, course = body / 2, gap = 0.03, r = 0.055, bw = w - 0.01;
  const shades = [1.0, 0.92, 0.97, 0.88].map((k) => C.wallSide.clone().multiplyScalar(k));
  const half = (bw - gap) / 2, o = (half + gap) / 2;
  // (RoundedBoxGeometry's segments: 1 here = three rows of faces per side, 108 triangles a stone; 2 was 300, and a 4-player board
  // holds ~400 blocks drawn twice a frame, shadow and colour: perf_battle measured 53 fps at 1080p with it)
  const stone = (sx, sy, sz, c, x, y, z) => paintSmooth(new RoundedBoxGeometry(sx, sy, sz, 1, r).translate(x, y, z), c, stoneShade(h));
  return mergeSmooth([
    paintSmooth(new RoundedBoxGeometry(w - 0.09, body + WALL_CAP_H * 0.5, w - 0.09, 1, 0.02).translate(0, (body + WALL_CAP_H * 0.5) / 2, 0), C.mortar),
    stone(half, course - gap, bw, shades[0], -o, course / 2, 0), stone(half, course - gap, bw, shades[1], o, course / 2, 0),
    stone(bw, course - gap, half, shades[2], 0, course * 1.5, -o), stone(bw, course - gap, half, shades[3], 0, course * 1.5, o),
  ], 'wall stone');
}
/** The coping on a wall block (UC-L1, "chunky rounded stone blocks with a lighter top"): four chunky cap stones, two by two (a big
 *  one, two middling, a small one: COPING_SPLIT), each
 *  well rounded over its edges and lit full on its top and much darker over its rim (capShade), so every stone shows its own bevel
 *  and the grooves between them the dark core below. Each stone has its own shade, height and size (COPING, AUTHORED, a hair apart);
 *  board.js turns each block a quarter turn by a hash of its square and tints it, so neighbouring blocks never repeat the same
 *  stones and the same board always lays the same ones (no flicker). White (the instance colour is the light top stone). Together
 *  they span CAP_SPAN, overhanging the body a little. From the near top-down REPAIR camera the coping IS the wall. */
export const CAP_SPAN = 0.93;                                  // AUTHORED: the coping's width in squares (the block's body is 0.9)
const capShade = (n) => 0.48 + 0.52 * Math.pow(Math.max(0, n.y), 4);
// per stone (x, z quadrant): its shade (r, g, b: a warm stone, a cool one, a sandy one, a dark one), height over WALL_CAP_H, and
// width and depth shrink (squares), so the four never read as one tile cut in a grid
// (kept light: a stone top in a castle's shadow must still read apart from the shadowed ground under it; at 0.79 the darkest stone
// did not, run_page walls_drawn 11-10)
const COPING = [[[1.06, 1.02, 0.95], 1.0, 0.0, 0.03], [[0.93, 0.95, 0.99], 1.18, 0.04, 0.01], [[1.0, 0.95, 0.87], 0.88, 0.015, 0.045], [[0.9, 0.89, 0.88], 1.1, 0.035, 0.022]];
// the joints between the four run COPING_SPLIT off the block's middle (along x one way, along z the other), so a big stone and a
// small one meet and the middle of every block is on a stone's flat top whatever its quarter turn: the page check (run_page.py
// walls_drawn) looks at that point, and a joint there showed the dark core either way (11-10: 77 of 78 drawn)
const COPING_SPLIT = 0.12;
export function wallCapGeometry(w, h) {
  const gap = 0.035, S = CAP_SPAN / 2, parts = [];
  const span = (k, split) => (k < 0 ? [-S, split - gap / 2] : [split + gap / 2, S]);   // a stone's extent along one axis
  COPING.forEach(([[r, g, b], hk, dw, dd], i) => {
    const [x0, x1] = span(i & 1 ? 1 : -1, COPING_SPLIT), [z0, z1] = span(i & 2 ? 1 : -1, -COPING_SPLIT);
    const ch = WALL_CAP_H * hk, y = h - WALL_CAP_H + ch / 2;
    parts.push(paintSmooth(new RoundedBoxGeometry(x1 - x0 - dw, ch, z1 - z0 - dd, 1, 0.06).translate((x0 + x1) / 2, y, (z0 + z1) / 2), new THREE.Color(r, g, b), capShade));
  });
  return mergeSmooth(parts, 'wall cap');
}
/** The owner's cloth round a wall block (UC-L1 "coloured cloth trim"): a band of cloth in the groove between the two courses of
 *  stone, standing a little proud of the stone on every side; white (the instance colour is the owner's colour). Four bars round
 *  the block, hollow: nothing of it stands where the stone is, so with the stone hidden the block's square shows the ground
 *  (run_page.py walls_drawn). */
// TRIM_SPAN: the band runs out to the square's edge, past the coping (CAP_SPAN), so from the near top-down REPAIR camera the cloth
// shows as a ring of the owner's colour round each block's coping (the band of the next block meets it)
export const TRIM_H = 0.075, TRIM_SPAN = 1.0;
export function wallTrimGeometry(w, h) {
  const y = (h - WALL_CAP_H) / 2, W2 = TRIM_SPAN, t = 0.07, white = new THREE.Color(1, 1, 1);
  const bar = (sx, sz, x, z) => paintSmooth(new THREE.BoxGeometry(sx, TRIM_H, sz).translate(x, y, z), white);   // 12 triangles a bar
  return mergeSmooth([bar(W2, t, 0, (W2 - t) / 2), bar(W2, t, 0, -(W2 - t) / 2), bar(t, W2 - 2 * t, (W2 - t) / 2, 0), bar(t, W2 - 2 * t, -(W2 - t) / 2, 0)], 'wall cloth');
}
/** The soft contact shadow under a wall block: a square a little bigger than the block, flat on the ground (its darkness is the
 *  material's, board.js: darkest under the block, gone at the edge), so a block sits ON the grass from every camera and in the low
 *  quality setting too (no ambient occlusion there). */
export const WALL_SHADOW = 1.32;                               // AUTHORED: the shadow square's side, in squares
export function wallShadowGeometry() { return new THREE.PlaneGeometry(WALL_SHADOW, WALL_SHADOW).rotateX(-Math.PI / 2); }

/** A block of the castle rise (CASTLE_RISE_UC.md UC-L8, render/rise.js): one chunky rounded stone block RISE_BLOCK_W across (the wall
 *  block's width, board.js WALL_W) and h tall, its base at y = 0. Its sides are the wall's warm grey and its top the coping's light
 *  stone, lit as the wall's stones are (stoneShade: lighter facing up, darker underneath and toward its foot, so the joint between two
 *  courses reads), so the courses read as laid stone and the risen top as a wall top from the near top-down REPAIR camera. The
 *  instance colour is its piece's stone shade; rise.js stretches a block to meet the next block of its own piece and scales it to a
 *  merlon and to the keep's blocks. 108 triangles: the wall's own stones' RoundedBoxGeometry at 1 segment. */
export const RISE_BLOCK_W = 0.9;
export function riseBlockGeometry(h) {
  const geo = new RoundedBoxGeometry(RISE_BLOCK_W, h, RISE_BLOCK_W, 1, 0.06).translate(0, h / 2, 0);
  const pos = geo.attributes.position, nrm = geo.attributes.normal, a = new Float32Array(pos.count * 3), shade = stoneShade(h);
  const N = new THREE.Vector3(), P = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    N.fromBufferAttribute(nrm, i); P.fromBufferAttribute(pos, i);
    c.copy(C.wallSide).lerp(C.wallTop, THREE.MathUtils.smoothstep(N.y, 0.45, 0.9)).multiplyScalar(shade(N, P));
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}
/** The owner's cloth round a rise block (UC-L8, as wallTrimGeometry is round a wall block): four bars RISE_CLOTH_H tall at the block's
 *  middle height, standing a little proud of it and out to the square's edge (TRIM_SPAN), so a course's bands meet from block to
 *  block; white (the instance colour is the owner's). */
export const RISE_CLOTH_H = 0.05;
export function riseClothGeometry(h) {
  const y = h / 2, W2 = TRIM_SPAN, t = 0.06, white = new THREE.Color(1, 1, 1);
  const bar = (sx, sz, x, z) => paintSmooth(new THREE.BoxGeometry(sx, RISE_CLOTH_H, sz).translate(x, y, z), white);
  return mergeSmooth([bar(W2, t, 0, (W2 - t) / 2), bar(W2, t, 0, -(W2 - t) / 2), bar(t, W2 - 2 * t, (W2 - t) / 2, 0), bar(t, W2 - 2 * t, -(W2 - t) / 2, 0)], 'rise cloth');
}

/** A METAL wall block (the shop's metal piece, six hits): riveted grey steel - a rounded steel slab with a dark seam round its
 *  middle and a row of rivets above and below it on every face. Same footprint and height as wallStoneGeometry (its coping is
 *  wallSteelCapGeometry). The steel stays grey (board.js tints it only by wear); the owner shows by the trim and the pennant. */
export const STEEL = new THREE.Color(0.6, 0.63, 0.68);
export function wallSteelGeometry(w, h) {
  const body = h - WALL_CAP_H, bw = w - 0.01, parts = [
    paintSmooth(new RoundedBoxGeometry(bw, body, bw, 1, 0.045).translate(0, body / 2, 0), STEEL, stoneShade(h)),
    paintSmooth(new RoundedBoxGeometry(bw + 0.014, 0.035, bw + 0.014, 1, 0.012).translate(0, body / 2, 0), STEEL.clone().multiplyScalar(0.42)),   // the seam
  ];
  const rivet = STEEL.clone().multiplyScalar(1.35), o = bw / 2 - 0.1;
  for (const y of [body * 0.24, body * 0.76]) for (const f of [0, 1, 2, 3]) for (const k of [-o, 0, o]) {
    const a = f * Math.PI / 2, nx = Math.cos(a), nz = Math.sin(a), tx = -nz, tz = nx;
    parts.push(paintSmooth(new THREE.SphereGeometry(0.032, 6, 4).translate(nx * bw / 2 + tx * k, y, nz * bw / 2 + tz * k), rivet, (n) => 0.8 + 0.3 * Math.max(0, n.y)));
  }
  return mergeSmooth(parts, 'wall steel');
}
/** The coping of a metal block: one riveted plate, white (the instance colour is the steel's), a rivet in each corner. */
export function wallSteelCapGeometry(w, h) {
  const y = h - WALL_CAP_H / 2, white = new THREE.Color(1, 1, 1), o = w / 2 - 0.1;
  const parts = [paintSmooth(new RoundedBoxGeometry(CAP_SPAN, WALL_CAP_H, CAP_SPAN, 1, 0.04).translate(0, y, 0), white.clone().multiplyScalar(0.9), (n) => 0.86 + 0.14 * Math.max(0, n.y))];
  for (const sx of [-o, o]) for (const sz of [-o, o]) parts.push(paintSmooth(new THREE.SphereGeometry(0.045, 8, 5).scale(1, 0.6, 1).translate(sx, h - 0.005, sz), white.clone().multiplyScalar(1.1)));
  return mergeSmooth(parts, 'wall steel cap');
}

/** The pennant on an owner's wall corner (UC-L1 "a coloured banner/pennant on the piece corner"): a wooden pole with a gold knob
 *  (pennantPoleGeometry, vertex colours) and a swallow-tailed flag (pennantFlagGeometry, white: the instance colour is the owner's;
 *  x runs along the flag from the pole, so the wind's wave grows toward its tail: board.js). y = 0 is the top of the block. */
export const PENNANT_POLE = 0.5, PENNANT_FLAG = 0.38, PENNANT_FLAG_H = 0.22;   // AUTHORED: pole height, flag length and height
export function pennantPoleGeometry() {
  return mergeSmooth([
    paintSmooth(new THREE.CylinderGeometry(0.018, 0.022, PENNANT_POLE, 6).translate(0, PENNANT_POLE / 2, 0), C.pennantPole),
    paintSmooth(new THREE.SphereGeometry(0.035, 8, 6).translate(0, PENNANT_POLE + 0.02, 0), C.pennantKnob),
  ], 'pennant pole');
}
export function pennantFlagGeometry() {
  const s = new THREE.Shape(), L = PENNANT_FLAG, H = PENNANT_FLAG_H;
  s.moveTo(0, 0); s.lineTo(L, 0.01); s.lineTo(L * 0.72, -H / 2); s.lineTo(L, -H - 0.01); s.lineTo(0, -H); s.lineTo(0, 0);
  return paintSmooth(new THREE.ShapeGeometry(s).translate(0.012, PENNANT_POLE - 0.02, 0), new THREE.Color(1, 1, 1));
}

/** A sand islet off the coast that a house stands on (UC-L1 scenery): a low round mound of sand with a grassy top, its top
 *  ISLET_TOP over the sea (board.js buildDecor puts the house's floor there). Sizes AUTHORED. */
export function isletGeometry() {
  return merge([
    at(cyl(1.2, 1.55, 0.5, 18, C.sand), 0, -0.13, 0),
    at(cyl(1.0, 1.12, 0.06, 18, C.grassLight), 0, 0.1, 0),
  ], 'islet');
}

/** A spike trap: a flat iron plate with a rim and nine spikes. The owner's colour is a separate ring (units/bombs.js). */
export function trapGeometry() {
  const iron = C.iron.clone().multiplyScalar(1.15), spike = new THREE.Color(0.78, 0.8, 0.84), parts = [
    at(cyl(0.4, 0.43, 0.06, 12, iron), 0, 0.03, 0),
    at(paint(new THREE.TorusGeometry(0.4, 0.025, 5, 16).rotateX(Math.PI / 2), iron.clone().multiplyScalar(1.4)), 0, 0.06, 0),
  ];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996, r = i === 0 ? 0 : 0.14 + 0.1 * (i % 3), x = Math.cos(a) * r, z = Math.sin(a) * r;
    parts.push(at(cone(0.055, 0.3, 5, spike), x, 0.2, z));
  }
  return merge(parts, 'trap');
}

/** A grass tuft: seven thin blades leaning out from one root, dark at the root and light at the tip (vertex colours), about a fifth of
 *  a square tall. y = 0 is the ground; the blades' height is TUFT_H (the sway in board.js bends them more toward the tip). */
export const TUFT_H = 0.24;
export function tuftGeometry() {
  const blades = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39996, lean = 0.3 + (i % 2) * 0.16, h = TUFT_H * (0.75 + ((i * 37) % 10) / 40);
    const g = new THREE.ConeGeometry(0.034, h, 3, 1).toNonIndexed(); g.translate(0, h / 2, 0);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      c.copy(C.grassRoot).lerp(C.grassTip, THREE.MathUtils.clamp(pos.getY(v) / h, 0, 1));
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
    blades.push(at(g, Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03, Math.sin(a) * lean, 0, -Math.cos(a) * lean));
  }
  return merge(blades, 'grass tuft');
}

// ---------------------------------------------------------------- deterministic noise for the land's relief and colour
// (render/noise.js: plain JavaScript, so the coast field and its tests use the same noise without three.js)
export { makeNoise } from './noise.js';

// ---------------------------------------------------------------- the noise texture the land and sea shaders sample
/** A tiling noise texture made in code once at start (no file): R = smooth fractal noise, G and B = its slope along x and y (0.5 =
 *  flat; the sea's waves are lit from these, so no shader works out a noise's slope itself), A = a second, finer noise. Sampling it
 *  costs the GPU a texture read where the shaders first evaluated 3D Perlin noise ten times per pixel of sea (11-09: twice the
 *  baseline's frame time at 3840 x 2160). NOISE_SLOPE: G and B hold slope / NOISE_SLOPE + 0.5. */
export const NOISE_SIZE = 256, NOISE_SLOPE = 24;
export function makeNoiseTexture() {
  const N = NOISE_SIZE;
  const lattice = (period, seed) => {                          // value noise on a period x period lattice that wraps, smoothstep blend
    const v = new Float32Array(period * period);
    let x = seed | 0;
    for (let i = 0; i < v.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) | 0; v[i] = (x >>> 8) / 16777216; }
    const s = (t) => t * t * (3 - 2 * t);
    return (u, w) => {                                          // u, w in 0..1 over the tile
      const fx = u * period, fy = w * period, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = s(fx - x0), ty = s(fy - y0);
      const a = v[(y0 % period) * period + (x0 % period)], b = v[(y0 % period) * period + ((x0 + 1) % period)];
      const c = v[((y0 + 1) % period) * period + (x0 % period)], d = v[((y0 + 1) % period) * period + ((x0 + 1) % period)];
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
  };
  const o1 = lattice(8, 11), o2 = lattice(16, 23), o3 = lattice(32, 37), f1 = lattice(32, 51), f2 = lattice(64, 67);
  const field = new Float32Array(N * N), fine = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, w = y / N;
    field[y * N + x] = o1(u, w) * 0.55 + o2(u, w) * 0.3 + o3(u, w) * 0.15;
    fine[y * N + x] = f1(u, w) * 0.6 + f2(u, w) * 0.4;
  }
  const data = new Uint8Array(N * N * 4), at = (x, y) => field[((y + N) % N) * N + ((x + N) % N)];
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, dx = (at(x + 1, y) - at(x - 1, y)) / 2 * N, dy = (at(x, y + 1) - at(x, y - 1)) / 2 * N;   // per tile
    data[i] = byte(field[y * N + x]); data[i + 1] = byte(dx / NOISE_SLOPE + 0.5); data[i + 2] = byte(dy / NOISE_SLOPE + 0.5); data[i + 3] = byte(fine[y * N + x]);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- instanced batches under the uniform-buffer limit
// three r175 (InstanceNode.setup, build/three.webgpu.js:13829) binds an InstancedMesh's WHOLE matrix array as a uniform buffer when
// the mesh's count is <= 1000 when its shader is first built, and WebGPU caps a uniform binding at 65536 bytes (1024 matrices). A
// mesh made with room for 1664 squares and drawn first with count 0 bound 106496 bytes and drew NOTHING (a black frame, a WebGPU
// validation warning each frame). So no InstancedMesh here ever has room for more than CHUNK instances: a big set is several meshes.
export const CHUNK = 1000;
// ...and that same line sizes the bound array by the mesh's count AT THAT FIRST BUILD (buffer(array, 'mat4', count)); the shader is
// cached per mesh (getMaterialCacheKey takes its uuid) and never rebuilt when count grows. Measured 11-09 (UC-P2): the wall batch's
// first build had 28 blocks (the castle rings), so every brick placed after it was drawn with no stone and no cap - only its
// outline - while the rules counted it: a ring the model called closed looked open on screen. So a mesh is BUILT at a room size
// (ROOM_MIN, doubling, at most CHUNK) and DRAWS that many instances (the ones past what is in use are scaled to nothing); when the
// set outgrows the room, the mesh is made again (a new uuid, so a new shader) with the next room size. roomFor(n) is that rule.
const ROOM_MIN = 64;
const NOTHING = new THREE.Matrix4().makeScale(0, 0, 0);
export function roomFor(n) { let r = ROOM_MIN; while (r < n) r *= 2; return Math.min(CHUNK, r); }
/** Keep a fixed-size InstancedMesh drawing its WHOLE capacity (its shader is built with it, so no later instance falls outside the
 *  bound array) with the instances from `used` on scaled to nothing. For the small meshes made once with their capacity (a ghost). */
export function drawAllRoom(im, used) {
  for (let k = used; k < im.instanceMatrix.count; k++) im.setMatrixAt(k, NOTHING);
  im.count = im.instanceMatrix.count; im.visible = used > 0; im.instanceMatrix.needsUpdate = true;
}
export class InstancedBatch {
  /** Meshes are added a CHUNK at a time as instances are set, up to `capacity`. colors: each instance has its own colour. */
  constructor(parent, geo, mat, capacity, { colors = false, castShadow = false, receiveShadow = false, name = 'batch', renderOrder = 0 } = {}) {
    this.parent = parent; this.geo = geo; this.mat = mat; this.capacity = capacity;
    this.o = { colors, castShadow, receiveShadow, name, renderOrder };
    this.meshes = []; this.n = 0;
  }
  /** A mesh with room for CHUNK instances in its arrays, whose shader is built for `room` of them (it draws `room`). */
  make(c, room) {
    const im = new THREE.InstancedMesh(this.geo, this.mat, CHUNK), o = this.o;
    if (o.colors) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CHUNK * 3), 3);
    im.count = room; im.userData.room = room; im.visible = false;
    im.castShadow = o.castShadow; im.receiveShadow = o.receiveShadow; im.renderOrder = o.renderOrder;
    im.name = o.name + ' ' + c;
    im.frustumCulled = false;                                    // instances spread over the whole board; the mesh's own bounds do not
    return im;
  }
  chunk(c) {
    while (this.meshes.length <= c) { const im = this.make(this.meshes.length, ROOM_MIN); this.parent.add(im); this.meshes.push(im); }
    return this.meshes[c];
  }
  set(i, matrix, color) {
    if (i >= this.capacity) throw new RangeError(this.o.name + ': instance ' + i + ' past its capacity ' + this.capacity);
    // a batch made without colours takes none: three would add a colour buffer to this mesh only, and the next, bigger mesh
    // (commit) would have none to copy it into (11-11: the warm-up did this, and commit threw mid-match)
    if (color && !this.o.colors) throw new Error(this.o.name + ': a colour for a batch made without colours');
    const im = this.chunk(Math.floor(i / CHUNK)), k = i % CHUNK;
    im.setMatrixAt(k, matrix);
    if (color) im.setColorAt(k, color);
  }
  /** Draw the first n instances. */
  commit(n) {
    this.n = n;
    this.meshes.forEach((old, c) => {
      const used = Math.max(0, Math.min(CHUNK, n - c * CHUNK));
      let im = old;
      if (used > old.userData.room) {                              // outgrown: a new mesh (a new shader) with room for them
        im = this.make(c, roomFor(used));
        im.instanceMatrix.array.set(old.instanceMatrix.array);
        if (old.instanceColor) im.instanceColor.array.set(old.instanceColor.array);
        this.parent.remove(old); old.dispose();
        this.parent.add(im); this.meshes[c] = im;
      }
      for (let k = used; k < im.userData.room; k++) im.setMatrixAt(k, NOTHING);
      im.count = im.userData.room;
      im.visible = used > 0;                                       // r175 draws instance 0 of a count-0 mesh (a stray block at the origin)
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }
  setMaterial(m) { this.mat = m; for (const im of this.meshes) im.material = m; }
}

/** A model of several parts (one per material) drawn as plain meshes that share the parts' geometry and material, one mesh per part
 *  per square, made as they are first needed and hidden when not. NOT instanced, on purpose: three r175 builds the shader of an
 *  InstancedMesh whose count is over 1 per MESH (its cache key takes the mesh's uuid, build/three.webgpu.js RenderObject
 *  getMaterialCacheKey), so every level's new batches of the 13 prop parts were built again (11-08: a 2 s stall in the first second
 *  of play, where the original procedural props stalled 0.5 s). Plain meshes share one build per part, made by the renderer's
 *  warm-up while the page loads. A map holds a few dozen props at most (app/maps.js: up to four woods of seven trees, a few rocks
 *  and houses), so the draw calls stay in the low hundreds. The same set(i, matrix) / commit(n) as InstancedBatch. */
export class PropSet {
  constructor(parent, parts, capacity, { castShadow = false, receiveShadow = false, name = 'props' } = {}) {
    if (!parts.length) throw new Error('PropSet "' + name + '": no parts');
    this.parent = parent; this.parts = parts; this.capacity = capacity; this.o = { castShadow, receiveShadow, name };
    this.meshes = [];                                            // meshes[i] = the parts of the i-th prop
  }
  set(i, matrix) {
    if (i >= this.capacity) throw new RangeError(this.o.name + ': prop ' + i + ' past its capacity ' + this.capacity);
    while (this.meshes.length <= i) {
      const group = this.parts.map((p) => {
        const m = new THREE.Mesh(p.geometry, p.material);
        m.castShadow = this.o.castShadow; m.receiveShadow = this.o.receiveShadow; m.matrixAutoUpdate = false; m.name = this.o.name;
        this.parent.add(m); return m;
      });
      this.meshes.push(group);
    }
    for (const m of this.meshes[i]) { m.matrix.copy(matrix); m.matrixWorldNeedsUpdate = true; }
  }
  commit(n) { this.meshes.forEach((group, i) => { for (const m of group) m.visible = i < n; }); }
}
