"""
The bot against the REAL ib_async: every ib.<method>(...) call and keyword, every order and contract
keyword, and every field the bot reads must exist in the library's source. The source is read as text
with ast; the library is never imported or run here. The other tests use the fake, so this is what ties
the fake's names to the real ones.

Runs when ib_async is installed, or when IB_ASYNC_SRC points at its package folder (the one holding ib.py).
"""
import ast
import importlib.machinery
import os
import pathlib

import pytest

BOT = pathlib.Path(__file__).resolve().parent.parent / "zdt_autopilot.py"


def library_folder():
    if os.environ.get("IB_ASYNC_SRC"):
        return pathlib.Path(os.environ["IB_ASYNC_SRC"])
    spec = importlib.machinery.PathFinder.find_spec("ib_async")   # searches sys.path only: the fake in sys.modules is skipped
    return pathlib.Path(spec.origin).parent if spec and spec.origin else None


LIB = library_folder()
pytestmark = pytest.mark.skipif(LIB is None or not (LIB / "ib.py").exists(),
                                reason="ib_async is not installed and IB_ASYNC_SRC is not set")


def class_node(module, name):
    tree = ast.parse((LIB / module).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == name:
            return node
    raise AssertionError(f"ib_async/{module} has no class {name}")


def members(module, name):
    """Fields, methods and class-level names of a class, as the source declares them."""
    found = set()
    for item in class_node(module, name).body:
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
            found.add(item.name)
        elif isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
            found.add(item.target.id)
        elif isinstance(item, ast.Assign):
            found.update(t.id for t in item.targets if isinstance(t, ast.Name))
    return found


def params(module, cls, method):
    """(names, takes **kwargs, positional count) of a method; None when it is not a def (e.g. sleep = staticmethod(...))."""
    for item in class_node(module, cls).body:
        if isinstance(item, ast.FunctionDef) and item.name == method:
            a = item.args
            names = [p.arg for p in a.posonlyargs + a.args + a.kwonlyargs]
            positional = float("inf") if a.vararg else len(a.posonlyargs + a.args) - 1
            return set(names), a.kwarg is not None, positional
    return None


def bot_calls():
    tree = ast.parse(BOT.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            yield node


def test_every_ib_call_names_a_real_method_and_real_keywords():
    ib_members = members("ib.py", "IB")
    checked = 0
    for call in bot_calls():
        f = call.func
        if not (isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id == "ib"):
            continue
        assert f.attr in ib_members, f"line {call.lineno}: IB has no method {f.attr}"
        signature = params("ib.py", "IB", f.attr)
        if signature is None:   # IB.sleep is staticmethod(util.sleep)
            assert f.attr == "sleep" and "def sleep(" in (LIB / "util.py").read_text(encoding="utf-8")
            continue
        names, has_kwargs, positional = signature
        for kw in call.keywords:
            assert has_kwargs or kw.arg in names, f"line {call.lineno}: IB.{f.attr} takes no keyword {kw.arg}"
        assert len(call.args) <= positional, f"line {call.lineno}: IB.{f.attr} takes {positional} positional arguments"
        checked += 1
    assert checked >= 12


def test_error_event_exists():
    assert "errorEvent" in (LIB / "ib.py").read_text(encoding="utf-8")
    assert "ib.errorEvent += on_ib_error" in BOT.read_text(encoding="utf-8")


@pytest.mark.parametrize("cls, module, base", [
    ("Stock", "contract.py", "Contract"), ("Option", "contract.py", "Contract"),
    ("LimitOrder", "order.py", "Order"), ("StopOrder", "order.py", "Order"), ("MarketOrder", "order.py", "Order"),
])
def test_order_and_contract_keywords_are_real(cls, module, base):
    names, has_kwargs, positional = params(module, cls, "__init__")
    fields = members(module, base)
    used = 0
    for call in bot_calls():
        if isinstance(call.func, ast.Name) and call.func.id == cls:
            used += 1
            assert len(call.args) <= positional, f"line {call.lineno}: {cls} takes {positional} positional arguments"
            for kw in call.keywords:
                assert kw.arg in names or (has_kwargs and kw.arg in fields), \
                    f"line {call.lineno}: {cls} has no parameter or {base} field {kw.arg}"
    assert used, f"the bot no longer builds a {cls}; drop it from this list"


# Fields and methods the bot reads on objects ib_async hands back.
READS = [
    ("contract.py", "Contract", ["conId", "symbol", "secType", "lastTradeDateOrContractMonth", "strike", "right", "multiplier"]),
    ("contract.py", "ContractDetails", ["liquidHours", "timeZoneId"]),
    ("ticker.py", "Ticker", ["last", "bid", "ask", "marketDataType", "time"]),
    ("order.py", "Trade", ["contract", "order", "fills", "isDone", "filled"]),
    ("order.py", "Order", ["orderId", "orderRef", "action"]),
    ("objects.py", "Fill", ["execution", "commissionReport"]),
    ("objects.py", "Execution", ["shares", "price"]),
    ("objects.py", "CommissionReport", ["execId", "commission"]),
    ("objects.py", "OptionChain", ["exchange", "expirations", "strikes", "tradingClass"]),
    ("objects.py", "BarData", ["date", "high", "low"]),
    ("objects.py", "AccountValue", ["tag", "value", "currency"]),
]


@pytest.mark.parametrize("module, cls, names", READS)
def test_fields_the_bot_reads_exist(module, cls, names):
    have = members(module, cls)
    missing = [n for n in names if n not in have]
    assert not missing, f"ib_async {cls} has no {missing}"
