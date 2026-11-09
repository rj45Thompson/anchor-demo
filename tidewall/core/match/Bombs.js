// model/Match/Bombs.js - the bomb rule set (BOMBS_SPEC.md, RJ 2026-11-09). Only a match built with GameOptions.bombs owns one.
//
// UC-B1, in the core's words: grunts drop lit bombs next to bricks and the castle; heroes defuse, carry, throw or drop their own;
// a blast is a plus shape that stops at the first brick, cannon, castle or rock and never crosses water; bombs are the ONLY thing
// that kills a grunt (cannon shots on land no longer do); bricks come in two kinds (health 2, metal 6); the shop sells items for
// score. Whole numbers only; no random stream is used anywhere here (nothing in these rules is chance), so the same commands give
// the same state and the same hash.
//
// This class holds the bombs and traps and the rules that need them; MatchModel calls into it at the places the base rules differ
// (the commands, the world step, the grunt's turn, a wall going up) and nowhere else, so with bombs off none of this runs and the
// base rules and the parity traces are untouched.
import { Cell } from '../cell.js';
import { Terrain, Occupant } from '../grid.js';
import { ItemKind, ItemNames } from '../rules/GameRules.js';
import { Phase, BombModel, TrapModel } from './Entities.js';
import { CommandKind } from './Commands.js';
import {
  RejectReason, BombDropped, BombPickedUp, BombThrown, BombLanded, BombSank, BombDefused, BombExploded, PlayerStunned, BombFumbled,
  ItemBought, TrapPlaced, TrapSprung, TrapRemoved, GruntKilled, GruntMoved, CastleBitten, CastleRuined,
} from './Events.js';

const DX4 = [1, -1, 0, 0], DY4 = [0, 0, 1, -1];     // east, west, south, north: the arms' order
const add32 = (a, b) => (a + b) | 0;

/** What stops a blast arm (and takes its damage): a brick, a cannon, a castle or a rock. */
function stopsBlast(o) {
  return o === Occupant.Wall || o === Occupant.Cannon || o === Occupant.Castle || o === Occupant.RockSmall || o === Occupant.RockLarge;
}
/** What a bomb or trap may be put on: open ground (nothing there, rubble, or a ruined castle's graveyard). */
function openGround(o) { return o === Occupant.Empty || o === Occupant.Rubble || o === Occupant.Graveyard; }

export class BombWorld {
  constructor(match) {
    this.m = match;
    this.rules = match.rules;
    this.bombs = [];          // BombModel, id order
    this.traps = [];          // TrapModel, id order
    this._nextBomb = 1;
    this._nextTrap = 1;
  }

  /** The kinds this rule set handles itself (Strike is DropBomb here). */
  static handles(kind) {
    return kind === CommandKind.Strike || (kind >= CommandKind.PickUpBomb && kind <= CommandKind.MoveHero);
  }

  /** A player enters a bomb match with a full hand. */
  initPlayer(p) { p.bombs = this.rules.bombCap; p.bombCap = this.rules.bombCap; p.bombRegen = 0; }

  /** BATTLE begins: every hand is topped up to the cap (a bombPack's extras are kept). */
  onBattleStart() {
    for (const p of this.m._players) { if (p.bombs < p.bombCap) p.bombs = p.bombCap; p.bombRegen = 0; }
  }

  /** Everything lit goes out (a new level, a lost round): hands empty, traps stay unless `traps`. */
  clear(traps) {
    this.bombs.length = 0;
    for (const p of this.m._players) p.carrying = 0;
    if (traps) this.traps.length = 0;
  }

  bombAt(x, y) {
    for (const b of this.bombs) if (b.alive && b.carriedBy < 0 && b.flightLeft === 0 && b.at.x === x && b.at.y === y) return b;
    return null;
  }
  trapAt(x, y) {
    for (const t of this.traps) if (t.at.x === x && t.at.y === y) return t;
    return null;
  }
  _bomb(id) { for (const b of this.bombs) if (b.id === id) return b; return null; }

  _reject(c, why) { return this.m._reject(c, why); }

  // ---- the hero's verbs ------------------------------------------------------------------------------------------------------

  apply(c, p) {
    switch (c.kind) {
      case CommandKind.Strike: return this._drop(c, p);
      case CommandKind.PickUpBomb: return this._pickUp(c, p);
      case CommandKind.ThrowBomb: return this._throw(c, p);
      case CommandKind.DefuseBomb: return this._defuse(c, p);
      case CommandKind.Buy: return this._buy(c, p);
      case CommandKind.PlaceTrap: return this._placeTrap(c, p);
      case CommandKind.MoveHero: return this._moveHero(c, p);
    }
    throw new Error('command kind ' + c.kind + ' is not a bomb command');
  }

  /** The gate every verb on foot passes: BATTLE or REPAIR, and not stunned. Returns a RejectReason, or -1. */
  _footGate(p) {
    const ph = this.m.phase;
    if (ph !== Phase.Repair && ph !== Phase.Battle) return RejectReason.WrongPhase;
    if (p.stunLeft > 0) return RejectReason.Stunned;
    return -1;
  }

  _moveHero(c, p) {
    if (!this.m.grid.in(c.at.x, c.at.y)) return this._reject(c, RejectReason.Blocked);
    p.heroAt = c.at;
    return true;
  }

  _drop(c, p) {
    const m = this.m, g = m.grid, r = this.rules;
    const gate = this._footGate(p);
    if (gate >= 0) return this._reject(c, gate);
    if (!p.sword) return this._reject(c, RejectReason.ToolOut);          // the phase's own tool is out
    if (p.bombs < 1) return this._reject(c, RejectReason.NoBombs);
    const x = c.at.x, y = c.at.y;
    if (!g.in(x, y) || g.terrainAt(x, y) !== Terrain.Land || !openGround(g.occupantAt(x, y))) return this._reject(c, RejectReason.Blocked);
    if (this.bombAt(x, y) !== null) return this._reject(c, RejectReason.BombHere);
    const big = p.items.bigBomb > 0;
    if (big) p.items.bigBomb--;
    p.bombs--;
    p.heroAt = c.at;
    const b = new BombModel(this._nextBomb++, c.slot, c.at, r.bombFuse, big);
    b.skipTick = m.tick;
    this.bombs.push(b);
    m._events.push(new BombDropped(m.tick, b.id, b.owner, b.at, b.fuseLeft, big));
    return true;
  }

  _pickUp(c, p) {
    const m = this.m;
    const gate = this._footGate(p);
    if (gate >= 0) return this._reject(c, gate);
    if (p.carrying !== 0) return this._reject(c, RejectReason.HandsFull);
    let best = null, bestD = Number.MAX_SAFE_INTEGER;
    for (const b of this.bombs) {                       // id order: the tie goes to the older bomb
      if (!b.alive || b.carriedBy >= 0 || b.flightLeft > 0) continue;
      const dx = b.at.x - c.at.x, dy = b.at.y - c.at.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > this.rules.pickUpReach) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best === null) return this._reject(c, RejectReason.NoBombNear);
    p.heroAt = c.at;
    best.carriedBy = c.slot; best.at = c.at; p.carrying = best.id;
    m._events.push(new BombPickedUp(m.tick, best.id, c.slot));
    return true;
  }

  _throw(c, p) {
    const m = this.m, r = this.rules, g = m.grid;
    const gate = this._footGate(p);
    if (gate >= 0) return this._reject(c, gate);
    if (p.carrying === 0) return this._reject(c, RejectReason.HandsEmpty);
    const to = c.target, from = c.at;
    if (!g.in(from.x, from.y) || !g.in(to.x, to.y)) return this._reject(c, RejectReason.Blocked);
    const dist = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (dist > r.throwRange) return this._reject(c, RejectReason.TooFar);
    const b = this._bomb(p.carrying);
    if (b === null) throw new Error('player ' + c.slot + ' carries bomb ' + p.carrying + ', which does not exist');
    const ticks = r.throwBaseTicks + r.throwTicksPerCell * dist;
    p.heroAt = from; p.carrying = 0;
    b.carriedBy = -1; b.owner = c.slot;                  // a bomb a player throws is theirs
    b.at = from; b.flightFrom = from; b.flightTo = to; b.flightLeft = ticks; b.flightTicks = ticks; b.skipTick = m.tick;
    m._events.push(new BombThrown(m.tick, b.id, c.slot, from, to, ticks));
    return true;
  }

  /** The nearest bomb within defuseReach of the hero, on the ground or in the hero's own hands; one in another hero's hands is
   *  out of reach. The hero's own carried bomb comes last: with something else near, defusing is for THAT (hands full is fine). */
  _defuse(c, p) {
    const m = this.m;
    const gate = this._footGate(p);
    if (gate >= 0) return this._reject(c, gate);
    let best = null, bestKey = null;
    for (const b of this.bombs) {
      if (!b.alive || b.flightLeft > 0) continue;
      if (b.carriedBy >= 0 && b.carriedBy !== c.slot) continue;
      const own = b.carriedBy === c.slot;
      const at = own ? c.at : b.at;
      const dx = at.x - c.at.x, dy = at.y - c.at.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > this.rules.defuseReach) continue;
      const key = [own ? 1 : 0, dx * dx + dy * dy, b.id];
      if (bestKey === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) { best = b; bestKey = key; }
    }
    if (best === null) return this._reject(c, RejectReason.NoBombNear);
    p.heroAt = c.at;
    best.alive = false;
    if (best.carriedBy >= 0) p.carrying = 0;
    this._purge();
    if (best.owner === -1) {                             // putting out a grunt's bomb pays
      p.score = add32(p.score, this.rules.pointsDefuseGruntBomb);
      m.teamScore = add32(m.teamScore, this.rules.pointsDefuseGruntBomb);
    }
    m._events.push(new BombDefused(m.tick, best.id, c.slot));
    return true;
  }

  _buy(c, p) {
    const m = this.m, r = this.rules;
    if (m.phase !== Phase.Repair) return this._reject(c, RejectReason.WrongPhase);   // the shop is open while BUILDING
    const item = c.shapeId;
    if (!Number.isInteger(item) || item < 0 || item >= ItemNames.length) return this._reject(c, RejectReason.BadItem);
    const name = ItemNames[item];
    const price = r.itemCosts[name];
    if (!Number.isInteger(price)) throw new Error('rules.itemCosts has no price for ' + name);
    if (p.score < price) return this._reject(c, RejectReason.CannotAfford);
    p.score = add32(p.score, -price);
    if (item === ItemKind.BombPack) p.bombs = Math.min(r.bombPackCap, p.bombs + r.bombPackSize);
    p.items[name]++;
    m._events.push(new ItemBought(m.tick, c.slot, item));
    return true;
  }

  _placeTrap(c, p) {
    const m = this.m, g = m.grid;
    if (m.phase !== Phase.Repair) return this._reject(c, RejectReason.WrongPhase);
    if (p.items.trap < 1) return this._reject(c, RejectReason.NoItem);
    const x = c.at.x, y = c.at.y;
    if (!g.in(x, y) || g.terrainAt(x, y) !== Terrain.Land || (g.occupantAt(x, y) !== Occupant.Empty && g.occupantAt(x, y) !== Occupant.Rubble)
        || this.trapAt(x, y) !== null || m.gruntAt(x, y)) return this._reject(c, RejectReason.Blocked);
    p.items.trap--;
    const t = new TrapModel(this._nextTrap++, c.slot, c.at);
    this.traps.push(t);
    m._events.push(new TrapPlaced(m.tick, t.id, c.slot, c.at));
    return true;
  }

  /** A wall or cannon went up on this square: a trap under it is gone. */
  removeTrapAt(x, y) {
    for (let i = 0; i < this.traps.length; i++)
      if (this.traps[i].at.x === x && this.traps[i].at.y === y) {
        const t = this.traps[i];
        this.traps.splice(i, 1);
        this.m._events.push(new TrapRemoved(this.m.tick, t.id, t.at));
        return;
      }
  }

  // ---- the world's tick ------------------------------------------------------------------------------------------------------

  _purge() {
    let j = 0;
    for (let i = 0; i < this.bombs.length; i++) if (this.bombs[i].alive) this.bombs[j++] = this.bombs[i];
    this.bombs.length = j;
  }

  /** One tick of BATTLE or REPAIR: stun wears off, hands refill, carried bombs follow their hero, flights land, fuses burn down and
   *  the bombs that reach zero blow in id order. A bomb a blast sets alight burns on its next tick (fuse 1), so a chain is one blast
   *  per tick. */
  step() {
    const m = this.m, r = this.rules;
    for (const p of m._players) {
      if (p.stunLeft > 0) p.stunLeft--;
      if (p.bombs < p.bombCap) { if (++p.bombRegen >= r.bombRegenTicks) { p.bombs++; p.bombRegen = 0; } } else p.bombRegen = 0;
    }
    for (const b of this.bombs) if (b.alive && b.carriedBy >= 0) b.at = m._players[b.carriedBy].heroAt;
    const due = [];
    for (const b of this.bombs) {
      if (!b.alive || b.skipTick === m.tick) continue;
      if (b.flightLeft > 0) { if (--b.flightLeft === 0) this._land(b); continue; }
      if (--b.fuseLeft <= 0) due.push(b);
    }
    for (const b of due) if (b.alive) this._explode(b);
    this._purge();
  }

  _land(b) {
    const m = this.m;
    b.at = b.flightTo;
    if (m.grid.terrainAt(b.at.x, b.at.y) === Terrain.Water) { b.alive = false; m._events.push(new BombSank(m.tick, b.id, b.at)); return; }
    m._events.push(new BombLanded(m.tick, b.id, b.at));
  }

  _explode(b) {
    const m = this.m, g = m.grid, r = this.rules, w = g.width;
    b.alive = false;
    if (b.carriedBy >= 0) { m._players[b.carriedBy].carrying = 0; b.carriedBy = -1; }     // blew up in the hero's hands
    const arm = b.big ? r.bigBombArm : r.bombArm;
    const centre = b.at;
    const arms = [], hits = [];
    const key = (x, y) => y * w + x;
    const blast = new Set([key(centre.x, centre.y)]);
    if (stopsBlast(g.occupantAt(centre.x, centre.y))) hits.push(centre);
    for (let k = 0; k < 4; k++)
      for (let d = 1; d <= arm; d++) {
        const x = centre.x + DX4[k] * d, y = centre.y + DY4[k] * d;
        if (!g.in(x, y) || g.terrainAt(x, y) === Terrain.Water) break;      // the blast does not cross water
        const cell = new Cell(x, y);
        arms.push(cell); blast.add(key(x, y));
        if (stopsBlast(g.occupantAt(x, y))) { hits.push(cell); break; }     // it stops at (and damages) the first thing in its way
      }
    m._events.push(new BombExploded(m.tick, b.id, centre, arms, b.owner, b.big));

    // grunts in the blast die; a player's bomb pays its owner
    let killed = false;
    for (const gr of m._grunts) {
      if (!gr.alive || !blast.has(key(gr.at.x, gr.at.y))) continue;
      gr.alive = false; killed = true;
      if (b.owner >= 0) {
        m._players[b.owner].score = add32(m._players[b.owner].score, r.pointsBombKill);
        m.teamScore = add32(m.teamScore, r.pointsBombKill);
      }
      m._events.push(new GruntKilled(m.tick, gr.id, b.owner, gr.at));
    }
    if (killed) { let j = 0; for (let i = 0; i < m._grunts.length; i++) if (m._grunts[i].alive) m._grunts[j++] = m._grunts[i]; m._grunts.length = j; }

    // heroes in the blast are stunned and let go of what they carry
    for (const p of m._players) {
      if (!p.connected || p.heroAt === null || !blast.has(key(p.heroAt.x, p.heroAt.y))) continue;
      p.stunLeft = r.stunTicks;
      m._events.push(new PlayerStunned(m.tick, p.slot, r.stunTicks));
      if (p.carrying !== 0) {
        const held = this._bomb(p.carrying);
        if (held !== null) { held.carriedBy = -1; m._events.push(new BombFumbled(m.tick, held.id, p.slot, held.at)); }
        p.carrying = 0;
      }
    }

    // every other bomb on the ground in the blast ignites at once
    for (const o of this.bombs)
      if (o.alive && o !== b && o.flightLeft === 0 && blast.has(key(o.at.x, o.at.y))) o.fuseLeft = Math.min(o.fuseLeft, 1);

    // what stopped the arms takes its damage; a cannon or a castle is hit once per blast however many arms reach it
    const cannonsHit = new Set(), castlesHit = new Set();
    for (const cell of hits) {
      const o = g.occupantAt(cell.x, cell.y);
      if (o === Occupant.Wall) m._damageWall(cell.x, cell.y, r.blastBrickDamage);
      else if (o === Occupant.Cannon) {
        const k = m.cannonAt(cell.x, cell.y);
        if (k !== null && !cannonsHit.has(k.id)) { cannonsHit.add(k.id); m._damageCannon(k, r.blastCannonDamage); }
      } else if (o === Occupant.Castle) {
        const c = m._castleAtCell(cell.x, cell.y);
        if (c !== null && !c.ruined && !castlesHit.has(c.id)) { castlesHit.add(c.id); this._damageCastle(c, r.blastCastleDamage); }
      }
      // rocks stop the blast and shrug it off
    }
  }

  _damageCastle(c, damage) {
    const m = this.m;
    const h = Math.max(0, m._castleHealth[c.id - 1] - damage);
    m._castleHealth[c.id - 1] = h;
    m._events.push(new CastleBitten(m.tick, c.id, h));
    if (h > 0) return;
    m.grid.setCastleRuined(c, true);
    m._events.push(new CastleRuined(m.tick, c.id));
  }

  /** After the grunts moved: the first grunt standing on a trap dies and the trap is used up. */
  sweepTraps() {
    if (this.traps.length === 0) return;
    const m = this.m, r = this.rules;
    for (const gr of m._grunts) {
      if (!gr.alive) continue;
      const i = this.traps.findIndex(t => t.at.x === gr.at.x && t.at.y === gr.at.y);
      if (i < 0) continue;
      const t = this.traps[i];
      this.traps.splice(i, 1);
      gr.alive = false;
      m._players[t.owner].score = add32(m._players[t.owner].score, r.pointsTrapKill);
      m.teamScore = add32(m.teamScore, r.pointsTrapKill);
      m._events.push(new TrapSprung(m.tick, t.id, t.at, gr.id));
      m._events.push(new GruntKilled(m.tick, gr.id, t.owner, gr.at));
    }
  }

  // ---- the grunt's turn in this rule set ---------------------------------------------------------------------------------------

  /** Start of a grunt's turn: its bomb cooldown ticks; while it flees it does nothing else. Returns true when the turn is spent. */
  gruntPre(gr) {
    if (gr.bombLeft > 0) gr.bombLeft--;
    if (gr.fleeLeft <= 0) return false;
    gr.fleeLeft--;
    this._flee(gr);
    return true;
  }

  /** A grunt runs 2 squares from its bomb, preferring a square off the blast's cross (a plus of arm 2 reaches 2 squares in line,
   *  so straight away would be no escape); it moves at its walking pace and waits out the rest of the flight. */
  _flee(gr) {
    const m = this.m, g = m.grid, r = this.rules;
    if (--gr.moveLeft > 0) return;
    gr.moveLeft = r.gruntTicksPerCell;
    const fx = gr.fleeFrom.x, fy = gr.fleeFrom.y;
    const score = (x, y) => {
      const dx = Math.abs(x - fx), dy = Math.abs(y - fy);
      return Math.min(dx + dy, r.gruntFleeCells) * 2 + (dx !== 0 && dy !== 0 ? 1 : 0);
    };
    let best = null, bestS = score(gr.at.x, gr.at.y);
    for (let k = 0; k < 4; k++) {
      const x = gr.at.x + DX4[k], y = gr.at.y + DY4[k];
      if (!g.in(x, y) || g.terrainAt(x, y) !== Terrain.Land || (g.occupantAt(x, y) !== Occupant.Empty && g.occupantAt(x, y) !== Occupant.Rubble)
          || m._otherGruntAt(x, y, gr)) continue;
      const s = score(x, y);
      if (s > bestS) { bestS = s; best = new Cell(x, y); }
    }
    if (best === null) return;
    const from = gr.at; gr.at = best;
    m._events.push(new GruntMoved(m.tick, gr.id, from, best));
  }

  /** True when a lit grunt bomb's blast cross would cover the square (walls ignored: the safe side of the guess). Grunts keep out of
   *  it, so one that ran from its bomb does not walk back into it. */
  gruntBombReaches(x, y) {
    for (const b of this.bombs) {
      if (!b.alive || b.owner !== -1 || b.flightLeft > 0 || b.carriedBy >= 0) continue;
      const arm = b.big ? this.rules.bigBombArm : this.rules.bombArm;
      if ((x === b.at.x && Math.abs(y - b.at.y) <= arm) || (y === b.at.y && Math.abs(x - b.at.x) <= arm)) return true;
    }
    return false;
  }

  /** A grunt next to a brick, cannon or the castle: instead of biting, with no bomb of its own cooling down it drops one on its
   *  square (owner -1) and flees; otherwise it waits there. */
  gruntAtTarget(gr) {
    const m = this.m, r = this.rules;
    if (gr.bombLeft > 0 || this.bombAt(gr.at.x, gr.at.y) !== null) return;
    const b = new BombModel(this._nextBomb++, -1, gr.at, r.bombFuse, false);
    this.bombs.push(b);
    gr.bombLeft = r.gruntBombCooldownTicks; gr.fleeLeft = r.gruntFleeTicks; gr.fleeFrom = gr.at;
    m._events.push(new BombDropped(m.tick, b.id, -1, b.at, b.fuseLeft, false));
  }

  // ---- tests (C# internal) ---------------------------------------------------------------------------------------------------

  /** Tests: a lit bomb on the ground at `at` (owner a slot, or -1). */
  put(owner, at, fuse = this.rules.bombFuse, big = false) {
    const b = new BombModel(this._nextBomb++, owner, at, fuse, big);
    this.bombs.push(b);
    return b;
  }

  // ---- the sync check ---------------------------------------------------------------------------------------------------------

  /** Appended to the match's state hash, only when bombs is on. */
  hashInto(f) {
    f.mix(1);                                            // this rule set is on
    f.mix(this._nextBomb); f.mix(this._nextTrap);
    f.mix(this.bombs.length);
    for (const b of this.bombs)
      for (const v of [b.id, b.owner, b.at.x, b.at.y, b.fuseLeft, b.carriedBy, b.flightLeft, b.flightTicks, b.flightFrom.x, b.flightFrom.y, b.flightTo.x, b.flightTo.y, b.big ? 1 : 0])
        f.mix(v);
    f.mix(this.traps.length);
    for (const t of this.traps) for (const v of [t.id, t.owner, t.at.x, t.at.y]) f.mix(v);
    for (const p of this.m._players)
      for (const v of [p.bombs, p.bombCap, p.bombRegen, p.items.metal, p.items.trap, p.items.bombPack, p.items.bigBomb, p.stunLeft, p.carrying,
                       p.heroAt === null ? -1 : p.heroAt.x, p.heroAt === null ? -1 : p.heroAt.y])
        f.mix(v);
    for (const gr of this.m._grunts) for (const v of [gr.id, gr.bombLeft, gr.fleeLeft, gr.fleeFrom.x, gr.fleeFrom.y]) f.mix(v);
    return f;
  }
}
