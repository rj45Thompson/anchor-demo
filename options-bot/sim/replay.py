"""Runs the bot, unchanged, through real past sessions: SPY's real minute bars stand in for the live feed, and modeled option
prices stand in for IB's quotes, because past 0DTE option quotes are not in the free data.

    py sim/replay.py [--stop 0.5 --target 1.0]      every session in sim/data, the budget carried day to day; writes
                                                    sim/results/week.json and sim/results/trade_execution_log.csv

What is READ and what is MODELED (each result file says the same):
- READ: SPY's minute bars (open, high, low, close) and VIX's minute closes, Yahoo Finance's public chart data, as fetched.
  The bot sees each minute at its close, once the minute is over; a move inside a minute is not seen.
- MODELED: every option price. Black-Scholes with no interest (under a day, it moves a price by less than a tenth of a cent),
  VIX's latest close as the volatility (0DTE options trade at their own volatility, which the free data does not carry),
  time left to the 16:00 close, and a bid and ask one cent either side. Strikes every dollar, a 0DTE expiry every session.
- IBKR's published commission: $0.65 a contract, $1.00 minimum an order; exchange fees left out.
- The account holds $1,000 (a paper account); the bot trades its own budget, STARTING_BUDGET_USD ($100) to start.
"""
import argparse
import contextlib
import datetime as dt
import io
import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path[:0] = [str(ROOT / "tests"), str(ROOT), str(HERE)]

import fake_ib_async  # noqa: E402

sys.modules["ib_async"] = fake_ib_async

import market_data  # noqa: E402
import zdt_autopilot as bot  # noqa: E402
from fake_ib_async import ET, Day, FakeTWS  # noqa: E402

MODEL_NOTE = ("Option prices are MODELED, not real quotes: Black-Scholes, no interest, VIX's latest minute close as the volatility, "
              "the time left to 16:00, a bid and an ask one cent either side. SPY's prices are its REAL minute bars.")


def black_scholes(spot, strike, years, vol, right):
    if years <= 0 or vol <= 0:
        return max(0.0, spot - strike) if right == "C" else max(0.0, strike - spot)
    d1 = (math.log(spot / strike) + 0.5 * vol * vol * years) / (vol * math.sqrt(years))
    d2 = d1 - vol * math.sqrt(years)
    n = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
    return spot * n(d1) - strike * n(d2) if right == "C" else strike * n(-d2) - spot * n(-d1)


class ReplayTWS(FakeTWS):
    """The in-memory TWS of the tests, driven by one real session: SPY's real minute bars, modeled option prices."""
    PER_CONTRACT = 0.65

    def __init__(self, date, spy_bars, vix_bars, cash=1000.00):
        first = spy_bars[0][1:]
        super().__init__(Day(date=date, start=dt.time(9, 20), session=(dt.time(9, 30), dt.time(16, 0)), cash_usd=cash,
                             orb=(0.0, 0.0), path=[], strikes=tuple(float(s) for s in range(int(first[3]) - 40, int(first[3]) + 41))))
        self.spy_bars, self.vix = spy_bars, sorted((t, c) for t, _, _, _, c in vix_bars)
        self.close = dt.datetime.combine(date, dt.time(16, 0), ET)

    @staticmethod
    def _latest(series, now):
        """the close of the last minute that has ENDED by now: no looking ahead"""
        value = None
        for start, close in series:
            if start + dt.timedelta(minutes=1) <= now:
                value = close
            else:
                break
        return value

    def spy_price(self):
        return self._latest([(b[0], b[4]) for b in self.spy_bars], self.now)

    def vix_now(self):
        return self._latest(self.vix, self.now)

    def quote(self, contract, spy):
        vix = self.vix_now()
        years = max(0.0, (self.close - self.now).total_seconds()) / (365 * 24 * 3600)
        mid = black_scholes(spy, contract.strike, years, (vix or 0) / 100, contract.right)
        return max(0.0, round(mid - 0.01, 2)), max(0.01, round(mid + 0.01, 2))

    def reqHistoricalData(self, contract, endDateTime, durationStr, barSizeSetting, whatToShow, useRTH,
                          formatDate=1, keepUpToDate=False, chartOptions=(), timeout=60):
        """15-minute bars built from the real minute bars that have ended by now, stamped at their start"""
        self._call("reqHistoricalData", durationStr=durationStr, barSizeSetting=barSizeSetting, useRTH=useRTH, formatDate=formatDate)
        bars, groups = [], {}
        for start, o, h, l, c in self.spy_bars:
            if start + dt.timedelta(minutes=1) <= self.now:
                key = start.replace(minute=start.minute - start.minute % 15, second=0)
                groups.setdefault(key, []).append((o, h, l, c))
        for key in sorted(groups):
            g = groups[key]
            date = key.astimezone(fake_ib_async.UTC) if formatDate == 2 else key
            bars.append(fake_ib_async.BarData(date, g[0][0], max(x[1] for x in g), min(x[2] for x in g), g[-1][3]))
        return bars


class StampedOut(io.TextIOBase):
    """stdout that remembers when each line was printed, by the replay's clock, for the replay page"""

    def __init__(self, clock):
        self.clock, self.buf, self.lines = clock, "", []

    def write(self, s):
        self.buf += s
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            versions = [v for v in line.split("\r") if v.strip()]
            if versions:
                self.lines.append((self.clock().strftime("%H:%M:%S"), versions[-1]))
        return len(s)


def run_day(date, spy_bars, vix_bars, log, stop, target):
    tws = ReplayTWS(date, spy_bars, vix_bars)
    bot.ib, bot.now_et = tws, (lambda: tws.now)
    bot.LOG_FILENAME, bot.STOP_LOSS_PCT, bot.TAKE_PROFIT_PCT = str(log), stop, target
    rows_before = len(log.read_text(encoding="utf-8").splitlines()) if log.exists() else 0
    out = StampedOut(lambda: tws.now)
    with contextlib.redirect_stdout(out):
        code = bot.run_live_execution()
    rows = log.read_text(encoding="utf-8").splitlines()[max(rows_before, 1):]
    fills = [{"time": f.execution.time.strftime("%H:%M:%S"), "action": t.order.action, "type": t.order.orderType,
              "qty": f.execution.shares, "price": f.execution.price, "contract": bot.name(t.contract)}
             for t in tws.trades for f in t.fills]
    first15 = [b for b in spy_bars if b[0].time() < dt.time(9, 45)]
    return {"date": str(date), "exit_code": code,
            "minutes": [[b[0].strftime("%H:%M"), b[4]] for b in spy_bars],
            "opening_range": {"high": max(b[2] for b in first15), "low": min(b[3] for b in first15)},
            "console": out.lines, "fills": fills, "rows": [r.split(",") for r in rows]}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--stop", type=float, default=0.5)
    ap.add_argument("--target", type=float, default=1.0)
    ap.add_argument("--reset-daily", action="store_true", help="start every session from STARTING_BUDGET_USD instead of carrying it over")
    a = ap.parse_args()
    spy, spy_skipped, spy_from = market_data.load("SPY")
    vix, vix_skipped, vix_from = market_data.load("VIX")
    results = HERE / "results"
    results.mkdir(exist_ok=True)
    name = "week_reset_daily" if a.reset_daily else "week"
    log = results / f"{name}_log.csv"
    if log.exists():
        log.unlink()                      # one week from STARTING_BUDGET_USD; the budget then carries day to day
    days = []
    for d in sorted(spy):
        if a.reset_daily and log.exists():
            log.unlink()                  # the alternative the owner may want: $100 again every morning
        days.append(run_day(d, spy[d], vix.get(d, []), log, a.stop, a.target))
    week = {"source": {"spy": spy_from, "vix": vix_from, "spy_minutes_skipped": spy_skipped, "vix_minutes_skipped": vix_skipped},
            "model": MODEL_NOTE, "budget": "reset to STARTING_BUDGET_USD every session" if a.reset_daily else "carried from session to session in the log",
            "settings": {"STOP_LOSS_PCT": a.stop, "TAKE_PROFIT_PCT": a.target, "STARTING_BUDGET_USD": bot.STARTING_BUDGET_USD,
                                              "note": "the stop and target are test values, not the owner's and not advice"},
            "days": days}
    (results / f"{name}.json").write_text(json.dumps(week, indent=1), encoding="utf-8")
    for d in days:
        trades = [r for r in d["rows"] if r and r[0] != "Timestamp"]
        print(f"{d['date']}: exit {d['exit_code']}, range {d['opening_range']['low']:.2f}-{d['opening_range']['high']:.2f}, "
              f"{len(trades)} trade(s)" + "".join(f"\n   {','.join(r)}" for r in trades))
    print("log:", log)
    return 0


if __name__ == "__main__":
    sys.exit(main())
