// The rules of Shatterbelt in C++17: the twin of core.js.
//
// Every class, method and tuning number in core.js is here under the same name, in the same order;
// the few types C++ needs on top (Vec2, Event, GameOptions, the rule tables' rows) say what they are.
// Types and functions are cased the Unreal way (step() is Step()); data keeps core.js's names exactly
// (fireTimer, alive), so one word finds a field in both files. A parameter that would hide a field of
// the same name takes the Unreal In prefix (InAngle). tools/parity.js plays the same games through both
// cores and compares the whole game after every step.
//
// The design in one paragraph, as in core.js:
//   Entity is anything that moves and can be hit: a position, a velocity, a facing, a spin, a radius.
//   Ship, Bullet, Rock and Hunter are Entities with their own rules.
//   Pool makes a fixed number of objects up front, so play never allocates, and it holds every add and
//   remove until Flush(), so nothing is added or removed while a loop is walking the list.
//   Field is the play area. Its edges wrap, so it also knows the shortest way between two points.
//   Game owns all of the above and advances the world one fixed step at a time (see Game::Step).
//
// What C++ adds: nothing allocates once a Game exists (test_core.cpp counts operator new across a long
// game), there are no exceptions and no RTTI, no virtual functions, and a Game is plain data with no
// pointers into itself, so it copies with = (a save state). An InputLog allocates once, when it is made.
#pragma once

#include <cstdint>

namespace Shatterbelt
{

constexpr double STEP = 1.0 / 60.0; // seconds of game time per step: the simulation always runs at 60 Hz
constexpr int STEPS_PER_HOUR = 60 * 60 * 60; // 216,000: the room in an input log, an hour of play

// One step's controls, as bits, so a whole game's input fits in one byte per step.
namespace Input
{
constexpr uint8_t Left = 1, Right = 2, Thrust = 4, Fire = 8, Hyperspace = 16;
}

enum class RockSize : uint8_t { Large, Medium, Small, None }; // None: the size of a Small rock's pieces
enum class HunterKind : uint8_t { Big, Small };

const char* NameOf(RockSize size);   // "Large", "Medium", "Small": the strings core.js uses
const char* NameOf(HunterKind kind); // "Big", "Small"

// A broken rule the code relies on: say which, and stop. core.js throws an Error in the same places.
[[noreturn]] void Fail(const char* what);
inline void Check(bool ok, const char* what)
{
    if (!ok) Fail(what);
}

// ------------------------------------------------------------------------------------------------
// Every tuning number in one place, with core.js's names. Distances are field units (the field is
// 1000 wide), times are seconds.

struct RockRules
{
    double radius;
    int score;
    double minSpeed, maxSpeed;
    RockSize smaller;
};

struct HunterRules
{
    double radius;
    int score;
    double speed, fireInterval, bulletSpeed;
};

namespace Rules
{
namespace field
{
constexpr double width = 1000, height = 625;
}
namespace ship
{
constexpr double radius = 14;
constexpr int startingShips = 3;
constexpr double turnSpeed = 4.6;       // radians per second
constexpr double thrust = 430;          // acceleration while thrusting
constexpr double drag = 0.55;           // share of speed lost per second
constexpr double maxSpeed = 470;
constexpr double fireInterval = 0.16;   // holding fire repeats this often
constexpr int maxBullets = 5;           // live shots at once
constexpr double invulnerableFor = 2.5; // after a respawn
constexpr double respawnDelay = 1.6;    // the shortest wait after a crash
constexpr double clearRadius = 150;     // a respawn waits until nothing hostile is this close to the centre
}
namespace bullet
{
constexpr double radius = 3, speed = 620, lifetime = 0.95;
}
namespace hyperspace
{
constexpr double jumpTime = 0.45, cooldown = 1.2;
constexpr int failOneIn = 8;
}
//                               radius  score  minSpeed  maxSpeed  smaller
constexpr RockRules rocks[3] = { {  46,     25,     30,       64,   RockSize::Medium },  // Large
                                 {  26,     60,     44,       96,   RockSize::Small },   // Medium
                                 {  13,    120,     62,      132,   RockSize::None } };  // Small
namespace split // children turn this far apart (radians) and speed up
{
constexpr double minAngle = 0.35, maxAngle = 0.8, speedUp = 1.25;
}
namespace waves
{
constexpr int firstCount = 3, growth = 1, maxCount = 11; // wave 1 has 3 Large rocks, one more per wave, never more than 11
constexpr double speedUpPerWave = 0.06, maxSpeedUp = 1.6;
constexpr double delay = 2.5;          // pause between a cleared wave and the next
constexpr double safeDistance = 240;   // new rocks never start this close to the ship
}
namespace hunters
{
//                                  radius  score  speed  fireInterval  bulletSpeed
constexpr HunterRules kinds[2] = { {  22,    250,    85,     1.25,        330 },   // Big
                                   {  13,   1000,   125,     0.95,        380 } }; // Small
constexpr double firstAfter = 16, interval = 15, minInterval = 7, quickerPerWave = 1;
constexpr int smallFromScore = 6000, smallAlwaysFromScore = 30000; // between these, the chance of a Small one rises
constexpr double aimErrorWorst = 0.45, aimErrorBest = 0.04;
constexpr int bestAimAtScore = 40000;
constexpr double turnEvery[2] = { 0.8, 1.8 };
constexpr double climbShare = 0.55;
constexpr int maxBullets = 3;
constexpr double bulletLifetime = 1.5;
}
constexpr int extraShipEvery = 15000;
} // namespace Rules

// How many of each a game can hold at once. Each pool is made this size and never grows, so each is a worst
// case:
//   bullets  the ship's 5 shots and 3 for each hunter slot, with room for the shots that hit something this
//            step, which keep their slot until Flush()
//   rocks    the fullest wave is 11 Large rocks, so at most 22 Medium or 44 Small. A rock broken in a step keeps
//            its slot until Flush() while its two pieces take theirs at once: 3 slots, for a Large rock's 4
//            Small rocks' worth or a Medium's 2. So the most is every one of 22 Medium rocks breaking in one
//            step: 22 + 44 = 66.
//   hunters  a new one comes only once the last has gone
namespace PoolSize
{
constexpr int bullets = 16, rocks = 66, hunters = 2;
}

inline const RockRules& RulesOf(RockSize size) { return Rules::rocks[static_cast<int>(size)]; }
inline const HunterRules& RulesOf(HunterKind kind) { return Rules::hunters::kinds[static_cast<int>(kind)]; }

// Small pure rules.
int RocksForWave(int wave);
double AimError(int score);          // how far off a Small hunter's shot can be, in radians
double SmallHunterChance(int score); // the chance that the next hunter is a Small one, from 0 to 1

// ------------------------------------------------------------------------------------------------

// A seeded random number generator (mulberry32). The same seed gives the same numbers on every run,
// which is what lets a whole game replay from its seed and its input log. Unsigned 32-bit arithmetic
// wraps at 2^32, which is what core.js gets from >>> 0 and Math.imul, so both give the same numbers.
class Random
{
public:
    explicit Random(uint32_t seed) : state(seed) {}

    double Next(); // a number in [0, 1)
    double Range(double min, double max);
    int Int(int count); // 0 to count - 1
    bool OneIn(int n);
    int Sign(); // -1 or +1

    uint32_t state;
};

// sin, cos, atan2 and hypot made from + - * / and square root only. IEEE 754 requires those five to be
// correctly rounded, so they give the same bits on every machine that follows it. The C runtime's own
// sin, cos, atan2 and hypot are approximations that differ from the browser's Math versions in the last
// bits (tools/parity.js measures it), and one differing bit is enough to part two replays. core.js has
// the same class, with the same steps in the same order.
struct Trig
{
    static constexpr double Pi = 3.141592653589793;

    static double Sin(double x);
    static double Cos(double x);
    static double Atan2(double y, double x); // finite y and x; (0, 0) gives 0
    static double Hypot(double x, double y);
};

struct Vec2
{
    double x = 0, y = 0;
};

class Entity;

// The play area. Its edges wrap: leave on the right and come back on the left.
class Field
{
public:
    Field(double InWidth, double InHeight) : width(InWidth), height(InHeight) {}

    void Wrap(Entity& entity) const;
    // The shortest way from a to b along x and along y, through an edge when that is shorter.
    double Dx(const Entity& a, const Entity& b) const;
    double Dy(const Entity& a, const Entity& b) const;
    double DistanceSquared(const Entity& a, const Entity& b) const;
    // Circle against circle. Two things touching across an edge do overlap.
    bool Overlaps(const Entity& a, const Entity& b) const;

    double width, height;
};

// Anything that moves and can be hit.
class Entity
{
public:
    explicit Entity(double InRadius = 0) : radius(InRadius) {}

    void Place(double x, double y, double vx, double vy, double InAngle);
    // Moves by its velocity and turns by its spin. The angle is wrapped to within half a turn of 0 (above -pi,
    // up to pi), and exactly, as in core.js.
    void Integrate(double dt);
    double Speed() const;

    Vec2 pos;
    Vec2 vel;
    double angle = 0;      // radians; 0 faces +x, and +y points down the screen, so turning right adds
    double angularVel = 0; // radians per second
    double radius;
    bool alive = false;
    struct { double x = 0, y = 0, angle = 0; } prev; // where it was one step ago, so a renderer can draw between steps
    int slot = -1;         // set by the Pool that holds it: its place in the pool, and in the live list
    int liveIndex = -1;
};

class Ship : public Entity
{
public:
    Ship() : Entity(Rules::ship::radius) {}

    bool CanBeHit() const { return alive && invulnerable <= 0 && jumping <= 0; }
    void Steer(uint8_t input, double dt); // rotate, thrust with inertia, then drag; speed is capped
    void TickTimers(double dt);

    bool thrusting = false;
    double fireTimer = 0;    // counts down to the next shot a held fire button may take
    double invulnerable = 0; // seconds left
    double jumping = 0;      // seconds left in hyperspace; the ship is nowhere while this is above 0
    double jumpCooldown = 0;
};

class Bullet : public Entity
{
public:
    Bullet() : Entity(Rules::bullet::radius) {}

    void Launch(bool InFromShip, double x, double y, double InAngle, double speed, double baseVx, double baseVy, double InLifetime);
    bool Age(double dt); // true once it has run out of time

    bool fromShip = true; // false: a hunter fired it
    double lifetime = 0;  // seconds left before it fades out
};

class Rock : public Entity
{
public:
    Rock() : Entity(0) {}

    void Init(RockSize InSize, double x, double y, double vx, double vy, double spin, int InLook);
    int Score() const { return RulesOf(size).score; }
    RockSize Smaller() const { return RulesOf(size).smaller; } // the size of its children; None for a Small rock

    RockSize size = RockSize::Large;
    int look = 0; // which of the rock models draws it; the rules do not care
};

class Hunter : public Entity
{
public:
    Hunter() : Entity(0) {}

    void Init(HunterKind InKind, double x, double y, int direction, double travel, Random& rng);
    int Score() const { return RulesOf(kind).score; }
    // The direction of its next shot. The Big one fires anywhere; the Small one aims at the ship the short
    // way round the field, off by up to AimError(score). No target (nullptr) means fire anywhere.
    double ShotAngle(const Entity* target, const Field& field, Random& rng, int score) const;
    void Weave(double dt, Random& rng); // every so often it changes course: climb, dive or level out

    HunterKind kind = HunterKind::Big;
    double fireTimer = 0;
    double turnTimer = 0;
    double travelLeft = 0; // it crosses the field once, then leaves
    double age = 0;
};

// A fixed set of objects, made once. Acquire() and Release() only take effect at Flush(), so code
// walking the live list never sees it change under it: nothing is skipped and nothing is visited twice.
// The lists hold slot numbers, not pointers, so a Pool is plain data and copies with =.
// T needs the fields alive, slot and liveIndex (Entity has them).
template <typename T, int Capacity>
class Pool
{
public:
    static constexpr int capacity = Capacity;

    Pool()
    {
        for (int i = 0; i < Capacity; ++i)
        {
            slots[i].alive = false;
            slots[i].slot = i;
            slots[i].liveIndex = -1;
            free[i] = Capacity - 1 - i; // taken from the end, so slot 0 is handed out first
        }
    }

    // A free object, already marked alive, that joins the live list at the next Flush(). nullptr when
    // every slot is taken: the pool never grows.
    T* Acquire()
    {
        if (freeCount == 0) return nullptr;
        T& item = slots[free[--freeCount]];
        item.alive = true;
        born[bornCount++] = item.slot;
        return &item;
    }

    // Marks it dead now (so nothing else hits it this step) and frees its slot at the next Flush().
    void Release(T& item)
    {
        if (!item.alive) return;
        item.alive = false;
        dying[dyingCount++] = item.slot;
    }

    void Flush()
    {
        for (int i = 0; i < dyingCount; ++i)
        {
            T& item = slots[dying[i]];
            if (item.liveIndex >= 0) RemoveFromLive(item);
            free[freeCount++] = item.slot;
        }
        dyingCount = 0;
        for (int i = 0; i < bornCount; ++i)
        {
            T& item = slots[born[i]];
            if (!item.alive) continue; // born and released in the same step: its slot is already free
            item.liveIndex = liveCount;
            live[liveCount++] = item.slot;
        }
        bornCount = 0;
    }

    int InUse() const { return Capacity - freeCount - dyingCount; }

    template <typename Test>
    int CountAlive(Test test) const
    {
        int count = 0;
        for (int i = 0; i < Capacity; ++i)
            if (slots[i].alive && test(slots[i])) ++count;
        return count;
    }

    // The objects in play: walk them with for (int i = 0; i < pool.LiveCount(); ++i) pool.Live(i).
    // The list changes only in Flush().
    int LiveCount() const { return liveCount; }
    T& Live(int index) { return slots[live[index]]; }
    const T& Live(int index) const { return slots[live[index]]; }

    T slots[Capacity]; // every object, made once

private:
    void RemoveFromLive(T& item) // swap with the last one: constant time, and order does not matter
    {
        const int last = live[--liveCount];
        if (last != item.slot)
        {
            live[item.liveIndex] = last;
            slots[last].liveIndex = item.liveIndex;
        }
        item.liveIndex = -1;
    }

    int free[Capacity];      // slots ready to hand out
    int freeCount = Capacity;
    int live[Capacity];      // in play
    int liveCount = 0;
    int born[Capacity];      // acquired since the last Flush()
    int bornCount = 0;
    int dying[Capacity];     // released since the last Flush()
    int dyingCount = 0;
};

// Turns real time, which arrives in uneven frames, into whole fixed steps.
class FixedTimestep
{
public:
    explicit FixedTimestep(double InStep = STEP, int InMaxStepsPerFrame = 5) : step(InStep), maxStepsPerFrame(InMaxStepsPerFrame) {}

    // Runs onStep once per whole step of time banked, and returns how far (0 to 1) the clock is into the
    // next step, for drawing between steps. After a long stall it drops the backlog rather than racing.
    template <typename OnStep>
    double Advance(double seconds, OnStep onStep)
    {
        const double most = step * maxStepsPerFrame;
        accumulator += seconds < most ? seconds : most;
        while (accumulator >= step)
        {
            onStep();
            accumulator -= step;
        }
        return accumulator / step;
    }

    double step;
    int maxStepsPerFrame;
    double accumulator = 0;
};

// One byte of input per step. With the seed, it is the whole game: replaying it gives the same game.
// It is made once, when a game starts, with room for an hour of play, and never grows. A step after that is
// not recorded, only counted in dropped: a game with a dropped step cannot be replayed, and says so.
class InputLog
{
public:
    explicit InputLog(int capacity = STEPS_PER_HOUR);
    ~InputLog();
    InputLog(const InputLog&) = delete;
    InputLog& operator=(const InputLog&) = delete;

    bool Record(uint8_t input); // false, and the step is counted as dropped, once the log is full
    uint8_t At(int step) const { return bytes[step]; }

    int length = 0;
    int dropped = 0; // steps that came after the log was full

private:
    uint8_t* bytes;
    int size;
};

// What happened in a step, for a renderer and the sound. size is set for a rock, kind for a hunter and
// fromShip for a shot; for anything else they keep these defaults.
enum class EventType : uint8_t
{
    shot, hyperspaceOut, hyperspaceIn, hyperspaceFailed, hunterLeft, hunterArrived, hunterDestroyed,
    rockBroken, waveStart, respawn, shipDestroyed, gameOver, extraShip,
};
const char* NameOf(EventType type); // "rockBroken": core.js's event names

struct Event
{
    EventType type = EventType::shot;
    double x = 0, y = 0;
    int points = 0;
    RockSize size = RockSize::None;
    HunterKind kind = HunterKind::Big;
    bool fromShip = false;
    double vx = 0, vy = 0;
};

// What happened in a step, for a renderer and the sound: a fixed array of records, as in core.js, that every
// step fills again from the first. No step makes more than 48: 8 from input and the timers, 2 from each of the
// 16 shots' hits, 3 from the ship ramming, 4 from the hunters hitting rocks and 1 game over. Emit() checks the
// capacity anyway.
struct EventList
{
    static constexpr int capacity = 64;
    Event items[capacity];
    int length = 0; // how many of the records are this step's
};

struct GameOptions
{
    uint32_t seed = 1;
    double width = Rules::field::width;
    double height = Rules::field::height;
    int startingShips = Rules::ship::startingShips;
};

// The whole game. Call Step() 60 times a second of game time.
class Game
{
public:
    explicit Game(const GameOptions& options = GameOptions());

    // ---- the main loop ----------------------------------------------------------------------------
    const EventList& Step(uint8_t input = 0);

    // ---- 1. input ---------------------------------------------------------------------------------
    void HandleInput(uint8_t input);
    void FireShipBullet();

    // ---- 2. update and integrate -------------------------------------------------------------------
    void Update(double dt);
    void UpdateShip(double dt);
    void ArriveFromHyperspace();
    void UpdateHunter(Hunter& hunter, double dt);
    void FireHunterBullet(Hunter& hunter);
    void UpdateWaves(double dt);
    void StartWave();
    Vec2 FarFromShip();
    Rock& SpawnRock(RockSize size, double x, double y, double vx, double vy);
    void UpdateHunterArrivals(double dt);
    void UpdateRespawn(double dt);
    bool CentreIsClear() const;
    void SpawnShip();

    // ---- 3. wrap ----------------------------------------------------------------------------------
    void WrapAll();

    // ---- 4. collide -------------------------------------------------------------------------------
    void Collide();
    Rock* FirstRockTouching(const Entity& entity);
    Hunter* FirstHunterTouching(const Entity& entity);
    void BreakRock(Rock& rock, bool byShip);
    void DestroyHunter(Hunter& hunter, bool byShip);
    void DestroyShip();
    void AddScore(int points);

    // ---- 5. spawn and destroy ----------------------------------------------------------------------
    void Flush();
    void CheckGameOver();

    // ---- 6. events --------------------------------------------------------------------------------
    void Emit(EventType type, const Entity& at, int points = 0);
    void Emit(EventType type, const Rock& rock, int points = 0);
    void Emit(EventType type, const Hunter& hunter, int points = 0);
    void Emit(EventType type, const Bullet& bullet, int points = 0);

    // ---- replay and checks ------------------------------------------------------------------------
    // Everything that makes this game this game, as JSON with the same fields as core.js's snapshot().
    // Writes into buffer and returns the length; numbers are written with 17 significant digits, which
    // reads back as exactly the same double.
    int Snapshot(char* buffer, int size) const;

    uint32_t seed;
    Random rng;
    Field field;
    Ship ship;
    Pool<Bullet, PoolSize::bullets> bullets; // each size is a worst case: see PoolSize
    Pool<Rock, PoolSize::rocks> rocks;
    Pool<Hunter, PoolSize::hunters> hunters;
    Entity centre;
    Entity probe;                   // a point FarFromShip() tries

    int score = 0;
    int ships;                      // ships left, counting the one flying
    int nextExtraShipAt = Rules::extraShipEvery;
    int wave = 0;
    double time = 0;
    int steps = 0;
    bool over = false;
    bool shipLost = false;          // a ship was lost in this step: CheckGameOver() decides what it means
    double waveTimer = 0;           // counts down to the next wave once the field is clear
    double hunterTimer = Rules::hunters::firstAfter;
    double respawnTimer = 0;
    uint8_t lastInput = 0;
    EventList events;               // what happened in the last step, for a renderer and the sound
};

// Plays a recorded game again: same seed, same inputs, same game.
Game Replay(const GameOptions& options, const InputLog& log, int steps);

} // namespace Shatterbelt
