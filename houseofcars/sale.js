// sale.js - the lot as a salesperson's tool (UC-11): what each car for sale leads the lot in, and the side-by-side compare with its
// price-vs-pace chart. Every claim is DERIVED from READ numbers (data/listings.json, data/sale_specs.json) or the simulated laps
// (data/ghosts, tools/sim_ghost.mjs); a row with an ABSENT value names no winner (UC-11.2a). Pure: it returns HTML strings.
// Serves UC-11.2, UC-11.3.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// the rows the lot is compared on: where the number lives, and which way is better
export const ROWS = [
  { label: 'Price', get: (c) => c.price, better: 'low', fmt: (v, c) => c.money(v), lead: 'Lowest price' },
  { label: 'Kilometres', get: (c) => c.km, better: 'low', fmt: (v) => v.toLocaleString('en-CA') + ' km', lead: 'Lowest km' },
  { label: 'Power', spec: 'power_kw', better: 'high', lead: 'Most powerful' },
  { label: 'Torque', spec: 'torque_nm', better: 'high', lead: 'Most torque' },
  { label: 'Weight', spec: 'curb_weight_kg', better: 'low', lead: 'Lightest' },
  { label: '0-100 km/h', spec: 'zero_to_100_kmh_s', better: 'low', lead: 'Quickest to 100' },
  { label: 'Top speed', spec: 'top_speed_kmh', better: 'high', lead: 'Fastest top speed' },
  { label: 'Drive', spec: 'drivetrain', short: true },
  { label: 'Simulated lap', get: (c) => c.lap, better: 'low', fmt: (v, c) => c.time(v), lead: 'Fastest lap on the lot' },
];

// one entry per car for sale: its numbers, READ or null, and how to format them
export function lotCars(LISTINGS, SALE_SPECS, GHOSTS, fmt) {
  const V = (f) => (f && (f.kind === 'READ' || f.kind === 'DERIVED') ? f.value : null);
  return LISTINGS.cars.map((l) => {
    const sp = (SALE_SPECS.cars[l.key] || {}).rows || [];
    const g = GHOSTS.ghosts.find((x) => x.car === l.key);
    return { key: l.key, title: V(l.display), price: V(l.price), km: V(l.km), lap: g ? g.lap : null, rows: sp,
             spec: (field) => sp.find((r) => r.field === field) || null, money: fmt.money, time: fmt.time };
  });
}

function cell(c, row) {
  if (row.spec) {
    const r = c.spec(row.spec);
    const t = r && r.kind === 'READ' ? r.value.replace(/ \(.*converted\)$/, '') : null;
    return t !== null ? { text: row.short ? t.split(/[ :(]/)[0] : t, num: typeof r.num === 'number' ? r.num : null, src: (row.short ? t + ' | ' : '') + r.src }
      : { text: 'not published', num: null, src: r ? r.src : 'not in research/specs.json' };
  }
  const v = row.get(c);
  return v === null || v === undefined ? { text: 'not listed', num: null } : { text: row.fmt(v, c), num: v };
}

// who leads each row: only when every car in the comparison has a READ number for it (UC-11.2a), and no tie at the top
function leaders(cars) {
  const out = {};
  ROWS.forEach((row, i) => {
    if (!row.better) return;
    const vals = cars.map((c) => cell(c, row).num);
    if (vals.some((v) => v === null)) return;
    const best = row.better === 'high' ? Math.max(...vals) : Math.min(...vals);
    const at = vals.map((v, k) => (v === best ? k : -1)).filter((k) => k >= 0);
    if (at.length === 1) out[i] = at[0];
  });
  return out;
}

// what a car leads the whole lot in (UC-11.3): the rows with a `lead` phrase that it wins outright
export function leadsFor(key, cars) {
  const L = leaders(cars), k = cars.findIndex((c) => c.key === key);
  return ROWS.map((row, i) => (row.lead && L[i] === k ? row.lead : null)).filter(Boolean);
}

export function compareHTML(cars, focusKey) {
  const L = leaders(cars);
  let h = '<div class="cmpwrap"><table class="cmp"><thead><tr><th></th>' + cars.map((c) => '<th class="' + (c.key === focusKey ? 'focus' : '') + '">' + esc(c.title) + '</th>').join('') + '</tr></thead><tbody>';
  ROWS.forEach((row, i) => {
    h += '<tr><th>' + esc(row.label) + '</th>' + cars.map((c, k) => {
      const v = cell(c, row);
      return '<td class="' + (L[i] === k ? 'win' : '') + (v.num === null && row.better ? ' na' : '') + (c.key === focusKey ? ' focus' : '') + '"' + (v.src ? ' title="' + esc(v.src) + '"' : '') + '>' + esc(v.text) + '</td>';
    }).join('') + '</tr>';
  });
  return h + '</tbody></table></div><p class="cmpnote">Green: best on the lot for that row, where every car\'s number is published. Simulated laps: each car\'s own weight, power, torque, gears and drag on the template\'s tyres, one driver for all. Hover a cell for its source.</p>';
}

// price against simulated lap, one dot per car (UC-11.2): lower-left is more pace for less money
export function priceVsPace(cars, focusKey, accent) {
  const pts = cars.filter((c) => c.price !== null && c.lap !== null);
  if (pts.length < 2) return '';
  const W = 560, H = 260, P = { l: 64, r: 16, t: 18, b: 44 };
  const xs = pts.map((c) => c.price), ys = pts.map((c) => c.lap);
  const x0 = Math.min(...xs) * 0.9, x1 = Math.max(...xs) * 1.05, y0 = Math.min(...ys) - 0.4, y1 = Math.max(...ys) + 0.4;
  const X = (v) => P.l + (v - x0) / (x1 - x0) * (W - P.l - P.r), Y = (v) => P.t + (v - y0) / (y1 - y0) * (H - P.t - P.b);
  let s = '<svg class="pvp" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Price against simulated lap time">';
  s += '<line x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '" class="ax"/><line x1="' + P.l + '" y1="' + P.t + '" x2="' + P.l + '" y2="' + (H - P.b) + '" class="ax"/>';
  for (let k = 0; k <= 3; k++) {                         // price ticks
    const v = x0 + (x1 - x0) * k / 3, x = X(v);
    s += '<line x1="' + x.toFixed(1) + '" y1="' + (H - P.b) + '" x2="' + x.toFixed(1) + '" y2="' + (H - P.b + 5) + '" class="ax"/><text x="' + x.toFixed(1) + '" y="' + (H - P.b + 17) + '" class="axl">$' + Math.round(v / 1000) + 'k</text>';
  }
  s += '<text x="' + (W / 2) + '" y="' + (H - 4) + '" class="axl">Price as listed (CAD)</text><text x="14" y="' + (H / 2) + '" class="axl" transform="rotate(-90 14 ' + (H / 2) + ')">Simulated lap (s), faster is up</text>';
  for (const c of pts) {
    const x = X(c.price), y = Y(c.lap), f = c.key === focusKey;
    s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (f ? 7 : 5) + '" fill="' + (f ? accent : '#fefefe') + '" opacity="' + (f ? 1 : 0.75) + '"/>' +
      '<text x="' + (x > W * 0.62 ? x - 9 : x + 9).toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="' + (x > W * 0.62 ? 'end' : 'start') + '" class="pl' + (f ? ' f' : '') + '">' +
      esc(c.title.replace(/^\d{4} /, '').split(' ').slice(0, 3).join(' ')) + ' · ' + c.lap.toFixed(1) + ' s</text>';
  }
  return s + '</svg>';
}
