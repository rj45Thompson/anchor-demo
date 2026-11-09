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

  /** The squares that make check() answer what it answers: the cells off the board (OutOfBounds), on water (OnWater), on swamp or
   *  lake (BadGround), occupied (Occupied) or under an enemy (EnemyThere); empty for Ok and UnknownShape. Same precedence as check,
   *  so a view outlines exactly the squares behind the reason it shows (UC-P1: the offending square outlined in red). */
  offending(grid, shape, quarterTurns, anchor, enemyAt = null) {
    const result = PlacementRules.check(grid, shape, quarterTurns, anchor, enemyAt);
    const out = [];
    if (result === PlacementResult.Ok || result === PlacementResult.UnknownShape) return out;
    for (const c of PlacementRules.cellsOf(shape, quarterTurns, anchor)) {
      const on = grid.in(c.x, c.y);
      let bad;
      switch (result) {
        case PlacementResult.OutOfBounds: bad = !on; break;
        case PlacementResult.OnWater: bad = on && grid.terrainAt(c.x, c.y) === Terrain.Water; break;
        case PlacementResult.BadGround: bad = on && grid.terrainAt(c.x, c.y) !== Terrain.Land && grid.terrainAt(c.x, c.y) !== Terrain.Water; break;
        case PlacementResult.Occupied: {
          const o = on ? grid.occupantAt(c.x, c.y) : Occupant.Empty;
          bad = o !== Occupant.Empty && o !== Occupant.House && o !== Occupant.Rubble; break;
        }
        case PlacementResult.EnemyThere: bad = enemyAt !== null && on && enemyAt(c.x, c.y); break;
        default: throw new Error('PlacementRules.offending: check() answered ' + result + ', which names no square');
      }
      if (bad) out.push(c);
    }
    return out;
  },

  /** The board cells the piece would cover (no legality check). */
  cellsOf(shape, quarterTurns, anchor) {
    const o = shape.rotated(quarterTurns);
    const r = new Array(o.length);
    for (let i = 0; i < o.length; i++) r[i] = new Cell(anchor.x + o[i].x, anchor.y + o[i].y);
    return r;
  },
});
