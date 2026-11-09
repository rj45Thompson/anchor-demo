// credits.js - the models this page draws that someone else made, credited as their licence asks, in ONE place: the title screen's
// footer reads this list, and ASSETS.md lists the same entries with where each file came from.
// The three Sketchfab models are CC Attribution 4.0: title, author, licence and a link are shown wherever the game is shown.

export const MODEL_CREDITS = Object.freeze([
  Object.freeze({ title: 'Oak Tree | Game Ready', author: 'mapletree', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/2f4ae6b907fd4741abda5d1b71c83b10' }),
  Object.freeze({ title: 'Low Poly Trees & Nature Pack (70 Props)', author: 'anastasita.3d', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/9e80530909f84da9bc226273974f75f1' }),
  Object.freeze({ title: 'Free Pack - Rocks Stylized', author: 'polyone', licence: 'CC BY 4.0', url: 'https://sketchfab.com/3d-models/7c60b4d1b8ab4187965f30c5e0212fc0' }),
]);

/** The licence's own page, linked beside each credit. */
export const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';

/** The models made for this game (no credit owed; said so the footer is complete). */
export const OWN_MODELS = 'Knight, goblin, ship, castle and cannon made with Meshy (meshy.ai) for this game.';
