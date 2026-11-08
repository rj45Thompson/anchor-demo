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
2. It reads the account's USD `TotalCashBalance` (the original's field) and its own budget: `STARTING_BUDGET_USD`
   ($100) before its first trade, then the last ending balance in its log. It prints `[ACCOUNT]` and `[BUDGET]`.
3. It reads today's session hours from IB, waits for the first 15-minute bar to close, and reads that
   bar. It prints `[ORB ESTABLISHED]` and the two triggers (high + `ORB_BUFFER`, low - `ORB_BUFFER`).
4. It streams SPY's last price and prints a status line every second.
5. SPY trades above the CALL trigger or below the PUT trigger. It prints `[SIGNAL]`.
6. It picks today's expiry and the listed strike nearest spot +/- 1.50 rounded to the dollar (the original's rule),
   always out of the money, a tie going to the one nearer spot +/- 1.50. It prints `[CONTRACT]`.
7. It reads that option's ask and sizes the order with the original's tier table, from its budget and never from more
   than the account's cash. It prints `[ORDER]`.
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
- 2b. The log's last row says UNREPORTED: the budget is not known, and it stops.
- 3a. Started after 9:45 ET: it still reads the 9:30 bar. The original read the latest 30 minutes, so
  after about 10:15 its "opening range" was a later bar, and before 9:45 it was a bar still forming.
- 3b. IB lists today as CLOSED: it does nothing. A half day closes early, and the flatten time moves with it.
- 4a. No live SPY price within 15 seconds, or the data is delayed: it stops and says why.
- 6a. Today's expiry is not listed: no trade today. The original switched to the next expiry, which is
  not a 0DTE trade.
- 6b. No out-of-the-money strike within $5 of the target is listed: no trade today. The original crashed here (`min()` of
  an empty list), and it never checked that IB knew the contract it picked.
- 7a. The option has no live bid and ask: this signal is skipped.
- 7b. One contract costs more than the budget, or than the cash: no trade today. The original bought one anyway.
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

From the owner's answer (2026-11-08): start it with $100 and trade 0DTE within that budget, buying cheap calls when
the market is going up and cheap puts when it is going down. The bot now sizes from its own budget, `STARTING_BUDGET_USD`
to start and the log's last ending balance after that, and never from more than the account holds (2, 7, 2b). Calls on
an up move and puts on a down move is the breakout rule it already had (5).

## Open questions for the owner

1. The original ends at the PUT check. Is there more of it? If not:
2. What stop and target do you want (`STOP_LOSS_PCT`, `TAKE_PROFIT_PCT`)?
3. What does `TIME_STOP_PCT = 0.25` do? The original sets it but uses it after the point where it ends, so
   the bot does not use it yet.
4. After a trade, should it trade again the same day? It now waits for SPY to come back inside the range
   first, then takes the next breakout, until two losses in a row.
5. The trend: the bot reads it as SPY breaking out of the first 15-minute range, up for calls and down for puts.
   Is that the read you mean, or another one (VWAP, a moving average)?
6. Cheap lotto options: the strike is the original's fixed $1.50 from spot (about 0.20 delta in its comment).
   When that option costs more than the budget, should it go further out to a cheaper one, or skip the day?
   And keep the fixed offset, or pick by the delta IB reports?
7. Answered 2026-11-08: start with $100 and trade within it. The budget carries over from day to day in the
   log; say if it should start again at $100 each day instead.

## The light loop

`spec_check/` holds a check of the code against a written spec, `spec_check/SPEC.md`: the use case above,
the original script's own comments, and ib_async's documentation, each copied word for word. Every rule in
`rules.json` quotes it, every suspect in `suspects.json` names a rule and a code line, and a fault counts only
when that suspect's repro (`repros/`) fails its own assertion on the code.

It now holds 19 rules and 18 suspects. The first run proved 3 faults (`REPORT_before_fixes.md`): a tie between two listed strikes went to the one
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

`pip install -r requirements-dev.txt`, then `py -m pytest tests` (84 tests) runs the bot through whole simulated
trading days against an in-memory TWS (`tests/fake_ib_async.py`), with tests for every step and alternate path of
the trading epic. No TWS, network or account is involved. `tests/test_api_contract.py` reads the real ib_async
source and checks that every `ib.` call, keyword and field the bot uses exists there. It runs when ib_async is
installed, or when `IB_ASYNC_SRC` points at its source, and is skipped otherwise.

`py tests/plant_check.py` plants 30 defects, one at a time, in copies of the bot and of the model (the original's
five among them), and each must make a test fail. A check that has only ever passed cannot be told from one
that is switched off.

What the tests cannot show: how IB itself fills, prices and reports on a given day. The first paper run
is that check.

`py tests/demo_day.py` prints one simulated day the way the terminal shows it (`tests/demo_day_signals_only.txt`);
`py tests/demo_day.py --exits 0.5 1.0` does the same with a stop and a target set, test values only
(`tests/demo_day_with_exits.txt`).

## Replay on real sessions

`sim/` runs the bot's own code, unchanged, through SPY's real one-minute bars: `py sim/market_data.py` fetches the latest
five sessions (Yahoo Finance's public chart data), `py sim/replay.py` replays them with the budget carried day to day
(`--reset-daily` starts each at $100; `--stop` and `--target` set the test exits), and `py sim/make_replay_page.py OUT`
writes the page that plays each day back. Option prices there are modeled (Black-Scholes, VIX as the volatility, the time
left to the close), because past 0DTE quotes are not in free data; `sim/README.md` says what is real and what is modeled.
The replay has its own light loop (`sim/spec_check/`): six rules from its use case, among them that no decision uses a
price from the future, none broken, and a planted look-ahead caught.

## How others do it

Searched on 2026-11-08. Each item links to a public page; where that page blocks readers, a readable summary is
linked beside it. This is what others built and what their authors report, not advice.

### On Hugging Face

A search of Hugging Face's model, dataset and Space names for "0dte", "opening range breakout" and "spy options" finds
no model or dataset for this strategy: three Spaces have 0DTE in their names, and the two datasets it matches are
unrelated. The nearest data:

- [paperswithbacktest/Options-Daily-Price](https://huggingface.co/datasets/paperswithbacktest/Options-Daily-Price):
  daily bars of every US-listed option that traded since June 2014, index weeklies included, with implied volatility
  and greeks. Daily bars cannot test a 9:45 entry. Access needs the owner's approval.
- [fabhaus/equities_5m_options](https://huggingface.co/datasets/fabhaus/equities_5m_options): 5-minute bars for
  options on about 13,300 US underlyings, January 2024 to March 2026. Fine enough for an intraday replay; its card
  does not list the underlyings, so check that SPY is among them first.

### Tools that run this kind of bot

- [ib_async](https://github.com/ib-api-reloaded/ib_async), the library this bot uses. It replaces ib_insync, which
  many examples online still use.
- [QuantConnect LEAN](https://www.quantconnect.com/docs/v2/writing-algorithms/securities/asset-classes/equity-options/requesting-data/universes)
  filters an option chain to today's expiry with `expiration(0, 0)` and picks strikes by delta with `delta(min, max)`.
  It [trades equity and index options live through Interactive Brokers](https://www.quantconnect.com/docs/v2/cloud-platform/live-trading/brokerages/interactive-brokers),
  with stop, limit, bracket and one-cancels-other orders.
- [NautilusTrader](https://nautilustrader.io/docs/latest/integrations/interactive_brokers/): its Interactive Brokers
  adapter trades through TWS or IB Gateway and loads option chains for a window of days from today.

### The same signal in research

- Zarattini and Aziz (2023), [Can Day Trading Really Be Profitable?](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4416622)
  ([summary](https://www.cxoadvisory.com/?p=44210)): QQQ shares, a 5-minute opening range, entered in the direction
  of the first bar, the stop at that bar's other end, the target 10 times the risk, out at the close. They report
  33.2% a year against 14.9% for holding QQQ, January 2016 to February 2023, with commission charged but no bid-ask
  spread or slippage.
- Zarattini, Barbon and Aziz (2024), [A Profitable Day Trading Strategy For The U.S. Equity Market](https://ideas.repec.org/p/chf/rpseri/rp2498.html):
  the 5-minute range again (15, 30 and 60 minutes compared), traded only in stocks far more active than usual that
  day, 2016 to 2023. They report a net Sharpe ratio of 2.81 for the top 20.
- Zarattini, Aziz and Barbon (2024), [Beat the Market: An Effective Intraday Momentum Strategy for S&P500 ETF (SPY)](https://ideas.repec.org/p/chf/rpseri/rp2497.html):
  trend entries on SPY when intraday demand looks abnormal, with trailing stops, 2007 to early 2024. They report
  19.6% a year net of costs. The abstract does not mention options.
- Option Alpha (2025), [Opening range breakout 0DTE options](https://optionalpha.com/blog/opening-range-breakout-0dte-options-trading-strategy-explained):
  the breakout on SPX, but on a break it sells a 0DTE credit spread (a put spread on an upside break) and holds it to
  the close. Of the 15, 30 and 60-minute ranges it tested, its bot uses the 60-minute one.

### 0DTE options and their costs in research

- Beckmeyer, Branger and Gayda (2023), [Retail Traders Love 0DTE Options... But Should They?](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4404704)
  ([summary](https://cxoadvisory.com/individual-investing/retail-0dte-option-trader-performance)): retail traders lost
  about $70 million in all on 0DTE S&P 500 index options, January 2021 to February 2023, and their average daily net
  loss rose from $184,000 to $358,000 after daily expiries began in May 2022.
- Almeida, Freire and Hizmeri (draft of May 2025), [0DTE Asset Pricing](https://fmai.memberclicks.net/assets/docs/Derivatives2025/Almeida.pdf):
  0DTE options are now about half of all S&P 500 option volume. In them, investors are paid mainly for bearing the
  risk of the market rising rather than falling, and most 0DTEs look mispriced to a risk-averse investor; that was
  highly profitable to exploit before 2022 and faded once 0DTEs were listed every day.
- Vilkov, [0DTE Trading Rules: Tail Risk, Implementation, and Tactical Timing](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4641356),
  with its code at [vilkovgr/0dte-strategies](https://github.com/vilkovgr/0dte-strategies): rule-based 0DTE option
  strategies. Its August 2026 correction says the bid-ask half-spread had been charged at 1/100 of its true size;
  with that fixed, no strategy or basket keeps a positive net Sharpe ratio.

### AI agents that trade

- [TradingAgents](https://github.com/TauricResearch/TradingAgents): a team of language-model agents (analysts, bull
  and bear researchers, a trader, risk managers, a portfolio manager) deciding trades in stocks, ETFs and crypto. It
  runs on Claude among many models, sends its orders to a simulated exchange, and says it is for research.
- Li, Kim, Cucuringu and Ma (2025), [Can LLM-based Financial Investing Strategies Outperform the Market in Long Run?](https://arxiv.org/abs/2505.07078):
  over two decades and more than 100 symbols, the advantages earlier reported for LLM strategies shrink a lot; the
  strategies were too cautious in rising markets and too aggressive in falling ones.
- [Alpaca's MCP server](https://github.com/alpacahq/alpaca-mcp-server) lets Claude (Desktop or Code) and other
  assistants place single and multi-leg option orders at the broker Alpaca, on a paper account unless switched off.
  A different broker, and no strategy of its own.

### How this bot differs

- Its range is the first 15 minutes and it enters $0.30 past it (`ORB_BUFFER`). The papers above use a 5-minute
  range, compare 15, 30 and 60, and add filters such as trading only unusually active stocks.
- It buys one option a fixed $1.50 out of the money (about 0.20 delta, the original's comment says). QuantConnect
  picks strikes by delta (open question 6), and Option Alpha's 0DTE version sells a spread instead of buying.
- The breakout papers trade shares and report gains. The 0DTE studies above report retail traders losing money, and
  Vilkov's net results reversed once the spread was charged at its true size. The bot's replay prices options with a
  model, so a paper run on real quotes is the check that counts.

## Talk to the page

The bot's pages carry Living Page, a small package any page can use: one script and a Cloudflare Worker that holds the
Claude key. Press **Talk to this page** and Claude answers aloud, from this README, the epics model and the bot's settings.
On the bot page you can also tell it how to change the page: reword a part, add or remove one, reorder them, or change the
colour and the text size. The change is made at once, in your own browser only, and Undo puts it back; only the page's
owner can keep a change for everyone. Claude cannot change the bot, its code or anyone's account, and it gives no trading
advice. `relay/build_docs.py` writes what the relay tells Claude about the bot.

---

Software, not financial advice. Options can lose their whole premium, and 0DTE options expire the same day.
Run it on a paper account first.
