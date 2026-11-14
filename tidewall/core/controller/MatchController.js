// port of model/Controller/MatchController.cs
import { Cell } from '../cell.js';
import { Terrain, Occupant } from '../grid.js';
import { CellMath } from '../rules/CellMath.js';
import { PlacementRules, PlacementResult } from '../rules/PlacementRules.js';
import { EnclosureRules } from '../rules/EnclosureRules.js';
import { GameRules } from '../rules/GameRules.js';
import { Phase } from '../match/Entities.js';
import { Command, CommandKind } from '../match/Commands.js';
import { HudViewModel } from './HudViewModel.js';
import { PlaybackQueue } from './PlaybackQueue.js';
import { CastleBot } from '../bots/CastleBot.js';

const PAD_FIELDS = Object.freeze({
  stickX: 'int', stickY: 'int', hasPointer: 'bool', pointer: 'cell', confirm: 'bool', rotate: 'bool', ready: 'bool', swap: 'bool', fast: 'bool',
  // the bomb rule set (BOMBS_SPEC.md): grab and defuse are HELD (B / right button / a key, and the bar's Defuse); tap is B let go
  // without a drag (pick up, or turn the piece); drop / pickUp / trap are pressed THIS frame; buy is an ItemKind (-1 = none)
  grab: 'bool', defuse: 'bool', tap: 'bool', drop: 'bool', pickUp: 'bool', trap: 'bool', buy: 'int',
  // UC-C1: a direction pressed this frame (-1, 0, 1 each way): the host's latched key, d-pad or stick step
  stepX: 'int', stepY: 'int',
});

/** AUTHORED: squares per second the drawn hero walks after the cursor in the bomb rule set's BATTLE and REPAIR, where it has no rule
 *  to follow (BOMBER_UC.md: the hero acts in the RAID alone, where the core walks it). Faster than the stick moves the cursor (10). */
export const HERO_CELLS_PER_SECOND = 12;
/** AUTHORED: how long a pointer's click (a finger's tap) on a far square in the RAID waits for the hero to walk there and set the
 *  bomb down (2 s: 12 squares at the hero's pace). */
const DROP_WALK_TICKS = 60;
/** UC-C1 (STEP_CONTROLS_UC.md), AUTHORED: the phases whose cursor steps a square at a time; the stick travel (of 1000) that is a
 *  push (half way, as the menus count a step); a lean (one axis this many times the other) that moves along that axis only; how
 *  long a push is held before it repeats (0.2 s: a quick tap of a thumb is 0.1-0.15 s and must stay ONE square). */
const STEP_PHASES = new Set([Phase.Claim, Phase.Cannons, Phase.Repair]);
const STEP_PUSH = 500, STEP_LEAN = 2, STEP_DELAY_TICKS = 6;

/** What a player's input device says this frame, in whole numbers (C# struct PadInput). The app's input layer fills it; the
 *  controller never reads a device. `swap` is this port's own field (the C# struct had one READY button for both jobs): it swaps the
 *  phase's tool for the sword and back in REPAIR and BATTLE, and `ready` only readies (CLAIM, CANNONS); a device with one button for
 *  both (a pad's Y) sets both and the phase picks the one that applies. Stick axes run -1000..1000 (+y is down the board); `pointer` is a cell when a mouse points at
 *  the board (`hasPointer`). confirm / rotate / ready are pressed THIS frame (edges, not held); fast is HELD (the cursor moves
 *  twice as far). Unset fields are the C# struct's defaults (0, false, cell 0,0); a field this struct does not have is refused. */
export class PadInput {
  constructor(fields = {}) {
    this.stickX = 0; this.stickY = 0;
    this.hasPointer = false; this.pointer = Cell.zero;
    this.confirm = false; this.rotate = false; this.ready = false; this.swap = false;
    this.fast = false;
    this.grab = false; this.defuse = false; this.tap = false; this.drop = false; this.pickUp = false; this.trap = false; this.buy = -1;
    this.stepX = 0; this.stepY = 0;
    for (const k of Object.keys(fields)) {
      const kind = PAD_FIELDS[k];
      if (kind === undefined) throw new TypeError('PadInput has no field "' + k + '"');
      const v = fields[k];
      if (k === 'buy' && !(Number.isInteger(v) && v >= -1 && v <= 3)) throw new TypeError('PadInput.buy is -1 or an ItemKind (0..3), got ' + v);
      if ((k === 'stepX' || k === 'stepY') && !(v === -1 || v === 0 || v === 1)) throw new TypeError('PadInput.' + k + ' is -1, 0 or 1, got ' + v);
      if (kind === 'int' && !(Number.isInteger(v) && v >= -2147483648 && v <= 2147483647)) throw new TypeError('PadInput.' + k + ' is a whole number, got ' + v);
      if (kind === 'bool' && typeof v !== 'boolean') throw new TypeError('PadInput.' + k + ' is true or false, got ' + v);
      if (kind === 'cell' && !(v instanceof Cell)) throw new TypeError('PadInput.' + k + ' is a Cell');
      this[k] = v;
    }
  }
}

/** What CONFIRM places in CANNONS: the 2x2 cannon (0), or in the full rules the 3x3 Mortar (1) or Kite (2), centred on the cursor.
 *  ROTATE cycles them in CANNONS when the full rules are on. */
export const PlaceKind = Object.freeze({ Cannon: 0, Mortar: 1, Kite: 2 });

/** What a player's ghost looks like now: the squares it would cover, whether that is legal, and what kind of action the confirm
 *  button would take. The view draws it in the player's colour. */
export class Ghost {
  constructor() {
    this.phase = 0;
    this.cursor = Cell.zero;
    this.cells = null;
    this.legal = false;
    this.shapeId = 0;
    this.quarterTurns = 0;
    this.place = PlaceKind.Cannon;   // CANNONS: what confirm would place
    this.kite = false;               // BATTLE (the full rules): confirm flies the kite at the cursor (recruit) instead of firing
    /** What the model would answer to confirm now (UC-P1: the ghost says WHY it is red): 'wall' -> a PlacementResult (Ok = 0),
     *  'cannon' / 'mortar' / 'kite' -> a RejectReason or -1 (placed), null in a phase with no ghost to refuse. From
     *  MatchModel.wallVerdict / cannonVerdict / mortarVerdict / kiteVerdict, the very checks the command runs. */
    this.kind = null;
    this.result = 0;
    /** The squares behind a refusal (outlined red by the view); empty when legal or when the reason is not about a square. */
    this.bad = [];
  }
}

/** Feeds the HUD as each event is SHOWN (not when the model decided it), then hands the event to the app's view. */
class HudPresenter {
  constructor(hud, view) { this._hud = hud; this._view = view; }
  get isIdle() { return this._view === null || this._view.isIdle; }
  present(e) { this._hud.shown(e); if (this._view !== null) this._view.present(e); }
}

/** The match scene's ONE controller: it turns each player's input into commands, gives a tick's commands to the model in the order
 *  they arrived, and replays the model's events to the views through a PlaybackQueue. It owns the cursors (a cursor is input state,
 *  not a game rule). The host calls frame() once per game tick with every slot's PadInput; tests call it the same way.
 *
 *  Real time: the presenter answers isIdle at once for events whose animation may overlap the next (a ship's step, a shot), and holds
 *  the queue only for the few that must be seen before anyone acts (a phase banner). Each frame drains while it is idle.
 *
 *  `presenter` is the app's view: an object with `isIdle` and `present(e)`, or null for none. */
export class MatchController {
  constructor(model, presenter) {
    if (presenter === undefined) throw new TypeError('MatchController: pass a presenter, or null for none');
    this.model = model;
    this.hud = new HudViewModel();
    this._presenter = new HudPresenter(this.hud, presenter);
    this._queue = new PlaybackQueue(this._presenter);
    const n = model.playerCount;
    this._qx = new Int32Array(n); this._qy = new Int32Array(n);   // cursor position in Q16 (65536 = one square)
    this._turns = new Int32Array(n); this._seq = new Int32Array(n);
    // the full rules: what confirm places in CANNONS (a PlaceKind), and whether confirm flies the kite in BATTLE
    this._place = new Int32Array(n); this._kiteAim = new Array(n).fill(false);
    // the bomb rule set: where each hero is drawn (Q16: chasing the cursor in BATTLE and REPAIR, the core's hero in the RAID), and the B hold
    this._hx = new Int32Array(n); this._hy = new Int32Array(n);
    // UC-P3: the hero and the cursor as they were one tick ago (Q16), so a view can draw them BETWEEN ticks at the display rate
    // (heroAt / cursorAt with the frame's alpha). View-only: no command and no rule reads them.
    this._phx = new Int32Array(n); this._phy = new Int32Array(n); this._pqx = new Int32Array(n); this._pqy = new Int32Array(n);
    this._hold = new Int32Array(n); this._holdDone = new Array(n).fill(false); this._arm = new Array(n).fill(null);
    // the RAID (BOMBER_UC.md R16): the way each player held last tick (-1, 0, 1 each), the axis pressed most recently (0 x, 1 y),
    // and a pointer's square the hero is walking a path to (null = none)
    this._rx = new Int32Array(n); this._ry = new Int32Array(n); this._rf = new Int32Array(n); this._dest = new Array(n).fill(null);
    // UC-C1 (STEP_CONTROLS_UC.md): the square-by-square cursor of CLAIM, CANNONS and REPAIR; each axis's held way (-1, 0, 1) and
    // how many ticks it has been held. stepCursor false is the C#'s glide in every phase (its ported tests set it).
    this.stepCursor = true;
    this._sdx = new Int32Array(n); this._sdy = new Int32Array(n); this._stx = new Int32Array(n); this._sty = new Int32Array(n);
    this._bots = new Array(n).fill(null);
    this._pending = [];
    /** The squares the shared camera can show at its widest, set by the host each frame: no cursor - no hero - walks past them.
     *  null = the whole map; else {x0, y0, x1, y1} in squares, inclusive. */
    this.bounds = null;
    /** Bot seats send nothing before this tick (a demo that waits before anyone builds). */
    this.botsFrom = 0;
    this._cursorsToCastles();
    this._queue.accept(model.events);
    this._drain();
  }

  /** Each cursor starts on a castle until one is claimed - again on every new map. */
  _cursorsToCastles() {
    const castles = this.model.grid.castles;
    for (let s = 0; s < this.model.playerCount; s++) {
      if (castles.length === 0) { this._qx[s] = this.model.grid.width * 32768; this._qy[s] = this.model.grid.height * 32768; }
      else {
        const c = castles[s % castles.length].cells[0];
        this._qx[s] = c.x * 65536 + 32768; this._qy[s] = c.y * 65536 + 32768;
      }
      this._hx[s] = this._qx[s]; this._hy[s] = this._qy[s]; this._hold[s] = 0; this._arm[s] = null; this._dest[s] = null;
      this._phx[s] = this._hx[s]; this._phy[s] = this._hy[s]; this._pqx[s] = this._qx[s]; this._pqy[s] = this._qy[s];
    }
  }

  /** What CONFIRM places in CANNONS (a PlaceKind): always Cannon in the normal rules; ROTATE cycles it in the full rules. */
  placeOf(slot) { return this._place[slot]; }
  /** BATTLE, the full rules: confirm flies the slot's kite at the cursor (ROTATE toggles it; a flight sets it back). */
  kiteAim(slot) { return this._kiteAim[slot]; }

  /** The team's answer on the fate screen (the menu sends it; any seat speaks for the team). */
  decide(fightAgain) { this._pending.push(Command.decide(0, ++this._seq[0], fightAgain, this._pending.length)); }

  cursor(slot) { return new Cell(CellMath.cellOfQ16(this._qx[slot]), CellMath.cellOfQ16(this._qy[slot])); }

  /** The cursor in squares, with its fraction: where the hero walks to. A view reads it; no rule does. */
  cursorExact(slot) { return { x: this._qx[slot] / 65536.0, y: this._qy[slot] / 65536.0 }; }

  /** The hero's square and its exact place in squares (the bomb rule set: the hero chases the cursor; a view draws it there). */
  heroCell(slot) { return new Cell(CellMath.cellOfQ16(this._hx[slot]), CellMath.cellOfQ16(this._hy[slot])); }
  heroExact(slot) { return { x: this._hx[slot] / 65536.0, y: this._hy[slot] / 65536.0 }; }
  /** UC-P3: the hero (bomb rule set) / the cursor in squares at `alpha` (0..1) of the way from the last tick to this one: a view
   *  draws the figure there every display frame, so it moves at the display rate instead of in 30 Hz steps. */
  heroAt(slot, alpha) {
    const k = Math.max(0, Math.min(1, alpha));
    return { x: (this._phx[slot] + (this._hx[slot] - this._phx[slot]) * k) / 65536.0, y: (this._phy[slot] + (this._hy[slot] - this._phy[slot]) * k) / 65536.0 };
  }
  cursorAt(slot, alpha) {
    const k = Math.max(0, Math.min(1, alpha));
    return { x: (this._pqx[slot] + (this._qx[slot] - this._pqx[slot]) * k) / 65536.0, y: (this._pqy[slot] + (this._qy[slot] - this._pqy[slot]) * k) / 65536.0 };
  }
  /** The B / defuse hold as 0..1 of rules.defuseHoldTicks (0 = not held, or already done): the progress ring. */
  holdProgress(slot) {
    if (this._hold[slot] === 0 || this._holdDone[slot]) return 0;
    return Math.min(1, this._hold[slot] / this.model.rules.defuseHoldTicks);
  }

  get backlog() { return this._queue.backlog; }
  get isCaughtUp() { return this._queue.isCaughtUp; }

  /** Let a bot play this slot (attract mode, or a seat nobody took); false hands it back to a person. */
  setBot(slot, on) { this._bots[slot] = on ? new CastleBot(slot) : null; }
  isBot(slot) { return this._bots[slot] !== null; }

  /** A pad was unplugged or plugged back in. */
  setConnected(slot, connected) {
    this._pending.push(connected ? Command.rejoin(slot, this._pending.length) : Command.leave(slot, this._pending.length));
  }

  /** One game tick: read every human slot's input, add the bots' commands, step the model, replay the new events. */
  frame(pads) {
    if (pads === null || pads === undefined || pads.length !== this.model.playerCount)
      throw new RangeError('one PadInput per player slot (' + this.model.playerCount + '), got ' + (pads === null || pads === undefined ? 0 : pads.length));
    for (let s = 0; s < pads.length; s++)
      if (!(pads[s] instanceof PadInput)) throw new TypeError('pads[' + s + '] is not a PadInput');
    this._phx.set(this._hx); this._phy.set(this._hy); this._pqx.set(this._qx); this._pqy.set(this._qy);
    for (let s = 0; s < this.model.playerCount; s++) {
      if (this._bots[s] !== null) {
        let acted = false;
        if (this.model.tick >= this.botsFrom)
          for (const c of this._bots[s].think(this.model, this._pending.length)) {
            acted = true;
            this._pending.push(c);
            // a bot seat's cursor goes where the bot works, so its disc hangs over what it builds and fires at (in the RAID it is the
            // hero, set from the model after the step)
            if (c.kind !== CommandKind.Ready && c.kind !== CommandKind.Leave && c.kind !== CommandKind.Rejoin && this.model.phase !== Phase.Raid) {
              this._qx[s] = c.at.x * 65536 + 32768; this._qy[s] = c.at.y * 65536 + 32768;
            }
          }
        if (!acted) this._botDriftHome(s);
        continue;
      }
      this._input(s, pads[s]);
    }
    if (this.model.options.bombs && this.model.phase !== Phase.Raid) for (let s = 0; s < pads.length; s++) this._walkHero(s);
    const grid = this.model.grid;
    this.model.step(this._pending);
    this._pending = [];
    if (grid !== this.model.grid) this._cursorsToCastles();   // a new level: back onto the castles
    if (this.model.phase === Phase.Raid) for (let s = 0; s < pads.length; s++) this._syncHero(s);
    this._queue.accept(this.model.events);
    this._drain();
    this.hud.refresh(this.model);
  }

  /** A bot with nothing to do drifts its cursor back over its own castle (at the stick's speed), so idle bots' discs do not stay
   *  stacked where they all last fired. A person's cursor never moves itself. */
  _botDriftHome(s) {
    const id = this.model.player(s).claimedCastle;
    let home = null;
    for (const k of this.model.grid.castles) if (k.id === id) home = k;
    if (home === null) return;
    const step = Math.trunc(65536 * this.model.rules.padCellsPerSecond / GameRules.TicksPerSecond);   // C# long division
    const tx = home.cells[0].x * 65536 + 32768, ty = home.cells[0].y * 65536 + 32768;
    this._qx[s] += Math.max(-step, Math.min(step, tx - this._qx[s]));
    this._qy[s] += Math.max(-step, Math.min(step, ty - this._qy[s]));
  }

  _drain() { while (this._queue.tick()) { /* show everything the presenter is idle for */ } }

  _input(s, p) {
    const m = this.model;
    if (!m.player(s).connected) return;
    if (m.phase === Phase.Raid) { this._raidInput(s, p); return; }   // BOMBER_UC.md: the RAID's one tool, its own controls
    const g = m.grid;
    const px = this._qx[s], py = this._qy[s];
    if (p.hasPointer) { this._qx[s] = p.pointer.x * 65536 + 32768; this._qy[s] = p.pointer.y * 65536 + 32768; }
    else if (this.stepCursor && STEP_PHASES.has(m.phase)) this._step(s, p);
    else {
      const dz = m.rules.padDeadZone;
      // C#: long perTick = 65536L * PadCellsPerSecond / TicksPerSecond * (Fast ? 2 : 1); (int)(perTick * stick / 1000), truncating
      const perTick = Math.trunc(65536 * m.rules.padCellsPerSecond / GameRules.TicksPerSecond) * (p.fast ? 2 : 1);
      if (Math.abs(p.stickX) > dz) this._qx[s] += Math.trunc(perTick * p.stickX / 1000);
      if (Math.abs(p.stickY) > dz) this._qy[s] += Math.trunc(perTick * p.stickY / 1000);
    }
    this._qx[s] = Math.max(0, Math.min(g.width * 65536 - 1, this._qx[s]));      // a cursor stays on the map
    this._qy[s] = Math.max(0, Math.min(g.height * 65536 - 1, this._qy[s]));
    if (this.bounds !== null) {                                                    // the screen's edge stops a hero
      const b = this.bounds;
      this._qx[s] = Math.max(b.x0 * 65536, Math.min((b.x1 + 1) * 65536 - 1, this._qx[s]));
      this._qy[s] = Math.max(b.y0 * 65536, Math.min((b.y1 + 1) * 65536 - 1, this._qy[s]));
    }
    const bombs = m.options.bombs;
    // with the sword out the cursor IS the hero on foot - it does not walk into the sea (a step onto water is undone, each axis on
    // its own, so the hero slides along a shore instead of sticking to it). Only a step FROM dry land is held back: a cursor that is
    // already in the sea (BATTLE aims it at the ships) must be free to walk out, or a hero who drew the sword out there is stuck in
    // the water for the whole phase (found 11-09 playing by keyboard: every step from a wet square was undone).
    // The bomb rule set has no such rule: its hero is not the cursor (it walks after it, below), and a bomb is thrown at the sea.
    if (!bombs && m.player(s).sword && this._dry(px, py)) {
      if (!this._dry(this._qx[s], this._qy[s]) && this._dry(px, this._qy[s])) this._qx[s] = px;
      else if (!this._dry(this._qx[s], this._qy[s]) && this._dry(this._qx[s], py)) this._qy[s] = py;
      else if (!this._dry(this._qx[s], this._qy[s])) { this._qx[s] = px; this._qy[s] = py; }
    }
    // ROTATE: in the full rules it cycles the gun kind in CANNONS (cannon, mortar, kite) and toggles the kite's aim in BATTLE; else
    // it turns the piece. The bomb rule set: B let go (tap) is the pad's B outside the RAID, so it does what B always did here
    if (p.rotate || (bombs && p.tap)) {
      if (m.phase === Phase.Cannons && m.options.full) this._place[s] = (this._place[s] + 1) % 3;
      else if (m.phase === Phase.Battle && m.options.full) this._kiteAim[s] = !this._kiteAim[s];
      else this._turns[s] = (this._turns[s] + 1) & 3;
    }
    // READY in claim and cannons; SWAP in REPAIR and BATTLE trades the phase's tool for the sword and back (the C# host had one button
    // for both; a device that still has one sets both fields, and only the one that fits the phase acts). The bomb rule set has one
    // tool a beat (BOMBER_UC.md R3): nothing to swap, so no swap is sent
    const toolPhase = m.phase === Phase.Repair || m.phase === Phase.Battle;
    if (p.ready && !toolPhase) this._pending.push(Command.ready(s, ++this._seq[s], this._pending.length));
    if (p.swap && toolPhase && !bombs) this._pending.push(Command.switchMode(s, ++this._seq[s], this._pending.length));
    // the shop and the trap (the bomb rule set's REPAIR; the core refuses them in any other phase, with the reason)
    if (bombs && p.buy >= 0) this._pending.push(Command.buy(s, ++this._seq[s], p.buy, this._pending.length));
    if (bombs && p.trap) this._pending.push(Command.placeTrap(s, ++this._seq[s], this.cursor(s), this._pending.length));
    if (!p.confirm) return;
    const at = this.cursor(s);
    if (!bombs && m.player(s).sword && (m.phase === Phase.Repair || m.phase === Phase.Battle)) {
      this._pending.push(Command.strike(s, ++this._seq[s], at, this._pending.length));   // the hero swings where it stands
      return;
    }
    switch (m.phase) {
      case Phase.Claim: this._pending.push(Command.claim(s, ++this._seq[s], at, this._pending.length)); break;
      case Phase.Cannons: {
        const kind = this._place[s], tl = kind === PlaceKind.Cannon ? at : new Cell(at.x - 1, at.y - 1);   // a 3x3 is centred on the cursor
        this._pending.push(kind === PlaceKind.Mortar ? Command.placeMortar(s, ++this._seq[s], tl, this._pending.length)
                         : kind === PlaceKind.Kite ? Command.placeKite(s, ++this._seq[s], tl, this._pending.length)
                         : Command.placeCannon(s, ++this._seq[s], at, this._pending.length));
        break;
      }
      case Phase.Battle:
        if (this._kiteAim[s]) { this._pending.push(Command.recruit(s, ++this._seq[s], at, this._pending.length)); this._kiteAim[s] = false; }
        else this._pending.push(Command.fire(s, ++this._seq[s], at, this._pending.length));
        break;
      case Phase.Repair:
        this._pending.push(Command.placeWall(s, ++this._seq[s], m.heldShapeId(s), this._turns[s], at, this._pending.length));
        break;
    }
  }

  /** STEP_CONTROLS_UC.md UC-C1: in CLAIM, CANNONS and REPAIR a stick or a key moves the cursor one SQUARE at a time, as a grid game
   *  does, instead of gliding at padCellsPerSecond (the C#'s way, still BATTLE's, where the cursor aims at ships on the move).
   *  A press steps once at once (p.stepX / stepY: a key, the d-pad or the stick pushed past half, latched by the host so a tap
   *  shorter than a tick still counts; or a push that is still held when the tick comes); held past STEP_DELAY_TICKS it steps every
   *  repeat ticks (padCellsPerSecond's pace, twice it with fast). A stick leaning mostly one way moves that way only, so a thumb that
   *  is not quite straight does not walk the ghost off its row. The cursor always sits on a square's centre here. */
  _step(s, p) {
    const m = this.model;
    const cx = CellMath.cellOfQ16(this._qx[s]), cy = CellMath.cellOfQ16(this._qy[s]);
    const ax = Math.abs(p.stickX), ay = Math.abs(p.stickY);
    let hx = ax > STEP_PUSH ? Math.sign(p.stickX) : 0, hy = ay > STEP_PUSH ? Math.sign(p.stickY) : 0;
    if (hx !== 0 && hy !== 0) { if (ax > STEP_LEAN * ay) hy = 0; else if (ay > STEP_LEAN * ax) hx = 0; }
    const repeat = Math.max(1, Math.round(GameRules.TicksPerSecond / m.rules.padCellsPerSecond / (p.fast ? 2 : 1)));
    const axis = (held, dir, ticks, tap) => {        // -> [step, new dir, new ticks]
      if (held === 0) return [tap, 0, 0];             // released (or never held): only a latched tap steps
      const t = held === dir ? ticks : 0;            // a new push, or the other way: the count starts again
      const go = t === 0 || (t >= STEP_DELAY_TICKS && (t - STEP_DELAY_TICKS) % repeat === 0);
      return [go ? held : 0, held, t + 1];
    };
    const [dx, ndx, ntx] = axis(hx, this._sdx[s], this._stx[s], p.stepX);
    const [dy, ndy, nty] = axis(hy, this._sdy[s], this._sty[s], p.stepY);
    this._sdx[s] = ndx; this._stx[s] = ntx; this._sdy[s] = ndy; this._sty[s] = nty;
    this._qx[s] = (cx + dx) * 65536 + 32768; this._qy[s] = (cy + dy) * 65536 + 32768;
  }

  /** The bomb rule set's BATTLE and REPAIR: the drawn hero walks after the cursor over dry land (each axis on its own, so it slides
   *  along a shore). No rule reads it (the hero acts in the RAID alone, BOMBER_UC.md); it is what the view draws there. */
  _walkHero(s) {
    const step = Math.trunc(65536 * HERO_CELLS_PER_SECOND / GameRules.TicksPerSecond);
    const nx = this._hx[s] + Math.max(-step, Math.min(step, this._qx[s] - this._hx[s]));
    if (this._dry(nx, this._hy[s])) this._hx[s] = nx;
    const ny = this._hy[s] + Math.max(-step, Math.min(step, this._qy[s] - this._hy[s]));
    if (this._dry(this._hx[s], ny)) this._hy[s] = ny;
  }

  /** The RAID: the hero is the core's (BOMBER_UC.md steps 2-6); its exact place this tick, and the cursor with it. */
  _syncHero(s) {
    const p = this.model.player(s);
    if (p.heroAt === null) return;
    let x = p.heroAt.x * 65536 + 32768, y = p.heroAt.y * 65536 + 32768;
    if (p.heroTo !== null) {
      const k = p.stepTicks - p.stepLeft;
      x += Math.trunc((p.heroTo.x - p.heroAt.x) * 65536 * k / p.stepTicks); y += Math.trunc((p.heroTo.y - p.heroAt.y) * 65536 * k / p.stepTicks);
    }
    this._hx[s] = x; this._hy[s] = y; this._qx[s] = x; this._qy[s] = y;
  }

  /** A bomb within pickUpReach of the hero that its hands could take (on the ground, not in flight, not carried), or null. */
  _bombNear(s) {
    const h = this.model.player(s).heroCell, reach = this.model.rules.pickUpReach;
    if (h === null) return null;
    for (const b of this.model.bombs)
      if (b.alive && b.carriedBy < 0 && b.flightLeft === 0 && Math.max(Math.abs(b.at.x - h.x), Math.abs(b.at.y - h.y)) <= reach) return b;
    return null;
  }

  /** BOMBER_UC.md R16, the RAID's controls. The stick, d-pad or keys are the way held: past half way a push (a lean one axis twice
   *  the other is that axis alone; a latched tap shorter than a tick counts for its tick), sent to the core as a walk whenever it
   *  changes, the axis pressed most recently tried first. A pointer (the mouse in pointer mode, a finger's tap) names a square: the
   *  hero walks a path to it, and a click / tap there drops a bomb on arrival (DROP_WALK_TICKS at most; a push cancels both).
   *  A (confirm, the bar's Drop): a bomb at its feet, or the carried one thrown. B is a TAP or a HOLD: let go before
   *  rules.defuseHoldTicks it picks up the bomb on or beside the hero (or throws the carried one); held that long it puts out the
   *  bomb on or beside it. The bar's Pick up / Defuse are the tap / the hold alone. */
  _raidInput(s, p) {
    const m = this.model, pl = m.player(s), r = m.rules;
    if (pl.heroAt === null) return;
    const at = pl.heroCell;
    // the way held
    const ax = Math.abs(p.stickX), ay = Math.abs(p.stickY);
    let hx = ax > STEP_PUSH ? Math.sign(p.stickX) : 0, hy = ay > STEP_PUSH ? Math.sign(p.stickY) : 0;
    if (hx !== 0 && hy !== 0) { if (ax > STEP_LEAN * ay) hy = 0; else if (ay > STEP_LEAN * ax) hx = 0; }
    if (hx === 0) hx = p.stepX;
    if (hy === 0) hy = p.stepY;
    let first = this._rf[s];
    const newX = hx !== 0 && this._rx[s] === 0, newY = hy !== 0 && this._ry[s] === 0;
    if (newX && newY) first = ax >= ay ? 0 : 1;
    else if (newX) first = 0;
    else if (newY) first = 1;
    else if (hx !== 0 && hy === 0) first = 0;
    else if (hy !== 0 && hx === 0) first = 1;
    this._rx[s] = hx; this._ry[s] = hy; this._rf[s] = first;
    // a pointer's square: walk a path there (a push takes the hero back)
    const pushed = hx !== 0 || hy !== 0;
    if (pushed) { this._dest[s] = null; this._arm[s] = null; }
    else if (p.hasPointer && this._arm[s] === null) this._dest[s] = p.pointer;   // a click's square wins over the hover until it drops
    if (!pushed && this._dest[s] !== null) {
      const d = this._dest[s];
      if (pl.heroTo !== null) { hx = pl.wishX; hy = pl.wishY; first = pl.wishFirst; }     // a step under way finishes by itself
      else if (d.x === at.x && d.y === at.y) this._dest[s] = null;
      else {
        const way = this._pathStep(at, d);
        if (way === null) this._dest[s] = null; else { [hx, hy] = way; first = hx !== 0 ? 0 : 1; }
      }
    }
    if (hx !== pl.wishX || hy !== pl.wishY || (hx !== 0 && hy !== 0 && first !== pl.wishFirst))
      this._pending.push(Command.walk(s, ++this._seq[s], hx, hy, first, this._pending.length));
    // B held: the ring fills, and at rules.defuseHoldTicks the hero defuses (once per hold). B let go (tap): pick up or throw, unless
    // that very hold already defused
    const held = p.grab || p.defuse, doneBefore = this._holdDone[s];
    if (held) {
      if (this._hold[s] === 0) this._holdDone[s] = false;
      this._hold[s]++;
      if (!this._holdDone[s] && this._hold[s] >= r.defuseHoldTicks) {
        this._pending.push(Command.defuseBomb(s, ++this._seq[s], at, this._pending.length));
        this._holdDone[s] = true;
      }
    } else if (this._hold[s] > 0) { this._hold[s] = 0; this._holdDone[s] = false; }
    let throwIt = false;
    if ((p.tap && !doneBefore) || p.pickUp) {
      if (pl.carrying !== 0) throwIt = true;
      else this._pending.push(Command.pickUpBomb(s, ++this._seq[s], at, this._pending.length));
    }
    // A: a bomb, at once at the hero's feet, or (a pointer's click on another square) when the hero gets there
    let drop = p.drop || p.confirm;
    if (drop && p.confirm && p.hasPointer && pl.carrying === 0 && (p.pointer.x !== at.x || p.pointer.y !== at.y)) {
      this._arm[s] = { cell: p.pointer, left: DROP_WALK_TICKS }; this._dest[s] = p.pointer; drop = false;
    }
    const arm = this._arm[s];
    if (arm !== null) {
      if (--arm.left < 0) this._arm[s] = null;
      else if (pl.heroTo === null && arm.cell.x === at.x && arm.cell.y === at.y) { this._arm[s] = null; drop = true; }
    }
    if (drop && pl.carrying !== 0) throwIt = true;
    if (throwIt) this._pending.push(Command.throwBomb(s, ++this._seq[s], at, at, this._pending.length));
    else if (drop) this._pending.push(Command.dropBomb(s, ++this._seq[s], at, this._pending.length));
  }

  /** The first step [dx, dy] of the shortest walk from `from` to `to` over the squares a hero may enter now (the arms' order on a
   *  tie), or null when there is none. The goal itself need not be enterable (a pointer on a bomb walks up to it). */
  _pathStep(from, to) {
    const m = this.model, g = m.grid, w = g.width, DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
    const first = new Int8Array(w * g.height).fill(-1), q = [from.y * w + from.x];
    first[q[0]] = 4;
    for (let i = 0; i < q.length; i++) {
      const c = q[i], cx = c % w, cy = (c / w) | 0;
      for (let k = 0; k < 4; k++) {
        const x = cx + DX[k], y = cy + DY[k];
        if (!g.in(x, y)) continue;
        const n = y * w + x;
        if (first[n] !== -1) continue;
        const goal = x === to.x && y === to.y;
        if (!goal && !m.heroCanEnter(x, y)) continue;
        first[n] = first[c] === 4 ? k : first[c];
        if (goal) return i === 0 && !m.heroCanEnter(x, y) ? null : [DX[first[n]], DY[first[n]]];   // beside a goal it cannot enter: there
        q.push(n);
      }
    }
    return null;
  }

  _dry(qx, qy) {
    const x = CellMath.cellOfQ16(qx), y = CellMath.cellOfQ16(qy);
    return this.model.grid.in(x, y) && this.model.grid.terrainAt(x, y) !== Terrain.Water;
  }

  /** The ghost a view draws at slot's cursor. `terr` (CANNONS only): EnclosureRules.map of the board now, when the caller asks for
   *  several ghosts in one frame; null maps it here. */
  ghostOf(s, terr = null) {
    const m = this.model;
    const at = this.cursor(s);
    const gh = new Ghost();
    gh.phase = m.phase; gh.cursor = at; gh.shapeId = m.heldShapeId(s); gh.quarterTurns = this._turns[s];
    gh.place = this._place[s]; gh.kite = this._kiteAim[s];
    switch (m.phase) {
      case Phase.Repair: {
        // the command's own check (MatchModel.wallVerdict): until 11-09 this was PlacementRules.check alone, which knew nothing of
        // the last-piece grace, the tool in hand or the piece in hand, so a ghost drawn legal could still be refused (UC-P1)
        const shape = m.catalog.byId(gh.shapeId);
        gh.cells = PlacementRules.cellsOf(shape, this._turns[s], at);
        const v = m.wallVerdict(s, gh.shapeId, this._turns[s], at);
        gh.kind = 'wall'; gh.result = v.result; gh.bad = v.bad;
        gh.legal = v.result === PlacementResult.Ok;
        break;
      }
      case Phase.Cannons: {
        // a 2x2 cannon, top-left at the cursor, or (the full rules) a 3x3 mortar or kite centred on it. The model's own check
        // (MatchModel.cannonVerdict / mortarVerdict / kiteVerdict): this used to ask "is it enclosed by anyone", the model asks "by
        // THIS player's walls", so a ghost inside a team-mate's ring was drawn legal and refused (UC-P1)
        const kind = this._place[s], size = kind === PlaceKind.Cannon ? 2 : 3;
        const tl = size === 2 ? at : new Cell(at.x - 1, at.y - 1);
        const list = [];
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) list.push(new Cell(tl.x + dx, tl.y + dy));
        gh.cells = list;
        const v = kind === PlaceKind.Mortar ? m.mortarVerdict(s, tl, terr) : kind === PlaceKind.Kite ? m.kiteVerdict(s, tl, terr) : m.cannonVerdict(s, at, terr);
        gh.kind = kind === PlaceKind.Mortar ? 'mortar' : kind === PlaceKind.Kite ? 'kite' : 'cannon';
        gh.result = v.result; gh.bad = v.bad;
        gh.legal = v.result < 0;
        break;
      }
      default:
        gh.cells = [at];
        gh.legal = true;
        break;
    }
    return gh;
  }
}
