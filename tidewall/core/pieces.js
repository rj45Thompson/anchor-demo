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
  }

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
}
