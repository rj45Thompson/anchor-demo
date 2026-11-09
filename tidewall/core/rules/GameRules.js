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
}
