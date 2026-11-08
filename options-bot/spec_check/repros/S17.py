import repro_kit as kit
import zdt_autopilot as bot

code, tws, trades, out = kit.simulate(kit.CALL_TO_TARGET, budget=None)
kit.need(bot.STARTING_BUDGET_USD == 100.0 and "[ACCOUNT] Current Available Funds: $1,000.00 USD" in out, "a $100 budget and a $1,000 account")
assert [t[2] for t in trades] == ["1"], f"bought {[t[2] for t in trades]} contracts; a $100 budget buys one at $62.30"
