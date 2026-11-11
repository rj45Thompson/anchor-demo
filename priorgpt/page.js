// page.js - PriorGPT on its Blueprint (index.html, UC-PG1).
//
// Before anything runs, this page prints the engine's graphs again itself and compares the text with core.js: a program
// that is not the one printed from the graphs is refused (R1). Then it loads the weights and the training text, checks
// its own forward pass against PyTorch's on fixed inputs (UC-PG2 alternate 4a), and answers. Every statement of the engine
// announces itself as it runs, and the open graph's node lights (R10). Clicking a node prints the line it was read from.
const PG = window.PG;
const NGL = window.NGL;
const J = window.JSGRAPH;
const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const fmt = (n) => Number(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const say = (html, cls) => { const p = document.createElement('p'); if (cls) p.className = cls; p.innerHTML = html; $('status').append(p); };

const graphs = NGL.parse(PG.ngl, 'core.ngl');
const heat = graphs.map(() => new Map());
const runs = new Float64Array(graphs.length);
const rate = new Float64Array(graphs.length);
const byName = new Map(graphs.map((g, i) => [g.name, i]));
let lastRun = new Float64Array(graphs.length);
globalThis.__bpNode = (g, id) => { heat[g].set(id, 1); runs[g] += 1; lastRun[g] += 1; };

function refuse(why) {
  $('status').innerHTML = '';
  say(esc(why), 'bad');
  $('proof').innerHTML = '<p class="bad"></p>';
  $('proof').firstChild.textContent = why;
}

// R1: the program that runs is the one printed from the graphs, or nothing runs
const printed = J.printModule(graphs, { probe: '__bpNode' });
const served = await fetch('core.js', { cache: 'no-store' }).then((r) => r.text());
if (printed !== served) {
  refuse('Not started: core.js here is not the program printed from the graphs (' + fmt(served.length) + ' characters served, '
    + fmt(printed.length) + ' printed).');
  throw new Error('core.js is not the program printed from the graphs');
}
const core = await import('./core.js');

(function proof() {
  const statements = graphs.reduce((s, g) => s + [...g.nodes.keys()].filter((k) => k[0] === 's').length, 0);
  const line = (html) => { const p = document.createElement('p'); p.innerHTML = html; $('proof').append(p); };
  line('<b>Running:</b> the program printed from <b>' + graphs.length + '</b> graphs (' + fmt(statements) + ' statements) read from the engine\'s source. '
    + '<span class="ok">This page printed it again: the same ' + fmt(printed.length) + ' characters.</span>');
  line('The graphs printed back parse to the source\'s own syntax tree (checked when the page was built, ' + esc(PG.build.when) + '). '
    + 'The loops that run millions of times a character are in kernels.js, off the graphs.');
})();

// ---- the list of graphs, by class, each with how often it runs
const rows = [];
(function list() {
  const ol = $('graphs');
  let cls = null;
  graphs.forEach((g, i) => {
    const kind = NGL.termText(g.attrs.kind);
    if (kind === 'class' || kind === 'import' || kind === 'export') return;
    const owner = g.name.includes('.') ? g.name.slice(0, g.name.indexOf('.')) : 'module';
    if (owner !== cls) { cls = owner; const h = document.createElement('li'); h.className = 'cls'; h.textContent = owner; ol.append(h); }
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="name"></span><span class="heat"><i></i></span>';
    b.firstChild.textContent = g.name.includes('.') ? g.name.slice(g.name.indexOf('.') + 1) : g.name;
    b.title = g.name + (g.attrs.doc ? ': ' + NGL.termText(g.attrs.doc) : '');
    b.addEventListener('click', () => open(i));
    li.append(b);
    ol.append(li);
    rows[i] = { b, bar: b.querySelector('i') };
  });
})();

let shown = null;
function open(i) {
  const g = graphs[i];
  const L = NGL.layout(g);
  const pad = 20;
  const svg = sv('svg', { width: L.w + pad * 2, height: L.h + pad * 2, viewBox: (-pad) + ' ' + (-pad) + ' ' + (L.w + pad * 2) + ' ' + (L.h + pad * 2) });
  const boxes = new Map();
  for (const w of L.wires) {
    if (w.kind !== 'exec') continue;
    const a = L.boxes.get(w.from), b = L.boxes.get(w.to);
    if (!a || !b) continue;
    const x1 = a.x + a.w, y1 = a.y + 22, x2 = b.x, y2 = b.y + 22, dx = Math.max(40, Math.abs(x2 - x1) / 2);
    svg.append(sv('path', { class: 'exec', d: 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2 }));
  }
  for (const [id, b] of L.boxes) {
    const gEl = sv('g', { class: 'box', transform: 'translate(' + b.x + ' ' + b.y + ')' });
    gEl.append(sv('rect', { class: 'body', width: b.w, height: b.h, rx: 7 }));
    const glow = sv('rect', { class: 'glow', width: b.w, height: b.h, rx: 7, opacity: 0 });
    gEl.append(glow);
    gEl.append(sv('rect', { class: 'head', width: b.w, height: 26, rx: 7 }));
    const t = sv('text', { x: 10, y: 18 });
    t.textContent = b.title + (b.sub ? ' ' + b.sub : '');
    gEl.append(t);
    (b.ins || []).slice(0, 3).forEach((p, k) => {
      const pt = sv('text', { class: 'pin', x: 10, y: 44 + k * 17 });
      const v = p.v ? NGL.termText(p.v) : '';
      const s = (p.name ? p.name + ': ' : '') + (v || '');
      pt.textContent = s.length > 90 ? s.slice(0, 89) + '…' : s;
      gEl.append(pt);
    });
    gEl.addEventListener('click', () => pick(i, id, gEl));
    svg.append(gEl);
    boxes.set(id, glow);
  }
  $('bp').replaceChildren(svg);
  $('gname').textContent = g.name;
  $('gdoc').textContent = g.attrs.doc ? NGL.termText(g.attrs.doc) : '';
  $('nodeinfo').textContent = 'Click a node to read the line of code it was read from.';
  rows.forEach((r, k) => r && r.b.setAttribute('aria-current', k === i ? 'true' : 'false'));
  shown = { i, boxes };
}

function pick(i, id, el) {
  for (const x of $('bp').querySelectorAll('.box.picked')) x.classList.remove('picked');
  el.classList.add('picked');
  const g = graphs[i];
  const n = g.nodes.get(id);
  const text = new J.JsPrinter(graphs).stmt(g, id, 0).join('\n');
  const note = n.attrs.note ? '\n// ' + NGL.termText(n.attrs.note) : '';
  $('nodeinfo').textContent = 'core.js line ' + NGL.termText(n.attrs.at) + ', read as ' + n.kw + ':\n' + (text.length > 600 ? text.slice(0, 600) + '…' : text) + note;
}

/** open the graph that ran the most statements in the last action, so what just happened is what lights */
function openBusiest(prefer) {
  let best = -1;
  for (let k = 0; k < graphs.length; k++) {
    if (!rows[k]) continue;
    if (prefer && !graphs[k].name.startsWith(prefer)) continue;
    if (best < 0 || lastRun[k] > lastRun[best]) best = k;
  }
  if (best >= 0 && lastRun[best] > 0) open(best);
}

let panelClock = 0;
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const fade = Math.exp(-dt * 1.2);
  if (shown) {
    const H = heat[shown.i];
    for (const [id, glow] of shown.boxes) {
      const h = H.get(id) || 0;
      glow.setAttribute('opacity', (h * 0.85).toFixed(3));
      if (h) H.set(id, h * fade < 0.02 ? 0 : h * fade);
    }
  }
  panelClock += dt;
  if (panelClock >= 0.25) {
    let top = 1;
    for (let k = 0; k < graphs.length; k++) { rate[k] = rate[k] * 0.85 + runs[k] * 0.15; runs[k] = 0; if (rate[k] > top) top = rate[k]; }
    rows.forEach((r, k) => { if (r) r.bar.style.width = Math.min(100, 100 * Math.log1p(rate[k]) / Math.log1p(top)).toFixed(1) + '%'; });
    for (let k = 0; k < graphs.length; k++) if (!shown || k !== shown.i) heat[k].clear();
    panelClock = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- the model and its priors
const get = (f) => fetch('data/' + f, { cache: 'no-store' });
const [meta, report, probes, half, text, grewPriors, grewWeights] = await Promise.all([
  get('meta.json').then((r) => r.json()), get('report.json').then((r) => r.json()), get('probes.json').then((r) => r.json()),
  get('weights.f16').then((r) => r.arrayBuffer()), get('priors.txt').then((r) => r.text()),
  get('grow_priors.json').then((r) => r.json()), get('grow.json').then((r) => r.json())]);
const vocab = new core.Vocab(meta.chars);
const weights = new core.Weights(meta.weights, core.halfToFloat(new Uint16Array(half)));
const gpt = new core.Gpt(weights, meta.hyper, vocab);
const t0 = performance.now();
const priors = new core.Priors(text, vocab, { name: meta.dataset + ', the notebook\'s training split', licence: meta.licence, url: meta.dataset_url });
const builtMs = performance.now() - t0;
const st = priors.stats();
$('status').innerHTML = '';
say('<b>' + fmt(weights.count) + '</b> weights (the Kaggle run\'s, stored as half floats). Priors: <b>' + fmt(st.characters) + '</b> characters of training text, '
  + fmt(st.lines) + ' lines, ' + fmt(st.speeches) + ' speeches, ' + fmt(st.speakers) + ' speakers, ' + fmt(st.edges) + ' edges, indexed here in ' + fmt(Math.round(builtMs)) + ' ms.');

// UC-PG2 alternate 4a: this page's forward pass against PyTorch's logits on the build's fixed inputs
let worst = 0;
let compared = 0;
for (const p of probes) {
  gpt.reset();
  const ids = vocab.encode(p.context);
  for (let t = 0; t < ids.length; t++) {
    const lg = gpt.feed(ids[t]);
    for (let c = 0; c < lg.length; c++) worst = Math.max(worst, Math.abs(lg[c] - p.logits[t][c]));
    compared += 1;
  }
}
const parityOk = worst <= report.parity.f16Bound;
say('This page\'s own forward pass, against PyTorch\'s on ' + compared + ' fixed positions: worst logit difference '
  + worst.toExponential(2) + ' <span class="' + (parityOk ? 'ok">within' : 'bad">OUTSIDE') + ' the bound the build measured for half floats ('
  + report.parity.f16Bound.toExponential(2) + ').</span>' + (parityOk ? '' : ' Nothing is answered.'), parityOk ? null : 'bad');
if (!parityOk) throw new Error('forward pass outside the parity bound');
openBusiest();

const speakers = [...priors.speakers.keys()].sort();
const local = new core.GptProposer(gpt, speakers);
/** the model, asked for its own answer only when the reader ticks the box (ranking every speaker is slow here) */
// a who-question's own answer from the model means scoring every speaker; the page does that a few at a time (rankSpeakers)
// before it asks, so it stays responsive, and hands the result in here
let ranked = undefined;
const proposer = {
  propose(kind, args) {
    if (kind === 'complete' || kind === 'reply') return local.propose(kind, args);
    return ranked;
  },
  rank(c, args, kind) { return local.rank(c, args, kind); },
};

/** the model's own pick of every speaker for a who-question, scored a few per frame, the progress shown as it goes */
async function rankSpeakers(kind, args, show) {
  let best = null;
  let bestScore = -Infinity;
  const t = performance.now();
  for (let i = 0; i < speakers.length; i++) {
    const s = local.speakerScore(kind, args, speakers[i]);
    if (s > bestScore) { bestScore = s; best = speakers[i]; }
    if (i % 3 === 2) {
      show('The plain model is scoring every speaker: ' + (i + 1) + ' of ' + speakers.length + ', ' + fmt(Math.round((performance.now() - t) / 1000)) + ' s so far...');
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return best;
}
const derived = new core.Derived();
const answerer = new core.Answerer(priors, proposer, { nearMin: report.nearMin, derived });

// ---- asking
const forms = core.Forms.filter((f) => f.name !== 'continue');
for (const f of forms) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = f.example;
  b.addEventListener('click', () => { $('q').value = f.example; ask(); });
  $('examples').append(b);
}
$('q').disabled = false;
$('go').disabled = false;
$('ask').addEventListener('submit', (e) => { e.preventDefault(); ask(); });

function lineText(n) {
  const l = priors.lines[n - 1];
  return l ? l.text : '';
}

function ask() {
  const q = $('q').value.trim();
  if (!q) return;
  const box = $('answer');
  box.hidden = false;
  box.innerHTML = '<p class="note">Working: the model proposes, the priors check...</p>';
  $('go').disabled = true;
  setTimeout(async () => {
    lastRun = new Float64Array(graphs.length);
    const t = performance.now();
    const plan = core.Asker.plan(q);
    if (plan && plan.form.name === 'continue') {
      // text in no listed form is continued by the writer below, every character traced (UC-PG5 step 3)
      $('go').disabled = false;
      box.innerHTML = '<p class="note">Not a question in a listed form, so the model continues it below, each character marked with where the training text holds it.</p>';
      $('w').value = plan.args[0];
      $('write').requestSubmit();
      $('write').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    ranked = undefined;
    if (plan && $('plain').checked && (plan.form.name === 'speaker' || plan.form.name === 'answerer')) {
      ranked = await rankSpeakers(plan.form.name, plan.args, (msg) => { box.innerHTML = '<p class="note">' + esc(msg) + '</p>'; });
    }
    const a = answerer.ask(q);
    const ms = performance.now() - t;
    $('go').disabled = false;
    show(a, ms, q);
    openBusiest('Answerer');
  }, 30);
}

/** line numbers with each run of neighbours as one range: 19385-19429, 19431 */
function ranges(ns) {
  const out = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j > i ? fmt(ns[i]) + '-' + fmt(ns[j]) : fmt(ns[i]));
    i = j;
  }
  return out.join(', ');
}

function show(a, ms, q) {
  const box = $('answer');
  let html = '<span class="badge ' + a.status + '">' + a.status + '</span>';
  if (a.value !== null && a.value !== undefined) html += '<span class="value">' + esc(Array.isArray(a.value) ? 'lines ' + ranges(a.value) : a.value) + '</span>';
  if (a.proposal !== undefined && a.proposal !== null && a.status !== 'REFUSED') {
    html += '<p class="proposal">The plain model\'s own answer: <b>' + esc(a.proposal) + '</b>, '
      + (a.confirmed ? '<span class="ok">which the priors back.</span>' : '<span class="bad">which the priors do not back, so it was replaced.</span>') + '</p>';
  } else if (a.status !== 'REFUSED' && a.status !== 'ABSENT' && a.kind !== 'find') {
    html += '<p class="proposal">The plain model was not asked for its own answer (tick the box above to ask it).</p>';
  }
  if (a.alternatives && a.alternatives.length > 1) html += '<p class="proposal">The priors back ' + a.alternatives.length + ' answers: ' + a.alternatives.map(esc).join(' | ') + '; the model ranked them.</p>';
  if (a.why) html += '<p class="why">' + esc(a.why) + '</p>';
  if (a.chain.length) {
    html += '<ol class="chain">';
    for (const h of a.chain) {
      html += '<li>' + esc(h.says);
      for (const n of h.evidence.slice(0, 4)) html += '<span class="ev">training line ' + fmt(n) + ': <q>' + esc(lineText(n)) + '</q></span>';
      if (h.evidence.length > 4) html += '<span class="ev">and ' + (h.evidence.length - 4) + ' more</span>';
      html += '</li>';
    }
    html += '</ol>';
  }
  html += '<p class="note">' + fmt(Math.round(ms)) + ' ms on this device.</p>';
  box.innerHTML = html;
  if (a.status === 'READ' && a.derived === undefined && a.chain.every((h) => h.evidence.length)) {
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.textContent = 'Keep this chain as a derived prior';
    keep.addEventListener('click', () => {
      const f = derived.keep(q, a, priors);
      keep.disabled = true;
      keep.textContent = 'Kept as derived prior ' + (f.id + 1) + ', resting on ' + f.restsOn.length + ' training lines. Ask it again to see it used.';
    });
    box.append(keep);
  }
  const lines = [];
  for (const h of a.chain) for (const n of h.evidence) if (lines.indexOf(n - 1) < 0 && lines.length < 6) lines.push(n - 1);
  if (lines.length) box.append(drawGraph(lines));
}

/** the node graph around the chain's lines: lines, their speeches, the speakers, and the speech after */
function drawGraph(lineIds) {
  const g = priors.neighbourhood(lineIds);
  const cols = { line: 0, speech: 1, speaker: 2 };
  const per = [[], [], []];
  for (const n of g.nodes) per[cols[n.kind]].push(n);
  const W = 760, rowH = 34, colX = [10, 400, 560], colW = [370, 140, 190];
  const H = Math.max(...per.map((c) => c.length)) * rowH + 16;
  const svg = sv('svg', { class: 'pg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'The priors around this answer: lines, speeches and speakers' });
  const at = new Map();
  per.forEach((list, c) => list.forEach((n, k) => at.set(n.id, { x: colX[c], y: 8 + k * rowH, w: colW[c], n })));
  for (const e of g.edges) {
    const a = at.get(e.from), b = at.get(e.to);
    if (!a || !b) continue;
    const same = a.x === b.x;
    const x1 = same ? a.x + a.w : a.x + a.w, y1 = a.y + 13, x2 = same ? b.x + b.w : b.x, y2 = b.y + 13;
    const d = same ? 'M' + x1 + ' ' + y1 + ' C' + (x1 + 30) + ' ' + y1 + ' ' + (x2 + 30) + ' ' + y2 + ' ' + x2 + ' ' + y2
      : 'M' + x1 + ' ' + y1 + ' C' + (x1 + 20) + ' ' + y1 + ' ' + (x2 - 20) + ' ' + y2 + ' ' + x2 + ' ' + y2;
    const ge = sv('g', { class: 'e' });
    ge.append(sv('path', { d }));
    const tl = sv('text', { x: (x1 + x2) / 2 + (same ? 34 : -12), y: (y1 + y2) / 2 - 3 });
    tl.textContent = e.kind;
    ge.append(tl);
    svg.append(ge);
  }
  for (const [, p] of at) {
    const gn = sv('g', { class: 'n ' + p.n.kind + (p.n.kind === 'line' ? ' on' : '') });
    gn.append(sv('rect', { x: p.x, y: p.y, width: p.w, height: 26, rx: 6 }));
    const t = sv('text', { x: p.x + 8, y: p.y + 17 });
    const label = p.n.label;
    t.textContent = label.length > (p.n.kind === 'line' ? 52 : 22) ? label.slice(0, p.n.kind === 'line' ? 51 : 21) + '…' : label;
    gn.append(t);
    const tt = sv('title', {});
    tt.textContent = label;
    gn.append(tt);
    svg.append(gn);
  }
  return svg;
}

// ---- writing with the priors beside it
const mixer = new core.Mixer(priors, report.lm.lambdas, report.lm.max);
$('w').disabled = false;
$('wgo').disabled = false;
$('write').addEventListener('submit', (e) => {
  e.preventDefault();
  const prompt = $('w').value;
  for (const c of prompt) {
    if (!vocab.has(c)) { $('written').textContent = 'The model has no character ' + JSON.stringify(c) + ': it was never in its training text.'; return; }
  }
  $('written').textContent = 'Writing...';
  $('wgo').disabled = true;
  setTimeout(() => {
    lastRun = new Float64Array(graphs.length);
    const out = mixer.write(gpt, prompt, 200);
    $('wgo').disabled = false;
    const div = $('written');
    div.textContent = prompt;
    for (const ch of out) {
      const s = document.createElement('span');
      s.textContent = ch.char;
      const k = Math.min(1, ch.matched / 24);
      s.style.background = 'rgba(' + Math.round(43 + 63 * k) + ',' + Math.round(58 + 107 * k) + ',' + Math.round(74 + 48 * k) + ',' + (ch.matched ? 0.9 : 0.35) + ')';
      s.title = ch.matched ? 'the ' + ch.matched + ' characters ending here occur ' + (ch.places === 1 ? 'once' : fmt(ch.places) + ' times') + ' in the training text, one of them at line ' + fmt(ch.line) + ': ' + lineText(ch.line) : 'no stretch ending here is in the training text';
      div.append(s);
    }
    openBusiest('Mixer');
  }, 30);
});

// ---- the head-to-head, from the run's own files
(function scores() {
  const R = report;
  const pct = (x) => (100 * x).toFixed(1) + '%';
  const ci = (c) => pct(c.rate) + ' <small>(' + pct(c.lo) + ' to ' + pct(c.hi) + ')</small>';
  let html = '<p class="note">' + esc(R.summary) + '</p><div class="tablewrap"><table class="scores"><thead><tr><th>Question kind</th><th>Test questions</th><th>Plain nanoGPT</th><th>PriorGPT</th><th>Plain model\'s answer the priors backed</th></tr></thead><tbody>';
  for (const k of R.kinds) {
    html += '<tr><td>' + esc(k.label) + '</td><td class="num">' + k.n + '</td><td class="num">' + ci(k.plain) + '</td><td class="num">' + ci(k.prior) + '</td><td class="num">' + (k.confirmed === null ? 'n/a' : k.confirmed + ' of ' + k.n) + '</td></tr>';
  }
  html += '</tbody></table></div>';
  html += '<p class="note">Bits per character on held-out Shakespeare neither arm trained on (lower is better): plain model <b>' + R.lm.test.modelAlone.toFixed(4)
    + '</b>, model with its priors <b>' + R.lm.test.modelWithPriors.toFixed(4) + '</b>, over ' + fmt(R.lm.test.positions) + ' characters. '
    + esc(R.lm.note) + '</p>';
  if (R.misses.length) {
    html += '<p class="note"><b>Every PriorGPT miss on the test set (' + R.misses.length + '):</b> ' + esc(R.thresholdNote) + '</p><ul class="note">';
    for (const m of R.misses) html += '<li>' + esc(m) + '</li>';
    html += '</ul>';
  } else html += '<p class="note">PriorGPT missed no test question.</p>';
  $('report').innerHTML = html;
  $('howtext').innerHTML = R.how.map((p) => '<p>' + p + '</p>').join('');
})();

// ---- learning on the fly (UC-PG3), from the experiment's own files
(function growth() {
  const G = grewPriors;
  const W = grewWeights;
  const b4 = W.bits_before;
  const af = W.bits_after;
  $('growth').innerHTML = '<p>The held-out text was cut in two. The first half, ' + fmt(G.new_characters) + ' characters nothing had trained on, was taken in as new priors; the second half measured.</p>'
    + '<p><b>The graph</b> took it in ' + fmt(G.ms_to_take_in) + ' ms, with no training step. Asked who says <q>' + esc(G.probe_line) + '</q>, it answered ' + esc(G.before.status)
    + ' before and ' + esc(G.after.status) + ' (' + esc(G.after.value) + ') after, citing the new text. Bits per character on the second half, with the priors: '
    + G.before.bits.modelWithPriors.toFixed(4) + ' before, ' + G.after.bits.modelWithPriors.toFixed(4) + ' after.</p>'
    + '<p><b>The weights</b> were fine-tuned on it for ' + W.steps + ' steps (' + esc(W.batch) + ', replay of the old priors) in ' + W.seconds_fine_tune.toFixed(0) + ' s on ' + esc(W.gpu) + '. '
    + 'Bits per character before and after: new text ' + b4['new text'].toFixed(3) + ' to ' + af['new text'].toFixed(3) + ', old priors ' + b4['old priors'].toFixed(3) + ' to ' + af['old priors'].toFixed(3)
    + ', the held-out half ' + b4['held-out measure'].toFixed(3) + ' to ' + af['held-out measure'].toFixed(3) + '. '
    + (W.kept ? '<span class="ok">No number got worse, so the new weights were kept.</span>' : '<span class="bad">' + esc(W.why.charAt(0).toUpperCase() + W.why.slice(1)) + '.</span> Weights are replaced only when no measured number gets worse.') + '</p>';
})();

