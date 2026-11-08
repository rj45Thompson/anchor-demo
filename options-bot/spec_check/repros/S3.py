import repro_kit as kit
import zdt_autopilot as bot

day = kit.replace(kit.CALL_TO_TARGET, commission_delay_s=5.0, interrupt_at=kit.dt.time(10, 10, 2))
code, tws, trades, out = kit.simulate(day)
kit.need("[STOPPED] Ctrl+C." in out, "the Ctrl+C reached the bot")
kit.need(any(t.order.orderType == "LMT" and t.order.action == "SELL" and t.filled() == 6 for t in tws.trades),
         "the 1.22 target filled before the Ctrl+C")
assert len(trades) == 1, f"the trade closed at its target, then Ctrl+C during the commission wait left {len(trades)} rows in the CSV"
