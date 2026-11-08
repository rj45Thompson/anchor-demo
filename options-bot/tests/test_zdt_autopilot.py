"""
The bot run through whole simulated trading days, one test per step and alternate path of the use case in
README.md. Money figures are worked out in each docstring from the fake market in fake_ib_async.py.
"""
import contextlib
import csv
import datetime as dt
import io
from dataclasses import dataclass, replace

import pytest

import zdt_autopilot as bot
from fake_ib_async import Day, FakeTWS


def steps(*points):
    """steps(("09:30", 580.0), ("09:50", 581.5)): SPY's last price from each time on."""
    return [(dt.time.fromisoformat(t), p) for t, p in points]


@dataclass
class Result:
    code: int
    tws: FakeTWS
    rows: list
    out: str
    error: Exception = None

    @property
    def trades(self):
        return self.rows[1:]

    def orders(self):
        return [c[2]["order"] for c in self.tws.called("placeOrder")]


@pytest.fixture
def simulate(tmp_path):
    def run(day, stop=0.5, target=1.0, live=False, port=7497, via_main=False, raises=None):
        """Runs the bot through the day. via_main: through main()'s command line. raises: the exception the run must
        end with; the result still carries the fake TWS and the output, so what was left behind can be checked."""
        tws = FakeTWS(day)
        log = tmp_path / "trade_execution_log.csv"
        patches = dict(ib=tws, now_et=lambda: tws.now, LOG_FILENAME=str(log),
                       STOP_LOSS_PCT=stop, TAKE_PROFIT_PCT=target, PORT=port)
        saved = {k: getattr(bot, k) for k in patches}
        for k, v in patches.items():
            setattr(bot, k, v)
        out, code, error = io.StringIO(), None, None
        try:
            with contextlib.redirect_stdout(out):
                code = bot.main(["--live"] if live else []) if via_main else bot.run_live_execution(live=live)
        except Exception as e:
            if raises is None or not isinstance(e, raises):
                raise
            error = e
        finally:
            for k, v in saved.items():
                setattr(bot, k, v)
        if raises is not None and error is None:
            raise AssertionError(f"the run was to end with {raises.__name__}, and nothing was raised")
        rows = list(csv.reader(log.open(newline=""))) if log.exists() else []
        return Result(code, tws, rows, out.getvalue(), error)
    return run


# The opening range is 579.00-581.00, so the triggers are CALL above 581.30 and PUT below 578.70.
CALL_TO_TARGET = Day(path=steps(("09:30", 580.00), ("09:50", 581.50), ("10:10", 584.00)))
CALL_THEN_FLAT = Day(path=steps(("09:30", 580.00), ("09:50", 581.50)))
PUT_TO_STOP = Day(path=steps(("09:30", 580.00), ("09:50", 578.60), ("10:00", 579.50)))


def assert_flat(r):
    """(step 13) Nothing of the bot's left working or held at IB."""
    assert r.tws.open_orders() == []
    assert all(r.tws.position(conid) == 0 for conid in r.tws.option_conids.values())


def test_call_breakout_reaches_target(simulate):
    """Steps 1-11. CALL at 581.50: strike round(583.0) = 583, ask 0.61. $1,000 is the original's 6-contract tier
    (6 x $62.30 fits). Target 1.22 fills at 10:10. IB's commission is $4.20 a side, so
    net = 0.61 x 600 - 8.40 = $357.60."""
    r = simulate(CALL_TO_TARGET)
    assert r.code == 0
    assert r.rows[0] == ["Timestamp", "PlayDirection", "Contracts", "EntryPrice", "ExitPrice", "NetPL", "EndingBalance"]
    assert [row[1:] for row in r.trades] == [["SPY CALL", "6", "0.61", "1.22", "357.60", "1357.60"]]
    assert "PAPER DU1234567" in r.out
    assert "[CONTRACT] SPY 20261109 583C" in r.out
    assert "[EXITS AT IB] Stop $0.30 | Target $1.22" in r.out
    assert_flat(r)


def test_pl_uses_ibs_commission_not_the_estimate(simulate):
    """Step 11. The 0.65-a-leg estimate would give $7.80 on six contracts; IB reported $8.40."""
    r = simulate(CALL_TO_TARGET)
    assert "after $8.40 commission" in r.out
    assert r.trades[0][5] == "357.60"


def test_exits_are_an_oca_pair_held_at_ib(simulate):
    """Step 9. The stop and target go to IB together as one OCA group (type 2: a fill shrinks the other)."""
    r = simulate(CALL_TO_TARGET)
    entry, stop, target = r.orders()
    assert (entry.action, entry.orderType, entry.lmtPrice, entry.totalQuantity) == ("BUY", "LMT", 0.61, 6)
    assert (stop.orderType, stop.auxPrice, target.orderType, target.lmtPrice) == ("STP", 0.30, "LMT", 1.22)
    assert stop.ocaGroup == target.ocaGroup != "" and stop.ocaType == target.ocaType == 2
    assert {o.orderRef for o in r.orders()} == {"zdt-autopilot"}


def test_put_breakdown_stops_out(simulate):
    """Steps 5 and 10. PUT at 578.60: strike round(577.1) = 577, ask 0.56, 6 contracts. SPY back at 579.50
    takes the bid to 0.09, under the 0.28 stop, which fills there:
    net = (0.09 - 0.56) x 600 - 8.40 = -$290.40."""
    r = simulate(PUT_TO_STOP)
    assert r.code == 0
    assert [row[1:] for row in r.trades] == [["SPY PUT", "6", "0.56", "0.09", "-290.40", "709.60"]]
    assert "[REARMED]" in r.out
    assert_flat(r)


def test_two_losses_in_a_row_stop_the_day(simulate):
    """Step 12. The PUT above loses $290.40 (balance 709.60, the original's 4-contract tier). A CALL at 10:30 then
    stops at the 0.01 bid: (0.01 - 0.61) x 400 - 5.60 = -$245.60. Two losses: circuit breaker."""
    day = Day(path=steps(("09:30", 580.00), ("09:50", 578.60), ("10:00", 579.50), ("10:30", 581.50), ("10:40", 580.00)))
    r = simulate(day)
    assert r.code == 0
    assert [row[1:] for row in r.trades] == [["SPY PUT", "6", "0.56", "0.09", "-290.40", "709.60"],
                                             ["SPY CALL", "4", "0.61", "0.01", "-245.60", "464.00"]]
    assert "[CIRCUIT BREAKER] Max daily consecutive losses (2) reached." in r.out
    assert r.tws.now.time() < dt.time(11, 0)
    assert_flat(r)


def test_no_new_trade_until_spy_comes_back_inside(simulate):
    """Step 12. After the target SPY stays above the CALL trigger all day: still one trade, not one a second."""
    r = simulate(CALL_TO_TARGET)
    assert len(r.trades) == 1
    assert "[REARMED]" not in r.out


def test_flatten_ten_minutes_before_the_close(simulate):
    """Steps 10 and 13. Nothing fills all day; at 15:50 the bot cancels both exits and sells at the 0.59
    bid: (0.59 - 0.61) x 600 - 8.40 = -$20.40."""
    r = simulate(CALL_THEN_FLAT)
    assert r.code == 0
    [trade] = r.trades
    assert trade[0].startswith("2026-11-09 15:50") and trade[1:] == ["SPY CALL", "6", "0.61", "0.59", "-20.40", "979.60"]
    assert r.orders()[-1].orderType == "MKT"
    assert_flat(r)


def test_ctrl_c_mid_trade_sells_logs_and_stops(simulate):
    """Step 13. Ctrl+C at 11:00 while holding: sells at market, writes the row, stops."""
    r = simulate(replace(CALL_THEN_FLAT, interrupt_at=dt.time(11, 0)))
    assert r.code == 0
    assert "[STOPPED] Ctrl+C." in r.out
    [trade] = r.trades
    assert trade[0].startswith("2026-11-09 11:00") and trade[1:] == ["SPY CALL", "6", "0.61", "0.59", "-20.40", "979.60"]
    assert_flat(r)


def test_live_port_is_refused_without_live_flag(simulate):
    """Alternate 1a."""
    r = simulate(CALL_TO_TARGET, port=7496)
    assert r.code == 1 and "[REFUSED] Port 7496 is a live port" in r.out
    assert r.tws.called("connect") == []


def test_live_account_is_refused_without_live_flag(simulate):
    """Alternate 1a. A paper port can still log in to a live account; the account ID tells."""
    r = simulate(replace(CALL_TO_TARGET, accounts=("U1234567",)))
    assert r.code == 1 and "[REFUSED] Account U1234567 is not a paper account" in r.out
    assert r.orders() == [] and not r.tws.connected


def test_live_account_trades_with_live_flag(simulate):
    """Step 1 with --live."""
    r = simulate(replace(CALL_TO_TARGET, accounts=("U1234567",)), live=True)
    assert r.code == 0 and "LIVE U1234567" in r.out
    assert len(r.trades) == 1


def test_no_usd_cash_balance_stops_instead_of_using_100(simulate):
    """Alternate 2a. The original carried on with STARTING_BUDGET_USD ($100) here."""
    r = simulate(replace(CALL_TO_TARGET, cash_usd=None))
    assert r.code == 1 and "[ERROR] IB reports no USD TotalCashBalance" in r.out
    assert "$100.00" not in r.out
    assert r.tws.called("reqHistoricalData") == [] and r.orders() == []


def test_early_start_waits_for_the_opening_bar_to_close(simulate):
    """Step 3. Started at 9:20, it asks for bars only once the 9:30 bar has closed."""
    r = simulate(CALL_TO_TARGET)
    [(when, _, kwargs)] = r.tws.called("reqHistoricalData")
    assert when.time() >= dt.time(9, 45, 5)
    assert kwargs["formatDate"] == 2 and kwargs["useRTH"] is True and kwargs["barSizeSetting"] == "15 mins"


def test_late_start_still_reads_the_0930_bar(simulate):
    """Alternate 3a. Started at 11:00, the original took the first bar of the last 30 minutes (10:30,
    585.10/584.90 here). The opening range is the 9:30 bar."""
    day = Day(start=dt.time(11, 0), path=steps(("09:30", 580.00), ("10:00", 585.00), ("10:50", 580.00)))
    r = simulate(day)
    assert "[ORB ESTABLISHED] 15-Min High: $581.00 | 15-Min Low: $579.00" in r.out
    assert r.trades == []


def test_closed_day_does_nothing(simulate):
    """Alternate 3b."""
    r = simulate(replace(CALL_TO_TARGET, session=None))
    assert r.code == 0 and "[CLOSED]" in r.out
    assert r.tws.called("reqHistoricalData") == [] and r.orders() == []


def test_half_day_flattens_before_the_early_close(simulate):
    """Alternate 3b. IB lists a 13:00 close, so the flatten is at 12:50, not 15:50."""
    r = simulate(replace(CALL_THEN_FLAT, session=(dt.time(9, 30), dt.time(13, 0))))
    [trade] = r.trades
    assert trade[0].startswith("2026-11-09 12:50")
    assert_flat(r)


def test_no_live_price_stops(simulate):
    """Alternate 4a."""
    r = simulate(replace(CALL_TO_TARGET, market_data=0))
    assert r.code == 1 and "[ERROR] No live SPY price after 15s" in r.out
    assert r.orders() == []


def test_delayed_data_stops(simulate):
    """Alternate 4a. Delayed prices (type 3) are never traded on."""
    r = simulate(replace(CALL_TO_TARGET, market_data=3))
    assert r.code == 1 and "(data type 3)" in r.out
    assert r.orders() == []


def test_no_0dte_expiry_means_no_trade_today(simulate):
    """Alternate 6a. The original switched to the next expiry here."""
    r = simulate(replace(CALL_TO_TARGET, expirations=("20261110", "20261111")))
    assert r.code == 0 and "[NO TRADE] No 20261109 expiry is listed" in r.out
    assert r.orders() == []


def test_unlisted_nearest_strike_takes_the_next_nearest_listed(simulate):
    """Step 6. The chain shows 583 but IB will not qualify it today: 582 is the nearest one it lists."""
    r = simulate(replace(CALL_TO_TARGET, unlisted=frozenset({(583.0, "C")})))
    assert "[CONTRACT] SPY 20261109 582C (target strike 583)" in r.out
    assert {c[2]["contract"].strike for c in r.tws.called("placeOrder")} == {582.0}


def test_no_strike_within_5_dollars_means_no_trade(simulate):
    """Alternate 6b. The original crashed here: min() of an empty list."""
    r = simulate(replace(CALL_TO_TARGET, strikes=tuple(float(s) for s in range(500, 570))))
    assert r.code == 0 and "[NO TRADE] No out-of-the-money 20261109 C strike within $5 of 583 is listed." in r.out
    assert r.orders() == []


@pytest.mark.parametrize("balance, price, contracts", [
    (100, 0.50, 1), (150, 0.60, 2), (150, 1.00, 1), (300, 0.60, 3), (700, 0.60, 4),
    (1000, 0.61, 6), (3000, 0.60, 8), (10000, 0.50, 10), (10000, 9.00, 10), (5000, 9.00, 5),
])
def test_original_tier_table(balance, price, contracts):
    """Step 7: the original's tiers, trimmed to what the balance covers at (price x 100 + 2 x 0.65) a contract."""
    assert bot.get_safe_tier_contracts(balance, price) == contracts


def test_one_contract_it_cannot_afford_is_zero_not_one():
    """Alternate 7b. The original's max(1, cts) returned 1 here: $121.30 of option on a $100 balance."""
    assert bot.get_safe_tier_contracts(100, 1.20) == 0


def test_cannot_afford_one_contract_means_no_trade(simulate):
    """Alternate 7b, end to end."""
    r = simulate(replace(CALL_TO_TARGET, cash_usd=50.00))
    assert r.code == 0
    assert "[NO TRADE] One SPY 20261109 583C costs $62.30 with fees; the balance is $50.00." in r.out
    assert r.orders() == []


def test_unfilled_entry_is_cancelled(simulate):
    """Alternate 8a."""
    r = simulate(replace(CALL_TO_TARGET, entry_fill=0.0))
    assert "[NO FILL] BUY 6 at $0.61 did not fill in 10s; cancelled." in r.out
    [entry] = r.tws.trades
    assert entry.orderStatus.status == "Cancelled"
    assert r.trades == []
    assert_flat(r)


def test_partial_fill_trades_only_what_filled(simulate):
    """Alternate 8a. Three of six fill: exits for three, net = 0.61 x 300 - 2 x 2.10 = $178.80."""
    r = simulate(replace(CALL_TO_TARGET, entry_fill=0.5))
    entry, stop, target = r.tws.trades
    assert entry.orderStatus.status == "Cancelled" and entry.filled() == 3
    assert stop.order.totalQuantity == 0 and target.filled() == 3
    assert [row[1:] for row in r.trades] == [["SPY CALL", "3", "0.61", "1.22", "178.80", "1178.80"]]
    assert_flat(r)


def test_signals_only_until_the_exit_rules_are_set(simulate):
    """Alternate 9a. The original ends before its exits, so with none set the bot sends nothing."""
    r = simulate(CALL_TO_TARGET, stop=None, target=None)
    assert r.code == 0
    assert "[SIGNALS ONLY] STOP_LOSS_PCT and TAKE_PROFIT_PCT are not set" in r.out
    assert "[ORDER] BUY 6 x SPY 20261109 583C at $0.61 (about $373.80 with fees)" in r.out
    assert r.orders() == [] and r.trades == []


@pytest.mark.parametrize("stop, target", [(1.5, 1.0), (0.0, 1.0), (0.5, 0.0), (-0.2, 1.0)])
def test_impossible_exit_rules_are_refused(simulate, stop, target):
    r = simulate(CALL_TO_TARGET, stop=stop, target=target)
    assert r.code == 1 and "[REFUSED] STOP_LOSS_PCT must be between 0 and 1" in r.out
    assert r.tws.called("connect") == []


def test_connection_lost_while_holding_says_what_is_open(simulate):
    """Alternate 10a. The exits stay at IB; the bot says what it still holds."""
    r = simulate(replace(CALL_THEN_FLAT, drop_at=dt.time(10, 0)))
    assert r.code == 2
    assert "[CONNECTION LOST] lost the connection to TWS while holding a position." in r.out
    assert "[STILL OPEN] 6 x SPY 20261109 583C" in r.out
    assert r.trades == []


def test_unreported_commission_is_logged_as_unreported_and_stops(simulate):
    """Alternate 11a. No estimate stands in for IB's figure."""
    r = simulate(replace(CALL_TO_TARGET, commission_delay_s=None))
    assert r.code == 1
    assert [row[1:] for row in r.trades] == [["SPY CALL", "6", "0.61", "1.22", "UNREPORTED", "UNREPORTED"]]
    assert "[STOPPED] Without IB's commission the balance is unknown" in r.out


def test_unreadable_session_hours_fail_loudly(simulate, monkeypatch):
    """Step 3. An hours format the bot cannot read stops it with an error, not a guessed 9:30."""
    from fake_ib_async import ContractDetails
    monkeypatch.setattr(FakeTWS, "reqContractDetails",
                        lambda self, c: [ContractDetails(c, "20261109:0930-1600;20261110:0930-1600", "US/Eastern")])
    with pytest.raises(ValueError):
        simulate(CALL_TO_TARGET)


def test_a_tie_goes_to_the_strike_nearer_spot_plus_1_50(simulate):
    """Step 6 (light loop S1). SPY 581.90 + 1.50 = 583.40, rounded 583, which IB will not qualify today.
    582 and 584 are both a dollar from 583; 584 is 0.60 from 583.40 and 582 is 1.40, so 584."""
    day = Day(path=steps(("09:30", 580.00), ("09:50", 581.90), ("10:10", 586.00)), unlisted=frozenset({(583.0, "C")}))
    r = simulate(day)
    assert "[CONTRACT] SPY 20261109 584C (target strike 583)" in r.out


def test_never_buys_an_in_the_money_option(simulate):
    """Step 6 (light loop S2). With 582-584 unlisted and SPY at 581.50 the nearest left are 581 and 585;
    581 is in the money for a call, so 585."""
    r = simulate(replace(CALL_TO_TARGET, unlisted=frozenset({(582.0, "C"), (583.0, "C"), (584.0, "C")})))
    assert "[CONTRACT] SPY 20261109 585C (target strike 583)" in r.out
    assert all(c[2]["contract"].strike > 581.50 for c in r.tws.called("placeOrder"))


def test_ctrl_c_during_the_commission_wait_still_logs_the_trade(simulate):
    """Steps 11 and 13 (light loop S3). The target fills at 10:10; Ctrl+C lands while IB's report is still
    5 s away. The closed trade still gets its row, UNREPORTED because the report never came."""
    r = simulate(replace(CALL_TO_TARGET, commission_delay_s=5.0, interrupt_at=dt.time(10, 10, 2)))
    assert "[STOPPED] Ctrl+C." in r.out
    assert [row[1:] for row in r.trades] == [["SPY CALL", "6", "0.61", "1.22", "UNREPORTED", "UNREPORTED"]]
    assert_flat(r)


def test_unreachable_tws_says_so_and_exits(simulate):
    """UC-1 alternate 3a. TWS is not running: the original's own [CONNECTION ERROR], and nothing else happens."""
    r = simulate(replace(CALL_TO_TARGET, connect_error=ConnectionRefusedError("the remote computer refused the connection")))
    assert r.code == 1 and "[CONNECTION ERROR] Could not connect to TWS on Port 7497" in r.out
    assert r.orders() == [] and r.tws.called("reqHistoricalData") == []


def test_an_option_with_no_quote_is_not_traded(simulate):
    """UC-4 alternate 3a. The option shows no live bid and ask: the signal is skipped, no order is sent."""
    r = simulate(replace(CALL_TO_TARGET, option_quotes=False))
    assert r.code == 0 and "[NO TRADE] SPY 20261109 583C has no live bid and ask after 5s." in r.out
    assert r.orders() == [] and r.trades == []


def test_no_bar_at_the_open_stops(simulate):
    """UC-2 alternate 4a. None of IB's bars is stamped at the session's open: the bot stops rather than take another bar."""
    r = simulate(replace(CALL_TO_TARGET, no_open_bar=True))
    assert r.code == 1 and "[ERROR] IB has no 09:30 ET bar for today. Stopping." in r.out
    assert r.orders() == []


def test_a_feed_that_stops_mid_day_stops_the_bot(simulate):
    """UC-3 alternate 2b. SPY's ticks stop at 11:00 with nothing held: once 15 s pass without one, the bot stops."""
    r = simulate(Day(path=steps(("09:30", 580.00)), feed_stops_at=dt.time(11, 0)))
    assert r.code == 1 and "[ERROR] No SPY tick for over 15s. Stopping." in r.out
    assert dt.time(11, 0, 15) <= r.tws.now.time() < dt.time(11, 0, 20)


def test_a_stop_under_one_cent_sells_at_once(simulate):
    """UC-5 alternate 1a. A 99.5% stop under a $0.61 fill rounds to $0.00, so no stop can stand: it sells at once, at the
    0.59 bid: (0.59 - 0.61) x 600 - 8.40 = -$20.40."""
    r = simulate(CALL_TO_TARGET, stop=0.995, target=1.0)
    assert "[EXIT] the stop under $0.61 rounds to under one cent: selling 6 at market." in r.out
    assert [o.orderType for o in r.orders()] == ["LMT", "MKT"]
    assert [row[1:] for row in r.trades] == [["SPY CALL", "6", "0.61", "0.59", "-20.40", "979.60"]]
    assert_flat(r)


def test_a_crash_mid_trade_still_closes_everything(simulate):
    """UC-7 steps 1-3. A crash at 11:00 while holding: the cleanup cancels the stop and the target, sells at market and
    disconnects, then the crash is raised as it was."""
    r = simulate(replace(CALL_THEN_FLAT, crash_at=dt.time(11, 0)), raises=RuntimeError)
    assert str(r.error) == "simulated crash"
    assert "[CLEANUP] SPY 20261109 583C: cancelling this bot's orders, selling the 6 it holds." in r.out
    assert r.orders()[-1].orderType == "MKT"
    assert_flat(r)
    assert not r.tws.connected


def test_an_order_that_will_not_cancel_is_reported(simulate):
    """UC-7 alternate 2a. After a crash IB never confirms the cancels: the cleanup stops with that error, still
    disconnects, and says what is open."""
    r = simulate(replace(CALL_THEN_FLAT, crash_at=dt.time(11, 0), stuck_cancels=True), raises=RuntimeError)
    assert "would not cancel" in str(r.error)
    assert "[STILL OPEN] 6 x SPY 20261109 583C" in r.out
    assert not r.tws.connected


def test_the_live_flag_reaches_the_bot_from_the_command_line(simulate):
    """UC-11 step 2. python zdt_autopilot.py --live: main() hands --live to the bot, which then trades the live account."""
    r = simulate(replace(CALL_TO_TARGET, accounts=("U1234567",)), live=True, via_main=True)
    assert r.code == 0 and "LIVE U1234567" in r.out and len(r.trades) == 1
