"""Runs one light-loop repro on its own, no tool needed:  python spec_check/run_repro.py S1
An AssertionError from the repro means its rule is broken; otherwise it prints that every assertion held."""
import pathlib
import runpy
import sys

here = pathlib.Path(__file__).resolve().parent
sys.path[:0] = [str(here), str(here.parent), str(here.parent / "tests")]
runpy.run_path(str(here / "repros" / f"{sys.argv[1]}.py"), run_name="__main__")
print(f"{sys.argv[1]}: every assertion held")
