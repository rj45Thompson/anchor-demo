"""
ZDT & SQUEEZE live trading autopilot for Interactive Brokers: SPY 0DTE options on the 15-minute
opening-range breakout (ORB).

The original script, finished. The original stops mid-line at the PUT trigger check; everything from
there on is new, and each value that is not from the original says so beside it. "(step N)" in a comment
points at the use case in README.md.

Paper account first:   py zdt_autopilot.py
A live account needs:  py zdt_autopilot.py --live
"""
import argparse
import csv
import datetime
import os
import sys
from zoneinfo import ZoneInfo

from ib_async import IB, LimitOrder, MarketOrder, Option, Stock, StopOrder

# --- USER CONFIGURATION ---
PORT = 7497             # 7497 = TWS Paper, 7496 = TWS Live, 4002 = IB Gateway Paper
CLIENT_ID = 1           # Unique client ID for this session
SYMBOL = "SPY"
EXCHANGE = "SMART"
CURRENCY = "USD"

STARTING_BUDGET_USD = 100.00   # the original used it only as a stand-in balance; the bot now stops instead
IBKR_FEE_PER_LEG = 0.65        # sizing estimate only: the P/L uses the commissions IB reports
TIME_STOP_PCT = 0.25           # the original uses this after the point where it stops, so it is not wired in
ORB_BUFFER = 0.30
MAX_ACTIVE_CONTRACTS = 10
MAX_CONSECUTIVE_LOSSES = 2
LOG_FILENAME = "trade_execution_log.csv"

# --- EXIT RULES: the original stops before its exits, so these start unset ---
# Until both are set the bot runs SIGNALS ONLY: it shows each trade it would make and sends no order.
STOP_LOSS_PCT = None           # fraction of the entry fill: 0.4 sells 40% below it
TAKE_PROFIT_PCT = None         # fraction of the entry fill: 1.0 sells at double it

# --- SAFETY: not from the original, change freely ---
LIVE_PORTS = (7496, 4001)                               # TWS live, IB Gateway live
FLATTEN_BEFORE_CLOSE = datetime.timedelta(minutes=10)   # sell what is open this long before the close
ENTRY_FILL_TIMEOUT_S = 10      # cancel an entry still unfilled after this
QUOTE_TIMEOUT_S = 5            # skip a signal whose option has no live bid and ask by then
PRICE_TIMEOUT_S = 15           # stop when SPY has had no live tick this long
REPORT_TIMEOUT_S = 10          # how long to wait for IB's commission reports

ET = ZoneInfo("America/New_York")
ORDER_REF = "zdt-autopilot"    # marks this bot's orders in TWS; it only ever cancels or sells its own
BOT_TRADES = []                # every order this run placed: what it holds is always read from IB's fills

ib = IB()


def now_et():
    return datetime.datetime.now(ET)


def initialize_csv_log():
    file_exists = os.path.isfile(LOG_FILENAME)
    if not file_exists or os.stat(LOG_FILENAME).st_size == 0:
        with open(LOG_FILENAME, mode='w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(["Timestamp", "PlayDirection", "Contracts", "EntryPrice", "ExitPrice", "NetPL", "EndingBalance"])


def log_trade(timestamp, direction, contracts, entry_p, exit_p, net_pl, ending_balance):
    """(step 11) One row per trade. NetPL and EndingBalance read UNREPORTED when IB sent no commission,
    rather than a figure built from the fee estimate."""
    with open(LOG_FILENAME, mode='a', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([timestamp, f"SPY {direction}", contracts, f"{entry_p:.2f}", f"{exit_p:.2f}", money(net_pl), money(ending_balance)])


def money(value):
    return "UNREPORTED" if value is None else f"{value:.2f}"


def get_safe_tier_contracts(balance, opt_price):
    """(step 7) The original's tier table. Returns 0 when one contract costs more than the balance."""
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
    # The original returned max(1, cts) here, which bought one contract even when it cost more than the balance.
    return cts if cts * cost <= balance else 0


def qualify(contract):
    """True when IB knows the contract. ib_async marks a failure with None inside the list it returns,
    and that list is still truthy, so this reads the conId IB fills in instead."""
    ib.qualifyContracts(contract)
    return bool(contract.conId)


def name(contract):
    return f"{contract.symbol} {contract.lastTradeDateOrContractMonth} {contract.strike:g}{contract.right}"


def get_0dte_contract(underlying, direction, current_spot):
    """
    (step 6) Finds today's expiring SPY 0DTE option: the listed out-of-the-money strike nearest spot +/- 1.50
    rounded to the dollar (~0.20 delta), a tie going to the one nearer spot +/- 1.50 itself. Returns None,
    saying why, when today's expiry or such a strike within $5 of the target is not listed.
    """
    today_str = now_et().strftime("%Y%m%d")

    # Request option chain details for today's expiry
    chains = ib.reqSecDefOptParams(underlying.symbol, '', underlying.secType, underlying.conId)
    smart_chain = [c for c in chains if c.exchange == 'SMART']
    if not smart_chain:
        print("[ERROR] Could not fetch SMART option chain.")
        return None

    chain = smart_chain[0]
    if today_str not in chain.expirations:
        # The original switched to the next expiry here; that is not a 0DTE trade, so the bot does not.
        print(f"[NO TRADE] No {today_str} expiry is listed for {SYMBOL} today.")
        return None

    # Target strike slightly OTM (approx ~0.20 Delta target offset)
    right = 'C' if direction == 'CALL' else 'P'
    target_strike = round(current_spot + 1.5, 0) if direction == 'CALL' else round(current_spot - 1.5, 0)

    # Closest strike IB actually lists for today (the chain's strikes cover every expiry), never in the money,
    # and a tie between two listed strikes goes to the one nearer spot +/- 1.50 before rounding.
    exact = current_spot + 1.5 if direction == 'CALL' else current_spot - 1.5
    out_of_the_money = (lambda s: s > current_spot) if direction == 'CALL' else (lambda s: s < current_spot)
    strikes = sorted((s for s in chain.strikes if abs(s - target_strike) <= 5.0 and out_of_the_money(s)),
                     key=lambda x: (abs(x - target_strike), abs(x - exact)))
    for strike in strikes:
        opt_contract = Option(SYMBOL, today_str, strike, right, 'SMART', tradingClass=chain.tradingClass, currency=CURRENCY)
        if qualify(opt_contract):
            print(f"[CONTRACT] {name(opt_contract)} (target strike {target_strike:g})")
            return opt_contract
    print(f"[NO TRADE] No out-of-the-money {today_str} {right} strike within $5 of {target_strike:g} is listed.")
    return None


def read_session(spy):
    """(step 3) Today's regular session as (open, close) in New York time, read from IB's liquid hours for
    SPY, so holidays and early closes come from IB. None when IB lists today as CLOSED.
    IB's format: '20261109:0930-20261109:1600;20261110:0930-20261110:1600;...'"""
    details = ib.reqContractDetails(spy)
    if not details:
        raise RuntimeError(f"IB returned no contract details for {SYMBOL}")
    tz = ZoneInfo(details[0].timeZoneId)
    today = now_et().astimezone(tz).strftime("%Y%m%d")
    for part in details[0].liquidHours.split(';'):
        if part == f"{today}:CLOSED":
            return None
        if part.startswith(f"{today}:"):
            start, end = part.split('-')
            session_open = datetime.datetime.strptime(start, "%Y%m%d:%H%M").replace(tzinfo=tz)
            session_close = datetime.datetime.strptime(end, "%Y%m%d:%H%M").replace(tzinfo=tz)
            return session_open.astimezone(ET), session_close.astimezone(ET)
    raise RuntimeError(f"IB's liquid hours for {SYMBOL} do not list {today}: {details[0].liquidHours!r}")


def read_cash_balance():
    """(step 2) The account's USD TotalCashBalance, the field the original reads. None when IB does not
    report it: the bot stops then, where the original went on with STARTING_BUDGET_USD."""
    for item in ib.accountSummary():
        if item.tag == 'TotalCashBalance' and item.currency == 'USD':
            return float(item.value)
    return None


def read_opening_range(spy, session_open):
    """(step 3) High and low of today's first 15-minute bar. Waits for that bar to close if the script
    starts early, and still reads that bar if it starts late. None when IB has no such bar."""
    ready = session_open + datetime.timedelta(minutes=15, seconds=5)
    while now_et() < ready:
        wait = (ready - now_et()).total_seconds()
        print(f"[WAIT] The opening range closes at {ready:%H:%M} ET, {wait / 60:.0f} min from now.", end="\r")
        ib.sleep(min(30.0, wait))
    print()
    bars = ib.reqHistoricalData(
        spy, endDateTime='', durationStr='2 D',
        barSizeSetting='15 mins', whatToShow='TRADES', useRTH=True, formatDate=2
    )
    first = [b for b in bars if b.date == session_open]   # formatDate=2: bar dates are UTC, compared as instants
    if not first:
        return None
    return float(first[0].high), float(first[0].low)


def live_last(ticker):
    """SPY's last trade while the feed is live, else None. IB sends NaN until there is one; the bot never
    stands the previous close in for it."""
    last = ticker.last
    if ticker.marketDataType == 1 and last == last and last > 0:
        return last
    return None


def live_quote(ticker):
    """(bid, ask) while both sides are live, else None. IB sends NaN, or -1, for a missing side."""
    bid, ask = ticker.bid, ticker.ask
    if ticker.marketDataType == 1 and bid == bid and ask == ask and 0 < bid <= ask:
        return bid, ask
    return None


def wait_for(read, seconds):
    """Calls read() every half second until it returns something other than None, for at most `seconds`."""
    end = now_et() + datetime.timedelta(seconds=seconds)
    while (value := read()) is None and now_et() < end:
        ib.sleep(0.5)
    return value


def wait_until(done, seconds):
    end = now_et() + datetime.timedelta(seconds=seconds)
    while not done() and now_et() < end:
        ib.sleep(0.5)
    return done()


def place(contract, order, legs):
    order.orderRef = ORDER_REF
    trade = ib.placeOrder(contract, order)
    BOT_TRADES.append(trade)
    legs.append(trade)
    return trade


def held(contract):
    """Contracts this run holds of `contract`, from IB's fills: bought minus sold."""
    total = 0
    for t in BOT_TRADES:
        if t.contract.conId == contract.conId:
            shares = sum(f.execution.shares for f in t.fills)
            total += shares if t.order.action == 'BUY' else -shares
    return int(total)


def avg_price(fills):
    return sum(f.execution.price * f.execution.shares for f in fills) / sum(f.execution.shares for f in fills)


def commissions(fills):
    """(step 11) What IB charged for these fills, from its commission reports. None when a report has not
    arrived within REPORT_TIMEOUT_S."""
    if not wait_until(lambda: all(f.commissionReport.execId for f in fills), REPORT_TIMEOUT_S):
        return None
    return sum(f.commissionReport.commission for f in fills)


def close_out(contract, legs):
    """Cancels this run's working orders on `contract`, then sells what it still holds at market."""
    mine = [t for t in BOT_TRADES if t.contract.conId == contract.conId]
    for t in mine:
        if not t.isDone():
            ib.cancelOrder(t.order)
    if not wait_until(lambda: all(t.isDone() for t in mine), 10):
        raise RuntimeError(f"this bot's orders on {name(contract)} would not cancel: check TWS")
    qty = held(contract)
    if qty > 0:
        place(contract, MarketOrder('SELL', qty, tif='DAY'), legs)
        if not wait_until(lambda: held(contract) == 0, 30):
            raise RuntimeError(f"could not sell {held(contract)} x {name(contract)}: close it in TWS")


def exits_set():
    return STOP_LOSS_PCT is not None and TAKE_PROFIT_PCT is not None


def take_trade(spy, direction, spot, balance, flatten_at):
    """(steps 6-11) One trade from a signal. Returns (net_pl, ending_balance) after a trade, 'skip' when
    this signal is passed over, 'stop' when there can be no trade today."""
    opt = get_0dte_contract(spy, direction, spot)
    if opt is None:
        return 'stop'
    quote_ticker = ib.reqMktData(opt, '', False, False)
    try:
        quote = wait_for(lambda: live_quote(quote_ticker), QUOTE_TIMEOUT_S)                    # (step 7)
        if quote is None:
            print(f"[NO TRADE] {name(opt)} has no live bid and ask after {QUOTE_TIMEOUT_S}s.")
            return 'skip'
        ask = quote[1]
        one = ask * 100.0 + IBKR_FEE_PER_LEG * 2
        qty = get_safe_tier_contracts(balance, ask)
        if qty == 0:
            print(f"[NO TRADE] One {name(opt)} costs ${one:,.2f} with fees; the balance is ${balance:,.2f}.")
            return 'stop'
        print(f"[ORDER] BUY {qty} x {name(opt)} at ${ask:.2f} (about ${qty * one:,.2f} with fees)")
        if not exits_set():
            print("[SIGNALS ONLY] No order sent: set STOP_LOSS_PCT and TAKE_PROFIT_PCT to trade.")
            return 'skip'
        return run_trade(opt, direction, qty, ask, balance, flatten_at, quote_ticker)
    finally:
        ib.cancelMktData(opt)


def run_trade(opt, direction, qty, ask, balance, flatten_at, quote_ticker):
    """(steps 8-11) Buy, leave the stop and the target working at IB, wait for one, write the CSV row."""
    legs, reason, interrupted = [], None, False
    try:
        entry = place(opt, LimitOrder('BUY', qty, ask, tif='DAY'), legs)                         # (step 8)
        if not wait_until(entry.isDone, ENTRY_FILL_TIMEOUT_S):
            ib.cancelOrder(entry.order)
            if not wait_until(entry.isDone, 10):
                raise RuntimeError("the entry order would not cancel: check TWS")
        filled = held(opt)
        if filled == 0:
            print(f"[NO FILL] BUY {qty} at ${ask:.2f} did not fill in {ENTRY_FILL_TIMEOUT_S}s; cancelled.")
            return 'skip'
        entry_price = avg_price(entry.fills)
        stop_price = round(entry_price * (1 - STOP_LOSS_PCT), 2)
        target_price = round(entry_price * (1 + TAKE_PROFIT_PCT), 2)
        print(f"[FILLED] {filled} x {name(opt)} @ ${entry_price:.2f}")
        if stop_price < 0.01:
            reason = f"the stop under ${entry_price:.2f} rounds to under one cent"
        else:
            oca = f"{ORDER_REF}-{entry.order.orderId}"                                            # (step 9)
            stop = place(opt, StopOrder('SELL', filled, stop_price, tif='DAY', ocaGroup=oca, ocaType=2), legs)
            target = place(opt, LimitOrder('SELL', filled, target_price, tif='DAY', ocaGroup=oca, ocaType=2), legs)
            print(f"[EXITS AT IB] Stop ${stop_price:.2f} | Target ${target_price:.2f} (one cancels the other)")
            while held(opt) > 0:                                                                   # (step 10)
                ib.sleep(1)
                if not ib.isConnected():
                    raise ConnectionError("lost the connection to TWS while holding a position")
                if now_et() >= flatten_at:
                    reason = f"{flatten_at:%H:%M} ET flatten"
                    break
                bid = quote_ticker.bid
                if bid == bid and bid > 0:
                    print(f"[{now_et():%H:%M:%S}] {name(opt)} bid ${bid:.2f} | Entry ${entry_price:.2f} | "
                          f"Stop ${stop_price:.2f} | Target ${target_price:.2f}", end="\r")
            if reason is None:
                reason = " and ".join(label for label, t in (("stop", stop), ("target", target)) if t.filled())
    except KeyboardInterrupt:
        interrupted, reason = True, "Ctrl+C"
    if held(opt) > 0:
        print(f"\n[EXIT] {reason}: selling {held(opt)} at market.")
        close_out(opt, legs)

    buys = [f for t in legs if t.order.action == 'BUY' for f in t.fills]
    if not buys:
        if interrupted:
            raise KeyboardInterrupt
        return 'skip'
    sells = [f for t in legs if t.order.action == 'SELL' for f in t.fills]
    contracts = int(sum(f.execution.shares for f in buys))
    entry_price, exit_price = avg_price(buys), avg_price(sells)
    try:
        fees = commissions(buys + sells)
    except KeyboardInterrupt:                # the trade is closed: its row is still written, then the bot stops
        interrupted, fees = True, None
    net_pl = None if fees is None else (exit_price - entry_price) * contracts * float(opt.multiplier) - fees
    ending_balance = None if net_pl is None else balance + net_pl
    log_trade(now_et().strftime("%Y-%m-%d %H:%M:%S"), direction, contracts, entry_price, exit_price, net_pl, ending_balance)
    if net_pl is None:
        print(f"\n[TRADE CLOSED] {reason} | {contracts} x {name(opt)} ${entry_price:.2f} -> ${exit_price:.2f} | "
              f"IB sent no commission report, so the log says UNREPORTED")
    else:
        print(f"\n[TRADE CLOSED] {reason} | {contracts} x {name(opt)} ${entry_price:.2f} -> ${exit_price:.2f} | "
              f"Net {'+' if net_pl >= 0 else '-'}${abs(net_pl):,.2f} after ${fees:.2f} commission | Balance ${ending_balance:,.2f}")
    if interrupted:
        raise KeyboardInterrupt
    return net_pl, ending_balance


def on_ib_error(reqId, errorCode, errorString, contract):
    print(f"\n[IB {errorCode}] {errorString}")


def connect(live):
    """(step 1) Connect, refusing a live port or a live account unless --live was given."""
    if PORT in LIVE_PORTS and not live:
        print(f"[REFUSED] Port {PORT} is a live port. Use the paper port, or add --live.")
        return False
    try:
        ib.connect('127.0.0.1', PORT, clientId=CLIENT_ID)
    except Exception as e:
        print(f"[CONNECTION ERROR] Could not connect to TWS on Port {PORT}: {e}")
        return False
    accounts = ib.managedAccounts()
    paper = bool(accounts) and all(a.startswith('D') for a in accounts)   # IBKR paper account IDs start with "D"
    if not paper and not live:
        print(f"[REFUSED] Account {', '.join(accounts)} is not a paper account. Add --live to trade it.")
        ib.disconnect()
        return False
    ib.errorEvent += on_ib_error
    print("=" * 88)
    print(f" ZDT & SQUEEZE LIVE TRADING AUTOPILOT - IBKR ACTIVE - {'PAPER' if paper else 'LIVE'} {', '.join(accounts)}")
    print("=" * 88)
    return True


def trade_the_day():
    spy = Stock(SYMBOL, EXCHANGE, CURRENCY)
    if not qualify(spy):
        print(f"[ERROR] IB does not know {SYMBOL} on {EXCHANGE}.")
        return 1

    session = read_session(spy)
    if session is None:
        print(f"[CLOSED] IB lists today as closed for {SYMBOL}. Nothing to do.")
        return 0
    session_open, session_close = session
    flatten_at = session_close - FLATTEN_BEFORE_CLOSE
    if now_et() >= flatten_at:
        print(f"[TOO LATE] It is past {flatten_at:%H:%M} ET; no new trades today.")
        return 0

    # Fetch live account balance                                                                    (step 2)
    current_balance = read_cash_balance()
    if current_balance is None:
        print("[ERROR] IB reports no USD TotalCashBalance for this account, so contracts cannot be sized. Stopping.")
        return 1
    print(f"[ACCOUNT] Current Available Funds: ${current_balance:,.2f} USD")

    # 1. Establish 15-Minute Opening Range                                                          (step 3)
    print("[INIT] Requesting first 15-minute bar to establish Opening Range (ORB)...")
    orb = read_opening_range(spy, session_open)
    if orb is None:
        print(f"[ERROR] IB has no {session_open:%H:%M} ET bar for today. Stopping.")
        return 1
    orb_high, orb_low = orb
    call_trigger, put_trigger = orb_high + ORB_BUFFER, orb_low - ORB_BUFFER
    print(f"[ORB ESTABLISHED] 15-Min High: ${orb_high:.2f} | 15-Min Low: ${orb_low:.2f}")
    print(f"[ORB TRIGGERS] CALL Breakout > ${call_trigger:.2f} | PUT Breakdown < ${put_trigger:.2f}\n")

    # 2. Subscribe to Live Market Data                                                              (step 4)
    ib.reqMarketDataType(1)
    ticker = ib.reqMktData(spy, '', False, False)
    if wait_for(lambda: live_last(ticker), PRICE_TIMEOUT_S) is None:
        print(f"[ERROR] No live {SYMBOL} price after {PRICE_TIMEOUT_S}s (data type {ticker.marketDataType}). "
              "Check the account's market data subscriptions. Stopping.")
        return 1

    consecutive_losses = 0
    armed = True

    print("[MONITORING] Scanning real-time SPY price tick stream. Press Ctrl+C to stop.\n")

    while True:
        ib.sleep(1)
        if not ib.isConnected():
            raise ConnectionError("lost the connection to TWS")
        now = now_et()
        if now >= flatten_at:
            print(f"\n[DONE] {flatten_at:%H:%M} ET: no new trades today.")
            return 0
        last_price = live_last(ticker)
        if last_price is None:
            print(f"\n[ERROR] {SYMBOL} data is no longer live (type {ticker.marketDataType}). Stopping.")
            return 1
        if (now - ticker.time).total_seconds() > PRICE_TIMEOUT_S:
            print(f"\n[ERROR] No {SYMBOL} tick for over {PRICE_TIMEOUT_S}s. Stopping.")
            return 1

        print(f"[{now:%H:%M:%S}] SPY Spot: ${last_price:.2f} | High: ${orb_high:.2f} | Low: ${orb_low:.2f}", end="\r")

        if not armed:                                                                                # (step 12)
            if put_trigger <= last_price <= call_trigger:
                armed = True
                print(f"\n[REARMED] {SYMBOL} is back between ${put_trigger:.2f} and ${call_trigger:.2f}.")
            continue

        # 3. Check Signal Conditions                                                                 (step 5)
        direction = None
        if last_price > call_trigger:
            direction = 'CALL'
        elif last_price < put_trigger:
            direction = 'PUT'
        if direction is None:
            continue

        armed = False
        print(f"\n[SIGNAL] {direction}: {SYMBOL} ${last_price:.2f}")
        result = take_trade(spy, direction, last_price, current_balance, flatten_at)
        if result == 'stop':
            return 0
        if result == 'skip':
            continue
        net_pl, ending_balance = result
        if net_pl is None:
            print("[STOPPED] Without IB's commission the balance is unknown, so the bot stops for today.")
            return 1
        current_balance = ending_balance
        consecutive_losses = consecutive_losses + 1 if net_pl < 0 else 0

        # Circuit Breaker Check                                                                     (step 12)
        if consecutive_losses >= MAX_CONSECUTIVE_LOSSES:
            print(f"[CIRCUIT BREAKER] Max daily consecutive losses ({MAX_CONSECUTIVE_LOSSES}) reached. Stopping live execution for today.")
            return 0


def make_flat():
    """(step 13) Nothing of this bot's is left working or held when it stops."""
    for conid in {t.contract.conId for t in BOT_TRADES}:
        contract = next(t.contract for t in BOT_TRADES if t.contract.conId == conid)
        working = any(not t.isDone() for t in BOT_TRADES if t.contract.conId == conid)
        if working or held(contract) > 0:
            print(f"\n[CLEANUP] {name(contract)}: cancelling this bot's orders, selling the {held(contract)} it holds.")
            close_out(contract, [])


def report_open():
    """(step 10a) What this bot still holds by its own fills, when it could not close it."""
    for conid in {t.contract.conId for t in BOT_TRADES}:
        contract = next(t.contract for t in BOT_TRADES if t.contract.conId == conid)
        if held(contract) > 0:
            print(f"[STILL OPEN] {held(contract)} x {name(contract)}. Check TWS: the stop and target this bot "
                  "placed stay working at IB until the close.")


def run_live_execution(live=False):
    if exits_set() and not (0 < STOP_LOSS_PCT < 1 and TAKE_PROFIT_PCT > 0):
        print("[REFUSED] STOP_LOSS_PCT must be between 0 and 1, and TAKE_PROFIT_PCT above 0.")
        return 1
    BOT_TRADES.clear()
    initialize_csv_log()
    if not connect(live):
        return 1
    if not exits_set():
        print("[SIGNALS ONLY] STOP_LOSS_PCT and TAKE_PROFIT_PCT are not set: signals are shown, no order is sent.")
    try:
        return trade_the_day()
    except KeyboardInterrupt:
        print("\n[STOPPED] Ctrl+C.")
        return 0
    except ConnectionError as e:
        print(f"\n[CONNECTION LOST] {e}.")
        return 2
    finally:
        try:
            if ib.isConnected():
                make_flat()
        finally:                             # even when the cleanup itself fails, disconnect and say what is open
            if ib.isConnected():
                ib.disconnect()
            report_open()


def main(argv=None):
    parser = argparse.ArgumentParser(description="SPY 0DTE opening-range breakout autopilot for Interactive Brokers.")
    parser.add_argument("--live", action="store_true", help="allow a live (non-paper) port or account")
    args = parser.parse_args(argv)
    return run_live_execution(live=args.live)


if __name__ == "__main__":
    sys.exit(main())
