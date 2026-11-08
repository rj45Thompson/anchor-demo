import repro_kit as kit
import zdt_autopilot as bot

tws = kit.install(kit.Day())
result = tws.qualifyContracts(kit.fake_ib_async.Option("SPY", "20261109", 999.0, "C", "SMART"))
kit.need(result == [None], "the fake answers like ib_async 2.1.0: [None] for an unknown contract")
assert bot.qualify(kit.fake_ib_async.Option("SPY", "20261109", 999.0, "C", "SMART")) is False, "an unknown contract counted as qualified"
