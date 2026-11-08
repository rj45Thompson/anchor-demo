# Replay: the bot on real sessions

`py sim/market_data.py` fetches SPY's and VIX's one-minute bars for the latest five sessions (Yahoo Finance's public chart
data) into `sim/data/`, with the address and time they were fetched. `py sim/replay.py` runs the bot's own code through
each session; `py sim/make_replay_page.py OUT` writes the replay page.

## The use case it follows

**Actor:** the trader. **Goal:** watch the bot trade real past sessions, minute by minute, before any money is at stake,
and see every trade and what it did to the budget.

1. The replay reads SPY's real minute bars for each session, only regular hours, and skips any minute with an empty price.
2. The bot sees each minute's close only once that minute has ended, so no decision uses a price from the future.
3. The opening range is built from the real minute bars of the session's first 15 minutes.
4. Option prices are modeled with Black-Scholes, VIX's latest minute close as the volatility and the time left to the close, and every result file and page says they are modeled.
5. The bot's own code runs unchanged; the replay only stands in for TWS.
6. The budget starts at STARTING_BUDGET_USD and carries from session to session in the log, unless the reset-daily run starts every session at $100.
7. The replay page shows each session's prices, the opening range, the triggers, every fill and the console, in time order.

Alternate paths:

- 1a. A minute Yahoo left empty: skipped and counted, never filled in.
- 6a. One contract costs more than the budget: the bot's own [NO TRADE] line, and no trade that session.
