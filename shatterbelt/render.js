// render.js: draws a Game with three.js (r128, the global THREE that index.html loads).
//
// It only reads the game: positions, angles, and the events each step returns. It never changes a rule.
// The play field is a flat rectangle on the ground plane, seen by a camera tilted a little. Its edges
// wrap, so anything near an edge is also drawn on the opposite side, and everything in play is clipped
// to the rectangle: a rock leaving on the right is cut at the edge as its copy slides in on the left.
import { PoolSize } from './core.js';

const THREE = window.THREE;

const SHARED = '../games/assets/'; // the site's space art, shared with Résumé Breakout (sky, planets, rock surface)
const OWN = 'assets/';

// ---- loading -----------------------------------------------------------------------------------

// Everything the renderer draws with. Any file that fails to load stops the game with its name.
export async function loadArt() {
  const loader = new THREE.TextureLoader();
  const texture = (url, { color = true, flipY = true, repeat = false } = {}) => new Promise((resolve, reject) => {
    loader.load(url, t => {
      t.encoding = color ? THREE.sRGBEncoding : THREE.LinearEncoding;
      t.flipY = flipY;
      t.anisotropy = 4;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
      resolve(t);
    }, undefined, () => reject(new Error(`could not load ${url}`)));
  });
  const sky = new Promise((resolve, reject) => {
    new THREE.CubeTextureLoader().setPath(SHARED).load(
      ['sky_px.jpg', 'sky_nx.jpg', 'sky_py.jpg', 'sky_ny.jpg', 'sky_pz.jpg', 'sky_nz.jpg'],
      t => { t.encoding = THREE.sRGBEncoding; resolve(t); }, undefined, () => reject(new Error('could not load the sky')));
  });
  const fetched = async (url, read) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not load ${url} (${response.status})`);
    return response[read]();
  };
  const [manifest, bytes] = await Promise.all([fetched(`${OWN}models/models.json`, 'json'), fetched(`${OWN}models/models.bin`, 'arrayBuffer')]);
  const model = name => {
    const entry = manifest.models[name];
    const geometry = new THREE.BufferGeometry();
    for (const [attr, info] of Object.entries(entry.attributes)) {
      const Type = info.type === 'Uint16Array' ? Uint16Array : Float32Array;
      const data = new Type(bytes, info.byteOffset, info.count * info.itemSize);
      if (attr === 'index') geometry.setIndex(new THREE.BufferAttribute(data, 1));
      else geometry.setAttribute(attr, new THREE.BufferAttribute(data, info.itemSize));
    }
    entry.groups.forEach((g, i) => geometry.addGroup(g.start, g.count, i));
    geometry.computeBoundingSphere();
    return geometry;
  };
  const ship = { flipY: false };
  const [skyTexture, shipMap, shipNormal, redMap, purpleMap, hunterNormal, rockMap, flame, glow, trail,
    planetA, planetANormal, planetB, planetBNormal, nebula] = await Promise.all([
    sky,
    texture(`${OWN}textures/playerShip_dff.jpg`, ship), texture(`${OWN}textures/playerShip_nrm.jpg`, { ...ship, color: false }),
    texture(`${OWN}textures/enemyShip_red_dff.jpg`, ship), texture(`${OWN}textures/enemyShip_purple_dff.jpg`, ship),
    texture(`${OWN}textures/enemyShip_nrm.jpg`, { ...ship, color: false }),
    texture(`${SHARED}gen_asteroid.jpg`, { repeat: true }),
    texture(`${OWN}textures/flame1.png`), texture(`${OWN}textures/fx_engine.png`), texture(`${OWN}textures/trail.png`),
    texture(`${SHARED}planet_derelict.jpg`), texture(`${SHARED}planet_derelict_n.jpg`, { color: false }),
    texture(`${SHARED}planet_glacier.jpg`), texture(`${SHARED}planet_glacier_n.jpg`, { color: false }),
    texture(`${SHARED}gen_nebula.jpg`),
  ]);
  return {
    sky: skyTexture, flame, glow, trail, nebula,
    ship: { geometry: model('ship'), map: shipMap, normal: shipNormal },
    hunter: { geometry: model('hunter'), maps: { Big: redMap, Small: purpleMap }, normal: hunterNormal },
    rocks: { geometries: [model('rock1'), model('rock2'), model('rock3')], map: rockMap },
    planets: [{ map: planetA, normal: planetANormal }, { map: planetB, normal: planetBNormal }],
  };
}

// ---- how big things are drawn, in field units ----------------------------------------------------

const LOOK = {
  shipLength: 50,
  hunterLength: { Big: 62, Small: 38 },
  rockScale: 2.25,            // a rock model's longest side, per unit of rock radius
  rockTint: { Large: 0xb3a596, Medium: 0xc8b8a6, Small: 0xdccbb8 },
  shotLength: 30, shotWidth: 9,
  tilt: 0.36,                 // radians the camera leans back from straight down
  fov: 34,
  skyTurn: [0, 0, Math.PI / 2], // turns the sky so the camera, looking down, sees its best face
  skyBrightness: 0.62,
};

// The angle to draw at, a share alpha (0 to 1) of the way from one step's angle to the next, turning the short
// way. The rules wrap an angle to within half a turn of 0, so a rock spinning past a half turn goes from just
// under pi to just over -pi in one step: drawn straight between the two it would spin back a whole turn.
export function turnBetween(from, to, alpha) {
  let turn = to - from;
  if (turn > Math.PI) turn -= 2 * Math.PI; else if (turn < -Math.PI) turn += 2 * Math.PI;
  return from + turn * alpha;
}

// ---- particles -----------------------------------------------------------------------------------

// Glowing points that fly, slow down, grow and fade: sparks, fire and smoke. One draw call per kind.
class Particles {
  constructor(texture, capacity, planes) {
    this.capacity = capacity;
    this.next = 0;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);      // seconds left; 0 = unused
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.base = new Float32Array(capacity * 3);  // colour at birth
    const geometry = new THREE.BufferGeometry();
    this.colour = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.alpha = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.drawSize = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.position = new THREE.BufferAttribute(this.pos, 3);
    for (const a of [this.colour, this.alpha, this.drawSize, this.position]) a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('aColor', this.colour);
    geometry.setAttribute('aAlpha', this.alpha);
    geometry.setAttribute('aSize', this.drawSize);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uScale: { value: 400 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        #include <clipping_planes_pars_vertex>
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha > 0.0 ? aSize * uScale / -mvPosition.z : 0.0;
          gl_Position = projectionMatrix * mvPosition;
          #include <clipping_planes_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec3 vColor; varying float vAlpha;
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.rgb * vAlpha, 1.0);
        }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, clipping: true,
    });
    this.material.clippingPlanes = planes;
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, drag, r, g, b) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity; // the oldest spark gives way when it is full
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.base.set([r, g, b], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.drag[i] = drag;
  }

  update(dt) {
    const colour = this.colour.array, alpha = this.alpha.array, size = this.drawSize.array;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) { alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const keep = Math.max(0, 1 - this.drag[i] * dt);
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k] *= keep;
        this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      }
      const t = Math.max(this.life[i], 0) / this.maxLife[i]; // 1 at birth, 0 at death
      this.size[i] += this.grow[i] * dt;
      size[i] = this.size[i];
      alpha[i] = t * t;
      const hot = t * t * t;                                 // starts white-hot, cools to its own colour
      for (let k = 0; k < 3; k++) colour[i * 3 + k] = this.base[i * 3 + k] * (1 - hot) + hot;
    }
    for (const a of [this.colour, this.alpha, this.drawSize, this.position]) a.needsUpdate = true;
  }
}

// ---- the renderer ----------------------------------------------------------------------------------

export class Renderer {
  constructor(canvas, art, labels) {
    this.art = art;
    this.labels = labels;      // a DOM layer over the canvas for score pop-ups
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.outputEncoding = THREE.sRGBEncoding;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.15;
    this.gl.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(LOOK.fov, 1, 10, 12000);
    this.planes = [0, 1, 2, 3].map(() => new THREE.Plane());  // the field's four edges
    this.shake = 0;
    this.calm = false;   // true when the player's system asks to reduce motion: no screen shake, a softer flash
    this.time = 0;
    this.width = 1000;
    this.height = 625;
    this.view = { width: 1, height: 1 };
    this.insets = { top: 0, bottom: 0 };   // screen pixels kept clear of the field (the touch buttons)
    this.buildLights();
    this.buildSky();
    this.buildBackdrop();
    this.buildBorder();
    this.buildShips();
    this.buildRocks();
    this.buildShots();
    this.sparks = new Particles(art.glow, 1400, this.planes);
    this.fire = new Particles(art.flame, 420, this.planes);
    this.scene.add(this.sparks.points, this.fire.points);
    this.buildRings();
    this.popups = [];
  }

  // ---- building the scene ------------------------------------------------------------------------

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x2a1830, 0.55));
    const key = new THREE.DirectionalLight(0xfff1dd, 2.3);
    key.position.set(-0.55, 1, -0.45);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 1.1);
    rim.position.set(0.7, 0.35, 0.9);
    this.flash = new THREE.PointLight(0xffb070, 0, 520, 1.6); // lights the field around each big explosion
    this.scene.add(key, rim, this.flash);
  }

  // The sky box, drawn behind everything and turned (three.js r128 cannot turn a scene background).
  buildSky() {
    const turn = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...LOOK.skyTurn)));
    const material = new THREE.ShaderMaterial({
      uniforms: { uSky: { value: this.art.sky }, uTurn: { value: turn }, uBright: { value: LOOK.skyBrightness } },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // always on the far plane
        }`,
      fragmentShader: `
        uniform samplerCube uSky; uniform mat3 uTurn; uniform float uBright; varying vec3 vDirection;
        void main() {
          vec3 d = uTurn * normalize(vDirection);
          gl_FragColor = vec4(textureCube(uSky, vec3(-d.x, d.yz)).rgb * uBright, 1.0);
        }`,
      side: THREE.BackSide, depthTest: false, depthWrite: false,
    });
    this.sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  // Two planets and a nebula far below the field: lit, slowly turning, never in play.
  buildBackdrop() {
    this.backdrop = new THREE.Group();
    const sphere = new THREE.SphereGeometry(1, 96, 48);
    const [a, b] = this.art.planets;
    this.planetA = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({
      map: a.map, normalMap: a.normal, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.92, metalness: 0.05 }));
    this.planetB = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({
      map: b.map, normalMap: b.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.75, metalness: 0.05 }));
    // the camera looks down, so each planet is tipped over to show its equator, not a pinched pole
    this.planetA.rotation.set(1.2, 0, 0.3);
    this.planetB.rotation.set(1.35, 0, -0.4);
    // the nebula fades out towards its edges, so it never shows a hard border
    const fade = document.createElement('canvas');
    fade.width = fade.height = 256;
    const g = fade.getContext('2d');
    const gradient = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(1, '#000');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 256, 256);
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.art.nebula, alphaMap: new THREE.CanvasTexture(fade), transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    haze.rotation.x = -Math.PI / 2;
    this.haze = haze;
    // a smoked-glass floor under the field: the play area reads as a window onto the belt
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      color: 0x02050c, transparent: true, opacity: 0.5, depthWrite: false }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -8;
    this.backdrop.add(haze, this.planetA, this.planetB);
    this.scene.add(this.backdrop, this.floor);
  }

  buildBorder() {
    const material = new THREE.LineBasicMaterial({ color: 0x7fb2e5, transparent: true, opacity: 0.35 });
    this.border = new THREE.LineLoop(new THREE.BufferGeometry(), material);
    this.scene.add(this.border);
  }

  // The ship and each hunter are drawn up to four times: once, plus copies across the edges it is near.
  buildShips() {
    const { ship, hunter, glow, flame } = this.art;
    const clip = this.planes;
    const metal = new THREE.MeshStandardMaterial({ map: ship.map, normalMap: ship.normal, metalness: 0.55, roughness: 0.42, clippingPlanes: clip });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, emissive: 0x2a9cff, emissiveIntensity: 0.9, metalness: 0.9, roughness: 0.15, clippingPlanes: clip });
    const engineGlow = new THREE.SpriteMaterial({ map: glow, color: 0x7fc8ff, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: clip });
    const engineFire = new THREE.SpriteMaterial({ map: flame, color: 0xff8a3c, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: clip });
    const shield = new THREE.SpriteMaterial({ map: glow, color: 0x47d1a0, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6, clippingPlanes: clip });
    this.shipCopies = [0, 1, 2, 3].map(() => {
      const group = new THREE.Group();
      group.rotation.order = 'YXZ';
      const body = new THREE.Mesh(ship.geometry, [metal, glass]);
      body.scale.setScalar(LOOK.shipLength);
      const core = new THREE.Sprite(engineGlow);
      const fire = new THREE.Sprite(engineFire);
      const bubble = new THREE.Sprite(shield);
      core.position.x = fire.position.x = -LOOK.shipLength * 0.52;
      bubble.scale.setScalar(LOOK.shipLength * 2.2);
      group.add(body, core, fire, bubble);
      group.userData = { core, fire, bubble };
      this.scene.add(group);
      return group;
    });
    const hunterMaterials = kind => [
      new THREE.MeshStandardMaterial({ map: hunter.maps[kind], normalMap: hunter.normal, metalness: 0.5, roughness: 0.4, clippingPlanes: clip }),
      new THREE.MeshStandardMaterial({ color: 0x220000, emissive: kind === 'Big' ? 0xff4a2a : 0xc56bff, emissiveIntensity: 1.6, clippingPlanes: clip }),
    ];
    this.hunterLooks = { Big: hunterMaterials('Big'), Small: hunterMaterials('Small') };
    const hunterGlow = new THREE.SpriteMaterial({ map: glow, color: 0xff5a3c, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: clip });
    // a group of four copies for each hunter slot
    this.hunterCopies = Array.from({ length: PoolSize.hunters }, () => [0, 1, 2, 3].map(() => {
      const group = new THREE.Group();
      group.rotation.order = 'YXZ';
      const body = new THREE.Mesh(hunter.geometry, this.hunterLooks.Big);
      const glowSprite = new THREE.Sprite(hunterGlow.clone());
      group.add(body, glowSprite);
      group.userData = { body, glowSprite };
      this.scene.add(group);
      return group;
    }));
  }

  buildRocks() {
    const { rocks } = this.art;
    this.rockMaterial = new THREE.MeshStandardMaterial({
      map: rocks.map, bumpMap: rocks.map, bumpScale: 2.2, roughness: 0.96, metalness: 0.02, clippingPlanes: this.planes });
    // one instanced mesh per rock model; every rock and every copy of a rock is one instance
    this.rockMeshes = rocks.geometries.map(geometry => {
      const mesh = new THREE.InstancedMesh(geometry, this.rockMaterial, PoolSize.rocks * 4);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.setColorAt(0, new THREE.Color());
      this.scene.add(mesh);
      return mesh;
    });
    // each slot tumbles about its own axis, picked once
    this.rockAxes = Array.from({ length: PoolSize.rocks }, (_, i) => new THREE.Vector3(Math.sin(i * 12.9898) * 0.6, 1, Math.cos(i * 78.233) * 0.6).normalize());
    // broken pieces: small tumbling rocks thrown out of each break
    this.debris = { mesh: new THREE.InstancedMesh(rocks.geometries[1], this.rockMaterial, 160), items: [] };
    this.debris.mesh.frustumCulled = false;
    this.debris.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // it shares the rocks' material, so it needs instance colours too: three.js r128 keeps one shader per material
    for (let i = 0; i < 160; i++) this.debris.mesh.setColorAt(i, new THREE.Color(LOOK.rockTint.Medium));
    this.scene.add(this.debris.mesh);
  }

  buildShots() {
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2); // lying flat on the field, facing up at the camera
    const shot = color => {
      const mesh = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({
        map: this.art.trail, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, clippingPlanes: this.planes }), PoolSize.bullets * 4);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
      return mesh;
    };
    this.shipShots = shot(0x9fe8ff);
    this.hunterShots = shot(0xff6a4a);
  }

  buildRings() {
    this.rings = Array.from({ length: 10 }, () => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 64), new THREE.MeshBasicMaterial({
        color: 0xffc880, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: this.planes }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.userData = { life: 0, maxLife: 1, from: 1, to: 1 };
      this.scene.add(ring);
      return ring;
    });
    this.nextRing = 0;
  }

  // Every effect still on screen goes, at once: a new game starts on a clean field, with nothing of the title's demo in it.
  clearEffects() {
    for (const p of [this.sparks, this.fire]) { p.life.fill(0); p.alpha.array.fill(0); p.alpha.needsUpdate = true; }
    this.debris.items.length = 0;
    this.debris.mesh.count = 0;
    for (const p of this.popups) p.el.remove();
    this.popups.length = 0;
    for (const ring of this.rings) { ring.visible = false; ring.userData.life = 0; }
    this.flash.intensity = 0;
    this.shake = 0;
  }

  // ---- field and camera --------------------------------------------------------------------------

  // A game's field can differ from the last one (a phone held upright gets a taller field).
  setField(width, height) {
    this.width = width;
    this.height = height;
    const [left, right, top, bottom] = this.planes;
    left.set(new THREE.Vector3(1, 0, 0), width / 2);
    right.set(new THREE.Vector3(-1, 0, 0), width / 2);
    top.set(new THREE.Vector3(0, 0, 1), height / 2);
    bottom.set(new THREE.Vector3(0, 0, -1), height / 2);
    const w = width / 2, h = height / 2;
    this.border.geometry.setFromPoints([new THREE.Vector3(-w, 0, -h), new THREE.Vector3(w, 0, -h), new THREE.Vector3(w, 0, h), new THREE.Vector3(-w, 0, h)]);
    const size = Math.max(width, height);
    this.haze.scale.set(size * 6, size * 6, 1); // the plane is upright in its own space, then laid flat
    this.haze.position.set(width * 0.4, -size * 3, -height * 0.3);
    this.floor.scale.set(width, height, 1);
    this.fitCamera();
  }

  // Keeps a band at the top and bottom of the view clear of the field, in CSS pixels.
  setInsets(top, bottom) {
    this.insets = { top, bottom };
    this.fitCamera();
  }

  resize(cssWidth, cssHeight) {
    this.view = { width: cssWidth, height: cssHeight };
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.setSize(cssWidth, cssHeight, false);
    this.camera.aspect = cssWidth / cssHeight;
    this.fitCamera();
  }

  // Moves the camera back until the whole field fits on screen, centred, with a small margin.
  fitCamera() {
    const camera = this.camera;
    camera.updateProjectionMatrix();
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(sx * this.width / 2, 0, sz * this.height / 2));
    const aim = new THREE.Vector3();
    const place = distance => {
      camera.position.set(aim.x, Math.cos(LOOK.tilt) * distance, aim.z + Math.sin(LOOK.tilt) * distance);
      camera.lookAt(aim);
      camera.updateMatrixWorld(true);
      return corners.map(c => c.clone().project(camera));
    };
    const high = 0.95 - 2 * this.insets.top / this.view.height;      // the band the field must fit in, in
    const low = -0.95 + 2 * this.insets.bottom / this.view.height;   // screen units from -1 to 1
    let distance = 1000;
    for (let pass = 0; pass < 6; pass++) {
      let near = 100, far = 20000;
      for (let i = 0; i < 40; i++) {
        distance = (near + far) / 2;
        const fits = place(distance).every(p => Math.abs(p.x) <= 0.97 && p.y <= high && p.y >= low);
        if (fits) far = distance; else near = distance;
      }
      distance = far;
      const projected = place(distance);
      const top = Math.max(...projected.map(p => p.y)), bottom = Math.min(...projected.map(p => p.y));
      aim.z -= ((top + bottom) - (high + low)) / 2 * this.height * 0.5; // nudge until the field sits in the middle of the band
    }
    this.cameraHome = camera.position.clone();
    this.cameraAim = aim.clone();
    // the planets are placed by where they should appear on screen: one rising from the near corner,
    // a small one beyond the far corner, both far below the field and out of play
    this.placeOnScreen(this.planetA, -0.9, -0.95, distance * 2.6, 0.2);
    this.placeOnScreen(this.planetB, 0.9, 0.5, distance * 3.4, 0.035);
    this.sparks.material.uniforms.uScale.value = this.fire.material.uniforms.uScale.value =
      this.gl.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(LOOK.fov) / 2));
  }

  placeOnScreen(object, ndcX, ndcY, distance, radiusShare) {
    const ray = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    object.position.copy(this.camera.position).addScaledVector(ray, distance);
    object.scale.setScalar(distance * radiusShare);
  }

  // field (x, y) to scene (x, 0, z): the field's centre is the scene's origin, +y down the screen is +z
  sceneX(x) { return x - this.width / 2; }
  sceneZ(y) { return y - this.height / 2; }

  // ---- events: what just happened ----------------------------------------------------------------

  onEvents(events) {
    for (const e of events) {
      const x = this.sceneX(e.x), z = this.sceneZ(e.y);
      switch (e.type) {
        case 'rockBroken': this.rockBurst(x, z, e); break;
        case 'hunterDestroyed': this.explode(x, z, 46, [1, 0.35, 0.2], 9, 1.1); this.popup(x, z, e.points); break;
        case 'shipDestroyed': this.explode(x, z, 70, [0.45, 0.75, 1], 16, 1.5); break;
        case 'shot': this.muzzle(x, z, e); break;
        case 'hyperspaceOut': this.warp(x, z, 1); break;
        case 'hyperspaceIn': this.warp(x, z, -1); break;
        case 'hyperspaceFailed': this.warp(x, z, -1); break;
        case 'respawn': this.ring(x, z, 70, 18, 0.6, 0x47d1a0); break;
        case 'hunterArrived': case 'hunterLeft': this.warp(x, z, e.type === 'hunterArrived' ? -1 : 1, 0xff6a4a); break;
        case 'extraShip': this.popup(this.sceneX(this.width / 2), this.sceneZ(this.height / 2) - 40, 0, 'Extra ship'); break;
        default: break;
      }
    }
  }

  rockBurst(x, z, e) {
    const big = { Large: 1, Medium: 0.62, Small: 0.36 }[e.size];
    this.explode(x, z, 40 * big, [1, 0.62, 0.3], 7 * big, 0.9 * big + 0.3, e.vx, e.vy);
    for (let i = 0; i < Math.round(9 * big); i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 150;
      this.debris.items.push({ x, y: 0, z, vx: Math.cos(a) * s + e.vx * 0.5, vy: (Math.random() - 0.3) * 60, vz: Math.sin(a) * s + e.vy * 0.5,
        life: 0.9 + Math.random() * 0.8, maxLife: 1.7, size: (4 + Math.random() * 7) * big + 2,
        axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), spin: 2 + Math.random() * 6 });
    }
    if (this.debris.items.length > 160) this.debris.items.splice(0, this.debris.items.length - 160);
    this.popup(x, z, e.points);
  }

  // sparks, fire, a ring, a flash of light and a shake, all scaled by `size`
  explode(x, z, size, colour, shake, ringSeconds, vx = 0, vz = 0) {
    const [r, g, b] = colour;
    for (let i = 0; i < size * 1.3; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random()) * size * 6;
      this.sparks.emit(x, 4, z, Math.cos(a) * s + vx * 0.4, Math.random() * 90, Math.sin(a) * s + vz * 0.4,
        0.35 + Math.random() * 0.6, 7 + Math.random() * 9, -4, 2.2, r, g, b);
    }
    for (let i = 0; i < size * 0.7; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * size * 2.4;
      this.fire.emit(x, 2, z, Math.cos(a) * s + vx * 0.3, 10, Math.sin(a) * s + vz * 0.3,
        0.5 + Math.random() * 0.8, size * (1 + Math.random()), size * 1.6, 1.3, r, g * 0.8, b * 0.6);
    }
    for (let i = 0; i < size * 0.25; i++) {   // dark smoke that lingers after the fire
      const a = Math.random() * Math.PI * 2, s = Math.random() * size * 1.2;
      this.fire.emit(x, 1, z, Math.cos(a) * s + vx * 0.2, 4, Math.sin(a) * s + vz * 0.2,
        1.1 + Math.random() * 0.7, size * 1.3, size * 1.1, 0.9, r * 0.25, g * 0.2, b * 0.2);
    }
    this.ring(x, z, size * 0.4, size * 3.4, ringSeconds * 0.55, new THREE.Color(r, g, b).getHex());
    this.flash.position.set(x, 60, z);
    this.flash.intensity = Math.max(this.flash.intensity, size / (this.calm ? 40 : 14));
    if (!this.calm) this.shake = Math.max(this.shake, shake);
  }

  muzzle(x, z, e) {
    const [r, g, b] = e.fromShip ? [0.6, 0.9, 1] : [1, 0.4, 0.3];
    for (let i = 0; i < 4; i++) {
      this.sparks.emit(x, 3, z, e.vx * 0.15 + (Math.random() - 0.5) * 60, 0, e.vy * 0.15 + (Math.random() - 0.5) * 60,
        0.12 + Math.random() * 0.1, 10, 0, 6, r, g, b);
    }
  }

  // a hyperspace jump or a hunter's arrival: a ring that closes in (direction 1) or opens out (-1)
  warp(x, z, direction, colour = 0x7fe0ff) {
    const [from, to] = direction > 0 ? [80, 4] : [4, 90];
    this.ring(x, z, from, to, 0.45, colour);
    const c = new THREE.Color(colour);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 160;
      const out = direction < 0 ? 1 : -1;
      const start = direction < 0 ? 0 : 70;
      this.sparks.emit(x + Math.cos(a) * start, 4, z + Math.sin(a) * start, Math.cos(a) * s * out, 0, Math.sin(a) * s * out,
        0.3 + Math.random() * 0.25, 9, 0, 1, c.r, c.g, c.b);
    }
  }

  ring(x, z, from, to, seconds, colour) {
    const ring = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    ring.visible = true;
    ring.position.set(x, 1, z);
    ring.material.color.set(colour);
    Object.assign(ring.userData, { life: seconds, maxLife: seconds, from, to });
  }

  popup(x, z, points, text = null) {
    if (!this.labels || (!points && !text)) return;
    const el = document.createElement('span');
    el.className = text ? 'pop big' : 'pop';
    el.textContent = text || `+${points}`;
    this.labels.appendChild(el);
    this.popups.push({ el, x, z, life: 0.9 });
  }

  // ---- drawing -----------------------------------------------------------------------------------

  // alpha: how far the clock is between the last step and the next one, for smooth motion
  draw(game, alpha, dt) {
    this.time += dt;
    this.drawShip(game, alpha);
    this.drawHunters(game, alpha);
    this.drawRocks(game, alpha);
    this.drawShots(game, alpha);
    this.animate(dt);
    this.gl.render(this.scene, this.camera);
  }

  // the place to draw an entity this frame, between its last two steps unless it just wrapped
  pose(e, alpha) {
    let x = e.pos.x, y = e.pos.y;
    const dx = e.pos.x - e.prev.x, dy = e.pos.y - e.prev.y;
    if (Math.abs(dx) < this.width / 2 && Math.abs(dy) < this.height / 2) {
      x = e.prev.x + dx * alpha;
      y = e.prev.y + dy * alpha;
    }
    return { x, y, angle: turnBetween(e.prev.angle, e.angle, alpha) };
  }

  // the offsets at which to draw something at (x, y) with this reach: itself, plus a copy across each edge it is near
  copies(x, y, reach) {
    const xs = [0], ys = [0];
    if (x < reach) xs.push(this.width); else if (x > this.width - reach) xs.push(-this.width);
    if (y < reach) ys.push(this.height); else if (y > this.height - reach) ys.push(-this.height);
    const out = [];
    for (const ox of xs) for (const oy of ys) out.push([ox, oy]);
    return out;
  }

  drawShip(game, alpha) {
    const ship = game.ship;
    const shown = ship.alive && ship.jumping <= 0 && !(ship.invulnerable > 0 && Math.floor(this.time * 12) % 3 === 0);
    const { x, y, angle } = this.pose(ship, alpha);
    const offsets = shown ? this.copies(x, y, LOOK.shipLength * 0.7) : [];
    const roll = -ship.angularVel * 0.09;
    const flicker = 0.85 + Math.sin(this.time * 60) * 0.1 + Math.random() * 0.1;
    this.shipCopies.forEach((group, i) => {
      group.visible = i < offsets.length;
      if (!group.visible) return;
      group.position.set(this.sceneX(x + offsets[i][0]), 0, this.sceneZ(y + offsets[i][1]));
      group.rotation.set(group.rotation.x + (roll - group.rotation.x) * 0.2, -angle, 0);
      const { core, fire, bubble } = group.userData;
      const thrust = ship.thrusting ? 1 : 0.25;
      core.scale.setScalar(LOOK.shipLength * (0.45 + 0.35 * thrust) * flicker);
      fire.scale.set(LOOK.shipLength * 0.9 * thrust * flicker, LOOK.shipLength * 0.5 * thrust * flicker, 1);
      fire.position.x = -LOOK.shipLength * (0.55 + 0.25 * thrust);
      fire.visible = ship.thrusting;
      bubble.visible = ship.invulnerable > 0;
      bubble.material.opacity = 0.25 + 0.2 * Math.sin(this.time * 10);
    });
  }

  drawHunters(game, alpha) {
    const live = game.hunters.slots;
    live.forEach((hunter, slot) => {
      const copies = this.hunterCopies[slot];
      if (!hunter.alive) { copies.forEach(g => { g.visible = false; }); return; }
      const { x, y } = this.pose(hunter, alpha);
      const length = LOOK.hunterLength[hunter.kind];
      const appear = Math.min(1, hunter.age / 0.35, Math.max(0, hunter.travelLeft) / (Math.abs(hunter.vel.x) * 0.35 + 1e-6));
      const heading = Math.atan2(hunter.vel.y * 0.6, hunter.vel.x);
      const offsets = this.copies(x, y, length * 0.7);
      copies.forEach((group, i) => {
        group.visible = i < offsets.length;
        if (!group.visible) return;
        const { body, glowSprite } = group.userData;
        body.material = this.hunterLooks[hunter.kind];
        body.scale.setScalar(length * appear);
        glowSprite.scale.setScalar(length * 1.1 * appear);
        glowSprite.material.color.set(hunter.kind === 'Big' ? 0xff5a3c : 0xb070ff);
        glowSprite.material.opacity = 0.35 + 0.15 * Math.sin(this.time * 8);
        group.position.set(this.sceneX(x + offsets[i][0]), 6, this.sceneZ(y + offsets[i][1]));
        group.rotation.set(Math.sin(this.time * 2 + slot) * 0.15 - hunter.vel.y * 0.004 * Math.sign(hunter.vel.x), -heading, 0);
      });
    });
  }

  drawRocks(game, alpha) {
    const matrix = new THREE.Matrix4(), turn = new THREE.Quaternion(), scale = new THREE.Vector3(), at = new THREE.Vector3();
    const colour = new THREE.Color();
    const counts = [0, 0, 0];
    for (const rock of game.rocks.live) {
      if (!rock.alive) continue;
      const { x, y, angle } = this.pose(rock, alpha);
      const mesh = this.rockMeshes[rock.look];
      turn.setFromAxisAngle(this.rockAxes[rock.slot], angle);
      scale.setScalar(rock.radius * LOOK.rockScale);
      colour.setHex(LOOK.rockTint[rock.size]);
      for (const [ox, oy] of this.copies(x, y, rock.radius * 1.2)) {
        at.set(this.sceneX(x + ox), 0, this.sceneZ(y + oy));
        matrix.compose(at, turn, scale);
        mesh.setMatrixAt(counts[rock.look], matrix);
        mesh.setColorAt(counts[rock.look], colour);
        counts[rock.look] += 1;
      }
    }
    this.rockMeshes.forEach((mesh, i) => {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    });
  }

  drawShots(game, alpha) {
    const matrix = new THREE.Matrix4(), turn = new THREE.Quaternion(), scale = new THREE.Vector3(), at = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const counts = { ship: 0, hunter: 0 };
    for (const shot of game.bullets.live) {
      if (!shot.alive) continue;
      const { x, y } = this.pose(shot, alpha);
      const mesh = shot.fromShip ? this.shipShots : this.hunterShots;
      const key = shot.fromShip ? 'ship' : 'hunter';
      // the trail texture's bright head is on its left (u = 0), so the quad faces backwards along its flight
      turn.setFromAxisAngle(up, Math.PI - Math.atan2(shot.vel.y, shot.vel.x));
      const fade = Math.min(1, shot.lifetime / 0.15);
      scale.set(LOOK.shotLength * fade, 1, LOOK.shotWidth);
      for (const [ox, oy] of this.copies(x, y, LOOK.shotLength)) {
        at.set(this.sceneX(x + ox), 3, this.sceneZ(y + oy));
        matrix.compose(at, turn, scale);
        mesh.setMatrixAt(counts[key]++, matrix);
      }
    }
    this.shipShots.count = counts.ship;
    this.hunterShots.count = counts.hunter;
    this.shipShots.instanceMatrix.needsUpdate = this.hunterShots.instanceMatrix.needsUpdate = true;
  }

  // everything that moves on its own clock: particles, rings, debris, pop-ups, the backdrop, the shake
  animate(dt) {
    this.sparks.update(dt);
    this.fire.update(dt);
    for (const ring of this.rings) {
      const u = ring.userData;
      if (!ring.visible) continue;
      u.life -= dt;
      if (u.life <= 0) { ring.visible = false; continue; }
      const t = 1 - u.life / u.maxLife;
      ring.scale.setScalar(u.from + (u.to - u.from) * (1 - (1 - t) * (1 - t)));
      ring.material.opacity = (1 - t) * 0.55;
    }
    const matrix = new THREE.Matrix4(), turn = new THREE.Quaternion(), scale = new THREE.Vector3(), at = new THREE.Vector3();
    const items = this.debris.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const d = items[i];
      d.life -= dt;
      if (d.life <= 0) { items.splice(i, 1); continue; }
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.vx *= 1 - dt * 0.8; d.vz *= 1 - dt * 0.8;
    }
    items.forEach((d, i) => {
      turn.setFromAxisAngle(d.axis, d.spin * this.time);
      scale.setScalar(d.size * Math.min(1, d.life / 0.4));
      matrix.compose(at.set(d.x, d.y, d.z), turn, scale);
      this.debris.mesh.setMatrixAt(i, matrix);
    });
    this.debris.mesh.count = items.length;
    this.debris.mesh.instanceMatrix.needsUpdate = true;

    this.flash.intensity *= Math.max(0, 1 - dt * 7);
    this.planetA.rotation.y += dt * 0.015;
    this.planetB.rotation.y -= dt * 0.03;
    this.haze.rotation.z += dt * 0.004;

    this.shake *= Math.max(0, 1 - dt * 6);
    const s = this.shake;
    this.camera.position.set(this.cameraHome.x + (Math.random() - 0.5) * s, this.cameraHome.y + (Math.random() - 0.5) * s * 0.5, this.cameraHome.z + (Math.random() - 0.5) * s);
    this.camera.lookAt(this.cameraAim.x + (Math.random() - 0.5) * s * 0.3, 0, this.cameraAim.z);
    this.sky.position.copy(this.camera.position);

    this.drawPopups(dt);
  }

  drawPopups(dt) {
    if (!this.popups.length) return;
    const point = new THREE.Vector3();
    const box = this.labels.getBoundingClientRect();
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      if (p.life <= 0) { p.el.remove(); this.popups.splice(i, 1); continue; }
      point.set(p.x, 20 + (0.9 - p.life) * 40, p.z).project(this.camera);
      p.el.style.transform = `translate(${((point.x + 1) / 2 * box.width).toFixed(1)}px, ${((1 - point.y) / 2 * box.height).toFixed(1)}px) translate(-50%, -50%)`;
      p.el.style.opacity = Math.min(1, p.life / 0.3).toFixed(2);
    }
  }
}
