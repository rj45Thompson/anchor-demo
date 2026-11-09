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
  stickX: 'int', stickY: 'int', hasPointer: 'bool', pointer: 'cell', confirm: 'bool', rotate: 'bool', ready: 'bool', fast: 'bool',
});

/** What a player's input device says this frame, in whole numbers (C# struct PadInput). The app's input layer fills it; the
 *  controller never reads a device. Stick axes run -1000..1000 (+y is down the board); `pointer` is a cell when a mouse points at
 *  the board (`hasPointer`). confirm / rotate / ready are pressed THIS frame (edges, not held); fast is HELD (the cursor moves
 *  twice as far). Unset fields are the C# struct's defaults (0, false, cell 0,0); a field this struct does not have is refused. */
export class PadInput {
  constructor(fields = {}) {
    this.stickX = 0; this.stickY = 0;
    this.hasPointer = false; this.pointer = Cell.zero;
    this.confirm = false; this.rotate = false; this.ready = false;
    this.fast = false;
    for (const k of Object.keys(fields)) {
      const kind = PAD_FIELDS[k];
      if (kind === undefined) throw new TypeError('PadInput has no field "' + k + '"');
      const v = fields[k];
      if (kind === 'int' && !(Number.isInteger(v) && v >= -2147483648 && v <= 2147483647)) throw new TypeError('PadInput.' + k + ' is a whole number, got ' + v);
      if (kind === 'bool' && typeof v !== 'boolean') throw new TypeError('PadInput.' + k + ' is true or false, got ' + v);
      if (kind === 'cell' && !(v instanceof Cell)) throw new TypeError('PadInput.' + k + ' is a Cell');
      this[k] = v;
    }
  }
}

/** What CONFIRM places in CANNONS. Only the 2x2 cannon (0) is in the normal rules; the private model's 1 and 2 belong to its
 *  extended rules, which the rules port does not have, so they are not ported. */
export const PlaceKind = Object.freeze({ Cannon: 0 });

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
      if (castles.length === 0) { this._qx[s] = this.model.grid.width * 32768; this._qy[s] = this.model.grid.height * 32768; continue; }
      const c = castles[s % castles.length].cells[0];
      this._qx[s] = c.x * 65536 + 32768; this._qy[s] = c.y * 65536 + 32768;
    }
  }

  /** What CONFIRM places in CANNONS: always PlaceKind.Cannon in the normal rules. */
  placeOf(slot) { return PlaceKind.Cannon; }

  /** The team's answer on the fate screen (the menu sends it; any seat speaks for the team). */
  decide(fightAgain) { this._pending.push(Command.decide(0, ++this._seq[0], fightAgain, this._pending.length)); }

  cursor(slot) { return new Cell(CellMath.cellOfQ16(this._qx[slot]), CellMath.cellOfQ16(this._qy[slot])); }

  /** The cursor in squares, with its fraction: where the hero walks to. A view reads it; no rule does. */
  cursorExact(slot) { return { x: this._qx[slot] / 65536.0, y: this._qy[slot] / 65536.0 }; }

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
    for (let s = 0; s < this.model.playerCount; s++) {
      if (this._bots[s] !== null) {
        let acted = false;
        if (this.model.tick >= this.botsFrom)
          for (const c of this._bots[s].think(this.model, this._pending.length)) {
            acted = true;
            this._pending.push(c);
            // a bot seat's cursor goes where the bot works, so its disc hangs over what it builds and fires at
            if (c.kind !== CommandKind.Ready && c.kind !== CommandKind.Leave && c.kind !== CommandKind.Rejoin) {
              this._qx[s] = c.at.x * 65536 + 32768; this._qy[s] = c.at.y * 65536 + 32768;
            }
          }
        if (!acted) this._botDriftHome(s);
        continue;
      }
      this._input(s, pads[s]);
    }
    const grid = this.model.grid;
    this.model.step(this._pending);
    this._pending = [];
    if (grid !== this.model.grid) this._cursorsToCastles();   // a new level: back onto the castles
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
    const g = m.grid;
    const px = this._qx[s], py = this._qy[s];
    if (p.hasPointer) { this._qx[s] = p.pointer.x * 65536 + 32768; this._qy[s] = p.pointer.y * 65536 + 32768; }
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
    // with the sword out the cursor IS the hero on foot - it does not walk into the sea (a step onto water is undone, each axis on
    // its own, so the hero slides along a shore instead of sticking to it)
    if (m.player(s).sword) {
      if (!this._dry(this._qx[s], this._qy[s]) && this._dry(px, this._qy[s])) this._qx[s] = px;
      else if (!this._dry(this._qx[s], this._qy[s]) && this._dry(this._qx[s], py)) this._qy[s] = py;
      else if (!this._dry(this._qx[s], this._qy[s])) { this._qx[s] = px; this._qy[s] = py; }
    }
    // the C# cycled the gun kind (CANNONS) or the recruit aim (BATTLE) here when options.super; the rules port has only the normal
    // rules (it refuses any other options.type), so rotate always turns the piece
    if (p.rotate) {
      if (m.options.super) throw new Error('the extended rules are not ported (options.type ' + m.options.type + ')');
      this._turns[s] = (this._turns[s] + 1) & 3;
    }
    // READY in claim and cannons; in REPAIR and BATTLE it swaps the phase's tool for the sword and back
    if (p.ready)
      this._pending.push(m.phase === Phase.Repair || m.phase === Phase.Battle ? Command.switchMode(s, ++this._seq[s], this._pending.length)
                                                                              : Command.ready(s, ++this._seq[s], this._pending.length));
    if (!p.confirm) return;
    const at = this.cursor(s);
    if (m.player(s).sword && (m.phase === Phase.Repair || m.phase === Phase.Battle)) {
      this._pending.push(Command.strike(s, ++this._seq[s], at, this._pending.length));   // the hero swings where it stands
      return;
    }
    switch (m.phase) {
      case Phase.Claim: this._pending.push(Command.claim(s, ++this._seq[s], at, this._pending.length)); break;
      case Phase.Cannons: this._pending.push(Command.placeCannon(s, ++this._seq[s], at, this._pending.length)); break;
      case Phase.Battle: this._pending.push(Command.fire(s, ++this._seq[s], at, this._pending.length)); break;
      case Phase.Repair:
        this._pending.push(Command.placeWall(s, ++this._seq[s], m.heldShapeId(s), this._turns[s], at, this._pending.length));
        break;
    }
  }

  _dry(qx, qy) {
    const x = CellMath.cellOfQ16(qx), y = CellMath.cellOfQ16(qy);
    return this.model.grid.in(x, y) && this.model.grid.terrainAt(x, y) !== Terrain.Water;
  }

  /** The ghost a view draws at slot's cursor. */
  ghostOf(s) {
    const m = this.model;
    const at = this.cursor(s);
    const gh = new Ghost();
    gh.phase = m.phase; gh.cursor = at; gh.shapeId = m.heldShapeId(s); gh.quarterTurns = this._turns[s];
    gh.place = PlaceKind.Cannon;
    switch (m.phase) {
      case Phase.Repair: {
        const shape = m.catalog.byId(gh.shapeId);
        gh.cells = PlacementRules.cellsOf(shape, this._turns[s], at);
        gh.legal = PlacementRules.check(m.grid, shape, this._turns[s], at, (x, y) => m.gruntAt(x, y)) === PlacementResult.Ok;
        break;
      }
      case Phase.Cannons: {
        // a 2x2 cannon, top-left at the cursor (the C#'s 3x3 kinds are extended-rules only)
        const list = [];
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) list.push(new Cell(at.x + dx, at.y + dy));
        gh.cells = list;
        const outside = EnclosureRules.outside(m.grid);
        gh.legal = m.player(s).cannonsToPlace >= 1;
        for (const c of gh.cells)
          gh.legal = gh.legal && m.grid.in(c.x, c.y) && m.grid.terrainAt(c.x, c.y) === Terrain.Land
                     && m.grid.occupantAt(c.x, c.y) === Occupant.Empty && !outside[c.y * m.grid.width + c.x] && !m.gruntAt(c.x, c.y);
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
