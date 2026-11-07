// perf.js - what the page spends its time on while it loads (UC-30; RJ 11-07: "sometimes a crazy lag for ten seconds when the game
// loads. Test that out with logging"). Off unless the address has ?perf: then it records every long animation frame (Chrome's
// long-animation-frame entries, with the scripts that ran in them), every long task, every gap between drawn frames over GAP_MS,
// and the page's own stages (app.js calls mark()), prints the timeline to the console REPORT_S in, and keeps it in
// window.HOC_PERF for the page check. AUTHORED: GAP_MS 50 (three frames at 60 Hz) and REPORT_S 30 (the lot is loaded by then).
const ON = /[?&]perf\b/.test(location.search);
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
