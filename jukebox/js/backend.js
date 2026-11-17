// Picks a renderer: WebGPU where the browser has it, WebGL 2 where it does not, and
// says why in words a player can read. A fault in one backend never leaves a black
// screen, because the next one is tried.
import { createGlBackend } from "./gl.js";
import { createGpuBackend } from "./gpu.js";

// `want` is "auto", "gpu" or "gl"; the page's ?backend= passes it straight through so
// a machine with both can be made to show either.
export async function pickBackend(canvas, want = "auto") {
  const notes = [];
  if (want === "auto" || want === "gpu") {
    try {
      return { backend: await createGpuBackend(canvas), why: "WebGPU." };
    } catch (e) {
      notes.push(e && e.message ? e.message : String(e));
      if (want === "gpu") throw new Error(`WebGPU was asked for and could not start: ${notes[0]}`);
    }
  }
  if (want === "auto" || want === "gl") {
    try {
      const backend = await createGlBackend(canvas);
      const first = notes[0];
      return {
        backend,
        why: first
          ? `${first[0].toUpperCase()}${first.slice(1)}, so the same highway is drawn with WebGL 2.`
          : "WebGL 2.",
      };
    } catch (e) {
      notes.push(e && e.message ? e.message : String(e));
    }
  }
  throw new Error(`no renderer could start: ${notes.join("; ")}`);
}
