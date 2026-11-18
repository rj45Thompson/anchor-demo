"""KAOS refinement wrapped in UML traceability: does the hybrid find gaps neither finds alone?

    py -X utf8 -I gatefly/uml_kaos.py            the gap map; exits non-zero on a broken link
    py -X utf8 -I gatefly/uml_kaos.py --selftest

RJ asked whether UML combined with KAOS helps anything, and he is right that UML wraps KAOS -
I said otherwise and was wrong in a way worth correcting precisely:

  * WHAT I SAID: "in UML proper there is no goal tree; its decomposition is «include» and
    «extend»." True of stock use case diagrams and MISLEADING as a summary.
  * WHAT IS ALSO TRUE: UML's PROFILE mechanism - stereotypes, tagged values, constraints -
    exists exactly so another modelling language can be expressed in UML's metamodel, and KAOS
    has been published as a UML profile. SysML, itself a UML profile, already ships most of it:
    a Requirements diagram with «deriveReqt», «satisfy», «verify», «refine», «trace» and
    requirement containment.
  * WHAT UML STILL DOES NOT GIVE: OR-refinement. Containment and «deriveReqt» are AND-shaped.
    The OR is the edge that carries "this route alone would settle the parent", so it has to be
    added as a stereotype with its own semantics, and no stock tool will compute with it.

SO WHAT DOES THE HYBRID ADD? Two things, and they are different:

  1. FROM KAOS: OBSTACLES. KAOS derives failure modes by NEGATING a goal and refining the
     negation. The tree in problem_tree.py was built top-down from what was already known,
     which finds the obstacles someone thought of. Obstacle analysis is the systematic way to
     find the ones nobody did.
  2. FROM UML: TRACEABILITY LINKS THAT RESOLVE. «satisfy» points a goal at the thing that
     realises it; «verify» points it at the thing that tests it. A goal with no «satisfy» is
     unimplemented; with no «verify» it is untested. That turns "what is missing" from a
     judgement into a JOIN.

AND THE REASON TO BUILD IT HERE RATHER THAN DRAW IT: a traceability matrix whose links are
asserted is worth nothing - the classic failure is a matrix reporting full coverage over links
that went stale. So every link below is RESOLVED against the source: a «verify» link names a
plant, and the plant's own label must actually appear in the named file, or this refuses. That
is the only part of this file that could not be done on a whiteboard.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from problem_tree import NODES, children, solved, walk

# «satisfy»: the goal is REALISED by this artefact.
SATISFY = {
    "E4.1": [("oracle.py", "def grade"), ("oracle.py", "def sharpness")],
    "E4.3": [("scale_guard.py", "def comparable"), ("scale_guard.py", "def is_one_step")],
    "E4.4": [("preservation_shape.py", "def shape")],
    "E3a": [("retrain.py", "def memit_edit")],
    "E3b": [("retrain.py", "def retrain_corrected_corpus")],
    "E3d": [("retrain.py", "def grow"), ("retrain.py", "def prune")],
    "E3a.1": [("gate_math.py", "def crowding_all")],
    "E1.1": [("oracle.py", "def move_values")],
}

# «verify»: the goal is TESTED by this plant. (file, a verbatim fragment of the plant's label)
# Each fragment must actually appear in that file or this refuses - a link that cannot be
# resolved is the whole failure mode this file exists to prevent.
VERIFY = {
    "E4.1": [("oracle.py", "the upgraded oracle disagrees with ttt.py on"),
             ("oracle.py", "symmetry reduction changed")],
    "E4.3": [("scale_guard.py", "is not refused as one grid step"),
             ("ladder.py", "is separable from 16/16 at n=16")],
    "E4.4": [("preservation_shape.py", "a swap between equally correct answers was counted as damage")],
    "E3a.1": [("gate_math.py", "orthonormal directions show crowding"),
              ("gate_read.py", "duplicating every column did not raise the crowding fraction")],
    "E1.3": [("preservation_shape.py", "with no ties the movement count and the damage count")],
    "E3d": [("retrain.py", "growing changed the net's function")],
}

# KAOS OBSTACLES: the negation of the goal, refined. `mitigation` names what is done about it
# here, or says plainly that nothing is.
OBSTACLES = {
    "E4.1": [dict(say="The oracle is exact for GAMES and does not exist for language, so every "
                      "figure resting on it is conditional on a setting no benchmark has.",
                  mitigation="NONE. Stated as the lane's standing limit; it is why results are "
                             "offered as questions to the benchmark lanes rather than as "
                             "transfers.")],
    "E4.2": [dict(say="A ruler can separate arms on a game and still not separate them on "
                      "language, so a resolution result here may not transfer.",
                  mitigation="NONE. The sibling lane re-ran the MECHANISM on its own data "
                             "rather than taking this lane's numbers, which is the right "
                             "shape and is not a mitigation this lane controls.")],
    "E4.3": [dict(say="The grid only covers DECLARED measures, so a number nobody declared is "
                      "invisible to it.",
                  mitigation="scan_runs() is the net for exactly this; it found 27 undeclared "
                             "fields on its first run, including the same measure under a "
                             "different capitalisation."),
             dict(say="A declaration can drift from the measure it describes.",
                  mitigation="PARTIAL. The declaration sits beside the measure in source, "
                             "which makes drift visible, but nothing checks that a declared "
                             "carrier is the carrier the code actually has.")],
    "E3a": [dict(say="Every figure is at ONE site, so the editor's behaviour may be a property "
                     "of blocks.N.ffwd.net.2.weight rather than of editing.",
                 mitigation="NONE. Registered as the site-sweep experiment; not run.")],
    "E3a.3": [dict(say="A capacity ceiling may be reached without the measurement being able "
                       "to see it, if the edit count is small relative to the key space.",
                   mitigation="MEASURED AND NOW CROSSED: at 256 keys in a 256-dimensional key "
                              "space, crowding reached 0.9354 and Efficacy fell to 0.945 with "
                              "intervals separated from perfect.")],
    "E1.2": [dict(say="Preservation is always measured on a SAMPLE, and the sample can report "
                      "health while the unsampled complement is destroyed.",
                  mitigation="PARTIAL. In this setting the complement is finite and fully "
                             "enumerable - 4,520 positions - so competence is measured over "
                             "all of it. That is the thing a real benchmark cannot do.")],
}


def resolve_link(fname, needle):
    """A link resolves only if the file exists AND the fragment is in it."""
    p = os.path.join(HERE, fname)
    if not os.path.exists(p):
        return False, "no such file: %s" % fname
    with open(p, encoding="utf-8") as f:
        body = f.read()
    if needle not in body:
        return False, "%s does not contain %r" % (fname, needle[:50])
    return True, "ok"


def gap_map():
    """The join. For every node: is it realised, is it tested, has its negation been refined?"""
    rows = []
    for depth, nid, v, ok in walk("E"):
        sat = SATISFY.get(nid, [])
        ver = VERIFY.get(nid, [])
        obs = OBSTACLES.get(nid, [])
        broken = []
        for fn, sym in sat:
            good, why = resolve_link(fn, sym)
            if not good:
                broken.append(("satisfy", why))
        for fn, frag in ver:
            good, why = resolve_link(fn, frag)
            if not good:
                broken.append(("verify", why))
        gaps = []
        if not children(nid):                       # only leaves must be realised and tested
            if not sat:
                gaps.append("UNREALISED - no «satisfy» link to anything that does it")
            if not ver:
                gaps.append("UNTESTED - no «verify» link to a plant that could fail")
        if not obs:
            gaps.append("UNANALYSED - its negation has never been refined (no KAOS obstacle)")
        rows.append(dict(depth=depth, node=nid, kind=v["kind"], solved=ok, say=v["say"],
                         satisfy=len(sat), verify=len(ver), obstacles=len(obs),
                         gaps=gaps, broken=broken))
    return rows


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. EVERY DECLARED LINK MUST RESOLVE. This is the whole point: a traceability matrix whose
    #    links are asserted reports full coverage over links that went stale.
    bad = []
    for nid, items in list(SATISFY.items()) + list(VERIFY.items()):
        for fn, needle in items:
            good, why = resolve_link(fn, needle)
            if not good:
                bad.append((nid, why))
    _plant("a declared traceability link does not resolve: %s" % bad[:3], not bad)

    # 2. AND THE RESOLVER MUST BE ABLE TO SAY NO, or plant 1 passes over anything.
    good, _ = resolve_link("oracle.py", "a string that is certainly not in this file 94f1a2")
    _plant("the resolver accepted a fragment that is not in the file", not good)
    good2, _ = resolve_link("no_such_file_xyz.py", "anything")
    _plant("the resolver accepted a file that does not exist", not good2)

    # 3. every link names a node that exists in the tree
    bad = [n for n in list(SATISFY) + list(VERIFY) + list(OBSTACLES) if n not in NODES]
    _plant("a link names a node outside the tree: %s" % bad, not bad)

    # 4. THE GAP MAP MUST FIND GAPS AND MUST NOT FIND THEM EVERYWHERE. A map that flags
    #    everything is as useless as one that flags nothing.
    rows = gap_map()
    withg = [r for r in rows if r["gaps"]]
    _plant("the gap map found no gaps at all", len(withg) > 0)
    _plant("the gap map flagged every single node, so it cannot discriminate",
           len(withg) < len(rows))
    _plant("the gap map reports a broken link while plant 1 says all resolve",
           not any(r["broken"] for r in rows))
    print("  %d nodes, %d carry at least one gap" % (len(rows), len(withg)))

    # 5. a node this lane calls SETTLED must be tested by a plant, not merely measured. This is
    #    the check that would have caught "settled on the strength of one run".
    unver = [r["node"] for r in rows
             if NODES[r["node"]]["status"] == "settled" and not children(r["node"])
             and r["verify"] == 0]
    _plant("a node is settled with no «verify» link to a plant: %s" % unver, not unver)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    rows = gap_map()
    broken = [(r["node"], r["broken"]) for r in rows if r["broken"]]
    # A LIGHT-LOOP GATE, not only a report. It refuses on the two things that are claims rather
    # than gaps: a traceability link that does not resolve, and a node asserted SETTLED with no
    # plant behind it. An unrealised or untested node is honest work-not-done and does not
    # refuse; a settled claim with nothing testing it is the thing that slips through.
    unplanted = [r["node"] for r in rows
                 if NODES[r["node"]]["status"] == "settled" and not children(r["node"])
                 and r["verify"] == 0]
    print("KAOS refinement x UML traceability: the gap map")
    print("«satisfy» = realised by.  «verify» = tested by a plant.  obstacle = its negation, refined.\n")
    for r in rows:
        pad = "  " * r["depth"]
        flag = "" if not r["gaps"] else "   <- " + "; ".join(g.split(" - ")[0] for g in r["gaps"])
        print("%s%-6s sat %d ver %d obs %d%s" % (pad, r["node"], r["satisfy"], r["verify"],
                                                 r["obstacles"], flag))
    print()
    n_unreal = sum(1 for r in rows if any(g.startswith("UNREALISED") for g in r["gaps"]))
    n_untest = sum(1 for r in rows if any(g.startswith("UNTESTED") for g in r["gaps"]))
    n_unanal = sum(1 for r in rows if any(g.startswith("UNANALYSED") for g in r["gaps"]))
    print("  %d leaves UNREALISED, %d leaves UNTESTED, %d nodes UNANALYSED (no obstacle), "
          "of %d nodes" % (n_unreal, n_untest, n_unanal, len(rows)))
    if broken:
        print("\n  BROKEN LINKS - a traceability claim that does not resolve:")
        for nid, bs in broken:
            for kind, why in bs:
                print("    %-6s %-8s %s" % (nid, kind, why))
    p = os.path.join(HERE, "runs", "gap_map.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"rows": rows, "unrealised": n_unreal, "untested": n_untest,
                   "unanalysed": n_unanal}, f, indent=1)
    if unplanted:
        print("")
        print("  REFUSED - settled with no plant behind it: %s" % unplanted)
    print("wrote " + p)
    raise SystemExit(1 if (broken or unplanted) else 0)
