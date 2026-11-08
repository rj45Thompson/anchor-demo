// perf.js - what the page spends its time on while it loads (UC-30; RJ 11-07: "sometimes a crazy lag for ten seconds when the game
// loads. Test that out with logging"). Off unless the address has ?perf: then it records every long animation frame (Chrome's
// long-animation-frame entries, with the scripts that ran in them), every long task, every gap between drawn frames over GAP_MS,
// and the page's own stages (app.js calls mark()), prints the timeline to the console REPORT_S in, and keeps it in
// window.HOC_PERF for the page check. AUTHORED: GAP_MS 50 (three frames at 60 Hz) and REPORT_S 30 (the lot is loaded by then).
const ON = typeof location !== 'undefined' && /[?&]perf\b/.test(location.search);   // node (test/perf.test.mjs) has no address
const GAP_MS = 50, REPORT_S = 30;
export const perf = { on: ON, frames: [], loaf: [], tasks: [], marks: [], said: [] };
const now = () => Math.round(performance.now());
/** a stage of the page's own, with what it was about (a file, a car) */
export function mark(name, detail) { if (ON) perf.marks.push({ t: now(), name, detail: detail === undefined ? '' : String(detail) }); }
/** time a piece of work and mark it with how long it took */
export async function timed(name, detail, fn) {
  if (!ON) return fn();
  const t = performance.now(); const r = await fn();
  perf.marks.push({ t: Math.round(t), name, detail: String(detail), ms: Math.round(performance.now() - t) }); return r;
}
function observe(type, take) {
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) take(e); }).observe({ type, buffered: true }); }
  catch (e) { perf.said.push('this browser keeps no ' + type + ' entries (' + e.message + ')'); }   // UC-30.2a: said, not hidden
}
if (ON) {
  window.HOC_PERF = perf;
  observe('long-animation-frame', (e) => perf.loaf.push({ t: Math.round(e.startTime), ms: Math.round(e.duration), blocking: Math.round(e.blockingDuration || 0),
    render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0),
    scripts: (e.scripts || []).map((s) => ({ ms: Math.round(s.duration), where: (s.sourceURL || '').split('/').pop() + (s.sourceFunctionName ? ' ' + s.sourceFunctionName : ''), what: s.invoker || '' }))
      .sort((a, b) => b.ms - a.ms).slice(0, 4) }));
  observe('longtask', (e) => perf.tasks.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) }));
  let last = performance.now();
  const tick = (t) => { if (t - last > GAP_MS) perf.frames.push({ t: Math.round(last), gap: Math.round(t - last) }); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setTimeout(() => report(), REPORT_S * 1000);
}
/** the timeline: the longest frames with what ran in them, beside the page's own stages; in the console, and on the screen (a phone
 *  has no console to read) */
export function report() {
  const lines = [];
  const longest = perf.frames.slice().sort((a, b) => b.gap - a.gap).slice(0, 8);
  lines.push(REPORT_S + ' s in: ' + perf.frames.length + ' frame gaps over ' + GAP_MS + ' ms, longest ' + (longest[0] ? longest[0].gap : 0) + ' ms; ' +
    perf.tasks.length + ' long tasks, ' + perf.tasks.reduce((a, x) => a + x.ms, 0) + ' ms in all' + (perf.said.length ? '; ' + perf.said.join('; ') : ''));
  for (const f of longest) {
    const lf = perf.loaf.filter((x) => x.t <= f.t + f.gap && x.t + x.ms >= f.t).sort((a, b) => b.ms - a.ms)[0];
    const near = perf.marks.filter((m) => m.t >= f.t - 50 && m.t <= f.t + f.gap + 50).map((m) => m.name + (m.detail ? ' ' + m.detail : '') + (m.ms ? ' (' + m.ms + ' ms)' : ''));
    lines.push(' ' + f.gap + ' ms gap at ' + f.t + ' ms' + (lf ? ': render ' + lf.render + ' ms, scripts ' + lf.scripts.map((s) => s.ms + ' ms ' + s.where + ' ' + s.what).join(' | ') : '') + (near.length ? ' // ' + near.join(', ') : ''));
  }
  for (const m of perf.marks) lines.push(' mark ' + m.t + ' ms ' + m.name + (m.detail ? ' ' + m.detail : '') + (m.ms ? ' (' + m.ms + ' ms)' : ''));
  for (const l of lines) console.log('[perf]' + l);
  const box = document.createElement('div');
  box.id = 'perfbox';
  box.style.cssText = 'position:fixed;z-index:20;left:8px;right:8px;bottom:8px;max-height:45vh;overflow:auto;padding:10px;border-radius:10px;background:rgba(10,10,10,.92);border:1px solid #f25827;color:#fefefe;font:11px/1.35 ui-monospace,Consolas,monospace;white-space:pre-wrap';
  box.textContent = 'Load timeline (?perf), tap to close\n' + lines.join('\n');
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
  return perf;
}

// ---------------------------------------------------------------- the page's resolution (UC-7.2a)
// ResolutionGovernor: which pixel ratio the page draws at. It steps down only when frames are steadily slow AND fewer pixels
// make them quicker; a step that buys no time is undone, so a frame that is slow for another reason keeps its full picture.
// Why (RJ 11-07: "pixelated the wraith and before it was smooth"), measured 11-07 on his PC (RTX 2080, Chrome 156, WebGPU,
// headless, 2048 x 1000 CSS px at devicePixelRatio 1.25; test/fixtures/frames_rtx2080.json): the lot's frame is ~20 ms of the
// page's own JavaScript (1,070 draws a frame) and took 20.4 ms at 1.25x and 21.3 ms at 0.75x; the strip mid-run 20.3 and 21.1 ms.
// The rule this replaces (app.js adapt, rounds 14-19: a 2 s MEAN over 1/45 s steps down, and only three 2 s means under 1/57 s
// step back up) took those frames for a slow GPU: the lot fell to 0.75x within 13 s in rounds 16 and 17 and never climbed back,
// because no resolution makes a 20 ms frame of JavaScript quicker.
// The window's measure is the mean of its quickest TRIM share of frames (steadyFrame), so the few long frames of a model joining,
// the launch or a shader build do not read as a slow GPU. A step down needs DROP_N windows in a row over DROP_S that agree within
// PAYS (a steady slowness, not the load settling); the window after it is the verdict: kept if PAYS quicker, else undone, and the
// same slowness (within PAYS of the one that failed) is not tried again. Up: RAISE_N windows in a row under RAISE_S, as before.
// AUTHORED: WINDOW_S, DROP_S, RAISE_S and RAISE_N are the old rule's; TRIM, PAYS and DROP_N are this one's.
export const GOVERNOR = { WINDOW_S: 2, DROP_S: 1 / 45, RAISE_S: 1 / 57, RAISE_N: 3, DROP_N: 2, TRIM: 0.9, PAYS: 0.1 };
/** the mean of the quickest `share` of a window's frame intervals */
export function steadyFrame(dts, share) {
  if (!dts.length) throw new Error('steadyFrame: a window with no frames');
  const s = dts.slice().sort((a, b) => a - b), n = Math.max(1, Math.round(s.length * share));
  let sum = 0; for (let k = 0; k < n; k++) sum += s[k];
  return sum / n;
}
export class ResolutionGovernor {
  /** ladder: the pixel ratios it may draw at, lowest first (app.js: 0.75 up to the screen's own, at most 2). It starts at the top */
  constructor(ladder, o = GOVERNOR) {
    if (!ladder.length || ladder.some((x, k) => !(x > 0) || (k && x <= ladder[k - 1]))) throw new Error('ResolutionGovernor: the ladder must be rising pixel ratios, got ' + JSON.stringify(ladder));
    this.ladder = ladder.slice(); this.o = o; this.i = ladder.length - 1;
    this.win = []; this.t = 0;
    this.slow = [];          // the measures of the slow windows in a row
    this.good = 0;           // quick windows in a row
    this.trial = null;       // a step down waiting for its verdict: { from, before }
    this.failedAt = null;    // the measure a step down did not improve
    this.log = [];           // what it did and why: { did, ratio, ms, beforeMs }
  }
  get ratio() { return this.ladder[this.i]; }
  /** one frame's interval in seconds; true when the ratio changed */
  frame(dt) {
    this.win.push(dt); this.t += dt;
    if (this.t < this.o.WINDOW_S) return false;
    const m = steadyFrame(this.win, this.o.TRIM);
    this.win = []; this.t = 0;
    return this.judge(m);
  }
  /** one window's measure (s); true when the ratio changed */
  judge(m) {
    const o = this.o;
    if (this.trial) {
      const t = this.trial; this.trial = null; this.slow = [];
      if (m > t.before * (1 - o.PAYS)) { this.i = t.from; this.failedAt = t.before; this.say('undone: fewer pixels bought no time', m, t.before); return true; }
      this.say('kept: fewer pixels made the frame quicker', m, t.before);
    }
    if (m > o.DROP_S) {
      this.good = 0; this.slow.push(m); if (this.slow.length > o.DROP_N) this.slow.shift();
      const hi = Math.max(...this.slow), lo = Math.min(...this.slow);
      const steady = this.slow.length >= o.DROP_N && hi - lo <= o.PAYS * hi;
      const triedThis = this.failedAt !== null && m <= this.failedAt * (1 + o.PAYS);
      if (steady && !triedThis && this.i > 0) {
        this.trial = { from: this.i, before: this.slow.reduce((x, y) => x + y, 0) / this.slow.length }; this.i--; this.slow = [];
        this.say('down: frames steadily slow, trying fewer pixels', m); return true;
      }
      return false;
    }
    this.slow = [];
    if (m < o.RAISE_S) {
      this.failedAt = null;
      if (++this.good >= o.RAISE_N && this.i < this.ladder.length - 1) { this.i++; this.good = 0; this.say('up: frames quick', m); return true; }
    } else this.good = 0;
    return false;
  }
  say(did, m, before) { this.log.push({ did, ratio: this.ratio, ms: +(m * 1000).toFixed(1), beforeMs: before === undefined ? null : +(before * 1000).toFixed(1) }); }
}
