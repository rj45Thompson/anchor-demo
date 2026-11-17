// Plays the song for real in a browser and checks the game actually works: a scripted
// player presses the frets off the audio clock, and the score, combo and multiplier
// have to follow. No phone, no relay, no microphone, no GPU.
//   node jukebox/tests/game.browser.mjs [seconds] [screenshot-dir]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAY_SECONDS = Number(process.argv[2] || 24);
const SHOT_DIR = process.argv[3] || null;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, rel.endsWith("/") ? `${rel}index.html` : rel);
  try {
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  // The relay is not reachable from a test machine; the page says so and carries on.
  const text = m.text();
  if (m.type() === "error" && !/ERR_TUNNEL|ERR_NAME|Failed to fetch dynamically imported/.test(text)) {
    errors.push(`console: ${text.slice(0, 200)}`);
  }
});

await page.goto(`${base}/jukebox/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.jukebox && window.jukebox.song && window.jukebox.backend, { timeout: 20000 });
const backend = await page.evaluate(() => window.jukebox.backend.name);

// Take the keyboard seat and start.
await page.keyboard.press("KeyK");
await page.waitForFunction(() => !document.getElementById("play").disabled, { timeout: 5000 });
await page.click("#play");
await page.waitForFunction(() => window.jukebox.running === true, { timeout: 10000 });

// A scripted player: presses each gem's lane on the beat, off the audio clock, and
// holds a sustain for its length. Dispatching real key events means this goes through
// the same listeners a person would.
await page.evaluate(() => {
  const CODES = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"];
  const j = window.jukebox;
  const events = [];
  for (const g of j.gems) {
    events.push({ t: g.t - 0.004, code: CODES[g.lane], type: "keydown" });
    events.push({ t: g.t + Math.max(0.05, g.len) + 0.01, code: CODES[g.lane], type: "keyup" });
  }
  events.sort((a, b) => a.t - b.t);
  let i = 0;
  window.__auto = { fired: 0, frames: 0 };
  // A 4 ms timer, not requestAnimationFrame: this is measuring the game's timing, and
  // rAF under a software renderer is far coarser than the judging window.
  const timer = setInterval(() => {
    const t = j.audio ? j.audio.now() : -99;
    while (i < events.length && events[i].t <= t) {
      const e = events[i++];
      window.dispatchEvent(new KeyboardEvent(e.type, { code: e.code, bubbles: true }));
      window.__auto.fired++;
    }
    if (!j.running) clearInterval(timer);
  }, 4);
  // Count frames too, so the run can report how fast it actually drew.
  const count = () => { window.__auto.frames++; if (j.running) requestAnimationFrame(count); };
  requestAnimationFrame(count);
});

// Let it play, sampling as it goes.
const samples = [];
const step = PLAY_SECONDS / 6;
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(step * 1000);
  samples.push(await page.evaluate(() => {
    const j = window.jukebox;
    const seat = j.play && j.play.seats.get(99);
    return seat ? {
      t: Number(j.audio.now().toFixed(2)), score: Math.round(seat.score), combo: seat.combo,
      best: seat.bestCombo, perfect: seat.hits.perfect, great: seat.hits.great,
      good: seat.hits.good, miss: seat.hits.miss, over: seat.overpresses,
      star: seat.starCharge, fired: window.__auto.fired, frames: window.__auto.frames,
    } : null;
  }));
  if (SHOT_DIR && i === 3) await page.screenshot({ path: join(SHOT_DIR, "playing.png") });
}
const final = samples[samples.length - 1];
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const board = await page.evaluate(() => ({
  shown: !document.getElementById("results").hidden,
  rows: [...document.querySelectorAll("#scoreboard li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()),
}));
if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, "results.png") });
await browser.close();
server.close();

const judged = final.perfect + final.great + final.good;
const checks = [
  ["the page had no errors", errors.length === 0, errors.join(" | ")],
  ["a renderer started", !!backend, ""],
  ["the scripted player actually pressed keys", final.fired > 40, `fired ${final.fired}`],
  ["the song reached the chart", final.t > 2, `clock at ${final.t}s`],
  ["notes were judged", judged > 20, `${judged} judged`],
  ["most of them were perfect", final.perfect / Math.max(1, judged) > 0.8, `${final.perfect}/${judged} perfect`],
  ["almost nothing was missed", final.miss <= judged * 0.1, `${final.miss} missed of ${judged}`],
  ["no phantom presses", final.over === 0, `${final.over} overpresses`],
  ["the score went up", final.score > 1000, `score ${final.score}`],
  ["a combo was built", final.best >= 20, `best run ${final.best}`],
  ["the multiplier climbed past 1x", final.score > judged * 50, `${final.score} for ${judged} notes at 50 base`],
  ["star power charged", final.star > 0, `charge ${final.star}`],
  ["the score only ever rose", samples.every((s, i) => i === 0 || s.score >= samples[i - 1].score), samples.map((s) => s.score).join(" -> ")],
  ["the clock kept moving", samples.every((s, i) => i === 0 || s.t > samples[i - 1].t), samples.map((s) => s.t).join(" -> ")],
  ["stopping shows the scoreboard", board.shown && board.rows.length >= 1, JSON.stringify(board.rows)],
];
let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -- ${detail}`}`);
}
console.log(`\nbackend: ${backend}  (${(final.frames / Math.max(1, final.t)).toFixed(1)} fps while drawing in software)`);
console.log(`progress: ${samples.map((s) => `${s.t}s/${s.score}`).join("  ")}`);
console.log(`final: ${final.perfect} perfect, ${final.great} great, ${final.good} good, ${final.miss} missed, best run ${final.best}`);
if (board.rows[0]) console.log(`scoreboard: ${board.rows[0]}`);
console.log(`${checks.length} checks, ${failed} failed.`);
process.exit(failed ? 1 : 0);
