import repro_kit as kit
import zdt_autopilot as bot

day = kit.Day(path=kit.steps(("09:30", 580.00), ("09:50", 581.30), ("10:30", 578.70), ("11:00", 580.00)))
code, tws, trades, out = kit.simulate(day)
assert "[SIGNAL]" not in out, "SPY exactly at a trigger (581.30 or 578.70) gave a signal; the rule is strictly above or below"
