import datetime as dt
import replay
from fake_ib_async import ET

import market_data
spy, _, _ = market_data.load("SPY")
day = sorted(spy)[-1]
tws = replay.ReplayTWS(day, spy[day], [])
bars = {b[0].time(): b[4] for b in spy[day]}
tws.now = dt.datetime.combine(day, dt.time(10, 0, 30), ET)
assert tws.spy_price() == bars[dt.time(9, 59)], f"at 10:00:30 the price is {tws.spy_price()}, not the 09:59 close {bars[dt.time(9, 59)]}"
