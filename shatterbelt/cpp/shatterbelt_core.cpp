// The rules of Shatterbelt in C++17: the method bodies. Read core.js beside it; the order is the same.
//
// One rule that core.js does not need: JavaScript evaluates a call's arguments left to right, and C++
// leaves the order open. So two random draws never sit in the arguments of one call here; each gets its
// own line, in core.js's order. (tools/parity.js plants that mistake in ArriveFromHyperspace(), and the
// game parts from core.js's.)
#include "shatterbelt_core.h"

#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>

namespace Shatterbelt
{

namespace
{
// Math.min and Math.max for the values the rules use (never NaN, never -0).
double Min(double a, double b) { return a < b ? a : b; }
double Max(double a, double b) { return a > b ? a : b; }

double Shortest(double delta, double size)
{
    if (delta > size / 2) return delta - size;
    if (delta < -size / 2) return delta + size;
    return delta;
}
} // namespace

void Fail(const char* what)
{
    std::fprintf(stderr, "shatterbelt: %s\n", what);
    std::abort();
}

const char* NameOf(RockSize size)
{
    switch (size)
    {
    case RockSize::Large: return "Large";
    case RockSize::Medium: return "Medium";
    case RockSize::Small: return "Small";
    default: return "None";
    }
}

const char* NameOf(HunterKind kind)
{
    return kind == HunterKind::Big ? "Big" : "Small";
}

const char* NameOf(EventType type)
{
    switch (type)
    {
    case EventType::shot: return "shot";
    case EventType::hyperspaceOut: return "hyperspaceOut";
    case EventType::hyperspaceIn: return "hyperspaceIn";
    case EventType::hyperspaceFailed: return "hyperspaceFailed";
    case EventType::hunterLeft: return "hunterLeft";
    case EventType::hunterArrived: return "hunterArrived";
    case EventType::hunterDestroyed: return "hunterDestroyed";
    case EventType::rockBroken: return "rockBroken";
    case EventType::waveStart: return "waveStart";
    case EventType::respawn: return "respawn";
    case EventType::shipDestroyed: return "shipDestroyed";
    case EventType::gameOver: return "gameOver";
    default: return "extraShip";
    }
}

// ------------------------------------------------------------------------------------------------

int RocksForWave(int wave)
{
    const int count = Rules::waves::firstCount + (wave - 1) * Rules::waves::growth;
    return count < Rules::waves::maxCount ? count : Rules::waves::maxCount;
}

double AimError(int score)
{
    using namespace Rules::hunters;
    const double progress = Min(Max(score / static_cast<double>(bestAimAtScore), 0), 1);
    return aimErrorWorst * (1 - progress) + aimErrorBest * progress;
}

double SmallHunterChance(int score)
{
    using namespace Rules::hunters;
    return Min(Max(static_cast<double>(score - smallFromScore) / (smallAlwaysFromScore - smallFromScore), 0), 1);
}

// ------------------------------------------------------------------------------------------------

double Random::Next()
{
    state += 0x6d2b79f5u;
    uint32_t t = state;
    t = (t ^ (t >> 15)) * (t | 1u);
    t ^= t + (t ^ (t >> 7)) * (t | 61u);
    return (t ^ (t >> 14)) / 4294967296.0;
}

double Random::Range(double min, double max)
{
    return min + (max - min) * Next();
}

int Random::Int(int count)
{
    return static_cast<int>(std::floor(Next() * count));
}

bool Random::OneIn(int n)
{
    return Int(n) == 0;
}

int Random::Sign()
{
    return Next() < 0.5 ? -1 : 1;
}

// ------------------------------------------------------------------------------------------------
// Trig. Each function folds its argument into a small range, then sums a Taylor series there.

#if defined(SHATTERBELT_LIBRARY_MATH)
// Only for tools/parity.js, to measure why Trig exists: the same game with the C runtime's functions.
double Trig::Sin(double x) { return std::sin(x); }
double Trig::Cos(double x) { return std::cos(x); }
double Trig::Atan2(double y, double x) { return std::atan2(y, x); }
double Trig::Hypot(double x, double y) { return std::hypot(x, y); }
#else
namespace
{
// pi / 2 in three parts (the split fdlibm uses). The first two have 33 significant bits, so k times a
// part is exact for any whole k below 2^20, and x - k * pi / 2 keeps its precision.
constexpr double TwoOverPi = 6.36619772367581382433e-01;
constexpr double HalfPi1 = 1.57079632673412561417e+00;
constexpr double HalfPi2 = 6.07710050630396597660e-11;
constexpr double HalfPi3 = 2.02226624871116645580e-21;
constexpr double TanEighthPi = 0.41421356237309503; // tan(pi / 8)

// sin and cos of r, |r| <= pi / 4, by their Taylor series. The first term left out is below 1e-19 for sin
// and 3e-18 for cos, far under the last bit of the result.
double SinNear0(double r)
{
    const double r2 = r * r;
    return r + r * r2 * (-1.0 / 6 + r2 * (1.0 / 120 + r2 * (-1.0 / 5040 + r2 * (1.0 / 362880 + r2 * (-1.0 / 39916800
        + r2 * (1.0 / 6227020800.0 + r2 * (-1.0 / 1307674368000.0 + r2 * (1.0 / 355687428096000.0))))))));
}

double CosNear0(double r)
{
    const double r2 = r * r;
    return 1 + r2 * (-1.0 / 2 + r2 * (1.0 / 24 + r2 * (-1.0 / 720 + r2 * (1.0 / 40320 + r2 * (-1.0 / 3628800
        + r2 * (1.0 / 479001600 + r2 * (-1.0 / 87178291200.0 + r2 * (1.0 / 20922789888000.0))))))));
}

// sin(x) when shift is 0, cos(x) when it is 1: take whole quarter turns off x, then use the quarter
// turn count to pick sin or cos of what is left, and its sign.
double SinOrCos(double x, int shift)
{
    const double k = std::floor(x * TwoOverPi + 0.5); // the nearest whole number of quarter turns
    const double r = ((x - k * HalfPi1) - k * HalfPi2) - k * HalfPi3;
    switch ((static_cast<int64_t>(k) + shift) & 3)
    {
    case 0: return SinNear0(r);
    case 1: return CosNear0(r);
    case 2: return -SinNear0(r);
    default: return -CosNear0(r);
    }
}

// atan(u) for |u| <= tan(pi / 8), by its Taylor series u - u^3/3 + u^5/5 - ... to u^41/41, summed from
// the smallest term up. The first term left out is below 1e-17 of u.
double AtanNear0(double u)
{
    const double u2 = u * u;
    double sum = 0;
    for (int n = 41; n >= 3; n -= 2) sum = (n % 4 == 1 ? 1.0 : -1.0) / n + u2 * sum;
    return u + u * u2 * sum;
}

// atan(t) for 0 <= t <= 1. Past tan(pi / 8), atan(t) = pi / 4 + atan((t - 1) / (t + 1)).
double AtanUnit(double t)
{
    if (t > TanEighthPi) return Trig::Pi / 4 + AtanNear0((t - 1) / (t + 1));
    return AtanNear0(t);
}
} // namespace

double Trig::Sin(double x) { return SinOrCos(x, 0); }
double Trig::Cos(double x) { return SinOrCos(x, 1); }

double Trig::Atan2(double y, double x)
{
    const double ax = std::fabs(x);
    const double ay = std::fabs(y);
    if (ax == 0 && ay == 0) return 0;
    double angle = ay <= ax ? AtanUnit(ay / ax) : Pi / 2 - AtanUnit(ax / ay); // folded into 0 to pi / 2
    if (x < 0) angle = Pi - angle;
    return y < 0 ? -angle : angle;
}

double Trig::Hypot(double x, double y)
{
    return std::sqrt(x * x + y * y);
}
#endif

// ------------------------------------------------------------------------------------------------

void Field::Wrap(Entity& entity) const
{
    Vec2& p = entity.pos;
    if (p.x < 0) p.x += width; else if (p.x >= width) p.x -= width;
    if (p.y < 0) p.y += height; else if (p.y >= height) p.y -= height;
}

double Field::Dx(const Entity& a, const Entity& b) const { return Shortest(b.pos.x - a.pos.x, width); }
double Field::Dy(const Entity& a, const Entity& b) const { return Shortest(b.pos.y - a.pos.y, height); }

double Field::DistanceSquared(const Entity& a, const Entity& b) const
{
    const double dx = Dx(a, b);
    const double dy = Dy(a, b);
    return dx * dx + dy * dy;
}

bool Field::Overlaps(const Entity& a, const Entity& b) const
{
    const double reach = a.radius + b.radius;
    return DistanceSquared(a, b) < reach * reach;
}

// ------------------------------------------------------------------------------------------------

void Entity::Place(double x, double y, double vx, double vy, double InAngle)
{
    pos.x = x;
    pos.y = y;
    vel.x = vx;
    vel.y = vy;
    angle = InAngle;
    angularVel = 0;
    prev.x = x;
    prev.y = y;
    prev.angle = InAngle;
}

void Entity::Integrate(double dt)
{
    prev.x = pos.x;
    prev.y = pos.y;
    prev.angle = angle;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    angle += angularVel * dt;
    if (angle > Trig::Pi) angle -= 2 * Trig::Pi; else if (angle <= -Trig::Pi) angle += 2 * Trig::Pi;
}

double Entity::Speed() const
{
    return Trig::Hypot(vel.x, vel.y);
}

void Ship::Steer(uint8_t input, double dt)
{
    using namespace Rules::ship;
    const int turn = ((input & Input::Right) ? 1 : 0) - ((input & Input::Left) ? 1 : 0);
    angularVel = turn * turnSpeed;
    thrusting = (input & Input::Thrust) != 0;
    if (thrusting)
    {
        vel.x += Trig::Cos(angle) * thrust * dt;
        vel.y += Trig::Sin(angle) * thrust * dt;
    }
    const double keep = 1 - drag * dt;
    vel.x *= keep;
    vel.y *= keep;
    const double speed = Speed();
    if (speed > maxSpeed)
    {
        vel.x *= maxSpeed / speed;
        vel.y *= maxSpeed / speed;
    }
}

void Ship::TickTimers(double dt)
{
    fireTimer = Max(0, fireTimer - dt);
    invulnerable = Max(0, invulnerable - dt);
    jumpCooldown = Max(0, jumpCooldown - dt);
}

void Bullet::Launch(bool InFromShip, double x, double y, double InAngle, double speed, double baseVx, double baseVy, double InLifetime)
{
    Place(x, y, baseVx + Trig::Cos(InAngle) * speed, baseVy + Trig::Sin(InAngle) * speed, InAngle);
    fromShip = InFromShip;
    lifetime = InLifetime;
}

bool Bullet::Age(double dt)
{
    lifetime -= dt;
    return lifetime <= 0;
}

void Rock::Init(RockSize InSize, double x, double y, double vx, double vy, double spin, int InLook)
{
    Place(x, y, vx, vy, 0);
    size = InSize;
    radius = RulesOf(InSize).radius;
    angularVel = spin;
    look = InLook;
}

void Hunter::Init(HunterKind InKind, double x, double y, int direction, double travel, Random& rng)
{
    const HunterRules& rules = RulesOf(InKind);
    Place(x, y, direction * rules.speed, 0, direction > 0 ? 0 : Trig::Pi);
    kind = InKind;
    radius = rules.radius;
    fireTimer = rules.fireInterval;
    turnTimer = rng.Range(Rules::hunters::turnEvery[0], Rules::hunters::turnEvery[1]);
    travelLeft = travel;
    age = 0;
}

double Hunter::ShotAngle(const Entity* target, const Field& field, Random& rng, int score) const
{
    if (kind == HunterKind::Big || target == nullptr) return rng.Range(0, Trig::Pi * 2);
    const double exact = Trig::Atan2(field.Dy(*this, *target), field.Dx(*this, *target));
    const double error = AimError(score);
    return exact + rng.Range(-error, error);
}

void Hunter::Weave(double dt, Random& rng)
{
    turnTimer -= dt;
    if (turnTimer > 0) return;
    using namespace Rules::hunters;
    turnTimer = rng.Range(turnEvery[0], turnEvery[1]);
    vel.y = (rng.Int(3) - 1) * RulesOf(kind).speed * climbShare;
}

// ------------------------------------------------------------------------------------------------

InputLog::InputLog(int capacity) : bytes(new uint8_t[capacity]()), size(capacity) {}

InputLog::~InputLog()
{
    delete[] bytes;
}

bool InputLog::Record(uint8_t input)
{
    if (length == size)
    {
        dropped += 1;
        return false;
    }
    bytes[length++] = input;
    return true;
}

// ------------------------------------------------------------------------------------------------

Game::Game(const GameOptions& options)
    : seed(options.seed),
      rng(options.seed),
      field(options.width, options.height),
      centre(Rules::ship::clearRadius),
      ships(options.startingShips)
{
    centre.pos.x = options.width / 2;
    centre.pos.y = options.height / 2;
    if (options.startingShips > 0) SpawnShip();
    StartWave();
    Flush();
    events.length = 0;
}

// ---- the main loop ------------------------------------------------------------------------------
// One fixed step. The order matters, and nothing is added to or removed from the world until
// Flush(), after every loop over it has finished.
const EventList& Game::Step(uint8_t input)
{
    events.length = 0;
    time += STEP;
    steps += 1;
    HandleInput(input); // 1. input: steer, fire, hyperspace
    Update(STEP);       // 2. update and integrate: move everything, run the timers
    WrapAll();          // 3. screen wrap
    Collide();          // 4. collide: circle against circle; hits only mark things dead
    Flush();            // 5. spawn and destroy: the only place the world's lists change
    CheckGameOver();    //    and the game ends here, once every hit of the step has counted
    return events;      // 6. events out, for a renderer and the sound
}

// ---- 1. input -----------------------------------------------------------------------------------
void Game::HandleInput(uint8_t input)
{
    const int pressed = input & ~lastInput; // pressed this step, not held from the last one
    lastInput = input;
    if (!ship.alive || ship.jumping > 0) return;
    ship.Steer(input, STEP);
    if ((input & Input::Fire) && ship.fireTimer <= 0) FireShipBullet();
    if ((pressed & Input::Hyperspace) && ship.jumpCooldown <= 0)
    {
        ship.jumping = Rules::hyperspace::jumpTime;
        ship.thrusting = false;
        Emit(EventType::hyperspaceOut, ship);
    }
}

void Game::FireShipBullet()
{
    if (bullets.CountAlive([](const Bullet& b) { return b.fromShip; }) >= Rules::ship::maxBullets) return;
    Bullet* bullet = bullets.Acquire();
    Check(bullet != nullptr, "bullet pool too small"); // capacity covers every shooter's cap
    const double nose = ship.radius + 2;
    bullet->Launch(true, ship.pos.x + Trig::Cos(ship.angle) * nose, ship.pos.y + Trig::Sin(ship.angle) * nose,
                   ship.angle, Rules::bullet::speed, ship.vel.x, ship.vel.y, Rules::bullet::lifetime);
    ship.fireTimer = Rules::ship::fireInterval;
    Emit(EventType::shot, *bullet);
}

// ---- 2. update and integrate ---------------------------------------------------------------------
void Game::Update(double dt)
{
    UpdateShip(dt);
    for (int i = 0; i < bullets.LiveCount(); ++i)
    {
        Bullet& bullet = bullets.Live(i);
        bullet.Integrate(dt);
        if (bullet.Age(dt)) bullets.Release(bullet);
    }
    for (int i = 0; i < rocks.LiveCount(); ++i) rocks.Live(i).Integrate(dt);
    for (int i = 0; i < hunters.LiveCount(); ++i) UpdateHunter(hunters.Live(i), dt);
    UpdateWaves(dt);
    UpdateHunterArrivals(dt);
    UpdateRespawn(dt);
}

void Game::UpdateShip(double dt)
{
    if (!ship.alive) return;
    ship.TickTimers(dt);
    if (ship.jumping > 0)
    {
        ship.jumping -= dt;
        if (ship.jumping <= 0) ArriveFromHyperspace();
        return;
    }
    ship.Integrate(dt);
}

// The risk of hyperspace: you arrive anywhere, at rest, with no shield, and one jump in failOneIn
// breaks the ship up.
void Game::ArriveFromHyperspace()
{
    const double x = rng.Range(0, field.width);
    const double y = rng.Range(0, field.height);
    ship.Place(x, y, 0, 0, ship.angle);
    ship.invulnerable = 0; // a jump taken under the respawn shield lands without it
    ship.jumpCooldown = Rules::hyperspace::cooldown;
    if (rng.OneIn(Rules::hyperspace::failOneIn))
    {
        Emit(EventType::hyperspaceFailed, ship);
        DestroyShip();
    }
    else
    {
        Emit(EventType::hyperspaceIn, ship);
    }
}

void Game::UpdateHunter(Hunter& hunter, double dt)
{
    hunter.age += dt;
    hunter.travelLeft -= std::fabs(hunter.vel.x) * dt;
    if (hunter.travelLeft <= 0)
    {
        hunters.Release(hunter);
        Emit(EventType::hunterLeft, hunter);
        return;
    }
    hunter.Weave(dt, rng);
    hunter.Integrate(dt);
    hunter.fireTimer -= dt;
    if (hunter.fireTimer <= 0)
    {
        hunter.fireTimer = RulesOf(hunter.kind).fireInterval;
        FireHunterBullet(hunter);
    }
}

void Game::FireHunterBullet(Hunter& hunter)
{
    if (bullets.CountAlive([](const Bullet& b) { return !b.fromShip; }) >= Rules::hunters::maxBullets * hunters.capacity) return;
    Bullet* bullet = bullets.Acquire();
    Check(bullet != nullptr, "bullet pool too small");
    // The ship is a target whenever it is on the field, shielded or not; in hyperspace it is nowhere.
    const Entity* target = ship.alive && ship.jumping <= 0 ? &ship : nullptr;
    const double angle = hunter.ShotAngle(target, field, rng, score);
    const double muzzle = hunter.radius + 4;
    bullet->Launch(false, hunter.pos.x + Trig::Cos(angle) * muzzle, hunter.pos.y + Trig::Sin(angle) * muzzle,
                   angle, RulesOf(hunter.kind).bulletSpeed, 0, 0, Rules::hunters::bulletLifetime);
    Emit(EventType::shot, *bullet);
}

void Game::UpdateWaves(double dt)
{
    if (rocks.InUse() > 0) return;
    if (waveTimer <= 0) waveTimer = Rules::waves::delay; // the field just cleared
    waveTimer -= dt;
    if (waveTimer <= 0) StartWave();
}

void Game::StartWave()
{
    wave += 1;
    waveTimer = 0;
    const double speedUp = Min(1 + (wave - 1) * Rules::waves::speedUpPerWave, Rules::waves::maxSpeedUp);
    for (int i = 0; i < RocksForWave(wave); ++i)
    {
        const Vec2 spot = FarFromShip();
        const double heading = rng.Range(0, Trig::Pi * 2);
        const RockRules& large = RulesOf(RockSize::Large);
        const double speed = rng.Range(large.minSpeed, large.maxSpeed) * speedUp;
        SpawnRock(RockSize::Large, spot.x, spot.y, Trig::Cos(heading) * speed, Trig::Sin(heading) * speed);
    }
    Emit(EventType::waveStart, centre);
}

// A random point at least safeDistance from the ship (or the centre, while there is no ship).
Vec2 Game::FarFromShip()
{
    const Entity& from = ship.alive ? static_cast<const Entity&>(ship) : centre;
    const double minSquared = Rules::waves::safeDistance * Rules::waves::safeDistance;
    do
    {
        probe.pos.x = rng.Range(0, field.width);
        probe.pos.y = rng.Range(0, field.height);
    } while (field.DistanceSquared(from, probe) < minSquared);
    return probe.pos;
}

Rock& Game::SpawnRock(RockSize size, double x, double y, double vx, double vy)
{
    Rock* rock = rocks.Acquire();
    Check(rock != nullptr, "rock pool too small"); // never: PoolSize::rocks is the worst case
    const double spin = rng.Range(-1.2, 1.2);
    const int look = rng.Int(3);
    rock->Init(size, x, y, vx, vy, spin, look);
    return *rock;
}

void Game::UpdateHunterArrivals(double dt)
{
    if (hunters.InUse() > 0) return;
    hunterTimer -= dt;
    if (hunterTimer > 0) return;
    using namespace Rules::hunters;
    hunterTimer = Max(minInterval, interval - (wave - 1) * quickerPerWave);
    const HunterKind kind = rng.Next() < SmallHunterChance(score) ? HunterKind::Small : HunterKind::Big;
    const int direction = rng.Sign(); // +1 enters on the left edge flying right
    Hunter* hunter = hunters.Acquire();
    Check(hunter != nullptr, "hunter pool too small");
    const double x = direction > 0 ? 0 : field.width - 0.001;
    const double y = rng.Range(0, field.height);
    hunter->Init(kind, x, y, direction, field.width, rng);
    Emit(EventType::hunterArrived, *hunter);
}

void Game::UpdateRespawn(double dt)
{
    if (ship.alive || ships <= 0) return; // flying, or no ships left
    respawnTimer -= dt;
    if (respawnTimer <= 0 && CentreIsClear()) SpawnShip();
}

bool Game::CentreIsClear() const
{
    for (int i = 0; i < rocks.LiveCount(); ++i)
        if (rocks.Live(i).alive && field.Overlaps(centre, rocks.Live(i))) return false;
    for (int i = 0; i < hunters.LiveCount(); ++i)
        if (hunters.Live(i).alive && field.Overlaps(centre, hunters.Live(i))) return false;
    for (int i = 0; i < bullets.LiveCount(); ++i)
    {
        const Bullet& bullet = bullets.Live(i);
        if (!bullet.fromShip && bullet.alive && field.Overlaps(centre, bullet)) return false;
    }
    return true;
}

void Game::SpawnShip()
{
    ship.Place(centre.pos.x, centre.pos.y, 0, 0, -Trig::Pi / 2); // facing up the screen
    ship.alive = true;
    ship.thrusting = false;
    ship.fireTimer = 0;
    ship.jumping = 0;
    ship.jumpCooldown = 0;
    ship.invulnerable = Rules::ship::invulnerableFor;
    Emit(EventType::respawn, ship);
}

// ---- 3. wrap ------------------------------------------------------------------------------------
void Game::WrapAll()
{
    if (ship.alive) field.Wrap(ship);
    for (int i = 0; i < bullets.LiveCount(); ++i) field.Wrap(bullets.Live(i));
    for (int i = 0; i < rocks.LiveCount(); ++i) field.Wrap(rocks.Live(i));
    for (int i = 0; i < hunters.LiveCount(); ++i) field.Wrap(hunters.Live(i));
}

// ---- 4. collide ---------------------------------------------------------------------------------
// Each hit releases what it hit. Release() marks it dead at once, so a rock hit twice in one step
// breaks once, but nothing leaves the lists until Flush().
void Game::Collide()
{
    for (int i = 0; i < bullets.LiveCount(); ++i)
    {
        Bullet& bullet = bullets.Live(i);
        if (!bullet.alive) continue;
        if (Rock* rock = FirstRockTouching(bullet))
        {
            bullets.Release(bullet);
            BreakRock(*rock, bullet.fromShip);
        }
        else if (bullet.fromShip)
        {
            if (Hunter* hunter = FirstHunterTouching(bullet))
            {
                bullets.Release(bullet);
                DestroyHunter(*hunter, true);
            }
        }
        else if (ship.CanBeHit() && field.Overlaps(bullet, ship))
        {
            bullets.Release(bullet);
            DestroyShip();
        }
    }
    if (ship.CanBeHit())
    {
        Rock* rock = FirstRockTouching(ship);
        Hunter* hunter = FirstHunterTouching(ship);
        if (rock) BreakRock(*rock, false);
        if (hunter) DestroyHunter(*hunter, false);
        if (rock || hunter) DestroyShip(); // ramming scores nothing: points come from shots
    }
    for (int i = 0; i < hunters.LiveCount(); ++i)
    {
        Hunter& hunter = hunters.Live(i);
        if (!hunter.alive) continue;
        if (Rock* rock = FirstRockTouching(hunter))
        {
            BreakRock(*rock, false);
            DestroyHunter(hunter, false);
        }
    }
}

Rock* Game::FirstRockTouching(const Entity& entity)
{
    for (int i = 0; i < rocks.LiveCount(); ++i)
    {
        Rock& rock = rocks.Live(i);
        if (rock.alive && field.Overlaps(entity, rock)) return &rock;
    }
    return nullptr;
}

Hunter* Game::FirstHunterTouching(const Entity& entity)
{
    for (int i = 0; i < hunters.LiveCount(); ++i)
    {
        Hunter& hunter = hunters.Live(i);
        if (hunter.alive && field.Overlaps(entity, hunter)) return &hunter;
    }
    return nullptr;
}

// A hit rock breaks. Bigger than Small, it leaves two children one size down, at its position, their
// velocities turned apart from its own and a little faster.
void Game::BreakRock(Rock& rock, bool byShip)
{
    rocks.Release(rock);
    if (byShip) AddScore(rock.Score());
    Emit(EventType::rockBroken, rock, byShip ? rock.Score() : 0);
    const RockSize size = rock.Smaller();
    if (size == RockSize::None) return;
    using namespace Rules::split;
    const double speed = Max(rock.Speed() * speedUp, RulesOf(size).minSpeed);
    const double heading = rock.Speed() > 0 ? Trig::Atan2(rock.vel.y, rock.vel.x) : rng.Range(0, Trig::Pi * 2);
    const int sides[2] = { -1, 1 };
    for (const int side : sides)
    {
        const double turned = heading + side * rng.Range(minAngle, maxAngle);
        SpawnRock(size, rock.pos.x, rock.pos.y, Trig::Cos(turned) * speed, Trig::Sin(turned) * speed);
    }
}

void Game::DestroyHunter(Hunter& hunter, bool byShip)
{
    hunters.Release(hunter);
    if (byShip) AddScore(hunter.Score());
    Emit(EventType::hunterDestroyed, hunter, byShip ? hunter.Score() : 0);
}

// The ship is lost. Whether that ends the game is decided once, at the end of the step (CheckGameOver).
void Game::DestroyShip()
{
    ship.alive = false;
    ship.thrusting = false;
    ships -= 1;
    shipLost = true;
    respawnTimer = Rules::ship::respawnDelay;
    Emit(EventType::shipDestroyed, ship);
}

void Game::AddScore(int points)
{
    score += points;
    while (!over && score >= nextExtraShipAt) // a finished game earns no ships
    {
        ships += 1;
        nextExtraShipAt += Rules::extraShipEvery;
        Emit(EventType::extraShip, ship);
    }
}

// ---- 5. spawn and destroy -----------------------------------------------------------------------
void Game::Flush()
{
    bullets.Flush();
    rocks.Flush();
    hunters.Flush();
}

// A ship lost in this step ends the game if no ship is left once every hit of the step has counted. Deciding
// it here, not at the crash, means a ship earned in the same step always counts, whatever order the shots are
// in the pool. (A game made with no ships has none to lose, so it never ends.)
void Game::CheckGameOver()
{
    if (!shipLost) return;
    shipLost = false;
    if (ships > 0) return;
    over = true;
    Emit(EventType::gameOver, ship);
}

// ---- 6. events ----------------------------------------------------------------------------------
// A renderer and the sound read them after each step; the rules never do.
void Game::Emit(EventType type, const Entity& at, int points)
{
    Check(events.length < EventList::capacity, "event list too small");
    Event& event = events.items[events.length++];
    event = Event();
    event.type = type;
    event.x = at.pos.x;
    event.y = at.pos.y;
    event.points = points;
    event.vx = at.vel.x;
    event.vy = at.vel.y;
}

void Game::Emit(EventType type, const Rock& rock, int points)
{
    Emit(type, static_cast<const Entity&>(rock), points);
    events.items[events.length - 1].size = rock.size;
}

void Game::Emit(EventType type, const Hunter& hunter, int points)
{
    Emit(type, static_cast<const Entity&>(hunter), points);
    events.items[events.length - 1].kind = hunter.kind;
}

void Game::Emit(EventType type, const Bullet& bullet, int points)
{
    Emit(type, static_cast<const Entity&>(bullet), points);
    events.items[events.length - 1].fromShip = bullet.fromShip;
}

// ---- replay and checks --------------------------------------------------------------------------
namespace
{
// Appends to a fixed buffer; stops the program if the buffer is too small rather than cut the text.
struct Text
{
    char* buffer;
    int size;
    int used;

    void Add(const char* format, ...)
    {
        va_list args;
        va_start(args, format);
        const int wrote = std::vsnprintf(buffer + used, static_cast<size_t>(size - used), format, args);
        va_end(args);
        Check(wrote >= 0 && wrote < size - used, "snapshot buffer too small");
        used += wrote;
    }

    void Pose(const Entity& e)
    {
        Add("%.17g,%.17g,%.17g,%.17g,%.17g", e.pos.x, e.pos.y, e.vel.x, e.vel.y, e.angle);
    }
};

const char* Bool(bool value) { return value ? "true" : "false"; }
} // namespace

int Game::Snapshot(char* buffer, int size) const
{
    Text out{ buffer, size, 0 };
    out.Add("{\"steps\":%d,\"score\":%d,\"ships\":%d,\"wave\":%d,\"over\":%s,\"rng\":%u,", steps, score, ships, wave, Bool(over), rng.state);
    out.Add("\"waveTimer\":%.17g,\"hunterTimer\":%.17g,\"respawnTimer\":%.17g,", waveTimer, hunterTimer, respawnTimer);
    out.Add("\"ship\":{\"alive\":%s,\"pose\":[", Bool(ship.alive));
    out.Pose(ship);
    out.Add("],\"jumping\":%.17g,\"invulnerable\":%.17g},\"bullets\":[", ship.jumping, ship.invulnerable);
    for (int i = 0; i < bullets.LiveCount(); ++i)
    {
        const Bullet& b = bullets.Live(i);
        out.Add("%s[%d,%s,%.17g,", i ? "," : "", b.slot, Bool(b.fromShip), b.lifetime);
        out.Pose(b);
        out.Add("]");
    }
    out.Add("],\"rocks\":[");
    for (int i = 0; i < rocks.LiveCount(); ++i)
    {
        const Rock& r = rocks.Live(i);
        out.Add("%s[%d,\"%s\",%d,", i ? "," : "", r.slot, NameOf(r.size), r.look);
        out.Pose(r);
        out.Add("]");
    }
    out.Add("],\"hunters\":[");
    for (int i = 0; i < hunters.LiveCount(); ++i)
    {
        const Hunter& h = hunters.Live(i);
        out.Add("%s[%d,\"%s\",%.17g,%.17g,", i ? "," : "", h.slot, NameOf(h.kind), h.travelLeft, h.fireTimer);
        out.Pose(h);
        out.Add("]");
    }
    out.Add("]}");
    return out.used;
}

Game Replay(const GameOptions& options, const InputLog& log, int steps)
{
    Game game(options);
    for (int i = 0; i < steps; ++i) game.Step(log.At(i));
    return game;
}

} // namespace Shatterbelt
