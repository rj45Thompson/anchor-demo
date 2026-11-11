// soundbank.js - R1 (SOUND_PLAN.md, UC-S2): the ONE table of what the game sounds like. Plain data and three small functions; runs in
// the browser and in Node (test/unit/SoundbankTests.mjs reads it).
//
// - EVENT_SOUNDS: game event -> a recorded sound (a SOUNDS key) or, ON PURPOSE and said why, a sound of the ported Synth. An event
//   that is not listed makes no sound, as before.
// - musicFor / duckFor: which music plays on which screen and in which phase (R3: crossfaded about 1 s by app/sound.js), and when
//   the ambience bus is ducked (R4: in battle).
// - SOUNDS (generated): every recorded sound, its file(s), how loud, its source's author and licence, and WHY it was chosen - by a
//   measurement, since nobody on the sound lane could listen (tools/sound/build.mjs; full numbers in tools/sound/manifest.json).
// - MISSING (generated): what the staged library does not have. It is said, never substituted.
import {
  ShotFired, ShotLanded, ShipSunk, WallsPlaced, WallBroken, LoopClosed, LastPieceGrace, PhaseChanged,
  BombDropped, BombPickedUp, BombThrown, BombLanded, BombSank, BombDefused, BombExploded, PlayerStunned, BombFumbled,
  ItemBought, MetalPlaced, TrapPlaced, TrapSprung,
} from '../core/match/Events.js';
import { Phase } from '../core/match/Entities.js';
import { STORE_PACKS } from '../render/packs.js';
import { Screen } from '../core/controller/MenuModel.js';

/** The three buses (R4) and their AUTHORED base levels; each player's volume setting (0..1) multiplies its bus. */
export const BUSES = Object.freeze({ music: 0.5, fx: 0.9, ambience: 0.6 });

/** event -> sound. Rules are tried in order; the first whose class matches and whose `when` holds decides. `when(e, ctx)` gets
 *  ctx.byShip(shotId): did a ship fire that shot (a player's shot that hits strikes a ship; a ship's strikes a wall).
 *  `sound` is a SOUNDS key; `synth` names a ported Synth.Sfx kept on purpose, with `why`. */
export const EVENT_SOUNDS = Object.freeze([
  { event: ShotFired, when: (e) => e.fromSlot >= 0, sound: 'cannonOwn' },
  { event: ShotFired, when: (e) => e.fromSlot < 0, sound: 'cannonShip' },
  { event: ShotLanded, when: (e) => !e.hit, sound: 'splash' },
  { event: ShotLanded, when: (e, ctx) => ctx.byShip(e.shotId), sound: 'hitWall' },
  { event: ShotLanded, when: (e, ctx) => !ctx.byShip(e.shotId), sound: 'hitShip' },
  { event: ShipSunk, sound: 'shipSunk' },
  { event: WallsPlaced, sound: 'wallsPlaced' },
  { event: MetalPlaced, sound: 'metalPlaced' },
  { event: WallBroken, sound: 'wallBroken' },
  { event: LoopClosed, sound: 'ringClosed' },
  { event: LastPieceGrace, synth: 'Drum', why: 'kept on purpose: no drum or snare in the staged library (no file named drum, snare or roll in the four Kenney packs or oga/); the synth snare warns that REPAIR is out of time, as before' },
  { event: PhaseChanged, when: (e) => e.phase === Phase.Score, sound: 'ceaseFire' },
  { event: BombDropped, sound: 'bombDropped' },
  { event: BombFumbled, sound: 'bombDropped' },
  { event: BombPickedUp, sound: 'bombPickedUp' },
  { event: BombThrown, sound: 'bombThrown' },
  { event: BombLanded, sound: 'bombLanded' },
  { event: BombSank, sound: 'splash' },
  { event: BombDefused, sound: 'bombDefused' },
  { event: BombExploded, when: (e) => e.big, sound: 'bigBombBlast' },
  { event: BombExploded, when: (e) => !e.big, sound: 'bombBlast' },
  { event: PlayerStunned, sound: 'stunned' },
  { event: ItemBought, sound: 'itemBought' },
  { event: TrapPlaced, sound: 'trapPlaced' },
  { event: TrapSprung, sound: 'trapSprung' },
]);

/** The rule an event makes a sound by, or null (most events are silent). */
export function soundForEvent(e, ctx) {
  for (const r of EVENT_SOUNDS) if (e instanceof r.event && (!r.when || r.when(e, ctx))) return r;
  return null;
}

/** The menu sounds (app/main.js plays them on a menu move and a menu pick). */
export const MENU_SOUNDS = Object.freeze({ move: 'menuMove', pick: 'menuPick' });

/** The ambience bus: the sea bed always (looped) and a gull now and then. */
export const AMBIENCE = Object.freeze({ bed: 'sea', calls: 'gull', callGapSec: Object.freeze([6, 16]) });   // AUTHORED gap between gulls

const BUILD = new Set([Phase.Claim, Phase.Repair, Phase.Score, Phase.Decide]);
const BATTLE = new Set([Phase.Cannons, Phase.Battle]);

/** True when the match's phase decides the music: an attract demo, or a person's match on its play, pause, fate and results screens.
 *  The title, the join screen, the initials and the high scores (and the silent demo behind them) are menus. */
function inMatch(s) {
  return s.attract || (!s.demo && (s.screen === Screen.Playing || s.screen === Screen.Pause || s.screen === Screen.Decide || s.screen === Screen.Results));
}

/** The music key for what is on screen: s = { screen, demo, attract, phase, boss }. UC-S2 steps 1-3 and 5; s.boss: a boss ship is
 *  afloat (BOSS_UC.md UC-B1), and its BATTLE has the boss theme. */
export function musicFor(s) {
  if (!inMatch(s)) return 'musicTitle';
  if (BUILD.has(s.phase)) return 'musicBuild';
  if (s.phase === Phase.Battle && s.boss && STORE_PACKS) return 'musicBoss';   // the boss theme is a store pack's (render/packs.js)
  if (BATTLE.has(s.phase)) return 'musicBattle';
  if (s.phase === Phase.Victory) return 'musicVictory';
  if (s.phase === Phase.GameOver) return 'gameOver';
  throw new RangeError('soundbank: no music for phase ' + s.phase);
}

/** The bed under the sea for a level's mood (render/moods.js names; MOOD_UC.md): Procedural Worlds' four ambient pieces, chosen in
 *  tools/sound/build.mjs by measurement. The menus have none (the title's sea alone, as before). */
export const MOOD_BEDS = Object.freeze({ noon: 'bedNoon', golden: 'bedGolden', dusk: 'bedDusk', storm: 'bedStorm' });
export function bedFor(s, mood) {
  if (!inMatch(s) || !STORE_PACKS) return null;      // the beds are a store pack's (render/packs.js): the sea alone without them
  const k = MOOD_BEDS[mood];
  if (!k) throw new RangeError('soundbank: no bed for mood ' + mood);
  return k;
}

/** The ambience is ducked during BATTLE (UC-S2 step 4). */
export function duckFor(s) { return inMatch(s) && s.phase === Phase.Battle; }

// ---- GENERATED by tools/sound/build.mjs: do not edit by hand (re-run the build) ----
/** Every recorded sound: bus, mode (oneshot / loop / sting), mix gain, its encoded file(s) with frame counts (48 kHz) and byte
 *  budgets, its source's author and licence, and WHY it was chosen (the measurement). Total 1942787 bytes. */
export const SOUNDS = Object.freeze({
  "cannonOwn": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.7,
    "files": [
      {
        "file": "assets/sound/cannonOwn.ogg",
        "frames": 143280,
        "bytes": 14707,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "thimras",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/battle-at-sea"
    },
    "why": "lowest spectral centroid of the 6 cannon-fire files: cannon_fire_1.ogg (centroid 113, duration 3.576) - the heaviest boom, for the players' own guns"
  },
  "cannonShip": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.55,
    "files": [
      {
        "file": "assets/sound/cannonShip.ogg",
        "frames": 75740,
        "bytes": 9077,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "rubberduck",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/25-cc0-bang-firework-sfx"
    },
    "why": "second-lowest centroid of the same 6 files: cannon_02.ogg (centroid 596, duration 1.795) - lighter, so a ship's gun is told apart from your own"
  },
  "splash": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.6,
    "files": [
      {
        "file": "assets/sound/splash.ogg",
        "frames": 75348,
        "bytes": 9773,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "thimras",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/ocean-splash"
    },
    "why": "the one staged file made for a shot falling in the sea (thimras \"Ocean splash\"); measured cannon_miss.ogg (centroid 1589, duration 1.648)"
  },
  "hitWall": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.6,
    "files": [
      {
        "file": "assets/sound/hitWall.ogg",
        "frames": 143532,
        "bytes": 17569,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "thimras",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/battle-at-sea"
    },
    "why": "the one staged file made for a cannonball striking a wall (thimras \"Battle at sea\"); measured cannon_hit_wall_1.ogg (centroid 1061, duration 3.008)"
  },
  "hitShip": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.6,
    "files": [
      {
        "file": "assets/sound/hitShip.ogg",
        "frames": 150680,
        "bytes": 17792,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "thimras",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/battle-at-sea"
    },
    "why": "the one staged file made for a cannonball striking a ship (thimras \"Battle at sea\"); measured cannon_hit_ship_short.ogg (centroid 196, duration 3.397)"
  },
  "shipSunk": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.7,
    "files": [
      {
        "file": "assets/sound/shipSunk.ogg",
        "frames": 336000,
        "bytes": 39019,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "thimras",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/ship-sinking"
    },
    "why": "the one staged file made for a ship going down (thimras \"Ship sinking\"); measured ship_destroyed.ogg (duration 18.544, centroid 164); cut to its first 7 s with a 1.5 s fade (AUTHORED: its loud part is the first ~10 s of 18.5, and a battle sinks several ships)"
  },
  "wallsPlaced": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.75,
    "files": [
      {
        "file": "assets/sound/wallsPlaced-1.ogg",
        "frames": 39855,
        "bytes": 5593,
        "budget": 65536,
        "channels": 1
      },
      {
        "file": "assets/sound/wallsPlaced-2.ogg",
        "frames": 40329,
        "bytes": 5815,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "stone family (Kenney impactMining, 5 files); the two lowest centroids = the deepest thunks: impactMining_004.ogg (centroid 74, duration 0.83), impactMining_000.ogg (centroid 110, duration 0.937)"
  },
  "wallBroken": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.6,
    "files": [
      {
        "file": "assets/sound/wallBroken-1.ogg",
        "frames": 16773,
        "bytes": 2083,
        "budget": 65536,
        "channels": 1
      },
      {
        "file": "assets/sound/wallBroken-2.ogg",
        "frames": 16496,
        "bytes": 2013,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "Kenney impactPlate_heavy (a hard crack, 5 files); the two lowest centroids: impactPlate_heavy_001.ogg (centroid 99, duration 0.349), impactPlate_heavy_003.ogg (centroid 101, duration 0.344) (the stone thunk stays the sound of BUILDING; breaking is a crack)"
  },
  "metalPlaced": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.6,
    "files": [
      {
        "file": "assets/sound/metalPlaced.ogg",
        "frames": 6284,
        "bytes": 871,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "Kenney impactMetal_heavy (5 files); the lowest centroid = the heaviest clank: impactMetal_heavy_004.ogg (centroid 1244, duration 0.131)"
  },
  "ringClosed": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.7,
    "transposeBySlot": true,
    "files": [
      {
        "file": "assets/sound/ringClosed.ogg",
        "frames": 38740,
        "bytes": 4944,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "the most strongly RISING of the 33 Kenney jingles with >= 30 voiced frames: jingles_NES12.ogg (pitch 21.7 st/s over 35 voiced frames, duration 0.852); transposed 2 semitones per player slot, as the synth fanfare was"
  },
  "gameOver": {
    "bus": "music",
    "mode": "sting",
    "vol": 0.8,
    "files": [
      {
        "file": "assets/sound/gameOver.ogg",
        "frames": 83414,
        "bytes": 19935,
        "budget": 2097152,
        "channels": 2
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "the LONGEST of the Kenney jingles whose pitch falls by >= 10 st/s (over >= 30 voiced frames): jingles_SAX07.ogg (pitch -14.7 st/s over 79 voiced frames, duration 1.74)"
  },
  "ceaseFire": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.7,
    "files": [
      {
        "file": "assets/sound/ceaseFire.ogg",
        "frames": 83562,
        "bytes": 9807,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "the longest of the 5 Kenney heavy bell strikes (the bell at the end of each round, when the walls are judged): impactBell_heavy_001.ogg (duration 1.741, centroid 355)"
  },
  "menuMove": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.5,
    "files": [
      {
        "file": "assets/sound/menuMove.ogg",
        "frames": 1934,
        "bytes": 475,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "of 12 Kenney interface clicks <= 0.1 s, the nearest to the synth MenuMove (centroid 1985 Hz, 0.05 s): select_001.ogg (centroid 2364, duration 0.04)"
  },
  "menuPick": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.6,
    "files": [
      {
        "file": "assets/sound/menuPick.ogg",
        "frames": 15331,
        "bytes": 1922,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "of 4 Kenney confirmations, the nearest to the synth MenuPick (centroid 2335 Hz, 0.17 s): confirmation_003.ogg (centroid 2639, duration 0.322)"
  },
  "bombBlast": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.65,
    "files": [
      {
        "file": "assets/sound/bombBlast-1.ogg",
        "frames": 53151,
        "bytes": 6451,
        "budget": 65536,
        "channels": 1
      },
      {
        "file": "assets/sound/bombBlast-2.ogg",
        "frames": 43834,
        "bytes": 5816,
        "budget": 65536,
        "channels": 1
      },
      {
        "file": "assets/sound/bombBlast-3.ogg",
        "frames": 40859,
        "bytes": 5060,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "rubberduck",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/25-cc0-bang-firework-sfx"
    },
    "why": "rubberduck \"25 CC0 bang\" (10 bangs): the three loudest (active RMS) under 800 Hz centroid, the deepest left for the big bomb: bang_09.ogg (activeRmsDb -14, centroid 758), bang_07.ogg (activeRmsDb -15.3, centroid 651), bang_01.ogg (activeRmsDb -16.6, centroid 792)"
  },
  "bigBombBlast": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.8,
    "files": [
      {
        "file": "assets/sound/bigBombBlast.ogg",
        "frames": 46069,
        "bytes": 5392,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "rubberduck",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/25-cc0-bang-firework-sfx"
    },
    "why": "the lowest-centroid bang of the 10: bang_03.ogg (centroid 247, activeRmsDb -14.8) - the big bomb"
  },
  "bombDropped": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.7,
    "files": [
      {
        "file": "assets/sound/bombDropped.ogg",
        "frames": 16701,
        "bytes": 2143,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "the one foley file named for a dropped object (Kenney RPG dropLeather); measured dropLeather.ogg (centroid 609, duration 0.415); also the fumble (a carried bomb let go)"
  },
  "bombPickedUp": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.8,
    "files": [
      {
        "file": "assets/sound/bombPickedUp.ogg",
        "frames": 10507,
        "bytes": 1547,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "Kenney RPG \"handle\" foley for taking a thing in hand; of 2, the lower centroid (less hiss): handleSmallLeather.ogg (centroid 1457, activeRmsDb -32.4)"
  },
  "bombThrown": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.8,
    "files": [
      {
        "file": "assets/sound/bombThrown.ogg",
        "frames": 29587,
        "bytes": 4134,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "Kenney RPG cloth swish for the throw; of 4, the loudest (active RMS): cloth1.ogg (activeRmsDb -22.3, duration 0.661)"
  },
  "bombLanded": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.7,
    "files": [
      {
        "file": "assets/sound/bombLanded.ogg",
        "frames": 25981,
        "bytes": 3272,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "Kenney impactSoft_heavy (a heavy thing on the ground, 5 files); the lowest centroid: impactSoft_heavy_003.ogg (centroid 70, duration 0.541)"
  },
  "bombDefused": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.7,
    "files": [
      {
        "file": "assets/sound/bombDefused.ogg",
        "frames": 12204,
        "bytes": 1718,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "Kenney RPG small metal mechanisms (metalClick, metalLatch); the fastest attack for the snuffed fuse: metalLatch.ogg (attackMs 40, duration 0.261)"
  },
  "trapPlaced": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.7,
    "files": [
      {
        "file": "assets/sound/trapPlaced.ogg",
        "frames": 18374,
        "bytes": 2506,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "the other of the same two metal mechanisms, for setting a trap: metalClick.ogg (attackMs 260, duration 0.446)"
  },
  "stunned": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.6,
    "files": [
      {
        "file": "assets/sound/stunned.ogg",
        "frames": 21506,
        "bytes": 2991,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "Kenney impactPunch_heavy (5 files), the lowest centroid, for a hero knocked down by a blast: impactPunch_heavy_002.ogg (centroid 121, duration 0.458)"
  },
  "itemBought": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.6,
    "files": [
      {
        "file": "assets/sound/itemBought.ogg",
        "frames": 35444,
        "bytes": 4472,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "Kenney RPG coins (2 files), the louder: handleCoins.ogg (activeRmsDb -22.5, duration 0.846)"
  },
  "trapSprung": {
    "bus": "fx",
    "mode": "oneshot",
    "vol": 0.7,
    "files": [
      {
        "file": "assets/sound/trapSprung.ogg",
        "frames": 11525,
        "bytes": 1659,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "Kenney",
      "licence": "CC0",
      "page": "https://kenney.nl"
    },
    "why": "the one staged file of a blade biting (Kenney RPG chop), the trap's jaws: chop.ogg (attackMs 40, duration 0.24, centroid 1838)"
  },
  "musicTitle": {
    "bus": "music",
    "mode": "loop",
    "vol": 0.55,
    "lazy": true,
    "files": [
      {
        "file": "assets/sound/musicTitle.ogg",
        "frames": 3224926,
        "bytes": 748284,
        "budget": 2097152,
        "channels": 2,
        "loopStart": 4800,
        "loopEnd": 3220126,
        "seam": {
          "jumpRatio": 0.99,
          "levelStepDb": 0.97,
          "fluxPercentile": 73.1
        }
      }
    ],
    "credit": {
      "author": "randommind",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/medieval-the-bards-tale"
    },
    "why": "the CALMER of the two medieval pieces not named for building (busyness Kings_Feast_0.mp3 0.2336, The_Bards_Tale.mp3 0.2026; lower = calmer); it is not a loop file, so its loop is found by matching the context around the jump (60..150 s, AUTHORED for size); its own seam: {\"jumpRatio\":1.15,\"levelStepDb\":43.43,\"fluxPercentile\":99.9}"
  },
  "musicBuild": {
    "bus": "music",
    "mode": "loop",
    "vol": 0.5,
    "lazy": true,
    "files": [
      {
        "file": "assets/sound/musicBuild.ogg",
        "frames": 1566289,
        "bytes": 363558,
        "budget": 2097152,
        "channels": 2,
        "loopStart": 4800,
        "loopEnd": 1561489,
        "seam": {
          "jumpRatio": 0.3,
          "levelStepDb": 0.5,
          "fluxPercentile": 18.6
        }
      }
    ],
    "credit": {
      "author": "randommind",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/medieval-market-day"
    },
    "why": "the plan names Market Day for CLAIM/REPAIR; busyness 0.2836 (between the calm title and the battle). It is published as a loop, but its OWN seam fails the gate (numbers below: the change at the join is bigger than nearly all the changes inside the piece), so its loop is found by the context match (30..60 s); its own seam: {\"jumpRatio\":0.02,\"levelStepDb\":5.26,\"fluxPercentile\":98.8}"
  },
  "musicBattle": {
    "bus": "music",
    "mode": "loop",
    "vol": 0.5,
    "lazy": true,
    "files": [
      {
        "file": "assets/sound/musicBattle.ogg",
        "frames": 772273,
        "bytes": 179655,
        "budget": 2097152,
        "channels": 2,
        "loopStart": 4800,
        "loopEnd": 767473,
        "seam": {
          "jumpRatio": 0.47,
          "levelStepDb": 0.77,
          "fluxPercentile": 0.1
        }
      }
    ],
    "credit": {
      "author": "xcvg",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/fast-fight-battle-music-looped"
    },
    "why": "the BUSIER of the two battle loops (busyness determined_pursuit_loop.wav 0.3571, fight_looped.ogg 0.4602; higher = more driving). Published as a loop, but its own seam fails the gate (numbers below), so its loop is found by the context match (15..23 s of its 24.8 s); its own seam: {\"jumpRatio\":1.19,\"levelStepDb\":1.34,\"fluxPercentile\":96.2}"
  },
  "musicVictory": {
    "bus": "music",
    "mode": "sting",
    "vol": 0.8,
    "lazy": true,
    "files": [
      {
        "file": "assets/sound/musicVictory.ogg",
        "frames": 179207,
        "bytes": 41976,
        "budget": 2097152,
        "channels": 2
      }
    ],
    "credit": {
      "author": "celestialghost8",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/victory"
    },
    "why": "the one staged victory piece (celestialghost8 \"Victory\"); measured Victory_0.mp3 (duration 4.88, activeRmsDb -19.9)"
  },
  "sea": {
    "bus": "ambience",
    "mode": "loop",
    "vol": 0.6,
    "files": [
      {
        "file": "assets/sound/sea.ogg",
        "frames": 2168253,
        "bytes": 367372,
        "budget": 524288,
        "channels": 2,
        "loopStart": 4800,
        "loopEnd": 2163453,
        "seam": {
          "jumpRatio": 1.05,
          "levelStepDb": 0.1,
          "fluxPercentile": 5.1
        }
      }
    ],
    "credit": {
      "author": "randommind",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/sea-and-river-wave-sounds"
    },
    "why": "the one long sea/river wave recording (randommind, 300.042 s); a 30..45 s loop is cut where the context around the jump matches best, joined by a 1 s equal-power crossfade (noise does not line up, so it is blended); its own seam: {\"jumpRatio\":0.08,\"levelStepDb\":1.98,\"fluxPercentile\":98.2}"
  },
  "gull": {
    "bus": "ambience",
    "mode": "oneshot",
    "vol": 0.45,
    "files": [
      {
        "file": "assets/sound/gull-1.ogg",
        "frames": 186564,
        "bytes": 24155,
        "budget": 65536,
        "channels": 1
      },
      {
        "file": "assets/sound/gull-2.ogg",
        "frames": 70135,
        "bytes": 9231,
        "budget": 65536,
        "channels": 1
      }
    ],
    "credit": {
      "author": "rango-mango",
      "licence": "CC0+",
      "page": "https://opengameart.org/content/solo-seagull-sound-effects"
    },
    "why": "the staged gull calls (rango-mango, 2 files: Seagull_Ambient_1.wav (duration 3.892, centroid 90), Seagull_Ambient_2.wav (duration 1.556, centroid 136)); high-passed at 300 Hz (AUTHORED): their measured centroid sits under 140 Hz, wind rumble the sea bed already carries"
  }
});

/** What the staged library does not have: said, never substituted. */
export const MISSING = Object.freeze([
  {
    "what": "fuseHiss",
    "why": "no steady hiss in the staged library: the only candidate, rubberduck fw_loop.ogg, swings 28 dB between 0.25 s frames (firework crackle, not a fuse); a lit bomb is silent until it blows"
  }
]);

export const TOTAL_BYTES = 1942787;
// ---- END GENERATED ----
