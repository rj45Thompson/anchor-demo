// port of model/Match/Events.cs
//
// What happened, in order (past tense). The model resolves a whole tick instantly and appends these; a host replays them and
// draws. Every event carries the tick it happened on. Field names are the C# names in lowerCamelCase. The C# base class is
// renamed MatchEvent here. The full rules' events carry this game's own names (test/parity/NAMES.md maps them to the C#).

export const RejectReason = Object.freeze({
  WrongPhase: 0, NoCannons: 1, NotEnclosed: 2, Blocked: 3, NoLoadedCannon: 4, NotACastle: 5, Disconnected: 6,
  BadSlot: 7, AlreadyConnected: 8,
  NotFull: 9,         // a full-rules command (mortar, kite, recruit) in a normal match
  NoKite: 10,         // recruit: the player has no unflown kite
  NotRecruitable: 11, // recruit: no enemy ship there, or a big one (gunboat, dreadnought, boss) that will not turn
  SwordOut: 12, NoSword: 13, SwordSwinging: 14,          // the hero's modes (REQ-HERO-02/03)
  // the bomb rule set (BOMBS_SPEC.md), appended: the numbers above never move
  NoBombs: 15,        // dropBomb: none left in hand
  BombHere: 16,       // dropBomb: a bomb already lies on that square
  NoBombNear: 17,     // pickUpBomb / defuseBomb: no bomb within one square that the hero may take
  HandsFull: 18,      // pickUpBomb: the hero already carries one
  HandsEmpty: 19,     // throwBomb: the hero carries nothing
  TooFar: 20,         // throwBomb: the target is more than throwRange squares away
  Stunned: 21,        // any bomb verb while the hero is stunned
  CannotAfford: 22,   // buy: not enough score
  ToolOut: 23,        // dropBomb: the phase's own tool (build / cannon) is out, not the bomb tool
  BadItem: 24,        // buy: not an ItemKind
  NoItem: 25,         // placeTrap: no trap in stock
  NoBombRules: 26,    // a bomb command in a match played without GameOptions.bombs
});

/** Why the board changed under a thing: a player's ball, enclosing at SCORE, a tree spreading, a house appearing, a pit burning out,
 *  the serpent's boulder, a pit lit, built over. */
export const ThingCause = Object.freeze({ Shot: 0, Enclosed: 1, Grew: 2, Appeared: 3, BurnedOut: 4, Boulder: 5, Pit: 6, BuiltOver: 7 });

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

/** The level's treasure squares (the full rules): enclosing one pays rules.pointsTreasure plus rules.pointsTreasurePerCannon for every
 *  live cannon in the same enclosure. */
export class TreasureSquares extends MatchEvent {
  constructor(t, cells) { super(t); this.cells = cells; }
}

export class TreasureTaken extends MatchEvent {
  constructor(t, at, points) { super(t); this.at = at; this.points = points; }
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

/** A 3x3 Mortar went up (its squares are Occupant.Cannon; m.cannons holds it with kind GunKind.Mortar). */
export class MortarPlaced extends MatchEvent {
  constructor(t, id, slot, seq, topLeft) { super(t); this.cannonId = id; this.slot = slot; this.seq = seq; this.topLeft = topLeft; }
}

export class KitePlaced extends MatchEvent {
  constructor(t, id, slot, seq, topLeft) { super(t); this.kiteId = id; this.slot = slot; this.seq = seq; this.topLeft = topLeft; }
}

/** A kite flew from `from` (its top-left) to the ship: the ship fights for the players now. */
export class ShipRecruited extends MatchEvent {
  constructor(t, ship, kite, slot, from) { super(t); this.shipId = ship; this.kiteId = kite; this.slot = slot; this.from = from; }
}

/** A part of a gunboat or the dreadnought was hit: a gun silenced, a weak spot struck (health 0) or only scratched. */
export class ShipPartHit extends MatchEvent {
  constructor(t, ship, part, role, health) { super(t); this.shipId = ship; this.part = part; this.role = role; this.health = health; }
}

export class SerpentRose extends MatchEvent {
  constructor(t, id, at, health) { super(t); this.serpentId = id; this.at = at; this.health = health; }
}

/** The serpent went under (or, at health 0, is gone for good). */
export class SerpentDove extends MatchEvent {
  constructor(t, id) { super(t); this.serpentId = id; }
}

export class SerpentHit extends MatchEvent {
  constructor(t, id, health, bySlot) { super(t); this.serpentId = id; this.health = health; this.bySlot = bySlot; }
}

/** The serpent threw a boulder (a shot from ShotModel.FromSerpent): it lands in `ticks` on `target` and its four neighbours. */
export class BoulderThrown extends MatchEvent {
  constructor(t, id, from, target, ticks) { super(t); this.serpentId = id; this.from = from; this.target = target; this.ticks = ticks; }
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

// ---- the bomb rule set (BOMBS_SPEC.md); every event below is appended and exists only in a match with GameOptions.bombs ----------

/** A bomb was put down: by a hero (owner = slot) or a grunt (owner -1). */
export class BombDropped extends MatchEvent {
  constructor(t, id, owner, at, fuseLeft, big) { super(t); this.id = id; this.owner = owner; this.at = at; this.fuseLeft = fuseLeft; this.big = big; }
}
export class BombPickedUp extends MatchEvent {
  constructor(t, id, slot) { super(t); this.id = id; this.slot = slot; }
}
export class BombThrown extends MatchEvent {
  constructor(t, id, slot, from, to, ticks) { super(t); this.id = id; this.slot = slot; this.from = from; this.to = to; this.ticks = ticks; }
}
export class BombLanded extends MatchEvent {
  constructor(t, id, at) { super(t); this.id = id; this.at = at; }
}
/** A thrown bomb came down in the sea: gone. */
export class BombSank extends MatchEvent {
  constructor(t, id, at) { super(t); this.id = id; this.at = at; }
}
export class BombDefused extends MatchEvent {
  constructor(t, id, slot) { super(t); this.id = id; this.slot = slot; }
}
/** `at` = the bomb's square; `arms` = every other square the blast reached (east, west, south, north arms in that order, near to
 *  far). The blast is drawn for rules.blastTicks; its damage is all done on this tick. */
export class BombExploded extends MatchEvent {
  constructor(t, id, at, arms, owner, big) { super(t); this.id = id; this.at = at; this.arms = arms; this.owner = owner; this.big = big; }
}
export class PlayerStunned extends MatchEvent {
  constructor(t, slot, ticks) { super(t); this.slot = slot; this.ticks = ticks; }
}
/** A stunned hero let go of the bomb it carried; it lies on the hero's square and keeps its fuse. */
export class BombFumbled extends MatchEvent {
  constructor(t, id, slot, at) { super(t); this.id = id; this.slot = slot; this.at = at; }
}
export class ItemBought extends MatchEvent {
  constructor(t, slot, item) { super(t); this.slot = slot; this.item = item; }
}
/** The player's next piece was built of metal (every brick health rules.metalWallHealth). Follows that piece's WallsPlaced. */
export class MetalPlaced extends MatchEvent {
  constructor(t, slot, seq, cells) { super(t); this.slot = slot; this.seq = seq; this.cells = cells; }
}
export class TrapPlaced extends MatchEvent {
  constructor(t, id, slot, at) { super(t); this.id = id; this.slot = slot; this.at = at; }
}
export class TrapSprung extends MatchEvent {
  constructor(t, id, at, gruntId) { super(t); this.id = id; this.at = at; this.gruntId = gruntId; }
}
/** A wall or cannon was built on a trap: it is gone. */
export class TrapRemoved extends MatchEvent {
  constructor(t, id, at) { super(t); this.id = id; this.at = at; }
}
