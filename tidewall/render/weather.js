// weather.js - the storm's rain and lightning (MOOD_UC.md UC-L6, AAA gap 6 "weather"). It follows the level's mood (render/moods.js
// `weather`): null is a dry level, and a storm has rain streaks over the board and a lightning flash now and then. It only draws: the
// rules never see it, so the parity traces cannot move.
//
// The rain is one LineSegments of `drops` streaks in a box over the board, each falling and blown by the wind and wrapped to the top
// when it reaches the ground (the CPU moves them: 2 points a streak, a few thousand floats a frame). A flash lifts the sky fill, the
// sun and the exposure for FLASH_SECONDS with a second flicker in it, and a bolt stands in the sea past the island's edge for its
// first part. Under reduced motion (SETTINGS_UC.md UC-ST2) there is no flash at all: the rain still falls.
import * as THREE from 'three/webgpu';

// AUTHORED (UC-L6): the streaks' length in squares and their colour and opacity; the rain box's height over the ground and its margin
// round the board; how long a flash lasts, how much it lifts the sky fill (times its own strength), the sun and the exposure; the
// bolt's height and width in squares and how far past the land it strikes
const STREAK = 0.7, RAIN_COLOUR = 0xd6dee8, RAIN_OPACITY = 0.42, RAIN_TOP = 14, RAIN_MARGIN = 4;
const FLASH_SECONDS = 0.55, FLASH_SKY = 2.4, FLASH_SUN = 0.6, FLASH_EXPOSURE = 0.35;
const BOLT_TOP = 26, BOLT_W = 0.45, BOLT_OUT = 6, BOLT_SECONDS = 0.22, BOLT_STEPS = 9;

/** The flash's strength 0..1 at t seconds into it: a sharp rise, a dip, a second flicker, then a fade. */
export function flashAt(t) {
  if (!(t >= 0) || t >= FLASH_SECONDS) return 0;
  const k = t / FLASH_SECONDS;
  return k < 0.08 ? k / 0.08 : k < 0.22 ? 1 - (k - 0.08) / 0.14 * 0.75 : k < 0.32 ? 0.25 + (k - 0.22) / 0.1 * 0.6 : 0.85 * (1 - (k - 0.32) / 0.68);
}

export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'weather'; scene.add(this.group);
    this.rain = null;              // { lines, pos, n, box, w } while it rains
    this.of = undefined;           // the mood's weather the rain was built for
    this.seed = 1;                 // a small LCG of its own: the strikes are the same every run of a level
    this.next = Infinity;          // seconds until the next flash
    this.t = Infinity;             // seconds into the flash showing now
    this.flashes = 0; this.flashMax = 0;   // what was shown, for the page check (report)
    this.bolt = null;
  }

  rnd() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  /** A new level: the board's size in squares and the level, so its strikes start from the same place every time. */
  setLevel(w, h, level) {
    this.w = w; this.h = h; this.seed = (level * 2654435761) >>> 0 || 1;
    this.of = undefined;
  }

  build(weather) {
    this.clearRain();
    this.of = weather;
    this.t = Infinity; this.next = weather ? weather.every[0] * 0.5 + this.rnd() * weather.every[0] : Infinity;
    if (!weather) return;
    const n = weather.drops, pos = new Float32Array(n * 6);
    const box = { x0: -RAIN_MARGIN, x1: this.w + RAIN_MARGIN, z0: -RAIN_MARGIN, z1: this.h + RAIN_MARGIN };
    for (let i = 0; i < n; i++) {
      const x = box.x0 + this.rnd() * (box.x1 - box.x0), z = box.z0 + this.rnd() * (box.z1 - box.z0), y = this.rnd() * RAIN_TOP;
      pos.set([x, y, z, x, y + STREAK, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    // the scene pass writes the view normal for the ambient occlusion (renderer.js buildPost MRT), so every drawn thing needs one
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 6).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(this.w / 2, RAIN_TOP / 2, this.h / 2), Math.hypot(box.x1 - box.x0, RAIN_TOP, box.z1 - box.z0) / 2);
    const mat = new THREE.LineBasicNodeMaterial({ color: RAIN_COLOUR, transparent: true, opacity: RAIN_OPACITY, depthWrite: false, fog: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false; lines.renderOrder = 4;
    this.group.add(lines);
    this.rain = { lines, pos, n, box };
  }

  clearRain() {
    if (!this.rain) return;
    this.group.remove(this.rain.lines);
    this.rain.lines.geometry.dispose(); this.rain.lines.material.dispose();
    this.rain = null;
  }

  /** One frame: rain falls, a strike comes when it is due. mood: the level's (render/mood.js current); base: the lights as the mood
   *  set them ({ sunI, skyI, exposure }); sun, hemi, gpu: what a flash lifts; camera: a bolt faces it; reduced: no flash (UC-ST2). */
  update(dt, mood, sun, hemi, gpu, camera, reduced) {
    if (mood.weather !== this.of) this.build(mood.weather);
    const w = this.of;
    if (this.rain) {
      const { pos, n, box } = this.rain, fall = w.fall * dt, blow = w.wind * dt, span = box.x1 - box.x0;
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        let x = pos[o] + blow, y = pos[o + 1] - fall;
        if (y < 0) { y += RAIN_TOP; x -= w.wind * (RAIN_TOP / w.fall); }   // back to the top, where its slant began
        if (x > box.x1) x -= span; else if (x < box.x0) x += span;
        // the streak's top trails up-wind of its foot, along the line it falls on
        pos[o] = x; pos[o + 1] = y; pos[o + 3] = x - w.wind / w.fall * STREAK; pos[o + 4] = y + STREAK;
      }
      this.rain.lines.geometry.attributes.position.needsUpdate = true;
    }
    let k = 0;
    if (w) {
      this.next -= dt;
      if (this.next <= 0) {
        this.next = w.every[0] + this.rnd() * (w.every[1] - w.every[0]);
        this.t = 0; this.flashes++;
        if (!reduced) this.strike(camera);
      }
      if (this.t < FLASH_SECONDS) { k = reduced ? 0 : flashAt(this.t); this.t += dt; }
    }
    if (this.bolt) this.bolt.visible = !reduced && this.t < BOLT_SECONDS;
    this.flashMax = Math.max(this.flashMax, k);
    this.flash = k;
    const m = mood;
    sun.intensity = m.sunI * (1 + FLASH_SUN * k);
    hemi.intensity = m.skyI * (1 + FLASH_SKY * k);
    gpu.toneMappingExposure = m.exposure + FLASH_EXPOSURE * k;
  }

  /** A bolt from the cloud to the sea past one edge of the board, a jagged ribbon facing the camera. */
  strike(camera) {
    if (!this.bolt) {
      const mat = new THREE.MeshBasicNodeMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0.95, depthWrite: false, fog: false, side: THREE.DoubleSide });
      this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      this.bolt.frustumCulled = false; this.bolt.renderOrder = 5;
      this.group.add(this.bolt);
    }
    const side = Math.floor(this.rnd() * 4), along = this.rnd();
    const at = side === 0 ? [along * this.w, -BOLT_OUT] : side === 1 ? [this.w + BOLT_OUT, along * this.h]
             : side === 2 ? [along * this.w, this.h + BOLT_OUT] : [-BOLT_OUT, along * this.h];
    const pts = [];
    let x = 0;
    for (let i = 0; i <= BOLT_STEPS; i++) { pts.push([x, BOLT_TOP * (1 - i / BOLT_STEPS)]); x += (this.rnd() - 0.5) * 2.2; }
    const v = [];
    for (let i = 0; i < BOLT_STEPS; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], wa = BOLT_W * (1 - i / BOLT_STEPS * 0.6), wb = BOLT_W * (1 - (i + 1) / BOLT_STEPS * 0.6);
      v.push(ax - wa, ay, 0, ax + wa, ay, 0, bx + wb, by, 0, ax - wa, ay, 0, bx + wb, by, 0, bx - wb, by, 0);
    }
    const g = this.bolt.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(v.length).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));   // the AO's view normal (see build)
    g.computeBoundingSphere();
    this.bolt.position.set(at[0], 0, at[1]);
    // it faces the camera about the upright axis only, so it stays standing
    this.bolt.rotation.set(0, Math.atan2(camera.position.x - at[0], camera.position.z - at[1]), 0);
  }

  /** For the page check: how many streaks fall, how many strikes came and the brightest flash shown. */
  report() { return { drops: this.rain ? this.rain.n : 0, flashes: this.flashes, flashMax: this.flashMax, raining: !!this.of }; }

  dispose() { this.clearRain(); if (this.bolt) { this.bolt.geometry.dispose(); this.bolt.material.dispose(); } this.scene.remove(this.group); }
}
