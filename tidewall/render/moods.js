// moods.js - the four lights a campaign's levels are lit with (MOOD_UC.md UC-L4): plain data and the level -> mood rule, with no
// three.js, so the unit tests read the same values the renderer does. render/mood.js turns the chosen one into uniforms and lights.

// AUTHORED (this game's own look). NOON is the light the game had until 11-10, value for value (look.js SUN and SKY, sky.js HAZE,
// ZENITH and GLARE, renderer.js EXPOSURE and GRADE), so level 1 and the menus look exactly as before.
export const MOODS = Object.freeze({
  noon: Object.freeze({
    name: 'noon', sun: 0xffe6c4, sunI: 3.1, sky: 0xcfe8ff, ground: 0x6f8f5f, skyI: 0.95, haze: 0xc4def2, zenith: 0x3f8ee8, glare: 0xfff0d2,
    seaHorizon: 0xe4f4ff, seaZenith: 0x5fa8ff, exposure: 0.72, cool: [-0.012, 0.004, 0.03], warm: [0.035, 0.015, -0.02], cloudShade: 0.16 }),
  golden: Object.freeze({
    name: 'golden', sun: 0xffc98a, sunI: 3.0, sky: 0xf0dcc4, ground: 0x76844f, skyI: 0.88, haze: 0xf0d8b6, zenith: 0x5a8ed4, glare: 0xffd49a,
    seaHorizon: 0xf6e2c6, seaZenith: 0x6f9ed8, exposure: 0.74, cool: [-0.006, 0.0, 0.03], warm: [0.05, 0.022, -0.03], cloudShade: 0.18 }),
  dusk: Object.freeze({
    // (11-10 first try: sun 0xff9c64, warm [0.06, 0.02, -0.035], exposure 0.8 turned the sand band lava orange and the board dark,
    // L* 40.8 in run_page mood; softened, LOOKED at again)
    name: 'dusk', sun: 0xffb48a, sunI: 2.6, sky: 0xb9a8cc, ground: 0x5f5c4a, skyI: 0.9, haze: 0xe6b294, zenith: 0x4a5c9e, glare: 0xffb27a,
    seaHorizon: 0xf0bea2, seaZenith: 0x5a6aa8, exposure: 0.86, cool: [0.0, -0.006, 0.045], warm: [0.04, 0.012, -0.022], cloudShade: 0.2 }),
  storm: Object.freeze({
    name: 'storm', sun: 0xd2dae6, sunI: 1.9, sky: 0xaab8c8, ground: 0x58654f, skyI: 1.1, haze: 0x9fadbc, zenith: 0x5b6d84, glare: 0xdde3ea,
    seaHorizon: 0xb4c2d0, seaZenith: 0x58708c, exposure: 0.82, cool: [-0.01, 0.004, 0.035], warm: [0.012, 0.008, -0.006], cloudShade: 0.3 }),
});

/** The mood of a campaign level (1-based): the four lights in turn, so a campaign of four islands is noon, golden, dusk, storm. The
 *  menus and the title's flyover are noon. */
export const MOOD_ORDER = Object.freeze(['noon', 'golden', 'dusk', 'storm']);
export function moodForLevel(level) {
  if (!Number.isInteger(level) || level < 1) throw new RangeError('mood.js: a level is a whole number from 1, got ' + level);
  return MOODS[MOOD_ORDER[(level - 1) % MOOD_ORDER.length]];
}
