// details.js - a page per car (UC-16), opened as details.html#car=<key>: the car's 3D model to turn, its name, the listed price with
// the day it was read (or "Price not listed"), its engine and figures as big numbers (each tile shows its source on tap), power per
// tonne DERIVED only from two READ numbers, the engine / gearbox / drive rows, the simulated lap, the reviews, owner reports and
// recalls, the common mods (only where the record has them), the clubs and forums (Alberta first), the dealer's listing, the 3D
// model's own line, and the way back to the lot.
// Every value comes from data/*.json and carries its source (READ), or says it is not published (ABSENT); nothing is typed in here.
// A data file that fails to load stops the page with the error on it: no half page. Every string from the data is escaped.
// Data: listings.json, sale_specs.json, reviews.json (cars.<key>.specs for a car with no listing: the S7), recalls.json,
// models.json, ghosts/index.json, timetrial_rules.json (the lap's format). Serves UC-16.1 to UC-16.6, UC-16.1a, UC-16.3a.
import { formatTime } from './rules.js';
import { dragyHUD } from './dragstats.js';                                // UC-21: Dragy owners' runs
import { svgIcon } from './icons.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isWeb = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
const ext = ' rel="noopener" target="_blank"';
const link = (u, text) => (isWeb(u) ? '<a href="' + esc(u) + '"' + ext + '>' + esc(text || host(u)) + '</a>' : esc(text || u));
const linkList = (urls) => urls.map((u) => (typeof u === 'string' ? link(u) : isWeb(u.url) ? '<a href="' + esc(u.url) + '"' + ext + (u.says ? ' title="' + esc(u.says) + '"' : '') + '>' + esc(host(u.url)) + '</a>' : esc(u.url))).join(' · ');
const V = (f) => (f && (f.kind === 'READ' || f.kind === 'DERIVED') ? f.value : null);   // a listing field's value, or null when ABSENT
const KINDS = new Set(['READ', 'DERIVED', 'ABSENT', 'UNRESOLVED']);   // UNRESOLVED: a source that would state it could not be read
const kcls = (k) => 'k-' + (KINDS.has(k) ? k : 'OTHER');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// a source sentence with its URLs as links and the rest escaped; a URL's trailing punctuation (and an unmatched ')') stays text
function linkify(s) {
  const str = String(s);
  let out = '', at = 0;
  for (const m of str.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    let u = m[0];
    for (;;) {
      const last = u.slice(-1);
      if ('.,;:!?\''.includes(last)) { u = u.slice(0, -1); continue; }
      if (last === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) { u = u.slice(0, -1); continue; }
      break;
    }
    out += esc(str.slice(at, m.index)) + link(u, u);
    at = m.index + u.length;
  }
  return out + esc(str.slice(at));
}

async function fetchJson(f) {
  const r = await fetch('data/' + f);
  if (!r.ok) throw new Error('data/' + f + ' did not load: HTTP ' + r.status);
  try { return await r.json(); } catch (e) { throw new Error('data/' + f + ' is not valid JSON: ' + e.message); }
}
async function loadAll() {
  const files = ['listings.json', 'sale_specs.json', 'reviews.json', 'recalls.json', 'models.json', 'ghosts/index.json', 'timetrial_rules.json', 'photos.json', 'colours.json', 'dragy.json'];
  const [LISTINGS, SALE_SPECS, REVIEWS, RECALLS, MODELS, GHOSTS, RULES, PHOTOS, COLOURS, DRAGY] = await Promise.all(files.map(fetchJson));
  // the colour: the listing's own field where it states one, else what its photos show (data/colours.json, each with its photo)
  for (const c of LISTINGS.cars) if (COLOURS.cars[c.key]) c.colour = COLOURS.cars[c.key];
  return { LISTINGS, SALE_SPECS, REVIEWS, RECALLS, MODELS, GHOSTS, RULES, PHOTOS, DRAGY };
}

// the day the listings were read, as it is written in read_at (not shifted to the visitor's time zone)
function readDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) throw new Error('data/listings.json read_at is not a date: ' + iso);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
const money = (n, cur) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: cur, minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);

// a car with no listing has no listing title: its name is the one the lot's own card gives it (app.js saleCard), which the page
// author named on seeing it in the showroom (listings.json absent[].named_by)
const UNLISTED_NAMES = { audi_s7: 'Audi S7' };

// the five factory figures as tiles: the sale_specs field that carries the READ number; a car with no listing (the S7) has rows
// in reviews.json with no field, matched by label
const FIGS = [
  { id: 'power', label: 'Power', field: 'power_kw' },
  { id: 'torque', label: 'Torque', field: 'torque_nm' },
  { id: 'zero100', label: '0-100 km/h', field: 'zero_to_100_kmh_s' },
  { id: 'top', label: 'Top speed', field: 'top_speed_kmh' },
  { id: 'weight', label: 'Weight', field: 'curb_weight_kg' },
];
const DRIVELINE = [{ id: 'engine', label: 'Engine' }, { id: 'gearbox', label: 'Gearbox', field: 'transmission' }, { id: 'drive', label: 'Drive', field: 'drivetrain' }];
const findRow = (rows, f) => rows.find((r) => f.field && r.field === f.field) || rows.find((r) => !r.field && r.label === f.label) || null;
const srcOf = (r) => (r && (r.src || r.why)) || 'no source recorded in the data';

// the car the hash names, with its figure rows; null when the lot has no such car (UC-16.1a)
function carFor(key, D) {
  const l = D.LISTINGS.cars.find((c) => c.key === key);
  if (l) {
    const sp = D.SALE_SPECS.cars[key];
    if (!sp || !Array.isArray(sp.rows)) throw new Error('data/sale_specs.json has no factory figures for ' + key + ', a car the listings name');
    const engine = l.engine ? { label: 'Engine', kind: l.engine.kind, value: l.engine.value, src: srcOf(l.engine), as: 'as listed' } : null;
    const name = V(l.display) || [V(l.year), V(l.make), V(l.model)].filter(Boolean).join(' ');
    return { key, listed: true, l, name, mark: V(l.make), sub: [V(l.trim), sp.name].filter(Boolean).join(' · '), rows: sp.rows, engine,
             rowsFrom: 'data/sale_specs.json' };
  }
  const x = (D.LISTINGS.absent || []).find((c) => c.key === key);
  if (!x) return null;
  if (!UNLISTED_NAMES[key]) throw new Error('the lot names no car ' + key + ' (listings.json absent) without a name for it');
  const rv = D.REVIEWS.cars[key];
  const rows = (rv && rv.specs) || [];
  return { key, listed: false, x, name: UNLISTED_NAMES[key], mark: UNLISTED_NAMES[key].split(' ')[0], sub: rv ? rv.car : '', rows,
           engine: findRow(rows, DRIVELINE[0]), rowsFrom: 'data/reviews.json' };
}

// ---------------------------------------------------------------- the figures
const SPLIT = /^(\d[\d,.]*)\s*([^\s(]+)?\s*(.*)$/;     // "254 kW (341 hp) at 6500 rpm" -> "254", "kW", "(341 hp) at 6500 rpm"
function tileHTML(id, label, r, i, from) {
  const kind = r ? r.kind : 'not read';
  let val, more = '';
  if (r && kind === 'READ' && r.value !== undefined && r.value !== null) {
    const m = SPLIT.exec(String(r.value));
    if (m) { val = '<b class="num">' + esc(m[1]) + '</b>' + (m[2] ? '<i class="unit">' + esc(m[2]) + '</i>' : ''); more = m[3]; }
    else val = '<b class="num long">' + esc(r.value) + '</b>';
  } else val = '<b class="num na">' + (r && kind !== 'UNRESOLVED' ? 'not published' : 'not read') + '</b>';
  const src = r ? srcOf(r) : from + ' has no row for it';
  return '<div class="tile in" style="--i:' + i + '" id="fig-' + id + '" data-fig="' + id + '" data-kind="' + esc(kind) + '" role="button" tabindex="0" aria-expanded="false">' +
    '<div class="th"><span class="lab">' + esc(label) + '</span><span class="badge ' + kcls(kind) + '">' + esc(kind) + '</span></div>' +
    '<div class="val">' + val + '</div><div class="more">' + esc(more) + '</div><div class="tap">Tap for its source</div>' +
    '<p class="src">' + linkify(src) + '</p></div>';
}

// power per tonne: DERIVED = power kW / (mass kg / 1000), only from a READ power_kw number and a READ curb_weight_kg number (UC-16.3a)
function perTonne(p, w) {
  const read = (r, field) => r && r.kind === 'READ' && r.field === field && typeof r.num === 'number' && Number.isFinite(r.num);
  if (read(p, 'power_kw') && read(w, 'curb_weight_kg') && w.num > 0) {
    const v = p.num / (w.num / 1000);
    return { ok: true, v, src: 'DERIVED: power / (weight / 1000) = ' + p.num + ' kW / (' + w.num + ' kg / 1000) = ' + v.toFixed(1) +
      ' kW per tonne, shown to one decimal. Power: ' + srcOf(p) + ' Weight: ' + srcOf(w) };
  }
  const why = !p || p.kind !== 'READ' ? 'its power is not published'
    : !w || w.kind !== 'READ' ? 'its weight is not published'
    : 'its published power ("' + p.value + '") and weight ("' + w.value + '") carry no READ kW and kg numbers';
  return { ok: false, src: 'Not derived: power per tonne is computed only from a READ power in kW and a READ weight in kg, and ' + why + '. Nothing is converted or estimated to make one.' };
}
function perTonneHTML(pt, i) {
  const val = pt.ok ? '<b class="num">' + esc(pt.v.toFixed(1)) + '</b><i class="unit">kW/t</i>' : '<b class="num na">not derived</b>';
  return '<div class="tile der in" style="--i:' + i + '" id="fig-ptonne" data-fig="ptonne" data-kind="' + (pt.ok ? 'DERIVED' : 'not derived') + '" role="button" tabindex="0" aria-expanded="false">' +
    '<div class="th"><span class="lab">Power per tonne</span><span class="badge ' + (pt.ok ? 'k-DERIVED' : 'k-OTHER') + '">' + (pt.ok ? 'DERIVED' : 'none') + '</span></div>' +
    '<div class="val">' + val + '</div><div class="more">' + (pt.ok ? 'power kW / (weight kg / 1000)' : 'needs READ kW and kg') + '</div><div class="tap">Tap for its formula</div>' +
    '<p class="src">' + linkify(pt.src) + '</p></div>';
}

// one row: its label, its value (READ) or why not (ABSENT), its badge; the badge opens the source under it
function rowHTML(label, r, fmt, naText) {
  const kind = r ? r.kind : 'not read';
  const ok = r && (kind === 'READ' || kind === 'DERIVED') && r.value !== undefined && r.value !== null;
  const v = ok ? esc(fmt ? fmt(r.value) : r.value) + (r.as ? ' <span class="dim">(' + esc(r.as) + ')</span>' : '') : esc(kind === 'UNRESOLVED' ? 'not read' : naText || 'not published');
  return '<div class="row"><span class="lab">' + esc(label) + '</span><span class="v' + (ok ? '' : ' na') + '">' + v + '</span>' +
    '<button class="badge ' + kcls(kind) + '" aria-expanded="false" title="Where this came from">' + esc(kind) + '</button>' +
    '<p class="src" hidden>' + linkify(r ? srcOf(r) : 'no row for it in the data') + '</p></div>';
}

function lapHTML(key, D) {
  const g = D.GHOSTS.ghosts.find((x) => x.car === key);
  if (!g) return '<div class="lap"><p class="kick">Simulated lap</p><span class="t na">no lap</span><p>The lot\'s Time Trial has no simulated lap for this car (data/ghosts/index.json).</p></div>';
  if (typeof g.lap !== 'number' || !Number.isFinite(g.lap)) throw new Error('data/ghosts/index.json: the lap of ' + key + ' is not a number');
  const sports = D.GHOSTS.ghosts.find((x) => x.car === 'SportsCar');
  return '<div class="lap"><p class="kick">Simulated lap</p><span class="t">' + esc(formatTime(g.lap, D.RULES)) + '</span>' +
    '<p>A simulated Time Trial lap: its own weight, power, torque, gears and drag, on the template\'s tyres, the page\'s driver.</p>' +
    (sports && typeof sports.lap === 'number' ? '<p class="ref">Template Sports Car on the same lap: ' + esc(formatTime(sports.lap, D.RULES)) + '</p>' : '') + '</div>';
}

// ---------------------------------------------------------------- reviews, owner reports, recalls
function reviewsHTML(rv, rc, D) {
  let left, right;
  if (!rv) {
    left = '<div class="card"><h3>Review</h3><p class="norate">No review record for this car (data/reviews.json).</p></div>';
    right = '';
  } else {
    const ratings = rv.ratings && rv.ratings.length
      ? '<div class="ratings">' + rv.ratings.map((r) => (isWeb(r.url) ? '<a class="rate" href="' + esc(r.url) + '"' + ext + ' title="' + esc(r.rates || '') + '">' : '<div class="rate">') +
          '<b>' + esc(r.value) + '</b><span>' + esc(r.by) + ' ↗</span>' + (isWeb(r.url) ? '</a>' : '</div>')).join('') + '</div>'
      : '<p class="norate">No published rating found for this year' + (rv.ratings_absent ? ': ' + esc(rv.ratings_absent) : '.') + '</p>';
    left = '<div class="card"><h3>Ratings for this year</h3>' + ratings +
      '<div class="ai"><p class="who"><b>AI SUMMARY</b><span>Written by an AI from the linked reviews and owner reports; not the dealer\'s words.</span></p>' +
      '<p class="sum">' + esc(rv.summary) + '</p>' + (rv.quote ? '<blockquote>"' + esc(rv.quote.text) + '" ' + link(rv.quote.url) + '</blockquote>' : '') +
      '<p class="srcs">Sources: ' + linkList(rv.summary_sources || []) + '</p></div>' +
      (rv.generation ? '<p class="gen">Generation: ' + esc(rv.generation) + (rv.retrieved ? '. Read ' + esc(rv.retrieved) + '.' : '') + '</p>' : '') + '</div>';
    right = '<div class="card"><h3>What owners report' + (rv.issues.length ? ' · ' + rv.issues.length : '') + '</h3>' +
      (rv.issues.length ? '<ul class="issues">' + rv.issues.map((i) => '<li><p>' + esc(i.issue) + '</p><p class="srcs">' + esc(i.years) + ' · ' +
        i.sources.length + (i.sources.length === 1 ? ' source: ' : ' sources: ') + linkList(i.sources) + '</p></li>').join('') + '</ul>'
        : '<p class="norate">No owner-reported issue in the record.</p>') + '</div>';
  }
  return '<div class="duo even">' + left + right + '</div>' + recallsHTML(rc, D);
}

function recallsHTML(rc, D) {
  if (!rc) return '<div class="card recalls"><h3>Recalls</h3><p class="norate">No recall record for this car (data/recalls.json).</p></div>';
  if (rc.kind !== 'READ') return '<div class="card recalls"><h3>Recalls</h3><p class="norate">Not found: ' + esc(rc.why || 'no reason recorded') + '</p>' +
    (rc.site ? '<p class="srcs">' + link(rc.site, 'Transport Canada recalls database') + '</p>' : '') + '</div>';
  const items = rc.recalls.map((r) => '<details><summary><b>' + esc(r.system || 'Recall') + '</b>' + (r.kind ? '<span class="tag">' + esc(r.kind) + '</span>' : '') +
    '<span class="when">' + esc(r.number) + ' · ' + esc(r.date) + (r.units_affected ? ' · ' + esc(r.units_affected) + ' units' : '') + '</span></summary>' +
    '<p>' + esc(r.summary) + (r.src ? ' ' + link(r.src, 'Its record') : '') + '</p></details>').join('');
  return '<div class="card recalls"><h3>Recalls · Transport Canada</h3><div class="rchead"><b>' + esc(rc.count) + '</b><span>' + (rc.count === 1 ? 'recall' : 'recalls') +
    ' for the ' + esc(rc.year) + ' ' + esc(rc.make) + ' ' + esc(rc.model_name) + ' in Transport Canada\'s database</span></div>' +
    (rc.count ? items : '<p class="norate">None listed for the ' + esc(rc.year) + ' model year.</p>') +
    '<p class="caveat">' + esc(rc.covers) + '.</p><p class="srcs">' + link(rc.site, 'Transport Canada recalls database') +
    (D.RECALLS.read_at ? ' · read ' + esc(String(D.RECALLS.read_at).slice(0, 10)) : '') + '</p></div>';
}

// the mods owners make (UC-16.5): only where the record has them; the Ghost, the Wraith and the Bentley have none (UC-14.5a)
function modsHTML(rv) {
  return '<div class="grid2">' + rv.mods.map((m) => '<article class="card mod"><h3>' + esc(String(m.mod).replace(/[.:]\s*$/, '')) + '</h3><p>' + esc(m.why) + '</p>' +
    (m.caveat ? '<p class="mc">' + esc(m.caveat) + '</p>' : '') + '<p class="srcs">' + linkList(m.sources || []) + '</p></article>').join('') + '</div>' +
    '<p class="modnote">What owners do, from their forums and tuners; a mod can affect the warranty, emissions and insurance.</p>';
}

// clubs and forums, the Alberta chapters first (an entry whose "where" names Alberta), the rest in the record's order
function clubsHTML(rv) {
  const ab = (c) => /alberta/i.test(c.where || '');
  const list = [...rv.clubs.filter(ab), ...rv.clubs.filter((c) => !ab(c))];
  return '<div class="grid2">' + list.map((c) => {
    const inner = '<span class="ck">' + (ab(c) ? '<em>Alberta</em>' : '') + esc(c.kind || '') + (c.where && !ab(c) ? ' · ' + esc(c.where) : '') + '</span><b>' + esc(c.name) + '</b>' +
      (isWeb(c.url) ? '<span class="h">' + esc(host(c.url)) + ' ↗</span>' : '');
    return isWeb(c.url) ? '<a class="club' + (ab(c) ? ' ab' : '') + '" href="' + esc(c.url) + '"' + ext + '>' + inner + '</a>' : '<div class="club' + (ab(c) ? ' ab' : '') + '">' + inner + '</div>';
  }).join('') + '</div>';
}

// ---------------------------------------------------------------- the listing's own photos
// data/photos.json (tools/photos.py): the listing's photos in its own order, shown from the dealer's image server (hotlinked, not
// copied) and credited to the listing. A car with no entry (the S7: no listing) has no gallery.
function photosFor(key, D) {
  const p = D.PHOTOS.cars && D.PHOTOS.cars[key];
  if (!p || !Array.isArray(p.photos) || !p.photos.length) return null;
  p.photos.forEach((x, i) => {
    if (!isWeb(x.thumb) || !isWeb(x.full)) throw new Error('data/photos.json: photo ' + (i + 1) + ' of ' + key + ' has no http(s) thumb and full URL');
  });
  return p;
}
function galleryHTML(p, name) {
  const n = p.photos.length;
  return '<section class="blk photos" id="photos"><div class="sh"><div><p class="kick">From the listing</p><h2>Photos of this car</h2></div>' +
    '<p class="credit">' + (isWeb(p.listing) ? '<a href="' + esc(p.listing) + '"' + ext + '>' + esc(p.credit || p.listing) + '</a>' : esc(p.credit || '')) + '</p></div>' +
    '<div class="gallery">' + p.photos.map((x, i) => '<button class="ph' + (i === 0 ? ' lead' : '') + '" data-ph="' + i + '" aria-label="Open photo ' + (i + 1) + ' of ' + n + '">' +
      '<img src="' + esc(x.thumb) + '" loading="lazy" decoding="async" width="640" height="480" alt="' + esc(name) + ', listing photo ' + (i + 1) + ' of ' + n + '">' +
      (i === 0 ? '<span class="n">' + n + ' photos</span>' : '') + '</button>').join('') + '</div>' +
    '<p class="swipe">Swipe for more · tap a photo to see it larger</p></section>';
}

// the larger view: next / previous (buttons, arrow keys, a swipe), Esc or the backdrop to close; focus goes back to the photo
const LB = { p: null, name: '', i: 0, from: null };
function lbShow(i) {
  const n = LB.p.photos.length;
  LB.i = (i + n) % n;
  const img = $('lbimg');
  img.src = LB.p.photos[LB.i].full;
  img.alt = LB.name + ', listing photo ' + (LB.i + 1) + ' of ' + n;
  $('lbcount').textContent = (LB.i + 1) + ' / ' + n;
  [LB.i + 1, LB.i - 1].forEach((k) => { const q = new Image(); q.src = LB.p.photos[(k + n) % n].full; });   // the neighbours, so next is instant
}
function lbOpen(i, from) {
  LB.from = from || null;
  $('lbcredit').innerHTML = isWeb(LB.p.listing) ? '<a href="' + esc(LB.p.listing) + '"' + ext + '>' + esc(LB.p.credit || LB.p.listing) + '</a>' : esc(LB.p.credit || '');
  lbShow(i);
  $('lb').hidden = false; document.body.style.overflow = 'hidden';
  $('lbclose').focus();
}
function lbClose() {
  if ($('lb').hidden) return;
  $('lb').hidden = true; document.body.style.overflow = '';
  $('lbimg').removeAttribute('src');
  if (LB.from) LB.from.focus();
}
function wireLightbox() {
  $('lbclose').addEventListener('click', lbClose);
  $('lbprev').addEventListener('click', () => lbShow(LB.i - 1));
  $('lbnext').addEventListener('click', () => lbShow(LB.i + 1));
  $('lb').addEventListener('click', (e) => { if (e.target.id === 'lb' || e.target.tagName === 'FIGURE') lbClose(); });
  document.addEventListener('keydown', (e) => {
    if ($('lb').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); lbClose(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); lbShow(LB.i - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbShow(LB.i + 1); }
  });
  let x0 = null;
  $('lb').addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  $('lb').addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 45) lbShow(LB.i + (dx < 0 ? 1 : -1));
  });
}

// ---------------------------------------------------------------- the listing and the model
function listingHTML(car, D, day) {
  if (car.listed) {
    const l = car.l;
    const rows = [['Kilometres', l.km, (v) => Number(v).toLocaleString('en-CA') + ' km'], ['Engine', l.engine], ['Colour', l.colour], ['Interior', l.interior],
      ['VIN', l.vin], ['Stock', l.stock], ['Store', l.store]].filter((x) => x[1]);
    return '<div class="card"><h3>The dealer\'s listing</h3><div class="rows">' + rows.map(([lab, f, fmt]) => rowHTML(lab, f && { kind: f.kind, value: f.value, src: srcOf(f) }, fmt, 'not listed')).join('') + '</div>' +
      (isWeb(l.url) ? '<div class="ctas"><a class="cta" href="' + esc(l.url) + '"' + ext + '>' + svgIcon('link', 16) + ' See it on houseofcars.com</a></div>' : '') +
      '<p class="srcs">Listing: ' + linkify(srcOf(l.name)) + '</p></div>';
  }
  return '<div class="card"><h3>The dealer\'s listing</h3><p>houseofcars.com lists no ' + esc(car.name) + ' on ' + esc(day) + ', so this page shows no price for it.</p>' +
    (car.x.named_by ? '<p class="meta">' + esc(car.x.named_by) + '.</p>' : '') +
    (car.x.searched && car.x.searched.length ? '<p class="meta">Searched:</p><ul class="meta">' + car.x.searched.map((s) => '<li>' + linkify(s) + '</li>').join('') + '</ul>' : '') + '</div>';
}
function modelHTML(m) {
  if (!m) return '<div class="card"><h3>The 3D model</h3><p class="soon">No model yet · coming soon</p></div>';   // UC-26
  return '<div class="card" id="model3d"><h3>The 3D model</h3><p class="meta" style="color:#cfd5dc">' + linkify(m.src) + '</p>' +
    (m.length_m ? '<p class="meta">Length: ' + esc(m.length_m.value) + ' m. ' + linkify(m.length_m.src) + '</p>' : '') +
    '<p class="meta">Inside: ' + (m.interior ? 'the cabin as the model has it, from the driver&#39;s seat (' + esc(m.interior.src) + ')' : 'this model has no cabin to look into') + '.</p></div>';
}

// ---------------------------------------------------------------- the page
function render(D) {
  lbClose();
  const main = $('main');
  const hm = /^#car=([\w-]+)(&inside)?$/.exec(decodeURIComponent(location.hash));   // &inside: open in the cabin (UC-17)
  const key = hm ? hm[1] : null;
  const car = key ? carFor(key, D) : null;
  const day = readDay(D.LISTINGS.read_at);
  const lotList = '<ul>' + D.LISTINGS.cars.map((c) => '<li><a href="details.html#car=' + esc(c.key) + '">' + esc(V(c.display) || c.key) + '</a></li>').join('') +
    (D.LISTINGS.absent || []).filter((x) => UNLISTED_NAMES[x.key]).map((x) => '<li><a href="details.html#car=' + esc(x.key) + '">' + esc(UNLISTED_NAMES[x.key]) + '</a></li>').join('') + '</ul>';
  if (!car) {                                                     // UC-16.1a: a link to a car the lot no longer has
    $('topnav').innerHTML = '<a class="toplot" href="index.html">' + svgIcon('lot', 16) + ' Back to the lot</a>';
    main.innerHTML = '<section class="gone" id="gone">' + (key
      ? '<p class="kick">Car details</p><h1>That car is no longer on this lot\'s list</h1><p>The link names a car (' + esc(key) + ') that the lot does not have now. The cars on the lot today are below.</p>'
      : '<p class="kick">Car details</p><h1>Pick a car</h1><p>This page shows one car at a time.</p>') +
      '<div class="ctas"><a class="cta go" href="index.html">' + svgIcon('lot', 16) + ' Back to the lot</a></div>' + lotList + '</section>';
    document.title = (key ? 'No longer listed' : 'Car details') + ' · House of Cars 3D Lot';
    document.documentElement.dataset.state = key ? 'gone' : 'pick';
    return;
  }
  const rv = D.REVIEWS.cars[key] || null, rc = D.RECALLS.cars[key] || null, model = (D.MODELS.models[key] && !D.MODELS.models[key].withheld) ? D.MODELS.models[key] : null;   // UC-26: none, or withdrawn
  const drivable = !!model && D.GHOSTS.ghosts.some((g) => g.car === key);   // as the lot's card: a model and a simulated car
  const lot = 'index.html#car=' + encodeURIComponent(key);
  const hasMods = !!(rv && rv.mods && rv.mods.length);
  const hasClubs = !!(rv && rv.clubs && rv.clubs.length);
  const photos = photosFor(key, D);
  const f = Object.fromEntries(FIGS.map((x) => [x.id, findRow(car.rows, x)]));
  const pt = perTonne(f.power, f.weight);
  LB.p = photos; LB.name = car.name;

  // the bar: jump to a part of the page (buttons, not #anchors: the hash names the car), and back to the lot
  const jumps = [photos && ['photos', 'Photos'], ['figures', 'Figures'], ['reviews', 'Reviews'], hasMods && ['mods', 'Mods'], ['clubs', 'Clubs'], ['listing', 'Listing']].filter(Boolean);
  $('topnav').innerHTML = '<nav class="jump" aria-label="On this page">' + jumps.map(([id, t]) => '<button data-go="' + id + '">' + t + '</button>').join('') + '</nav>' +
    '<a class="toplot" href="' + esc(lot) + '">' + svgIcon('lot', 16) + ' Back to the lot</a>';

  const l = car.listed ? car.l : null;
  const priceV = l ? V(l.price) : null, cur = l ? V(l.currency) : null;
  const price = priceV !== null && typeof priceV === 'number'
    ? '<div class="price in" style="--i:3" id="price">' + esc(cur ? money(priceV, cur) : priceV.toLocaleString('en-CA') + ' (currency not listed)') + '<small>as listed on houseofcars.com, ' + esc(day) + '</small></div>'
    : '<div class="price na in" style="--i:3" id="price">Price not listed<small>' + (car.listed ? 'The listing shows no price' : 'houseofcars.com lists no ' + esc(car.name) + ' on ' + esc(day) + ', so this page shows no price for it') + '</small></div>';
  const kicker = car.listed ? 'For sale · ' + esc(V(l.city)) + (V(l.store) && V(l.store) !== V(l.city) ? ' · ' + esc(V(l.store)) : '') + ' store' : 'In the showroom · not listed online';
  const chips = car.listed ? [V(l.km) !== null ? Number(V(l.km)).toLocaleString('en-CA') + ' km' : null, V(l.colour), V(l.engine)].filter(Boolean) : [];
  const glance = [['power', 'Power'], ['zero100', '0-100 km/h'], ['top', 'Top speed']].map(([id, t]) => {
    const r = f[id], m = r && r.kind === 'READ' ? SPLIT.exec(String(r.value)) : null;
    return m ? '<button data-open="fig-' + id + '"><span class="gl">' + t + '</span><b>' + esc(m[1]) + (m[2] ? '<i>' + esc(m[2]) + '</i>' : '') + '</b></button>' : '';
  }).filter(Boolean);
  const ctas = (drivable ? '<a class="cta go" href="' + esc(lot) + '&drag">' + svgIcon('wheel', 16) + ' Drag race it</a><a class="cta" href="' + esc(lot) + '">Lap the track</a>' : '') +   // UC-23.1
    (l && isWeb(l.url) ? '<a class="cta" href="' + esc(l.url) + '"' + ext + '>' + svgIcon('link', 16) + ' See it on houseofcars.com</a>' : '') +
    '<a class="cta" href="' + esc(lot) + '">' + svgIcon('lot', 16) + ' Back to the lot</a>';

  const stage = '<div class="stage in" id="stage">' + (car.mark ? '<div class="mark" aria-hidden="true" style="--n:' + Math.max(4, String(car.mark).length) + '"><span>' + esc(car.mark) + '</span></div>' : '') +
    (model ? '<model-viewer id="mv" src="data/meshes/' + esc(model.glb) + '" alt="' + esc(car.name) + ', 3D model" camera-controls auto-rotate auto-rotate-delay="1500" rotation-per-second="12deg" ' +
      'touch-action="pan-y" shadow-intensity="1" shadow-softness="0.9" exposure="1.05" environment-image="neutral" camera-orbit="-35deg 76deg auto" interaction-prompt="none" ' +
      'ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed"><button slot="ar-button" class="arbtn">' + svgIcon('lot', 15) + ' See it in your driveway</button></model-viewer>' +
      '<div class="bar" id="mvbar"><i></i></div><p class="hint" id="mvhint">Drag to turn · pinch to zoom</p><button class="about" data-go="model3d">About this model</button>' +
      (model.interior ? '<button class="inside" id="mvinside" type="button" aria-pressed="false" disabled>' + svgIcon('wheel', 15) + ' <span>Look inside</span></button>' : '')
      : '<p class="nomodel soon">No model yet · coming soon</p>') + '</div>';   // UC-26

  main.innerHTML =
    '<section class="hero"><div class="wrap" style="padding:0">' + stage +
      '<div class="intro"><p class="kick in" style="--i:1">' + kicker + '</p><h1 class="in" style="--i:2" id="carname">' + esc(car.name) + '</h1>' +
      (car.sub ? '<p class="sub in" style="--i:2">' + esc(car.sub) + '</p>' : '') + price +
      (chips.length ? '<div class="chips in" style="--i:4">' + chips.map((c) => '<span>' + esc(c) + '</span>').join('') + '</div>' : '') +
      (glance.length ? '<div class="glance in" style="--i:5">' + glance.join('') + '</div>' : '') +
      '<div class="ctas in" style="--i:6">' + ctas + '</div></div></div></section>' +

    (photos ? galleryHTML(photos, car.name) : '') +

    '<section class="blk" id="figures"><div class="sh"><p class="kick">Performance</p><h2>Engine and figures</h2>' +
      '<p class="note">Factory figures for this model, each from a named source: tap a tile to see where it came from.</p></div>' +
      '<div class="tiles">' + FIGS.map((x, i) => tileHTML(x.id, x.label, f[x.id], i, car.rowsFrom)).join('') + perTonneHTML(pt, FIGS.length) + '</div></section>' +

    (D.DRAGY.cars[key] ? '<section class="blk" id="dragstrip"><div class="sh"><p class="kick">On the drag strip</p><h2>What owners run</h2>' +
      '<p class="note">Dragy users&#39; own GPS runs of this car, from Dragy&#39;s public leaderboard.</p></div>' + dragyHUD(key, D.DRAGY, 'page') + '</section>' : '') +   // UC-21

    '<section class="blk" id="driveline"><div class="duo"><div><div class="sh"><p class="kick">Driveline</p><h2>Engine, gearbox and drive</h2></div><div class="rows">' +
      rowHTML('Engine', car.engine) + DRIVELINE.slice(1).map((x) => rowHTML(x.label, findRow(car.rows, x))).join('') + '</div>' + moreRowsHTML(car) + '</div>' +
      '<div><div class="sh"><p class="kick">On the lot\'s track</p><h2>Time Trial</h2></div>' + lapHTML(key, D) + '</div></div></section>' +

    '<section class="blk" id="reviews"><div class="sh"><p class="kick">What people say</p><h2>Reviews</h2>' +
      (rv ? '<p class="note">' + esc(rv.car) + '</p>' : '') + '</div>' + reviewsHTML(rv, rc, D) + '</section>' +

    (hasMods ? '<section class="blk" id="mods"><div class="sh"><p class="kick">What owners do</p><h2>Common mods</h2></div>' + modsHTML(rv) + '</section>' : '') +

    '<section class="blk" id="clubs"><div class="sh"><p class="kick">Where owners meet</p><h2>Clubs and forums</h2>' +
      '<p class="note">Alberta chapters first. Each opens in a new tab.</p></div>' +
      (hasClubs ? clubsHTML(rv) : '<p class="norate">No clubs or forums recorded for this car.</p>') + '</section>' +

    '<section class="blk" id="listing"><div class="duo even">' + listingHTML(car, D, day) + modelHTML(model) + '</div></section>' +

    '<div class="endcta"><h2>' + esc(car.name) + '</h2><div class="ctas">' + ctas + '</div></div>';

  document.title = car.name + ' · House of Cars 3D Lot (concept)';
  wire(main);
  if (model) startModel(model, !!(hm && hm[2]));
  document.documentElement.dataset.state = 'ready';
  document.documentElement.dataset.car = key;
}

// the rows the tiles and the driveline do not show (the length; for the S7 its 0-60 mph and its MSRP), each with its source
function moreRowsHTML(car) {
  const used = new Set([...FIGS, ...DRIVELINE].map((x) => findRow(car.rows, x)).filter(Boolean));
  const rest = car.rows.filter((r) => !used.has(r));
  return rest.length ? '<p class="rowshead">More figures</p><div class="rows">' + rest.map((r) => rowHTML(r.label, r)).join('') + '</div>' : '';
}

function go(id) {
  const el = $(id);
  if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  return el;
}
function toggleTile(t, open) {
  const on = open === undefined ? !t.classList.contains('open') : open;
  t.classList.toggle('open', on); t.setAttribute('aria-expanded', String(on));
}
function wire(root) {
  root.querySelectorAll('.tile').forEach((t) => {
    t.addEventListener('click', (e) => { if (e.target.closest('a')) return; toggleTile(t); });
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTile(t); } });
  });
  root.querySelectorAll('.row .badge').forEach((b) => b.addEventListener('click', () => {
    const p = b.parentElement.querySelector('.src'); p.hidden = !p.hidden; b.setAttribute('aria-expanded', String(!p.hidden));
  }));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { const t = go(b.dataset.open); if (t) toggleTile(t, true); }));
  root.querySelectorAll('button[data-ph]').forEach((b) => b.addEventListener('click', () => lbOpen(+b.dataset.ph, b)));
}

// the 3D model: model-viewer from the importmap (as the lot's AR view); its progress, its arrival, or its error on the stage
async function startModel(model, inside) {
  const mv = $('mv'), bar = $('mvbar'), st = $('stage');
  // a wide stage (a desktop) frames the car a little closer than model-viewer's auto radius, which fits it at every angle; a tall
  // one (a phone) keeps auto, or the long side of the car would leave the frame as it turns
  if (st.clientWidth / st.clientHeight >= 1.2) mv.setAttribute('camera-orbit', '-35deg 76deg 88%');
  mv.addEventListener('progress', (e) => { bar.firstChild.style.width = (100 * e.detail.totalProgress).toFixed(0) + '%'; if (e.detail.totalProgress >= 1) bar.classList.add('done'); });
  mv.addEventListener('load', () => { mv.classList.add('on'); bar.classList.add('done'); });
  mv.addEventListener('error', (e) => {
    $('stage').insertAdjacentHTML('beforeend', '<p class="mverr">The 3D model did not load: ' + esc((e.detail && e.detail.type) || 'error') + ' (' + esc(mv.getAttribute('src')) + ')</p>');
  });
  try {
    if (!customElements.get('model-viewer')) await import('model-viewer');
  } catch (e) {
    $('stage').insertAdjacentHTML('beforeend', '<p class="mverr">The 3D viewer (model-viewer) did not load: ' + esc(e.message) + '</p>');
    throw e;
  }
  if (mv.loaded) mv.classList.add('on');
  if (model.interior) wireInside(mv, model.interior, inside);
}
// UC-17 look inside: model-viewer's camera moved to the driver's eye (models.json interior: behind the model's own steering wheel)
// on an orbit of 2 cm, so a drag turns the head round the cabin; out again, the stage's own framing comes back
function wireInside(mv, cabin, start) {
  const btn = $('mvinside'), outside = { orbit: mv.getAttribute('camera-orbit'), fov: mv.getAttribute('field-of-view') || 'auto' };
  const set = (on) => {
    btn.setAttribute('aria-pressed', String(on)); btn.querySelector('span').textContent = on ? 'Back outside' : 'Look inside';
    $('mvhint').textContent = on ? 'Drag to look round the cabin' : 'Drag to turn · pinch to zoom';
    $('stage').classList.toggle('cabin', on);
    if (on) {
      mv.autoRotate = false;
      mv.setAttribute('min-camera-orbit', 'auto 20deg 0.01m'); mv.setAttribute('max-camera-orbit', 'auto 160deg 0.05m');
      mv.setAttribute('max-field-of-view', '80deg');      // model-viewer's own cap (about 45 deg) would zoom the cabin in to the wheel
      mv.cameraTarget = cabin.eye_m.map((x) => x + 'm').join(' ');
      mv.fieldOfView = '70deg'; mv.cameraOrbit = '-90deg 86deg 0.02m';
    } else {
      mv.removeAttribute('min-camera-orbit'); mv.removeAttribute('max-camera-orbit'); mv.removeAttribute('max-field-of-view');
      mv.cameraTarget = 'auto auto auto'; mv.fieldOfView = outside.fov; mv.cameraOrbit = outside.orbit || '-35deg 76deg auto';
    }
    mv.jumpCameraToGoal && !on && mv.jumpCameraToGoal();
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-pressed') !== 'true'));
  btn.disabled = false;                                 // drawn disabled: a click before model-viewer is here would do nothing
  if (start) { const go = () => set(true); if (mv.loaded) go(); else mv.addEventListener('load', go, { once: true }); }
}

function showError(e) {
  $('topnav').innerHTML = '<a class="toplot" href="index.html">Back to the lot</a>';
  $('main').innerHTML = '<section class="err" id="err"><p class="kick">This page could not load</p><h1>The car\'s details are not shown</h1>' +
    '<p><code>' + esc(e && e.message ? e.message : e) + '</code></p><p>Nothing is shown rather than half a page. <a href="index.html">Back to the lot</a></p></section>';
  document.documentElement.dataset.state = 'error';
}

let D;
wireLightbox();
try { D = await loadAll(); render(D); } catch (e) { showError(e); throw e; }
window.addEventListener('hashchange', () => {
  try { render(D); window.scrollTo(0, 0); } catch (e) { showError(e); throw e; }
});
