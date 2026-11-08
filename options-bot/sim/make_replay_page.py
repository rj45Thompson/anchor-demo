"""Writes replay.html from sim/results/week.json and week_reset_daily.json: watch the bot trade each real session.

    py sim/make_replay_page.py OUT_DIR
"""
import html
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent


def slim(week):
    """only what the page draws: each minute's close, the console, the fills, the rows"""
    return {"source": week["source"], "model": week["model"], "budget": week["budget"], "settings": week["settings"],
            "days": [{"date": d["date"], "minutes": [[m[0], round(m[1], 2)] for m in d["minutes"]], "range": d["opening_range"],
                      "console": d["console"], "fills": d["fills"], "rows": [r for r in d["rows"] if r and r[0] != "Timestamp"]}
                     for d in week["days"]]}


def main(out):
    carried = slim(json.loads((HERE / "results" / "week.json").read_text(encoding="utf-8")))
    reset = slim(json.loads((HERE / "results" / "week_reset_daily.json").read_text(encoding="utf-8")))
    data = json.dumps({"carried": carried, "reset": reset}, separators=(",", ":")).replace("</", "<\\/")
    fetched = html.escape(carried["source"]["spy"]["fetched_utc"])
    page = TEMPLATE.replace("__DATA__", data).replace("__FETCHED__", fetched).replace("__MODEL__", html.escape(carried["model"]))
    pathlib.Path(out).mkdir(parents=True, exist_ok=True)
    (pathlib.Path(out) / "replay.html").write_text(page, encoding="utf-8", newline="\n")
    print(f"wrote {pathlib.Path(out) / 'replay.html'} ({len(page)} bytes)")
    return 0


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Options Bot Replay</title>
<meta name="description" content="The options trader bot run through five real SPY sessions (November 2-6, 2026), minute by minute: the opening range, the signals, the trades and its own console. Option prices are modeled.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400..700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{--bg:#0B1219;--panel:#121C26;--line:#2E4052;--well:#0E1720;--fg:#F4F2EC;--soft:#C9D3DC;--muted:#A9B7C4;--accent:#F08A3C;
  --blue:#7FB2E5;--green:#47D1A0;--red:#F2787A;--amber:#F7C873;
  --sans:'IBM Plex Sans',system-ui,sans-serif;--head:'Space Grotesk',system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,Consolas,monospace;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15.5px/1.6 var(--sans)}
main{max-width:1000px;margin:0 auto;padding:22px 16px 48px}a{color:var(--blue)}
.crumb{font-size:13.5px;color:var(--muted);margin:0 0 18px}.crumb a{color:var(--muted)}
h1{font:700 clamp(28px,5vw,40px)/1.15 var(--head);margin:0 0 10px}h1 b{color:var(--accent)}
h2{font:600 22px/1.25 var(--head);margin:34px 0 10px}p{margin:0 0 12px;color:var(--soft)}
.honest{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:12px;padding:12px 14px;margin:14px 0}
.honest p{margin:4px 0;font-size:14.5px}.honest b{color:var(--fg)}
.nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.nums div{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.nums b{display:block;font:700 24px/1.1 var(--head);color:var(--green)}.nums b.down{color:var(--red)}.nums span{color:var(--muted);font-size:13.5px}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}
.tabs button,.ctl button,.ctl select{font:600 13.5px var(--sans);color:var(--fg);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer}
.tabs button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
.stage{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px}
canvas{display:block;width:100%;height:340px;background:var(--well);border-radius:10px}
.ctl{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0}
.ctl input[type=range]{flex:1;min-width:160px;accent-color:var(--accent)}
.clock{font:600 14px var(--mono);color:var(--amber);min-width:64px}
.console{height:220px;overflow:auto;background:#081016;border:1px solid var(--line);border-radius:10px;padding:10px;font:12.5px/1.55 var(--mono);color:var(--soft);white-space:pre-wrap;overflow-wrap:anywhere;font-variant-ligatures:none}
.console .t{color:var(--muted)}.console .k{color:var(--fg)}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--muted);margin:6px 0 0}
.legend i{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:5px}
table{width:100%;border-collapse:collapse;font:13.5px var(--mono);margin:8px 0}th,td{border-bottom:1px solid var(--line);padding:6px 6px;text-align:right}
th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}th{color:var(--muted);font-weight:600}
.wrap{overflow-x:auto}.up{color:var(--green)}.dn{color:var(--red)}
footer{margin-top:30px;padding-top:14px;border-top:1px solid var(--line);font-size:13.5px;color:var(--muted)}footer p{color:var(--muted)}
code{font:13px var(--mono);background:var(--well);border:1px solid var(--line);border-radius:6px;padding:1px 5px}
@media (max-width:560px){canvas{height:260px}}
</style>
</head>
<body>
<main>
<p class="crumb"><a href="../">anchor-demo</a> / <a href="./">options trader bot</a> / replay</p>
<h1>Replay: <b>five real sessions</b></h1>
<p>The bot's own code, unchanged, run through SPY's real minute bars for November 2 to 6, 2026: the latest five sessions when
this was made (Sunday, November 8). Press play to watch a day: the price, the opening range, the triggers, each signal and fill,
and the bot's console as it printed.</p>
<div class="honest">
<p><b>Real:</b> SPY's one-minute bars, Yahoo Finance's public chart data, fetched __FETCHED__ UTC. The bot sees each minute at its close.</p>
<p><b>Modeled:</b> __MODEL__</p>
<p><b>Settings:</b> a $100 starting budget (the owner's), test exits of a 50% stop and a 100% target (not the owner's, not advice),
IBKR's published $0.65 a contract with a $1.00 minimum. One week of one model shows how the bot behaves; it says nothing about
how a strategy would do.</p>
</div>
<div class="nums" id="cards"></div>
<h2>Watch a day</h2>
<div class="tabs" id="tabs"></div>
<div class="stage">
  <canvas id="chart" aria-label="SPY's minute closes for the chosen day, with the opening range, the triggers and the trades"></canvas>
  <div class="legend"><span><i style="background:#C9D3DC"></i>SPY close</span><span><i style="background:rgba(127,178,229,.5);height:10px"></i>opening range</span>
  <span><i style="background:#47D1A0"></i>CALL trigger</span><span><i style="background:#F2787A"></i>PUT trigger</span><span>&#9650; buy &nbsp; &#10005; sell</span></div>
  <div class="ctl"><button id="play" type="button">Play</button><select id="speed" aria-label="Speed"><option value="2">slow</option><option value="6" selected>normal</option><option value="20">fast</option></select>
  <input id="t" type="range" min="0" max="390" value="390" aria-label="Time of day"><span class="clock" id="clock">16:00</span><span id="budget" class="clock"></span></div>
  <div class="console" id="console" role="log"></div>
</div>
<h2>Every trade</h2>
<p>The bot as built carries its budget from day to day in its log. The second table starts every morning from $100 again, the
other answer the owner may choose.</p>
<div class="wrap"><table id="carried"></table></div>
<div class="wrap"><table id="reset"></table></div>
<footer>
<p>Run it again: <code>py sim/market_data.py</code> fetches the latest five sessions, <code>py sim/replay.py</code> replays them
(<code>--stop</code>, <code>--target</code>, <code>--reset-daily</code>), and <code>py sim/make_replay_page.py OUT</code> writes this page.
The code: <a href="sim/replay.py">replay.py</a>, <a href="sim/market_data.py">market_data.py</a>.</p>
<p><a href="./">Back to the options trader bot</a> · <a href="epics.html">Epics and use cases</a>. Software, not financial advice.</p>
</footer>
</main>
<script>
const DATA = __DATA__;
const $ = (id) => document.getElementById(id);
const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2);
const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (h - 9) * 60 + m - 30; };
const secs = (hms) => { const [h, m, s] = hms.split(':').map(Number); return (h - 9) * 60 + m - 30 + s / 60; };

function rowsOf(run) { return run.days.flatMap((d) => d.rows.map((r) => ({ date: d.date, r }))); }
function cards() {
  const c = rowsOf(DATA.carried), r = rowsOf(DATA.reset);
  const end = c.length ? Number(c[c.length - 1].r[6]) : 100;
  const wins = c.filter((x) => Number(x.r[5]) > 0).length;
  const resetNet = r.reduce((s, x) => s + Number(x.r[5]), 0);
  const noTrade = DATA.carried.days.filter((d) => d.console.some(([, l]) => l.includes('[NO TRADE] One'))).length;
  $('cards').innerHTML = [
    ['$100.00', 'the budget it started with', ''], [money(end), 'its budget at the end of the week', end < 100 ? 'down' : ''],
    [String(c.length), 'trades: ' + wins + ' won, ' + (c.length - wins) + ' lost', ''],
    [String(noTrade), 'days a signal came but one contract cost more than the budget', ''],
    [money(resetNet), 'the week\'s net if the budget went back to $100 each morning', resetNet < 0 ? 'down' : '']
  ].map(([b, s, cls]) => '<div><b class="' + cls + '">' + b + '</b><span>' + s + '</span></div>').join('');
}
function table(id, run, title) {
  const rows = rowsOf(run);
  $(id).innerHTML = '<caption style="text-align:left;color:var(--muted);padding:4px 0">' + title + '</caption>' +
    '<tr><th>Closed</th><th>Play</th><th>Contracts</th><th>Entry</th><th>Exit</th><th>Net</th><th>Budget after</th></tr>' +
    (rows.length ? rows.map(({ r }) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] +
      '</td><td class="' + (Number(r[5]) < 0 ? 'dn' : 'up') + '">' + money(Number(r[5])) + '</td><td>' + money(Number(r[6])) + '</td></tr>').join('')
      : '<tr><td colspan="7">No trades.</td></tr>');
}

let day = null, t = 390, playing = false, timer = null;
function pick(i) {
  day = DATA.carried.days[i];
  document.querySelectorAll('#tabs button').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  stop(); t = 390; $('t').value = t; draw();
}
function draw() {
  const cv = $('chart'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const closes = day.minutes.map((m) => m[1]);
  const trig = { call: day.range.high + 0.30, put: day.range.low - 0.30 };
  let lo = Math.min(...closes, trig.put), hi = Math.max(...closes, trig.call);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const L = 52, R = 10, T = 10, B = 24;
  const x = (m) => L + (w - L - R) * m / 390, y = (p) => T + (h - T - B) * (hi - p) / (hi - lo);
  g.font = '11px JetBrains Mono, monospace'; g.fillStyle = '#A9B7C4'; g.strokeStyle = '#223142'; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const p = lo + (hi - lo) * k / 4; g.beginPath(); g.moveTo(L, y(p)); g.lineTo(w - R, y(p)); g.stroke(); g.fillText(p.toFixed(2), 2, y(p) + 4); }
  for (const hh of [10, 11, 12, 13, 14, 15]) { const m = (hh - 9) * 60 - 30; g.fillText(hh + ':00', x(m) - 14, h - 6); }
  g.fillStyle = 'rgba(127,178,229,.22)'; g.fillRect(x(0), y(day.range.high), x(15) - x(0), y(day.range.low) - y(day.range.high));
  g.setLineDash([5, 4]);
  for (const [p, c] of [[trig.call, '#47D1A0'], [trig.put, '#F2787A']]) { g.strokeStyle = c; g.beginPath(); g.moveTo(x(15), y(p)); g.lineTo(w - R, y(p)); g.stroke(); }
  g.setLineDash([]); g.strokeStyle = '#C9D3DC'; g.lineWidth = 1.5; g.beginPath();
  day.minutes.forEach(([hm, c], i) => { const m = mins(hm) + 1; if (m > t) return; i ? g.lineTo(x(m), y(c)) : g.moveTo(x(m), y(c)); });
  g.stroke();
  const priceAt = (m) => { let p = closes[0]; for (const [hm, c] of day.minutes) { if (mins(hm) + 1 <= m) p = c; } return p; };
  g.font = '14px sans-serif';
  for (const f of day.fills) {
    const m = secs(f.time); if (m > t) continue;
    const call = f.contract.endsWith('C');
    g.fillStyle = f.action === 'BUY' ? (call ? '#47D1A0' : '#F2787A') : '#F7C873';
    g.fillText(f.action === 'BUY' ? '▲' : '✕', x(m) - 6, y(priceAt(m)) - 6);
  }
  if (t < 390) { g.strokeStyle = '#F08A3C'; g.beginPath(); g.moveTo(x(t), T); g.lineTo(x(t), h - B); g.stroke(); }
  const hhmm = (m) => { const a = Math.floor(m) + 570; return String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0'); };
  $('clock').textContent = hhmm(Math.min(t, 390));
  const lines = day.console.filter(([tm]) => secs(tm) <= t);
  const budgetLine = [...lines].reverse().find(([, l]) => l.includes('Balance $') || l.startsWith('[BUDGET]'));
  $('budget').textContent = budgetLine ? (budgetLine[1].match(/Balance (\$[\d,.]+)/) || budgetLine[1].match(/\[BUDGET\] (\$[\d,.]+)/) || [, ''])[1] : '';
  const con = $('console');
  con.innerHTML = lines.map(([tm, l]) => '<span class="t">' + tm + '</span>  <span class="' + (/^\[(SIGNAL|FILLED|TRADE CLOSED|NO TRADE|CIRCUIT|BUDGET)/.test(l) ? 'k' : '') + '">' +
    l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</span>').join('\n');
  con.scrollTop = con.scrollHeight;
}
function stop() { playing = false; clearInterval(timer); $('play').textContent = 'Play'; }
function play() {
  if (playing) return stop();
  if (t >= 390) t = -10;
  playing = true; $('play').textContent = 'Pause';
  timer = setInterval(() => { t = Math.min(390, t + Number($('speed').value) / 10); $('t').value = t; draw(); if (t >= 390) stop(); }, 50);
}
DATA.carried.days.forEach((d, i) => {
  const b = document.createElement('button'); b.type = 'button';
  b.textContent = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  b.addEventListener('click', () => pick(i)); $('tabs').appendChild(b);
});
$('play').addEventListener('click', play);
$('t').addEventListener('input', (e) => { stop(); t = Number(e.target.value); draw(); });
window.addEventListener('resize', () => day && draw());
cards();
table('carried', DATA.carried, 'The bot as built: the budget carried day to day');
table('reset', DATA.reset, 'The alternative: $100 again every morning');
pick(DATA.carried.days.length - 1);
</script>
</body>
</html>
"""

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
