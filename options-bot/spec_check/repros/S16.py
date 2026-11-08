import repro_kit as kit
import zdt_autopilot as bot

code, tws, trades, out = kit.simulate(kit.CALL_TO_TARGET)
kit.need(len(trades) >= 1, "the first trade happened")
# After the target SPY stays above the CALL trigger all day: no second signal without a return between the triggers.
assert out.count("[SIGNAL]") == 1, f"{out.count('[SIGNAL]')} signals while SPY never came back between the triggers"
