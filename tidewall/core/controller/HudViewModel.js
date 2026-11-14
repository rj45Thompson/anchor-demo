// port of model/Controller/HudViewModel.cs
//
// Public-build changes (PLAN.md hard limits), each a reword, no rule changed:
//   - the full rules' banners (the dreadnought sailing in, the serpent rising, a ship recruited) and the words for the reject reasons
//     9..11 are this game's own (the C#'s named the reference game's content);
//   - the fate wording is "CONTINUE OR GIVE UP?" / "CONTINUE!" (the private build quoted an existing game's line).
// The boss fields (bossAfloat, bossHealth, bossMaxHealth) are the C#'s: they follow the full rules' dreadnought, as the C# does.
import { GameRules } from '../rules/GameRules.js';
import { Terrain, Occupant } from '../grid.js';
import { PlacementResult } from '../rules/PlacementRules.js';
import { Phase, ShipKind } from '../match/Entities.js';
import { MatchModel } from '../match/MatchModel.js';
import {
  PhaseChanged, LevelStarted, LastPieceGrace, FateAsked, FateChosen, CastleRuined, CastleRestored, FinalBonus, PlayerFell,
  LifeLost, PlacementRejected, CommandRejected, WallsPlaced, RejectReason, ShipSpawned, SerpentRose, ShipRecruited,
} from '../match/Events.js';

/** One player's card on the HUD. */
export class PlayerHud {
  constructor() {
    this.present = false; this.connected = false;
    this.cannons = 0; this.heldShapeId = 0; this.score = 0;
    this.lastMessage = '';    // why their last command was refused, in words
    this.fell = false;        // ended the last REPAIR with no castle inside their own walls
  }
}

function enumName(e, v) {
  for (const k of Object.keys(e)) if (e[k] === v) return k;
  return String(v);          // C# Enum.ToString() of a value with no name prints the number
}

/** The shared HUD as SHOWN (one per screen): team lives, round, phase and its timer, and per player the cannons to place, the held
 *  piece, the score and whether their pad is in. Punctual changes arrive through shown(event) as each event is played; ongoing
 *  values (the timer, the held piece) are read each frame by refresh(model). */
export class HudViewModel {
  constructor() {
    this.round = 1; this.lives = 0; this.teamScore = 0; this.secondsLeft = 0; this.secondsTotal = 0; this.level = 1;
    this.wave = 0; this.waves = 0; this.continues = 0;
    this.mapName = ''; this.subtitle = '';   // the level's name under the round line; the banner's second line
    this.challenge = false; this.grace = false;
    /** The full rules' dreadnought is afloat (alive), and its health now and at full: the boss bar. */
    this.bossAfloat = false; this.bossHealth = 0; this.bossMaxHealth = 0;
    this.phase = Phase.Claim;
    this.banner = '';                        // the last big announcement: "PREPARE FOR BATTLE!", "ROUND LOST", "VICTORY!"
    this.bannerTick = 0;
    this.bannerTicks = 2 * GameRules.TicksPerSecond;   // how long the banner holds: a lost round holds the whole cease fire
    this.players = [];
    for (let i = 0; i < MatchModel.MaxPlayers; i++) this.players.push(new PlayerHud());
    /** Which controller seat each player slot sits at (the cards say "P" + seat + 1). The host sets it; null: seat = slot. */
    this.seatOfSlot = null;
  }

  shown(e) {
    const T = GameRules.TicksPerSecond;
    if (e instanceof PhaseChanged) {
      this.phase = e.phase; this.round = e.round; this.bannerTick = e.tick; this.bannerTicks = 2 * T;
      this.secondsTotal = Math.trunc((e.ticks + T - 1) / T);
      for (const h of this.players) { h.lastMessage = ''; if (e.phase === Phase.Cannons) h.fell = false; }   // "reloading" belongs to the battle
      this.banner = e.phase === Phase.Claim ? 'CHOOSE YOUR HOME CASTLE' : e.phase === Phase.Cannons ? 'PLACE CANNONS'
                  : e.phase === Phase.Battle ? 'PREPARE FOR BATTLE!' : e.phase === Phase.Repair ? (this.challenge ? 'CHALLENGE ROUND - BUILD!' : 'BUILD & REPAIR')
                  : e.phase === Phase.Score ? 'CEASE FIRE!' : e.phase === Phase.Victory ? 'VICTORY!' : e.phase === Phase.Decide ? 'CONTINUE OR GIVE UP?'
                  : e.phase === Phase.Raid ? 'RAIDERS ASHORE!' : 'GAME OVER';
      // the RAID's banner says what to do (BOMBER_UC.md step 1)
      this.subtitle = e.phase === Phase.Raid ? 'BOMB THEM BEFORE THEY BLOW YOUR WALLS' : '';
    } else if (e instanceof LevelStarted) {
      this.challenge = e.challenge; this.mapName = HudViewModel.pretty(e.map); this.bannerTick = e.tick;
      this.banner = e.challenge ? 'CHALLENGE ROUND' : 'LEVEL ' + e.level; this.subtitle = this.mapName;
    } else if (e instanceof ShipSpawned && e.kind === ShipKind.Dreadnought) {
      this.banner = 'THE DREADNOUGHT!'; this.subtitle = 'SILENCE ITS GUNS, THEN STRIKE ITS FOUR HIDDEN WEAK SPOTS'; this.bannerTick = e.tick;
    } else if (e instanceof SerpentRose) {
      this.banner = 'THE SERPENT RISES!'; this.subtitle = 'SHOOT IT WHILE ITS HEAD IS ABOVE THE WAVES'; this.bannerTick = e.tick;
    } else if (e instanceof LastPieceGrace) {
      this.banner = 'LAST PIECE!'; this.subtitle = ''; this.bannerTick = e.tick;
    } else if (e instanceof FateAsked) {
      this.banner = 'CONTINUE OR GIVE UP?'; this.bannerTick = e.tick;
      this.subtitle = (this.fallenWords() === '' ? '' : this.fallenWords() + ' - ') + e.continuesLeft + (e.continuesLeft === 1 ? ' CONTINUE LEFT' : ' CONTINUES LEFT');
    } else if (e instanceof FateChosen && e.fightAgain) {
      this.banner = 'CONTINUE!'; this.subtitle = 'MORE FIREPOWER'; this.bannerTick = e.tick;
    } else if (e instanceof ShipRecruited) {
      this.banner = 'A SHIP CHANGES SIDES!'; this.subtitle = ''; this.bannerTick = e.tick;
    } else if (e instanceof CastleRuined) {
      this.banner = 'A CASTLE HAS FALLEN'; this.subtitle = 'ENCLOSE THE GRAVEYARD TO RESTORE IT'; this.bannerTick = e.tick;
    } else if (e instanceof CastleRestored) {
      this.banner = 'CASTLE RESTORED'; this.subtitle = ''; this.bannerTick = e.tick;
    } else if (e instanceof FinalBonus) {
      this.subtitle = 'BONUS ' + e.total;
    } else if (e instanceof PlayerFell && e.slot >= 0 && e.slot < this.players.length) {
      this.players[e.slot].fell = true; this.players[e.slot].lastMessage = 'no castle inside your walls';
    } else if (e instanceof LifeLost) {
      this.banner = e.livesLeft > 0 ? 'ROUND LOST' : 'NO CONTINUES LEFT'; this.bannerTick = e.tick; this.bannerTicks = 5 * T;
      this.subtitle = this.fallenWords();
    } else if (e instanceof PlacementRejected && e.slot >= 0 && e.slot < this.players.length) {
      this.players[e.slot].lastMessage = HudViewModel.placementWords(e.reason);
    } else if (e instanceof CommandRejected && e.slot >= 0 && e.slot < this.players.length) {
      this.players[e.slot].lastMessage = HudViewModel.rejectWords(e.reason);
    } else if (e instanceof WallsPlaced && e.slot >= 0 && e.slot < this.players.length) {
      this.players[e.slot].lastMessage = '';
    }
  }

  refresh(m) {
    const T = GameRules.TicksPerSecond;
    this.lives = m.lives; this.teamScore = m.teamScore; this.level = m.level; this.wave = m.wave; this.waves = m.table.waveCount;
    this.continues = Math.max(0, m.lives - 1); this.grace = m.inGrace; this.challenge = m.isChallenge;
    if (this.mapName.length === 0 && m.mapName !== null) this.mapName = HudViewModel.pretty(m.mapName);
    this.bossAfloat = false; this.bossHealth = 0; this.bossMaxHealth = 0;
    for (const s of m.ships)
      if (s.alive && s.kind === ShipKind.Dreadnought) { this.bossAfloat = true; this.bossHealth = s.health; this.bossMaxHealth = s.maxHealth; }
    this.secondsLeft = Math.trunc((m.phaseTicksLeft + T - 1) / T);
    for (let s = 0; s < this.players.length; s++) {
      const h = this.players[s];
      h.present = s < m.playerCount;
      if (!h.present) continue;
      const p = m.player(s);
      h.connected = p.connected; h.cannons = p.cannonsToPlace; h.heldShapeId = m.heldShapeId(s); h.score = p.score;
    }
  }

  /** "NorthBay" -> "NORTH BAY": a space before every capital after the first letter, all upper case. */
  static pretty(map) {
    if (map === null || map === undefined || map.length === 0) return '';
    let sb = '';
    for (let i = 0; i < map.length; i++) {
      const ch = map[i];
      if (i > 0 && /\p{Lu}/u.test(ch)) sb += ' ';
      sb += ch.toUpperCase();
    }
    return sb;
  }

  /** The short reason a ghost shows at itself when confirm would be refused (UC-P1, PLAY_FIXES_AND_LOOK_SPEC.md: "water", "wall
   *  here", "castle", ...). `ghost` is MatchController.ghostOf's Ghost (kind, result, bad); `grid` names what stands on the first
   *  outlined square. '' when the ghost is legal. Port-own (the private model's ghost said nothing). */
  static ghostWords(ghost, grid) {
    if (ghost.legal || ghost.kind === null) return '';
    const b = ghost.bad.length > 0 ? ghost.bad[0] : null, on = b !== null && grid.in(b.x, b.y);
    const thing = () => {
      switch (on ? grid.occupantAt(b.x, b.y) : -1) {
        case Occupant.Wall: return 'wall here';
        case Occupant.Castle: return 'castle';
        case Occupant.Cannon: return 'cannon here';
        case Occupant.Graveyard: return 'ruined castle';
        case Occupant.RockSmall: case Occupant.RockLarge: return 'rock';
        case Occupant.Tree: return 'tree';
        case Occupant.House: return 'house';
        case Occupant.Pit: return 'burning pit';
        case Occupant.Kite: return 'kite here';
        default: return 'blocked';
      }
    };
    if (ghost.kind === 'wall')
      switch (ghost.result) {
        case PlacementResult.OutOfBounds: return 'off the map';
        case PlacementResult.OnWater: return 'water';
        case PlacementResult.BadGround: return on && grid.terrainAt(b.x, b.y) === Terrain.Lake ? 'lake' : 'swamp';
        case PlacementResult.Occupied: return thing();
        case PlacementResult.EnemyThere: return 'enemy here';
        case PlacementResult.GraceUsed: return 'last piece used';
        case PlacementResult.SwordOut: return 'bombs out: swap tool';
        case PlacementResult.WrongPiece: return 'new piece';
        default: return HudViewModel.placementWords(ghost.result);
      }
    switch (ghost.result) {
      case RejectReason.Blocked: {
        const t = on ? grid.terrainAt(b.x, b.y) : -1;
        return !on ? 'off the map' : t === Terrain.Water ? 'water' : t === Terrain.Swamp ? 'swamp' : t === Terrain.Lake ? 'lake' : thing();
      }
      case RejectReason.NotEnclosed: return 'outside your walls';
      default: return HudViewModel.rejectWords(ghost.result);
    }
  }

  /** C# Words(PlacementResult). */
  static placementWords(r) {
    switch (r) {
      case PlacementResult.BadGround: return "can't build on swamp or lake";
      case PlacementResult.GraceUsed: return 'that was your last piece';
      case PlacementResult.SwordOut: return 'bombs out - swap tool to build';
      case PlacementResult.OutOfBounds: return 'off the map';
      case PlacementResult.OnWater: return "can't build on water";
      case PlacementResult.Occupied: return 'something is there';
      case PlacementResult.EnemyThere: return 'an enemy is standing there';
      case PlacementResult.WrongPhase: return 'not now';
      case PlacementResult.Disconnected: return 'controller unplugged';
      default: return enumName(PlacementResult, r);
    }
  }

  /** "P3 HAS NO CASTLE" - who left their castle open, named as the HUD's cards name them. */
  fallenWords() {
    const who = [];
    for (let s = 0; s < this.players.length; s++)
      if (this.players[s].fell) who.push('P' + ((this.seatOfSlot !== null && s < this.seatOfSlot.length ? this.seatOfSlot[s] : s) + 1));
    if (who.length === 0) return '';
    return who.join(' + ') + (who.length === 1 ? ' HAS NO CASTLE' : ' HAVE NO CASTLE');
  }

  /** C# Words(RejectReason). */
  static rejectWords(r) {
    switch (r) {
      case RejectReason.NoCannons: return 'no cannons left';
      case RejectReason.NotEnclosed: return 'cannons go inside your walls';
      case RejectReason.Blocked: return 'something is there';
      case RejectReason.NoLoadedCannon: return 'reloading';
      case RejectReason.NotACastle: return 'pick a castle';
      case RejectReason.NotFull: return 'full rules only';
      case RejectReason.NoKite: return 'no kite to fly';
      case RejectReason.NotRecruitable: return "that ship won't turn";
      case RejectReason.SwordOut: return 'bombs out - swap tool for the cannon';
      case RejectReason.NoSword: return 'swap tool to take out bombs';
      case RejectReason.NoBombs: return 'all your bombs are lit';
      case RejectReason.BombHere: return 'a bomb is already here';
      case RejectReason.NoBombNear: return 'no bomb within reach';
      case RejectReason.HandsFull: return 'hands full - throw it first';
      case RejectReason.HandsEmpty: return 'nothing to throw';
      case RejectReason.TooFar: return 'too far to throw';
      case RejectReason.Stunned: return 'stunned';
      case RejectReason.CannotAfford: return 'not enough score';
      case RejectReason.ToolOut: return 'swap tool to take out bombs';
      case RejectReason.BadItem: return 'no such item';
      case RejectReason.NoItem: return 'none in stock - buy one first';
      case RejectReason.NoBombRules: return 'not in this rule set';
      case RejectReason.RaidOver: return 'the raid is over';
      case RejectReason.BadWay: return 'not a way to walk';
      case RejectReason.NoHero: return 'no hero on the field';
      case RejectReason.SwordSwinging: return '';
      case RejectReason.WrongPhase: return 'not now';
      case RejectReason.Disconnected: return 'controller unplugged';
      default: return enumName(RejectReason, r);
    }
  }
}
