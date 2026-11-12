// port of model/Rules/Campaign.cs
import { Fnv64 } from '../grid.js';
import { GameRules, BombRules, RoundKind, RoundSpec, RoundTable } from './GameRules.js';
import { PieceCatalog } from '../pieces.js';

/** The setup screen's choice of ruleset: Normal (0), or Full (1): the land (rocks, trees, swamps, lakes, houses, graveyards, pits),
 *  the fireship, gunboat, dreadnought and serpent, ironclad waves, the Mortar and the Kite, treasure squares, the growing bag and
 *  the six-map campaign with its Challenge rounds. */
export const GameType = Object.freeze({ Normal: 0, Full: 1 });
/** Recruit starts at level 1, Veteran at level 2 with a starting bonus. */
export const Battlefield = Object.freeze({ Recruit: 0, Veteran: 1 });
/** Easy / Medium / Tough: how much of the round table's repair time a team gets. */
export const Difficulty = Object.freeze({ Easy: 0, Medium: 1, Tough: 2 });

export class GameOptions {
  /** The C#'s default type is the full rules; this game's default stays Normal (the public game it already plays), so a caller who
   *  wants the full rules says so: new GameOptions({ type: GameType.Full }). */
  constructor({ type = GameType.Normal, field = Battlefield.Recruit, level = Difficulty.Easy, startRound = 0, bombs = false } = {}) {
    if (typeof bombs !== 'boolean') throw new TypeError('GameOptions.bombs is true or false, got ' + bombs);
    if (type !== GameType.Normal && type !== GameType.Full) throw new Error('GameOptions.type is a GameType (0 Normal, 1 Full), got ' + type);
    this.type = type;
    this.field = field;
    this.level = level;
    /** Not on the setup screen: start at this round (tests, demos). 0 = by the battlefield. */
    this.startRound = startRound;
    /** The bomb rule set (BOMBS_SPEC.md): bombs are the only ground attack, heroes carry, throw and defuse them, a shop, longer
     *  rounds. false = the ported base rules exactly (the parity traces). Not part of hashInto: the match hashes its bomb state itself. */
    this.bombs = bombs;
  }

  /** The full rules are on (GameType.Full). */
  get full() { return this.type === GameType.Full; }
  /** The same, by the name the menus and their tests already read. */
  get super() { return this.full; }

  /** 100 %, 80 %, 65 % of the round table's repair time at Easy, Medium, Tough. */
  get repairPercent() { return this.level === Difficulty.Easy ? 100 : this.level === Difficulty.Medium ? 80 : 65; }

  hash(h) { return this.hashInto(Fnv64.fromBigInt(h)).toBigInt(); }
  hashInto(f) { f.mix(this.type); f.mix(this.field); f.mix(this.level); return f; }
}

const S = GameRules.TicksPerSecond;

const BOMB_RULES = BombRules.default();   // the bomb rule set's numbers the table reads (ship counts), one place with the rules

function wave(map, battleSeconds, white, grey, bombs, boss = false, extra = null) {
  // BOMBS_SPEC.md: with bombs CANNONS is 25 s (was 15), BATTLE 6 s longer (24 + i against 18 + i), REPAIR 75 s (was 25);
  // UC-S1: with bombs the islands are bigger, so the wave carries shipsBaseBonus more ships and shipsPerExtraPlayer per extra player
  const r = new RoundSpec((bombs ? 25 : 15) * S, (battleSeconds + (bombs ? 6 : 0)) * S, (bombs ? 75 : 25) * S,
    white + (bombs ? BOMB_RULES.shipsBaseBonus : 0), bombs ? BOMB_RULES.shipsPerExtraPlayer : 1, 0, grey);
  r.map = map;
  r.bossShips = bombs && boss ? 1 : 0;                 // UC-B1: only the bomb rule set sails a boss (the base rules stay as ported)
  if (extra !== null) {                                // the full rules' wave extras (C# Campaign.Wave's named arguments)
    r.fireships = extra.fireships ?? 0; r.gunboats = extra.gunboats ?? 0;
    r.serpent = extra.serpent ?? false; r.dreadnought = extra.dreadnought ?? false; r.ironclad = extra.ironclad ?? false;
  }
  return r;
}

/** A Challenge round (C# Campaign.Challenge): no ships, a building field. Its 30 s of REPAIR is the C#'s; BOMBS_SPEC.md's longer
 *  REPAIR names the wave rounds only and says nothing of a Challenge round (ABSENT there), so the bomb rule set keeps the 30 s. */
function challenge(map) {
  const r = new RoundSpec(0, 0, 30 * S, 0, 0, 0, 0);
  r.map = map; r.kind = RoundKind.Challenge;
  return r;
}

/** The campaigns. */
export const Campaign = Object.freeze({
  /** The normal campaign: eight waves on four maps, two rounds per map. `maps` names the four maps (level 1..4), because the
   *  private model's maps are not ported - the host generates its own and loads them by these names (MatchModel.startOn).
   *  The private model's normal table also sails fireships from round 3 (1, 1, 1, 1, 2, 2); this game's normal campaign leaves them
   *  out (the game it published has none), and the parity traces record the private table with that count set to zero. Putting them
   *  back is RJ's call: it is a table change only (RoundSpec.fireships), the fireship itself is ported. */
  normal(maps, bombs = false) {
    if (!Array.isArray(maps) || maps.length !== 4 || maps.some(m => typeof m !== 'string' || m.length === 0))
      throw new Error('the normal campaign is fought on four maps: pass their four names, got ' + JSON.stringify(maps));
    const [a, b, c, d] = maps;
    return new RoundTable([
      // UC-B1: each map's second wave is its boss round (bomb rules only)
      wave(a, 20, 3, 0, bombs), wave(a, 22, 3, 1, bombs, true), wave(b, 24, 4, 1, bombs), wave(b, 26, 4, 2, bombs, true),
      wave(c, 24, 4, 1, bombs), wave(c, 26, 4, 2, bombs, true), wave(d, 28, 5, 2, bombs), wave(d, 30, 6, 2, bombs, true),
    ], false);
  },

  /** The full rules' campaign (C# Campaign.Super): four levels on four maps with a Challenge round after each of the first two, seven
   *  waves, then the boss wave (the dreadnought). `maps` names its six maps in the order the campaign reaches them: level 1, the first
   *  Challenge field, level 2, the second Challenge field, level 3, level 4. With `bombs` the wave rounds take the bomb rule set's
   *  lengths and ship counts exactly as Campaign.normal's do (the Challenge rounds keep theirs, see challenge()); the bomb rules' own
   *  boss ship sails in no round here: this campaign's boss is the dreadnought, wave 8. */
  full(maps, bombs = false) {
    if (!Array.isArray(maps) || maps.length !== 6 || maps.some(m => typeof m !== 'string' || m.length === 0) || new Set(maps).size !== 6)
      throw new Error('the full campaign is fought on six different maps (level 1, challenge 1, level 2, challenge 2, level 3, level 4): pass their six names, got ' + JSON.stringify(maps));
    const [a, ca, b, cb, c, d] = maps;
    return new RoundTable([
      wave(a, 20, 3, 0, bombs, false, {}),                                                       // wave 1: one-sail ships
      wave(a, 22, 3, 1, bombs, false, {}),                                                       // wave 2: the first two-sail lander
      challenge(ca),
      wave(b, 24, 3, 1, bombs, false, { fireships: 1 }),                                         // wave 3: a fireship - burning pits
      wave(b, 26, 3, 2, bombs, false, { fireships: 1, gunboats: 1 }),                            // wave 4: the first gunboat
      challenge(cb),
      wave(c, 28, 4, 2, bombs, false, { fireships: 1, serpent: true, ironclad: true }),          // wave 5: ironclads, the serpent rises
      wave(c, 30, 4, 2, bombs, false, { fireships: 2, gunboats: 1, ironclad: true }),            // wave 6
      wave(d, 32, 5, 2, bombs, false, { fireships: 2, gunboats: 1, ironclad: true }),            // wave 7: the last fleet
      wave(d, 60, 2, 0, bombs, false, { fireships: 1, dreadnought: true, ironclad: true }),      // wave 8: the boss - the dreadnought
    ], false);
  },

  /** The table for these options (C# Campaign.For): the full campaign on six maps, or the normal one on four. */
  for(o, maps) { return o.full ? Campaign.full(maps, o.bombs) : Campaign.normal(maps, o.bombs); },

  /** How many map names Campaign.for(o, names) takes. */
  mapCount(o) { return o.full ? 6 : 4; },

  /** Veteran starts at level 2: the first round on the table's second map. */
  firstRound(t, o) {
    if (o.startRound > 0) return Math.min(o.startRound, t.count);
    if (o.field === Battlefield.Recruit) return 1;
    for (let r = 1; r <= t.count; r++) if (t.levelOf(r) === 2) return r;
    return 1;
  },

  /** The rules with the options folded in: the repair time is read from the table and scaled when a round starts. */
  rulesFor(o) { return o.bombs ? BombRules.default() : GameRules.default(); },

  /** The piece set for these options: the bomb rule set deals the smaller Tidewall pieces (1-4 squares), the base rules the ported
   *  starting set (so the parity traces keep their hashes). */
  catalogFor(o) { return o.bombs ? PieceCatalog.tidewall() : PieceCatalog.default(); },
});
