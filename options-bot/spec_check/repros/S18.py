import repro_kit as kit
import zdt_autopilot as bot

import csv, pathlib, tempfile
log = pathlib.Path(tempfile.mkdtemp()) / "trade_execution_log.csv"
with log.open("w", newline="") as f:
    csv.writer(f).writerows([["Timestamp", "PlayDirection", "Contracts", "EntryPrice", "ExitPrice", "NetPL", "EndingBalance"],
                             ["2026-11-06 10:10:01", "SPY CALL", "1", "0.61", "1.22", "59.00", "159.00"]])
bot.LOG_FILENAME = str(log)
budget, source = bot.read_budget()
assert budget == 159.00, f"the budget read {budget} from {source}; the log's last row ended at $159.00"
