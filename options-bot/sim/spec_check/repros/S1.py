import datetime as dt
import replay
from fake_ib_async import ET

import market_data
days, skipped, prov = market_data.load("SPY")
bars = [b for d in days.values() for b in d]
assert all(dt.time(9, 30) <= b[0].time() <= dt.time(15, 59) for b in bars), "a bar outside regular hours"
assert all(None not in b[1:] for b in bars), "a bar with an empty price"
assert prov["url"].startswith("https://query1.finance.yahoo.com/"), f"no address recorded: {prov}"
