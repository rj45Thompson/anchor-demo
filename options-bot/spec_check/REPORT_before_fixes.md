# Spec check: zdt_autopilot

Line numbers are those of the code before the three fixes. The repros are the same files as now; each one failed on that code.

Spec: `SPEC.md`. Code: `zdt_autopilot.py`. Target: `zdt_autopilot`.

17 rules, 16 suspects: 3 PROVEN, 0 ERROR, 0 TIMEOUT, 0 REFUSED, 13 DROPPED.

Only PROVEN is a fault: its repro's own assertion failed on the shipped code. Everything else is listed so an unproven suspect is never read as a finding.

## PROVEN (3)

### S1: Ties between listed strikes go to the first in list order, not to the one nearer spot +/- 1.50: with 583 unlisted and spot 581.90 it picks 582 (1.40 away) over 584 (0.60 away).

- Rule R5 (A 6), spec line 23: "It picks today's expiry and the listed strike nearest spot +/- 1.50"
- Code: `zdt_autopilot.py:140`
- Observed: picked the 582.0 strike; the listed strike nearest 583.40 is 584
- Reproduce: `python spec_check/run_repro.py S1`
- Repro: `repros/S1.py` (0.35 s)

### S2: Candidates run $5 either side of the target, so when the strikes just above spot are unlisted it can buy an in-the-money call.

- Rule R6 (B), spec line 59: "Finds today's expiring SPY 0DTE option matching ~0.20 Delta / slightly OTM."
- Code: `zdt_autopilot.py:140`
- Observed: picked the 581.0 call with SPY at 581.50, which is in the money
- Reproduce: `python spec_check/run_repro.py S2`
- Repro: `repros/S2.py` (0.37 s)

### S3: Ctrl+C while it waits for IB's commission reports leaves a closed trade out of the CSV.

- Rule R9 (A 11), spec line 29: "It writes one row to `trade_execution_log.csv` in the original's columns, with the net P/L after the commissions IB reports."
- Code: `zdt_autopilot.py:357`
- Observed: the trade closed at its target, then Ctrl+C during the commission wait left 0 rows in the CSV
- Reproduce: `python spec_check/run_repro.py S3`
- Repro: `repros/S3.py` (0.48 s)

## DROPPED (13)

### S10: A missing commission might be filled in from the fee estimate.

- Rule R11 (A 11a), spec line 53: "IB never sends the commission: the row says UNREPORTED rather than an estimate"
- Code: `zdt_autopilot.py:77`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S10`
- Repro: `repros/S10.py` (0.44 s)

### S11: A wait might use time.sleep, which stops ib_async's event loop.

- Rule R12 (C), spec line 92: "For introducing a delay, never use time.sleep() but use :meth:`.sleep` instead."
- Code: `zdt_autopilot.py:219`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S11`
- Repro: `repros/S11.py` (0.4 s)

### S12: ib_async's [None] for an unknown contract is a truthy list and might pass for success.

- Rule R13 (C), spec line 93: "If a contract cannot be qualified (bad values, ambiguous), the return value for the contract position in the result is None."
- Code: `zdt_autopilot.py:108`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S12`
- Repro: `repros/S12.py` (0.4 s)

### S13: UTC bar dates might fail to match the New York 9:30 open.

- Rule R14 (C), spec line 94: "setting to 2 will cause the returned date fields to be timezone-aware datetime.datetime with UTC timezone"
- Code: `zdt_autopilot.py:192`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S13`
- Repro: `repros/S13.py` (0.35 s)

### S14: The breaker might trip one loss late.

- Rule R15 (B), spec line 63: "Max daily consecutive losses ({MAX_CONSECUTIVE_LOSSES}) reached. Stopping live execution for today."
- Code: `zdt_autopilot.py:494`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S14`
- Repro: `repros/S14.py` (0.48 s)

### S15: Delayed prices (data type 3) might be traded on.

- Rule R16 (A 4a), spec line 42: "No live SPY price within 15 seconds, or the data is delayed: it stops and says why."
- Code: `zdt_autopilot.py:202`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S15`
- Repro: `repros/S15.py` (0.43 s)

### S16: After a trade it might take a new signal while SPY is still past the trigger.

- Rule R17 (A 12), spec line 31: "It waits for SPY to come back between the triggers before it takes another signal"
- Code: `zdt_autopilot.py:464`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S16`
- Repro: `repros/S16.py` (0.68 s)

### S4: Port 7496 might be let through without --live.

- Rule R1 (A 1a), spec line 37: "1a. Live port or live account without `--live`: it refuses and exits."
- Code: `zdt_autopilot.py:378`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S4`
- Repro: `repros/S4.py` (0.33 s)

### S5: Port 4002 might be treated as a live port.

- Rule R2 (B), spec line 58: "7497 = TWS Paper, 7496 = TWS Live, 4002 = IB Gateway Paper"
- Code: `zdt_autopilot.py:378`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S5`
- Repro: `repros/S5.py` (0.62 s)

### S6: With no USD row it might size from the BASE-currency row instead of stopping.

- Rule R3 (A 2a), spec line 38: "IB reports no USD `TotalCashBalance`: it stops."
- Code: `zdt_autopilot.py:174`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S6`
- Repro: `repros/S6.py` (0.33 s)

### S7: Started late, it might take a later bar as the opening range.

- Rule R4 (A 3a), spec line 39: "Started after 9:45 ET: it still reads the 9:30 bar."
- Code: `zdt_autopilot.py:192`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S7`
- Repro: `repros/S7.py` (0.53 s)

### S8: A price exactly at a trigger might count as a breakout.

- Rule R7 (B), spec line 62: "CALL Breakout > ${orb_high + ORB_BUFFER:.2f} | PUT Breakdown < ${orb_low - ORB_BUFFER:.2f}"
- Code: `zdt_autopilot.py:472`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S8`
- Repro: `repros/S8.py` (0.67 s)

### S9: Sizing might still return one contract the balance cannot cover.

- Rule R8 (A 7b), spec line 48: "One contract costs more than the balance: no trade today."
- Code: `zdt_autopilot.py:101`
- Observed: every assertion held
- Reproduce: `python spec_check/run_repro.py S9`
- Repro: `repros/S9.py` (0.33 s)
