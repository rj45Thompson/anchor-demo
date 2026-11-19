"""The prior-art node graph for model editing: mechanisms as nodes, works as citations on them.

    py -X utf8 -I gatefly/art_graph.py                 the graph and the frontier
    py -X utf8 -I gatefly/art_graph.py --frontier       only mechanisms no work teaches
    py -X utf8 -I gatefly/art_graph.py --domain tami    the scope rule
    py -X utf8 -I gatefly/art_graph.py --selftest

RJ: "search every prior art on editing and then all in a node graph and see if we can fill it
in once and only new data be new branches in other works, dedup full in the node graph."

THE SHAPE THAT MAKES THAT WORK. A reading list grows by one row per paper and tells you nothing;
this graph is keyed on MECHANISMS, and a work is a citation hanging off the mechanisms it
teaches. So:

  * FILL IT IN ONCE - the mechanism node is canonical. ROME and MEMIT both teach
    locate-then-edit; that is ONE node with two citations, not two rows.
  * ONLY NEW DATA BECOMES A NEW BRANCH - a later work either attaches to existing nodes
    (teaches) or introduces a node nobody had (adds). AlphaEdit's delta is exactly one new
    branch, M1.3, hung off MEMIT's M1.2. Its other content attaches to what is already there.
  * DEDUP IS ENFORCED, not intended - a plant refuses two mechanism nodes with the same
    normalised text, and refuses a work claiming to ADD a mechanism an earlier work already
    taught. Without that the graph silently becomes the reading list it replaced.

AND THE FRONTIER FALLS OUT FOR FREE: a mechanism node that NO work teaches is either our own
idea or a gap in the literature. That is the only part worth spending a session on, and it is a
query against the graph rather than a judgement.

SCOPE, which RJ raised and which matters more than it looks: "Tami is a game it has none it has
requirements." A prior-art gate is for work whose claim is a NOVEL MECHANISM. A game's work
items are requirements - they are not claims about the state of the art, nobody has published
"the inventory screen should show stack counts", and demanding a literature search before a
bug fix would be a tax that teaches the team to route around the gate. So the gate reports NOT
APPLICABLE for a product domain and says what governs instead. A gate that fires everywhere
gets disabled everywhere.

WHAT THIS CANNOT DO. It records what searches on one day found, from result summaries rather
than full texts in most cases - every citation here is a POINTER TO CHECK, not a read paper. It
cannot tell whether a method works, only that someone published the mechanism. A frontier node
means "no work found", which is an absence claim and carries the queries that failed.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------- mechanisms
# id -> (parent, what). Canonical: ONE node per mechanism however many works teach it.
MECH = {
 "M0":     (None,   "Change a model's stored knowledge without full retraining"),

 "M1":     ("M0",   "Locate-then-edit: solve for a weight delta at a located site"),
 "M1.1":   ("M1",   "Rank-one update at a single MLP site"),
 "M1.2":   ("M1",   "Batched closed-form ridge solve over many keys at once"),
 "M1.3":   ("M1.2", "Project the closed-form update into the null space of preserved keys"),
 "M1.3.1": ("M1.3", "Correct the finite-sample leakage in an estimated null space"),
 "M1.3.2": ("M1.3", "Carry earlier edits explicitly in the solve, not just preserved keys"),
 "M1.3.3": ("M1.3", "Align null-space projections across separately edited copies, then merge"),
 "M1.4":   ("M1",   "Subspace-aware key-value mapping rather than a single shared site"),

 "M2":     ("M0",   "Meta-learning: a hypernetwork predicts the weight update"),
 "M3":     ("M0",   "External memory or retrieval instead of changing weights"),

 "M4":     ("M0",   "Constrain GRADIENT training so it cannot disturb stored knowledge"),
 "M4.1":   ("M4",   "Project the optimiser's update into the null space of feature covariance"),
 "M4.2":   ("M4",   "Approximate generalised inverse of the feature matrix"),
 "M4.3":   ("M4",   "Projected gradient descent in the null space of the weights, memory-free"),
 "M4.4":   ("M4",   "Localised fine-tuning with breadth-first mini-batch aggregation"),

 "M5":     ("M0",   "Diagnose or mitigate collapse under many sequential edits"),
 "M5.1":   ("M5",   "Attribute collapse to growth in the matrix condition number"),
 "M5.2":   ("M5",   "Attribute it to superimposed noise from irrelevant knowledge"),
 "M5.3":   ("M5",   "Attribute it to edits propagating along fragile representation directions"),
 "M5.4":   ("M5",   "Attribute it to SVD / spectral structure of the accumulated update"),

 "M6":     ("M0",   "Measure whether an edit did what was asked and nothing else"),
 "M6.1":   ("M6",   "A lifelong benchmark large enough to show the limit"),
 "M6.2":   ("M6",   "Decompose a claim into atomic facts and verify each separately"),
 "M6.3":   ("M6",   "Measure the quality of that decomposition itself"),

 # ---- the frontier. No work found for these; the queries that failed are recorded below.
 "M7":     ("M0",   "ALTERNATE a null-space-projected closed-form edit with null-space-confined "
                    "gradient training, each step constrained by what the other installed"),
 "M8":     ("M5",   "Read REMAINING CAPACITY before spending an edit: a per-edit number saying "
                    "how much room is left in the subspace, rather than an empirical threshold "
                    "discovered after collapse"),
}

# --------------------------------------------------------------------------- works
# A work lists what it TEACHES (attaches to existing nodes) and what it ADDS (its delta, the
# only thing that becomes a new branch).
WORKS = {
 "ROME":       {"cite": "Meng et al., Locating and Editing Factual Associations in GPT, "
                        "NeurIPS 2022", "teaches": ["M1"], "adds": ["M1.1"]},
 "MEMIT":      {"cite": "Meng et al., Mass-Editing Memory in a Transformer, ICLR 2023",
                "teaches": ["M1", "M1.1"], "adds": ["M1.2"]},
 "AlphaEdit":  {"cite": "Fang et al., AlphaEdit: Null-Space Constrained Knowledge Editing for "
                        "Language Models, ICLR 2025, arXiv:2410.02355",
                "teaches": ["M1", "M1.2"], "adds": ["M1.3"]},
 "BetaEdit":   {"cite": "BetaEdit: Null-Space Constrained Sequential Model Editing, "
                        "arXiv:2605.09285", "teaches": ["M1.3"], "adds": ["M1.3.1"]},
 "X-Edit":     {"cite": "X-Edit: Exact, Explicit and Explainable Null-Space Editing for Medical "
                        "Vision Transformers, arXiv:2605.24932",
                "teaches": ["M1.3"], "adds": ["M1.3.2"]},
 "FedAlphaEdit": {"cite": "FedAlphaEdit: Null-Space-Aligned Merging for Collaborative Knowledge "
                          "Editing, arXiv:2610.11033", "teaches": ["M1.3"], "adds": ["M1.3.3"]},
 "SUIT":       {"cite": "SUIT: Knowledge Editing with Subspace-Aware Key-Value Mappings, "
                        "arXiv:2509.24502", "teaches": ["M1"], "adds": ["M1.4"]},
 "MEND":       {"cite": "Mitchell et al., Fast Model Editing at Scale, ICLR 2022",
                "teaches": ["M0"], "adds": ["M2"]},
 "SERAC":      {"cite": "Mitchell et al., Memory-Based Model Editing at Scale, ICML 2022",
                "teaches": ["M0"], "adds": ["M3"]},
 "Adam-NSCL":  {"cite": "Wang et al., Training Networks in Null Space of Feature Covariance for "
                        "Continual Learning, CVPR 2021, arXiv:2103.07113",
                "teaches": ["M4"], "adds": ["M4.1"]},
 "OWM":        {"cite": "Zeng et al., Continual learning of context-dependent processing in "
                        "neural networks, Nature MI 2019", "teaches": ["M4"], "adds": ["M4.2"]},
 "LOKI":       {"cite": "LOKI: Memory-Free Null-Space Constrained Lifelong Knowledge Editing, "
                        "arXiv:2606.19679", "teaches": ["M4", "M1.3"], "adds": ["M4.3"]},
 "LocFT-BF":   {"cite": "Fine-tuning Done Right in Model Editing, arXiv:2509.22072",
                "teaches": ["M4"], "adds": ["M4.4"]},
 "PRUNE":      {"cite": "PRUNE, via the sequential-editing collapse literature",
                "teaches": ["M5"], "adds": ["M5.1"]},
 "SuperNoise": {"cite": "On the Superimposed Noise Accumulation Problem in Sequential Knowledge "
                        "Editing, arXiv:2505.07899", "teaches": ["M5"], "adds": ["M5.2"]},
 "DimCollapse": {"cite": "Dimensional Collapse Hypothesis, via the collapse literature",
                 "teaches": ["M5"], "adds": ["M5.3"]},
 "REVIVE":     {"cite": "Spectral Characterization and Mitigation of Sequential Knowledge "
                        "Editing Collapse, ACL 2026", "teaches": ["M5"], "adds": ["M5.4"]},
 "WikiBigEdit": {"cite": "Understanding the Limits of Lifelong Knowledge Editing in LLMs, "
                         "arXiv:2503.05683", "teaches": ["M6", "M5"], "adds": ["M6.1"]},
 "FActScore":  {"cite": "Min et al., FActScore: Fine-grained Atomic Evaluation of Factual "
                        "Precision, EMNLP 2023, arXiv:2305.14251",
                "teaches": ["M6"], "adds": ["M6.2"]},
 "DecompScore": {"cite": "Core: Robust Factual Precision with Informative Sub-claim "
                         "Identification, *SEM 2024", "teaches": ["M6.2"], "adds": ["M6.3"]},
}

# An absence is a claim and carries the search that failed to refute it.
FRONTIER_QUERIES = {
 "M7": ["alternating closed-form model edit with gradient fine-tuning null space subspace "
        "sequential knowledge editing combine (extended)",
        "AlphaEdit null-space constrained knowledge editing language models"],
 "M8": ["knowledge editing capacity limit how many edits before collapse pigeonhole rank "
        "dimension bound sequential editing (extended)"],
}

# What this lane holds for a frontier node, so the lift is stated rather than implied.
OURS = {
 "M7": "This lane has both parents already implemented against an EXACT oracle: the closed-form "
       "ridge edit (gatefly/retrain.py memit_edit) and the same covariance C that M4.1 projects "
       "into. The arrangement is cheap here precisely because M1.3 and M4.1 are published.",
 "M8": "gate_j = g(a_j - c_j), with a_j addressability and c_j crowding as a Schur complement "
       "against the other keys - a per-edit read available BEFORE the edit is spent. Measured "
       "at the pigeonhole point: 256 keys in a 256-dim key space gives crowding 0.9354 against "
       "0.0540 at n=16, Efficacy 0.945, competence 0.9880 -> 0.6967, and the rate is the "
       "arithmetic's own since n identical keys each receive g(na)/n. The M5 family explains "
       "collapse AFTER it happens; none of it gives a number beforehand.",
}

# --------------------------------------------------------------------------- scope
# RJ: "Tami is a game it has none it has requirements."
DOMAINS = {
 "gatefly":  {"kind": "research", "governs": "the prior-art gate: the claim is a novel mechanism"},
 "editing":  {"kind": "research", "governs": "the prior-art gate"},
 "tami":     {"kind": "product",
              "governs": "REQUIREMENTS, not prior art. A game's work items are requirements and "
                         "bug rows; nobody publishes 'the inventory screen should show stack "
                         "counts', so there is no literature for a search to find. Use the use "
                         "case model and KNOWN_BUGS. Demanding a search here would be a tax that "
                         "teaches the team to route around the gate."},
 "anchor-demo-site": {"kind": "product",
                      "governs": "REQUIREMENTS. It is a page that has to render correctly."},
}


def applies_to(domain):
    """-> (applies, governs). Unknown domains REFUSE rather than defaulting either way:
    defaulting to 'research' taxes product work, defaulting to 'product' silently exempts
    research work from the gate, and the second is the failure this gate exists to prevent."""
    d = DOMAINS.get(domain)
    if d is None:
        return None, ("unknown domain %r - say whether its work items are novel-mechanism "
                      "claims (prior art governs) or requirements (they do not) before the gate "
                      "can answer" % domain)
    return d["kind"] == "research", d["governs"]


# --------------------------------------------------------------------------- queries
def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def taught_by():
    """mechanism -> [work ids], from both teaches and adds."""
    out = {m: [] for m in MECH}
    for w, v in WORKS.items():
        for m in list(v["teaches"]) + list(v["adds"]):
            if m in out and w not in out[m]:
                out[m].append(w)
    return out


def frontier():
    """Mechanism nodes no work teaches: our own ideas, or gaps. The only sessionable cells."""
    t = taught_by()
    return [m for m in sorted(MECH) if not t[m]]


def first_to_add(m):
    """Which work introduced this branch, if any."""
    for w, v in WORKS.items():
        if m in v["adds"]:
            return w
    return None


def tree_lines():
    kids = {}
    for m, (par, _) in MECH.items():
        kids.setdefault(par, []).append(m)
    t = taught_by()
    out = []

    def walk(node, depth):
        par, what = MECH[node]
        works = t[node]
        tag = ("  [%s]" % ", ".join(works)) if works else "  [FRONTIER - no work found]"
        out.append("%s%-8s %s%s" % ("  " * depth, node, what[:62], tag))
        for k in sorted(kids.get(node, [])):
            walk(k, depth + 1)

    for root in sorted(kids.get(None, [])):
        walk(root, 0)
    return out


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. DEDUP, ENFORCED. Two mechanism nodes with the same normalised text means the graph has
    #    become the reading list it replaced. This is the load-bearing plant.
    seen = {}
    dupes = []
    for m, (_, what) in MECH.items():
        k = _norm(what)
        if k in seen:
            dupes.append((seen[k], m))
        seen[k] = m
    _plant("two mechanism nodes share the same text, so the graph is duplicating rather than "
           "deduplicating: %s" % (dupes or "none"), not dupes)

    # 2. ONLY NEW DATA BECOMES A NEW BRANCH: a mechanism may be ADDED by at most one work. If
    #    two works both claim to introduce it, the later one is duplicating a branch.
    adders = {}
    clashes = []
    for w, v in WORKS.items():
        for m in v["adds"]:
            if m in adders:
                clashes.append((m, adders[m], w))
            adders[m] = w
    _plant("a mechanism is claimed as NEW by two works: %s" % (clashes or "none"), not clashes)

    # 3. the graph must be connected and acyclic, or a node can never be reached from a root
    bad_parent = [(m, p) for m, (p, _) in MECH.items() if p is not None and p not in MECH]
    _plant("a mechanism's parent is not in the graph: %s" % (bad_parent or "none"), not bad_parent)
    orphan = []
    for m in MECH:
        seen_ids, cur = set(), m
        while cur is not None:
            if cur in seen_ids:
                orphan.append(m)
                break
            seen_ids.add(cur)
            cur = MECH[cur][0]
    _plant("a cycle in the mechanism graph: %s" % (orphan or "none"), not orphan)

    # 4. every work must attach somewhere, or it is a reading-list row pretending to be a node
    dangling = [w for w, v in WORKS.items() if not v["teaches"] and not v["adds"]]
    _plant("a work attaches to no mechanism: %s" % (dangling or "none"), not dangling)
    badref = [(w, m) for w, v in WORKS.items()
              for m in list(v["teaches"]) + list(v["adds"]) if m not in MECH]
    _plant("a work cites a mechanism not in the graph: %s" % (badref or "none"), not badref)

    # 5. THE FRONTIER must be exactly the nodes no work teaches, and must be NON-EMPTY or the
    #    graph is claiming the field is finished, and EMPTY of nodes that do have works.
    fr = frontier()
    _plant("the frontier is empty - the graph claims every mechanism is published", bool(fr))
    t = taught_by()
    _plant("a frontier node actually has a work attached",
           all(not t[m] for m in fr))
    _plant("a non-frontier node has no work attached",
           all(t[m] for m in MECH if m not in fr))

    # 6. every frontier node is an ABSENCE CLAIM and must carry the queries that failed, or it
    #    is a guess wearing a verdict.
    noq = [m for m in fr if m not in FRONTIER_QUERIES]
    _plant("a frontier node has no recorded search behind it: %s" % (noq or "none"), not noq)

    # 7. THE SCOPE RULE, both directions. Research must be gated; a product domain must NOT be,
    #    or the gate becomes a tax on bug fixes and gets switched off everywhere.
    a1, _ = applies_to("gatefly")
    _plant("the gate does not apply to a research domain", a1 is True)
    a2, g2 = applies_to("tami")
    _plant("the gate applies to Tami - a game has no prior art, it has requirements",
           a2 is False)
    _plant("the Tami answer does not say what governs instead", "REQUIREMENTS" in g2)
    a3, g3 = applies_to("something-nobody-classified")
    _plant("an unknown domain defaulted instead of refusing - defaulting to product would "
           "silently exempt research work from the gate", a3 is None)

    # 8. the known deltas must be right, because the whole claim of this file is that a later
    #    work contributes ONE branch rather than a row. Spot-checked against the search.
    _plant("AlphaEdit's delta is not M1.3", first_to_add("M1.3") == "AlphaEdit")
    _plant("MEMIT's delta is not M1.2", first_to_add("M1.2") == "MEMIT")
    _plant("Adam-NSCL's delta is not M4.1", first_to_add("M4.1") == "Adam-NSCL")
    _plant("a frontier node has an adding work", all(first_to_add(m) is None for m in fr))

    # 9. and this lane must state what it HOLDS for each frontier node, or the lift is implied
    #    rather than claimed
    noours = [m for m in fr if m not in OURS]
    _plant("a frontier node with nothing recorded about what this lane holds: %s"
           % (noours or "none"), not noours)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--frontier", action="store_true")
    ap.add_argument("--domain", default=None)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())

    if a.domain:
        applies, governs = applies_to(a.domain)
        if applies is None:
            print("DOMAIN %r: REFUSING" % a.domain)
            print("  %s" % governs)
            raise SystemExit(1)
        print("DOMAIN %r: prior-art gate %s"
              % (a.domain, "APPLIES" if applies else "DOES NOT APPLY"))
        print("  %s" % governs)
        raise SystemExit(0)

    if a.frontier:
        print("FRONTIER - mechanism nodes no work was found for:")
        for m in frontier():
            print("  %-6s %s" % (m, MECH[m][1]))
            for q in FRONTIER_QUERIES.get(m, []):
                print("         searched: %s" % q)
            if m in OURS:
                print("         ours: %s" % OURS[m])
        raise SystemExit(0)

    print("PRIOR-ART GRAPH for model editing: %d mechanisms, %d works"
          % (len(MECH), len(WORKS)))
    print()
    for ln in tree_lines():
        print(ln)
    print()
    fr = frontier()
    print("  %d mechanism(s) on the frontier (no work found): %s" % (len(fr), ", ".join(fr)))
    print("  every citation here is a POINTER TO CHECK, from search summaries rather than full")
    print("  texts. It says somebody published the mechanism, never that it works.")
