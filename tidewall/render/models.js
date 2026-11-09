// models.js - the models the board is drawn with, brought to a web budget by tools/models/make_web_models.mjs (ASSETS.md says where
// each comes from): five made with Meshy (meshy.ai) on the owner's account - the knight (each player's hero), the goblin (the grunts),
// the ship, the castle and the cannon - and three CC-BY models from Sketchfab, credited on the title screen (app/credits.js) - the
// oak, the bush and two rocks (the board's decoration). They are loaded ONCE before the first match; a model that does not load, or lacks a clip
// or a bone the renderer drives, stops the renderer with the reason (no procedural stand-in is drawn in its place).
//
// What each source file holds was read from the files themselves (tools/models/inspect_glb.mjs, 2026-11-08):
//   knight  1.30 x 1.70 x 0.59, feet at y 0, facing +z; skinned (53 joints); clips Running, Walking, Combat_Stance, Right_Hand_Sword_Slash
//   goblin  1.77 x 1.69 x 0.83, feet at y 0, facing +z; skinned (56 joints); clips Running, Walking, Punch_Combo
//   ship    1.90 long (x) x 1.72 tall x 0.81, centred; bow toward -x
//   castle  1.88 x 1.67 x 1.90, centred, on a grass plinth; gate toward +z
//   cannon  1.90 x 1.78 x 1.85, centred, on a round platform; muzzle toward -x
// (orientation LOOKED at in shots/models/m1_all.png: front and side views with axes).
import * as THREE from 'three/webgpu';
import { texture, uniform, vec3, vec4, dot, max, min, smoothstep, mix, oneMinus, pow, normalView, positionViewDirection } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FILES = { knight: 'knight.glb', goblin: 'goblin.glb', ship: 'ship.glb', castle: 'castle.glb', cannon: 'cannon.glb',
                oak: 'oak.glb', bush: 'bush.glb', rockSmall: 'rock_small.glb', rockLarge: 'rock_large.glb' };
const CLIPS = { knight: ['Combat_Stance', 'Walking', 'Running', 'Right_Hand_Sword_Slash'], goblin: ['Walking', 'Running', 'Punch_Combo'] };

export class ModelLoadError extends Error {
  constructor(why) { super(why); this.name = 'ModelLoadError'; }
}

/** The loaded models: each a glTF scene (the template every figure is cloned from), its clips by name, and its size. */
export class Models {
  static async load() {
    const loader = new GLTFLoader(), out = new Models();
    await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
      const url = new URL('../assets/models/' + file, import.meta.url).href;
      let gltf;
      try { gltf = await loader.loadAsync(url); }
      catch (e) { throw new ModelLoadError('the ' + key + ' model (' + url + ') did not load: ' + (e && e.message ? e.message : e)); }
      const clips = new Map(gltf.animations.map((a) => [a.name, a]));
      for (const name of CLIPS[key] ?? []) if (!clips.has(name)) throw new ModelLoadError('the ' + key + ' model has no clip "' + name + '" (it has: ' + [...clips.keys()].join(', ') + ')');
      gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const box = new THREE.Box3().setFromObject(gltf.scene);
      out[key] = { scene: gltf.scene, clips, box, size: box.getSize(new THREE.Vector3()) };
    }));
    return out;
  }

  /** A static model (ship, castle, cannon) as a new object sharing the template's geometry and materials. */
  instance(key) { return this[key].scene.clone(true); }

  /** A static model baked for instancing: one {geometry, material} per material with every node's transform applied, moved so its
   *  footprint is centred on the origin and its base is at y = 0, scaled so its larger width (or, with fit.height, its height) is
   *  the size given, then moved by fit.at (x, z). Only position, normal and uv are kept (the normal map works from screen-space
   *  derivatives without the source's tangents). */
  parts(key, fit) {
    const scene = this[key].scene;
    scene.updateMatrixWorld(true);
    const byMat = new Map();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) throw new ModelLoadError('the ' + key + ' model has a mesh with several materials (' + o.name + ')');
      const g = new THREE.BufferGeometry();
      for (const a of ['position', 'normal', 'uv']) {
        if (!o.geometry.attributes[a]) throw new ModelLoadError('the ' + key + ' model has a mesh without ' + a + ' (' + o.name + ')');
        g.setAttribute(a, o.geometry.attributes[a]);
      }
      if (!o.geometry.index) throw new ModelLoadError('the ' + key + ' model has an unindexed mesh (' + o.name + ')');
      g.setIndex(o.geometry.index);
      const baked = g.clone().applyMatrix4(o.matrixWorld);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(baked);
    });
    const parts = [...byMat].map(([material, geos]) => {
      const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!geometry) throw new ModelLoadError('the ' + key + ' model: its meshes would not merge');
      return { geometry, material };
    });
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    const size = box.getSize(new THREE.Vector3());
    const k = fit.height !== undefined ? fit.height / size.y : fit.width / Math.max(size.x, size.z);
    if (!(k > 0 && Number.isFinite(k))) throw new ModelLoadError('the ' + key + ' model has no size to fit');
    const at = fit.at ?? [0, 0];
    for (const p of parts) {
      p.geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      p.geometry.scale(k, k, k);
      p.geometry.translate(at[0], 0, at[1]);
    }
    return parts;
  }

  /** A skinned figure (knight, goblin): its own skeleton, its own mixer, an action per clip. */
  figure(key) {
    const root = SkeletonUtils.clone(this[key].scene), mixer = new THREE.AnimationMixer(root), actions = {};
    for (const [name, clip] of this[key].clips) actions[name] = mixer.clipAction(clip);
    return { root, mixer, actions };
  }
}

/** The first bone whose name ends with `suffix` (the loader drops the ':' from "mixamorig:RightHand"). Absent is an error. */
export function boneEndingWith(root, suffix) {
  let found = null;
  root.traverse((o) => { if (!found && o.isBone && o.name.endsWith(suffix)) found = o; });
  if (!found) throw new ModelLoadError('no bone named ...' + suffix + ' in the figure');
  return found;
}

// AUTHORED (graphics round 2, "knights and goblins are specks"): the rim light that outlines a figure in its side's colour, so a
// hero reads as its player and a grunt as the enemy at the island-wide zoom. RIM_POWER sharpens it toward the silhouette, RIM_K is
// its strength (it is emissive, so the bloom catches it a little). FLASH_K: how white a figure goes at the peak of its hit flash.
export const RIM_POWER = 2.2, RIM_K = 1.35, FLASH_K = 2.2;
/** The rim and the hit flash, as an emissive node: the colour toward the silhouette (where the surface turns away from the camera),
 *  plus white times the drawn object's own userData.flash (0..1, set by units.js per figure; a per-OBJECT uniform, so every figure
 *  shares one material and one shader and still flashes alone). Every mesh drawn with it must carry userData.flash: markFlash(). */
function rimAndFlash(colourNode, k) {
  const fres = oneMinus(max(dot(normalView, positionViewDirection), 0));
  const flash = uniform(0).onObjectUpdate(({ object }) => object.userData.flash);
  return colourNode.mul(pow(fres, RIM_POWER).mul(k)).add(vec3(1, 1, 1).mul(flash.mul(FLASH_K)));
}
/** Give every mesh of a figure its hit-flash value (0 = none); units.js raises it on a hit and lets it fall. */
export function markFlash(root) { root.traverse((o) => { if (o.isMesh) o.userData.flash = 0; }); }
/** Set a figure's hit flash (0..1) on all its meshes. */
export function setFlash(root, v) { root.traverse((o) => { if (o.isMesh) o.userData.flash = v; }); }

/** The knight's armour in a player's colour: the texture is multiplied by the colour where it is light and grey (the white armour
 *  and cape), and left alone where it is coloured or dark (the face, the hair, the leather). Every mesh in `root` gets one shared
 *  material per player; the weights below are AUTHORED for the knight's texture (LOOKED at, shots/models/). */
export function tintArmour(root, colour) {
  const made = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    if (!src.map) throw new ModelLoadError('the knight mesh "' + o.name + '" has no base colour texture to tint');
    let m = made.get(src);
    if (!m) {
      m = new THREE.MeshStandardNodeMaterial();
      m.normalMap = src.normalMap; if (src.normalMap) m.normalScale.copy(src.normalScale);
      m.roughnessMap = src.roughnessMap; m.metalnessMap = src.metalnessMap; m.roughness = src.roughness; m.metalness = src.metalness;
      const t = texture(src.map);
      const lum = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));                       // linear light
      const sat = max(t.r, max(t.g, t.b)).sub(min(t.r, min(t.g, t.b)));
      const w = smoothstep(0.12, 0.4, lum).mul(oneMinus(smoothstep(0.05, 0.16, sat)));
      const tint = uniform(colour.clone());                                       // a uniform: one shader for every colour
      m.colorNode = vec4(t.rgb.mul(mix(vec3(1, 1, 1), tint, w)), t.a);
      m.emissiveNode = rimAndFlash(tint, RIM_K);                                  // the outline in the player's colour, and the hit flash
      made.set(src, m);
    }
    o.material = m;
  });
  markFlash(root);
}

/** A figure (the goblin) outlined in one colour: its own textures as they are, with the rim and the hit flash of rimAndFlash. The
 *  materials are made once per source material and colour (cache) and shared by every figure that passes the same cache, so the
 *  shader is built once (renderer.js warm-up draws one). */
export function rimFigure(root, colour, cache) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    if (!src.map) throw new ModelLoadError('the figure mesh "' + o.name + '" has no base colour texture');
    let m = cache.get(src);
    if (!m) {
      m = new THREE.MeshStandardNodeMaterial();
      m.map = src.map; m.color.copy(src.color);
      m.normalMap = src.normalMap; if (src.normalMap) m.normalScale.copy(src.normalScale);
      m.roughnessMap = src.roughnessMap; m.metalnessMap = src.metalnessMap; m.roughness = src.roughness; m.metalness = src.metalness;
      m.emissiveNode = rimAndFlash(uniform(colour.clone()), RIM_K);
      cache.set(src, m);
    }
    o.material = m;
  });
  markFlash(root);
}

/** Every mesh in `root` drawn with its material multiplied by `k` (a darker or tinted copy, shared per source material). */
export function shade(root, colour) {
  const made = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    let m = made.get(o.material);
    if (!m) { m = o.material.clone(); m.color = m.color.clone().multiply(colour); made.set(o.material, m); }
    o.material = m;
  });
}
