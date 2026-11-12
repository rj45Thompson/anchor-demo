// port of model/GridModel.cs
import { Cell } from './cell.js';

/** Ground. Swamp and Lake are the full rules' (GameType.Full): no wall and no grunt on them, and they turn to Land once enclosed. A
 *  lake is inland: it never counts as the open sea for the enclosure flood. A normal match turns both to Land at load (MatchModel.plain). */
export const Terrain = Object.freeze({ Water: 0, Land: 1, Swamp: 2, Lake: 3 });

/** What stands on a square. Appended only (old values keep their meaning). Rocks, trees and houses (5..8) come from a map that
 *  names them, and a normal campaign clears them at load (MatchModel.plain); Graveyard (9) is a ruined castle; Pit (10) is a burning
 *  pit (a fireship's, a dreadnought's or a mortar's ball; it burns out after rules.pitBattles battles); Kite (11) is a kite's 3x3
 *  emplacement (the full rules). A Mortar stands on Cannon squares. */
export const Occupant = Object.freeze({
  Empty: 0, Wall: 1, Castle: 2, Cannon: 3, Rubble: 4,
  RockSmall: 5, RockLarge: 6, Tree: 7, House: 8, Graveyard: 9, Pit: 10, Kite: 11,
});

/** A castle: the cells it covers. Found from the map once, at build time; ids are 1.. in row-major discovery order. */
export class Castle {
  constructor(id, cells) {
    this.id = id;
    this.cells = cells;
    /** Destroyed by grunts: its squares are a graveyard until it is enclosed again. */
    this.ruined = false;
  }
}

// ---- 64-bit FNV-1a -------------------------------------------------------------------------------------------------------
// The C# hashes in ulong. The public surface here is BigInt (HashStart, mix, hash, stateHash return BigInt), exactly the C#
// values. Inside, the arithmetic runs on two 32-bit halves because a BigInt multiply per byte made a board hash ~100x slower;
// test/parity/unit_rules.mjs proves the halves against BigInt on random inputs, and every parity trace proves them against .NET.

const TWO32 = 4294967296;

/** A running FNV-1a 64 value as two uint32 halves. mix(v) feeds the 8 little-endian bytes of v as a C# (ulong) cast sees them. */
export class Fnv64 {
  constructor(hi, lo) { this.hi = hi >>> 0; this.lo = lo >>> 0; }

  static fromBigInt(h) {
    if (typeof h !== 'bigint') throw new TypeError('a hash is a BigInt');
    const m = h & 0xFFFFFFFFFFFFFFFFn;
    return new Fnv64(Number(m >> 32n), Number(m & 0xFFFFFFFFn));
  }

  toBigInt() { return (BigInt(this.hi) << 32n) | BigInt(this.lo); }

  /** Hex, 16 digits, lower case (C#: ToString("x16")). */
  toHex() { return this.hi.toString(16).padStart(8, '0') + this.lo.toString(16).padStart(8, '0'); }

  /** Feed one 64-bit value given as its two uint32 halves. */
  mixHalves(vhi, vlo) {
    let hi = this.hi, lo = this.lo;
    for (let b = 0; b < 4; b++) {
      lo = (lo ^ ((vlo >>> (8 * b)) & 0xFF)) >>> 0;
      const a = lo * 0x1B3;
      const nlo = a >>> 0;
      hi = (Math.imul(hi, 0x1B3) + (lo << 8) + (a - nlo) / TWO32) >>> 0;
      lo = nlo;
    }
    for (let b = 0; b < 4; b++) {
      lo = (lo ^ ((vhi >>> (8 * b)) & 0xFF)) >>> 0;
      const a = lo * 0x1B3;
      const nlo = a >>> 0;
      hi = (Math.imul(hi, 0x1B3) + (lo << 8) + (a - nlo) / TWO32) >>> 0;
      lo = nlo;
    }
    this.hi = hi; this.lo = lo;
    return this;
  }

  /** Feed a whole number as C#'s `(ulong)v` of a long: negatives are two's complement. Safe integers only. */
  mix(v) {
    if (!Number.isSafeInteger(v)) throw new RangeError('hash input must be a safe integer, got ' + v);
    return this.mixHalves(Math.floor(v / TWO32) >>> 0, v >>> 0);
  }

  /** Feed a boolean as 1 or 0 (the C# writes `b ? 1 : 0`). */
  mixBool(b) { return this.mixHalves(0, b ? 1 : 0); }
}

/** The board: the ONE home of what is on every square. Whole-cell integers only. Walls belong to a player slot (0..3) via
 *  owner; owner is 255 (NoOwner) where no one owns the cell. Bytes are stored in Uint8Arrays, which wrap like the C# (byte) cast. */
export class GridModel {
  static NoOwner = 255;
  static HashStart = 14695981039346656037n;

  constructor(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError('a board has cells');
    this.width = width;
    this.height = height;
    const n = width * height;
    this._terrain = new Uint8Array(n);
    this._occupant = new Uint8Array(n);
    this._owner = new Uint8Array(n).fill(GridModel.NoOwner);
    this._health = new Uint8Array(n);
    this._castles = [];
  }

  get castles() { return this._castles; }

  in(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  _i(x, y) {
    if (!this.in(x, y)) throw new RangeError('cell (' + x + ',' + y + ') is off the ' + this.width + 'x' + this.height + ' board');
    return y * this.width + x;
  }

  terrainAt(x, y) { return this._terrain[this._i(x, y)]; }
  occupantAt(x, y) { return this._occupant[this._i(x, y)]; }
  ownerAt(x, y) { return this._owner[this._i(x, y)]; }
  healthAt(x, y) { return this._health[this._i(x, y)]; }

  setWall(x, y, ownerSlot, health) {
    const i = this._i(x, y);
    this._occupant[i] = Occupant.Wall; this._owner[i] = ownerSlot; this._health[i] = health;
  }

  /** A cannon's cell (its health lives on the CannonModel; the board only says the square is taken, and by whom). */
  setCannon(x, y, ownerSlot) {
    const i = this._i(x, y);
    this._occupant[i] = Occupant.Cannon; this._owner[i] = ownerSlot; this._health[i] = 0;
  }

  setHealth(x, y, health) { this._health[this._i(x, y)] = health; }

  /** Put a thing on a square (a rock, tree, house, pit, graveyard, or Empty). Owner is cleared. */
  setThing(x, y, what, health) {
    if (what === Occupant.Wall || what === Occupant.Cannon || what === Occupant.Castle) throw new Error('walls, cannons and castles have their own setters');
    const i = this._i(x, y);
    if (this._occupant[i] === Occupant.Castle) throw new Error('a castle square is never overwritten (REQ-BOARD-05)');
    this._occupant[i] = what; this._owner[i] = GridModel.NoOwner; this._health[i] = health;
  }

  /** An emplacement's square (a kite's), owned like a cannon's. */
  setEmplacement(x, y, what, ownerSlot) {
    const i = this._i(x, y);
    this._occupant[i] = what; this._owner[i] = ownerSlot; this._health[i] = 0;
  }

  setTerrain(x, y, t) { this._terrain[this._i(x, y)] = t; }

  /** A castle's squares become a graveyard (ruined) or a castle again (restored). The only way a castle square changes. */
  setCastleRuined(c, ruined) {
    c.ruined = ruined;
    for (const cell of c.cells) this._occupant[this._i(cell.x, cell.y)] = ruined ? Occupant.Graveyard : Occupant.Castle;
  }

  /** A broken wall or cannon square: debris that is drawn and open ground - a wall may be built straight back on it. */
  setRubble(x, y) {
    const i = this._i(x, y);
    this._occupant[i] = Occupant.Rubble; this._owner[i] = GridModel.NoOwner; this._health[i] = 0;
  }

  clearCell(x, y) {
    const i = this._i(x, y);
    if (this._occupant[i] === Occupant.Castle) throw new Error('a castle square is never cleared (REQ-BOARD-05)');
    this._occupant[i] = Occupant.Empty; this._owner[i] = GridModel.NoOwner; this._health[i] = 0;
  }

  /** Build a board from rows of text: '~' water, '.' land, 'C' castle (land), 'W' a pre-placed wall (land, no owner, health 2);
   *  'r' small rock, 'R' large rock, 'T' tree, 'H' house, 's' swamp, 'L' lake. Any other character is refused with its
   *  position: a map is never half-read. Castles are the 4-connected groups of 'C'. */
  static fromAscii(rows) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('a map has rows');
    const h = rows.length, w = rows[0].length;
    const g = new GridModel(w, h);
    for (let y = 0; y < h; y++) {
      if (rows[y].length !== w) throw new Error('map row ' + y + ' is ' + rows[y].length + ' wide, row 0 is ' + w);
      for (let x = 0; x < w; x++) {
        const c = rows[y][x];
        const i = y * w + x;
        switch (c) {
          case '~': g._terrain[i] = Terrain.Water; break;
          case '.': g._terrain[i] = Terrain.Land; break;
          case 'C': g._terrain[i] = Terrain.Land; g._occupant[i] = Occupant.Castle; break;
          case 'W': g._terrain[i] = Terrain.Land; g._occupant[i] = Occupant.Wall; g._health[i] = 2; break;
          case 'r': g._terrain[i] = Terrain.Land; g._occupant[i] = Occupant.RockSmall; g._health[i] = 1; break;
          case 'R': g._terrain[i] = Terrain.Land; g._occupant[i] = Occupant.RockLarge; break;
          case 'T': g._terrain[i] = Terrain.Land; g._occupant[i] = Occupant.Tree; break;
          case 'H': g._terrain[i] = Terrain.Land; g._occupant[i] = Occupant.House; break;
          case 's': g._terrain[i] = Terrain.Swamp; break;
          case 'L': g._terrain[i] = Terrain.Lake; break;
          default: throw new Error('map cell (' + x + ',' + y + ") is '" + c + "': only ~ . C W r R T H s L are known");
        }
      }
    }
    g._findCastles();
    return g;
  }

  _findCastles() {
    const w = this.width;
    const seen = new Uint8Array(w * this.height);
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < w; x++) {
        if (seen[y * w + x] || this._occupant[y * w + x] !== Occupant.Castle) continue;
        const cells = [];
        const stack = [new Cell(x, y)];
        seen[y * w + x] = 1;
        while (stack.length > 0) {
          const c = stack.pop(); cells.push(c);
          this._tryPush(c.x + 1, c.y, seen, stack); this._tryPush(c.x - 1, c.y, seen, stack);
          this._tryPush(c.x, c.y + 1, seen, stack); this._tryPush(c.x, c.y - 1, seen, stack);
        }
        cells.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
        this._castles.push(new Castle(this._castles.length + 1, cells));
      }
  }

  _tryPush(x, y, seen, stack) {
    if (!this.in(x, y)) return;
    const i = y * this.width + x;
    if (seen[i] || this._occupant[i] !== Occupant.Castle) return;
    seen[i] = 1; stack.push(new Cell(x, y));
  }

  /** FNV-1a 64 over the whole board, in a fixed order. BigInt in, BigInt out (the C# ulong). */
  hash(seed) { return this.hashInto(Fnv64.fromBigInt(seed)).toBigInt(); }

  /** The same hash, fed into a running accumulator (what MatchModel.stateHash uses). */
  hashInto(f) {
    f.mix(this.width); f.mix(this.height);
    const t = this._terrain, o = this._occupant, w = this._owner, hh = this._health;
    for (let i = 0; i < t.length; i++) {
      f.mixHalves(0, t[i]); f.mixHalves(0, o[i]); f.mixHalves(0, w[i]); f.mixHalves(0, hh[i]);
    }
    for (const c of this._castles) f.mixBool(c.ruined);
    return f;
  }

  /** C# GridModel.Mix(ulong h, ulong v): BigInt in, BigInt out. v may be a BigInt or a safe integer (a long cast to ulong). */
  static mix(h, v) {
    const f = Fnv64.fromBigInt(h);
    if (typeof v === 'bigint') {
      const m = v & 0xFFFFFFFFFFFFFFFFn;
      f.mixHalves(Number(m >> 32n), Number(m & 0xFFFFFFFFn));
    } else f.mix(v);
    return f.toBigInt();
  }
}
