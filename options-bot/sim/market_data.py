"""Real SPY and VIX minute bars from Yahoo Finance's public chart data, kept as fetched with where and when they came from.

    py sim/market_data.py            fetch the last five sessions into sim/data/ (one file per symbol, with its URL and time)

Only regular-hours bars (09:30 to 15:59 New York) with all four prices are used; a minute Yahoo left empty is skipped and
counted, never filled in.
"""
import datetime as dt
import json
import pathlib
import sys
import urllib.request
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DATA = pathlib.Path(__file__).resolve().parent / "data"
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=5d&includePrePost=false"
SYMBOLS = {"SPY": "SPY", "VIX": "%5EVIX"}


def fetch():
    DATA.mkdir(parents=True, exist_ok=True)
    for name, sym in SYMBOLS.items():
        url = URL.format(sym=sym)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = json.loads(r.read().decode("utf-8"))
        raw["_provenance"] = {"url": url, "fetched_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
        (DATA / f"{name}.json").write_text(json.dumps(raw), encoding="utf-8")
        print(f"{name}: {len(raw['chart']['result'][0]['timestamp'])} bars from {url}")


def load(name):
    """{date: [(minute start in New York time, open, high, low, close)]} for regular hours, and what was skipped."""
    raw = json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))
    res = raw["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    days, skipped = {}, 0
    for i, t in enumerate(res["timestamp"]):
        when = dt.datetime.fromtimestamp(t, ET)
        if not dt.time(9, 30) <= when.time() <= dt.time(15, 59):
            continue
        bar = tuple(q[k][i] for k in ("open", "high", "low", "close"))
        if any(v is None for v in bar):
            skipped += 1
            continue
        days.setdefault(when.date(), []).append((when, *bar))
    return days, skipped, raw["_provenance"]


if __name__ == "__main__":
    fetch()
    for name in SYMBOLS:
        days, skipped, prov = load(name)
        print(name, {str(d): len(b) for d, b in sorted(days.items())}, "skipped", skipped, prov["fetched_utc"])
    sys.exit(0)
