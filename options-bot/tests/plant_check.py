"""Plants one defect at a time in a COPY of the bot and checks the tests catch each one. The bot itself is never touched.

    py tests/plant_check.py        (IB_ASYNC_SRC, when set, lets the API check run on the copies too)

A check that has only ever passed cannot be told from one that is switched off; each plant is that proof for one guard.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

PLANTS = [
    ("the original's sizing: max(1, cts)", "    return cts if cts * cost <= balance else 0", "    return max(1, cts)"),
    ("the original's opening range: not the open's bar", "    first = [b for b in bars if b.date == session_open]", "    first = bars[-2:-1]"),
    ("the original's next-expiry switch", "        print(f\"[NO TRADE] No {today_str} expiry is listed for {SYMBOL} today.\")\n        return None",
     "        today_str = sorted(e for e in chain.expirations if e >= today_str)[0]"),
    ("qualifyContracts' answer ignored", "    ib.qualifyContracts(contract)\n    return bool(contract.conId)", "    ib.qualifyContracts(contract)\n    return True"),
    ("the original's $100 stand-in balance", "            return float(item.value)\n    return None", "            return float(item.value)\n    return STARTING_BUDGET_USD"),
    ("no live-port guard", "    if PORT in LIVE_PORTS and not live:", "    if False:"),
    ("no live-account guard", "    if not paper and not live:", "    if False:"),
    ("the fee estimate instead of IB's commission", "    return sum(f.commissionReport.commission for f in fills)",
     "    return sum(f.execution.shares for f in fills) * IBKR_FEE_PER_LEG"),
    ("no re-arm rule", "        if not armed:", "        if False:"),
    ("no flatten before the close", "                if now_et() >= flatten_at:\n                    reason", "                if False:\n                    reason"),
    ("the breaker one loss late", "        if consecutive_losses >= MAX_CONSECUTIVE_LOSSES:", "        if consecutive_losses > MAX_CONSECUTIVE_LOSSES:"),
    ("orders sent in signals-only", "        if not exits_set():\n            print(\"[SIGNALS ONLY] No order sent", "        if False:\n            print(\"[SIGNALS ONLY] No order sent"),
    ("delayed data accepted", "    if ticker.marketDataType == 1 and last == last and last > 0:", "    if last == last and last > 0:"),
    ("UNREPORTED replaced by a figure", "    return \"UNREPORTED\" if value is None else f\"{value:.2f}\"", "    return \"0.00\" if value is None else f\"{value:.2f}\""),
    ("a misspelt ib keyword", "durationStr='2 D'", "durationstr='2 D'"),
    ("a misspelt order field", "ocaGroup=oca, ocaType=2), legs)\n            target", "ocaGrp=oca, ocaType=2), legs)\n            target"),
    ("the stop placed as a limit", "stop = place(opt, StopOrder('SELL'", "stop = place(opt, LimitOrder('SELL'"),
    ("in-the-money strikes allowed (light loop S2)", " and out_of_the_money(s)),", "),"),
    ("a tie by list order (light loop S1)", "key=lambda x: (abs(x - target_strike), abs(x - exact)))", "key=lambda x: abs(x - target_strike))"),
    ("Ctrl+C in the commission wait drops the row (light loop S3)", "    try:\n        fees = commissions(buys + sells)\n    except KeyboardInterrupt:",
     "    fees = commissions(buys + sells)\n    if False:"),
    ("no cleanup after a crash", "            if ib.isConnected():\n                make_flat()", "            if ib.isConnected():\n                pass"),
    ("a dead feed not noticed", "        if (now - ticker.time).total_seconds() > PRICE_TIMEOUT_S:", "        if False:"),
    ("any first bar taken as the open's", "    first = [b for b in bars if b.date == session_open]", "    first = bars[:1]"),
]


# Plants in the epics model, each of which tests/test_model.py must refuse: (label, file, old, new).
MODEL_PLANTS = [
    ("a step names code its tests never ran", "model/usecases.yaml",
     'code: ["zdt_autopilot.py::read_cash_balance", "zdt_autopilot.py::trade_the_day"]}', 'code: ["zdt_autopilot.py::read_cash_balance", "zdt_autopilot.py::close_out"]}'),
    ("a requirement linked straight to code", "model/requirements.yaml", "{id: OB-6, kind: authored,", "{id: OB-6, code: read_cash_balance, kind: authored,"),
    ("an alternate path with no tests", "model/step_tests.yaml", "  UC-4.3a: [test_an_option_with_no_quote_is_not_traded]\n", ""),
    ("a trace older than the code", "zdt_autopilot.py", 'ORDER_REF = "zdt-autopilot"', 'ORDER_REF = "zdt-autopilot"  # changed'),
    ("a measure naming a test that is gone", "model/requirements.yaml", 'measure: "test_unreachable_tws_says_so_and_exits"', 'measure: "test_tws_unreachable"'),
]


def plant(label, rel, old, new, tests):
    """One plant in a fresh copy of the project; True when the named tests fail on it."""
    work = pathlib.Path(tempfile.mkdtemp(prefix="zdt_plant_"))
    try:
        shutil.copytree(ROOT, work / "p", ignore=shutil.ignore_patterns("__pycache__", "*.csv", "original", ".git"))
        target = work / "p" / rel
        text = target.read_text(encoding="utf-8")
        if text.count(old) != 1:
            raise SystemExit(f"BROKEN  {label}: its site is found {text.count(old)} times in {rel}, not once")
        target.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
        env = {k: v for k, v in os.environ.items() if k != "USECASE_MODEL"}
        run = subprocess.run([sys.executable, "-X", "utf8", "-m", "pytest", *tests, "-q", "-x", "-p", "no:cacheprovider"],
                             cwd=work / "p", env=env, capture_output=True, text=True, timeout=900)
        failed = [l for l in run.stdout.splitlines() if l.startswith(("FAILED", "ERROR"))]
        ok = run.returncode != 0
        print(f"{'CAUGHT' if ok else 'MISSED'}  {label}: {failed[0][7:110] if failed else run.stdout.strip().splitlines()[-1]}")
        return ok
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    behaviour = ["tests/test_zdt_autopilot.py", "tests/test_api_contract.py"]
    results = [plant(label, "zdt_autopilot.py", old, new, behaviour) for label, old, new in PLANTS]
    results += [plant(label, rel, old, new, ["tests/test_model.py"]) for label, rel, old, new in MODEL_PLANTS]
    print(f"\n{sum(results)} of {len(results)} planted defects caught")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
