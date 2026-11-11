// Runs the tests, then plants bugs one at a time to show the tests can fail, and writes what happened
// into index.html (the "How it is checked" numbers) and the table of files. Nothing on the page about
// the tests is typed by hand.
//
//   node tools/proof.js           run everything, print it, and rewrite the blocks in index.html
//   node tools/proof.js --dry     run everything and print it; leave index.html alone
//
// The plants run in a copy of the folder in the system's temp directory, so the real code is never
// edited, and every plant must change exactly one place or the run stops.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stamp } from './class_diagram.js';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGE = join(HERE, 'index.html');

// Each plant: a bug a real change could bring in, as an exact edit to core.js.
export const PLANTS = [
  { bug: 'Small rocks split too', change: 'a Small rock\'s pieces are Small rocks',
    find: 'Small:  { radius: 13, score: 120, minSpeed: 62, maxSpeed: 132, smaller: null },',
    put: 'Small:  { radius: 13, score: 120, minSpeed: 62, maxSpeed: 132, smaller: RockSize.Small },' },
  { bug: 'Pieces are not turned apart', change: 'both pieces fly along the parent\'s line',
    find: 'const turned = heading + side * this.rng.range(minAngle, maxAngle);',
    put: 'const turned = heading + 0 * side * this.rng.range(minAngle, maxAngle);' },
  { bug: 'Destroy during iteration', change: 'release() removes the item from the live list at once, mid-loop',
    find: '    item.alive = false;\n    this.dying.push(item);',
    put: '    item.alive = false;\n    if (item.liveIndex >= 0) this.removeFromLive(item);\n    this.free.push(item);' },
  { bug: 'Wrap forgets the top edge', change: 'leaving through the top no longer comes back at the bottom',
    find: 'if (p.y < 0) p.y += this.height; else if (p.y >= this.height) p.y -= this.height;',
    put: 'if (p.y >= this.height) p.y -= this.height;' },
  { bug: 'Extra ship on every score past 15,000', change: 'the threshold is checked, but never moves on',
    find: 'while (this.score >= this.nextExtraShipAt) {',
    put: 'if (this.score >= Rules.extraShipEvery) {' },
  { bug: 'Hunter aims the long way round', change: 'aiming ignores the wrapping edges',
    find: 'const exact = Math.atan2(field.dy(this, target), field.dx(this, target));',
    put: 'const exact = Math.atan2(target.pos.y - this.pos.y, target.pos.x - this.pos.x);' },
  { bug: 'Randomness not from the seed', change: 'the generator is seeded from Math.random()',
    find: 'this.rng = new Random(seed);',
    put: 'this.rng = new Random(Math.random() * 2 ** 32);' },
  { bug: 'A method renamed, the page not updated', change: 'breakRock becomes shatterRock in core.js only',
    find: /breakRock\(/g, put: 'shatterRock(' },
];

// Runs node --test in a folder and reads the TAP report: every top-level test, passed or not.
function runTests(folder) {
  const started = Date.now();
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: folder, encoding: 'utf8' });
  const tests = [];
  for (const line of run.stdout.split(/\r?\n/)) {
    const m = line.match(/^(ok|not ok) \d+ - (.*)$/);
    if (m) tests.push({ name: m[2].replace(/\\#/g, '#'), pass: m[1] === 'ok' });
  }
  const count = name => Number((run.stdout.match(new RegExp(`^# ${name} (\\d+)`, 'm')) || [])[1]);
  const summary = { tests: count('tests'), pass: count('pass'), fail: count('fail'), seconds: (Date.now() - started) / 1000 };
  if (!tests.length || summary.tests !== tests.length) throw new Error(`could not read the test report in ${folder}:\n${run.stdout}\n${run.stderr}`);
  return { ...summary, list: tests };
}

function plantAll() {
  const results = [];
  for (const plant of PLANTS) {
    const folder = mkdtempSync(join(tmpdir(), 'shatterbelt-proof-'));
    try {
      for (const part of ['core.js', 'index.html', 'package.json', 'tools', 'test']) cpSync(join(HERE, part), join(folder, part), { recursive: true });
      const source = readFileSync(join(folder, 'core.js'), 'utf8');
      const hits = typeof plant.find === 'string' ? source.split(plant.find).length - 1 : (source.match(plant.find) || []).length;
      if (hits === 0 || (typeof plant.find === 'string' && hits !== 1)) throw new Error(`plant "${plant.bug}" matches ${hits} places in core.js`);
      writeFileSync(join(folder, 'core.js'), typeof plant.find === 'string' ? source.replace(plant.find, plant.put) : source.replace(plant.find, plant.put));
      const run = runTests(folder);
      results.push({ ...plant, caughtBy: run.list.filter(t => !t.pass).map(t => t.name), of: run.tests });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
  return results;
}

// The code files of the folder, each with its line count and its own first comment line.
function files() {
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (!['assets', 'lib', 'node_modules'].includes(name)) walk(path); continue; }
      if (!/\.(js|py)$/.test(name)) continue;
      const text = readFileSync(path, 'utf8');
      const first = text.split(/\r?\n/).find(l => /^(\/\/|"""|#)/.test(l)) || '';
      const what = first.replace(/^(\/\/|"""|#)\s*/, '').replace(/^[\w./]+\.(js|py)\s*[:-]\s*/i, '').replace(/"""$/, '');
      out.push({ file: relative(HERE, path).replace(/\\/g, '/'), lines: text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0), what });
    }
  };
  walk(HERE);
  const order = ['core.js', 'main.js', 'render.js', 'input.js', 'audio.js'];
  return out.sort((a, b) => (order.indexOf(a.file) + 1 || 99) - (order.indexOf(b.file) + 1 || 99) || a.file.localeCompare(b.file));
}

function folderBytes(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    total += statSync(path).isDirectory() ? folderBytes(path) : statSync(path).size;
  }
  return total;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function testsBlock(run) {
  return `<div class="stat"><div><b>${run.tests}</b><span>tests</span></div><div><b class="ok">${run.pass}</b><span>passed</span></div>` +
    `<div><b class="${run.fail ? 'bad' : ''}">${run.fail}</b><span>failed</span></div>` +
    `<div><b>${run.seconds.toFixed(1)} s</b><span>for the whole run, Node ${process.versions.node}</span></div></div>` +
    `<details><summary>Every test, by name</summary><ol>${run.list.map(t => `<li>${esc(t.name)}${t.pass ? '' : ' <b class="bad">failed</b>'}</li>`).join('')}</ol></details>`;
}

function plantsBlock(plants) {
  const rows = plants.map(p => `<tr><td><b>${esc(p.bug)}</b><br>${esc(p.change)}</td>` +
    `<td>${p.caughtBy.length ? `<span class="ok">caught</span> by ${p.caughtBy.length} of ${p.of}: ${p.caughtBy.map(esc).join('; ')}` : '<span class="bad">not caught</span>'}</td></tr>`);
  return `<div class="tablewrap"><table><thead><tr><th>Planted bug</th><th>Tests that failed</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function filesBlock(list) {
  const shared = ['sky_px.jpg', 'sky_nx.jpg', 'sky_py.jpg', 'sky_ny.jpg', 'sky_pz.jpg', 'sky_nz.jpg', 'planet_derelict.jpg', 'planet_derelict_n.jpg',
    'planet_glacier.jpg', 'planet_glacier_n.jpg', 'gen_nebula.jpg', 'gen_asteroid.jpg', 'audio/arcade.ogg'];
  const sharedBytes = shared.reduce((n, f) => n + statSync(join(HERE, '..', 'games', 'assets', f)).size, 0);
  const rows = list.map(f => `<tr><td><code>${esc(f.file)}</code></td><td>${f.lines}</td><td>${esc(f.what)}</td></tr>`);
  return `<table><thead><tr><th>File</th><th>Lines</th><th>What it is</th></tr></thead><tbody>${rows.join('')}</tbody></table>` +
    `<p class="cap">The whole folder is ${(folderBytes(HERE) / 1048576).toFixed(1)} MB with its models, textures and sounds. ` +
    `The sky, planets, nebula, rock surface and music (${(sharedBytes / 1048576).toFixed(1)} MB) are shared with R&eacute;sum&eacute; Breakout and loaded from its folder.</p>`;
}

function main() {
  const run = runTests(HERE);
  console.log(`tests: ${run.tests}, passed ${run.pass}, failed ${run.fail}, ${run.seconds.toFixed(1)} s`);
  const plants = plantAll();
  for (const p of plants) console.log(`plant "${p.bug}": ${p.caughtBy.length ? `caught by ${p.caughtBy.length}: ${p.caughtBy.join(' | ')}` : 'NOT CAUGHT'}`);
  const list = files();
  if (process.argv.includes('--dry')) return;
  let page = readFileSync(PAGE, 'utf8');
  page = stamp(page, 'tests', testsBlock(run));
  page = stamp(page, 'plants', plantsBlock(plants));
  page = stamp(page, 'files', filesBlock(list));
  writeFileSync(PAGE, page);
  console.log('written into index.html');
  if (run.fail || plants.some(p => !p.caughtBy.length)) process.exitCode = 1;
}

main();
