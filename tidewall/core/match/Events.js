// port of model/Match/Events.cs
//
// What happened, in order (past tense). The model resolves a whole tick instantly and appends these; a host replays them and
// draws. Every event carries the tick it happened on. Field names are the C# names in lowerCamelCase. The C# base class is
// renamed MatchEvent here. Only the events a normal match emits are ported; the bigger ruleset's (its extra ships and
// creatures, emplacements and bonus squares) are not.

export const RejectReason = Object.freeze({
  WrongPhase: 0, NoCannons: 1, NotEnclosed: 2, Blocked: 3, NoLoadedCannon: 4, NotACastle: 5, Disconnected: 6,
  BadSlot: 7, AlreadyConnected: 8,
  // 9..11 are the bigger ruleset's reasons and are not ported
  SwordOut: 12, NoSword: 13, SwordSwinging: 14,          // the hero's modes (REQ-HERO-02/03)
});

/** Why the board changed under a thing. Only the two causes a normal match can produce are ported. */
export const ThingCause = Object.freeze({ Shot: 0, Enclosed: 1 });

export class MatchEvent {
  constructor(tick) { this.tick = tick; }
}

export class PhaseChanged extends MatchEvent {
  constructor(t, phase, round, ticks) { super(t); this.phase = phase; this.round = round; this.ticks = ticks; }
}

export class CastleClaimed extends MatchEvent {
  constructor(t, slot, castleId, auto) { super(t); this.slot = slot; this.castleId = castleId; this.auto = auto; }
}

/** Walls the game built for free (the CLAIM ring, the ring rebuilt after a lost life). */
export class RingBuilt extends MatchEvent {
  constructor(t, slot, castleId, cells) { super(t); this.slot = slot; this.castleId = castleId; this.cells = cells; }
}

export class WallsPlaced extends MatchEvent {
  constructor(t, slot, seq, shapeId, quarterTurns, cells, nextShapeId) {
    super(t); this.slot = slot; this.seq = seq; this.shapeId = shapeId; this.quarterTurns = quarterTurns; this.cells = cells; this.nextShapeId = nextShapeId;
  }
}

export class PlacementRejected extends MatchEvent {
  constructor(t, slot, seq, reason) { super(t); this.slot = slot; this.seq = seq; this.reason = reason; }
}

/** A command other than a wall placement was refused, and why. Nothing changed. */
export class CommandRejected extends MatchEvent {
  constructor(t, kind, slot, seq, reason) { super(t); this.kind = kind; this.slot = slot; this.seq = seq; this.reason = reason; }
}

export class CannonsGranted extends MatchEvent {
  constructor(t, perSlot, total) { super(t); this.perSlot = perSlot; this.total = total; }
}

export class CannonPlaced extends MatchEvent {
  constructor(t, id, slot, seq, topLeft) { super(t); this.cannonId = id; this.slot = slot; this.seq = seq; this.topLeft = topLeft; }
}

export class PlayerReady extends MatchEvent {
  constructor(t, slot) { super(t); this.slot = slot; }
}

export class ShipSpawned extends MatchEvent {
  constructor(t, id, at, health, kind) { super(t); this.shipId = id; this.at = at; this.health = health; this.kind = kind; }
}

export class ShipMoved extends MatchEvent {
  constructor(t, id, from, to) { super(t); this.shipId = id; this.from = from; this.to = to; }
}

export class ShotFired extends MatchEvent {
  constructor(t, shotId, fromSlot, fromShip, cannonId, origin, target, ticks) {
    super(t); this.shotId = shotId; this.fromSlot = fromSlot; this.fromShip = fromShip; this.cannonId = cannonId;
    this.origin = origin; this.target = target; this.ticks = ticks;
  }
}

export class ShotLanded extends MatchEvent {
  constructor(t, shotId, target, hit) { super(t); this.shotId = shotId; this.target = target; this.hit = hit; }
}

export class WallDamaged extends MatchEvent {
  constructor(t, at, health, owner) { super(t); this.at = at; this.health = health; this.owner = owner; }
}

/** A wall cell at zero health became rubble - open ground to rebuild on (REQ-SCORE-06). */
export class WallBroken extends MatchEvent {
  constructor(t, at) { super(t); this.at = at; }
}

export class CannonDamaged extends MatchEvent {
  constructor(t, id, health) { super(t); this.cannonId = id; this.health = health; }
}

export class CannonDestroyed extends MatchEvent {
  constructor(t, id) { super(t); this.cannonId = id; }
}

export class ShipDamaged extends MatchEvent {
  constructor(t, id, health) { super(t); this.shipId = id; this.health = health; }
}

export class ShipSunk extends MatchEvent {
  constructor(t, id, bySlot, at) { super(t); this.shipId = id; this.bySlot = bySlot; this.at = at; }
}

export class GruntLanded extends MatchEvent {
  constructor(t, id, fromShip, at) { super(t); this.gruntId = id; this.fromShip = fromShip; this.at = at; }
}

/** REQ-REF-03: a cannon on land that is no longer enclosed at SCORE is lost with the territory. */
export class CannonLost extends MatchEvent {
  constructor(t, id) { super(t); this.cannonId = id; }
}

export class GruntMoved extends MatchEvent {
  constructor(t, id, from, to) { super(t); this.gruntId = id; this.from = from; this.to = to; }
}

export class GruntKilled extends MatchEvent {
  constructor(t, id, bySlot, at) { super(t); this.gruntId = id; this.bySlot = bySlot; this.at = at; }
}

export class RubbleCleared extends MatchEvent {
  constructor(t, cells) { super(t); this.cells = cells; }
}

/** A placement shut a castle in during REPAIR: the closing credit (REQ-SCORE-04). */
export class LoopClosed extends MatchEvent {
  constructor(t, slot, castleId) { super(t); this.slot = slot; this.castleId = castleId; }
}

export class RoundScored extends MatchEvent {
  constructor(t, round, castleIds, cells, points, lives) {
    super(t); this.round = round; this.castleIds = castleIds; this.enclosedCastles = castleIds.length; this.enclosedCells = cells;
    this.points = points; this.lives = lives;
  }
}

export class LifeLost extends MatchEvent {
  constructor(t, left) { super(t); this.livesLeft = left; }
}

export class PlayerLeft extends MatchEvent {
  constructor(t, slot) { super(t); this.slot = slot; }
}

export class PlayerRejoined extends MatchEvent {
  constructor(t, slot) { super(t); this.slot = slot; }
}

export class GameEnded extends MatchEvent {
  constructor(t, won, round, score) { super(t); this.won = won; this.round = round; this.teamScore = score; }
}

/** A new map: castles are chosen again. Views rebuild the board. */
export class LevelStarted extends MatchEvent {
  constructor(t, level, round, map, challenge) { super(t); this.level = level; this.round = round; this.map = map; this.challenge = challenge; }
}

/** A thing on the board changed. what = what is there NOW (Empty when it went away). */
export class ThingChanged extends MatchEvent {
  constructor(t, at, what, ground, cause, bySlot) { super(t); this.at = at; this.what = what; this.ground = ground; this.cause = cause; this.bySlot = bySlot; }
}

export class CastleRuined extends MatchEvent {
  constructor(t, id) { super(t); this.castleId = id; }
}

export class CastleRestored extends MatchEvent {
  constructor(t, id) { super(t); this.castleId = id; }
}

export class CastleBitten extends MatchEvent {
  constructor(t, id, health) { super(t); this.castleId = id; this.health = health; }
}

/** Enemy grunts appeared from a house a wall was built on. */
export class HouseRose extends MatchEvent {
  constructor(t, house, gruntId, gruntAt) { super(t); this.house = house; this.gruntId = gruntId; this.gruntAt = gruntAt; }
}

export class HouseSurrounded extends MatchEvent {
  constructor(t, at, points) { super(t); this.at = at; this.points = points; }
}

export class GruntSurrounded extends MatchEvent {
  constructor(t, id, at) { super(t); this.gruntId = id; this.at = at; }
}

/** Freestanding and jutting wall squares trimmed after REPAIR. */
export class WallsTrimmed extends MatchEvent {
  constructor(t, cells) { super(t); this.cells = cells; }
}

/** REPAIR's time is up: each player may still place ONE piece. */
export class LastPieceGrace extends MatchEvent {
  constructor(t, ticks) { super(t); this.ticks = ticks; }
}

/** The fate screen: Fight Again or Give Up, continues left. */
export class FateAsked extends MatchEvent {
  constructor(t, left) { super(t); this.continuesLeft = left; }
}

export class FateChosen extends MatchEvent {
  constructor(t, again, slot, firepower) { super(t); this.fightAgain = again; this.slot = slot; this.firepower = firepower; }
}

/** The bonus points paid at the end of the game. */
export class FinalBonus extends MatchEvent {
  constructor(t, continues, difficulty, completion, total) {
    super(t); this.continues = continues; this.difficultyPoints = difficulty; this.completion = completion; this.total = total;
  }
}

/** A player ended REPAIR with no castle inside their own walls ("you lose the round"). */
export class PlayerFell extends MatchEvent {
  constructor(t, slot) { super(t); this.slot = slot; }
}

/** A hero drew the sword (sword true) or took the phase's tool back (REQ-HERO-02). */
export class ModeSwitched extends MatchEvent {
  constructor(t, slot, sword) { super(t); this.slot = slot; this.sword = sword; }
}

/** A hero swung the sword at a square; kills grunts died (REQ-HERO-03). */
export class SwordSwung extends MatchEvent {
  constructor(t, slot, at, kills) { super(t); this.slot = slot; this.at = at; this.kills = kills; }
}
