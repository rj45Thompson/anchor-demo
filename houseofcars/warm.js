// warm.js - a shader is built before anyone sees the frame that builds it (UC-30, UC-44.2). The pure parts; app.js does the drawing.
//
// What a build is (READ in three r175, three.webgpu.js): the first time a mesh is drawn with a material in a new setting, three turns
// the material into WGSL on the main thread (Nodes.getForRender, a NodeBuilder) and keeps the result under a key made of the
// material's settings, the geometry's attributes and the scene's lights and environment (the light LIST's own id among them); WHERE
// the mesh hangs and how it is scaled are not in the key. Then the GPU compiles a pipeline for each pass and render target it is
// drawn into, and the first draw waits for that. MEASURED 11-08 on the RTX 2080 (Chrome 156 headless, WebGPU,
// D:/_houseofcars/SPEED_REPORT.md): 70 to 270 ms of script a build, and the lot built every material twice (its main camera and the
// pedestal tops' mirror camera each had a light list of their own), so a car for sale of 20 to 30 materials froze the lot for 2 to
// 10 s the frame it joined (19 s on the phone profile, whose CPU is throttled 4x).
//
// What app.js does about it:
// 1. Tried and dropped: one light list for every camera of the lot (a three.Lighting whose getNode gave the main camera and the mirror
//    camera the same list), so each material is built once, not twice. The builds halved, but the pictures changed: two cameras then
//    share a built shader, and with it the buffer of its per-render uniforms (the camera's matrices: three's shared 'render' group).
//    The mirror's render runs inside the main view's, so a mesh the main view drew before the tops (the room's dome) was drawn with the
//    mirror camera's matrices: 19 % of the lot's pixels changed, the dome lost its blue (MEASURED 11-08, pixel diff against the base).
// 2. A warming mesh is prepared, not drawn: three's own compile path (the one renderer.compileAsync uses) writes its WGSL and asks
//    the GPU for its pipelines without waiting (createRenderPipelineAsync), in the very pass and render target that is drawing; it is
//    drawn once they are ready (pipelinesReady).
// 3. Warm in frames of their own. three draws a post pass's scene at most once an animation frame (r175 PassNode: updateBeforeType
//    FRAME; the frame number moves only in the renderer's own requestAnimationFrame loop, Animation.start). A warm-up that waited a
//    16 ms timer between pieces let two pieces share a frame; the second was never prepared, and the lot's three template cars were
//    built in the first frames after the lot opened (MEASURED 11-08: 2.4 s of builds with no car for sale joining at all).
// 4. A little at a time: at most one lit material a frame (warmSteps), for the lot's warm-up and for a car for sale. The car hangs on
//    a holder scaled to 0 (no triangle has area, so no pixel could move even if it were drawn), and each of its frames is one of the
//    lot that also ran the tops' reflection and the key light's shadow map (drawnInEveryPass); then it rolls onto its pedestal.
// Pure parts here (test/warm.test.mjs): litMaterial, warmSlices, warmSteps, drawnInEveryPass.

// What a frame may take (MEASURED 11-08, desktop, build probe D:/_houseofcars/shots/speed_harness/build_probe.py): a lit material
// (one the lights shade: standard, physical, ...) takes 70 to 270 ms to build, an unlit one (basic, sprite, line, points) 3 to 8 ms.
// So a warm-up frame takes the unlit materials in its way and at most one lit one (warmSteps). A frame that doubled its share while
// the last was quick (tried first) took 16 materials at once when the template cars came after the cheap panels: a 907 ms frame.
const UNLIT = ['isMeshBasicMaterial', 'isMeshBasicNodeMaterial', 'isSpriteMaterial', 'isSpriteNodeMaterial', 'isLineBasicMaterial', 'isLineBasicNodeMaterial',
  'isLineDashedMaterial', 'isLineDashedNodeMaterial', 'isPointsMaterial', 'isPointsNodeMaterial', 'isShadowMaterial'];
/** a material the lights shade (its build is the expensive kind); a NodeMaterial says so itself (lights) */
export function litMaterial(mat) {
  if (!mat || !mat.isMaterial) throw new Error('litMaterial: not a material: ' + mat);
  if (UNLIT.some((f) => mat[f] === true)) return false;
  return mat.isNodeMaterial === true && mat.lights === false ? false : true;
}

/** a model's drawables in the order they are warmed: one slice per material (a mesh with several materials: per that list), in the
 *  order the meshes come, so a frame builds at most one material's shaders and the meshes that share it ride along */
export function warmSlices(meshes) {
  const key = (m) => {
    if (Array.isArray(m.material)) return m.material.map((x) => x.uuid).join(',');
    if (!m.material || !m.material.uuid) throw new Error('warmSlices: ' + (m.name || m.type) + ' has no material to build');
    return m.material.uuid;
  };
  const by = new Map();
  for (const m of meshes) { const k = key(m); if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
  return [...by.values()];
}

/** slices (warmSlices) gathered into frames: each frame the unlit slices up to and including one lit slice (a multi-material mesh is
 *  lit if any of its materials is); the meshes of each frame, in order */
export function warmSteps(slices) {
  const lit = (m) => (Array.isArray(m.material) ? m.material.some(litMaterial) : litMaterial(m.material));
  const steps = [];
  let cur = [];
  for (const sl of slices) {
    cur.push(...sl);
    if (sl.some(lit)) { steps.push(cur); cur = []; }
  }
  if (cur.length) steps.push(cur);
  return steps;
}

/** stamps: { lot, reflect, shadow }, the last frame (renderer.info.frame) the lot was drawn in, the tops' reflection was drawn in, and
 *  the key light's shadow map was drawn in. True when one frame later than `after` drew all three: whatever was visible from `after`
 *  on has then been drawn in every pass of the lot */
export function drawnInEveryPass(after, s) {
  for (const k of ['lot', 'reflect', 'shadow']) if (!Number.isInteger(s[k])) throw new Error('drawnInEveryPass: stamp ' + k + ' is ' + s[k] + ', not a frame number');
  return s.lot > after && s.reflect === s.lot && s.shadow === s.lot;
}
