import repro_kit as kit
import zdt_autopilot as bot

code, tws, trades, out = kit.simulate(kit.CALL_TO_TARGET, port=4002)
assert "[REFUSED]" not in out and "PAPER DU1234567" in out, "port 4002 (IB Gateway Paper) on a paper account was refused"
