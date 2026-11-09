// board.js - the island and everything that stands on its squares: the land (a heightfield with gentle relief and a sand edge),
// the animated sea with shoreline foam, the territory fill painted into the land in each owner's colour (flashing when a ring
// closes), the walls (one toy block per square, each placed PIECE wrapped in a glowing outline in its owner's colour), and the
// props on the squares (rubble, rocks, trees, houses, pits, graveyards). It reads the model's GridModel and nothing else; every
// change is found by comparing the board's bytes with the last frame's, so a view can never drift from the rules.
import * as THREE from 'three/webgpu';
import { texture, uniform, vertexColor, positionWorld, positionLocal, vec2, vec3, vec4, float, mix, smoothstep, sin, fract, min, max, abs, step, clamp,
         normalize, dot, reflect, pow, cameraPosition, transformNormalToView, mrt, cos, positionGeometry,
         instancedBufferAttribute } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Terrain, Occupant, EnclosureRules, PieceMap, WallOutline, WallsPlaced, RingBuilt } from '../core/index.js';
import { C, SKY, NEUTRAL_WALL, mats, glowing, tuftGeometry, TUFT_H, makeNoiseTexture, NOISE_SLOPE, makeNoise, InstancedBatch, PropSet, pitGeometry, rubbleGeometry, graveGeometry } from './look.js';

export const MARGIN = 12;              // AUTHORED: squares of sea drawn round the board, so the island never sits on a hard edge
const SUB = 4;                         // AUTHORED: land vertices per square (the coast is smooth, not stepped)
const TUFTS_PER_SQUARE = 3;            // AUTHORED: grass tufts on each open grass square
const TUFT_CAP = 52 * 34 * TUFTS_PER_SQUARE;   // the largest generated map (app/maps.js) full of grass
const SDF_RANGE = 8;                   // the distance texture holds -8..+8 squares
const WALL_H = 0.5, WALL_W = 0.9;      // AUTHORED: a wall block, in squares
const FLASH_SECONDS = 1.4;             // AUTHORED: how long a square glows after the capture sweep's front passed it
const SWEEP_SPEED = 9;                 // AUTHORED: squares per second the capture glow runs out from the castle
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
  constructor() {
    this.uTime = uniform(0); this.uGrid = uniform(0); this.uWaterDetail = uniform(1); this.uSize = uniform(new THREE.Vector2(1, 1));
    const unbound = () => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; };
    this.noiseTex = makeNoiseTexture();
    this.fillNode = texture(unbound()); this.flashNode = texture(unbound()); this.sdfNode = texture(unbound());
    this.land = this.makeLand();
    this.sea = this.makeSea();
    this.tufts = this.makeTufts();
  }

  /** Grass tufts: ONE mesh drawn instanced (Mesh.count), each tuft's place, turn and size in an instanced vertex attribute, so a
   *  level only rewrites the attribute (no InstancedMesh, whose matrices would sit in a uniform buffer capped at 1000; no new shader
   *  per level). They lean with a breeze that grows toward the blade tips. TUFT_CAP covers the largest generated map (app/maps.js:
   *  52 x 34 squares) at TUFTS_PER_SQUARE; a board that would need more is an error in Board.drawTufts, never a silent cut. */
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
    const fill = this.fillNode.uv(cellUv), fl = this.flashNode.uv(cellUv);
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
    const ripple = sin(P.x.mul(5.2).add(P.y.mul(2.3)).add(nz(P.mul(0.06).add(0.61)).r.mul(6.4))).mul(0.5).add(0.5);
    const grain = nz(P.mul(1.7)).a.mul(2).sub(1);
    const sand = vc.mul(ripple.mul(0.06).add(0.97)).mul(grain.mul(0.05).add(1));
    const base = mix(sand, grass, grassy);
    const tint = mix(base, fill.rgb.mul(0.62).add(0.3), fill.a.mul(inBoard));   // a light wash of the owner's colour, not a dark stain
    // a faint square grid on the land, eased in while pieces are being placed (REPAIR) so a square is easy to aim at
    const gx = fract(positionWorld.x), gz = fract(positionWorld.z);
    const edge = min(min(gx, gx.oneMinus()), min(gz, gz.oneMinus()));
    const line = smoothstep(0.045, 0.0, edge).mul(this.uGrid).mul(inBoard).mul(smoothstep(0.03, 0.1, positionWorld.y));
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, flatShading: false });
    m.colorNode = tint.mul(float(1).sub(line.mul(0.28)));
    m.emissiveNode = fill.rgb.mul(fl.r).mul(inBoard).mul(2.2);
    return m;
  }

  makeSea() {
    const M = MARGIN;
    const t = this.uTime, q = this.uWaterDetail;
    const P = positionWorld.xz;
    const suv = P.add(M).div(this.uSize.add(2 * M));
    const sdfN = this.sdfNode.uv(suv).r.mul(2 * SDF_RANGE).sub(SDF_RANGE);
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
    const sky = mix(vec3(SKY.horizon.r, SKY.horizon.g, SKY.horizon.b), vec3(SKY.zenith.r, SKY.zenith.g, SKY.zenith.b), smoothstep(0.05, 0.7, R.y));
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
   *  @param decorParts { bush, rockSmall, rockLarge, oak }: the decoration's model parts (buildDecor) */
  constructor(scene, grid, colours, propParts, decorParts, look) {
    if (!(look instanceof BoardLook)) throw new Error('board.js: the shared BoardLook is required');
    this.look = look;
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
    this.buildField();
    this.buildLand();
    this.buildSea();
    this.buildWalls();
    this.buildProps();
    this.buildDecor();
    this.sync(0, true);
  }

  // ------------------------------------------------------------------ the shape of the island
  /** Signed distance to the coast in squares (+ on land, - at sea), from the board's squares, with a little noise so the coast is
   *  not stepped. The noise is at most a quarter square, so a land square's centre is always on land and a sea square's at sea. */
  buildField() {
    const { w, h, grid } = this;
    const land = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) land[y * w + x] = wet(grid.terrainAt(x, y)) ? 0 : 1;
    this.land = land;
    const isLand = (x, y) => x >= 0 && y >= 0 && x < w && y < h && land[y * w + x] === 1;
    // the squares on either side of the coast: only they can be the nearest of the other kind
    const coastLand = [], coastSea = [];
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      const me = isLand(x, y);
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (isLand(x + dx, y + dy) !== me) edge = true;
      if (edge) (me ? coastLand : coastSea).push([x, y]);
    }
    const boxDist = (px, pz, list) => {
      let best = 1e9;
      for (const [x, y] of list) {
        const dx = Math.max(Math.abs(px - (x + 0.5)) - 0.5, 0), dz = Math.max(Math.abs(pz - (y + 0.5)) - 0.5, 0);
        const d = dx * dx + dz * dz; if (d < best) best = d;
      }
      return Math.sqrt(best);
    };
    this.sdf = (px, pz) => {
      const x = Math.floor(px), y = Math.floor(pz);
      const raw = isLand(x, y) ? boxDist(px, pz, coastSea) : -boxDist(px, pz, coastLand);
      if (coastLand.length === 0) return -SDF_RANGE;
      return raw + (this.noise(px * 0.45, pz * 0.45) - 0.5) * 0.45;
    };
    // the lattice the land mesh and the sea's distance texture share
    const M = MARGIN, lw = (w + 2 * M) * SUB + 1, lh = (h + 2 * M) * SUB + 1;
    const field = new Float32Array(lw * lh);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const px = -M + i / SUB, pz = -M + j / SUB;
      field[j * lw + i] = coastLand.length === 0 ? -SDF_RANGE : this.sdf(px, pz);
    }
    this.lattice = { lw, lh, field };
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
    const span = 400;                                                 // the sea runs past every camera's edge
    const geo = new THREE.PlaneGeometry(span, span, 160, 160); geo.rotateX(-Math.PI / 2); geo.translate(w / 2, 0, h / 2);
    this.look.bindSea(sdfTex);
    const m = this.look.sea;
    this.sea = new THREE.Mesh(geo, m); this.sea.receiveShadow = true; this.sea.name = 'sea';
    this.group.add(this.sea);
  }

  // ------------------------------------------------------------------ walls and props
  buildWalls() {
    const n = this.w * this.h;
    const geo = new RoundedBoxGeometry(WALL_W, WALL_H, WALL_W, 2, 0.07); geo.translate(0, WALL_H / 2, 0);
    this.walls = new InstancedBatch(this.group, geo, mats.wall, n, { colors: true, castShadow: true, receiveShadow: true, name: 'walls' });
    // the outline: thin glowing bars on every outer edge of a piece (WallOutline), coloured by the piece's owner
    const cap = n * 12;
    const bar = new THREE.BoxGeometry(1, 1, 1);
    const glowMat = glowing(new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.6, 2.6, 2.6) }));
    this.outline = new InstancedBatch(this.group, bar, glowMat, cap, { colors: true, name: 'wall outline' });
  }

  buildProps() {
    const n = this.w * this.h;
    // what the rules leave behind (rubble, a burning pit, a graveyard) is this game's own procedural shapes; the land a map names
    // (trees, houses, small and large rocks) is drawn with the CC-BY models
    const kinds = [[Occupant.Rubble, rubbleGeometry()], [Occupant.Pit, pitGeometry()], [Occupant.Graveyard, graveGeometry()]];
    this.props = new Map();
    for (const [occ, geo] of kinds) {
      this.props.set(occ, new InstancedBatch(this.group, geo, mats.vc, n, { castShadow: true, receiveShadow: true, name: 'props ' + occ }));
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
      if (e instanceof WallsPlaced || e instanceof RingBuilt) this.pieces.shown(e);
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
        props = true;
        s.occ[i] = o; s.own[i] = ow; s.hp[i] = hp; s.ter[i] = t;
      }
    }
    if (walls) { this.drawWalls(); this.territory = EnclosureRules.map(g); }
    if (props) this.drawProps();
    this.drawTerritory(dt);
    return walls;
  }

  drawWalls() {
    const g = this.grid, w = this.w, h = this.h, m = new THREE.Matrix4(), c = new THREE.Color();
    const top = new Float32Array(w * h);
    let k = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (g.occupantAt(x, y) !== Occupant.Wall) continue;
      const ow = g.ownerAt(x, y), hp = g.healthAt(x, y), gy = this.groundAt(x, y);
      const sy = hp <= 1 ? 0.68 : 1;                                   // a damaged wall (one hit left) stands lower
      m.makeScale(1, sy, 1).setPosition(x + 0.5, gy - 0.04, y + 0.5);
      c.copy(ow < 4 ? this.colourOf(ow) : NEUTRAL_WALL).lerp(C.foam, 0.28);
      if (hp <= 1) c.multiplyScalar(0.72);
      this.walls.set(k, m, c);
      top[y * w + x] = gy - 0.04 + WALL_H * sy;
      k++;
    }
    this.walls.commit(k);
    // the outline (WallOutline.build): bars inset a hair into the block so they sit on its faces
    const edges = WallOutline.build(g, this.pieces), T = 0.045, IN = (1 - WALL_W) / 2;
    let e = 0;
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (const ed of edges) {
      const cx = ed.cell % w, cy = Math.floor(ed.cell / w), ow = g.ownerAt(cx, cy), base = this.groundAt(cx, cy) - 0.04, tp = top[ed.cell];
      c.copy(ow < 4 ? this.colourOf(ow) : NEUTRAL_WALL);
      if (ed.kind === WallOutline.Kind.Upright) {
        const ix = ed.x0 > cx ? -IN : IN, iz = ed.y0 > cy ? -IN : IN;
        p.set(ed.x0 + ix, (base + tp) / 2, ed.y0 + iz); sc.set(T, tp - base, T);
      } else {
        let x0 = ed.x0, z0 = ed.y0, x1 = ed.x1, z1 = ed.y1;
        if (ed.side === 0) { z0 += IN; z1 += IN; } else if (ed.side === 2) { z0 -= IN; z1 -= IN; }
        else if (ed.side === 1) { x0 -= IN; x1 -= IN; } else { x0 += IN; x1 += IN; }
        const yy = ed.kind === WallOutline.Kind.Top ? tp : base + 0.06;
        p.set((x0 + x1) / 2, yy, (z0 + z1) / 2);
        sc.set(Math.max(Math.abs(x1 - x0), T), T, Math.max(Math.abs(z1 - z0), T));
      }
      q.identity(); m.compose(p, q, sc);
      this.outline.set(e, m, c); e++;
    }
    this.outline.commit(e);
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
      im.set(k, m);
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
    let n = 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (g.occupantAt(x, y) !== Occupant.Empty || g.terrainAt(x, y) !== Terrain.Land) continue;
      for (let k = 0; k < TUFTS_PER_SQUARE; k++) {
        const px = x + 0.12 + r(x, y, k) * 0.76, pz = y + 0.12 + r(y, x, k + 5) * 0.76;
        if (this.sdf(px, pz) < 0.85) continue;                         // the sand band
        if (this.noise(px * 0.45 + 20, pz * 0.45 - 7) < 0.42) continue;    // tufts grow in clumps, with open lawn between
        if (n >= TUFT_CAP) throw new RangeError('board.js: more grass tufts than TUFT_CAP (' + TUFT_CAP + '): a board bigger than the largest generated map');
        const size = Math.round((0.75 + r(x + 3, y, k) * 0.6) * 100);   // 0.75..1.35 as hundredths
        d[n * 4] = px; d[n * 4 + 1] = this.groundAtPoint(px, pz) - 0.01; d[n * 4 + 2] = pz; d[n * 4 + 3] = size * 2 * Math.PI + r(x, y + 9, k) * 2 * Math.PI * 0.999;
        n++;
      }
    }
    this.look.tuftAttr.needsUpdate = true;
    this.look.tufts.count = n; this.look.tufts.visible = n > 0;
  }

  // ------------------------------------------------------------------ decoration (no square of the rules)
  /** Rocks, bushes and a few oak islets, ONLY where nothing the rules move or place can ever be, read from the rules
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
    const items = { bush: [], rockSmall: [], rockLarge: [], oak: [] };
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
      put(rnd() < 0.6 ? 'bush' : 'rockSmall', px, pz, -0.04, 0.8 + rnd() * 0.4);
    }
    // the sea outside the board: off the north, east and west edges, 1.5 to 4.5 squares out
    const side = [];
    for (let x = 0; x < w; x += 3) side.push([x + rnd() * 3, -1.5 - rnd() * 3]);
    for (let y = 0; y < h; y += 3) { side.push([-1.5 - rnd() * 3, y + rnd() * 3]); side.push([w + 1.5 + rnd() * 3, y + rnd() * 3]); }
    let oaks = 0;
    for (const [px, pz] of side) {
      const r = rnd();
      if (r < 0.5) continue;                                      // about half the places stay open sea
      if (r < 0.62 && oaks < 4) { put('rockLarge', px, pz, -0.35, 1); put('oak', px, pz, 0.45, 0.8 + rnd() * 0.3); oaks++; }
      else if (r < 0.8) put('rockLarge', px, pz, -0.3, 0.7 + rnd() * 0.5);
      else put('rockSmall', px, pz, -0.08, 0.8 + rnd() * 0.6);
    }
    this.decor = {};
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const kind of Object.keys(items)) {
      const list = items[kind];
      if (!D[kind]) throw new Error('board.js: no decoration parts for ' + kind);
      const set = new PropSet(this.group, D[kind], Math.max(1, list.length), { castShadow: true, receiveShadow: true, name: 'decor ' + kind });
      list.forEach((it, i) => { qt.setFromAxisAngle(up, it.turn); m.compose(new THREE.Vector3(it.x, it.y, it.z), qt, new THREE.Vector3(it.scale, it.scale, it.scale)); set.set(i, m); });
      set.commit(list.length);
      this.decor[kind] = list.length;
    }
    this.decor.lagoonSquares = lagoon;
  }

  /** A player slot's colour; a slot the match does not have is an error, never a stand-in colour. */
  colourOf(slot) {
    const c = this.colours[slot];
    if (!c) throw new Error('board.js: no player in slot ' + slot + ' (the match has ' + this.colours.length + ')');
    return c;
  }

  drawTerritory(dt) {
    const t = this.territory, w = this.w, g = this.grid, d = this.fillData, f = this.flashData;
    let flashing = false;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, r = t ? t.regionAt(x, y) : 0, owner = r > 0 ? t.mainOwner(r) : -1;
      if (owner >= 0 && g.occupantAt(x, y) !== Occupant.Wall) {
        const c = this.colourOf(owner);
        d[i * 4] = c.r * 255; d[i * 4 + 1] = c.g * 255; d[i * 4 + 2] = c.b * 255; d[i * 4 + 3] = 150;
      } else { d[i * 4 + 3] = 0; }
      // the capture sweep: a bright front as it passes, then a glow that fades over FLASH_SECONDS
      const e = this.now - this.flashAt[i];
      let v = 0;
      if (e < FLASH_SECONDS && this.flashAt[i] > -1e8) { flashing = true; if (e >= 0) v = Math.exp(-(e * e) / 0.015) + 0.45 * (1 - e / FLASH_SECONDS) ** 2; }
      f[i * 4] = Math.round(255 * Math.min(1, v));
    }
    this.fillTex.needsUpdate = true;
    if (flashing || this._wasFlashing) this.flashTex.needsUpdate = true;
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
