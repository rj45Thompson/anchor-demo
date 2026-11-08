"""Runs one of the replay's light-loop repros on its own:  python sim/spec_check/run_repro.py S2   (after py sim/market_data.py
and py sim/replay.py). An AssertionError from the repro means its rule is broken; otherwise it says every assertion held."""
import pathlib
import runpy
import sys

here = pathlib.Path(__file__).resolve().parent
sys.path[:0] = [str(here.parent), str(here.parent.parent), str(here.parent.parent / "tests")]
runpy.run_path(str(here / "repros" / f"{sys.argv[1]}.py"), run_name="__main__")
print(f"{sys.argv[1]}: every assertion held")
