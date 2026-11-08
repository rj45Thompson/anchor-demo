"""Runs the bot's tests under the tracer and writes model/step_trace.json: for each step in model/step_tests.yaml, its tests
and the functions of zdt_autopilot.py those tests ran. Refuses a test name the run did not hold.

    py tests/step_trace.py        (after any change to zdt_autopilot.py; tests/test_model.py fails on a stale trace)
"""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    raw = pathlib.Path(tempfile.mkdtemp()) / "raw.json"
    env = dict(os.environ, PYTHONPATH=str(ROOT / "tests"))
    run = subprocess.run([sys.executable, "-X", "utf8", "-m", "pytest", "tests/test_zdt_autopilot.py", "-q", "-p", "no:cacheprovider",
                          "-p", "trace_plugin", f"--trace-out={raw}"], cwd=ROOT, env=env, capture_output=True, text=True)
    if run.returncode != 0:
        print(run.stdout[-3000:] + run.stderr[-2000:])
        print("REFUSED: the tests did not all pass, so no trace is written")
        return 1
    ran = json.loads(raw.read_text(encoding="utf-8"))
    mapping = yaml.safe_load((ROOT / "model" / "step_tests.yaml").read_text(encoding="utf-8"))["steps"]
    missing = sorted({t for tests in mapping.values() for t in tests} - set(ran))
    if missing:
        print("REFUSED: step_tests.yaml names tests the run did not hold: " + ", ".join(missing))
        return 2
    steps = {s: {"tests": tests, "ran": sorted(set().union(*(ran[t] for t in tests)))} for s, tests in mapping.items()}
    bot = (ROOT / "zdt_autopilot.py").read_bytes()
    out = {"bot_sha256": hashlib.sha256(bot).hexdigest(), "tests_run": len(ran), "steps": steps}
    (ROOT / "model" / "step_trace.json").write_text(json.dumps(out, indent=1), encoding="utf-8", newline="\n")
    print(f"step_trace.json: {len(steps)} steps, {len(ran)} tests traced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
