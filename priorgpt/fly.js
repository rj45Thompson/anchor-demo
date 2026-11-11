// fly.js - PriorGPT flown through (UC-PG7; R24 the city, R25 the 3D windows, R26 WebGPU, R27 the model taken apart).
//
// The scene is the LLM as a city, every size READ from the run: the model's blocks stand as towers whose floors are its weight
// tensors (height = weights, from meta.json's manifest), beside the city of its training text, a building per speech and a
// floor per line (from the priors page.js builds). Each section of the page is a 3D window standing beside what it explains;
// the tour flies window to window, and the visitor can fly anywhere. What the page does lights the city: page.js tells this
// file each answer's cited lines, each written character's line, and what every head looked at (pg:answer, pg:char, pg:learn),
// and the model's towers light from the statements its graphs run (PG_LIVE.total). Nothing here decides anything.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('en-US');
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// AUTHORED, every one: the city's layout and look (the sizes it shows are read; where things stand is this page's choice)
const LAYOUT = {
  perWeight: 1 / 100000,  // a tower floor's height: one unit for every 100,000 weights in its tensors
  floorMin: 0.14,         // a layer norm's 768 weights would be invisible at that scale: the least floor drawn
  tower: 4, towerGap: 7,  // a block's footprint and the distance between blocks
  modelX: -66,            // where the token table stands; the blocks follow it to the east
  cityX: 10,              // the west edge of the training text's city
  cols: 80, step: 1.1,    // buildings per row, and their spacing
  building: 0.72, lineH: 0.16,
  px: 0.02,               // a 3D window's size in the world for each CSS pixel
};
const COLOR = { bg: 0x0b1219, ground: 0x0e1720, grid: 0x1c2b3a, head: 0x3d7fd1, proj: 0x2fa39a, ff: 0xe0873c, norm: 0x6b7c8d,
  embed: 0x8f6bd1, out: 0xd96b8f, accent: 0xf08a3c, lit: 0xffd27a, quiet: 0x33475c, unnamed: 0x24323f };
// the speakers who speak most, each a colour of its own; the rest share one (the priors window lists them)
const PALETTE = [0x7fb2e5, 0x8fd6a0, 0xe8c468, 0xff8f6b, 0xc792ea, 0x5fd3d3, 0xf2a7c3, 0xb5d36b, 0xf0b27a, 0x9aa7ff];

// ---------------------------------------------------------------- the renderer: WebGPU, or its WebGL 2 backend (R26)
const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
} catch (e) {
  // UC-PG7 alternate 1b: say why, and leave the windows as plain panels
  document.body.classList.remove('pending');
  $('backend').textContent = 'no 3D view here: ' + e.message;
  $('backend').className = 'pill bad';
  throw e;
}
const onGPU = !!(renderer.backend && renderer.backend.isWebGPUBackend);
$('backend').textContent = onGPU ? 'WebGPU' : 'WebGL 2 (this browser has no WebGPU)';
$('backend').title = onGPU ? 'The city is drawn by WebGPU' : 'WebGPU is not offered here, so three.js draws the same scene on its WebGL 2 backend';
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(COLOR.bg);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(COLOR.bg, 140, 420);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
camera.position.set(16, 80, 160);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(16, 0, 0);
controls.maxPolarAngle = 88 * DEG;
const css = new CSS3DRenderer();
// the layer of windows passes every pointer through to the scene, except where a window is (CSS3DObject sets its own)
css.domElement.style.pointerEvents = 'none';
$('css').append(css.domElement);
const cssScene = new THREE.Scene();

scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x1a1208, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(-60, 120, 80);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: COLOR.ground, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);
const grid = new THREE.GridHelper(600, 120, COLOR.grid, COLOR.grid);
grid.position.y = 0.005;
scene.add(grid);

// ---------------------------------------------------------------- labels: a canvas drawn once, standing up to the camera
const labels = [];
function label(lines, at, opts = {}) {
  const size = opts.size || 1;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const fontPx = 46;
  ctx.font = '600 ' + fontPx + 'px system-ui, sans-serif';
  const w = Math.ceil(Math.max(...lines.map((l, i) => ctx.measureText(l).width * (i ? 0.78 : 1)))) + 40;
  c.width = w;
  c.height = Math.ceil(lines.length * fontPx * 1.25 + 24);
  ctx.fillStyle = 'rgba(11,18,25,0.78)';
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 18);
  ctx.fill();
  lines.forEach((l, i) => {
    ctx.font = (i ? '400 ' + Math.round(fontPx * 0.78) : '600 ' + fontPx) + 'px system-ui, sans-serif';
    ctx.fillStyle = i ? '#c9d3dc' : (opts.color || '#f4f2ec');
    ctx.fillText(l, 20, 12 + fontPx * (i + 0.85) * 1.2);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(c.width / 100 * size, c.height / 100 * size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.position.copy(at);
  m.renderOrder = 2;
  scene.add(m);
  labels.push(m);
  return m;
}

// ---------------------------------------------------------------- the model: its blocks as towers, read from the weights' manifest
const meta = await fetch('data/meta.json').then((r) => r.json());
const hyper = meta.hyper;
const W = meta.weights;
const weightsIn = (prefix) => W.filter((w) => w.name.startsWith(prefix)).reduce((s, w) => s + w.count, 0);
const floorH = (n) => Math.max(LAYOUT.floorMin, n * LAYOUT.perWeight);
const towerFloors = [];          // per block: [{mesh, kind, head}]
const pickable = [];             // the meshes a pointer can name
const unitBox = new THREE.BoxGeometry(1, 1, 1);
function floorMesh(x, y, z, w, h, d, color, info) {
  const m = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, emissive: color, emissiveIntensity: 0.12 }));
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.userData = info;
  scene.add(m);
  pickable.push(m);
  return m;
}
const T = LAYOUT.tower;
const embedN = weightsIn('token_embedding_table.') + weightsIn('position_embedding_table.');
const embedX = LAYOUT.modelX;
floorMesh(embedX, 0, 0, 6, floorH(embedN), 6, COLOR.embed, { what: 'the token and position tables: ' + fmt(embedN) + ' weights. Each of its ' + meta.chars.length + ' characters, and each of ' + hyper.block_size + ' positions, is a row of ' + hyper.n_embed + ' numbers' });
// the characters it knows, written on the table's top
{
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a1f45';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#f4f2ec';
  ctx.font = '600 44px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  const per = Math.ceil(Math.sqrt(meta.chars.length));
  meta.chars.forEach((ch, i) => ctx.fillText(ch === '\n' ? '↵' : ch === ' ' ? '␣' : ch, (i % per + 0.5) * 512 / per, (Math.floor(i / per) + 0.78) * 512 / per));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const top = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), new THREE.MeshBasicMaterial({ map: tex }));
  top.rotation.x = -Math.PI / 2;
  top.position.set(embedX, floorH(embedN) + 0.01, 0);
  scene.add(top);
}
label(['In: ' + meta.chars.length + ' characters', 'the only letters it knows'], new THREE.Vector3(embedX, floorH(embedN) + 4, 0), { color: '#c792ea', size: 1.3 });
let topY = 0;
for (let l = 0; l < hyper.n_layers; l++) {
  const x = embedX + 6 + (l + 1) * LAYOUT.towerGap - 2;
  const p = 'blocks.' + l + '.';
  const floors = [{ kind: 'norm', n: weightsIn(p + 'ln1.'), what: 'layer norm' }];
  for (let h = 0; h < hyper.n_heads; h++) floors.push({ kind: 'head', head: h, n: weightsIn(p + 'sa.heads.' + h + '.'), what: 'attention head ' + (h + 1) + ': its key, query and value' });
  floors.push({ kind: 'proj', n: weightsIn(p + 'sa.proj.'), what: 'the projection that mixes the six heads' });
  floors.push({ kind: 'norm', n: weightsIn(p + 'ln2.'), what: 'layer norm' });
  floors.push({ kind: 'ff', n: weightsIn(p + 'ff.net.0.'), what: 'feed-forward, up to ' + 4 * hyper.n_embed + ' numbers' });
  floors.push({ kind: 'ff', n: weightsIn(p + 'ff.net.2.'), what: 'feed-forward, back down to ' + hyper.n_embed });
  let y = 0;
  const made = [];
  for (const f of floors) {
    const h = floorH(f.n);
    const m = floorMesh(x, y + 0.03, 0, T, h - 0.06, T, COLOR[f.kind], { what: 'block ' + (l + 1) + ', ' + f.what + ': ' + fmt(f.n) + ' weights', layer: l, head: f.head });
    made.push({ mesh: m, kind: f.kind, head: f.head });
    y += h;
  }
  topY = Math.max(topY, y);
  towerFloors.push(made);
  label(['Block ' + (l + 1), fmt(weightsIn(p)) + ' weights'], new THREE.Vector3(x, y + 2.6, 0), { size: 1.3 });
}
const outX = embedX + 6 + (hyper.n_layers + 1) * LAYOUT.towerGap - 2;
const outN = weightsIn('ln_f.') + weightsIn('lm_head.');
const outTower = floorMesh(outX, 0, 0, T, floorH(outN), T, COLOR.out, { what: 'the last layer norm and the head: ' + fmt(outN) + ' weights, turning ' + hyper.n_embed + ' numbers into a chance for each of ' + meta.chars.length + ' characters' });
label(['Out: the next character', 'a chance for each of ' + meta.chars.length], new THREE.Vector3(outX, floorH(outN) + 4, 0), { color: '#f2a7c3', size: 1.3 });
const modelMid = (embedX + outX) / 2;
label(['The model: ' + fmt(meta.parameters) + ' weights', hyper.n_layers + ' blocks of ' + hyper.n_heads + ' attention heads; a floor\'s height is its weights'], new THREE.Vector3(modelMid, topY + 9, -2), { size: 2.2 });

// the window's words about it, from the same manifest
$('modeltext').innerHTML = '<p>The model is <b>' + fmt(meta.parameters) + '</b> numbers, its weights, learned from the training text. They stand here as towers: '
  + 'a character comes in on the left as a row of ' + hyper.n_embed + ' numbers, climbs through <b>' + hyper.n_layers + ' blocks</b>, and comes out on the right as a chance for each of the '
  + meta.chars.length + ' characters it knows.</p><p>Each floor is one part of a block, as tall as its weights: the <span style="color:#7fb2e5">blue</span> floors are the '
  + hyper.n_heads + ' attention heads, which look back at the characters before; <span style="color:#5fd3d3">teal</span> mixes what they found; the <span style="color:#f0b27a">orange</span> pair is the feed-forward layer, '
  + 'most of each block\'s weights. Point at any floor to read what it is. The towers light while the model runs.</p>';

// ---------------------------------------------------------------- the context strip and the chances (the model taken apart, R27)
function canvasPlane(w, h, pxW, pxH, at, rotY) {
  const c = document.createElement('canvas');
  c.width = pxW;
  c.height = pxH;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  m.position.copy(at);
  m.rotation.y = rotY || 0;
  scene.add(m);
  return { c, ctx: c.getContext('2d'), tex, mesh: m };
}
// in front of the last blocks and the head, where the learn stop looks (the left of its view is the window's)
const strip = canvasPlane(30, 4.1, 2048, 280, new THREE.Vector3(outX - 12, 3.2, 10), 0);
const chancesBoard = canvasPlane(10, 7.5, 600, 450, new THREE.Vector3(outX + 9, 5.5, 6), -24 * DEG);
const showChar = (c) => (c === '\n' ? '↵' : c === ' ' ? '␣' : c);
function drawLearn(d) {
  const { ctx, c } = strip;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(11,18,25,0.82)';
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 22);
  ctx.fill();
  const n = Math.min(d.chars.length, 40);
  const from = d.chars.length - n;
  let top = 0;
  for (let s = from; s < d.chars.length; s++) top = Math.max(top, d.row[s]);
  const cw = (c.width - 60) / 40;
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillStyle = '#c9d3dc';
  ctx.fillText('What block ' + (d.layer + 1) + ', head ' + (d.head + 1) + ' looks at for the newest character (bar = its share of attention)', 30, 34);
  for (let k = 0; k < n; k++) {
    const s = from + k;
    const x = 30 + k * cw;
    const hBar = 140 * d.row[s] / (top || 1);
    ctx.fillStyle = 'rgba(240,138,60,' + (0.25 + 0.75 * d.row[s] / (top || 1)).toFixed(3) + ')';
    ctx.fillRect(x + 4, 196 - hBar, cw - 8, hBar);
    ctx.fillStyle = s === d.chars.length - 1 ? '#ffd27a' : '#f4f2ec';
    ctx.font = '600 40px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(showChar(d.chars[s]), x + cw / 2, 252);
    ctx.textAlign = 'left';
  }
  strip.tex.needsUpdate = true;
  const b = chancesBoard;
  b.ctx.clearRect(0, 0, b.c.width, b.c.height);
  b.ctx.fillStyle = 'rgba(11,18,25,0.85)';
  b.ctx.beginPath();
  b.ctx.roundRect(0, 0, b.c.width, b.c.height, 22);
  b.ctx.fill();
  b.ctx.fillStyle = '#f4f2ec';
  b.ctx.font = '600 30px system-ui, sans-serif';
  b.ctx.fillText('Its chances for the next character', 24, 46);
  d.chances.forEach((x, i) => {
    const y = 80 + i * 44;
    b.ctx.font = '600 30px ui-monospace, Consolas, monospace';
    b.ctx.fillText(showChar(x.char), 30, y + 28);
    b.ctx.fillStyle = '#f08a3c';
    b.ctx.fillRect(90, y + 6, 380 * x.p / d.chances[0].p, 26);
    b.ctx.fillStyle = '#c9d3dc';
    b.ctx.font = '24px ui-monospace, Consolas, monospace';
    b.ctx.fillText((100 * x.p).toFixed(1) + '%', 480, y + 28);
    b.ctx.fillStyle = '#f4f2ec';
  });
  b.tex.needsUpdate = true;
  // each head's floor glows by how sharply it looks: its largest single share of attention
  d.att.forEach((layer, l) => layer.forEach((row, h) => {
    let mx = 0;
    for (const v of row) mx = Math.max(mx, v);
    const f = towerFloors[l].find((x) => x.kind === 'head' && x.head === h);
    f.focus = mx;
    f.picked = l === d.layer && h === d.head;
  }));
}
window.addEventListener('pg:learn', (e) => drawLearn(e.detail));

// ---------------------------------------------------------------- the training text: a building per speech, a floor per line
let priorsMesh = null;
let instLine = null;          // instance -> line id
let lineInst = null;          // line id -> instance (-1 for a line with no floor: a blank line, a speaker's name line)
let baseColor = null;
let cityMid = new THREE.Vector3(54, 0, 0);
const lit = new Map();        // instance -> brightness, fading
let P = null;
function buildPriors(live) {
  P = live.priors;
  const st = live.stats;
  const speeches = P.speeches;
  let n = 0;
  for (const sp of speeches) n += sp.lines.length;
  const rows = Math.ceil(speeches.length / LAYOUT.cols);
  const z0 = -(rows - 1) * LAYOUT.step / 2;
  const geo = new THREE.BoxGeometry(LAYOUT.building, LAYOUT.lineH * 0.82, LAYOUT.building);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1 });
  priorsMesh = new THREE.InstancedMesh(geo, mat, n);
  instLine = new Int32Array(n);
  lineInst = new Int32Array(P.lines.length).fill(-1);
  baseColor = new Float32Array(n * 3);
  // the speakers who speak most: a colour each
  const bySpeeches = [...P.speakers].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const colourOf = new Map(bySpeeches.slice(0, PALETTE.length).map((e, i) => [e[0], PALETTE[i]]));
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  let k = 0;
  speeches.forEach((sp, i) => {
    const x = LAYOUT.cityX + (i % LAYOUT.cols) * LAYOUT.step;
    const z = z0 + Math.floor(i / LAYOUT.cols) * LAYOUT.step;
    col.setHex(sp.speaker === null ? COLOR.unnamed : colourOf.get(sp.speaker) || COLOR.quiet);
    sp.lines.forEach((lid, f) => {
      m4.makeTranslation(x, LAYOUT.lineH * (f + 0.5), z);
      priorsMesh.setMatrixAt(k, m4);
      priorsMesh.setColorAt(k, col);
      baseColor[k * 3] = col.r;
      baseColor[k * 3 + 1] = col.g;
      baseColor[k * 3 + 2] = col.b;
      instLine[k] = lid;
      lineInst[lid] = k;
      k += 1;
    });
  });
  priorsMesh.instanceMatrix.needsUpdate = true;
  priorsMesh.instanceColor.needsUpdate = true;
  priorsMesh.userData = { priors: true };
  scene.add(priorsMesh);
  pickable.push(priorsMesh);
  const xMid = LAYOUT.cityX + (LAYOUT.cols - 1) * LAYOUT.step / 2;
  cityMid = new THREE.Vector3(xMid, 0, 0);
  label(['The training text: ' + fmt(st.speeches) + ' speeches', 'a building per speech, a floor per line'], new THREE.Vector3(xMid, 18, z0 - 6), { size: 3.6 });
  $('priorstext').innerHTML = '<p>Its priors: every line it was trained on, <b>' + fmt(st.characters) + '</b> characters in <b>' + fmt(st.lines) + '</b> lines, '
    + fmt(st.speeches) + ' speeches by ' + fmt(st.speakers) + ' speakers. Each building is one speech, in the order the text runs, and each floor one of its spoken lines: '
    + fmt(n) + ' floors (a blank line and a speaker\'s name line get none). The tallest speeches are the longest.</p><p>A node graph joins them: a line is in a speech, a speech is spoken by a speaker and followed by the next. '
    + 'When it answers, it walks that graph and the lines it cites light up here. Point at a building to read it; click to fly there.</p>';
  $('legend').innerHTML = bySpeeches.slice(0, PALETTE.length).map((e, i) => '<span><i style="background:#' + PALETTE[i].toString(16).padStart(6, '0') + '"></i>'
    + e[0].replace(/[&<>]/g, '') + ' (' + fmt(e[1].length) + ')</span>').join('') + '<span><i style="background:#' + COLOR.quiet.toString(16).padStart(6, '0') + '"></i>everyone else</span>';
  stops.find((s) => s.stop === 'priors').subject.copy(cityMid);
  stops.find((s) => s.stop === 'scores').subject.copy(cityMid);
  placeAll();
}
function light(lineNo, amount) {
  if (!lineInst) return;
  const k = lineInst[lineNo - 1];
  if (k < 0 || k === undefined) return;
  lit.set(k, Math.max(lit.get(k) || 0, amount));
}

// ---------------------------------------------------------------- the check: a bridge from the model into the text
const bridgeCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(outX + 2, floorH(outN), 0), new THREE.Vector3((outX + LAYOUT.cityX) / 2, 22, 0),
  new THREE.Vector3(LAYOUT.cityX - 1, 1, 0));
const bridgeMat = new THREE.MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.35 });
scene.add(new THREE.Mesh(new THREE.TubeGeometry(bridgeCurve, 64, 0.22, 10), bridgeMat));
label(['The check', 'every answer walks into the text it read'], new THREE.Vector3((outX + LAYOUT.cityX) / 2, 27, 0), { color: '#f08a3c', size: 1.8 });
let bridgeGlow = 0;
const beams = [];
const beamMat = new THREE.MeshBasicMaterial({ color: COLOR.lit, transparent: true, opacity: 0.8 });
window.addEventListener('pg:answer', (e) => {
  bridgeGlow = 1;
  for (const b of beams) scene.remove(b);
  beams.length = 0;
  for (const n of e.detail.lines) {
    light(n, 1);
    const k = lineInst ? lineInst[n - 1] : -1;
    if (k >= 0 && beams.length < 16) {
      const m4 = new THREE.Matrix4();
      priorsMesh.getMatrixAt(k, m4);
      const p = new THREE.Vector3().setFromMatrixPosition(m4);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 30, 8), beamMat);
      beam.position.set(p.x, p.y + 15, p.z);
      scene.add(beam);
      beams.push(beam);
    }
  }
  // the cited lines may stand anywhere in the city: a way to fly to the first of them, in the answer itself
  if (beams.length) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Show ' + (beams.length === 1 ? 'its line' : 'its ' + beams.length + ' lines') + ' in the city';
    const at = beams[0].position.clone();
    b.addEventListener('click', () => flyTo(V(at.x + 9, 12, at.z + 16), V(at.x, 2, at.z), 1600));
    $('answer').prepend(b);
  }
});
window.addEventListener('pg:char', (e) => { if (e.detail.line) light(e.detail.line, 0.8); });

// ---------------------------------------------------------------- the tour: each stop a window beside what it explains
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const stops = [
  { stop: 'welcome', subject: V(16, 0, 0), bearing: 0, dist: 150, height: 70 },
  { stop: 'model', subject: V(modelMid, 6, 0), bearing: -12, dist: 44, height: 15 },
  { stop: 'learn', subject: V(outX - 6, 4.5, 8), bearing: 0, dist: 34, height: 9 },
  { stop: 'priors', subject: V(54, 0, 0), bearing: 28, dist: 105, height: 60 },
  { stop: 'ask', subject: V((outX + LAYOUT.cityX) / 2 + 8, 4, 0), bearing: 8, dist: 58, height: 24 },
  { stop: 'write', subject: V(outX + 4, 4, 2), bearing: -32, dist: 38, height: 13 },
  { stop: 'grow', subject: V(LAYOUT.cityX + 80, 0, 30), bearing: 72, dist: 70, height: 34 },
  { stop: 'scores', subject: V(54, 0, 0), bearing: 152, dist: 110, height: 58 },
  { stop: 'blueprint', subject: V(modelMid, 6, 0), bearing: 196, dist: 52, height: 22 },
  { stop: 'how', subject: V(16, 0, 0), bearing: -158, dist: 150, height: 70 },
];
const wins = new Map();
for (const el of document.querySelectorAll('#windows .win')) {
  const obj = new CSS3DObject(el);
  obj.scale.setScalar(LAYOUT.px);
  cssScene.add(obj);
  const s = stops.find((x) => x.stop === el.dataset.stop);
  if (!s) throw new Error('fly.js: a window for no stop: ' + el.dataset.stop);
  s.el = el;
  s.obj = obj;
  s.title = el.querySelector('h2').textContent;
  s.kick = el.querySelector('.kick').textContent;
  wins.set(el.dataset.stop, s);
  // a window not in front is a door: clicking it flies there
  el.addEventListener('click', (ev) => { if (!el.classList.contains('here')) { ev.preventDefault(); ev.stopPropagation(); go(stops.indexOf(s)); } }, true);
}
if (wins.size !== stops.length) throw new Error('fly.js: ' + wins.size + ' windows for ' + stops.length + ' stops');

function poseOf(s) {
  const b = s.bearing * DEG;
  const C = V(s.subject.x + Math.sin(b) * s.dist, s.height, s.subject.z + Math.cos(b) * s.dist);
  const T = s.subject.clone();
  // on a wide screen the window stands on the left, so the camera turns until the subject stands on the right
  const aspect = innerWidth / innerHeight;
  if (aspect >= 1.15) {
    const f = T.clone().sub(C).normalize();
    const right = new THREE.Vector3().crossVectors(f, UP).normalize();
    const shift = 0.42 * C.distanceTo(T) * Math.tan(camera.fov * DEG / 2) * aspect;
    C.addScaledVector(right, -shift);
    T.addScaledVector(right, -shift);
  }
  return { C, T };
}
/** a stop's window: in front of its camera, filling most of the view's height, to the left on a wide screen so what it
 *  explains shows on the right, and the whole width on a narrow one */
function place(s) {
  const { C, T } = poseOf(s);
  const f = T.clone().sub(C).normalize();
  const right = new THREE.Vector3().crossVectors(f, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, f);
  const tanH = Math.tan(camera.fov * DEG / 2);
  const aspect = innerWidth / innerHeight;
  // measured at its full size: a window away from its stop is drawn as a small door (index.html, .win:not(.here))
  s.el.classList.add('measure');
  const ww = s.el.offsetWidth * LAYOUT.px;
  const wh = s.el.offsetHeight * LAYOUT.px;
  s.el.classList.remove('measure');
  const wide = aspect >= 1.15;
  let d = (wh / 0.8) / (2 * tanH);
  d = Math.max(d, (ww / (wide ? 0.5 : 0.94)) / (2 * tanH * aspect));
  const halfW = d * tanH * aspect;
  const x = wide ? -halfW + ww / 2 + 0.05 * halfW : 0;
  s.obj.position.copy(C).addScaledVector(f, d).addScaledVector(right, x).addScaledVector(up, -0.02 * d * tanH);
  s.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f.clone().negate()));
}
function placeAll() {
  document.body.classList.toggle('narrow', innerWidth < 760);
  for (const s of stops) place(s);
}

let current = 0;
let flight = null;
function go(i) {
  current = (i + stops.length) % stops.length;
  const s = stops[current];
  const { C, T } = poseOf(s);
  for (const x of stops) x.el.classList.toggle('here', x === s);
  $('stopname').innerHTML = s.title.replace(/[&<>]/g, '') + '<small>' + (current + 1) + ' of ' + stops.length + ' &middot; ' + s.kick.replace(/^\d+ \S+ /, '') + '</small>';
  flyTo(C, T);
}
function flyTo(C, T, ms = 1700) {
  if (reduced) { camera.position.copy(C); controls.target.copy(T); return; }
  flight = { t0: performance.now(), ms, fromC: camera.position.clone(), fromT: controls.target.clone(), toC: C.clone(), toT: T.clone() };
}
$('next').addEventListener('click', () => go(current + 1));
$('back').addEventListener('click', () => go(current - 1));
$('start').addEventListener('click', () => go(1));
window.addEventListener('pg:go', (e) => { const i = stops.findIndex((s) => s.stop === e.detail); if (i >= 0) go(i); });
for (const a of document.querySelectorAll('.top a[data-stop]')) a.addEventListener('click', (e) => { e.preventDefault(); go(stops.findIndex((s) => s.stop === a.dataset.stop)); });
const typing = () => { const t = document.activeElement; return t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName); };
const keys = new Set();
addEventListener('keydown', (e) => {
  if (typing()) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(current + 1); e.preventDefault(); return; }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(current - 1); e.preventDefault(); return; }
  keys.add(e.key.toLowerCase());
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
// a swipe across the scene's empty sky moves the tour too
let swipe = null;
canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 1) swipe = { x: e.touches[0].clientX, t: performance.now() }; }, { passive: true });
canvas.addEventListener('touchend', (e) => {
  if (!swipe || !e.changedTouches.length) return;
  const dx = e.changedTouches[0].clientX - swipe.x;
  if (Math.abs(dx) > 90 && performance.now() - swipe.t < 400) go(current + (dx < 0 ? 1 : -1));
  swipe = null;
});

// ---------------------------------------------------------------- pointing at the city
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let lastHover = 0;
let downAt = null;
function hit(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(pickable, false)[0];
  return h || null;
}
function describe(h) {
  if (h.object.userData.priors) {
    const lid = instLine[h.instanceId];
    const line = P.lines[lid];
    const sp = P.speeches[line.speech];
    return 'speech ' + fmt(sp.id + 1) + (sp.speaker ? ', ' + sp.speaker : '') + ' · line ' + fmt(lid + 1) + ': ' + line.text;
  }
  return h.object.userData.what;
}
canvas.addEventListener('pointermove', (ev) => {
  const now = performance.now();
  if (now - lastHover < 60) return;
  lastHover = now;
  const h = hit(ev);
  const tip = $('tip');
  if (!h) { tip.style.display = 'none'; return; }
  tip.textContent = describe(h);
  tip.style.display = 'block';
  tip.style.left = Math.min(ev.clientX + 14, innerWidth - 350) + 'px';
  tip.style.top = (ev.clientY + 16) + 'px';
});
canvas.addEventListener('pointerleave', () => { $('tip').style.display = 'none'; });
canvas.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
canvas.addEventListener('pointerup', (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6) return;
  const h = hit(ev);
  if (!h) return;
  if (h.object.userData.priors) {
    const m4 = new THREE.Matrix4();
    priorsMesh.getMatrixAt(h.instanceId, m4);
    const p = new THREE.Vector3().setFromMatrixPosition(m4);
    flyTo(V(p.x + 6, p.y + 7, p.z + 10), V(p.x, p.y, p.z), 1200);
  } else if (h.object.userData.head !== undefined) {
    // a head's floor: take the model apart at that head
    window.dispatchEvent(new CustomEvent('pg:pickhead', { detail: { layer: h.object.userData.layer, head: h.object.userData.head } }));
    go(stops.findIndex((s) => s.stop === 'learn'));
  }
});

// ---------------------------------------------------------------- the frame
function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  css.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  placeAll();
}
addEventListener('resize', resize);
resize();

let lastSteps = 0;
let towerHeat = 0;
const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
const side = new THREE.Vector3();
const camPos = new THREE.Vector3();
const toWin = new THREE.Vector3();
const col = new THREE.Color();
const litCol = new THREE.Color(COLOR.lit);
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (flight) {
    const k = Math.min(1, (performance.now() - flight.t0) / flight.ms);
    const e = ease(k);
    camera.position.lerpVectors(flight.fromC, flight.toC, e);
    // an arc: rise on the way, so a long flight looks over the city instead of through it
    camera.position.y += Math.sin(Math.PI * e) * Math.min(40, flight.fromC.distanceTo(flight.toC) * 0.18);
    controls.target.lerpVectors(flight.fromT, flight.toT, e);
    if (k === 1) flight = null;
  } else if (keys.size) {
    const speed = Math.max(8, camera.position.distanceTo(controls.target)) * dt * 0.9;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    side.crossVectors(fwd, UP);
    const move = new THREE.Vector3();
    if (keys.has('w')) move.add(fwd);
    if (keys.has('s')) move.sub(fwd);
    if (keys.has('d')) move.add(side);
    if (keys.has('a')) move.sub(side);
    if (keys.has('e')) move.y += 1;
    if (keys.has('q')) move.y -= 1;
    if (move.lengthSq()) { move.normalize().multiplyScalar(speed); camera.position.add(move); controls.target.add(move); }
  }
  controls.update();
  // the towers light while the model runs: the statements Gpt.step has run since the last frame (PG_LIVE.total)
  const L = globalThis.PG_LIVE;
  if (L && L.byName.has('Gpt.step')) {
    const steps = L.total[L.byName.get('Gpt.step')];
    if (steps > lastSteps) towerHeat = 1;
    lastSteps = steps;
  }
  towerHeat *= Math.exp(-dt * 2.5);
  for (const floors of towerFloors) {
    for (const f of floors) {
      const focus = f.kind === 'head' && f.focus !== undefined ? f.focus : 0;
      f.mesh.material.emissiveIntensity = 0.12 + towerHeat * 0.9 + focus * 0.9 + (f.picked ? 0.8 : 0);
    }
  }
  outTower.material.emissiveIntensity = 0.12 + towerHeat * 1.1;
  bridgeGlow *= Math.exp(-dt * 0.35);
  bridgeMat.opacity = 0.35 + 0.6 * bridgeGlow;
  // lit floors fade back to their speaker's colour
  if (lit.size && priorsMesh) {
    for (const [k, b] of lit) {
      col.setRGB(baseColor[k * 3], baseColor[k * 3 + 1], baseColor[k * 3 + 2]).lerp(litCol, Math.min(1, b));
      priorsMesh.setColorAt(k, col);
      const nb = b * Math.exp(-dt * 0.25);
      if (nb < 0.02) { lit.delete(k); col.setRGB(baseColor[k * 3], baseColor[k * 3 + 1], baseColor[k * 3 + 2]); priorsMesh.setColorAt(k, col); } else lit.set(k, nb);
    }
    priorsMesh.instanceColor.needsUpdate = true;
  }
  // labels stand up to the camera; a window behind the camera is not drawn (a CSS transform there would mirror it)
  for (const m of labels) m.quaternion.copy(camera.quaternion);
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(fwd);
  for (const s of stops) {
    toWin.copy(s.obj.position).sub(camPos);
    const ahead = toWin.dot(fwd);
    s.el.style.display = ahead > 1 && toWin.length() < 520 ? '' : 'none';
  }
  renderer.render(scene, camera);
  css.render(cssScene, camera);
}
renderer.setAnimationLoop(frame);

document.body.classList.remove('pending');
document.body.classList.add('fly');
placeAll();
go(0);
const live = globalThis.PG_LIVE;
// the page may have taken the model apart before this scene stood: draw what it last showed
if (live && live.lastLearn) drawLearn(live.lastLearn);
if (live && live.priors) buildPriors(live);
else window.addEventListener('pg:ready', (e) => buildPriors(e.detail), { once: true });
// a window's size is its layout's: measured once the page's own tools have filled it
setTimeout(placeAll, 1500);
// what a test can ask (UC-PG7): the backend, the stops, the city's counts, and what is lit
globalThis.__fly = { backend: () => (onGPU ? 'WebGPU' : 'WebGL 2'), stops: () => stops.map((s) => s.stop), current: () => stops[current].stop, go,
  floors: () => (priorsMesh ? priorsMesh.count : 0), towers: () => towerFloors.length, lit: () => lit.size, beams: () => beams.length, flying: () => !!flight };
