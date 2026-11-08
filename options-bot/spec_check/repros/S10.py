import repro_kit as kit
import zdt_autopilot as bot

code, tws, trades, out = kit.simulate(kit.replace(kit.CALL_TO_TARGET, commission_delay_s=None))
kit.need(len(trades) == 1, "the trade happened")
assert trades[0][5:] == ["UNREPORTED", "UNREPORTED"], f"with no commission report the row says {trades[0][5:]}"
