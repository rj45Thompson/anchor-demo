import repro_kit as kit
import zdt_autopilot as bot

day = kit.Day(path=kit.steps(("09:30", 580.00), ("09:50", 578.60), ("10:00", 579.50), ("10:30", 581.50), ("10:40", 580.00)))
code, tws, trades, out = kit.simulate(day)
kit.need(len(trades) == 2, "two trades happened")
assert "Max daily consecutive losses (2) reached" in out and tws.now.time() < kit.dt.time(11, 0), "two losses in a row did not stop the day"
