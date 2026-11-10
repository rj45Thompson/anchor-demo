// sky.js - what is above and beyond the island (graphics round 2: "at the 3/4 battle camera the sea just ends"): a sky dome behind
// everything (a gradient from the haze at the horizon to the blue overhead, a few drifting clouds, the glare of a low light over the
// north horizon), and the scene's haze: everything far from the camera fades toward the horizon's colour, so the sea runs into the
// sky instead of stopping, and soft cloud shadows drift over the land and the sea. All of it is a handful of texture reads in the
// shaders that already run (Scene.fogNode is applied by every material), no extra pass.
//
// What the cameras see of it: the battle camera looks down at 54 degrees with a 38-degree field (camera.js), so its top edge is 35
// degrees BELOW the horizon and no sky can ever be in its frame; there the haze thickens toward the top of the picture and the cloud
// shadows cross the board. The menu camera (camera.js, MENU) is low enough to show the horizon, the sky and its clouds.
import * as THREE from 'three/webgpu';
import { uniform, positionLocal, positionWorld, normalize, vec2, vec3, vec4, float, mix, smoothstep, max, dot, pow, texture, output,
         rangeFogFactor, Fn, mrt } from 'three/tsl';
import { sunDirection } from './look.js';

// AUTHORED (this game's own look, round 2)
const RADIUS = 350;                                     // the dome, centred on the camera every frame (the camera's far plane is 400)
// the far air (the dome's colour at the horizon and what the haze fades to), the sky overhead and the low light's colour are the
// level's light: render/mood.js Mood (haze, zenith, glare; NOON there is what these were until 11-10)
// the glare sits where the sea's glints come from (board.js GLINT: low over the north horizon, toward which the painted sea
// sparkles), lowered to just above the horizon so the menu camera sees it; the shadow-casting sun is behind the camera (look.js SUN)
const GLARE_DIR = new THREE.Vector3(0.25, 0.07, -0.87).normalize();
// the haze near the camera: from 0.9x the camera's distance to what it looks at to 2.4x it rises to HAZE_NEAR_MAX (the air stays
// clear enough to see the island's far side and the ships through it)
const HAZE_NEAR = 0.9, HAZE_FAR = 2.4, HAZE_NEAR_MAX = 0.45;
// and whatever that distance, the haze is full before the camera's far plane (camera.js: 400), so the sea (board.js: drawn far past
// it) never shows an edge: it runs into the haze, and the haze is the sky's colour at the horizon
const FAR_HAZE = [220, 340];
const CLOUD_SCALE = 0.011;                              // noise-texture tiles per square for the cloud shadows (one cloud ~10 squares)
// how much light a cloud's shadow takes away: the mood's cloudShade (0.16 at noon)
const WIND = new THREE.Vector2(0.0068, 0.0031);         // noise-texture tiles per second the clouds (and their shadows) drift

export class Sky {
  /** @param scene the scene (its fogNode is set here, once, before the first draw: every material's shader includes it)
   *  @param noiseTex look.js makeNoiseTexture (R smooth noise), shared with the land and the sea
   *  @param mood     render/mood.js Mood: the level's light, read by the dome and the haze as uniforms */
  constructor(scene, noiseTex, mood) {
    if (!mood || !mood.haze) throw new Error('sky.js: the Mood (render/mood.js) is required');
    this.uTime = uniform(0); this.uNear = uniform(60); this.uFar = uniform(160);
    const t = this.uTime, haze = mood.haze;
    // ---- the dome: the direction from the camera is the dome's own vertex direction (it is centred on the camera)
    const d = normalize(positionLocal), y = d.y;
    let col = mix(haze, mood.zenith, pow(smoothstep(0.0, 0.3, y), 0.6));
    const g = max(dot(d, vec3(GLARE_DIR.x, GLARE_DIR.y, GLARE_DIR.z)), 0);
    const glareC = mood.glare;
    // (above the horizon only: below it the dome must be exactly the haze the far sea fades to, or the seam shows as a line)
    const above = smoothstep(-0.005, 0.03, y);
    col = col.add(glareC.mul(pow(g, 7).mul(0.32).add(pow(g, 70).mul(0.7))).mul(above));
    // clouds: the noise projected onto a flat layer overhead, so they bunch up and thin toward the horizon as real ones do; lit
    // warm on the side toward the glare, grey-blue underneath
    const cuv = d.xz.div(max(y, 0.035)).mul(0.07).add(vec2(t.mul(WIND.x), t.mul(WIND.y)));
    const n = texture(noiseTex, cuv).r, n2 = texture(noiseTex, cuv.mul(2.3).add(0.31)).a;
    const cover = smoothstep(0.52, 0.74, n.add(n2.sub(0.5).mul(0.18))).mul(smoothstep(0.004, 0.045, y)).mul(smoothstep(0.85, 0.45, y));
    const cloudC = mix(vec3(0.62, 0.68, 0.8), vec3(1.0, 0.97, 0.92), smoothstep(0.45, 0.8, n2).mul(0.6).add(g.mul(0.5)));
    col = mix(col, cloudC, cover.mul(0.82));
    const disc = pow(g, 1400).mul(5);                    // the light's own disc: it glows (the only part written to the bloom)
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    m.colorNode = col.add(glareC.mul(disc));
    m.mrtNode = mrt({ emissive: vec4(glareC.mul(disc), 1) });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 48, 24), m);
    this.dome.renderOrder = -10; this.dome.frustumCulled = false; this.dome.name = 'sky';
    scene.add(this.dome);
    // ---- the haze and the cloud shadows, applied by every material that draws (Scene.fogNode). A cloud's shadow is found where
    // the sun's ray through the point meets the ground, so a wall and the grass at its foot fall under the same cloud.
    const s = sunDirection();
    const P = positionWorld, ground = P.xz.sub(vec2(s.x / s.y, s.z / s.y).mul(P.y));
    const shadow = smoothstep(0.5, 0.72, texture(noiseTex, ground.mul(CLOUD_SCALE).add(vec2(t.mul(WIND.x), t.mul(WIND.y)))).r);
    const lit = output.rgb.mul(float(1).sub(shadow.mul(mood.cloudShade)));
    scene.fogNode = Fn(() => vec4(mix(lit, haze, max(rangeFogFactor(this.uNear, this.uFar).mul(HAZE_NEAR_MAX), rangeFogFactor(float(FAR_HAZE[0]), float(FAR_HAZE[1])))), output.a))();
  }

  /** How hazed a point at view depth z (positive, world units) is, 0..1: the post chain fades the ambient occlusion with it (GTAO
   *  darkens a far plane seen edge-on, which showed as a dark band where the sea meets the haze). */
  hazeAt(z) { return max(smoothstep(this.uNear, this.uFar, z).mul(HAZE_NEAR_MAX), smoothstep(FAR_HAZE[0], FAR_HAZE[1], z)); }

  /** Each frame: the dome follows the camera; the haze is measured from the camera's distance to what it looks at. */
  update(camera, target, seconds) {
    this.dome.position.copy(camera.position);
    // the dome is drawn only when the top of the picture can reach above the horizon (the menu camera); under the battle and build
    // cameras every pixel of it would be drawn and then covered by the sea (a full-screen pass for nothing: 11-09, the isolated 4K render 16.8 -> 11.2 ms median without it)
    const dir = target.clone().sub(camera.position).normalize(), down = THREE.MathUtils.radToDeg(Math.asin(-dir.y));
    this.dome.visible = down - camera.fov / 2 < 2;
    const dist = camera.position.distanceTo(target);
    this.uNear.value = dist * HAZE_NEAR; this.uFar.value = dist * HAZE_FAR;
    this.uTime.value = seconds;
  }
}
