// Juke Box Legend: the page. Holds the screens, the seats, the loop, and the two
// kinds of player — phones on the frets, and one voice on this machine's microphone.
//
// Everything with a rule in it lives in js/ and is tested in Node. This file is the
// wiring: DOM, the relay, the microphone, and the frame.
import { buildGems, parseSong } from "./js/chart.js";
import {
  STAR_NEEDED, activateStar, activeMultiplier, advance, createPlay,
  multiplierFor, press, release, starReady, summary,
} from "./js/scoring.js";
import { createTracker, dropSeat, lanesDownFromKeys, readPads, update, LANE_KEYS, STAR_KEYS } from "./js/input.js";
import { createVocals, feed as feedVocals, finish as finishVocals } from "./js/vocals.js";
import { detectPitch } from "../karaoke/js/pitch.js";
import { Scene, build, camera } from "./js/scene.js";
import { viewProjection } from "./js/mat4.js";
import { pickBackend } from "./js/backend.js";
import { createAudio } from "./js/audio.js";

const RELAY = "https://phonepad-relay.tami-play.workers.dev";
const SEATS = 4;
const KEYBOARD_SEAT = 99;          // the player at this machine, not on a phone
const COUNT_IN = 3;                // seconds of countdown before the song starts
// Matches karaoke/config.json; the detector is that page's, already covered by its tests.
const PITCH = { pitchMinHz: 80, pitchMaxHz: 1000, yinThreshold: 0.15, minRms: 0.01, window: 1024 };
const SMOOTHING = 5;

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"), join: $("join"), hud: $("hud"), results: $("results"),
  qr: $("qr"), code: $("code"), joinhost: $("joinhost"), joinhere: $("joinhere"), padserr: $("padserr"),
  seatlist: $("seatlist"), usemic: $("usemic"), micnote: $("micnote"), play: $("play"),
  songline: $("songline"), rendernote: $("rendernote"), hudseats: $("hudseats"),
  lyric: $("lyric"), countdown: $("countdown"), quit: $("quit"),
  scoreboard: $("scoreboard"), again: $("again"), back: $("back"),
};

const app = {
  song: null, gems: null,
  pads: null, backend: null, scene: new Scene(),
  roles: new Map([[KEYBOARD_SEAT, "guitar"]]),   // seat -> "guitar" | "vocals" | "out"
  known: new Set(),                               // seats that have ever appeared
  keyboardIn: false,
  tracker: createTracker(),
  keys: new Set(),
  play: null, audio: null, vocalState: null, vocalSeat: null,
  mic: { stream: null, analyser: null, buffer: null, recent: [] },
  effects: [], running: false, startedAt: 0, raf: 0, lyricIndex: -1,
};

// ---------------------------------------------------------------- screens
function show(which) {
  els.join.hidden = which !== "join";
  els.results.hidden = which !== "results";
  els.hud.hidden = which !== "play";
  document.body.dataset.screen = which;
}

// ---------------------------------------------------------------- seats
function seatName(seat) {
  return seat === KEYBOARD_SEAT ? "Keyboard" : `Player ${seat}`;
}

// The seats that will actually play, in a stable order.
function activeSeats() {
  const out = [];
  for (const seat of [...app.known].sort((a, b) => a - b)) {
    const role = app.roles.get(seat);
    if (role === "guitar" || role === "vocals") out.push({ id: seat, role, name: seatName(seat) });
  }
  return out;
}

function renderSeats() {
  const seats = [...app.known].sort((a, b) => a - b);
  els.seatlist.replaceChildren();
  if (!seats.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.innerHTML = 'Nobody yet. Scan the code, or press <kbd>K</kbd> to play on this keyboard.';
    els.seatlist.append(li);
  }
  for (const seat of seats) {
    const li = document.createElement("li");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = seatName(seat);
    const rtt = document.createElement("span");
    rtt.className = "rtt";
    const ms = app.pads && app.pads.rtt ? app.pads.rtt.get(seat) : null;
    rtt.textContent = ms ? `${Math.round(ms)} ms` : "";
    const role = document.createElement("span");
    role.className = "role";
    for (const [value, label] of [["guitar", "Guitar"], ["vocals", "Sing"], ["out", "Sit out"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-pressed", String(app.roles.get(seat) === value));
      b.addEventListener("click", () => {
        // Only one voice: this machine has one microphone.
        if (value === "vocals") {
          for (const [s, r] of app.roles) if (r === "vocals" && s !== seat) app.roles.set(s, "guitar");
          els.usemic.checked = true;
        }
        app.roles.set(seat, value);
        renderSeats();
      });
      role.append(b);
    }
    li.append(who, rtt, role);
    els.seatlist.append(li);
  }
  const ready = activeSeats().length > 0;
  els.play.disabled = !ready || !app.song;
  els.play.textContent = ready ? "Start the song" : "Waiting for a player";
}

function noticeSeat(seat) {
  if (app.known.has(seat)) return;
  app.known.add(seat);
  if (!app.roles.has(seat)) app.roles.set(seat, "guitar");
  renderSeats();
}

// ---------------------------------------------------------------- the microphone
async function openMic() {
  if (app.mic.analyser) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    els.micnote.textContent = "This browser has no microphone API, so nobody can sing.";
    return false;
  }
  try {
    const ctx = app.audio ? app.audio.context : new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    app.mic = { stream, analyser, buffer: new Float32Array(analyser.fftSize), recent: [] };
    els.micnote.textContent = "Microphone is on. Headphones help, so the speakers do not sing along.";
    return true;
  } catch (e) {
    els.micnote.textContent = `Microphone not available (${e.name}). The guitars still work.`;
    return false;
  }
}

function readVoice() {
  const { analyser, buffer } = app.mic;
  if (!analyser) return null;
  analyser.getFloatTimeDomainData(buffer);
  const hz = detectPitch(buffer, app.audio.context.sampleRate, PITCH);
  // A short median smooths the reading without letting it lag the singer.
  if (hz === null) { app.mic.recent.length = 0; return null; }
  app.mic.recent.push(hz);
  if (app.mic.recent.length > SMOOTHING) app.mic.recent.shift();
  const sorted = [...app.mic.recent].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

// ---------------------------------------------------------------- the frame
function hudFor(seat) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.seat = String(seat.id);
  card.innerHTML = `<div class="name"></div><div class="score">0</div>
    <div class="combo"></div><div class="meter"><i></i></div>`;
  return card;
}

function renderHud() {
  for (const card of els.hudseats.children) {
    const seat = app.play.seats.get(Number(card.dataset.seat));
    if (!seat) continue;
    const star = seat.starUntil > app.play.time;
    card.querySelector(".name").textContent = `${seat.name}${seat.role === "vocals" ? " - voice" : ""}`;
    card.querySelector(".score").textContent = Math.round(seat.score).toLocaleString();
    const mult = activeMultiplier(app.play, seat);
    card.querySelector(".combo").innerHTML = seat.combo > 0
      ? `${seat.combo} in a row &middot; <b>${mult}x</b>`
      : (starReady(seat) ? "<b>star power ready</b>" : `<b>${mult}x</b>`);
    card.classList.toggle("star", star);
    card.querySelector(".meter i").style.width =
      `${Math.round(100 * (star ? 1 : Math.min(1, seat.starCharge / STAR_NEEDED)))}%`;
  }
}

function showLyric(t) {
  const lines = app.song.lyrics;
  let i = -1;
  for (let k = 0; k < lines.length; k++) if (lines[k].t <= t) i = k; else break;
  if (i === app.lyricIndex) return;
  app.lyricIndex = i;
  els.lyric.textContent = i >= 0 ? lines[i].text : "";
}

function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(window.innerWidth * dpr));
  const h = Math.max(1, Math.round(window.innerHeight * dpr));
  if (els.stage.width !== w || els.stage.height !== h) {
    els.stage.width = w;
    els.stage.height = h;
  }
  return { w, h };
}

function frame() {
  if (!app.running) return;
  app.raf = requestAnimationFrame(frame);
  const t = app.audio.now();

  if (t < 0) {
    els.countdown.hidden = false;
    els.countdown.textContent = String(Math.max(1, Math.ceil(-t)));
  } else if (!els.countdown.hidden) {
    els.countdown.hidden = true;
  }

  // Input first, so a press this frame is judged against this frame's clock.
  if (t >= 0) {
    const fromPads = readPads(() => navigator.getGamepads());
    for (const [seat, snapshot] of fromPads) {
      noticeSeat(seat);
      if (app.roles.get(seat) !== "guitar") continue;
      handle(update(app.tracker, seat, snapshot.down, snapshot), t);
    }
    // A phone that slept stops holding its lanes.
    for (const seat of [...app.tracker.seats.keys()]) {
      if (seat !== KEYBOARD_SEAT && !fromPads.has(seat)) {
        for (const lane of dropSeat(app.tracker, seat).released) release(app.play, seat, lane, t);
      }
    }
    pumpKeyboard(t);
    advance(app.play, t);
    if (app.vocalSeat !== null) {
      feedVocals(app.vocalState, app.play, app.vocalSeat, readVoice(), t);
    }
  }

  // Draw.
  const { w, h } = sizeCanvas();
  const lead = app.play.seats.get(leadSeatId());
  const starLit = !!(lead && lead.starUntil > app.play.time);
  build(app.scene, {
    song: app.song, gems: app.gems, now: Math.max(0, t),
    held: app.tracker.seats.get(leadSeatId())?.lanes || new Set(),
    settled: lead && lead.role === "guitar" ? lead.settled : new Set(),
    effects: app.effects, vocalState: app.vocalState, seat: lead,
  });
  const cam = camera(app.song, Math.max(0, t), { starLit });
  app.backend.draw(app.scene, viewProjection(cam.eye, cam.target, cam.up, cam.fov, w / h, cam.near, cam.far, app.backend.depth01), w, h);

  if (app.effects.length > 40) app.effects = app.effects.slice(-24);
  renderHud();
  showLyric(t);

  if (t > app.song.duration + 1.5) finishSong();
}

// Which seat the highway is drawn for: the first guitar seat, since everyone reads
// the same chart. The gems clear as that player catches them.
function leadSeatId() {
  for (const s of activeSeats()) if (s.role === "guitar") return s.id;
  return activeSeats()[0]?.id ?? KEYBOARD_SEAT;
}

function handle(ev, t) {
  for (const lane of ev.pressed) {
    const r = press(app.play, ev.seat, lane, t);
    app.effects.push({ lane, at: t, kind: r.verdict ? "hit" : "miss" });
  }
  for (const lane of ev.released) release(app.play, ev.seat, lane, t);
  if (ev.star) activateStar(app.play, ev.seat, t);
}

// ---------------------------------------------------------------- start and stop
async function startSong() {
  const seats = activeSeats();
  if (!seats.length) return;
  const singer = seats.find((s) => s.role === "vocals");
  if (singer && !(await openMic())) {
    // No microphone: that seat plays guitar instead rather than sitting silent.
    app.roles.set(singer.id, "guitar");
    renderSeats();
  }
  const final = activeSeats();
  app.play = createPlay(app.song, app.gems, final);
  app.vocalSeat = final.find((s) => s.role === "vocals")?.id ?? null;
  app.vocalState = createVocals(app.song);
  app.effects = [];
  app.lyricIndex = -2;
  app.tracker = createTracker();

  els.hudseats.replaceChildren(...final.map(hudFor));
  show("play");

  app.audio = createAudio(app.song);
  if (app.vocalSeat !== null) await openMic();
  await app.audio.start(-COUNT_IN);
  app.running = true;
  app.raf = requestAnimationFrame(frame);
}

function finishSong() {
  if (!app.running) return;
  app.running = false;
  cancelAnimationFrame(app.raf);
  if (app.vocalSeat !== null) finishVocals(app.vocalState, app.play, app.vocalSeat);
  if (app.audio) app.audio.stop();
  els.scoreboard.replaceChildren();
  summary(app.play).forEach((row, i) => {
    const li = document.createElement("li");
    const pct = Math.round(row.accuracy * 100);
    li.innerHTML = `<span class="rank">${i + 1}</span>
      <span><b>${row.name}</b>${row.role === "vocals" ? " - voice" : ""}
        <span class="detail">${pct}% caught &middot; best run ${row.bestCombo}
        &middot; ${row.hits.perfect} perfect, ${row.hits.great} great, ${row.hits.good} good, ${row.hits.miss} missed</span></span>
      <span class="pts">${row.score.toLocaleString()}</span>`;
    els.scoreboard.append(li);
  });
  show("results");
}

// ---------------------------------------------------------------- boot
async function boot() {
  show("join");
  // The song.
  try {
    app.song = parseSong(await (await fetch("songs/neon-run.json")).json());
    app.gems = buildGems(app.song);
    els.songline.textContent = `${app.song.title} - ${app.song.artist} - ${app.song.bpm} bpm, ${app.gems.length} notes`;
  } catch (e) {
    els.songline.textContent = `The song did not load: ${e.message}`;
    return;
  }

  // The renderer.
  try {
    const picked = await pickBackend(els.stage, new URLSearchParams(location.search).get("backend") || "auto");
    app.backend = picked.backend;
    els.rendernote.textContent = `Drawing with ${picked.backend.name}. ${picked.why}`;
  } catch (e) {
    els.rendernote.textContent = `Nothing can draw the highway here: ${e.message}`;
    els.play.disabled = true;
    return;
  }

  // The phones.
  try {
    const { PhonePad } = await import(/* webpackIgnore: true */ `${RELAY}/phonepad-host.js`);
    app.pads = await PhonePad.start({ relay: RELAY, layout: "pad", seats: SEATS });
    app.pads.drawQR(els.qr, 8);
    els.code.textContent = app.pads.code;
    els.joinhost.textContent = new URL(app.pads.join).host;
    els.joinhere.href = app.pads.join;
    // Name the buttons for this game where the relay supports it; a layout it does
    // not recognise just leaves the default labels on the phone.
    try {
      app.pads.layout("pad", { dpadLeft: "GREEN", dpadUp: "RED", dpadRight: "YELLOW", X: "BLUE", A: "ORANGE", Y: "STAR" });
    } catch { /* the phone keeps its usual labels */ }
    window.addEventListener("pagehide", () => app.pads.close());
    setInterval(() => {
      for (const seat of readPads(() => navigator.getGamepads()).keys()) noticeSeat(seat);
      if (!els.join.hidden) renderSeats();
    }, 700);
  } catch (e) {
    els.padserr.hidden = false;
    els.padserr.textContent = `No phones: the relay could not open a room (${e.message}). Press K to play on this keyboard.`;
  }
  renderSeats();
}

// Keys: the desk player, and K to take a seat.
// Feed the keyboard seat's current keys in at `t`. Called from the key handlers, so a
// press is judged at the moment it happened, and once more each frame as a safety net
// for a key held across frames (which produces no edge and so costs nothing).
function pumpKeyboard(t) {
  if (!app.running || !app.keyboardIn || app.roles.get(KEYBOARD_SEAT) !== "guitar") return;
  handle(update(app.tracker, KEYBOARD_SEAT, lanesDownFromKeys(app.keys), {
    starDown: STAR_KEYS.some((k) => app.keys.has(k)),
  }), Math.max(0, t));
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyK" && !els.join.hidden) {
    app.keyboardIn = !app.keyboardIn;
    if (app.keyboardIn) noticeSeat(KEYBOARD_SEAT); else { app.known.delete(KEYBOARD_SEAT); renderSeats(); }
    return;
  }
  if (LANE_KEYS.flat().includes(e.code) || STAR_KEYS.includes(e.code)) {
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) return;                       // auto-repeat is not a new strum
    app.keys.add(e.code);
    if (app.running) pumpKeyboard(app.audio.now());
  }
  if (e.code === "Escape" && app.running) finishSong();
});
window.addEventListener("keyup", (e) => {
  if (!app.keys.delete(e.code)) return;
  if (app.running) pumpKeyboard(app.audio.now());
});
window.addEventListener("blur", () => {
  app.keys.clear();
  if (app.running) pumpKeyboard(app.audio.now());
});

els.play.addEventListener("click", startSong);
els.quit.addEventListener("click", finishSong);
els.again.addEventListener("click", startSong);
els.back.addEventListener("click", () => { show("join"); renderSeats(); });
els.usemic.addEventListener("change", () => { if (els.usemic.checked) openMic(); });

// The live game, for the browser test in tests/game.browser.mjs and for poking at a
// running song from the console. Nothing in the game reads it back.
window.jukebox = app;

boot().catch((e) => { els.songline.textContent = `The page could not start: ${e.message}`; });
