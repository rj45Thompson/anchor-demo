"""
The epics model (model/) held to the code. Requirements link only to steps, and only steps link to code, so:
- every step and alternate path of the trading epic has tests, and each named test exists;
- every code link resolves, and the code a step names ran under that step's tests (model/step_trace.json);
- the trace is of the code as it is now, no requirement names code, and every test a measure names exists;
- the model passes the closed-loop kit's use case checker (rules U1-U19) when USECASE_MODEL points at usecase_model.py.
"""
import ast
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys

import pytest

yaml = pytest.importorskip("yaml")

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODEL = ROOT / "model"


def load(name):
    return yaml.safe_load((MODEL / name).read_text(encoding="utf-8"))


USECASES = load("usecases.yaml")["usecases"]
REQS = load("requirements.yaml")["requirements"]
STEP_TESTS = load("step_tests.yaml")["steps"]
TRACE = json.loads((MODEL / "step_trace.json").read_text(encoding="utf-8"))


def functions(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}


TESTS = {n for n in functions(ROOT / "tests" / "test_zdt_autopilot.py") if n.startswith("test_")}


def pathways(uc):
    """The model's own ids (usecase_model.py): <uc>.<n> for a step, <uc>.<at><letter> for an alternate."""
    ids = [f"{uc['id']}.{n}" for n in range(1, len(uc.get("steps", [])) + 1)]
    seen = {}
    for e in uc.get("ext", []):
        letter = "abcdefghijklmnopqrstuvwxyz"[seen.get(e["at"], 0)]
        seen[e["at"]] = seen.get(e["at"], 0) + 1
        ids.append(f"{uc['id']}.{e['at']}{letter}")
    return ids


ALL_IDS = {i for uc in USECASES for i in pathways(uc)}
TRADING = [uc for uc in USECASES if uc.get("parent", {}).get("uc") == "EPIC-1"]


def test_every_step_and_path_of_the_trading_epic_has_tests():
    missing = [i for uc in TRADING for i in pathways(uc) if not STEP_TESTS.get(i)]
    assert not missing, f"no tests for {missing}"


def test_step_tests_name_real_steps_and_real_tests():
    assert set(STEP_TESTS) <= ALL_IDS, f"not a step of the model: {sorted(set(STEP_TESTS) - ALL_IDS)}"
    unknown = sorted({t for ts in STEP_TESTS.values() for t in ts} - TESTS)
    assert not unknown, f"no such test: {unknown}"


def test_every_code_link_resolves():
    for uc in USECASES:
        for n, step in enumerate(uc.get("steps", []), 1):
            for link in step.get("code", []):
                path, _, name = link.partition("::")
                assert (ROOT / path).exists(), f"{uc['id']}.{n}: no file {path}"
                if name:
                    assert name in functions(ROOT / path), f"{uc['id']}.{n}: {path} has no function {name}"


def test_each_steps_code_ran_under_its_tests():
    for uc in USECASES:
        for n, step in enumerate(uc.get("steps", []), 1):
            named = {link.partition("::")[2] for link in step.get("code", []) if link.startswith("zdt_autopilot.py::")}
            if not named:
                continue
            sid = f"{uc['id']}.{n}"
            assert sid in TRACE["steps"], f"{sid} names code but has no tests to run it"
            unrun = named - set(TRACE["steps"][sid]["ran"])
            assert not unrun, f"{sid} names {sorted(unrun)}, which none of its tests ran"


def test_the_trace_is_of_the_code_as_it_is():
    now = hashlib.sha256((ROOT / "zdt_autopilot.py").read_bytes()).hexdigest()
    assert TRACE["bot_sha256"] == now, "zdt_autopilot.py changed since the trace: run py tests/step_trace.py"
    assert {s: v["tests"] for s, v in TRACE["steps"].items()} == STEP_TESTS, "step_tests.yaml changed since the trace"


def test_requirements_never_name_code():
    for r in REQS:
        extra = set(r) - {"id", "kind", "sources", "text", "measure", "why"}
        assert not extra, f"{r['id']} carries {sorted(extra)}: a requirement links to steps, never to code"
        assert "::" not in r["text"], f"{r['id']} names code in its text"


def test_every_test_a_measure_names_exists():
    for r in REQS:
        for name in re.findall(r"(?<![\w/])test_\w+\b(?!\.py)", r["measure"]):   # a tests/test_x.py file is not a test name
            assert name in TESTS, f"{r['id']}'s measure names {name}, which does not exist"


def test_the_model_passes_the_kits_19_rules():
    tool = os.environ.get("USECASE_MODEL")
    if not tool:
        pytest.skip("USECASE_MODEL is not set to the closed-loop kit's usecase_model.py")
    run = subprocess.run([sys.executable, "-X", "utf8", tool, str(MODEL)], capture_output=True, text=True)
    assert run.returncode == 0, run.stdout[-3000:]
