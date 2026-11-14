// port of model/Match/Commands.cs
import { Cell } from '../cell.js';

/** The command kinds, with the private model's numbers. 7, 8 and 9 are the full rules' (GameType.Full): a Mortar, a Kite, and
 *  flying a kite over a ship to recruit it; a normal match refuses them (RejectReason.NotFull). */
export const CommandKind = Object.freeze({
  PlaceWall: 0, PlaceCannon: 1, Fire: 2, Ready: 3, Claim: 4, Leave: 5, Rejoin: 6,
  PlaceMortar: 7, PlaceKite: 8, Recruit: 9,    // the full rules' 3x3 emplacements and the kite's flight
  Decide: 10,                                  // the fate screen: Fight Again or Give Up
  SwitchMode: 11, Strike: 12,                  // the hero: tool <-> sword, and a sword swing
  // the bomb rule set (GameOptions.bombs, BOMBS_SPEC.md). Strike (12) is DropBomb there. Refused when bombs is off.
  PickUpBomb: 13, ThrowBomb: 14, DefuseBomb: 15, Buy: 16, PlaceTrap: 17,
  MoveHero: 18,                                // was: the controller reported where the hero stood; refused since the RAID (11-13)
  Walk: 19,                                    // the RAID (BOMBER_UC.md): the way the player holds; the core walks the hero
});

const KINDS = new Set(Object.values(CommandKind));

function whole(name, v) {
  if (!Number.isInteger(v)) throw new TypeError('Command.' + name + ' is a whole number, got ' + v);
  return v;
}

/** What a player asks for, never what happened. The host gives each one its arrival order within the tick; every machine then
 *  runs the same tick's commands in that order (REQ-NET-10). One shape for every kind so a tick's batch is one list.
 *    placeWall: shapeId, quarterTurns, at = anchor.  placeCannon: at = top-left cell.  fire: at = target cell.
 *    claim: at = any cell of the castle.  decide: quarterTurns 1 = Fight Again, 0 = Give Up.  strike: at = the hero's square.
 *    placeMortar / placeKite: at = the 3x3's top-left cell.  recruit: at = a square of the ship the kite flies to.
 *    ready / leave / rejoin / switchMode: no payload.
 *  The bomb rule set: placeTrap: at = the square to trap.  buy: shapeId = the ItemKind.  In the RAID (BOMBER_UC.md) the core walks
 *    the hero, so dropBomb (= strike) / pickUpBomb / defuseBomb act at the hero's square as the core has it, and throwBomb throws
 *    the way the hero faces: their `at` (and throwBomb's target, shapeId / quarterTurns) are carried but not read.
 *    walk: shapeId = (dx + 1) + 3 (dy + 1) for the way held (dx, dy each -1, 0, 1), quarterTurns = the axis tried first (0 across,
 *    1 down); read back as `way`. */
export class Command {
  constructor(kind, slot, seq, arrival, shapeId, quarterTurns, at) {
    if (!KINDS.has(kind)) throw new Error('command kind ' + kind + ' is not a CommandKind');
    if (!(at instanceof Cell)) throw new TypeError('Command.at is a Cell');
    this.kind = kind;
    this.slot = whole('slot', slot);           // player slot 0..3
    this.seq = whole('seq', seq);              // the player's own counter, echoed in the event so a client matches its reply
    this.arrival = whole('arrival', arrival);  // host receive order within the tick (REQ-PLACE-05)
    this.shapeId = whole('shapeId', shapeId);
    this.quarterTurns = whole('quarterTurns', quarterTurns);
    this.at = at;
    Object.freeze(this);
  }

  static placeWall(slot, seq, shapeId, quarterTurns, anchor, arrival) { return new Command(CommandKind.PlaceWall, slot, seq, arrival, shapeId, quarterTurns, anchor); }
  static placeCannon(slot, seq, topLeft, arrival) { return new Command(CommandKind.PlaceCannon, slot, seq, arrival, 0, 0, topLeft); }
  static fire(slot, seq, target, arrival) { return new Command(CommandKind.Fire, slot, seq, arrival, 0, 0, target); }
  static ready(slot, seq, arrival) { return new Command(CommandKind.Ready, slot, seq, arrival, 0, 0, Cell.zero); }
  static claim(slot, seq, castleCell, arrival) { return new Command(CommandKind.Claim, slot, seq, arrival, 0, 0, castleCell); }
  /** A 3x3 Mortar, top-left at `topLeft` (costs rules.mortarCost of the allotment). */
  static placeMortar(slot, seq, topLeft, arrival) { return new Command(CommandKind.PlaceMortar, slot, seq, arrival, 0, 0, topLeft); }
  /** A 3x3 Kite, top-left at `topLeft` (costs rules.kiteCost of the allotment). */
  static placeKite(slot, seq, topLeft, arrival) { return new Command(CommandKind.PlaceKite, slot, seq, arrival, 0, 0, topLeft); }
  /** Fly your kite over the ship at `target` and recruit it. */
  static recruit(slot, seq, target, arrival) { return new Command(CommandKind.Recruit, slot, seq, arrival, 0, 0, target); }
  /** Decide your fate: fightAgain true = Fight Again, false = Give Up (carried in quarterTurns). */
  static decide(slot, seq, fightAgain, arrival) { return new Command(CommandKind.Decide, slot, seq, arrival, 0, fightAgain ? 1 : 0, Cell.zero); }
  static switchMode(slot, seq, arrival) { return new Command(CommandKind.SwitchMode, slot, seq, arrival, 0, 0, Cell.zero); }
  static strike(slot, seq, at, arrival) { return new Command(CommandKind.Strike, slot, seq, arrival, 0, 0, at); }
  /** The bomb rule set's name for strike: A drops a bomb there. */
  static dropBomb(slot, seq, at, arrival) { return Command.strike(slot, seq, at, arrival); }
  static pickUpBomb(slot, seq, at, arrival) { return new Command(CommandKind.PickUpBomb, slot, seq, arrival, 0, 0, at); }
  static throwBomb(slot, seq, from, target, arrival) { return new Command(CommandKind.ThrowBomb, slot, seq, arrival, target.x, target.y, from); }
  static defuseBomb(slot, seq, at, arrival) { return new Command(CommandKind.DefuseBomb, slot, seq, arrival, 0, 0, at); }
  static buy(slot, seq, item, arrival) { return new Command(CommandKind.Buy, slot, seq, arrival, item, 0, Cell.zero); }
  static placeTrap(slot, seq, at, arrival) { return new Command(CommandKind.PlaceTrap, slot, seq, arrival, 0, 0, at); }
  static moveHero(slot, seq, at, arrival) { return new Command(CommandKind.MoveHero, slot, seq, arrival, 0, 0, at); }
  /** The RAID: the way the player holds now (dx, dy each -1, 0, 1; 0, 0 = let go) and the axis to try first (0 across, 1 down). */
  static walk(slot, seq, dx, dy, first, arrival) {
    if (![-1, 0, 1].includes(dx) || ![-1, 0, 1].includes(dy) || (first !== 0 && first !== 1)) throw new RangeError('Command.walk: dx, dy are -1, 0, 1 and first 0 or 1, got ' + dx + ', ' + dy + ', ' + first);
    return new Command(CommandKind.Walk, slot, seq, arrival, (dx + 1) + 3 * (dy + 1), first, Cell.zero);
  }
  /** walk's way: { dx, dy, first }, or null when shapeId / quarterTurns are not a way (a hand-made command). */
  get way() {
    if (!Number.isInteger(this.shapeId) || this.shapeId < 0 || this.shapeId > 8 || (this.quarterTurns !== 0 && this.quarterTurns !== 1)) return null;
    return { dx: this.shapeId % 3 - 1, dy: Math.trunc(this.shapeId / 3) - 1, first: this.quarterTurns };
  }
  /** throwBomb's target square. */
  get target() { return new Cell(this.shapeId, this.quarterTurns); }
  static leave(slot, arrival) { return new Command(CommandKind.Leave, slot, 0, arrival, 0, 0, Cell.zero); }
  static rejoin(slot, arrival) { return new Command(CommandKind.Rejoin, slot, 0, arrival, 0, 0, Cell.zero); }
}
