import datetime as dt
import replay
from fake_ib_async import ET

import market_data
spy, _, _ = market_data.load("SPY")
day = sorted(spy)[-1]
tws = replay.ReplayTWS(day, spy[day], [])
tws.now = dt.datetime.combine(day, dt.time(9, 45, 5), ET)
first = tws.reqHistoricalData(None, "", "2 D", "15 mins", "TRADES", True, formatDate=2)[0]
real = [b for b in spy[day] if b[0].time() < dt.time(9, 45)]
assert (first.high, first.low) == (max(b[2] for b in real), min(b[3] for b in real)), f"the 09:30 bar reads {first.high}/{first.low}"
