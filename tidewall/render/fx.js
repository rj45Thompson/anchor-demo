// fx.js - the GPU particles every effect is drawn with: muzzle flashes, smoke, shot trails, explosions, splashes, bubbles, ship
// wakes, dust, debris and the sparkle of a captured territory. A pool is ONE mesh drawn instanced (Mesh.count) whose particles live
// in instanced vertex attributes: where and when a particle was born, its velocity, life, sizes, gravity, drag, colour and shape.
// The vertex shader works out where each one is from the renderer's clock, so the CPU only writes a particle once, when it is
// born, into a ring of CAPACITY slots (the oldest is reused). No material is made per effect (11-09: the old effects made a new
// material per puff, and every new material built a shader in the frame it appeared: 30-300 ms stalls in battle).
//
// CAPACITY is 1000 per pool: the uniform-buffer limit found earlier (look.js CHUNK) caps an InstancedMesh's matrices at 1000; these
// pools hold their data in vertex attributes, not a uniform buffer, but keep to the same bound.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, vec2, vec3, vec4, float, uv, smoothstep, exp, max, min, mix, step, length, sin, cos, mrt,
         positionGeometry, select } from 'three/tsl';

export const CAPACITY = 1000;
const DEAD = -1e6;                      // a slot's birth time before it is first used: long dead

/** The shapes a particle can be drawn as (its fragment). */
export const Shape = Object.freeze({ Soft: 0, Ring: 1, Spark: 2 });

/** One pool. kind: 'smoke' (soft sprites, normal blending), 'glow' (sprites added to the frame and to the bloom's glow target),
 *  'flat' (soft discs and rings lying on the water, normal blending), 'debris' (small lit boxes that tumble and fall). */
export class ParticlePool {
  constructor(parent, uTime, kind, name) {
    if (!['smoke', 'glow', 'flat', 'debris'].includes(kind)) throw new Error('fx.js: no particle kind ' + kind);
    this.kind = kind; this.head = 0; this.dirty = false; this.uTime = uTime;
    // a0 = born x, y, z, time; a1 = velocity x, y, z, life (s); a2 = size at birth, size at death, gravity, drag; a3 = r, g, b,
    // alpha; a4 = shape, spin (rad/s), fade-in fraction of the life, -
    this.data = Array.from({ length: 5 }, () => new Float32Array(CAPACITY * 4));
    for (let i = 0; i < CAPACITY; i++) { this.data[0][i * 4 + 3] = DEAD; this.data[1][i * 4 + 3] = 1; }
    this.attrs = this.data.map((a) => new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage));
    const [a0, a1, a2, a3, a4] = this.attrs.map((a) => instancedBufferAttribute(a));
    const age = uTime.sub(a0.w), life = a1.w, k = age.div(life);
    const alive = step(0, age).mul(step(age, life));
    const drag = max(a2.w, 0.001);
    const travel = a1.xyz.mul(float(1).sub(exp(drag.negate().mul(age))).div(drag));   // v (1 - e^-dt) / d: slows to a stop
    const centre = a0.xyz.add(travel).add(vec3(0, a2.z.mul(age).mul(age).mul(-0.5), 0));
    const kk = min(max(k, 0), 1);
    const size = mix(a2.x, a2.y, float(1).sub(float(1).sub(kk).mul(float(1).sub(kk)))).mul(alive);   // grows fast, then slows
    const fadeIn = smoothstep(0, max(a4.z, 0.001), kk);
    const alpha = a3.w.mul(fadeIn).mul(float(1).sub(kk).mul(float(1).sub(kk)));
    const spin = a4.y.mul(age);
    const d = length(uv().sub(0.5)).mul(2);                                              // 0 at the centre, 1 at the edge
    const soft = smoothstep(1, 0.15, d);
    const ring = smoothstep(0.62, 0.8, d).mul(smoothstep(1, 0.88, d));
    const spark = smoothstep(1, 0, d).pow(3);
    const shape = select(a4.x.lessThan(0.5), soft, select(a4.x.lessThan(1.5), ring, spark));
    let mat, geo;
    if (kind === 'debris') {
      geo = new THREE.BoxGeometry(1, 1, 1);
      mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0, flatShading: true });
      const p = positionGeometry.mul(size);
      const c = cos(spin), s = sin(spin);
      const rx = vec3(p.x, p.y.mul(c).sub(p.z.mul(s)), p.y.mul(s).add(p.z.mul(c)));       // tumble about x, then y
      const c2 = cos(spin.mul(0.7)), s2 = sin(spin.mul(0.7));
      mat.positionNode = vec3(rx.x.mul(c2).add(rx.z.mul(s2)), rx.y, rx.z.mul(c2).sub(rx.x.mul(s2))).add(centre);
      mat.colorNode = a3.xyz;
    } else if (kind === 'flat') {
      geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      const p = positionGeometry.mul(size), c = cos(spin), s = sin(spin);
      mat.positionNode = vec3(p.x.mul(c).sub(p.z.mul(s)), p.y, p.x.mul(s).add(p.z.mul(c))).add(centre);
      mat.colorNode = a3.xyz;
      mat.opacityNode = alpha.mul(shape);
    } else {
      geo = new THREE.PlaneGeometry(1, 1);
      mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
      mat.positionNode = centre;
      mat.scaleNode = vec2(size, size);
      mat.rotationNode = spin;
      if (kind === 'glow') {
        mat.blending = THREE.AdditiveBlending;
        const c = a3.xyz.mul(alpha).mul(shape);
        mat.colorNode = c;
        mat.opacityNode = float(1);
        mat.mrtNode = mrt({ emissive: vec4(c, 1) });                                     // additive into the glow target too
      } else {
        mat.colorNode = a3.xyz;
        mat.opacityNode = alpha.mul(shape);
      }
    }
    // a see-through particle must not write the scene pass's normal target: the ambient occlusion reads normals with the depth (which
    // particles do not write), and a smoke quad's normal there darkened its whole square on the sea (11-09 frames). Alpha 0 in that
    // target leaves what is under it, with normal and with additive blending alike.
    if (kind !== 'debris') mat.mrtNode = kind === 'glow' ? mrt({ emissive: mat.mrtNode.outputNodes.emissive, normal: vec4(0, 0, 0, 0) }) : mrt({ normal: vec4(0, 0, 0, 0) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.count = CAPACITY; mesh.frustumCulled = false; mesh.name = name; mesh.renderOrder = kind === 'flat' ? 1 : 4;
    mesh.castShadow = false; mesh.receiveShadow = false;
    parent.add(mesh);
    this.mesh = mesh;
  }

  /** One particle, born now. o: { at: Vector3 (or x, y, z), vel: [x, y, z], life, size: [birth, death], gravity, drag,
   *  color: Color or [r, g, b] (values over 1 glow), alpha, shape, spin, fadeIn }. */
  emit(o) {
    const i = this.head, j = i * 4, d = this.data, at = o.at, v = o.vel ?? ZERO, col = o.color;
    this.head = (this.head + 1) % CAPACITY;
    d[0][j] = at.x; d[0][j + 1] = at.y; d[0][j + 2] = at.z; d[0][j + 3] = o.born ?? this.uTime.value;
    d[1][j] = v[0]; d[1][j + 1] = v[1]; d[1][j + 2] = v[2]; d[1][j + 3] = o.life;
    d[2][j] = o.size[0]; d[2][j + 1] = o.size[1]; d[2][j + 2] = o.gravity ?? 0; d[2][j + 3] = o.drag ?? 0;
    if (col.isColor) { d[3][j] = col.r; d[3][j + 1] = col.g; d[3][j + 2] = col.b; } else { d[3][j] = col[0]; d[3][j + 1] = col[1]; d[3][j + 2] = col[2]; }
    d[3][j + 3] = o.alpha ?? 1;
    d[4][j] = o.shape ?? Shape.Soft; d[4][j + 1] = o.spin ?? 0; d[4][j + 2] = o.fadeIn ?? 0.05;
    this.dirty = true;
  }

  /** Upload what was born this frame (whole attributes: 5 x 16 KB at most, only on a frame that emitted). */
  commit() {
    if (!this.dirty) return;
    for (const a of this.attrs) a.needsUpdate = true;
    this.dirty = false;
  }

  /** Every particle dead at once (a new level). */
  clear() {
    for (let i = 0; i < CAPACITY; i++) this.data[0][i * 4 + 3] = DEAD;
    this.dirty = true;
  }
}
const ZERO = [0, 0, 0];

/** The renderer's four pools, made once and shared by every level (a new level does not build new shaders). */
export class Fx {
  constructor(scene, uTime) {
    this.group = new THREE.Group(); this.group.name = 'fx'; scene.add(this.group);
    this.uTime = uTime;
    this.smoke = new ParticlePool(this.group, uTime, 'smoke', 'fx smoke');
    this.glow = new ParticlePool(this.group, uTime, 'glow', 'fx glow');
    this.flat = new ParticlePool(this.group, uTime, 'flat', 'fx water');
    this.debris = new ParticlePool(this.group, uTime, 'debris', 'fx debris');
    this.pools = [this.smoke, this.glow, this.flat, this.debris];
  }
  commit() { for (const p of this.pools) p.commit(); }
  clear() { for (const p of this.pools) p.clear(); }
}

// ---------------------------------------------------------------- the effects, each a burst of particles (sizes in squares, AUTHORED)
const WHITE = new THREE.Color(1, 1, 1), SMOKE = new THREE.Color(0.86, 0.85, 0.83), SOOT = new THREE.Color(0.3, 0.29, 0.29);
const FIRE = new THREE.Color(3.2, 1.5, 0.45), FLASH = new THREE.Color(4, 3.3, 2.2), SPRAY = new THREE.Color(0.92, 0.97, 1);
const EMBER = new THREE.Color(2.2, 0.7, 0.12), DUST = new THREE.Color(0.93, 0.87, 0.74), BUBBLE = new THREE.Color(0.85, 0.96, 1);

/** The game's effects as particle bursts. Spreads come from a small seeded generator, so the same match draws the same bursts. */
export class Effects {
  constructor(fx) { this.fx = fx; this.seed = 0x9e3779b9; }
  rnd() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0; return (this.seed >>> 8) / 16777216; }
  /** A random unit-ish direction in the horizontal plane times r, with an upward part `up`. */
  spread(r, up = 0) { const a = this.rnd() * Math.PI * 2, k = 0.4 + this.rnd() * 0.6; return [Math.cos(a) * r * k, up * (0.6 + this.rnd() * 0.4), Math.sin(a) * r * k]; }

  /** A gun going off at `at`, its muzzle pointing along `dir` (unit, horizontal): a white-hot flash, sparks in the shooter's colour
   *  and a cloud of smoke pushed out of the barrel. k scales it (a ship's gun is smaller). */
  muzzle(at, dir, colour, k = 1) {
    const { glow, smoke } = this.fx;
    glow.emit({ at, life: 0.13, size: [0.7 * k, 1.5 * k], color: FLASH, fadeIn: 0 });
    glow.emit({ at, life: 0.22, size: [0.5 * k, 1.0 * k], color: colour.clone().multiplyScalar(3), fadeIn: 0 });
    for (let i = 0; i < 7; i++) {
      const s = this.spread(1.2, 1.0);
      glow.emit({ at, vel: [dir.x * 4.5 + s[0], s[1], dir.z * 4.5 + s[2]], drag: 4, gravity: 3, life: 0.32 + this.rnd() * 0.2,
                  size: [0.13 * k, 0.03], color: FIRE, shape: Shape.Spark, fadeIn: 0 });
    }
    for (let i = 0; i < 9; i++) {
      const s = this.spread(0.6, 0.5), f = 1.2 + this.rnd() * 1.6;
      smoke.emit({ at, vel: [dir.x * f + s[0], 0.3 + s[1], dir.z * f + s[2]], drag: 2.2, life: 1.2 + this.rnd() * 0.8,
                   size: [0.28 * k, (0.9 + this.rnd() * 0.5) * k], color: SMOKE, alpha: 0.55, spin: (this.rnd() - 0.5) * 2, fadeIn: 0.08 });
    }
  }

  /** A puff of a flying shot's trail at `at`: thin smoke and a fading ember of the shot's colour. */
  trail(at, colour) {
    this.fx.smoke.emit({ at, vel: [0, 0.15, 0], drag: 1, life: 0.7, size: [0.12, 0.42], color: SMOKE, alpha: 0.32, spin: this.rnd() - 0.5, fadeIn: 0.1 });
    this.fx.glow.emit({ at, life: 0.28, size: [0.2, 0.05], color: colour.clone().multiplyScalar(2.2), fadeIn: 0 });
  }

  /** A shot or a wreck hitting the sea: two rings running out on the water, a column of spray, droplets that fall back, foam left. */
  splash(at, k = 1) {
    const { flat, smoke } = this.fx, now = this.fx.uTime.value, sea = { x: at.x, y: 0.04, z: at.z };
    flat.emit({ at: sea, life: 0.9, size: [0.3 * k, 1.9 * k], color: WHITE, alpha: 0.9, shape: Shape.Ring, fadeIn: 0 });
    flat.emit({ at: sea, born: now + 0.18, life: 1.0, size: [0.2 * k, 1.3 * k], color: WHITE, alpha: 0.7, shape: Shape.Ring, fadeIn: 0 });
    flat.emit({ at: sea, life: 2.2, size: [0.5 * k, 1.5 * k], color: WHITE, alpha: 0.45, spin: this.rnd(), fadeIn: 0.05 });
    for (let i = 0; i < 5; i++) {
      const s = this.spread(0.25, 2.8 * k);
      smoke.emit({ at: sea, vel: s, gravity: 7, life: 0.75, size: [0.28 * k, 0.5 * k], color: SPRAY, alpha: 0.8, fadeIn: 0 });
    }
    for (let i = 0; i < 14; i++) {
      const s = this.spread(1.4, 3.6 * k);
      smoke.emit({ at: sea, vel: s, gravity: 10, life: 0.8, size: [0.09, 0.05], color: SPRAY, alpha: 0.95, fadeIn: 0 });
    }
  }

  /** Something blown apart at `at`: a flash, a fireball, sparks, rising soot and chunks of `debris` colour that tumble and fall.
   *  k scales it. */
  explosion(at, debris, k = 1) {
    const { glow, smoke } = this.fx;
    glow.emit({ at, life: 0.16, size: [1.0 * k, 2.2 * k], color: FLASH, fadeIn: 0 });
    for (let i = 0; i < 8; i++) {
      const s = this.spread(1.6 * k, 1.2 * k);
      glow.emit({ at, vel: s, drag: 3.5, life: 0.38 + this.rnd() * 0.25, size: [0.35 * k, 0.85 * k], color: FIRE, fadeIn: 0 });
    }
    for (let i = 0; i < 10; i++) {
      const s = this.spread(3.2 * k, 3.5 * k);
      glow.emit({ at, vel: s, drag: 1.2, gravity: 7, life: 0.5 + this.rnd() * 0.4, size: [0.12, 0.03], color: FIRE, shape: Shape.Spark, fadeIn: 0 });
    }
    for (let i = 0; i < 8; i++) {
      const s = this.spread(0.9 * k, 1.1);
      smoke.emit({ at, vel: s, drag: 1.4, life: 1.6 + this.rnd(), size: [0.4 * k, 1.5 * k], color: SOOT, alpha: 0.6, spin: this.rnd() - 0.5, fadeIn: 0.12 });
    }
    this.chunks(at, debris, 8, k);
  }

  /** n chunks of `colour` thrown up from `at`, tumbling, falling under gravity. */
  chunks(at, colour, n, k = 1) {
    for (let i = 0; i < n; i++) {
      const s = this.spread(2.2 * k, 3.6 * k), c = colour.clone().multiplyScalar(0.8 + this.rnd() * 0.35);
      this.fx.debris.emit({ at, vel: s, gravity: 11, drag: 0.4, life: 0.9 + this.rnd() * 0.4, size: [0.13 * k, 0.11 * k], color: c,
                            spin: 6 + this.rnd() * 8, fadeIn: 0 });
    }
  }

  /** A low ring of dust where something landed on the ground (a placed piece's square, a placed cannon). */
  dust(at, k = 1, colour = DUST) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6 + this.rnd() * 0.1) * Math.PI * 2;
      this.fx.smoke.emit({ at: { x: at.x + Math.cos(a) * 0.3 * k, y: at.y + 0.06, z: at.z + Math.sin(a) * 0.3 * k },
                           vel: [Math.cos(a) * 1.1 * k, 0.25, Math.sin(a) * 1.1 * k], drag: 3.5, life: 0.75 + this.rnd() * 0.3,
                           size: [0.22 * k, 0.6 * k], color: colour, alpha: 0.55, spin: this.rnd() - 0.5, fadeIn: 0.05 });
    }
  }

  /** Bubbles rising where a ship goes down, and foam rings on the water over it. */
  bubbles(at, k = 1) {
    const s = this.spread(0.35 * k, 0);
    this.fx.smoke.emit({ at: { x: at.x + s[0], y: 0.02, z: at.z + s[2] }, vel: [0, 0.5 + this.rnd() * 0.4, 0], life: 0.7, size: [0.07, 0.15],
                         color: BUBBLE, alpha: 0.95, shape: Shape.Ring, fadeIn: 0.1 });
    if (this.rnd() < 0.35) this.fx.flat.emit({ at: { x: at.x + s[0], y: 0.04, z: at.z + s[2] }, life: 1.0, size: [0.1, 0.6], color: WHITE, alpha: 0.7, shape: Shape.Ring, fadeIn: 0 });
  }

  /** A ring of foam running out on the water at `at`, `r` squares wide (a sinking ship churns the sea). */
  foamRing(at, r) {
    this.fx.flat.emit({ at: { x: at.x, y: 0.045, z: at.z }, life: 1.1, size: [0.3 * r, 1.4 * r], color: WHITE, alpha: 0.75, shape: Shape.Ring, fadeIn: 0 });
    this.fx.flat.emit({ at: { x: at.x, y: 0.04, z: at.z }, life: 1.6, size: [0.4 * r, 0.9 * r], color: WHITE, alpha: 0.4, spin: this.rnd(), fadeIn: 0.05 });
  }

  /** n planks of `colour` thrown from a wreck: they fly a little, land on the water and float there, drifting, while they fade. */
  planks(at, colour, n, k = 1) {
    for (let i = 0; i < n; i++) {
      const s = this.spread(1.6 * k, 0), c = colour.clone().multiplyScalar(0.7 + this.rnd() * 0.4);
      this.fx.flat.emit({ at: { x: at.x + s[0] * 0.3, y: 0.05, z: at.z + s[2] * 0.3 }, vel: [s[0], 0, s[2]], drag: 1.1, life: 4 + this.rnd() * 2,
                          size: [0.22 * k, 0.22 * k], color: c, alpha: 0.95, spin: (this.rnd() - 0.5) * 0.8, fadeIn: 0 });
    }
  }

  /** A glint of `colour` rising from `at`, starting `delay` seconds from now (the territory sweep). */
  sparkle(at, colour, delay = 0) {
    this.fx.glow.emit({ at, born: this.fx.uTime.value + delay, vel: [0, 0.9 + this.rnd() * 0.6, 0], drag: 1.2, life: 0.9,
                        size: [0.22, 0.04], color: colour.clone().multiplyScalar(2.6), shape: Shape.Spark, fadeIn: 0.1 });
  }

  /** A bright burst of `colour` (a claimed castle, a sword's strike). */
  flash(at, colour, size = 1) {
    this.fx.glow.emit({ at, life: 0.35, size: [0.6 * size, 2.2 * size], color: colour.clone().multiplyScalar(3), fadeIn: 0 });
    for (let i = 0; i < 6; i++) {
      const s = this.spread(2 * size, 1.5 * size);
      this.fx.glow.emit({ at, vel: s, drag: 3, life: 0.45, size: [0.14, 0.03], color: colour.clone().multiplyScalar(3), shape: Shape.Spark, fadeIn: 0 });
    }
  }

  /** The lit fuse's spark at `at`: one short-lived ember thrown up and out (a bomb calls it a few times a second). */
  fuseSpark(at) {
    const s = this.spread(0.7, 1.0);
    this.fx.glow.emit({ at, vel: s, drag: 2, gravity: 4, life: 0.22 + this.rnd() * 0.12, size: [0.08, 0.015], color: FIRE, shape: Shape.Spark, fadeIn: 0 });
  }

  /** One square of a blast's cross of flame: a column of fire rising from the ground, sparks, a curl of smoke. k scales it. */
  flame(at, k = 1) {
    const { glow, smoke } = this.fx;
    glow.emit({ at, vel: [0, 1.3, 0], drag: 3, life: 0.4, size: [0.8 * k, 1.2 * k], color: EMBER, fadeIn: 0 });
    glow.emit({ at: { x: at.x, y: at.y + 0.25, z: at.z }, vel: [0, 2, 0], drag: 3, life: 0.3, size: [0.45 * k, 0.8 * k], color: FIRE, alpha: 0.8, fadeIn: 0 });
    for (let i = 0; i < 2; i++) {
      const s = this.spread(1.6, 2.6);
      glow.emit({ at, vel: s, drag: 1.5, gravity: 7, life: 0.4 + this.rnd() * 0.25, size: [0.1, 0.025], color: FIRE, shape: Shape.Spark, fadeIn: 0 });
    }
    const s = this.spread(0.5, 0.9);
    smoke.emit({ at, vel: s, drag: 1.4, life: 1.2 + this.rnd() * 0.6, size: [0.35 * k, 1.1 * k], color: SOOT, alpha: 0.5, spin: this.rnd() - 0.5, fadeIn: 0.15 });
  }

  /** The dark scorch a blast leaves on the ground, fading over a few seconds. */
  scorch(at, k = 1) {
    this.fx.flat.emit({ at: { x: at.x, y: 0.05, z: at.z }, life: 6, size: [0.85 * k, 0.95 * k], color: SOOT.clone().multiplyScalar(0.35), alpha: 0.55, spin: this.rnd() * 3, fadeIn: 0.02 });
  }

  /** A wisp of dark smoke rising from something damaged (a hurt castle, CASTLE_DAMAGE_UC.md UC-L5). */
  smokeWisp(at, k = 1) {
    const s = this.spread(0.25, 0.7);
    this.fx.smoke.emit({ at, vel: [s[0], 0.55 + s[1], s[2]], drag: 0.9, life: 1.8 + this.rnd() * 0.8, size: [0.3 * k, 1.2 * k], color: SOOT, alpha: 0.42, spin: this.rnd() - 0.5, fadeIn: 0.2 });
  }

  /** A small puff of pale smoke where a bomb was put out. */
  puff(at) {
    for (let i = 0; i < 6; i++) {
      const s = this.spread(0.8, 0.9);
      this.fx.smoke.emit({ at, vel: s, drag: 2, life: 0.8 + this.rnd() * 0.4, size: [0.15, 0.55], color: WHITE, alpha: 0.6, spin: this.rnd() - 0.5, fadeIn: 0.08 });
    }
  }
}
