// Drawing between two steps, checked in node. render.js needs three.js only once a Renderer is made, so its
// pure helpers load here with an empty stand-in for the page's global THREE.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || { THREE: {} };
const { turnBetween } = await import('../render.js');

test('drawing between two steps turns the short way, also across the wrap of the angle', () => {
  const step = 1.2 / 60; // a rock spinning as fast as rocks do, for one step
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  // an ordinary step: halfway is halfway
  assert.ok(near(turnBetween(0.5, 0.5 + step, 0.5), 0.5 + step / 2));
  // across the wrap, turning up: from just under a half turn to just over minus a half turn
  const before = Math.PI - step / 4;
  const after = before + step - 2 * Math.PI;
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    const drawn = turnBetween(before, after, alpha);
    assert.ok(near(drawn, before + step * alpha), `alpha ${alpha}: drawn at ${drawn}, not ${before + step * alpha}`);
  }
  // and turning down
  assert.ok(near(turnBetween(-Math.PI + step / 4, Math.PI - (3 * step) / 4, 0.5), -Math.PI + step / 4 - step / 2));
});
