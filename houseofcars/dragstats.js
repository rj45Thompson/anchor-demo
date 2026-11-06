// dragstats.js - the drag strip numbers Dragy users' own GPS runs give each car (UC-21), as a heads-up readout: 0-100 km/h, the
// 1/8 mile and the 1/4 mile with their trap speeds. Data: data/dragy.json (tools/dragy.py, Dragy's public leaderboard). The big
// number is the MEDIAN of the runs that list no modifications (one mislabelled upload cannot move it: 11-06 the i8's fastest
// "no mods" 0-100 was 2.42 s); the fastest upload is shown small and named as an upload. A car with no run of its generation
// says so (ABSENT, with the search); a board that did not answer says "not read" (UNRESOLVED). Nobody's name is shown.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TESTS = [['0-100 km/h', '0-100', 'KM/H'], ['1/8 mile', '1/8', 'MILE'], ['1/4 mile', '1/4', 'MILE']];

export const DRAG_CSS = `
.dhud{margin:8px 0;border:1px solid rgba(63,178,127,.35);border-radius:12px;padding:10px 12px;background:linear-gradient(180deg,rgba(8,20,14,.92),rgba(6,10,8,.92));box-shadow:inset 0 0 24px rgba(63,178,127,.08)}
.dhud .dh{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7fd8aa}
.dhud .dh a{color:#7fd8aa;letter-spacing:.06em;font-weight:700}
.dhud .drow{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0 4px}
.dhud .dread{border-radius:9px;background:rgba(0,0,0,.45);border:1px solid rgba(63,178,127,.18);padding:8px 6px;text-align:center;min-width:0}
.dhud .dl{font-size:9.5px;font-weight:800;letter-spacing:.14em;color:#8fa79a}.dhud .dl b{display:block;font-size:13px;letter-spacing:.06em;color:#cfe9dc}
.dhud .dv{font:700 26px/1.1 ui-monospace,"Cascadia Mono",Consolas,monospace;color:#5dffa9;text-shadow:0 0 10px rgba(93,255,169,.55);font-variant-numeric:tabular-nums;margin:4px 0 2px}
.dhud .dv small{font-size:12px;color:#7fd8aa;text-shadow:none;margin-left:2px}
.dhud .dv.none{color:#55665d;text-shadow:none}
.dhud .dt{font:600 11px ui-monospace,Consolas,monospace;color:#ffd27a}
.dhud .ds{font-size:10.5px;color:#8fa79a;line-height:1.35}.dhud .ds.mod{color:#ffb38a}
.dhud .df{font-size:10.5px;color:#7d8f86;line-height:1.4;margin-top:4px}
.dhud.big .dv{font-size:40px}.dhud.big .dl b{font-size:16px}.dhud.big .dread{padding:14px 8px}
@media (max-width:420px){.dhud .dv{font-size:21px}.dhud.big .dv{font-size:28px}}
`;
let cssIn = false;
function ensureCss() { if (cssIn || typeof document === 'undefined') return; const s = document.createElement('style'); s.textContent = DRAG_CSS; document.head.appendChild(s); cssIn = true; }

function readout(t, rec) {
  const [name, top, unit] = t;
  const head = '<div class="dl">' + esc(unit) + '<b>' + esc(top) + '</b></div>';
  if (!rec || rec.kind === 'UNRESOLVED') return '<div class="dread">' + head + '<div class="dv none">--</div><div class="ds">not read' + (rec ? ': ' + esc(rec.why.replace(/^not read: /, '')) : '') + '</div></div>';
  if (rec.kind === 'ABSENT') return '<div class="dread">' + head + '<div class="dv none">--</div><div class="ds">no run of this car on Dragy\'s board</div></div>';
  const s = rec.no_mods_listed || rec.all, stock = !!rec.no_mods_listed;
  const trap = s.median_trap_kmh ? '<div class="dt">@ ' + Math.round(s.median_trap_kmh) + ' km/h</div>' : '';
  return '<div class="dread" data-test="' + esc(name) + '">' + head + '<div class="dv">' + s.median_s.toFixed(2) + '<small>s</small></div>' + trap +
    '<div class="ds' + (stock ? '' : ' mod') + '">' + (s.runs === 1 ? 'one run' : 'typical of ' + s.runs + ' runs') + (stock ? ', no mods listed' : ', all modified') + '</div>' +
    (s.runs > 1 ? '<div class="ds">fastest upload ' + s.best_s.toFixed(2) + ' s</div>' : '') + '</div>';
}

/** the readout for one car: 'card' (the lot card, compact) or 'page' (the details page, big) */
export function dragyHUD(key, DRAGY, mode) {
  ensureCss();
  const c = DRAGY && DRAGY.cars[key];
  if (!c) return '';
  const any = TESTS.some((t) => c.tests[t[0]] && c.tests[t[0]].kind === 'READ');
  const day = String(DRAGY.read_at).slice(0, 10);
  return '<div class="dhud' + (mode === 'page' ? ' big' : '') + '" id="dragy-' + esc(key) + '"><div class="dh"><span>Dragy · owners\' GPS runs</span><a href="' + esc(c.board) + '" target="_blank" rel="noopener">the leaderboard</a></div>' +
    '<div class="drow">' + TESTS.map((t) => readout(t, c.tests[t[0]])).join('') + '</div>' +
    '<div class="df">' + (any ? 'The big number is the median of the runs Dragy users uploaded that list no modifications. ' : 'No Dragy user has uploaded a run of this car yet. ') +
    'Counted: ' + esc(c.why) + '. Self-reported GPS runs, not a road test; read ' + esc(day) + '.</div></div>';
}
