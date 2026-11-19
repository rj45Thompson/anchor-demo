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
    "E4.2": [dict(say="THE RULER MAY NOT BE THE CAUSE AT ALL. If a model answers almost none "
                      "of the downstream probes correctly before any intervention, a metric "
                      "that fails to separate arms is being asked to measure damage to "
                      "knowledge that was never there. Measured by the v4 lane on its own "
                      "probes; this lane CANNOT see it, because its net is competent on "
                      "1.0000 of its positions by construction.",
                  mitigation="NONE AVAILABLE HERE. Any lane reporting a resolution failure "
                             "must report its BASE COMPETENCE on the same probes beside it, "
                             "or the two causes are indistinguishable."),
             dict(say="A ruler can separate arms on a game and still not separate them on "
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
    "E4.4": [dict(say="The answer SET itself can be incomplete, and not only by missing a "
                      "surface alias: a GRANULARITY MISMATCH - a correct answer at a different "
                      "level of specificity, absent from the set's vocabulary entirely - "
                      "passes every alias detector either lane had.",
                  mitigation="NONE. The node was un-settled on this. Counting against the set "
                             "is necessary and is not sufficient while the set can be wrong."),
             dict(say="A node can be SETTLED on evidence that later weakens, and this gate "
                      "would not catch it: it checks that a settled node has a PLANT, not that "
                      "the plant still covers what the node claims. The first instance was "
                      "this very node, caught by another lane rather than by the gate.",
                  mitigation="REGISTERED, NOT BUILT: the periodic re-evaluation mechanism. "
                             "This obstacle is its motivating case.")],
    "E1.2": [dict(say="Preservation is always measured on a SAMPLE, and the sample can report "
                      "health while the unsampled complement is destroyed.",
                  mitigation="PARTIAL. In this setting the complement is finite and fully "
                             "enumerable - 4,520 positions - so competence is measured over "
                             "all of it. That is the thing a real benchmark cannot do.")],
}


LINE_SHAPED = re.compile(r"^\s*(?:line\s*)?\d+\s*(?:[-:,]\s*\d+\s*)?$|:\d+$|#L\d+")


# ROT DEFENCE, the ratchet lane's real objection: "an unanalysed count that never moves is
# indistinguishable from a tree nobody has opened in a month." Per-node last-examined date, and
# the oldest is printed every run. Dated the day each node was last written or revised.
EXAMINED = {nid: "2026-11-18" for nid in NODES}


def resolve_link(fname, needle, lane="gatefly"):
    """A link resolves only if the file exists AND the SYMBOL is in it.

    SYMBOL ONLY, NEVER A POSITION - the ratchet lane's condition, from a measurement rather
    than a preference: its own citations drifted 149 -> 166 -> 205 -> 303 inside a single
    session, and it went symbol-only and paid for it (verified citations fell 7 to 5, recorded
    rather than hidden). A cross-lane matrix keyed on line numbers rots within a day, and the
    rot lands in a lane that cannot see the tree. So a position-shaped link is REFUSED here
    rather than resolved, whatever it would have matched.
    """
    if LINE_SHAPED.search(needle.strip()):
        return False, ("POSITION-SHAPED LINK REFUSED: %r. Links resolve by symbol - a plant "
                       "label or a function name - never by line number." % needle[:40])
    p = fname if os.path.isabs(fname) else os.path.join(HERE, fname)
    if not os.path.exists(p):
        return False, "no such file: %s (lane %s)" % (fname, lane)
    with open(p, encoding="utf-8") as f:
        body = f.read()
    if needle not in body:
        return False, "%s does not contain %r" % (fname, needle[:50])
    return True, "ok"


# «refine»: the goal node is OPERATIONALISED by this use case step or requirement, in
# gatefly/UC_GATEFLY.md. This is the half of the bridge that was missing: the goal tree and the
# use case model were two unconnected descriptions of the same work, so a use case step could
# be written, the goal move on, and the step never be revisited. A refine-link resolves against
# the UC file by symbol, exactly like the others.
UC_FILE = "UC_GATEFLY.md"
REFINE = {
    "E4.1": ["UC-GF-1", "REQ-GF-1a"],
    "E4.2": ["UC-GF-3", "REQ-GF-3a"],
    "E4.3": ["REQ-GF-2c", "REQ-GF-2d"],
    "E4.4": ["REQ-GF-4a"],
    "E3a": ["UC-GF-3", "REQ-GF-3b"],
    "E3b": ["UC-GF-3", "REQ-GF-3c"],
    "E3d": ["UC-GF-5", "REQ-GF-5a", "REQ-GF-5c"],
    "E3a.1": ["UC-GF-5", "REQ-GF-5b"],
    "E2.1": ["UC-GF-2", "REQ-GF-2b"],
    "E1.1": ["UC-GF-1"],
    "E1.3": ["REQ-GF-4a"],
}

# The bridge has four joins. A join with nothing in it is not "clean", it is UNBUILT, and the
# check below reports the difference rather than letting an empty table read as full coverage.
BRIDGE = {
    "goal -> artefact  («satisfy»)": lambda: SATISFY,
    "goal -> plant     («verify»)": lambda: VERIFY,
    "goal -> use case  («refine»)": lambda: REFINE,
    "obstacle -> its mitigation": lambda: {k: [o for o in v if o.get("mitigation")]
                                           for k, v in OBSTACLES.items()},
}


# Which lane each linked artefact belongs to. A link into ANOTHER lane refuses THIS lane's
# commit and only REPORTS to the lane that moved the symbol - never the reverse. The ratchet
# lane's condition, and it is right: otherwise this lane's model of the problem becomes a veto
# on another lane's refactors, and the person who can fix the link is not the person blocked.
LANE_OF = {}          # fname -> lane name; anything unlisted is this lane's own


def lane_of(fname):
    return LANE_OF.get(fname, "gatefly")


def gap_map():
    """The join. For every node: is it realised, is it tested, has its negation been refined?"""
    rows = []
    for depth, nid, v, ok in walk("E"):
        sat = SATISFY.get(nid, [])
        ver = VERIFY.get(nid, [])
        obs = OBSTACLES.get(nid, [])
        ref = REFINE.get(nid, [])
        broken, foreign = [], []
        for sym in ref:
            good, why = resolve_link(UC_FILE, sym)
            if not good:
                broken.append(("refine", why))
        for kind, items in (("satisfy", sat), ("verify", ver)):
            for fn, sym in items:
                good, why = resolve_link(fn, sym, lane_of(fn))
                if good:
                    continue
                # a broken link ALWAYS refuses the tree owner - this lane - and is additionally
                # REPORTED to the lane that owns the artefact when that is someone else
                broken.append((kind, why))
                if lane_of(fn) != "gatefly":
                    foreign.append((lane_of(fn), fn, sym))
        gaps = []
        if not children(nid):                       # only leaves must be realised and tested
            if not sat:
                gaps.append("UNREALISED - no «satisfy» link to anything that does it")
            if not ver:
                gaps.append("UNTESTED - no «verify» link to a plant that could fail")
            if not ref:
                gaps.append("UNOPERATIONALISED - no «refine» link to a use case step")
        if not obs:
            gaps.append("UNANALYSED - its negation has never been refined (no KAOS obstacle)")
        rows.append(dict(depth=depth, node=nid, kind=v["kind"], solved=ok, say=v["say"],
                         satisfy=len(sat), verify=len(ver), refine=len(ref),
                         obstacles=len(obs),
                         gaps=gaps, broken=broken, foreign=foreign,
                         examined=EXAMINED.get(nid)))
    return rows


def bridge_report():
    """Is the bridge actually bridged? Per join: how many nodes use it, and does it resolve.

    "Keep an eye on that" (RJ) means this is a standing readout rather than a one-off. A join
    with an empty table is UNBUILT, which is a different statement from a join whose links all
    resolve, and the two must never print the same.
    """
    rows = []
    for name, get in BRIDGE.items():
        table = get()
        used = [k for k, v in table.items() if v]
        rows.append({"join": name, "nodes_using_it": len(used),
                     "of_nodes": len(NODES),
                     "state": "UNBUILT" if not used else "in use"})
    return rows


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    premises = []

    def _premise(label, holds, consequence):
        print(("  premise  " if holds else "  EXPIRED  ") + label)
        if not holds:
            premises.append((label, consequence))

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
    # A PREMISE, not a plant: it passes only while gaps REMAIN, so closing every gap - the
    # stated goal of the gap map - would turn it red. Third of three this lane catalogued as
    # premise-shaped in its own review and then left as plants anyway.
    _premise("the gap map still finds gaps to close", len(withg) > 0,
             "every goal now has a satisfying mechanism, so the gap map has nothing left to "
             "report - retire this check and the gap row with it rather than keeping a green "
             "check over an empty question")
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

    # 6. SYMBOL ONLY. A position-shaped link must be REFUSED outright, not resolved - and the
    #    refusal must not swallow a legitimate symbol that happens to contain digits.
    for bad_needle in ("166", "line 205", "gate_math.py:149", "#L303", " 42 "):
        good, why = resolve_link("gate_math.py", bad_needle)
        _plant("a position-shaped link %r was not refused" % bad_needle,
               not good and "POSITION-SHAPED" in why)
    good, _ = resolve_link("gate_math.py", "def crowding_all")
    _plant("the position refusal swallowed a real symbol", good)
    good, _ = resolve_link("net.py", "blocks.0.ffwd.net.2.weight")
    _plant("the position refusal rejected a symbol containing digits", good)

    # 7. REFUSAL OWNERSHIP. A broken link into ANOTHER lane must refuse this lane AND be
    #    reported to the owner; a broken link into this lane must not be reported outward.
    saved = dict(LANE_OF)
    savedV = {k: list(v) for k, v in VERIFY.items()}
    try:
        LANE_OF["ratchet_stub.py"] = "ratchet"
        VERIFY["E4.1"] = VERIFY["E4.1"] + [("ratchet_stub.py", "a symbol that is not there")]
        rows = {r["node"]: r for r in gap_map()}
        r = rows["E4.1"]
        _plant("a broken CROSS-LANE link did not refuse this lane", bool(r["broken"]))
        _plant("a broken cross-lane link was not reported to its owner",
               any(l == "ratchet" for l, _, _ in r["foreign"]))
        VERIFY["E4.1"] = savedV["E4.1"] + [("gate_math.py", "a symbol that is not there")]
        r2 = {x["node"]: x for x in gap_map()}["E4.1"]
        _plant("a broken OWN-LANE link was reported outward as another lane's",
               bool(r2["broken"]) and not r2["foreign"])
    finally:
        LANE_OF.clear(); LANE_OF.update(saved)
        VERIFY.clear(); VERIFY.update(savedV)

    # 8. ROT DEFENCE: every node must carry a last-examined date, or the oldest is meaningless.
    missing = [n for n in NODES if n not in EXAMINED]
    _plant("a node has no last-examined date: %s" % missing, not missing)

    print("  selftest: %d plant(s) checked, %d failed; %d premise(s) expired"
          % (len(checked), len(fails), len(premises)))
    if premises:
        print()
        print("  PREMISES EXPIRED - not failures. Retire these rather than keeping them green:")
        for label, consequence in premises:
            print("    - %s" % label)
            print("      -> %s" % consequence)
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
    oldest = min(EXAMINED.values()) if EXAMINED else "never"
    stale = sum(1 for v in EXAMINED.values() if v == oldest)
    print("  oldest node last examined %s (%d node(s) at that date) - a count that never moves "
          "is a tree nobody has opened" % (oldest, stale))
    try:
        import scale_guard as _sg
        miss, tot = _sg.unreached()
        print("  %d of %d numeric field names in runs/ are reached by NO pattern of the scale "
              "grid - a limitation in a docstring is one nobody acts on" % (len(miss), tot))
    except Exception as ex:
        print("  could not count unreached fields: %r" % (ex,))
    print()
    print("  THE BRIDGE - four joins between KAOS refinement and UML traceability:")
    for b in bridge_report():
        print("    %-34s %-8s %2d of %d nodes"
              % (b["join"], b["state"], b["nodes_using_it"], b["of_nodes"]))
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
