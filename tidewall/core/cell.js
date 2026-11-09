// port of model/Cell.cs

/** One square of the board, in whole cells. The core never holds a world position: converting a screen or world point to a
 *  cell is the host's job, done with CellMath.floorDiv (never a truncating cast). Immutable, like the C# readonly struct. */
export class Cell {
  constructor(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new TypeError('a cell is two whole numbers, got ' + x + ',' + y);
    this.x = x;
    this.y = y;
    Object.freeze(this);
  }
  toString() { return this.x + ',' + this.y; }
  /** C# `default(Cell)`: (0, 0). */
  static get zero() { return ZERO; }
}

const ZERO = new Cell(0, 0);
