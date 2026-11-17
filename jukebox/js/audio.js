// The band. There is no audio file: the backing track is synthesised from the chart,
// so the music and the gems can never drift apart and the song costs the page nothing
// to download.
//
// The audio clock is the game clock. Reading time from AudioContext.currentTime
// rather than from frames is what keeps a note you hear and a gem you see together,
// even when a frame runs long.
//
// The part that decides WHAT to play is pure and tested (tests/audio.test.mjs); the
// part that makes a sound needs a browser.
import { beatSeconds } from "./chart.js";

export const LOOKAHEAD = 0.12;      // seconds of music scheduled ahead of the clock
const TICK_MS = 25;

// A minor, four bars round: the chart was written over this.
const PROGRESSION = [45, 41, 48, 43];   // A2 F2 C3 G2

export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Every backing event in [from, to): drums and bass, worked out from the tempo rather
// than stored, so a chart of any length has a band behind it.
export function backingBetween(song, from, to) {
  const beat = beatSeconds(song);
  const out = [];
  // Walk a beat wider than the window at each end: a beat whose downbeat falls
  // outside it can still own an off-beat event inside it, and skipping the beat would
  // drop that event for good. The filter at the end is what decides what is in.
  const first = Math.max(0, Math.floor(from / beat) - 1);
  const last = Math.ceil(to / beat) + 1;
  for (let b = first; b < last; b++) {
    const t = b * beat;
    const inBar = b % 4;
    const bar = Math.floor(b / 4);
    if (inBar === 0 || inBar === 2) out.push({ t, kind: "kick" });
    if (inBar === 1 || inBar === 3) out.push({ t, kind: "snare" });
    out.push({ t, kind: "hat" });
    out.push({ t: t + beat / 2, kind: "hat", soft: true });
    // The bass walks the progression, one chord a bar, with a push on the and of 3.
    const root = PROGRESSION[bar % PROGRESSION.length];
    if (inBar === 0) out.push({ t, kind: "bass", midi: root, len: beat * 1.6 });
    if (inBar === 2) out.push({ t, kind: "bass", midi: root, len: beat * 0.7 });
    if (inBar === 3) out.push({ t: t + beat / 2, kind: "bass", midi: root + 7, len: beat * 0.4 });
  }
  return out.filter((e) => e.t >= from && e.t < to).sort((a, b) => a.t - b.t);
}

// The guitar line the chart is written for: one voice per strum, so a chord sounds as
// one note rather than as a cluster.
export function melodyBetween(song, from, to) {
  const out = [];
  for (const e of song.guitar) {
    if (e.t < from || e.t >= to) continue;
    out.push({ t: e.t, kind: "lead", midi: e.midi === null ? 57 : e.midi, len: Math.max(0.12, e.len || beatSeconds(song) * 0.45) });
  }
  return out;
}

export function eventsBetween(song, from, to) {
  return [...backingBetween(song, from, to), ...melodyBetween(song, from, to)].sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Everything below needs a browser.

function noiseBuffer(ctx) {
  const n = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

export function createAudio(song, AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext) {
  if (!AudioContextClass) throw new Error("this browser has no Web Audio API");
  const ctx = new AudioContextClass();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  const drums = ctx.createGain(); drums.gain.value = 0.55; drums.connect(master);
  const bass = ctx.createGain(); bass.gain.value = 0.5; bass.connect(master);
  const lead = ctx.createGain(); lead.gain.value = 0.32; lead.connect(master);
  const noise = noiseBuffer(ctx);

  let startedAt = null;        // ctx.currentTime the song began
  let scheduledTo = 0;         // song time already handed to the scheduler
  let timer = null;

  function env(node, at, attack, decay, peak) {
    const g = node.gain;
    g.setValueAtTime(0.0001, at);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  }

  function kick(at) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(135, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.11);
    env(g, at, 0.004, 0.22, 1.0);
    o.connect(g); g.connect(drums); o.start(at); o.stop(at + 0.3);
  }
  function hit(at, { freq, q, peak, decay, type = "bandpass" }) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    env(g, at, 0.002, decay, peak);
    s.connect(f); f.connect(g); g.connect(drums); s.start(at); s.stop(at + decay + 0.05);
  }
  function tone(at, midi, len, dest, type, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.setValueAtTime(midiToHz(midi), at);
    f.type = "lowpass";
    f.frequency.setValueAtTime(type === "sawtooth" ? 900 : 2600, at);
    f.Q.value = 1;
    env(g, at, 0.008, len, peak);
    o.connect(f); f.connect(g); g.connect(dest);
    o.start(at); o.stop(at + len + 0.08);
  }

  function play(e, at) {
    switch (e.kind) {
      case "kick": return kick(at);
      case "snare": return hit(at, { freq: 1900, q: 0.7, peak: 0.55, decay: 0.16 });
      case "hat": return hit(at, { freq: 8200, q: 1.2, peak: e.soft ? 0.12 : 0.22, decay: 0.045, type: "highpass" });
      case "bass": return tone(at, e.midi, e.len, bass, "sawtooth", 0.8);
      case "lead": return tone(at, e.midi, e.len, lead, "square", 0.6);
    }
  }

  function pump() {
    if (startedAt === null) return;
    const now = ctx.currentTime - startedAt;
    const until = now + LOOKAHEAD;
    if (until <= scheduledTo) return;
    for (const e of eventsBetween(song, scheduledTo, until)) {
      play(e, startedAt + e.t);
    }
    scheduledTo = until;
  }

  return {
    get context() { return ctx; },
    // Song time, from the audio clock. Negative during the count-in.
    now() { return startedAt === null ? 0 : ctx.currentTime - startedAt; },
    async start(fromSongTime = 0) {
      await ctx.resume();
      startedAt = ctx.currentTime + 0.08 - fromSongTime;
      scheduledTo = fromSongTime;
      timer = setInterval(pump, TICK_MS);
      pump();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      startedAt = null;
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    },
    // Classic rhythm-game feedback: drop the lead when the player is missing.
    setLeadGain(v) { lead.gain.setTargetAtTime(v * 0.32, ctx.currentTime, 0.02); },
    async close() { if (timer) clearInterval(timer); await ctx.close().catch(() => {}); },
  };
}
