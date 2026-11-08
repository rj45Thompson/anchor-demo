import repro_kit as kit
import zdt_autopilot as bot

code, tws, trades, out = kit.simulate(kit.replace(kit.CALL_TO_TARGET, cash_usd=None))
assert code == 1 and "no USD TotalCashBalance" in out, f"no USD TotalCashBalance gave exit {code}"
assert tws.called("placeOrder") == [], "it placed an order without a USD balance"
