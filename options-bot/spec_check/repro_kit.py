"""Set-up shared by the repros: the in-memory TWS from tests/fake_ib_async.py stands in for ib_async, so a
repro runs the shipped zdt_autopilot.py with no TWS, network or account. A set-up that did not happen
raises RuntimeError (the light loop's ERROR), never an assertion, so it can never pass for a proven fault."""
import contextlib
import csv
import datetime as dt
import io
import pathlib
import sys
import tempfile
from dataclasses import replace  # noqa: F401  (repros use it)

import fake_ib_async

sys.modules["ib_async"] = fake_ib_async

import zdt_autopilot as bot  # noqa: E402
from fake_ib_async import Day, FakeTWS, Stock  # noqa: E402


def steps(*points):
    return [(dt.time.fromisoformat(t), p) for t, p in points]


# Opening range 579.00-581.00: CALL above 581.30, PUT below 578.70.
CALL_TO_TARGET = Day(path=steps(("09:30", 580.00), ("09:50", 581.50), ("10:10", 584.00)))


def install(day):
    tws = FakeTWS(day)
    bot.ib, bot.now_et = tws, (lambda: tws.now)
    return tws


def spy(tws):
    contract = Stock("SPY", "SMART", "USD")
    tws.qualifyContracts(contract)
    return contract


def simulate(day, stop=0.5, target=1.0, live=False, port=7497, budget=1000.0):
    """Runs the bot through the whole day. Returns (exit code, fake TWS, CSV trade rows, console output). budget: the
    STARTING_BUDGET_USD the scenario's sums are written for (the fake account's $1,000); None keeps the bot's own."""
    tws = install(day)
    log = pathlib.Path(tempfile.mkdtemp()) / "trade_execution_log.csv"
    bot.LOG_FILENAME, bot.STOP_LOSS_PCT, bot.TAKE_PROFIT_PCT, bot.PORT = str(log), stop, target, port
    if budget is not None:
        bot.STARTING_BUDGET_USD = budget
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = bot.run_live_execution(live=live)
    rows = list(csv.reader(log.open(newline=""))) if log.exists() else []
    return code, tws, rows[1:], out.getvalue()


def need(condition, what):
    if not condition:
        raise RuntimeError(f"set-up did not happen: {what}")
