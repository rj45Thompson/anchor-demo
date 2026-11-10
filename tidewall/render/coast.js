// coast.js - the island's coast as a field (COAST_UC.md UC-L2): the signed distance to the coast in squares (+ on land, - at sea),
// on the lattice the land mesh and the sea's distance texture share. Plain JavaScript (no three.js), so the unit tests hold the
// coast to its rule on every island the game can draw.
//
// Until 11-10 the field was the distance to the nearest square of the other kind, plus a little noise: every corner of a square was
// a corner of the beach, and the coast read as square steps (AAA gap 1). Now that exact field is smoothed with a Gaussian of BLUR
// squares on the lattice: a diagonal run of squares becomes a straight diagonal beach, a lone corner is rounded, a straight coast
// stays where it was. The rule the game needs is that a square that PLAYS as land LOOKS like land (walls, cannons and castles stand
// on it) and a sea square looks like sea: every square's centre keeps its side by CENTRE_MARGIN, checked when a board is built.

// AUTHORED: lattice points per square (the land mesh's vertices; render/board.js SUB), and the distance the sea's texture holds
export const LATTICE_SUB = 4;
export const COAST_RANGE = 8;
// AUTHORED, chosen by measurement (11-10, the 120 islands CoastFieldTests checks; smallest centre margin over all of them):
//   blur 0 + wobble 0.225 (the old field) 0.296 | blur 0.3 alone 0.223 | 0.3 + 0.12 0.137 | 0.3 + 0.2 0.078 (7 islands under 0.12) |
//   0.35 + 0.1 0.108 (3 under) | 0.4 + 0.1 0.066 (36 under).
// BLUR is the smoothing in squares (the Gaussian's sigma): 0.3 cuts the corner of every step, the drawn coast 11 % shorter than the
// staircase. WOBBLE is how far the noise moves the coast either way: 0.12 is what is left after the smoothing for every centre to
// keep CENTRE_MARGIN.
export const BLUR = 0.3;
export const WOBBLE = 0.12;
// AUTHORED: the least distance, in squares, between a square's centre and the drawn coast: a land square's centre is at least this far
// inland, a sea square's this far out to sea.
export const CENTRE_MARGIN = 0.12;

export class CoastError extends Error {
  constructor(why) { super('coast: ' + why); this.name = 'CoastError'; }
}

/** The coast field of one board. land[y * w + x] is 1 for a square that plays as land, 0 for water; margin squares of sea are drawn
 *  round the board; sub lattice points per square; range clamps the distance (the sea texture holds -range..+range); noise(x, y) is
 *  in 0..1 (render/noise.js makeNoise). */
export class CoastField {
  constructor(land, w, h, { margin, sub, range, noise, blur = BLUR, wobble = WOBBLE }) {
    if (!(land instanceof Uint8Array) || land.length !== w * h) throw new CoastError('land is a Uint8Array of ' + w + ' x ' + h);
    if (typeof noise !== 'function') throw new CoastError('noise is a function');
    this.w = w; this.h = h; this.margin = margin; this.sub = sub; this.range = range;
    const lw = (w + 2 * margin) * sub + 1, lh = (h + 2 * margin) * sub + 1;
    this.lw = lw; this.lh = lh;
    const isLand = (x, y) => x >= 0 && y >= 0 && x < w && y < h && land[y * w + x] === 1;
    // the squares on either side of the coast: only they can be the nearest of the other kind
    const coastLand = [], coastSea = [];
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      const me = isLand(x, y);
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (isLand(x + dx, y + dy) !== me) edge = true;
      if (edge) (me ? coastLand : coastSea).push(x, y);
    }
    this.noLand = coastLand.length === 0;
    const field = new Float32Array(lw * lh);
    if (this.noLand) { field.fill(-range); this.field = field; return; }
    // 1. the exact distance to the squares of the other kind (box distance: the old field, without its noise)
    const boxDist = (px, pz, list) => {
      let best = 1e9;
      for (let k = 0; k < list.length; k += 2) {
        const dx = Math.max(Math.abs(px - (list[k] + 0.5)) - 0.5, 0), dz = Math.max(Math.abs(pz - (list[k + 1] + 0.5)) - 0.5, 0);
        const d = dx * dx + dz * dz; if (d < best) best = d;
      }
      return Math.sqrt(best);
    };
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const px = -margin + i / sub, pz = -margin + j / sub, x = Math.floor(px), y = Math.floor(pz);
      // a point on a square's edge belongs to both; Math.floor gives it to the square to its right / below, as the old field did
      const v = isLand(x, y) ? boxDist(px, pz, coastSea) : -boxDist(px, pz, coastLand);
      field[j * lw + i] = Math.max(-range, Math.min(range, v));
    }
    // 2. the smoothing: a separable Gaussian on the lattice (the edge rows repeat: the lattice's border is deep sea all round)
    if (blur > 0) {
      const sig = blur * sub, r = Math.ceil(sig * 3), ker = new Float32Array(2 * r + 1);
      let sum = 0;
      for (let k = -r; k <= r; k++) { ker[k + r] = Math.exp(-(k * k) / (2 * sig * sig)); sum += ker[k + r]; }
      for (let k = 0; k < ker.length; k++) ker[k] /= sum;
      const tmp = new Float32Array(lw * lh);
      for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += ker[k + r] * field[j * lw + Math.min(lw - 1, Math.max(0, i + k))];
        tmp[j * lw + i] = s;
      }
      for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += ker[k + r] * tmp[Math.min(lh - 1, Math.max(0, j + k)) * lw + i];
        field[j * lw + i] = s;
      }
    }
    // 3. the wobble, so a long straight coast is not ruled with a straight edge
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      const px = -margin + i / sub, pz = -margin + j / sub;
      field[j * lw + i] += (noise(px * 0.45, pz * 0.45) - 0.5) * 2 * wobble;
    }
    this.field = field;
  }

  /** The field at any point (squares): bilinear between the lattice points, so a thing stands exactly on the mesh drawn from them.
   *  A point past the lattice reads its border, which is MARGIN squares out at sea (the deep sea the lattice ends in). */
  at(px, pz) {
    if (this.noLand) return -this.range;
    const { lw, lh, sub, margin, field } = this;
    const fi = Math.min(lw - 1, Math.max(0, (px + margin) * sub)), fj = Math.min(lh - 1, Math.max(0, (pz + margin) * sub));
    const i0 = Math.min(lw - 2, Math.floor(fi)), j0 = Math.min(lh - 2, Math.floor(fj)), tx = fi - i0, tz = fj - j0;
    const a = field[j0 * lw + i0], b = field[j0 * lw + i0 + 1], c = field[(j0 + 1) * lw + i0], d = field[(j0 + 1) * lw + i0 + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /** The smallest margin a square's centre keeps from the coast, on each side: { land: the least field value at a land square's
   *  centre, landAt: [x, y], sea: the least distance out to sea of a sea square's centre (-field), seaAt }. */
  centreMargins(land) {
    let lm = Infinity, la = null, sm = Infinity, sa = null;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const v = this.at(x + 0.5, y + 0.5);
      if (land[y * this.w + x] === 1) { if (v < lm) { lm = v; la = [x, y]; } }
      else if (-v < sm) { sm = -v; sa = [x, y]; }
    }
    return { land: lm, landAt: la, sea: sm, seaAt: sa };
  }

  /** Throws CoastError naming the first square whose centre is drawn on the wrong side of the coast (COAST_UC.md R3). */
  check(land) {
    if (this.noLand) return;
    const m = this.centreMargins(land);
    if (m.land < CENTRE_MARGIN) throw new CoastError('land square ' + m.landAt + ' is drawn only ' + m.land.toFixed(3) + ' squares inland (needs ' + CENTRE_MARGIN + ')');
    if (m.sea < CENTRE_MARGIN) throw new CoastError('sea square ' + m.seaAt + ' is drawn only ' + m.sea.toFixed(3) + ' squares out to sea (needs ' + CENTRE_MARGIN + ')');
  }
}
