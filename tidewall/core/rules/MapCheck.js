// port of model/Maps/MapLibrary.cs (the MapCheck class only: the map data in that file is not ported)
import { Cell } from '../cell.js';
import { GridModel, Terrain, Occupant } from '../grid.js';

const OCCUPANT_NAME = Object.fromEntries(Object.entries(Occupant).map(([k, v]) => [v, k]));

/** What makes a map playable, checked when it is loaded - a map that fails is refused, never half-played. */
export const MapCheck = Object.freeze({
  MaxWidth: 64,
  MaxHeight: 64,

  /** Every problem, in words; empty = playable. challenge: a field where no ships come, so the sea checks do not apply. */
  problems(g, rules, challenge = false) {
    const p = [];
    if (g.width > MapCheck.MaxWidth || g.height > MapCheck.MaxHeight)
      p.push('the map is ' + g.width + ' x ' + g.height + ': larger than the camera scrolls (' + MapCheck.MaxWidth + ' x ' + MapCheck.MaxHeight + ')');
    if (g.castles.length === 0) p.push('the map has no castle');
    const spawn = [];
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++)
        if ((x === 0 || y === 0 || x === g.width - 1 || y === g.height - 1) && g.terrainAt(x, y) === Terrain.Water) spawn.push(new Cell(x, y));
    if (spawn.length === 0 && !challenge) p.push("no water on the map's edge: ships cannot arrive");
    // every castle's starting ring must be whole land (else the free ring cannot shut it in) and reachable by some ship
    const reach = waterReach(g, spawn);
    for (const c of g.castles) {
      let x0 = 2147483647, y0 = 2147483647, x1 = -2147483648, y1 = -2147483648;
      for (const cell of c.cells) { x0 = Math.min(x0, cell.x); y0 = Math.min(y0, cell.y); x1 = Math.max(x1, cell.x); y1 = Math.max(y1, cell.y); }
      const r = rules.ringRadius; let shipCanReach = false;
      for (let y = y0 - r; y <= y1 + r; y++)
        for (let x = x0 - r; x <= x1 + r; x++) {
          const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
          if (Math.max(dx, dy) > r) continue;
          if (!g.in(x, y) || g.terrainAt(x, y) !== Terrain.Land) { p.push('castle ' + c.id + ': square (' + x + ',' + y + ') of its ring area is not land'); continue; }
          const o = g.occupantAt(x, y);       // a rock or tree in the ring area would leave a gap in the free ring
          if (o !== Occupant.Empty && o !== Occupant.Castle) { p.push('castle ' + c.id + ': square (' + x + ',' + y + ') of its ring area holds ' + OCCUPANT_NAME[o]); continue; }
          if (Math.max(dx, dy) === r && reach.some(w => Math.abs(w.x - x) + Math.abs(w.y - y) <= rules.shipRange)) shipCanReach = true;
        }
      if (!shipCanReach && !challenge) p.push('castle ' + c.id + ': no ship can come within range of its ring (REQ-SHIP-05)');
    }
    return p;
  },

  /** Parse and check: the board, or an Error naming every problem. */
  loadChecked(rows, rules, challenge = false) {
    const g = GridModel.fromAscii(rows);
    const p = MapCheck.problems(g, rules, challenge);
    if (p.length > 0) throw new Error('the map is not playable: ' + p.join('; '));
    return g;
  },
});

function waterReach(g, spawn) {
  const seen = new Uint8Array(g.width * g.height); const q = []; const all = [];
  for (const s of spawn) { seen[s.y * g.width + s.x] = 1; q.push(s); }
  const dx = [1, -1, 0, 0], dy = [0, 0, 1, -1];
  for (let qh = 0; qh < q.length; qh++) {
    const c = q[qh]; all.push(c);
    for (let k = 0; k < 4; k++) {
      const x = c.x + dx[k], y = c.y + dy[k];
      if (!g.in(x, y) || seen[y * g.width + x] || g.terrainAt(x, y) !== Terrain.Water) continue;
      seen[y * g.width + x] = 1; q.push(new Cell(x, y));
    }
  }
  return all;
}
