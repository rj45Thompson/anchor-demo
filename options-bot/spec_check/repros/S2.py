import repro_kit as kit
import zdt_autopilot as bot

tws = kit.install(kit.Day(start=kit.dt.time(10, 0), unlisted=frozenset({(582.0, "C"), (583.0, "C"), (584.0, "C")})))
opt = bot.get_0dte_contract(kit.spy(tws), "CALL", 581.50)
got = None if opt is None else opt.strike
# "slightly OTM": a call above SPY's 581.50. No strike, and so no trade, also keeps the rule.
assert got is None or got > 581.50, f"picked the {got} call with SPY at 581.50, which is in the money"
