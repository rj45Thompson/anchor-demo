// lot_focus.js - the pedestal tops' reflection draws only what can show in the tops in view (graphics pass 11-08). MEASURED 11-08 on
// RJ's PC (RTX 2080, Chrome 156 headless, WebGPU, 2560 x 1250 px; D:/_houseofcars/GFX_REPORT.md), with the cars already batched
// (batch.js): of the lot's 500 draw calls a frame, the reflection (fx.js polishedTops: one more render of the whole scene a frame,
// mirrored in the tops' plane) drew 180, for 3.8 ms of JavaScript, though it can only show in the few tops near the camera.
//
// While the reflector draws, two kinds of mesh are hidden, and shown again straight after:
//  - everything wholly under the mirror plane (the floor, the ring light, the pedestals' sides, the plinths): the reflector's
//    oblique clip plane already cuts all of it away, so hiding it changes no pixel; none of it casts a shadow
//  - the pieces of every slide farther than REFLECT_M from the slide in view, unless the view sees the whole ring (the intro's
//    fly-in from above, walking the lot: update's `whole`), when nothing is culled
// Only meshes are hidden, never a light: a light hidden for one render would change the lit materials' light set and rebuild them.
// The key light's shadow map is never drawn from inside the reflection's render: three renders it once a frame, from whichever
// pass reaches it first (11-08: always the main pass, 356 frames of 356, before and after this change), and a far slide hidden
// then would cast no shadow for that frame. So the far slides are hidden only once the shadow map has been drawn this frame
// (its camera's matrices updated, stamped with renderer.info.frame); otherwise the reflection draws them, exactly as before.
// Tried first and dropped (11-08 pictures, GFX_REPORT.md): the shadow map's box fitted round the slide in view as well. It saved
// little once the cars were batched (117 draws a frame to 101 on the Ghost's slide) and the cars across the ring lost their
// shadows, in the welcome view's wheel arches and the intro's fly-in.
// Off (active = false) until app.js has warmed the lot (UC-30): the warm-up draws every piece in every pass, the reflection's too.
//
// Pure parts (test/lot_focus.test.mjs): FOCUS, farFrom. makeLotFocus(THREE, opts) wraps them.

// AUTHORED (graphics pass 11-08): the slide in view and three either side (app.js RING: 18 slides on a 26.9 m ring, neighbours
// 9.4, 18.4 and 26.9 m apart), with a car's reach (2.75 m) to spare. The reflection of a slide farther off can only show in a top
// across the ring, a few pixels at the horizon: the before/after pictures differ there by less than run-to-run noise
export const FOCUS = { REFLECT_M: 29 };

/** which of the points [x, z] lie farther than r from the focus [x, z] (a Uint8Array of 0 / 1) */
export function farFrom(points, focus, r) {
  const out = new Uint8Array(points.length);
  points.forEach((p, i) => { out[i] = Math.hypot(p[0] - focus[0], p[1] - focus[1]) > r ? 1 : 0; });
  return out;
}

/** opts: { renderer, light (the shadow-casting DirectionalLight), reflector (fx.js polishedTops(...).reflector), planeY (the tops'
 *  height), scene, stands (each slide's Group, in slide order) }. Returns { update(x, z, whole), active, stats, shadowFrame,
 *  reflectFrame (the last frames the shadow map and the reflection were drawn in: renderer.info.frame), reflecting } */
export function makeLotFocus(THREE, o) {
  const { renderer, light, reflector, planeY, scene, stands } = o;
  if (!renderer || !renderer.info) throw new Error('lot_focus: opts.renderer must be the page\'s renderer (its info.frame stamps the shadow map)');
  if (!light || !light.isDirectionalLight || !light.castShadow) throw new Error('lot_focus: opts.light must be the shadow-casting DirectionalLight');
  if (!reflector || typeof reflector.updateBefore !== 'function') throw new Error('lot_focus: opts.reflector must be the tops\' ReflectorBaseNode (fx.js polishedTops)');
  // wholly under the mirror plane and casting no shadow: the floor, the ring light, every pedestal's sides and every plinth
  const below = [], box = new THREE.Box3();
  scene.updateMatrixWorld(true);
  scene.traverse((m) => { if (m.isMesh && !m.castShadow && box.setFromObject(m).max.y < planeY) below.push(m); });
  // a slide's drawn pieces are its direct children but its lights; a light deeper down would be hidden with its piece
  for (const s of stands) for (const c of s.children) if (!c.isLight) c.traverse((x) => { if (x.isLight) throw new Error('lot_focus: a light inside a piece of a slide (' + (c.name || c.type) + '): hiding the piece would hide the light'); });
  const at = stands.map((s) => [s.position.x, s.position.z]), none = new Uint8Array(stands.length);
  const F = { active: false, focus: [at[0][0], at[0][1]], whole: true, far: none, shadowFrame: -1, reflectFrame: -1, reflecting: false, stats: { reflectHidden: 0, below: below.length, unculled: 0 } };
  // the shadow map's frame: three updates its camera's matrices right before it draws it (LightShadow.updateMatrices)
  const um = light.shadow.updateMatrices;
  light.shadow.updateMatrices = function (l) { F.shadowFrame = renderer.info.frame; return um.call(this, l); };
  /** x, z: the slide in view; whole: the view sees the whole ring (nothing culled) */
  F.update = (x, z, whole) => {
    F.focus = [x, z]; F.whole = !!whole;
    F.far = whole ? none : farFrom(at, F.focus, FOCUS.REFLECT_M);
  };
  const run = reflector.updateBefore;
  // UC-44.2 for app.js's warm-up (warm.js): reflecting, true while the reflection renders (a joining car's material is prepared here in
  // one frame and in the main view in the next, so no frame builds it twice); reflectFrame, the frame the reflection was last drawn in
  // (its render added draw calls; three skips it when the view faces away from the tops)
  const drew = (calls) => { F.reflecting = false; if (renderer.info.render.drawCalls > calls) F.reflectFrame = renderer.info.frame; };
  reflector.updateBefore = function (frame) {
    const calls = renderer.info.render.drawCalls;
    F.reflecting = true;
    if (!F.active) { try { return run.call(this, frame); } finally { drew(calls); } }
    const hid = [];
    const hide = (m) => { if (m.visible) { m.visible = false; hid.push(m); } };
    for (const m of below) hide(m);
    if (F.shadowFrame === renderer.info.frame) { for (let i = 0; i < stands.length; i++) if (F.far[i]) for (const c of stands[i].children) if (!c.isLight) hide(c); }
    else F.stats.unculled++;                                           // the shadow map is still to come this frame: cull no slide
    F.stats.reflectHidden = hid.length;
    try { return run.call(this, frame); } finally { for (const m of hid) m.visible = true; drew(calls); }
  };
  return F;
}
