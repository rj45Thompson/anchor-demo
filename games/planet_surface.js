/* planet_surface.js - the machine world's SURFACE: geometry, shader, per-world metal.

   Loaded by BOTH resume-arkanoid.html (which flies over it) and _planetlab.html (which renders it
   at poses the game never takes). One file, because the difference between a displaced sphere and
   a painted ball is entirely in the silhouette, the game only ever looks straight down, and two
   copies of a look drift apart inside a day.

   Everything here is pure: no scene, no ship, no game state. It attaches to window.PLANET_SURFACE
   rather than to module scope, because the game is one big inline <script> and r128 examples are
   plain scripts too - adding a module boundary here would mean changing how everything loads. */
(function(){
'use strict';
/* ---------------------------------------------------------------- the plated sphere
   RJ 2026-09-07: "it looks like you just mapped the texture and didn't take any of the mesh at
   all ... for Cybertron it's just simply you're not using a mesh at all."

   Correct, and the screenshot said it in one detail: the LIMB WAS A PERFECT CIRCLE. The ground
   was SphereGeometry(1, 96, 64) - a smooth ball - wearing a colour map and a normal map. A normal
   map tilts shading INSIDE the silhouette; it cannot touch the silhouette. So at the horizon,
   where a machine world should be a skyline, there was a drawn arc, and no amount of better
   texture was ever going to fix that.

   The panels come from a CUBE projection, not from noise, and that choice is the whole look: a
   machine world reads as rectilinear plating, and smooth noise reads as sand dunes. Every vertex
   maps to one of six faces, lands in a panel on that face's grid, and takes:
     * that panel's own quantised height - terraces, not slopes;
     * a trench carved along the panel seams, deepest at the border;
     * a low-frequency drift so panels group into continents rather than salt-and-pepper;
     * fine chatter for greeble at the scale you actually fly.
   Flat-shaded (non-indexed, face normals) because facets ARE the low-poly machine read RJ asked
   for, and per-panel tint in a vertex colour, because one uTint over six different maps is what
   flattened six worlds into one grey-brown family.

   COST: 46,080 triangles built once at load (~40 ms here), zero per-frame work. The existing
   buildPlanetDetail already spends 2,160 instanced boxes; this is the cheaper half of the look
   and the half that carries the silhouette. */
function hash3(x, y, z){
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise3(x, y, z){          // trilinear value noise, no gradients: cheap and smooth enough
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf), w = zf*zf*(3-2*zf);
  const c = (a,b,d) => hash3(xi+a, yi+b, zi+d);
  const x00 = c(0,0,0)*(1-u) + c(1,0,0)*u, x10 = c(0,1,0)*(1-u) + c(1,1,0)*u;
  const x01 = c(0,0,1)*(1-u) + c(1,0,1)*u, x11 = c(0,1,1)*(1-u) + c(1,1,1)*u;
  return ((x00*(1-v) + x10*v) * (1-w) + (x01*(1-v) + x11*v) * w) * 2 - 1;
}
function fbm3(x, y, z, oct){
  let s = 0, a = 0.5, f = 1;
  for(let i = 0; i < oct; i++){ s += a * vnoise3(x*f, y*f, z*f); f *= 2.03; a *= 0.5; }
  return s;
}
/* Which of the six cube faces a direction belongs to, and where on that face. This is what makes
   the plating rectilinear instead of blobby, and it is seamless by construction: two vertices on
   opposite sides of a face border get different panel ids but the SAME trench, because the trench
   is a function of distance to the border, which is continuous across it. */
function cubeFace(d){
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if(ax >= ay && ax >= az) return { f: d.x > 0 ? 0 : 1, u: d.y / ax, v: d.z / ax };
  if(ay >= az)             return { f: d.y > 0 ? 2 : 3, u: d.z / ay, v: d.x / ay };
  return                          { f: d.z > 0 ? 4 : 5, u: d.x / az, v: d.y / az };
}
let PLATE_GRID   = 20;     // panels across one cube face. Swept in _planetlab: 11 gave continent-
                           // sized terraces that read as a staircase; 20 puts a plate at roughly
                           // a city block at the altitude you actually fly.
let PLATE_STEPS  = 7;      // how many discrete terrace heights a panel can take
let PLATE_AMP    = 0.032;  // total relief as a fraction of R. Swept: 0.055 read as a pile of
                           // bricks, 0.020 lost the jagged limb that is the whole point. Small
                           // either way - a planet is mostly round.
let TRENCH_W     = 0.11;   // fraction of a panel taken by the seam
function plateHeight(dx, dy, dz, out){
  const F = cubeFace({x:dx, y:dy, z:dz});
  const pu = (F.u * 0.5 + 0.5) * PLATE_GRID, pv = (F.v * 0.5 + 0.5) * PLATE_GRID;
  const cu = Math.floor(pu), cv = Math.floor(pv);
  // this panel's own height, quantised: terraces, never a ramp
  const r = hash3(cu + F.f * 97, cv + F.f * 31, F.f * 13 + 5);
  const drift = fbm3(dx * 1.7, dy * 1.7, dz * 1.7, 3);      // continents of high and low plating
  let step = Math.floor((r * 0.62 + (drift * 0.5 + 0.5) * 0.38) * PLATE_STEPS) / (PLATE_STEPS - 1);
  // the seam: distance to the nearest panel border, carved down hard so plate edges catch light
  const eu = Math.min(pu - cu, 1 - (pu - cu)), ev = Math.min(pv - cv, 1 - (pv - cv));
  const edge = Math.min(eu, ev);
  const trench = 1 - Math.min(1, edge / TRENCH_W);
  const greeble = fbm3(dx * 26, dy * 26, dz * 26, 2) * 0.07;
  if(out){ out.step = step; out.trench = trench; out.panel = r; }
  return (step - 0.5) * 0.62 - trench * trench * 0.85 + greeble;
}
/* A displaced, flat-shaded sphere. Displacement is biased DOWNWARD from 1.0 (the raised terraces
   only reach +0.012R while trenches cut to -0.05R) on purpose: the army, the flak batteries and
   the launchers are all placed at exactly R by surfaceToBoard, so a surface that mostly rose above
   1.0 would swallow them. */
function plateSphere(seg, rings){
  const g = new THREE.SphereGeometry(1, seg, rings);
  const pos = g.attributes.position, n = pos.count;
  const info = { step:0, trench:0, panel:0 };
  const col = new Float32Array(n * 3);
  for(let i = 0; i < n; i++){
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const L = Math.hypot(x, y, z) || 1; x /= L; y /= L; z /= L;
    const h = plateHeight(x, y, z, info);
    const r = 1 + h * PLATE_AMP;
    pos.setXYZ(i, x * r, y * r, z * r);
    // per-panel metal tint. A raised, clean panel is brighter and cooler; a trench floor is dark
    // and warmer, because that is where the furnace light and the rust live.
    const lift = 0.72 + info.step * 0.45 - info.trench * 0.42;
    const warm = 0.10 * (info.panel - 0.5) + info.trench * 0.22;
    col[i*3] = lift * (1 + warm); col[i*3+1] = lift; col[i*3+2] = lift * (1 - warm * 0.7);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const flat = g.toNonIndexed();          // facets: the low-poly machine read, not a smooth ball
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

const WORLDS = {
  forge:    0xd8c8b8,
  circuit:  0xc2d2d8,
  reactor:  0xc6d4d8,
  derelict: 0xd6c4b4,
  citadel:  0xcac2d8,
  glacier:  0xd2dae2,
};

/* THE PLANET SHADER - RJ 2026-09-06: "make it shiny and a cool shader for the planet, make it
   dark with lights that twinkle emissive."

   A standard material could not do the last part: the twinkle has to come from the surface
   itself, per pixel, in the dark parts of the plating and strongest on the night side. So the
   ground gets its own program:
     * dark steel base from the drawn map, with the normal map folded in through the sphere's
       own tangent frame (no tangent attribute needed on a sphere - the frame is derivable);
     * a hard specular lobe, so the plating catches the key light as a moving highlight;
     * a reflection of the nebula cubemap, weighted by fresnel - this is what actually makes it
       read as polished metal rather than painted metal;
     * CITY LIGHTS: a hash per cell decides which cells are lit and how fast they blink, the
       mask is gated to the DARK parts of the map (the canyons between plates, never the plate
       faces), and the whole thing brightens as the surface turns away from the light. */
const PLANET_VERT = `
  varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vC; varying vec3 vD;
  /* Do NOT declare the color attribute here. vertexColors:true makes three.js define USE_COLOR
     and declare it in its own shader prefix, so declaring it again is a GLSL redefinition: the
     vertex shader fails to compile, the material silently draws nothing, and the planet's whole
     surface vanishes leaving the detail instances floating in space. Nothing on screen says
     why - the reason is one line in the console.
     (And no backticks in a comment inside a template literal: that ends the string.) */
  void main(){
    vUv = uv;
    vC = color;
    /* The object-space direction, which is what the procedural plating below is a function of.
       Displacement is radial, so normalising the displaced position gives exactly the direction
       the geometry used - the shader's grid and the mesh's grid cannot drift apart. */
    vD = normalize(position);
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const PLANET_FRAG = `
  uniform sampler2D uMap; uniform sampler2D uNorm; uniform samplerCube uEnv;
  uniform vec3 uLight; uniform vec3 uCam; uniform vec3 uTint;
  uniform float uTime;
uniform float uLights;   // 1 = city lights + strip lights on, 0 = off (the bottom-left switch)
uniform float uEnvAmt;   // the limb glow / environment reflection
uniform float uSpec;     // specular highlight + sheen
  uniform float uBump;     // normal-map strength. Was SWALLOWED onto the tail of the uSpec comment
                           // when uLights was inserted above (2026-09-07): the declaration ended up
                           // after a //, so uBump was undeclared, the fragment shader failed to
                           // compile with "'uBump' : undeclared identifier", and this material -
                           // the planet's whole ground - rendered from a dead program. Never append
                           // to a line that already carries a // comment.
  /* How brightly the SURFACE itself is lit, separate from its emissives. RJ asked for two things
     that are the same setting: "make it dark with lights that twinkle emissive", and "make sure
     her letters contrast to it - letters well lit". A planet lit to near-white leaves a white
     glyph nothing to sit against, and every attempt to fix that by making the letters brighter
     ran out of headroom. So the ground is deliberately held down and the strip lights and city
     lights - which are added AFTER the lighting term - carry the interest. This is the single
     knob for that trade; the letters own the bright end of the frame. */
  uniform float uGround;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vC; varying vec3 vD;
  uniform float uGrid;      // sub-panels across one cube face - the geometry's grid, times a few
  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  /* The same cube projection plateHeight uses on the CPU, one level finer. Doing it here rather
     than in a texture is what keeps a seam one pixel wide at every altitude: there is no texel to
     run out of. Costs about a dozen instructions. */
  vec3 faceUV(vec3 d){
    vec3 a = abs(d);
    if(a.x >= a.y && a.x >= a.z) return vec3(d.y / a.x, d.z / a.x, d.x > 0.0 ? 0.0 : 1.0);
    if(a.y >= a.z)               return vec3(d.z / a.y, d.x / a.y, d.y > 0.0 ? 2.0 : 3.0);
    return                              vec3(d.x / a.z, d.y / a.z, d.z > 0.0 ? 4.0 : 5.0);
  }
  // width of one screen pixel in grid units, so the seam antialiases instead of shimmering
  float pixelWidth(vec2 g){
    vec2 w = fwidth(g);
    return max(max(w.x, w.y), 1e-4);
  }
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(uCam - vW);
    vec3 L = normalize(uLight);
    /* The mesh carries the big shapes now, so the map is a SURFACE, not the whole planet: it
       is multiplied by the per-panel metal tint the geometry baked in, which is what stops six
       different worlds rendering as one grey-brown family. */
    vec3 alb = pow(texture2D(uMap, vUv).rgb, vec3(2.2)) * vC;
    /* sRGB -> linear on read. Every texture here is authored in sRGB - a canvas, a jpeg - and a
       custom ShaderMaterial gets NO automatic decode: three.js only injects one for the material
       chunks it owns, so texture2D returns the sRGB bytes as if they were linear light. The
       renderer then applies its own linear->sRGB on output, and the result is everything washed
       one full gamma step pale. This is why a #0d1420 plate rendered as mid grey and why the
       planet looked bleached however far its tint was pulled down. */


    /* ---- PROCEDURAL PLATING. The map carries colour and material; the plating carries the
       machine, and it is computed per pixel so it is as sharp skimming the surface as it is
       from orbit. */
    vec3 F = faceUV(normalize(vD));
    vec2 gp = (F.xy * 0.5 + 0.5) * uGrid;
    vec2 cellId = floor(gp);
    vec2 f = fract(gp);
    float pw = pixelWidth(gp);
    /* Fade the fine plating out as its cells shrink towards a pixel. Without this the seam's own
       "widen to at least one pixel" rule keeps widening at distance until every pixel IS seam, and
       the planet turns into a uniform glowing haze at exactly the moment it should read as a
       smooth dark world. The detail is meant to be there when you are close enough to see it. */
    float detailFade = 1.0 - smoothstep(0.20, 0.75, pw);
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));   // distance to the panel border
    // seam: a dark hairline, widened to at least a pixel so it never aliases into sparkle
    float seam = (1.0 - smoothstep(0.0, max(0.035, pw * 1.5), edge)) * detailFade;
    float pr = hash21(cellId + F.z * 53.0);
    // each plate its own slight tone - a plate field is never one flat value
    alb *= 1.0 + (0.34 * pr - 0.20) * detailFade;
    alb *= 1.0 - 0.62 * seam;                       // recessed seam
    // rivets: a ring of dots inset from the panel border, only on the larger plates
    vec2 rq = abs(f - 0.5);
    float rivet = step(0.86, pr) * (1.0 - smoothstep(0.012, 0.030,
                    abs(max(rq.x, rq.y) - 0.40) + abs(fract(min(rq.x, rq.y) * 9.0) - 0.5) * 0.10));
    alb += rivet * 0.16;

    // the sphere's own tangent frame: no tangent attribute, no BufferGeometryUtils
    vec3 nm = texture2D(uNorm, vUv).xyz * 2.0 - 1.0;
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5));
    vec3 B = cross(N, T);
    /* uBump drops to 0.30 from 0.55: the normal map used to be the ONLY relief on a smooth
       ball and was pushed hard to compensate. Now it is fine detail on top of real geometry,
       and left at 0.55 it fights the mesh's own facet normals at every plate edge. */
    N = normalize(N + (T * nm.x + B * nm.y) * uBump);

    float ndl = max(dot(N, L), 0.0);
    float lam = ndl * 0.88 + 0.12;                 // a little wrap, so the terminator is not tar

    /* RJ 2026-09-06: "the white shine of the planet makes text contrast too hard." The
       highlight was white and strong, so the lit face went to paper under white glyphs. It is
       weaker now and TINTED COLD - a blue-steel sheen carries "polished metal" without ever
       reaching the white the text needs to own. */
    vec3 H = normalize(L + V);
    vec3 specTint = vec3(0.62, 0.78, 1.0);
    // held down with the base for the same reason: a hot specular on the plating is exactly
    // where a white letter loses its edge.
    float spec = pow(max(dot(N, H), 0.0), 110.0) * 0.34;
    float sheen = pow(max(dot(N, H), 0.0), 16.0) * 0.06;

    vec3 R = reflect(-V, N);
    vec3 env = textureCube(uEnv, R).rgb;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

    // ---- twinkling city lights
    float lum = dot(alb, vec3(0.299, 0.587, 0.114));
    float inDark = smoothstep(0.26, 0.06, lum);     // only down in the canyons
    vec2 cell = floor(vUv * vec2(520.0, 260.0));
    float h = hash21(cell);
    float on = step(0.955, h);                      // about one cell in twenty
    float blink = 0.40 + 0.60 * sin(uTime * (1.2 + h * 7.0) + h * 62.0);
    vec3 lampCol = mix(vec3(0.52, 0.84, 1.0), vec3(1.0, 0.70, 0.32), step(0.5, fract(h * 17.0)));
    float night = 1.0 - ndl;
    vec3 lamps = lampCol * on * inDark * blink * (0.30 + 1.35 * night) * 2.6;

    /* STRIP LIGHTS in the seams. Roughly one panel border in eight is lit, and it is EMISSIVE -
       added after the lighting term, unaffected by ndl - so it reads on the night side and gives
       the bloom pass something to catch. RJ: "none of the emissive shaders seem to be actually
       working"; before this the only emissive on the planet was the city-light hash, which is
       gated to the dark canyons of the MAP and so barely fired on a bright world. */
    float lit = step(0.86, hash21(cellId + F.z * 17.0 + 91.0));
    float pulse = 0.72 + 0.28 * sin(uTime * (0.8 + pr * 2.2) + pr * 40.0);
    vec3 stripCol = mix(vec3(0.35, 0.80, 1.00), vec3(1.00, 0.62, 0.22), step(0.62, pr));
    vec3 strips = stripCol * seam * lit * pulse * (0.55 + 0.90 * night) * 1.9;

    vec3 base = alb * uTint * lam * uGround;
    // the reflection is held to the LIMB (fresnel-weighted) so the face you read over stays dark
    // Each term is scaled by its own knob so the bottom-left panel can isolate what a world's
    // identity actually survives. Measured 2026-09-07: the six worlds land within 2-6% of each
    // other because the tint is a pale multiply while these bright terms are identical on all six.
    vec3 col = base + env * (0.03 + 0.26 * fres) + specTint * spec + specTint * sheen
             + (lamps + strips) * uLights;   // uLights 0 kills the city lights and the seam strips   // uLights 0 kills the twinkling city lights and the seam strips; the plating, tint and limb stay
    gl_FragColor = vec4(col, 1.0);
  }`;

window.PLANET_SURFACE = {
  WORLDS, PLANET_VERT, PLANET_FRAG,
  plateSphere, plateHeight, hash3, vnoise3, fbm3, cubeFace,
  get PLATE_GRID(){ return PLATE_GRID; },  set PLATE_GRID(v){ PLATE_GRID = v; },
  get PLATE_STEPS(){ return PLATE_STEPS; },set PLATE_STEPS(v){ PLATE_STEPS = v; },
  get PLATE_AMP(){ return PLATE_AMP; },    set PLATE_AMP(v){ PLATE_AMP = v; },
  get TRENCH_W(){ return TRENCH_W; },      set TRENCH_W(v){ TRENCH_W = v; },
};
})();
