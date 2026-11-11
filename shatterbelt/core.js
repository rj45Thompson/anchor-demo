// Shatterbelt: the rules of the game.
//
// Everything that decides what happens lives in this file, and nothing else does. It has no DOM and
// no three.js, so the same code runs in the browser and under `node --test`.
//
// The design in one paragraph:
//   Entity is anything that moves and can be hit: a position, a velocity, a facing, a spin, a radius.
//   Ship, Bullet, Rock and Hunter are Entities with their own rules.
//   Pool makes a fixed number of objects up front, so play never allocates, and it holds every add and
//   remove until flush(), so nothing is added or removed while a loop is walking the list.
//   Field is the play area. Its edges wrap, so it also knows the shortest way between two points.
//   Game owns all of the above and advances the world one fixed step at a time (see Game.step).

export const STEP = 1 / 60; // seconds of game time per step: the simulation always runs at 60 Hz

// One step's controls, as bits, so a whole game's input fits in one byte per step.
export const Input = Object.freeze({ Left: 1, Right: 2, Thrust: 4, Fire: 8, Hyperspace: 16 });

export const RockSize = Object.freeze({ Large: 'Large', Medium: 'Medium', Small: 'Small' });
export const HunterKind = Object.freeze({ Big: 'Big', Small: 'Small' });

// Every tuning number in one place. Distances are field units (the field is 1000 wide), times are seconds.
export const Rules = deepFreeze({
  field: { width: 1000, height: 625 },
  ship: {
    radius: 14, startingShips: 3,
    turnSpeed: 4.6,          // radians per second
    thrust: 430,             // acceleration while thrusting
    drag: 0.55,              // share of speed lost per second
    maxSpeed: 470,
    fireInterval: 0.16,      // holding fire repeats this often
    maxBullets: 5,           // live shots at once
    invulnerableFor: 2.5,    // after a respawn
    respawnDelay: 1.6,       // the shortest wait after a crash
    clearRadius: 150,        // a respawn waits until nothing hostile is this close to the centre
  },
  bullet: { radius: 3, speed: 620, lifetime: 0.95 },
  hyperspace: { jumpTime: 0.45, cooldown: 1.2, failOneIn: 8 },
  rocks: {
    Large:  { radius: 46, score: 25,  minSpeed: 30, maxSpeed: 64,  smaller: RockSize.Medium },
    Medium: { radius: 26, score: 60,  minSpeed: 44, maxSpeed: 96,  smaller: RockSize.Small },
    Small:  { radius: 13, score: 120, minSpeed: 62, maxSpeed: 132, smaller: null },
  },
  split: { minAngle: 0.35, maxAngle: 0.8, speedUp: 1.25 }, // children turn this far apart (radians) and speed up
  waves: {
    firstCount: 3, growth: 1, maxCount: 11,   // wave 1 has 3 Large rocks, one more per wave, never more than 11
    speedUpPerWave: 0.06, maxSpeedUp: 1.6,
    delay: 2.5,                               // pause between a cleared wave and the next
    safeDistance: 240,                        // new rocks never start this close to the ship
  },
  hunters: {
    Big:   { radius: 22, score: 250,  speed: 85,  fireInterval: 1.25, bulletSpeed: 330 },
    Small: { radius: 13, score: 1000, speed: 125, fireInterval: 0.95, bulletSpeed: 380 },
    firstAfter: 16, interval: 15, minInterval: 7, quickerPerWave: 1,
    smallFromScore: 6000, smallAlwaysFromScore: 30000,   // between these, the chance of a Small one rises
    aimErrorWorst: 0.45, aimErrorBest: 0.04, bestAimAtScore: 40000,
    turnEvery: [0.8, 1.8], climbShare: 0.55, maxBullets: 3, bulletLifetime: 1.5,
  },
  extraShipEvery: 15000,
});

// ------------------------------------------------------------------------------------------------
// Small pure rules, exported so the tests and the page can read them directly.

export function rocksForWave(wave) {
  const { firstCount, growth, maxCount } = Rules.waves;
  return Math.min(firstCount + (wave - 1) * growth, maxCount);
}

// How far off a Small hunter's shot can be, in radians. It shrinks as the player's score grows.
export function aimError(score) {
  const { aimErrorWorst, aimErrorBest, bestAimAtScore } = Rules.hunters;
  const progress = Math.min(Math.max(score / bestAimAtScore, 0), 1);
  return aimErrorWorst * (1 - progress) + aimErrorBest * progress;
}

// The chance that the next hunter is a Small one, from 0 to 1.
export function smallHunterChance(score) {
  const { smallFromScore, smallAlwaysFromScore } = Rules.hunters;
  return Math.min(Math.max((score - smallFromScore) / (smallAlwaysFromScore - smallFromScore), 0), 1);
}

// ------------------------------------------------------------------------------------------------

// A seeded random number generator (mulberry32). The same seed gives the same numbers on every run,
// which is what lets a whole game replay from its seed and its input log.
export class Random {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  next() { // a number in [0, 1)
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(count) { // 0 to count - 1
    return Math.floor(this.next() * count);
  }

  oneIn(n) {
    return this.int(n) === 0;
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}

// sin, cos, atan2 and hypot made from + - * / and square root only. IEEE 754 requires those five to be
// correctly rounded, so they give the same bits on every machine that follows it. JavaScript leaves
// Math.sin and the others approximate, so they may differ between browsers, and they do differ from the
// C runtime's in the last bits (tools/parity.js measures it); one differing bit is enough to part two
// replays. cpp/shatterbelt_core.cpp has the same class, with the same steps in the same order.
export class Trig {
  static sin(x) {
    return sinOrCos(x, 0);
  }

  static cos(x) {
    return sinOrCos(x, 1);
  }

  static atan2(y, x) { // finite y and x; (0, 0) gives 0
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    if (ax === 0 && ay === 0) return 0;
    let angle = ay <= ax ? atanUnit(ay / ax) : Math.PI / 2 - atanUnit(ax / ay); // folded into 0 to pi / 2
    if (x < 0) angle = Math.PI - angle;
    return y < 0 ? -angle : angle;
  }

  static hypot(x, y) {
    return Math.sqrt(x * x + y * y);
  }
}

// pi / 2 in three parts (the split fdlibm uses). The first two have 33 significant bits, so k times a part
// is exact for any whole k below 2^20, and x - k * pi / 2 keeps its precision.
const TWO_OVER_PI = 6.36619772367581382433e-01;
const HALF_PI_1 = 1.57079632673412561417e+00;
const HALF_PI_2 = 6.07710050630396597660e-11;
const HALF_PI_3 = 2.02226624871116645580e-21;
const TAN_EIGHTH_PI = 0.41421356237309503; // tan(pi / 8)

// sin and cos of r, |r| <= pi / 4, by their Taylor series. The first term left out is below 1e-19 for sin
// and 3e-18 for cos, far under the last bit of the result.
function sinNear0(r) {
  const r2 = r * r;
  return r + r * r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800
    + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000 + r2 * (1 / 355687428096000))))))));
}

function cosNear0(r) {
  const r2 = r * r;
  return 1 + r2 * (-1 / 2 + r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800
    + r2 * (1 / 479001600 + r2 * (-1 / 87178291200 + r2 * (1 / 20922789888000))))))));
}

// sin(x) when shift is 0, cos(x) when it is 1: take whole quarter turns off x, then use the quarter turn
// count to pick sin or cos of what is left, and its sign.
function sinOrCos(x, shift) {
  const k = Math.floor(x * TWO_OVER_PI + 0.5); // the nearest whole number of quarter turns
  const r = ((x - k * HALF_PI_1) - k * HALF_PI_2) - k * HALF_PI_3;
  switch ((k + shift) & 3) {
    case 0: return sinNear0(r);
    case 1: return cosNear0(r);
    case 2: return -sinNear0(r);
    default: return -cosNear0(r);
  }
}

// atan(u) for |u| <= tan(pi / 8), by its Taylor series u - u^3/3 + u^5/5 - ... to u^41/41, summed from the
// smallest term up. The first term left out is below 1e-17 of u.
function atanNear0(u) {
  const u2 = u * u;
  let sum = 0;
  for (let n = 41; n >= 3; n -= 2) sum = (n % 4 === 1 ? 1 : -1) / n + u2 * sum;
  return u + u * u2 * sum;
}

// atan(t) for 0 <= t <= 1. Past tan(pi / 8), atan(t) = pi / 4 + atan((t - 1) / (t + 1)).
function atanUnit(t) {
  if (t > TAN_EIGHTH_PI) return Math.PI / 4 + atanNear0((t - 1) / (t + 1));
  return atanNear0(t);
}

// The play area. Its edges wrap: leave on the right and come back on the left.
export class Field {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  wrap(entity) {
    const p = entity.pos;
    if (p.x < 0) p.x += this.width; else if (p.x >= this.width) p.x -= this.width;
    if (p.y < 0) p.y += this.height; else if (p.y >= this.height) p.y -= this.height;
  }

  // The shortest way from a to b along x and along y, through an edge when that is shorter.
  dx(a, b) {
    return shortest(b.pos.x - a.pos.x, this.width);
  }

  dy(a, b) {
    return shortest(b.pos.y - a.pos.y, this.height);
  }

  distanceSquared(a, b) {
    const dx = this.dx(a, b);
    const dy = this.dy(a, b);
    return dx * dx + dy * dy;
  }

  // Circle against circle. Two things touching across an edge do overlap.
  overlaps(a, b) {
    const reach = a.radius + b.radius;
    return this.distanceSquared(a, b) < reach * reach;
  }
}

function shortest(delta, size) {
  if (delta > size / 2) return delta - size;
  if (delta < -size / 2) return delta + size;
  return delta;
}

// Anything that moves and can be hit.
export class Entity {
  constructor(radius) {
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.angle = 0;        // radians; 0 faces +x, and +y points down the screen, so turning right adds
    this.angularVel = 0;   // radians per second
    this.radius = radius;
    this.alive = false;
    this.prev = { x: 0, y: 0, angle: 0 }; // where it was one step ago, so the renderer can draw between steps
  }

  place(x, y, vx, vy, angle) {
    this.pos.x = x;
    this.pos.y = y;
    this.vel.x = vx;
    this.vel.y = vy;
    this.angle = angle;
    this.angularVel = 0;
    this.prev.x = x;
    this.prev.y = y;
    this.prev.angle = angle;
  }

  integrate(dt) {
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
    this.prev.angle = this.angle;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.angle += this.angularVel * dt;
  }

  get speed() {
    return Trig.hypot(this.vel.x, this.vel.y);
  }
}

export class Ship extends Entity {
  constructor() {
    super(Rules.ship.radius);
    this.thrusting = false;
    this.fireTimer = 0;       // counts down to the next shot a held fire button may take
    this.invulnerable = 0;    // seconds left
    this.jumping = 0;         // seconds left in hyperspace; the ship is nowhere while this is above 0
    this.jumpCooldown = 0;
  }

  get canBeHit() {
    return this.alive && this.invulnerable <= 0 && this.jumping <= 0;
  }

  // Rotate, thrust with inertia, then drag. Speed is capped.
  steer(input, dt) {
    const { turnSpeed, thrust, drag, maxSpeed } = Rules.ship;
    const turn = (input & Input.Right ? 1 : 0) - (input & Input.Left ? 1 : 0);
    this.angularVel = turn * turnSpeed;
    this.thrusting = (input & Input.Thrust) !== 0;
    if (this.thrusting) {
      this.vel.x += Trig.cos(this.angle) * thrust * dt;
      this.vel.y += Trig.sin(this.angle) * thrust * dt;
    }
    const keep = 1 - drag * dt;
    this.vel.x *= keep;
    this.vel.y *= keep;
    const speed = this.speed;
    if (speed > maxSpeed) {
      this.vel.x *= maxSpeed / speed;
      this.vel.y *= maxSpeed / speed;
    }
  }

  tickTimers(dt) {
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
  }
}

export class Bullet extends Entity {
  constructor() {
    super(Rules.bullet.radius);
    this.fromShip = true;   // false: a hunter fired it
    this.lifetime = 0;      // seconds left before it fades out
  }

  launch(fromShip, x, y, angle, speed, baseVx, baseVy, lifetime) {
    this.place(x, y, baseVx + Trig.cos(angle) * speed, baseVy + Trig.sin(angle) * speed, angle);
    this.fromShip = fromShip;
    this.lifetime = lifetime;
  }

  // Returns true once it has run out of time.
  age(dt) {
    this.lifetime -= dt;
    return this.lifetime <= 0;
  }
}

export class Rock extends Entity {
  constructor() {
    super(0);
    this.size = RockSize.Large;
    this.look = 0;          // which of the rock models draws it; the rules do not care
  }

  init(size, x, y, vx, vy, spin, look) {
    this.place(x, y, vx, vy, 0);
    this.size = size;
    this.radius = Rules.rocks[size].radius;
    this.angularVel = spin;
    this.look = look;
  }

  get score() {
    return Rules.rocks[this.size].score;
  }

  get smaller() { // the size of its children, or null for a Small rock, which just breaks
    return Rules.rocks[this.size].smaller;
  }
}

export class Hunter extends Entity {
  constructor() {
    super(0);
    this.kind = HunterKind.Big;
    this.fireTimer = 0;
    this.turnTimer = 0;
    this.travelLeft = 0;    // it crosses the field once, then leaves
    this.age = 0;
  }

  init(kind, x, y, direction, travel, rng) {
    const rules = Rules.hunters[kind];
    this.place(x, y, direction * rules.speed, 0, direction > 0 ? 0 : Math.PI);
    this.kind = kind;
    this.radius = rules.radius;
    this.fireTimer = rules.fireInterval;
    this.turnTimer = rng.range(...Rules.hunters.turnEvery);
    this.travelLeft = travel;
    this.age = 0;
  }

  get score() {
    return Rules.hunters[this.kind].score;
  }

  // The direction of its next shot. The Big one fires anywhere; the Small one aims at the ship
  // the short way round the field, off by up to aimError(score).
  shotAngle(target, field, rng, score) {
    if (this.kind === HunterKind.Big || target === null) return rng.range(0, Math.PI * 2);
    const exact = Trig.atan2(field.dy(this, target), field.dx(this, target));
    const error = aimError(score);
    return exact + rng.range(-error, error);
  }

  // Every so often it changes course: climb, dive or level out.
  weave(dt, rng) {
    this.turnTimer -= dt;
    if (this.turnTimer > 0) return;
    const { turnEvery, climbShare } = Rules.hunters;
    this.turnTimer = rng.range(...turnEvery);
    this.vel.y = (rng.int(3) - 1) * Rules.hunters[this.kind].speed * climbShare;
  }
}

// A fixed set of objects, made once. acquire() and release() only take effect at flush(), so code
// walking `live` never sees the list change under it: nothing is skipped and nothing is visited twice.
export class Pool {
  constructor(capacity, create) {
    this.capacity = capacity;
    this.slots = [];
    for (let i = 0; i < capacity; i++) {
      const item = create();
      item.alive = false;
      item.slot = i;
      item.liveIndex = -1;
      this.slots.push(item);
    }
    this.free = [...this.slots].reverse(); // pop() hands out slot 0 first
    this.live = [];                        // in play: walk this; it changes only in flush()
    this.born = [];                        // acquired since the last flush
    this.dying = [];                       // released since the last flush
  }

  // A free object, already marked alive, that joins `live` at the next flush. Null when every slot
  // is taken: the pool never grows.
  acquire() {
    const item = this.free.pop();
    if (item === undefined) return null;
    item.alive = true;
    this.born.push(item);
    return item;
  }

  // Marks it dead now (so nothing else hits it this step) and frees its slot at the next flush.
  release(item) {
    if (!item.alive) return;
    item.alive = false;
    this.dying.push(item);
  }

  flush() {
    for (const item of this.dying) {
      if (item.liveIndex >= 0) this.removeFromLive(item);
      this.free.push(item);
    }
    this.dying.length = 0;
    for (const item of this.born) {
      if (!item.alive) continue; // born and released in the same step: its slot is already free
      item.liveIndex = this.live.length;
      this.live.push(item);
    }
    this.born.length = 0;
  }

  get inUse() {
    return this.capacity - this.free.length - this.dying.length;
  }

  countAlive(test) {
    let count = 0;
    for (const item of this.slots) if (item.alive && test(item)) count++;
    return count;
  }

  removeFromLive(item) { // swap with the last one: constant time, and order does not matter
    const last = this.live.pop();
    if (last !== item) {
      this.live[item.liveIndex] = last;
      last.liveIndex = item.liveIndex;
    }
    item.liveIndex = -1;
  }
}

// Turns real time, which arrives in uneven frames, into whole fixed steps.
export class FixedTimestep {
  constructor(step = STEP, maxStepsPerFrame = 5) {
    this.step = step;
    this.maxStepsPerFrame = maxStepsPerFrame;
    this.accumulator = 0;
  }

  // Runs onStep once per whole step of time banked, and returns how far (0 to 1) the clock is into the
  // next step, for drawing between steps. After a long stall it drops the backlog rather than racing.
  advance(seconds, onStep) {
    this.accumulator += Math.min(seconds, this.step * this.maxStepsPerFrame);
    while (this.accumulator >= this.step) {
      onStep();
      this.accumulator -= this.step;
    }
    return this.accumulator / this.step;
  }
}

// One byte of input per step. With the seed, it is the whole game: replaying it gives the same game.
export class InputLog {
  constructor() {
    this.bytes = new Uint8Array(4096);
    this.length = 0;
  }

  record(input) {
    if (this.length === this.bytes.length) {
      const bigger = new Uint8Array(this.bytes.length * 2);
      bigger.set(this.bytes);
      this.bytes = bigger;
    }
    this.bytes[this.length++] = input;
  }

  at(step) {
    return this.bytes[step];
  }
}

// The whole game. Call step() 60 times a second of game time.
export class Game {
  constructor({ seed = 1, width = Rules.field.width, height = Rules.field.height,
                startingShips = Rules.ship.startingShips } = {}) {
    this.seed = seed;
    this.rng = new Random(seed);
    this.field = new Field(width, height);
    this.ship = new Ship();
    // capacities: 11 Large rocks can become at most 44 pieces at once; 5 ship shots plus 3 per hunter
    this.bullets = new Pool(16, () => new Bullet());
    this.rocks = new Pool(48, () => new Rock());
    this.hunters = new Pool(2, () => new Hunter());
    this.centre = { pos: { x: width / 2, y: height / 2 }, radius: Rules.ship.clearRadius };

    this.score = 0;
    this.ships = startingShips;          // ships left, counting the one flying
    this.nextExtraShipAt = Rules.extraShipEvery;
    this.wave = 0;
    this.time = 0;
    this.steps = 0;
    this.over = false;
    this.waveTimer = 0;                  // counts down to the next wave once the field is clear
    this.hunterTimer = Rules.hunters.firstAfter;
    this.respawnTimer = 0;
    this.lastInput = 0;
    this.events = [];                    // what happened in the last step, for the renderer and the sound

    if (startingShips > 0) this.spawnShip();
    this.startWave();
    this.flush();
    this.events.length = 0;
  }

  // ---- the main loop ----------------------------------------------------------------------------
  // One fixed step. The order matters, and nothing is added to or removed from the world until
  // flush(), after every loop over it has finished.
  step(input = 0) {
    this.events.length = 0;
    this.time += STEP;
    this.steps += 1;
    this.handleInput(input); // 1. input: steer, fire, hyperspace
    this.update(STEP);       // 2. update and integrate: move everything, run the timers
    this.wrapAll();          // 3. screen wrap
    this.collide();          // 4. collide: circle against circle; hits only mark things dead
    this.flush();            // 5. spawn and destroy: the only place the world's lists change
    return this.events;      // 6. events out, for the renderer and the sound
  }

  // ---- 1. input ---------------------------------------------------------------------------------
  handleInput(input) {
    const pressed = input & ~this.lastInput; // pressed this step, not held from the last one
    this.lastInput = input;
    const ship = this.ship;
    if (!ship.alive || ship.jumping > 0) return;
    ship.steer(input, STEP);
    if (input & Input.Fire && ship.fireTimer <= 0) this.fireShipBullet();
    if (pressed & Input.Hyperspace && ship.jumpCooldown <= 0) {
      ship.jumping = Rules.hyperspace.jumpTime;
      ship.thrusting = false;
      this.emit('hyperspaceOut', ship);
    }
  }

  fireShipBullet() {
    const ship = this.ship;
    if (this.bullets.countAlive(b => b.fromShip) >= Rules.ship.maxBullets) return;
    const bullet = this.bullets.acquire();
    if (bullet === null) throw new Error('bullet pool too small'); // capacity covers every shooter's cap
    const { speed, lifetime } = Rules.bullet;
    const nose = ship.radius + 2;
    bullet.launch(true, ship.pos.x + Trig.cos(ship.angle) * nose, ship.pos.y + Trig.sin(ship.angle) * nose,
      ship.angle, speed, ship.vel.x, ship.vel.y, lifetime);
    ship.fireTimer = Rules.ship.fireInterval;
    this.emit('shot', bullet);
  }

  // ---- 2. update and integrate -------------------------------------------------------------------
  update(dt) {
    this.updateShip(dt);
    for (const bullet of this.bullets.live) {
      bullet.integrate(dt);
      if (bullet.age(dt)) this.bullets.release(bullet);
    }
    for (const rock of this.rocks.live) rock.integrate(dt);
    for (const hunter of this.hunters.live) this.updateHunter(hunter, dt);
    this.updateWaves(dt);
    this.updateHunterArrivals(dt);
    this.updateRespawn(dt);
  }

  updateShip(dt) {
    const ship = this.ship;
    if (!ship.alive) return;
    ship.tickTimers(dt);
    if (ship.jumping > 0) {
      ship.jumping -= dt;
      if (ship.jumping <= 0) this.arriveFromHyperspace();
      return;
    }
    ship.integrate(dt);
  }

  // The risk of hyperspace: you arrive anywhere, at rest, with no shield, and one jump in
  // failOneIn breaks the ship up.
  arriveFromHyperspace() {
    const ship = this.ship;
    ship.place(this.rng.range(0, this.field.width), this.rng.range(0, this.field.height), 0, 0, ship.angle);
    ship.jumpCooldown = Rules.hyperspace.cooldown;
    if (this.rng.oneIn(Rules.hyperspace.failOneIn)) {
      this.emit('hyperspaceFailed', ship);
      this.destroyShip();
    } else {
      this.emit('hyperspaceIn', ship);
    }
  }

  updateHunter(hunter, dt) {
    hunter.age += dt;
    hunter.travelLeft -= Math.abs(hunter.vel.x) * dt;
    if (hunter.travelLeft <= 0) {
      this.hunters.release(hunter);
      this.emit('hunterLeft', hunter);
      return;
    }
    hunter.weave(dt, this.rng);
    hunter.integrate(dt);
    hunter.fireTimer -= dt;
    if (hunter.fireTimer <= 0) {
      hunter.fireTimer = Rules.hunters[hunter.kind].fireInterval;
      this.fireHunterBullet(hunter);
    }
  }

  fireHunterBullet(hunter) {
    if (this.bullets.countAlive(b => !b.fromShip) >= Rules.hunters.maxBullets * this.hunters.capacity) return;
    const bullet = this.bullets.acquire();
    if (bullet === null) throw new Error('bullet pool too small');
    const target = this.ship.canBeHit ? this.ship : null;
    const angle = hunter.shotAngle(target, this.field, this.rng, this.score);
    const muzzle = hunter.radius + 4;
    bullet.launch(false, hunter.pos.x + Trig.cos(angle) * muzzle, hunter.pos.y + Trig.sin(angle) * muzzle,
      angle, Rules.hunters[hunter.kind].bulletSpeed, 0, 0, Rules.hunters.bulletLifetime);
    this.emit('shot', bullet);
  }

  updateWaves(dt) {
    if (this.rocks.inUse > 0) return;
    if (this.waveTimer <= 0) this.waveTimer = Rules.waves.delay; // the field just cleared
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) this.startWave();
  }

  startWave() {
    this.wave += 1;
    this.waveTimer = 0;
    const { speedUpPerWave, maxSpeedUp } = Rules.waves;
    const speedUp = Math.min(1 + (this.wave - 1) * speedUpPerWave, maxSpeedUp);
    for (let i = 0; i < rocksForWave(this.wave); i++) {
      const spot = this.farFromShip();
      const heading = this.rng.range(0, Math.PI * 2);
      const { minSpeed, maxSpeed } = Rules.rocks.Large;
      const speed = this.rng.range(minSpeed, maxSpeed) * speedUp;
      this.spawnRock(RockSize.Large, spot.x, spot.y, Trig.cos(heading) * speed, Trig.sin(heading) * speed);
    }
    this.emit('waveStart', this.centre);
  }

  // A random point at least safeDistance from the ship (or the centre, while there is no ship).
  farFromShip() {
    const from = this.ship.alive ? this.ship : this.centre;
    const probe = { pos: { x: 0, y: 0 } };
    const minSquared = Rules.waves.safeDistance ** 2;
    do {
      probe.pos.x = this.rng.range(0, this.field.width);
      probe.pos.y = this.rng.range(0, this.field.height);
    } while (this.field.distanceSquared(from, probe) < minSquared);
    return probe.pos;
  }

  spawnRock(size, x, y, vx, vy) {
    const rock = this.rocks.acquire();
    if (rock === null) throw new Error('rock pool too small'); // 48 covers 11 Large rocks broken to 44 Small
    rock.init(size, x, y, vx, vy, this.rng.range(-1.2, 1.2), this.rng.int(3));
    return rock;
  }

  updateHunterArrivals(dt) {
    if (this.hunters.inUse > 0) return;
    this.hunterTimer -= dt;
    if (this.hunterTimer > 0) return;
    const { interval, minInterval, quickerPerWave } = Rules.hunters;
    this.hunterTimer = Math.max(minInterval, interval - (this.wave - 1) * quickerPerWave);
    const kind = this.rng.next() < smallHunterChance(this.score) ? HunterKind.Small : HunterKind.Big;
    const direction = this.rng.sign();      // +1 enters on the left edge flying right
    const hunter = this.hunters.acquire();
    if (hunter === null) throw new Error('hunter pool too small');
    const x = direction > 0 ? 0 : this.field.width - 0.001;
    hunter.init(kind, x, this.rng.range(0, this.field.height), direction, this.field.width, this.rng);
    this.emit('hunterArrived', hunter);
  }

  updateRespawn(dt) {
    if (this.ship.alive || this.ships <= 0) return; // flying, or no ships left
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0 && this.centreIsClear()) this.spawnShip();
  }

  centreIsClear() {
    const near = e => e.alive && this.field.overlaps(this.centre, e);
    for (const rock of this.rocks.live) if (near(rock)) return false;
    for (const hunter of this.hunters.live) if (near(hunter)) return false;
    for (const bullet of this.bullets.live) if (!bullet.fromShip && near(bullet)) return false;
    return true;
  }

  spawnShip() {
    const ship = this.ship;
    ship.place(this.centre.pos.x, this.centre.pos.y, 0, 0, -Math.PI / 2); // facing up the screen
    ship.alive = true;
    ship.thrusting = false;
    ship.fireTimer = 0;
    ship.jumping = 0;
    ship.jumpCooldown = 0;
    ship.invulnerable = Rules.ship.invulnerableFor;
    this.emit('respawn', ship);
  }

  // ---- 3. wrap ----------------------------------------------------------------------------------
  wrapAll() {
    if (this.ship.alive) this.field.wrap(this.ship);
    for (const bullet of this.bullets.live) this.field.wrap(bullet);
    for (const rock of this.rocks.live) this.field.wrap(rock);
    for (const hunter of this.hunters.live) this.field.wrap(hunter);
  }

  // ---- 4. collide -------------------------------------------------------------------------------
  // Each hit releases what it hit. release() marks it dead at once, so a rock hit twice in one step
  // breaks once, but nothing leaves the lists until flush().
  collide() {
    const { field, ship } = this;
    for (const bullet of this.bullets.live) {
      if (!bullet.alive) continue;
      const rock = this.firstRockTouching(bullet);
      if (rock) {
        this.bullets.release(bullet);
        this.breakRock(rock, bullet.fromShip);
      } else if (bullet.fromShip) {
        const hunter = this.firstHunterTouching(bullet);
        if (hunter) {
          this.bullets.release(bullet);
          this.destroyHunter(hunter, true);
        }
      } else if (ship.canBeHit && field.overlaps(bullet, ship)) {
        this.bullets.release(bullet);
        this.destroyShip();
      }
    }
    if (ship.canBeHit) {
      const rock = this.firstRockTouching(ship);
      const hunter = this.firstHunterTouching(ship);
      if (rock) this.breakRock(rock, false);
      if (hunter) this.destroyHunter(hunter, false);
      if (rock || hunter) this.destroyShip(); // ramming scores nothing: points come from shots
    }
    for (const hunter of this.hunters.live) {
      if (!hunter.alive) continue;
      const rock = this.firstRockTouching(hunter);
      if (rock) {
        this.breakRock(rock, false);
        this.destroyHunter(hunter, false);
      }
    }
  }

  firstRockTouching(entity) {
    for (const rock of this.rocks.live) if (rock.alive && this.field.overlaps(entity, rock)) return rock;
    return null;
  }

  firstHunterTouching(entity) {
    for (const hunter of this.hunters.live) if (hunter.alive && this.field.overlaps(entity, hunter)) return hunter;
    return null;
  }

  // A hit rock breaks. Bigger than Small, it leaves two children one size down, at its position,
  // their velocities turned apart from its own and a little faster.
  breakRock(rock, byShip) {
    this.rocks.release(rock);
    if (byShip) this.addScore(rock.score);
    this.emit('rockBroken', rock, byShip ? rock.score : 0);
    const size = rock.smaller;
    if (size === null) return;
    const { minAngle, maxAngle, speedUp } = Rules.split;
    const speed = Math.max(rock.speed * speedUp, Rules.rocks[size].minSpeed);
    const heading = rock.speed > 0 ? Trig.atan2(rock.vel.y, rock.vel.x) : this.rng.range(0, Math.PI * 2);
    for (const side of [-1, 1]) {
      const turned = heading + side * this.rng.range(minAngle, maxAngle);
      this.spawnRock(size, rock.pos.x, rock.pos.y, Trig.cos(turned) * speed, Trig.sin(turned) * speed);
    }
  }

  destroyHunter(hunter, byShip) {
    this.hunters.release(hunter);
    if (byShip) this.addScore(hunter.score);
    this.emit('hunterDestroyed', hunter, byShip ? hunter.score : 0);
  }

  destroyShip() {
    const ship = this.ship;
    ship.alive = false;
    ship.thrusting = false;
    this.ships -= 1;
    this.respawnTimer = Rules.ship.respawnDelay;
    this.emit('shipDestroyed', ship);
    if (this.ships <= 0) {
      this.over = true;
      this.emit('gameOver', ship);
    }
  }

  addScore(points) {
    this.score += points;
    while (this.score >= this.nextExtraShipAt) {
      this.ships += 1;
      this.nextExtraShipAt += Rules.extraShipEvery;
      this.emit('extraShip', this.ship);
    }
  }

  // ---- 5. spawn and destroy ----------------------------------------------------------------------
  flush() {
    this.bullets.flush();
    this.rocks.flush();
    this.hunters.flush();
  }

  // ---- 6. events --------------------------------------------------------------------------------
  // Events are rare (a few a second), so they are small plain objects. The renderer and the sound
  // read them after each step; the rules never do.
  emit(type, at, points = 0) {
    this.events.push({
      type, x: at.pos.x, y: at.pos.y, points,
      size: at.size, kind: at.kind, fromShip: at.fromShip,
      vx: at.vel ? at.vel.x : 0, vy: at.vel ? at.vel.y : 0,
    });
  }

  // ---- replay and checks ------------------------------------------------------------------------
  // Everything that makes this game this game, as plain data. Two games with the same snapshot are
  // the same game.
  snapshot() {
    const pose = e => [e.pos.x, e.pos.y, e.vel.x, e.vel.y, e.angle];
    const ship = this.ship;
    return {
      steps: this.steps, score: this.score, ships: this.ships, wave: this.wave, over: this.over,
      rng: this.rng.state, waveTimer: this.waveTimer, hunterTimer: this.hunterTimer, respawnTimer: this.respawnTimer,
      ship: { alive: ship.alive, pose: pose(ship), jumping: ship.jumping, invulnerable: ship.invulnerable },
      bullets: this.bullets.live.map(b => [b.slot, b.fromShip, b.lifetime, ...pose(b)]),
      rocks: this.rocks.live.map(r => [r.slot, r.size, r.look, ...pose(r)]),
      hunters: this.hunters.live.map(h => [h.slot, h.kind, h.travelLeft, h.fireTimer, ...pose(h)]),
    };
  }
}

// Plays a recorded game again: same seed, same inputs, same game.
export function replay(options, log, steps = log.length) {
  const game = new Game(options);
  for (let i = 0; i < steps; i++) game.step(log.at(i));
  return game;
}

function deepFreeze(object) {
  for (const value of Object.values(object)) if (typeof value === 'object' && value !== null) deepFreeze(value);
  return Object.freeze(object);
}
