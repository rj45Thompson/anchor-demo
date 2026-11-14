// model/Match/Bombs.js - the bomb rule set (BOMBS_SPEC.md, RJ 2026-11-09) and its own beat, the RAID (BOMBER_UC.md, 11-13). Only a
// match built with GameOptions.bombs owns one.
//
// UC-R1, in the core's words: after a BATTLE that left raiders (grunts) ashore comes the RAID, Bomberman on land. The core walks every
// hero square by square from the way its player holds (Command.walk, with Bomberman's corner slide); a hero drops bombs at its feet,
// bombCap of its own lit at once; a lit bomb blocks walking; a blast is a cross whose arms run the hero's FIRE squares and stop at the
// first thing in their way: a brick, a cannon or a castle takes the damage, a large rock shrugs it off, a SOFT block (a tree, a small
// rock, a house) breaks and may hide a power-up; the blast's squares burn for blastTicks and catch what walks in. Raiders wander toward
// the walls, drop their bombs there and run. Bombs are the ONLY thing that kills a raider (cannon shots on land do not). Bricks come in
// two kinds (health 2, metal 6); the shop sells items for score in REPAIR. Whole numbers only; the only chance is the power-up rolls and
// the raiders' wandering, each its own seeded stream (Streams.key), so the same commands give the same state and the same hash.
//
// This class holds the bombs, traps, power-ups and fires and the rules that need them; MatchModel calls into it at the places the
// base rules differ (the commands, the RAID's tick and its start and end, a grunt's turn, a wall going up, a new level) and nowhere
// else, so with bombs off none of this runs and the base rules and the parity traces are untouched.
import { Cell } from '../cell.js';
import { Terrain, Occupant } from '../grid.js';
import { ItemKind, ItemNames } from '../rules/GameRules.js';
import { PathRules, PathResult } from '../rules/PathRules.js';
import { Phase, BombModel, TrapModel, PowerKind, PowerUpModel, FireModel } from './Entities.js';
import { CommandKind } from './Commands.js';
import { Streams } from './PieceDealer.js';
import {
  RejectReason, ThingCause, BombDropped, BombPickedUp, BombThrown, BombLanded, BombSank, BombDefused, BombExploded, PlayerStunned,
  BombFumbled, ItemBought, TrapPlaced, TrapSprung, TrapRemoved, GruntKilled, GruntMoved, CastleBitten, CastleRuined, ThingChanged,
  HeroEntered, PowerUpRevealed, PowerUpTaken, PowerUpBurned, SoftBlockBroken,
} from './Events.js';

const DX4 = [1, -1, 0, 0], DY4 = [0, 0, 1, -1];     // east, west, south, north: the arms' order
const add32 = (a, b) => (a + b) | 0;
/** The random streams' purposes (Streams.key(seed, purpose, index)); MatchModel's own run 2000..2500. */
const ROLL_STREAM = 2600, WANDER_STREAM = 2700;
const POWER_KINDS = [PowerKind.Fire, PowerKind.Bomb, PowerKind.Speed];

/** A soft block (BOMBER_UC.md step 8): a blast breaks it, and it stops the arm. */
function soft(o) { return o === Occupant.Tree || o === Occupant.RockSmall || o === Occupant.House; }
/** What stops a blast arm (and takes its hit): a brick, a cannon, a castle, a large rock, or a soft block. */
function stopsBlast(o) {
  return o === Occupant.Wall || o === Occupant.Cannon || o === Occupant.Castle || o === Occupant.RockLarge || soft(o);
}
/** Open ground (nothing there, rubble, or a ruined castle's graveyard): what a hero walks on and a bomb or trap is put on. */
function openGround(o) { return o === Occupant.Empty || o === Occupant.Rubble || o === Occupant.Graveyard; }
/** What a raider bombs (a grunt's targets): a brick, a cannon, a castle. */
function raiderTarget(o) { return o === Occupant.Wall || o === Occupant.Cannon || o === Occupant.Castle; }

export class BombWorld {
  constructor(match) {
    this.m = match;
    this.rules = match.rules;
    const w = this.rules.powerUpWeights;
    if (!Array.isArray(w) || w.length !== POWER_KINDS.length || w.reduce((a, b) => a + b, 0) !== 100)
      throw new Error('rules.powerUpWeights is one whole weight per PowerKind adding to 100, got ' + JSON.stringify(w));
    this.bombs = [];          // BombModel, id order
    this.traps = [];          // TrapModel, id order
    this.powerUps = [];       // PowerUpModel, id order: lying on the board in the RAID
    this.fires = [];          // FireModel, id order: the blasts still burning
    this._nextBomb = 1; this._nextTrap = 1; this._nextPower = 1; this._nextFire = 1;
    this._rolls = 0;          // power-up rolls made: each is its own stream (seed, ROLL_STREAM, roll)
    this._spent = null;       // { tick, cells }: the squares of the fires that burned their last tick on `tick` (only the raiders' step reads it)
    this._wander = null;      // { tick, rng }: this tick's wandering stream, made when the first raider needs it
  }

  /** The kinds this rule set handles itself (Strike is DropBomb here). */
  static handles(kind) {
    return kind === CommandKind.Strike || (kind >= CommandKind.PickUpBomb && kind <= CommandKind.Walk);
  }

  /** A player enters a bomb match (and every new level) as Bomberman starts: one bomb lit at once, arms of bombArm, the base pace. */
  initPlayer(p) {
    p.bombCap = this.rules.bombCap; p.fire = this.rules.bombArm; p.ticksPerCell = this.rules.heroTicksPerCell;
    this._offBoard(p);
    p.bombs = p.bombCap;
  }

  /** A new map: everything lit goes out, no traps, and every hero starts the level without its power-ups (BOMBER_UC.md step 11). */
  newLevel() {
    this.clear(true);
    for (const p of this.m._players) this.initPlayer(p);
  }

  /** Everything lit goes out (a new level, a lost round): hands empty, fires out, power-ups gone; traps stay unless `traps`. */
  clear(traps) {
    this.bombs.length = 0; this.fires.length = 0; this.powerUps.length = 0;
    for (const p of this.m._players) p.carrying = 0;
    if (traps) this.traps.length = 0;
    this._hands();
  }

  _offBoard(p) { p.heroAt = null; p.heroTo = null; p.stepLeft = 0; p.stepTicks = 0; p.wishX = 0; p.wishY = 0; p.wishFirst = 0; }

  bombAt(x, y) {
    for (const b of this.bombs) if (b.alive && b.carriedBy < 0 && b.flightLeft === 0 && b.at.x === x && b.at.y === y) return b;
    return null;
  }
  trapAt(x, y) {
    for (const t of this.traps) if (t.at.x === x && t.at.y === y) return t;
    return null;
  }
  _bomb(id) { for (const b of this.bombs) if (b.id === id) return b; return null; }
  _ownLit(slot) { let n = 0; for (const b of this.bombs) if (b.alive && b.owner === slot) n++; return n; }
  /** Every hero's `bombs`: how many more of its own it may light now. */
  _hands() { for (const p of this.m._players) p.bombs = Math.max(0, p.bombCap - this._ownLit(p.slot)); }

  _reject(c, why) { return this.m._reject(c, why); }

  // ---- the RAID's seam (BOMBER_UC.md steps 1, 2, 14) ----------------------------------------------------------------------------

  /** The raid is over for new bombs: its clock is out, or no raider is left. */
  raidOver() {
    if (this.m.phaseTicksLeft === 0) return true;
    for (const g of this.m._grunts) if (g.alive) return false;
    return true;
  }
  /** The raid is done: over, and nothing lit or burning is left (a lit bomb always burns down: at most bombFuse ticks). */
  raidDone() { return this.raidOver() && this.bombs.length === 0 && this.fires.length === 0; }

  /** RAID begins: each connected player with a home castle has its hero enter (step 2). */
  raidStart() {
    const m = this.m, taken = new Set(), w = m.grid.width;
    for (const p of m._players) {
      this._offBoard(p);
      p.stunLeft = 0; p.carrying = 0;
      if (!p.connected) continue;
      const home = m.castleById(p.claimedCastle);
      if (home === null) continue;                                     // 2b: no home castle, no hero
      const hc = home.cells[0];
      const raiders = m._grunts.filter((g) => g.alive)
        .sort((a, b) => (Math.abs(a.at.x - hc.x) + Math.abs(a.at.y - hc.y)) - (Math.abs(b.at.x - hc.x) + Math.abs(b.at.y - hc.y)) || a.id - b.id);
      let at = null;
      for (const r of raiders) { at = this._nearestFrom(r.at, hc, taken); if (at !== null) break; }
      if (at === null) at = this._nearestOpen(hc, taken);             // 2a: no raider can be walked to
      if (at === null) throw new Error('the board has no square for player ' + p.slot + "'s hero to enter the raid on");
      taken.add(at.y * w + at.x);
      p.heroAt = at; p.faceX = 0; p.faceY = 1;
      m._events.push(new HeroEntered(m.tick, p.slot, at));
    }
    this._hands();
  }

  /** RAID ends: the power-ups still lying there go with it, the heroes leave the board (step 14). */
  raidEnd() {
    this.powerUps.length = 0;
    for (const p of this.m._players) { this._offBoard(p); p.stunLeft = 0; }
    this._hands();
  }

  /** Of the squares a hero can walk to from `from` (a raider's square), the one nearest `home` (Manhattan; ties: the walk's order). */
  _nearestFrom(from, home, taken) {
    const g = this.m.grid, w = g.width, seen = new Uint8Array(w * g.height), q = [from.y * w + from.x];
    seen[q[0]] = 1;
    let best = null, bestD = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < q.length; i++) {
      const c = q[i], cx = c % w, cy = (c / w) | 0;
      for (let k = 0; k < 4; k++) {
        const x = cx + DX4[k], y = cy + DY4[k];
        if (!g.in(x, y) || seen[y * w + x] || !this.heroCanEnter(x, y)) continue;
        seen[y * w + x] = 1; q.push(y * w + x);
        const d = Math.abs(x - home.x) + Math.abs(y - home.y);
        if (d < bestD && !taken.has(y * w + x)) { bestD = d; best = new Cell(x, y); }
      }
    }
    return best;
  }

  /** The enterable square nearest `home` (Manhattan; ties: row order). */
  _nearestOpen(home, taken) {
    const g = this.m.grid, w = g.width;
    let best = null, bestD = Number.MAX_SAFE_INTEGER;
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < w; x++) {
        if (!this.heroCanEnter(x, y) || taken.has(y * w + x)) continue;
        const d = Math.abs(x - home.x) + Math.abs(y - home.y);
        if (d < bestD) { bestD = d; best = new Cell(x, y); }
      }
    return best;
  }

  /** A hero may step onto (x, y) (step 6): on the board, dry land, open ground, no lit bomb lying there, no raider on it. */
  heroCanEnter(x, y) {
    const g = this.m.grid;
    return g.in(x, y) && g.terrainAt(x, y) === Terrain.Land && openGround(g.occupantAt(x, y)) && this.bombAt(x, y) === null && !this.m.gruntAt(x, y);
  }

  // ---- the hero's verbs ------------------------------------------------------------------------------------------------------

  apply(c, p) {
    switch (c.kind) {
      case CommandKind.Strike: return this._drop(c, p);
      case CommandKind.PickUpBomb: return this._pickUp(c, p);
      case CommandKind.ThrowBomb: return this._throw(c, p);
      case CommandKind.DefuseBomb: return this._defuse(c, p);
      case CommandKind.Buy: return this._buy(c, p);
      case CommandKind.PlaceTrap: return this._placeTrap(c, p);
      // the core walks the hero since the RAID (BOMBER_UC.md): a reported square would let a player teleport, so it is refused
      case CommandKind.MoveHero: return this._reject(c, RejectReason.WrongPhase);
      case CommandKind.Walk: return this._walk(c, p);
    }
    throw new Error('command kind ' + c.kind + ' is not a bomb command');
  }

  /** The gate every verb on foot passes: the RAID, a hero on the board, not stunned. Returns a RejectReason, or -1. */
  _footGate(p) {
    if (this.m.phase !== Phase.Raid) return RejectReason.WrongPhase;
    if (p.heroAt === null) return RejectReason.NoHero;
    if (p.stunLeft > 0) return RejectReason.Stunned;
    return -1;
  }

  /** The way the player holds (steps 3-5): kept until the next walk; the hero follows it every tick it is not stunned. */
  _walk(c, p) {
    if (this.m.phase !== Phase.Raid) return this._reject(c, RejectReason.WrongPhase);
    const w = c.way;
    if (w === null) return this._reject(c, RejectReason.BadWay);
    if (p.heroAt === null) return this._reject(c, RejectReason.NoHero);
    p.wishX = w.dx; p.wishY = w.dy; p.wishFirst = w.first;
    return true;
  }

  /** A at the hero's feet (step 7). */
  _drop(c, p) {
    const m = this.m, g = m.grid, r = this.rules;
    const gate = this._footGate(p);
    if (gate >= 0) return this._reject(c, gate);
    if (this.raidOver()) return this._reject(c, RejectReason.RaidOver);
    if (this._ownLit(c.slot) >= p.bombCap) return this._reject(c, RejectReason.NoBombs);
    const at = p.heroCell;
    if (!openGround(g.occupantAt(at.x, at.y))) throw new Error('player ' + c.slot + "'s hero stands on " + at + ', which is not open ground');
    if (this.bombAt(at.x, at.y) !== null) return this._reject(c, RejectReason.BombHere);
    const big = p.items.bigBomb > 0;
    if (big) p.items.bigBomb--;
    const b = new BombModel(this._nextBomb++, c.slot, at, r.bombFuse, big, big ? Math.max(r.bigBombArm, p.fire) : p.fire);
    b.skipTick = m.tick;
    this.bombs.push(b);
    m._events.push(new BombDropped(m.tick, b.id, b.owner, b.at, b.fuseLeft, big));
    this._hands();
    return true;
  }

  _pickUp(c, p) {
    const m = this.m;
    const gate = this._footGate(p);
    if (gate >= 0) return this._reject(c, gate);
    if (p.carrying !== 0) return this._reject(c, RejectReason.HandsFull);
    const h = p.heroCell;
    let best = null, bestD = Number.MAX_SAFE_INTEGER;
    for (const b of this.bombs) {                       // id order: the tie goes to the older bomb
      if (!b.alive || b.carriedBy >= 0 || b.flightLeft > 0) continue;
      const dx = b.at.x - h.x, dy = b.at.y - h.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > this.rules.pickUpReach) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best === null) return this._reject(c, RejectReason.NoBombNear);
    best.carriedBy = c.slot; best.at = h; p.carrying = best.id;
    m._events.push(new BombPickedUp(m.tick, best.id, c.slot));
    return true;
  }

  /** A carried bomb flies throwCells squares the way the hero faces (step 13), stopped by the board's edge. */
  _throw(c, p) {
    const m = this.m, r = this.rules, g = m.grid;
    const gate = this._footGate(p);
    if (gate >= 0) return this._reject(c, gate);
    if (p.carrying === 0) return this._reject(c, RejectReason.HandsEmpty);
    const b = this._bomb(p.carrying);
    if (b === null) throw new Error('player ' + c.slot + ' carries bomb ' + p.carrying + ', which does not exist');
    const from = p.heroCell;
    const to = new Cell(Math.max(0, Math.min(g.width - 1, from.x + p.faceX * r.throwCells)), Math.max(0, Math.min(g.height - 1, from.y + p.faceY * r.throwCells)));
    const ticks = r.throwBaseTicks + r.throwTicksPerCell * PathRules.manhattan(from, to);
    p.carrying = 0;
    b.carriedBy = -1; b.owner = c.slot;                  // a bomb a player throws is theirs
    b.at = from; b.flightFrom = from; b.flightTo = to; b.flightLeft = ticks; b.flightTicks = ticks; b.skipTick = m.tick;
    m._events.push(new BombThrown(m.tick, b.id, c.slot, from, to, ticks));
    this._hands();
    return true;
  }

  /** The nearest bomb within defuseReach of the hero, on the ground or in the hero's own hands; one in another hero's hands is
   *  out of reach. The hero's own carried bomb comes last: with something else near, defusing is for THAT (hands full is fine). */
  _defuse(c, p) {
    const m = this.m;
    const gate = this._footGate(p);
    if (gate >= 0) return this._reject(c, gate);
    const h = p.heroCell;
    let best = null, bestKey = null;
    for (const b of this.bombs) {
      if (!b.alive || b.flightLeft > 0) continue;
      if (b.carriedBy >= 0 && b.carriedBy !== c.slot) continue;
      const own = b.carriedBy === c.slot;
      const at = own ? h : b.at;
      const dx = at.x - h.x, dy = at.y - h.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > this.rules.defuseReach) continue;
      const key = [own ? 1 : 0, dx * dx + dy * dy, b.id];
      if (bestKey === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) { best = b; bestKey = key; }
    }
    if (best === null) return this._reject(c, RejectReason.NoBombNear);
    best.alive = false;
    if (best.carriedBy >= 0) p.carrying = 0;
    this._purge();
    if (best.owner === -1) {                             // putting out a grunt's bomb pays
      p.score = add32(p.score, this.rules.pointsDefuseGruntBomb);
      m.teamScore = add32(m.teamScore, this.rules.pointsDefuseGruntBomb);
    }
    m._events.push(new BombDefused(m.tick, best.id, c.slot));
    this._hands();
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
    if (item === ItemKind.BombPack) p.bombCap = Math.min(r.bombMax, p.bombCap + 1);   // BOMBER_UC.md: one more lit at once, this level
    p.items[name]++;
    m._events.push(new ItemBought(m.tick, c.slot, item));
    this._hands();
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

  // ---- the RAID's tick ---------------------------------------------------------------------------------------------------------

  _purge() {
    let j = 0;
    for (let i = 0; i < this.bombs.length; i++) if (this.bombs[i].alive) this.bombs[j++] = this.bombs[i];
    this.bombs.length = j;
  }

  /** One tick of the RAID, before the raiders act: stun wears off, the heroes walk, carried bombs follow their hero, power-ups show
   *  and are taken, what stands in a fire is caught, flights land, fuses burn down and the bombs that reach zero blow in id order. A
   *  bomb a blast sets alight burns on its next tick (fuse 1), so a chain is one blast per tick. */
  raidStep() {
    const m = this.m;
    // a stunned hero holds still for the whole of stunTicks: it walks only when it enters the tick unstunned, and the stun counts down
    // after (the same ticks its verbs are refused Stunned in: _footGate reads the count before the tick's step)
    for (const p of m._players) if (p.heroAt !== null && p.stunLeft === 0) this._walkHero(p);
    for (const p of m._players) if (p.stunLeft > 0) p.stunLeft--;
    for (const b of this.bombs) if (b.alive && b.carriedBy >= 0) b.at = m._players[b.carriedBy].heroCell;
    this._powerUpsTick();
    this._burn();
    const due = [];
    for (const b of this.bombs) {
      if (!b.alive || b.skipTick === m.tick) continue;
      if (b.flightLeft > 0) { if (--b.flightLeft === 0) this._land(b); continue; }
      if (--b.fuseLeft <= 0) due.push(b);
    }
    for (const b of due) if (b.alive) this._explode(b);
    this._purge();
    this._hands();
  }

  /** The ways the hero tries from a square's centre, in order: the axis it pressed first (wishFirst), then the other (step 5). */
  _ways(p) {
    const x = p.wishX !== 0 ? [p.wishX, 0] : null, y = p.wishY !== 0 ? [0, p.wishY] : null;
    return (p.wishFirst === 0 ? [x, y] : [y, x]).filter((d) => d !== null);
  }

  /** One tick of a hero's walk (steps 3-6): a step under way goes one tick on (or turns back at once, or slides back into an opening
   *  it has just passed); at a centre it starts the next step the held way, or turns to face it when the way is blocked. */
  _walkHero(p) {
    if (p.heroTo !== null) {
      const sx = p.heroTo.x - p.heroAt.x, sy = p.heroTo.y - p.heroAt.y;
      const back = (sx !== 0 && p.wishX === -sx) || (sy !== 0 && p.wishY === -sy);
      // the corner slide: a press that is only sideways, less than half a square past an opening on that side, with none beside the
      // square ahead, takes the hero back into the opening (it then turns there)
      const px = sy !== 0 && p.wishY === 0 ? p.wishX : 0, py = sx !== 0 && p.wishX === 0 ? p.wishY : 0;
      const sideways = px !== 0 || py !== 0;
      const slide = !back && sideways && 2 * (p.stepTicks - p.stepLeft) < p.stepTicks
        && this.heroCanEnter(p.heroAt.x + px, p.heroAt.y + py) && !this.heroCanEnter(p.heroTo.x + px, p.heroTo.y + py);
      if (back || slide) {
        const was = p.heroAt; p.heroAt = p.heroTo; p.heroTo = was;
        p.stepLeft = p.stepTicks - p.stepLeft;
        p.faceX = -sx; p.faceY = -sy;
      }
      if (--p.stepLeft === 0) { p.heroAt = p.heroTo; p.heroTo = null; }
      return;
    }
    const ways = this._ways(p);
    for (const [dx, dy] of ways) {
      const x = p.heroAt.x + dx, y = p.heroAt.y + dy;
      if (!this.heroCanEnter(x, y)) continue;
      p.heroTo = new Cell(x, y); p.stepTicks = p.ticksPerCell; p.stepLeft = p.stepTicks - 1; p.faceX = dx; p.faceY = dy;
      return;
    }
    if (ways.length > 0) { p.faceX = ways[0][0]; p.faceY = ways[0][1]; }   // pushed against something: it turns to face it
  }

  /** Power-ups waiting for their fire show; a hero standing on a shown one takes it (steps 10-11). */
  _powerUpsTick() {
    const m = this.m, r = this.rules;
    for (const u of this.powerUps)
      if (u.revealLeft > 0 && --u.revealLeft === 0) m._events.push(new PowerUpRevealed(m.tick, u.id, u.kind, u.at));
    for (const p of m._players) {
      const h = p.heroCell;
      if (h === null) continue;
      for (let i = 0; i < this.powerUps.length; i++) {
        const u = this.powerUps[i];
        if (!u.shown || u.at.x !== h.x || u.at.y !== h.y) continue;
        if (u.kind === PowerKind.Fire) p.fire = Math.min(r.fireMax, p.fire + 1);
        else if (u.kind === PowerKind.Bomb) p.bombCap = Math.min(r.bombMax, p.bombCap + 1);
        else if (u.kind === PowerKind.Speed) p.ticksPerCell = Math.max(r.heroTicksMin, p.ticksPerCell - 1);
        else throw new Error('power-up ' + u.id + ' has kind ' + u.kind + ', not a PowerKind');
        this.powerUps.splice(i, 1); i--;
        m._events.push(new PowerUpTaken(m.tick, u.id, p.slot, u.kind, u.at));
      }
    }
  }

  /** The squares burning now, as y * width + x keys: the fires still alight, and the ones whose last burning tick is this one (a
   *  fire is taken off the list when it has burned its last tick, which is before the raiders act on that same tick). */
  _burning() {
    const w = this.m.grid.width, set = new Set();
    for (const f of this.fires) for (const c of f.cells) set.add(c.y * w + c.x);
    if (this._spent !== null && this._spent.tick === this.m.tick) for (const c of this._spent.cells) set.add(c.y * w + c.x);
    return set;
  }

  /** What stands in a fire that still burns is caught (step 9: a raider dies, a hero not yet stunned is stunned, a bomb lights);
   *  then every fire burns a tick down. A fire lit this tick is applied by its explosion. */
  _burn() {
    if (this.fires.length === 0) return;
    const w = this.m.grid.width;
    for (const f of this.fires) {
      const keys = new Set(f.cells.map((c) => c.y * w + c.x));
      this._catch(keys, f.owner, f.left);
    }
    for (const f of this.fires) f.left--;
    this._spent = { tick: this.m.tick, cells: this.fires.filter((f) => f.left <= 0).flatMap((f) => f.cells) };
    this.fires = this.fires.filter((f) => f.left > 0);
  }

  /** Everything on the squares `keys` is caught by a fire of `owner` that burns `left` more ticks. */
  _catch(keys, owner, left) {
    const m = this.m, r = this.rules, w = m.grid.width;
    let killed = false;
    for (const gr of m._grunts) {
      if (!gr.alive || !keys.has(gr.at.y * w + gr.at.x)) continue;
      gr.alive = false; killed = true;
      if (owner >= 0) {
        m._players[owner].score = add32(m._players[owner].score, r.pointsBombKill);
        m.teamScore = add32(m.teamScore, r.pointsBombKill);
      }
      m._events.push(new GruntKilled(m.tick, gr.id, owner, gr.at));
      if (owner >= 0) this._roll(r.raiderDropPercent, gr.at, left);      // step 10: a player's bomb may knock a power-up out of it
    }
    if (killed) { let j = 0; for (let i = 0; i < m._grunts.length; i++) if (m._grunts[i].alive) m._grunts[j++] = m._grunts[i]; m._grunts.length = j; }
    for (const p of m._players) {
      const h = p.heroCell;
      if (!p.connected || h === null || p.stunLeft > 0 || !keys.has(h.y * w + h.x)) continue;
      p.stunLeft = r.stunTicks;
      m._events.push(new PlayerStunned(m.tick, p.slot, r.stunTicks));
      if (p.carrying !== 0) {
        const held = this._bomb(p.carrying);
        if (held !== null) { held.carriedBy = -1; m._events.push(new BombFumbled(m.tick, held.id, p.slot, held.at)); }
        p.carrying = 0;
      }
    }
    for (const o of this.bombs)
      if (o.alive && o.carriedBy < 0 && o.flightLeft === 0 && keys.has(o.at.y * w + o.at.x)) o.fuseLeft = Math.min(o.fuseLeft, 1);
  }

  /** A power-up roll (step 10): one stream per roll; `percent` of the time a power-up of a weighted kind lies on `at`, shown in
   *  `reveal` ticks (when the fire there is out). */
  _roll(percent, at, reveal) {
    const m = this.m, rng = m._random(Streams.key(m.seed, ROLL_STREAM, this._rolls++));
    if (rng.range(0, 100) >= percent) return;
    let v = rng.range(0, 100), kind = -1;
    const w = this.rules.powerUpWeights;
    for (let k = 0; k < w.length; k++) { if (v < w[k]) { kind = POWER_KINDS[k]; break; } v -= w[k]; }
    this.powerUps.push(new PowerUpModel(this._nextPower++, kind, at, reveal));
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
    const centre = b.at;
    const arms = [], hits = [];
    const key = (x, y) => y * w + x;
    const blast = new Set([key(centre.x, centre.y)]);
    if (stopsBlast(g.occupantAt(centre.x, centre.y))) hits.push(centre);
    for (let k = 0; k < 4; k++)
      for (let d = 1; d <= b.arm; d++) {
        const x = centre.x + DX4[k] * d, y = centre.y + DY4[k] * d;
        if (!g.in(x, y) || g.terrainAt(x, y) === Terrain.Water) break;      // the blast does not cross water
        const cell = new Cell(x, y);
        arms.push(cell); blast.add(key(x, y));
        if (stopsBlast(g.occupantAt(x, y))) { hits.push(cell); break; }     // it stops at (and hits) the first thing in its way
      }
    m._events.push(new BombExploded(m.tick, b.id, centre, arms, b.owner, b.big));

    // a power-up lying in the blast is burned (one this blast uncovers is rolled below, after)
    for (let i = 0; i < this.powerUps.length; i++) {
      const u = this.powerUps[i];
      if (!blast.has(key(u.at.x, u.at.y))) continue;
      this.powerUps.splice(i, 1); i--;
      m._events.push(new PowerUpBurned(m.tick, u.id, u.at));
    }
    // raiders, heroes and bombs in it are caught, as by the fire it leaves (step 9)
    this._catch(blast, b.owner, r.blastTicks);

    // what stopped the arms takes its hit; a cannon or a castle is hit once per blast however many arms reach it
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
      } else if (soft(o)) this._breakSoft(cell, o, b.owner);
      // a large rock stops the blast and shrugs it off
    }
    // its squares burn blastTicks ticks counting this one: _burn catches what is on them on each of the next blastTicks - 1
    if (r.blastTicks > 1) this.fires.push(new FireModel(this._nextFire++, b.owner, [centre, ...arms], r.blastTicks - 1));
  }

  /** A soft block broken by a blast (step 8): open ground now; a small rock or a house pays as a cannon ball's does; it may hide a
   *  power-up (step 10). */
  _breakSoft(cell, o, owner) {
    const m = this.m, g = m.grid, r = this.rules;
    g.clearCell(cell.x, cell.y);
    const points = o === Occupant.RockSmall ? r.pointsSmallRock : o === Occupant.House ? r.pointsHouseDestroyed : 0;
    if (owner >= 0 && points > 0) {
      m._players[owner].score = add32(m._players[owner].score, points);
      m.teamScore = add32(m.teamScore, points);
    }
    m._events.push(new SoftBlockBroken(m.tick, cell, o, owner));
    m._events.push(new ThingChanged(m.tick, cell, Occupant.Empty, g.terrainAt(cell.x, cell.y), ThingCause.Blast, owner));
    this._roll(r.powerUpPercent, cell, r.blastTicks);
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

  /** After the raiders moved: the first raider standing on a trap dies and the trap is used up. */
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

  // ---- the raider's turn (step 12) ---------------------------------------------------------------------------------------------

  /** A raider's turn in the RAID: its bomb cooldown ticks; while it flees it runs; next to a brick, cannon or castle it drops its
   *  bomb (or waits for the cooldown); else it steps toward the nearest one, a quarter of its steps wandering instead. */
  raiderAct(gr) {
    const m = this.m, g = m.grid, r = this.rules;
    if (gr.bombLeft > 0) gr.bombLeft--;
    if (gr.fleeLeft > 0) { gr.fleeLeft--; this._flee(gr); return; }
    for (let k = 0; k < 4; k++) {
      const x = gr.at.x + DX4[k], y = gr.at.y + DY4[k];
      if (g.in(x, y) && raiderTarget(g.occupantAt(x, y))) { this._raiderBomb(gr); return; }
    }
    if (--gr.moveLeft > 0) return;
    gr.moveLeft = r.gruntTicksPerCell;
    const burning = this._burning(), free = (x, y) => this._raiderFree(x, y, gr, burning);
    const path = PathRules.nextStep(g, gr.at, free, (x, y) => this._nextToTarget(x, y));
    let next = path.result === PathResult.Stepped ? path.next : null;
    const rng = this._wanderRng();
    if (next === null || rng.range(0, 100) < r.raiderWanderPercent) {
      const open = [];
      for (let k = 0; k < 4; k++) { const x = gr.at.x + DX4[k], y = gr.at.y + DY4[k]; if (free(x, y)) open.push(new Cell(x, y)); }
      next = open.length > 0 ? open[rng.range(0, open.length)] : null;
    }
    if (next === null) return;
    const from = gr.at; gr.at = next;
    m._events.push(new GruntMoved(m.tick, gr.id, from, next));
  }

  /** This tick's wandering stream (seed, WANDER_STREAM, tick): made once, drawn by each raider that steps, in id order. */
  _wanderRng() {
    const m = this.m;
    if (this._wander === null || this._wander.tick !== m.tick) this._wander = { tick: m.tick, rng: m._random(Streams.key(m.seed, WANDER_STREAM, m.tick | 0)) };
    return this._wander.rng;
  }

  _nextToTarget(x, y) {
    const g = this.m.grid;
    for (let k = 0; k < 4; k++) { const nx = x + DX4[k], ny = y + DY4[k]; if (g.in(nx, ny) && raiderTarget(g.occupantAt(nx, ny))) return true; }
    return false;
  }

  /** A raider may step onto (x, y): dry land, empty or rubble, no other raider, no lit bomb, no hero, not burning, and not inside a
   *  raider bomb's cross (one that ran from its bomb does not walk back into it). */
  _raiderFree(x, y, me, burning) {
    const m = this.m, g = m.grid;
    if (!g.in(x, y) || g.terrainAt(x, y) !== Terrain.Land) return false;
    const o = g.occupantAt(x, y);
    if (o !== Occupant.Empty && o !== Occupant.Rubble) return false;
    if (m._otherGruntAt(x, y, me) || this.bombAt(x, y) !== null || burning.has(y * g.width + x) || this._heroOn(x, y)) return false;
    return !this.raiderBombReaches(x, y);
  }

  /** A hero stands on (x, y), or is stepping into it. */
  _heroOn(x, y) {
    for (const p of this.m._players) {
      if (p.heroAt === null) continue;
      if ((p.heroAt.x === x && p.heroAt.y === y) || (p.heroTo !== null && p.heroTo.x === x && p.heroTo.y === y)) return true;
    }
    return false;
  }

  /** A raider next to its target: with no bomb of its own cooling down it drops one on its square (owner -1) and flees. */
  _raiderBomb(gr) {
    const m = this.m, r = this.rules;
    if (gr.bombLeft > 0 || this.bombAt(gr.at.x, gr.at.y) !== null) return;
    const b = new BombModel(this._nextBomb++, -1, gr.at, r.bombFuse, false, r.bombArm);
    this.bombs.push(b);
    gr.bombLeft = r.gruntBombCooldownTicks; gr.fleeLeft = r.gruntFleeTicks; gr.fleeFrom = gr.at;
    m._events.push(new BombDropped(m.tick, b.id, -1, b.at, b.fuseLeft, false));
  }

  /** A raider runs 2 squares from its bomb, preferring a square off the blast's cross (a plus of arm 2 reaches 2 squares in line,
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
    const burning = this._burning();                      // step 12: a raider never steps onto a burning square, running or not
    let best = null, bestS = score(gr.at.x, gr.at.y);
    for (let k = 0; k < 4; k++) {
      const x = gr.at.x + DX4[k], y = gr.at.y + DY4[k];
      if (!g.in(x, y) || g.terrainAt(x, y) !== Terrain.Land || (g.occupantAt(x, y) !== Occupant.Empty && g.occupantAt(x, y) !== Occupant.Rubble)
          || m._otherGruntAt(x, y, gr) || this.bombAt(x, y) !== null || this._heroOn(x, y) || burning.has(y * g.width + x)) continue;
      const s = score(x, y);
      if (s > bestS) { bestS = s; best = new Cell(x, y); }
    }
    if (best === null) return;
    const from = gr.at; gr.at = best;
    m._events.push(new GruntMoved(m.tick, gr.id, from, best));
  }

  /** True when a lit raider bomb's blast cross would cover the square (walls ignored: the safe side of the guess). */
  raiderBombReaches(x, y) {
    for (const b of this.bombs) {
      if (!b.alive || b.owner !== -1 || b.flightLeft > 0 || b.carriedBy >= 0) continue;
      if ((x === b.at.x && Math.abs(y - b.at.y) <= b.arm) || (y === b.at.y && Math.abs(x - b.at.x) <= b.arm)) return true;
    }
    return false;
  }

  // ---- tests (C# internal) ---------------------------------------------------------------------------------------------------

  /** Tests: a lit bomb on the ground at `at` (owner a slot, or -1); its arm is a big bomb's or bombArm. */
  put(owner, at, fuse = this.rules.bombFuse, big = false) {
    const b = new BombModel(this._nextBomb++, owner, at, fuse, big, big ? this.rules.bigBombArm : this.rules.bombArm);
    this.bombs.push(b);
    this._hands();
    return b;
  }
  /** Tests: the hero of `slot` stands at `at`, still, facing (faceX, faceY). */
  putHero(slot, at, faceX = 0, faceY = 1) {
    const p = this.m._players[slot];
    this._offBoard(p);
    p.heroAt = at; p.faceX = faceX; p.faceY = faceY;
  }
  /** Tests: a power-up of `kind` shown at `at`. */
  putPowerUp(kind, at) {
    const u = new PowerUpModel(this._nextPower++, kind, at, 0);
    this.powerUps.push(u);
    return u;
  }

  // ---- the sync check ---------------------------------------------------------------------------------------------------------

  /** Appended to the match's state hash, only when bombs is on. */
  hashInto(f) {
    f.mix(1);                                            // this rule set is on
    for (const v of [this._nextBomb, this._nextTrap, this._nextPower, this._nextFire, this._rolls]) f.mix(v);
    f.mix(this.bombs.length);
    for (const b of this.bombs)
      for (const v of [b.id, b.owner, b.at.x, b.at.y, b.fuseLeft, b.carriedBy, b.flightLeft, b.flightTicks, b.flightFrom.x, b.flightFrom.y, b.flightTo.x, b.flightTo.y, b.big ? 1 : 0, b.arm])
        f.mix(v);
    f.mix(this.traps.length);
    for (const t of this.traps) for (const v of [t.id, t.owner, t.at.x, t.at.y]) f.mix(v);
    f.mix(this.powerUps.length);
    for (const u of this.powerUps) for (const v of [u.id, u.kind, u.at.x, u.at.y, u.revealLeft]) f.mix(v);
    f.mix(this.fires.length);
    for (const fr of this.fires) { for (const v of [fr.id, fr.owner, fr.left, fr.cells.length]) f.mix(v); for (const c of fr.cells) { f.mix(c.x); f.mix(c.y); } }
    for (const p of this.m._players)
      for (const v of [p.bombs, p.bombCap, p.fire, p.ticksPerCell, p.items.metal, p.items.trap, p.items.bombPack, p.items.bigBomb, p.stunLeft, p.carrying,
                       p.heroAt === null ? -1 : p.heroAt.x, p.heroAt === null ? -1 : p.heroAt.y, p.heroTo === null ? -1 : p.heroTo.x, p.heroTo === null ? -1 : p.heroTo.y,
                       p.stepLeft, p.stepTicks, p.wishX, p.wishY, p.wishFirst, p.faceX, p.faceY])
        f.mix(v);
    for (const gr of this.m._grunts) for (const v of [gr.id, gr.bombLeft, gr.fleeLeft, gr.fleeFrom.x, gr.fleeFrom.y]) f.mix(v);
    return f;
  }
}
