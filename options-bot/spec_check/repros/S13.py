import repro_kit as kit
import zdt_autopilot as bot

import datetime as dt
tws = kit.install(kit.Day(start=kit.dt.time(10, 0)))
session_open = dt.datetime(2026, 11, 9, 9, 30, tzinfo=kit.bot.ET)
orb = bot.read_opening_range(kit.spy(tws), session_open)
[(when, method, kwargs)] = tws.called("reqHistoricalData")
kit.need(kwargs["formatDate"] == 2, "the bot asks for formatDate=2")
assert orb == (581.00, 579.00), f"with UTC bar dates the 9:30 ET bar was not matched: {orb}"
