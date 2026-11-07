// fight/fight.js - "Fight the manager for a deal" (UC-29), the page: the three Meshy fighters (cast.json, data/meshes/fight/) on a
// side-on stage, played by fight/rules.js (the rules, node-tested), with the price of a real car on the lot falling as the fees come
// off, and the shared 'fight' board (scores.js) at the end. A JOKE: Doc Fee is made up. The stage's look (the floor, the office
// wall, the lights, the camera's framing) and the house score are AUTHORED.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as R from './rules.js';
import { ScoreBoard, HOUSE_NAME, checkName, ranked, qualifies, boardHTML, lastName, keepName } from '../scores.js';

const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Math.round(n).toLocaleString('en-CA');
const V = (f) => (f && f.kind !== 'ABSENT' ? f.value : null);
const FIGHT_HOUSE = { name: HOUSE_NAME, score: 20000, at: '' };   // AUTHORED: about a clean win with half the fees off
const fetchJson = (f) => fetch(f).then((r) => { if (!r.ok) throw new Error(f + ': HTTP ' + r.status); return r.json(); });

// ---- the car whose price comes down: the one the link names (?car= or #car=), else one of the lot's cars for sale
const [CAST, LISTINGS, SCORES_CFG] = await Promise.all([fetchJson('cast.json'), fetchJson('../data/listings.json'), fetchJson('../data/scores.json')]);
const SCORES = new ScoreBoard(SCORES_CFG);
const want = (location.search + location.hash).match(/car=([a-z0-9_]+)/);
const cars = LISTINGS.cars.filter((c) => V(c.price) !== null);
const car = (want && cars.find((c) => c.key === want[1])) || cars[Math.floor(Math.random() * cars.length)];
const carName = V(car.display) || [V(car.year), V(car.make), V(car.model)].filter(Boolean).join(' ');
const price = V(car.price);
$('startcar').innerHTML = 'Doc Fee won&rsquo;t move on the <b>' + carName + '</b> (' + money(price) + ' as listed). Make him.';
$('dealcar').textContent = carName; $('seecar').href = '../details.html#car=' + car.key;

// ---- the stage
const canvas = $('view');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
await renderer.init();
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d0f12);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2018, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(4, 9, 7); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -14, right: 14, top: 8, bottom: -2, far: 40 }); scene.add(key);
const rim = new THREE.DirectionalLight(0xff9b74, 1.2); rim.position.set(-6, 4, -6); scene.add(rim);
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const floorTex = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#1b1d21'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a2d33'; g.lineWidth = 6; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); } });
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(12, 3);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 12), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.1 }));
floor.rotation.x = -Math.PI / 2; floor.position.z = -1; floor.receiveShadow = true; scene.add(floor);
const wallTex = canvasTex(2048, 512, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#20252c'); grd.addColorStop(1, '#14171b'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f25827'; g.fillRect(0, h - 40, w, 10);
  g.font = '800 58px "Open Sans", sans-serif'; g.fillStyle = '#fefefe'; g.textAlign = 'center';
  g.fillText('DOC FEE’S BACK OFFICE', w * 0.25, 120); g.fillText('ALL FEES FINAL', w * 0.75, 120);
  g.font = '700 30px "Open Sans", sans-serif'; g.fillStyle = '#a3abb0';
  g.fillText('MONTHLY QUOTA: YOUR WALLET', w * 0.25, 175); g.fillText('ASK ABOUT OUR EXTENDED WARRANTY', w * 0.75, 175);
  g.fillStyle = '#e9ecef'; g.fillRect(w * 0.43, 220, w * 0.14, 190); g.fillStyle = '#c62828'; g.font = '800 26px "Open Sans", sans-serif'; g.fillText('FEES', w * 0.5, 255);
  g.strokeStyle = '#c62828'; g.lineWidth = 8; g.beginPath(); g.moveTo(w * 0.445, 390); g.lineTo(w * 0.48, 340); g.lineTo(w * 0.51, 360); g.lineTo(w * 0.555, 270); g.stroke();
});
const wall = new THREE.Mesh(new THREE.PlaneGeometry(48, 12), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }));
wall.position.set(0, 3, -6); scene.add(wall);
const desk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.2), new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 }));
desk.position.set(R.ARENA.right + 3.5, 0.45, -3); desk.castShadow = true; scene.add(desk);

// ---- the fighters: each a Meshy GLB with its own motions, played as the rules' state says
const loader = new GLTFLoader();
const prog = {};
function showLoad() { let l = 0, t = 0; for (const v of Object.values(prog)) { l += v.l; t += v.t; } if (t) { $('loadbar').firstElementChild.style.width = (100 * l / t).toFixed(0) + '%'; $('loadtxt').textContent = (l / 1e6).toFixed(1) + ' / ' + (t / 1e6).toFixed(1) + ' MB'; } }
async function fighter(k) {
  const c = CAST.fighters[k];
  const g = await loader.loadAsync('../data/meshes/fight/' + c.glb, (e) => { prog[k] = { l: e.loaded, t: e.total || e.loaded }; showLoad(); });
  const root = g.scene; root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const box = new THREE.Box3().setFromObject(root), h = box.max.y - box.min.y;
  if (!(h > 0.5 && h < 4)) throw new Error('fight: ' + c.glb + ' is ' + h.toFixed(2) + ' m tall, not a person');
  const wrap = new THREE.Group(); root.position.y = -box.min.y; wrap.add(root); scene.add(wrap);
  const mixer = new THREE.AnimationMixer(root), actions = {};
  for (const [state, clip] of Object.entries(c.clips)) {
    const a = g.animations.find((x) => x.name === clip);
    if (!a) throw new Error('fight: ' + c.glb + ' has no clip ' + clip + ' (cast.json ' + k + '.' + state + ')');
    actions[state] = mixer.clipAction(a);
  }
  return { k, wrap, mixer, actions, playing: null, height: h };
}
const [YOU, PAL, BOSS] = await Promise.all([fighter('buyer'), fighter('sidekick'), fighter('docfee')]);
const ONCE = new Set(['punch', 'kick', 'special', 'hit', 'swing', 'throw', 'spray', 'down', 'win', 'assist', 'taunt']);
const HOLD = new Set(['down', 'win', 'block']);
/** play a state's clip (cross-faded); a one-shot fitted to `dur` seconds when given */
function play(f, state, dur, dir = 1) {
  const a = f.actions[state] || f.actions.idle;
  if (f.playing === a && !ONCE.has(state)) { a.timeScale = dir; return; }
  const was = f.playing; f.playing = a;
  a.reset(); a.enabled = true;
  a.setLoop(ONCE.has(state) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = HOLD.has(state) || ONCE.has(state);
  a.timeScale = (dur ? a.getClip().duration / dur : 1) * dir;
  if (was && was !== a) a.crossFadeFrom(was, 0.12, false);
  a.play();
}

// ---- input: keys, touch buttons; the attacks are presses (edges), moving and blocking are held
const held = new Set(), pressed = new Set();
const KEYMAP = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyS: 'block', ArrowDown: 'block', KeyJ: 'punch', KeyZ: 'punch', KeyK: 'kick', KeyX: 'kick', KeyL: 'special', KeyC: 'special' };
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Enter') { if (!$('start').hidden && !$('go').disabled) begin(); else if (!$('end').hidden) begin(); return; }
  const k = KEYMAP[e.code]; if (!k) return; e.preventDefault();
  if (!e.repeat && ['punch', 'kick', 'special'].includes(k)) pressed.add(k); held.add(k);
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) held.delete(k); });
document.querySelectorAll('#touch button').forEach((b) => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); held.add(k); if (['punch', 'kick', 'special'].includes(k)) pressed.add(k); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => held.delete(k));
});

// ---- the HUD: health, the price coming down, the fees knocked off, who says what
let F = null, last = 0, acc = 0, said = { boss: null, pal: null };
const toScreen = (f, up) => { const p = new THREE.Vector3(f.wrap.position.x, up, 0).project(camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; };
function popAt(f, html, cls) { const [x, y] = toScreen(f, f.height + 0.3); const d = document.createElement('div'); d.className = cls; d.innerHTML = html; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); return d; }
function say(who, text) {
  const f = who === 'boss' ? BOSS : PAL;
  if (said[who]) said[who].el.remove();
  said[who] = { el: popAt(f, text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]), 'say' + (who === 'pal' ? ' pal' : '')), f, until: performance.now() + 2200 };
}
function hud() {
  $('youbar').firstElementChild.style.width = (100 * F.you.hp / F.you.max) + '%';
  $('bossbar').firstElementChild.style.width = (100 * F.boss.hp / F.boss.max) + '%';
  const off = R.discount(F);
  $('dealprice').textContent = money(Math.max(0, price - off));
  $('dealoff').textContent = off ? money(off) + ' in fees knocked off' : 'Every hit knocks a fee off';
  for (const w of ['boss', 'pal']) { const s = said[w]; if (!s) continue; if (performance.now() > s.until) { s.el.remove(); said[w] = null; continue; } const [x, y] = toScreen(s.f, s.f.height + 0.45); s.el.style.left = x + 'px'; s.el.style.top = y + 'px'; }
}

// paperwork and the undercoating cloud, drawn from the rules' own lists
const paperTex = canvasTex(256, 180, (g, w, h) => { g.fillStyle = '#fbfbf5'; g.fillRect(0, 0, w, h); g.fillStyle = '#c62828'; g.font = '800 26px "Open Sans", sans-serif'; g.textAlign = 'center'; g.fillText('EXTENDED', w / 2, 60); g.fillText('WARRANTY', w / 2, 92); g.fillStyle = '#888'; for (let i = 0; i < 4; i++) g.fillRect(30, 115 + i * 14, w - 60, 4); });
const paperMat = new THREE.MeshBasicMaterial({ map: paperTex, side: THREE.DoubleSide });
const papers = new Map();
// the undercoating: a few brown puffs with its name on them, as wide as the rules' reach (1.2 m either side)
const cloud = new THREE.Group(), puffMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, transparent: true, opacity: 0.6, roughness: 1 });
for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.22 + (i % 3) * 0.08, 16, 12), puffMat); m.position.set((i - 3) * 0.32, 0.2 * Math.sin(i * 1.7), 0.15 * Math.cos(i)); cloud.add(m); }
const coatLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(512, 96, (g, w, h) => { g.font = '800 54px "Open Sans", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffd27a'; g.strokeStyle = '#000'; g.lineWidth = 8; g.strokeText('UNDERCOATING', w / 2, 66); g.fillText('UNDERCOATING', w / 2, 66); }), transparent: true }));
coatLabel.scale.set(1.6, 0.3, 1); coatLabel.position.y = 0.75; cloud.add(coatLabel);
cloud.visible = false; scene.add(cloud);

// ---- a fight
function begin() {
  F = R.makeFight(); acc = 0; last = performance.now(); held.clear(); pressed.clear();
  for (const p of papers.values()) scene.remove(p); papers.clear();
  for (const w of ['boss', 'pal']) if (said[w]) { said[w].el.remove(); said[w] = null; }
  $('start').hidden = true; $('end').hidden = true; $('hud').hidden = false;
  for (const f of [YOU, PAL, BOSS]) { f.playing = null; play(f, 'idle'); }
  say('boss', 'This price is for today only.');
}
window.FIGHT = { get F() { return F; }, begin, tick: (dt) => frame(dt) };   // the page check steps the fight by its own clock

function frame(dt) {
  if (!F) return;
  const input = { left: held.has('left'), right: held.has('right'), block: held.has('block'), punch: pressed.has('punch'), kick: pressed.has('kick'), special: pressed.has('special') };
  pressed.clear();
  R.step(F, input, dt);
  for (const e of F.events) {
    if (e.kind === 'fee') { const d = popAt(BOSS, '−' + money(e.usd) + '<small>' + e.what + ' waived</small>', 'pop'); setTimeout(() => d.remove(), 1400); }
    else if (e.kind === 'say') { say(e.who, e.text); if (e.who === 'pal') play(PAL, 'assist', 0.8); }
    else if (e.kind === 'throw') play(BOSS, e.what === 'Undercoating' ? 'spray' : 'throw', 0.9);
  }
  // the fighters where the rules have them, each facing the way the rules say, playing its state
  const map = [[YOU, F.you], [PAL, F.pal], [BOSS, F.boss]];
  for (const [f, s] of map) {
    f.wrap.position.x = s.x;
    const face = F.boss_ai.away > 0 && f === BOSS ? 1 : s.facing;
    f.wrap.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  const anim = (f, s) => {
    if (s.state === 'down') return play(f, 'down');
    if (s.state === 'hit') return play(f, 'hit', R.HIT_STUN + 0.15);
    if (s.move) { if (f.playing !== f.actions[s.move.name]) play(f, s.move.name, s.move.startup + s.move.active + s.move.recover); return; }
    if (f.playing && ONCE.has(Object.keys(f.actions).find((k) => f.actions[k] === f.playing)) && f.playing.isRunning()) return;   // let a one-shot finish
    if (s.state === 'block') return play(f, 'block');
    if (s.state === 'walk') return play(f, f === BOSS && F.boss_ai.away > 0 ? 'away' : 'walk', 0, 1);
    play(f, 'idle');
  };
  anim(YOU, F.you); anim(BOSS, F.boss);
  if (!(PAL.playing && PAL.playing.isRunning() && PAL.playing === PAL.actions.assist)) play(PAL, Math.abs(F.pal.x - (F.you.x - 1.4 * F.you.facing)) > 0.3 ? 'walk' : 'idle');
  for (const p of F.papers) { if (!papers.has(p)) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.39), paperMat); scene.add(m); papers.set(p, m); } const m = papers.get(p); m.position.set(p.x, 1.3, 0.2); m.rotation.set(0.3, p.t * 9, p.t * 4); }
  for (const [p, m] of papers) if (!F.papers.includes(p)) { scene.remove(m); papers.delete(p); }
  cloud.visible = !!F.cloud; if (F.cloud) { const k = Math.min(1, F.cloud.t * 2); cloud.position.set(F.cloud.x, 0.9, 0.1); cloud.scale.setScalar(0.5 + 0.5 * k); puffMat.opacity = 0.6 * Math.min(1, (3 - F.cloud.t) * 2); cloud.rotation.z = Math.sin(F.cloud.t * 3) * 0.1; }
  if (F.over && !F.shown) { F.shown = true; end(); }
}
renderer.setAnimationLoop(() => {
  const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (F && !F.over) { acc += dt; while (acc >= 1 / 60) { frame(1 / 60); acc -= 1 / 60; } }
  for (const f of [YOU, PAL, BOSS]) f.mixer.update(dt);
  const mid = F ? (F.you.x + Math.min(F.boss.x, R.ARENA.right)) / 2 : 0;
  camera.position.set(mid, 1.55, 9.2); camera.lookAt(mid, 1.05, 0);
  if (F) hud();
  renderer.render(scene, camera);
});
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.fov = innerWidth < innerHeight ? 52 : 32; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
$('go').disabled = false; $('go').onclick = begin; $('again').onclick = begin;
$('loadtxt').textContent = 'Ready.';

// ---- the end: DEAL! or not, the score, and the shared board with a name box for a top-ten score
async function end() {
  const won = F.over.won, sc = R.score(F), off = R.discount(F);
  play(won ? YOU : BOSS, 'win'); play(won ? BOSS : YOU, 'down'); if (won) play(PAL, 'win');
  $('endtitle').textContent = won ? 'DEAL!' : 'Your trade-in is worth nothing';
  $('endsub').innerHTML = won ? 'You knocked ' + money(off) + ' of made-up fees off the ' + carName + '. Doc Fee is &ldquo;talking to his manager&rdquo;.' : 'Doc Fee upsold you ' + money(off) + ' short of a deal. Rematch?';
  $('endscore').textContent = sc.toLocaleString('en-CA') + ' points';
  $('end').hidden = false; $('endform').hidden = true; $('endmsg').textContent = 'Reading the board…';
  const show = (rows, mine) => { $('endrows').innerHTML = boardHTML(ranked(rows, FIGHT_HOUSE, false), (r) => r.score.toLocaleString('en-CA'), mine); };
  show([]);
  const mine = F;
  let rows;
  try { rows = await SCORES.top('fight'); } catch (e) { if (F === mine) $('endmsg').textContent = e.message + '. Your score is not on it.'; return; }
  if (F !== mine) return;
  show(rows);
  if (!(sc > 0 && qualifies(rows, FIGHT_HOUSE, false, sc))) { $('endmsg').textContent = ''; return; }
  $('endmsg').textContent = 'You made the top ten.'; $('endform').hidden = false;
  const box = $('endname'); box.value = lastName(); box.focus(); box.select();
  $('endform').onsubmit = async (e) => {
    e.preventDefault();
    const c = checkName(box.value); if (!c.ok) { $('endmsg').textContent = c.why; return; }
    const entry = { name: c.name, score: sc, at: new Date().toISOString() };
    $('endform').hidden = true; $('endmsg').textContent = 'Saving…';
    try { const after = await SCORES.submit('fight', entry); keepName(c.name); show(after, entry); $('endmsg').textContent = 'Saved. You are on the board.'; }
    catch (err) { $('endform').hidden = false; $('endmsg').textContent = err.message + '. Not saved: try again.'; }
  };
}
