// weather.js - the storm's rain and lightning (MOOD_UC.md UC-L6, AAA gap 6 "weather"). It follows the level's mood (render/moods.js
// `weather`): null is a dry level, and a storm has rain streaks over the board and a lightning flash now and then. It only draws: the
// rules never see it, so the parity traces cannot move.
//
// The rain is one LineSegments of `drops` streaks in a box over the board, each falling and blown by the wind and wrapped to the top
// when it reaches the ground (the CPU moves them: 2 points a streak, a few thousand floats a frame). A flash lifts the sky fill, the
// sun and the exposure for FLASH_SECONDS with a second flicker in it, and a bolt stands in the sea past the island's edge for its
// first part. Under reduced motion (SETTINGS_UC.md UC-ST2) there is no flash at all: the rain still falls.
import * as THREE from 'three/webgpu';
import { STORE_PACKS } from './packs.js';

// AUTHORED (UC-L6): the streaks' length in squares and their colour and opacity; the rain box's height over the ground and its margin
// round the board; how long a flash lasts, how much it lifts the sky fill (times its own strength), the sun and the exposure; the
// bolt's height and width in squares and how far past the land it strikes
const STREAK = 0.7, RAIN_COLOUR = 0xd6dee8, RAIN_OPACITY = 0.42, RAIN_TOP = 14, RAIN_MARGIN = 4;
const FLASH_SECONDS = 0.55, FLASH_SKY = 2.4, FLASH_SUN = 0.6, FLASH_EXPOSURE = 0.35;
const BOLT_TOP = 26, BOLT_OUT = 6, BOLT_SECONDS = 0.22, BOLT_GLOW = 9, BOLT_COLOUR = new THREE.Color(0.82, 0.9, 1.15);
const BOLT_TEX = 'assets/textures/store/lightning_bolt.png', GLOW_TEX = 'assets/textures/store/lightning_glow.png';
const BOLT_ASPECT = 157 / 512;                // the bolt texture's width over its height (tools: cropped to the bolt, 157 x 512 px)

/** The flash's strength 0..1 at t seconds into it: a sharp rise, a dip, a second flicker, then a fade. */
export function flashAt(t) {
  if (!(t >= 0) || t >= FLASH_SECONDS) return 0;
  const k = t / FLASH_SECONDS;
  return k < 0.08 ? k / 0.08 : k < 0.22 ? 1 - (k - 0.08) / 0.14 * 0.75 : k < 0.32 ? 0.25 + (k - 0.22) / 0.1 * 0.6 : 0.85 * (1 - (k - 0.32) / 0.68);
}

export class Weather {
  /** tex: Weather.loadTextures()'s { bolt, glow }. */
  constructor(scene, tex) {
    if (!tex || !tex.bolt || !tex.glow) throw new Error('weather.js: the bolt textures are required (await Weather.loadTextures())');
    this.scene = scene; this.tex = tex;
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

  /** The bolt's textures (11-11, RJ's request): a Unity Asset Store VFX pack's branching bolt (Lightning1_Ray1, cropped
   *  to the bolt and its luminance made its alpha) and its glow flare (lightning_new_glow2), Unity Asset Store textures RJ holds the licence to; a texture that
   *  does not load stops the page (no stand-in). */
  static async loadTextures() {
    if (!STORE_PACKS) return Weather.drawnTextures();
    const loader = new THREE.TextureLoader(), load = async (url) => {
      try { const t = await loader.loadAsync(url); t.colorSpace = THREE.SRGBColorSpace; return t; }
      catch (e) { throw new Error('weather.js: ' + url + ' did not load: ' + (e && e.message ? e.message : e)); }
    };
    return { bolt: await load(BOLT_TEX), glow: await load(GLOW_TEX) };
  }

  /** The bolt and its glow drawn in code, this game's own (render/packs.js STORE_PACKS false: the store pack's textures are held).
   *  The bolt: a jagged stroke from the top centre to the foot, with two forks, each segment displaced at random about the line
   *  (a fixed seed: the same bolt every load), drawn white with a soft blur round it on a 157 x 512 canvas (BOLT_ASPECT, so the quad
   *  is the store texture's size); its alpha is its brightness, as the store one's was made. The glow: a radial white falloff. */
  static drawnTextures() {
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const W = 157, H = 512, bolt = document.createElement('canvas'); bolt.width = W; bolt.height = H;
    const g = bolt.getContext('2d');
    // AUTHORED: segments down the main stroke, how far each strays (px), the forks' start (fraction of the way down) and lean
    const path = (x0, y0, x1, y1, n, stray) => {
      const pts = [[x0, y0]];
      for (let i = 1; i < n; i++) { const k = i / n; pts.push([x0 + (x1 - x0) * k + (rnd() - 0.5) * 2 * stray, y0 + (y1 - y0) * k]); }
      pts.push([x1, y1]); return pts;
    };
    const stroke = (pts, width, blur) => {
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
      g.lineJoin = 'miter'; g.lineCap = 'round'; g.strokeStyle = '#fff'; g.lineWidth = width; g.shadowColor = '#fff'; g.shadowBlur = blur; g.stroke();
    };
    const main = path(W / 2, 0, W / 2 + (rnd() - 0.5) * 30, H, 18, 14);
    for (const [at, lean, len] of [[0.3, -1, 0.32], [0.55, 1, 0.26]]) {
      const [fx, fy] = main[Math.round(at * (main.length - 1))];
      stroke(path(fx, fy, fx + lean * W * 0.38, fy + H * len, 8, 9), 2, 8);
    }
    stroke(main, 4, 14);
    stroke(main, 1.5, 0);
    const glow = document.createElement('canvas'); glow.width = glow.height = 256;
    const q = glow.getContext('2d'), rg = q.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    q.fillStyle = rg; q.fillRect(0, 0, 256, 256);
    const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    return { bolt: tex(bolt), glow: tex(glow) };
  }

  /** A bolt from the cloud to the sea past one edge of the board: the bolt texture on an upright quad turned to the camera, added
   *  onto the picture, with the glow flare where it meets the water. Mirrored at random, so two strikes in a row differ. */
  strike(camera) {
    if (!this.bolt) {
      if (!this.tex) throw new Error('weather.js: strike() before the bolt textures were handed in (Weather constructor)');
      const add = (map, colour) => new THREE.MeshBasicNodeMaterial({ map, color: colour, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, side: THREE.DoubleSide });
      const quad = (w, h) => { const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0); return g; };
      this.bolt = new THREE.Group(); this.bolt.renderOrder = 5;
      const ray = new THREE.Mesh(quad(BOLT_TOP * BOLT_ASPECT, BOLT_TOP), add(this.tex.bolt, BOLT_COLOUR));
      const glow = new THREE.Mesh(quad(BOLT_GLOW, BOLT_GLOW), add(this.tex.glow, BOLT_COLOUR)); glow.position.y = -BOLT_GLOW / 2;
      for (const m of [ray, glow]) { m.frustumCulled = false; m.renderOrder = 5; this.bolt.add(m); }
      this.bolt.userData.ray = ray;
      this.group.add(this.bolt);
    }
    const side = Math.floor(this.rnd() * 4), along = this.rnd();
    const at = side === 0 ? [along * this.w, -BOLT_OUT] : side === 1 ? [this.w + BOLT_OUT, along * this.h]
             : side === 2 ? [along * this.w, this.h + BOLT_OUT] : [-BOLT_OUT, along * this.h];
    this.bolt.userData.ray.scale.x = this.rnd() < 0.5 ? -1 : 1;
    this.bolt.position.set(at[0], 0, at[1]);
    // it faces the camera about the upright axis only, so it stays standing
    this.bolt.rotation.set(0, Math.atan2(camera.position.x - at[0], camera.position.z - at[1]), 0);
  }

  /** For the page check: how many streaks fall, how many strikes came and the brightest flash shown. */
  report() { return { drops: this.rain ? this.rain.n : 0, flashes: this.flashes, flashMax: this.flashMax, raining: !!this.of }; }

  dispose() {
    this.clearRain();
    if (this.bolt) this.bolt.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.scene.remove(this.group);
  }
}
