"""
A stand-in for the ib_async package plus an in-memory TWS, so the bot's own logic runs through a whole
trading day with no TWS, network or account. It mimics only what the bot touches, in ib_async's names and
shapes as read from ib_async 2.1.0's source; tests/test_api_contract.py checks the bot against that source.

How the fake market behaves (made up for the tests, not a model of real prices):
- SPY's last price follows Day.path, a list of (time, price) steps.
- An option's mid is 0.60 + 0.5 x how far SPY has moved toward it past (strike -/+ 1.50), never under
  0.02; bid and ask sit a cent either side.
- A buy limit fills at the ask once the ask is at or under the limit; a sell limit fills at its limit once
  the bid reaches it; a stop fills at the bid once the bid is at or under the stop; a market sell fills at
  the bid. Sibling orders in an OCA group shrink by what fills (IB's ocaType 2).
- IB's commission is max(1.00, 0.70 per contract) per fill, deliberately not the bot's 0.65 estimate,
  so the tests can tell which one the P/L used.
"""
import datetime as dt
import itertools
from dataclasses import dataclass, field
from typing import ClassVar, NamedTuple
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = dt.timezone.utc
nan = float("nan")


@dataclass
class Contract:
    secType: str = ""
    conId: int = 0
    symbol: str = ""
    lastTradeDateOrContractMonth: str = ""
    strike: float = 0.0
    right: str = ""
    multiplier: str = ""
    exchange: str = ""
    currency: str = ""
    localSymbol: str = ""
    tradingClass: str = ""


class Stock(Contract):
    def __init__(self, symbol="", exchange="", currency="", **kwargs):
        Contract.__init__(self, secType="STK", symbol=symbol, exchange=exchange, currency=currency, **kwargs)


class Option(Contract):
    def __init__(self, symbol="", lastTradeDateOrContractMonth="", strike=0.0, right="", exchange="",
                 multiplier="", currency="", **kwargs):
        Contract.__init__(self, secType="OPT", symbol=symbol,
                          lastTradeDateOrContractMonth=lastTradeDateOrContractMonth, strike=strike, right=right,
                          exchange=exchange, multiplier=multiplier, currency=currency, **kwargs)


@dataclass
class Order:
    orderId: int = 0
    action: str = ""
    totalQuantity: float = 0.0
    orderType: str = ""
    lmtPrice: float = nan
    auxPrice: float = nan
    tif: str = ""
    ocaGroup: str = ""
    ocaType: int = 0
    orderRef: str = ""


class LimitOrder(Order):
    def __init__(self, action, totalQuantity, lmtPrice, **kwargs):
        Order.__init__(self, orderType="LMT", action=action, totalQuantity=totalQuantity, lmtPrice=lmtPrice, **kwargs)


class StopOrder(Order):
    def __init__(self, action, totalQuantity, stopPrice, **kwargs):
        Order.__init__(self, orderType="STP", action=action, totalQuantity=totalQuantity, auxPrice=stopPrice, **kwargs)


class MarketOrder(Order):
    def __init__(self, action, totalQuantity, **kwargs):
        Order.__init__(self, orderType="MKT", action=action, totalQuantity=totalQuantity, **kwargs)


@dataclass
class Execution:
    execId: str = ""
    time: dt.datetime = None
    side: str = ""
    shares: float = 0.0
    price: float = 0.0


@dataclass
class CommissionReport:
    execId: str = ""
    commission: float = 0.0


class Fill(NamedTuple):
    contract: Contract
    execution: Execution
    commissionReport: CommissionReport
    time: dt.datetime


@dataclass
class OrderStatus:
    orderId: int = 0
    status: str = ""
    DoneStates: ClassVar[frozenset] = frozenset(["Filled", "Cancelled", "ApiCancelled", "Inactive"])


@dataclass
class Trade:
    contract: Contract
    order: Order
    orderStatus: OrderStatus
    fills: list = field(default_factory=list)

    def isDone(self):
        return self.orderStatus.status in OrderStatus.DoneStates

    def filled(self):
        return sum(f.execution.shares for f in self.fills)

    def remaining(self):
        return self.order.totalQuantity - self.filled()


@dataclass
class Ticker:
    contract: Contract
    time: dt.datetime = None
    marketDataType: int = 1
    bid: float = nan
    ask: float = nan
    last: float = nan


@dataclass
class BarData:
    date: dt.datetime
    open: float
    high: float
    low: float
    close: float


class AccountValue(NamedTuple):
    account: str
    tag: str
    value: str
    currency: str
    modelCode: str


@dataclass
class OptionChain:
    exchange: str
    underlyingConId: int
    tradingClass: str
    multiplier: str
    expirations: list
    strikes: list


@dataclass
class ContractDetails:
    contract: Contract
    liquidHours: str
    timeZoneId: str


class Event:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def emit(self, *args):
        for handler in self.handlers:
            handler(*args)


class IB:
    """Only so `ib = IB()` works at import; the tests swap the bot's `ib` for a FakeTWS."""


SPY_CONID = 756733


@dataclass
class Day:
    """One trading day as the fake TWS plays it."""
    date: dt.date = dt.date(2026, 11, 9)                       # a Monday
    start: dt.time = dt.time(9, 20)                           # when the script starts, New York time
    session: tuple = (dt.time(9, 30), dt.time(16, 0))         # None: IB lists the day as CLOSED
    orb: tuple = (581.00, 579.00)                             # high, low of the first 15-minute bar
    path: list = field(default_factory=lambda: [(dt.time(9, 30), 580.00)])
    accounts: tuple = ("DU1234567",)
    cash_usd: float = 1000.00                                 # None: no USD TotalCashBalance row
    market_data: int = 1                                      # 1 live, 3 delayed, 0 nothing at all
    expirations: tuple = None                                 # None: today and the next four days
    strikes: tuple = tuple(float(s) for s in range(560, 601))
    unlisted: frozenset = frozenset()                         # (strike, right) in the chain that IB will not qualify
    entry_fill: float = 1.0                                   # share of an entry order that fills
    commission_delay_s: float = 1.0                           # None: IB never sends the report
    connect_error: Exception = None
    drop_at: dt.time = None                                   # the connection is lost at this time
    interrupt_at: dt.time = None                              # Ctrl+C at this time (once)


class FakeTWS:
    def __init__(self, day):
        self.day = day
        self.now = dt.datetime.combine(day.date, day.start, ET)
        self.connected = False
        self.errorEvent = Event()
        self.tickers = {}
        self.trades = []
        self.calls = []
        self.reports = []
        self.option_conids = {}
        self.order_ids = itertools.count(1)
        self.exec_ids = itertools.count(1)
        self.interrupted = False

    def _call(self, method, **kwargs):
        self.calls.append((self.now, method, kwargs))

    def called(self, method):
        return [c for c in self.calls if c[1] == method]

    # --- connection ---
    def connect(self, host="127.0.0.1", port=7497, clientId=1, **kwargs):
        self._call("connect", host=host, port=port, clientId=clientId)
        if self.day.connect_error:
            raise self.day.connect_error
        self.connected = True

    def isConnected(self):
        return self.connected

    def disconnect(self):
        self._call("disconnect")
        self.connected = False

    def managedAccounts(self):
        return list(self.day.accounts)

    # --- time: every sleep moves the fake market forward in half-second steps ---
    def sleep(self, seconds=0.02):
        end = self.now + dt.timedelta(seconds=seconds)
        while self.now < end:
            self.now = min(end, self.now + dt.timedelta(seconds=0.5))
            self._tick()
        if self.now.time() > dt.time(18, 0):
            raise RuntimeError("the fake day ran past 18:00: the bot never stopped")
        if self.day.interrupt_at and not self.interrupted and self.now.time() >= self.day.interrupt_at:
            self.interrupted = True
            raise KeyboardInterrupt

    def price_at(self, t):
        price = None
        for when, p in self.day.path:
            if when <= t:
                price = p
        return price

    def spy_price(self):
        return self.price_at(self.now.time())

    def quote(self, contract, spy):
        reach = spy - (contract.strike - 1.5) if contract.right == "C" else (contract.strike + 1.5) - spy
        mid = max(0.02, 0.60 + 0.5 * reach)
        return round(mid - 0.01, 2), round(mid + 0.01, 2)

    def _tick(self):
        if self.day.drop_at and self.now.time() >= self.day.drop_at:
            self.connected = False
        spy = self.spy_price()
        if spy is not None and self.day.market_data:
            for ticker in self.tickers.values():
                ticker.marketDataType = self.day.market_data
                ticker.time = self.now
                if ticker.contract.secType == "STK":
                    ticker.last = spy
                else:
                    ticker.bid, ticker.ask = self.quote(ticker.contract, spy)
        if self.connected and spy is not None:
            self._match(spy)
        for report in [r for r in self.reports if r[0] <= self.now]:
            self.reports.remove(report)
            _, cr, exec_id, commission = report
            cr.execId, cr.commission = exec_id, commission

    def _match(self, spy):
        for trade in list(self.trades):
            if trade.isDone():
                continue
            order = trade.order
            bid, ask = self.quote(trade.contract, spy)
            left = order.totalQuantity - trade.filled()
            qty, price = 0, None
            if order.action == "BUY" and order.orderType == "LMT" and ask <= order.lmtPrice:
                qty, price = round(order.totalQuantity * self.day.entry_fill) - trade.filled(), ask
            elif order.action == "SELL" and order.orderType == "LMT" and bid >= order.lmtPrice:
                qty, price = left, order.lmtPrice
            elif order.action == "SELL" and order.orderType == "STP" and bid <= order.auxPrice:
                qty, price = left, bid
            elif order.action == "SELL" and order.orderType == "MKT":
                qty, price = left, bid
            if qty > 0:
                self._fill(trade, qty, price)

    def _fill(self, trade, qty, price):
        exec_id = f"0001.{next(self.exec_ids)}"
        report = CommissionReport()
        execution = Execution(execId=exec_id, time=self.now, side="BOT" if trade.order.action == "BUY" else "SLD",
                              shares=qty, price=price)
        trade.fills.append(Fill(trade.contract, execution, report, self.now))
        if trade.filled() >= trade.order.totalQuantity:
            trade.orderStatus.status = "Filled"
        if self.day.commission_delay_s is not None:
            due = self.now + dt.timedelta(seconds=self.day.commission_delay_s)
            self.reports.append((due, report, exec_id, round(max(1.00, 0.70 * qty), 2)))
        if trade.order.ocaGroup:
            for other in self.trades:
                if other is not trade and other.order.ocaGroup == trade.order.ocaGroup and not other.isDone():
                    other.order.totalQuantity -= qty
                    if other.order.totalQuantity - other.filled() <= 0:
                        other.orderStatus.status = "Cancelled"

    # --- contracts ---
    def qualifyContracts(self, *contracts):
        self._call("qualifyContracts", contracts=contracts)
        result = []
        for c in contracts:
            if c.secType == "STK" and c.symbol == "SPY":
                c.conId = SPY_CONID
                result.append(c)
            elif c.secType == "OPT" and self._listed(c):
                key = (c.lastTradeDateOrContractMonth, c.strike, c.right)
                c.conId = self.option_conids.setdefault(key, 10_000 + len(self.option_conids))
                c.multiplier, c.tradingClass = "100", "SPY"
                result.append(c)
            else:
                result.append(None)
        return result

    def _listed(self, c):
        return (c.lastTradeDateOrContractMonth in self.expirations() and c.strike in self.day.strikes
                and (c.strike, c.right) not in self.day.unlisted)

    def expirations(self):
        if self.day.expirations is not None:
            return list(self.day.expirations)
        return [(self.day.date + dt.timedelta(days=n)).strftime("%Y%m%d") for n in range(5)]

    def reqSecDefOptParams(self, underlyingSymbol, futFopExchange, underlyingSecType, underlyingConId):
        self._call("reqSecDefOptParams", symbol=underlyingSymbol, conId=underlyingConId)
        return [OptionChain("CBOE", underlyingConId, "SPY", "100", self.expirations(), list(self.day.strikes)),
                OptionChain("SMART", underlyingConId, "SPY", "100", self.expirations(), list(self.day.strikes))]

    def reqContractDetails(self, contract):
        self._call("reqContractDetails", contract=contract)
        days = []
        for n in range(4):
            d = self.day.date + dt.timedelta(days=n)
            if n == 0 and self.day.session is None:
                days.append(f"{d:%Y%m%d}:CLOSED")
            else:
                start, end = self.day.session or (dt.time(9, 30), dt.time(16, 0))
                days.append(f"{d:%Y%m%d}:{start:%H%M}-{d:%Y%m%d}:{end:%H%M}")
        return [ContractDetails(contract, ";".join(days), "US/Eastern")]

    # --- account ---
    def accountSummary(self, account=""):
        self._call("accountSummary")
        rows = [AccountValue("DU1234567", "NetLiquidation", "250000.00", "USD", ""),
                AccountValue("DU1234567", "TotalCashBalance", "250000.00", "BASE", "")]
        if self.day.cash_usd is not None:
            rows.append(AccountValue("DU1234567", "TotalCashBalance", f"{self.day.cash_usd:.2f}", "USD", ""))
        return rows

    # --- market data ---
    def reqHistoricalData(self, contract, endDateTime, durationStr, barSizeSetting, whatToShow, useRTH,
                          formatDate=1, keepUpToDate=False, chartOptions=(), timeout=60):
        self._call("reqHistoricalData", durationStr=durationStr, barSizeSetting=barSizeSetting,
                   useRTH=useRTH, formatDate=formatDate)
        if self.day.session is None:
            return []
        bars = []
        start = dt.datetime.combine(self.day.date, self.day.session[0], ET)
        while start <= self.now:
            if not bars:
                high, low = self.day.orb
            else:
                end = (start + dt.timedelta(minutes=15)).time()
                prices = [self.price_at(start.time())] + [p for when, p in self.day.path if start.time() < when < end]
                high, low = max(prices) + 0.10, min(prices) - 0.10
            date = start.astimezone(UTC) if formatDate == 2 else start
            bars.append(BarData(date, low, high, low, high))
            start += dt.timedelta(minutes=15)
        return bars

    def reqMarketDataType(self, marketDataType):
        self._call("reqMarketDataType", marketDataType=marketDataType)

    def reqMktData(self, contract, genericTickList="", snapshot=False, regulatorySnapshot=False, mktDataOptions=()):
        self._call("reqMktData", contract=contract)
        return self.tickers.setdefault(contract.conId, Ticker(contract))

    def cancelMktData(self, contract):
        self._call("cancelMktData", contract=contract)
        self.tickers.pop(contract.conId, None)

    # --- orders ---
    def placeOrder(self, contract, order):
        self._call("placeOrder", contract=contract, order=order)
        order.orderId = next(self.order_ids)
        trade = Trade(contract, order, OrderStatus(order.orderId, "Submitted"))
        self.trades.append(trade)
        return trade

    def cancelOrder(self, order):
        self._call("cancelOrder", order=order)
        for trade in self.trades:
            if trade.order is order and not trade.isDone():
                trade.orderStatus.status = "Cancelled"

    def open_orders(self):
        return [t for t in self.trades if not t.isDone()]

    def position(self, conid):
        total = 0
        for t in self.trades:
            if t.contract.conId == conid:
                total += t.filled() if t.order.action == "BUY" else -t.filled()
        return total
