// port of model/Rules/PathRules.cs
import { Cell } from '../cell.js';

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/** PathRules.Result (a nested enum in the C#). */
export const PathResult = Object.freeze({ AtGoal: 0, Stepped: 1, NoPath: 2 });

/** Shortest grid paths for ships (over water) and grunts (over land), 4-connected, with a FIXED neighbour order (+x, -x, +y, -y)
 *  so every machine picks the same step. */
export const PathRules = Object.freeze({
  Result: PathResult,

  /** From `start`, walking only cells `passable(x, y)` allows, find the nearest cell `goal(x, y)` accepts (breadth first, ties
   *  in neighbour order). Returns { result, next }: AtGoal when start already is one (next = start); Stepped with the first step
   *  of the path; NoPath otherwise (next = start). The C# `out Cell next` is the returned `next`. */
  nextStep(g, start, passable, goal) {
    if (goal(start.x, start.y)) return { result: PathResult.AtGoal, next: start };
    const w = g.width, n = w * g.height;
    const parent = new Int32Array(n).fill(-2);
    const s = start.y * w + start.x;
    parent[s] = -1;
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    q[qt++] = s;
    while (qh < qt) {
      const c = q[qh++]; const cx = c % w, cy = (c / w) | 0;
      for (let k = 0; k < 4; k++) {
        const x = cx + DX[k], y = cy + DY[k];
        if (!g.in(x, y)) continue;
        const i = y * w + x;
        if (parent[i] !== -2 || !passable(x, y)) continue;
        parent[i] = c;
        if (goal(x, y)) {
          let step = i;
          while (parent[step] !== s) step = parent[step];
          return { result: PathResult.Stepped, next: new Cell(step % w, (step / w) | 0) };
        }
        q[qt++] = i;
      }
    }
    return { result: PathResult.NoPath, next: start };
  },

  manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); },
});
