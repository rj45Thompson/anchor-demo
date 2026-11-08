# Spec check: replay

Spec: `..\README.md`. Code: `..\..`. Target: `replay`.

6 rules, 6 suspects: 0 PROVEN, 0 ERROR, 0 TIMEOUT, 0 REFUSED, 6 DROPPED.

Only PROVEN is a fault: its repro's own assertion failed on the shipped code. Everything else is listed so an unproven suspect is never read as a finding.

## DROPPED (6)

### S1: Bars outside 09:30-15:59, or with an empty price, might reach the bot.

- Rule R1 (1), spec line 12: "only regular hours, and skips any minute with an empty price"
- Code: `sim/market_data.py:44`
- Observed: every assertion held
- Reproduce: `python sim/spec_check/run_repro.py S1`
- Repro: `repros/S1.py` (0.49 s)

### S2: The price at 10:00:30 might already be the 10:00 minute's close, a price from the future.

- Rule R2 (2), spec line 13: "The bot sees each minute's close only once that minute has ended"
- Code: `sim/replay.py:66`
- Observed: every assertion held
- Reproduce: `python sim/spec_check/run_repro.py S2`
- Repro: `repros/S2.py` (0.44 s)

### S3: The 09:30 bar the bot reads might not be the real first 15 minutes' high and low.

- Rule R3 (3), spec line 14: "The opening range is built from the real minute bars of the session's first 15 minutes."
- Code: `sim/replay.py:91`
- Observed: every assertion held
- Reproduce: `python sim/spec_check/run_repro.py S3`
- Repro: `repros/S3.py` (0.54 s)

### S4: A results file might not say its option prices are modeled.

- Rule R4 (4), spec line 15: "every result file and page says they are modeled"
- Code: `sim/replay.py:37`
- Observed: every assertion held
- Reproduce: `python sim/spec_check/run_repro.py S4`
- Repro: `repros/S4.py` (0.49 s)

### S5: The replay might change one of the bot's functions, not only stand in for TWS.

- Rule R5 (5), spec line 16: "The bot's own code runs unchanged; the replay only stands in for TWS."
- Code: `sim/replay.py:118`
- Observed: every assertion held
- Reproduce: `python sim/spec_check/run_repro.py S5`
- Repro: `repros/S5.py` (0.49 s)

### S6: Each session might start from $100 again instead of the last session's ending balance.

- Rule R6 (6), spec line 17: "The budget starts at STARTING_BUDGET_USD and carries from session to session in the log"
- Code: `sim/replay.py:153`
- Observed: every assertion held
- Reproduce: `python sim/spec_check/run_repro.py S6`
- Repro: `repros/S6.py` (0.45 s)
