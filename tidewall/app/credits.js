// credits.js - the models this page draws that someone else made, credited as their licence asks, in ONE place: the title screen's
// footer reads this list, and ASSETS.md lists the same entries with where each file came from.
// The Sketchfab models are CC Attribution 4.0: title, author, licence and a link are shown wherever the game is shown. The look lane
// (UC-L1, 11-09) added the bomb, the barrel, the tower and the village's houses (authors and links from art_in/sketchfab/CHOSEN.json).

export const MODEL_CREDITS = Object.freeze([
  Object.freeze({ title: 'Oak Tree | Game Ready', author: 'mapletree', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/2f4ae6b907fd4741abda5d1b71c83b10' }),
  Object.freeze({ title: 'Low Poly Trees & Nature Pack (70 Props)', author: 'anastasita.3d', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/9e80530909f84da9bc226273974f75f1' }),
  Object.freeze({ title: 'Free Pack - Rocks Stylized', author: 'polyone', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/7c60b4d1b8ab4187965f30c5e0212fc0' }),
  Object.freeze({ title: 'Round Bomb', author: 'rectus', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/2148b02dd8c948f797903f75988d8717' }),
  Object.freeze({ title: 'Old wooden Barrel 3d Model', author: 'aarav.sharma2310', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/1afde542abdd49daa67ccf1a4cab2eef' }),
  Object.freeze({ title: 'Medieval Tower', author: 'farooq.smurf', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/c4d4b41b87fd427fbfc9c61f3c151ae9' }),
  Object.freeze({ title: 'FREE Low Poly Medieval Village - 5 Houses', author: 'wErTT', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/c9f1b1ab017544d7b68c35890d27a3fc' }),
]);

/** The licence's own page, linked beside each credit. */
export const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';

/** The models made for this game (no credit owed; said so the footer is complete). */
export const OWN_MODELS = 'Knight, goblin, ship, castle and cannon made with Meshy (meshy.ai) for this game.';

/** The recorded sounds (app/soundbank.js, assets/sound/; ASSETS.md lists each file). They are all CC0, which asks no credit (the
 *  Unity Asset Store packs are held out: render/packs.js). Every author whose
 *  recording the game plays is named. test/unit/SoundbankTests.mjs fails when a soundbank author is missing here. */
export const SOUND_CREDITS = Object.freeze([
  Object.freeze({ title: 'Impact, Interface, RPG Audio and Music Jingles packs', author: 'Kenney', url: 'https://kenney.nl' }),
  Object.freeze({ title: 'Medieval: The Bard\'s Tale; Medieval: Market Day; sea and river waves', author: 'randommind', url: 'https://opengameart.org/content/medieval-the-bards-tale' }),
  Object.freeze({ title: 'Fast Fight / Battle Music (looped)', author: 'xcvg', url: 'https://opengameart.org/content/fast-fight-battle-music-looped' }),
  Object.freeze({ title: 'Victory', author: 'celestialghost8', url: 'https://opengameart.org/content/victory' }),
  Object.freeze({ title: 'Battle at sea; Ocean splash; Ship sinking', author: 'thimras', url: 'https://opengameart.org/content/battle-at-sea' }),
  Object.freeze({ title: '25 CC0 bang / firework SFX', author: 'rubberduck', url: 'https://opengameart.org/content/25-cc0-bang-firework-sfx' }),
  Object.freeze({ title: 'Solo seagull sound effects', author: 'rango-mango', url: 'https://opengameart.org/content/solo-seagull-sound-effects' }),
  // the Unity Asset Store packs' rows (the boss theme, the thunder, the four ambient beds) live in held/README.md while
  // render/packs.js STORE_PACKS is false: nothing of theirs is played, so nothing of theirs is credited
]);

/** The licence the recorded sounds are under. */
export const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
