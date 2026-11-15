// Duet Night: the co-op karaoke page. Two singers, one or two microphones, a note lane, a backing band,
// a team combo and hype bar, and a results screen.
// Serves: P1 to P7 (the public page), C1 to C9 (co-op), A1 to A3, A5, CA1, CA2, CA4, CA5.
// Nothing here fetches lyrics or a music player. Every song is an original written for this page.
import { detectPitch, foldSemitones, hzToMidi, midiToHz, noteName } from "./js/pitch.js";
import { buildPhrases, currentLineIndex, noteAt, parseSong } from "./js/phrases.js";
import { Team, isOnPitch, lineWord, linePart, micFor, singers } from "./js/coop.js";
import { bandEnd, bandEvents } from "./js/band.js";

const SONGS = ["songs/two-lanterns.json", "songs/road-trip-radio.json", "songs/harbour-moon.json", "demo-song.json"];
const COLOR = { 1: "#ff4fa3", 2: "#3fc8ff", both: "#ffd23f" };
const AHEAD = 4; // seconds of notes shown ahead of the now line (C4)
const BEHIND = 1.4; // seconds of trail shown behind it
const LOOKAHEAD = 0.25; // seconds of sound scheduled ahead of the clock (C3)

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(
  ["song", "mode", "name1", "name2", "find-mics", "mic1", "mic2", "level1", "level2", "band", "guide", "preview",
    "preview-wrap", "start", "stop", "restart", "demo", "score", "combo", "mult", "hype", "harmony", "lane", "banner",
    "lyric-now", "lyric-next", "status", "results", "res-title", "res-stars", "res-score", "res-hits", "res-combo",
    "res-share", "res-players", "res-note", "again", "swap", "file", "credit",
    "chip1-name", "chip1-arrow", "chip1-note", "chip1-gap", "chip2-name", "chip2-arrow", "chip2-note", "chip2-gap"]
    .map((id) => [id, $(id)]),
);
const AudioContextClass = window.AudioContext || window.webkitAudioContext;

const app = {
  cfg: null,
  pitchOptions: null,
  songs: [], // [{label, song}]
  song: null,
  phrases: [],
  notes: [], // every judged note, with id and phrase
  parts: [], // part per line for this mode (C1)
  range: { min: 55, max: 79 },
  mode: "duet",
  swap: false,
  team: null,
  playing: false,
  finished: false,
  demo: false,
  clockBase: 0,
  clockStart: 0,
  audio: null,
  bus: null, // gain node for this run's sounds; dropped on Stop so nothing scheduled keeps playing
  noise: null,
  scheduledTo: null,
  previewed: new Set(),
  mics: [], // [{id, stream, analyser, buffer, recent}]
  micIds: null,
  micError: null,
  devices: [],
  trails: { 1: [], 2: [] },
  sung: { 1: null, 2: null },
  nextClose: 0,
  wordShown: new Set(),
  popups: [],
  sparks: [],
  lineIndex: -2,
  lastFrame: 0,
};

const beat = () => (app.song && app.song.band ? 60 / app.song.band.bpm : 0.6);
const name = (p) => (p === 1 ? els.name1.value : els.name2.value).trim() || `Player ${p}`;
const partLabel = (part) => (part === "both" ? "Both" : name(part));
const setStatus = (msg) => { els.status.textContent = msg; };

function songTime() {
  return app.playing ? app.clockBase + (performance.now() - app.clockStart) / 1000 : app.clockBase;
}

function songEnd() {
  const last = app.notes.length ? app.notes[app.notes.length - 1].end + 1 : 0;
  return Math.max(last, app.song && app.song.band ? bandEnd(app.song.band) : 0);
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------- C1: song, mode, parts ----------

function applyParts() {
  app.mode = els.mode.value;
  app.parts = app.song.lines.map((line, i) => linePart(line, i, app.mode, app.swap));
  const two = app.mode !== "solo";
  document.querySelectorAll(".p2-only").forEach((el) => { el.hidden = !two; });
  document.querySelector(".name.p2").hidden = !two;
  els.swap.hidden = app.mode !== "duet";
}

function loadSong(song) {
  app.song = song;
  const built = buildPhrases(song.lines, song.notes, app.cfg.leadInSeconds, app.cfg.phraseTailSeconds);
  app.phrases = built.phrases;
  app.notes = built.phrases.flatMap((ph) => ph.notes).map((n, id) => ({ ...n, id }));
  const midis = app.notes.map((n) => n.midi);
  const lo = Math.min(...midis) - 3;
  const hi = Math.max(...midis) + 3;
  app.range = { min: lo, max: Math.max(hi, lo + 12) };
  els["preview-wrap"].hidden = song.preview === false;
  els.credit.textContent = song.credit || "";
  applyParts();
  restart();
  const unowned = built.unowned ? ` ${built.unowned} notes fall before the first line and are not scored.` : "";
  setStatus(`${song.title}: ${app.notes.length} notes in ${app.phrases.length} lines.${unowned}`);
}

// ---------- C2: microphones ----------

async function findMics() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("This browser has no microphone API.");
    return;
  }
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    const all = await navigator.mediaDevices.enumerateDevices();
    probe.getTracks().forEach((track) => track.stop());
    app.devices = all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
    for (const [sel, first] of [[els.mic1, "Default mic"], [els.mic2, "Share Player 1's mic"]]) {
      const keep = sel.value;
      sel.replaceChildren(new Option(first, ""));
      app.devices.forEach((d, i) => sel.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
      sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "";
    }
    setStatus(app.devices.length < 2
      ? `Found ${app.devices.length} microphone. Player 2 shares it (one mic hears you both).`
      : `Found ${app.devices.length} microphones. Pick one for each player for separate scores and Sync bonuses.`);
  } catch (err) {
    setStatus(`Microphone not available (${err.name}).`);
  }
}

async function openOne(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const source = app.audio.createMediaStreamSource(stream);
  const analyser = app.audio.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  return { id: deviceId, stream, analyser, buffer: new Float32Array(analyser.fftSize), recent: [] };
}

async function openMics() {
  const want = [els.mic1.value, app.mode !== "solo" && els.mic2.value && els.mic2.value !== els.mic1.value ? els.mic2.value : null];
  const key = want.join("|");
  if (app.micIds === key && app.mics.length) {
    return;
  }
  app.mics.forEach((m) => m.stream.getTracks().forEach((t) => t.stop()));
  app.mics = [];
  app.micIds = key;
  app.micError = null;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    app.micError = "no microphone API";
    setStatus("This browser has no microphone API, so nothing can be judged. The band and the lane still run.");
    return;
  }
  try {
    app.mics.push(await openOne(want[0]));
  } catch (err) {
    app.micError = err.name;
    setStatus(`Microphone not available (${err.name}). The song still plays; nothing is scored as sung.`);
    return;
  }
  if (want[1]) {
    try {
      app.mics.push(await openOne(want[1]));
    } catch (err) {
      setStatus(`Player 2's mic did not open (${err.name}), so Player 2 shares Player 1's mic.`);
    }
  }
}

// Each mic's pitch, smoothed, in MIDI, or null when silent (C4, CA3).
function readMics() {
  const out = [];
  app.mics.forEach((mic, i) => {
    mic.analyser.getFloatTimeDomainData(mic.buffer);
    let energy = 0;
    for (let k = 0; k < mic.buffer.length; k++) {
      energy += mic.buffer[k] * mic.buffer[k];
    }
    els[i === 0 ? "level1" : "level2"].style.width = `${Math.min(100, Math.sqrt(energy / mic.buffer.length) * 400)}%`;
    const hz = detectPitch(mic.buffer, app.audio.sampleRate, app.pitchOptions);
    if (hz === null) {
      mic.recent = [];
    } else {
      mic.recent.push(hzToMidi(hz));
      if (mic.recent.length > app.cfg.smoothingFrames) {
        mic.recent.shift();
      }
    }
    out.push(mic.recent.length ? median(mic.recent) : null);
  });
  return out;
}

// C9: the page sings by itself, through the same judge. Player 2 sings two semitones sharp on every fifth note.
function demoVoice(player, t) {
  const note = noteAt(app.notes, t);
  if (!note || !singers(app.parts[note.phrase]).includes(player) || t > note.end - 0.04) {
    return null;
  }
  const off = player === 2 && note.id % 5 === 3 ? 2.2 : 0;
  return note.midi + off + 0.25 * Math.sin(t * 11 + player) - (player === 2 ? 12 : 0);
}

// ---------- C3: sound ----------

function makeBus() {
  app.bus = app.audio.createGain();
  app.bus.gain.value = 1;
  app.bus.connect(app.audio.destination);
  if (!app.noise) {
    const len = app.audio.sampleRate;
    app.noise = app.audio.createBuffer(1, len, app.audio.sampleRate);
    const data = app.noise.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x7fffffff) * 2 - 1;
    }
  }
}

function tone(at, hz, dur, vol, type = "triangle", attack = 0.01) {
  const ctx = app.audio;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = hz;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(vol, at + attack);
  gain.gain.setTargetAtTime(0, Math.max(at + attack, at + dur - 0.08), 0.05);
  osc.connect(gain).connect(app.bus);
  osc.start(at);
  osc.stop(at + dur + 0.3);
}

function noiseHit(at, dur, vol, highpass) {
  const ctx = app.audio;
  const src = ctx.createBufferSource();
  src.buffer = app.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = highpass;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  src.connect(filter).connect(gain).connect(app.bus);
  src.start(at, Math.random() * 0.5);
  src.stop(at + dur + 0.02);
}

function kick(at, vol) {
  const ctx = app.audio;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(130, at);
  osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
  osc.connect(gain).connect(app.bus);
  osc.start(at);
  osc.stop(at + 0.3);
}

function play(event, at) {
  const v = app.cfg.bandVolume;
  switch (event.kind) {
    case "kick": kick(at, v * 1.6); break;
    case "snare": noiseHit(at, 0.16, v * 0.7, 1200); break;
    case "hat": noiseHit(at, 0.04, v * 0.22, 7000); break;
    case "chord": event.midis.forEach((m) => tone(at, midiToHz(m), event.dur, v * 0.16, "sine", 0.06)); break;
    case "bass": tone(at, midiToHz(event.midi), event.dur, v * 0.5, "triangle", 0.01); break;
    case "click": tone(at, event.high ? 1760 : 1320, 0.06, 0.25, "square", 0.002); break;
    case "guide": tone(at, midiToHz(event.midi), event.dur, app.cfg.guideVolume, "triangle", 0.02); break;
    default: break;
  }
}

// Everything due in [t0, t1): the count-in, the band, and the guide melody (C3).
function soundsDue(t0, t1) {
  const out = [];
  const b = beat();
  for (let k = 1; k <= 3; k++) {
    const t = -k * b;
    if (t >= t0 && t < t1) {
      out.push({ t, kind: "click", high: false });
    }
  }
  if (app.song.band && els.band.checked) {
    out.push(...bandEvents(app.song.band, Math.max(0, t0), t1));
  }
  if (els.guide.checked) {
    for (const n of app.notes) {
      if (n.start >= t0 && n.start < t1) {
        out.push({ t: n.start, kind: "guide", midi: n.midi, dur: n.end - n.start });
      }
    }
  }
  return out;
}

function schedule(t) {
  if (!app.audio || !app.bus) {
    return;
  }
  const from = app.scheduledTo === null ? t : app.scheduledTo;
  const to = t + LOOKAHEAD;
  if (to <= from) {
    return;
  }
  const now = app.audio.currentTime;
  for (const e of soundsDue(from, to)) {
    play(e, now + Math.max(0, e.t - t));
  }
  app.scheduledTo = to;
}

// P3: the line's melody played in the gap before it, for songs that ask for it (the warm-up).
function maybePreview(t) {
  if (!app.audio || !app.bus || app.song.preview === false || !els.preview.checked) {
    return;
  }
  app.phrases.forEach((phrase, i) => {
    if (app.previewed.has(i) || phrase.previewAt === null || !(t >= phrase.previewAt && t < phrase.start)) {
      return;
    }
    app.previewed.add(i);
    const origin = app.audio.currentTime + 0.05;
    const first = phrase.notes[0].start;
    phrase.notes.forEach((n) => tone(origin + (n.start - first), midiToHz(n.midi), n.end - n.start, app.cfg.previewVolume));
  });
}

// ---------- run control (P2, P6, C3, C9) ----------

async function begin(demo) {
  if (app.finished || demo !== app.demo) {
    restart();
  }
  app.demo = demo;
  els.results.hidden = true;
  if (AudioContextClass && !app.audio) {
    app.audio = new AudioContextClass();
  }
  if (app.audio) {
    await app.audio.resume();
  }
  if (!demo && app.audio) {
    await openMics();
  }
  if (!app.team) {
    app.team = new Team(app.notes, (phrase) => app.parts[phrase], demo ? 2 : Math.max(1, app.mics.length));
    app.clockBase = -3 * beat(); // C3: count 3, 2, 1
  }
  if (app.audio) {
    makeBus();
  }
  app.scheduledTo = null;
  app.clockStart = performance.now();
  app.playing = true;
  setButtons();
}

function silence() {
  if (app.bus) {
    app.bus.gain.setTargetAtTime(0, app.audio.currentTime, 0.02);
    const old = app.bus;
    setTimeout(() => old.disconnect(), 400);
    app.bus = null;
  }
}

function stop() {
  app.clockBase = songTime();
  app.playing = false;
  silence();
  setButtons();
}

function restart() {
  silence();
  app.playing = false;
  app.finished = false;
  app.clockBase = 0;
  app.team = null;
  app.nextClose = 0;
  app.wordShown.clear();
  app.previewed.clear();
  app.popups = [];
  app.sparks = [];
  app.trails = { 1: [], 2: [] };
  app.lineIndex = -2;
  els.results.hidden = true;
  setButtons();
  updateHud(0);
}

function setButtons() {
  els.start.disabled = app.playing;
  els.stop.disabled = !app.playing;
  els.demo.disabled = app.playing;
  els.start.textContent = !app.playing && app.clockBase > 0 && !app.finished ? "Resume" : "Start";
}

// ---------- judging (C4 to C7) ----------

function judge(t, dt) {
  const note = noteAt(app.notes, t);
  if (!note) {
    return;
  }
  for (const p of singers(app.parts[note.phrase])) {
    app.team.addFrame(note.id, p, dt, isOnPitch(note.midi, app.sung[p], app.cfg.toleranceSemitones));
  }
}

function closeDue(t) {
  while (app.nextClose < app.notes.length && app.notes[app.nextClose].end <= t) {
    const note = app.notes[app.nextClose];
    for (const e of app.team.closeNote(note.id, t)) {
      effect(e, note);
    }
    app.nextClose += 1;
  }
  app.phrases.forEach((phrase, i) => {
    if (app.wordShown.has(i) || phrase.scoreEnd === null || t < phrase.scoreEnd) {
      return;
    }
    app.wordShown.add(i);
    const share = app.team.lineShare(i);
    const word = lineWord(share);
    if (word) {
      popup(`${word}! ${Math.round(share * 100)}%`, COLOR[app.parts[i]], 0.5, 0.42, 1.6, 30);
    }
  });
}

function effect(e, note) {
  const color = e.player ? COLOR[e.player] : COLOR.both;
  if (e.kind === "hit") {
    burst(note, color, 14);
  } else if (e.kind === "sync") {
    popup("SYNC! +50", COLOR.both, 0.5, 0.25, 1.2, 26);
    burst(note, COLOR.both, 26);
  } else if (e.kind === "harmony") {
    popup("HARMONY TIME! x2", COLOR.both, 0.5, 0.3, 2.2, 34);
  } else if (e.kind === "break" && e.combo >= 5) {
    popup(`Combo ${e.combo} ended`, "#a59cc8", 0.5, 0.6, 1.2, 18);
  }
}

function finish() {
  app.clockBase = songTime();
  app.playing = false;
  app.finished = true;
  silence();
  setButtons();
  const r = app.team.results();
  els["res-title"].textContent = `${app.song.title}: ${["", "Keep practising", "Not bad", "Good team", "Great team", "Superstars"][r.stars] || "Song complete"}`;
  els["res-stars"].textContent = "★".repeat(r.stars) + "☆".repeat(5 - r.stars);
  els["res-score"].textContent = r.score.toLocaleString();
  els["res-hits"].textContent = `${r.notesHit} of ${r.notesJudged}`;
  els["res-combo"].textContent = String(r.bestCombo);
  els["res-share"].textContent = r.teamShare === null ? "-" : `${Math.round(r.teamShare * 100)}%`;
  const rows = [1, 2].filter((p) => r.players[p].notes > 0).map((p) => {
    const s = r.players[p];
    return `${name(p)}: ${Math.round(s.share * 100)}% on pitch, ${s.hits} of ${s.notes} notes`;
  });
  els["res-players"].replaceChildren(...rows.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
  const notes = [];
  if (app.demo) {
    notes.push("This was the demo: the page sang both parts, and Player 2 missed every fifth note on purpose.");
  } else if (app.micError) {
    notes.push(`No microphone (${app.micError}), so nothing could be judged as sung.`);
  } else if (app.mics.length < 2 && app.mode !== "solo" && app.parts.includes("both")) {
    notes.push("One mic heard you both on the gold lines, so both singers got its reading there. A mic each gives separate scores and Sync bonuses.");
  }
  els["res-note"].textContent = notes.join(" ");
  els.results.hidden = false;
  els.results.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- drawing (C4, C5, C6) ----------

function popup(text, color, x, y, life, size) {
  app.popups.push({ text, color, x, y, born: performance.now(), life, size });
}

function burst(note, color, count) {
  const w = els.lane.clientWidth;
  const x = Math.max(60, w * 0.2);
  const y = laneY(note.midi);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 160;
    app.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, born: performance.now(), color });
  }
}

function laneY(midi) {
  const h = els.lane.clientHeight;
  const top = 44;
  const bottom = h - 18;
  return bottom - ((midi - app.range.min) / (app.range.max - app.range.min)) * (bottom - top);
}

// Fold a sung pitch into the octave nearest the target, so the trail sits on the lane (C4).
function foldNear(midi, target) {
  return midi + 12 * Math.round((target - midi) / 12);
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function draw(t) {
  const c = els.lane;
  const g = c.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const nowX = Math.max(60, w * 0.2);
  const pps = (w - nowX) / AHEAD;
  const xAt = (time) => nowX + (time - t) * pps;
  const harmony = app.playing && app.team && app.team.inHarmony(t);

  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, harmony ? "#2b2108" : "#140c2c");
  bg.addColorStop(1, "#06040f");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // pitch rows, C labelled
  g.font = "11px Nunito, sans-serif";
  for (let m = Math.ceil(app.range.min); m <= app.range.max; m++) {
    const y = laneY(m);
    g.strokeStyle = m % 12 === 0 ? "#3a2f63" : "#1c1638";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
    if (m % 12 === 0) {
      g.fillStyle = "#6f659a";
      g.fillText(noteName(m), 4, y - 3);
    }
  }
  // bar lines
  if (app.song.band) {
    const bar = 4 * beat();
    for (let k = Math.floor((t - BEHIND) / bar); k * bar < t + AHEAD; k++) {
      const x = xAt(app.song.band.start + k * bar);
      g.strokeStyle = "#ffffff10";
      g.beginPath();
      g.moveTo(x, 36);
      g.lineTo(x, h);
      g.stroke();
    }
  }
  // notes
  const live = noteAt(app.notes, t);
  g.textAlign = "left";
  for (const n of app.notes) {
    const x0 = xAt(n.start);
    const x1 = xAt(n.end);
    if (x1 < 0 || x0 > w) {
      continue;
    }
    const part = app.parts[n.phrase];
    const color = COLOR[part];
    const y = laneY(n.midi);
    const out = app.team ? app.team.outcome[n.id] : null;
    const hit = out && Object.values(out).some(Boolean);
    const missed = out && !hit;
    g.save();
    if (hit || (live && live.id === n.id)) {
      g.shadowColor = color;
      g.shadowBlur = hit ? 18 : 10;
    }
    roundRect(g, x0 + 1, y - 7, Math.max(4, x1 - x0 - 2), 14, 7);
    g.globalAlpha = missed ? 0.25 : hit ? 1 : live && live.id === n.id ? 0.85 : 0.45;
    g.fillStyle = missed ? "#5a5375" : color;
    g.fill();
    g.globalAlpha = missed ? 0.4 : 1;
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
    if (n.syl && x1 - x0 > 10) {
      g.fillStyle = missed ? "#7d7499" : "#f4f0ff";
      g.font = "bold 12px Nunito, sans-serif";
      g.fillText(n.syl, x0 + 3, y - 11);
    }
  }
  // now line
  g.strokeStyle = harmony ? COLOR.both : "#f4f0ffcc";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(nowX, 36);
  g.lineTo(nowX, h);
  g.stroke();
  // voice trails
  for (const p of [1, 2]) {
    const pts = app.trails[p];
    g.save();
    g.strokeStyle = COLOR[p];
    g.shadowColor = COLOR[p];
    g.shadowBlur = 12;
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    let pen = false;
    for (const pt of pts) {
      if (pt.m === null) {
        pen = false;
        continue;
      }
      const x = xAt(pt.t);
      const y = laneY(pt.m);
      if (pen) {
        g.lineTo(x, y);
      } else {
        g.moveTo(x, y);
        pen = true;
      }
    }
    g.stroke();
    const lastPt = pts[pts.length - 1];
    if (lastPt && lastPt.m !== null && t - lastPt.t < 0.1) {
      g.fillStyle = COLOR[p];
      g.beginPath();
      g.arc(nowX, laneY(lastPt.m), 6, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  // sparks
  const now = performance.now();
  app.sparks = app.sparks.filter((s) => now - s.born < 700);
  for (const s of app.sparks) {
    const age = (now - s.born) / 1000;
    g.globalAlpha = 1 - age / 0.7;
    g.fillStyle = s.color;
    g.fillRect(s.x + s.vx * age - 2, s.y + s.vy * age + 180 * age * age - 2, 4, 4);
  }
  g.globalAlpha = 1;
  // popups
  g.textAlign = "center";
  app.popups = app.popups.filter((p) => now - p.born < p.life * 1000);
  for (const p of app.popups) {
    const age = (now - p.born) / 1000;
    g.globalAlpha = Math.min(1, 3 * (1 - age / p.life));
    g.fillStyle = p.color;
    g.shadowColor = p.color;
    g.shadowBlur = 16;
    g.font = `${p.size}px Bungee, Impact, sans-serif`;
    g.fillText(p.text, p.x * w, p.y * h - age * 24);
  }
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  // count-in (C3)
  if (app.playing && t < 0) {
    g.fillStyle = "#f4f0ff";
    g.font = `${Math.min(120, h * 0.45)}px Bungee, Impact, sans-serif`;
    g.fillText(String(Math.ceil(-t / beat())), w / 2, h * 0.62);
  }
  g.textAlign = "left";
}

// ---------- text on the page (C5, P4) ----------

function showLyrics(t) {
  const lines = app.song.lines;
  const idx = Math.max(-1, currentLineIndex(lines, t));
  if (idx !== app.lineIndex) {
    app.lineIndex = idx;
    const now = els["lyric-now"];
    now.replaceChildren();
    if (idx >= 0) {
      const notes = app.notes.filter((n) => n.phrase === idx);
      now.style.color = "#f4f0ff";
      if (notes.length && notes.every((n) => n.syl)) {
        notes.forEach((n, k) => {
          const span = document.createElement("span");
          span.className = "syl";
          span.dataset.id = n.id;
          span.textContent = n.syl.endsWith("-") ? n.syl.slice(0, -1) : n.syl + (k + 1 < notes.length ? " " : "");
          now.appendChild(span);
        });
      } else {
        now.textContent = lines[idx].text;
      }
    } else {
      now.textContent = app.playing || app.clockBase !== 0 ? "Get ready" : "Press Start";
    }
    const next = lines[idx + 1];
    els["lyric-next"].textContent = next ? `${partLabel(app.parts[idx + 1])}: ${next.text}` : "";
    els["lyric-next"].style.color = next ? COLOR[app.parts[idx + 1]] : "";
  }
  if (idx >= 0) {
    const color = COLOR[app.parts[idx]];
    for (const span of els["lyric-now"].querySelectorAll(".syl")) {
      const n = app.notes[Number(span.dataset.id)];
      span.className = `syl${t >= n.end ? " done" : t >= n.start ? " live" : ""}`;
      span.style.color = t >= n.start ? color : "";
    }
  }
}

function showBanner(t) {
  const next = app.phrases.find((ph) => ph.notes.length && ph.notes[ph.notes.length - 1].end > t);
  let text = "";
  let color = "";
  if (next && app.mode !== "solo") {
    const part = app.parts[next.index];
    const lead = next.notes[0].start - t;
    if (lead > 0 && lead < 4 * beat()) {
      text = part === "both" ? "Both together, get ready!" : `${name(part)}, get ready!`;
    } else if (lead <= 0) {
      text = part === "both" ? "Both!" : name(part);
    }
    color = COLOR[part];
  }
  if (els.banner.textContent !== text) {
    els.banner.textContent = text;
  }
  els.banner.style.color = color;
}

function showChips(t) {
  const note = noteAt(app.notes, t);
  for (const p of [1, 2]) {
    els[`chip${p}-name`].textContent = name(p);
    const sung = app.sung[p];
    const mine = note && singers(app.parts[note.phrase]).includes(p);
    let kind = "idle";
    let gap = "";
    if (app.playing && mine) {
      if (sung === null) {
        kind = "silent";
        gap = "sing!";
      } else {
        const d = foldSemitones(note.midi - sung);
        kind = Math.abs(d) <= app.cfg.toleranceSemitones ? "on" : d > 0 ? "up" : "down";
        gap = kind === "on" ? "on pitch" : `go ${kind} ${Math.abs(d).toFixed(1)}`;
      }
    } else if (app.playing) {
      gap = "rest";
    }
    const arrow = els[`chip${p}-arrow`];
    arrow.textContent = { on: "●", up: "▲", down: "▼", silent: "–" }[kind] || "·";
    arrow.className = `arrow ${kind}`;
    els[`chip${p}-note`].textContent = sung === null ? "-" : noteName(sung);
    els[`chip${p}-gap`].textContent = gap;
  }
}

function updateHud(t) {
  const team = app.team;
  els.score.textContent = (team ? team.score : 0).toLocaleString();
  els.combo.textContent = String(team ? team.combo : 0);
  els.mult.textContent = `x${team ? team.multiplier() : 1}`;
  const harmony = app.playing && team && team.inHarmony(t);
  els.hype.style.width = `${harmony ? 100 : team ? team.hype : 0}%`;
  els.harmony.hidden = !harmony;
}

// ---------- the loop ----------

function frame(now) {
  const dt = app.lastFrame ? Math.min(0.1, (now - app.lastFrame) / 1000) : 0;
  app.lastFrame = now;
  if (app.song) {
    const t = songTime();
    if (app.playing) {
      schedule(t);
      maybePreview(t);
    }
    const heard = app.mics.length ? readMics() : [];
    for (const p of [1, 2]) {
      app.sung[p] = app.demo && app.playing ? demoVoice(p, t) : heard.length ? heard[micFor(p, heard.length)] : null;
    }
    if (app.playing && t >= 0 && app.team) {
      judge(t, dt);
      closeDue(t);
      const target = noteAt(app.notes, t) || app.notes.find((n) => n.start > t);
      for (const p of [1, 2]) {
        const s = app.sung[p];
        app.trails[p].push({ t, m: s === null ? null : foldNear(s, target ? target.midi : (app.range.min + app.range.max) / 2) });
        while (app.trails[p].length && t - app.trails[p][0].t > BEHIND + 0.2) {
          app.trails[p].shift();
        }
      }
      if (t >= songEnd()) {
        finish();
      }
    }
    // C1: before the first Start, the lane shows the song's first notes coming up.
    const idle = !app.playing && app.clockBase === 0 && !app.finished && app.notes.length;
    draw(idle ? Math.max(0, app.notes[0].start - AHEAD * 0.6) : t);
    showLyrics(t);
    showBanner(t);
    showChips(t);
    updateHud(t);
  }
  requestAnimationFrame(frame);
}

// ---------- wiring ----------

async function loadFromFile(file) {
  if (file.size > app.cfg.maxFileBytes) {
    throw new Error(`the file is ${file.size} bytes, and the limit is ${app.cfg.maxFileBytes}`);
  }
  return parseSong(JSON.parse(await file.text()));
}

els.start.addEventListener("click", () => begin(false));
els.demo.addEventListener("click", () => begin(true));
els.stop.addEventListener("click", stop);
els.restart.addEventListener("click", restart);
els.again.addEventListener("click", () => { restart(); begin(app.demo); });
els.swap.addEventListener("click", () => { app.swap = !app.swap; applyParts(); restart(); begin(app.demo); });
els["find-mics"].addEventListener("click", findMics);
els.mode.addEventListener("change", () => { app.swap = false; applyParts(); restart(); });
els.song.addEventListener("change", () => loadSong(app.songs[Number(els.song.value)].song));
for (const id of ["name1", "name2"]) {
  els[id].addEventListener("input", () => { app.lineIndex = -2; });
}
els.file.addEventListener("change", async () => {
  const file = els.file.files[0];
  if (!file) {
    return;
  }
  try {
    const song = await loadFromFile(file);
    app.songs.push({ label: `Your file: ${song.title}`, song });
    els.song.add(new Option(`Your file: ${song.title}`, String(app.songs.length - 1)));
    els.song.value = String(app.songs.length - 1);
    loadSong(song);
  } catch (err) {
    setStatus(`Not loaded: ${err.message}. The song in use is unchanged.`);
  }
});

// Test hook for tests/page_check.py: read-only state.
window.__karaoke = {
  state: () => ({
    title: app.song && app.song.title,
    mode: app.mode,
    parts: app.parts,
    playing: app.playing,
    finished: app.finished,
    demo: app.demo,
    t: songTime(),
    mics: app.mics.length,
    micError: app.micError,
    devices: app.devices.length,
    score: app.team ? app.team.score : 0,
    combo: app.team ? app.team.combo : 0,
    bestCombo: app.team ? app.team.bestCombo : 0,
    results: app.team ? app.team.results() : null,
    songs: app.songs.map((s) => s.label),
  }),
};

async function init() {
  app.cfg = await (await fetch("config.json")).json();
  app.pitchOptions = {
    pitchMinHz: app.cfg.pitchMinHz,
    pitchMaxHz: app.cfg.pitchMaxHz,
    yinThreshold: app.cfg.yinThreshold,
    minRms: app.cfg.minRms,
    window: app.cfg.pitchWindow,
  };
  if (!AudioContextClass) {
    app.micError = "no Web Audio API";
  }
  for (const file of SONGS) {
    const song = parseSong(await (await fetch(file)).json());
    const label = file === "demo-song.json" ? "Warm-up: la la la (one voice at a time)" : song.title;
    app.songs.push({ label, song });
    els.song.add(new Option(label, String(app.songs.length - 1)));
  }
  els.song.value = "0";
  loadSong(app.songs[0].song);
  if (!AudioContextClass) {
    setStatus("This browser has no Web Audio API, so there is no sound and no pitch check.");
  }
  requestAnimationFrame(frame);
}

init().catch((err) => setStatus(`The page could not start: ${err.message}`));
