// The rules of the C++ core, checked the way test/core.test.js checks core.js, plus what only C++ can
// break: allocating inside Game::Step, and drifting from core.js's numbers.
//
//   test_core.exe          runs every test and prints one TAP line per test ("ok 3 - name"); exit 1 on a failure
//   test_core.exe <text>   runs only the tests whose name contains the text
#include "shatterbelt_core.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

using namespace Shatterbelt;

// ---- counting allocations -----------------------------------------------------------------------
// Every operator new in this program, the core's included, goes through these and is counted.
namespace
{
long long allocations = 0;

void* Allocate(std::size_t size)
{
    ++allocations;
    void* memory = std::malloc(size ? size : 1);
    if (!memory) std::abort();
    return memory;
}
} // namespace

void* operator new(std::size_t size) { return Allocate(size); }
void* operator new[](std::size_t size) { return Allocate(size); }
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::size_t) noexcept { std::free(memory); }

// ---- a small test runner ------------------------------------------------------------------------
namespace
{
int failedChecks = 0; // in the test that is running

void Expect(bool ok, const char* what)
{
    if (ok) return;
    ++failedChecks;
    std::printf("#   failed: %s\n", what);
}

// ---- helpers: set up an exact situation, then let the real Step() run it ----------------------

// A game with nothing on the field and no wave or hunter due, so a test can place exactly what it needs.
Game EmptyGame(uint32_t seed = 11)
{
    GameOptions options;
    options.seed = seed;
    Game game(options);
    for (int i = 0; i < game.rocks.LiveCount(); ++i) game.rocks.Release(game.rocks.Live(i));
    for (int i = 0; i < game.bullets.LiveCount(); ++i) game.bullets.Release(game.bullets.Live(i));
    for (int i = 0; i < game.hunters.LiveCount(); ++i) game.hunters.Release(game.hunters.Live(i));
    game.Flush();
    game.waveTimer = 1e9;
    game.hunterTimer = 1e9;
    game.ship.invulnerable = 0;
    return game;
}

Rock& AddRock(Game& game, RockSize size, double x, double y, double vx = 0, double vy = 0)
{
    Rock& rock = game.SpawnRock(size, x, y, vx, vy);
    rock.angularVel = 0;
    game.Flush();
    return rock;
}

Bullet& AddShot(Game& game, double x, double y, double angle = 0, bool fromShip = true)
{
    Bullet* bullet = game.bullets.Acquire();
    bullet->Launch(fromShip, x, y, angle, Rules::bullet::speed, 0, 0, Rules::bullet::lifetime);
    game.Flush();
    return *bullet;
}

Hunter& AddHunter(Game& game, HunterKind kind, double x, double y)
{
    Hunter* hunter = game.hunters.Acquire();
    hunter->Init(kind, x, y, 1, game.field.width, game.rng);
    game.Flush();
    return *hunter;
}

void MoveShipTo(Game& game, double x, double y)
{
    game.ship.Place(x, y, 0, 0, -Trig::Pi / 2);
}

double Heading(const Vec2& v) { return std::atan2(v.y, v.x); }
double SignedTurn(double from, double to) { return std::atan2(std::sin(to - from), std::cos(to - from)); } // the short way
double AngleBetween(double a, double b) { return std::fabs(SignedTurn(b, a)); }

int CountOf(const EventList& events, EventType type)
{
    int count = 0;
    for (int i = 0; i < events.length; ++i)
        if (events.items[i].type == type) ++count;
    return count;
}

int ShipShotsAlive(const Game& game)
{
    return game.bullets.CountAlive([](const Bullet& b) { return b.fromShip; });
}

// The input of a player who changes what they hold every so often, as in core.test.js.
struct Player
{
    Random inputs{ 2024 };
    uint8_t held = 0;

    uint8_t Next()
    {
        if (inputs.OneIn(12)) held = static_cast<uint8_t>(inputs.Int(32));
        return held;
    }
};

// ---- splitting ------------------------------------------------------------------------------------

void SplitLarge()
{
    Game game = EmptyGame();
    MoveShipTo(game, 100, 100);
    Rock& parent = AddRock(game, RockSize::Large, 500, 300, 40, 0);
    AddShot(game, 500, 300);
    game.Step(0);
    Expect(!parent.alive, "the parent is gone");
    Expect(game.rocks.LiveCount() == 2, "two children");
    double sides[2] = { 0, 0 };
    for (int i = 0; i < game.rocks.LiveCount() && i < 2; ++i)
    {
        const Rock& child = game.rocks.Live(i);
        Expect(child.size == RockSize::Medium, "each child is Medium");
        Expect(child.pos.x == parent.pos.x && child.pos.y == parent.pos.y, "born where the parent was hit");
        const double turn = AngleBetween(Heading(child.vel), Heading(parent.vel));
        Expect(turn >= Rules::split::minAngle && turn <= Rules::split::maxAngle, "turned apart by minAngle to maxAngle");
        Expect(child.Speed() > parent.Speed(), "a little faster");
        sides[i] = std::sin(Heading(child.vel) - Heading(parent.vel));
    }
    Expect(sides[0] * sides[1] < 0, "one turns left of the parent, the other right");
}

void SplitMedium()
{
    Game game = EmptyGame();
    MoveShipTo(game, 100, 100);
    AddRock(game, RockSize::Medium, 500, 300, 0, 50);
    AddShot(game, 500, 300);
    game.Step(0);
    Expect(game.rocks.LiveCount() == 2, "two children");
    for (int i = 0; i < game.rocks.LiveCount(); ++i) Expect(game.rocks.Live(i).size == RockSize::Small, "each child is Small");
}

void SmallDoesNotSplit()
{
    Game game = EmptyGame();
    MoveShipTo(game, 100, 100);
    AddRock(game, RockSize::Small, 500, 300, 60, 0);
    AddShot(game, 500, 300);
    const EventList& events = game.Step(0);
    Expect(game.rocks.LiveCount() == 0, "nothing is left");
    Expect(CountOf(events, EventType::rockBroken) == 1, "one rockBroken event");
}

// The worst case for the rock pool: the fullest wave (11 Large rocks) is 22 Medium rocks at most, and a broken
// rock keeps its slot until Flush() while its two pieces take theirs at once, so 22 breaks before one Flush()
// hold 22 + 44 = 66 slots. Before the pool was this size, this test stopped the run: "rock pool too small".
void RockPoolHoldsTheFullestWave()
{
    Game game = EmptyGame();
    MoveShipTo(game, 30, 30);
    game.wave = 10;
    game.StartWave();
    game.Flush();
    Expect(game.rocks.LiveCount() == RocksForWave(11), "the fullest wave");
    for (int i = 0; i < game.rocks.LiveCount(); ++i) game.BreakRock(game.rocks.Live(i), true);
    game.Flush();
    Expect(game.rocks.CountAlive([](const Rock& r) { return r.size == RockSize::Medium; }) == 22, "22 Medium rocks");
    game.events.length = 0;
    for (int i = 0; i < game.rocks.LiveCount(); ++i) game.BreakRock(game.rocks.Live(i), true); // the calls Collide() makes, before one Flush()
    game.Flush();
    Expect(game.rocks.LiveCount() == 44, "44 pieces");
    Expect(game.rocks.CountAlive([](const Rock& r) { return r.size == RockSize::Small; }) == 44, "all Small");
    Expect(CountOf(game.events, EventType::rockBroken) == 22, "22 rockBroken events");
}

// ---- scoring -------------------------------------------------------------------------------------

int ScoreForRock(RockSize size)
{
    Game game = EmptyGame();
    MoveShipTo(game, 100, 100);
    AddRock(game, size, 500, 300);
    AddShot(game, 500, 300);
    game.Step(0);
    return game.score;
}

int ScoreForHunter(HunterKind kind)
{
    Game game = EmptyGame();
    MoveShipTo(game, 100, 100);
    AddHunter(game, kind, 500, 300);
    AddShot(game, 500, 300);
    game.Step(0);
    return game.score;
}

void PointsBySize()
{
    Expect(ScoreForRock(RockSize::Large) == 25, "Large rock 25");
    Expect(ScoreForRock(RockSize::Medium) == 60, "Medium rock 60");
    Expect(ScoreForRock(RockSize::Small) == 120, "Small rock 120");
    Expect(ScoreForHunter(HunterKind::Big) == 250, "Big hunter 250");
    Expect(ScoreForHunter(HunterKind::Small) == 1000, "Small hunter 1000");
}

// ---- the wrapping field --------------------------------------------------------------------------

void WrapAllEdges()
{
    const Field field(1000, 625);
    Entity e;
    e.pos = { -4, 300 };
    field.Wrap(e);
    Expect(e.pos.x == 996 && e.pos.y == 300, "left edge");
    e.pos = { 1003, 300 };
    field.Wrap(e);
    Expect(e.pos.x == 3 && e.pos.y == 300, "right edge");
    e.pos = { 500, -5 };
    field.Wrap(e);
    Expect(e.pos.x == 500 && e.pos.y == 620, "top edge");
    e.pos = { 500, 627 };
    field.Wrap(e);
    Expect(e.pos.x == 500 && e.pos.y == 2, "bottom edge");
}

void WrapInTheStep()
{
    Game game = EmptyGame();
    MoveShipTo(game, 500, 300);
    Rock& rock = AddRock(game, RockSize::Small, 1, 300, -120, 0);
    game.Step(0);
    Expect(rock.pos.x > 990, "came back on the right");
    const Field field(1000, 625);
    Entity a(10), b(10), c(10);
    a.pos = { 995, 10 };
    b.pos = { 3, 620 };
    c.pos = { 900, 10 };
    Expect(field.Overlaps(a, b), "touching across two edges overlaps");
    Expect(!field.Overlaps(c, b), "far apart does not");
}

// "angle += angularVel * dt, wrap the angle": a spinning rock and a ship turning for a long time each stay within
// half a turn of 0, and the wrap never changes how far they turn in a step.
void SpinWrapsTheAngle()
{
    Game game = EmptyGame();
    game.ships = 1000;
    MoveShipTo(game, 100, 100);
    Rock& fast = AddRock(game, RockSize::Large, 500, 300);
    Rock& back = AddRock(game, RockSize::Large, 800, 400);
    fast.angularVel = 1.2; // the fastest a rock spins, each way
    back.angularVel = -1.2;
    int wraps = 0;
    bool inRange = true;
    bool turnsBySpin = true;
    for (int i = 0; i < 1200; ++i)
    {
        game.Step(i < 900 ? Input::Left : Input::Right); // the ship turns too: 69 rad left, then 23 right
        const Entity* turning[3] = { &fast, &back, &game.ship };
        for (const Entity* e : turning)
        {
            if (!(e->angle > -Trig::Pi && e->angle <= Trig::Pi)) inRange = false;
            if (std::fabs(SignedTurn(e->prev.angle, e->angle) - e->angularVel * STEP) >= 1e-12) turnsBySpin = false;
            if (std::fabs(e->angle - e->prev.angle) > Trig::Pi) ++wraps;
        }
    }
    Expect(inRange, "every angle within half a turn of 0, every step");
    Expect(turnsBySpin, "every step turns by the spin, wrapped or not");
    Expect(wraps >= 3 + 3 + 10, "each went round more than once");
}

// ---- shots ---------------------------------------------------------------------------------------

void ShotLifetime()
{
    Game game = EmptyGame();
    MoveShipTo(game, 500, 300);
    game.Step(Input::Fire);
    const Bullet& shot = game.bullets.Live(0);
    const int lifeSteps = static_cast<int>(std::lround(Rules::bullet::lifetime / STEP));
    for (int i = 1; i < lifeSteps - 1; ++i) game.Step(0);
    Expect(shot.alive, "alive one step before its lifetime");
    game.Step(0);
    game.Step(0);
    Expect(!shot.alive, "gone one step after");
    Expect(game.bullets.LiveCount() == 0, "and out of the live list");
}

void ShotCap()
{
    Game game = EmptyGame();
    MoveShipTo(game, 500, 300);
    int most = 0;
    for (int i = 0; i < 600; ++i)
    {
        game.Step(Input::Fire | Input::Left);
        const int live = ShipShotsAlive(game);
        Expect(live <= Rules::ship::maxBullets, "never more than the cap");
        if (live > most) most = live;
    }
    Expect(most == Rules::ship::maxBullets, "the cap is reached, so it is the cap that holds");
}

// ---- the pool ------------------------------------------------------------------------------------

void PoolCapacityAndReuse()
{
    Pool<Rock, 4> pool;
    Rock* taken[4];
    for (Rock*& item : taken) item = pool.Acquire();
    for (Rock* item : taken) Expect(item != nullptr, "four objects");
    Expect(pool.Acquire() == nullptr, "full: no fifth object");
    pool.Flush();
    Expect(pool.LiveCount() == 4, "four live");
    pool.Release(*taken[2]);
    pool.Flush();
    Expect(pool.LiveCount() == 3, "three live");
    Rock* again = pool.Acquire();
    Expect(again == taken[2], "the freed object comes back, not a new one");
    Expect(again && again->slot == 2, "in its old slot");
    pool.Flush();
    Expect(pool.InUse() == 4, "four in use");
}

struct Item
{
    bool alive = false;
    int slot = -1;
    int liveIndex = -1;
};

void PoolReleaseWhileWalking()
{
    Pool<Item, 7> pool;
    for (int i = 0; i < 6; ++i) pool.Acquire();
    pool.Flush();
    int visits[7] = {};
    for (int i = 0; i < pool.LiveCount(); ++i)
    {
        Item& item = pool.Live(i);
        visits[item.slot] += 1;
        pool.Release(item);
        if (item.slot == 1) Expect(pool.Acquire() != nullptr, "one taken mid-walk"); // and it does not join this walk
    }
    for (int slot = 0; slot < 6; ++slot) Expect(visits[slot] == 1, "every item visited exactly once");
    Expect(visits[6] == 0, "the one taken mid-walk is not visited");
    Expect(pool.LiveCount() == 6, "the list itself waits for Flush()");
    pool.Flush();
    Expect(pool.LiveCount() == 1, "one live after Flush()");
    Expect(pool.InUse() == 1, "one in use");
}

void DeferredThreeRocks()
{
    Game game = EmptyGame();
    MoveShipTo(game, 100, 550);
    const double xs[3] = { 250, 500, 750 };
    for (const double x : xs)
    {
        AddRock(game, RockSize::Large, x, 300);
        AddShot(game, x, 300);
    }
    const EventList& events = game.Step(0);
    Expect(CountOf(events, EventType::rockBroken) == 3, "three rocks broken");
    Expect(game.score == 3 * Rules::rocks[0].score, "three scores");
    Expect(game.rocks.LiveCount() == 6, "six children");
    Expect(game.bullets.LiveCount() == 0, "every shot used");
}

void DeferredTwoShotsOneRock()
{
    Game game = EmptyGame();
    MoveShipTo(game, 100, 550);
    AddRock(game, RockSize::Large, 500, 300);
    AddShot(game, 495, 300);
    AddShot(game, 505, 300);
    const EventList& events = game.Step(0);
    Expect(CountOf(events, EventType::rockBroken) == 1, "broken once");
    Expect(game.score == Rules::rocks[0].score, "scored once");
    Expect(game.rocks.LiveCount() == 2, "two children, not four");
    Expect(game.bullets.LiveCount() == 1, "the second shot flies on");
}

// ---- ships ---------------------------------------------------------------------------------------

void ExtraShipOnce()
{
    Game game = EmptyGame();
    MoveShipTo(game, 100, 550);
    game.score = Rules::extraShipEvery - Rules::rocks[1].score;
    const int ships = game.ships;
    AddRock(game, RockSize::Medium, 500, 300);
    AddShot(game, 500, 300);
    const EventList& events = game.Step(0);
    Expect(game.score == Rules::extraShipEvery, "the score reaches 15,000");
    Expect(game.ships == ships + 1, "one more ship");
    Expect(CountOf(events, EventType::extraShip) == 1, "one extraShip event");
    Vec2 children[2];
    for (int i = 0; i < 2; ++i) children[i] = game.rocks.Live(i).pos;
    for (const Vec2& child : children)
    {
        AddShot(game, child.x, child.y);
        game.Step(0);
    }
    Expect(game.ships == ships + 1, "more points in the same band give no more ships");
    game.AddScore(2 * Rules::extraShipEvery);
    Expect(game.ships == ships + 3, "one jump across two thresholds gives two");
}

void RespawnWaitsForClearCentre()
{
    Game game = EmptyGame();
    const double cx = game.field.width / 2;
    const double cy = game.field.height / 2;
    Rock& blocker = AddRock(game, RockSize::Large, cx + 60, cy);
    MoveShipTo(game, 100, 100);
    game.DestroyShip();
    for (int i = 0; i < 600; ++i) game.Step(0);
    Expect(!game.ship.alive, "ten seconds later, still waiting");
    blocker.pos.x = cx + Rules::ship::clearRadius + blocker.radius + 5;
    game.Step(0);
    Expect(game.ship.alive, "back once the centre is clear");
    Expect(game.ship.pos.x == cx && game.ship.pos.y == cy, "at the centre");
    Expect(game.ship.invulnerable > 0, "shielded");
}

void GameOver()
{
    Game game = EmptyGame();
    game.ships = 1;
    MoveShipTo(game, 500, 300);
    Rock& rock = AddRock(game, RockSize::Small, 500, 300, 20, 0);
    const EventList& events = game.Step(0);
    Expect(game.over, "over");
    Expect(game.ships == 0, "no ships left");
    Expect(CountOf(events, EventType::gameOver) == 1, "one gameOver event");
    for (int i = 0; i < 600; ++i) game.Step(Input::Fire | Input::Thrust);
    Expect(!game.ship.alive, "no ship comes back");
    Expect(!rock.alive, "the rock it hit broke");
}

// The last ship is hit while its own shot is still on the way to a rock, and that shot takes the score past
// 15,000 a step later: no extra ship once the game is over.
void NoExtraShipAfterGameOver()
{
    Game game = EmptyGame();
    game.ships = 1;
    game.score = Rules::extraShipEvery - 10;
    MoveShipTo(game, 500, 300);
    AddRock(game, RockSize::Large, 800, 100);
    AddShot(game, 800 - 60, 100);      // the ship's shot, two steps from the rock
    AddShot(game, 500, 300, 0, false); // a hunter's shot, on the ship
    game.Step(0);
    Expect(game.over, "the last ship is lost");
    int extraShips = 0;
    for (int i = 0; i < 300; ++i) extraShips += CountOf(game.Step(0), EventType::extraShip);
    Expect(game.score > Rules::extraShipEvery, "the shot landed");
    Expect(extraShips == 0, "no extraShip event after game over");
    Expect(game.ships == 0 && game.over, "still over, with no ships");
    Expect(!game.ship.alive, "no ship flies in a finished game");
}

// The last ship lost and a ship earned in the same step: the game is decided once, after every hit of the step,
// so the order of the two shots in the pool cannot change it.
void LastShipAndExtraShipInOneStep()
{
    const bool orders[2] = { true, false };
    for (const bool hunterShotFirst : orders)
    {
        Game game = EmptyGame();
        game.ships = 1;
        game.score = Rules::extraShipEvery - 10;
        MoveShipTo(game, 500, 300);
        AddRock(game, RockSize::Large, 800, 100);
        if (hunterShotFirst)
        {
            AddShot(game, 500, 300, 0, false);
            AddShot(game, 800, 100);
        }
        else
        {
            AddShot(game, 800, 100);
            AddShot(game, 500, 300, 0, false);
        }
        const EventList& events = game.Step(0);
        const char* order = hunterShotFirst ? "hunter shot first" : "ship shot first";
        std::printf("#   %s: over %s, ships %d, score %d\n", order, game.over ? "yes" : "no", game.ships, game.score);
        Expect(game.score == Rules::extraShipEvery + 15, "the rock was hit");
        Expect(!game.over && game.ships == 1, "not over, one ship left");
        Expect(CountOf(events, EventType::shipDestroyed) == 1 && CountOf(events, EventType::extraShip) == 1 &&
                   CountOf(events, EventType::gameOver) == 0, "a ship lost, a ship earned, no game over");
        for (int i = 0; i < 600 && !game.ship.alive; ++i) game.Step(0);
        Expect(game.ship.alive, "the earned ship flies");
    }
}

void HyperspaceLandingHasNoShield()
{
    int landings = 0;
    for (uint32_t seed = 1; seed <= 40 && landings < 8; ++seed)
    {
        Game game = EmptyGame(seed);
        game.SpawnShip();
        Expect(game.ship.invulnerable > 0, "shielded after the respawn");
        game.Step(Input::Hyperspace);
        Expect(game.ship.jumping > 0, "in hyperspace");
        int arrived = 0; // 1 landed, 2 failed
        for (int i = 0; i < 60 && !arrived; ++i)
        {
            const EventList& events = game.Step(0);
            if (CountOf(events, EventType::hyperspaceIn)) arrived = 1;
            if (CountOf(events, EventType::hyperspaceFailed)) arrived = 2;
        }
        if (arrived != 1) continue; // one jump in eight fails; the rule is about a landing
        ++landings;
        Expect(game.ship.invulnerable == 0, "landed with no shield");
        Expect(game.ship.CanBeHit(), "and can be hit");
    }
    Expect(landings >= 8, "eight landings");
}

void HyperspaceFailsOneInEight()
{
    Game game = EmptyGame();
    int jumps = 0;
    int failed = 0;
    while (jumps < 800)
    {
        game.ships = 3;
        if (!game.ship.alive) game.SpawnShip();
        MoveShipTo(game, 500, 300);
        game.ship.invulnerable = 0;
        game.Step(Input::Hyperspace);
        game.Step(0);
        Expect(game.ship.jumping > 0, "in hyperspace");
        const Vec2 before = game.ship.pos;
        while (game.ship.jumping > 0) game.Step(0);
        jumps += 1;
        if (!game.ship.alive) failed += 1;
        else Expect(game.ship.pos.x != before.x || game.ship.pos.y != before.y, "it moved");
        const int cooldownSteps = static_cast<int>(std::lround(Rules::hyperspace::cooldown / STEP)) + 1;
        for (int i = 0; i < cooldownSteps; ++i) game.Step(0);
    }
    const double share = static_cast<double>(failed) / jumps;
    std::printf("#   %d of %d jumps failed\n", failed, jumps);
    Expect(share > 0.08 && share < 0.17, "about one jump in eight fails");
}

// ---- waves ---------------------------------------------------------------------------------------

void WavesGrow()
{
    const int expected[12] = { 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 11, 11 };
    for (int wave = 1; wave <= 12; ++wave) Expect(RocksForWave(wave) == expected[wave - 1], "3, one more each wave, at most 11");
    GameOptions options;
    options.seed = 5;
    Game game(options);
    Expect(game.wave == 1, "wave 1");
    Expect(game.rocks.LiveCount() == 3, "three rocks");
    for (int i = 0; i < game.rocks.LiveCount(); ++i)
    {
        Expect(game.rocks.Live(i).size == RockSize::Large, "all Large");
        game.rocks.Release(game.rocks.Live(i));
    }
    game.Flush();
    int steps = 0;
    while (game.wave == 1)
    {
        game.Step(0);
        steps += 1;
    }
    Expect(game.rocks.LiveCount() == 4, "four rocks in wave 2");
    Expect(std::fabs(steps * STEP - Rules::waves::delay) < 2 * STEP, "after the delay");
}

// ---- hunters -------------------------------------------------------------------------------------

void SmallHunterAimsShortWay()
{
    const Field field(1000, 625);
    Random rng(3);
    Hunter hunter;
    hunter.Init(HunterKind::Small, 300, 300, 1, 1000, rng);
    Entity ship;
    ship.pos = { 600, 420 };
    const double exact = std::atan2(120.0, 300.0);
    for (int i = 0; i < 200; ++i)
    {
        const double off = AngleBetween(hunter.ShotAngle(&ship, field, rng, 40000), exact);
        Expect(off <= Rules::hunters::aimErrorBest + 1e-9, "within its best aim");
    }
    hunter.pos.x = 960;
    ship.pos = { 40, 300 };
    const double across = hunter.ShotAngle(&ship, field, rng, 40000);
    Expect(std::cos(across) > 0.99, "fires right, across the edge, not the long way left");
}

void SmallHunterAimsAtShieldedShip()
{
    for (uint32_t seed = 1; seed <= 20; ++seed)
    {
        Game game = EmptyGame(seed);
        game.score = 40000;
        game.SpawnShip(); // the game's own respawn: the centre, shield on
        Expect(!game.ship.CanBeHit(), "shielded");
        Hunter& hunter = AddHunter(game, HunterKind::Small, game.ship.pos.x - 300, game.ship.pos.y);
        game.FireHunterBullet(hunter);
        game.Flush();
        const Bullet* shot = nullptr;
        for (int i = 0; i < game.bullets.LiveCount(); ++i)
            if (!game.bullets.Live(i).fromShip) shot = &game.bullets.Live(i);
        Expect(shot != nullptr, "it fired");
        if (shot) Expect(AngleBetween(Heading(shot->vel), 0) <= Rules::hunters::aimErrorBest + 1e-9, "the shot flies at the ship");
    }
}

// ---- the clock and the log ---------------------------------------------------------------------

void FixedTimestepSteps()
{
    FixedTimestep clock;
    int steps = 0;
    const double frames[5] = { 0.007, 0.016, 0.025, 0.004, 0.0081 };
    double time = 0;
    for (int i = 0; time < 10; ++i)
    {
        const double dt = frames[i % 5];
        time += dt;
        const double between = clock.Advance(dt, [&steps] { ++steps; });
        Expect(between >= 0 && between < 1, "the fraction into the next step is in [0, 1)");
    }
    Expect(std::abs(steps - static_cast<int>(std::floor(time * 60))) <= 1, "60 steps a second");
    int after = 0;
    clock.Advance(3.0, [&after] { ++after; });
    Expect(after == clock.maxStepsPerFrame, "a stall is not raced through");
}

void InputLogMadeOnceForAnHour()
{
    const int hour = 60 * 60 * 60; // steps
    const long long beforeLog = allocations;
    InputLog log;
    Expect(allocations == beforeLog + 1, "one allocation, when the log is made");
    const long long made = allocations;
    int refused = 0;
    for (int i = 0; i < hour; ++i)
        if (!log.Record(static_cast<uint8_t>(i % 32))) ++refused;
    Expect(refused == 0 && log.length == hour && log.dropped == 0, "room for an hour of play");
    Expect(!log.Record(5) && !log.Record(6), "full: a step is not recorded");
    Expect(log.length == hour && log.dropped == 2, "and the log says so: this game cannot be replayed");
    Expect(allocations == made, "recording never allocates");
    Expect(log.At(hour - 1) == (hour - 1) % 32 && log.At(4097) == 4097 % 32, "every step kept");
}

// ---- what only the C++ build can get wrong -------------------------------------------------------

// The numbers core.js's Random gives, printed by:
//   node -e "import('./core.js').then(({Random}) => { const r = new Random(77); for (let i = 0; i < 4; i++) console.log(r.next() * 2 ** 32) })"
void RandomMatchesCoreJs()
{
    struct Case { uint32_t seed; uint32_t values[4]; uint32_t stateAfter; };
    const Case cases[3] = {
        { 1, { 2693262067u, 11749833u, 2265367787u, 4213581821u }, 3031295957u },
        { 77, { 1827943904u, 181332479u, 2989326142u, 2086917005u }, 3031296033u },
        { 4294967295u, { 3850105811u, 813802916u, 3073704848u, 4054706436u }, 3031295955u },
    };
    for (const Case& c : cases)
    {
        Random rng(c.seed);
        for (const uint32_t value : c.values) Expect(rng.Next() * 4294967296.0 == value, "the same number as core.js");
        Expect(rng.state == c.stateAfter, "the same state as core.js");
    }
}

// How far apart two doubles are, in units in the last place of the second.
double UlpsApart(double value, double reference)
{
    const double ulp = std::nextafter(std::fabs(reference), INFINITY) - std::fabs(reference);
    return std::fabs(value - reference) / ulp;
}

void TrigIsAccurate()
{
    Random rng(99);
    double worst[4] = { 0, 0, 0, 0 };
    for (int i = 0; i < 1000000; ++i)
    {
        const double x = rng.Range(-2000, 2000);
        const double y = rng.Range(-2000, 2000);
        const double errors[4] = { UlpsApart(Trig::Sin(x), std::sin(x)), UlpsApart(Trig::Cos(x), std::cos(x)),
                                   UlpsApart(Trig::Atan2(y, x), std::atan2(y, x)), UlpsApart(Trig::Hypot(x, y), std::hypot(x, y)) };
        for (int k = 0; k < 4; ++k)
            if (errors[k] > worst[k]) worst[k] = errors[k];
    }
    std::printf("#   worst distance from the C runtime in a million tries, in units in the last place: sin %.2f, cos %.2f, atan2 %.2f, hypot %.2f\n",
                worst[0], worst[1], worst[2], worst[3]);
    for (const double ulps : worst) Expect(ulps <= 3, "within 3 units in the last place of the C runtime");
}

void Determinism()
{
    InputLog log;
    Player player;
    for (int i = 0; i < 5000; ++i) log.Record(player.Next());
    GameOptions options;
    options.seed = 77;
    const Game first = Replay(options, log, 5000);
    const Game second = Replay(options, log, 5000);
    options.seed = 78;
    const Game otherSeed = Replay(options, log, 5000);
    static char a[1 << 16], b[1 << 16], c[1 << 16];
    first.Snapshot(a, static_cast<int>(sizeof(a)));
    second.Snapshot(b, static_cast<int>(sizeof(b)));
    otherSeed.Snapshot(c, static_cast<int>(sizeof(c)));
    Expect(first.steps == 5000 && first.score > 0, "a real game");
    Expect(std::strcmp(a, b) == 0, "the same game twice");
    Expect(std::strcmp(a, c) != 0, "and the seed matters");
}

void CopyIsASaveState()
{
    Player player;
    Game original;
    for (int i = 0; i < 1000; ++i) original.Step(player.Next());
    Game copy = original;
    Player copyPlayer = player;
    for (int i = 0; i < 3000; ++i)
    {
        original.Step(player.Next());
        copy.Step(copyPlayer.Next());
    }
    static char a[1 << 16], b[1 << 16];
    original.Snapshot(a, static_cast<int>(sizeof(a)));
    copy.Snapshot(b, static_cast<int>(sizeof(b)));
    Expect(std::strcmp(a, b) == 0, "the copy played on exactly like the original");
    Expect(original.steps == 4000 && original.score > 0, "a real game");
}

void StepNeverAllocates()
{
    Player player;
    Game game;
    const long long before = allocations;
    int* probe = new int(1); // the counter really counts: this one must show
    delete probe;
    Expect(allocations == before + 1, "the counter sees an operator new");
    const long long start = allocations;
    int deaths = 0;
    int jumps = 0;
    for (int i = 0; i < 20000; ++i)
    {
        const EventList& events = game.Step(player.Next());
        deaths += CountOf(events, EventType::shipDestroyed);
        jumps += CountOf(events, EventType::hyperspaceOut);
    }
    std::printf("#   %lld operator new calls in 20,000 steps (score %d, wave %d, %d ships lost, %d jumps)\n",
                allocations - start, game.score, game.wave, deaths, jumps);
    Expect(allocations == start, "no operator new inside Game::Step");
    Expect(deaths > 0 && jumps > 0 && game.score > 0, "a busy game: ships lost, jumps made, points scored");
}

// ---- the run -------------------------------------------------------------------------------------

struct Test
{
    const char* name;
    void (*run)();
};

const Test tests[] = {
    { "a hit Large rock leaves two Medium rocks at its position, turned apart and a little faster", SplitLarge },
    { "a hit Medium rock leaves two Small rocks", SplitMedium },
    { "a hit Small rock breaks and leaves nothing", SmallDoesNotSplit },
    { "the rock pool holds the worst case: every Medium rock of the fullest wave broken in one step", RockPoolHoldsTheFullestWave },
    { "points by size: Large 25, Medium 60, Small 120, Big hunter 250, Small hunter 1000", PointsBySize },
    { "wrap: leaving any of the four edges comes back in at the opposite one", WrapAllEdges },
    { "wrap: a moving rock crosses an edge in the real step, and things touch across an edge", WrapInTheStep },
    { "spin: an angle is wrapped to within half a turn, and still turns by its spin every step", SpinWrapsTheAngle },
    { "a shot lives for its lifetime, then is gone", ShotLifetime },
    { "the ship never has more than its cap of live shots, however long fire is held", ShotCap },
    { "pool: never grows past its capacity, and reuses a freed slot", PoolCapacityAndReuse },
    { "pool: releasing while walking the live list visits every item exactly once", PoolReleaseWhileWalking },
    { "deferred destroy in the game: three shots on three rocks in one step break all three", DeferredThreeRocks },
    { "deferred destroy in the game: two shots on one rock break it once", DeferredTwoShotsOneRock },
    { "an extra ship at every 15,000 points, given exactly once", ExtraShipOnce },
    { "respawn waits for a clear centre, then comes back shielded", RespawnWaitsForClearCentre },
    { "game over when the last ship is lost, and no ship comes back", GameOver },
    { "no extra ship once the game is over, from a shot that lands after the last ship is lost", NoExtraShipAfterGameOver },
    { "the last ship lost and a ship earned in one step: the game goes on, whichever shot is first in the pool", LastShipAndExtraShipInOneStep },
    { "a hyperspace landing has no shield, even from a jump taken while the respawn shield is up", HyperspaceLandingHasNoShield },
    { "hyperspace moves the ship, and about one jump in eight fails", HyperspaceFailsOneInEight },
    { "waves grow: 3 Large rocks, one more each wave, at most 11", WavesGrow },
    { "a Small hunter aims at the ship, the short way round the field", SmallHunterAimsShortWay },
    { "a Small hunter aims at a ship that has just respawned under its shield", SmallHunterAimsAtShieldedShip },
    { "fixed timestep: uneven frames become 60 steps a second; a stall is not raced through", FixedTimestepSteps },
    { "the input log is made once, with room for an hour of play, and stops recording at its end", InputLogMadeOnceForAnHour },
    { "Random gives exactly the numbers core.js's Random gives", RandomMatchesCoreJs },
    { "Trig: sin, cos, atan2 and hypot stay within 3 units in the last place of the C runtime's", TrigIsAccurate },
    { "determinism: the same seed and the same input log give the same game after 5,000 steps", Determinism },
    { "a Game is plain data: a copy plays on exactly like the original", CopyIsASaveState },
    { "Game::Step never allocates: no operator new in a 20,000-step game", StepNeverAllocates },
};
} // namespace

int main(int argc, char** argv)
{
    const char* only = argc > 1 ? argv[1] : nullptr; // part of a test's name: run only the tests it matches
    int count = 0;
    for (const Test& test : tests)
        if (!only || std::strstr(test.name, only)) ++count;
    if (count == 0)
    {
        std::printf("no test's name contains \"%s\"\n", only);
        return 2;
    }
    int passed = 0;
    int ran = 0;
    std::printf("TAP version 13\n");
    for (const Test& test : tests)
    {
        if (only && !std::strstr(test.name, only)) continue;
        const int i = ran++;
        std::printf("# running %d - %s\n", i + 1, test.name);
        std::fflush(stdout); // so a crash still shows which test was running
        failedChecks = 0;
        test.run();
        if (failedChecks == 0) ++passed;
        std::printf("%s %d - %s\n", failedChecks == 0 ? "ok" : "not ok", i + 1, test.name);
    }
    std::printf("1..%d\n# tests %d\n# pass %d\n# fail %d\n", count, count, passed, count - passed);
    return passed == count ? 0 : 1;
}
