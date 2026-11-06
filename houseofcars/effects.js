// effects.js - what the tyres leave behind: skid marks and smoke, laid only where Unreal's own rule says the tyre is skidding or
// slipping (IsSkidding: |GetSkidMagnitude| > SkidThreshold, IsSlipping: |GetSlipMagnitude| > SlipThreshold; WheelSystem.h, the
// thresholds READ per car), at the wheel trace's hit point, as wide as the READ wheel_width. How dark a mark is and how much smoke
// a slide makes are the page's own (AUTHORED). Serves UC-7.4.
import * as THREE from 'three/webgpu';
import { toThreePoint } from './ue_space.js';

const SEG = 6000;                                         // skid segments kept (the oldest is overwritten)
// 0..1 how hard a wheel slides: zero unless Unreal's rule says skidding / slipping, then growing with the magnitude (the curve is AUTHORED)
export const slideAmount = (w) => !w.inContact ? 0 : Math.max(w.skidding ? Math.pow(Math.min(1, Math.abs(w.skidCmS) / 700), 1.5) : 0,
  w.slipping ? Math.pow(Math.min(1, Math.abs(w.slipCmS) / 1000), 1.5) : 0);

export function makeSkids(scene) {
  const pos = new Float32Array(SEG * 4 * 3), col = new Float32Array(SEG * 4 * 4), idx = new Uint32Array(SEG * 6);
  for (let i = 0; i < SEG; i++) idx.set([4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 2, 4 * i + 1, 4 * i + 3], 6 * i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 1;
  scene.add(mesh);
  return { mesh, geo, pos, col, next: 0, last: [], smoke: makeSmoke(scene) };
}

export function clearSkids(S) {
  S.col.fill(0); S.geo.attributes.color.needsUpdate = true; S.last = []; S.next = 0;
  for (const p of S.smoke.parts) { p.life = 0; p.sprite.visible = false; }
}

// one frame: each wheel that slides adds a quad from where it was to where it is now
export function laySkids(S, v, carRightUe, widthsCm, dt) {
  v.wheels.forEach((w, i) => {
    const k = slideAmount(w);
    if (k <= 0.02 || !w.contactCm) { S.last[i] = null; return; }
    const half = widthsCm[i] / 2, p = w.contactCm;
    const L = [p[0] - carRightUe[0] * half, p[1] - carRightUe[1] * half, p[2] + 2], R = [p[0] + carRightUe[0] * half, p[1] + carRightUe[1] * half, p[2] + 2];
    const prev = S.last[i];
    if (prev && Math.hypot(p[0] - prev.p[0], p[1] - prev.p[1]) < 15) return;     // a new quad every 15 cm
    if (prev && Math.hypot(p[0] - prev.p[0], p[1] - prev.p[1]) < 400) {
      const q = S.next; S.next = (S.next + 1) % SEG;
      [prev.L, prev.R, L, R].forEach((c, j) => { S.pos.set(toThreePoint(c), 3 * (4 * q + j)); });
      const a0 = 0.34 * prev.k, a1 = 0.34 * k;
      S.col.set([0.05, 0.05, 0.05, a0, 0.05, 0.05, 0.05, a0, 0.05, 0.05, 0.05, a1, 0.05, 0.05, 0.05, a1], 16 * q);
      S.geo.attributes.position.needsUpdate = true; S.geo.attributes.color.needsUpdate = true;
    }
    S.last[i] = { p, L, R, k };
    if (k > 0.35) puff(S.smoke, toThreePoint(p), k);
  });
  tickSmoke(S.smoke, dt);
}

// ---------------------------------------------------------------- tyre smoke: a pool of soft sprites that rise, grow and fade
function smokeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  r.addColorStop(0, 'rgba(235,235,235,0.9)'); r.addColorStop(0.5, 'rgba(220,220,220,0.35)'); r.addColorStop(1, 'rgba(220,220,220,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeSmoke(scene) {
  const map = smokeTexture(), parts = [];
  for (let i = 0; i < 48; i++) {
    const m = new THREE.SpriteNodeMaterial({ map, transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
    parts.push({ sprite: s, life: 0, max: 1, vy: 0 });
  }
  return { parts, next: 0, clock: 0 };
}
function puff(M, at, k) {
  M.clock += k;
  if (M.clock < 1.2) return;                              // a puff per slid ~1.2 units of slide
  M.clock = 0;
  const p = M.parts[M.next]; M.next = (M.next + 1) % M.parts.length;
  p.life = p.max = 1.4 + Math.random() * 0.8; p.vy = 0.5 + Math.random() * 0.5;
  p.sprite.position.set(at[0] + (Math.random() - 0.5) * 0.3, at[1] + 0.25, at[2] + (Math.random() - 0.5) * 0.3);
  p.k = k; p.sprite.visible = true;
}
function tickSmoke(M, dt) {
  for (const p of M.parts) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.sprite.visible = false; continue; }
    const age = 1 - p.life / p.max;
    p.sprite.position.y += p.vy * dt;
    p.sprite.scale.setScalar(0.5 + 1.9 * age);
    p.sprite.material.opacity = 0.22 * p.k * (1 - age);
  }
}
