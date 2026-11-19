"""Why can't we build a perfect editor? The epic, decomposed as an AND/OR goal tree.

    py -X utf8 -I gatefly/problem_tree.py              walk the whole tree
    py -X utf8 -I gatefly/problem_tree.py --open       only what is still open
    py -X utf8 -I gatefly/problem_tree.py --propose    emit boneyard entries for open nodes
    py -X utf8 -I gatefly/problem_tree.py --selftest

WHAT THIS KIND OF DIAGRAM IS CALLED. RJ asked. There are several names and they are not
synonyms; the one that fits decides what the edges MEAN:

  * AND/OR GOAL REFINEMENT TREE, from goal-oriented requirements engineering. The canonical
    formalism is KAOS (van Lamsweerde); i* (Yu) and GRL are the other two. A goal is refined
    into subgoals until they are operationalisable. This is the closest fit and is what is
    built here.
  * FAULT TREE ANALYSIS (Watson/Bell Labs, 1961; NUREG-0492 is the standard reference). Same
    AND/OR structure, but the root is a FAILURE and the leaves are basic events. "Why can't we"
    is a failure framing, so this fits too - a fault tree is an AND/OR tree wearing a different
    hat.
  * ISSUE TREE / LOGIC TREE, and specifically a MECE tree (mutually exclusive, collectively
    exhaustive) - the management-consulting name for the same shape.
  * In UML proper there is no goal tree. Its decomposition mechanisms are the «include» and
    «extend» relationships between use cases plus generalisation, which express "always does"
    and "sometimes does", not "needs all of" and "needs one of".
  * In agile vocabulary, EPIC -> FEATURE -> STORY, which is what "epic problem" borrows from.

THE EDGE TYPE IS THE WHOLE POINT, and it answers the other thing RJ asked for - the list of
things that WOULD solve a problem and the list that MIGHT:

    AND-node   solved only when EVERY child is solved. Each child is NECESSARY.
    OR-node    solved when ANY ONE child is solved. Each child is SUFFICIENT on its own.

So an experiment hanging off an OR-child, if it succeeds, WOULD settle its parent. An
experiment hanging off an AND-child removes one obstacle of several and only MIGHT. That is a
structural criterion rather than a judgement, and `classify()` computes it instead of asserting
it.

EVERY NODE CARRIES ITS EVIDENCE FROM THIS LANE where there is any, with the figure. A node with
no evidence says so. Nothing here is a claim about editing in general: this lane measures a
201,226-parameter net playing tic-tac-toe, and the oracle that makes those measurements
checkable is exactly what a real benchmark cannot supply.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# kind: "AND" (all children necessary) or "OR" (any child sufficient) or "LEAF"
# status:
#   "settled"  solved here AND tested by a plant that can fail
#   "measured"  there is run evidence but no plant - weaker, and NOT counted as solved
#   "blocked"   a confirmed OBSTACLE: we know the answer and the answer is "this route fails".
#               Never counted as solved - the UML/KAOS gap map caught this one, because
#               "settled" was being used for both "solved" and "confirmed blocker" and
#               solved() was therefore counting a confirmed blocker TOWARD its parent.
#   "open"      not known
#   "external"  real, but not this lane's to settle
NODES = {
    "E": dict(
        kind="AND", parent=None,
        say="A PERFECT EDITOR: install any requested behavioural change exactly, disturb "
            "nothing else, reliably, at any scale, repeatedly.",
        why="Needs all four of specify, locate, install and verify. Failing any one is enough "
            "to make the editor imperfect, which is why the root is an AND.",
        status="open", evidence=None),

    # ---------------------------------------------------------------- 1. SPECIFY
    "E1": dict(kind="AND", parent="E",
               say="SPECIFY the change exactly: say what must become true and what must not move.",
               why="All three sub-problems must be solved; naming the target is not enough if "
                   "its consequences and its complement are unnamed.",
               status="open", evidence=None),
    "E1.1": dict(kind="LEAF", parent="E1",
                 say="Enumerate what SHOULD change as a consequence of the new fact.",
                 why="A fact implies others. Nothing enumerates that closure for real knowledge.",
                 status="external",
                 evidence="Not this lane's to settle for language. In a SOLVED GAME it is free: "
                          "the consequence closure of a move is the minimax line, computed "
                          "exactly. gatefly/oracle.py returns it."
                    " PRIOR ART, swept 2026-11-19: this is RIPPLE EFFECTS, named and benchmarked - Cohen et al., Evaluating the Ripple Effects of Knowledge Editing, TACL 2024, arXiv:2307.12976, ~5K entries, finding that methods modify the fact but often FAIL to capture the entailed ripples. UniEdit (arXiv:2505.12345) types locality as subject-, relation- and object-crossed. RippleEdits derives the implied set from a KNOWLEDGE GRAPH; this lane derives it EXACTLY from minimax, which is the same structure with an exact oracle."),
    "E1.2": dict(kind="LEAF", parent="E1",
                 say="Enumerate what should NOT change. The complement is unbounded.",
                 why="'Everything else' cannot be listed, so preservation is always measured on "
                     "a sample and the sample is never the complement.",
                 status="partial",
                 evidence="Measured here: Eq.7 Preservation over an 800-probe sample read "
                          "1.1309 - better than untouched - for a model that had just lost "
                          "25.7% of its competence over the full 4,520-position space. The "
                          "sample said nothing was wrong while a quarter of the answers were."
                    " PRIOR ART, swept 2026-11-19: EVK-Bench (arXiv:2602.01977) argues a fixed list of predefined related prompts cannot reach the effects that matter and probes at the embedding level instead - which is the same objection as this lane's 800-probe sample reading Preservation 1.1309 for a model that had lost 25.7% of its competence. The literature has no agreed definition of locality across these benchmarks, so the complement being unbounded is not solved there either."),
    "E1.3": dict(kind="LEAF", parent="E1",
                 say="Pin the target's surface forms: aliases, paraphrases, equally-correct answers.",
                 why="If the answer set is incomplete, a correct output is scored as damage.",
                 status="partial",
                 evidence="Measured here: every movement by two surgical arms was a swap "
                          "between EQUALLY CORRECT answers - real damage 0.0000 - so a naive "
                          "argmax count over-reported by 100% of its own value. The sibling "
                          "lane found the same structure in a knowledge benchmark: 11 of 46 "
                          "prompts with several correct answers, covering 60% of its probes."
                    " PRIOR ART, swept 2026-11-19: partially covered. Alias robustness is tested in the SUBJECT (a Subject Replace metric swaps the subject for a synonym), and multi-label facts carry an IGNORE RATE for other correct objects. What is tested is robustness to alias PHRASING, not whether alias ANSWERS are scored correct - which is the half this lane measured as two surgical arms whose every movement was a swap between equally correct answers, real damage 0.0000."),

    # ---------------------------------------------------------------- 2. LOCATE
    "E2": dict(kind="AND", parent="E",
               say="LOCATE where in the weights the change must go.",
               why="All three must hold: the knowledge must be findable, the finding must be "
                   "reliable, and the site must not be an arbitrary choice.",
               status="open", evidence=None),
    "E2.1": dict(kind="LEAF", parent="E2",
                 say="Knowledge is distributed, not localised - superposition.",
                 why="If a fact lives across many directions, there is no single place to write.",
                 status="partial",
                 evidence="Quantified here rather than asserted: at pong's output layer 64 "
                          "neurons write into ONE dimension, c/a 0.9965, gate 0.0035 - the "
                          "collinear law in a trained net. In the tic-tac-toe net crowding "
                          "rises with depth across the four blocks: 0.777, 0.782, 0.794, 0.834."
                    " PRIOR ART, swept 2026-11-19: COVERED and foundational. Superposition - Elhage et al., Toy Models of Superposition, arXiv:2209.10652 - frames it as embedding more features than neurons by distributing each along a direction spanning several, 'in a way that minimises interference', with correlated features pushed toward orthogonality and anticorrelated ones sharing a dimension antipodally. Sparse probing (arXiv:2305.01610) argues superposition necessarily implies polysemantic neurons. The literature's own phrasing - interference is the PRICE OF COMPRESSION - is this node's claim, and this lane's c/a 0.9965 at pong's output layer is one measurement of that price."),
    "E2.2": dict(kind="LEAF", parent="E2",
                 say="Attribution is unreliable at depth.",
                 why="Localisation methods disagree with causal interventions.",
                 status="external",
                 evidence="Published (Basu, Pope & Feizi, ICLR 2021, via the v4 lane). Not "
                          "measured here and this lane has no standing to confirm it."),
    "E2.3": dict(kind="LEAF", parent="E2",
                 say="The site (which layer, which matrix) is a free parameter with no "
                     "principled selection rule.",
                 why="Every result is conditional on a choice nobody derives.",
                 status="open",
                 evidence="Untested here. Every figure in this lane is at ONE site, "
                          "blocks.N.ffwd.net.2.weight, chosen to match the ratchet lane's."
                    " PRIOR ART, swept 2026-11-19: COVERED AND CONTESTED. Hase et al., Does Localization Inform Editing?, arXiv:2301.04213, found causal tracing statistically UNCORRELATED with edit success, and that the edit layer mattered more than the tracing score. Proposed replacements: gradient attribution (LGA), Fisher information (arXiv:2602.20207), causal-weighted allocation across layers (CAKE, ACL 2026). No consensus criterion. Every criterion on offer asks WHICH LAYER MATTERS FOR THIS FACT; none asks WHICH LAYER HAS ROOM LEFT, which is the opening for a capacity-based rule."),

    # ---------------------------------------------------------------- 3. INSTALL
    "E3": dict(kind="OR", parent="E",
               say="INSTALL the change. ANY mechanism that installs exactly would settle this.",
               why="OR: the editor does not care how the change gets in. One working mechanism "
                   "is enough, which is why every child here is a candidate solution rather "
                   "than an obstacle.",
               status="open", evidence=None),
    "E3a": dict(kind="AND", parent="E3",
                say="A closed-form ridge edit (MEMIT-style) that installs exactly.",
                why="Blocked by all three of interference, linearity and capacity.",
                status="partial",
                evidence="Strong here: Efficacy 1.0000 at every edit-set size 1 to 32 with "
                         "competence 0.9920-0.9998. It beats retraining on both axes on this "
                         "system."),
    "E3a.1": dict(kind="LEAF", parent="E3a",
                  say="Interference: writes share dimensions, so each one lands short.",
                  why="gate_j = g(a_j - c_j); the crowding term subtracts.",
                  status="partial",
                  evidence="Measured: the edit's own crowding rises with the number of keys - "
                           "0.0000, 0.0000, 0.0032, 0.0327, 0.0459, 0.1112 at n = 1 to 32 - "
                           "and growing one private neuron per case drives it to EXACTLY "
                           "0.0000 at every size while raising addressability 8.2x."
                    " PRIOR ART, swept 2026-11-19: SPLIT, and the open half is this lane's. COVERED: that edits interfere and accumulate - DeltaEdit (arXiv:2505.07899) defines a per-edit SUPERIMPOSED NOISE term from the cumulative effect of earlier updates, reports performance falling sharply past a threshold, and fixes it with a dynamic orthogonal constraint; MEND's own numbers show the effect, edit success 0.98 at one edit falling to 0.67 at 125 summed simultaneously. NOT FOUND, searched explicitly: any measure of whether a SINGLE UPDATE'S MAGNITUDE IS SHRUNK when many edits share the same dimensions. That fraction is exactly gate_j = g(a_j - c_j), and this lane measured it rising with key count: 0.0000, 0.0000, 0.0032, 0.0327, 0.0459, 0.1112 at n = 1 to 32."),
    "E3a.2": dict(kind="LEAF", parent="E3a",
                  say="The solve is linear; the behaviour it must produce is not.",
                  why="A correct delta at the key does not guarantee correct behaviour away "
                      "from it.",
                  status="open",
                  evidence="Untested here. This lane measures what lands at the key and what "
                           "happens at sampled positions, never the relation between them."
                    " PRIOR ART, swept 2026-11-19: not found as a stated problem. The closed-form editing literature solves a linear system and evaluates behaviour, without a published treatment of the gap between what lands at the key and what the model then does. Still untested here too, so this is an absence in both places rather than an opening this lane can claim."),
    "E3a.3": dict(kind="LEAF", parent="E3a",
                  say="Capacity: p keys in H dimensions must collide once p approaches H.",
                  why="A hard ceiling independent of method.",
                  status="blocked",
                  evidence="NOW REACHED AND CONFIRMED. At 256 keys in a 256-dimensional key "
                           "space - the pigeonhole point, by construction - crowding reached "
                           "0.9354 against 0.0540 at n=16, Efficacy fell to 0.945 (242/256, "
                           "95% CI [0.9103, 0.9671], separated from a perfect [0.9852, "
                           "1.0000]) and competence fell 0.9880 to 0.6967. The rate is the "
                           "arithmetic's own: n identical keys each receive g(na)/n, so the "
                           "share falls as 1/n and never reaches zero. A confirmed BLOCKER, "
                           "not a solved node: it is a bound that will not be engineered away."
                    " PRIOR ART, swept 2026-11-18 (the capacity search): empirical collapse thresholds exist and NO DERIVED BOUND does. Reported thresholds run from ~250 sequential edits for MEMIT to ~8k for others, with explanations offered as condition-number growth (PRUNE), superimposed noise, a Dimensional Collapse Hypothesis and a spectral account (REVIVE). None gives an edit count from the geometry. One 2026 report has 3 of 5 model-method pairings at chance-level MMLU after 1,000 edits WHILE EDIT SUCCESS STAYS AT 1.00 - independent corroboration of this lane's Efficacy 0.945 with competence 0.6967 at n=256, reached from the arithmetic rather than from a benchmark."),
    "E3b": dict(kind="AND", parent="E3",
                say="Retraining on corrected data.",
                why="Blocked by forgetting, by dilution, and by cost.",
                status="partial",
                evidence="Measured here and it is a spectrum whose ends fail oppositely: items "
                         "alone gives Efficacy 1.0000 and competence 0.62-0.84; the uniform "
                         "corpus gives Efficacy 0.0000 and competence 1.0000; a 25% weighted "
                         "middle gives 1.0000 and 0.9998 but DEGRADES to Efficacy 0.63 by "
                         "n = 32 while the closed-form edit holds 1.0000."),
    "E3b.1": dict(kind="LEAF", parent="E3b",
                  say="Catastrophic forgetting when training on the corrected items.",
                  why="The rest of the model moves with them.",
                  status="blocked",
                  evidence="Measured: competence 0.7429, 0.8407, 0.7600, 0.6381, 0.6246, "
                           "0.7073 at n = 1 to 32, against 1.0000 before. Settled AS A "
                           "BLOCKER - it is real here, not that it is solved."
                    " PRIOR ART, swept 2026-11-19: COVERED and large. Catastrophic forgetting under fine-tuning is a field, with replay and rehearsal as the standard mitigation; forecasting WHICH examples will be forgotten and replaying those beats random replay (arXiv:2402.01865, exact-match drop cut to ~1.6-1.8%), and susceptibility prediction is its own line (arXiv:2406.09935). This lane's competence figures of 0.62-0.84 are an instance, not a discovery."),
    "E3b.2": dict(kind="LEAF", parent="E3b",
                  say="Dilution: corrected items are a vanishing fraction of the corpus.",
                  why="Train on everything and the correction never lands.",
                  status="blocked",
                  evidence="Measured: the uniform corrected corpus gives Efficacy 0.0000 at "
                           "n = 1 and 0.3438 at n = 32. Settled as a blocker."
                    " PRIOR ART, swept 2026-11-19: the mechanism is obvious and the MEASUREMENT was not found. Replay guides use ratios (one defaults to 30%) without a tested optimum, and the search returned no measured trade-off between replay ratio and edit success, and nothing on how much a small corrected set is diluted by a large one. This lane has that curve: a uniform corrected corpus gives Efficacy 0.0000 at n=1 and 0.3438 at n=32, while a 25% weighted middle gives 1.0000 and competence 0.9998 before degrading to Efficacy 0.63 by n=32."),
    "E3b.3": dict(kind="LEAF", parent="E3b",
                  say="Cost: retraining a set is not a 160 KB delta.",
                  why="The cost ordering is the practical argument for editing.",
                  status="external",
                  evidence="The v4 lane's framing; not costed here."
                    " PRIOR ART, swept 2026-11-19: NOT COSTED ANYWHERE FOUND. The search returned general claims that forgetting 'costs billions in retraining' and no head-to-head cost comparison of full retraining against targeted editing. Not costed here either, so this is an absence in both places and this lane has no standing to claim it."),
    "E3c": dict(kind="OR", parent="E3",
                say="Alternate a closed-form edit with training CONFINED to an isolated subspace.",
                why="RJ's idea. OR, because any of the three isolation definitions working "
                    "would settle it.",
                status="open",
                evidence="REGISTERED, NOT RUN. Boneyard id edit-then-isolated-train-loop. The "
                         "prior-art phase has not been done, and the honest first step is "
                         "finding out whether it is already published."),
    "E3d": dict(kind="OR", parent="E3",
                say="Change WHICH neurons exist, chosen by the gate pattern, so the maths "
                    "stops overlapping.",
                why="RJ's idea. OR: growing or pruning, either would do.",
                status="partial",
                evidence="Measured: GROWING works and is a DIAL, not an improvement - crowding "
                         "to exactly 0.0000 at every size, IFR pinned to 1.00-1.05 against the "
                         "plain edit's 0.69-1.15 (9.3x tighter), Preservation 4.6x closer to "
                         "1.0. It buys precision and SPENDS depth. PRUNING failed its own "
                         "mechanism: crowding moved 0.1112 to 0.1096, a 1.4% reduction."
                    " PRIOR ART, swept 2026-11-19: THE MECHANISM IS NOT THIS LANE'S. Growing one neuron per case is T-Patcher (Huang et al. 2023), one neuron per error-producing token. SCEN (arXiv:2404.02699) gives each edit its own expert with dynamic neuron indexing; MeG (ICLR 2026, arXiv:2512.14395) generates the added neuron's weights with a diffusion model and cites the growing overhead of such methods as why they do not scale - which is exactly the cost this lane measured independently as crowding to 0.0000 bought by spending depth. So the mechanism is theirs and the PRICE IN GATE TERMS is this lane's contribution."),

    # ---------------------------------------------------------------- 4. VERIFY
    "E4": dict(kind="AND", parent="E",
               say="VERIFY the result: know whether the edit did what was asked and nothing else.",
               why="All four are necessary. An editor you cannot check is not known to be "
                   "perfect however good it is.",
               status="open", evidence=None),
    "E4.1": dict(kind="LEAF", parent="E4",
                 say="An oracle for what should and should not have changed.",
                 why="Without it, collateral damage is estimated rather than known.",
                 status="settled",
                 evidence="SOLVED IN THIS SETTING and that is this lane's whole reason to "
                          "exist: minimax gives the correct answer at all 4,520 live positions "
                          "exactly. gatefly/oracle.py now also gives every move's value, the "
                          "depth to the end, and a per-position SHARPNESS - of the 4,520, "
                          "1,944 are maximally sharp, 1,247 middling, 1,329 dull. Solved for "
                          "games; NOT solved for language, which is the honest limit."
                    " PRIOR ART, swept 2026-11-19: no oracle for language was found, which is the expected answer rather than a gap this lane can close. Benchmarks substitute a knowledge graph (RippleEdits) or an answer list (PEAK) for an oracle, and both are incomplete by construction - the v4 lane's granularity mismatch is what incompleteness looks like. This lane's exact minimax oracle is real and is a property of SOLVED GAMES, not a method anybody can carry to language."),
    "E4.2": dict(kind="LEAF", parent="E4",
                 say="Rulers that actually resolve: that separate a good editor from a bad one.",
                 why="A metric that cannot distinguish arms cannot select a method.",
                 status="partial",
                 evidence="Measured here: Eq.7 Preservation reads 1.1309 for a model that lost "
                          "25.7% of its competence, and its MEDIAN also fails at 0.9906. The "
                          "measure that works is a set-valued movement count, which separates "
                          "the destructive arm from the surgical one 0.2412 against 0.0000. "
                          "BUT THE CAUSE MAY NOT BE THE RULER. The v4 lane measured its base "
                          "competence on the downstream probes and found the model answers "
                          "almost none of them correctly BEFORE any intervention. You cannot "
                          "measure collateral damage to knowledge the model does not have, so "
                          "a ruler that fails to separate arms there is being asked to measure "
                          "an absence. That is a different cause from the one this node was "
                          "opened for, and this lane cannot distinguish them, because its own "
                          "net is competent on 1.0000 of its probes by construction. "
                          "Artefact: selfimprove_v4 commit 4ad9d744."
                    " PRIOR ART, swept 2026-11-19: the complaint is published, the diagnosis is not. A 2024 EMNLP Findings pitfalls paper reports that evaluation 'relies on inconsistent metrics and benchmarks, lacking a uniform standard' and that metrics are 'primarily limited to scenarios where editing is performed only once'. Metric granularity is known to change scores (token-level accuracy against answer-level exact match). What was NOT found is a demonstration that a published ruler reports a model IMPROVED while it lost a quarter of its competence, which is this lane's Eq.7 reading of 1.1309."),
    "E4.3": dict(kind="LEAF", parent="E4",
                 say="Measures whose scale or resolution does not track the thing being varied.",
                 why="Otherwise a trend across conditions is an artefact of the measure.",
                 status="partial",
                 evidence="FOUR instances found, each by accident: Efficacy over a growing "
                          "vocabulary; TV compressing as distributions spread; a bits "
                          "denominator moving with tokeniser size; and Efficacy's RESOLUTION "
                          "being 1/n_edits, which made a one-case 'break' look real. "
                          "gatefly/scale_guard.py is now a 77-cell grid plus a resolution axis "
                          "and a net that found 27 undeclared fields in this lane's own files."
                    " PRIOR ART, swept 2026-11-19: NOT FOUND, searched explicitly for sample-size and resolution critiques of editing metrics. The literature criticises inconsistency and single-edit scope; it does not appear to treat a measure whose RESOLUTION tracks the thing being varied as a named fault. This lane has four instances, each found by accident, and gatefly/scale_guard.py as the standing check - 77 cells plus a resolution axis, which found 27 undeclared fields in this lane's own files."),
    "E4.4": dict(kind="LEAF", parent="E4",
                 say="Correctness judged against the SET of right answers, not one of them.",
                 why="Otherwise a swap between equally correct answers reads as damage - and "
                     "the SET has to be complete, which is the part that is not settled.",
                 status="measured",
                 evidence="UN-SETTLED 2026-11-18, by the lane whose finding settled it. This "
                          "lane measured real damage 0.0000 for two arms whose naive movement "
                          "count read 0.1250 and 0.1412, which stands. What does NOT stand is "
                          "that counting against the set is therefore sufficient: the v4 lane's "
                          "decoder test found a GRANULARITY MISMATCH - a prompt whose answer "
                          "set says one place while the model answers a more specific one, both "
                          "correct, with the model's answer not in the set's vocabulary at all. "
                          "That is not a surface alias and no detector either lane had was "
                          "looking for it. So the set-valued count is right and INCOMPLETE "
                          "ANSWER SETS are an open sub-problem. See selfimprove_v4 commit "
                          "4ad9d744 for the artefact; the figure is not copied here because "
                          "that lane's figures move - one of them went 14% to 8% the same day."
                    " PRIOR ART, swept 2026-11-19, AND THE SET-VALUED COUNT WAS ALREADY PUBLISHED: PEAK (arXiv:2401.17623) appends an answer and measures the proportion of the ORIGINAL correct answers accidentally removed - the same quantity as this lane's set-valued movement count, published first. Related: multi-label facts with an IGNORE RATE for other correct objects, and Pohl, Ploner & Akbik's manual audit of the string-matching basis of editing metrics. What the sweep did NOT find, searched explicitly, is GRANULARITY MISMATCH - a correct answer at a different specificity, absent from the answer set's vocabulary. That remains open, it is the v4 lane's finding, and neither this lane's count nor PEAK's covers it because both compare against a set that is itself incomplete."),
}

# ---------------------------------------------------------------- candidate experiments
# `node` is what it bears on. `settles` says what a positive result would establish.
# `failure` is how it can come back uninformative - required, because an experiment with no
# stated failure mode is one nobody has thought about.
CANDIDATES = [
    dict(id="graded-targets-by-cost", node="E3a.1",
         say="Grade counterfactual targets by what they THROW AWAY, using the upgraded "
             "oracle's cost_of, and sweep the editor along that axis at a fixed board and a "
             "fixed edit count.",
         settles="whether the editor's difficulty is driven by how WRONG a target is, which is "
                 "a difficulty axis with no dependence on board size",
         failure="Efficacy may stay at 1.0000 across every cost level, as it did across every "
                 "board size, in which case the axis is inert too and that is the result.",
         new_because="The old oracle could not express it: a target was optimal or not, with no "
                     "degree. cost_of and sharpness are new."),
    dict(id="sharpness-stratified-editing", node="E4.2",
         say="Report every editing figure stratified by the position's SHARPNESS: 1,944 "
             "maximally sharp, 1,247 middling, 1,329 dull of 4,520.",
         settles="whether the published metrics resolve differently on positions where a "
                 "mistake is catastrophic versus where every move is fine - a resolution test "
                 "the metrics have never been given",
         failure="the strata may not separate, which would say the metrics are insensitive to "
                 "the thing that actually matters about a position.",
         new_because="sharpness did not exist before this oracle upgrade."),
    dict(id="capacity-ceiling-at-p-approaches-H", node="E3a.3",
         say="Push the edit count toward the key-space dimension H = 256 and find where "
             "Efficacy falls, with Wilson intervals so a one-case fall cannot be read as a break.",
         settles="the capacity node outright: it is the only axis MEASURED to move the edit's "
                 "geometry, 0.0459 to 0.1112 from one doubling",
         failure="it may break for reasons other than capacity, which the per-case a and c now "
                 "recorded would distinguish.",
         new_because="board size was measured inert, so this is the axis that remains."),
    dict(id="site-sweep", node="E2.3",
         say="Run the same edit at every weight matrix of the net, not just "
             "blocks.N.ffwd.net.2.weight, and compare.",
         settles="nothing by itself, but it would say how much of every figure in this lane is "
                 "a property of the site rather than of editing",
         failure="the sites may all behave alike, which would be reassuring and uninformative.",
         new_because="never attempted; every figure here is at one site."),
    # The two RJ proposed hang off OR-nodes, so either working would settle E3 - "install it" -
    # by itself. They are already registered in the boneyard; attaching them to the tree is what
    # makes their status visible beside the obstacles they would bypass.
    dict(id="edit-then-isolated-train-loop", node="E3c",
         say="Alternate a closed-form edit with training confined to an isolated subspace, in "
             "a loop, and test it against editing alone, training alone, and their plain "
             "composition - with the isolation REMOVED as the control.",
         settles="node E3 outright if it installs exactly without the collateral damage "
                 "training causes, because E3 is an OR and one working mechanism is enough",
         failure="the loop may do no better than its own no-isolation control, in which case "
                 "the isolation bought nothing; or the whole thing may already be published, "
                 "which is a successful close and not a failure.",
         new_because="the components are published - GRACE, AlphaEdit, OGD, Gradient Routing - "
                     "but I cannot name one that alternates them with the isolation subspace "
                     "chosen by a closed-form interference quantity."),
    dict(id="capacity-search-inside-the-edit-loop", node="E3d",
         say="Perturb the neuron set at each step - add or remove - measure the effect, and "
             "settle where more private dimensions stop paying for themselves.",
         settles="node E3 outright if an adaptive capacity beats a fixed one, since E3 is an OR",
         failure="growing already measured as a DIAL rather than an improvement - precision up, "
                 "depth down - so an adaptive search may simply trace that trade-off without "
                 "finding a point that dominates.",
         new_because="growing and pruning during training are both well covered; sizing a "
                     "layer by its measured effect on EDITABILITY is what I cannot name."),
    dict(id="key-to-behaviour-gap", node="E3a.2",
         say="Measure the relation between what lands AT THE KEY (the gate's prediction) and "
             "what changes in BEHAVIOUR at positions away from it.",
         settles="the linearity node: whether a correct delta at the key implies correct "
                 "behaviour elsewhere",
         failure="the relation may be dominated by the net's nonlinearity in a way that gives "
                 "no clean statement.",
         new_because="this lane has measured both halves separately and never their relation."),
]


# ---------------------------------------------------------------- the semantics
def children(nid):
    return [k for k, v in NODES.items() if v["parent"] == nid]


def solved(nid, _seen=None):
    """AND: every child solved. OR: any child solved. LEAF: status is 'settled'.

    Only "settled" counts. A "blocked" leaf is a CONFIRMED OBSTACLE and must never count
    toward its parent - that was a real bug here, found by the gap map: two confirmed blockers
    were marked "settled" and were pushing their AND-parent toward solved. A route known to
    fail is the opposite of a route that works.
    """
    _seen = _seen or set()
    if nid in _seen:
        raise ValueError("cycle through %s" % nid)
    _seen = _seen | {nid}
    v = NODES[nid]
    ch = children(nid)
    if not ch:
        return v["status"] == "settled"
    if v["kind"] == "OR":
        return any(solved(c, _seen) for c in ch)
    return all(solved(c, _seen) for c in ch)


def classify(cand):
    """WOULD or MIGHT, computed from the edge type rather than asserted.

    An experiment WOULD settle its parent if the node it attaches to is a child of an OR - one
    sufficient route - or if it attaches to a node that is the only unsettled child of an AND.
    Otherwise it removes one obstacle of several, and MIGHT.
    """
    nid = cand["node"]
    v = NODES[nid]
    par = v["parent"]
    if par is None:
        return "MIGHT", "it attaches to the root, which no single experiment settles"
    pk = NODES[par]["kind"]
    if pk == "OR":
        return "WOULD", ("its parent %s is an OR, so this route succeeding is sufficient for it"
                         % par)
    sibs = [c for c in children(par) if c != nid]
    unsolved = [c for c in sibs if not solved(c)]
    if not unsolved:
        return "WOULD", ("its parent %s is an AND and every other child is already settled, so "
                         "this is the last one" % par)
    return "MIGHT", ("its parent %s is an AND with %d other unsettled child(ren) (%s), so this "
                     "removes one obstacle of several"
                     % (par, len(unsolved), ", ".join(unsolved)))


def walk(nid="E", depth=0, only_open=False, out=None):
    out = out if out is not None else []
    v = NODES[nid]
    ok = solved(nid)
    if not (only_open and ok):
        out.append((depth, nid, v, ok))
    for c in sorted(children(nid)):
        walk(c, depth + 1, only_open, out)
    return out


def propose():
    """Boneyard entries for the candidates, in the registry's schema."""
    ents = []
    for c in CANDIDATES:
        verdict, why = classify(c)
        v = NODES[c["node"]]
        ents.append({
            "id": c["id"],
            "for": "%s (problem tree node %s: %s)" % (c["say"], c["node"], v["say"]),
            "learned": "",
            "attempted": "",
            "state": "ACTIVE",
            "started": "2026-11-18",
            "decides": "%s. It %s settle node %s, because %s. It can come back uninformative: %s"
                       % (c["settles"], verdict, c["node"], why, c["failure"]),
            "prior_art": "Attached to the AND/OR goal tree in gatefly/problem_tree.py rather "
                         "than proposed free-standing; the tree's own prior art is KAOS "
                         "(van Lamsweerde) for goal refinement and fault tree analysis "
                         "(NUREG-0492) for the failure framing. The experiment itself is new "
                         "to this lane BECAUSE %s - which is a claim about this lane's "
                         "instruments, not about the literature, and the literature search is "
                         "the first task of whoever takes it." % c["new_because"],
        })
    return ents


# ---------------------------------------------------------------- plants
def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. structure: one root, every node reachable from it, no cycles, no dangling parent.
    roots = [k for k, v in NODES.items() if v["parent"] is None]
    _plant("there is not exactly one root: %s" % roots, len(roots) == 1)
    bad = [k for k, v in NODES.items() if v["parent"] and v["parent"] not in NODES]
    _plant("a node names a parent that does not exist: %s" % bad, not bad)
    reached = {nid for _, nid, _, _ in walk("E")}
    _plant("nodes unreachable from the root: %s" % sorted(set(NODES) - reached),
           reached == set(NODES))
    try:
        solved("E")
        cyc = False
    except ValueError:
        cyc = True
    _plant("the tree has a cycle", not cyc)

    # 2. AND/OR SEMANTICS MUST ACTUALLY COMPUTE, checked on a constructed tree whose answer is
    #    known by hand. Without this, solved() could return a constant and every verdict in the
    #    walk would be vacuous.
    saved = dict(NODES)
    try:
        NODES.clear()
        NODES.update({
            "R": dict(kind="AND", parent=None, say="", why="", status="open", evidence=None),
            "A": dict(kind="LEAF", parent="R", say="", why="", status="settled", evidence=None),
            "B": dict(kind="OR", parent="R", say="", why="", status="open", evidence=None),
            "B1": dict(kind="LEAF", parent="B", say="", why="", status="open", evidence=None),
            "B2": dict(kind="LEAF", parent="B", say="", why="", status="settled", evidence=None),
        })
        _plant("an OR with one settled child is not solved", solved("B"))
        _plant("an AND with all children solved is not solved", solved("R"))
        NODES["B2"]["status"] = "open"
        _plant("an OR with NO settled child is still solved", not solved("B"))
        _plant("an AND with an unsolved child is still solved", not solved("R"))
    finally:
        NODES.clear()
        NODES.update(saved)

    # 3. every candidate names a node that exists, and classify covers both verdicts - a
    #    classifier that only ever says MIGHT would pass a weaker check.
    bad = [c["id"] for c in CANDIDATES if c["node"] not in NODES]
    _plant("a candidate names a node that does not exist: %s" % bad, not bad)
    verdicts = {classify(c)[0] for c in CANDIDATES}
    _plant("classify never says WOULD: %s" % verdicts, "WOULD" in verdicts)
    _plant("classify never says MIGHT: %s" % verdicts, "MIGHT" in verdicts)
    # and on a CONSTRUCTED tree, so the classifier is tested independently of which real
    # candidates happen to exist today
    saved2 = dict(NODES)
    try:
        NODES.clear()
        NODES.update({
            "R": dict(kind="OR", parent=None, say="", why="", status="open", evidence=None),
            "X": dict(kind="LEAF", parent="R", say="", why="", status="open", evidence=None),
            "S": dict(kind="AND", parent="R", say="", why="", status="open", evidence=None),
            "S1": dict(kind="LEAF", parent="S", say="", why="", status="open", evidence=None),
            "S2": dict(kind="LEAF", parent="S", say="", why="", status="open", evidence=None),
            "T": dict(kind="AND", parent="R", say="", why="", status="open", evidence=None),
            "T1": dict(kind="LEAF", parent="T", say="", why="", status="open", evidence=None),
            "T2": dict(kind="LEAF", parent="T", say="", why="", status="settled", evidence=1),
        })
        vX = classify({"node": "X"})[0]
        vS1 = classify({"node": "S1"})[0]
        vT1 = classify({"node": "T1"})[0]
        _plant("a child of an OR is not WOULD (got %s)" % vX, vX == "WOULD")
        _plant("a child of an AND with another unsettled sibling is not MIGHT (got %s)" % vS1,
               vS1 == "MIGHT")
        _plant("the LAST unsettled child of an AND is not WOULD (got %s)" % vT1,
               vT1 == "WOULD")
    finally:
        NODES.clear()
        NODES.update(saved2)

    # 4. every candidate must declare a FAILURE MODE. An experiment with no stated way to come
    #    back uninformative is one nobody has thought about.
    bad = [c["id"] for c in CANDIDATES if not c.get("failure")]
    _plant("a candidate has no stated failure mode: %s" % bad, not bad)

    # 5. every node must carry evidence or be explicitly marked as having none, and a node
    #    claiming "settled" must carry evidence for it.
    bad = [k for k, v in NODES.items()
           if v["status"] == "settled" and not v.get("evidence")]
    _plant("a node is marked settled with no evidence: %s" % bad, not bad)

    # 6. the emitted boneyard entries must satisfy the registry's own gate: the fields it
    #    requires, prior_art non-empty, and ACTIVE entries carrying started and decides.
    import re
    HEDGE = re.compile(r"\b(probably|i think|something like|maybe|perhaps|possibly)\b", re.I)
    ents = propose()
    bad = [e["id"] for e in ents
           if not all(f in e for f in ("for", "learned", "attempted", "state", "prior_art"))]
    _plant("an emitted entry is missing a required field: %s" % bad, not bad)
    bad = [e["id"] for e in ents if e["state"] == "ACTIVE" and not (e.get("started")
                                                                   and e.get("decides"))]
    _plant("an ACTIVE entry lacks started or decides: %s" % bad, not bad)
    bad = [e["id"] for e in ents if HEDGE.search(e["prior_art"])]
    _plant("an entry hedges in prior_art: %s" % bad, not bad)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", dest="only_open", action="store_true")
    ap.add_argument("--propose", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    if a.propose:
        ents = propose()
        would = [c for c in CANDIDATES if classify(c)[0] == "WOULD"]
        might = [c for c in CANDIDATES if classify(c)[0] == "MIGHT"]
        print("WOULD settle their node (attached to an OR, or the last unsettled child of an AND):")
        for c in would:
            print("  %-34s -> %s  %s" % (c["id"], c["node"], classify(c)[1]))
        print("MIGHT settle it (one obstacle of several):")
        for c in might:
            print("  %-34s -> %s  %s" % (c["id"], c["node"], classify(c)[1]))
        p = os.path.join(HERE, "runs", "proposed_boneyard.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"_what": "Boneyard entries proposed from the problem tree's OPEN nodes. "
                                "Merge into closed_loop_lite/ratchet/boneyard.json mechanisms.",
                       "mechanisms": ents}, f, indent=1)
        print("wrote " + p)
        raise SystemExit(0)
    rows = walk("E", only_open=a.only_open)
    print("WHY CAN'T WE BUILD A PERFECT EDITOR - an AND/OR goal refinement tree")
    print("(AND = every child necessary.  OR = any child sufficient.)\n")
    for depth, nid, v, ok in rows:
        pad = "  " * depth
        mark = "[settled]" if ok else "[OPEN]   "
        print("%s%s %-6s %-4s %s" % (pad, mark, nid, v["kind"], v["say"]))
        if v.get("evidence"):
            print("%s          %s" % (pad, v["evidence"]))
    n_open = sum(1 for _, _, _, ok in rows if not ok)
    print("\n  %d nodes, %d open" % (len(rows), n_open))
