// port of model/Bots/ (the private model's one bot file; its class is named CastleBot here)
//
// Every decision is the C# one, the full rules' too: in BATTLE a recruited (allied) ship is never aimed at, and a serpent with its
// head up that is nearer the bot's own cannons than every enemy ship is shot first. (The C# bot places no mortar or kite and flies
// no kite: its full-rules play is only that aiming.) The bomb rule set's hero work (_bombWork) is this game's own.
import { Cell } from '../cell.js';
import { Terrain, Occupant } from '../grid.js';
import { EnclosureRules } from '../rules/EnclosureRules.js';
import { PathRules } from '../rules/PathRules.js';
import { PlacementRules, PlacementResult } from '../rules/PlacementRules.js';
import { Phase } from '../match/Entities.js';
import { Command } from '../match/Commands.js';

const INT_MAX = 2147483647, INT_MIN = -2147483648;
/** AUTHORED: squares beyond the castle's ring within which a bot hero deals with a grunt or a grunt's bomb (BOMBS_SPEC task: within 3 squares of its walls). */
const BOMB_ZONE = 3;

function castleOf(m, id) {
  for (const c of m.grid.castles) if (c.id === id) return c;
  return null;
}

/** The bounding box of a castle's squares, {x0, y0, x1, y1}. */
function box(c) {
  let x0 = INT_MAX, y0 = INT_MAX, x1 = INT_MIN, y1 = INT_MIN;
  for (const cell of c.cells) { x0 = Math.min(x0, cell.x); y0 = Math.min(y0, cell.y); x1 = Math.max(x1, cell.x); y1 = Math.max(y1, cell.y); }
  return { x0, y0, x1, y1 };
}

/** A simple player that makes the commands a person would, from what the model shows - used for scripted matches (tests, the
 *  attract demo) and as a stand-in for a slot nobody holds. It only ever SENDS commands; the rules judge them like anyone's.
 *  Deterministic: same model, same commands. Acts once every `every` ticks, offset by slot, like a person who does not press every
 *  frame. */
export class CastleBot {
  constructor(slot) {
    this.slot = slot;
    this.every = 8;
    this._seq = 0;
  }

  /** The commands this bot sends this tick (at most one), each stamped with `arrival`. */
  *think(m, arrival) {
    const p = m.player(this.slot);
    if (!p.connected || m.ended || (m.tick + this.slot * 2) % this.every !== 0) return;
    switch (m.phase) {
      case Phase.Decide:
        if (this.slot === 0) yield Command.decide(this.slot, ++this._seq, true, arrival);   // a bot team always continues
        break;
      case Phase.Claim:
        if (p.claimedCastle === 0)
          for (const c of m.grid.castles)
            if (!this._takenByOther(m, c.id)) { yield Command.claim(this.slot, ++this._seq, c.cells[0], arrival); return; }
        break;
      case Phase.Cannons:
        if (p.cannonsToPlace > 0) {
          const spot = this._cannonSpot(m, p.claimedCastle);
          if (spot !== null) yield Command.placeCannon(this.slot, ++this._seq, spot, arrival);
          else yield Command.ready(this.slot, ++this._seq, arrival);
        }
        break;
      case Phase.Battle: {
        const bw = m.options.bombs ? this._bombWork(m, p, arrival) : this._swordWork(m, p, arrival);
        if (bw.handled) { if (bw.cmd !== null) yield bw.cmd; break; }
        let aim = null, best = INT_MAX;
        for (const s of m.ships) {
          if (!s.alive || s.allied) continue;
          const d = this._distToOwn(m, s.at);
          if (d < best) { best = d; aim = s; }
        }
        for (const k of m.serpents)        // a serpent with its head up, nearer than every ship: shoot it
          if (k.alive && k.up && this._distToOwn(m, k.at) < best) { yield Command.fire(this.slot, ++this._seq, k.at, arrival); return; }
        if (aim !== null) {
          // a big ship: walk the balls over its squares in turn
          const n = aim.size * aim.size;
          let i = (Math.trunc(m.tick / this.every) + this.slot) % n;
          // The bomb rule set (this game's own bot play): skip the squares with nothing left to hit. Measured 11-11 (24 bot campaigns of
          // the full rules on the test maps): the C#'s walk is a fixed cycle of the tick, and with 1-3 cannons reloading it can fall in
          // step with them so that the one square still holding a live gun is never the one aimed at, while a ball is always in the air -
          // and a battle closes only with no ball in the air: 3 of 24 battles never ended. The normal and full rules keep the C#'s walk
          // exactly (the parity traces hold it; test/parity/traces/full_campaign_1p_stuck.json.gz is the C# itself stuck the same way).
          if (m.options.bombs && aim.parts !== null)
            for (let k = 0; k < n && aim.parts[i] <= 0; k++) i = (i + 1) % n;
          yield Command.fire(this.slot, ++this._seq, new Cell(aim.at.x + i % aim.size, aim.at.y + Math.trunc(i / aim.size)), arrival);
        }
        break;
      }
      case Phase.Repair: {
        const rw = m.options.bombs ? this._bombWork(m, p, arrival) : this._swordWork(m, p, arrival);
        if (rw.handled) { if (rw.cmd !== null) yield rw.cmd; break; }
        const place = this._repairMove(m, this._working(m, p.claimedCastle));
        if (place !== null) yield Command.placeWall(this.slot, ++this._seq, m.heldShapeId(this.slot), place.value, place.key, arrival);
        break;
      }
    }
  }

  /** The hero's sword: a grunt near the bot's castle is cut down (draw, then swing at it); with none near, the sword goes away
   *  again. handled false when the tool is in hand and nothing calls for the sword; true (cmd maybe null) while the sword has this
   *  tick - a sword still recovering must not fall through to a build or a shot that would be refused. */
  _swordWork(m, p, arrival) {
    const home = castleOf(m, p.claimedCastle);
    let near = null;
    if (home !== null) {
      const { x0, y0, x1, y1 } = box(home);
      const reach = m.rules.ringRadius + 2;
      let bestD = INT_MAX;
      for (const g of m.grunts) {
        if (!g.alive) continue;
        const dx = g.at.x < x0 ? x0 - g.at.x : g.at.x > x1 ? g.at.x - x1 : 0, dy = g.at.y < y0 ? y0 - g.at.y : g.at.y > y1 ? g.at.y - y1 : 0;
        const d = Math.max(dx, dy);
        if (d <= reach && d < bestD) { bestD = d; near = g; }
      }
    }
    let cmd = null;
    if (near !== null) {
      if (!p.sword) cmd = Command.switchMode(this.slot, ++this._seq, arrival);
      else if (p.swordLeft === 0) cmd = Command.strike(this.slot, ++this._seq, near.at, arrival);
      return { handled: true, cmd };
    }
    if (!p.sword) return { handled: false, cmd: null };
    cmd = Command.switchMode(this.slot, ++this._seq, arrival);
    return { handled: true, cmd };
  }

  /** The bomb rule set's hero work, greedy: (1) a bomb in its hands is thrown at the nearest grunt in range, else into the sea, else
   *  put out; (2) a grunt's bomb within BOMB_ZONE squares of its castle's ring is put out or - every other one - picked up; (3) a
   *  grunt near the castle gets a bomb of its own on its square, unless that blast would reach one of the bot's own bricks, and only
   *  one of its bombs is lit at a time; (4) after a drop it walks home out of the blast. With nothing to do the bomb tool goes away
   *  (the phase's own tool again). Same contract as _swordWork: handled false = nothing for the hero to do, so the phase's work goes on. */
  _bombWork(m, p, arrival) {
    const home = castleOf(m, p.claimedCastle);
    if (home === null) return { handled: false, cmd: null };
    const { x0, y0, x1, y1 } = box(home);
    const zone = m.rules.ringRadius + BOMB_ZONE;
    const away = (at) => { const dx = at.x < x0 ? x0 - at.x : at.x > x1 ? at.x - x1 : 0, dy = at.y < y0 ? y0 - at.y : at.y > y1 ? at.y - y1 : 0; return Math.max(dx, dy); };
    const S = this.slot, say = (cmd) => ({ handled: true, cmd });
    if (p.stunLeft > 0) return say(null);
    const mine = m.bombs.filter((b) => b.alive && b.owner === S && b.carriedBy < 0 && b.flightLeft === 0);
    // (1) carrying: throw
    if (p.carrying !== 0) {
      const from = p.heroAt, tgt = this._throwAt(m, from);
      if (!p.sword) return say(Command.switchMode(S, ++this._seq, arrival));
      if (tgt !== null) return say(Command.throwBomb(S, ++this._seq, from, tgt, arrival));
      return say(Command.defuseBomb(S, ++this._seq, from, arrival));
    }
    // (4) walk out of the blast of its own bomb
    if (p.heroAt !== null)
      for (const b of mine)
        if (Math.max(Math.abs(b.at.x - p.heroAt.x), Math.abs(b.at.y - p.heroAt.y)) <= 2) return say(Command.moveHero(S, ++this._seq, home.cells[0], arrival));
    // (2) a grunt's bomb near the walls
    let bomb = null, bestD = INT_MAX;
    for (const b of m.bombs) {
      if (!b.alive || b.owner !== -1 || b.carriedBy >= 0 || b.flightLeft > 0) continue;
      const d = away(b.at);
      if (d <= zone && d < bestD) { bestD = d; bomb = b; }
    }
    if (bomb !== null) {
      if (bomb.id % 2 === 1 && bomb.fuseLeft > 30) return say(Command.pickUpBomb(S, ++this._seq, bomb.at, arrival));
      return say(Command.defuseBomb(S, ++this._seq, bomb.at, arrival));
    }
    // (3) a grunt near the castle: a bomb of its own, where it cannot hurt the bot's bricks
    if (mine.length === 0 && p.bombs > 0) {
      let g0 = null;
      bestD = INT_MAX;
      for (const g of m.grunts) {
        if (!g.alive) continue;
        const d = away(g.at);
        if (d <= zone && d < bestD && this._safeToBlast(m, g.at)) { bestD = d; g0 = g; }
      }
      if (g0 !== null) {
        if (!p.sword) return say(Command.switchMode(S, ++this._seq, arrival));
        return say(Command.dropBomb(S, ++this._seq, g0.at, arrival));
      }
    }
    if (!p.sword) return { handled: false, cmd: null };
    return say(Command.switchMode(S, ++this._seq, arrival));
  }

  /** No wall square (anyone's) within two squares of `at` along its four lines, and the square is dry land: a bomb dropped there
   *  breaks no brick. */
  _safeToBlast(m, at) {
    const g = m.grid;
    if (!g.in(at.x, at.y) || g.terrainAt(at.x, at.y) !== Terrain.Land) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      for (let k = 1; k <= m.rules.bombArm; k++) {
        const x = at.x + dx * k, y = at.y + dy * k;
        if (!g.in(x, y)) break;
        const o = g.occupantAt(x, y);
        if (o === Occupant.Wall || o === Occupant.Castle || o === Occupant.Cannon) return false;
        if (o !== Occupant.Empty && o !== Occupant.Rubble && o !== Occupant.Graveyard) break;   // a rock stops the arm (and is hit)
      }
    return true;
  }

  /** Where to throw a bomb from `from`: the nearest grunt within the throw range, else the nearest sea square within it. null = none. */
  _throwAt(m, from) {
    const range = m.rules.throwRange, g = m.grid;
    let best = null, bestD = INT_MAX;
    for (const k of m.grunts) {
      if (!k.alive) continue;
      const d = Math.abs(k.at.x - from.x) + Math.abs(k.at.y - from.y);
      if (d <= range && d < bestD) { bestD = d; best = k.at; }
    }
    if (best !== null) return best;
    for (let y = from.y - range; y <= from.y + range; y++)
      for (let x = from.x - range; x <= from.x + range; x++) {
        const d = Math.abs(x - from.x) + Math.abs(y - from.y);
        if (d <= range && d < bestD && g.in(x, y) && g.terrainAt(x, y) === Terrain.Water) { bestD = d; best = new Cell(x, y); }
      }
    return best;
  }

  /** The castle to build round: its own; or, with none (a ruined home), the castles in turn by slot, skipping ruins and those
   *  already shut in. 0 = none. */
  _working(m, claimed) {
    const own = castleOf(m, claimed);
    if (own !== null && !own.ruined) return claimed;
    const shut = EnclosureRules.enclosedCastleIds(m.grid);
    const open = [];
    for (const c of m.grid.castles) if (!c.ruined && !shut.includes(c.id)) open.push(c);
    if (open.length === 0) return 0;
    return open[this.slot % open.length].id;
  }

  _takenByOther(m, castleId) {
    for (let i = 0; i < m.playerCount; i++) if (i !== this.slot && m.player(i).claimedCastle === castleId) return true;
    return false;
  }

  _distToOwn(m, at) {
    let best = INT_MAX;
    for (const k of m.cannons) if (k.alive && k.owner === this.slot) best = Math.min(best, PathRules.manhattan(k.topLeft, at));
    return best;
  }

  /** The nearest empty 2x2 inside the bot's OWN territory to its castle (a team-mate's walls refuse it). null = none. */
  _cannonSpot(m, castleId) {
    const g = m.grid, terr = EnclosureRules.map(g);
    const c = castleOf(m, castleId); if (c === null) return null;
    const { x0, y0 } = box(c);
    let best = null, bestD = INT_MAX;
    for (let y = 0; y < g.height - 1; y++)
      for (let x = 0; x < g.width - 1; x++) {
        let ok = true;
        for (let dy = 0; dy < 2 && ok; dy++)
          for (let dx = 0; dx < 2 && ok; dx++) {
            const cx = x + dx, cy = y + dy;
            ok = g.terrainAt(cx, cy) === Terrain.Land && g.occupantAt(cx, cy) === Occupant.Empty && terr.holds(this.slot, terr.regionAt(cx, cy)) && !m.gruntAt(cx, cy);
          }
        if (!ok) continue;
        const d = Math.abs(x - x0) + Math.abs(y - y0);
        if (d < bestD) { bestD = d; best = new Cell(x, y); }
      }
    return best;
  }

  /** Close the castle again, by laying pieces on the castle's RING. The target squares are the ring's empty squares, and round every
   *  ring square that cannot take a wall the squares one step further out that touch it - and again further out where those are
   *  blocked too - so a breach is walled round. Each legal placement of the held piece is ranked: one that SHUTS the castle in
   *  first; then 3 per target square it covers, less 2 per square it wastes off the targets and 5 per square inside the ring; then
   *  the smallest leak (ground inside the ring still open to the sea). A placement that neither shuts it nor covers a target is not
   *  made: the piece is held. Returns {key: anchor Cell, value: quarter turns} or null. */
  _repairMove(m, castleId) {
    const g = m.grid, c = castleOf(m, castleId); if (c === null) return null;
    if (EnclosureRules.enclosedCastleIds(g).includes(castleId)) return null;      // already shut in: nothing to repair
    const { x0, y0, x1, y1 } = box(c);
    const r = m.rules.ringRadius;
    const ring = (x, y) => {
      const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      return Math.max(dx, dy);
    };
    const takes = (x, y) => g.in(x, y) && g.terrainAt(x, y) === Terrain.Land
      && (g.occupantAt(x, y) === Occupant.Empty || g.occupantAt(x, y) === Occupant.Rubble) && !m.gruntAt(x, y);
    const isWall = (x, y) => g.in(x, y) && g.occupantAt(x, y) === Occupant.Wall;
    // the targets: ring r's open squares, then a detour ring by ring round whatever is blocked
    const target = new Set();
    const blocked = new Set();
    for (let k = r; k <= r + 3; k++)
      for (let y = y0 - k; y <= y1 + k; y++)
        for (let x = x0 - k; x <= x1 + k; x++) {
          if (ring(x, y) !== k || !g.in(x, y) || isWall(x, y)) continue;
          let wanted = k === r;
          for (let dy = -1; dy <= 1 && !wanted; dy++)
            for (let dx = -1; dx <= 1 && !wanted; dx++)
              wanted = blocked.has((y + dy) * g.width + (x + dx)) && ring(x + dx, y + dy) === k - 1;
          if (!wanted) continue;
          if (takes(x, y)) target.add(y * g.width + x); else blocked.add(y * g.width + x);
        }
    if (target.size === 0) return null;
    const leak = (extra) => {
      const outside = EnclosureRules.outside(g, extra); let n = 0;
      let shut = true;
      for (const k of c.cells) if (outside[k.y * g.width + k.x]) shut = false;
      for (let y = Math.max(0, y0 - r + 1); y <= Math.min(g.height - 1, y1 + r - 1); y++)
        for (let x = Math.max(0, x0 - r + 1); x <= Math.min(g.width - 1, x1 + r - 1); x++)
          if (outside[y * g.width + x]) n++;
      return { n, shut };
    };
    const shape = m.catalog.byId(m.heldShapeId(this.slot));
    const gruntAt = (x, y) => m.gruntAt(x, y);
    let best = null;
    let bestShut = false, bestScore = INT_MIN, bestLeak = INT_MAX;
    for (let t = 0; t < 4; t++)
      for (let y = y0 - r - 5; y <= y1 + r + 5; y++)
        for (let x = x0 - r - 5; x <= x1 + r + 5; x++) {
          const at = new Cell(x, y);
          if (PlacementRules.check(g, shape, t, at, gruntAt) !== PlacementResult.Ok) continue;
          const cells = PlacementRules.cellsOf(shape, t, at);
          const extra = new Set();
          let score = 0, hits = 0;
          for (const cell of cells) {
            const i = cell.y * g.width + cell.x;
            extra.add(i);
            if (target.has(i)) { score += 3; hits++; }
            else score -= ring(cell.x, cell.y) < r ? 5 : 2;
          }
          if (hits === 0) continue;              // covers no target: hold the piece
          const lk = leak(extra);                // the flood only for placements on target
          const better = lk.shut !== bestShut ? lk.shut
                       : score !== bestScore ? score > bestScore
                       : lk.n < bestLeak;
          if (best === null || better) { bestShut = lk.shut; bestScore = score; bestLeak = lk.n; best = { key: at, value: t }; }
        }
    return best;
  }
}
