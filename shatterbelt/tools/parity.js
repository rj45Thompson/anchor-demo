// Holds the C++ twin in cpp/ to core.js: builds it with MSVC, runs its tests, plants bugs in a copy of it
// to show the tests can fail, then plays the same games through both cores and compares the whole game
// after every step, to the last bit. It writes what happened into index.html (the cpp block). Nothing in
// that block is typed by hand.
//
//   node tools/parity.js           run everything, print it, and rewrite the block in index.html
//   node tools/parity.js --dry     run everything and print it; leave index.html alone
//
// Needs cl.exe: run it from a Developer Command Prompt for Visual Studio, or anywhere Visual Studio's C++
// tools are installed (cpp/build.cmd finds them). Everything is built in the system's temp directory, and
// the plants edit a copy of cpp/, never cpp/ itself.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readStep, stamp } from './class_diagram.js';
import { Game, Random, Trig, Input } from '../core.js';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const CPP = join(HERE, 'cpp');
const PAGE = join(HERE, 'index.html');

// ---- the games ----------------------------------------------------------------------------------
// Each is a seed, field options and a player. A player is made fresh for each run and is asked for one
// byte of input per step, seeing the game as it goes; its bytes are recorded into the game file that
// both cores then replay. Every player is seeded, so every run plays the same games. Between them the
// games lose ships, jump to hyperspace, meet both kinds of hunter, earn extra ships and end in game
// over (main() checks that they really do).
const { Left, Right, Thrust, Fire, Hyperspace } = Input;

function holder(seed, every) { // changes what it holds every so often
  const rng = new Random(seed);
  let held = 0;
  return () => { if (rng.oneIn(every)) held = rng.int(32); return held; };
}

// Turns toward the nearest rock or hunter, fires when it faces it, and jumps to hyperspace when
// something is about to hit it.
function aimer() {
  return game => {
    const { ship, field } = game;
    if (!ship.alive || ship.jumping > 0) return 0;
    let target = null;
    let best = Infinity;
    for (const pool of [game.rocks, game.hunters]) {
      for (const e of pool.live) {
        const d = e.alive ? field.distanceSquared(ship, e) : Infinity;
        if (d < best) { best = d; target = e; }
      }
    }
    if (!target) return 0;
    const want = Trig.atan2(field.dy(ship, target), field.dx(ship, target));
    const off = Trig.atan2(Trig.sin(want - ship.angle), Trig.cos(want - ship.angle));
    let input = Math.abs(off) > 0.06 ? (off > 0 ? Right : Left) : 0;
    if (Math.abs(off) < 0.2) input |= Fire;
    const reach = ship.radius + target.radius + 30;
    if (best < reach * reach && ship.invulnerable <= 0) input |= Hyperspace;
    return input;
  };
}

export const GAMES = [
  { name: 'a player who changes what they hold every so often', options: { seed: 77 }, steps: 6000, player: () => holder(2024, 12) },
  { name: 'spin and fire, thrusting now and then', options: { seed: 1 }, steps: 20000,
    player: () => { let step = 0; return () => Left | Fire | (step++ % 300 < 20 ? Thrust : 0); } },
  { name: 'fire, turn, and jump to hyperspace every 1.5 seconds', options: { seed: 2024 }, steps: 8000,
    player: () => { let step = 0; return () => { const s = step++; return Fire | (s % 240 < 120 ? Right : 0) | (s % 90 === 0 ? Hyperspace : 0); }; } },
  { name: 'reckless: thrust and turn into everything', options: { seed: 9 }, steps: 6000,
    player: () => { let step = 0; return () => Thrust | Right | (step++ % 60 < 30 ? Fire : 0); } },
  { name: 'an upright phone field, 622 by 1005', options: { seed: 5, width: 622, height: 1005 }, steps: 6000, player: () => holder(31, 8) },
  { name: 'five ships, and a new random input every step', options: { seed: 4242, startingShips: 5 }, steps: 8000,
    player: () => { const rng = new Random(99); return () => rng.int(32); } },
  { name: 'a bot that aims at the nearest rock or hunter', options: { seed: 3 }, steps: 25000, player: aimer },
];

// Records a game's inputs by letting its player play core.js, and writes the game file replay.exe reads.
export function gameFile(folder, index, game) {
  const o = { seed: 1, width: 1000, height: 625, startingShips: 3, ...game.options };
  const player = game.player();
  const played = new Game(game.options);
  const bytes = Buffer.alloc(game.steps);
  for (let i = 0; i < game.steps; i++) {
    bytes[i] = player(played);
    played.step(bytes[i]);
  }
  const path = join(folder, `game${index + 1}.bin`);
  writeFileSync(path, Buffer.concat([Buffer.from(`shatterbelt-game seed=${o.seed} width=${o.width} height=${o.height} startingShips=${o.startingShips} steps=${game.steps}\n`), bytes]));
  return { path, bytes };
}

// ---- building and testing the C++ ---------------------------------------------------------------

export function build(source, out) {
  const run = spawnSync('cmd.exe', ['/d', '/c', 'call', join(source, 'build.cmd'), out, source], { encoding: 'utf8' });
  const output = `${run.stdout}${run.stderr}`;
  if (run.status !== 0) throw new Error(`cpp/build.cmd failed (exit ${run.status}):\n${output}`);
  return { output, warnings: (output.match(/warning [A-Z]+\d+/g) || []).length };
}

// Runs test_core.exe and reads its TAP lines. A run that crashes counts the test it was in as failed.
function runCppTests(out) {
  const run = spawnSync(join(out, 'test_core.exe'), { encoding: 'utf8' });
  const tests = [];
  const notes = [];
  let running = null;
  for (const line of run.stdout.split(/\r?\n/)) {
    const result = line.match(/^(ok|not ok) \d+ - (.*)$/);
    const started = line.match(/^# running \d+ - (.*)$/);
    if (result) { tests.push({ name: result[2], pass: result[1] === 'ok' }); running = null; }
    else if (started) running = started[1];
    else if (/^# {3}/.test(line)) notes.push(line.slice(4));
  }
  if (running) tests.push({ name: running, pass: false, crashed: `${run.stderr}`.trim() || `exit ${run.status}` });
  if (!tests.length) throw new Error(`could not read test_core.exe's report:\n${run.stdout}\n${run.stderr}`);
  const declared = Number((run.stdout.match(/^# tests (\d+)/m) || [])[1]) || null;
  return { tests, notes, declared, status: run.status, pass: tests.filter(t => t.pass).length };
}

// Each plant: a bug a real change could bring in, as an exact edit to one file of a copy of cpp/.
export const PLANTS = [
  { bug: 'Small rocks split too', change: 'a Small rock\'s pieces are Small rocks', file: 'shatterbelt_core.h',
    find: '{  13,    120,     62,      132,   RockSize::None } };  // Small',
    put: '{  13,    120,     62,      132,   RockSize::Small } };  // Small' },
  { bug: 'Destroy during iteration', change: 'Release() takes the object out of the live list at once, mid-loop', file: 'shatterbelt_core.h',
    find: '        item.alive = false;\n        dying[dyingCount++] = item.slot;',
    put: '        item.alive = false;\n        if (item.liveIndex >= 0) RemoveFromLive(item);\n        free[freeCount++] = item.slot;' },
  { bug: 'Wrap forgets the top edge', change: 'leaving through the top no longer comes back at the bottom', file: 'shatterbelt_core.cpp',
    find: 'if (p.y < 0) p.y += height; else if (p.y >= height) p.y -= height;',
    put: 'if (p.y >= height) p.y -= height;' },
  { bug: 'Extra ship on every score past 15,000', change: 'the threshold is checked, but never moves on', file: 'shatterbelt_core.cpp',
    find: 'while (!over && score >= nextExtraShipAt)',
    put: 'if (!over && score >= Rules::extraShipEvery)' },
  { bug: 'Game over decided at the crash', change: 'the last ship lost ends the game before the rest of the step\'s hits count', file: 'shatterbelt_core.cpp',
    find: '    Emit(EventType::shipDestroyed, ship);\n}',
    put: '    Emit(EventType::shipDestroyed, ship);\n    CheckGameOver();\n}' },
  { bug: 'Rock pool too small', change: 'the rock pool holds 48, as it once did', file: 'shatterbelt_core.h',
    find: 'constexpr int bullets = 16, rocks = 66, hunters = 2;',
    put: 'constexpr int bullets = 16, rocks = 48, hunters = 2;' },
  { bug: 'Hyperspace keeps the shield', change: 'a jump taken under the respawn shield lands with it still on', file: 'shatterbelt_core.cpp',
    find: '    ship.invulnerable = 0; // a jump taken under the respawn shield lands without it\n',
    put: '' },
  { bug: 'Hunter blind to a shielded ship', change: 'the Small hunter aims only at a ship it can hit', file: 'shatterbelt_core.cpp',
    find: 'const Entity* target = ship.alive && ship.jumping <= 0 ? &ship : nullptr;',
    put: 'const Entity* target = ship.CanBeHit() ? &ship : nullptr;' },
  { bug: 'Angle never wrapped', change: 'a spinning rock\'s angle grows for ever', file: 'shatterbelt_core.cpp',
    find: '    if (angle > Trig::Pi) angle -= 2 * Trig::Pi; else if (angle <= -Trig::Pi) angle += 2 * Trig::Pi;\n',
    put: '' },
  { bug: 'Game::Step allocates', change: 'Collide() makes a scratch list with new on every step', file: 'shatterbelt_core.cpp',
    find: 'void Game::Collide()\n{\n',
    put: 'void Game::Collide()\n{\n    int* scratch = new int[bullets.LiveCount() + 1];\n    delete[] scratch;\n' },
  { bug: 'Random is not quite mulberry32', change: 'one constant in Random::Next() is 63 where core.js has 61', file: 'shatterbelt_core.cpp',
    find: 't ^= t + (t ^ (t >> 7)) * (t | 61u);',
    put: 't ^= t + (t ^ (t >> 7)) * (t | 63u);' },
  { bug: 'Two random draws in one call', change: 'ArriveFromHyperspace() draws x and y inside the arguments of Place(), whose order C++ leaves open',
    file: 'shatterbelt_core.cpp', parity: true,
    find: '    const double x = rng.Range(0, field.width);\n    const double y = rng.Range(0, field.height);\n    ship.Place(x, y, 0, 0, ship.angle);',
    put: '    ship.Place(rng.Range(0, field.width), rng.Range(0, field.height), 0, 0, ship.angle);' },
];

function cppSources(folder) {
  for (const name of readdirSync(CPP)) if (/\.(h|cpp|cmd)$/.test(name)) cpSync(join(CPP, name), join(folder, name));
}

async function plantAll(files, work, testCount) {
  const results = [];
  for (const plant of PLANTS) {
    const folder = mkdtempSync(join(work, 'plant-'));
    const source = join(folder, 'src');
    cppSources(source);
    const path = join(source, plant.file);
    const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n'); // the plants are written with \n
    const hits = text.split(plant.find).length - 1;
    if (hits !== 1) throw new Error(`plant "${plant.bug}" matches ${hits} places in ${plant.file}`);
    writeFileSync(path, text.replace(plant.find, plant.put));
    build(source, join(folder, 'build'));
    const run = runCppTests(join(folder, 'build'));
    const result = { ...plant, caughtBy: run.tests.filter(t => !t.pass), of: testCount }; // a crashed run never prints its count
    if (plant.parity) result.parity = await compareAll(files, join(folder, 'build', 'replay.exe'), Game);
    results.push(result);
  }
  return results;
}

// ---- comparing the two cores --------------------------------------------------------------------

// The first place two snapshots differ, as a path like "rocks[3][5]", or null. Numbers must be the same
// double: Object.is, so even 0 and -0 differ.
function firstDifference(js, cpp, path = '') {
  if (typeof js !== typeof cpp) return { path, js, cpp };
  if (Array.isArray(js)) {
    if (!Array.isArray(cpp) || js.length !== cpp.length) return { path: `${path}.length`, js: js.length, cpp: cpp && cpp.length };
    for (let i = 0; i < js.length; i++) { const d = firstDifference(js[i], cpp[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (js && typeof js === 'object') {
    const keys = Object.keys(js);
    if (keys.join() !== Object.keys(cpp).join()) return { path: `${path} keys`, js: keys.join(), cpp: Object.keys(cpp).join() };
    for (const key of keys) { const d = firstDifference(js[key], cpp[key], path ? `${path}.${key}` : key); if (d) return d; }
    return null;
  }
  return Object.is(js, cpp) ? null : { path, js, cpp };
}

// Plays one game file through the C++ program and through GameClass in step, comparing every line. Stops
// at the first difference. Also counts what happened, from core.js's events.
async function compareGame(exe, file, game, GameClass) {
  const child = spawn(exe, [file.path, '--every', '1']);
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const exited = new Promise(resolve => child.on('close', code => resolve(code)));
  const js = new GameClass(game.options);
  const seen = { shipDestroyed: 0, hyperspaceOut: 0, hyperspaceFailed: 0, hunterArrived: 0, hunterDestroyed: 0, extraShip: 0, rockBroken: 0, gameOver: 0 };
  let smallHunters = 0;
  let step = 0;
  let compared = 0;
  let difference = null;
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    let names = [];
    if (step > 0) {
      const events = js.step(file.bytes[step - 1]);
      names = events.map(e => e.type);
      for (const e of events) {
        if (e.type in seen) seen[e.type] += 1;
        if (e.type === 'hunterArrived' && e.kind === 'Small') smallHunters += 1;
      }
    }
    const cpp = JSON.parse(line);
    difference = firstDifference(js.snapshot(), cpp.snapshot, 'snapshot') || firstDifference(names, cpp.events, 'events');
    if (difference) { difference.step = step; child.kill(); break; }
    compared += 1;
    step += 1;
  }
  const code = await exited;
  if (!difference && (code !== 0 || compared !== game.steps + 1)) throw new Error(`${exe} stopped early on ${file.path}: exit ${code}, ${compared} lines\n${stderr}`);
  return { name: game.name, steps: game.steps, compared, difference, seen, smallHunters, score: js.score, wave: js.wave, over: js.over };
}

export async function compareAll(files, exe, GameClass) {
  const results = [];
  for (let i = 0; i < GAMES.length; i++) results.push(await compareGame(exe, files[i], GAMES[i], GameClass));
  return results;
}

// core.js with each Trig call turned back into the browser's own Math function, in a scratch folder.
async function libraryMathCore(work) {
  const source = readFileSync(join(HERE, 'core.js'), 'utf8');
  let replaced = 0;
  const changed = source.replace(/\bTrig\.(sin|cos|atan2|hypot)\(/g, (_, name) => { replaced += 1; return `Math.${name}(`; });
  if (!replaced) throw new Error('core.js has no Trig calls to replace');
  const path = join(mkdtempSync(join(work, 'library-')), 'core.js');
  writeFileSync(path, changed);
  return { module: await import(pathToFileURL(path).href), replaced };
}

// ---- the page -----------------------------------------------------------------------------------

// The page boxes inline code; inside a code block that would box every line.
const PLAIN = ' style="border:0;background:none;padding:0"';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = x => x.toLocaleString('en-US');
const of = (count, thing) => `${n(count)} ${thing}${count === 1 ? '' : 's'}`;

// Game::Step() as written in shatterbelt_core.cpp, from its first line to its closing brace.
export function readCppStep(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith('const EventList& Game::Step('));
  if (start < 0) throw new Error('Game::Step not found in cpp/shatterbelt_core.cpp');
  return lines.slice(start, lines.indexOf('}', start) + 1).join('\n');
}

function readFlags() {
  const m = readFileSync(join(CPP, 'build.cmd'), 'utf8').match(/^set "FLAGS=(.*)"\r?$/m);
  if (!m) throw new Error('no set "FLAGS=..." line in cpp/build.cmd');
  return m[1];
}

function describe(d) {
  const show = v => (typeof v === 'number' ? String(v) : JSON.stringify(v));
  return `<code>${esc(d.path)}</code> was ${esc(show(d.js))} in core.js and ${esc(show(d.cpp))} in C++`;
}

function block(r) {
  const jsStep = readStep(readFileSync(join(HERE, 'core.js'), 'utf8'));
  const cppStep = readCppStep(readFileSync(join(CPP, 'shatterbelt_core.cpp'), 'utf8'));
  const steps = r.parity.reduce((s, g) => s + g.steps, 0);
  const compared = r.parity.reduce((s, g) => s + g.compared, 0);
  const differ = r.parity.filter(g => g.difference);
  const total = key => r.parity.reduce((s, g) => s + g.seen[key], 0);
  const overs = r.parity.filter(g => g.over).length;
  const smalls = r.parity.reduce((s, g) => s + g.smallHunters, 0);
  const alloc = (r.tests.notes.find(t => /operator new calls/.test(t)) || '').match(/^(\d+) operator new calls in ([\d,]+) steps/);
  const trig = (r.tests.notes.find(t => /units in the last place/.test(t)) || '').split(': ')[1];
  const parted = r.library.results.filter(g => g.difference);
  const firstParted = parted.length ? parted.reduce((a, b) => (a.difference.step <= b.difference.step ? a : b)) : null;
  const byTests = r.plants.filter(p => p.caughtBy.length).length;
  const byParity = r.plants.filter(p => !p.caughtBy.length && p.parity && p.parity.some(g => g.difference)).length;

  // two columns only where a whole line of either file fits (play_check: 'every code block on the page fits its box')
  const sideBySide = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,700px),1fr));gap:0 14px">` +
    `<div><p class="cap">core.js</p><pre class="code"><code${PLAIN}>${esc(jsStep)}</code></pre></div>` +
    `<div><p class="cap">cpp/shatterbelt_core.cpp</p><pre class="code"><code${PLAIN}>${esc(cppStep)}</code></pre></div></div>`;

  const plantRows = r.plants.map(p => {
    const tests = p.caughtBy.length
      ? `<span class="ok">caught</span> by ${p.caughtBy.length} of ${p.of} C++ tests: ${p.caughtBy.map(t => esc(t.name) + (t.crashed ? ` (the run stopped there: ${esc(t.crashed)})` : '')).join('; ')}`
      : '<span class="bad">not caught</span> by the C++ tests';
    let parity = '';
    if (p.parity) {
      const hit = p.parity.find(g => g.difference);
      parity = hit ? `. <span class="ok">Caught</span> by the comparison with core.js: game ${r.parity.findIndex(g => g.name === hit.name) + 1} parted at step ${n(hit.difference.step)}, where ${describe(hit.difference)}`
        : '. <span class="bad">Not caught</span> by the comparison with core.js either';
    }
    return `<tr><td><b>${esc(p.bug)}</b><br>${esc(p.change)}</td><td>${tests}${parity}</td></tr>`;
  });

  const gameRows = r.parity.map((g, i) => `<tr><td>${i + 1}. ${esc(g.name)}</td><td>${n(g.steps)}</td>` +
    `<td>${of(g.seen.shipDestroyed, 'ship')} lost${g.over ? ', game over' : ''}; ${of(g.seen.hyperspaceOut, 'jump')}; ` +
    `${of(g.seen.hunterArrived, 'hunter')} (${g.smallHunters} Small); ${of(g.seen.rockBroken, 'rock')} broken; score ${n(g.score)}, wave ${g.wave}</td>` +
    `<td>${g.difference ? `<span class="bad">step ${n(g.difference.step)}</span>: ${describe(g.difference)}` : '<span class="ok">none</span>'}</td></tr>`);

  return `<h3>The same core in C++</h3>` +
    `<p>The rules again in C++17, with the same classes, names and order: <a href="cpp/shatterbelt_core.h"><code>cpp/shatterbelt_core.h</code></a> and ` +
    `<a href="cpp/shatterbelt_core.cpp"><code>cpp/shatterbelt_core.cpp</code></a>. Pools are fixed arrays with a free list, nothing is allocated once a game exists, ` +
    `and there are no exceptions, no RTTI and no virtual functions. One step in each, read out of the two files:</p>` + sideBySide +
    `<p>Built by <a href="cpp/build.cmd"><code>cpp/build.cmd</code></a> with Microsoft C/C++ ${esc(r.compiler)}, with ${r.warnings} warnings:</p>` +
    `<pre class="code"><code${PLAIN}>cl ${esc(r.flags)} replay_main.cpp shatterbelt_core.cpp</code></pre>` +
    `<div class="stat"><div><b>${GAMES.length}</b><span>games played through both cores, ${n(steps)} steps in all</span></div>` +
    `<div><b>${n(compared)}</b><span>snapshots compared, every number to the last bit, and every step's events by name</span></div>` +
    `<div><b class="${differ.length ? 'bad' : 'ok'}">${differ.length}</b><span>games where the two cores differed</span></div>` +
    `<div><b class="${r.tests.pass === r.tests.declared ? 'ok' : 'bad'}">${r.tests.pass} of ${r.tests.declared}</b><span>C++ tests passed (<a href="cpp/test_core.cpp">test_core.cpp</a>)</span></div></div>` +
    `<p class="cap">Measured by <code>tools/parity.js</code>, which records each game's inputs, replays them through <code>replay_main.cpp</code> and core.js, ` +
    `and compares the whole game after every step. Between them the games lost ${total('shipDestroyed')} ships, ended in game over ${overs} times, ` +
    `jumped to hyperspace ${total('hyperspaceOut')} times (${total('hyperspaceFailed')} jumps failed), met ${total('hunterArrived')} hunters (${smalls} of them Small) ` +
    `and earned ${total('extraShip')} extra ships. ` +
    (alloc ? `In the C++ tests, a ${alloc[2]}-step game made ${alloc[1]} calls to operator new.` : '') + `</p>` +
    `<details><summary>Each game</summary><div class="tablewrap"><table><thead><tr><th>Game</th><th>Steps</th><th>What happened</th><th>First difference</th></tr></thead>` +
    `<tbody>${gameRows.join('')}</tbody></table></div></details>` +
    `<p><b>Why there is a <code>Trig</code> class.</b> Both cores take sin, cos, atan2 and hypot from <code>Trig</code>, written the same way in both, ` +
    `from + - * / and square root only. IEEE 754 requires those five to be correctly rounded, so they give the same bits on every machine that follows it. ` +
    `With each language's own functions instead (the browser's <code>Math</code> and the Microsoft C runtime), ` +
    (firstParted ? `${parted.length} of ${GAMES.length} games parted, the first ${firstParted.difference.step ? `at step ${n(firstParted.difference.step)}` : 'as soon as it was made, before step 1'}, where ${describe(firstParted.difference)}. ` : 'no game parted. ') +
    `That was measured by the same comparison, on a copy of core.js with its ${r.library.replaced} Trig calls turned back into Math calls.` +
    (trig ? ` Trig's worst distance from the C runtime's functions in a million tries, in units in the last place: ${esc(trig)}.` : '') + `</p>` +
    `<p><b>Can these checks fail?</b> <code>tools/parity.js</code> also plants one bug at a time in a copy of the C++ and runs the checks again. ` +
    `${byTests + byParity} of ${r.plants.length} were caught: ${byTests} by the C++ tests, ${byParity} only by the comparison with core.js.</p>` +
    `<div class="tablewrap"><table><thead><tr><th>Planted in a copy of the C++</th><th>What failed</th></tr></thead><tbody>${plantRows.join('')}</tbody></table></div>`;
}

// ---- the run ------------------------------------------------------------------------------------

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'shatterbelt-parity-'));
  try {
    const out = join(work, 'build');
    const built = build(CPP, out);
    const compiler = (readFileSync(join(out, 'compiler.txt'), 'utf8').match(/Version ([\d.]+ for \w+)/) || [])[1];
    if (!compiler) throw new Error('could not read the compiler version from compiler.txt');
    console.log(`built with MSVC ${compiler}, ${built.warnings} warnings`);

    const tests = runCppTests(out);
    console.log(`C++ tests: ${tests.pass} of ${tests.declared} passed`);
    for (const note of tests.notes) console.log(`  ${note}`);
    for (const t of tests.tests.filter(t => !t.pass)) console.log(`  FAILED: ${t.name}${t.crashed ? ` (crashed: ${t.crashed})` : ''}`);

    const files = GAMES.map((g, i) => gameFile(work, i, g));
    const parity = await compareAll(files, join(out, 'replay.exe'), Game);
    for (const g of parity) {
      console.log(`game "${g.name}": ${g.compared} snapshots, ${g.difference ? `DIFFERS at step ${g.difference.step}: ${g.difference.path} js=${g.difference.js} cpp=${g.difference.cpp}` : 'same'}` +
        ` (${g.seen.shipDestroyed} lost, ${g.seen.hyperspaceOut} jumps, ${g.seen.hunterArrived} hunters/${g.smallHunters} small, over=${g.over}, score ${g.score}, wave ${g.wave})`);
    }
    const covered = ['shipDestroyed', 'hyperspaceOut', 'hyperspaceFailed', 'hunterArrived', 'hunterDestroyed', 'gameOver', 'extraShip']
      .filter(k => !parity.some(g => g.seen[k] > 0));
    if (covered.length || !parity.some(g => g.smallHunters > 0)) throw new Error(`the games never had: ${[...covered, 'a Small hunter'].join(', ')}`);

    const libraryCore = await libraryMathCore(work);
    const library = { replaced: libraryCore.replaced, results: await compareAll(files, join(out, 'replay_library_math.exe'), libraryCore.module.Game) };
    for (const g of library.results) console.log(`library math, game "${g.name}": ${g.difference ? `parted at step ${g.difference.step}: ${g.difference.path} js=${g.difference.js} cpp=${g.difference.cpp}` : 'same'}`);

    const plants = await plantAll(files, work, tests.declared);
    for (const p of plants) {
      console.log(`plant "${p.bug}": ${p.caughtBy.length ? `caught by ${p.caughtBy.length}: ${p.caughtBy.map(t => t.name + (t.crashed ? ` [crashed: ${t.crashed}]` : '')).join(' | ')}` : 'NOT CAUGHT by the C++ tests'}`);
      if (p.parity) { const hit = p.parity.find(g => g.difference); console.log(`  parity: ${hit ? `parted in "${hit.name}" at step ${hit.difference.step} (${hit.difference.path})` : 'NOT CAUGHT'}`); }
    }

    const results = { compiler, flags: readFlags(), warnings: built.warnings, tests, parity, library, plants };
    const failed = built.warnings || tests.pass !== tests.declared || parity.some(g => g.difference) ||
      plants.some(p => !p.caughtBy.length && !(p.parity && p.parity.some(g => g.difference)));
    if (process.argv.includes('--dry')) { process.exitCode = failed ? 1 : 0; return; }
    writeFileSync(PAGE, stamp(readFileSync(PAGE, 'utf8'), 'cpp', block(results)));
    console.log('written into index.html');
    if (failed) process.exitCode = 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
