// FirstMatchGuide.js - this game's own (TUTORIAL_UC.md UC-T2, AAA gaps 13-14): the first match's guide. In the first round of a
// player's first match the hint strip (app/overlay.js HintStrip) shows the phase's goals as a short list, each with its count and a
// tick when the player has done it, read from the match's own events for that player's slot. Engine-free, so a test can feed it
// events; it never changes the match.
//
// The goals per phase (each one is something the rules already ask; the guide only says it and sees it done):
//   CLAIM    pick a castle                       CastleClaimed(slot)
//   CANNONS  place your cannons (n / granted)    CannonsGranted(perSlot[slot]), CannonPlaced(slot); READY: PlayerReady(slot)
//   BATTLE   fire a shot, sink a ship            ShotFired(fromSlot), ShipSunk(bySlot)
//   REPAIR   place a piece, close a ring         WallsPlaced(slot), LoopClosed(slot) (round a castle: the rules' own ring)
//   RAID     drop a bomb, blow up a raider       BombDropped(owner), GruntKilled(bySlot) (BOMBER_UC.md, the bomb rule set's own beat)
import { CastleClaimed, CannonsGranted, CannonPlaced, PlayerReady, ShotFired, ShipSunk, WallsPlaced, LoopClosed, BombDropped, GruntKilled } from '../match/Events.js';

const GOALS = Object.freeze({
  Claim: Object.freeze([{ id: 'claim', say: 'Pick a castle' }]),
  Cannons: Object.freeze([{ id: 'cannons', say: 'Place your cannons', count: true }, { id: 'ready', say: 'Ready' }]),
  Battle: Object.freeze([{ id: 'fire', say: 'Fire a shot' }, { id: 'sink', say: 'Sink a ship' }]),
  Raid: Object.freeze([{ id: 'bomb', say: 'Drop a bomb' }, { id: 'raider', say: 'Blow up a raider' }]),
  Repair: Object.freeze([{ id: 'piece', say: 'Place a piece' }, { id: 'ring', say: 'Close a ring' }]),
});

export class FirstMatchGuide {
  static Phases = Object.freeze(Object.keys(GOALS));

  /** slot: the player the guide follows (the first human slot of the match). */
  constructor(slot) {
    if (!Number.isInteger(slot) || slot < 0) throw new RangeError('FirstMatchGuide: slot is a player slot, got ' + slot);
    this.slot = slot;
    this.done = new Set();          // goal ids done
    this.placed = 0;                // cannons placed this CANNONS phase, of `granted`
    this.granted = 0;
  }

  /** The match's events since the last call (the same list the renderer draws from). */
  see(events) {
    const me = this.slot;
    for (const e of events) {
      if (e instanceof CastleClaimed && e.slot === me) this.done.add('claim');
      else if (e instanceof CannonsGranted) { this.granted = e.perSlot[me] ?? 0; this.placed = 0; }
      else if (e instanceof CannonPlaced && e.slot === me) { this.placed++; if (this.placed >= this.granted) this.done.add('cannons'); }
      else if (e instanceof PlayerReady && e.slot === me) this.done.add('ready');
      else if (e instanceof ShotFired && e.fromSlot === me) this.done.add('fire');
      else if (e instanceof ShipSunk && e.bySlot === me) this.done.add('sink');
      else if (e instanceof WallsPlaced && e.slot === me) this.done.add('piece');
      else if (e instanceof LoopClosed && e.slot === me) this.done.add('ring');
      else if (e instanceof BombDropped && e.owner === me) this.done.add('bomb');
      else if (e instanceof GruntKilled && e.bySlot === me) this.done.add('raider');
    }
  }

  /** The goals of a phase (its Phase name) as the strip shows them: [{ id, say, done, count: 'n/k' or '' }]; [] for a phase
   *  with none (SCORE, the fate screen). */
  goals(phase) {
    const g = GOALS[phase];
    if (!g) return [];
    return g.map((x) => ({ id: x.id, say: x.say, done: this.done.has(x.id),
      count: x.count && this.granted > 0 ? Math.min(this.placed, this.granted) + '/' + this.granted : '' }));
  }

  /** Every goal of the phase is done. */
  phaseDone(phase) { const g = this.goals(phase); return g.length > 0 && g.every((x) => x.done); }
}
