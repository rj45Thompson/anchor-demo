// port of model/Match/Entities.cs
import { Cell } from '../cell.js';

/** The round's phases. Decide = the fate screen after a lost round: Fight Again or Give Up. Raid (8, appended) is the bomb rule set's
 *  own beat (BOMBER_UC.md): after a BATTLE that left raiders ashore, Bomberman on land, then REPAIR. Never entered with bombs off. */
export const Phase = Object.freeze({ Claim: 0, Cannons: 1, Battle: 2, Repair: 3, Score: 4, GameOver: 5, Victory: 6, Decide: 7, Raid: 8 });

/** A RAID power-up's kind (BOMBER_UC.md steps 10-11). Appended only. Fire: the hero's arms +1. Bomb: one more of its bombs lit at
 *  once. Speed: one tick less per square. */
export const PowerKind = Object.freeze({ Fire: 0, Bomb: 1, Speed: 2 });

/** A gun's kind: the 2x2 cannon (0), or the full rules' 3x3 Mortar (1), which costs rules.mortarCost of the allotment, has twice
 *  a cannon's health and fires incendiary balls that do rules.mortarDamage and light pits. */
export const GunKind = Object.freeze({ Cannon: 0, Mortar: 1 });

/** One-sail ships shoot walls; two-sail ships take three hits, head for the shore and land grunts. The full rules add the Fireship
 *  (2: its balls leave burning pits), the Gunboat (3: a 2x2 gun platform, every square a gun) and the Dreadnought (4: the 3x3 last
 *  boss, porthole guns and four hidden weak spots). Appended only. Boss (5) is this game's own (BOSS_UC.md UC-B1), the bomb rule set
 *  only: one 2 x 2 ship in each island's last wave (it was 2 before the full rules were ported; every reader names it, none its number). */
export const ShipKind = Object.freeze({ OneSail: 0, TwoSail: 1, Fireship: 2, Gunboat: 3, Dreadnought: 4, Boss: 5 });

/** What a big ship's square is: plain hull (takes nothing), a gun, or a hidden weak spot (the dreadnought's). */
export const PartRole = Object.freeze({ Hull: 0, Gun: 1, WeakSpot: 2 });

/** One player's state. Slots are 0..3; the colour is the view's, by slot. */
export class PlayerModel {
  constructor(slot) {
    this.slot = slot;
    this.connected = true;
    this.ready = false;
    this.claimedCastle = 0;      // 0 = none yet
    this.cannonsFresh = 0;       // granted this round
    this.cannonsCarried = 0;     // left over from last round's CANNONS: spent first, lost at the end of this one (REQ-CANNON-02)
    this.score = 0;
    /** The hero's sword is out (REQ-HERO-02): in REPAIR and BATTLE a player holds EITHER the phase's tool OR the sword. */
    this.sword = false;
    this.swordLeft = 0;          // ticks until the sword can swing again
    // ---- the bomb rule set (GameOptions.bombs; see match/Bombs.js, BOMBS_SPEC.md, BOMBER_UC.md). Untouched, and not hashed, when off.
    this.bombs = 0;              // how many more of its own bombs the hero may light now (bombCap less those lit): what a view shows
    this.bombCap = 0;            // its own bombs lit at once (rules.bombCap, +1 per BOMB power-up or bombPack, to rules.bombMax)
    this.fire = 0;               // its blast's arm length (rules.bombArm, +1 per FIRE power-up, to rules.fireMax)
    this.ticksPerCell = 0;       // its walk: ticks a square (rules.heroTicksPerCell, -1 per SPEED power-up, to rules.heroTicksMin)
    this.items = { metal: 0, trap: 0, bombPack: 0, bigBomb: 0 };   // bought, in stock (bombPack counts packs bought: it applies at once)
    this.stunLeft = 0;           // ticks the hero is stunned
    this.carrying = 0;           // id of the bomb in the hero's hands, 0 = none
    // the hero on foot in the RAID, walked by the core square by square (BOMBER_UC.md steps 2-6): heroAt its square (null = not on
    // the board: outside the RAID, or no home castle), heroTo the square it is stepping into (null = standing at a centre) with
    // stepLeft of stepTicks ticks to go (stepTicks: its pace when the step began); wishX / wishY the way held (-1, 0, 1 each,
    // Command.walk), wishFirst the axis tried first (0 x, 1 y); faceX / faceY the way it faces (a throw goes that way)
    this.heroAt = null; this.heroTo = null; this.stepLeft = 0; this.stepTicks = 0;
    this.wishX = 0; this.wishY = 0; this.wishFirst = 0; this.faceX = 0; this.faceY = 1;
  }
  /** The square the hero stands on for every rule (a bomb dropped, a blast, a power-up): the nearer of the two it is between. */
  get heroCell() {
    if (this.heroTo === null || this.heroAt === null) return this.heroAt;
    return 2 * this.stepLeft <= this.stepTicks ? this.heroTo : this.heroAt;
  }
  get cannonsToPlace() { return this.cannonsFresh + this.cannonsCarried; }
}

/** A 2x2 cannon (REQ-CANNON-01), or a 3x3 Mortar (the full rules). Id order is placement order: the tie-break of REQ-FIRE-05.
 *  inFlight: one ball in the air. */
export class CannonModel {
  constructor(id, owner, topLeft, health, kind = GunKind.Cannon) {
    if (kind !== GunKind.Cannon && kind !== GunKind.Mortar) throw new Error('gun kind ' + kind + ' is not a GunKind');
    this.id = id; this.owner = owner; this.topLeft = topLeft; this.kind = kind;
    this.health = health;
    this.reloadLeft = 0;
    this.inFlight = 0;
    this.alive = true;
  }
  get size() { return this.kind === GunKind.Mortar ? 3 : 2; }
  covers(x, y) { const n = this.size; return x >= this.topLeft.x && x < this.topLeft.x + n && y >= this.topLeft.y && y < this.topLeft.y + n; }
}

/** A Kite (the full rules): placed in CANNONS inside the player's walls on a 3x3, flown once over a ship to recruit it. An unused one
 *  is lost at SCORE. */
export class KiteModel {
  static Size = 3;
  constructor(id, owner, topLeft) { this.id = id; this.owner = owner; this.topLeft = topLeft; this.used = false; }
}

/** A ship on water (REQ-SHIP-01..07). Whole-cell position plus an integer step counter: no float anywhere. A one-sail, two-sail
 *  or fireship is one square (size 1); a gunboat 2, a dreadnought 3 and a boss (UC-B1) rules.bossSize squares a side, from `at`, its
 *  top-left. A big ship of the full rules has `parts` (one health per footprint square, row-major; 0 = destroyed) and `roles` (a
 *  PartRole each); every other ship has null for both. `ironclad`: the full rules' darker ship, rules.ironcladExtraHealth tougher;
 *  `allied`: recruited by a kite, it fights for the players and stays where it is. */
export class ShipModel {
  constructor(id, at, health, moveTicks, reload) {
    this.id = id;
    this.kind = ShipKind.OneSail;
    this.landed = false;         // a two-sail ship that has put its grunts ashore
    this.at = at;                // its square
    this.health = health;
    this.maxHealth = health;
    this.moveLeft = moveTicks;   // ticks until the next cell step
    this.reloadLeft = reload;
    this.hasTarget = false;
    this.target = Cell.zero;
    this.alive = true;
    this.big = 1;                // the footprint, squares a side (the C# Size)
    this.ironclad = false;
    this.allied = false;
    this.parts = null;
    this.roles = null;
  }
  get size() { return this.big; }
  covers(x, y) { return x >= this.at.x && y >= this.at.y && x < this.at.x + this.big && y < this.at.y + this.big; }
  /** The footprint's middle square (the top-left for a one-square ship). */
  get centre() { return new Cell(this.at.x + Math.trunc(this.big / 2), this.at.y + Math.trunc(this.big / 2)); }
}

/** The Serpent (the full rules): it rises from the deep within reach of the walls, throws boulders that break walls and leave small
 *  rocks, and can be hit only while its head is out of the water (`up`). */
export class SerpentModel {
  constructor(id, at, health, phaseTicks) {
    this.id = id; this.at = at; this.up = false; this.health = health;
    this.phaseLeft = phaseTicks;     // ticks until it dives or rises
    this.throwLeft = 0;
    this.alive = true;
  }
}

/** A grunt on land (REQ-GRUNT-01..04). */
export class GruntModel {
  constructor(id, at, moveTicks, bite) {
    this.id = id; this.at = at; this.moveLeft = moveTicks; this.biteLeft = bite; this.alive = true;
    // the bomb rule set: ticks until it may drop another bomb, ticks it still flees, and the square it flees from
    this.bombLeft = 0; this.fleeLeft = 0; this.fleeFrom = at;
  }
}

/** A shot in flight: an event with a landing tick, never a physics body (REQ-FIRE-02). fromSlot is the firing player, -1 for an
 *  enemy ship's shot, FromAlly (-2) for a recruited ship's, FromSerpent (-3) for the serpent's boulder. */
export class ShotModel {
  static FromAlly = -2;
  static FromSerpent = -3;
  constructor(id, fromSlot, fromShip, origin, target, ticks, damage, firedTick) {
    this.id = id; this.fromSlot = fromSlot; this.fromShip = fromShip; this.origin = origin; this.target = target;
    this.ticksLeft = ticks; this.damage = damage;
    this.firedTick = firedTick;   // a shot is not moved on the tick it was fired: it lands exactly `ticks` later
    this.cannonId = 0;            // the player's gun that fired it (its one ball in the air)
    this.incendiary = false;      // a fireship's, the dreadnought's or a mortar's ball: it leaves a burning pit
  }
}

/** A lit bomb (BOMBS_SPEC.md). owner = a player's slot, or -1 for a grunt's. carriedBy = the slot of the hero holding it, -1 = on
 *  the ground. While flightLeft > 0 it is in the air from flightFrom to flightTo (its fuse is frozen); landing keeps the fuse. */
export class BombModel {
  /** arm: how far each arm of its blast runs (the dropping hero's fire, a big bomb's bigBombArm, a raider's bombArm). */
  constructor(id, owner, at, fuseLeft, big, arm) {
    if (!Number.isInteger(arm) || arm < 1) throw new RangeError('a bomb arm is a whole number of squares (1 or more), got ' + arm);
    this.id = id; this.owner = owner; this.at = at; this.fuseLeft = fuseLeft; this.big = big; this.arm = arm;
    this.carriedBy = -1;
    this.flightLeft = 0; this.flightTicks = 0; this.flightFrom = at; this.flightTo = at;
    this.skipTick = -1;          // the tick a command dropped or threw it: that tick's world step does not age it (it lasts the full count)
    this.alive = true;
  }
}

/** A RAID power-up lying on a square (BOMBER_UC.md step 10): shown once revealLeft is 0 (it waits for the fire on its square). */
export class PowerUpModel {
  constructor(id, kind, at, revealLeft) { this.id = id; this.kind = kind; this.at = at; this.revealLeft = revealLeft; }
  get shown() { return this.revealLeft === 0; }
}

/** A blast's burning squares (BOMBER_UC.md step 9): `cells` burn for `left` more ticks; `owner` is the bomb's (a slot, or -1). */
export class FireModel {
  constructor(id, owner, cells, left) { this.id = id; this.owner = owner; this.cells = cells; this.left = left; }
}

/** A drawn spike trap on an empty land square: the first grunt to step on it dies and the trap is used up. */
export class TrapModel {
  constructor(id, owner, at) { this.id = id; this.owner = owner; this.at = at; }
}
