"""UML x KAOS sections 3, 4 and 5: agents, «refine» links, and the reverse walk.

    py -X utf8 -I gatefly/uml_bridge.py              all three; non-zero on an unserved artefact
    py -X utf8 -I gatefly/uml_bridge.py --refine
    py -X utf8 -I gatefly/uml_bridge.py --reverse
    py -X utf8 -I gatefly/uml_bridge.py --agents
    py -X utf8 -I gatefly/uml_bridge.py --selftest

Built from UML_KAOS_PLAN.md, which marked sections 2, 3, 4 and 5 NOT BUILT. Three of the four
are here. SECTION 2 IS DELIBERATELY NOT BUILT and that is not an omission: its own stated
trigger is "worth building when a node has more than ~3 obstacles, or when two obstacles share
a cause", and the plan records that 19 of 25 nodes have none - so the gap is breadth, not
depth. Building it would contradict the condition written beside it. A plan whose conditions
are ignored the moment somebody is finishing things off is a plan nobody consults.

WHAT EACH SECTION IS FOR:

  3  AGENTS. KAOS assigns each leaf goal to an agent that can achieve it alone. Here the agents
     are real and distinct - this lane, the ratchet lane, the v4 lane, and THE LITERATURE. A
     leaf assigned to the literature is a prior-art search, not an experiment. Its trigger was
     "more than one lane edits the tree", which three parallel lanes now satisfy.

  4  «REFINE» LINKS. The goal tree and the use case model are two unconnected descriptions of
     the same work. A link from each tree node to the UC step that operationalises it answers
     one query: which use case step implements this goal, and does that step have a plant. The
     plan calls this the highest-value unbuilt item.

  5  THE REVERSE WALK. The existing gate walks goals and asks what realises them. This asks the
     other direction: which modules and run files serve NO node? That finds work nobody can say
     why they did, which is the complement of work nobody did. The plan says build it alongside
     4 because both need the same index.

WHAT THIS CANNOT DO. A «refine» link records that somebody judged a UC step to operationalise a
goal; it does not verify the step does. And the reverse walk finds artefacts no link claims -
an artefact may still be useful and merely unlinked, which is why an unserved artefact is
REPORTED rather than deleted.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from problem_tree import NODES

# ---------------------------------------------------------------- section 3: agents
# Who can settle this leaf ALONE. "literature" means a prior-art search rather than an
# experiment - the distinction section 3 exists to make.
THIS, RATCHET, V4, LIT, NOBODY = "gatefly", "ratchet", "v4", "literature", "unassigned"

AGENT_OF = {
 "E1.1": THIS,   "E1.2": LIT,    "E1.3": V4,
 "E2.1": LIT,    "E2.2": LIT,    "E2.3": LIT,
 "E3a.1": THIS,  "E3a.2": NOBODY, "E3a.3": THIS,
 "E3b.1": LIT,   "E3b.2": THIS,  "E3b.3": NOBODY,
 "E3c": THIS,    "E3d": THIS,
 "E4.1": THIS,   "E4.2": THIS,   "E4.3": THIS,  "E4.4": V4,
}

# ---------------------------------------------------------------- section 4: «refine»
# tree node -> the UC step that operationalises it. A node may have none; a UC with no node is
# what the reverse walk reports.
REFINE = {
 "E1.1": "UC-GF-1", "E1.2": "UC-GF-3", "E1.3": "UC-GF-3",
 "E2.1": "UC-GF-2", "E2.3": "UC-GF-2",
 "E3a.1": "UC-GF-5", "E3a.3": "UC-GF-5", "E3b.1": "UC-GF-3", "E3b.2": "UC-GF-3",
 "E3c": "UC-GF-5", "E3d": "UC-GF-5",
 "E4.1": "UC-GF-1", "E4.2": "UC-GF-3", "E4.3": "UC-GF-4", "E4.4": "UC-GF-3",
}

# ---------------------------------------------------------------- section 5: reverse walk
# Which module serves which UC. Anything absent is reported by the reverse walk.
SERVES = {
 "ttt.py": "UC-GF-1", "data_ttt.py": "UC-GF-1", "train_ttt.py": "UC-GF-1",
 "play.py": "UC-GF-1", "net.py": "UC-GF-1", "oracle.py": "UC-GF-1",
 "gate_math.py": "UC-GF-2", "gate_read.py": "UC-GF-2", "check_hover.py": "UC-GF-2",
 "metrics.py": "UC-GF-3", "retrain.py": "UC-GF-3", "preservation_shape.py": "UC-GF-3",
 "headroom.py": "UC-GF-3",
 "shrink.py": "UC-GF-4", "shrink_save.py": "UC-GF-4", "scale_guard.py": "UC-GF-4",
 "ladder.py": "UC-GF-5", "ladder_probe.py": "UC-GF-5", "mnk.py": "UC-GF-5",
 "pong.py": "UC-GF-6",
 # the method modules: they serve the PROCESS rather than a use case, which is itself a
 # finding the reverse walk should surface rather than hide behind a catch-all
 "problem_tree.py": None, "uml_kaos.py": None, "uml_bridge.py": None, "reevaluate.py": None,
 "prior_art.py": None, "art_graph.py": None, "plant_manifest.py": None, "status.py": None,
 "offline.py": None,
}


def uc_steps():
    """UC ids declared in the use case model, read from the file."""
    p = os.path.join(HERE, "UC_GATEFLY.md")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        return re.findall(r"^## (UC-GF-\d+)", f.read(), re.M)


def modules():
    return sorted(f for f in os.listdir(HERE) if f.endswith(".py"))


def terminal_nodes(nodes=None):
    nodes = nodes if nodes is not None else NODES
    has_child = {n: False for n in nodes}
    for n, v in nodes.items():
        if v.get("parent") in has_child:
            has_child[v["parent"]] = True
    return [n for n in sorted(nodes) if not has_child[n]]


def agents_report(nodes=None):
    nodes = nodes if nodes is not None else NODES
    out = {}
    for n in terminal_nodes(nodes):
        out[n] = AGENT_OF.get(n, NOBODY)
    return out


def refine_report(nodes=None):
    """-> (links, nodes with none, UC ids referenced that do not exist)."""
    nodes = nodes if nodes is not None else NODES
    steps = set(uc_steps())
    term = terminal_nodes(nodes)
    links = {n: REFINE[n] for n in term if n in REFINE}
    missing = [n for n in term if n not in REFINE]
    dangling = sorted({uc for uc in links.values() if steps and uc not in steps})
    return links, missing, dangling


def reverse_walk():
    """Artefacts serving no node of the tree. -> (unserved modules, unmapped modules)."""
    _, _, _ = refine_report()
    served_ucs = set(REFINE.values())
    unserved, unmapped = [], []
    for m in modules():
        if m not in SERVES:
            unmapped.append(m)
            continue
        uc = SERVES[m]
        if uc is None:
            continue                      # method module, serves the process
        if uc not in served_ucs:
            unserved.append((m, uc))
    return unserved, unmapped


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    steps = uc_steps()
    _plant("no UC steps were read from the use case model - the refine links point at nothing",
           len(steps) >= 5)

    # SECTION 4. A link must point at a UC that EXISTS, or the bridge records a judgement about
    # a step nobody wrote. This is the failure the reverse walk cannot see, because it looks
    # for artefacts with no goal rather than goals with no artefact.
    links, missing, dangling = refine_report()
    _plant("a refine link points at a UC step that does not exist: %s" % (dangling or "none"),
           not dangling)
    _plant("no refine links at all", len(links) >= 10)

    # every link target must be a real UC and every linked node a real terminal node
    term = set(terminal_nodes())
    bad = [n for n in links if n not in term]
    _plant("a refine link hangs off a node that is not terminal: %s" % (bad or "none"), not bad)

    # SECTION 3. Every terminal node must have an agent, and "unassigned" must be a STATED
    # value rather than a missing key - a node nobody owns should be visible, not absent.
    ag = agents_report()
    _plant("a terminal node has no agent entry", len(ag) == len(term))
    _plant("the unassigned agent is not used, so a node nobody owns would be invisible",
           NOBODY in set(ag.values()))
    # and the literature must be a real agent class, since that is the distinction section 3
    # exists to draw - a leaf assigned to it is a search, not an experiment
    _plant("no leaf is assigned to THE LITERATURE - then section 3 draws no distinction",
           LIT in set(ag.values()))

    # SECTION 5. The reverse walk must notice a module nobody has mapped. Tested on a synthetic
    # name rather than on the lane's current contents, so it tests the walk.
    saved = dict(SERVES)
    try:
        SERVES.pop("ttt.py", None)
        _, unmapped = reverse_walk()
        _plant("the reverse walk missed an unmapped module - work nobody can say why they did "
               "would stay invisible", "ttt.py" in unmapped)
    finally:
        SERVES.clear()
        SERVES.update(saved)
    _, unmapped2 = reverse_walk()
    _plant("the reverse walk reports unmapped modules when every module IS mapped: %s"
           % (unmapped2 or "none"), not unmapped2)

    # and a module serving a UC that no node refines must be REPORTED, which is the whole point
    unserved, _ = reverse_walk()
    print("  modules serving a UC that no tree node refines: %s"
          % (", ".join("%s(%s)" % (m, uc) for m, uc in unserved) or "none"))

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refine", action="store_true")
    ap.add_argument("--reverse", action="store_true")
    ap.add_argument("--agents", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    show_all = not (a.refine or a.reverse or a.agents)

    if a.agents or show_all:
        print("SECTION 3 - who can settle each leaf ALONE")
        by = {}
        for n, who in sorted(agents_report().items()):
            by.setdefault(who, []).append(n)
        for who in sorted(by):
            print("  %-12s %s" % (who, ", ".join(by[who])))
        print("    a leaf assigned to 'literature' is a PRIOR-ART SEARCH, not an experiment")
        print("    '%s' is stated, not missing: it is a node nobody can currently settle" % NOBODY)
        print()

    if a.refine or show_all:
        links, missing, dangling = refine_report()
        print("SECTION 4 - «refine»: which UC step operationalises each goal")
        for n, uc in sorted(links.items()):
            print("  %-7s refines  %s" % (n, uc))
        if missing:
            print("  NO UC STEP: %s" % ", ".join(missing))
            print("    these goals have no operationalisation in the use case model - either")
            print("    the step is unwritten or the goal is not this project's to settle")
        print()

    if a.reverse or show_all:
        unserved, unmapped = reverse_walk()
        print("SECTION 5 - the reverse walk: artefacts serving no node")
        print("  modules serving a UC no node refines : %s"
              % (", ".join("%s(%s)" % (m, uc) for m, uc in unserved) or "none"))
        print("  modules mapped to no UC at all       : %s" % (", ".join(unmapped) or "none"))
        print("    an unserved artefact is REPORTED, never deleted: it may be useful and")
        print("    merely unlinked, and this walk cannot tell those apart")
        raise SystemExit(1 if unmapped else 0)
