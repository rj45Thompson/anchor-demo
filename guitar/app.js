// Chord Trainer page: mic and camera, the song clock, the lane, practice, tuner. The judging maths lives in js/.
// Serves: S1-S8, P1-P3, A4, A5, A8, A9, A10 (docs/USE_CASES.md).

import { SHAPES, NOTE_NAMES, STRING_NAMES, OPEN_STRINGS, chordPitchClasses } from "./js/chords.js";
import { strum, pluck, seededRandom } from "./js/synth.js";
import { analyse, magnitudeSpectrum, readStrum, rms, quietNotes } from "./js/chroma.js";
import { detectPitch, hzToMidi, noteName } from "./js/pitch.js";
import { StrumDetector } from "./js/onset.js";
import { scheduleSong, SongRun } from "./js/judge.js";
import { pickChordHand, shapeVector, ShapeMemory } from "./js/hands.js";
import { SONGS } from "./js/songs.js";
import { CONFIG } from "./js/config.js";

const MP_VERSION = "0.10.14";
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MEMORY_KEY = "chord-trainer-shapes-v1";
const COUNT_IN = 4;
const JUDGE_DELAY = (CONFIG.strum.judgeToMs + 100) / 1000;

const $ = (id) => document.getElementById(id);
const A = CONFIG.analysis;

// ---------- state ----------
let ctx = null;
let analyser = null;
let buf = null;
let recentBuffers = []; // [{ t, data }] the last ~150 ms of analyser windows, for the "before the strum" spectrum
let micStream = null;
let micSource = null;
let floorMeasure = null; // { until, levels }
let gateUntil = 0; // ctx time: input ignored while the page itself plays a chord (A8)
const detector = new StrumDetector(CONFIG.strum);
let pending = []; // strums being listened to
let tab = "play";
let practiseChord = "G";
let run = null;
let tunerReadings = [];
const memory = new ShapeMemory(CONFIG.hands, loadMemory());
const cam = { stream: null, landmarker: null, lastVideoTime: -1, recent: [], delegate: "", hand: null, statusAt: 0 };

function loadMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveMemory() {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory.toJSON()));
  } catch {
    // Storage blocked (private window): shapes are kept for this visit only, which the status line says.
  }
}

function deviceStatus(text) {
  $("device-status").textContent = text;
}

// ---------- audio ----------
async function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = A.fftSize;
    analyser.smoothingTimeConstant = 0;
    buf = new Float32Array(analyser.fftSize);
    requestAnimationFrame(loop);
  }
  if (ctx.state !== "running") {
    await ctx.resume();
  }
}

async function toggleMic() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micSource.disconnect();
    micStream = null;
    micSource = null;
    $("mic-btn").textContent = "Turn on mic";
    deviceStatus("The mic is off. Nothing is judged until it is on.");
    return;
  }
  await ensureAudio();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    deviceStatus("This browser gives the page no microphone (it needs https and a current browser). Nothing can be judged; the demo, Listen and the diagrams still work.");
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    deviceStatus(`The mic could not start (${e.name}: ${e.message}). Nothing can be judged without it; the demo, Listen and the diagrams still work.`);
    return;
  }
  micSource = ctx.createMediaStreamSource(micStream);
  if (!(run && run.demo)) {
    micSource.connect(analyser);
  }
  $("mic-btn").textContent = "Turn off mic";
  floorMeasure = { until: ctx.currentTime + 1, levels: [] };
  deviceStatus("Measuring the room's noise for 1 second: keep the strings still.");
}

// A plucked-string sound into the speakers (and into the judge when `toJudge`, which only the demo does).
function playSamples(samples, when, toJudge) {
  const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  b.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.connect(ctx.destination);
  if (toJudge) {
    src.connect(analyser);
  }
  src.start(when);
  return when + samples.length / ctx.sampleRate;
}

function click(when, accent) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.3, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  osc.connect(g).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.05);
  if (run) {
    run.clicks.push(when);
  }
}

// The page is about to make sound through the speakers: stop listening until it has faded (A8).
function gateFor(seconds) {
  gateUntil = Math.max(gateUntil, ctx.currentTime + seconds);
  pending = [];
}

async function listen(chord) {
  await ensureAudio();
  const s = strum(SHAPES[chord], ctx.sampleRate, { seconds: 1.6, staggerMs: 14, decay: 0.996, detuneCents: 0, seed: 5 });
  const end = playSamples(s, ctx.currentTime + 0.02, false);
  gateFor(end - ctx.currentTime + 0.1);
}

// ---------- the frame loop ----------
function loop() {
  requestAnimationFrame(loop);
  const now = ctx.currentTime;
  analyser.getFloatTimeDomainData(buf);
  recentBuffers.push({ t: now, data: buf.slice() });
  while (recentBuffers.length > 2 && recentBuffers[0].t < now - 0.15) {
    recentBuffers.shift();
  }
  const level = rms(buf, 1024);
  $("level").style.width = `${Math.min(100, level * 300)}%`;

  if (floorMeasure) {
    floorMeasure.levels.push(level);
    if (now >= floorMeasure.until) {
      const sorted = floorMeasure.levels.slice().sort((a, b) => a - b);
      const floor = sorted[Math.floor(sorted.length / 2)];
      detector.setFloor(floor);
      floorMeasure = null;
      deviceStatus(`Mic on. Room noise ${floor.toFixed(4)}; a strum must be ${CONFIG.strum.floorRatio}x louder. Strum a chord and the level bar jumps.`);
    }
  }

  const input = (micStream || (run && run.demo)) && !floorMeasure;
  const clicking = run && run.clicks.some((c) => now - c >= -0.01 && now - c < 0.09);
  if (input && now >= gateUntil && !clicking) {
    if (detector.push(level, now * 1000)) {
      onStrum(now);
    }
  }
  servicePending(now);
  if (tab === "tune") {
    tuneFrame();
  }
  if (run && !run.done) {
    runFrame(now);
  }
  cameraFrame(now);
  drawLane(now);
}

function onStrum(now) {
  const older = recentBuffers.filter((b) => b.t <= now - 0.04);
  const beforeData = older.length ? older[older.length - 1].data : null;
  pending.push({
    onset: now - CONFIG.strum.hopMs / 2000,
    before: beforeData ? magnitudeSpectrum(beforeData, A.fftSize) : null,
    plain: [],
    ringOff: [],
    nextAt: now + CONFIG.strum.judgeFromMs / 1000,
    until: now + CONFIG.strum.judgeToMs / 1000,
  });
}

function servicePending(now) {
  for (const p of pending.slice()) {
    if (now >= p.nextAt && p.nextAt <= p.until + 0.001) {
      const c = analyse(buf, ctx.sampleRate, A, null);
      const d = p.before ? analyse(buf, ctx.sampleRate, A, p.before) : null;
      if (c) {
        p.plain.push(c);
      }
      if (d) {
        p.ringOff.push(d);
      }
      p.nextAt += 0.1;
    }
    if (p.nextAt > p.until + 0.001) {
      pending.splice(pending.indexOf(p), 1);
      deliver(p, readStrum(p.plain, p.ringOff, A));
    }
  }
}

// A strum's verdict reaches the game, or the practice panel.
function deliver(p, verdict) {
  const heard = verdict ? verdict.name : null;
  if (run && !run.done) {
    const res = run.songRun.strum(songTimeAt(p.onset), heard);
    if (!res) {
      return;
    }
    if (res.kind === "hit") {
      banner(res.grade, res.grade);
      const when = res.offsetMs === 0 ? "on the beat" : `${Math.abs(res.offsetMs)} ms ${res.offsetMs < 0 ? "early" : "late"}`;
      feedback(`<span class="good">${esc(run.events[res.index].chord)}: ${res.grade}</span>, ${when}.`);
      learnShape(run.events[res.index].chord, p.onset);
    } else {
      banner("wrong", "wrong");
      feedback(heard
        ? `<span class="bad">Heard ${esc(heard)}, wanted ${esc(res.wanted)}.</span> Look at the diagram.`
        : `<span class="bad">That was not a chord I know.</span> Wanted ${esc(res.wanted)}. A muted string or tuning? Try the Tune tab.`);
    }
    updateScore();
    return;
  }
  if (tab === "practise") {
    showPractise(verdict);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function feedback(html) {
  $("feedback").innerHTML = html;
}

let bannerTimer = 0;
function banner(text, kind) {
  const b = $("banner");
  b.textContent = text === "wrong" ? "Not that one" : text === "miss" ? "Missed" : text;
  b.className = `banner ${kind}`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    b.textContent = "";
  }, 900);
}

// ---------- a song run ----------
async function startRun(demo) {
  await ensureAudio();
  if (!demo && !micStream) {
    feedback('<span class="bad">Turn the mic on first:</span> the game cannot judge what it cannot hear. Or watch the demo.');
    return;
  }
  const song = SONGS.find((s) => s.id === $("song").value);
  const speed = Number($("speed").value);
  const mode = $("mode").value;
  const events = scheduleSong(song, speed, COUNT_IN);
  const spb = 60 / (song.bpm * speed);
  const start = ctx.currentTime + 0.15;
  pending = [];
  run = {
    song, events, demo, mode, spb,
    songRun: new SongRun(events, mode, CONFIG.timing, JUDGE_DELAY),
    songTime: -0.15, lastCtx: ctx.currentTime, history: [], clicks: [], scheduled: new Set(), lastBeat: COUNT_IN - 1,
    done: false, random: seededRandom(42),
  };
  for (let i = 0; i < COUNT_IN; i++) {
    click(start + i * spb, i === 0);
  }
  if (demo && micSource) {
    micSource.disconnect();
  }
  $("start").disabled = true;
  $("demo").disabled = true;
  $("stop").disabled = false;
  $("results").hidden = true;
  feedback(demo
    ? "Demo: the page is strumming the chords itself, into the same judge your guitar goes to."
    : `Count-in: ${COUNT_IN} clicks, then ${esc(events[0].chord)} on the next beat.`);
  updateScore();
}

function stopRun(finished) {
  if (!run) {
    return;
  }
  run.done = true;
  if (run.demo && micSource) {
    micSource.connect(analyser);
  }
  $("start").disabled = false;
  $("demo").disabled = false;
  $("stop").disabled = true;
  showResults(finished);
}

// Song time for a past moment, from the clock's recent history (the clock can hold, so it is not just an offset).
function songTimeAt(ctxTime) {
  const h = run.history;
  if (!h.length) {
    return run.songTime;
  }
  if (ctxTime <= h[0][0]) {
    return h[0][1] - (h[0][0] - ctxTime);
  }
  for (let i = h.length - 1; i > 0; i--) {
    if (h[i - 1][0] <= ctxTime) {
      const [c0, s0] = h[i - 1];
      const [c1, s1] = h[i];
      return c1 === c0 ? s1 : s0 + ((s1 - s0) * (ctxTime - c0)) / (c1 - c0);
    }
  }
  return run.songTime;
}

function runFrame(now) {
  const dt = now - run.lastCtx;
  run.lastCtx = now;
  const listening = pending.length > 0;
  run.songTime = run.songRun.holdTime(run.songTime + dt, listening ? JUDGE_DELAY : 0);
  run.history.push([now, run.songTime]);
  while (run.history.length > 2 && run.history[0][0] < now - 4) {
    run.history.shift();
  }
  for (const i of run.songRun.advance(run.songTime)) {
    banner("miss", "miss");
    feedback(`<span class="bad">Missed ${esc(run.events[i].chord)}.</span>`);
    updateScore();
  }
  // Click every beat (after the count-in) when asked.
  const beat = Math.floor(run.songTime / run.spb + 1e-6);
  if (beat > run.lastBeat) {
    run.lastBeat = beat;
    if ($("metronome").checked && !run.demo) {
      click(now + 0.01, false);
    }
  }
  // Demo: strum each chord on its beat, give or take 30 ms.
  if (run.demo) {
    run.events.forEach((e, i) => {
      if (!run.scheduled.has(i) && e.time - run.songTime < 0.4) {
        run.scheduled.add(i);
        const jitter = (run.random() - 0.5) * 0.06;
        const s = strum(SHAPES[e.chord], ctx.sampleRate, {
          seconds: Math.min(2.5, e.duration + 0.3), staggerMs: 12, decay: 0.996, detuneCents: 0, seed: i + 1,
        });
        playSamples(s, now + Math.max(0, e.time - run.songTime + jitter), true);
      }
    });
  }
  const i = run.songRun.current();
  showNext(i >= 0 ? run.events[i].chord : null);
  const last = run.events[run.events.length - 1];
  if (run.songRun.finished() && !pending.length && run.songTime > last.time + Math.min(last.duration, 1)) {
    stopRun(true);
  }
}

let shownNext = null;
function showNext(chord) {
  if (chord === shownNext) {
    return;
  }
  shownNext = chord;
  $("next-diagram").innerHTML = chord ? diagramSVG(chord) : "";
}

function updateScore() {
  if (!run) {
    return;
  }
  const done = run.songRun.events.filter((e) => e.state !== "due").length;
  $("points").textContent = run.songRun.points;
  $("streak").textContent = run.songRun.streak;
  $("progress").textContent = `${done} / ${run.events.length}`;
}

function showResults(finished) {
  const r = run.songRun.results();
  const lines = Object.entries(r.perChord).map(([chord, c]) => {
    const parts = [`${c.hits} hit`];
    if (c.misses) {
      parts.push(`${c.misses} missed`);
    }
    if (c.wrong) {
      parts.push(`${c.wrong} wrong strum${c.wrong > 1 ? "s" : ""}`);
    }
    return `<li><strong>${esc(chord)}</strong>: ${parts.join(", ")}</li>`;
  });
  const slow = run.mode === "wait" && r.slowest && r.slowest.seconds > 0.3
    ? `<p>Slowest change: to <strong>${esc(r.slowest.chord)}</strong>, ${r.slowest.seconds.toFixed(1)} s after its beat.</p>` : "";
  $("results-body").innerHTML = `
    <p>${finished ? "" : "Stopped early. "}${run.demo ? "Demo run (the page played). " : ""}
      <strong>${r.points}</strong> points, ${r.hits} of ${r.total} chords (${Math.round(r.accuracy * 100)}%), best streak ${r.bestStreak}.</p>
    <ul>${lines.join("")}</ul>
    ${slow}
    ${r.practise ? `<p>Practise next: <button type="button" id="go-practise">${esc(r.practise)}</button></p>` : ""}`;
  $("results").hidden = false;
  const go = $("go-practise");
  if (go) {
    go.addEventListener("click", () => {
      practiseChord = r.practise;
      setTab("practise");
    });
  }
}

// ---------- the lane ----------
function drawLane(now) {
  const canvas = $("lane");
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const hitY = h * 0.8;
  if (!run) {
    g.fillStyle = color("--dim");
    g.font = "600 18px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("Chords come down here.", w / 2, h * 0.45);
    g.fillText("Strum each one as it reaches the line.", w / 2, h * 0.45 + 26);
    drawHitLine(g, w, hitY, color);
    return;
  }
  const lookahead = Math.min(6, Math.max(3, run.spb * 6));
  const pps = hitY / lookahead;
  const t = run.songTime;
  // Beat lines.
  g.strokeStyle = color("--line");
  g.lineWidth = 1;
  for (let b = Math.ceil((t - 1) / run.spb); b * run.spb < t + lookahead; b++) {
    const y = hitY - (b * run.spb - t) * pps;
    g.beginPath();
    g.moveTo(w * 0.1, y);
    g.lineTo(w * 0.9, y);
    g.stroke();
  }
  const cur = run.songRun.current();
  run.songRun.events.forEach((e, i) => {
    const bottom = hitY - (e.time - t) * pps;
    const top = bottom - e.duration * pps + 6;
    if (top > h || bottom < -10) {
      return;
    }
    const fill = e.state === "hit" ? color("--good") : e.state === "miss" ? color("--bad") : i === cur ? color("--accent") : color("--panel-2");
    g.fillStyle = fill;
    g.globalAlpha = e.state === "due" && i !== cur ? 1 : 0.9;
    roundRect(g, w * 0.14, top, w * 0.72, Math.max(8, bottom - top), 10);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = i === cur || e.state !== "due" ? color("--accent-ink") : color("--fg");
    g.font = `800 ${Math.min(40, Math.max(18, (bottom - top) * 0.5))}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillText(e.chord, w / 2, bottom - 6);
  });
  drawHitLine(g, w, hitY, color);
  if (t < run.events[0].time) {
    const left = Math.ceil((run.events[0].time - t) / run.spb);
    g.fillStyle = color("--fg");
    g.font = "800 44px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(Math.max(1, left)), w / 2, h * 0.35);
  }
}

function drawHitLine(g, w, y, color) {
  g.strokeStyle = color("--fg");
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(w * 0.06, y);
  g.lineTo(w * 0.94, y);
  g.stroke();
  g.font = "700 11px system-ui, sans-serif";
  g.textAlign = "left";
  g.textBaseline = "top";
  const label = "STRUM HERE";
  const lw = g.measureText(label).width + 12;
  g.fillStyle = color("--fg");
  roundRect(g, w * 0.06, y + 5, lw, 18, 4);
  g.fill();
  g.fillStyle = color("--bg");
  g.fillText(label, w * 0.06 + 6, y + 9);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------- chord diagrams ----------
function diagramSVG(name) {
  const shape = SHAPES[name];
  const W = 212;
  const left = 50;
  const right = 182;
  const top = 64;
  const fretH = 38;
  const frets = 4;
  const gap = (right - left) / 5;
  const sx = (i) => left + i * gap;
  const parts = [];
  parts.push(`<text x="${(left + right) / 2}" y="30" text-anchor="middle" font-size="28" font-weight="800" fill="var(--fg)">${esc(name)}</text>`);
  if (shape.note) {
    parts.push(`<text x="${(left + right) / 2}" y="47" text-anchor="middle" font-size="11" fill="var(--dim)">${esc(shape.note)}</text>`);
  }
  for (let f = 0; f <= frets; f++) {
    const y = top + f * fretH;
    parts.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="var(--string)" stroke-width="${f === 0 ? 6 : 1.5}"/>`);
  }
  for (let s = 0; s < 6; s++) {
    parts.push(`<line x1="${sx(s)}" y1="${top}" x2="${sx(s)}" y2="${top + frets * fretH}" stroke="var(--string)" stroke-width="${1 + (5 - s) * 0.35}"/>`);
    const fret = shape.frets[s];
    if (fret < 0) {
      parts.push(`<text x="${sx(s)}" y="${top - 9}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--bad)">×</text>`);
    } else if (fret === 0) {
      parts.push(`<circle cx="${sx(s)}" cy="${top - 14}" r="6" fill="none" stroke="var(--fg)" stroke-width="2"/>`);
    } else {
      const cy = top + (fret - 0.5) * fretH;
      parts.push(`<circle cx="${sx(s)}" cy="${cy}" r="13" fill="var(--accent)"/>`);
      parts.push(`<text x="${sx(s)}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="800" fill="var(--accent-ink)">${shape.fingers[s]}</text>`);
    }
    parts.push(`<text x="${sx(s)}" y="${top + frets * fretH + 20}" text-anchor="middle" font-size="12" fill="var(--dim)">${STRING_NAMES[s]}</text>`);
  }
  for (let f = 1; f <= frets; f++) {
    parts.push(`<text x="${left - 32}" y="${top + (f - 0.5) * fretH + 4}" text-anchor="middle" font-size="11" fill="var(--dim)">${f}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${top + frets * fretH + 30}" role="img" aria-label="${esc(name)} chord: ${describe(name)}">${parts.join("")}</svg>`;
}

function describe(name) {
  const shape = SHAPES[name];
  return shape.frets
    .map((fret, s) => {
      const str = `${STRING_NAMES[s]} string`;
      if (fret < 0) {
        return `${str} not played`;
      }
      if (fret === 0) {
        return `${str} open`;
      }
      return `${str} fret ${fret}, finger ${shape.fingers[s]}`;
    })
    .join("; ");
}

// ---------- practise ----------
function buildPractise() {
  const picker = $("chord-picker");
  picker.innerHTML = "";
  for (const name of Object.keys(SHAPES)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.setAttribute("aria-pressed", String(name === practiseChord));
    b.addEventListener("click", () => {
      practiseChord = name;
      renderPractise();
    });
    picker.appendChild(b);
  }
  renderPractise();
}

function renderPractise() {
  for (const b of $("chord-picker").children) {
    b.setAttribute("aria-pressed", String(b.textContent === practiseChord));
  }
  $("big-diagram").innerHTML = diagramSVG(practiseChord);
  $("practise-feedback").textContent = micStream ? `Strum ${practiseChord}.` : `Turn the mic on, then strum ${practiseChord}.`;
  renderBars(null);
}

function chordPcs(name) {
  const s = SHAPES[name];
  return chordPitchClasses(s.root, s.quality === "7" ? "7" : s.quality);
}

function renderBars(chroma) {
  const pcs = chordPcs(practiseChord);
  $("bars").innerHTML = NOTE_NAMES.map((n, i) => {
    const h = chroma ? Math.round(chroma[i] * 100) : 0;
    return `<div class="bar${pcs.includes(i) ? " in" : ""}"><i style="height:${h}%"></i><span>${n}</span></div>`;
  }).join("");
}

function showPractise(verdict) {
  const fb = $("practise-feedback");
  if (!verdict) {
    fb.innerHTML = '<span class="bad">Too quiet to read.</span> Strum a little harder.';
    return;
  }
  renderBars(verdict.chroma);
  const quiet = quietNotes(verdict.chroma, chordPcs(practiseChord), A.quietRatio);
  if (verdict.name === practiseChord) {
    fb.innerHTML = `<span class="good">${esc(practiseChord)}: right.</span>${quiet.length ? ` Quiet: ${quiet.join(", ")}.` : " Every note rang."}`;
    learnShape(practiseChord, ctx.currentTime - CONFIG.strum.judgeToMs / 1000);
  } else {
    const heard = verdict.name ? `Heard ${esc(verdict.name)}` : "Not a chord I know";
    fb.innerHTML = `<span class="bad">${heard}, wanted ${esc(practiseChord)}.</span>${quiet.length ? ` Missing or quiet: ${quiet.join(", ")}: check the strings that play ${quiet.length > 1 ? "them" : "it"}.` : ""}`;
  }
}

// ---------- tuner ----------
function buildStrings() {
  const box = $("strings");
  OPEN_STRINGS.forEach((midi, s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${STRING_NAMES[s]} ${noteName(midi)}`;
    b.addEventListener("click", async () => {
      await ensureAudio();
      const hz = 440 * Math.pow(2, (midi - 69) / 12);
      const end = playSamples(pluck(hz, ctx.sampleRate, 2, 0.997, seededRandom(s + 1)), ctx.currentTime + 0.02, false);
      gateFor(end - ctx.currentTime + 0.1);
    });
    box.appendChild(b);
  });
}

function tuneFrame() {
  if (!micStream || ctx.currentTime < gateUntil) {
    return;
  }
  const hz = detectPitch(buf.subarray(buf.length - 4096), ctx.sampleRate, CONFIG.tuner);
  if (!hz) {
    return;
  }
  tunerReadings.push(hzToMidi(hz));
  if (tunerReadings.length > 5) {
    tunerReadings.shift();
  }
  const midi = tunerReadings.slice().sort((a, b) => a - b)[Math.floor(tunerReadings.length / 2)];
  let s = 0;
  OPEN_STRINGS.forEach((m, i) => {
    if (Math.abs(midi - m) < Math.abs(midi - OPEN_STRINGS[s])) {
      s = i;
    }
  });
  const cents = Math.round((midi - OPEN_STRINGS[s]) * 100);
  $("tune-note").textContent = noteName(midi);
  const needle = $("tune-needle");
  needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
  needle.className = `needle ${Math.abs(cents) <= 5 ? "in" : "off"}`;
  if (Math.abs(cents) > 250) {
    $("tune-text").textContent = `${noteName(midi)} is not near an open string.`;
  } else if (Math.abs(cents) <= 5) {
    $("tune-text").textContent = `${STRING_NAMES[s]} string: in tune (${cents >= 0 ? "+" : ""}${cents} cents).`;
  } else {
    $("tune-text").textContent = `${STRING_NAMES[s]} string: ${Math.abs(cents)} cents ${cents > 0 ? "sharp, loosen it" : "flat, tighten it"}.`;
  }
}

// ---------- camera ----------
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

function shapeStatus(text) {
  $("shape-status").textContent = text;
}

async function toggleCamera() {
  if (cam.stream) {
    cam.stream.getTracks().forEach((t) => t.stop());
    cam.stream = null;
    $("cam-wrap").hidden = true;
    $("cam-btn").textContent = "Turn on camera";
    shapeStatus("Camera off. The game plays on sound alone.");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    shapeStatus("This browser gives the page no camera. The game plays on sound alone.");
    return;
  }
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (e) {
    shapeStatus(`The camera could not start (${e.name}: ${e.message}). The game plays on sound alone.`);
    return;
  }
  const video = $("video");
  video.srcObject = cam.stream;
  await video.play();
  $("cam-wrap").hidden = false;
  $("cam-btn").textContent = "Turn off camera";
  if (cam.landmarker) {
    return;
  }
  shapeStatus("Loading the hand tracker (about 8 MB, once)...");
  try {
    const vision = await import(MP_BUNDLE);
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
    const make = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MP_MODEL, delegate },
      runningMode: "VIDEO",
      numHands: 2,
    });
    try {
      cam.landmarker = await make("GPU");
      cam.delegate = "GPU";
    } catch (gpuError) {
      cam.landmarker = await make("CPU");
      cam.delegate = `CPU (the GPU path failed: ${gpuError.message})`;
    }
    shapeStatus(`Hand tracker ready on ${cam.delegate}. Hold the guitar so both hands are in view.`);
  } catch (e) {
    shapeStatus(`The hand tracker could not load (${e.message}). The game plays on sound alone.`);
  }
}

function cameraFrame(now) {
  const video = $("video");
  if (!cam.stream || !cam.landmarker || video.readyState < 2 || video.currentTime === cam.lastVideoTime) {
    return;
  }
  cam.lastVideoTime = video.currentTime;
  const res = cam.landmarker.detectForVideo(video, performance.now());
  const all = res.landmarks || [];
  const hand = pickChordHand(all, $("lefty").checked);
  cam.hand = hand;
  if (hand) {
    const vec = shapeVector(hand);
    if (vec) {
      cam.recent.push({ t: now, vec });
    }
  }
  while (cam.recent.length && cam.recent[0].t < now - 2) {
    cam.recent.shift();
  }
  drawHands(all, hand);
  if (now - cam.statusAt > 0.25) {
    cam.statusAt = now;
    updateShapeStatus(now);
  }
}

function drawHands(all, chordHand) {
  const canvas = $("overlay");
  const video = $("video");
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  for (const hand of all) {
    const main = hand === chordHand;
    g.strokeStyle = main ? css.getPropertyValue("--accent").trim() : "rgba(255,255,255,0.35)";
    g.lineWidth = main ? 4 : 2;
    for (const [a, b] of HAND_LINKS) {
      g.beginPath();
      g.moveTo(hand[a].x * w, hand[a].y * h);
      g.lineTo(hand[b].x * w, hand[b].y * h);
      g.stroke();
    }
    g.fillStyle = g.strokeStyle;
    for (const p of hand) {
      g.beginPath();
      g.arc(p.x * w, p.y * h, main ? 5 : 3, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function targetChord() {
  if (run && !run.done) {
    const i = run.songRun.current();
    return i >= 0 ? run.events[i].chord : null;
  }
  return tab === "practise" ? practiseChord : null;
}

function updateShapeStatus(now) {
  if (!cam.landmarker) {
    return;
  }
  const target = targetChord();
  const learned = memory.learned();
  if (!cam.hand) {
    shapeStatus("Chord hand not in view (the outlined hand is the one it watches; tick Left-handed if it picks the wrong one).");
    return;
  }
  if (!learned.length) {
    shapeStatus("Learning your hand: each chord the mic hears right, the camera remembers your hand's shape for it.");
    return;
  }
  const latest = cam.recent[cam.recent.length - 1];
  const r = memory.classify(latest.vec);
  const known = `Knows your shapes for: ${learned.join(", ")}.`;
  if (!target) {
    shapeStatus(`${known} Your hand looks most like ${r.chord}.`);
  } else if (!learned.includes(target)) {
    shapeStatus(`${known} ${target} not learned yet: play it right once.`);
  } else if (r.clear === null) {
    shapeStatus(`${known} Needs a second chord to compare against.`);
  } else if (r.chord === target && r.clear) {
    shapeStatus(`Shape: ${target} ready. ${known}`);
  } else if (r.clear) {
    shapeStatus(`Shape looks like ${r.chord}, not ${target} yet. ${known}`);
  } else {
    shapeStatus(`Shape: not sure, between ${r.chord} and others. ${known}`);
  }
}

// S7: the hand shape a moment after a strum the mic heard right.
function learnShape(chord, onset) {
  if (!cam.landmarker || !cam.recent.length) {
    return;
  }
  const want = onset + 0.2;
  let best = null;
  for (const r of cam.recent) {
    if (!best || Math.abs(r.t - want) < Math.abs(best.t - want)) {
      best = r;
    }
  }
  if (best && Math.abs(best.t - want) < 0.5) {
    memory.learn(chord, best.vec);
    saveMemory();
  }
}

// ---------- tabs and setup ----------
function setTab(name) {
  tab = name;
  for (const b of document.querySelectorAll(".tabs button")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === name));
  }
  for (const id of ["play", "practise", "tune"]) {
    $(`tab-${id}`).hidden = id !== name;
  }
  if (name === "practise") {
    renderPractise();
  }
}

function setup() {
  const select = $("song");
  for (const s of SONGS) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.title} (${s.level}, ${[...new Set(s.chords.map(([c]) => c))].join(" ")})`;
    select.appendChild(o);
  }
  select.addEventListener("change", () => {
    const s = SONGS.find((x) => x.id === select.value);
    if (!run || run.done) {
      showNext(s.chords[0][0]);
    }
  });
  showNext(SONGS[0].chords[0][0]);
  $("mic-btn").addEventListener("click", toggleMic);
  $("cam-btn").addEventListener("click", toggleCamera);
  $("start").addEventListener("click", () => startRun(false));
  $("demo").addEventListener("click", () => startRun(true));
  $("stop").addEventListener("click", () => stopRun(false));
  $("listen").addEventListener("click", () => listen(practiseChord));
  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => setTab(b.dataset.tab));
  }
  buildPractise();
  buildStrings();
  drawLane(0);
  window.addEventListener("resize", () => drawLane(0));
  if (memory.learned().length) {
    shapeStatus(`Camera off. Remembered shapes from last time: ${memory.learned().join(", ")}.`);
  }
}

setup();

// For the page check (test/guitar_check): read-only views of the game state.
window.__chordTrainer = {
  state: () => ({
    run: run && { done: run.done, demo: run.demo, songTime: run.songTime, results: run.songRun.results(),
      events: run.songRun.events.map((e) => ({ chord: e.chord, state: e.state, grade: e.grade })) },
    tab,
    sampleRate: ctx && ctx.sampleRate,
    tracker: cam.landmarker ? cam.delegate : null,
  }),
};
