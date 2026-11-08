"""
One simulated trading day, printed the way the terminal shows it: the bot's own console output, run against
the in-memory TWS in fake_ib_async.py (made-up prices, no TWS, no account).

    py tests/demo_day.py                     the bot as shipped: SIGNALS ONLY, no orders
    py tests/demo_day.py --exits 0.5 1.0     with a stop and a target set (test values, not settings advice)
"""
import argparse
import contextlib
import datetime as dt
import io
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import fake_ib_async  # noqa: E402

sys.modules["ib_async"] = fake_ib_async

import zdt_autopilot as bot  # noqa: E402
from fake_ib_async import Day, FakeTWS  # noqa: E402


def terminal_view(raw):
    """What a terminal shows: a line rewritten in place with \\r keeps only its last version."""
    lines = []
    for line in raw.split("\n"):
        versions = [v for v in line.split("\r") if v]
        lines.append(versions[-1] if versions else "")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--exits", nargs=2, type=float, metavar=("STOP", "TARGET"))
    a = ap.parse_args()
    path = [(dt.time.fromisoformat(t), p) for t, p in
            (("09:30", 580.00), ("09:50", 581.50), ("10:10", 584.00))]
    tws = FakeTWS(Day(path=path))
    bot.ib, bot.now_et = tws, (lambda: tws.now)
    bot.LOG_FILENAME = str(pathlib.Path(tempfile.mkdtemp()) / "trade_execution_log.csv")
    if a.exits:
        bot.STOP_LOSS_PCT, bot.TAKE_PROFIT_PCT = a.exits
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = bot.run_live_execution()
    print(terminal_view(out.getvalue()).rstrip())
    print(f"\n(exit code {code}; trade_execution_log.csv:)")
    print(pathlib.Path(bot.LOG_FILENAME).read_text(encoding="utf-8").rstrip())
    return code


if __name__ == "__main__":
    sys.exit(main())
