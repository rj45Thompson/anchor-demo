// port of model/Pieces.cs
import { Cell } from './cell.js';

/** A wall piece: the cells it covers around a pivot at (0,0). A shape is DATA (id + offsets), never code. AUTHORED in the
 *  private model (its own starting set); replace it by passing another catalog - nothing else in the core names a shape. */
export class PieceShape {
  constructor(id, name, ...cells) {
    if (cells.length === 0) throw new Error('a piece covers at least one cell');
    for (const c of cells) if (!(c instanceof Cell)) throw new TypeError('a piece cell is a Cell');
    this.id = id;
    this.name = name;
    this._cells = cells;
  }

  get cellCount() { return this._cells.length; }

  /** The offsets after quarterTurns clockwise turns about the pivot: (x,y) -> (-y,x) per turn. Four turns return the original. */
  rotated(quarterTurns) {
    const t = ((quarterTurns % 4) + 4) % 4;
    const r = new Array(this._cells.length);
    for (let i = 0; i < r.length; i++) {
      let x = this._cells[i].x, y = this._cells[i].y;
      for (let k = 0; k < t; k++) { const nx = -y; y = x; x = nx; }
      r[i] = new Cell(x, y);
    }
    return r;
  }
}

/** The ordered set of shapes a match deals from. Order is the given order. */
export class PieceCatalog {
  constructor(...shapes) {
    if (shapes.length === 0) throw new Error('a catalog holds at least one shape');
    const seen = new Set();
    for (const s of shapes) {
      if (seen.has(s.id)) throw new Error('shape id ' + s.id + ' appears twice');
      seen.add(s.id);
    }
    this._shapes = shapes.slice();
    this._weights = null;     // null = every shape once per bag (the ported behaviour); see withWeights
  }

  /** The same shapes with a per-bag COUNT for each shape id: PieceDealer puts weightOf(id) copies of the shape into every bag, so a
   *  shape with weight 1 among bigger weights is rare, and the bag stays a shuffle (deterministic, no extra random draw). A shape
   *  with no entry has weight 1. A weight is a whole number >= 1; an id that is not in the catalog is refused. */
  withWeights(weights) {
    const c = new PieceCatalog(...this._shapes);
    for (const id of Object.keys(weights)) {
      if (this.byId(Number(id)) === null) throw new Error('weight for a shape id that is not in the catalog: ' + id);
      if (!Number.isInteger(weights[id]) || weights[id] < 1) throw new RangeError('shape ' + id + ' weight must be a whole number >= 1, got ' + weights[id]);
    }
    c._weights = { ...weights };
    return c;
  }

  /** How many copies of this shape one bag holds. */
  weightOf(id) { return this._weights !== null && this._weights[id] !== undefined ? this._weights[id] : 1; }

  /** Pieces in one bag (the sum of the weights). */
  get bagSize() { let n = 0; for (const s of this._shapes) n += this.weightOf(s.id); return n; }

  /** The mean number of squares of a piece dealt from this catalog (over one bag, exact, as a fraction numerator / bagSize). */
  get squaresPerBag() { let n = 0; for (const s of this._shapes) n += this.weightOf(s.id) * s.cellCount; return n; }

  get count() { return this._shapes.length; }
  at(index) { return this._shapes[index]; }

  /** The shape with this id, or null (the C# answers null; PlacementRules turns that into UnknownShape). */
  byId(id) {
    for (let i = 0; i < this._shapes.length; i++) if (this._shapes[i].id === id) return this._shapes[i];
    return null;
  }

  /** The starting set: dot, domino, line3, corner3, square, L4, T4, S4, Z4, line4, plus. */
  static default() {
    const c = (x, y) => new Cell(x, y);
    return new PieceCatalog(
      new PieceShape(1, 'dot', c(0, 0)),
      new PieceShape(2, 'domino', c(0, 0), c(1, 0)),
      new PieceShape(3, 'line3', c(0, 0), c(1, 0), c(2, 0)),
      new PieceShape(4, 'corner3', c(0, 0), c(1, 0), c(0, 1)),
      new PieceShape(5, 'square', c(0, 0), c(1, 0), c(0, 1), c(1, 1)),
      new PieceShape(6, 'L4', c(0, 0), c(0, 1), c(0, 2), c(1, 2)),
      new PieceShape(7, 'T4', c(0, 0), c(1, 0), c(2, 0), c(1, 1)),
      new PieceShape(8, 'S4', c(1, 0), c(2, 0), c(0, 1), c(1, 1)),
      new PieceShape(9, 'Z4', c(0, 0), c(1, 0), c(1, 1), c(2, 1)),
      new PieceShape(10, 'line4', c(0, 0), c(1, 0), c(2, 0), c(3, 0)),
      new PieceShape(11, 'plus', c(1, 0), c(0, 1), c(1, 1), c(2, 1), c(1, 2)));
  }

  /** THE TIDEWALL SET (the bomb rule set, RJ 2026-11-09: "shrink the size of the Tetris pieces a little bit so that we could get more
   *  area to play"): pieces of 1 to 4 squares, no plus. Shape ids 1-10 are the starting set's own (same cells), 12 is new (the mirror
   *  of L4), so no id the traces use moves; the plus (11) is simply absent. BAG: the weights below, per bag of 22 -
   *  dot 1 (rare: 1 in 22), domino 5, line3 3, corner3 4, square 2, L4 1, J4 1, T4 2, S4 1, Z4 1, line4 1 = 68 squares, mean 3.09. */
  static tidewall() {
    const c = (x, y) => new Cell(x, y);
    const cat = new PieceCatalog(
      new PieceShape(1, 'dot', c(0, 0)),
      new PieceShape(2, 'domino', c(0, 0), c(1, 0)),
      new PieceShape(3, 'line3', c(0, 0), c(1, 0), c(2, 0)),
      new PieceShape(4, 'corner3', c(0, 0), c(1, 0), c(0, 1)),
      new PieceShape(5, 'square', c(0, 0), c(1, 0), c(0, 1), c(1, 1)),
      new PieceShape(6, 'L4', c(0, 0), c(0, 1), c(0, 2), c(1, 2)),
      new PieceShape(7, 'T4', c(0, 0), c(1, 0), c(2, 0), c(1, 1)),
      new PieceShape(8, 'S4', c(1, 0), c(2, 0), c(0, 1), c(1, 1)),
      new PieceShape(9, 'Z4', c(0, 0), c(1, 0), c(1, 1), c(2, 1)),
      new PieceShape(10, 'line4', c(0, 0), c(1, 0), c(2, 0), c(3, 0)),
      new PieceShape(12, 'J4', c(1, 0), c(1, 1), c(1, 2), c(0, 2)));
    return cat.withWeights(PieceCatalog.TidewallWeights);
  }
}

/** Copies of each shape in one Tidewall bag, by shape id (see PieceCatalog.tidewall). */
PieceCatalog.TidewallWeights = Object.freeze({ 1: 1, 2: 5, 3: 3, 4: 4, 5: 2, 6: 1, 7: 2, 8: 1, 9: 1, 10: 1, 12: 1 });
