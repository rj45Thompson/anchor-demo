import repro_kit as kit
import zdt_autopilot as bot

code, tws, trades, out = kit.simulate(kit.replace(kit.CALL_TO_TARGET, market_data=3))
assert code == 1 and "(data type 3)" in out and tws.called("placeOrder") == [], "delayed data (type 3) did not stop the bot"
