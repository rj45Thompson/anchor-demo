"""pytest plugin: records which functions of zdt_autopilot.py each test runs.

    py -m pytest tests -p trace_plugin --trace-out model/step_trace_raw.json

Every Python call into zdt_autopilot.py during a test's call phase is recorded by function name, through sys.setprofile,
so a step's code (usecases.yaml) is held to what its tests actually execute, not to what anyone claims they do.
Parametrised cases of one test are pooled under the test's own name.
"""
import json
import os
import pathlib
import sys

import pytest

BOT = os.path.normcase(str(pathlib.Path(__file__).resolve().parent.parent / "zdt_autopilot.py"))
RAN = {}


def pytest_addoption(parser):
    parser.addoption("--trace-out", default=None, help="where to write {test: [functions of zdt_autopilot.py it ran]}")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_call(item):
    seen = RAN.setdefault(item.originalname, set())

    def profile(frame, event, arg):
        if event == "call" and os.path.normcase(frame.f_code.co_filename) == BOT:
            seen.add(frame.f_code.co_name)

    sys.setprofile(profile)
    try:
        yield
    finally:
        sys.setprofile(None)


def pytest_sessionfinish(session):
    out = session.config.getoption("--trace-out")
    if out:
        pathlib.Path(out).write_text(json.dumps({t: sorted(f) for t, f in sorted(RAN.items())}, indent=1), encoding="utf-8")
