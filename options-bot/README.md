# ZDT autopilot: SPY 0DTE opening-range breakout on Interactive Brokers

A trading script, finished and tested. The original arrived cut off mid-line at the PUT trigger check
(`elif last_price < orb_lo`); every change from it is listed below, and every value in `zdt_autopilot.py`
that is not from the original says so beside it.

## Run it on a paper account first

1. Start TWS (or IB Gateway) logged in to the PAPER account. In TWS: Global Configuration, API, Settings:
   tick "Enable ActiveX and Socket Clients", port 7497.
2. The account needs live market data for SPY and for US options (OPRA). Without it the bot stops at
   startup and says so.
3. `pip install -r requirements.txt`
4. `py zdt_autopilot.py`

The bot refuses a live port (7496, 4001) or a live account (IBKR paper account IDs start with "D") unless you
add `--live`.

**It sends no orders until the two exit rules are set** (`STOP_LOSS_PCT`, `TAKE_PROFIT_PCT` near the top of
the file). The original stops before its exit rules, so they are not known. Until they are set it runs
SIGNALS ONLY: it does everything else (opening range, signals, the contract it would buy, how many) and
prints the order it would send.

## The use case it follows

**Actor:** the trader, running the script on their own PC beside TWS or IB Gateway.
**Goal:** on a trading day, buy a SPY 0DTE option when SPY breaks out of its first 15-minute range, sized to
the balance, let IB hold the exits, write every trade to the CSV, and never leave an order or a position
behind.
**Preconditions:** TWS or IB Gateway is running with the API on `PORT`; the account has live SPY and OPRA data.

Main path, each step with what you see:

1. You start the script. It connects and prints PAPER or LIVE with the account ID.
2. It reads the account's USD `TotalCashBalance` (the original's field). It prints `[ACCOUNT]`.
3. It reads today's session hours from IB, waits for the first 15-minute bar to close, and reads that
   bar. It prints `[ORB ESTABLISHED]` and the two triggers (high + `ORB_BUFFER`, low - `ORB_BUFFER`).
4. It streams SPY's last price and prints a status line every second.
5. SPY trades above the CALL trigger or below the PUT trigger. It prints `[SIGNAL]`.
6. It picks today's expiry and the listed strike nearest spot +/- 1.50 rounded to the dollar (the original's rule),
   always out of the money, a tie going to the one nearer spot +/- 1.50. It prints `[CONTRACT]`.
7. It reads that option's ask and sizes the order with the original's tier table. It prints `[ORDER]`.
8. It buys with a limit at the ask and waits for the fill. It prints `[FILLED]`.
9. It places the stop and the target at IB as one OCA pair, so they stay working even if the PC or the
   script dies. It prints `[EXITS AT IB]`.
10. One exit fills, or the flatten time arrives (10 minutes before the close) and it sells at market. It prints `[TRADE CLOSED]`.
11. It writes one row to `trade_execution_log.csv` in the original's columns, with the net P/L after the
    commissions IB reports.
12. It waits for SPY to come back between the triggers before it takes another signal, and stops for
    the day after `MAX_CONSECUTIVE_LOSSES` losses in a row. It prints `[REARMED]` or `[CIRCUIT BREAKER]`.
13. At the flatten time, or on Ctrl+C, it cancels its own orders, sells what it bought, and disconnects.

Alternate paths:

- 1a. Live port or live account without `--live`: it refuses and exits.
- 2a. IB reports no USD `TotalCashBalance`: it stops. The original carried on with $100 instead.
- 3a. Started after 9:45 ET: it still reads the 9:30 bar. The original read the latest 30 minutes, so
  after about 10:15 its "opening range" was a later bar, and before 9:45 it was a bar still forming.
- 3b. IB lists today as CLOSED: it does nothing. A half day closes early, and the flatten time moves with it.
- 4a. No live SPY price within 15 seconds, or the data is delayed: it stops and says why.
- 6a. Today's expiry is not listed: no trade today. The original switched to the next expiry, which is
  not a 0DTE trade.
- 6b. No out-of-the-money strike within $5 of the target is listed: no trade today. The original crashed here (`min()` of
  an empty list), and it never checked that IB knew the contract it picked.
- 7a. The option has no live bid and ask: this signal is skipped.
- 7b. One contract costs more than the balance: no trade today. The original bought one anyway.
- 8a. Not filled within 10 seconds: the rest is cancelled and only what filled is traded.
- 9a. Exit rules not set: SIGNALS ONLY, no orders at all.
- 10a. The connection drops while holding: the stop and target keep working at IB; the script says what
  is still open.
- 11a. IB never sends the commission: the row says UNREPORTED rather than an estimate, and the bot stops
  for the day because the balance is no longer known.

## What is from the original and what is new

Kept as the original wrote it: the configuration, the CSV columns, the tier table, the strike rule (spot +/- 1.50,
nearest within $5), the ORB buffer and triggers, the consecutive-loss breaker, the prints.

Changed, each one a defect in the original as it arrived:

- `get_safe_tier_contracts` returned `max(1, cts)`, so it bought one contract it could not afford. It now
  returns 0 and the bot does not trade (7b).
- The opening range was `bars[0]` of the last 30 minutes, which is the opening bar only between about 9:45
  and 10:15 (3a).
- When the balance could not be read it used `STARTING_BUDGET_USD` ($100) as if it were real (2a).
- When today's expiry was missing it traded the next one (6a).
- An empty strike list crashed it, and neither `qualifyContracts` call was checked. ib_async reports a
  failure as `None` inside a non-empty list, so the result has to be read, not just called (6b).
- The date came from the PC's clock in its own time zone; it now comes from New York time.

New, because the file ends before them: steps 7 to 13, the live guard (1a), the session hours (3b), the
re-arm rule (12), and the cleanup (13). Every value that is not from the original is marked in the file.

## Open questions for the owner

1. The original ends at the PUT check. Is there more of it? If not:
2. What stop and target do you want (`STOP_LOSS_PCT`, `TAKE_PROFIT_PCT`)?
3. What does `TIME_STOP_PCT = 0.25` do? The original sets it but uses it after the point where it ends, so
   the bot does not use it yet.
4. After a trade, should it trade again the same day? It now waits for SPY to come back inside the range
   first, then takes the next breakout, until two losses in a row.
5. `STARTING_BUDGET_USD` was only the stand-in balance. Should the bot size from the whole account, or never
   from more than a budget set for it? A paper account usually holds far more than $100, so on paper it sizes
   up to `MAX_ACTIVE_CONTRACTS`.
6. The original's docstring aims at about 0.20 delta, but its strike rule is a fixed $1.50 from spot, which
   is a different delta at 9:45 than at 15:00. Keep the fixed offset, or pick by the delta IB reports?

## The light loop

`spec_check/` holds a check of the code against a written spec, `spec_check/SPEC.md`: the use case above,
the original script's own comments, and ib_async's documentation, each copied word for word. Every rule in
`rules.json` quotes it, every suspect in `suspects.json` names a rule and a code line, and a fault counts only
when that suspect's repro (`repros/`) fails its own assertion on the code.

The first run proved 3 faults (`REPORT_before_fixes.md`): a tie between two listed strikes went to the one
farther from spot +/- 1.50; with the strikes just above spot unlisted it could buy an in-the-money call,
against the original's "slightly OTM"; and Ctrl+C while waiting for IB's commission report left a closed
trade out of the CSV. All three are fixed and each has a test. The second run proved none (`REPORT.md`).

Run any repro on its own: `python spec_check/run_repro.py S1`.

## Epics and use cases

`model/` is the bot written as two epics: trading one day (seven use cases) and getting it ready for real money (four).
Each use case gives its actor, trigger, success and minimal guarantee, its steps, and every alternate path with
where it leads. Requirements (`model/requirements.yaml`) never name code: each is carried by steps, and only the
steps name code. `model/step_tests.yaml` names the tests that run each step and path; `py tests/step_trace.py`
runs them under a tracer and writes the code each one ran (`model/step_trace.json`), and `tests/test_model.py`
fails any step whose named code its tests never ran. `py make_epics_page.py OUT` writes the page that shows it all.
The model also passes the closed-loop kit's use case checker (`usecase_model.py`, rules U1 to U19) with no holes;
set `USECASE_MODEL` to that file and `tests/test_model.py` runs it too.

## Tests

`pip install -r requirements-dev.txt`, then `py -m pytest tests` (80 tests) runs the bot through whole simulated
trading days against an in-memory TWS (`tests/fake_ib_async.py`), with tests for every step and alternate path of
the trading epic. No TWS, network or account is involved. `tests/test_api_contract.py` reads the real ib_async
source and checks that every `ib.` call, keyword and field the bot uses exists there. It runs when ib_async is
installed, or when `IB_ASYNC_SRC` points at its source, and is skipped otherwise.

`py tests/plant_check.py` plants 28 defects, one at a time, in copies of the bot and of the model (the original's
five among them), and each must make a test fail. A check that has only ever passed cannot be told from one
that is switched off.

What the tests cannot show: how IB itself fills, prices and reports on a given day. The first paper run
is that check.

`py tests/demo_day.py` prints one simulated day the way the terminal shows it (`tests/demo_day_signals_only.txt`);
`py tests/demo_day.py --exits 0.5 1.0` does the same with a stop and a target set, test values only
(`tests/demo_day_with_exits.txt`).

---

Software, not financial advice. Options can lose their whole premium, and 0DTE options expire the same day.
Run it on a paper account first.
