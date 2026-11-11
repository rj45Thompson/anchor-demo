// moods.js - the four lights a campaign's levels are lit with (MOOD_UC.md UC-L4): plain data and the level -> mood rule, with no
// three.js, so the unit tests read the same values the renderer does. render/mood.js turns the chosen one into uniforms and lights.

// AUTHORED (this game's own look). NOON is the light the game had until 11-10, value for value (look.js SUN and SKY, sky.js HAZE,
// ZENITH and GLARE, renderer.js EXPOSURE and GRADE), so level 1 and the menus look exactly as before.
// saturation: the grade's colour strength (renderer.js buildPost; noon's 1.12 is the old GRADE.saturation).
// weather (MOOD_UC.md UC-L6, 11-11): null, or { drops, fall, wind, every: [min, max] }: rain streaks over the board (drops of them,
// falling `fall` squares a second, blown `wind` squares a second along +x) and a lightning flash every `every` seconds (render/weather.js).
export const MOODS = Object.freeze({
  noon: Object.freeze({
    name: 'noon', sun: 0xffe6c4, sunI: 3.1, sky: 0xcfe8ff, ground: 0x6f8f5f, skyI: 0.95, haze: 0xc4def2, zenith: 0x3f8ee8, glare: 0xfff0d2,
    seaHorizon: 0xe4f4ff, seaZenith: 0x5fa8ff, exposure: 0.72, cool: [-0.012, 0.004, 0.03], warm: [0.035, 0.015, -0.02], cloudShade: 0.16, saturation: 1.12, weather: null }),
  golden: Object.freeze({
    name: 'golden', sun: 0xffc98a, sunI: 3.0, sky: 0xf0dcc4, ground: 0x76844f, skyI: 0.88, haze: 0xf0d8b6, zenith: 0x5a8ed4, glare: 0xffd49a,
    seaHorizon: 0xf6e2c6, seaZenith: 0x6f9ed8, exposure: 0.74, cool: [-0.006, 0.0, 0.03], warm: [0.05, 0.022, -0.03], cloudShade: 0.18, saturation: 1.12, weather: null }),
  dusk: Object.freeze({
    // (11-10 first try: sun 0xff9c64, warm [0.06, 0.02, -0.035], exposure 0.8 turned the sand band lava orange and the board dark,
    // L* 40.8 in run_page mood; softened, LOOKED at again)
    name: 'dusk', sun: 0xffb48a, sunI: 2.6, sky: 0xb9a8cc, ground: 0x5f5c4a, skyI: 0.9, haze: 0xe6b294, zenith: 0x4a5c9e, glare: 0xffb27a,
    seaHorizon: 0xf0bea2, seaZenith: 0x5a6aa8, exposure: 0.86, cool: [0.0, -0.006, 0.045], warm: [0.04, 0.012, -0.022], cloudShade: 0.2, saturation: 1.08, weather: null }),
  storm: Object.freeze({
    // (11-11: the 11-10 storm, sun 1.9, exposure 0.82, the colour at noon's 1.12, read as a sunny green board with rain on it,
    // shots/mood/storm_rain.png; a weaker sun, a lower exposure and the colour pulled down, LOOKED at again)
    name: 'storm', sun: 0xc8d2e0, sunI: 1.35, sky: 0x9eacbc, ground: 0x4f5a48, skyI: 1.05, haze: 0x93a1b0, zenith: 0x4f6178, glare: 0xd0d8e2,
    seaHorizon: 0xa6b4c2, seaZenith: 0x4c6480, exposure: 0.74, cool: [-0.012, 0.004, 0.04], warm: [0.008, 0.006, -0.004], cloudShade: 0.34, saturation: 0.78,
    weather: Object.freeze({ drops: 2200, fall: 24, wind: 4, every: Object.freeze([6, 13]) }) }),
});

/** The mood of a campaign level (1-based): the four lights in turn, so a campaign of four islands is noon, golden, dusk, storm. The
 *  menus and the title's flyover are noon. */
export const MOOD_ORDER = Object.freeze(['noon', 'golden', 'dusk', 'storm']);
export function moodForLevel(level) {
  if (!Number.isInteger(level) || level < 1) throw new RangeError('mood.js: a level is a whole number from 1, got ' + level);
  return MOODS[MOOD_ORDER[(level - 1) % MOOD_ORDER.length]];
}
