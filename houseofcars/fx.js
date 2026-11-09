// fx.js - the page's look, apart from what it shows: a studio light environment for the car highlights, clear-coated paint,
// a polished showroom floor, and the post chain (bloom on the accent lights, a vignette, multisampled edges). All of it is
// AUTHORED (app.js AUTHORED lists it); none of it changes a car or track number. Serves UC-7.2, UC-7.3, UC-7.5.
import * as THREE from 'three/webgpu';
import { positionLocal, positionView, normalView, abs, vertexColor, mx_fractal_noise_float, mx_noise_float, nodeObject, pass, uniform, uv, float, vec2, vec3, vec4, color as tslColor, texture, mix, max, min, smoothstep, luminance, length, reflector, positionWorld, cameraPosition, normalize, dot, pow, oneMinus, normalWorld } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { godRays } from './weather.js';                    // UC-40: the light shafts, put in front of the bloom (makePost o.godRays)

// ---------------------------------------------------------------- studio environment (UC-7.2)
// A dark room with softboxes: one long overhead strip, two side strips and a warm accent strip in the dealer's orange, so a
// glossy car shows the long, clean highlights of a photo studio instead of RoomEnvironment's ceiling lamps.
export function studioEnvironment(renderer, accentHex) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicNodeMaterial({ color: 0x0b0d10, side: THREE.BackSide })));
  const box = (w, h, x, y, z, rx, ry, c, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); scene.add(m);
  };
  box(30, 5, 0, 20, 0, Math.PI / 2, 0, 0xffffff, 6);          // overhead strip, along the car
  box(4, 28, 0, 20, 8, Math.PI / 2, 0, 0xffffff, 2.5);         // cross strip
  box(24, 3, 0, 4, -22, 0, 0, 0xffffff, 3.5);                  // back wall strip, low: the long side highlight
  box(24, 3, 0, 4, 22, 0, Math.PI, 0xffffff, 3.5);
  box(3, 16, -22, 8, 0, 0, Math.PI / 2, 0xdfe8ff, 2.0);        // cool side box
  box(3, 16, 22, 8, 0, 0, -Math.PI / 2, new THREE.Color(accentHex), 2.4);   // warm accent box
  const floorGlow = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicNodeMaterial({ color: 0x1a1d22 }));
  floorGlow.rotation.x = -Math.PI / 2; floorGlow.position.y = -3; scene.add(floorGlow);
  const pmrem = new THREE.PMREMGenerator(renderer);
  return pmrem.fromScene(scene, 0.02).texture;
}

// ---------------------------------------------------------------- clear-coated paint, with a colour that can be changed (UC-7.2, UC-7.3)
// The paint materials, by the names Unreal's glTF export gave them (data/meshes/*.glb, read 2026-11-05). Each one becomes a
// physical material with a clear coat. The picker recolours only the paint: for a textured body the mask is the texture's own
// saturation (the livery is a saturated colour; trim, carbon and decals are grey), and the new colour keeps the texture's
// shading by its luminance against the paint's measured mean luminance.
export const PAINT_MATERIALS = { MI_SportsCarBody: 'SportsCar', MI_OffroadCar_Main: 'OffroadCar', MI_CarPaint: 'ConceptCar' };
export const paint = {};                          // car name -> { tint: uniform(Color), amount: uniform(0..1), factory: hex }

function meanPaintLuminance(img) {                 // the mean luminance of the texture's saturated (paint) pixels, measured
  const c = document.createElement('canvas'); const s = 128; c.width = s; c.height = s;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, s, s);
  const d = g.getImageData(0, 0, s, s).data;
  let sum = 0, n = 0, rs = 0, gs = 0, bs = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (mx > 0.05 && (mx - mn) / mx > 0.5) { const lin = (x) => Math.pow(x, 2.2); sum += 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b); rs += r; gs += gg; bs += b; n++; }
  }
  if (!n) throw new Error('fx.js: the paint texture has no saturated pixels to measure');
  return { lum: sum / n, factory: new THREE.Color(rs / n, gs / n, bs / n).getHex() };
}

export function upgradePaint(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const old = o.material, car = PAINT_MATERIALS[old.name];
    if (!car) return;
    const m = new THREE.MeshPhysicalNodeMaterial();
    for (const k of ['name', 'map', 'normalMap', 'normalScale', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissive', 'emissiveMap', 'color', 'roughness', 'metalness', 'side']) {
      if (old[k] !== undefined && old[k] !== null) m[k] = (old[k] && old[k].clone && !old[k].isTexture) ? old[k].clone() : old[k];
    }
    m.clearcoat = 1; m.clearcoatRoughness = 0.04;
    m.roughness = Math.min(m.roughness, 0.45);
    const tint = uniform(new THREE.Color(0xffffff)), amount = uniform(0);
    if (old.map) {
      const { lum, factory } = meanPaintLuminance(old.map.image);
      const t = texture(old.map);
      const mx = max(t.r, max(t.g, t.b)), mn = min(t.r, min(t.g, t.b));
      const mask = smoothstep(0.35, 0.6, mx.sub(mn).div(max(mx, 0.0001)));
      const shade = luminance(t.rgb).div(lum);
      m.colorNode = vec4(mix(t.rgb, tint.mul(shade), mask.mul(amount)), t.a);
      paint[car] = { tint, amount, factory };
    } else {
      const base = old.color.clone();
      m.colorNode = mix(tslColor(base), tint, amount);
      paint[car] = { tint, amount, factory: base.getHex() };
    }
    o.material = m;
  });
}

export function setPaint(car, hex) {              // null = the factory paint
  const p = paint[car];
  if (!p) throw new Error('fx.js: no paint material for ' + car);
  if (hex === null) { p.amount.value = 0; return; }
  p.tint.value.set(hex).convertSRGBToLinear();
  p.amount.value = 1;
}

// ---------------------------------------------------------------- polished pedestal tops (UC-7.2)
// The cars stand on the pedestal tops, so that is where their reflection belongs. Every pedestal top sits at the same height,
// so ONE reflector (one extra half-resolution render a frame) serves them all. The reflection is slightly blurred and faded
// with a Fresnel term so the top reads as polished stone, not a mirror.
export function polishedTops(y, hex) {
  const reflection = reflector({ resolution: 0.5 });
  reflection.target.rotateX(-Math.PI / 2);
  reflection.target.position.y = y;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.0 });
  const view = normalize(cameraPosition.sub(positionWorld));
  const fres = float(0.18).add(float(0.6).mul(pow(oneMinus(max(dot(normalWorld, view), 0)), 3)));
  mat.colorNode = tslColor(new THREE.Color(hex));
  // a 5-tap blur in screen space (texture().blur() needs mipmaps, which a reflector's target lacks when the material builds)
  const taps = [[0, 0], [0.0025, 0.0035], [-0.0025, 0.0035], [0.0025, -0.0035], [-0.0025, -0.0035]].map(([x, y]) => {
    const t = reflection.clone(); t.uvNode = nodeObject(reflection.uvNode).add(vec2(x, y)); return nodeObject(t).rgb;   // clone() hands back a bare node
  });
  mat.emissiveNode = taps.reduce((a, t) => a.add(t)).mul(0.2).mul(fres);
  return { material: mat, target: reflection.target, reflector: reflection.reflector };   // reflector: lot_focus.js trims what it draws (GFX 11-08)
}

// ---------------------------------------------------------------- ground detail (UC-7.5)
// M_Landscape's colours (READ, as vertex colours) times a two-scale noise: broad patches (~6 m) and a fine grain (~0.4 m).
// The noise is the page's own (AUTHORED); Unreal's landscape layers are not ported.
export function groundDetail(mat) {

  const broad = mx_fractal_noise_float(positionWorld.mul(0.16), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const fine = mx_noise_float(positionWorld.mul(2.6)).mul(0.5).add(0.5);
  const k = float(0.82).add(broad.mul(0.26)).add(fine.mul(0.1));
  mat.colorNode = vertexColor(0).rgb.mul(k);
  mat.roughnessNode = float(mat.roughness).mul(float(0.9).add(fine.mul(0.2)));
  return mat;
}

// ---------------------------------------------------------------- the track's surfaces restyled (UC-33)
// RJ 11-07: "It's very game jam looking let's shoot for aaa". The Unreal template's track (data/track.glb) is drawn in prototype
// checkers: MI_TrackEdge_Inst a dark grey checker (the road) and MI_TrackEdge an orange and grey one (its borders), both 1024 px
// textures looked at 11-07, and one flat tint on its walls (M_TintCol, base colour 1, 0.1, 0). All three restyled here, AUTHORED:
// Epic's art is not changed in the file, only how the page draws it. 11-07, tried first and dropped: keeping the texture's coloured
// texels as markings, which turned the borders into an orange-and-black checker. The markings now come from the dressing (dress.js:
// edge lines and kerbs on the road's own spline). Asphalt: a near-black base (the road) or a lighter worn shoulder (the borders),
// a fine aggregate grain and a broad patchiness, world-space noise; concrete walls the same two scales on a mid grey.
export function asphaltRoad(mat, shoulder) {
  const grain = mx_noise_float(positionWorld.mul(9.0)).mul(0.5).add(0.5);
  const patch = mx_fractal_noise_float(positionWorld.mul(0.08), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const base = shoulder ? vec3(0.085, 0.083, 0.08) : vec3(0.03, 0.031, 0.034);   // 11-07: lighter read as concrete under the sky's light
  mat.colorNode = base.mul(float(0.75).add(grain.mul(0.35)).add(patch.mul(0.25)));
  mat.roughnessNode = float(0.78).add(grain.mul(0.18));
  mat.metalnessNode = float(0);
  return mat;
}
export function concreteWall(mat) {
  const grain = mx_noise_float(positionWorld.mul(6.0)).mul(0.5).add(0.5);
  const patch = mx_fractal_noise_float(positionWorld.mul(0.12), 3, 2.0, 0.5).mul(0.5).add(0.5);
  mat.colorNode = vec3(0.46, 0.47, 0.48).mul(float(0.78).add(grain.mul(0.14)).add(patch.mul(0.2)));
  mat.roughnessNode = float(0.82).add(grain.mul(0.12));
  mat.metalnessNode = float(0);
  return mat;
}

// ---------------------------------------------------------------- a spot light's visible beam (UC-7.2)
// An open cone from the lamp to the floor, added on top of the scene: brightest near the lamp, soft at its rim (the view-facing
// term), so the light reads as light in a dark room. AUTHORED, like the spot it belongs to.
export function lightBeam(from, to, radius, hex, k) {
  const h = from.distanceTo(to);
  const geo = new THREE.ConeGeometry(radius, h, 48, 1, true); geo.translate(0, -h / 2, 0);   // apex at the origin, opening down
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const along = smoothstep(-h, 0, positionLocal.y);                                          // 1 at the lamp, 0 at the floor
  const rim = pow(abs(dot(normalize(normalView), normalize(positionView.negate()))), 2.0);  // faint where the cone is seen edge-on
  mat.colorNode = vec3(tslColor(new THREE.Color(hex))).mul(along.mul(along).mul(rim).mul(k));
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(from);                                                                      // in the parent's space: lookAt would read world space
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());   // the cone opens toward the target
  m.renderOrder = 2;
  return m;
}

// an emissive accent: values above 1 so the bloom picks it up
export const glowMaterial = (hex, k) => new THREE.MeshBasicNodeMaterial({ colorNode: tslColor(new THREE.Color(hex)).mul(k) });

// ---------------------------------------------------------------- the post chain (UC-7.2, UC-7.5)
// UC-37.3 a car's contact shadow: a soft dark patch on the road under it, darkest under the middle, so it sits on the road; the
// sun's shadow map draws the shadow it casts, this the light the body blocks from the sky (AUTHORED: its falloff and strength)
let contactTex = null;
export function contactShadow(lengthM, widthM, strength = 0.72) {
  if (!contactTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.45, 'rgba(0,0,0,0.75)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    contactTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(lengthM * 1.18, widthM * 1.35), new THREE.MeshBasicNodeMaterial({ map: contactTex, transparent: true, opacity: strength, depthWrite: false, color: 0x000000 }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1; m.name = 'contact-shadow';
  return m;
}
export function makePost(renderer, scene, camera, o) {
  const post = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera, { samples: 4 });
  const raw = scenePass.getTextureNode('output');
  // UC-40 o.godRays { sun: weather.js sunTracker, quality }: weather.js godRays (LSPP's light scattering) added to the scene's colour
  // before the bloom, as test/weather_view.html draws it; without it the chain is the one below, unchanged (the lot's)
  const col = o.godRays ? godRays(THREE, raw, o.godRays.sun, { depth: scenePass.getTextureNode('depth'), quality: o.godRays.quality }) : raw;
  // UC-37.5 (AUTHORED): what feeds the bloom is capped, so a sun glint on a clear coat glows instead of swelling into a white blob
  // over the windscreen (11-07, the strip's head-on shots); the picture graded a touch more saturated (o.saturation, 1 = none)
  const b = bloom(min(col, vec4(o.bloomCap ?? 6, o.bloomCap ?? 6, o.bloomCap ?? 6, 1)), o.bloomStrength, o.bloomRadius, o.bloomThreshold);
  const d = length(uv().sub(0.5));
  const vig = oneMinus(smoothstep(0.35, 0.85, d).mul(o.vignette));
  const lit = col.rgb.add(b.rgb), grey = luminance(lit);
  post.outputNode = vec4(mix(vec3(grey, grey, grey), lit, o.saturation ?? 1).mul(vig), 1);
  return { post, scenePass, bloomNode: b, rays: o.godRays ? col : null, render: () => post.render() };
}

// ---------------------------------------------------------------- the track's sky (UC-7.5)
// A physical sky (three.js SkyMesh: Rayleigh + Mie scattering) lit from the level's DirectionalLight direction (READ, passed in
// as the direction the light travels, in three.js space). Unreal draws SkyAtmosphere + VolumetricCloud, which glTF cannot carry;
// this is the page's stand-in, and the same sky, rendered into a light probe, is what the car's paint reflects.
// UC-37.2 the probe has the ground under its horizon (groundRGB, the level's READ landscape colour, at GROUND_RADIANCE of it: AUTHORED):
// clear-coated paint reflecting only a sky dome reads as a flat sheen; with the ground in it, every glossy side carries the line
// where the ground meets the sky, which is what makes paint read as wet
const GROUND_RADIANCE = 0.42;
export function physicalSky(renderer, lightDir, gain = 0.32, groundRGB = null) {
  const toSun = new THREE.Vector3(-lightDir[0], -lightDir[1], -lightDir[2]).normalize();
  const make = (scale) => {
    const sky = new SkyMesh();
    sky.scale.setScalar(scale);
    sky.turbidity.value = 2.5; sky.rayleigh.value = 2.2; sky.mieCoefficient.value = 0.003; sky.mieDirectionalG.value = 0.85;
    sky.sunPosition.value.copy(toSun);
    sky.material.fog = false;
    sky.material.fragmentNode = sky.material.fragmentNode.mul(vec4(gain, gain, gain, 1));   // SkyMesh is built for exposure ~0.3; the page keeps 1
    return sky;
  };
  return { mesh: make(2800), env: skyEnv(renderer, make(100), groundRGB), toSun };
}
// the probe: a sky mesh 100 m across (the clear one above, or UC-40's overcast one: app.js hands a clone of the sky the camera sees,
// which shares its material) with the ground under its horizon, rendered into the PMREM the paint and the wet road reflect
export function skyEnv(renderer, skyMesh, groundRGB = null) {
  const probe = new THREE.Scene(); probe.add(skyMesh);
  if (groundRGB) {
    const g = new THREE.Mesh(new THREE.CircleGeometry(95, 48), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(...groundRGB).multiplyScalar(GROUND_RADIANCE), fog: false }));
    g.rotation.x = -Math.PI / 2; g.position.y = -1.2; probe.add(g);
  }
  return new THREE.PMREMGenerator(renderer).fromScene(probe, 0.0).texture;
}
