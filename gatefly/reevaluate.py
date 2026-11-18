"""Periodic re-evaluation of the problem tree: has a claim drifted away from what tests it?

    py -X utf8 -I gatefly/reevaluate.py --baseline     record the current state as examined
    py -X utf8 -I gatefly/reevaluate.py                re-evaluate; exits non-zero on drift
    py -X utf8 -I gatefly/reevaluate.py --selftest

WHY THIS EXISTS, and it is not a hypothetical. Node E4.4 was marked SETTLED on a sibling lane's
tie finding. That lane's later decoder test found a GRANULARITY MISMATCH - a correct answer at a
different level of specificity, absent from the answer set entirely - which weakened the
evidence without touching any link. **The traceability gate PASSED it.** It checks that a
settled node has a PLANT; it does not check that the plant still covers what the node CLAIMS,
and no amount of link resolution can see that difference.

So the thing to re-evaluate is not "does the check still pass" - CI does that - but:

    has the CLAIM moved, or has the thing TESTING it moved, since anyone last looked at the pair?

THE MECHANISM. For each node, fingerprint the pair: its claim text, its status, its evidence,
and the LABELS of the plants linked to it. Store that with the date it was examined. On a later
run, recompute. A node whose fingerprint has changed while its examined date has NOT is drift:
somebody edited the claim or the plant without re-checking that they still match. That refuses.

WHAT IT CANNOT DO, said plainly. It detects that the pair MOVED, not that the pair is WRONG.
E4.4's evidence weakened because of something measured in another lane and written into the
node; this would have caught that edit. But a node whose claim and plant both sit untouched
while the WORLD moves underneath them is invisible to it - which is what the horizon check and
the cross-lane citation list are for, and both are weaker.

SCOPED TO THE PROBLEM CONTEXT on RJ's instruction: it re-evaluates goal nodes and the pairing
between a claim and its test. It does not re-run experiments and does not re-derive measurements.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from problem_tree import NODES
import uml_kaos as UK

STATE = os.path.join(HERE, "runs", "reeval.json")
HORIZON_DAYS = 14


def fingerprint(nid, nodes=None, verify=None):
    """The claim and the thing that tests it, as one hash.

    Deliberately includes the EVIDENCE: that is the field that moved when E4.4 weakened, and a
    fingerprint over the claim alone would have missed it. Deliberately includes the plant
    LABELS rather than the plant's code, because a plant whose label still describes the claim
    is still about the claim even if its body was refactored.
    """
    nodes = nodes if nodes is not None else NODES
    verify = verify if verify is not None else UK.VERIFY
    v = nodes[nid]
    h = hashlib.sha256()
    for part in (v.get("say", ""), v.get("status", ""), v.get("evidence") or ""):
        h.update(part.encode("utf-8"))
        h.update(b"\x00")
    for fn, label in sorted(verify.get(nid, [])):
        h.update(("%s::%s" % (fn, label)).encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


def cross_lane_citations(nodes=None):
    """Nodes whose evidence rests on another lane's artefact. Weaker than the drift check -
    this lane cannot see another lane's commits - so it is a LIST to re-confirm, not a gate."""
    nodes = nodes if nodes is not None else NODES
    out = []
    for nid, v in nodes.items():
        ev = (v.get("evidence") or "")
        if "selfimprove_v4" in ev or "ratchet lane" in ev or "v4 lane" in ev or "commit" in ev:
            out.append(nid)
    return sorted(out)


def load_state():
    if not os.path.exists(STATE):
        return {}
    with open(STATE, encoding="utf-8") as f:
        return json.load(f)


def write_state(state):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(state, f, indent=1)


def evaluate(today=None, state=None, nodes=None, verify=None):
    """-> (drift, stale, unseen, citations). `drift` is what refuses."""
    nodes = nodes if nodes is not None else NODES
    today = today or datetime.date.today().isoformat()
    state = state if state is not None else load_state()
    drift, stale, unseen = [], [], []
    for nid in sorted(nodes):
        fp = fingerprint(nid, nodes, verify)
        rec = state.get(nid)
        if rec is None:
            unseen.append(nid)
            continue
        if rec["fingerprint"] != fp:
            # the pair moved. Did anyone look at it when it did?
            if rec.get("examined") == today:
                continue                      # examined today: the move is the examination
            drift.append({"node": nid, "was": rec["fingerprint"], "now": fp,
                          "last_examined": rec.get("examined"),
                          "why": "the claim, its status, its evidence or the label of the plant "
                                 "testing it has CHANGED since it was last examined - so "
                                 "nobody has checked that the two still match"})
            continue
        age = (datetime.date.fromisoformat(today)
               - datetime.date.fromisoformat(rec["examined"])).days
        if age > HORIZON_DAYS:
            stale.append({"node": nid, "last_examined": rec["examined"], "days": age})
    return drift, stale, unseen, cross_lane_citations(nodes)


def baseline(today=None):
    today = today or datetime.date.today().isoformat()
    state = {nid: {"fingerprint": fingerprint(nid), "examined": today} for nid in NODES}
    write_state(state)
    return state


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # A tiny tree standing in for the real one, so the plants do not depend on today's content.
    N0 = {"X": dict(kind="LEAF", parent=None, say="a claim", status="settled",
                    evidence="measured: 0.42"),
          "Y": dict(kind="LEAF", parent=None, say="another", status="open", evidence=None)}
    V0 = {"X": [("mod.py", "the plant label that tests the claim")]}
    today = "2026-11-18"
    st = {nid: {"fingerprint": fingerprint(nid, N0, V0), "examined": today} for nid in N0}

    # 1. nothing moved -> no drift. If a quiet tree refuses, the gate gets switched off.
    d, s, u, c = evaluate(today, dict(st), N0, V0)
    _plant("a tree that has not moved reported drift", not d)
    _plant("a tree that has not moved reported stale nodes", not s)

    # 2. THE MOTIVATING CASE, reconstructed: E4.4's EVIDENCE weakened while its claim, its
    #    status and its plant all stayed put, and the traceability gate passed it. This must
    #    catch that, or the mechanism does not address the failure it was built for.
    N1 = {k: dict(v) for k, v in N0.items()}
    N1["X"]["evidence"] = "measured: 0.42, but a later test found a granularity mismatch"
    d1, _, _, _ = evaluate(today + "x" if False else "2026-11-19", dict(st), N1, V0)
    _plant("evidence weakening with everything else unchanged was NOT caught - the exact E4.4 "
           "failure", any(x["node"] == "X" for x in d1))

    # 3. and the other three directions must each be caught, or the fingerprint is partial
    for field, newval in (("say", "a different claim"), ("status", "measured")):
        N2 = {k: dict(v) for k, v in N0.items()}
        N2["X"][field] = newval
        d2, _, _, _ = evaluate("2026-11-19", dict(st), N2, V0)
        _plant("a change to %r was not caught" % field, any(x["node"] == "X" for x in d2))
    V2 = {"X": [("mod.py", "a plant label that no longer mentions the claim")]}
    d3, _, _, _ = evaluate("2026-11-19", dict(st), N0, V2)
    _plant("the PLANT's label changing under a fixed claim was not caught",
           any(x["node"] == "X" for x in d3))

    # 4. examining it on the day it moved is not drift - otherwise every edit refuses and the
    #    mechanism is unusable.
    d4, _, _, _ = evaluate(today, dict(st), N1, V0)
    _plant("a node examined on the day it changed still reported drift",
           not any(x["node"] == "X" for x in d4))

    # 5. the HORIZON must fire, and must not fire inside it.
    old = {nid: {"fingerprint": fingerprint(nid, N0, V0), "examined": "2026-01-01"}
           for nid in N0}
    _, s5, _, _ = evaluate(today, dict(old), N0, V0)
    _plant("a node untouched since January was not reported stale", len(s5) == len(N0))
    recent = {nid: {"fingerprint": fingerprint(nid, N0, V0), "examined": "2026-11-17"}
              for nid in N0}
    _, s6, _, _ = evaluate(today, dict(recent), N0, V0)
    _plant("a node examined yesterday was reported stale", not s6)

    # 6. a node never seen before is UNSEEN, not drift - a new node has not drifted from
    #    anything and must not refuse a first run.
    d7, _, u7, _ = evaluate(today, {}, N0, V0)
    _plant("a never-seen node was reported as drift instead of unseen",
           not d7 and sorted(u7) == sorted(N0))

    # 7. the cross-lane list must find a citation and must not flag a node without one
    cl = cross_lane_citations({"A": dict(say="", status="", evidence="per the v4 lane"),
                               "B": dict(say="", status="", evidence="measured here")})
    _plant("a cross-lane citation was not listed", cl == ["A"])

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--today", default=None)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    if a.baseline:
        st = baseline(a.today)
        print("baselined %d nodes as examined %s"
              % (len(st), a.today or datetime.date.today().isoformat()))
        print("wrote " + STATE)
        raise SystemExit(0)
    drift, stale, unseen, cites = evaluate(a.today)
    print("RE-EVALUATION of the problem tree (claim vs the thing that tests it)")
    if unseen:
        print("  %d node(s) never baselined: %s" % (len(unseen), ", ".join(unseen[:8])))
    print("  %d node(s) with a cross-lane citation to re-confirm: %s"
          % (len(cites), ", ".join(cites) if cites else "none"))
    if stale:
        print("  %d node(s) not examined for over %d days:" % (len(stale), HORIZON_DAYS))
        for s in stale:
            print("    %-6s last examined %s (%d days)" % (s["node"], s["last_examined"],
                                                           s["days"]))
    if drift:
        print("\n  DRIFT - the claim or its test moved and nobody re-checked the pair:")
        for d in drift:
            print("    %-6s last examined %s" % (d["node"], d["last_examined"]))
            print("           %s" % d["why"])
        print("\n  Re-read each, then re-baseline with --baseline to record the examination.")
    else:
        print("  no drift")
    raise SystemExit(1 if drift else 0)
