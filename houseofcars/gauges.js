// gauges.js - UC-36 each car's own instrument cluster as the strip's HUD: its dials in their places, its scales, its look, drawn
// by the page in SVG (no copied artwork, no badges). Pure string building plus one update per frame; node tests the geometry.
// The cluster's FACTS (which dials, their scales, the redline, colours) are READ in data/clusters.json, each with its source; the
// DRAWING is AUTHORED, the page's own: the sweep of the needles, the layers that make a flat SVG read as a real instrument (a
// metal bezel, a recessed face, a glass highlight, a shaded needle with a shadow, numerals lit from behind), and where the cluster
// sits on the screen.
//   dial kinds: round (a needle; `half` top|bottom for two scales in one bezel, `bezel: false` for the second of them), ring (a
//   screen's filled arc, the i8's), bar (a screen's segmented bar), screen (a lit panel for readouts); deco: drawn shapes
//   (the i8's road, the AMG's side panels, the Wraith's horseshoe)

const NS = 'http://www.w3.org/2000/svg';
const f1 = (x) => (Math.round(x * 10) / 10).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** where a value sits along a dial, 0..1: linear from `from` to `to`, or, with `marks`, equal steps between marks (a non-linear
 *  scale, as the Bentley's speedometer: 20s to 100, then 30s) */
export function dialU(d, value) {
  if (d.marks) {
    const m = d.marks, v = Math.max(m[0], Math.min(m[m.length - 1], value));
    let i = 0; while (i < m.length - 2 && v > m[i + 1]) i++;
    return (i + (v - m[i]) / (m[i + 1] - m[i])) / (m.length - 1);
  }
  return Math.max(0, Math.min(1, (value - d.from) / (d.to - d.from)));
}
/** a dial's needle angle (degrees, 0 = up, clockwise) for a value on its scale; clamped to the scale's ends */
export const needleDeg = (d, value) => d.sweep[0] + (d.sweep[1] - d.sweep[0]) * dialU(d, value);
/** the values a dial prints: its `labels`, else its marks, else from, from + step, .. to */
export function majors(d) {
  if (d.labels) return d.labels.map((l) => (typeof l === 'object' ? l.v : l));
  if (d.marks) return d.marks.slice();
  const out = [], n = Math.round((d.to - d.from) / d.step);
  for (let i = 0; i <= n; i++) out.push(d.from + i * d.step);
  return out;
}
const labelText = (d, i, v) => { const l = d.labels && d.labels[i]; return l && typeof l === 'object' ? l.t : (d.div ? v / d.div : v); };
/** UC-36.2 a Rolls-Royce's Power Reserve: the share of the engine's power still unused, 1 at rest, 0 at full power at the speed it
 *  makes the most. torqueNm the engine's output now, omega its speed (rad/s), pmax its most power (W) over its rpm range */
export const powerReserve = (torqueNm, omega, pmax) => Math.max(0, Math.min(1, 1 - (torqueNm * omega) / pmax));

const pol = (cx, cy, r, deg) => { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = pol(cx, cy, r, a0), [x1, y1] = pol(cx, cy, r, a1);
  return 'M' + f1(x0) + ' ' + f1(y0) + 'A' + f1(r) + ' ' + f1(r) + ' 0 ' + (Math.abs(a1 - a0) > 180 ? 1 : 0) + ' ' + (a1 > a0 ? 1 : 0) + ' ' + f1(x1) + ' ' + f1(y1);
}

/** the shared defs for a look: gradients and filters each dial refers to by id (prefixed, so two clusters never clash) */
function defs(p, L) {
  return '<defs>' +
    '<linearGradient id="' + p + 'bz" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + L.bezel_hi + '"/><stop offset=".42" stop-color="' + L.bezel_mid + '"/><stop offset=".58" stop-color="' + L.bezel_lo + '"/><stop offset="1" stop-color="' + L.bezel_hi + '"/></linearGradient>' +
    '<radialGradient id="' + p + 'fc" cx=".5" cy=".4" r=".65"><stop offset="0" stop-color="' + L.face_hi + '"/><stop offset="1" stop-color="' + L.face + '"/></radialGradient>' +
    '<radialGradient id="' + p + 'rim" cx=".5" cy=".5" r=".5"><stop offset=".82" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="' + (L.rim_shadow ?? 0.75) + '"/></radialGradient>' +
    '<linearGradient id="' + p + 'gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".55" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="' + p + 'nd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + L.needle_lo + '"/><stop offset=".5" stop-color="' + L.needle + '"/><stop offset="1" stop-color="' + L.needle_lo + '"/></linearGradient>' +
    '<radialGradient id="' + p + 'cap" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="' + L.cap_mid + '"/><stop offset="1" stop-color="' + L.cap_lo + '"/></radialGradient>' +
    '<filter id="' + p + 'sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="1.5" dy="3" stdDeviation="2" flood-color="#000" flood-opacity=".65"/></filter>' +
    '<filter id="' + p + 'lit" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="' + (L.glow ?? 1.2) + '" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '</defs>';
}

function roundDial(p, L, d) {
  const { x: cx, y: cy, r } = d, ri = r * (1 - (d.bezel_w ?? 0.1)), red = (v) => d.red_from !== undefined && d.red_from !== null && v >= d.red_from - 1e-9;
  let s = '<g class="dial" data-id="' + d.id + '">' + (d.title ? '<title>' + esc(d.title) + '</title>' : '');
  if (d.bezel !== false) {
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + f1(r) + '" fill="url(#' + p + 'bz)" filter="url(#' + p + 'sh)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + f1(ri) + '" fill="url(#' + p + 'fc)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + f1(ri) + '" fill="url(#' + p + 'rim)"/>';
  }
  if (d.red_from !== undefined && d.red_from !== null) s += '<path d="' + arc(cx, cy, ri * 0.9, needleDeg(d, d.red_from), d.sweep[1]) + '" fill="none" stroke="' + L.red + '" stroke-width="' + f1(ri * 0.08) + '" opacity=".9"/>';
  // ticks: every minor step (or between marks), the printed ones long
  const ticks = [];
  if (d.marks) { for (let i = 0; i < d.marks.length; i++) { ticks.push([d.marks[i], true]); if (i < d.marks.length - 1) ticks.push([(d.marks[i] + d.marks[i + 1]) / 2, false]); } }
  else { const minor = d.minor || d.step / 2; for (let i = 0, v = d.from; v <= d.to + 1e-9 && i < 500; v = d.from + (++i) * minor) ticks.push([v, Math.abs((v - d.from) / d.step - Math.round((v - d.from) / d.step)) < 1e-6]); }
  for (const [v, major] of ticks) {
    const a = needleDeg(d, v), [x0, y0] = pol(cx, cy, ri * (major ? 0.79 : 0.85), a), [x1, y1] = pol(cx, cy, ri * 0.93, a);
    s += '<line x1="' + f1(x0) + '" y1="' + f1(y0) + '" x2="' + f1(x1) + '" y2="' + f1(y1) + '" stroke="' + (red(v) ? L.red : L.tick) + '" stroke-width="' + f1(major ? ri * 0.026 : ri * 0.012) + '" stroke-linecap="round"/>';
  }
  majors(d).forEach((v, i) => {
    const [x, y] = pol(cx, cy, ri * (d.num_r || 0.63), needleDeg(d, v));
    s += '<text x="' + f1(x) + '" y="' + f1(y + ri * (d.num_size || 0.15) * 0.36) + '" class="num" fill="' + (red(v) ? L.red : L.numerals) + '" font-size="' + f1(ri * (d.num_size || 0.15)) + '" font-weight="' + (L.num_weight || 600) + '" filter="url(#' + p + 'lit)">' + esc(labelText(d, i, v)) + '</text>';
  });
  if (d.label) s += '<text x="' + cx + '" y="' + f1(cy + ri * (d.label_y ?? 0.4)) + '" class="lab" fill="' + L.label + '" font-size="' + f1(ri * (d.label_size || 0.085)) + '">' + esc(d.label) + '</text>';
  if (d.unit) s += '<text x="' + cx + '" y="' + f1(cy + ri * (d.unit_y ?? -0.3)) + '" class="lab" fill="' + L.label + '" font-size="' + f1(ri * 0.075) + '">' + esc(d.unit) + '</text>';
  const nl = ri * (d.needle_len || 0.86), nw = ri * (d.needle_w || 0.045), tail = ri * 0.14;
  const body = 'M' + f1(cx - nw) + ' ' + f1(cy + tail) + 'L' + f1(cx - nw * 0.3) + ' ' + f1(cy - nl) + 'L' + f1(cx + nw * 0.3) + ' ' + f1(cy - nl) + 'L' + f1(cx + nw) + ' ' + f1(cy + tail) + 'Z';
  s += '<g class="needle" data-needle="' + d.id + '" transform="rotate(' + f1(needleDeg(d, d.rest ?? (d.marks ? d.marks[0] : d.from))) + ' ' + cx + ' ' + cy + ')" filter="url(#' + p + 'sh)"><path d="' + body + '" fill="url(#' + p + 'nd)"/>';
  if (L.needle_tip) { const t0 = cy - nl * 0.68; s += '<path d="M' + f1(cx - nw * 0.52) + ' ' + f1(t0) + 'L' + f1(cx - nw * 0.3) + ' ' + f1(cy - nl) + 'L' + f1(cx + nw * 0.3) + ' ' + f1(cy - nl) + 'L' + f1(cx + nw * 0.52) + ' ' + f1(t0) + 'Z" fill="' + L.needle_tip + '"/>'; }
  if (L.needle_glow) s += '<path d="' + body + '" fill="' + L.needle + '" opacity=".55" filter="url(#' + p + 'lit)"/>';
  s += '</g>';
  if (d.cap !== false) s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + f1(ri * (d.cap_r || 0.085)) + '" fill="url(#' + p + 'cap)" filter="url(#' + p + 'sh)"/>';
  if (d.bezel !== false) s += '<path d="M' + f1(cx - ri * 0.92) + ' ' + cy + 'A' + f1(ri * 0.92) + ' ' + f1(ri * 0.92) + ' 0 0 1 ' + f1(cx + ri * 0.92) + ' ' + cy + 'Q' + cx + ' ' + f1(cy - ri * 0.28) + ' ' + f1(cx - ri * 0.92) + ' ' + cy + 'Z" fill="url(#' + p + 'gl)"/>';
  return s + '</g>';
}

/** a screen's filled arc (the i8's rings: no needle, a lit arc and a thin white line at the value) */
function ringDial(p, L, d) {
  const { x: cx, y: cy, r } = d, w = r * (d.ring_w || 0.12);
  let s = '<g class="ring" data-id="' + d.id + '">' + (d.title ? '<title>' + esc(d.title) + '</title>' : '') +
    '<path d="' + arc(cx, cy, r, d.sweep[0], d.sweep[1]) + '" fill="none" stroke="' + L.track + '" stroke-width="' + f1(w) + '"/>' +
    '<path class="fill" data-fill="' + d.id + '" d="' + arc(cx, cy, r, d.sweep[0], d.sweep[1]) + '" pathLength="1000" stroke-dasharray="0 1000" fill="none" stroke="' + (d.color || L.needle) + '" stroke-width="' + f1(w) + '" filter="url(#' + p + 'lit)"/>';
  if (d.red_from !== undefined && d.red_from !== null) s += '<path d="' + arc(cx, cy, r + w * 0.85, needleDeg(d, d.red_from), d.sweep[1]) + '" fill="none" stroke="' + L.red + '" stroke-width="' + f1(w * 0.35) + '"/>';
  majors(d).forEach((v, i) => { const [x, y] = pol(cx, cy, r - w * 1.6, needleDeg(d, v)); s += '<text x="' + f1(x) + '" y="' + f1(y + r * 0.035) + '" class="num" fill="' + L.numerals + '" font-size="' + f1(r * (d.num_size || 0.1)) + '" font-weight="' + (L.num_weight || 300) + '">' + esc(labelText(d, i, v)) + '</text>'; });
  s += '<line class="mark" data-mark="' + d.id + '" x1="' + cx + '" y1="' + f1(cy - r - w * 0.7) + '" x2="' + cx + '" y2="' + f1(cy - r + w * 0.7) + '" stroke="#fff" stroke-width="' + f1(Math.max(1.5, w * 0.12)) + '" transform="rotate(' + f1(d.sweep[0]) + ' ' + cx + ' ' + cy + ')"/>';
  if (d.unit) s += '<text x="' + cx + '" y="' + f1(cy + r * 0.48) + '" class="lab" fill="' + L.label + '" font-size="' + f1(r * 0.075) + '">' + esc(d.unit) + '</text>';
  return s + '</g>';
}

/** a screen's segmented bar (a fuel or a battery bar, a rev bar): segments lit to the value */
function barDial(p, L, d) {
  const n = d.segments || 24, w = d.w / n;
  let s = '<g class="bar" data-id="' + d.id + '">' + (d.title ? '<title>' + esc(d.title) + '</title>' : '');
  for (let i = 0; i < n; i++) {
    const v = d.from + (d.to - d.from) * (i + 0.5) / n, red = d.red_from !== undefined && d.red_from !== null && v >= d.red_from;
    s += '<rect class="seg" data-seg="' + i + '" x="' + f1(d.x + i * w + w * 0.14) + '" y="' + d.y + '" width="' + f1(w * 0.72) + '" height="' + d.h + '" rx="1" fill="' + (red ? L.red : (d.color || L.needle)) + '" opacity=".16"/>';
  }
  if (d.label) s += '<text x="' + f1(d.x - 8) + '" y="' + f1(d.y + d.h * 0.8) + '" class="lab" text-anchor="end" fill="' + L.label + '" font-size="' + f1(d.h * 1.1) + '">' + esc(d.label) + '</text>';
  return s + '</g>';
}

/** a lit panel: a screen's face (the 911's TFT, the Bentley's centre screen) */
const screen = (p, L, d) => d.round
  ? '<circle cx="' + d.x + '" cy="' + d.y + '" r="' + d.r + '" fill="url(#' + p + 'bz)" filter="url(#' + p + 'sh)"/><circle cx="' + d.x + '" cy="' + d.y + '" r="' + f1(d.r * 0.9) + '" fill="' + (d.fill || L.screen) + '"/>'
  : '<rect x="' + d.x + '" y="' + d.y + '" width="' + d.w + '" height="' + d.h + '" rx="' + (d.rx ?? 10) + '" fill="' + (d.fill || L.screen) + '" stroke="' + (d.stroke || 'none') + '"/>';

/** the cluster as one SVG: spec from data/clusters.json (READ facts, AUTHORED drawing) */
export function clusterSVG(spec, prefix = 'g') {
  const p = prefix + '-', L = spec.look;
  let s = '<svg xmlns="' + NS + '" viewBox="0 0 ' + spec.w + ' ' + spec.h + '" class="cluster" font-family="' + esc(L.font) + '" text-anchor="middle">' + defs(p, L);
  for (const g of spec.deco || []) s += '<path d="' + g.d + '" fill="' + (g.fill || 'none') + '" stroke="' + (g.stroke || 'none') + '" stroke-width="' + (g.sw || 1) + '" opacity="' + (g.opacity ?? 1) + '"/>';
  for (const d of spec.dials) s += d.kind === 'bar' ? barDial(p, L, d) : d.kind === 'ring' ? ringDial(p, L, d) : d.kind === 'screen' ? screen(p, L, d) : roundDial(p, L, d);
  for (const t of spec.texts || []) s += '<text x="' + t.x + '" y="' + t.y + '" class="' + (t.cls || 'read') + '" data-read="' + t.id + '" fill="' + (t.fill || L.numerals) + '" font-size="' + t.size + '" font-weight="' + (t.weight || 700) + '"' + (t.anchor ? ' text-anchor="' + t.anchor + '"' : '') + (t.glow ? ' filter="url(#' + p + 'lit)"' : '') + '>' + esc(t.text || '') + '</text>';
  return s + '</svg>';
}

/** the cluster's live parts, found once; update(state) turns the needles, fills the rings and bars, writes the readouts.
 *  state: { [dial id]: value, ['text:' + text id]: string } */
export function bindCluster(root, spec) {
  const needles = [], rings = [], bars = [], reads = {};
  for (const d of spec.dials) {
    if (d.kind === 'bar') bars.push({ d, segs: [...root.querySelectorAll('[data-id="' + d.id + '"] .seg')] });
    else if (d.kind === 'ring') rings.push({ d, fill: root.querySelector('[data-fill="' + d.id + '"]'), mark: root.querySelector('[data-mark="' + d.id + '"]') });
    else if (d.kind !== 'screen') needles.push({ d, el: root.querySelector('[data-needle="' + d.id + '"]') });
  }
  for (const el of root.querySelectorAll('[data-read]')) reads[el.dataset.read] = el;
  const api = {
    update(state) {
      for (const n of needles) { const v = state[n.d.id]; if (v !== undefined && n.el) n.el.setAttribute('transform', 'rotate(' + f1(needleDeg(n.d, v)) + ' ' + n.d.x + ' ' + n.d.y + ')'); }
      for (const g of rings) { const v = state[g.d.id]; if (v === undefined) continue; g.fill.setAttribute('stroke-dasharray', Math.round(1000 * dialU(g.d, v)) + ' 1000'); g.mark.setAttribute('transform', 'rotate(' + f1(needleDeg(g.d, v)) + ' ' + g.d.x + ' ' + g.d.y + ')'); }
      for (const b of bars) { const v = state[b.d.id]; if (v === undefined) continue; const lit = Math.round(b.segs.length * dialU(b.d, v)); b.segs.forEach((el, i) => el.setAttribute('opacity', i < lit ? '1' : '.16')); }
      for (const k in reads) { const t = state['text:' + k]; if (t !== undefined && reads[k].textContent !== t) reads[k].textContent = t; }
    },
  };
  const rest = {}; for (const d of spec.dials) if (d.rest !== undefined) rest[d.id] = d.rest;   // the dials the sim does not drive, where they rest
  api.update(rest);
  return api;
}
