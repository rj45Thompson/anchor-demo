// Public karaoke page: manual start, a melody preview before each phrase, a live pitch arrow, and phrase scores.
// Serves: P1 (show the demo), P2 (start and microphone), P3 (lead-in preview), P4 (pitch arrow),
// P5 (phrase score), P6 (stop and restart), P7 (own melody file), A1 (mic refused), A2 (no Web Audio),
// A3 (bad own file), A5 (manual timing, said on the page).
// Nothing here fetches lyrics or a music player. The demo tune is an original melody sung to "la".
import { detectPitch, foldSemitones, hzToMidi, midiToHz, noteName } from "./js/pitch.js";
import { buildPhrases, currentLineIndex, noteAt, parseSong } from "./js/phrases.js";

const $ = (id) => document.getElementById(id);
const els = {
  title: $("song-title"),
  prev: $("prev-line"),
  current: $("current-line"),
  next: $("next-line"),
  arrow: $("arrow"),
  target: $("target"),
  sung: $("sung"),
  gap: $("gap"),
  level: $("level"),
  start: $("start"),
  stop: $("stop"),
  restart: $("restart"),
  preview: $("preview"),
  file: $("file"),
  status: $("status"),
  scores: $("scores"),
};

const AudioContextClass = window.AudioContext || window.webkitAudioContext;

const app = {
  cfg: null,
  pitchOptions: null,
  song: null,
  phrases: [],
  unowned: 0,
  stats: [], // per phrase: { active, hits }
  previewed: new Set(),
  scored: new Set(),
  playing: false,
  clockBase: 0, // song seconds when the clock last started or stopped
  clockStart: 0, // performance.now() when the clock last started
  audio: null, // AudioContext, made on the first Start press
  analyser: null,
  buffer: null,
  micError: null, // the browser's error name when the mic is refused or missing (A1)
  recent: [], // recent sung midi readings, for smoothing
  lineIndex: -2,
};

function songTime() {
  return app.playing ? app.clockBase + (performance.now() - app.clockStart) / 1000 : app.clockBase;
}

function setStatus(message) {
  els.status.textContent = message;
}

function setButtons() {
  els.start.disabled = app.playing;
  els.stop.disabled = !app.playing;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function loadSong(song) {
  const built = buildPhrases(song.lines, song.notes, app.cfg.leadInSeconds, app.cfg.phraseTailSeconds);
  app.song = song;
  app.phrases = built.phrases;
  app.unowned = built.unowned;
  app.playing = false;
  app.clockBase = 0;
  app.clockStart = 0;
  app.lineIndex = -2;
  restart();
  els.title.textContent = song.title;
  const count = `${song.notes.length} notes in ${app.phrases.length} phrases`;
  const unowned = app.unowned ? ` ${app.unowned} notes fall before the first line and are not scored.` : "";
  setStatus(`Loaded ${count}.${unowned}`);
  setButtons();
}

async function openMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    app.micError = "no microphone API in this browser";
    setStatus("This browser has no microphone API, so the pitch check cannot run. Timing and preview still work.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    const source = app.audio.createMediaStreamSource(stream);
    app.analyser = app.audio.createAnalyser();
    app.analyser.fftSize = 2048;
    source.connect(app.analyser);
    app.buffer = new Float32Array(app.analyser.fftSize);
  } catch (err) {
    app.micError = err.name;
    setStatus(`Microphone not available (${err.name}). Timing and preview still work.`);
  }
}

async function start() {
  if (AudioContextClass && !app.audio) {
    app.audio = new AudioContextClass();
  }
  if (app.audio) {
    await app.audio.resume();
  }
  if (app.audio && !app.analyser && !app.micError) {
    await openMic();
  }
  app.clockStart = performance.now();
  app.playing = true;
  setButtons();
}

function stop() {
  app.clockBase = songTime();
  app.playing = false;
  setButtons();
}

function restart() {
  app.clockBase = 0;
  app.clockStart = performance.now();
  app.previewed.clear();
  app.scored.clear();
  app.stats = app.phrases.map(() => ({ active: 0, hits: 0 }));
  app.recent = [];
  app.lineIndex = -2;
  els.scores.replaceChildren();
  setButtons();
}

// Lead-in preview: the phrase's notes play at their own spacing, starting now (P3).
function playPreview(phrase) {
  const ctx = app.audio;
  const origin = ctx.currentTime + 0.05;
  const first = phrase.notes[0].start;
  const volume = app.cfg.previewVolume;
  for (const note of phrase.notes) {
    const at = origin + (note.start - first);
    const until = at + (note.end - note.start);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = midiToHz(note.midi);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.02);
    gain.gain.setValueAtTime(volume, Math.max(at + 0.02, until - 0.05));
    gain.gain.linearRampToValueAtTime(0, until);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(until + 0.02);
  }
}

function maybePreview(t) {
  if (!app.playing || !els.preview.checked || !app.audio) {
    return;
  }
  app.phrases.forEach((phrase, i) => {
    if (app.previewed.has(i) || phrase.previewAt === null) {
      return;
    }
    if (t >= phrase.previewAt && t < phrase.start) {
      app.previewed.add(i);
      playPreview(phrase);
    }
  });
}

function showLines(t) {
  const lines = app.song.lines;
  const idx = currentLineIndex(lines, t);
  if (idx === app.lineIndex) {
    return;
  }
  app.lineIndex = idx;
  els.prev.textContent = idx > 0 ? lines[idx - 1].text : "";
  if (idx >= 0) {
    els.current.textContent = lines[idx].text;
  } else {
    els.current.textContent = app.playing || app.clockBase > 0 ? "Get ready" : "Press Start";
  }
  els.next.textContent = idx + 1 < lines.length ? lines[idx + 1].text : "";
}

function renderArrow(kind, target, sung, gap, text) {
  const glyph = { on: "●", up: "▲", down: "▼" }[kind] || "·";
  els.arrow.textContent = glyph;
  els.arrow.className = `arrow ${kind}`;
  els.target.textContent = target;
  els.sung.textContent = sung;
  if (gap === null) {
    els.gap.textContent = text;
  } else {
    const direction = gap > 0 ? "up" : "down";
    els.gap.textContent = `${text} go ${direction} ${Math.abs(gap).toFixed(1)} semitones`;
  }
}

// Pitch arrow: the sung note against the target note in the phrase's current window (P4, A6).
function readPitch(t) {
  if (!app.analyser) {
    renderArrow("off", "-", "-", null, `Mic off: ${app.micError || "not started"}`);
    return;
  }
  if (!app.playing) {
    renderArrow("idle", "-", "-", null, "");
    return;
  }
  const hz = detectPitch(app.buffer, app.audio.sampleRate, app.pitchOptions);
  if (hz === null) {
    app.recent = [];
  } else {
    app.recent.push(hzToMidi(hz));
    if (app.recent.length > app.cfg.smoothingFrames) {
      app.recent.shift();
    }
  }
  const sung = app.recent.length ? median(app.recent) : null;
  const note = noteAt(app.song.notes, t);
  if (!note) {
    renderArrow("rest", "-", sung === null ? "-" : noteName(sung), null, "Rest.");
    return;
  }
  const stat = app.stats[note.phrase];
  stat.active += 1;
  if (sung === null) {
    renderArrow("silent", noteName(note.midi), "-", null, "No voice.");
    return;
  }
  const gap = foldSemitones(note.midi - sung);
  const on = Math.abs(gap) <= app.cfg.toleranceSemitones;
  if (on) {
    stat.hits += 1;
  }
  renderArrow(on ? "on" : gap > 0 ? "up" : "down", noteName(note.midi), noteName(sung), on ? 0 : gap, on ? "On pitch." : "");
}

function drawLevel(buffer) {
  let energy = 0;
  for (let i = 0; i < buffer.length; i++) {
    energy += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(energy / buffer.length);
  els.level.style.width = `${Math.min(100, rms * 400)}%`;
}

// Phrase score: the share of a phrase's note time that was on pitch. Silence counts as a miss (P5, A6).
function scorePhrases(t) {
  app.phrases.forEach((phrase, i) => {
    if (app.scored.has(i) || phrase.scoreEnd === null || t < phrase.scoreEnd) {
      return;
    }
    app.scored.add(i);
    const stat = app.stats[i];
    const item = document.createElement("li");
    item.textContent = `Phrase ${i + 1}: ${stat.active === 0 ? "not scored" : `${Math.round((100 * stat.hits) / stat.active)}% on pitch`}`;
    els.scores.appendChild(item);
  });
}

function frame() {
  const t = songTime();
  if (app.song) {
    maybePreview(t);
    showLines(t);
    if (app.analyser) {
      app.analyser.getFloatTimeDomainData(app.buffer);
      drawLevel(app.buffer);
    }
    readPitch(t);
    scorePhrases(t);
  }
  requestAnimationFrame(frame);
}

async function readSongFile(file) {
  if (file.size > app.cfg.maxFileBytes) {
    throw new Error(`the file is ${file.size} bytes, and the limit is ${app.cfg.maxFileBytes}`);
  }
  return parseSong(JSON.parse(await file.text()));
}

els.start.addEventListener("click", start);
els.stop.addEventListener("click", stop);
els.restart.addEventListener("click", restart);
els.file.addEventListener("change", async () => {
  const file = els.file.files[0];
  if (!file) {
    return;
  }
  try {
    loadSong(await readSongFile(file));
    setStatus(`${app.song.title} is loaded from your file. ${els.status.textContent}`);
  } catch (err) {
    setStatus(`Not loaded: ${err.message}. The song in use is unchanged.`);
  }
});

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
    setStatus("This browser has no Web Audio API, so the preview and the pitch check cannot run. Timing still works.");
  }
  const demo = await (await fetch("demo-song.json")).json();
  loadSong(parseSong(demo));
  requestAnimationFrame(frame);
}

init().catch((err) => setStatus(`The page could not start: ${err.message}`));
