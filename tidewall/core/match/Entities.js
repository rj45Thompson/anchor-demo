// port of model/Match/Entities.cs
import { Cell } from '../cell.js';

/** The round's phases. Decide = the fate screen after a lost round: Fight Again or Give Up. */
export const Phase = Object.freeze({ Claim: 0, Cannons: 1, Battle: 2, Repair: 3, Score: 4, GameOver: 5, Victory: 6, Decide: 7 });

/** A gun's kind. Only the 2x2 cannon (0) is in the normal game; 1 is the bigger ruleset's and is not ported. */
export const GunKind = Object.freeze({ Cannon: 0 });

/** One-sail ships shoot walls; two-sail ships take three hits, head for the shore and land grunts. Values 2..4 are the bigger
 *  ruleset's ships and are not ported: no normal wave sails one. */
export const ShipKind = Object.freeze({ OneSail: 0, TwoSail: 1 });

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
  }
  get cannonsToPlace() { return this.cannonsFresh + this.cannonsCarried; }
}

/** A 2x2 cannon (REQ-CANNON-01). Id order is placement order: the tie-break of REQ-FIRE-05. inFlight: one ball in the air. */
export class CannonModel {
  constructor(id, owner, topLeft, health) {
    this.id = id; this.owner = owner; this.topLeft = topLeft; this.kind = GunKind.Cannon;
    this.health = health;
    this.reloadLeft = 0;
    this.inFlight = 0;
    this.alive = true;
  }
  get size() { return 2; }
  covers(x, y) { return x >= this.topLeft.x && x < this.topLeft.x + 2 && y >= this.topLeft.y && y < this.topLeft.y + 2; }
}

/** A ship on water (REQ-SHIP-01..07). Whole-cell position plus an integer step counter: no float anywhere. Every normal ship is
 *  one square (size 1). */
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
  }
  get size() { return 1; }
  covers(x, y) { return x === this.at.x && y === this.at.y; }
  get centre() { return this.at; }
}

/** A grunt on land (REQ-GRUNT-01..04). */
export class GruntModel {
  constructor(id, at, moveTicks, bite) {
    this.id = id; this.at = at; this.moveLeft = moveTicks; this.biteLeft = bite; this.alive = true;
  }
}

/** A shot in flight: an event with a landing tick, never a physics body (REQ-FIRE-02). fromSlot is the firing player, or -1
 *  for a ship's shot. */
export class ShotModel {
  constructor(id, fromSlot, fromShip, origin, target, ticks, damage, firedTick) {
    this.id = id; this.fromSlot = fromSlot; this.fromShip = fromShip; this.origin = origin; this.target = target;
    this.ticksLeft = ticks; this.damage = damage;
    this.firedTick = firedTick;   // a shot is not moved on the tick it was fired: it lands exactly `ticks` later
    this.cannonId = 0;            // the player's gun that fired it (its one ball in the air)
  }
}
