// port of model/Controller/HudViewModel.cs
//
// Public-build changes (PLAN.md hard limits), each a removal or a reword, no rule changed:
//   - the boss fields (bossAfloat, bossHealth, bossMaxHealth) and the banners for the boss ship, the sea monster and a recruited ship
//     are left out: the public build runs the normal rules only, where none of those exist;
//   - the fate wording is "CONTINUE OR GIVE UP?" / "CONTINUE!" (the private build quoted an existing game's line);
//   - the reject reasons 9..11 (the extended rules' weapons) have no words: the rules port does not have them.
import { GameRules } from '../rules/GameRules.js';
import { PlacementResult } from '../rules/PlacementRules.js';
import { Phase } from '../match/Entities.js';
import { MatchModel } from '../match/MatchModel.js';
import {
  PhaseChanged, LevelStarted, LastPieceGrace, FateAsked, FateChosen, CastleRuined, CastleRestored, FinalBonus, PlayerFell,
  LifeLost, PlacementRejected, CommandRejected, WallsPlaced, RejectReason,
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
                  : 'GAME OVER';
      this.subtitle = '';
    } else if (e instanceof LevelStarted) {
      this.challenge = e.challenge; this.mapName = HudViewModel.pretty(e.map); this.bannerTick = e.tick;
      this.banner = e.challenge ? 'CHALLENGE ROUND' : 'LEVEL ' + e.level; this.subtitle = this.mapName;
    } else if (e instanceof LastPieceGrace) {
      this.banner = 'LAST PIECE!'; this.subtitle = ''; this.bannerTick = e.tick;
    } else if (e instanceof FateAsked) {
      this.banner = 'CONTINUE OR GIVE UP?'; this.bannerTick = e.tick;
      this.subtitle = (this.fallenWords() === '' ? '' : this.fallenWords() + ' - ') + e.continuesLeft + (e.continuesLeft === 1 ? ' CONTINUE LEFT' : ' CONTINUES LEFT');
    } else if (e instanceof FateChosen && e.fightAgain) {
      this.banner = 'CONTINUE!'; this.subtitle = 'MORE FIREPOWER'; this.bannerTick = e.tick;
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

  /** C# Words(PlacementResult). */
  static placementWords(r) {
    switch (r) {
      case PlacementResult.BadGround: return "can't build on swamp or lake";
      case PlacementResult.GraceUsed: return 'that was your last piece';
      case PlacementResult.SwordOut: return 'sword out - swap tool to build';
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
      case RejectReason.SwordOut: return 'sword out - swap tool for the cannon';
      case RejectReason.NoSword: return 'swap tool to draw the sword';
      case RejectReason.SwordSwinging: return '';
      case RejectReason.WrongPhase: return 'not now';
      case RejectReason.Disconnected: return 'controller unplugged';
      default: return enumName(RejectReason, r);
    }
  }
}
