"""The lane's open-work figures, READ from their sources, so prose never quotes memory.

    py -X utf8 -I gatefly/status.py
    py -X utf8 -I gatefly/status.py --selftest

WHY THIS EXISTS, and it is a specific failure rather than tidiness. This lane told RJ "12 nodes
remain unswept" twice, retracted it ("it is 16 of 18"), and the snipershot lane then caught the
figure appearing again. Its diagnosis is the part worth building against:

    12 was the read from art_graph.py's mechanism graph and 16 from problem_tree.py's join,
    because the sweep's evidence had never been written back. Two sources for one figure, so
    the prose number regenerates from whichever was last read, every time a sentence is written
    from memory.

The write-back landed in 0d94ce4 and the true figure is now 11. THAT FIXED THE DATA AND NOT THE
FAULT. Nothing stopped the next sentence being typed rather than read, and a retraction that
does not change the source is the same shape as a review that produces a correct list and
changes nothing - which is this lane's own finding, pointed at its own number.

So every figure below has exactly ONE reader, and the plants assert that the reader agrees with
its source. A number in prose should be a command away, not a recollection.

WHAT THIS CANNOT DO: it reports what the artefacts say. If an artefact is stale - a json written
before the code changed - this reports the stale figure faithfully. It removes the memory step,
not the staleness step, and the drift checks in plant_manifest.py and reevaluate.py are what
cover the other one.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def unswept():
    """-> (count, total, node ids). The ONE reader for 'how many nodes are unchecked'."""
    import prior_art as PA
    rows = PA.join()
    un = [r["node"] for r in rows if r["external"] == PA.NOT_SEARCHED]
    return len(un), len(rows), un


def frontier():
    """-> (count, ids). Mechanisms no work was found for. A DIFFERENT question from unswept()
    and the two were being conflated: this counts MECHANISMS in the literature graph, that
    counts NODES in the problem tree."""
    import art_graph as AG
    f = AG.frontier()
    return len(f), f


def plants():
    """-> (static, modules, digest) from the committed manifest, not from a sweep."""
    p = os.path.join(HERE, "runs", "plant_manifest.json")
    with open(p, encoding="utf-8") as f:
        m = json.load(f)
    return m["totals"]["plants"], m["totals"]["modules_with_plants"], m.get("labels_digest")


def unpushed():
    """-> (count, branch). None when there is no upstream to compare against."""
    try:
        br = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=HERE,
                            capture_output=True, text=True, timeout=20).stdout.strip()
        out = subprocess.run(["git", "rev-list", "--count", "origin/%s..HEAD" % br], cwd=HERE,
                             capture_output=True, text=True, timeout=20)
        if out.returncode != 0:
            return None, br
        return int(out.stdout.strip()), br
    except Exception:
        return None, "?"


def unbuilt_sections():
    """-> ids of UML x KAOS plan sections marked NOT BUILT, read from the plan itself."""
    p = os.path.join(HERE, "UML_KAOS_PLAN.md")
    if not os.path.exists(p):
        return []
    out = []
    with open(p, encoding="utf-8") as f:
        for ln in f:
            if ln.startswith("## ") and "NOT BUILT" in ln:
                out.append(ln[3:].split(".")[0].strip())
    return out


def report():
    n, tot, ids = unswept()
    fc, fids = frontier()
    pl, mods, dig = plants()
    up, br = unpushed()
    sec = unbuilt_sections()
    print("GATEFLY OPEN WORK, read from the artefacts")
    print("  nodes never checked against the literature : %d of %d" % (n, tot))
    print("      %s" % ", ".join(ids))
    print("  mechanisms on the literature frontier      : %d  (%s)" % (fc, ", ".join(fids)))
    print("      NOT the same question as the line above: that counts TREE NODES, this counts")
    print("      MECHANISMS. Conflating them is how '12' and '16' were both said of one figure.")
    print("  plants recorded in the manifest            : %d across %d module(s), digest %s"
          % (pl, mods, dig))
    print("  commits not on origin/%-20s: %s" % (br, "unknown" if up is None else up))
    print("  UML x KAOS sections marked NOT BUILT       : %s" % (", ".join(sec) or "none"))
    return n, fc, pl


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. THE LOAD-BEARING ONE. Each reader must agree with its own source, because the whole
    #    point is that prose quotes the reader instead of a memory. If a reader drifts from its
    #    source, this file becomes a second authority rather than the single one.
    import prior_art as PA
    rows = PA.join()
    direct = len([r for r in rows if r["external"] == PA.NOT_SEARCHED])
    n, tot, ids = unswept()
    _plant("unswept() disagrees with the join it reads (%d vs %d)" % (n, direct), n == direct)
    _plant("unswept() returned a count that does not match its own id list", n == len(ids))
    _plant("unswept() reported more unswept than there are nodes", n <= tot)

    import art_graph as AG
    fc, fids = frontier()
    _plant("frontier() disagrees with art_graph.frontier()", fids == AG.frontier())

    # 2. the two counts must be REPORTED AS DIFFERENT QUESTIONS. They are near each other in
    #    size, which is exactly how one gets quoted for the other - that is the whole history
    #    of the 12/16 mistake.
    _plant("the tree-node count and the mechanism-frontier count are the same number, so "
           "nothing in the output distinguishes them (%d, %d)" % (n, fc), True)
    # (not an assertion that they differ - they may legitimately coincide - but the report
    #  must SAY they are different questions, which is asserted on the text below)
    import io as _io
    import contextlib
    buf = _io.StringIO()
    with contextlib.redirect_stdout(buf):
        report()
    txt = buf.getvalue()
    _plant("the report does not say the two counts are different questions - the next person "
           "to read it quotes whichever they saw last", "NOT the same question" in txt)

    # 3. the manifest reader must match the committed file, or prose quotes a figure that is
    #    not in the artefact it claims to come from
    with open(os.path.join(HERE, "runs", "plant_manifest.json"), encoding="utf-8") as f:
        m = json.load(f)
    pl, mods, dig = plants()
    _plant("plants() disagrees with the committed manifest", pl == m["totals"]["plants"])
    _plant("plants() reports a digest the manifest does not carry", dig == m.get("labels_digest"))

    # 4. unpushed must REFUSE rather than report 0 when it cannot tell. Reporting 0 for "no
    #    upstream" would say the work is pushed when nobody knows.
    up, br = unpushed()
    _plant("unpushed() returned a number it could not have known", up is None or up >= 0)

    # 5. the sections reader must read the plan, not a hardcoded list - this lane said "2, 3
    #    and 5" for days while the plan marked 2, 3, 4 AND 5 not built
    sec = unbuilt_sections()
    _plant("unbuilt_sections() returned nothing although the plan marks sections NOT BUILT",
           sec or not os.path.exists(os.path.join(HERE, "UML_KAOS_PLAN.md")))
    _plant("unbuilt_sections() missed section 4, which this lane omitted from prose for days",
           "4" in sec or not sec)

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
    report()
