// fx.js - the page's look, apart from what it shows: a studio light environment for the car highlights, clear-coated paint,
// a polished showroom floor, and the post chain (bloom on the accent lights, a vignette, multisampled edges). All of it is
// AUTHORED (app.js AUTHORED lists it); none of it changes a car or track number. Serves UC-7.2, UC-7.3, UC-7.5.
import * as THREE from 'three/webgpu';
import { nodeObject, pass, uniform, uv, float, vec2, vec3, vec4, color as tslColor, texture, mix, max, min, smoothstep, luminance, length, reflector, positionWorld, cameraPosition, normalize, dot, pow, oneMinus, normalWorld } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

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
  return { material: mat, target: reflection.target };
}

// an emissive accent: values above 1 so the bloom picks it up
export const glowMaterial = (hex, k) => new THREE.MeshBasicNodeMaterial({ colorNode: tslColor(new THREE.Color(hex)).mul(k) });

// ---------------------------------------------------------------- the post chain (UC-7.2, UC-7.5)
export function makePost(renderer, scene, camera, o) {
  const post = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera, { samples: 4 });
  const col = scenePass.getTextureNode('output');
  const b = bloom(col, o.bloomStrength, o.bloomRadius, o.bloomThreshold);
  const d = length(uv().sub(0.5));
  const vig = oneMinus(smoothstep(0.35, 0.85, d).mul(o.vignette));
  post.outputNode = vec4(col.rgb.add(b.rgb).mul(vig), 1);
  return { post, scenePass, bloomNode: b, render: () => post.render() };
}

// ---------------------------------------------------------------- the track's sky (UC-7.5)
// A physical sky (three.js SkyMesh: Rayleigh + Mie scattering) lit from the level's DirectionalLight direction (READ, passed in
// as the direction the light travels, in three.js space). Unreal draws SkyAtmosphere + VolumetricCloud, which glTF cannot carry;
// this is the page's stand-in, and the same sky, rendered into a light probe, is what the car's paint reflects.
export function physicalSky(renderer, lightDir, gain = 0.32) {
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
  const probe = new THREE.Scene(); probe.add(make(100));
  const env = new THREE.PMREMGenerator(renderer).fromScene(probe, 0.0).texture;
  return { mesh: make(2800), env, toSun };
}
