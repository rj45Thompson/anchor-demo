// noise.js - deterministic value noise for the land's relief, colour and coast wobble: the same board always draws the same island.
// Plain JavaScript (no three.js), so render/coast.js and the unit tests that hold the coast to its rules use the very same noise.
// (Moved from render/look.js on 11-10, unchanged.)

/** Value noise on a lattice, hashed from integer coordinates and a seed: the same board always draws the same island. */
export function makeNoise(seed) {
  const h = (x, y) => {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const s = (t) => t * t * (3 - 2 * t);
  const v = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => v(x, y) * 0.6 + v(x * 2.1 + 17.3, y * 2.1 - 4.1) * 0.3 + v(x * 4.3 - 9.7, y * 4.3 + 2.9) * 0.1;
}

