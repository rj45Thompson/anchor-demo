// packs.js - one switch for the Unity Asset Store packs this game was tried with: the boss theme, the thunder, the four ambient beds
// and the storm's bolt. Whether their licences cover this game is not settled, so they are out of every build. With this false the
// game plays without them: tools/sound/build.mjs leaves their sounds out, the soundbank never asks for them, the credits do not list
// them and the storm's bolt is drawn in code (render/weather.js drawnTextures). To put them back: held/README.md.
export const STORE_PACKS = false;
