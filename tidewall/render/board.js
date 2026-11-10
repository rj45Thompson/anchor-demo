// board.js - the island and everything that stands on its squares: the land (a heightfield with gentle relief and a sand edge),
// the animated sea with shoreline foam, the territory fill painted into the land in each owner's colour (flashing when a ring
// closes), the walls (UC-L1: one chunky stone block per square with a light coping, a band of the owner's cloth and a soft contact
// shadow, and the owner's pennants on the north corners of each run of their wall; nothing on a wall glows), the props on the
// squares (rubble, rocks, trees, houses, pits, graveyards) and the scenery round the board (rocks, oaks, houses, barrels, towers). It reads the model's GridModel and nothing else; every
// change is found by comparing the board's bytes with the last frame's, so a view can never drift from the rules.
import * as THREE from 'three/webgpu';
import { texture, uniform, vertexColor, positionWorld, positionLocal, vec2, vec3, vec4, float, mix, smoothstep, sin, fract, min, max, abs, step, clamp,
         normalize, dot, reflect, pow, cameraPosition, transformNormalToView, mrt, cos, positionGeometry,
         instancedBufferAttribute, instanceIndex, uv, oneMinus } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CoastField, LATTICE_SUB, COAST_RANGE } from './coast.js';
import { Terrain, Occupant, EnclosureRules, PieceMap, WallOutline, WallsPlaced, RingBuilt, ShotLanded } from '../core/index.js';
import { C, SKY, NEUTRAL_WALL, mats, glowing, wallStoneGeometry, wallCapGeometry, wallSteelGeometry, wallSteelCapGeometry, STEEL, tuftGeometry, TUFT_H, makeNoiseTexture, NOISE_SLOPE, makeNoise, InstancedBatch, PropSet, pitGeometry, rubbleGeometry, graveGeometry,
         wallTrimGeometry, wallShadowGeometry, pennantPoleGeometry, pennantFlagGeometry, PENNANT_FLAG } from './look.js';

export const MARGIN = 12;              // AUTHORED: squares of sea drawn round the board, so the island never sits on a hard edge
const SUB = LATTICE_SUB;               // land vertices per square (render/coast.js: the coast field's lattice)
const TUFTS_PER_SQUARE = 3;            // AUTHORED: grass tufts on each open grass square
const TUFT_CAP = 76 * 56 * TUFTS_PER_SQUARE;   // the largest generated map (app/maps.js SIZE_CLASSES.large: up to 76 x 56) full of grass
const SDF_RANGE = COAST_RANGE;         // the distance texture holds -8..+8 squares (render/coast.js)
const WALL_H = 0.5, WALL_W = 0.9;      // AUTHORED: a wall block, in squares
// AUTHORED (UC-L1): how much of the owner's colour the light coping takes (the cloth and the pennants carry the rest; seen from the
// near top-down REPAIR camera the coping is most of what shows of a wall), a pennant for about every PENNANT_EVERY squares of an
// owner's wall run, the pennant pole's inset from the block's corner, and the soft shadow's darkness at its middle
// the scenery tall enough for its shadow to read from the camera; the low bits (bushes, small rocks, barrels, the sand islets)
// stay out of the shadow pass (a draw each, every other frame)
const DECOR_CASTS = new Set(['rockLarge', 'oak', 'tower', 'houseA', 'houseB']);
const WALL_JITTER = 0.04, CAP_OWNER = 0.18, PENNANT_EVERY = 5, PENNANT_INSET = 0.1, WALL_SHADOW_K = 0.38;
// AUTHORED (graphics round 3): a cannonball's scorch on the land fades over SCORCH_SECONDS (the first moments glow as embers); its
// strength is the flash texture's G channel, so the land's shader reads it with the texture it already samples
const SCORCH_SECONDS = 9, SCORCH_UPLOAD = 0.1;
const FLASH_SECONDS = 1.4;             // AUTHORED: how long a square glows after the capture sweep's front passed it
const SWEEP_SPEED = 9;                 // AUTHORED: squares per second the capture glow runs out from the castle
// AUTHORED (AAA gap 8, WALL_DROP_UC.md UC-L3): a placed block drops in from `height` squares above its square in `seconds`, falling
// faster as it goes, then squashes a little as it lands (`squash` of its height, over `squashSeconds`). A piece's blocks (and a
// castle's first ring) land one after another, `stagger` seconds apart but never longer than `spread` for the whole set.
export const WALL_DROP = Object.freeze({ height: 0.9, seconds: 0.2, squash: 0.14, squashSeconds: 0.12, stagger: 0.035, spread: 0.6 });
/** Seconds after the event that block k of n lands (the dust is raised then: render/units.js). */
export const wallLandsAfter = (k, n) => WALL_DROP.seconds + k * Math.min(WALL_DROP.stagger, WALL_DROP.spread / Math.max(1, n));
// AUTHORED: the direction the sea's glints come from. The sun is behind the camera's left shoulder (its shadows fall away from the
// camera), so its own mirror image is never on screen; the glints use a light low over the far (north) horizon instead, the way a
// painted sea sparkles toward the viewer.
const GLINT = new THREE.Vector3(0.25, 0.42, -0.87).normalize();

/** The squares the sea counts as water for drawing: open sea and an inland lake. */
const wet = (t) => t === Terrain.Water || t === Terrain.Lake;

/** The land's and the sea's materials, made ONCE by the renderer and shared by every level: a level only hands them its textures and
 *  size (bindLand, bindSea), so starting a match or a new level builds no shader (11-09: the sea's shader built at START stalled the
 *  first second of play and swallowed the page check's key and pad presses). The textures they hold before the first level binds
 *  its own are 1x1 and never drawn: no board is in the scene until a level has bound. */
export class BoardLook {
  /** @param mood render/mood.js Mood: the level's light (the sea reflects its sky) */
  constructor(mood) {
    if (!mood || !mood.seaHorizon) throw new Error('board.js: BoardLook needs the Mood (render/mood.js)');
    this.mood = mood;
    this.uTime = uniform(0); this.uGrid = uniform(0); this.uWaterDetail = uniform(1); this.uSize = uniform(new THREE.Vector2(1, 1));
    this.uFlash = uniform(1);            // how bright a captured territory flashes: 1, or REDUCED_FLASH under reduced motion (UC-ST2)
    const unbound = () => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; };
    this.noiseTex = makeNoiseTexture();
    this.fillNode = texture(unbound()); this.flashNode = texture(unbound()); this.sdfNode = texture(unbound());
    this.land = this.makeLand();
    this.sea = this.makeSea();
    this.tufts = this.makeTufts();
    this.makeWallMats();
  }

  /** The walls' materials, shared by every level like the land's (UC-L1). Every one is lit by the sun and writes nothing to the
   *  glow target, so no wall blooms. The stone (its stones' shades in the vertex colours, smooth-shaded: the rounded stones' own
   *  normals are their roundness; a fine grain from the noise texture so a face is not flat paint; tinted per block by the instance
   *  colour), the light coping, the owner's cloth (matte, a fine weave), the steel of a metal block, the soft contact shadow under
   *  each block, and the pennants' flags (the owner's colour per instance, waving: the wave grows from the pole to the tail, each
   *  flag at its own phase). */
  makeWallMats() {
    const P = positionWorld, grain = texture(this.noiseTex, P.xz.mul(1.9).add(P.y.mul(1.3))).a;
    const fleck = texture(this.noiseTex, P.zx.mul(0.37).add(P.y.mul(0.5))).r;
    this.wallStone = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    this.wallStone.colorNode = vec3(grain.mul(0.14).add(0.91).mul(fleck.mul(0.1).add(0.95)));
    this.wallCap = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    // the coping's face: the fine grain and a broad mottle of lighter and darker patches, so a long run of copings is weathered
    // stone, not one paint
    this.wallCap.colorNode = vec3(grain.mul(0.1).add(0.93).mul(texture(this.noiseTex, P.xz.mul(0.29)).r.mul(0.2).add(0.9)));
    this.wallTrim = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.wallTrim.colorNode = vec3(texture(this.noiseTex, P.xz.mul(5.3).add(P.y.mul(7.1))).a.mul(0.14).add(0.88));
    // the metal piece's steel: smoother and glossier than the stone, fine grain only
    this.wallSteel = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.5 });
    this.wallSteel.colorNode = vec3(grain.mul(0.06).add(0.96));
    this.wallShadow = new THREE.MeshBasicNodeMaterial({ color: 0x14200c, transparent: true, depthWrite: false });
    const d = max(abs(uv().x.sub(0.5)), abs(uv().y.sub(0.5))).mul(2);    // 0 at the middle, 1 at the square's edge
    this.wallShadow.opacityNode = smoothstep(1.0, 0.5, d).mul(WALL_SHADOW_K);
    this.pennantFlag = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const along = positionGeometry.x.div(PENNANT_FLAG).clamp(0, 1);
    const wave = sin(this.uTime.mul(5.2).add(positionGeometry.x.mul(16)).add(instanceIndex.toFloat().mul(1.37))).mul(0.055).mul(along);
    this.pennantFlag.positionNode = positionLocal.add(vec3(0, 0, wave));
  }

  /** Grass tufts: ONE mesh drawn instanced (Mesh.count), each tuft's place, turn and size in an instanced vertex attribute, so a
   *  level only rewrites the attribute (no InstancedMesh, whose matrices would sit in a uniform buffer capped at 1000; no new shader
   *  per level). They lean with a breeze that grows toward the blade tips. TUFT_CAP covers the largest generated map (app/maps.js SIZE_CLASSES.large:
   *  up to 76 x 56 squares) at TUFTS_PER_SQUARE; a board that would need more is an error in Board.drawTufts, never a silent cut. */
  makeTufts() {
    this.tuftData = new Float32Array(TUFT_CAP * 4);
    this.tuftAttr = new THREE.InstancedBufferAttribute(this.tuftData, 4).setUsage(THREE.DynamicDrawUsage);
    const a = instancedBufferAttribute(this.tuftAttr);                 // x, ground y, z, turn + 2*PI * size (packed)
    const size = a.w.div(2 * Math.PI).floor().div(100), turn = a.w.sub(size.mul(100).mul(2 * Math.PI));
    const c = cos(turn), sn = sin(turn), p = positionGeometry.mul(size);
    const k = positionGeometry.y.div(TUFT_H).pow(2);                    // the tip bends, the root stays put
    const t = this.uTime, ph = a.x.mul(0.7).add(a.z.mul(0.9));
    const sway = vec3(sin(t.mul(1.6).add(ph)).mul(0.035).add(0.02), 0, sin(t.mul(1.3).add(ph.mul(1.3))).mul(0.025)).mul(k).mul(size);
    const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    m.positionNode = vec3(p.x.mul(c).sub(p.z.mul(sn)), p.y, p.x.mul(sn).add(p.z.mul(c))).add(sway).add(a.xyz);
    m.normalNode = transformNormalToView(vec3(0, 1, 0));             // lit as the ground they grow from: no dark undersides
    const mesh = new THREE.Mesh(tuftGeometry(), m);
    mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'grass tufts';
    return mesh;
  }
  bindLand(fillTex, flashTex, w, h) { this.fillNode.value = fillTex; this.flashNode.value = flashTex; this.uSize.value.set(w, h); }
  bindSea(sdfTex) { this.sdfNode.value = sdfTex; }

  makeLand() {
    const cellUv = positionWorld.xz.div(this.uSize);
    const inBoard = step(0, positionWorld.x).mul(step(positionWorld.x, this.uSize.x)).mul(step(0, positionWorld.z)).mul(step(positionWorld.z, this.uSize.y));
    const fill = this.fillNode.sample(cellUv), fl = this.flashNode.sample(cellUv);
      // the ground's own detail, all procedural (no texture file): on grass, broad patches of drier and lusher green, a finer mottle and
    // blade-length streaks; on sand, wind ripples and grain. Which is which is read from the vertex colour the island was painted with
    // (grass is greener than it is red; the beach is the other way round).
    const vc = vertexColor(), P = positionWorld.xz;
    const grassy = smoothstep(0.03, 0.16, vc.g.sub(vc.r));
    const nz = (uvw) => texture(this.noiseTex, uvw);                       // look.js makeNoiseTexture: R noise, A finer noise
    const patch = smoothstep(0.25, 0.75, nz(P.mul(0.035)).r);
    const mottle = nz(P.mul(0.11).add(0.37)).a.mul(2).sub(1);
    const streak = nz(vec2(P.x.mul(0.9), P.y.mul(0.36))).a.mul(2).sub(1);
    let grass = mix(vc, vec3(C.grassDry.r, C.grassDry.g, C.grassDry.b), smoothstep(0.58, 0.9, patch).mul(0.6));
    grass = mix(grass, vec3(C.grassDeep.r, C.grassDeep.g, C.grassDeep.b), smoothstep(0.42, 0.1, patch).mul(0.55));
    grass = grass.mul(mottle.mul(0.1).add(1)).mul(streak.mul(0.06).add(1));
    // UC-L1: the lawn laid in square turf tiles (a light checker, one tile per board square), with patches of dirt path and beds of
    // flowers, all from the noise texture and the square's own coordinates (no texture file). AUTHORED sizes: a path patch about 20
    // squares apart (0.05 tiles per square), a flower bed about 14 (0.07); flowers on a 3 x 3 lattice per square, about 45 % of its
    // points in a bed, each a dot 0.06 of a square across, white, yellow or pink by a hash of its point
    const cell = positionWorld.xz.floor(), checker = cell.x.add(cell.y).mod(2);
    grass = grass.mul(checker.mul(0.075).add(0.96));
    // (one noise sample makes both: a path where it is high, a flower bed where it is low, so they never overlap; the dirt's grain is
    // the sand's own sample below: every texture read here is per pixel of the whole island)
    const patchN = nz(P.mul(0.05).add(vec2(0.31, 0.77))).r, grainS = nz(P.mul(1.7)).a;
    const pathK = smoothstep(0.66, 0.71, patchN);
    const dirt = vec3(C.path.r, C.path.g, C.path.b).mul(grainS.mul(0.16).add(0.9));
    grass = mix(grass, dirt, pathK.mul(0.8));
    const bed = smoothstep(0.36, 0.3, patchN);
    const q = P.mul(3), qi = q.floor(), qf = q.fract().sub(0.5);
    const h1 = fract(sin(qi.x.mul(12.9898).add(qi.y.mul(78.233))).mul(43758.5453)), h2 = fract(h1.mul(17.31));
    const flower = smoothstep(0.2, 0.13, qf.add(vec2(h2.sub(0.5).mul(0.36), h1.sub(0.5).mul(0.36))).length()).mul(step(0.55, h1)).mul(bed);
    const petal = mix(mix(vec3(C.flowerA.r, C.flowerA.g, C.flowerA.b), vec3(C.flowerB.r, C.flowerB.g, C.flowerB.b), step(0.4, h2)), vec3(C.flowerC.r, C.flowerC.g, C.flowerC.b), step(0.72, h2));
    grass = mix(grass, petal, flower);
    const ripple = sin(P.x.mul(5.2).add(P.y.mul(2.3)).add(nz(P.mul(0.06).add(0.61)).r.mul(6.4))).mul(0.5).add(0.5);
    const grain = grainS.mul(2).sub(1);
    const sand = vc.mul(ripple.mul(0.06).add(0.97)).mul(grain.mul(0.05).add(1));
    const base = mix(sand, grass, grassy);
    let tint = mix(base, fill.rgb.mul(0.62).add(0.3), fill.a.mul(inBoard));   // a light wash of the owner's colour, not a dark stain
    // a cannonball's scorch (graphics round 3): a ragged dark crater in the middle of the square it hit, fading (fl.g)
    const sc = fl.g.mul(inBoard), cr = positionWorld.xz.fract().sub(0.5).length().add(nz(P.mul(0.8)).a.sub(0.5).mul(0.22));
    const crater = smoothstep(0.46, 0.14, cr).mul(sc);
    tint = mix(tint, vec3(0.13, 0.1, 0.08), crater.mul(0.82));
    this.scorchEmbers = vec3(1.0, 0.32, 0.06).mul(smoothstep(0.18, 0.02, cr)).mul(sc.mul(sc).mul(sc).mul(sc)).mul(2.4);
    // a faint square grid on the land, eased in while pieces are being placed (REPAIR) so a square is easy to aim at
    const gx = fract(positionWorld.x), gz = fract(positionWorld.z);
    const edge = min(min(gx, gx.oneMinus()), min(gz, gz.oneMinus()));
    const line = smoothstep(0.045, 0.0, edge).mul(this.uGrid).mul(inBoard).mul(smoothstep(0.03, 0.1, positionWorld.y));
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, flatShading: false });
    m.colorNode = tint.mul(float(1).sub(line.mul(0.28)));
    m.emissiveNode = fill.rgb.mul(fl.r).mul(inBoard).mul(2.2).mul(this.uFlash).add(this.scorchEmbers);
    return m;
  }

  makeSea() {
    const M = MARGIN;
    const t = this.uTime, q = this.uWaterDetail;
    const P = positionWorld.xz;
    const suv = P.add(M).div(this.uSize.add(2 * M));
    const sdfN = this.sdfNode.sample(suv).r.mul(2 * SDF_RANGE).sub(SDF_RANGE);
    const off = sdfN.negate();                                        // squares out from the coast
    // the surface: two drifting octaves of noise and a long swell. Its slope (finite differences) is the normal the sun lights, the
    // sky reflects in and the glints come from; the second octave is dropped on the low quality setting (uWaterDetail = 0)
    // the slope of two octaves of the noise texture drifting across each other (G, B = slope, look.js makeNoiseTexture) and of a long
    // swell, in height per square; the second octave is dropped on the low quality setting (uWaterDetail = 0)
    const nz = (uvw) => texture(this.noiseTex, uvw);
    const S1 = 0.045, S2 = 0.13;                                      // tiles per square: an octave's waves are 1 / (8 x S) squares long
    const w1 = nz(P.mul(S1).add(vec2(t.mul(0.011), t.mul(0.007)))), w2 = nz(P.mul(S2).sub(vec2(t.mul(0.017), t.mul(-0.013))));
    const slope = (w) => w.gb.sub(0.5).mul(NOISE_SLOPE);
    const sw = cos(P.x.mul(0.6).add(P.y.mul(0.35)).add(t.mul(1.1))).mul(0.18);
    const grad = slope(w1).mul(S1 * 0.7).add(slope(w2).mul(S2 * 0.14).mul(q)).add(vec2(sw.mul(0.6), sw.mul(0.35)));
    const calm = smoothstep(0.05, 1.2, off).mul(0.75).add(0.25);       // flatter in the shallows
    const N = normalize(vec3(grad.x.negate().mul(calm), 1, grad.y.negate().mul(calm)));
    // colour by depth: sand-tinted clear water at the beach, turquoise shallows, teal, deep blue; a slow noise keeps the bands from
    // reading as contour lines
    const n0 = w1.r.mul(2).sub(1);
    const dOff = off.add(n0.mul(0.9));
    let col = mix(vec3(C.lagoon.r, C.lagoon.g, C.lagoon.b), vec3(C.shallow.r, C.shallow.g, C.shallow.b), smoothstep(0.0, 1.4, dOff));
    col = mix(col, vec3(C.midSea.r, C.midSea.g, C.midSea.b), smoothstep(1.2, 4.5, dOff));
    col = mix(col, vec3(C.deep.r, C.deep.g, C.deep.b), smoothstep(4.0, 10.0, dOff));
    // light dancing on the sand under the shallows (caustics): thin bright veins of a moving noise
    const ca = nz(P.mul(0.32).add(vec2(t.mul(0.03), t.mul(0.021)))).a, cb = nz(P.mul(0.27).sub(vec2(t.mul(0.025), t.mul(-0.033))).add(0.5)).a;
    const cn = ca.sub(cb).abs().mul(2.4).oneMinus().max(0).pow(6);
    col = col.add(cn.mul(smoothstep(2.4, 0.3, off)).mul(0.2));
    // foam: a swash line at the beach that runs up and back, bands of surf rolling in, both torn by noise
    const fn = nz(P.mul(0.33).add(vec2(t.mul(0.02), t.mul(0.012)))).a;
    const swash = sin(t.mul(1.15)).mul(0.08).add(0.36);
    const edgeFoam = smoothstep(swash, swash.sub(0.3), off).mul(smoothstep(0.15, 0.55, fn).mul(0.6).add(0.4));
    const band = smoothstep(0.7, 1.0, sin(off.mul(7.5).sub(t.mul(2.2)).add(fn.mul(2.2)))).mul(smoothstep(1.7, 0.3, off)).mul(smoothstep(0.35, 0.75, fn));
    const foam = clamp(max(edgeFoam, band.mul(0.95)), 0, 1);
    // the sky in the water: Fresnel (stronger toward the horizon), the reflected ray picking between the horizon and zenith colours
    const V = normalize(cameraPosition.sub(positionWorld));
    const ndv = max(dot(N, V), 0);
    const fres = pow(float(1).sub(ndv), 3).mul(0.75).add(0.06);
    const R = reflect(V.negate(), N);
    const sky = mix(this.mood.seaHorizon, this.mood.seaZenith, smoothstep(0.05, 0.7, R.y));     // the level's sky (render/mood.js)
    // sparkle: the sun's glint on wave facets, broken into twinkling points; it glows (it is written to the bloom's target)
    const L = GLINT;
    const glint = pow(max(dot(R, vec3(L.x, L.y, L.z)), 0), 600);
    const twinkle = smoothstep(0.62, 0.8, nz(P.mul(0.7).add(vec2(t.mul(0.09), t.mul(-0.07)))).a);
    const sparkle = glint.mul(twinkle).mul(6).mul(float(1).sub(foam)).mul(smoothstep(0.3, 1.5, off));
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.0 });
    m.colorNode = mix(col, vec3(1, 1, 1), foam);
    m.normalNode = transformNormalToView(N);
    m.emissiveNode = sky.mul(fres).mul(float(1).sub(foam)).mul(0.42).add(vec3(sparkle));
    m.mrtNode = mrt({ emissive: vec4(vec3(sparkle), 1) });            // only the glints bloom, never the reflected sky
    // a gentle swell, flattened at the coast so the beach line does not swim
    const swell = sin(positionLocal.x.mul(0.55).add(t.mul(1.2))).add(sin(positionLocal.z.mul(0.43).sub(t.mul(0.9)))).mul(0.018).mul(smoothstep(0.3, 2.5, off));
    m.positionNode = positionLocal.add(vec3(0, swell, 0));
    return m;
  }
}

export class Board {
  /** @param {THREE.Scene} scene  @param grid the model's GridModel  @param colours each player slot's colour (its seat's)
   *  @param propParts Map occupant -> the model parts a square holding it is drawn with (trees and rocks: models.js)
   *  @param decorParts { bush, rockSmall, rockLarge, oak }: the decoration's model parts (buildDecor)
   *  @param rules the match's rules: a brick with more health than rules.wallHealth is a metal one (the bomb rule set's shop piece) */
  constructor(scene, grid, colours, propParts, decorParts, look, rules) {
    if (!(look instanceof BoardLook)) throw new Error('board.js: the shared BoardLook is required');
    this.look = look; this.rules = rules;
    this.scene = scene; this.grid = grid; this.colours = colours; this.propParts = propParts; this.decorParts = decorParts;
    this.w = grid.width; this.h = grid.height;
    this.group = new THREE.Group(); this.group.name = 'board'; scene.add(this.group);
    this.noise = makeNoise(this.w * 131 + this.h * 7);
    this.pieces = new PieceMap(this.w, this.h);
    const n = this.w * this.h;
    this.seen = { occ: new Int16Array(n).fill(-1), own: new Int16Array(n).fill(-1), hp: new Int16Array(n).fill(-1), ter: new Int16Array(n).fill(-1) };
    this.flashAt = new Float32Array(n).fill(-1e9);   // when the capture sweep's front reached each square (board clock, s)
    this.now = 0;
    this.territory = null;
    this.dropAt = new Float64Array(this.w * this.h).fill(-1e9);   // when each square's block started to fall (seconds; page clock)
    this.dropUntil = -1;                                            // the last block of the newest drop has settled by then
    this.buildField();
    this.buildLand();
    this.buildSea();
    this.buildWalls();
    this.buildProps();
    this.buildDecor();
    this.sync(0, true);
  }

  // ------------------------------------------------------------------ the shape of the island
  /** Signed distance to the coast in squares (+ on land, - at sea): render/coast.js CoastField (COAST_UC.md UC-L2), smoothed so the
   *  coast is a shore and not a staircase of squares, and checked so every square's centre is drawn on its own side (it throws on a
   *  board that would break that). sdf(px, pz) reads it anywhere; the lattice is the land mesh's vertices and the sea's texture. */
  buildField() {
    const { w, h, grid } = this;
    const land = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) land[y * w + x] = wet(grid.terrainAt(x, y)) ? 0 : 1;
    this.land = land;
    const coast = new CoastField(land, w, h, { margin: MARGIN, sub: SUB, range: SDF_RANGE, noise: this.noise });
    coast.check(land);
    this.coast = coast;
    this.sdf = (px, pz) => coast.at(px, pz);
    this.lattice = { lw: coast.lw, lh: coast.lh, field: coast.field };
  }

  /** The land's height at a point (squares; the sea is y = 0). */
  heightOf(s, px, pz) {
    if (s < 0) return Math.max(s * 0.5, -0.7);
    const relief = (this.noise(px * 0.3 + 40, pz * 0.3 - 11) - 0.5) * 0.1 * THREE.MathUtils.smoothstep(s, 0.9, 2.6);
    return 0.06 * THREE.MathUtils.smoothstep(s, 0, 0.3) + 0.12 * THREE.MathUtils.smoothstep(s, 0.35, 2.6) + relief;
  }
  /** Where a thing standing on square (x, y) sits: the land's height at the square's centre. */
  groundAt(x, y) { const px = x + 0.5, pz = y + 0.5; return Math.max(0, this.heightOf(this.sdf(px, pz), px, pz)); }
  /** The same at any point (a hero walks between squares). */
  groundAtPoint(px, pz) { return Math.max(0, this.heightOf(this.sdf(px, pz), px, pz)); }

  buildLand() {
    const { lw, lh, field } = this.lattice, M = MARGIN, grid = this.grid, w = this.w, h = this.h;
    const pos = new Float32Array(lw * lh * 3), col = new Float32Array(lw * lh * 3), tmp = new THREE.Color();
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const k = j * lw + i, px = -M + i / SUB, pz = -M + j / SUB, s = field[k];
      pos[k * 3] = px; pos[k * 3 + 1] = this.heightOf(s, px, pz); pos[k * 3 + 2] = pz;
      const n = this.noise(px * 0.6 + 3, pz * 0.6 + 9);
      if (s < 0) tmp.copy(C.wetSand).lerp(C.seaBed, THREE.MathUtils.smoothstep(-s, 0, 1.2));
      else if (s < 0.5) tmp.copy(C.wetSand).lerp(C.sand, THREE.MathUtils.smoothstep(s, 0, 0.2));
      else {
        tmp.copy(C.grassDark).lerp(C.grassLight, n);
        tmp.lerp(C.sand, 1 - THREE.MathUtils.smoothstep(s, 0.5, 0.75));
        const x = Math.floor(px), y = Math.floor(pz);
        if (x >= 0 && y >= 0 && x < w && y < h && grid.terrainAt(x, y) === Terrain.Swamp) tmp.lerp(C.swamp, 0.8);
      }
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    }
    const idx = [];
    for (let j = 0; j < lh - 1; j++) for (let i = 0; i < lw - 1; i++) {
      const a = j * lw + i, b = a + 1, c = a + lw, d = c + 1;
      if (field[a] < -2.5 && field[b] < -2.5 && field[c] < -2.5 && field[d] < -2.5) continue;   // deep under the sea: never seen
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();

    // the territory: one texel per square, the owner's colour and how strongly it fills; a second texture holds the flash
    this.fillData = new Uint8Array(w * h * 4); this.flashData = new Uint8Array(w * h * 4);
    this.scorch = new Float32Array(w * h);                                  // each square's scorch, 1 when a ball lands, fading to 0
    this.rubbleOwner = new Int8Array(w * h).fill(-1);                     // whose wall a rubble square was (its stones keep the colour)
    this.fillTex = new THREE.DataTexture(this.fillData, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.flashTex = new THREE.DataTexture(this.flashData, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [this.fillTex, this.flashTex]) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    this.look.bindLand(this.fillTex, this.flashTex, w, h);
    const m = this.look.land;
    this.landMesh = new THREE.Mesh(geo, m); this.landMesh.receiveShadow = true; this.landMesh.name = 'land';
    this.group.add(this.landMesh);
  }

  buildSea() {
    const { lw, lh, field } = this.lattice, M = MARGIN, w = this.w, h = this.h;
    // the signed distance as a texture, so the sea's shader knows how far from the coast each point is
    const tw = lw, th = lh, data = new Uint8Array(tw * th * 4);
    for (let k = 0; k < tw * th; k++) {
      const v = Math.round(THREE.MathUtils.clamp((field[k] + SDF_RANGE) / (2 * SDF_RANGE), 0, 1) * 255);
      data[k * 4] = v; data[k * 4 + 1] = v; data[k * 4 + 2] = v; data[k * 4 + 3] = 255;
    }
    const sdfTex = new THREE.DataTexture(data, tw, th, THREE.RGBAFormat, THREE.UnsignedByteType);
    sdfTex.magFilter = sdfTex.minFilter = THREE.LinearFilter; sdfTex.generateMipmaps = false; sdfTex.needsUpdate = true;
    this.sdfTex = sdfTex;
    const span = 1200;                                                // the sea runs past the camera's far plane (400) every way: it
                                                                      // never ends on screen, it fades into the haze (sky.js)
    const geo = new THREE.PlaneGeometry(span, span, 480, 480); geo.rotateX(-Math.PI / 2); geo.translate(w / 2, 0, h / 2);
    this.look.bindSea(sdfTex);
    const m = this.look.sea;
    this.sea = new THREE.Mesh(geo, m); this.sea.receiveShadow = true; this.sea.name = 'sea';
    this.group.add(this.sea);
  }

  // ------------------------------------------------------------------ walls and props
  buildWalls() {
    const n = this.w * this.h;
    // a block is two batches of the same squares (each under the 1000-instance limit, InstancedBatch): the stone body, tinted per
    // block, and its cap in the owner's colour
    this.walls = new InstancedBatch(this.group, wallStoneGeometry(WALL_W, WALL_H), this.look.wallStone, n, { colors: true, castShadow: true, receiveShadow: true, name: 'walls' });
    // (the copings cast no shadow of their own: the stone body under each casts the block's, and the shadow map is the frame's
    // second-largest cost, perf_battle --ablate)
    this.caps = new InstancedBatch(this.group, wallCapGeometry(WALL_W, WALL_H), this.look.wallCap, n, { colors: true, castShadow: false, receiveShadow: true, name: 'wall caps' });
    // the metal piece's blocks: steel body and steel cap, tinted a little toward the owner (they are only made when one is bought)
    this.steel = new InstancedBatch(this.group, wallSteelGeometry(WALL_W, WALL_H), this.look.wallSteel, n, { colors: true, castShadow: true, receiveShadow: true, name: 'steel walls' });
    this.steelCaps = new InstancedBatch(this.group, wallSteelCapGeometry(WALL_W, WALL_H), this.look.wallSteel, n, { colors: true, castShadow: false, receiveShadow: true, name: 'steel caps' });
    // UC-L1, both kinds of block: the owner's cloth band and the soft shadow under the block; the pennants on the runs' corners
    // (the round 1-4 glowing outline bars round each piece are gone: RJ 11-09, "not going with the laser look anymore")
    this.trims = new InstancedBatch(this.group, wallTrimGeometry(WALL_W, WALL_H), this.look.wallTrim, n, { colors: true, castShadow: false, receiveShadow: true, name: 'wall cloth' });
    this.shadows = new InstancedBatch(this.group, wallShadowGeometry(), this.look.wallShadow, n, { name: 'wall shadows', renderOrder: 1 });
    this.poles = new InstancedBatch(this.group, pennantPoleGeometry(), mats.vc, n, { castShadow: false, name: 'pennant poles' });   // a pole's shadow is a hair: not drawn
    this.flags = new InstancedBatch(this.group, pennantFlagGeometry(), this.look.pennantFlag, n, { colors: true, castShadow: false, name: 'pennant flags' });
  }

  buildProps() {
    const n = this.w * this.h;
    // what the rules leave behind (rubble, a burning pit, a graveyard) is this game's own procedural shapes; the land a map names
    // (trees, houses, small and large rocks) is drawn with the CC-BY models
    const kinds = [[Occupant.Rubble, rubbleGeometry()], [Occupant.Pit, pitGeometry()], [Occupant.Graveyard, graveGeometry()]];
    this.props = new Map();
    for (const [occ, geo] of kinds) {
      this.props.set(occ, new InstancedBatch(this.group, geo, mats.vc, n, { colors: occ === Occupant.Rubble, castShadow: true, receiveShadow: true, name: 'props ' + occ }));
    }
    // (a House square has no drawing: the normal rules, the only ones this game runs, clear every house at load, MatchModel.plain)
    for (const occ of [Occupant.Tree, Occupant.RockSmall, Occupant.RockLarge]) {
      const parts = this.propParts.get(occ);
      if (!parts) throw new Error('board.js: no model parts for occupant ' + occ);
      this.props.set(occ, new PropSet(this.group, parts, n, { castShadow: true, receiveShadow: true, name: 'props ' + occ }));
    }
    // a pit glows (it burns); a separate emissive disc so the bloom picks it up
    this.embers = new InstancedBatch(this.group, new THREE.CircleGeometry(0.22, 10).rotateX(-Math.PI / 2), glowing(new THREE.MeshBasicNodeMaterial({ color: C.ember.clone().multiplyScalar(2.2) })), n, { name: 'embers' });
  }

  /** Feed the events the view was handed, in order: the piece map needs every placed piece and every built ring. */
  events(list, seconds) {
    for (const e of list) {
      if (e instanceof WallsPlaced || e instanceof RingBuilt) {
        this.pieces.shown(e);
        // the blocks drop in (UC-L3): each starts its fall so that it lands at wallLandsAfter(k, n)
        const n = e.cells.length;
        e.cells.forEach((c, k) => { if (this.grid.in(c.x, c.y)) this.dropAt[c.y * this.w + c.x] = this.now + wallLandsAfter(k, n) - WALL_DROP.seconds; });
        this.dropUntil = Math.max(this.dropUntil, this.now + wallLandsAfter(n - 1, n) + WALL_DROP.squashSeconds);
      }
      else if (e instanceof ShotLanded) {                               // a ball on the land leaves a scorch (the sea takes it whole)
        const { x, y } = e.target;
        if (this.grid.in(x, y) && this.grid.terrainAt(x, y) !== Terrain.Water && this.grid.terrainAt(x, y) !== Terrain.Lake) this.scorch[y * this.w + x] = 1;
      }
    }
  }

  /** A ring closed round castle `castleId`: its territory flashes. */
  flashRegionOf(cells) {
    if (!this.territory) throw new Error('board.js: a ring closed before the board mapped its territory');
    const regions = new Set();
    let cx = 0, cy = 0;
    for (const c of cells) { const r = this.territory.regionAt(c.x, c.y); if (r > 0) regions.add(r); cx += c.x + 0.5; cy += c.y + 0.5; }
    cx /= cells.length; cy /= cells.length;
    const swept = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!regions.has(this.territory.regionAt(x, y))) continue;
      const delay = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / SWEEP_SPEED;
      this.flashAt[y * this.w + x] = this.now + delay;                  // the sweep's front reaches this square then
      swept.push({ x, y, delay });
    }
    return swept;
  }

  /** Compare the board with what is drawn; rebuild what changed. Returns true when the walls changed (the territory too). */
  sync(dt, force = false) {
    const g = this.grid, w = this.w, h = this.h, s = this.seen;
    let walls = force, props = force;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = g.occupantAt(x, y), ow = g.ownerAt(x, y), hp = g.healthAt(x, y), t = g.terrainAt(x, y);
      if (o !== s.occ[i] || ow !== s.own[i] || hp !== s.hp[i] || t !== s.ter[i]) {
        if (o === Occupant.Wall || s.occ[i] === Occupant.Wall) walls = true;
        if (o === Occupant.Rubble) { if (s.occ[i] === Occupant.Wall) this.rubbleOwner[i] = s.own[i] < 4 ? s.own[i] : -1; }   // the rules forget the owner
        else this.rubbleOwner[i] = -1;
        props = true;
        s.occ[i] = o; s.own[i] = ow; s.hp[i] = hp; s.ter[i] = t;
      }
    }
    if (walls) { this.drawWalls(); this.territory = EnclosureRules.map(g); }
    else if (this.now <= this.dropUntil + 0.05) this.drawWalls();     // blocks still falling or settling: redrawn every frame (UC-L3)
    if (props) this.drawProps();
    this.drawTerritory(dt);
    return walls;
  }

  /** Where square (x, y)'s block is in its drop (WALL_DROP_UC.md UC-L3), now: fall = squares above its square (it falls faster as it
   *  comes: height * (1 - (1 + t / seconds)^2) for t in -seconds..0), squash = the share of its height it stands at (dipping by
   *  WALL_DROP.squash over squashSeconds after it lands). A block that never dropped, or has settled, is { fall: 0, squash: 1 }; a
   *  block of a set still waiting for its turn (staggered) is not drawn yet: squash 0. */
  dropOf(x, y) {
    const t = this.now - this.dropAt[y * this.w + x] - WALL_DROP.seconds;
    if (t < -WALL_DROP.seconds) return { fall: WALL_DROP.height, squash: 0 };
    const fall = t < 0 ? WALL_DROP.height * (1 - Math.pow(1 + t / WALL_DROP.seconds, 2)) : 0;
    const squash = t >= 0 && t < WALL_DROP.squashSeconds ? 1 - WALL_DROP.squash * Math.sin(Math.PI * t / WALL_DROP.squashSeconds) : 1;
    return { fall, squash };
  }

  drawWalls() {
    const g = this.grid, w = this.w, h = this.h, m = new THREE.Matrix4(), c = new THREE.Color(), sq = new THREE.Matrix4();
    const top = new Float32Array(w * h);
    let k = 0, ks = 0, kb = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (g.occupantAt(x, y) !== Occupant.Wall) continue;
      const ow = g.ownerAt(x, y), hp = g.healthAt(x, y), gy = this.groundAt(x, y), own = ow < 4 ? this.colourOf(ow) : NEUTRAL_WALL;
      const metal = hp > this.rules.wallHealth;
      const { fall, squash } = this.dropOf(x, y);                      // the drop (UC-L3): 0 and 1 once the block has settled
      // a block of a set still waiting for its turn is not drawn at all (11-10: drawn at zero height its normals went singular and it
      // lit as a flat BLACK square, shots/app/touch_02_claim_portrait.png), and no pennant stands on it
      if (squash === 0) { top[y * w + x] = NaN; continue; }
      const sy = (!metal && hp <= 1 ? 0.68 : 1) * squash;               // a damaged stone block (one hit left) stands lower
      const dim = !metal && hp <= 1 ? 0.75 : 1;                        // ...and darker
      // per block (hashed from the square, so the same board always lays the same stones): a quarter turn of the stones' bond, a
      // shade and a warmth
      const v = this.noise(x * 5.3 + 1.7, y * 4.9 - 3.1), turn = Math.floor(this.noise(x * 2.9 - 7, y * 3.3 + 5) * 4) % 4;
      // ...and a height a hair up or down (WALL_JITTER), so a run's copings are not one flat plane
      m.makeRotationY(turn * Math.PI / 2).premultiply(sq.makeScale(1, sy, 1)).setPosition(x + 0.5, gy - 0.04 + (v - 0.5) * WALL_JITTER + fall, y + 0.5);
      if (metal) {                                                     // a metal block: grey steel, worn a little by each blast it has taken
        const wear = 0.8 + 0.2 * (hp - this.rules.wallHealth) / (this.rules.metalWallHealth - this.rules.wallHealth);
        c.setScalar(wear * (0.96 + v * 0.08)); this.steel.set(ks, m, c);
        c.copy(STEEL).multiplyScalar(wear * 1.3); this.steelCaps.set(ks, m, c);
        ks++;
      } else {
        c.setRGB(1.0 + (v - 0.5) * 0.06, 1.0, 1.0 - (v - 0.5) * 0.1).multiplyScalar((0.9 + v * 0.18) * dim);
        this.walls.set(k, m, c);
        c.copy(C.wallTop).multiplyScalar(0.94 + v * 0.08).lerp(own, CAP_OWNER).multiplyScalar(dim);
        this.caps.set(k, m, c);
        k++;
      }
      c.copy(own).multiplyScalar(dim); this.trims.set(kb, m, c);      // the owner's cloth, on both kinds
      const ss = 1 - 0.45 * fall / WALL_DROP.height;                   // a falling block's soft shadow grows as it comes down
      this.shadows.set(kb, sq.makeScale(ss, 1, ss).setPosition(x + 0.5, gy + 0.012, y + 0.5));
      kb++;
      top[y * w + x] = gy - 0.04 + (v - 0.5) * WALL_JITTER + fall + WALL_H * sy;
    }
    this.walls.commit(k); this.caps.commit(k); this.steel.commit(ks); this.steelCaps.commit(ks); this.trims.commit(kb); this.shadows.commit(kb);
    this.drawPennants(top);
  }

  /** The owner's pennants (UC-L1): each run of one owner's wall (its squares joined side to side) flies about one pennant per
   *  PENNANT_EVERY squares, on blocks along the run's NORTH side (no square of the run north of them), spread evenly along the run
   *  in row order, the pole at the block's north edge and the flag flying west (east from a block with no run square east of it, a
   *  north-east corner). Only the north side: the camera looks from the south (or the east, turned, in portrait), so a flag stands
   *  over the run's outside and never over the top of a block (the page check's walls_drawn looks there). A map's own (unowned)
   *  wall flies none. */
  drawPennants(top) {
    const g = this.grid, w = this.w, h = this.h, run = new Int32Array(w * h).fill(-1), m = new THREE.Matrix4(), c = new THREE.Color();
    const wallOf = (x, y, ow) => g.in(x, y) && g.occupantAt(x, y) === Occupant.Wall && g.ownerAt(x, y) === ow;
    let n = 0, runs = 0;
    for (let y0 = 0; y0 < h; y0++) for (let x0 = 0; x0 < w; x0++) {
      const ow = g.ownerAt(x0, y0);
      if (run[y0 * w + x0] >= 0 || g.occupantAt(x0, y0) !== Occupant.Wall || ow >= 4) continue;
      const cells = [y0 * w + x0]; run[y0 * w + x0] = runs;
      for (let i = 0; i < cells.length; i++) {                       // the run: 4-joined squares of this owner's wall
        const x = cells[i] % w, y = (cells[i] / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (wallOf(nx, ny, ow) && run[ny * w + nx] < 0) { run[ny * w + nx] = runs; cells.push(ny * w + nx); }
        }
      }
      runs++;
      cells.sort((a, b) => a - b);                                     // row order
      const corners = [];
      for (const i of cells) {
        const x = i % w, y = (i / w) | 0;
        if (wallOf(x, y - 1, ow)) continue;
        corners.push({ x, y, east: wallOf(x - 1, y, ow) && !wallOf(x + 1, y, ow) });
      }
      const want = Math.min(corners.length, Math.max(1, Math.round(cells.length / PENNANT_EVERY)));
      for (let j = 0; j < want; j++) {
        const q = corners[Math.floor((j + 0.5) * corners.length / want)];
        if (Number.isNaN(top[q.y * w + q.x])) continue;                // its block has not dropped in yet (drawWalls)
        const px = q.east ? q.x + 1 - PENNANT_INSET : q.x + PENNANT_INSET, pz = q.y + PENNANT_INSET;
        m.makeRotationY(q.east ? 0 : Math.PI).setPosition(px, top[q.y * w + q.x], pz);
        this.poles.set(n, m); this.flags.set(n, m, c.copy(this.colourOf(ow)));
        n++;
      }
    }
    this.poles.commit(n); this.flags.commit(n);
    this.pennantCount = n;
  }

  drawProps() {
    const g = this.grid, counts = new Map(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let em = 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const o = g.occupantAt(x, y), im = this.props.get(o);
      if (o === Occupant.House) throw new Error('board.js: a house at ' + x + ',' + y + ': the normal rules clear houses (MatchModel.plain), and this board has no drawing for one');
      if (!im) continue;
      const k = counts.get(o) ?? 0; counts.set(o, k + 1);
      q.setFromAxisAngle(up, this.noise(x * 3.1, y * 2.7) * Math.PI * 2);
      const gy = this.groundAt(x, y);
      m.compose(new THREE.Vector3(x + 0.5, gy, y + 0.5), q, new THREE.Vector3(1, 1, 1));
      if (o === Occupant.Rubble) {                                       // the broken wall's stones keep a little of its owner's colour
        const ro = this.rubbleOwner[y * this.w + x];
        im.set(k, m, ro >= 0 ? new THREE.Color(1, 1, 1).lerp(this.colourOf(ro), 0.45) : new THREE.Color(1, 1, 1));
      } else im.set(k, m);
      if (o === Occupant.Pit) { m.makeTranslation(x + 0.5, gy + 0.065, y + 0.5); this.embers.set(em++, m); }
    }
    for (const [o, im] of this.props) im.commit(counts.get(o) ?? 0);
    this.embers.commit(em);
    this.drawTufts();
  }

  /** Grass tufts on every land square where no rule object stands (Occupant.Empty) and the ground is grass (not the beach band, not
   *  swamp), TUFTS_PER_SQUARE each at places hashed from the square, so the same board always grows the same grass. */
  drawTufts() {
    const g = this.grid, d = this.look.tuftData, r = (x, y, k) => this.noise(x * 7.31 + k * 3.7, y * 5.17 - k * 1.3);
    // where each square's tufts would stand is the same all match long (it depends on the land's shape and the noise only), so it
    // is worked out once per board: the coast distance (sdf) it needs walks the coast's squares, and doing that for every tuft each
    // time a wall broke cost ~40 ms a time in BATTLE (11-09, perf: a stall a broken wall). Each time, only which squares are open
    // grass is read.
    if (!this.tuftAt) {
      this.tuftAt = [];
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const list = [];
        if (g.terrainAt(x, y) === Terrain.Land) for (let k = 0; k < TUFTS_PER_SQUARE; k++) {
          const px = x + 0.12 + r(x, y, k) * 0.76, pz = y + 0.12 + r(y, x, k + 5) * 0.76;
          if (this.sdf(px, pz) < 0.85) continue;                       // the sand band
          if (this.noise(px * 0.45 + 20, pz * 0.45 - 7) < 0.42) continue;  // tufts grow in clumps, with open lawn between
          const size = Math.round((0.75 + r(x + 3, y, k) * 0.6) * 100); // 0.75..1.35 as hundredths
          list.push([px, this.groundAtPoint(px, pz) - 0.01, pz, size * 2 * Math.PI + r(x, y + 9, k) * 2 * Math.PI * 0.999]);
        }
        this.tuftAt.push(list);
      }
    }
    let n = 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (g.occupantAt(x, y) !== Occupant.Empty || g.terrainAt(x, y) !== Terrain.Land) continue;
      for (const t of this.tuftAt[y * this.w + x]) {
        if (n >= TUFT_CAP) throw new RangeError('board.js: more grass tufts than TUFT_CAP (' + TUFT_CAP + '): a board bigger than the largest generated map');
        d[n * 4] = t[0]; d[n * 4 + 1] = t[1]; d[n * 4 + 2] = t[2]; d[n * 4 + 3] = t[3];
        n++;
      }
    }
    this.look.tuftAttr.needsUpdate = true;
    this.look.tufts.count = n; this.look.tufts.visible = n > 0;
  }

  // ------------------------------------------------------------------ decoration (no square of the rules)
  /** Rocks, bushes, oak islets, and (UC-L1) towers on rock islets, houses with barrels on sand islets and barrels on a lagoon's
   *  rim, ONLY where nothing the rules move or place can ever be, read from the rules
   *  (core/match/MatchModel.js):
   *  - a ship can be on ANY water square joined to the board's edge: it is born on an edge square (_spawnWave), sails over water,
   *    4-connected (_actShip, PathRules.nextStep), and a lander heads for any water square beside land (_shoreWater). So no water
   *    square joined to the edge is decorated, and the sand band of the coast is on LAND squares (where walls, cannons, grunts and
   *    heroes go), so it is not either.
   *  - a grunt lands and walks on land squares only (_landGrunt, _actGrunt).
   *  What is left: a LAGOON (water no edge square reaches: no ship can ever enter it), whose rim gets bushes and small rocks low
   *  enough to hide nothing, and the open sea OUTSIDE the board (ships never leave the board), where rocks stand off the north, east
   *  and west coasts and a few carry an oak. Nothing is put south of the board: the camera looks from the south, so something
   *  there would stand in front of the ships on the board's south edge. Seeded by the board's own squares, so each map has its own
   *  and the same map always has the same. */
  buildDecor() {
    const g = this.grid, w = this.w, h = this.h, D = this.decorParts;
    let seed = 2166136261;                                        // FNV-1a over the terrain: one seed per map
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { seed ^= g.terrainAt(x, y) + 1; seed = Math.imul(seed, 16777619); }
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    // the water a ship can reach: every water square 4-joined to a water square on the board's edge
    const water = (x, y) => g.terrainAt(x, y) === Terrain.Water, reach = new Uint8Array(w * h), q = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && water(x, y)) { reach[y * w + x] = 1; q.push(y * w + x); }
    for (let i = 0; i < q.length; i++) {
      const c = q[i], x = c % w, y = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || reach[ny * w + nx] || !water(nx, ny)) continue;
        reach[ny * w + nx] = 1; q.push(ny * w + nx);
      }
    }
    const items = { bush: [], rockSmall: [], rockLarge: [], oak: [], tower: [], houseA: [], houseB: [], barrel: [], islet: [] };
    const put = (kind, x, z, y, scale) => items[kind].push({ x, z, y, scale, turn: rnd() * Math.PI * 2 });
    // lagoon squares: water the flood did not reach. A rim square (land beside it) gets a bush or a small rock now and then.
    let lagoon = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!water(x, y) || reach[y * w + x]) continue;
      lagoon++;
      let rim = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!wet(g.terrainAt(x + dx, y + dy))) rim = true;
      if (!rim || rnd() > 0.45) continue;
      const px = x + 0.25 + rnd() * 0.5, pz = y + 0.25 + rnd() * 0.5;
      const r = rnd();
      if (r < 0.15) put('barrel', px, pz, -0.08, 0.9 + rnd() * 0.2);              // a barrel washed up on the lagoon's rim
      else put(r < 0.6 ? 'bush' : 'rockSmall', px, pz, -0.04, 0.8 + rnd() * 0.4);
    }
    // the sea outside the board: off the north, east and west edges, 1.5 to 4.5 squares out
    const side = [];
    for (let x = 0; x < w; x += 3) side.push([x + rnd() * 3, -1.5 - rnd() * 3]);
    for (let y = 0; y < h; y += 3) { side.push([-1.5 - rnd() * 3, y + rnd() * 3]); side.push([w + 1.5 + rnd() * 3, y + rnd() * 3]); }
    // AUTHORED (UC-L1): at most TOWERS towers on rock islets and HOUSES sand islets with a house and two barrels; the heights put
    // a tower's foot and a house's floor on the islet's top (rockLarge fitted 1.2 wide: its top ~0.45 over the sea; ISLET_TOP)
    const TOWERS = 3, HOUSES = 3, ISLET_TOP = 0.12;
    let oaks = 0, towers = 0, houses = 0;
    for (const [px, pz] of side) {
      const r = rnd();
      if (r < 0.46) continue;                                     // about half the places stay open sea
      if (r < 0.56 && oaks < 4) { put('rockLarge', px, pz, -0.35, 1); put('oak', px, pz, 0.45, 0.8 + rnd() * 0.3); oaks++; }
      else if (r < 0.64 && towers < TOWERS) { put('rockLarge', px, pz, -0.35, 1.05); put('tower', px, pz, 0.38, 0.9 + rnd() * 0.2); towers++; }
      else if (r < 0.72 && houses < HOUSES) {
        put('islet', px, pz, 0, 1);
        put(houses % 2 ? 'houseB' : 'houseA', px, pz, ISLET_TOP, 0.95 + rnd() * 0.1);
        const a = rnd() * Math.PI * 2;
        for (const k of [0, 1]) put('barrel', px + Math.cos(a + k * 0.5) * 0.95, pz + Math.sin(a + k * 0.5) * 0.95, ISLET_TOP, 0.9 + rnd() * 0.2);
        houses++;
      }
      else if (r < 0.84) put('rockLarge', px, pz, -0.3, 0.7 + rnd() * 0.5);
      else put('rockSmall', px, pz, -0.08, 0.8 + rnd() * 0.6);
    }
    // the scenery never moves, so each kind is BAKED: every copy of a part merged into one geometry, one mesh per part of the kind
    // whatever the count (UC-L1, 11-09: the houses, towers and barrels as one plain mesh per part per copy were ~40 more draws a
    // frame, and perf_battle measured 53 fps against 55 before; baked, the whole scenery is a draw per part). The parts' materials
    // are the renderer's, so the shaders are the ones its warm-up built.
    this.decor = {};
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const kind of Object.keys(items)) {
      const list = items[kind];
      if (!D[kind]) throw new Error('board.js: no decoration parts for ' + kind);
      this.decor[kind] = list.length;
      if (!list.length) continue;
      for (const part of D[kind]) {
        const copies = list.map((it) => {
          qt.setFromAxisAngle(up, it.turn); m.compose(new THREE.Vector3(it.x, it.y, it.z), qt, new THREE.Vector3(it.scale, it.scale, it.scale));
          return part.geometry.clone().applyMatrix4(m);
        });
        const geo = copies.length === 1 ? copies[0] : mergeGeometries(copies, false);
        if (!geo) throw new Error('board.js: the ' + kind + ' scenery would not merge');
        if (copies.length > 1) for (const c of copies) c.dispose();
        const mesh = new THREE.Mesh(geo, part.material);
        mesh.castShadow = DECOR_CASTS.has(kind); mesh.receiveShadow = true; mesh.name = 'decor ' + kind;
        this.group.add(mesh);
      }
    }
    this.decor.lagoonSquares = lagoon;
  }

  /** A player slot's colour; a slot the match does not have is an error, never a stand-in colour. */
  colourOf(slot) {
    const c = this.colours[slot];
    if (!c) throw new Error('board.js: no player in slot ' + slot + ' (the match has ' + this.colours.length + ')');
    return c;
  }

  /** UC-P2: the territory as DRAWN - every square the fill texture colours (alpha > 0), [x, y, owner slot] - for the page check
   *  to hold cell for cell against the model's EnclosureRules. */
  displayedTerritory() {
    const out = [], d = this.fillData;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = y * this.w + x;
      if (d[i * 4 + 3] > 0) out.push([x, y, this.territory ? this.territory.mainOwner(this.territory.regionAt(x, y)) : -1]);
    }
    return out;
  }

  drawTerritory(dt) {
    const t = this.territory, w = this.w, g = this.grid, d = this.fillData, f = this.flashData;
    let flashing = false, changed = false, scorching = false;
    const put = (k, v) => { if (d[k] !== v) { d[k] = v; changed = true; } };   // the fill is uploaded only when a byte of it changed
    for (let y = 0; y < this.h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, r = t ? t.regionAt(x, y) : 0, owner = r > 0 ? t.mainOwner(r) : -1;
      if (owner >= 0 && g.occupantAt(x, y) !== Occupant.Wall) {
        const c = this.colourOf(owner);
        put(i * 4, c.r * 255 | 0); put(i * 4 + 1, c.g * 255 | 0); put(i * 4 + 2, c.b * 255 | 0); put(i * 4 + 3, 150);
      } else put(i * 4 + 3, 0);
      // the capture sweep: a bright front as it passes, then a glow that fades over FLASH_SECONDS
      const e = this.now - this.flashAt[i];
      let v = 0;
      if (e < FLASH_SECONDS && this.flashAt[i] > -1e8) { flashing = true; if (e >= 0) v = Math.exp(-(e * e) / 0.015) + 0.45 * (1 - e / FLASH_SECONDS) ** 2; }
      f[i * 4] = Math.round(255 * Math.min(1, v));
      if (this.scorch[i] > 0) { this.scorch[i] = Math.max(0, this.scorch[i] - dt / SCORCH_SECONDS); scorching = true; }
      f[i * 4 + 1] = Math.round(255 * this.scorch[i]);
    }
    if (changed || !this._filled) { this.fillTex.needsUpdate = true; this._filled = true; }
    this.scorchClock = (this.scorchClock ?? 0) + dt;
    const scorchDue = (scorching || this._wasScorching) && this.scorchClock >= SCORCH_UPLOAD;   // a fading scorch: 10 uploads a second
    if (flashing || this._wasFlashing || scorchDue) { this.flashTex.needsUpdate = true; this.scorchClock = 0; this._wasScorching = scorching; }
    this._wasFlashing = flashing;
  }

  update(dt, seconds, repairK) {
    this.look.uTime.value = seconds;
    this.now = seconds;
    this.look.uGrid.value = repairK;
    this.sync(dt);
  }

  /** The bounds of the land, in squares: what the camera frames. */
  landBounds() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.land[y * this.w + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < 0) return { x0: 0, y0: 0, x1: this.w, y1: this.h };
    return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }

  dispose() {
    this.scene.remove(this.group);
    // the model parts are the renderer's, shared by every level: disposing them here destroyed buffers the next level still drew
    // with (11-08: "[Buffer] used in submit while destroyed" x500 after a second match started)
    const shared = new Set();
    for (const parts of [...this.propParts.values(), ...Object.values(this.decorParts)]) for (const p of parts) shared.add(p.geometry);
    this.group.traverse((o) => { if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose(); });
    for (const t of [this.fillTex, this.flashTex, this.sdfTex]) t.dispose();
  }
}
