// port of model/Rules/EnclosureRules.cs
import { Terrain, Occupant } from '../grid.js';

/** Which land is shut in by walls. Rule: flood from every water cell and every non-wall cell on the map edge, stepping
 *  4-connected through non-wall cells. A land cell the flood never reaches is ENCLOSED. Walls touching only at a corner DO close
 *  the gap. A castle is enclosed when none of its cells was reached. Pure and order-independent. */
export const EnclosureRules = Object.freeze({
  /** A Uint8Array, 1 at index y*width+x where the flood reached the cell (outside), 0 where it did not. The C# returns bool[];
   *  read it by truthiness. extraWalls: a Set of indexes y*width+x treated as walls too (a what-if for a planner), or null. */
  outside(g, extraWalls = null) {
    const w = g.width, h = g.height, n = w * h;
    const occ = g._occupant, ter = g._terrain;
    const wall = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (occ[i] === Occupant.Wall) wall[i] = 1;
    if (extraWalls !== null) for (const i of extraWalls) if (i >= 0 && i < n) wall[i] = 1;
    const reached = new Uint8Array(n);
    const stack = new Int32Array(n);
    let sp = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const seed = ter[i] === Terrain.Water || (edge && !wall[i]);
        if (seed && !reached[i]) { reached[i] = 1; stack[sp++] = i; }
      }
    while (sp > 0) {
      const i = stack[--sp]; const x = i % w, y = (i - x) / w;
      if (x + 1 < w) { const j = i + 1; if (!reached[j] && !wall[j]) { reached[j] = 1; stack[sp++] = j; } }
      if (x - 1 >= 0) { const j = i - 1; if (!reached[j] && !wall[j]) { reached[j] = 1; stack[sp++] = j; } }
      if (y + 1 < h) { const j = i + w; if (!reached[j] && !wall[j]) { reached[j] = 1; stack[sp++] = j; } }
      if (y - 1 >= 0) { const j = i - w; if (!reached[j] && !wall[j]) { reached[j] = 1; stack[sp++] = j; } }
    }
    return reached;
  },

  /** Ids of the castles shut in, ascending. */
  enclosedCastleIds(g) {
    const outside = EnclosureRules.outside(g);
    const ids = [];
    for (const c of g.castles) {
      if (c.ruined) continue;                     // a graveyard is no castle until it is enclosed and restored
      let reachedAny = false;
      for (const cell of c.cells) if (outside[cell.y * g.width + cell.x]) { reachedAny = true; break; }
      if (!reachedAny) ids.push(c.id);
    }
    return ids;
  },

  /** How many land cells are enclosed (the territory a round's points are read from). */
  enclosedLandCells(g) {
    const outside = EnclosureRules.outside(g);
    const ter = g._terrain, occ = g._occupant;
    let n = 0;
    for (let i = 0; i < ter.length; i++)
      if (ter[i] === Terrain.Land && occ[i] !== Occupant.Wall && !outside[i]) n++;
    return n;
  },

  /** The territory: every enclosed area (the 4-connected non-wall ground the flood never reached), numbered 1..n (0 = open),
   *  and whose it is - every player whose walls ring it (a wall of theirs on any of its 8 neighbours). */
  map(g) {
    const outside = EnclosureRules.outside(g);
    const w = g.width, h = g.height;
    const occ = g._occupant, own = g._owner;
    const region = new Int32Array(w * h);
    const masks = [0];
    const walls = [new Int32Array(4)];
    const stack = [];
    for (let s = 0; s < region.length; s++) {
      if (outside[s] || region[s] !== 0 || occ[s] === Occupant.Wall) continue;
      const id = masks.length; let mask = 0; const count = new Int32Array(4);
      region[s] = id; stack.push(s);
      while (stack.length > 0) {
        const c = stack.pop(); const x = c % w, y = (c - x) / w;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (occ[n] === Occupant.Wall) {
              const o = own[n];
              if (o >= 0 && o < 4) { mask |= 1 << o; count[o]++; }
              continue;
            }
            if ((dx !== 0 && dy !== 0) || outside[n] || region[n] !== 0) continue;   // the area grows 4-connected only
            region[n] = id; stack.push(n);
          }
      }
      masks.push(mask); walls.push(count);
    }
    return new Territory(w, region, masks, walls);
  },
});

/** The enclosed areas and their owners (EnclosureRules.map). A view fills them in the owners' colours; the rules read which
 *  castles each player holds. */
export class Territory {
  constructor(width, region, owners, walls) { this._w = width; this._region = region; this._owners = owners; this._walls = walls; }
  get count() { return this._owners.length - 1; }
  /** The area square (x, y) belongs to, 0 when it is open. */
  regionAt(x, y) { return this._region[y * this._w + x]; }
  /** Bit s set: player slot s's walls ring that area. */
  ownersOf(region) { return region > 0 && region < this._owners.length ? this._owners[region] : 0; }
  holds(slot, region) { return (this.ownersOf(region) & (1 << slot)) !== 0; }
  /** The ringing player with the most wall squares on the area's edge (ties: the lowest slot), or -1 for none. */
  mainOwner(region) {
    if (region <= 0 || region >= this._walls.length) return -1;
    let best = -1;
    for (let s = 0; s < 4; s++) if (this._walls[region][s] > 0 && (best < 0 || this._walls[region][s] > this._walls[region][best])) best = s;
    return best;
  }
}
