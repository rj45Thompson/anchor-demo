import repro_kit as kit
import zdt_autopilot as bot

code, tws, trades, out = kit.simulate(kit.CALL_TO_TARGET, port=7496)
assert code == 1 and "[REFUSED]" in out, f"port 7496 (TWS Live) without --live gave exit {code}"
assert tws.called("connect") == [], "it connected to the live port"
