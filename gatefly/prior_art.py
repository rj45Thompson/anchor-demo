"""The prior-art gate: decompose an idea into ATOMS and refuse until each one is accounted for.

    py -X utf8 -I gatefly/prior_art.py                  report; exits non-zero on an unsearched atom
    py -X utf8 -I gatefly/prior_art.py --idea <id>
    py -X utf8 -I gatefly/prior_art.py --context implement --long-run
    py -X utf8 -I gatefly/prior_art.py --selftest

WHY A GATE AND NOT A HABIT. This lane registered E3c - "alternate a closed-form edit with
training confined to an isolated subspace" - as REGISTERED, NOT RUN, with the note that the
honest first step is finding out whether it is already published. Three sessions were started to
implement it and all three died before running. Nobody did the search. An hour of searching
found both halves already published, which would have changed what those sessions were for.

HOW THE DECOMPOSITION WORKS, and this is the part worth stating because it is not obvious:

  * Split where a DIFFERENT MECHANISM does the work, not where the narrative has steps. E3c
    reads as three steps in time (edit, train, repeat). That is not its atomization. Its atoms
    are a closed-form solve, a gradient projection, and a control policy - three different
    mathematical objects, which is also how the literature indexes them.
  * The test for a good atom: COULD ONE PAPER CONTAIN THIS ALONE? If no, it is too big or too
    small. "Edit a model well" fails the test. "Project the ridge update onto the null space of
    preserved keys" passes.
  * Atomize ACROSS LITERATURES. Atoms 1 and 2 of E3c sit in knowledge editing and in continual
    learning, which barely cite each other. An unclaimed seam is usually at a literature
    boundary, not inside one.

THE VERDICT LOGIC IS PATENT LAW'S, because patent examiners have done this for 150 years and
the structure is already correct (35 U.S.C. 102 and 103):

  * ANTICIPATED - ONE reference teaches EVERY atom IN THE SAME ARRANGEMENT. Then do not build
    it; use it.
  * COMBINATION - the atoms are covered, but across SEVERAL references. Then the atoms are free
    and only the ARRANGEMENT is yours to build. This is where E3c sits.
  * NOVEL ATOM - some atom is covered by NO reference. That is the lift, and it is the only
    part worth spending a session on.

ARRANGEMENT IS AN ATOM IN ITS OWN RIGHT. This is the correction the patent literature made to
my first version of this gate. Net MoneyIN v. VeriSign: a reference showing every limitation
does NOT anticipate unless they are "arranged or combined in the same way as recited in the
claim", and the PTAB's Biscotti held that stitching together distinct teachings from different
embodiments of ONE document is still not anticipation. So "all the pieces exist somewhere" is
not a reason to drop an idea - the arrangement can be the whole contribution. My first version
of this module would have graded E3c as fully covered and killed it.

ABSENCE IS A CLAIM AND CARRIES ITS SEARCH. An atom marked OPEN records the queries that failed
to find it, because "no prior art" without the search behind it is a guess. A miss is UNKNOWN
until a search is recorded, and NOT_SEARCHED refuses rather than reading as open.

WHAT THIS CANNOT DO. It records what a search found on one day. It cannot prove absence, cannot
read a paywalled paper, and cannot tell whether a cited method actually works - only that
somebody published the mechanism. Every OPEN verdict is perishable and dated.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

ANTICIPATED = "ANTICIPATED"      # one reference, every atom, same arrangement -> do not build
COVERED = "COVERED"              # this atom is published somewhere -> cite, do not build
OPEN = "OPEN"                    # searched, not found -> candidate for the lift
NOT_SEARCHED = "NOT_SEARCHED"    # refuses

# --------------------------------------------------------------------------- the register
# One entry per registered idea. Atoms are mechanisms, not steps.
IDEAS = {
 "edit-then-isolated-train-loop": {
  "says": "Alternate a closed-form edit with training CONFINED to an isolated subspace, so the "
          "training cannot disturb what the edit installed and the edit cannot undo what "
          "training learned. Problem-tree node E3c, an OR-child of E3 (INSTALL the change).",
  "searched": "2026-11-18",
  "tree_node": "E3c",
  "atoms": [
   {"id": "A1", "what": "Project the closed-form (ridge / MEMIT-style) update into a subspace "
                        "that leaves preserved knowledge untouched.",
    "verdict": COVERED,
    "refs": ["AlphaEdit: Null-Space Constrained Knowledge Editing for Language Models, "
             "Fang et al., ICLR 2025, arXiv:2410.02355 - projects each locate-then-edit update "
             "onto the null space of preserved-knowledge keys; reported +36.7% average over "
             "locate-then-edit methods from a projection added in one line",
             "BetaEdit: Null-Space Constrained Sequential Model Editing, arXiv:2605.09285 - "
             "addresses the finite-sample leakage in that null space, claims 10,000 sequential "
             "edits",
             "X-Edit, arXiv:2605.24932 - closed-form under a null-space constraint with a term "
             "protecting earlier edits (medical ViTs, not LLMs)"],
    "note": "Fully solved and better than anything this lane would have written. Take it."},

   {"id": "A2", "what": "Confine GRADIENT training to a subspace that cannot disturb stored "
                        "knowledge - a projected-gradient step rather than a projected solve.",
    "verdict": COVERED,
    "refs": ["Adam-NSCL: Training Networks in Null Space of Feature Covariance for Continual "
             "Learning, Wang et al., CVPR 2021, arXiv:2103.07113 - projects Adam's candidate "
             "update into the null space of the UNCENTERED FEATURE COVARIANCE, per linear "
             "layer, by SVD, updated incrementally",
             "OWM (Orthogonal Weights Modification), Zeng et al. 2019 - the earlier approximate "
             "generalised-inverse version Adam-NSCL reports beating by 4.88-8.3%",
             "LOKI: Memory-Free Null-Space Constrained Lifelong Knowledge Editing, "
             "arXiv:2606.19679 - projected gradient descent in the null space of the model "
             "weights, already inside the editing literature"],
    "note": "THE SEAM WORTH NOTICING: Adam-NSCL projects into the null space of the uncentered "
            "feature covariance. That is the SAME OBJECT MEMIT uses in its ridge solve and the "
            "same C this lane computes in retrain.covariance(). Two literatures using one "
            "matrix for opposite halves of this problem, barely citing each other."},

   {"id": "A3", "what": "THE ARRANGEMENT: alternate A1 and A2 in a loop, each step constrained "
                        "by what the other installed, rather than doing either once.",
    "verdict": OPEN,
    "queries": ["alternating closed-form model edit with gradient fine-tuning null space "
                "subspace sequential knowledge editing combine (extended)",
                "AlphaEdit null-space constrained knowledge editing language models"],
    "refs": [],
    "note": "No reference found that alternates them. Under the patent test this is a "
            "COMBINATION rather than an anticipation, and the arrangement is the claim. Cheap "
            "to build precisely because A1 and A2 are both published with code."},

   {"id": "A4", "what": "A stopping rule read from REMAINING CAPACITY in the subspace - decide "
                        "before spending an edit whether there is room for it.",
    "verdict": OPEN,
    "queries": ["knowledge editing capacity limit how many edits before collapse pigeonhole "
                "rank dimension bound sequential editing (extended)"],
    "refs": ["Empirical thresholds exist and no derived bound does: MEMIT reported collapsing "
             "after ~250 sequential edits while the same 10K batched avoids it; AlphaEdit "
             "eventually collapses too; one 2026 report has 3 of 5 model-method pairings at "
             "chance-level MMLU after 1,000 sequential edits WHILE EDIT SUCCESS STAYS AT 1.00. "
             "Explanations offered are condition-number growth (PRUNE), superimposed noise "
             "(arXiv:2505.07899), a Dimensional Collapse Hypothesis, and an SVD/spectral "
             "account (REVIVE). None gives an edit count from the geometry."],
    "note": "THIS IS THE LIFT AND IT IS THIS LANE'S OWN. Null-space projection solves "
            "PRESERVATION - do not damage what is already stored. It does NOT create CAPACITY "
            "for new keys, which is a different quantity. This lane measured the capacity side "
            "directly at the pigeonhole point: 256 keys into a 256-dimensional key space gives "
            "crowding 0.9354 against 0.0540 at n=16, Efficacy 0.945, competence 0.9880 -> "
            "0.6967, and the rate is the arithmetic's own - n identical keys each receive "
            "g(na)/n, so the share falls as 1/n and never reaches zero. The gate g(a_j - c_j) "
            "is a PER-EDIT read of how much room is left, available before the edit is spent. "
            "The literature's 'edit success 1.00 while MMLU is at chance' is the same "
            "phenomenon this lane measured as Efficacy 0.945 with competence 0.6967, reached "
            "independently."},
  ],
 },
}


# --------------------------------------------------------------------------- the verdict
def verdict_for(idea, ideas=None):
    """-> (verdict, reason, free_atoms, build_atoms, unsearched).

    Patent-shaped: one reference covering every atom in the same arrangement ANTICIPATES; atoms
    covered across several references make it a COMBINATION where only the arrangement is yours;
    an atom no reference covers is the NOVEL one and the only part worth a session.
    """
    ideas = ideas if ideas is not None else IDEAS
    atoms = ideas[idea]["atoms"]
    unsearched = [a["id"] for a in atoms if a["verdict"] == NOT_SEARCHED]
    if unsearched:
        return (NOT_SEARCHED,
                "atom(s) %s have no recorded search, so this idea's novelty is UNKNOWN and not "
                "open - search them or say plainly that nobody looked" % ", ".join(unsearched),
                [], [], unsearched)

    free = [a["id"] for a in atoms if a["verdict"] == COVERED]
    build = [a["id"] for a in atoms if a["verdict"] == OPEN]

    # Anticipation needs ONE reference teaching every atom. Atoms covered by DIFFERENT
    # references are a combination, which is not anticipation - Net MoneyIN - so the
    # arrangement survives as the contribution.
    if not build:
        refsets = [set(a["refs"]) for a in atoms]
        shared = set.intersection(*refsets) if refsets else set()
        if shared:
            return (ANTICIPATED,
                    "one reference teaches every atom: %s - do not build this, use it"
                    % sorted(shared)[0][:80], free, [], [])
        return (COVERED,
                "every atom is published but across DIFFERENT references, so the arrangement is "
                "still unclaimed - build only the arrangement", free, [], [])
    return (COVERED if free else OPEN,
            "%d atom(s) are published and free to cite (%s); %d are not covered by any "
            "reference found (%s) and are the only parts worth building"
            % (len(free), ", ".join(free) or "none", len(build), ", ".join(build)),
            free, build, [])


# ------------------------------------------------------------------- the contextual step
# RJ: "light loop needs a contextual analysis step." This gate is not free - it costs a human
# or an agent an hour of searching - so it fires on the shape of the run rather than always.
def needs_prior_art(context):
    """-> (fires, why). `context` is a dict of facts about the run, not a mode name.

    Deliberately keyed on facts a runner can read off its own task, because a mode name is a
    thing somebody has to remember to set and a fact is not.
    """
    reasons = []
    if context.get("about_to_implement"):
        reasons.append("the run is about to IMPLEMENT a registered idea, and the cost of "
                       "discovering the prior art afterwards is the whole implementation")
    if context.get("starting_sessions", 0) >= 1 and context.get("about_to_implement"):
        reasons.append("%d session(s) are being started for it, which multiplies that cost"
                       % context["starting_sessions"])
    if context.get("expected_minutes", 0) >= 30:
        reasons.append("the run is expected to take %d minutes, against an hour of searching"
                       % context["expected_minutes"])
    if context.get("crosses_literatures"):
        reasons.append("the idea spans more than one literature, which is where an atom is "
                       "most likely already solved and least likely to be cited")
    if not reasons:
        return False, ("no trigger: this is measurement or analysis of work already done, and "
                       "the gate would cost an hour to tell a finished run it was unoriginal")
    return True, reasons


# ------------------------------------------------- the join with the KAOS / UML gap analysis
# RJ: "we also have kaos and the uml gap thing but this could be done better for prior art."
# Correct, and they are DUALS rather than overlapping tools:
#
#     the KAOS/UML gap analysis asks  what does OUR system fail to satisfy  (internal)
#     the prior-art gate asks         what has SOMEBODY ELSE already solved (external)
#
# Either alone is half a map. Crossed, the cells mean different things and only one of them is
# an opportunity:
#
#     OPEN internally + COVERED externally   -> FREE LIFT. The mechanism exists and we are not
#                                               using it. Nobody looks in this cell, because
#                                               internal tracking says "open" and stops there.
#     OPEN internally + OPEN externally      -> genuine research; the only cell worth a session
#     BLOCKED internally + COVERED           -> check whether the published method actually
#                                               beats OUR measured blocker, or merely addresses
#                                               a different quantity with a similar name
#     settled internally + COVERED           -> we reinvented something. Worth knowing, cheap
#                                               to learn, and nothing to do about it now
#     anything + NOT_SEARCHED                -> UNKNOWN, and it refuses. This is most of any
#                                               tree, which is the point of measuring it.
EXTERNAL_MARKERS = ("Published (", "ICLR", "NeurIPS", "CVPR", "ACL", "EMNLP", "arXiv", "et al")


def external_status(nid, nodes, ideas=None):
    """-> (status, detail). Reads the node's own evidence for a literature citation, then the
    prior-art register. Never guesses: no citation and no register entry is NOT_SEARCHED."""
    ideas = ideas if ideas is not None else IDEAS
    for idea, v in ideas.items():
        if v.get("tree_node") == nid:
            return verdict_for(idea, ideas)[0], "prior-art register: %s" % idea
    ev = nodes[nid].get("evidence") or ""
    if any(m in ev for m in EXTERNAL_MARKERS):
        return COVERED, "a literature citation in the node's own evidence"
    return NOT_SEARCHED, "no citation in the evidence and no entry in the prior-art register"


def join(nodes=None, ideas=None):
    """Cross the internal (KAOS/UML) verdict with the external (prior-art) one."""
    if nodes is None:
        sys.path.insert(0, HERE)
        from problem_tree import NODES as nodes
    # TERMINAL means "has no children", not kind == LEAF. E3c is an OR node with no children -
    # a registered route nobody has run - and keying on LEAF excluded the one node that had
    # actually been searched from the report about what had been searched.
    has_child = {nid: False for nid in nodes}
    for nid, v in nodes.items():
        par = v.get("parent")
        if par in has_child:
            has_child[par] = True
    rows = []
    for nid in sorted(nodes):
        v = nodes[nid]
        if has_child[nid]:
            continue
        internal = v.get("status", "open")
        ev = v.get("evidence") or ""
        if "BLOCKER" in ev or "blocker" in ev:
            internal = "blocked"
        ext, detail = external_status(nid, nodes, ideas)
        rows.append({"node": nid, "internal": internal, "external": ext, "why": detail,
                     "say": v.get("say", "")[:64]})
    return rows


def join_report(rows):
    print("%-7s %-9s %-13s %s" % ("NODE", "INTERNAL", "EXTERNAL", "WHAT"))
    for r in rows:
        print("%-7s %-9s %-13s %s" % (r["node"], r["internal"], r["external"], r["say"]))
    print()
    lift = [r for r in rows if r["internal"] in ("open", "blocked") and r["external"] == COVERED]
    research = [r for r in rows if r["internal"] == "open" and r["external"] == OPEN]
    unknown = [r for r in rows if r["external"] == NOT_SEARCHED]
    reinvented = [r for r in rows if r["internal"] == "settled" and r["external"] == COVERED]
    print("  FREE LIFT      open or blocked here, published elsewhere : %d  %s"
          % (len(lift), ", ".join(r["node"] for r in lift) or "none"))
    print("  RESEARCH       open here, searched and not found         : %d  %s"
          % (len(research), ", ".join(r["node"] for r in research) or "none"))
    print("  REINVENTED     settled here, already published          : %d  %s"
          % (len(reinvented), ", ".join(r["node"] for r in reinvented) or "none"))
    print("  NEVER SEARCHED external status UNKNOWN, not open         : %d of %d"
          % (len(unknown), len(rows)))
    if unknown:
        print()
        print("  %d of %d leaves have never been checked against the literature. Each is a"
              % (len(unknown), len(rows)))
        print("  node this lane might be researching alone against a solved problem. That is")
        print("  the gap the KAOS/UML analysis cannot see, because it only reads inward.")
    return unknown


# --------------------------------------------------------- the two rules RJ asked for
# RJ: "Working on any item in the boneyard should require a prior art search and one search
# every few loops of the light loop? No?"  Yes, and they are different rules for different
# reasons, so they are separate functions.
#
#   THE GATE is blocking and cheap to state: no boneyard item may be WORKED without a
#   prior-art entry. This lane is the evidence for it - E3c sat REGISTERED, NOT RUN with the
#   note that the honest first step was a search, three sessions were started to implement it,
#   all three died, and nobody searched. An hour of searching found both halves published.
#
#   THE CADENCE is not a weaker version of the gate, it answers a different failure: AN OPEN
#   VERDICT ROTS. Today's search returned papers from 2605, 2606 and 2610 - after the searching
#   agent's own knowledge cutoff - so "nobody has done this" is a statement about one day. A
#   gate with no horizon lets a stale OPEN sit in the register looking like a current fact,
#   which is the same fault reevaluate.py was built for on the internal side. Same shape,
#   different direction, so the horizon is deliberately shorter: the literature moves faster
#   than this lane's own claims do.
HORIZON_DAYS = 30


def may_work_on(item, ideas=None, today=None):
    """-> (allowed, reason). The blocking gate: a boneyard item needs a searched entry."""
    ideas = ideas if ideas is not None else IDEAS
    today = today or datetime.date.today().isoformat()
    entry = ideas.get(item)
    if entry is None:
        return False, ("no prior-art entry for %r. An item with no search has UNKNOWN novelty, "
                       "not open novelty - search its atoms first, or record plainly that "
                       "nobody looked and why that is acceptable this time" % item)
    verdict = verdict_for(item, ideas)[0]
    if verdict == NOT_SEARCHED:
        return False, "the entry exists but has atom(s) with no recorded search"
    if verdict == ANTICIPATED:
        return False, ("one reference teaches every atom, so building this reinvents it - use "
                       "the published method instead")
    age = stale_days(item, ideas, today)
    # UNDATED IS NOT FRESH, and this gate had it backwards. stale_days() returns None when no
    # date is recorded, and the old guard read `age is not None and age > HORIZON` - so a
    # missing date fell straight through to the allow. A gate that FAILS OPEN on absent
    # evidence is worse than no gate, and it is the same two-states-one-label fault this lane
    # has been clearing all day, in the direction that hides it. The snipershot lane kept
    # UNDATED distinct from STALE in its own version and that is what exposed this.
    if age is None:
        return False, ("the entry records no search DATE, so its age is UNKNOWN and cannot be "
                       "called fresh. Undated is not the same as recent - record when the "
                       "search was run")
    if age > HORIZON_DAYS:
        return False, ("the search is %d days old against a %d-day horizon. An OPEN verdict is "
                       "a statement about the day it was made, and this field publishes faster "
                       "than that - re-search before building on it" % (age, HORIZON_DAYS))
    return True, "searched %s; build only the atoms no reference covers" % entry.get("searched")


def stale_days(item, ideas=None, today=None):
    """Age of the NEWEST evidence for this item, not of one field.

    Using a single `searched` field dates an idea by when somebody last touched the field, so an
    old citation sitting beside a fresh search reads at the wrong age. Taking the newest of the
    idea-level date and any per-atom dates means a re-searched atom refreshes what it actually
    refreshed. Returns None for UNDATED, which the gate must REFUSE rather than allow.
    """
    ideas = ideas if ideas is not None else IDEAS
    entry = ideas.get(item) or {}
    dates = [d for d in [entry.get("searched")]
             + [a.get("searched") for a in entry.get("atoms", [])] if d]
    when = max(dates) if dates else None
    if not when:
        return None
    today = today or datetime.date.today().isoformat()
    return (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(when)).days


def due_for_research(ideas=None, today=None, loops_since=None, every_n_loops=5):
    """The cadence: which entries are due a re-search, by age or by loop count.

    Returns the SINGLE most overdue entry rather than a list, because "one search every few
    loops" is a budget of one and a function that returns five turns a cadence back into a
    backlog.
    """
    ideas = ideas if ideas is not None else IDEAS
    today = today or datetime.date.today().isoformat()
    due = []
    for item in sorted(ideas):
        age = stale_days(item, ideas, today)
        if age is None:
            due.append((10 ** 6, item, "never searched"))
        elif age > HORIZON_DAYS:
            due.append((age, item, "searched %d days ago, horizon %d" % (age, HORIZON_DAYS)))
    if loops_since is not None and loops_since >= every_n_loops and not due:
        oldest = max(((stale_days(i, ideas, today) or 0), i) for i in ideas)
        due.append((oldest[0], oldest[1],
                    "%d loops since the last search and the budget is one every %d - take the "
                    "oldest entry even though it is inside the horizon"
                    % (loops_since, every_n_loops)))
    if not due:
        return None
    due.sort(reverse=True)
    return {"item": due[0][1], "why": due[0][2], "also_due": [d[1] for d in due[1:]]}


def report(idea, ideas=None):
    ideas = ideas if ideas is not None else IDEAS
    v = ideas[idea]
    verdict, reason, free, build, unsearched = verdict_for(idea, ideas)
    print("IDEA  %s" % idea)
    print("  %s" % v["says"])
    print("  searched %s" % v.get("searched", "NEVER"))
    print()
    for a in v["atoms"]:
        print("  [%-12s] %-3s %s" % (a["verdict"], a["id"], a["what"]))
        for r in a.get("refs", []):
            print("        ref: %s" % r)
        for q in a.get("queries", []):
            print("        searched: %s" % q)
        if a.get("note"):
            print("        -> %s" % a["note"])
        print()
    print("  VERDICT %s" % verdict)
    print("  %s" % reason)
    return verdict, unsearched


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    R1, R2 = "ref one", "ref two"

    # 1. NOT_SEARCHED must refuse. An atom nobody looked at must not read as novel - that is the
    #    failure mode this gate exists for, and it is what happened to E3c for a day.
    idea_u = {"x": {"says": "", "atoms": [
        {"id": "A1", "what": "", "verdict": COVERED, "refs": [R1]},
        {"id": "A2", "what": "", "verdict": NOT_SEARCHED, "refs": []}]}}
    v, why, _, _, un = verdict_for("x", idea_u)
    _plant("an UNSEARCHED atom did not refuse - absence would read as novelty", v == NOT_SEARCHED)
    _plant("the refusal does not name the unsearched atom", un == ["A2"])

    # 2. ONE reference covering every atom ANTICIPATES - do not build.
    idea_a = {"x": {"says": "", "atoms": [
        {"id": "A1", "what": "", "verdict": COVERED, "refs": [R1]},
        {"id": "A2", "what": "", "verdict": COVERED, "refs": [R1]}]}}
    v2 = verdict_for("x", idea_a)[0]
    _plant("one reference teaching every atom was not ANTICIPATED", v2 == ANTICIPATED)

    # 3. THE LOAD-BEARING ONE. The same atoms covered by DIFFERENT references must NOT be
    #    anticipated: the arrangement survives as the contribution. My first version of this
    #    module got this wrong and would have graded E3c as fully covered and killed it.
    #    Net MoneyIN: limitations present but not arranged as claimed is not anticipation.
    idea_c = {"x": {"says": "", "atoms": [
        {"id": "A1", "what": "", "verdict": COVERED, "refs": [R1]},
        {"id": "A2", "what": "", "verdict": COVERED, "refs": [R2]}]}}
    v3, why3, _, _, _ = verdict_for("x", idea_c)
    _plant("atoms covered by DIFFERENT references were read as ANTICIPATED - the arrangement "
           "would be discarded as already published", v3 != ANTICIPATED)
    _plant("the combination verdict does not say the arrangement is unclaimed",
           "arrangement" in why3)

    # 4. an OPEN atom must be reported as the thing to build, and a covered one must not be
    idea_o = {"x": {"says": "", "atoms": [
        {"id": "A1", "what": "", "verdict": COVERED, "refs": [R1]},
        {"id": "A2", "what": "", "verdict": OPEN, "refs": [], "queries": ["q"]}]}}
    _, _, free, build, _ = verdict_for("x", idea_o)
    _plant("a COVERED atom was not listed as free to cite", free == ["A1"])
    _plant("an OPEN atom was not listed as the part to build", build == ["A2"])

    # 5. the real register must be internally honest: every OPEN atom carries its queries, or
    #    it is an absence claim with no search behind it.
    bad = [(i, a["id"]) for i, v_ in IDEAS.items() for a in v_["atoms"]
           if a["verdict"] == OPEN and not a.get("queries")]
    _plant("an OPEN atom in the register has no recorded search - an absence claim with nothing "
           "behind it: %s" % (bad or "none"), not bad)
    bad2 = [(i, a["id"]) for i, v_ in IDEAS.items() for a in v_["atoms"]
            if a["verdict"] == COVERED and not a.get("refs")]
    _plant("a COVERED atom in the register cites nothing: %s" % (bad2 or "none"), not bad2)

    # 6. the contextual step must FIRE when implementing and must NOT fire on analysis, or it
    #    is either useless or always-on. Both directions, since one alone proves nothing.
    f1, _ = needs_prior_art({"about_to_implement": True, "starting_sessions": 3})
    _plant("the gate did not fire when about to implement with sessions starting", f1)
    f2, why2 = needs_prior_art({"about_to_implement": False, "expected_minutes": 2})
    _plant("the gate fired on a short analysis run - it would cost an hour to tell a finished "
           "run it was unoriginal", not f2)
    f3, _ = needs_prior_art({"crosses_literatures": True})
    _plant("the gate did not fire on an idea spanning two literatures", f3)

    # 7. and E3c itself must come out as a COMBINATION with A3/A4 to build - the answer that
    #    would have changed what three failed sessions were for.
    vE, whyE, freeE, buildE, _ = verdict_for("edit-then-isolated-train-loop")
    _plant("E3c did not resolve to COVERED/COMBINATION (got %s)" % vE, vE == COVERED)
    _plant("E3c's free atoms are not A1 and A2 (got %s)" % freeE, freeE == ["A1", "A2"])
    _plant("E3c's buildable atoms are not A3 and A4 (got %s)" % buildE, buildE == ["A3", "A4"])

    # 8. THE GATE must refuse an item with no entry at all. This is the E3c case exactly: three
    #    sessions were started to implement an idea nobody had searched.
    ok8, why8 = may_work_on("an-item-nobody-searched")
    _plant("working on an unsearched boneyard item was ALLOWED - the E3c failure repeats",
           not ok8)
    _plant("the refusal does not say UNKNOWN rather than open", "UNKNOWN" in why8)
    ok8b, _ = may_work_on("edit-then-isolated-train-loop", today="2026-11-18")
    _plant("a searched, in-horizon item was refused - the gate blocks everything", ok8b)

    # 9. and it must refuse an ANTICIPATED item, or the gate lets us reinvent a published method
    idea_a2 = {"z": {"says": "", "searched": "2026-11-18", "atoms": [
        {"id": "A1", "what": "", "verdict": COVERED, "refs": [R1]},
        {"id": "A2", "what": "", "verdict": COVERED, "refs": [R1]}]}}
    okA, whyA = may_work_on("z", idea_a2, today="2026-11-18")
    _plant("an ANTICIPATED item was allowed to be built - that is reinventing it", not okA)

    # 10. THE HORIZON. An OPEN verdict is a statement about one day: today's search returned
    #     papers postdating the searching agent's own knowledge cutoff, so a stale entry must
    #     refuse. Both directions, or it either never fires or always does.
    okS, whyS = may_work_on("edit-then-isolated-train-loop", today="2027-06-01")
    _plant("a search 195 days old was treated as current", not okS)
    _plant("the staleness refusal does not give the age", "days old" in whyS)
    okF, _ = may_work_on("edit-then-isolated-train-loop", today="2026-11-20")
    _plant("a 2-day-old search was refused as stale - the horizon fires on everything", okF)

    # 10b. UNDATED MUST REFUSE. This gate FAILED OPEN here: stale_days() returns None with no
    #      date recorded and the guard read `age is not None and age > HORIZON`, so a missing
    #      date went straight to the allow. Found because the snipershot lane kept UNDATED
    #      distinct from STALE in its version and said so.
    # two refs, so the verdict is a COMBINATION and reaches the DATE check - with one ref it
    # refuses as ANTICIPATED first and this plant would be testing the wrong guard
    idea_nd = {"u": {"says": "", "atoms": [
        {"id": "A1", "what": "", "verdict": COVERED, "refs": [R1]},
        {"id": "A2", "what": "", "verdict": COVERED, "refs": [R2]}]}}
    okU, whyU = may_work_on("u", idea_nd, today="2026-11-18")
    _plant("an entry with NO SEARCH DATE was allowed - the gate fails open on absent evidence",
           not okU)
    _plant("the undated refusal does not distinguish UNKNOWN age from too old",
           "UNKNOWN" in whyU)

    # 10c. and the age must come from the NEWEST evidence, so a re-searched atom refreshes what
    #      it refreshed instead of the whole entry reading at one field's age
    idea_mix = {"m": {"says": "", "searched": "2026-01-01", "atoms": [
        {"id": "A1", "what": "", "verdict": COVERED, "refs": [R1],
         "searched": "2026-11-18"}]}}
    _plant("the age came from the idea-level field instead of the newest evidence (got %s)"
           % stale_days("m", idea_mix, "2026-11-20"),
           stale_days("m", idea_mix, "2026-11-20") == 2)

    # 11. THE CADENCE must pick exactly one item, and must pick the oldest when the loop budget
    #     comes due with nothing over the horizon. A cadence that returns a list is a backlog.
    d1 = due_for_research(today="2027-06-01")
    _plant("nothing was due after 195 days", d1 is not None)
    _plant("the cadence returned a list instead of one item",
           isinstance(d1, dict) and isinstance(d1.get("item"), str))
    d2 = due_for_research(today="2026-11-20", loops_since=0, every_n_loops=5)
    _plant("something was due 2 days after a search with no loops elapsed", d2 is None)
    d3 = due_for_research(today="2026-11-20", loops_since=7, every_n_loops=5)
    _plant("the loop budget came due and nothing was picked", d3 is not None)
    _plant("the loop-budget reason does not explain why an in-horizon item was picked",
           d3 and "budget is one" in d3["why"])

    # 12. THE JOIN with the KAOS/UML gap analysis. A node with no citation and no register entry
    #     must read NOT_SEARCHED, never open - otherwise the gap analysis reports a research
    #     frontier that is partly just unread literature.
    N0 = {"P": dict(kind="LEAF", parent=None, say="cited", status="open",
                    evidence="Published (Basu, Pope & Feizi, ICLR 2021)"),
          "Q": dict(kind="LEAF", parent=None, say="uncited", status="open",
                    evidence="measured here: 0.42"),
          "R": dict(kind="LEAF", parent=None, say="blocked", status="open",
                    evidence="Settled AS A BLOCKER - it is real here")}
    rows = join(N0, IDEAS)
    by = {r["node"]: r for r in rows}
    _plant("a node citing published work was not read as externally COVERED",
           by["P"]["external"] == COVERED)
    _plant("a node with no citation was read as externally OPEN instead of NOT_SEARCHED",
           by["Q"]["external"] == NOT_SEARCHED)
    _plant("a node whose evidence names a BLOCKER was not marked blocked internally",
           by["R"]["internal"] == "blocked")

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--idea", default=None)
    ap.add_argument("--context", default=None,
                    help="implement | analyse - shorthand for the contextual step")
    ap.add_argument("--sessions", type=int, default=0)
    ap.add_argument("--minutes", type=int, default=0)
    ap.add_argument("--crosses-literatures", action="store_true")
    ap.add_argument("--join", action="store_true",
                    help="cross the KAOS/UML internal verdict with the external one")
    ap.add_argument("--may-work-on", default=None)
    ap.add_argument("--loops-since", type=int, default=None)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())

    if a.join:
        unknown = join_report(join())
        raise SystemExit(1 if unknown else 0)

    if a.may_work_on:
        ok, why = may_work_on(a.may_work_on)
        print("MAY WORK ON %r: %s" % (a.may_work_on, "YES" if ok else "NO"))
        print("  %s" % why)
        raise SystemExit(0 if ok else 1)

    if a.loops_since is not None:
        d = due_for_research(loops_since=a.loops_since)
        if d is None:
            print("no prior-art search due")
        else:
            print("DUE A RE-SEARCH: %s" % d["item"])
            print("  %s" % d["why"])
            if d["also_due"]:
                print("  also due (budget is one per cadence): %s" % ", ".join(d["also_due"]))
        raise SystemExit(0)

    if a.context:
        ctx = {"about_to_implement": a.context == "implement",
               "starting_sessions": a.sessions, "expected_minutes": a.minutes,
               "crosses_literatures": a.crosses_literatures}
        fires, why = needs_prior_art(ctx)
        print("CONTEXTUAL STEP: prior-art gate %s" % ("FIRES" if fires else "does not fire"))
        for w in ([why] if isinstance(why, str) else why):
            print("  - %s" % w)
        print()
        if not fires:
            raise SystemExit(0)

    rc = 0
    for idea in ([a.idea] if a.idea else sorted(IDEAS)):
        v, un = report(idea, IDEAS)
        if un:
            rc = 1
        print()
    if rc:
        print("REFUSING: an atom with no recorded search is UNKNOWN, not open.")
    raise SystemExit(rc)
