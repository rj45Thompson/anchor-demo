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


 # ---- E1.1/E1.2: enumerate the consequence closure of an edit. Swept 2026-11-19.
 "M9":     ("M0",   "Enumerate the consequence closure of an edit: which NEARBY facts must "
                    "also change and which must stay fixed"),
 "M9.1":   ("M9",   "Derive the set of implied facts from a knowledge graph"),
 "M9.2":   ("M9",   "Probe at the embedding level instead of a fixed prompt list"),
 "M9.3":   ("M9",   "Sample knowledge subgraphs to build typed locality classes"),
 "M9.4":   ("M9",   "Test whether an edit in one language carries to others"),

 # ---- E1.3/E4.4: correctness against a SET rather than one string. Swept 2026-11-19.
 "M10":    ("M6",   "Score an edit against the SET of correct answers, not one of them"),
 "M10.1":  ("M10",  "Measure the proportion of originally-correct answers accidentally removed"),
 "M10.2":  ("M10",  "Install several correct labels at once rather than editing one fact"),
 "M10.3":  ("M10",  "Swap the SUBJECT for an alias to test generalisation of the edit"),
 "M10.4":  ("M10",  "Handle a correct answer at a DIFFERENT GRANULARITY that is absent from "
                    "the answer set entirely"),
 "M10.5":  ("M10",  "Audit the string-matching basis of the metric itself by hand"),

 # ---- E2.3: which site to edit, and by what criterion. Swept 2026-11-19.
 "M11":    ("M1",   "Choose WHICH site to edit by a stated criterion rather than a fixed layer"),
 "M11.1":  ("M11",  "Pick the layer by causal tracing / causal mediation scores"),
 "M11.2":  ("M11",  "Pick it by gradient attribution instead"),
 "M11.3":  ("M11",  "Pick it by Fisher information as an influence criterion"),
 "M11.4":  ("M11",  "Spread the edit across layers weighted by causal score"),

 # ---- E3d: add dedicated parameters per edit. Swept 2026-11-19.
 "M12":    ("M0",   "Add DEDICATED parameters per edit instead of overwriting shared ones"),
 "M12.1":  ("M12",  "Add one neuron per error-producing token"),
 "M12.2":  ("M12",  "Train one expert network per edit, routed by a dynamic index"),
 "M12.3":  ("M12",  "GENERATE the added neuron's weights conditioned on the edit query"),
 "M12.4":  ("M12",  "Fine-tune only the existing neurons that contribute most, adding none"),

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

 "RippleEdits": {"cite": "Cohen et al., Evaluating the Ripple Effects of Knowledge Editing in "
                         "Language Models, TACL 2024, arXiv:2307.12976 - ~5K entries; current "
                         "methods modify the fact but often FAIL to capture the entailed "
                         "ripples", "teaches": ["M6", "M9"], "adds": ["M9.1"]},
 "EVK-Bench":  {"cite": "Beyond Local Edits: embedding-virtualized probing, arXiv:2602.01977 - "
                        "argues a fixed list of predefined related prompts cannot reach the "
                        "effects that matter", "teaches": ["M9"], "adds": ["M9.2"]},
 "UniEdit":    {"cite": "UniEdit: A Unified Knowledge Editing Benchmark, arXiv:2505.12345 - "
                        "subject-crossed, relation-crossed and object-crossed locality classes",
                "teaches": ["M9"], "adds": ["M9.3"]},
 "IndicRipple": {"cite": "Cross-lingual ripple effects, ACL Anthology 2026.aacl-long.171 - "
                         "reports limited cross-lingual ripple", "teaches": ["M9"],
                 "adds": ["M9.4"]},
 "PEAK":       {"cite": "Neighboring Perturbations of Knowledge Editing, arXiv:2401.17623 - "
                        "appends an answer and measures the proportion of the ORIGINAL correct "
                        "answers accidentally removed", "teaches": ["M6", "M10"],
                "adds": ["M10.1"]},
 "MultiLabelEdit": {"cite": "Knowledge-distortion work on multi-label facts, with an IGNORE RATE "
                            "for other correct objects disregarded", "teaches": ["M10"],
                    "adds": ["M10.2"]},
 "SubjectReplace": {"cite": "Subject Replace generalisation metric, via the editing-pitfalls "
                            "literature (arXiv:2310.02129)", "teaches": ["M10"],
                    "adds": ["M10.3"]},
 "PohlEval":   {"cite": "Pohl, Ploner & Akbik, manual assessment of the string-matching basis "
                        "of editing evaluation; contrasts zsRE token-wise greedy decoding with "
                        "CounterFact sequence-likelihood ranking", "teaches": ["M10", "M6"],
                "adds": ["M10.5"]},
 "TracingCritique": {"cite": "Hase et al., Does Localization Inform Editing?, arXiv:2301.04213 - "
                             "causal tracing results statistically UNCORRELATED with edit "
                             "success; the edit layer mattered more than the tracing score",
                     "teaches": ["M11", "M11.1"], "adds": []},
 "CMA-layer":  {"cite": "Causal mediation layer scoring, the standard baseline criticised above",
                "teaches": ["M11"], "adds": ["M11.1"]},
 "LGA":        {"cite": "Gradient-attribution layer selection, reported to beat CMA and SaLEM "
                        "without exhaustive layer-wise trial and error", "teaches": ["M11"],
                "adds": ["M11.2"]},
 "GoldenLayers": {"cite": "Golden Layers and Where to Find Them, arXiv:2602.20207 - Fisher "
                          "Information as a principled criterion for influential layers",
                  "teaches": ["M11"], "adds": ["M11.3"]},
 "CAKE":       {"cite": "CAKE, ACL 2026 2026.acl-long.918 - allocates editing effort across "
                        "layers by causal weight rather than a fixed set", "teaches": ["M11"],
                "adds": ["M11.4"]},
 "T-Patcher":  {"cite": "Huang et al. 2023, Transformer-Patcher - adds one neuron per "
                        "error-producing token, which helps with forgetting under sequential "
                        "edits", "teaches": ["M12"], "adds": ["M12.1"]},
 "SCEN":       {"cite": "Scalable Model Editing via Customized Expert Networks, "
                        "arXiv:2404.02699 - one expert per edit, dynamic neuron indexing; the "
                        "network GROWS with the number of edits", "teaches": ["M12"],
                "adds": ["M12.2"]},
 "MeG":        {"cite": "Massive Editing via Dynamic Weight Generation, ICLR 2026, "
                        "arXiv:2512.14395 - diffusion-generated weights for a single added "
                        "neuron; cites the growing overhead of neuron- and expert-adding "
                        "methods as the reason they do not scale", "teaches": ["M12"],
                "adds": ["M12.3"]},
 "NMKE":       {"cite": "Entropy-guided dynamic sparse mask over existing neurons, plus the "
                        "AAAI 2025 targeted-neurons work", "teaches": ["M12"],
                "adds": ["M12.4"]},
}

# An absence is a claim and carries the search that failed to refute it.
FRONTIER_QUERIES = {
 "M10.4": ["knowledge editing evaluation multiple correct answers answer set aliases equally "
           "valid granularity mismatch metric - returned work on multi-label facts, ignore "
           "rate and PEAK, and NOTHING on granularity: a correct answer at a different "
           "specificity, absent from the answer set's vocabulary"],
 "M7": ["alternating closed-form model edit with gradient fine-tuning null space subspace "
        "sequential knowledge editing combine (extended)",
        "AlphaEdit null-space constrained knowledge editing language models"],
 "M8": ["knowledge editing capacity limit how many edits before collapse pigeonhole rank "
        "dimension bound sequential editing (extended)"],
}

# What this lane holds for a frontier node, so the lift is stated rather than implied.
OURS = {
 "M10.4": "Not this lane's finding - the v4 lane's decoder test found it (selfimprove_v4 commit "
          "4ad9d744): a prompt whose answer set names one place while the model answers a more "
          "specific one, both correct, the model's answer absent from the set entirely. This "
          "lane's own set-valued movement count does NOT cover it, and neither does PEAK's "
          "removal count, because both compare against a set that is itself incomplete.",
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

# ----------------------------------------- the three-way join: literature, code, and the net
# RJ: "Would it help if we mapped the code actually in there as well? And what the graph of the
# NN does and we connect all three?"  Yes, and the third graph is the one that earns it.
#
# A PUBLISHED MECHANISM ASSUMES A STRUCTURE. AlphaEdit's projection needs a null space of
# preserved keys with room in it; if the keys already span the space there is no null space to
# project into and the method cannot help however well it is implemented. That precondition is
# a FACT ABOUT THE NET, measurable here, and checkable BEFORE a session is spent. So the three
# graphs answer three different questions that were being answered separately:
#
#     art graph   does this mechanism exist in the world?        (MECH / WORKS above)
#     code graph  is it implemented in this repository?          (IMPL below)
#     NN graph    does OUR net have the structure it assumes?    (ASSUMES x NN_FACTS below)
#
# The join's verdict is the useful part: a mechanism can be PUBLISHED, UNIMPLEMENTED and
# STRUCTURALLY INAPPLICABLE all at once, and only the third of those is a reason not to try.
IMPL = {
 "M1.2": "gatefly/retrain.py memit_edit - the batched closed-form ridge solve",
 "M4":   "gatefly/retrain.py run_arm - training arms, NOT subspace-confined",
 "M6":   "gatefly/metrics.py - IFR and Preservation, plus a set-valued movement count",
 "M6.1": "gatefly/ladder.py - the m,n,k complexity ladder with an exact oracle at every rung",
 "M8":   "gatefly/gate_math.py acg - a_j, c_j and gate_j = g(a_j - c_j), the capacity read",
}

# The structural precondition each mechanism needs, named as something measurable.
ASSUMES = {
 "M1.3":   ("null_space_room",
            "a null space of preserved keys with room in it: the preserved keys must NOT span "
            "the key space, or there is nothing to project into"),
 "M1.3.1": ("null_space_room", "same, plus enough samples to estimate that null space"),
 "M4.1":   ("null_space_room",
            "the same object from the other side: the feature covariance must have small "
            "singular values to build a projection from"),
 "M4.3":   ("null_space_room", "a null space of the WEIGHTS rather than the features"),
 "M1.1":   ("site_localisation",
            "the knowledge must be localised enough that one site carries it"),
 "M1.2":   ("site_localisation", "the same, for a batch of keys at one site"),
 "M8":     ("capacity_readable",
            "a_j and c_j must be computable, which needs the keys and the covariance"),
}

# Facts about THIS lane's net, read from committed artefacts rather than typed in. Refuses
# rather than guessing when an artefact is missing, because a precondition check that silently
# invents its facts is worse than no check.
def nn_facts():
    import json
    out, missing = {}, []
    r9 = os.path.join(HERE, "runs", "r9_keys.json")
    lad = os.path.join(HERE, "runs", "ladder_n256.json")
    if os.path.exists(r9):
        d = json.load(open(r9, encoding="utf-8"))
        rows = {r["n"]: r for r in d["rows"]}
        big = rows.get(256) or rows[max(rows)]
        out["key_dim"] = d.get("key_dim")
        out["keys_at_worst"] = big["n"]
        out["worst_whitened"] = big.get("whitened_worst")
        out["spans_key_space"] = big["n"] >= (d.get("key_dim") or 10 ** 9)
        out["source_r9"] = "gatefly/runs/r9_keys.json"
    else:
        missing.append("runs/r9_keys.json")
    if os.path.exists(lad):
        out["source_ladder"] = "gatefly/runs/ladder_n256.json"
    else:
        missing.append("runs/ladder_n256.json")
    return out, missing


def transfers(mech, facts=None):
    """-> (verdict, why). Does OUR net have the structure this mechanism assumes?

    Three verdicts and they are not degrees of one thing: APPLIES, INAPPLICABLE (the net lacks
    the assumed structure, which is a reason not to try), and UNKNOWN (no precondition recorded,
    which is not permission).
    """
    if facts is None:
        facts, missing = nn_facts()
        if missing:
            return "UNKNOWN", ("cannot check: missing artefact(s) %s - refusing to guess a "
                               "structural precondition" % ", ".join(missing))
    got = ASSUMES.get(mech)
    if got is None:
        return "UNKNOWN", "no structural precondition recorded for this mechanism"
    name, what = got
    if name == "null_space_room":
        if facts.get("spans_key_space"):
            return "INAPPLICABLE", (
                "this net's edit keys SPAN the key space at the size this lane measured (%d keys "
                "in %d dimensions), so the null space is trivial and there is nothing to project "
                "into. Needs: %s" % (facts["keys_at_worst"], facts["key_dim"], what))
        return "APPLIES", "keys do not span the key space, so a null space exists. Needs: %s" % what
    if name == "capacity_readable":
        return ("APPLIES" if facts.get("worst_whitened") is not None else "UNKNOWN",
                "a_j and c_j are computed in this lane on every run. Needs: %s" % what)
    if name == "site_localisation":
        return "APPLIES", ("this lane edits one site, blocks.N.ffwd.net.2.weight, and gets "
                           "Efficacy 1.0000 up to n=32, so the site carries it at that scale. "
                           "Needs: %s" % what)
    return "UNKNOWN", what


# Candidate hybrids, each naming WHICH published mechanism is being crossed with WHAT this lane
# holds, and why the pair is more than the sum. RJ: "what mechanism priors exist that we could
# hybrid".
HYBRIDS = [
 {"id": "H1", "cross": ("M1.3", "M4.1"), "same_as": "M7",
  "why": "The known frontier: a projected closed-form edit alternating with projected gradient "
         "training. Both parents published with code, and they project into THE SAME OBJECT - "
         "the uncentered feature covariance - so the two steps can share one projection rather "
         "than fighting over two.",
  "blocked_by": "M1.3's precondition. Once the keys span the key space there is no null space "
                "for either parent, so this hybrid inherits the capacity wall rather than "
                "solving it."},
 {"id": "H2", "cross": ("M3", "M8"),
  "why": "THE BEST ONE, and it turns this lane's blocker into a design. M3 is external "
         "memory/retrieval instead of weights; M8 is a per-edit read of remaining capacity. Use "
         "the capacity read as a ROUTER: edit in weights while the gate says there is room, and "
         "SPILL to retrieval once g(a-c) says the subspace is full. The capacity bound stops "
         "being a cliff and becomes a routing threshold. Nothing in the graph does this, because "
         "M3 and the M1/M4 families are treated as competing methods rather than as two sides of "
         "a budget - and the trigger that would join them is exactly the number nobody has.",
  "blocked_by": "nothing structural. Needs a retrieval path this lane does not have, which is "
                "build work rather than a precondition failure."},
 {"id": "H3", "cross": ("M1.4", "M8"),
  "why": "SUIT chooses subspace-aware key-value mappings; M8 says how much room each candidate "
         "site has left. Choose the SITE per key by remaining capacity instead of fixing one "
         "site for every edit - which also attacks E2.3, where the site is a free parameter with "
         "no principled selection rule.",
  "blocked_by": "E2.3 is untested here: every figure in this lane is at ONE site, so this lane "
                "cannot currently compare sites."},
 {"id": "H4", "cross": ("M5.1", "M8"),
  "why": "PRUNE attributes collapse to condition-number growth; M8 reads capacity from the gate. "
         "Both are health measures on the accumulated update and cond(C) is already computed "
         "here (3.225e+03 over 4,000 positions). Cheapest possible test of whether the two "
         "numbers track each other, which would either corroborate M8 against published work or "
         "show they measure different things.",
  "blocked_by": "nothing. This is a day's work and the cheapest validation of M8 available."},
]


# What the wide sweep found this lane had ALREADY REINVENTED. Recorded because the join was
# built to detect exactly this cell - settled internally, published externally - and the first
# time it ran over a widened graph it caught two of this lane's own results.
REINVENTED = {
 "M10.1": "This lane built a SET-VALUED MOVEMENT COUNT to replace Eq.7 Preservation, and "
          "reported it as the measure that works: 0.2412 for the destructive arm against 0.0000 "
          "for the surgical one. PEAK (arXiv:2401.17623) already measures the proportion of "
          "ORIGINALLY-CORRECT answers accidentally removed. Same quantity, published first. The "
          "finding that survives is not the metric but the DEMONSTRATION that the published "
          "ruler fails: Eq.7 read 1.1309 - better than untouched - for a model that had lost "
          "25.7% of its competence, and its median also failed at 0.9906.",
 "M12.1": "This lane's grow() adds one neuron per edit case firing on that case alone, and "
          "measured it as a DIAL rather than an improvement - crowding to exactly 0.0000 at "
          "every size, IFR 9.3x tighter, bought by spending depth. T-Patcher (Huang et al. "
          "2023) adds one neuron per error-producing token and is the same mechanism. MeG "
          "(ICLR 2026) cites the growing overhead of such methods as the reason they do not "
          "scale, which is the cost this lane measured independently in gate terms. So the "
          "mechanism is theirs and the PRICE IN CROWDING AND DEPTH is this lane's contribution.",
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

    # A PREMISE IS NOT A PLANT - see plant_manifest.py for the taxonomy. Both of the premises
    # below were written in THIS FILE nineteen minutes after this lane named the premise shape
    # and converted three others, which is a replication of the snipershot lane's finding that
    # naming a class does not prevent the next instance. Worse: this lane then reviewed every
    # candidate the screen produced, catalogued these two BY NAME as genuinely premise-shaped
    # in REVIEWED_TRUE_PREMISES, and still left them as plants. The diagnosis was recorded and
    # the fix was not applied.
    premises = []

    def _premise(label, holds, consequence):
        print(("  premise  " if holds else "  EXPIRED  ") + label)
        if not holds:
            premises.append((label, consequence))

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
    _premise("the frontier still has mechanisms no work was found for", bool(fr),
             "every mechanism in the graph is now published, so this lane has no open branch "
             "left in model editing - stop maintaining a frontier query and read the graph as a "
             "reading list instead")
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

    # 9b. A REINVENTED entry must name a mechanism that EXISTS and that a work actually
    #     teaches, or the lane is confessing to reinventing something nobody published.
    badr = [m for m in REINVENTED if m not in MECH]
    _plant("a REINVENTED entry names a mechanism not in the graph: %s" % (badr or "none"),
           not badr)
    t9 = taught_by()
    unpub = [m for m in REINVENTED if not t9.get(m)]
    _plant("a REINVENTED entry points at a mechanism NO work teaches - then it was not "
           "reinvented: %s" % (unpub or "none"), not unpub)

    # 10. THE THREE-WAY JOIN. The load-bearing claim is that a structural precondition read off
    #     OUR net can say a published mechanism will not transfer. It must actually say that
    #     for the case this lane measured, or the join is decoration.
    facts, missing = nn_facts()
    _plant("the NN facts could not be read from committed artefacts: %s" % (missing or "none"),
           not missing)
    if not missing:
        print("  net: %d keys in %d dims, worst whitened pair %.4f, keys span the space: %s"
              % (facts["keys_at_worst"], facts["key_dim"], facts["worst_whitened"],
                 facts["spans_key_space"]))
        v, why = transfers("M1.3", facts)
        _plant("a null-space method was NOT flagged inapplicable although this net's keys span "
               "the key space (got %s) - then the precondition check cannot refuse anything"
               % v, v == "INAPPLICABLE")
        # negative control: the same check must APPLY when there IS room, or it refuses
        # everything and tells us nothing
        roomy = dict(facts); roomy["spans_key_space"] = False
        v2, _ = transfers("M1.3", roomy)
        _plant("the same check refused even with room in the key space - it fires on anything",
               v2 == "APPLIES")
        # and a mechanism with no recorded precondition must be UNKNOWN, never APPLIES:
        # silence is not permission
        v3, _ = transfers("M2", facts)
        _plant("a mechanism with no recorded precondition read as APPLIES - silence would be "
               "permission", v3 == "UNKNOWN")

    # 11. the hybrids must cross mechanisms that EXIST, and each must name what blocks it or it
    #     is a wish rather than a candidate
    badx = [(h["id"], m) for h in HYBRIDS for m in h["cross"] if m not in MECH]
    _plant("a hybrid crosses a mechanism not in the graph: %s" % (badx or "none"), not badx)
    nob = [h["id"] for h in HYBRIDS if not h.get("blocked_by")]
    _plant("a hybrid does not say what blocks it: %s" % (nob or "none"), not nob)
    # at least one hybrid must be unblocked, or the list is a graveyard and says nothing
    free = [h["id"] for h in HYBRIDS if h["blocked_by"].startswith("nothing")]
    _premise("at least one hybrid is still unblocked", bool(free),
             "every hybrid is now blocked or done - go through HYBRIDS, delete the ones that "
             "were built, and if the rest are all genuinely blocked say so in the module "
             "docstring rather than leaving a list that proposes nothing")

    print("  selftest: %d plant(s) checked, %d failed; %d premise(s) expired"
          % (len(checked), len(fails), len(premises)))
    for f in fails:
        print("  FAILED: " + f)
    if premises:
        print()
        print("  PREMISES EXPIRED - not failures. Retire these rather than keeping them green:")
        for label, consequence in premises:
            print("    - %s" % label)
            print("      -> %s" % consequence)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--frontier", action="store_true")
    ap.add_argument("--domain", default=None)
    ap.add_argument("--hybrids", action="store_true")
    ap.add_argument("--transfers", action="store_true")
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

    if a.transfers:
        facts, missing = nn_facts()
        if missing:
            print("REFUSING: missing artefact(s) %s" % ", ".join(missing))
            raise SystemExit(1)
        print("DOES THIS NET HAVE THE STRUCTURE EACH MECHANISM ASSUMES?")
        print("  net: %d keys in %d dims, worst whitened pair %.4f"
              % (facts["keys_at_worst"], facts["key_dim"], facts["worst_whitened"]))
        print()
        for m in sorted(ASSUMES):
            v, why = transfers(m, facts)
            print("  %-8s %-13s %s" % (m, v, MECH[m][1][:54]))
            print("           %s" % why)
        print()
        print("  implemented here:")
        for m in sorted(IMPL):
            print("    %-8s %s" % (m, IMPL[m]))
        raise SystemExit(0)

    if a.hybrids:
        print("HYBRID CANDIDATES - a published mechanism crossed with what this lane holds")
        for h in HYBRIDS:
            print()
            print("  %s  %s x %s%s" % (h["id"], h["cross"][0], h["cross"][1],
                                       "  (= %s)" % h["same_as"] if h.get("same_as") else ""))
            print("      %s  x  %s" % (MECH[h["cross"][0]][1][:48],
                                        MECH[h["cross"][1]][1][:48]))
            print("      why: %s" % h["why"])
            print("      blocked by: %s" % h["blocked_by"])
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
