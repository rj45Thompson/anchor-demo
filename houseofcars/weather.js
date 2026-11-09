// weather.js - UC-40: rain falling past the camera, a wet road, and light shafts through the haze, ported from Elami (the
// owner's Unity game). Its rain is the Lana Studio pack's Rain_heavy weather sheet (the one Elami's GodrayRain VFX nests) and its
// screen-space light shafts are OccaSoftware LSPP's EstimateLightScattering, with the settings Elami's LSPPGodRayLive.cs gave it,
// plus the page's changes (RAYS) that make shafts out of it under the track's high sun (opts.pure turns them off).
// Every number READ from Elami names its file; research/ELAMI_RAIN_GODRAYS.md has the whole reading. Everything else is AUTHORED
// (the page's own choice) and says so where it is set.
//
// The lead wires it in (app.js / fx.js makePost); this file changes nothing on its own. Five parts:
//   buildRain(THREE, opts) -> { group, update(camera, dt), setAmount(a), budget }   streaks around the camera, ONE draw call
//   wetRoad(THREE, material, opts) -> { wetness, undo() }                            a node material made wet, reversibly
//   sunTracker(THREE, light) -> { ndc, dirView, proj, near, far, lightColor, update(camera) }   the sun on screen, per frame
//   godRays(THREE, sceneColor, sun, opts) -> node                                    LSPP's light scattering as a TSL post node
//   overcast(THREE, skyMaterial, opts) -> { amount, undo() }                        the clear sky greyed for a rain day (AUTHORED)
// Like scenery.js, the three/webgpu namespace comes from the caller and its node functions from THREE.TSL, so the pure parts
// (no three, no DOM) run in node: test/weather.test.mjs.

// ---------------------------------------------------------------- READ from Elami (D:/code/Tami/Tami/Assets, files named)
const PACK = 'Lana Studio/Environment VFX pack';
export const ELAMI = {
  rain: {                                             // Prefabs/Rain/Rain_heavy.prefab, emitter "Rain_heavy"
    src: PACK + '/Prefabs/Rain/Rain_heavy.prefab (emitter Rain_heavy; nested by Media/VFX/GodrayRain/GodrayRain.prefab)',
    speed: 30,                                        // InitialModule.startSpeed
    size: 0.09,                                       // InitialModule.startSize
    lifetime: 3,                                      // InitialModule.startLifetime
    alpha: 0.28235295,                                // InitialModule.startColor (white)
    colour: [1, 1, 1],
    fadeInFrac: 0.114,                                // ColorModule alpha keys: 0 at t 0, 1 at t 0.114, 1 at t 1
    rate: 150,                                        // EmissionModule.rateOverTime
    radius: 15, height: 20,                           // ShapeModule: Cone, angle 0, radius 15, position y 20, aimed down
    lengthScale: 1, velocityScale: 0.05,              // ParticleSystemRenderer: Stretched Billboard (m_RenderMode 1)
    cameraVelocityScale: 0,                           // ParticleSystemRenderer.m_CameraVelocityScale
    wind: [0, 0, 0],                                  // no Velocity, Force or Noise module is enabled
    discRadius: 0.656,                                // Textures/Circle04.png: an opaque disc, edge at x 22 of the 128 px centre row
    material: 'Materials/Alpha_Blended.mat (a built-in shader, fileID 10721: its name and blend are UNRESOLVED from files; the blend here follows the material NAME)',
  },
  rings: {                                            // the same prefab, emitter "Rings" (one per drop that hits)
    src: PACK + '/Prefabs/Rain/Rain_heavy.prefab (emitter Rings) + Textures/Circle03.png',
    lifetime: [0.2, 0.3],                             // InitialModule.startLifetime (random between)
    size: [1.0, 1.5],                                 // InitialModule.startSize (Horizontal Billboard)
    alpha: 0.5686275,                                 // InitialModule.startColor
    sizeCurve: [0.063, 1],                            // SizeModule: 0.063 at t 0 -> 1 at t 1
    fadeFrom: 0.466,                                  // ColorModule alpha: 1 until t 0.466, 0 at t 1
    ring: { inner: 0.47, peak: 0.72, outer: 0.94, peakAlpha: 84 / 255 },   // Circle03.png centre-row profile (of the half size)
  },
  lspp: {                                             // Assets/LSPPGodRayTool/Editor/LSPPGodRayLive.cs:33-36 + 98-101: values Elami
    src: 'LSPPGodRayTool/Editor/LSPPGodRayLive.cs (values Elami AUTHORED) + Packages/com.occasoftware.lspp (the algorithm)',  // AUTHORED
    fogDensity: 0.9,                                  // the render pass passes fogDensity * 0.1 (LightScatteringRenderPass.cs:247)
    samples: 32,
    maxRayDistance: 0.9,
    falloffIntensity: 2.0,
    tint: [1, 0.96, 0.88],
    softenScreenEdges: true,
    lightMustBeOnScreen: false,
    occlusionAssumption: 0, occlusionOverDistanceAmount: 1,   // the package defaults (LightScatteringPostProcess.cs:46, :51)
    falloffBasis: 'ray',                              // the package default, FalloffBasis.RayDirection (:43); its other value is
                                                      // the camera's forward direction ('camera', LightScattering.hlsl's else branch)
    skyFrom: 0.9,                                     // Occluders.shader: step(0.9, Linear01Depth) - sky is where depth is past 90 %
  },
};

// ---------------------------------------------------------------- the page's own choices (AUTHORED)
export const RAIN = {
  box: [44, 26, 44],            // the volume of drops around the camera (m): Elami's sheet is a 15 m disc 20 m up, not a moving camera's
  boxUp: 7,                     // the volume's centre this far above the camera, so little of it lies under the road
  drops: { high: 7000, low: 3500 },   // low halves it
  edgeFade: [0.72, 1.0],        // drops fade out over the outer 28 % of the box's half width (no pop where they wrap)
  nearFade: [0.6, 2.2],         // ...and within 0.6-2.2 m of the eye (a drop on the lens would be a white bar across the view)
  width: 0.012,                 // m: the streak's width. Elami's (READ size 0.09 x the disc's 0.656 = 0.059 m) is drawn for a tactics
                                //   camera 10-20 m from the rain; inside the rain it is a 25 px bar at 2 m, so the page's is thinner
  minAngle: 0.0011,             // a streak is never drawn narrower than this many radians (~1 px at 1080 p), its alpha thinned instead
  camVelSmooth: 0.08,           // s: the camera's velocity, smoothed (a chase camera's frame-to-frame jitter would shake every streak)
  teleport: 200,                // m/s: faster than this is a cut, not motion (the velocity is reset)
  // the streak is the drop's motion RELATIVE TO THE CAMERA over Elami's velocityScale (0.05 s), the camera's share scaled by this
  // (Elami's camera stands still: its cameraVelocityScale 0 (READ) and this are the same streak when the camera is still). At 1 a
  // car at 70 m/s drew a 3.7 m streak per drop, every one pointing at the vanishing point: a starfield (shots 11-07)
  cameraShare: 0.3,
  maxLength: 2.6,               // m: no streak longer than this
};
export const WET = {
  darken: 0.62,                 // wet albedo = dry x this
  roughness: 0.3,               // a water film on asphalt
  puddle: { scale: 0.11, lo: 0.18, hi: 0.42, darken: 0.55, roughness: 0.035 },   // noise per m, its threshold band, then the puddle's look
};
export const RIPPLE = {
  cell: 0.6,                    // m: one drop lands in each cell per period
  period: 0.55,                 // s
  size: 0.34,                   // m: the ring's size at the end of its life (Elami's 1-1.5 is a tactics-map scale; see the research note)
  tilt: 0.8,                    // how far a ring tilts the surface normal (what makes it catch the sky)
  roughen: 0.25,                // and how much it breaks the film's gloss
  fadeFrom: 14, fadeTo: 32,     // m from the eye: rings this far off would only shimmer
};
// LSPP with Elami's settings alone (opts.pure) is a flat haze here (looked at 11-07, shots/weather_rays_pure.png): the track's
// sun stands 61 deg up (READ, data/track_lights.json), far above the top of a racing camera's frame, so 3/4 of each march ran off
// the screen, where softenScreenEdges counts it as open sky, and occlusionOverDistanceAmount 1 lit the rest; and raising its gain
// only washed the picture out (shots/weather_rays_pure_gain6.png: hazed trees, the shafts no clearer). The page's changes:
export const RAYS = {
  gain: 6,                      // x LSPP's scattered light
  marchCap: 0.8,                // the march never runs further than this across the screen (UV), so the samples stay on it
  // a shaft keeps its shadow all the way along the ray; and the density is weighed by the CAMERA's direction to the sun (LSPP's
  // other falloff basis), not each pixel's: by the pixel's ray, a 61 deg sun gave the road (rays 60-85 deg off it) nothing
  overrides: { occlusionOverDistanceAmount: 0, falloffBasis: 'camera' },
  contrast: 3,                  // the lit fraction of the march is raised to this power: half-lit rays fall to 13 %, beams stand out
  near: 0.85,                   // ...and that fraction weighs each sample by near^i (at 32 samples; 'low' squares it), so what stands
                                //   right above a pixel decides it: a tree's own crown stays dark instead of glowing beige
  skyKeep: 0.3,                 // a pixel that is itself sky keeps this much (its own glow is already in the sky's Mie term)
  air: [0.5, 100],              // light scattered in front of a surface grows with the air before it: [at 0 m, the 1/e distance (m)],
                                //   so a tree 20 m off is not lit beige by the haze (it was, shots 11-07) while the beams over the road stay
};
export const QUALITY = {
  high: { drops: RAIN.drops.high, raySamples: ELAMI.lspp.samples, puddleOctaves: 3, ripples: true },
  low: { drops: RAIN.drops.low, raySamples: ELAMI.lspp.samples / 2, puddleOctaves: 1, ripples: true },   // "low halves everything"
};
const q = (quality) => {
  const Q = QUALITY[quality || 'high'];
  if (!Q) throw new Error('weather.js: no quality "' + quality + '" (high, low)');
  return Q;
};

// ---------------------------------------------------------------- pure parts (test/weather.test.mjs)
export function makeRng(seed) {                        // mulberry32: deterministic drops
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Unity's stretched billboard: length = size x lengthScale + speed x velocityScale (along the velocity), width = size
export const streakLength = (speed, size = ELAMI.rain.size, lengthScale = ELAMI.rain.lengthScale, velocityScale = ELAMI.rain.velocityScale) =>
  size * lengthScale + speed * velocityScale;
// drops per m^3 of a sheet that spawns `rate` a second over a disc of `radius`, falling at `speed`: flux / speed
export const sheetDensity = (rate, radius, speed) => rate / (Math.PI * radius * radius) / speed;
export function rainBudget(quality) {
  const Q = q(quality), [bx, by, bz] = RAIN.box, vol = bx * by * bz, density = Q.drops / vol;
  const elami = sheetDensity(ELAMI.rain.rate, ELAMI.rain.radius, ELAMI.rain.speed);
  return { drops: Q.drops, drawCalls: 1, triangles: Q.drops * 2, vertices: Q.drops * 4, volume_m3: vol, density, elamiDensity: elami,
    vsElami: density / elami, raySamples: Q.raySamples };
}
// the fall since time 0, wrapped into the box per axis (kept small on the CPU so the GPU never adds a huge offset)
export function wrapOffset(t, vel, box) {
  return [0, 1, 2].map((k) => { const v = vel[k] * t, b = box[k]; return v - b * Math.floor(v / b); });
}
// the shader's wrap, on the CPU: a drop at p (seed x box + offset) shown at the copy of it nearest the box's centre `o`
export function wrapToBox(p, o, box) {
  return [0, 1, 2].map((k) => { const a = p[k] - o[k] + box[k] / 2; return a - box[k] * Math.floor(a / box[k]) - box[k] / 2; });
}
// the streak mesh: 4 vertices a drop, every vertex of a drop carrying the drop's seed (0..1)^3; corner x -1/1 across, y 0/1 along
export function streakGeometryData(count, seed = 4040) {
  const rng = makeRng(seed), seeds = new Float32Array(count * 12), corners = new Float32Array(count * 8);
  const index = count * 4 > 65535 ? new Uint32Array(count * 6) : new Uint16Array(count * 6);
  const C = [-1, 0, 1, 0, 1, 1, -1, 1];
  for (let i = 0; i < count; i++) {
    const s = [rng(), rng(), rng()];
    for (let v = 0; v < 4; v++) { seeds.set(s, (i * 4 + v) * 3); corners[(i * 4 + v) * 2] = C[v * 2]; corners[(i * 4 + v) * 2 + 1] = C[v * 2 + 1]; }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  return { seeds, corners, index };
}
// one ripple at life fraction t (0..1): the ring's radius as a fraction of the ring's end size, and its alpha (READ curves)
export function ringAt(t) {
  const R = ELAMI.rings, s = R.sizeCurve[0] + (R.sizeCurve[1] - R.sizeCurve[0]) * t;
  const fade = t <= R.fadeFrom ? 1 : Math.max(0, (1 - t) / (1 - R.fadeFrom));
  return { radius: 0.5 * s * R.ring.peak, alpha: t < 0 || t > 1 ? 0 : R.alpha * fade };
}
// the sun on screen, from the camera's view and projection matrices (three.js column-major arrays) and the direction TO the sun.
// As LSPP does it (LightScattering.hlsl): the light's view-space direction projected as a point (w 1); behind the camera w < 0.
export function sunScreen(view, proj, toSun) {
  const d = [0, 1, 2].map((r) => view[r] * toSun[0] + view[4 + r] * toSun[1] + view[8 + r] * toSun[2]);
  const n = Math.hypot(d[0], d[1], d[2]); for (let k = 0; k < 3; k++) d[k] /= n;
  const cx = proj[0] * d[0] + proj[4] * d[1] + proj[8] * d[2] + proj[12];
  const cy = proj[1] * d[0] + proj[5] * d[1] + proj[9] * d[2] + proj[13];
  const cw = proj[3] * d[0] + proj[7] * d[1] + proj[11] * d[2] + proj[15];
  const ndc = [cx / cw, cy / cw];
  return { ndc, uv: [ndc[0] * 0.5 + 0.5, ndc[1] * 0.5 + 0.5], w: cw, dirView: d, focal: [proj[0], proj[5]] };
}
// LSPP's EstimateLightScattering (Packages/com.occasoftware.lspp/Shaders/Resources/LightScattering.hlsl), on the CPU, for one
// pixel: the reference the TSL node below is written from. occ(u, v) is the occluder texture (1 = sky). Returns [r, g, b].
// uv runs UP (LSPP's / GL's); o overrides any ELAMI.lspp setting; o.marchCap, o.contrast, o.near, o.skyKeep are the page's (RAYS),
// none of them by default, so with no o this is LSPP exactly.
export function lsppScatter(uv, occ, sun, light, o = {}) {
  const L = { ...ELAMI.lspp, ...o };
  const density0 = L.fogDensity * 0.1, N = L.samples, maxRay = L.maxRayDistance, cap = o.marchCap ?? Infinity;
  const ndc = [uv[0] * 2 - 1, uv[1] * 2 - 1];
  const ray = L.falloffBasis === 'camera' ? [0, 0, -1] : [ndc[0] / sun.focal[0], ndc[1] / sun.focal[1], -1], rl = Math.hypot(...ray);
  const dot = (ray[0] * sun.dirView[0] + ray[1] * sun.dirView[1] + ray[2] * sun.dirView[2]) / rl;
  const density = density0 * Math.pow(Math.min(Math.max(dot, 0), 1), L.falloffIntensity);
  if (density <= 0.001) return [0, 0, 0];
  const d0 = [sun.ndc[0] - ndc[0], sun.ndc[1] - ndc[1]], kc = Math.min(1, cap / maxRay / Math.max(Math.hypot(d0[0], d0[1]), 1e-4));
  const dir = [d0[0] * kc, d0[1] * kc], step = maxRay / N, r = o.noise ?? 0;
  const off = [r * dir[0] * step, r * dir[1] * step];
  const k = density * step / maxRay, col = [0, 0, 0], full = [0, 0, 0], nearK = Math.pow(o.near ?? 1, 32 / N); let alpha = 1, litW = 0, allW = 0, wN = 1;
  for (let i = 0; i < N; i++) {
    const sp = [uv[0] + dir[0] * step * i + off[0], uv[1] + dir[1] * step * i + off[1]];
    const decay = Math.exp(-density * step * i / maxRay);
    let oc = L.occlusionAssumption;
    if (sp[0] > 0 && sp[1] > 0 && sp[0] < 1 && sp[1] < 1) oc = occ(sp[0], sp[1]);
    if (L.softenScreenEdges) {
      const sm = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
      const adj = Math.max(sm(0.9, 1, Math.abs(sp[0] * 2 - 1)), sm(0.9, 1, Math.abs(sp[1] * 2 - 1)));
      oc = oc + (1 - oc) * adj;
    }
    oc = oc + (1 - oc) * (i / N) * L.occlusionOverDistanceAmount;
    for (let c = 0; c < 3; c++) { col[c] += light[c] * L.tint[c] * k * alpha * oc; full[c] += light[c] * L.tint[c] * k * alpha; }
    litW += wN * oc; allW += wN; wN *= nearK;
    alpha *= decay;
  }
  if (o.contrast === undefined) return col;
  const lit = Math.min(Math.max(litW / Math.max(allW, 1e-6), 0), 1), keep = occ(uv[0], uv[1]) >= 1 ? (o.skyKeep ?? 1) : 1;
  return full.map((f) => f * Math.pow(lit, o.contrast) * keep);
}

// ---------------------------------------------------------------- the rain (one draw call)
// Drops are world-fixed (you drive through them), spread through a box that follows the camera: each drop's position is its seed
// times the box plus the fall since time 0, shown at its copy nearest the box's centre, so the box never empties however fast the
// camera goes. Each drop is a quad stretched along its velocity relative to the camera (Elami's stretched billboard), faded in over
// the first 11.4 % of its fall through the box (Elami's alpha curve), and out near the box's sides and the eye (AUTHORED).
export function buildRain(THREE, opts = {}) {
  const T = THREE.TSL, Q = q(opts.quality), E = ELAMI.rain;
  const count = opts.drops ?? Q.drops;
  const box = RAIN.box, half = box.map((v) => v / 2);
  const g = streakGeometryData(count, opts.seed ?? 4040);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 12), 3));   // unused: the shader places every vertex
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 12), 3));     // unlit: the zeros three put in its place,
                                                                                               // without its console warning a compile
  geo.setAttribute('seed', new THREE.BufferAttribute(g.seeds, 3));
  geo.setAttribute('corner', new THREE.BufferAttribute(g.corners, 2));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));

  const wind = opts.wind ?? E.wind;
  const vel = [wind[0], -E.speed, wind[2]];
  const uCam = T.uniform(new THREE.Vector3()), uCamVel = T.uniform(new THREE.Vector3()), uOffset = T.uniform(new THREE.Vector3());
  const uAmount = T.uniform(1);
  const vVel = T.vec3(...vel), vBox = T.vec3(...box), vHalf = T.vec3(...half);
  const seed = T.attribute('seed', 'vec3'), corner = T.attribute('corner', 'vec2');

  const origin = uCam.add(T.vec3(0, RAIN.boxUp, 0));
  const a = seed.mul(vBox).add(uOffset).sub(origin).add(vHalf);
  const rel = a.sub(vBox.mul(T.floor(a.div(vBox)))).sub(vHalf);              // wrapped into [-half, half) (no mod: WGSL's % truncates)
  const centre = origin.add(rel);
  const relVel = vVel.sub(uCamVel.mul(RAIN.cameraShare));
  const speed = T.max(T.length(relVel), 0.001);
  const len = T.min(speed.mul(E.velocityScale).add(E.size * E.lengthScale), RAIN.maxLength);   // Unity: size x lengthScale + |v| x velocityScale
  const axis = relVel.div(speed).mul(len);
  const toEye = uCam.sub(centre), dist = T.max(T.length(toEye), 0.001);
  const side = T.normalize(T.cross(axis, toEye));
  const wVis = opts.width ?? RAIN.width;                                       // AUTHORED (see RAIN.width)
  const w = T.max(dist.mul(RAIN.minAngle), wVis);
  const pos = centre.add(axis.mul(corner.y.sub(0.5))).add(side.mul(corner.x.mul(w).mul(0.5)));
  const life = vHalf.y.sub(rel.y).div(box[1]);                                 // 0 entering the top of the box, 1 leaving the bottom
  const fadeIn = T.clamp(life.div(E.fadeInFrac), 0, 1);                       // READ curve
  const edge = T.oneMinus(T.smoothstep(RAIN.edgeFade[0], RAIN.edgeFade[1], T.max(T.abs(rel.x).div(half[0]), T.abs(rel.z).div(half[2]))));
  const near = T.smoothstep(RAIN.nearFade[0], RAIN.nearFade[1], dist.sub(len.mul(0.5)));   // the streak's nearest end, not its middle
  const vAlpha = T.varying(fadeIn.mul(edge).mul(near).mul(T.float(wVis).div(w)), 'v_rainAlpha');

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.NormalBlending });
  mat.forceSinglePass = true;                                                  // a transparent double-sided material is otherwise 2 draws
  mat.positionNode = T.modelWorldMatrixInverse.mul(T.vec4(pos, 1)).xyz;
  const across = T.oneMinus(corner.x.mul(corner.x));                          // AUTHORED: a soft profile (the disc's hard edge aliases)
  const along = T.smoothstep(0, 0.18, corner.y).mul(T.smoothstep(1, 0.82, corner.y));   // the stretched disc's rounded ends
  mat.colorNode = T.vec3(...(opts.colour ?? E.colour)).mul(opts.brightness ?? 1);
  mat.opacityNode = vAlpha.mul(across).mul(along).mul(E.alpha).mul(uAmount);
  mat.name = 'weather-rain';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 20; mesh.name = 'weather-rain';
  const group = new THREE.Group(); group.name = 'weather'; group.add(mesh);

  const last = new THREE.Vector3(), now = new THREE.Vector3(), v = new THREE.Vector3();
  let t = 0, have = false;
  function update(camera, dt) {
    camera.getWorldPosition(now);
    if (have && dt > 0) {
      v.copy(now).sub(last).divideScalar(dt);
      if (v.length() > RAIN.teleport) { v.set(0, 0, 0); uCamVel.value.set(0, 0, 0); }
      uCamVel.value.lerp(v, 1 - Math.exp(-dt / RAIN.camVelSmooth));
    }
    last.copy(now); have = true;
    t += dt > 0 ? dt : 0;
    uCam.value.copy(now);
    uOffset.value.fromArray(wrapOffset(t, vel, box));
  }
  function setAmount(x) {                              // 0..1: fewer drops drawn (cheaper), not fainter ones
    const k = Math.min(Math.max(x, 0), 1);
    geo.setDrawRange(0, Math.round(count * k) * 6);
    group.visible = k > 0;
  }
  return { group, update, setAmount, budget: { ...rainBudget(opts.quality), drops: count }, uniforms: { camPos: uCam, camVel: uCamVel, offset: uOffset, amount: uAmount } };
}

// ---------------------------------------------------------------- the wet road
// Wraps the material's own colour and roughness (its nodes, or its color / map / roughness when it has none): darker, glossier,
// with puddles where a broad noise crosses a threshold (darker still, near-mirror), and rain rings in the film (Elami's Rings:
// their life, size curve, fade and ring profile READ; their size on a road and their density AUTHORED). `wetness` (a uniform,
// 0..1) fades it all; undo() puts the material back exactly as it was. Needs the scene's environment map to reflect (both of the
// page's tracks have one: fx.js physicalSky).
export function wetRoad(THREE, mat, opts = {}) {
  const T = THREE.TSL, Q = q(opts.quality), R = ELAMI.rings;
  if (!mat || !mat.isNodeMaterial) throw new Error('weather.js wetRoad: a node material is required (MeshStandardNodeMaterial / MeshPhysicalNodeMaterial)');
  if (!('roughness' in mat)) throw new Error('weather.js wetRoad: ' + (mat.name || mat.type) + ' has no roughness to wet');
  const saved = { colorNode: mat.colorNode, roughnessNode: mat.roughnessNode, normalNode: mat.normalNode };
  const wet = opts.wetness ?? T.uniform(1);
  const P = T.positionWorld;

  const n = Q.puddleOctaves > 1
    ? T.mx_fractal_noise_float(P.mul(T.vec3(WET.puddle.scale, 0, WET.puddle.scale)), Q.puddleOctaves, 2.0, 0.5)
    : T.mx_noise_float(P.mul(T.vec3(WET.puddle.scale, 0, WET.puddle.scale)));
  const puddle = T.smoothstep(WET.puddle.lo, WET.puddle.hi, n).mul(wet);

  const base = T.vec4(saved.colorNode ?? T.materialColor);
  const k = T.mix(1, WET.darken, wet).mul(T.mix(1, WET.puddle.darken, puddle));
  mat.colorNode = T.vec4(base.rgb.mul(k), base.a);

  let rough = T.mix(T.mix(saved.roughnessNode ?? T.materialRoughness, WET.roughness, wet), WET.puddle.roughness, puddle);
  if (Q.ripples) {
    const cellP = P.xz.div(RIPPLE.cell), id = T.floor(cellP), f = T.fract(cellP);
    const h = (x, y) => T.fract(T.sin(T.dot(id, T.vec2(x, y))).mul(43758.5453));
    const h1 = h(12.9898, 78.233), h2 = h(39.3468, 11.1351), h3 = h(73.156, 52.235);
    const c = T.vec2(h1, h2).mul(0.4).add(0.3);                                // the drop lands in the cell's middle 40 %
    const life = T.mix(R.lifetime[0], R.lifetime[1], h3);                      // READ
    const age = T.fract(T.time.div(RIPPLE.period).add(h3)).mul(RIPPLE.period);
    const t = age.div(life);
    const sizeK = T.mix(R.sizeCurve[0], R.sizeCurve[1], T.clamp(t, 0, 1));     // READ size curve
    const Rr = sizeK.mul(RIPPLE.size * 0.5);                                   // the ring's half size now (m)
    const dv = f.sub(c).mul(RIPPLE.cell), d = T.length(dv);
    const ring = T.smoothstep(Rr.mul(R.ring.inner), Rr.mul(R.ring.peak), d).mul(T.oneMinus(T.smoothstep(Rr.mul(R.ring.peak), Rr.mul(R.ring.outer), d)));
    const fade = T.clamp(T.oneMinus(t).div(1 - R.fadeFrom), 0, 1);           // READ: 1 until 0.466, to 0 at 1
    const alive = T.step(t, 1);
    const far = T.oneMinus(T.smoothstep(RIPPLE.fadeFrom, RIPPLE.fadeTo, T.length(T.cameraPosition.sub(P))));   // no shimmer far off
    const ripple = ring.mul(fade).mul(alive).mul(R.alpha).mul(wet).mul(far);  // READ start alpha; the ring profile is the shape
    const slope = T.sign(d.sub(Rr.mul(R.ring.peak)));                          // the ring's two flanks tilt opposite ways
    const radial = T.vec3(dv.x, 0, dv.y).div(T.max(d, 1e-4));
    const tiltW = radial.mul(slope).mul(ripple).mul(RIPPLE.tilt);
    const baseN = saved.normalNode ?? ((mat.normalMap || mat.bumpMap) ? T.materialNormal : T.normalView);
    mat.normalNode = T.normalize(baseN.add(T.cameraViewMatrix.mul(T.vec4(tiltW, 0)).xyz));
    rough = rough.add(ripple.mul(RIPPLE.roughen));
  }
  mat.roughnessNode = T.clamp(rough, 0.02, 1);
  mat.needsUpdate = true;
  let undone = false;
  return {
    wetness: wet,
    undo() {
      if (undone) throw new Error('weather.js wetRoad: undo() called twice on ' + (mat.name || mat.type));
      Object.assign(mat, saved); mat.needsUpdate = true; undone = true;
    },
  };
}

// ---------------------------------------------------------------- a rain day's sky (AUTHORED: Elami's rain has no sky of its own)
// The page's sky (fx.js physicalSky, three.js SkyMesh) is a clear one; under rain it is greyed and dimmed. Takes the sky mesh's
// node material (physicalSky(...).mesh.material: its fragmentNode) and returns { amount (uniform 0..1), undo() }. Only what the
// camera sees changes: the paint and the wet road reflect physicalSky's env map, made once from the clear sky, so a grey
// reflection needs that env rebuilt from this sky (test/weather_view.html does it with a PMREM of its own).
export const OVERCAST = { grey: [0.8, 0.84, 0.9], dim: 0.8, amount: 0.8 };
export function overcast(THREE, skyMaterial, opts = {}) {
  const T = THREE.TSL;
  if (!skyMaterial || !skyMaterial.fragmentNode) throw new Error('weather.js overcast: the sky material has no fragmentNode (fx.js physicalSky\'s SkyMesh has one)');
  const saved = skyMaterial.fragmentNode, amount = opts.amount ?? T.uniform(OVERCAST.amount);
  const c = T.vec4(saved), grey = T.luminance(c.rgb);
  const out = T.mix(c.rgb, T.vec3(...OVERCAST.grey).mul(grey), amount).mul(T.mix(1, OVERCAST.dim, amount));
  skyMaterial.fragmentNode = T.vec4(out, c.a);
  skyMaterial.needsUpdate = true;
  let undone = false;
  return { amount, undo() { if (undone) throw new Error('weather.js overcast: undo() called twice'); skyMaterial.fragmentNode = saved; skyMaterial.needsUpdate = true; undone = true; } };
}

// ---------------------------------------------------------------- the sun on screen (what godRays reads)
// light: the scene's DirectionalLight (its direction = position - target, its colour x intensity is what LSPP scatters: URP's
// mainLight.color). update(camera) once a frame, before rendering.
export function sunTracker(THREE, light) {
  const T = THREE.TSL;
  if (!light || !light.isDirectionalLight) throw new Error('weather.js sunTracker: a DirectionalLight is required');
  const S = {
    ndc: T.uniform(new THREE.Vector2()), dirView: T.uniform(new THREE.Vector3(0, 0, -1)), proj: T.uniform(new THREE.Vector2(1, 1)),
    near: T.uniform(0.1), far: T.uniform(3000), lightColor: T.uniform(new THREE.Color()), uv: [0.5, 0.5], w: 1,
  };
  const toSun = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  S.update = (camera) => {
    camera.updateMatrixWorld();
    light.getWorldPosition(a); light.target.getWorldPosition(b);
    toSun.copy(a).sub(b).normalize();
    const r = sunScreen(camera.matrixWorldInverse.elements, camera.projectionMatrix.elements, toSun.toArray());
    S.ndc.value.set(r.ndc[0], r.ndc[1]); S.dirView.value.fromArray(r.dirView); S.proj.value.set(r.focal[0], r.focal[1]);
    S.near.value = camera.near; S.far.value = camera.far;
    S.lightColor.value.copy(light.color).multiplyScalar(light.intensity);
    S.uv = r.uv; S.w = r.w;
    return r;
  };
  return S;
}

// ---------------------------------------------------------------- light shafts: LSPP as a TSL post node
// sceneColor: the scene pass's colour (fx.js makePost: scenePass.getTextureNode('output')); sun: a sunTracker; opts.depth: the
// same pass's depth (scenePass.getTextureNode('depth')), REQUIRED: LSPP's occluders are the pixels nearer than 90 % of the far
// plane. Returns sceneColor + the scattered light (vec4). The march is LSPP's, line for line (see lsppScatter above): N samples
// toward the light's screen position over maxRayDistance of the way, each unoccluded sample adding density x light colour x tint,
// the density weighted by how close the pixel's own view ray is to the sun (pow(dot, falloffIntensity)). Cost: opts.samples depth
// reads a pixel (32 at 'high', 16 at 'low'), at full resolution (LSPP renders at half and upsamples; not ported).
export function godRays(THREE, sceneColor, sun, opts = {}) {
  const T = THREE.TSL, Q = q(opts.quality), pure = opts.pure === true;
  const L = { ...ELAMI.lspp, ...(pure ? {} : RAYS.overrides), ...opts };
  if (!opts.depth) throw new Error('weather.js godRays: opts.depth (the scene pass depth texture node) is required');
  if (!sun || !sun.ndc) throw new Error('weather.js godRays: a sunTracker is required');
  const N = opts.samples ?? Q.raySamples, maxRay = L.maxRayDistance, step = maxRay / N;
  const gain = opts.gain ?? (pure ? 1 : RAYS.gain), cap = pure ? Infinity : (opts.marchCap ?? RAYS.marchCap);
  const depthTex = opts.depth;
  const scatter = T.Fn(() => {
    // three's post quad uv() runs DOWN the screen (v 0 at the top, measured 11-07: the falloff came out upside down with uv() taken
    // as GL's); LSPP's UV runs up. The march is done in LSPP's UV (U) and every texture read flips back.
    const uvDown = T.uv(), uv0 = T.vec2(uvDown.x, T.oneMinus(uvDown.y));
    const ndc = uv0.mul(2).sub(1);
    const ray = L.falloffBasis === 'camera' ? T.vec3(0, 0, -1) : T.normalize(T.vec3(ndc.x.div(sun.proj.x), ndc.y.div(sun.proj.y), -1));
    if (L.falloffBasis !== 'camera' && L.falloffBasis !== 'ray') throw new Error('weather.js godRays: falloffBasis is ray or camera, not ' + L.falloffBasis);
    const density = T.float(L.fogDensity * 0.1).mul(T.pow(T.saturate(T.dot(sun.dirView, ray)), L.falloffIntensity));
    const dir0 = sun.ndc.sub(ndc);
    const dir = cap === Infinity ? dir0 : dir0.mul(T.min(1, T.float(cap / maxRay).div(T.max(T.length(dir0), 1e-4))));
    // the march's start offset: LSPP's sin hash (pure), or (AUTHORED) interleaved gradient noise on the pixel grid, whose even
    // spread shows as a fine weave instead of the hash's sand once the page's contrast power is applied
    const px = uvDown.mul(T.screenSize);
    const r = opts.noise === false ? T.float(0) : pure ? T.fract(T.sin(T.dot(uv0, T.vec2(12.9898, 78.233))).mul(43758.5453))
      : T.fract(T.fract(T.dot(px, T.vec2(0.06711056, 0.00583715))).mul(52.9829189));
    const off = dir.mul(r.mul(step));
    const illum = T.vec3(sun.lightColor).mul(T.vec3(...L.tint)).mul(density).mul(step / maxRay);
    const col = T.vec3(0).toVar(), full = T.vec3(0).toVar(), alpha = T.float(1).toVar();
    const litW = T.float(0).toVar(), allW = T.float(0).toVar(), wNear = T.float(1).toVar();
    const nearK = Math.pow(opts.near ?? RAYS.near, 32 / N);
    T.Loop(N, ({ i }) => {
      const fi = T.float(i);
      const sp = uv0.add(dir.mul(fi.mul(step))).add(off);
      const inside = T.step(0, sp.x).mul(T.step(0, sp.y)).mul(T.step(sp.x, 1)).mul(T.step(sp.y, 1));
      const z = depthTex.sample(T.clamp(T.vec2(sp.x, T.oneMinus(sp.y)), 0, 1)).r;
      const lin01 = T.perspectiveDepthToViewZ(z, sun.near, sun.far).negate().div(sun.far);
      const occ = T.mix(T.float(L.occlusionAssumption), T.step(L.skyFrom, lin01), inside).toVar();
      if (L.softenScreenEdges) {
        const adj = T.smoothstep(0.9, 1.0, T.abs(sp.mul(2).sub(1)));
        occ.assign(T.mix(occ, 1, T.max(adj.x, adj.y)));
      }
      occ.assign(T.mix(occ, 1, fi.div(N).mul(L.occlusionOverDistanceAmount)));
      col.addAssign(illum.mul(alpha).mul(occ));
      full.addAssign(illum.mul(alpha));
      litW.addAssign(wNear.mul(occ)); allW.addAssign(wNear); wNear.mulAssign(nearK);
      alpha.mulAssign(T.exp(density.negate().mul(step).mul(fi).div(maxRay)));
    });
    let out = col;
    if (!pure) {
      const lit = T.saturate(litW.div(T.max(allW, 1e-6)));                  // the lit fraction of this pixel's march, near samples first
      const self = T.step(L.skyFrom, T.perspectiveDepthToViewZ(depthTex.r, sun.near, sun.far).negate().div(sun.far));
      const eye = T.perspectiveDepthToViewZ(depthTex.r, sun.near, sun.far).negate();
      const air = opts.air ?? RAYS.air, airK = T.mix(air[0], 1, T.oneMinus(T.exp(eye.div(-air[1]))));
      out = full.mul(T.pow(lit, opts.contrast ?? RAYS.contrast)).mul(T.mix(airK, opts.skyKeep ?? RAYS.skyKeep, self));
      if (opts.debug === 'lit') out = T.vec3(lit);
    }
    return T.select(density.greaterThan(0.001), out, T.vec3(0));
  });
  const s = scatter();
  if (opts.debug === 'occluders') return T.vec4(T.vec3(T.step(L.skyFrom, T.perspectiveDepthToViewZ(depthTex.r, sun.near, sun.far).negate().div(sun.far))), 1);
  if (opts.debug === 'scatter') return T.vec4(s.mul(gain * 4), 1);
  if (opts.debug === 'lit') return T.vec4(s, 1);
  if (opts.debug === 'tap') {                       // the occluder seen by march sample opts.tap (no noise, no soften): it must be
    const uvDown = T.uv(), u = T.vec2(uvDown.x, T.oneMinus(uvDown.y)), n = u.mul(2).sub(1), d0 = sun.ndc.sub(n);   // the mask moved toward the sun
    const d = cap === Infinity ? d0 : d0.mul(T.min(1, T.float(cap / maxRay).div(T.max(T.length(d0), 1e-4))));
    const sp = u.add(d.mul((opts.tap ?? 8) * step));
    const z = depthTex.sample(T.clamp(T.vec2(sp.x, T.oneMinus(sp.y)), 0, 1)).r;
    return T.vec4(T.vec3(T.step(L.skyFrom, T.perspectiveDepthToViewZ(z, sun.near, sun.far).negate().div(sun.far))), 1);
  }
  return T.vec4(sceneColor.rgb.add(s.mul(gain)), sceneColor.a);
}

// ---------------------------------------------------------------- light shafts as scene geometry: Elami's GodRayShaft
// What Elami ships for god rays is not the LSPP post above but Assets/Art/Shaders/GodRayShaft.shader ("Tami/GodRayShaft"), whose
// header records that it REPLACED the LSPP post process, "which RJ killed on look": additive quads in the scene (Blend SrcAlpha One,
// ZWrite Off, Cull Off), each brightest at its light end and fading along its length, feathered at its sides, faded as it turns
// edge-on and faded where it meets the scene (the soft-particle depth fade, the term RJ singled out: "the difference between god ray
// and glowing cardboard"). Its axis is the scene sun's (BlockTilePainterWindow.Lighting.cs ResolveShaftAxis, auto-orient: the light's
// forward), its quad turned about that axis toward the camera (PlaceGodRayShaft's double cross product). The shape terms and the
// look below are READ; Elami turns a shaft to the camera once, when it is placed, and the page does it every frame, since its
// camera drives past them (AUTHORED, the same construction).
// The look is GodrayRain's shaft (the VFX whose rain is ported above: "heavy rain + a god ray"), not the Lighting tab's starting
// shaft (DefaultShaft: falloff 1.6, brightest at its top), which looked at on the strip 11-08 (shots/shafts_default_*.png) was a
// glow in the sky above the frame and nothing by the road: GodrayRain's falloff 0.35 "stays bright most of its length".
export const SHAFT = {                                // Media/VFX/GodrayRain/GodrayRain_Shaft.mat = GodrayRainRules.cs:71-79
  src: 'Media/VFX/GodrayRain/GodrayRain_Shaft.mat (values Elami AUTHORED, GodrayRainRules.cs:71-79) + Art/Shaders/GodRayShaft.shader (the terms)',
  colour: [1, 0.97, 0.8], intensity: 1.6, falloff: 0.35, topFade: 0.12, edgeFade: 0.25, depthFade: 1.0, viewFadePower: 1.2,
};
export const SHAFTS = {                               // AUTHORED: the page's shafts over the strip
  every: 20, from: -12, to: 580,  // m along the strip: a row every 20 m from behind the start line to past the finish
  across: [-30, 30],              // m: where a shaft lands across the strip (it is 24 m wide); one each side of the centre line a row
  width: [2, 5], length: [42, 64],   // m: Elami's 1.6 x 10 is sized to its 1 m tile under a tactics camera. 5-9 m wide read as
                                  //   columns of fog, not shafts (looked at 11-08, shots/shafts_tune1_sheet.png)
  intensity: 1.0,                 // x SHAFT.intensity
  nearFade: [3, 12],              // m from the eye: a shaft the camera drives through fades out instead of washing the screen
  farFade: [90, 260],             // m: and the far ones go into the haze (the scene's fog is not applied to an additive quad). Out to
                                  //   520 m the rows down the strip piled up into one white glow at its end (shots/shafts_tune1_sheet.png)
};
// where each shaft lands and its size: rows along the strip, one each side of the centre line, seeded -> [{ x, z, width, length }]
export function shaftPlaces(opts = {}) {
  const S = { ...SHAFTS, ...opts }, rnd = makeRng(opts.seed ?? 1108), out = [];
  const lerp = (r, a, b) => a + (b - a) * r;
  for (let x = S.from; x <= S.to; x += S.every) for (const side of [-1, 1]) {
    out.push({ x: x + lerp(rnd(), -0.4, 0.4) * S.every, z: side * lerp(rnd(), 2, Math.abs(S.across[side < 0 ? 0 : 1])),
               width: lerp(rnd(), ...S.width), length: lerp(rnd(), ...S.length) });
  }
  return out;
}
// the shafts' geometry, four corners a shaft (pure): base (the landing point), corner (u across 0..1, v 0 at the ground to 1 at the
// light end, GodRayShaft's v), size (width, length)
export function shaftGeometryData(places) {
  const n = places.length, base = new Float32Array(n * 12), corner = new Float32Array(n * 8), size = new Float32Array(n * 8), index = new Uint32Array(n * 6);
  const C = [0, 0, 1, 0, 1, 1, 0, 1];
  places.forEach((p, i) => {
    for (let k = 0; k < 4; k++) { base.set([p.x, 0, p.z], i * 12 + k * 3); size.set([p.width, p.length], i * 8 + k * 2); }
    corner.set(C, i * 8); index.set([0, 1, 2, 0, 2, 3].map((j) => j + i * 4), i * 6);
  });
  return { base, corner, size, index };
}
// buildShafts(THREE, { light, places? }) -> { mesh, update(camera), places }: ONE draw call for every shaft. light: the scene's
// DirectionalLight (the axis: from its target back toward it). update(camera) once a frame, before rendering.
export function buildShafts(THREE, opts = {}) {
  const T = THREE.TSL, S = SHAFT, A = { ...SHAFTS, ...(opts.shafts || {}) };
  const light = opts.light;
  if (!light || !light.isDirectionalLight) throw new Error('weather.js buildShafts: the scene\'s DirectionalLight is required (the shafts\' axis)');
  const places = opts.places ?? shaftPlaces(opts);
  if (!places.length) throw new Error('weather.js buildShafts: no places to put a shaft');
  const g = shaftGeometryData(places);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(places.length * 12), 3));   // unused: the shader places them
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(places.length * 12), 3));     // unlit (as the rain's)
  geo.setAttribute('base', new THREE.BufferAttribute(g.base, 3));
  geo.setAttribute('corner', new THREE.BufferAttribute(g.corner, 2));
  geo.setAttribute('size', new THREE.BufferAttribute(g.size, 2));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));

  const uUp = T.uniform(new THREE.Vector3(0, 1, 0)), uSide0 = T.uniform(new THREE.Vector3(1, 0, 0)), uCam = T.uniform(new THREE.Vector3());
  const base = T.modelWorldMatrix.mul(T.vec4(T.attribute('base', 'vec3'), 1)).xyz, corner = T.attribute('corner', 'vec2'), size = T.attribute('size', 'vec2');
  const mid = base.add(uUp.mul(size.y.mul(0.5)));
  const across = T.cross(uUp, uCam.sub(mid));                                  // PlaceGodRayShaft: side = up x view, normal = side x up
  const side = T.normalize(across.add(uSide0.mul(1e-4)));                      // ...never degenerate: looking straight up a shaft
  const normal = T.normalize(T.cross(side, uUp));
  const pos = base.add(side.mul(corner.x.sub(0.5).mul(size.x))).add(uUp.mul(corner.y.mul(size.y)));
  const vNormal = T.varying(normal, 'v_shaftNormal'), vCorner = T.varying(corner, 'v_shaftCorner');

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending });
  mat.forceSinglePass = true;
  mat.positionNode = T.modelWorldMatrixInverse.mul(T.vec4(pos, 1)).xyz;
  const u = vCorner.x, v = vCorner.y;
  // GodRayShaft frag, term by term
  const top = T.smoothstep(1, 1 - S.topFade - 1e-4, v);
  const along = T.pow(T.saturate(v), S.falloff).mul(S.topFade > 0.0001 ? top : 1);
  const edge = T.smoothstep(0, S.edgeFade, u).mul(T.smoothstep(0, S.edgeFade, T.oneMinus(u)));
  const toEye = uCam.sub(T.positionWorld), dist = T.length(toEye);
  const viewFade = T.pow(T.saturate(T.abs(T.dot(T.normalize(vNormal), toEye.div(T.max(dist, 1e-4))))), S.viewFadePower);
  const sceneZ = T.perspectiveDepthToViewZ(T.viewportDepthTexture(T.screenUV).x, T.cameraNear, T.cameraFar).negate();
  const depthFade = T.saturate(sceneZ.sub(T.positionView.z.negate()).div(S.depthFade));
  // the page's two (AUTHORED, see SHAFTS)
  const near = T.smoothstep(A.nearFade[0], A.nearFade[1], dist), far = T.oneMinus(T.smoothstep(A.farFade[0], A.farFade[1], dist));
  mat.colorNode = T.vec3(...S.colour).mul(S.intensity * A.intensity);
  mat.opacityNode = T.saturate(along.mul(edge).mul(viewFade).mul(depthFade).mul(near).mul(far));
  mat.name = 'weather-shafts';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 19; mesh.name = 'weather-shafts';
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function update(camera) {
    light.getWorldPosition(a); light.target.getWorldPosition(b);
    uUp.value.copy(a).sub(b).normalize();                                      // from the ground back toward the sun
    uSide0.value.set(1, 0, 0).cross(uUp.value); if (uSide0.value.lengthSq() < 1e-8) uSide0.value.set(0, 0, 1).cross(uUp.value); uSide0.value.normalize();
    camera.getWorldPosition(uCam.value);
  }
  return { mesh, update, places, uniforms: { up: uUp, cam: uCam } };
}
