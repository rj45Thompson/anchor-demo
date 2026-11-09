// port of model/Controller/WallOutline.cs
import { Occupant } from '../grid.js';
import { WallsPlaced, RingBuilt } from '../match/Events.js';

/** Which placed piece each wall square came from (a view model). The view draws one block per square and outlines each PIECE, so it
 *  has to know which squares were laid together. The rules never need this (a wall is a wall), so it lives beside the HUD, fed from
 *  the same events: a piece placed, a castle's ring built. A wall square no event named (a map's own wall) is a piece of its own. */
export class PieceMap {
  constructor(width, height) {
    this._w = width;
    this._piece = new Int32Array(width * height);
    this._next = 1;
  }

  /** The piece of square (x, y); a square no piece event named answers a number of its own (negative). */
  at(x, y) { const i = y * this._w + x; return this._piece[i] !== 0 ? this._piece[i] : -(i + 1); }

  shown(e) {
    if (e instanceof WallsPlaced) this._mark(e.cells);
    else if (e instanceof RingBuilt) this._mark(e.cells);
  }

  _mark(cells) { const id = this._next++; for (const c of cells) this._piece[c.y * this._w + c.x] = id; }
}

const Kind = Object.freeze({ Top: 0, Bottom: 1, Upright: 2 });

/** One outline edge. Corners in square units: (x, y) is the top-left corner of square (x, y). `cell` is the square it belongs to
 *  (y * width + x); `side` 0 N, 1 E, 2 S, 3 W (-1 for an upright). */
class Edge {
  constructor(x0, y0, x1, y1, cell, side, kind) {
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.cell = cell; this.side = side; this.kind = kind;
    Object.freeze(this);
  }
}

const Dx = [0, 1, 0, -1], Dy = [-1, 0, 1, 0];

function same(g, pieces, x, y, me) {
  return g.in(x, y) && g.occupantAt(x, y) === Occupant.Wall && pieces.at(x, y) === me;
}

/** The 3D outline of every placed piece: the edges of its silhouette and nothing between its own squares. A square's side is an
 *  OUTER face when the square beside it is not the same piece; each outer face gives a top edge and a bottom edge; a corner gives an
 *  upright edge when it is convex (both sides outer) or concave (both sides inner but the diagonal square is not the piece). */
export class WallOutline {
  static Kind = Kind;
  static Edge = Edge;

  /** Every edge, in the order the C# builds them (row by row, then side by side, then corner by corner). */
  static build(g, pieces) {
    const edges = [];
    const w = g.width;
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < w; x++) {
        if (g.occupantAt(x, y) !== Occupant.Wall) continue;
        const me = pieces.at(x, y), i = y * w + x;
        const outer = [false, false, false, false];
        for (let s = 0; s < 4; s++) {
          outer[s] = !same(g, pieces, x + Dx[s], y + Dy[s], me);
          if (!outer[s]) continue;
          // the side's two corners: N (x,y)-(x+1,y), E (x+1,y)-(x+1,y+1), S (x,y+1)-(x+1,y+1), W (x,y)-(x,y+1)
          const ax = s === 1 ? x + 1 : x, ay = s === 2 ? y + 1 : y;
          const bx = s === 3 ? x : x + 1, by = s === 0 ? y : y + 1;
          edges.push(new Edge(ax, ay, bx, by, i, s, Kind.Top));
          edges.push(new Edge(ax, ay, bx, by, i, s, Kind.Bottom));
        }
        // the four corners: NE between N(0) and E(1), SE between E(1) and S(2), SW between S(2) and W(3), NW between W(3) and N(0)
        for (let c = 0; c < 4; c++) {
          const s1 = c, s2 = (c + 1) % 4;
          const cx = x + (Dx[s1] + Dx[s2] > 0 ? 1 : 0), cy = y + (Dy[s1] + Dy[s2] > 0 ? 1 : 0);
          const convex = outer[s1] && outer[s2];
          const concave = !outer[s1] && !outer[s2] && !same(g, pieces, x + Dx[s1] + Dx[s2], y + Dy[s1] + Dy[s2], me);
          if (convex || concave) edges.push(new Edge(cx, cy, cx, cy, i, -1, Kind.Upright));
        }
      }
    return edges;
  }
}
