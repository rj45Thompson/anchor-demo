// port of model/Rules/GameRules.cs
//
// Only the fields the NORMAL game reads are ported. The private model's GameRules also carries the bigger ruleset's numbers
// (its extra ships and creatures, land growth, emplacements, bonus squares); none is read when GameOptions.super is false, so
// none is here. test/parity/run.mjs refuses a trace whose rules carry a field this class lacks unless that field is named in its
// NOT_PORTED list, so a new rule in the model cannot be dropped silently.

export class GameRules {
  static TicksPerSecond = 30;

  constructor() {
    const S = GameRules.TicksPerSecond;
    this.wallHealth = 2;                 // REQ-PLACE-03
    this.cannonHealth = 3;               // REQ-CANNON-04
    this.cannonReloadTicks = 45;         // REQ-CANNON-03
    this.shotBaseTicks = 6;              // REQ-FIRE-02: travel = base + per-cell * distance
    this.shotTicksPerCell = 2;
    this.playerShotDamage = 1;           // REQ-FIRE-03
    this.shipShotDamage = 1;

    this.shipTicksPerCell = 20;          // REQ-SHIP-02
    this.shipRange = 6;                  // REQ-SHIP-07, Manhattan cells
    this.shipReloadTicks = 75;           // REQ-SHIP-03

    this.gruntTicksPerCell = 24;         // REQ-GRUNT-02
    this.gruntBiteTicks = 45;
    this.swordTicks = 12;                // a swing every 0.4 s (REQ-HERO-03)
    this.swordReach = 1;                 // the hero's square and the eight round it
    this.pointsGruntSworded = 25;
    this.gruntLandingReach = 2;          // REQ-GRUNT-04, Manhattan cells from the ship to land

    this.ringRadius = 3;                 // REQ-PHASE-07: the starting ring stands this many cells off the castle
    this.claimTicks = 15 * S;
    this.scoreTicks = 3 * S;

    this.homeCastleCannons = 2;          // REQ-REF-02: a player's own castle grants two when it is enclosed
    this.otherCastleCannons = 1;         // REQ-REF-02: every other enclosed castle grants one
    this.twoSailHealth = 3;              // REQ-REF-07: double-sailed ships take three hits
    this.gruntsPerLanding = 2;           // REQ-REF-07: grunts a two-sail ship puts ashore

    this.lives = 3;                      // REQ-SCORE-02: the first try + two continues

    // scoring (REQ-SCORE-10)
    this.pointsShipHit = 16;
    this.pointsGruntKilled = 25;
    this.pointsGruntSurrounded = 25;
    this.pointsHouseDestroyed = 25;
    this.pointsSmallRock = 50;
    this.pointsPerEnclosedCell = 1;
    this.pointsVeteranStart = 5000;
    this.pointsHouseStep = 100;
    this.castleBonus = [0, 500, 700, 900, 1000, 1200, 1400];   // by castles enclosed; past 6: +200 each
    this.pointsUnusedContinue = 50000;
    this.pointsMedium = 100000;
    this.pointsTough = 200000;
    this.pointsCompleteNormal = 1000000;
    this.pointsClosingCredit = 50;       // co-op credit to the closer (REQ-SCORE-04)

    this.whiteShipHealth = 2;            // a one-sail ship's health when the round names none
    this.maxShips = 16;                  // at most 16 ships on the water at once
    this.castleHealth = 12;              // grunt bites that ruin a castle

    this.lastPieceGraceTicks = 4 * S;    // REPAIR's last-piece grace

    this.padDeadZone = 200;              // REQ-PLAYER-04: stick travel (of 1000) that moves nothing
    this.padCellsPerSecond = 10;         // REQ-PLAYER-04 (the host's input view reads it; the core never moves a cursor)
  }

  static default() { return new GameRules(); }
}

/** The shop's items (BOMBS_SPEC.md). Appended-only numbers; `ItemNames[k]` is the key in rules.itemCosts and player.items. */
export const ItemKind = Object.freeze({ Metal: 0, Trap: 1, BombPack: 2, BigBomb: 3 });
export const ItemNames = Object.freeze(['metal', 'trap', 'bombPack', 'bigBomb']);

/** The rules of the bomb rule set (GameOptions.bombs): the base rules plus these numbers. A SUBCLASS, so GameRules itself (and the
 *  parity traces' rules check) is untouched. Every number cites BOMBS_SPEC.md (RJ 2026-11-09); ticks are 30 to the second. */
export class BombRules extends GameRules {
  constructor() {
    super();
    // REQ-BOMB-01: fuse 90 ticks; blast = a plus, arm length 2 (big 4), drawn 8 ticks
    this.bombFuse = 90; this.bombArm = 2; this.bigBombArm = 4; this.blastTicks = 8;
    // REQ-BOMB-02: damage per blast (a normal brick has wallHealth 2, a metal one metalWallHealth 6, a castle castleHealth 12)
    this.blastBrickDamage = 1; this.blastCannonDamage = 1; this.blastCastleDamage = 3;
    this.metalWallHealth = 6;
    // REQ-BOMB-03: a hero in a blast is stunned
    this.stunTicks = 45;
    // REQ-BOMB-04: the hero's stock of bombs
    this.bombCap = 3; this.bombPackCap = 6; this.bombPackSize = 3; this.bombRegenTicks = 150;
    // REQ-BOMB-05: the hero verbs (reach in squares, king's move; throw range in Manhattan squares; flight = base + perCell * distance)
    this.pickUpReach = 1; this.defuseReach = 1; this.defuseHoldTicks = 12;   // defuseHoldTicks: the controller's B hold, read from here
    this.throwRange = 5; this.throwBaseTicks = 6; this.throwTicksPerCell = 2;
    // REQ-BOMB-06: grunts drop bombs instead of biting
    this.gruntBombCooldownTicks = 150; this.gruntFleeCells = 2; this.gruntFleeTicks = 60;
    // REQ-BOMB-07: points
    this.pointsBombKill = 25; this.pointsDefuseGruntBomb = 10; this.pointsTrapKill = 25;
    // REQ-BOMB-08: the shop (score)
    this.itemCosts = { metal: 80, trap: 40, bombPack: 30, bigBomb: 60 };
    // UC-S1 (RJ 2026-11-09, bigger islands: 4 players on a 72 x 52 board with 5-7 castles, 1-2 players on 48 x 36 with 3-5). The
    // island is bigger than the base game's, so each wave sails more ships and every enclosed home castle grants more cannons.
    // shipsBaseBonus: ships added to every wave's base count (the base table sails 2..6; a ship now crosses up to ~36 squares of
    // sea at 20 ticks a square, 12 s, before it is in range, so a wave needs a few more to keep pressure on 5-7 castles).
    this.shipsBaseBonus = 1;
    // shipsPerExtraPlayer: ships added per player beyond the first (the base table adds 1). A 4-player island holds 5-7 castles, so it
    // is attacked from more sides: 2 per extra player (RoundSpec.shipCount; the board's maxShips cap of 16 still applies).
    this.shipsPerExtraPlayer = 2;
    // the starting cannons: a home castle's enclosed ground is bigger on these islands (ring radius is unchanged), so 3 where the
    // base game grants 2; every other enclosed castle still grants otherCastleCannons (1).
    this.homeCastleCannons = 3;
  }

  static default() { return new BombRules(); }
}

export const RoundKind = Object.freeze({ Wave: 0, Challenge: 1 });

/** One round of the campaign: its phase lengths and its wave (REQ-PHASE-02, REQ-SHIP-01). `map` names the board the round is
 *  fought on (null = the board the match was built on); a new map is a new level. The private model's RoundSpec also carries the
 *  bigger ruleset's wave extras; a normal round has none, and test/parity/run.mjs refuses a trace whose round has any. */
export class RoundSpec {
  constructor(cannonsTicks, battleTicks, repairTicks, shipsBase, shipsPerExtraPlayer, shipHealth, twoSailShips) {
    this.cannonsTicks = cannonsTicks; this.battleTicks = battleTicks; this.repairTicks = repairTicks;
    this.shipsBase = shipsBase; this.shipsPerExtraPlayer = shipsPerExtraPlayer; this.shipHealth = shipHealth;
    this.twoSailShips = twoSailShips;    // REQ-REF-07: two-sail ships in this wave (they head for the shore and land grunts)
    this.map = null;
    this.kind = RoundKind.Wave;
  }

  /** REQ-SHIP-01: wave size scales with the number of players. */
  shipCount(players) { return this.shipsBase + this.shipsPerExtraPlayer * Math.max(0, players - 1); }
}

/** The campaign. Every round the game can reach is defined (REQ-PHASE-02); endless repeats the last round forever. */
export class RoundTable {
  constructor(rounds, endless) {
    this._rounds = Array.from(rounds);
    if (this._rounds.length === 0) throw new Error('a campaign has at least one round');
    this.endless = endless;
  }

  get count() { return this._rounds.length; }

  /** Round n (1-based). Past the end: the last round when endless, refused otherwise - never a guessed round. */
  for(round) {
    if (round < 1) throw new RangeError('round ' + round);
    if (round <= this._rounds.length) return this._rounds[round - 1];
    if (this.endless) return this._rounds[this._rounds.length - 1];
    throw new RangeError('round ' + round + " is past the campaign's " + this._rounds.length);
  }

  isLast(round) { return !this.endless && round >= this._rounds.length; }

  /** The level of round n: 1 + how many times a WAVE moved to a new map before it. */
  levelOf(round) {
    let level = 1; let map = this._rounds[0].map;
    for (let i = 1; i < Math.min(round, this._rounds.length); i++)
      if (this._rounds[i].kind === RoundKind.Wave && this._rounds[i].map !== null && this._rounds[i].map !== map) { level++; map = this._rounds[i].map; }
    return level;
  }

  /** How many waves (battles) the campaign has - the HUD's "WAVE 5 OF 8". */
  get waveCount() { let n = 0; for (const r of this._rounds) if (r.kind === RoundKind.Wave) n++; return n; }

  waveOf(round) {
    let n = 0;
    for (let i = 0; i < Math.min(round, this._rounds.length); i++) if (this._rounds[i].kind === RoundKind.Wave) n++;
    return n;
  }

  static default(endless = false) {
    const s = GameRules.TicksPerSecond;
    const r = [];
    for (let i = 1; i <= 8; i++)
      r.push(new RoundSpec(15 * s, (18 + i) * s, 25 * s, 2 + Math.trunc(i / 2), 1, 1 + Math.trunc(i / 3), i >= 3 ? 1 + Math.trunc((i - 3) / 2) : 0));
    return new RoundTable(r, endless);
  }

  /** The bomb rule set's longer rounds (BOMBS_SPEC.md "Round lengths"): CANNONS 25 s (was 15), BATTLE (24 + i) s (was 18 + i),
   *  REPAIR 75 s (was 25); ships as in `default` plus the bomb rules' shipsBaseBonus and shipsPerExtraPlayer (UC-S1). */
  static tidewall(endless = false, rules = BombRules.default()) {
    const s = GameRules.TicksPerSecond;
    const r = [];
    for (let i = 1; i <= 8; i++)
      r.push(new RoundSpec(25 * s, (24 + i) * s, 75 * s, 2 + Math.trunc(i / 2) + rules.shipsBaseBonus, rules.shipsPerExtraPlayer, 1 + Math.trunc(i / 3), i >= 3 ? 1 + Math.trunc((i - 3) / 2) : 0));
    return new RoundTable(r, endless);
  }
}
