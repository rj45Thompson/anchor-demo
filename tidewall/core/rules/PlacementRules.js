// port of model/Rules/PlacementRules.cs
import { Cell } from '../cell.js';
import { Terrain, Occupant } from '../grid.js';

export const PlacementResult = Object.freeze({
  Ok: 0, OutOfBounds: 1, OnWater: 2, Occupied: 3, UnknownShape: 4, WrongPiece: 5, BadSlot: 6,
  WrongPhase: 7, EnemyThere: 8, Disconnected: 9, BadGround: 10, GraceUsed: 11, SwordOut: 12,
});

/** Where a wall piece may go. Legal = every covered cell is on the board, on land, and empty (or rubble, or a house). Pure:
 *  reads the board, changes nothing. */
export const PlacementRules = Object.freeze({
  /** enemyAt(x, y): true where an enemy stands (a piece cannot land on one); null or omitted = no enemies. */
  check(grid, shape, quarterTurns, anchor, enemyAt = null) {
    if (shape === null || shape === undefined) return PlacementResult.UnknownShape;
    const offsets = shape.rotated(quarterTurns);
    // Precedence is fixed so the reason never depends on which cell comes first: off the board, then water, then occupied.
    for (let i = 0; i < offsets.length; i++)
      if (!grid.in(anchor.x + offsets[i].x, anchor.y + offsets[i].y)) return PlacementResult.OutOfBounds;
    for (let i = 0; i < offsets.length; i++)
      if (grid.terrainAt(anchor.x + offsets[i].x, anchor.y + offsets[i].y) === Terrain.Water) return PlacementResult.OnWater;
    for (let i = 0; i < offsets.length; i++)
      if (grid.terrainAt(anchor.x + offsets[i].x, anchor.y + offsets[i].y) !== Terrain.Land) return PlacementResult.BadGround;
    for (let i = 0; i < offsets.length; i++) {
      const o = grid.occupantAt(anchor.x + offsets[i].x, anchor.y + offsets[i].y);
      // a house may be built over; rubble too (a broken wall is open ground to repair). Everything else blocks.
      if (o !== Occupant.Empty && o !== Occupant.House && o !== Occupant.Rubble) return PlacementResult.Occupied;
    }
    if (enemyAt !== null)
      for (let i = 0; i < offsets.length; i++)
        if (enemyAt(anchor.x + offsets[i].x, anchor.y + offsets[i].y)) return PlacementResult.EnemyThere;
    return PlacementResult.Ok;
  },

  /** The board cells the piece would cover (no legality check). */
  cellsOf(shape, quarterTurns, anchor) {
    const o = shape.rotated(quarterTurns);
    const r = new Array(o.length);
    for (let i = 0; i < o.length; i++) r[i] = new Cell(anchor.x + o[i].x, anchor.y + o[i].y);
    return r;
  },
});
