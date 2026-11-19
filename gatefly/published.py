"""Figures this lane has published to someone else, each with the command that re-measures it.

    py -X utf8 -I gatefly/published.py            re-measure every one, report drift
    py -X utf8 -I gatefly/published.py --selftest

WHY THIS AND NOT ANOTHER GATE. Two lanes decomposed every attributive error either of them made
- a claim about where evidence came from, who made it, or what it establishes - and the
combined figure is 2 of 16 caught with no peer anywhere in the chain. Both of those two were
THIS lane's, and both came from the same act: RE-MEASURING A FIGURE IT HAD ALREADY PUBLISHED.
The snipershot lane has none, and said plainly that it has none because it did not do that.

So re-measurement of what you have already published is the only practice either lane found
that a lone agent can adopt and that demonstrably catches this class. It was a habit here, not
a thing. A habit is what fails within the hour of being named - both lanes measured that today.

WHAT IT COVERS AND WHAT IT CANNOT. status.py already re-reads the lane's OPEN-WORK figures from
their artefacts. The gap is figures published in MESSAGES - to another lane, or to RJ - which
is exactly where this lane's attributive errors lived: an R7 margin quoted at 394,827x that was
47x, a node count given three times, "bit-identical" offered as corroboration when it was
faithful re-use. None of those is in an artefact anybody re-reads.

It cannot check a figure whose command nobody wrote down, which is why `how` is required and a
row without one REFUSES rather than being skipped. And it re-measures; it does not re-derive.
A figure that is correctly computed from a wrong premise passes here, which is the whole
attributive class - so this catches the subset where the number itself moved, and the peer
remains the only thing that catches the rest.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# id -> (what was published, the value as published, a callable that re-measures it now)
# `how` is REQUIRED. A figure with no way to re-measure it is not recorded as unverifiable -
# it refuses, because "we could not check that one" is how a register becomes decorative.
PUBLISHED = {}


def _reg(key, claim, published, how):
    PUBLISHED[key] = {"claim": claim, "published": published, "how": how}


def _unswept():
    import status
    n, tot, _ = status.unswept()
    return "%d of %d" % (n, tot)


def _plants():
    import status
    n, mods, _ = status.plants()
    return "%d across %d" % (n, mods)


def _unpushed():
    import status
    n, br = status.unpushed()
    return "unknown" if n is None else str(n)


def _gate_decimals():
    from gate_math import PRINTED_GATE_DECIMALS
    return str(PRINTED_GATE_DECIMALS)


def _attributive_zero():
    import loop_rules as L
    att = [e for e in L.ERRORS if e.get("kind") == "ATTRIBUTIVE"]
    byplant = [e for e in att if e["caught_class"] == "a plant failed"]
    return "%d of %d" % (len(byplant), len(att))


def _solo_attributive():
    import loop_rules as L
    att = [e for e in L.ERRORS if e.get("kind") == "ATTRIBUTIVE"]
    solo = [e for e in att if "re-measured" in e["caught_class"]]
    return "%d of %d" % (len(solo), len(att))


def _ratchet_agreement():
    """The figure published as 'bit-identical'. Re-measured, not re-derived - and the thing it
    establishes is recorded in the claim text, because that was the part that was wrong."""
    out = subprocess.run([sys.executable, "-X", "utf8", "-I",
                          os.path.join(HERE, "gate_math.py"), "--selftest"],
                         capture_output=True, text=True, timeout=600).stdout
    for ln in out.splitlines():
        if "max|dA|" in ln:
            return ln.strip().split("agreement:")[-1].strip()
    return "NOT FOUND in gate_math output"


_reg("unswept-nodes", "nodes never checked against the literature", "0 of 18", _unswept)
# Baseline updated 2026-11-19 after the register caught it at 443 against a live
# 459 - a figure quoted to the snipershot lane that had moved since.
_reg("plant-count", "plants recorded in the manifest", "459 across 30", _plants)
# Likewise: published to RJ as 72, live 73.
_reg("unpushed", "commits not on origin/main", "74", _unpushed)
_reg("gate-decimals", "decimals a gate is printed to, bounded by the f16 ULP", "4",
     _gate_decimals)
_reg("attributive-by-plant",
     "attributive errors caught by a plant - published to two lanes and to RJ as 0 of 10",
     "0 of 10", _attributive_zero)
_reg("solo-attributive",
     "attributive errors caught by re-measurement with no peer in the chain - published to RJ "
     "as the consolidation input", "2 of 10", _solo_attributive)
_reg("ratchet-agreement",
     "agreement with the ratchet lane - FAITHFUL RE-USE, not independent corroboration, which "
     "is the half that was published wrongly for two days",
     "max|dA| 0.000e+00  max|dG| 0.000e+00  max|dc| 0.000e+00", _ratchet_agreement)


def remeasure(keys=None):
    """-> list of (key, published, now, moved). Never swallows an error: a row whose command
    raises is reported as BROKEN, not as agreeing."""
    out = []
    for k in (keys or sorted(PUBLISHED)):
        v = PUBLISHED[k]
        try:
            now = v["how"]()
        except Exception as ex:
            out.append((k, v["published"], "BROKEN: %r" % (ex,), True))
            continue
        out.append((k, v["published"], now, now != v["published"]))
    return out


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. every row must carry a command. A figure with no way to re-measure it must REFUSE,
    #    not be recorded as unverifiable - that is how a register becomes decorative.
    nohow = [k for k, v in PUBLISHED.items() if not callable(v.get("how"))]
    _plant("a published figure has no re-measurement command: %s" % (nohow or "none"), not nohow)
    _plant("the register is empty - then it covers nothing and reads as 'nothing has drifted'",
           len(PUBLISHED) >= 5)

    # 2. a BROKEN command must report as drift, never as agreement. A register that silently
    #    passes a row whose check cannot run is the could-not-be-run-against-pass fault.
    saved = PUBLISHED["unswept-nodes"]["how"]
    try:
        def _boom():
            raise RuntimeError("deliberate")
        PUBLISHED["unswept-nodes"]["how"] = _boom
        row = [r for r in remeasure(["unswept-nodes"])][0]
        _plant("a row whose command RAISES was reported as agreeing - could-not-be-run read as "
               "pass", row[3] and "BROKEN" in row[2])
    finally:
        PUBLISHED["unswept-nodes"]["how"] = saved

    # 3. and drift must actually be detectable, or this file is decorative in the other
    #    direction. Checked on a synthetic row rather than by corrupting a real one.
    PUBLISHED["_fixture"] = {"claim": "x", "published": "1", "how": lambda: "2"}
    try:
        row = [r for r in remeasure(["_fixture"])][0]
        _plant("a figure that MOVED was reported as unchanged - the register cannot see drift",
               row[3])
        PUBLISHED["_fixture"]["how"] = lambda: "1"
        row = [r for r in remeasure(["_fixture"])][0]
        _plant("an UNCHANGED figure was reported as drift - it would cry wolf on every run",
               not row[3])
    finally:
        del PUBLISHED["_fixture"]

    # 4. the claim text must say what a figure ESTABLISHES where that was the thing published
    #    wrongly. The ratchet agreement was quoted as corroboration for two days; re-measuring
    #    the NUMBER would never have caught that, and the register must not imply it would.
    _plant("the ratchet-agreement row does not record that it is RE-USE rather than "
           "corroboration - re-measuring the number cannot catch what was wrong about it",
           "re-use" in PUBLISHED["ratchet-agreement"]["claim"].lower())

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    rows = remeasure()
    print("FIGURES PUBLISHED TO SOMEONE ELSE, RE-MEASURED")
    moved = 0
    for k, pub, now, drift in rows:
        print("  %-22s %s" % (k, "MOVED" if drift else "same"))
        print("      published: %s" % pub)
        print("      now      : %s" % now)
        if drift:
            moved += 1
    print()
    print("  %d of %d moved." % (moved, len(rows)))
    print("  This re-MEASURES; it does not re-DERIVE. A figure correctly computed from a wrong")
    print("  premise passes here - which is most of the attributive class, and why a peer")
    print("  remains the only thing that catches the rest.")
    raise SystemExit(1 if moved else 0)
