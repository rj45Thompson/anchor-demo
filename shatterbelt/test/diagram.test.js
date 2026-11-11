// The page's class diagram and main loop are read out of core.js. These fail when the page and the
// code disagree, and show that the reader really reads: a renamed method changes the diagram.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE, PAGE, blocks, between, readClasses, readStep } from '../tools/class_diagram.js';

const source = readFileSync(CORE, 'utf8');

test('the class diagram on the page is the one core.js gives today', () => {
  assert.equal(between(readFileSync(PAGE, 'utf8'), 'diagram'), blocks(source).diagram,
    'run: node tools/class_diagram.js');
});

test('the main loop on the page is Game.step() as written', () => {
  assert.equal(between(readFileSync(PAGE, 'utf8'), 'step'), blocks(source).step, 'run: node tools/class_diagram.js');
});

test('the diagram names every class core.js exports, and every Game method', () => {
  const exported = [...source.matchAll(/^export class (\w+)/gm)].map(m => m[1]);
  const classes = readClasses(source);
  assert.deepEqual(classes.map(c => c.name), exported);
  const svg = blocks(source).diagram;
  for (const name of exported) assert.ok(svg.includes(`>${name}</text>`), `${name} drawn`);
  const game = classes.find(c => c.name === 'Game');
  const methods = [...source.slice(source.indexOf('export class Game')).matchAll(/^ {2}(\w+)\(/gm)].map(m => m[1]).filter(m => m !== 'constructor');
  const drawn = game.sections.flatMap(s => s.methods).map(m => m.split('(')[0]);
  assert.deepEqual(drawn, methods.slice(0, drawn.length));
  assert.equal(drawn.length, methods.length);
});

test('the reader follows the code: renaming a method changes the diagram', () => {
  const renamed = source.replace('  breakRock(rock, byShip) {', '  shatterRock(rock, byShip) {');
  assert.notEqual(renamed, source);
  assert.notEqual(blocks(renamed).diagram, blocks(source).diagram);
  assert.ok(blocks(renamed).diagram.includes('shatterRock(rock, byShip)'));
  assert.match(readStep(source), /this\.flush\(\);/);
});

test('every class box opens its own line of core.js on GitHub, so a reader goes from the picture to the code', () => {
  const svg = blocks(source).diagram;
  const lines = source.split(/\r?\n/);
  const exported = [...source.matchAll(/^export class (\w+)/gm)].map(m => m[1]);
  for (const name of exported) {
    const link = svg.match(new RegExp(
      `<a href="https://github\\.com/rj45Thompson/anchor-demo/blob/main/shatterbelt/core\\.js#L(\\d+)"[^>]*>` +
      `<title>[^<]*</title><g class="cls[^"]*"><rect[^>]*/><text class="name"[^>]*>${name}</text>`));
    assert.ok(link, `${name}: its box links to core.js`);
    assert.match(lines[Number(link[1]) - 1], new RegExp(`^export class ${name}\\b`), `${name}: the link lands on its class line`);
  }
});
