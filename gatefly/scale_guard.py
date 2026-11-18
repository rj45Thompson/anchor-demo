"""Which comparisons in this zoo are confounded by the measure's own scale? (RJ, 2026-11-18)

    py -X utf8 -I gatefly/scale_guard.py                 print the grid
    py -X utf8 -I gatefly/scale_guard.py --check ladder  refuse the confounded cells of a run
    py -X utf8 -I gatefly/scale_guard.py --selftest

RJ: "figure out exactly what 'the scale of the measure tracks the thing being varied' means in
a zoo of experiments. Can we predict it and understand it in every way?"

THE FAULT, STATED PRECISELY. A comparison of M across conditions c1, c2 is valid only if M's
value does not depend on c through anything but the effect being studied. Write M = f(effect,
s(c)) where s is a SCALE-CARRYING ARGUMENT. If s(c1) != s(c2), then M(c1) - M(c2) contains the
effect AND the scale change, and no amount of care in running the experiment separates them
afterwards. The fix is never statistical; it is to pick a measure whose s does not move, or whose
dependence on s is known and divided out.

THREE INSTANCES IN ONE DAY, each found by accident, which is why this file exists:
  1. Efficacy `p > 0.5` taken over the whole vocabulary, compared across board sizes. The
     vocabulary grows with the board (10 tokens at 3,3,3, 17 at 4,4,4), so the same
     concentration of mass reads lower on a bigger board. Caught before the ladder reported.
  2. Removal damage as mean TOTAL VARIATION, compared across board sizes. TV is bounded and
     compresses as a distribution spreads; KL is unbounded and does not. Either turns board size
     into a trend.
  3. A sibling lane's `--bits` normalised by log2(vocab), compared across models. The denominator
     swings about 13% on tokeniser size alone: 32,000 -> 14.97 bits, 50,257 -> 15.62,
     128,256 -> 16.97.

WHAT THE THREE HAVE IN COMMON, which is the start of an answer to "can we predict it": in all
three the scale-carrier is THE CARDINALITY OF AN OUTCOME SPACE. That may be the class, or it may
be what this group of lanes happened to hit. The grid below therefore lists OTHER scale-carriers
that are known to bite - sample size, dimension, base rate, selection count, sequence length -
so the enumeration is not quietly narrowed to the three we found.

NOT A NOVEL IDEA, and the prior art must not be re-derived: Stevens' scale types (1946) settle
which operations a measure admits; dimensional analysis and the Buckingham pi theorem (1914)
require a law to be expressible in dimensionless groups; psychometrics calls the comparison
version MEASUREMENT INVARIANCE (Meredith, 1993) and Rasch's SPECIFIC OBJECTIVITY (1961); and
ThinkEval's own IFR divides by sqrt(n_S) for exactly this reason. What is offered here is only
the mechanical part: the grid for THIS zoo, and a check that refuses a confounded comparison
instead of leaving it to be noticed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- the scale-carriers
# Each is something a measure's value can depend on that is NOT the effect under study.
CARRIERS = {
    "support": "the cardinality of the outcome space (vocabulary, legal-move count, label set)",
    "n": "the number of observations the figure is computed over",
    "dim": "the dimension of the space the quantity lives in",
    "base_rate": "the prevalence of the positive class, or the pre-edit value being ratio'd",
    "selection": "how many candidates a max or best-of was taken over",
    "length": "sequence or chain length",
    "bound": "whether the measure is bounded, so it compresses near its ceiling or floor",
}

# ---------------------------------------------------------------- the measures in this zoo
# For each: which carriers it depends on, and what to do about each.
#   "invariant"  - does not move with that carrier
#   "corrected"  - moves, but the dependence is divided out and HOW is named
#   "CONFOUNDED" - moves, uncorrected: comparing across an axis that changes it is invalid
MEASURES = {
    "efficacy_p_gt_0.5": {
        "what": "fraction of cases whose target probability exceeds 0.5 over the WHOLE vocabulary",
        "support": ("CONFOUNDED", "mass spreads over more tokens as the vocabulary grows, so "
                                  "the same concentration reads lower"),
        "n": ("invariant", "a fraction"),
        "base_rate": ("CONFOUNDED", "a target already near 0.5 before the edit needs less to "
                                    "cross than one near 0"),
        "bound": ("CONFOUNDED", "a hard threshold on a bounded quantity: once every case is "
                                "over 0.5 the measure cannot report further improvement, which "
                                "is the saturation this lane hit at every edit-set size"),
    },
    "efficacy_legal_renormalised": {
        "what": "the same threshold after renormalising over the LEGAL moves at that position",
        "support": ("corrected", "the vocabulary is divided out; what remains is the legal-move "
                                 "count, which varies by POSITION and not by rung, so it "
                                 "averages out across a rung rather than trending with it"),
        "n": ("invariant", "a fraction"),
        "bound": ("CONFOUNDED", "still a hard threshold, so it still saturates"),
    },
    "efficacy_argmax": {
        "what": "the target is the argmax",
        "support": ("CONFOUNDED", "beating 16 competitors is harder than beating 9, though the "
                                  "dependence is weaker than a threshold on raw probability"),
        "bound": ("CONFOUNDED", "saturates"),
    },
    "competence_set_valued": {
        "what": "fraction of positions whose argmax lies IN the optimal set",
        "support": ("invariant", "'did it pick a correct move' means the same at every board "
                                 "size; this is why it is the cross-rung damage measure"),
        "n": ("invariant", "a fraction, with its denominator reported"),
        "base_rate": ("invariant", "measured against the oracle, not against the model's own "
                                   "previous answer"),
        "bound": ("CONFOUNDED", "bounded above by 1, so it compresses near a competent net"),
    },
    "damage_tv": {
        "what": "mean total variation between parent and child move distributions",
        "support": ("CONFOUNDED", "bounded in [0,1] and compresses as the distribution spreads "
                                  "over a bigger board"),
        "bound": ("CONFOUNDED", "bounded by construction"),
        "n": ("invariant", "a mean over positions, denominator reported"),
    },
    "damage_kl": {
        "what": "mean KL at the read position",
        "support": ("CONFOUNDED", "unbounded, and its typical magnitude grows with the support "
                                  "it sums over - in the OPPOSITE direction to TV, which is why "
                                  "neither is safe across rungs"),
        "bound": ("invariant", "unbounded"),
    },
    "crowding_fraction_c_over_a": {
        "what": "mean of c/a over the edit's keys",
        "dim": ("corrected", "a ratio of two quantities in the same space, so the ridge scale "
                             "cancels; this is the lane's reason for using the RATIO rather "
                             "than c alone"),
        "n": ("CONFOUNDED", "crowding rises with the NUMBER OF KEYS, so it is only comparable "
                            "at a fixed edit count - which the ladder holds fixed on purpose"),
        "support": ("invariant", "a property of the weights and keys, not of the label space"),
    },
    "spearman_rho": {
        "what": "rank correlation between a predictor and damage",
        "n": ("corrected", "rho itself is invariant; its P-VALUE is not, and a p-value must "
                           "never be compared across runs of different n"),
        "bound": ("CONFOUNDED", "bounded in [-1,1], so it compresses near a strong effect"),
    },
    "preservation_eq7_mean": {
        "what": "ThinkEval Eq. 7, the mean of post/pre ratios over indirect probes",
        "base_rate": ("CONFOUNDED", "a mean of unbounded RATIOS is dominated by probes whose "
                                    "pre-value was small; this is the fault that read 1.1309 "
                                    "while a model lost 25.7% of its competence"),
        "n": ("invariant", "a mean, denominator reported"),
        "bound": ("invariant", "unbounded above, which is the problem"),
    },
    "movement_count_set_valued": {
        "what": "fraction of probes whose argmax left the SET of correct answers",
        "support": ("invariant", "counts set membership, not probability mass"),
        "base_rate": ("invariant", "counted against the oracle's set"),
        "n": ("invariant", "a fraction"),
        "bound": ("CONFOUNDED", "bounded, compresses near zero damage"),
    },
    "best_of_k_random": {
        "what": "the best random cut over k seeds, used as the null in the shrink sweep",
        "selection": ("CONFOUNDED", "the maximum of a sample GROWS with k, so a best-of-8 null "
                                    "is a harder bar than a best-of-4 and the two cannot be "
                                    "compared; the sweep reports the mean and sd beside it for "
                                    "this reason"),
    },
}

# ---------------------------------------------------------------- the axes this zoo varies
AXES = {
    "board_size": ["support", "length"],
    "edit_count": ["n", "selection"],
    "model_size": ["dim"],
    "tokeniser": ["support"],
    "seed_count": ["selection"],
    "position_sample_size": ["n"],
    "chain_length": ["length", "n"],
}


def grid():
    """Every (measure, axis) cell, adjudicated. A cell is CONFOUNDED when the axis moves a
    carrier the measure is confounded on."""
    out = []
    for mname, spec in MEASURES.items():
        for axis, carriers in AXES.items():
            verdicts = []
            for car in carriers:
                if car in spec:
                    verdicts.append((car,) + spec[car])
            if not verdicts:
                out.append({"measure": mname, "axis": axis, "verdict": "unaffected",
                            "why": "this axis moves no carrier this measure depends on"})
                continue
            bad = [v for v in verdicts if v[1] == "CONFOUNDED"]
            if bad:
                out.append({"measure": mname, "axis": axis, "verdict": "CONFOUNDED",
                            "carrier": bad[0][0], "why": bad[0][2]})
            else:
                out.append({"measure": mname, "axis": axis, "verdict": "corrected",
                            "carrier": verdicts[0][0], "why": verdicts[0][2]})
    return out


def comparable(measure, axis):
    """-> (ok, why). The predictive form: ask BEFORE running whether a planned comparison is
    valid, instead of discovering it afterwards."""
    if measure not in MEASURES:
        return False, ("measure %r is not in the grid, so its scale-carriers have never been "
                       "declared and no comparison across it can be sanctioned" % measure)
    if axis not in AXES:
        return False, ("axis %r is not in the grid, so what it moves has never been declared"
                       % axis)
    for cell in grid():
        if cell["measure"] == measure and cell["axis"] == axis:
            return cell["verdict"] != "CONFOUNDED", cell["why"]
    return False, "no cell"


def check_run(path, axis):
    """Refuse the confounded comparisons a run file invites, by name."""
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    found = set()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in MEASURES:
                    found.add(k)
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(doc)
    rows = []
    for m in sorted(found):
        ok, why = comparable(m, axis)
        rows.append({"measure": m, "axis": axis, "comparable": ok, "why": why})
    return rows


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. THE THREE INSTANCES THAT ACTUALLY HAPPENED must each come out CONFOUNDED on the axis
    #    they happened on. If the grid cannot reproduce the faults it was built from, it is a
    #    description of nothing.
    ok1, _ = comparable("efficacy_p_gt_0.5", "board_size")
    _plant("the grid does not flag the Efficacy-over-vocabulary fault", not ok1)
    ok2, _ = comparable("damage_tv", "board_size")
    _plant("the grid does not flag TV compressing across board sizes", not ok2)
    ok3, _ = comparable("preservation_eq7_mean", "edit_count")
    # Eq.7's fault is base_rate, which edit_count does not move - so this one must come out
    # UNAFFECTED, and that is the check that the grid is not simply saying no to everything
    _plant("the grid flags Eq.7 against an axis that does not move its carrier", ok3)

    # 2. THE FIX must come out better than the thing it replaced on the same axis.
    okf, _ = comparable("efficacy_legal_renormalised", "board_size")
    _plant("the renormalised criterion is not an improvement on the raw one over board_size",
           okf and not ok1)
    okc, _ = comparable("competence_set_valued", "board_size")
    _plant("set-valued competence is not comparable across board sizes, but the ladder uses it "
           "as its cross-rung damage measure", okc)

    # 3. A MEASURE NOT IN THE GRID MUST BE REFUSED, not waved through. An unknown measure is the
    #    most likely way the next instance of this fault arrives.
    oku, whyu = comparable("some_new_metric", "board_size")
    _plant("an undeclared measure was sanctioned instead of refused", not oku)
    _plant("the refusal does not say WHY an undeclared measure is refused",
           "never been declared" in whyu)
    oka, _ = comparable("efficacy_p_gt_0.5", "some_new_axis")
    _plant("an undeclared axis was sanctioned instead of refused", not oka)

    # 4. the grid must contain BOTH verdicts - a grid that says CONFOUNDED everywhere would
    #    pass plant 1 while being useless.
    g = grid()
    vs = set(c["verdict"] for c in g)
    _plant("the grid does not contain all three verdicts: %s" % sorted(vs),
           {"CONFOUNDED", "corrected", "unaffected"} <= vs)
    nconf = sum(1 for c in g if c["verdict"] == "CONFOUNDED")
    _plant("the grid is all CONFOUNDED (%d of %d) and so cannot discriminate"
           % (nconf, len(g)), 0 < nconf < len(g))
    print("  grid: %d cells, %d CONFOUNDED, %d corrected, %d unaffected"
          % (len(g), nconf, sum(1 for c in g if c["verdict"] == "corrected"),
             sum(1 for c in g if c["verdict"] == "unaffected")))

    # 5. every carrier named by an axis must EXIST, or an axis could silently move nothing.
    bad = [(a, c) for a, cs in AXES.items() for c in cs if c not in CARRIERS]
    _plant("an axis names a carrier that is not declared: %s" % bad, not bad)
    # and every measure's keys must be carriers or the descriptive field
    bad2 = [(m, k) for m, s in MEASURES.items() for k in s
            if k != "what" and k not in CARRIERS]
    _plant("a measure declares a dependence on an undeclared carrier: %s" % bad2, not bad2)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", default=None, help="a run file stem in runs/, e.g. ladder")
    ap.add_argument("--axis", default="board_size")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    if a.check:
        p = os.path.join(HERE, "runs", a.check + ".json")
        if not os.path.exists(p):
            raise SystemExit("no such run file: " + p)
        print("Comparisons in %s across the axis %r:" % (a.check, a.axis))
        bad = 0
        for r in check_run(p, a.axis):
            print("  %-34s %s" % (r["measure"], "ok" if r["comparable"] else "REFUSED"))
            if not r["comparable"]:
                bad += 1
                print("      %s" % r["why"])
        print("  %d measure(s) must not be compared across %s" % (bad, a.axis))
        raise SystemExit(1 if bad else 0)
    g = grid()
    print("THE GRID: %d measures x %d axes" % (len(MEASURES), len(AXES)))
    for cell in g:
        if cell["verdict"] == "CONFOUNDED":
            print("  CONFOUNDED  %-34s across %-22s via %s"
                  % (cell["measure"], cell["axis"], cell["carrier"]))
    print("\n  %d CONFOUNDED, %d corrected, %d unaffected, of %d cells"
          % (sum(1 for c in g if c["verdict"] == "CONFOUNDED"),
             sum(1 for c in g if c["verdict"] == "corrected"),
             sum(1 for c in g if c["verdict"] == "unaffected"), len(g)))
    out = os.path.join(HERE, "runs", "scale_grid.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"carriers": CARRIERS, "measures": MEASURES, "axes": AXES, "grid": g}, f,
                  indent=1)
    print("wrote " + out)
