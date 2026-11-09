// port of model/Rules/CellMath.cs

/** Integer cell arithmetic. Rule: a cell is the FLOOR of the position over the cell size, for every sign (a truncating cast
 *  puts every cell left of or below the origin one square off). */
export const CellMath = Object.freeze({
  /** floor(a / b) for b > 0, correct for negative a. Whole numbers in, whole number out (C# int). */
  floorDiv(a, b) {
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new TypeError('floorDiv takes whole numbers');
    if (b <= 0) throw new RangeError('a cell size is positive');
    const q = Math.trunc(a / b);
    return (a % b !== 0 && a < 0) ? q - 1 : q;
  },

  /** The cell holding a fixed-point position (Q16: 65536 = one cell) - the only world-to-cell conversion in the core. */
  cellOfQ16(q16) { return CellMath.floorDiv(q16, 65536); },
});
