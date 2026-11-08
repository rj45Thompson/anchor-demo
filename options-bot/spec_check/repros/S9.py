import repro_kit as kit
import zdt_autopilot as bot

assert bot.get_safe_tier_contracts(100.00, 1.20) == 0, "one contract at 1.20 costs $121.30, more than $100.00, and was still sized"
