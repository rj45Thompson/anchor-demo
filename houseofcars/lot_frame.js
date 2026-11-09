// lot_frame.js - UC-44.3 the lot's camera puts the slide's subject (its car on the pedestal, or its sign) where the panels leave
// the screen free. MEASURED before this (lot pass 11-08, shots/lotpass_harness/lot_layout9.py, the Mercedes's slide): the panels
// covered 41 % of the car's box on a phone on its side at 915 x 412, 60 % at 844 x 390, 88 % at 740 x 360, 28 % on a 1024 x 768
// tablet and 7 to 13 % on 1280 to 1440 px computers (the sales chat over the car's left, the card over its right); the camera was
// placed by hand-set numbers (app.js tickShow: a 1.6 m step left on screens over 900 px, a lower aim upright), which knew nothing of
// where the chat or the card actually sat.
// Now: app.js reads the panels' boxes off the page (only when one changes: a ResizeObserver, a resize), this module finds the
// rectangles they leave free, and each frame fits the subject's box (projected from the authored camera) into the best one: the
// largest scale (never closer than the authored camera, s <= 1), then the least move. app.js pulls the camera back by 1 / s and
// shifts the picture by (dx, dy) with a lens shift (camera.setViewOffset): the camera's pose, the ring behind and the light stay
// the authored ones. Pure (no three.js, no page): test/lot_frame.test.mjs.

// AUTHORED: the space kept between the subject and a panel; the smallest scale worth using (below it the car is too small to
// read and the authored framing stands, the panels over it: the layout check reports that cover); a tie in scale within TIE_S is
// settled by the least move; and the farthest it may move, a quarter of the screen each way (a free corner beside the footer would
// otherwise take a small car out of the middle: the 844 x 390 case in test/lot_frame.test.mjs)
export const FRAME = { GAP: 12, MIN_S: 0.55, TIE_S: 0.02, MOVE: 0.25, SCAN_S: 0.025 };

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const contains = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];

/** view { w, h } CSS px; panels [[x0, y0, x1, y1], ...] CSS px. Every rectangle whose sides lie on the screen's edges or on a
 *  panel's edges (each panel grown by gap), that no grown panel overlaps, and that no other such rectangle contains */
export function freeRects(view, panels, gap) {
  if (!(view.w > 0 && view.h > 0)) throw new Error('lot_frame.freeRects: the view has no size: ' + JSON.stringify(view));
  const P = panels.map((p) => {
    if (p.length !== 4 || p.some((v) => !Number.isFinite(v)) || p[2] < p[0] || p[3] < p[1]) throw new Error('lot_frame.freeRects: not a box: ' + JSON.stringify(p));
    return [p[0] - gap, p[1] - gap, p[2] + gap, p[3] + gap];
  });
  const edges = (lo, hi, k) => [...new Set([lo, hi, ...P.flatMap((p) => [p[k], p[k + 2]])].map((v) => Math.min(hi, Math.max(lo, v))))].sort((a, b) => a - b);
  const xs = edges(0, view.w, 0), ys = edges(0, view.h, 1), out = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++)
    for (let k = 0; k < ys.length; k++) for (let l = k + 1; l < ys.length; l++) {
      const r = [xs[i], ys[k], xs[j], ys[l]];
      if (!P.some((p) => overlaps(p, r))) out.push(r);
    }
  return out.filter((r) => !out.some((q) => q !== r && contains(q, r)));
}

/** sub: the subject's box on screen [x0, y0, x1, y1] under the authored camera; rects: freeRects(...); view { w, h }.
 *  A pull back by 1 / s shrinks the subject toward the view's centre by s; then (dx, dy) px moves it, the least distance that puts it
 *  inside a free rectangle. Returns { s, dx, dy, fits, rect }; fits false (s 1, no move) when no rectangle holds it at MIN_S or more
 *  within MOVE of where it was */
export function fitSubject(sub, rects, view, o = FRAME) {
  const bw = sub[2] - sub[0], bh = sub[3] - sub[1];
  if (!(bw > 0 && bh > 0)) throw new Error('lot_frame.fitSubject: the subject has no size on screen: ' + JSON.stringify(sub));
  const cx = view.w / 2, cy = view.h / 2, clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // per rectangle, the largest scale that fits it AND needs no move past MOVE: a smaller subject sits nearer the centre, so it moves
  // less (11-09, a 1024 x 768 tablet: at the largest scale the car had to rise 209 px, past a quarter, and nothing fitted; at 0.8 it
  // rises less and clears the card and the chat). AUTHORED: tried in steps of SCAN_S
  const fits = rects.map((r) => {
    for (let s = Math.min(1, (r[2] - r[0]) / bw, (r[3] - r[1]) / bh); s >= o.MIN_S - 1e-9; s -= o.SCAN_S) {
      const x0 = cx + (sub[0] - cx) * s, y0 = cy + (sub[1] - cy) * s;
      const dx = clamp(x0, r[0], r[2] - bw * s) - x0, dy = clamp(y0, r[1], r[3] - bh * s) - y0;
      if (Math.abs(dx) <= o.MOVE * view.w && Math.abs(dy) <= o.MOVE * view.h) return { s, dx, dy, move: Math.hypot(dx, dy), rect: r };
    }
    return null;
  }).filter(Boolean);
  const top = Math.max(...fits.map((f) => f.s));
  const best = fits.filter((f) => f.s >= top - o.TIE_S).sort((a, b) => a.move - b.move)[0];
  if (!best) return { s: 1, dx: 0, dy: 0, fits: false, rect: null };
  return { s: best.s, dx: best.dx, dy: best.dy, fits: true, rect: best.rect };
}

/** the panels' boxes, merged where a row of them reads as one (the header's title and pills, the nav's buttons): boxes
 *  { name: [x0, y0, x1, y1] } with names 'group:part' merged per group. Pure: app.js hands it what it read off the page */
export function mergeGroups(boxes) {
  const g = new Map();
  for (const [k, b] of Object.entries(boxes)) {
    const n = k.split(':')[0], m = g.get(n);
    g.set(n, m ? [Math.min(m[0], b[0]), Math.min(m[1], b[1]), Math.max(m[2], b[2]), Math.max(m[3], b[3])] : b.slice());
  }
  return [...g.values()];
}
