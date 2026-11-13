// End-to-end check of the live microphone path, with no real microphone.
// Chromium is given a fake capture device fed from a generated C4 tone, so this
// exercises getUserMedia -> MediaStreamSource -> Analyser -> detectPitch -> DOM,
// which the pure-function tests in core.test.mjs cannot reach.
//   node karaoke/tests/mic.browser.mjs
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A sustained C4 with harmonics, written as 16-bit mono PCM: what Chromium's
// --use-file-for-fake-audio-capture expects. Long enough to outlast the song.
function wav(hz, seconds, rate = 48000, amp = 0.3, harmonics = 5) {
  const n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * hz * h * (i / rate)) / h;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(amp * v * 32767))), 44 + i * 2);
  }
  return buf;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, rel.endsWith("/") ? `${rel}index.html` : rel);
  try {
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const dir = await mkdtemp(join(tmpdir(), "karaoke-mic-"));
const tone = join(dir, "c4.wav");
await writeFile(tone, wav(261.63, 26));

const browser = await chromium.launch({ args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
  `--use-file-for-fake-audio-capture=${tone}`,
  "--autoplay-policy=no-user-gesture-required", "--no-sandbox",
]});
const page = await (await browser.newContext({ permissions: ["microphone"] })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(url, { waitUntil: "networkidle" });
await page.click("#start");

// The demo song runs 4s-19s, and the last phrase scores 0.5s after that.
const sung = new Map();
const targets = new Set();
for (let i = 0; i < 215; i++) {
  await page.waitForTimeout(100);
  const s = await page.evaluate(() => ({
    sung: document.querySelector("#sung")?.textContent?.trim(),
    target: document.querySelector("#target")?.textContent?.trim(),
    scores: [...document.querySelectorAll("#scores li")].map((li) => li.textContent.trim()),
  }));
  if (s.sung && s.sung !== "-") sung.set(s.sung, (sung.get(s.sung) || 0) + 1);
  if (s.target && s.target !== "-") targets.add(s.target);
  if (s.scores.length >= 4) break;
}
const final = await page.evaluate(() => ({
  scores: [...document.querySelectorAll("#scores li")].map((li) => li.textContent.trim()),
  status: document.querySelector("#status")?.textContent?.trim(),
}));
await browser.close();
server.close();

const ranked = [...sung.entries()].sort((a, b) => b[1] - a[1]);
const scored = final.scores.map((s) => Number(/(\d+)% on pitch/.exec(s)?.[1] ?? -1));
const checks = [
  ["no page errors", errors.length === 0, errors.join(" | ")],
  ["page reports C4", ranked[0]?.[0] === "C4", `saw ${ranked.map(([n, c]) => `${n}x${c}`).join(" ") || "nothing"}`],
  ["render loop survived (melody advanced)", targets.size >= 4, `${targets.size} distinct target notes: ${[...targets].join(",")}`],
  ["all 4 phrases scored", final.scores.length === 4, final.scores.join(" / ")],
  ["some notes judged on pitch", scored.some((n) => n > 0), final.scores.join(" / ")],
];
let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -- ${detail}`}`);
}
console.log(`scores: ${final.scores.join(" / ") || "(none)"}`);
console.log(`${checks.length} checks, ${failed} failed.`);
process.exit(failed ? 1 : 0);
