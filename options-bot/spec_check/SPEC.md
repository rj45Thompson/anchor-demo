# Spec for zdt_autopilot.py

Three sources, each copied word for word. The light loop (spec_check.py) checks every rule's quote against this file.

## A. The use case (README.md, 2026-11-08)

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

## B. The original script's own words (the file as it arrived, 2026-11-08)

- `PORT = 7497             # 7497 = TWS Paper, 7496 = TWS Live, 4002 = IB Gateway Paper`
- `Finds today's expiring SPY 0DTE option matching ~0.20 Delta / slightly OTM.`
- `# Target strike slightly OTM (approx ~0.20 Delta target offset)`
- `# Find closest available strike`
- `print(f"[ORB TRIGGERS] CALL Breakout > ${orb_high + ORB_BUFFER:.2f} | PUT Breakdown < ${orb_low - ORB_BUFFER:.2f}\n")`
- `print(f"\n[CIRCUIT BREAKER] Max daily consecutive losses ({MAX_CONSECUTIVE_LOSSES}) reached. Stopping live execution for today.")`

The original's sizing function, as it arrived:

```python
def get_safe_tier_contracts(balance, opt_price):
    if balance < 110:
        cts = 1
    elif balance < 250:
        cts = 2
    elif balance < 500:
        cts = 3
    elif balance < 1000:
        cts = 4
    elif balance < 2500:
        cts = 6
    elif balance < 5000:
        cts = 8
    else:
        cts = MAX_ACTIVE_CONTRACTS

    cost = (opt_price * 100.0) + (IBKR_FEE_PER_LEG * 2)
    while cts > 1 and (cts * cost) > balance:
        cts -= 1
    return max(1, cts)
```

## C. ib_async 2.1.0, the library's own docstrings (ib_async/ib.py)

- For introducing a delay, never use time.sleep() but use :meth:`.sleep` instead.
- Note: return value has elements in same position as input request. If a contract cannot be qualified (bad values, ambiguous), the return value for the contract position in the result is None.
- formatDate: For an intraday request setting to 2 will cause the returned date fields to be timezone-aware datetime.datetime with UTC timezone, instead of local timezone as used by TWS.
- Returns the Ticker that holds the market data. The ticker will initially be empty and gradually (after a couple of seconds) be filled.
