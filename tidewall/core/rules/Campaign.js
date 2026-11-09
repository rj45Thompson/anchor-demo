// port of model/Rules/Campaign.cs
import { Fnv64 } from '../grid.js';
import { GameRules, BombRules, RoundSpec, RoundTable } from './GameRules.js';
import { PieceCatalog } from '../pieces.js';

/** The setup screen's choice of ruleset. Only Normal (0) is ported; 1 is the private model's bigger ruleset, which this game
 *  does not play (a match refuses any other value). */
export const GameType = Object.freeze({ Normal: 0 });
/** Recruit starts at level 1, Veteran at level 2 with a starting bonus. */
export const Battlefield = Object.freeze({ Recruit: 0, Veteran: 1 });
/** Easy / Medium / Tough: how much of the round table's repair time a team gets. */
export const Difficulty = Object.freeze({ Easy: 0, Medium: 1, Tough: 2 });

export class GameOptions {
  /** The C# default type is the bigger ruleset; this port has only Normal, so that is the default here. */
  constructor({ type = GameType.Normal, field = Battlefield.Recruit, level = Difficulty.Easy, startRound = 0, bombs = false } = {}) {
    if (typeof bombs !== 'boolean') throw new TypeError('GameOptions.bombs is true or false, got ' + bombs);
    this.type = type;
    this.field = field;
    this.level = level;
    /** Not on the setup screen: start at this round (tests, demos). 0 = by the battlefield. */
    this.startRound = startRound;
    /** The bomb rule set (BOMBS_SPEC.md): bombs are the only ground attack, heroes carry, throw and defuse them, a shop, longer
     *  rounds. false = the ported base rules exactly (the parity traces). Not part of hashInto: the match hashes its bomb state itself. */
    this.bombs = bombs;
  }

  /** Always false in this port (the C# `Super` property). */
  get super() { return this.type !== GameType.Normal; }

  /** 100 %, 80 %, 65 % of the round table's repair time at Easy, Medium, Tough. */
  get repairPercent() { return this.level === Difficulty.Easy ? 100 : this.level === Difficulty.Medium ? 80 : 65; }

  hash(h) { return this.hashInto(Fnv64.fromBigInt(h)).toBigInt(); }
  hashInto(f) { f.mix(this.type); f.mix(this.field); f.mix(this.level); return f; }
}

const S = GameRules.TicksPerSecond;

const BOMB_RULES = BombRules.default();   // the bomb rule set's numbers the table reads (ship counts), one place with the rules

function wave(map, battleSeconds, white, grey, bombs) {
  // BOMBS_SPEC.md: with bombs CANNONS is 25 s (was 15), BATTLE 6 s longer (24 + i against 18 + i), REPAIR 75 s (was 25);
  // UC-S1: with bombs the islands are bigger, so the wave carries shipsBaseBonus more ships and shipsPerExtraPlayer per extra player
  const r = new RoundSpec((bombs ? 25 : 15) * S, (battleSeconds + (bombs ? 6 : 0)) * S, (bombs ? 75 : 25) * S,
    white + (bombs ? BOMB_RULES.shipsBaseBonus : 0), bombs ? BOMB_RULES.shipsPerExtraPlayer : 1, 0, grey);
  r.map = map;
  return r;
}

/** The campaigns. */
export const Campaign = Object.freeze({
  /** The normal campaign: eight waves on four maps, two rounds per map. `maps` names the four maps (level 1..4), because the
   *  private model's maps are not ported - the host generates its own and loads them by these names (MatchModel.startOn).
   *  The private model's normal table also sails an extra ship kind from round 3; this game has none, so it is left out here
   *  (the parity traces are recorded against the private table with that kind's count set to zero). */
  normal(maps, bombs = false) {
    if (!Array.isArray(maps) || maps.length !== 4 || maps.some(m => typeof m !== 'string' || m.length === 0))
      throw new Error('the normal campaign is fought on four maps: pass their four names, got ' + JSON.stringify(maps));
    const [a, b, c, d] = maps;
    return new RoundTable([
      wave(a, 20, 3, 0, bombs), wave(a, 22, 3, 1, bombs), wave(b, 24, 4, 1, bombs), wave(b, 26, 4, 2, bombs),
      wave(c, 24, 4, 1, bombs), wave(c, 26, 4, 2, bombs), wave(d, 28, 5, 2, bombs), wave(d, 30, 6, 2, bombs),
    ], false);
  },

  /** The table for these options (C# Campaign.For). Only the normal ruleset is ported. */
  for(o, maps) {
    if (o.super) throw new Error('only the normal ruleset is ported (GameOptions.type ' + o.type + ')');
    return Campaign.normal(maps, o.bombs);
  },

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
