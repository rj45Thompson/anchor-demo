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
  MoveHero: 18,                                // the controller reports where the hero stands (the core never moves a cursor)
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
 *  The bomb rule set: dropBomb (= strike) / pickUpBomb / defuseBomb / placeTrap / moveHero: at = the hero's square (placeTrap: the
 *    square to trap).  throwBomb: at = the square thrown FROM, shapeId = target x, quarterTurns = target y (read it back as
 *    `target`).  buy: shapeId = the ItemKind. */
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
  /** throwBomb's target square. */
  get target() { return new Cell(this.shapeId, this.quarterTurns); }
  static leave(slot, arrival) { return new Command(CommandKind.Leave, slot, 0, arrival, 0, 0, Cell.zero); }
  static rejoin(slot, arrival) { return new Command(CommandKind.Rejoin, slot, 0, arrival, 0, 0, Cell.zero); }
}
