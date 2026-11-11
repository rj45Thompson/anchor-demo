// Plays a recorded game through the C++ core and writes the whole game out as it goes, for tools/parity.js.
//
//   replay <game file> [--every K] [--steps N]
//
// A game file is one line of text, then the input log, one byte per step:
//   shatterbelt-game seed=77 width=1000 height=625 startingShips=3 steps=6000\n<6000 bytes>
// It writes one JSON line once the game is made (step 0), then one every K steps (default 1):
//   {"snapshot":<Game::Snapshot(), the fields of core.js's snapshot()>,"events":[<event names since the last line>]}
#define _CRT_SECURE_NO_WARNINGS // fopen and sscanf are standard C; MSVC's fopen_s and sscanf_s are not portable

#include "shatterbelt_core.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

using namespace Shatterbelt;

namespace
{
int Usage()
{
    std::fprintf(stderr, "usage: replay <game file> [--every K] [--steps N]\n");
    return 2;
}

// The event names since the last line, kept between lines without allocating: one step's names at a time
// are written into a fixed buffer.
struct EventNames
{
    char text[1 << 16];
    int used = 0;

    void Add(const EventList& events)
    {
        for (int i = 0; i < events.count; ++i)
        {
            const int wrote = std::snprintf(text + used, sizeof(text) - used, "%s\"%s\"", used ? "," : "", NameOf(events.items[i].type));
            Check(wrote > 0 && wrote < static_cast<int>(sizeof(text)) - used, "event names buffer too small");
            used += wrote;
        }
    }
};
} // namespace

int main(int argc, char** argv)
{
    if (argc < 2) return Usage();
    int every = 1;
    int stepsWanted = -1;
    for (int i = 2; i < argc; ++i)
    {
        if (i + 1 < argc && std::strcmp(argv[i], "--every") == 0) every = std::atoi(argv[++i]);
        else if (i + 1 < argc && std::strcmp(argv[i], "--steps") == 0) stepsWanted = std::atoi(argv[++i]);
        else return Usage();
    }
    if (every < 1) return Usage();

    FILE* file = std::fopen(argv[1], "rb");
    if (!file)
    {
        std::fprintf(stderr, "replay: cannot open %s\n", argv[1]);
        return 1;
    }
    char header[256];
    if (!std::fgets(header, sizeof(header), file))
    {
        std::fprintf(stderr, "replay: %s is empty\n", argv[1]);
        return 1;
    }
    GameOptions options;
    int stepsInFile = 0;
    if (std::sscanf(header, "shatterbelt-game seed=%u width=%lf height=%lf startingShips=%d steps=%d",
                    &options.seed, &options.width, &options.height, &options.startingShips, &stepsInFile) != 5)
    {
        std::fprintf(stderr, "replay: %s does not start with a shatterbelt-game line\n", argv[1]);
        return 1;
    }
    InputLog log;
    for (int byte = std::fgetc(file); byte != EOF; byte = std::fgetc(file)) log.Record(static_cast<uint8_t>(byte));
    std::fclose(file);
    if (log.length != stepsInFile)
    {
        std::fprintf(stderr, "replay: the header says %d steps, the file holds %d\n", stepsInFile, log.length);
        return 1;
    }
    const int steps = stepsWanted < 0 ? stepsInFile : stepsWanted;
    if (steps > stepsInFile) return Usage();

    static Game game(options); // static rather than on the stack: the Game and the two buffers are about 140 KB
    static char snapshot[1 << 16];
    static EventNames names;
    for (int step = 0; step <= steps; ++step)
    {
        if (step > 0) names.Add(game.Step(log.At(step - 1)));
        if (step % every != 0 && step != steps) continue;
        game.Snapshot(snapshot, static_cast<int>(sizeof(snapshot)));
        std::printf("{\"snapshot\":%s,\"events\":[%.*s]}\n", snapshot, names.used, names.text);
        names.used = 0;
    }
    return 0;
}
