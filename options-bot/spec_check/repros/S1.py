import repro_kit as kit
import zdt_autopilot as bot

tws = kit.install(kit.Day(start=kit.dt.time(10, 0), unlisted=frozenset({(583.0, "C")})))
opt = bot.get_0dte_contract(kit.spy(tws), "CALL", 581.90)
got = None if opt is None else opt.strike
# Spot + 1.50 = 583.40. 583 is not listed today; 584 is 0.60 from 583.40 and 582 is 1.40 from it.
assert got == 584.0, f"picked the {got} strike; the listed strike nearest 583.40 is 584"
