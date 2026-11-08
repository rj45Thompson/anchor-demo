import repro_kit as kit
import zdt_autopilot as bot

day = kit.Day(start=kit.dt.time(11, 0), path=kit.steps(("09:30", 580.00), ("10:00", 585.00), ("10:50", 580.00)))
code, tws, trades, out = kit.simulate(day)
assert "[ORB ESTABLISHED] 15-Min High: $581.00 | 15-Min Low: $579.00" in out, "started at 11:00, it did not use the 9:30 bar"
