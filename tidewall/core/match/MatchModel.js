// port of model/Match/MatchModel.cs (and of the parts of model/Match/MatchModel.Super.cs a normal match runs)
//
// The whole match: its state and its rules. One call, step, takes one tick's commands and resolves the tick instantly -
// commands first, in (arrival, slot) order, then the world (cannons reload, shots land, ships act, grunts act), then the phase
// clock. It never waits, draws or reads a clock; it appends events. Whole numbers only, one random stream per purpose, every
// list walked by id: the same commands give the same state, and the same stateHash, as the private C# model.
//
// The round (REQ-PHASE-01): CLAIM (round 1 of a level only) -> CANNONS -> BATTLE -> REPAIR -> SCORE -> next round, GameOver
// or Victory (with the fate screen, DECIDE, after a lost round).
//
// Only the NORMAL ruleset is ported (GameOptions.type Normal). From MatchModel.Super.cs this file carries what a normal match
// executes, line for line: castle health and grunts biting castles, the wall trim after REPAIR, what enclosing does at SCORE,
// houses and rocks met on a board that names them, and the state the hash mixes in (castle health, houses surrounded, and the
// bigger ruleset's three counters, which a normal match never moves from their start values).
import { Cell } from '../cell.js';
import { GridModel, Terrain, Occupant, Fnv64 } from '../grid.js';
import { PieceCatalog } from '../pieces.js';
import { PlacementRules, PlacementResult } from '../rules/PlacementRules.js';
import { PathRules, PathResult } from '../rules/PathRules.js';
import { EnclosureRules } from '../rules/EnclosureRules.js';
import { GameRules, BombRules, RoundKind, RoundTable } from '../rules/GameRules.js';
import { GameOptions, GameType, Battlefield, Difficulty, Campaign } from '../rules/Campaign.js';
import { MapCheck } from '../rules/MapCheck.js';
import { CommandKind, Command } from './Commands.js';
import { PlaceWallCommand } from './PlaceWallCommand.js';
import { PieceDealer, Streams } from './PieceDealer.js';
import { BombWorld } from './Bombs.js';
import { Phase, ShipKind, PlayerModel, CannonModel, ShipModel, GruntModel, ShotModel } from './Entities.js';
import {
  RejectReason, ThingCause,
  PhaseChanged, CastleClaimed, RingBuilt, WallsPlaced, PlacementRejected, CommandRejected, CannonsGranted, CannonPlaced,
  PlayerReady, ShipSpawned, ShipMoved, ShotFired, ShotLanded, WallDamaged, WallBroken, CannonDamaged, CannonDestroyed,
  ShipDamaged, ShipSunk, GruntLanded, CannonLost, GruntMoved, GruntKilled, RubbleCleared, LoopClosed, RoundScored, LifeLost,
  MetalPlaced, PlayerLeft, PlayerRejoined, GameEnded, LevelStarted, ThingChanged, CastleRuined, CastleRestored, CastleBitten, HouseRose,
  HouseSurrounded, GruntSurrounded, WallsTrimmed, LastPieceGrace, FateAsked, FateChosen, FinalBonus, PlayerFell,
  ModeSwitched, SwordSwung,
} from './Events.js';

const INT_MAX = 2147483647, INT_MIN = -2147483648;
const DX4 = [1, -1, 0, 0], DY4 = [0, 0, 1, -1];

/** C# int addition: wraps at 32 bits. */
const add32 = (a, b) => (a + b) | 0;

/** C# List.RemoveAll(x => !x.alive): in place, order kept (a view holding the list sees the same array). */
function removeDead(list) {
  let j = 0;
  for (let i = 0; i < list.length; i++) if (list[i].alive) list[j++] = list[i];
  list.length = j;
}

function isTarget(o) { return o === Occupant.Wall || o === Occupant.Cannon; }
/** What a grunt bites: walls, cannons, and castles - the only way a castle can be destroyed. */
function isGruntTarget(o) { return o === Occupant.Wall || o === Occupant.Cannon || o === Occupant.Castle; }

export class MatchModel {
  static MaxPlayers = 4;

  /**
   * @param random   the platform seam: a function from a stream key to a random source (key => new SeededRandom(key)).
   * @param start    Phase.Claim for a real match; Phase.Repair starts a match straight in the building phase (practice, tests).
   * @param loadMap  (name, rules, challenge) => GridModel: the board of a map the campaign moves to (a new level). It replaces the
   *                 private model's map library, which is not ported. The model checks the board (MapCheck) and clears it
   *                 (plain) exactly as the C# does after its own load. null = a match whose table never changes map; a map
   *                 change without it is refused.
   */
  constructor(grid, catalog, rules, table, playerCount, seed, random, start = Phase.Claim, options = null, firstRound = 1, loadMap = null) {
    if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MatchModel.MaxPlayers) throw new RangeError('1 to 4 players (D1)');
    if (start !== Phase.Claim && start !== Phase.Repair) throw new Error('a match starts at Claim or, for practice, Repair');
    if (!Number.isInteger(seed) || seed < INT_MIN || seed > INT_MAX) throw new RangeError('a seed is a 32-bit int');
    if (typeof random !== 'function') throw new TypeError('random is a function from a stream key to a random source');
    this.grid = grid; this.catalog = catalog; this.rules = rules; this.table = table; this.playerCount = playerCount;
    this.seed = seed; this._random = random; this._loadMap = loadMap;
    this._players = new Array(playerCount);
    this._dealers = new Array(playerCount);
    for (let i = 0; i < playerCount; i++) {
      this._players[i] = new PlayerModel(i);
      this._dealers[i] = new PieceDealer(catalog, random, seed, i);
    }
    this.tick = 0;
    this.teamScore = 0;
    this._cannons = []; this._ships = []; this._grunts = []; this._shots = []; this._events = [];
    this._nextCannon = 1; this._nextShip = 1; this._nextGrunt = 1; this._nextShot = 1; this._battles = 0;
    this._wonAtScore = false; this._lostAtScore = false;
    this._grace = false;           // REPAIR's last-piece grace is running
    this._holdNoSpawn = false;     // this BATTLE replays the round to clear the sea before the map changes: no new wave
    this._continuesUsed = 0;       // "Fight Again" taken: each one is MORE FIREPOWER
    this._castleHealth = [];
    this._housesSurrounded = 0;
    this.lives = rules.lives;
    this.options = options ?? new GameOptions({ type: GameType.Normal });   // a match built on a handed board plays the normal rules
    if (this.options.super) throw new Error('only the normal ruleset is ported (GameOptions.type ' + this.options.type + ')');
    // the bomb rule set (BOMBS_SPEC.md) is opt-in: with options.bombs false nothing of it exists and the base rules run untouched
    if (this.options.bombs !== (rules instanceof BombRules)) throw new Error('GameOptions.bombs and the rules must agree: bombs needs BombRules, and BombRules need bombs');
    this._bw = this.options.bombs ? new BombWorld(this) : null;
    if (this._bw !== null) for (const p of this._players) this._bw.initPlayer(p);
    this._graceUsed = new Array(playerCount).fill(false);
    this.round = firstRound;
    this.mapName = table.for(firstRound).map;
    this.phase = start;
    this.phaseTicksLeft = start === Phase.Claim ? rules.claimTicks : this._repairTicks(table.for(firstRound));
    this._events.push(new PhaseChanged(0, this.phase, this.round, this.phaseTicksLeft));
    this._startLevelThings();
  }

  /** The C# MatchModel.Start, on a board the host hands in (the private map library is not ported): the campaign for these
   *  options on the maps `levels.names` (four names, level 1..4), its first round (level 2 for Veteran, with the starting bonus),
   *  the board checked (MapCheck) and cleared (plain) as the C# does at load.
   *  @param grid    the board of the first round's map - MatchModel.firstMapName(options, levels.names) says which.
   *  @param levels  { names: [4 map names], load: (name, rules, challenge) => GridModel } - load is called on each level change. */
  static startOn(grid, options, playerCount, seed, random, levels) {
    if (!(grid instanceof GridModel)) throw new TypeError('startOn takes the first map as a GridModel');
    if (!levels || !Array.isArray(levels.names) || typeof levels.load !== 'function') throw new TypeError('levels is { names: [4 map names], load(name, rules, challenge) }');
    const rules = Campaign.rulesFor(options);
    const table = Campaign.for(options, levels.names);
    const first = Campaign.firstRound(table, options);
    const spec = table.for(first);
    const challenge = spec.kind === RoundKind.Challenge;
    const problems = MapCheck.problems(grid, rules, challenge);
    if (problems.length > 0) throw new Error('the map is not playable: ' + problems.join('; '));
    if (!options.super) MatchModel.plain(grid);
    const m = new MatchModel(grid, Campaign.catalogFor(options), rules, table, playerCount, seed, random,
      challenge ? Phase.Repair : Phase.Claim, options, first, levels.load);
    if (options.field === Battlefield.Veteran) m.teamScore = add32(m.teamScore, rules.pointsVeteranStart);
    return m;
  }

  /** Which of the four map names startOn's first board must be for these options. */
  static firstMapName(options, names) {
    const table = Campaign.for(options, names);
    return table.for(Campaign.firstRound(table, options)).map;
  }

  /** The normal game has none of the bigger ruleset's land: rocks, trees and houses go, swamps and lakes are plain land. */
  static plain(g) {
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++) {
        const t = g.terrainAt(x, y);
        if (t === Terrain.Swamp || t === Terrain.Lake) g.setTerrain(x, y, Terrain.Land);
        const o = g.occupantAt(x, y);
        if (o === Occupant.RockSmall || o === Occupant.RockLarge || o === Occupant.Tree || o === Occupant.House) g.clearCell(x, y);
      }
  }

  /** The round's repair time, scaled by the chosen difficulty (REQ-OPT-03). */
  _repairTicks(r) { return Math.trunc(r.repairTicks * this.options.repairPercent / 100); }

  get level() { return this.table.levelOf(this.round); }
  get wave() { return this.table.waveOf(this.round); }
  get isChallenge() { return this.currentRound.kind === RoundKind.Challenge; }
  get continuesUsed() { return this._continuesUsed; }
  get inGrace() { return this._grace; }

  /** Repair-phase practice with default rules and the default 8-round table. */
  static practice(grid, catalog, playerCount, seed, random) {
    return new MatchModel(grid, catalog, GameRules.default(), RoundTable.default(), playerCount, seed, random, Phase.Repair);
  }

  // ---- what a view reads --------------------------------------------------------------------------------------------------

  get events() { return this._events; }
  player(slot) { return this._players[slot]; }
  heldShapeId(slot) { return this._dealers[slot].current; }
  get cannons() { return this._cannons; }
  get ships() { return this._ships; }
  get grunts() { return this._grunts; }
  get shots() { return this._shots; }
  /** The bomb rule set's state, read-only: lit bombs {id, owner, at, fuseLeft, carriedBy, flightLeft, flightTicks, flightFrom, flightTo,
   *  big}, spike traps {id, owner, at}. Empty when GameOptions.bombs is off. */
  get bombs() { return this._bw === null ? [] : this._bw.bombs; }
  get traps() { return this._bw === null ? [] : this._bw.traps; }
  /** The grounded bomb on a square, or null. */
  bombAt(x, y) { return this._bw === null ? null : this._bw.bombAt(x, y); }
  /** A metal brick stands here (health above a normal brick's). A metal brick worn down to a normal brick's health reads as normal. */
  isMetalAt(x, y) { return this._bw !== null && this.grid.occupantAt(x, y) === Occupant.Wall && this.grid.healthAt(x, y) > this.rules.wallHealth; }
  get ended() { return this.phase === Phase.GameOver || this.phase === Phase.Victory; }
  get currentRound() { return this.table.for(this.round); }
  castleHealthOf(castleId) { return castleId >= 1 && castleId <= this._castleHealth.length ? this._castleHealth[castleId - 1] : 0; }

  gruntAt(x, y) {
    for (const g of this._grunts) if (g.alive && g.at.x === x && g.at.y === y) return true;
    return false;
  }

  /** A replayed ring's walls rise where grunts stand: they are crushed (no points - the team did not surround them). */
  _crushGruntsAt(x, y) {
    for (const g of this._grunts)
      if (g.alive && g.at.x === x && g.at.y === y) { g.alive = false; this._events.push(new GruntSurrounded(this.tick, g.id, g.at)); }
    removeDead(this._grunts);
  }

  cannonAt(x, y) {
    for (const c of this._cannons) if (c.alive && c.covers(x, y)) return c;
    return null;
  }

  castleById(id) {
    for (const k of this.grid.castles) if (k.id === id) return k;
    return null;
  }

  /** Every enemy still afloat. */
  enemiesAfloat() {
    for (const s of this._ships) if (s.alive) return true;
    return false;
  }

  // ---- the tick ---------------------------------------------------------------------------------------------------------

  /** One tick. Returns how many commands were accepted. */
  step(commands) {
    for (const c of commands) if (!(c instanceof Command)) throw new TypeError('step takes Commands (stepWalls takes PlaceWallCommands)');
    this.tick++;
    for (const p of this._players) if (p.swordLeft > 0) p.swordLeft--;          // REQ-HERO-03: the swing's recovery
    let accepted = 0;
    if (!this.ended) {
      const order = commands.map((c, i) => [i, c]);
      order.sort((a, b) => a[1].arrival !== b[1].arrival ? a[1].arrival - b[1].arrival
        : a[1].slot !== b[1].slot ? a[1].slot - b[1].slot : a[0] - b[0]);
      for (const [, c] of order) if (this._apply(c)) accepted++;

      if (this.phase === Phase.Battle) this._simulateBattle();
      else if (this.phase === Phase.Repair) this._simulateGrunts();          // REQ-REF-08: grunts keep at the walls while they are rebuilt
      if (this.phaseTicksLeft > 0) this.phaseTicksLeft--;
      if (this._phaseDone()) this._advance();
    }
    return accepted;
  }

  /** The first slice's shape: a tick of wall placements only (C# Step(IReadOnlyList<PlaceWallCommand>)). */
  stepWalls(walls) {
    const list = [];
    for (const w of walls) {
      if (!(w instanceof PlaceWallCommand)) throw new TypeError('stepWalls takes PlaceWallCommands');
      list.push(Command.placeWall(w.slot, w.seq, w.shapeId, w.quarterTurns, w.anchor, w.arrival));
    }
    return this.step(list);
  }

  _phaseDone() {
    switch (this.phase) {
      case Phase.Claim: return this.phaseTicksLeft === 0 || this._allConnected(p => p.claimedCastle !== 0);
      case Phase.Cannons: return this.phaseTicksLeft === 0 || this._allConnected(p => p.ready || p.cannonsToPlace === 0);
      case Phase.Battle: return (this.phaseTicksLeft === 0 || !this.enemiesAfloat()) && this._shots.length === 0;   // REQ-PHASE-08, REQ-REF-06
      case Phase.Decide: return false;              // only a choice leaves it
      default: return this.phaseTicksLeft === 0;
    }
  }

  _allConnected(f) {
    let any = false;
    for (const p of this._players) { if (!p.connected) continue; any = true; if (!f(p)) return false; }
    return any;
  }

  _connectedCount() {
    let n = 0; for (const p of this._players) if (p.connected) n++; return n;
  }

  _enter(phase, ticks) {
    this.phase = phase; this.phaseTicksLeft = ticks;
    for (const p of this._players) { p.ready = false; p.sword = false; }     // REQ-HERO-02: every phase starts with the tool in hand
    this._events.push(new PhaseChanged(this.tick, phase, this.round, ticks));
  }

  _advance() {
    switch (this.phase) {
      case Phase.Claim:
        this._finishClaims();
        this.grant(1);
        this._enter(Phase.Cannons, this.currentRound.cannonsTicks);
        break;
      case Phase.Cannons:
        for (const p of this._players) { p.cannonsCarried = p.cannonsFresh; p.cannonsFresh = 0; }   // REQ-CANNON-02
        this._enter(Phase.Battle, this.currentRound.battleTicks);
        if (this._bw !== null) this._bw.onBattleStart();
        // (the C# burns the bigger ruleset's pits down here; a normal board never holds one)
        if (!this._holdNoSpawn) this._spawnWave();
        this._holdNoSpawn = false;
        break;
      case Phase.Battle:
        this._enter(Phase.Repair, this._repairTicks(this.currentRound));
        break;
      case Phase.Repair:
        if (!this._grace) {                              // REQ-REPAIR-02: one last piece each, then the walls are judged
          this._grace = true;
          for (let i = 0; i < this._graceUsed.length; i++) this._graceUsed[i] = false;
          this.phaseTicksLeft = this.rules.lastPieceGraceTicks;
          this._events.push(new LastPieceGrace(this.tick, this.phaseTicksLeft));
          break;
        }
        this._grace = false;
        this._trimWalls();
        this._enter(Phase.Score, this.rules.scoreTicks);
        this._scoreRound();
        break;
      case Phase.Score:
        this._afterScore();
        break;
    }
  }

  /** What follows SCORE: game over, the fate screen, victory, the same round again (a sea still full of ships before the map
   *  changes), the next round on this map, or the next level. */
  _afterScore() {
    if (this._lostAtScore && this.lives === 0) { this._enter(Phase.GameOver, 0); this._events.push(new GameEnded(this.tick, false, this.round, this.teamScore)); return; }
    if (this._lostAtScore) {
      this._enter(Phase.Decide, 0);       // it WAITS for the team
      this._events.push(new FateAsked(this.tick, this.lives - 1));
      return;
    }
    if (this._wonAtScore) { this._payFinalBonus(); this._enter(Phase.Victory, 0); this._events.push(new GameEnded(this.tick, true, this.round, this.teamScore)); return; }
    const leavingMap = this.table.isLast(this.round) || this._nextMapDiffers();
    if (!this.isChallenge && leavingMap && this.enemiesAfloat()) {
      // a level is not left with its fleet afloat: the battle is fought again with what is left, and no new wave sails in
      this._holdNoSpawn = true;
      this.grant(this.round);
      this._enter(Phase.Cannons, this.currentRound.cannonsTicks);
      return;
    }
    this.round++;
    if (this._nextMapDiffersFrom(this.round - 1)) { this._loadLevel(); return; }
    this.grant(this.round);
    if (this.isChallenge) this._enter(Phase.Repair, this._repairTicks(this.currentRound));
    else this._enter(Phase.Cannons, this.currentRound.cannonsTicks);
  }

  _nextMapDiffers() { return !this.table.isLast(this.round) && this._nextMapDiffersFrom(this.round); }

  _nextMapDiffersFrom(round) {
    const next = this.table.for(round + 1).map;
    return next !== null && next !== this.mapName;
  }

  /** A new map (a new level): everything on the old board goes; the team keeps its score, lives and continues; castles are
   *  chosen again. */
  _loadLevel() {
    const spec = this.currentRound;
    const challenge = spec.kind === RoundKind.Challenge;
    if (this._loadMap === null) throw new Error("round " + this.round + " moves to map '" + spec.map + "' but this match was built without loadMap");
    const g = this._loadMap(spec.map, this.rules, challenge);
    if (!(g instanceof GridModel)) throw new TypeError("loadMap('" + spec.map + "') did not return a GridModel");
    const problems = MapCheck.problems(g, this.rules, challenge);
    if (problems.length > 0) throw new Error("map '" + spec.map + "' is not playable: " + problems.join('; '));
    this.grid = g;
    if (!this.options.super) MatchModel.plain(this.grid);
    this.mapName = spec.map;
    this._cannons.length = 0; this._ships.length = 0; this._grunts.length = 0; this._shots.length = 0;
    if (this._bw !== null) this._bw.clear(true);            // a new board: nothing lit, no traps
    for (const p of this._players) { p.claimedCastle = 0; p.cannonsFresh = 0; p.cannonsCarried = 0; }
    this._events.push(new LevelStarted(this.tick, this.level, this.round, this.mapName, challenge));
    this._startLevelThings();
    if (challenge) this._enter(Phase.Repair, this._repairTicks(spec));
    else this._enter(Phase.Claim, this.rules.claimTicks);
  }

  /** Fight Again replays the round with MORE FIREPOWER (faster shots); Give Up ends the game. */
  _chooseFate(again, slot) {
    if (!again) {
      this._events.push(new FateChosen(this.tick, false, slot, this._continuesUsed));
      this.lives = 0; this._enter(Phase.GameOver, 0); this._events.push(new GameEnded(this.tick, false, this.round, this.teamScore));
      return;
    }
    this._continuesUsed++;
    this._events.push(new FateChosen(this.tick, true, slot, this._continuesUsed));
    this.grant(this.round);
    if (this.isChallenge) this._enter(Phase.Repair, this._repairTicks(this.currentRound));
    else this._enter(Phase.Cannons, this.currentRound.cannonsTicks);
  }

  /** The bonus at the end: every unused continue, the difficulty played, and completing. */
  _payFinalBonus() {
    const continues = Math.imul(Math.max(0, this.lives - 1), this.rules.pointsUnusedContinue);
    const diff = this.options.level === Difficulty.Medium ? this.rules.pointsMedium : this.options.level === Difficulty.Tough ? this.rules.pointsTough : 0;
    const done = this.rules.pointsCompleteNormal;
    const total = add32(add32(continues, diff), done);
    this.teamScore = add32(this.teamScore, total);
    this._events.push(new FinalBonus(this.tick, continues, diff, done, total));
  }

  // ---- commands -----------------------------------------------------------------------------------------------------------

  _apply(c) {
    if (c.slot < 0 || c.slot >= this.playerCount) {
      if (c.kind === CommandKind.PlaceWall) this._events.push(new PlacementRejected(this.tick, c.slot, c.seq, PlacementResult.BadSlot));
      else this._events.push(new CommandRejected(this.tick, c.kind, c.slot, c.seq, RejectReason.BadSlot));
      return false;
    }
    const p = this._players[c.slot];
    if (c.kind === CommandKind.Rejoin) return this._rejoin(c, p);
    if (!p.connected) {
      if (c.kind === CommandKind.PlaceWall) this._events.push(new PlacementRejected(this.tick, c.slot, c.seq, PlacementResult.Disconnected));
      else this._events.push(new CommandRejected(this.tick, c.kind, c.slot, c.seq, RejectReason.Disconnected));
      return false;
    }
    switch (c.kind) {
      case CommandKind.PlaceWall: return this._placeWall(c);
      case CommandKind.PlaceCannon: return this._placeCannon(c, p);
      case CommandKind.Fire: return this._fire(c);
      case CommandKind.Ready: return this._ready(c, p);
      case CommandKind.Claim: return this._claim(c, p);
      case CommandKind.Leave: p.connected = false; this._events.push(new PlayerLeft(this.tick, c.slot)); return true;
      case CommandKind.SwitchMode: return this._switchMode(c, p);
      case CommandKind.Strike: return this._bw !== null ? this._bw.apply(c, p) : this._strike(c, p);   // bombs: strike = drop a bomb
      case CommandKind.PickUpBomb: case CommandKind.ThrowBomb: case CommandKind.DefuseBomb:
      case CommandKind.Buy: case CommandKind.PlaceTrap: case CommandKind.MoveHero:
        return this._bw !== null ? this._bw.apply(c, p) : this._reject(c, RejectReason.NoBombRules);
      case CommandKind.Decide:
        if (this.phase !== Phase.Decide) return this._reject(c, RejectReason.WrongPhase);
        this._chooseFate(c.quarterTurns !== 0, c.slot); return true;
    }
    throw new Error('command kind ' + c.kind + ' has no handler');
  }

  _reject(c, why) { this._events.push(new CommandRejected(this.tick, c.kind, c.slot, c.seq, why)); return false; }

  /** Tool <-> sword. Only in REPAIR (build) and BATTLE (cannon): one or the other, not both at once. */
  _switchMode(c, p) {
    if (this.phase !== Phase.Repair && this.phase !== Phase.Battle) return this._reject(c, RejectReason.WrongPhase);
    p.sword = !p.sword;
    this._events.push(new ModeSwitched(this.tick, c.slot, p.sword));
    return true;
  }

  /** A sword swing at the hero's square: every grunt on it or the eight round it dies. */
  _strike(c, p) {
    if (this.phase !== Phase.Repair && this.phase !== Phase.Battle) return this._reject(c, RejectReason.WrongPhase);
    if (!p.sword) return this._reject(c, RejectReason.NoSword);
    if (p.swordLeft > 0) return this._reject(c, RejectReason.SwordSwinging);
    p.swordLeft = this.rules.swordTicks;
    let kills = 0; const r = this.rules.swordReach;
    for (const g of this._grunts) {
      if (!g.alive || Math.abs(g.at.x - c.at.x) > r || Math.abs(g.at.y - c.at.y) > r) continue;
      g.alive = false; kills++;
      this._players[c.slot].score = add32(this._players[c.slot].score, this.rules.pointsGruntSworded);
      this.teamScore = add32(this.teamScore, this.rules.pointsGruntSworded);
      this._events.push(new GruntKilled(this.tick, g.id, c.slot, g.at));
    }
    removeDead(this._grunts);
    this._events.push(new SwordSwung(this.tick, c.slot, c.at, kills));
    return true;
  }

  _rejoin(c, p) {
    if (p.connected) return this._reject(c, RejectReason.AlreadyConnected);
    p.connected = true; this._events.push(new PlayerRejoined(this.tick, c.slot)); return true;
  }

  /** What a placeWall(slot, shapeId, quarterTurns, at) would answer NOW, without placing it: the same checks in the same order as
   *  _placeWall (which calls this), so a view that draws this verdict at the ghost can never disagree with the command (UC-P1).
   *  Returns { result: PlacementResult, bad: Cell[] } - bad = the squares behind the result (PlacementRules.offending), empty for a
   *  reason that is not about a square (wrong phase, tool out, wrong piece, last piece used). The slot must be connected. */
  wallVerdict(slot, shapeId, quarterTurns, at) {
    if (this.phase !== Phase.Repair) return { result: PlacementResult.WrongPhase, bad: [] };
    if (this._players[slot].sword) return { result: PlacementResult.SwordOut, bad: [] };   // REQ-HERO-02
    if (shapeId !== this._dealers[slot].current) return { result: PlacementResult.WrongPiece, bad: [] };
    if (this._grace && this._graceUsed[slot]) return { result: PlacementResult.GraceUsed, bad: [] };
    const shape = this.catalog.byId(shapeId), enemy = (x, y) => this.gruntAt(x, y);
    const result = PlacementRules.check(this.grid, shape, quarterTurns, at, enemy);
    return { result, bad: result === PlacementResult.Ok ? [] : PlacementRules.offending(this.grid, shape, quarterTurns, at, enemy) };
  }

  _placeWall(c) {
    const result = this.wallVerdict(c.slot, c.shapeId, c.quarterTurns, c.at).result;
    if (result !== PlacementResult.Ok) { this._events.push(new PlacementRejected(this.tick, c.slot, c.seq, result)); return false; }
    const dealer = this._dealers[c.slot];
    const shape = this.catalog.byId(c.shapeId);

    const before = EnclosureRules.enclosedCastleIds(this.grid);
    const cells = PlacementRules.cellsOf(shape, c.quarterTurns, c.at);
    const houses = [];
    for (const cell of cells) if (this.grid.occupantAt(cell.x, cell.y) === Occupant.House) houses.push(cell);
    const player = this._players[c.slot];
    const metal = this._bw !== null && player.items.metal > 0;          // a bought metal piece: every brick takes more blasts
    if (metal) player.items.metal--;
    for (const cell of cells) this.grid.setWall(cell.x, cell.y, c.slot, metal ? this.rules.metalWallHealth : this.rules.wallHealth);
    for (const h of houses) this._houseToGrunt(h);
    if (this._grace) this._graceUsed[c.slot] = true;
    dealer.take();
    this._events.push(new WallsPlaced(this.tick, c.slot, c.seq, c.shapeId, c.quarterTurns & 3, cells, dealer.current));
    if (metal) this._events.push(new MetalPlaced(this.tick, c.slot, c.seq, cells));
    if (this._bw !== null) for (const cell of cells) this._bw.removeTrapAt(cell.x, cell.y);
    for (const id of EnclosureRules.enclosedCastleIds(this.grid))
      if (!before.includes(id)) {
        this._players[c.slot].score = add32(this._players[c.slot].score, this.rules.pointsClosingCredit);
        this.teamScore = add32(this.teamScore, this.rules.pointsClosingCredit);
        this._events.push(new LoopClosed(this.tick, c.slot, id));
      }
    return true;
  }

  /** What a placeCannon(slot, at) would answer NOW: -1 (it would be placed) or the RejectReason, with the squares behind it (the
   *  2x2 square that is blocked or outside the player's own ring). The same checks in the same order as _placeCannon, which calls
   *  it; the controller draws the CANNONS ghost from it, so the ghost and the command agree (UC-P1). `terr` is EnclosureRules.map
   *  of the board now (passed in so a caller drawing several ghosts maps the board once), or null to map it here. */
  cannonVerdict(slot, at, terr = null) {
    const p = this._players[slot];
    if (this.phase !== Phase.Cannons) return { result: RejectReason.WrongPhase, bad: [] };
    if (p.cannonsToPlace <= 0) return { result: RejectReason.NoCannons, bad: [] };
    // inside an area the player's OWN walls ring, not a team-mate's
    if (terr === null) terr = EnclosureRules.map(this.grid);
    const g = this.grid, blocked = (x, y) => !g.in(x, y) || g.terrainAt(x, y) !== Terrain.Land || g.occupantAt(x, y) !== Occupant.Empty || this.gruntAt(x, y);
    let result = -1;
    for (let dy = 0; dy < 2 && result < 0; dy++)
      for (let dx = 0; dx < 2 && result < 0; dx++) {
        const x = at.x + dx, y = at.y + dy;
        if (blocked(x, y)) result = RejectReason.Blocked;
        else if (!terr.holds(slot, terr.regionAt(x, y))) result = RejectReason.NotEnclosed;
      }
    const bad = [];
    if (result >= 0)                                  // every square of the 2x2 behind that reason (a view outlines them)
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const x = at.x + dx, y = at.y + dy;
        if (result === RejectReason.Blocked ? blocked(x, y) : !blocked(x, y) && !terr.holds(slot, terr.regionAt(x, y))) bad.push(new Cell(x, y));
      }
    return { result, bad };
  }

  _placeCannon(c, p) {
    const why = this.cannonVerdict(c.slot, c.at).result;
    if (why >= 0) return this._reject(c, why);
    const cannon = new CannonModel(this._nextCannon++, c.slot, c.at, this.rules.cannonHealth);
    this._cannons.push(cannon);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.grid.setCannon(c.at.x + dx, c.at.y + dy, c.slot);
    if (this._bw !== null) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this._bw.removeTrapAt(c.at.x + dx, c.at.y + dy);
    if (p.cannonsCarried > 0) p.cannonsCarried--; else p.cannonsFresh--;
    this._events.push(new CannonPlaced(this.tick, cannon.id, c.slot, c.seq, c.at));
    return true;
  }

  _ready(c, p) {
    if (this.phase !== Phase.Cannons && this.phase !== Phase.Claim) return this._reject(c, RejectReason.WrongPhase);
    p.ready = true; this._events.push(new PlayerReady(this.tick, c.slot)); return true;
  }

  _fire(c) {
    if (this.phase !== Phase.Battle) return this._reject(c, RejectReason.WrongPhase);
    if (this._players[c.slot].sword) return this._reject(c, RejectReason.SwordOut);                    // REQ-HERO-02
    if (!this.grid.in(c.at.x, c.at.y)) return this._reject(c, RejectReason.Blocked);
    let best = null; let bestD = Number.MAX_SAFE_INTEGER;
    for (const k of this._cannons) {      // id order = placement order: the tie goes to the cannon placed first
      if (!k.alive || k.reloadLeft > 0 || k.inFlight > 0) continue;     // one ball in the air per cannon
      if (k.owner !== c.slot && this._players[k.owner].connected) continue;   // your own, or one whose player left (D12)
      const dx = k.topLeft.x - c.at.x, dy = k.topLeft.y - c.at.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best === null) return this._reject(c, RejectReason.NoLoadedCannon);
    best.reloadLeft = this.rules.cannonReloadTicks;
    let ticks = this.rules.shotBaseTicks + this.rules.shotTicksPerCell * PathRules.manhattan(best.topLeft, c.at);
    ticks = Math.max(this.rules.shotBaseTicks, Math.trunc(ticks * (100 - 20 * Math.min(2, this._continuesUsed)) / 100));   // MORE FIREPOWER: faster balls
    const shot = new ShotModel(this._nextShot++, c.slot, 0, best.topLeft, c.at, ticks, this.rules.playerShotDamage, this.tick);
    shot.cannonId = best.id;
    best.inFlight++;
    this._shots.push(shot);
    this._events.push(new ShotFired(this.tick, shot.id, c.slot, 0, best.id, best.topLeft, c.at, ticks));
    return true;
  }

  _claim(c, p) {
    if (this.phase !== Phase.Claim) return this._reject(c, RejectReason.WrongPhase);
    const id = this._castleIdAt(c.at);
    if (id === 0 || this.castleById(id).ruined) return this._reject(c, RejectReason.NotACastle);
    let takenByOther = false;
    for (const o of this._players) if (o !== p && o.claimedCastle === id) takenByOther = true;
    if (takenByOther && this._unclaimedCastle() !== 0) return this._reject(c, RejectReason.Blocked);   // distinct while castles remain
    p.claimedCastle = id;
    this._events.push(new CastleClaimed(this.tick, c.slot, id, false));
    return true;
  }

  _castleIdAt(at) {
    for (const k of this.grid.castles) for (const cell of k.cells) if (cell.x === at.x && cell.y === at.y) return k.id;
    return 0;
  }

  _unclaimedCastle() {
    for (const k of this.grid.castles) {
      if (k.ruined) continue;
      let taken = false;
      for (const p of this._players) if (p.claimedCastle === k.id) taken = true;
      if (!taken) return k.id;
    }
    return 0;
  }

  _finishClaims() {
    for (const p of this._players) {
      if (p.claimedCastle !== 0) continue;
      let id = this._unclaimedCastle();
      if (id === 0) {
        if (this.grid.castles.length === 0) throw new Error('the board has no castle to give player ' + p.slot);
        id = this.grid.castles[p.slot % this.grid.castles.length].id;
      }
      p.claimedCastle = id;
      this._events.push(new CastleClaimed(this.tick, p.slot, id, true));
    }
    for (const p of this._players) this._buildRing(p.slot, p.claimedCastle, false);
  }

  /** Fight Again replays the most recent combat: each player's home castle stands again - a graveyard is restored at full
   *  health - inside its starting ring, and the ring's walls crush any grunt standing where they rise. */
  _replayHome(p) {
    const castle = this.castleById(p.claimedCastle);
    if (castle === null) return;
    if (castle.ruined) {
      this.grid.setCastleRuined(castle, false);
      this._castleHealth[castle.id - 1] = this.rules.castleHealth;
      this._events.push(new CastleRestored(this.tick, castle.id));
    }
    this._buildRing(p.slot, p.claimedCastle, true);
    // and any grunt already INSIDE the ring would gnaw the castle through the whole replay: the replay starts it clean
    const r = this.rules.ringRadius;
    for (const cell of castle.cells)
      for (let dy = -(r - 1); dy <= r - 1; dy++)
        for (let dx = -(r - 1); dx <= r - 1; dx++)
          if (this.grid.in(cell.x + dx, cell.y + dy)) this._crushGruntsAt(cell.x + dx, cell.y + dy);
  }

  /** The free starting ring (REQ-PHASE-07): every empty land square exactly ringRadius squares (king's move) outside the
   *  castle's bounding box becomes a wall of that player. */
  _buildRing(slot, castleId, crush) {
    let castle = null;
    for (const k of this.grid.castles) if (k.id === castleId) castle = k;
    if (castle === null) return;
    let x0 = INT_MAX, y0 = INT_MAX, x1 = INT_MIN, y1 = INT_MIN;
    for (const cell of castle.cells) { x0 = Math.min(x0, cell.x); y0 = Math.min(y0, cell.y); x1 = Math.max(x1, cell.x); y1 = Math.max(y1, cell.y); }
    const r = this.rules.ringRadius;
    const built = [];
    const g = this.grid;
    for (let y = y0 - r; y <= y1 + r; y++)
      for (let x = x0 - r; x <= x1 + r; x++) {
        const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
        if (Math.max(dx, dy) !== r || !g.in(x, y)) continue;
        if (crush && g.terrainAt(x, y) === Terrain.Land && g.occupantAt(x, y) === Occupant.Empty) this._crushGruntsAt(x, y);
        if (g.terrainAt(x, y) !== Terrain.Land || g.occupantAt(x, y) !== Occupant.Empty || this.gruntAt(x, y)) continue;
        g.setWall(x, y, slot, this.rules.wallHealth);
        if (this._bw !== null) this._bw.removeTrapAt(x, y);
        built.push(new Cell(x, y));
      }
    this._events.push(new RingBuilt(this.tick, slot, castleId, built));
  }

  // ---- scoring and cannons ------------------------------------------------------------------------------------------------

  /** An enclosed castle grants cannons to whoever's walls ring it: its claimer, if that is one of them, HomeCastleCannons;
   *  else the ringer with the most wall squares on it, OtherCastleCannons. Only a castle ringed by no player's walls is
   *  shared out in turn (REQ-CANNON-06). (C# internal: tests call it.) */
  grant(forRound) {
    const per = new Array(this.playerCount).fill(0);
    let shared = 0;
    const terr = EnclosureRules.map(this.grid);
    for (const id of EnclosureRules.enclosedCastleIds(this.grid)) {
      const c = this.castleById(id);
      const region = terr.regionAt(c.cells[0].x, c.cells[0].y);
      let home = false;
      for (const p of this._players)
        if (p.connected && p.claimedCastle === id && terr.holds(p.slot, region)) { per[p.slot] += this.rules.homeCastleCannons; home = true; }
      if (home) continue;
      const owner = terr.mainOwner(region);
      if (owner >= 0 && owner < this.playerCount && this._players[owner].connected) per[owner] += this.rules.otherCastleCannons;
      else shared += this.rules.otherCastleCannons;
    }
    const split = this.splitGrant(shared, forRound);
    let total = 0;
    for (let i = 0; i < this.playerCount; i++) { per[i] += split[i]; this._players[i].cannonsFresh = per[i]; total += per[i]; }
    this._events.push(new CannonsGranted(this.tick, per, total));
  }

  /** REQ-CANNON-06: equal shares among connected players; the remainder one each to connected slots in turn, starting at
   *  (round mod connected count). */
  splitGrant(total, forRound) {
    const per = new Array(this.playerCount).fill(0);
    const connected = [];
    for (let i = 0; i < this.playerCount; i++) if (this._players[i].connected) connected.push(i);
    if (connected.length === 0) return per;
    const share = Math.trunc(total / connected.length), rest = total % connected.length;
    for (const s of connected) per[s] = share;
    const start = forRound % connected.length;
    for (let k = 0; k < rest; k++) per[connected[(start + k) % connected.length]]++;
    return per;
  }

  _scoreRound() {
    const g = this.grid;
    const rubble = [];
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++)
        if (g.occupantAt(x, y) === Occupant.Rubble) { g.clearCell(x, y); rubble.push(new Cell(x, y)); }
    if (rubble.length > 0) this._events.push(new RubbleCleared(this.tick, rubble));

    const outside = EnclosureRules.outside(g);
    for (const k of this._cannons) {                                       // REQ-REF-03: lost with the territory
      if (!k.alive) continue;
      let open = false;
      for (let dy = 0; dy < k.size; dy++) for (let dx = 0; dx < k.size; dx++) open = open || !!outside[(k.topLeft.y + dy) * g.width + k.topLeft.x + dx];
      if (!open) continue;
      k.alive = false;
      for (let dy = 0; dy < k.size; dy++) for (let dx = 0; dx < k.size; dx++) g.clearCell(k.topLeft.x + dx, k.topLeft.y + dy);
      this._events.push(new CannonLost(this.tick, k.id));
    }
    const extra = this._enclosedEffects(outside);                         // grunts crushed, houses, ground reclaimed, graveyards
    const castles = EnclosureRules.enclosedCastleIds(g);
    const cells = EnclosureRules.enclosedLandCells(g);
    const points = add32(extra, castles.length === 0 ? 0 : add32(this.castleBonusFor(castles.length), Math.imul(cells, this.rules.pointsPerEnclosedCell)));
    this.teamScore = add32(this.teamScore, points);
    // REQ-TERR-02: EVERY connected player must hold a castle inside their own territory; one who does not costs the team the round.
    const fallen = this.playersWithoutACastle();
    for (const s of fallen) this._events.push(new PlayerFell(this.tick, s));
    this._lostAtScore = fallen.length > 0 && !this.isChallenge;
    this._wonAtScore = !this._lostAtScore && this.table.isLast(this.round) && !this.enemiesAfloat();
    if (this._lostAtScore) {
      if (this._bw !== null) this._bw.clear(false);          // the fuses go out with the lost round
      this.lives--;
      this._events.push(new LifeLost(this.tick, this.lives));
      if (this.lives > 0) for (const p of this._players) this._replayHome(p);
    }
    this._events.push(new RoundScored(this.tick, this.round, castles, cells, points, this.lives));
    // (the C# grows the bigger ruleset's land things here; a normal match grows none)
  }

  /** The connected players who hold no castle inside their own territory (REQ-TERR-02). */
  playersWithoutACastle() {
    const terr = EnclosureRules.map(this.grid);
    const held = new Array(this.playerCount).fill(false);
    for (const c of this.grid.castles) {
      if (c.ruined) continue;
      const region = terr.regionAt(c.cells[0].x, c.cells[0].y);
      if (region === 0) continue;
      for (let s = 0; s < this.playerCount; s++) if (terr.holds(s, region)) held[s] = true;
    }
    const fallen = [];
    for (let s = 0; s < this.playerCount; s++) if (this._players[s].connected && !held[s]) fallen.push(s);
    return fallen;
  }

  /** 1 castle 500, 2 700, 3 900, 4 1000, 5 1200, 6 1400; past six, +200 each. */
  castleBonusFor(castles) {
    const t = this.rules.castleBonus;
    if (castles <= 0) return 0;
    if (castles < t.length) return t[castles];
    return add32(t[t.length - 1], Math.imul(200, castles - (t.length - 1)));
  }

  // ---- what enclosing does, and the land (from MatchModel.Super.cs) --------------------------------------------------------

  _startLevelThings() {
    this._castleHealth = new Array(this.grid.castles.length).fill(this.rules.castleHealth);
    // (the C# also lays the bigger ruleset's bonus squares here; a normal match has none)
  }

  /** A player's ball on land: a small rock is blown up, a tree felled, a house destroyed; large rocks shrug it off. Only a
   *  board that names those things holds them (a normal campaign clears them at load). */
  _shootLand(x, y, sh) {
    const o = this.grid.occupantAt(x, y);
    const points = o === Occupant.RockSmall ? this.rules.pointsSmallRock : o === Occupant.House ? this.rules.pointsHouseDestroyed : 0;
    if (o === Occupant.RockSmall || o === Occupant.Tree || o === Occupant.House) {
      this.grid.clearCell(x, y);
      this._players[sh.fromSlot].score = add32(this._players[sh.fromSlot].score, points);
      this.teamScore = add32(this.teamScore, points);
      this._events.push(new ThingChanged(this.tick, new Cell(x, y), Occupant.Empty, this.grid.terrainAt(x, y), ThingCause.Shot, sh.fromSlot));
      return true;
    }
    return o === Occupant.RockLarge;
  }

  /** A wall laid on a house: its people rise as an enemy grunt on the nearest free land. */
  _houseToGrunt(house) {
    const g = this.grid;
    let best = Cell.zero; let bestD = INT_MAX;
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++) {
        if (g.terrainAt(x, y) !== Terrain.Land || g.occupantAt(x, y) !== Occupant.Empty || this.gruntAt(x, y)) continue;
        const d = Math.abs(x - house.x) + Math.abs(y - house.y);
        if (d < bestD) { bestD = d; best = new Cell(x, y); }
      }
    if (bestD === INT_MAX) return;
    const gr = new GruntModel(this._nextGrunt++, best, this.rules.gruntTicksPerCell, this.rules.gruntBiteTicks);
    this._grunts.push(gr);
    this._events.push(new HouseRose(this.tick, house, gr.id, best));
  }

  /** A grunt bites a castle; at zero it is ruined - a graveyard. */
  _biteCastle(x, y) {
    const c = this._castleAtCell(x, y);
    if (c === null || c.ruined) return;
    const h = --this._castleHealth[c.id - 1];
    this._events.push(new CastleBitten(this.tick, c.id, h));
    if (h > 0) return;
    this.grid.setCastleRuined(c, true);
    this._events.push(new CastleRuined(this.tick, c.id));
  }

  _castleAtCell(x, y) {
    for (const k of this.grid.castles) for (const cell of k.cells) if (cell.x === x && cell.y === y) return k;
    return null;
  }

  /** Freestanding and jutting wall squares are trimmed when REPAIR is complete. One pass: a wall square that borders no
   *  enclosed ground (eight neighbours) and has at most one wall beside it (four neighbours) is a loose end, and goes. */
  _trimWalls() {
    const g = this.grid;
    const outside = EnclosureRules.outside(g);
    const cut = [];
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++) {
        if (g.occupantAt(x, y) !== Occupant.Wall) continue;
        let border = false; let walls = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if ((dx === 0 && dy === 0) || !g.in(nx, ny)) continue;
            const o = g.occupantAt(nx, ny);
            if (o !== Occupant.Wall && !outside[ny * g.width + nx]) border = true;
            if (o === Occupant.Wall && (dx === 0 || dy === 0)) walls++;
          }
        if (!border && walls <= 1) cut.push(new Cell(x, y));
      }
    for (const c of cut) g.clearCell(c.x, c.y);
    if (cut.length > 0) this._events.push(new WallsTrimmed(this.tick, cut));
  }

  /** What enclosing does at SCORE: grunts are crushed, houses pay 100, 200, ..., swamps and lakes become land, trees are
   *  cleared, and a ruined castle shut in becomes plain ground (normal rules). Returns the points earned. */
  _enclosedEffects(outside) {
    const g = this.grid;
    let points = 0; const w = g.width;
    for (const gr of this._grunts) {
      if (!gr.alive || outside[gr.at.y * w + gr.at.x]) continue;
      gr.alive = false; points = add32(points, this.rules.pointsGruntSurrounded);
      this._events.push(new GruntSurrounded(this.tick, gr.id, gr.at));
    }
    removeDead(this._grunts);
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < w; x++) {
        if (outside[y * w + x]) continue;
        const at = new Cell(x, y);
        const o = g.occupantAt(x, y);
        const ground = g.terrainAt(x, y);
        if (ground === Terrain.Swamp || ground === Terrain.Lake) {
          g.setTerrain(x, y, Terrain.Land);
          this._events.push(new ThingChanged(this.tick, at, o, Terrain.Land, ThingCause.Enclosed, -1));
        }
        if (o === Occupant.Tree) { g.clearCell(x, y); this._events.push(new ThingChanged(this.tick, at, Occupant.Empty, Terrain.Land, ThingCause.Enclosed, -1)); }
        else if (o === Occupant.House) {
          this._housesSurrounded++;
          const p = Math.imul(this.rules.pointsHouseStep, this._housesSurrounded);
          points = add32(points, p);
          g.clearCell(x, y);
          this._events.push(new HouseSurrounded(this.tick, at, p));
        }
      }
    for (const c of g.castles) {
      if (!c.ruined) continue;
      let inside = true;
      for (const cell of c.cells) if (outside[cell.y * w + cell.x]) inside = false;
      if (!inside) continue;
      for (const cell of c.cells) {
        g.setThing(cell.x, cell.y, Occupant.Empty, 0);
        this._events.push(new ThingChanged(this.tick, cell, Occupant.Empty, Terrain.Land, ThingCause.Enclosed, -1));
      }
    }
    // (the C# then pays the bigger ruleset's bonus squares and clears its unused emplacements; a normal match has neither)
    return points;
  }

  // ---- the battle ---------------------------------------------------------------------------------------------------------

  _spawnWave() {
    const spec = this.currentRound;
    if (spec.kind === RoundKind.Challenge) return;
    const players = Math.max(1, this._connectedCount());
    const kinds = [];
    // UC-B1 (0 outside the bomb rules' boss rounds); step 1 says ONE boss: none while one is still afloat (a Fight Again of the boss
    // round would otherwise add a second; found by the spec check, 11-11)
    if (!this._ships.some((s) => s.alive && s.kind === ShipKind.Boss)) for (let i = 0; i < spec.bossShips; i++) kinds.push(ShipKind.Boss);
    for (let i = 0; i < spec.twoSailShips; i++) kinds.push(ShipKind.TwoSail);
    for (let i = 0, n = spec.shipCount(players); i < n; i++) kinds.push(ShipKind.OneSail);
    const rng = this._random(Streams.key(this.seed, 2000, this._battles++));
    let afloat = 0; for (const s of this._ships) if (s.alive) afloat++;
    const g = this.grid;
    for (const kind of kinds) {
      if (afloat >= this.rules.maxShips) break;                          // at most maxShips ships on the water
      const spawn = [];
      const n = kind === ShipKind.Boss ? this.rules.bossSize : 1;
      for (let y = 0; y + n <= g.height; y++)
        for (let x = 0; x + n <= g.width; x++) {
          const edge = x === 0 || y === 0 || x + n === g.width || y + n === g.height;
          if (edge && this._shipFits(x, y, n)) spawn.push(new Cell(x, y));
        }
      if (spawn.length === 0 && kind === ShipKind.Boss) continue;          // UC-B1 1c: no edge water a boss fits in this wave
      if (spawn.length === 0) throw new Error('the map has no water on its edge: ships cannot arrive (REQ-SHIP-05; MapCheck refuses such a map at load)');
      // UC-B1 step 1: the boss comes for the players: the edge spot nearest any wall or cannon (ties: the first in row order), not a
      // random one (11-11, tools/boss_balance.mjs: from a random edge it could sail 33+ squares and arrive as the battle clock ran out,
      // when ships no longer act; it then never fired)
      const at = kind === ShipKind.Boss ? this._nearestToTargets(spawn) : spawn[rng.range(0, spawn.length)];
      const s = this._makeShip(kind, at);
      this._ships.push(s);
      this._events.push(new ShipSpawned(this.tick, s.id, at, s.health, s.kind));
      afloat++;
    }
  }

  /** A one-sail ship takes the round's ship health (or the rules' default when the round names none); a two-sail ship its own. */
  _makeShip(kind, at) {
    const spec = this.currentRound;
    let health;
    if (kind === ShipKind.TwoSail) health = this.rules.twoSailHealth;
    else if (kind === ShipKind.OneSail) health = spec.shipHealth > 0 ? spec.shipHealth : this.rules.whiteShipHealth;
    else if (kind === ShipKind.Boss) {                                       // UC-B1: the bomb rules' boss, its health by level
      if (!this.options.bombs) throw new Error('a boss ship is part of the bomb rule set only');
      const hp = this.rules.bossHealth;
      const ship = new ShipModel(this._nextShip++, at, hp[Math.min(this.level, hp.length) - 1] + this.rules.bossHealthPerExtraPlayer * Math.max(0, this.playerCount - 1), this.rules.bossTicksPerCell, Math.trunc(this.rules.bossReloadTicks / 2));
      ship.kind = kind; ship.big = this.rules.bossSize;
      return ship;
    }
    else throw new Error('ship kind ' + kind + ' is not part of the normal game');
    const ship = new ShipModel(this._nextShip++, at, health, this.rules.shipTicksPerCell, Math.trunc(this.rules.shipReloadTicks / 2));
    ship.kind = kind;
    return ship;
  }

  /** Of `cells`, the one with the smallest Manhattan distance to any wall or cannon (the first such in their order on a tie); the
   *  first cell when there is no wall or cannon at all. */
  _nearestToTargets(cells) {
    const g = this.grid, targets = [];
    for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) if (isTarget(g.occupantAt(x, y))) targets.push(x, y);
    if (targets.length === 0) return cells[0];
    let best = cells[0], bestD = INT_MAX;
    for (const c of cells) {
      let d = INT_MAX;
      for (let i = 0; i < targets.length; i += 2) d = Math.min(d, Math.abs(targets[i] - c.x) + Math.abs(targets[i + 1] - c.y));
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  /** An n x n ship fits with its top-left at (x, y): every square on the board, water, and under no other ship. */
  _shipFits(x, y, n, self = null) {
    const g = this.grid;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
      const cx = x + dx, cy = y + dy;
      if (!g.in(cx, cy) || g.terrainAt(cx, cy) !== Terrain.Water) return false;
      for (const s of this._ships) if (s.alive && s !== self && s.covers(cx, cy)) return false;
    }
    return true;
  }

  /** Tests: put a ship of a normal kind on the water at `at` (C# internal PutShip). */
  putShip(kind, at) {
    const s = this._makeShip(kind, at);
    this._ships.push(s);
    return s;
  }

  _shipAt(x, y) {
    for (const s of this._ships) if (s.alive && s.covers(x, y)) return true;
    return false;
  }

  _simulateGrunts() {
    if (this._bw !== null) this._bw.step();
    for (const g of this._grunts) if (g.alive) this._actGrunt(g);
    if (this._bw !== null) this._bw.sweepTraps();
    removeDead(this._grunts);
  }

  _simulateBattle() {
    for (const k of this._cannons) if (k.alive && k.reloadLeft > 0) k.reloadLeft--;
    this._landShots();
    if (this._bw !== null) this._bw.step();
    if (this.phaseTicksLeft > 0) {
      for (const s of this._ships) if (s.alive) this._actShip(s);
      for (const g of this._grunts) if (g.alive) this._actGrunt(g);
    }
    if (this._bw !== null) this._bw.sweepTraps();
    removeDead(this._ships);
    removeDead(this._grunts);
  }

  _landShots() {
    for (let i = 0; i < this._shots.length; i++) {
      const sh = this._shots[i];
      if (sh.firedTick === this.tick || --sh.ticksLeft > 0) continue;
      let hit = false;
      const x = sh.target.x, y = sh.target.y;
      if (sh.fromSlot >= 0) {
        for (const k of this._cannons) if (k.id === sh.cannonId && k.inFlight > 0) k.inFlight--;
        for (const s of this._ships)
          if (s.alive && s.covers(x, y)) { hit = true; this._hitShip(s, sh.damage, sh.fromSlot); }
        if (this._bw === null)                    // bombs are the only ground attack: with them on, a ball on land spares grunts
        for (const g of this._grunts)
          if (g.alive && g.at.x === x && g.at.y === y) {
            hit = true; g.alive = false;
            this._players[sh.fromSlot].score = add32(this._players[sh.fromSlot].score, this.rules.pointsGruntKilled);
            this.teamScore = add32(this.teamScore, this.rules.pointsGruntKilled);
            this._events.push(new GruntKilled(this.tick, g.id, sh.fromSlot, g.at));
          }
        if (!hit && this.grid.in(x, y)) hit = this._shootLand(x, y, sh);
      } else if (sh.fromSlot === -1) {
        const occ = this.grid.occupantAt(x, y);
        if (occ === Occupant.Wall) { hit = true; this._damageWall(x, y, sh.damage); }
        else if (occ === Occupant.Cannon) { hit = true; this._damageCannon(this.cannonAt(x, y), sh.damage); }
      } else throw new Error('shot ' + sh.id + ' came from slot ' + sh.fromSlot + ': not a player (>= 0) and not a ship (-1)');
      this._events.push(new ShotLanded(this.tick, sh.id, sh.target, hit));
      this._shots.splice(i, 1); i--;
    }
  }

  /** A hit on a ship pays the shooter (pointsShipHit a hit, the sinking one too). */
  _hitShip(s, damage, bySlot) {
    if (bySlot >= 0) {
      this._players[bySlot].score = add32(this._players[bySlot].score, this.rules.pointsShipHit);
      this.teamScore = add32(this.teamScore, this.rules.pointsShipHit);
    }
    this._damageShip(s, damage, bySlot);
  }

  _damageShip(s, damage, bySlot) {
    s.health -= damage;
    if (s.health > 0) { this._events.push(new ShipDamaged(this.tick, s.id, s.health)); return; }
    s.alive = false;
    if (s.kind === ShipKind.Boss && bySlot >= 0) {                          // UC-B1 step 5: the boss pays its sinker on top
      this._players[bySlot].score = add32(this._players[bySlot].score, this.rules.pointsBossSunk);
      this.teamScore = add32(this.teamScore, this.rules.pointsBossSunk);
    }
    this._events.push(new ShipSunk(this.tick, s.id, bySlot, s.at));
  }

  /** A two-sail ship at the shore puts one grunt on the nearest empty land square (ties: the lowest index). */
  _landGrunt(from, shipId) {
    const g = this.grid;
    let best = Cell.zero; let bestD = INT_MAX;
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++) {
        if (g.terrainAt(x, y) !== Terrain.Land || g.occupantAt(x, y) !== Occupant.Empty || this.gruntAt(x, y)) continue;
        const d = Math.abs(x - from.x) + Math.abs(y - from.y);
        if (d < bestD) { bestD = d; best = new Cell(x, y); }
      }
    if (bestD > this.rules.gruntLandingReach) return;
    const gr = new GruntModel(this._nextGrunt++, best, this.rules.gruntTicksPerCell, this.rules.gruntBiteTicks);
    this._grunts.push(gr);
    this._events.push(new GruntLanded(this.tick, gr.id, shipId, best));
  }

  _damageWall(x, y, damage) {
    const h = this.grid.healthAt(x, y) - damage, owner = this.grid.ownerAt(x, y);
    if (h > 0) { this.grid.setHealth(x, y, h); this._events.push(new WallDamaged(this.tick, new Cell(x, y), h, owner)); return; }
    this.grid.setRubble(x, y);
    this._events.push(new WallBroken(this.tick, new Cell(x, y)));
  }

  _damageCannon(k, damage) {
    if (k === null) return;
    k.health -= damage;
    if (k.health > 0) { this._events.push(new CannonDamaged(this.tick, k.id, k.health)); return; }
    k.alive = false;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.grid.setRubble(k.topLeft.x + dx, k.topLeft.y + dy);
    this._events.push(new CannonDestroyed(this.tick, k.id));
  }

  _shoreWater(x, y) {
    if (this.grid.terrainAt(x, y) !== Terrain.Water) return false;
    return this._landEmpty(x + 1, y) || this._landEmpty(x - 1, y) || this._landEmpty(x, y + 1) || this._landEmpty(x, y - 1);
  }

  _landEmpty(x, y) {
    const g = this.grid;
    return g.in(x, y) && g.terrainAt(x, y) === Terrain.Land && g.occupantAt(x, y) === Occupant.Empty && !this.gruntAt(x, y);
  }

  _actShip(s) {
    const g = this.grid;
    if (s.kind === ShipKind.Boss) { this._actBoss(s); return; }
    const water = (x, y) => g.terrainAt(x, y) === Terrain.Water;
    if (s.kind === ShipKind.TwoSail && !s.landed) {
      if (this._shoreWater(s.at.x, s.at.y)) {
        for (let k = 0; k < this.rules.gruntsPerLanding; k++) this._landGrunt(s.at, s.id);
        s.landed = true;
        return;
      }
      if (--s.moveLeft > 0) return;
      s.moveLeft = this.rules.shipTicksPerCell;
      const rs = PathRules.nextStep(g, s.at, water, (x, y) => this._shoreWater(x, y));
      if (rs.result === PathResult.Stepped) { const from = s.at; s.at = rs.next; this._events.push(new ShipMoved(this.tick, s.id, from, rs.next)); }
      else if (rs.result === PathResult.NoPath) s.landed = true;   // no shore it can reach: it fights as a gunship
      return;
    }
    if (!s.hasTarget || !isTarget(g.occupantAt(s.target.x, s.target.y))) {
      s.hasTarget = false; let bestD = INT_MAX;
      for (let y = 0; y < g.height; y++)
        for (let x = 0; x < g.width; x++) {
          if (!isTarget(g.occupantAt(x, y))) continue;
          const d = Math.abs(x - s.at.x) + Math.abs(y - s.at.y);
          if (d < bestD) { bestD = d; s.target = new Cell(x, y); s.hasTarget = true; }
        }
      if (!s.hasTarget) return;
    }
    if (PathRules.manhattan(s.at, s.target) <= this.rules.shipRange) {
      if (s.reloadLeft > 0) { s.reloadLeft--; return; }
      s.reloadLeft = this.rules.shipReloadTicks;
      const ticks = this.rules.shotBaseTicks + this.rules.shotTicksPerCell * PathRules.manhattan(s.at, s.target);
      const shot = new ShotModel(this._nextShot++, -1, s.id, s.at, s.target, ticks, this.rules.shipShotDamage, this.tick);
      this._shots.push(shot);
      this._events.push(new ShotFired(this.tick, shot.id, -1, s.id, 0, s.at, s.target, ticks));
      return;
    }
    if (--s.moveLeft > 0) return;
    s.moveLeft = this.rules.shipTicksPerCell;
    const target = s.target, range = this.rules.shipRange;
    const r = PathRules.nextStep(g, s.at, water,
      (x, y) => g.terrainAt(x, y) === Terrain.Water && Math.abs(x - target.x) + Math.abs(y - target.y) <= range);
    if (r.result === PathResult.Stepped) { const from = s.at; s.at = r.next; this._events.push(new ShipMoved(this.tick, s.id, from, r.next)); }
  }

  /** UC-B1 steps 2-3: the boss picks the nearest wall or cannon (from its top-left square, as a ship from its square), sails
   *  where all of its squares are water until that is within bossRange, then fires a volley of bossVolley shots every
   *  bossReloadTicks: at the target and at the squares beside it across the line of fire, those on the board. */
  _actBoss(s) {
    const g = this.grid, R = this.rules;
    if (!s.hasTarget || !isTarget(g.occupantAt(s.target.x, s.target.y))) {
      s.hasTarget = false; let bestD = INT_MAX;
      for (let y = 0; y < g.height; y++)
        for (let x = 0; x < g.width; x++) {
          if (!isTarget(g.occupantAt(x, y))) continue;
          const d = Math.abs(x - s.at.x) + Math.abs(y - s.at.y);
          if (d < bestD) { bestD = d; s.target = new Cell(x, y); s.hasTarget = true; }
        }
      if (!s.hasTarget) return;
    }
    if (PathRules.manhattan(s.at, s.target) > R.bossRange) {
      // UC-B1 2a: while its target is out of range, the nearest wall or cannon that IS in range becomes the target (a boss with no
      // path kept its first target and never fired at a wall built beside it: the spec check's F2, 11-11)
      let near = null, nd = R.bossRange + 1;
      for (let y = Math.max(0, s.at.y - R.bossRange); y <= Math.min(g.height - 1, s.at.y + R.bossRange); y++)
        for (let x = Math.max(0, s.at.x - R.bossRange); x <= Math.min(g.width - 1, s.at.x + R.bossRange); x++) {
          if (!isTarget(g.occupantAt(x, y))) continue;
          const d = Math.abs(x - s.at.x) + Math.abs(y - s.at.y);
          if (d < nd) { nd = d; near = new Cell(x, y); }
        }
      if (near !== null) s.target = near;
    }
    if (PathRules.manhattan(s.at, s.target) <= R.bossRange) {
      if (s.reloadLeft > 0) { s.reloadLeft--; return; }
      // F1 (the spec check, 11-11): a volley EVERY bossReloadTicks - counting down from bossReloadTicks then firing on the next tick
      // made it every bossReloadTicks + 1
      s.reloadLeft = R.bossReloadTicks - 1;
      const t = s.target, across = Math.abs(t.x - s.at.x) >= Math.abs(t.y - s.at.y) ? [0, 1] : [1, 0];
      const half = Math.trunc(R.bossVolley / 2);
      for (let k = -half; k < R.bossVolley - half; k++) {
        const aim = new Cell(t.x + across[0] * k, t.y + across[1] * k);
        if (!g.in(aim.x, aim.y)) continue;
        const ticks = R.shotBaseTicks + R.shotTicksPerCell * PathRules.manhattan(s.at, aim);
        const shot = new ShotModel(this._nextShot++, -1, s.id, s.at, aim, ticks, R.shipShotDamage, this.tick);
        this._shots.push(shot);
        this._events.push(new ShotFired(this.tick, shot.id, -1, s.id, 0, s.at, aim, ticks));
      }
      return;
    }
    if (--s.moveLeft > 0) return;
    s.moveLeft = R.bossTicksPerCell;
    const n = s.size, target = s.target;
    const r = PathRules.nextStep(g, s.at, (x, y) => this._shipFits(x, y, n, s),
      (x, y) => this._shipFits(x, y, n, s) && Math.abs(x - target.x) + Math.abs(y - target.y) <= R.bossRange);
    if (r.result === PathResult.Stepped) { const from = s.at; s.at = r.next; this._events.push(new ShipMoved(this.tick, s.id, from, r.next)); }
  }

  _actGrunt(gr) {
    const g = this.grid;
    if (this._bw !== null && this._bw.gruntPre(gr)) return;       // bombs: cooldown ticks; a grunt that just dropped one runs
    for (let k = 0; k < 4; k++) {
      const x = gr.at.x + DX4[k], y = gr.at.y + DY4[k];
      if (!g.in(x, y) || !isGruntTarget(g.occupantAt(x, y))) continue;
      if (this._bw !== null) { this._bw.gruntAtTarget(gr); return; }   // bombs: it drops a bomb (or waits) instead of biting
      if (--gr.biteLeft > 0) return;
      gr.biteLeft = this.rules.gruntBiteTicks;
      const o = g.occupantAt(x, y);
      if (o === Occupant.Wall) this._damageWall(x, y, 1); else if (o === Occupant.Cannon) this._damageCannon(this.cannonAt(x, y), 1); else this._biteCastle(x, y);
      return;
    }
    if (--gr.moveLeft > 0) return;
    gr.moveLeft = this.rules.gruntTicksPerCell;
    const me = gr;
    const r = PathRules.nextStep(g, gr.at,
      (x, y) => g.terrainAt(x, y) === Terrain.Land && (g.occupantAt(x, y) === Occupant.Empty || g.occupantAt(x, y) === Occupant.Rubble) && !this._otherGruntAt(x, y, me)
        && (this._bw === null || !this._bw.gruntBombReaches(x, y)),     // bombs: a grunt does not walk into its own kind's lit bomb
      (x, y) => this._nextToTarget(x, y));
    if (r.result === PathResult.Stepped) { const from = gr.at; gr.at = r.next; this._events.push(new GruntMoved(this.tick, gr.id, from, r.next)); }
  }

  _otherGruntAt(x, y, me) {
    for (const o of this._grunts) if (o !== me && o.alive && o.at.x === x && o.at.y === y) return true;
    return false;
  }

  _nextToTarget(x, y) {
    const g = this.grid;
    return (g.in(x + 1, y) && isGruntTarget(g.occupantAt(x + 1, y))) || (g.in(x - 1, y) && isGruntTarget(g.occupantAt(x - 1, y)))
      || (g.in(x, y + 1) && isGruntTarget(g.occupantAt(x, y + 1))) || (g.in(x, y - 1) && isGruntTarget(g.occupantAt(x, y - 1)));
  }

  // ---- tests (C# internal) ------------------------------------------------------------------------------------------------

  /** Tests: put a grunt on land at `at` (the same grunt a landing makes). */
  putGrunt(at) {
    const gr = new GruntModel(this._nextGrunt++, at, this.rules.gruntTicksPerCell, this.rules.gruntBiteTicks);
    this._grunts.push(gr);
    return gr;
  }

  /** Tests (bombs only): a lit bomb on the ground at `at`, owner a slot or -1. */
  putBomb(owner, at, fuse = undefined, big = false) { return this._bw.put(owner, at, fuse, big); }

  /** Tests: enter a phase now. */
  forcePhase(p, ticks) { this._enter(p, ticks); }

  /** Tests: a player's ball lands at `target` now (the same code a real shot runs when it lands). */
  landPlayerBall(slot, target, damage = 1) {
    const sh = new ShotModel(this._nextShot++, slot, 0, target, target, 1, damage, this.tick - 1);
    this._shots.push(sh);
    const before = this._events.length;
    this._landShots();
    for (let i = before; i < this._events.length; i++) { const l = this._events[i]; if (l instanceof ShotLanded && l.shotId === sh.id) return l.hit; }
    return false;
  }

  // ---- the sync check -----------------------------------------------------------------------------------------------------

  /** One number for the whole state, a BigInt equal to the C# model's ulong for the same history. */
  stateHash() { return this._stateFnv().toBigInt(); }

  /** The same, as 16 lower-case hex digits (C# ToString("x16")). */
  stateHashHex() { return this._stateFnv().toHex(); }

  _stateFnv() {
    const f = this.grid.hashInto(Fnv64.fromBigInt(GridModel.HashStart));
    for (const v of [this.tick, this.phase, this.round, this.phaseTicksLeft, this.lives, this.teamScore, this._nextCannon, this._nextShip, this._nextGrunt, this._nextShot, this._battles])
      f.mix(v);
    for (const p of this._players)
      for (const v of [p.connected ? 1 : 0, p.ready ? 1 : 0, p.claimedCastle, p.cannonsFresh, p.cannonsCarried, p.score, p.sword ? 1 : 0, p.swordLeft])
        f.mix(v);
    for (const d of this._dealers) d.hashInto(f);
    for (const k of this._cannons)
      for (const v of [k.id, k.owner, k.topLeft.x, k.topLeft.y, k.health, k.reloadLeft, k.alive ? 1 : 0])
        f.mix(v);
    for (const s of this._ships)
      for (const v of [s.id, s.kind, s.landed ? 1 : 0, s.at.x, s.at.y, s.health, s.moveLeft, s.reloadLeft, s.hasTarget ? 1 : 0, s.target.x, s.target.y])
        f.mix(v);
    for (const g of this._grunts)
      for (const v of [g.id, g.at.x, g.at.y, g.moveLeft, g.biteLeft])
        f.mix(v);
    for (const sh of this._shots)
      for (const v of [sh.id, sh.fromSlot, sh.fromShip, sh.target.x, sh.target.y, sh.ticksLeft, sh.damage, sh.cannonId, 0 /* incendiary: never in the normal game */])
        f.mix(v);
    for (const v of [this._grace ? 1 : 0, this._holdNoSpawn ? 1 : 0, this._continuesUsed]) f.mix(v);
    for (const u of this._graceUsed) f.mixBool(u);
    this.options.hashInto(f);
    const name = this.mapName ?? '';
    for (let i = 0; i < name.length; i++) f.mix(name.charCodeAt(i));
    for (const s of this._ships)                    // size, allied 0, dark 0, max health; a normal ship has no parts
      for (const v of [s.size, 0, 0, s.maxHealth]) f.mix(v);
    for (const k of this._cannons) { f.mix(k.kind); f.mix(k.inFlight); }
    // the C# SuperHash: no extra creatures, emplacements or bonus squares in a normal match; then castle health, houses surrounded,
    // and the bigger ruleset's three counters, which a normal match leaves at their start values (1, 1, 0)
    for (const v of this._castleHealth) f.mix(v);
    for (const v of [this._housesSurrounded, 1, 1, 0]) f.mix(v);
    if (this._bw !== null) this._bw.hashInto(f);      // only with bombs on: the base hash is bit-identical to the C# model's
    return f;
  }
}
