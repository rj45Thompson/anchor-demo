// The chord hand's shape: which tracked hand it is, a size- and turn-free description of it, and a memory of the
// shapes that were heard to be right, per chord.
// Serves: S2 (outline the chord hand), S7 (shape ready / looks like), A5 (no tracker), A7 (left-handed).
// Pure: takes landmark lists (21 points, x and y in 0..1 of the raw, un-mirrored camera frame).

// Which hand frets the chords. Facing the camera, a right-handed player's fretting (left) hand is on the camera's
// right, so larger x in the raw frame; left-handed is the reverse. One hand alone counts only on its side.
export function pickChordHand(hands, leftHanded) {
  if (!hands.length) {
    return null;
  }
  const meanX = (h) => h.reduce((s, p) => s + p.x, 0) / h.length;
  const sorted = hands.slice().sort((a, b) => meanX(a) - meanX(b));
  const pick = leftHanded ? sorted[0] : sorted[sorted.length - 1];
  if (hands.length === 1) {
    const x = meanX(pick);
    return (leftHanded ? x < 0.5 : x > 0.5) ? pick : null;
  }
  return pick;
}

// 20 points relative to the wrist, turned so wrist -> middle knuckle points one way, scaled by that length.
// So the same shape held nearer, further or tilted gives the same vector.
export function shapeVector(hand) {
  const w = hand[0];
  const m = hand[9];
  const dx = m.x - w.x;
  const dy = m.y - w.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return null;
  }
  const cos = dx / len;
  const sin = dy / len;
  const v = new Float64Array(40);
  for (let i = 1; i < 21; i++) {
    const px = hand[i].x - w.x;
    const py = hand[i].y - w.y;
    v[(i - 1) * 2] = (px * cos + py * sin) / len;
    v[(i - 1) * 2 + 1] = (-px * sin + py * cos) / len;
  }
  return v;
}

// Mean distance between matching points of two shape vectors.
export function shapeDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < 40; i += 2) {
    sum += Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]);
  }
  return sum / 20;
}

export class ShapeMemory {
  // options: { maxSamplesPerChord, matchRatio } from config.js. saved: an earlier toJSON() or null.
  constructor(options, saved) {
    this.options = options;
    this.shapes = {};
    if (saved) {
      for (const [chord, list] of Object.entries(saved)) {
        this.shapes[chord] = list.map((v) => Float64Array.from(v));
      }
    }
  }

  // S7: a shape seen at the moment the chord was heard right.
  learn(chord, vector) {
    const list = (this.shapes[chord] ??= []);
    list.push(vector);
    if (list.length > this.options.maxSamplesPerChord) {
      list.shift();
    }
  }

  learned() {
    return Object.keys(this.shapes);
  }

  // The learned chord the hand is nearest to, and whether it is clearly that one: its distance times matchRatio
  // is still under the nearest other chord's. With only one chord learned there is nothing to compare, so
  // `clear` is null (the panel says it needs a second chord).
  classify(vector) {
    const scored = Object.entries(this.shapes)
      .map(([chord, list]) => ({ chord, distance: Math.min(...list.map((s) => shapeDistance(vector, s))) }))
      .sort((a, b) => a.distance - b.distance);
    if (!scored.length) {
      return null;
    }
    const [best, next] = scored;
    return {
      chord: best.chord,
      distance: best.distance,
      clear: next ? best.distance * this.options.matchRatio < next.distance : null,
    };
  }

  toJSON() {
    return Object.fromEntries(Object.entries(this.shapes).map(([c, l]) => [c, l.map((v) => Array.from(v))]));
  }
}
