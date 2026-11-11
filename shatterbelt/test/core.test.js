// The rules of Shatterbelt, checked in node. Run from the shatterbelt folder:   node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, Field, Pool, Rock, Hunter, Random, FixedTimestep, InputLog, Input, Rules, RockSize, HunterKind,
  STEP, rocksForWave, aimError, replay,
} from '../core.js';

// ---- helpers: set up an exact situation, then let the real step() run it ---------------------------

// A game with nothing on the field and no wave or hunter due, so a test can place exactly what it needs.
function emptyGame(options = {}) {
  const game = new Game({ seed: 11, ...options });
  for (const pool of [game.rocks, game.bullets, game.hunters]) for (const item of pool.live) pool.release(item);
  game.flush();
  game.waveTimer = 1e9;
  game.hunterTimer = 1e9;
  game.ship.invulnerable = 0;
  return game;
}

function addRock(game, size, x, y, vx = 0, vy = 0) {
  const rock = game.spawnRock(size, x, y, vx, vy);
  rock.angularVel = 0;
  game.flush();
  return rock;
}

function addShot(game, x, y, angle = 0, fromShip = true) {
  const bullet = game.bullets.acquire();
  bullet.launch(fromShip, x, y, angle, Rules.bullet.speed, 0, 0, Rules.bullet.lifetime);
  game.flush();
  return bullet;
}

function addHunter(game, kind, x, y) {
  const hunter = game.hunters.acquire();
  hunter.init(kind, x, y, 1, game.field.width, game.rng);
  game.flush();
  return hunter;
}

function moveShipTo(game, x, y) {
  game.ship.place(x, y, 0, 0, -Math.PI / 2);
}

const heading = v => Math.atan2(v.y, v.x);
const angleBetween = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const eventsOf = (events, type) => events.filter(e => e.type === type);

// ---- splitting -------------------------------------------------------------------------------------

test('a hit Large rock leaves two Medium rocks at its position, turned apart and a little faster', () => {
  const game = emptyGame();
  moveShipTo(game, 100, 100);
  const parent = addRock(game, RockSize.Large, 500, 300, 40, 0);
  addShot(game, 500, 300);
  game.step(0);
  assert.equal(parent.alive, false);
  const children = game.rocks.live;
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(child.size, RockSize.Medium);
    assert.deepEqual(child.pos, parent.pos, 'born where the parent was hit');
    const turn = angleBetween(heading(child.vel), heading(parent.vel));
    assert.ok(turn >= Rules.split.minAngle && turn <= Rules.split.maxAngle, `turned ${turn} rad`);
    assert.ok(child.speed > parent.speed, 'a little faster');
  }
  const [a, b] = children;
  const sideA = Math.sign(Math.sin(heading(a.vel) - heading(parent.vel)));
  const sideB = Math.sign(Math.sin(heading(b.vel) - heading(parent.vel)));
  assert.equal(sideA, -sideB, 'one turns left of the parent, the other right');
});

test('a hit Medium rock leaves two Small rocks', () => {
  const game = emptyGame();
  moveShipTo(game, 100, 100);
  addRock(game, RockSize.Medium, 500, 300, 0, 50);
  addShot(game, 500, 300);
  game.step(0);
  assert.deepEqual(game.rocks.live.map(r => r.size), [RockSize.Small, RockSize.Small]);
});

test('a hit Small rock breaks and leaves nothing', () => {
  const game = emptyGame();
  moveShipTo(game, 100, 100);
  addRock(game, RockSize.Small, 500, 300, 60, 0);
  addShot(game, 500, 300);
  const events = game.step(0);
  assert.equal(game.rocks.live.length, 0);
  assert.equal(eventsOf(events, 'rockBroken').length, 1);
});

// ---- scoring ---------------------------------------------------------------------------------------

test('points by size: Large 25, Medium 60, Small 120, Big hunter 250, Small hunter 1000', () => {
  const scoreFor = place => {
    const game = emptyGame();
    moveShipTo(game, 100, 100);
    place(game);
    addShot(game, 500, 300);
    game.step(0);
    return game.score;
  };
  assert.equal(scoreFor(g => addRock(g, RockSize.Large, 500, 300)), 25);
  assert.equal(scoreFor(g => addRock(g, RockSize.Medium, 500, 300)), 60);
  assert.equal(scoreFor(g => addRock(g, RockSize.Small, 500, 300)), 120);
  assert.equal(scoreFor(g => addHunter(g, HunterKind.Big, 500, 300)), 250);
  assert.equal(scoreFor(g => addHunter(g, HunterKind.Small, 500, 300)), 1000);
});

test('only the ship\'s shots score: a hunter\'s shot breaks a rock for no points', () => {
  const game = emptyGame();
  moveShipTo(game, 100, 100);
  addRock(game, RockSize.Large, 500, 300);
  addShot(game, 500, 300, 0, false);
  game.step(0);
  assert.equal(game.rocks.live.length, 2, 'it still breaks');
  assert.equal(game.score, 0);
});

// ---- the wrapping field ----------------------------------------------------------------------------

test('wrap: leaving any of the four edges comes back in at the opposite one', () => {
  const field = new Field(1000, 625);
  const at = (x, y) => { const e = { pos: { x, y } }; field.wrap(e); return [e.pos.x, e.pos.y]; };
  assert.deepEqual(at(-4, 300), [996, 300], 'left edge');
  assert.deepEqual(at(1003, 300), [3, 300], 'right edge');
  assert.deepEqual(at(500, -5), [500, 620], 'top edge');
  assert.deepEqual(at(500, 627), [500, 2], 'bottom edge');
});

test('wrap: a moving rock crosses an edge in the real step, and things touch across an edge', () => {
  const game = emptyGame();
  moveShipTo(game, 500, 300);
  const rock = addRock(game, RockSize.Small, 1, 300, -120, 0);
  game.step(0);
  assert.ok(rock.pos.x > 990, `came back on the right at x=${rock.pos.x}`);
  const field = new Field(1000, 625);
  assert.ok(field.overlaps({ pos: { x: 995, y: 10 }, radius: 10 }, { pos: { x: 3, y: 620 }, radius: 10 }));
  assert.ok(!field.overlaps({ pos: { x: 900, y: 10 }, radius: 10 }, { pos: { x: 3, y: 620 }, radius: 10 }));
});

// ---- shots -----------------------------------------------------------------------------------------

test('a shot lives for its lifetime, then is gone', () => {
  const game = emptyGame();
  moveShipTo(game, 500, 300);
  game.step(Input.Fire);
  const shot = game.bullets.live[0];
  const lifeSteps = Math.round(Rules.bullet.lifetime / STEP);
  for (let i = 1; i < lifeSteps - 1; i++) game.step(0);
  assert.equal(shot.alive, true, `alive after ${lifeSteps - 1} steps`);
  game.step(0);
  game.step(0);
  assert.equal(shot.alive, false, `gone after ${lifeSteps + 1} steps`);
  assert.equal(game.bullets.live.length, 0);
});

test('the ship never has more than its cap of live shots, however long fire is held', () => {
  const game = emptyGame();
  moveShipTo(game, 500, 300);
  let most = 0;
  for (let i = 0; i < 600; i++) {
    game.step(Input.Fire | Input.Left);
    const live = game.bullets.countAlive(b => b.fromShip);
    assert.ok(live <= Rules.ship.maxBullets, `${live} live shots`);
    most = Math.max(most, live);
  }
  assert.equal(most, Rules.ship.maxBullets, 'the cap is reached, so it is the cap that holds');
});

// ---- the pool --------------------------------------------------------------------------------------

test('pool: never grows past its capacity, and reuses a freed slot', () => {
  const pool = new Pool(4, () => new Rock());
  const taken = [pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()];
  assert.ok(taken.every(item => item !== null));
  assert.equal(pool.acquire(), null, 'full: no fifth object');
  pool.flush();
  assert.equal(pool.slots.length, 4);
  assert.equal(pool.live.length, 4);
  pool.release(taken[2]);
  pool.flush();
  assert.equal(pool.live.length, 3);
  const again = pool.acquire();
  assert.equal(again, taken[2], 'the freed object comes back, not a new one');
  assert.equal(again.slot, 2);
  pool.flush();
  assert.equal(pool.slots.length, 4);
  assert.equal(pool.inUse, 4);
});

test('pool: releasing while walking the live list visits every item exactly once', () => {
  const pool = new Pool(7, () => ({}));
  for (let i = 0; i < 6; i++) pool.acquire();
  pool.flush();
  const visited = [];
  for (const item of pool.live) {
    visited.push(item.slot);
    pool.release(item);
    if (item.slot === 1) assert.ok(pool.acquire()); // and one taken mid-walk does not join this walk either
  }
  assert.deepEqual([...visited].sort(), [0, 1, 2, 3, 4, 5]);
  assert.equal(pool.live.length, 6, 'the list itself waits for flush()');
  pool.flush();
  assert.equal(pool.live.length, 1);
  assert.equal(pool.inUse, 1);
});

test('deferred destroy in the game: three shots on three rocks in one step break all three', () => {
  const game = emptyGame();
  moveShipTo(game, 100, 550);
  for (const x of [250, 500, 750]) {
    addRock(game, RockSize.Large, x, 300);
    addShot(game, x, 300);
  }
  const events = game.step(0);
  assert.equal(eventsOf(events, 'rockBroken').length, 3);
  assert.equal(game.score, 3 * Rules.rocks.Large.score);
  assert.equal(game.rocks.live.length, 6);
  assert.equal(game.bullets.live.length, 0);
});

test('deferred destroy in the game: two shots on one rock break it once', () => {
  const game = emptyGame();
  moveShipTo(game, 100, 550);
  addRock(game, RockSize.Large, 500, 300);
  addShot(game, 495, 300);
  addShot(game, 505, 300);
  const events = game.step(0);
  assert.equal(eventsOf(events, 'rockBroken').length, 1);
  assert.equal(game.score, Rules.rocks.Large.score);
  assert.equal(game.rocks.live.length, 2, 'two children, not four');
  assert.equal(game.bullets.live.length, 1, 'the second shot flies on');
});

// ---- ships -----------------------------------------------------------------------------------------

test('an extra ship at every 15,000 points, given exactly once', () => {
  const game = emptyGame();
  moveShipTo(game, 100, 550);
  game.score = Rules.extraShipEvery - Rules.rocks.Medium.score;
  const ships = game.ships;
  addRock(game, RockSize.Medium, 500, 300);
  addShot(game, 500, 300);
  const events = game.step(0);
  assert.equal(game.score, Rules.extraShipEvery);
  assert.equal(game.ships, ships + 1);
  assert.equal(eventsOf(events, 'extraShip').length, 1);
  for (const child of game.rocks.live) {
    addShot(game, child.pos.x, child.pos.y);
    game.step(0);
  }
  assert.equal(game.ships, ships + 1, 'more points in the same band give no more ships');
  game.addScore(2 * Rules.extraShipEvery);
  assert.equal(game.ships, ships + 3, 'one jump across two thresholds gives two');
});

test('respawn waits for a clear centre, then comes back shielded', () => {
  const game = emptyGame();
  const centre = { x: game.field.width / 2, y: game.field.height / 2 };
  const blocker = addRock(game, RockSize.Large, centre.x + 60, centre.y);
  moveShipTo(game, 100, 100);
  game.destroyShip();
  for (let i = 0; i < 600; i++) game.step(0);
  assert.equal(game.ship.alive, false, 'ten seconds later, still waiting');
  blocker.pos.x = centre.x + Rules.ship.clearRadius + blocker.radius + 5;
  game.step(0);
  assert.equal(game.ship.alive, true);
  assert.deepEqual([game.ship.pos.x, game.ship.pos.y], [centre.x, centre.y]);
  assert.ok(game.ship.invulnerable > 0);
});

test('respawn: never before the delay, even on an empty field', () => {
  const game = emptyGame();
  game.destroyShip();
  const delaySteps = Math.round(Rules.ship.respawnDelay / STEP);
  for (let i = 0; i < delaySteps - 1; i++) game.step(0);
  assert.equal(game.ship.alive, false);
  game.step(0);
  game.step(0);
  assert.equal(game.ship.alive, true);
});

test('a freshly respawned ship survives a rock until its shield runs out', () => {
  const game = emptyGame();
  game.spawnShip();
  addRock(game, RockSize.Large, game.ship.pos.x, game.ship.pos.y);
  const shieldSteps = Math.round(Rules.ship.invulnerableFor / STEP);
  for (let i = 0; i < shieldSteps - 1; i++) game.step(0);
  assert.equal(game.ship.alive, true);
  for (let i = 0; i < 3; i++) game.step(0);
  assert.equal(game.ship.alive, false);
});

test('game over when the last ship is lost, and no ship comes back', () => {
  const game = emptyGame();
  game.ships = 1;
  moveShipTo(game, 500, 300);
  const rock = addRock(game, RockSize.Small, 500, 300, 20, 0);
  const events = game.step(0);
  assert.equal(game.over, true);
  assert.equal(game.ships, 0);
  assert.equal(eventsOf(events, 'gameOver').length, 1);
  for (let i = 0; i < 600; i++) game.step(Input.Fire | Input.Thrust);
  assert.equal(game.ship.alive, false);
  assert.equal(rock.alive, false, 'the rock it hit broke');
});

test('hyperspace moves the ship, and about one jump in eight fails', () => {
  const game = emptyGame();
  let jumps = 0, failed = 0;
  while (jumps < 800) {
    game.ships = 3;
    if (!game.ship.alive) game.spawnShip();
    moveShipTo(game, 500, 300);
    game.ship.invulnerable = 0;
    game.step(Input.Hyperspace);
    game.step(0);
    assert.ok(game.ship.jumping > 0, 'in hyperspace');
    const before = { ...game.ship.pos };
    while (game.ship.jumping > 0) game.step(0);
    jumps += 1;
    if (!game.ship.alive) failed += 1;
    else assert.notDeepEqual(game.ship.pos, before);
    for (let i = 0; i < Math.round(Rules.hyperspace.cooldown / STEP) + 1; i++) game.step(0);
  }
  const share = failed / jumps;
  assert.ok(share > 0.08 && share < 0.17, `${failed} of ${jumps} failed`);
});

// ---- waves -----------------------------------------------------------------------------------------

test('waves grow: 3 Large rocks, one more each wave, at most 11', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(rocksForWave), [3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 11, 11]);
  const game = new Game({ seed: 5 });
  assert.equal(game.wave, 1);
  assert.equal(game.rocks.live.length, 3);
  assert.ok(game.rocks.live.every(r => r.size === RockSize.Large));
  for (const rock of game.rocks.live) game.rocks.release(rock);
  game.flush();
  let steps = 0;
  while (game.wave === 1) { game.step(0); steps += 1; }
  assert.equal(game.rocks.live.length, 4);
  assert.ok(Math.abs(steps * STEP - Rules.waves.delay) < 2 * STEP, `next wave after ${steps} steps`);
});

test('a new wave never starts a rock on top of the ship', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const game = new Game({ seed });
    for (const rock of game.rocks.live) {
      assert.ok(game.field.distanceSquared(game.ship, rock) >= Rules.waves.safeDistance ** 2);
    }
  }
});

// ---- hunters ---------------------------------------------------------------------------------------

test('a Small hunter aims at the ship, the short way round the field', () => {
  const field = new Field(1000, 625);
  const rng = new Random(3);
  const hunter = new Hunter();
  hunter.init(HunterKind.Small, 300, 300, 1, 1000, rng);
  const ship = { pos: { x: 600, y: 420 } };
  const exact = Math.atan2(120, 300);
  for (let i = 0; i < 200; i++) {
    const off = angleBetween(hunter.shotAngle(ship, field, rng, 40000), exact);
    assert.ok(off <= Rules.hunters.aimErrorBest + 1e-9, `off by ${off}`);
  }
  hunter.pos.x = 960;
  ship.pos.x = 40;
  ship.pos.y = 300;
  const across = hunter.shotAngle(ship, field, rng, 40000);
  assert.ok(Math.cos(across) > 0.99, 'fires right, across the edge, not the long way left');
});

test('in the game, a Small hunter\'s shot flies toward the ship', () => {
  const game = emptyGame();
  game.score = 40000;
  moveShipTo(game, 700, 300);
  const hunter = addHunter(game, HunterKind.Small, 300, 300);
  game.fireHunterBullet(hunter);
  game.flush();
  const shot = game.bullets.live[0];
  assert.equal(shot.fromShip, false);
  assert.ok(angleBetween(heading(shot.vel), 0) <= Rules.hunters.aimErrorBest + 1e-9);
});

test('a hunter\'s aim gets better as the score rises; the Big one fires anywhere', () => {
  assert.ok(aimError(0) > aimError(20000));
  assert.ok(aimError(20000) > aimError(40000));
  assert.equal(aimError(40000), Rules.hunters.aimErrorBest);
  assert.equal(aimError(90000), Rules.hunters.aimErrorBest);
  const field = new Field(1000, 625);
  const rng = new Random(9);
  const big = new Hunter();
  big.init(HunterKind.Big, 300, 300, 1, 1000, rng);
  const quarters = new Set();
  for (let i = 0; i < 200; i++) {
    const a = big.shotAngle({ pos: { x: 600, y: 300 } }, field, rng, 40000);
    quarters.add(Math.floor((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2)));
  }
  assert.equal(quarters.size, 4);
});

test('a ship shot destroys a hunter; a hunter shot destroys the ship', () => {
  const game = emptyGame();
  moveShipTo(game, 800, 500);
  const hunter = addHunter(game, HunterKind.Big, 300, 300);
  addShot(game, 300, 300);
  game.step(0);
  assert.equal(hunter.alive, false);
  const ships = game.ships;
  addShot(game, 800, 500, 0, false);
  game.step(0);
  assert.equal(game.ship.alive, false);
  assert.equal(game.ships, ships - 1);
});

// ---- the clock, the log and replays ------------------------------------------------------------------

test('fixed timestep: uneven frames become 60 steps a second; a stall is not raced through', () => {
  const clock = new FixedTimestep();
  let steps = 0;
  const frames = [0.007, 0.016, 0.025, 0.004, 0.0081];
  let time = 0;
  for (let i = 0; time < 10; i++) {
    const dt = frames[i % frames.length];
    time += dt;
    const between = clock.advance(dt, () => steps++);
    assert.ok(between >= 0 && between < 1);
  }
  assert.ok(Math.abs(steps - Math.floor(time * 60)) <= 1, `${steps} steps in ${time.toFixed(3)} s`);
  let after = 0;
  clock.advance(3.0, () => after++);
  assert.equal(after, clock.maxStepsPerFrame);
});

test('determinism: the same seed and the same input log give the same game after 5,000 steps', () => {
  const inputs = new Random(2024);
  const log = new InputLog();
  let held = 0;
  for (let i = 0; i < 5000; i++) {
    if (inputs.oneIn(12)) held = inputs.int(32); // a player changes what they hold every so often
    log.record(held);
  }
  const options = { seed: 77 };
  const first = replay(options, log, 5000);
  const second = replay(options, log, 5000);
  assert.ok(first.steps === 5000 && first.score > 0, `a real game: score ${first.score}, wave ${first.wave}`);
  assert.equal(JSON.stringify(first.snapshot()), JSON.stringify(second.snapshot()));
  const otherSeed = replay({ seed: 78 }, log, 5000);
  assert.notEqual(JSON.stringify(first.snapshot()), JSON.stringify(otherSeed.snapshot()), 'and the seed matters');
  for (const pool of [first.bullets, first.rocks, first.hunters]) {
    assert.equal(pool.slots.length, pool.capacity, 'no pool grew during 5,000 steps');
    assert.ok(pool.live.every(item => pool.slots[item.slot] === item));
  }
});

test('the input log keeps every step, past its first block', () => {
  const log = new InputLog();
  for (let i = 0; i < 10000; i++) log.record(i % 32);
  assert.equal(log.length, 10000);
  assert.equal(log.at(9999), 9999 % 32);
  assert.equal(log.at(4097), 4097 % 32);
});
