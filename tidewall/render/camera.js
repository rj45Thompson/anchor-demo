// camera.js - the one shared camera. It frames the whole island (or, when asked, every hero with room round them), at a 3/4 angle
// for the battle and swung to near top-down while pieces are placed (REPAIR), eased between the two so it glides. The framing is
// solved by projection: the camera is pulled back until every corner of the box it must show sits inside the screen's safe area
// (the HUD's banner at the top and the player cards at the bottom are kept clear).
import * as THREE from 'three/webgpu';

export const PITCH_BATTLE = 54, PITCH_BUILD = 80, FOV = 38;   // AUTHORED: degrees down from level; vertical field of view
const SAFE = { left: 0.04, right: 0.04, top: 0.13, bottom: 0.2 }; // AUTHORED: fractions of the screen the HUD covers
const SWING_SECONDS = 1.1;                                      // AUTHORED: the swing between the two angles

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 400);
    this.k = 0; this.kWant = 0;        // 0 = battle angle, 1 = build angle
    this.box = null; this.follow = false;
    this.pose = null;
    this.shake = 0;
  }

  /** Solve one pose: where the camera stands to show `box` ({x0,y0,x1,y1} squares, y up to `top`) at `pitchDeg`. */
  solve(box, pitchDeg, top) {
    const cam = this.camera, p = THREE.MathUtils.degToRad(pitchDeg);
    const fwd = new THREE.Vector3(0, -Math.sin(p), -Math.cos(p));      // looking north (row 0 at the top of the screen) and down
    const pts = [];
    for (const x of [box.x0, box.x1]) for (const z of [box.y0, box.y1]) for (const y of [0, top]) pts.push(new THREE.Vector3(x, y, z));
    const target = new THREE.Vector3((box.x0 + box.x1) / 2, 0, (box.y0 + box.y1) / 2);
    const wantX = (SAFE.left - SAFE.right), wantY = (SAFE.bottom - SAFE.top);   // the safe area's centre in NDC
    const halfX = 1 - SAFE.left - SAFE.right, halfY = 1 - SAFE.top - SAFE.bottom;
    let dist = 30;
    const place = () => {
      cam.position.copy(target).addScaledVector(fwd, -dist);
      cam.up.set(0, 1, 0); cam.lookAt(target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    };
    const extent = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of pts) { const v = q.clone().project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
      return { x0, x1, y0, y1 };
    };
    for (let pass = 0; pass < 4; pass++) {
      let lo = 2, hi = 400;                                            // the nearest distance at which the box fits
      for (let i = 0; i < 40; i++) {
        dist = (lo + hi) / 2; place();
        const e = extent();
        if ((e.x1 - e.x0) / 2 <= halfX && (e.y1 - e.y0) / 2 <= halfY) hi = dist; else lo = dist;
      }
      dist = hi; place();
      const e = extent();
      // centre the box in the safe area: move the target across the ground by the NDC error
      const cx = (e.x0 + e.x1) / 2 - wantX, cy = (e.y0 + e.y1) / 2 - wantY;
      const hh = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * dist, hw = hh * cam.aspect;
      target.x += cx * hw;
      target.z -= cy * hh / Math.max(0.2, Math.sin(p));
    }
    place();
    return { pos: cam.position.clone(), target: target.clone() };
  }

  /** The island's box (from the board) and whether REPAIR is on; heroes for the follow framing. */
  update(dt, box, building, heroSpots) {
    let frame = box;
    if (this.follow && heroSpots.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of heroSpots) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.z); y1 = Math.max(y1, s.z); }
      const pad = 6;                                                   // AUTHORED: squares of room round the heroes
      frame = { x0: Math.max(box.x0, x0 - pad), y0: Math.max(box.y0, y0 - pad), x1: Math.min(box.x1, x1 + pad), y1: Math.min(box.y1, y1 + pad) };
    }
    this.kWant = building ? 1 : 0;
    const step = dt / SWING_SECONDS;
    this.k = this.kWant > this.k ? Math.min(this.kWant, this.k + step) : Math.max(this.kWant, this.k - step);
    const s = this.k * this.k * (3 - 2 * this.k);
    const key = JSON.stringify(frame) + this.camera.aspect.toFixed(4);
    if (key !== this.key) { this.key = key; this.battle = this.solve(frame, PITCH_BATTLE, 1.6); this.build = this.solve(frame, PITCH_BUILD, 1.6); }
    const pos = this.battle.pos.clone().lerp(this.build.pos, s), target = this.battle.target.clone().lerp(this.build.target, s);
    if (!this.pose) this.pose = { pos: pos.clone(), target: target.clone() };
    const f = this.follow ? Math.min(1, dt * 3) : 1;                   // the follow framing glides; the island framing is exact
    this.pose.pos.lerp(pos, f); this.pose.target.lerp(target, f);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const j = this.shake * this.shake * 0.25, t = performance.now() / 1000;
    this.camera.position.copy(this.pose.pos).add(new THREE.Vector3(Math.sin(t * 61) * j, Math.sin(t * 47) * j, Math.sin(t * 53) * j));
    this.camera.lookAt(this.pose.target);
    return s;
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); this.key = null; }
}
