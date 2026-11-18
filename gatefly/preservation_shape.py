"""Does Eq. 7's MEAN hide what happened, and would a median have caught it? (UC-GF-3 step 4)

    py -X utf8 -I gatefly/preservation_shape.py --name ttt_big
    py -X utf8 -I gatefly/preservation_shape.py --selftest

WHY THIS FILE EXISTS. The selfimprove_v4 lane took the mechanism from this lane's note, ran it
over its OWN record, and found that the fault there is not the one this lane named:

  * on its five WEIGHT-EDIT arms the mean/median ratio is 0.89 to 1.02, so there is no skew and
    A MEDIAN WOULD HAVE CAUGHT NOTHING;
  * what bites there is CANCELLATION - its baseline's Preservation of 1.0008 averages 52% of
    probes falling and 48% rising, 14% of them falling by more than a tenth;
  * so a count of MOVEMENT separates "nothing moved" from "half moved each way", and no measure
    of central tendency can.

That lane's figures are its own and are not reproduced here. What IS done here is the same test
on THIS lane's data, because recommending a median to someone else without having checked it on
my own numbers is the fault this repo logs as a check that was never run against the thing it
excludes. The answer below decides whether "a median would have caught it" stays in this lane's
write-up or comes out of it.

THE FOUR SHAPES, computed per arm over the same E_ind the published metric uses:
    mean          Eq. 7 itself, which must reproduce the recorded figure or this refuses
    median        the robust centre
    p10           the worst tenth
    frac_below_1  how much of E_ind moved DOWN at all
    changed_argmax  the fraction of E_ind whose ARGMAX changed - a count of movement, not a
                  centre, and the only one that cannot cancel
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import metrics as M
import net as N
import retrain as R
import ttt

OUT = os.path.join(HERE, "runs")


def shape(pre, post, pre_arg, post_arg):
    """Every shape of the same Eq. 7 ratio set, plus the movement count."""
    r = []
    excluded = 0
    for p, q in zip(pre, post):
        if p == 0.0:
            excluded += 1
            continue
        r.append(q / p)
    r = np.array(r, dtype=np.float64)
    if r.size == 0:
        return None
    changed = float(np.mean([1.0 if a != b else 0.0 for a, b in zip(pre_arg, post_arg)]))
    return {"n": int(r.size), "excluded": excluded,
            "mean_eq7": float(r.mean()), "median": float(np.median(r)),
            "p10": float(np.percentile(r, 10)), "p90": float(np.percentile(r, 90)),
            "frac_below_1": float(np.mean(r < 1.0)),
            "frac_below_0.9": float(np.mean(r < 0.9)),
            "mean_over_median": float(r.mean() / np.median(r)) if np.median(r) else float("nan"),
            "changed_argmax": changed}


def run(a):
    dev = "cuda" if torch.cuda.is_available() and not a.cpu else "cpu"
    base, meta = N.load(os.path.join(OUT, a.name), dev)
    layer = meta["hyper"]["n_layers"] - 1
    C, cov_n, cov_cond = R.covariance(base, layer, dev)
    cases = R.build_cases(base, a.size, dev, a.seed)
    ind = R.indirect_set(cases, a.indirect)
    ind_pre = [t["prefix"] for t in ind]

    board_states, board_prefixes = [], []
    for s_ in ttt.decisions():
        pr = M.prefix_of(s_)
        if pr is not None:
            board_states.append(s_)
            board_prefixes.append(pr)

    pre_all = R.read_all(base, cases, ind, dev)          # the real pre-state, not a stub
    P0 = R.probs(base, ind_pre, dev)
    pre_p = [float(P0[i, t["answer"]]) for i, t in enumerate(ind)]
    pre_arg = P0.argmax(1).tolist()
    if pre_p != pre_all["ind_p"]:
        raise SystemExit("the indirect probabilities read two ways disagree")

    rows = []
    for arm in a.arms.split(","):
        m, s, info = R.run_arm(base, "" if arm == "control" else arm, cases, ind,
                               pre_all, layer, dev, a.lam, C, a.grow_per_case, a.prune_k)
        P1 = R.probs(m, ind_pre, dev)
        post_p = [float(P1[i, t["answer"]]) for i, t in enumerate(ind)]
        sh = shape(pre_p, post_p, pre_arg, P1.argmax(1).tolist())
        # the oracle, which is the thing the metric is being judged against
        BP = R.probs(m, board_prefixes, dev)
        comp = float(np.mean([1.0 if (p < 9 and p in ttt.optimal_moves(s_)) else 0.0
                              for p, s_ in zip(BP.argmax(1), board_states)]))
        # REFUSE if Eq. 7 recomputed here disagrees with the published implementation
        eq7, kept, exc = M.preservation(pre_p, post_p)
        if abs(eq7 - sh["mean_eq7"]) > 1e-9:
            raise SystemExit("Eq.7 %.10f disagrees with the mean of the same ratios %.10f"
                             % (eq7, sh["mean_eq7"]))
        sh.update({"arm": arm, "competence_after": comp})
        rows.append(sh)
        print("  %-14s Eq.7 mean %.4f  median %.4f  p10 %.4f  <1 %.2f  <0.9 %.2f  "
              "m/med %.2f  CHANGED-ARGMAX %.4f  competence %.4f"
              % (arm, sh["mean_eq7"], sh["median"], sh["p10"], sh["frac_below_1"],
                 sh["frac_below_0.9"], sh["mean_over_median"], sh["changed_argmax"], comp))

    doc = {"name": a.name, "size": a.size, "indirect": len(ind), "layer": layer,
           "seed": a.seed, "rows": rows,
           "what": "Eq. 7's ratio set in four shapes plus a movement count, per arm, beside "
                   "the oracle competence the metric is being judged against.",
           "sibling_lane": "selfimprove_v4 ran the same mechanism over its own record and "
                           "found mean/median 0.89-1.02 on its five weight-edit arms, so the "
                           "median catches nothing there; its fault is cancellation. Its "
                           "figures are its own and are NOT reproduced here."}
    p = os.path.join(OUT, a.name + ".preservation_shape.json")
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, indent=1)
    print("wrote " + p)
    return 0


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. CANCELLATION: half the probes halve, half double. The mean sits above 1 and the MEDIAN
    #    IS ALSO NEAR 1, so neither centre shows that everything moved - but the movement count
    #    is 1.0. This is the sibling lane's case, constructed.
    pre = [0.5] * 100
    post = [0.25] * 50 + [1.0] * 50
    sh = shape(pre, post, list(range(100)), [i + 1 for i in range(100)])
    _plant("a fully cancelling set does not keep the median near 1 (%.4f)" % sh["median"],
           0.4 < sh["median"] < 1.6)
    _plant("the movement count missed a set where every probe moved (%.4f)" % sh["changed_argmax"],
           sh["changed_argmax"] == 1.0)
    _plant("frac_below_1 missed half the set falling (%.4f)" % sh["frac_below_1"],
           abs(sh["frac_below_1"] - 0.5) < 1e-9)

    # 2. NOTHING MOVED: every shape must say so, and the movement count must be 0. If this
    #    fails, a quiet arm would look damaged.
    sh2 = shape(pre, list(pre), list(range(100)), list(range(100)))
    _plant("an untouched set does not give mean, median and p10 of exactly 1.0",
           sh2["mean_eq7"] == 1.0 and sh2["median"] == 1.0 and sh2["p10"] == 1.0)
    _plant("the movement count fired on an untouched set", sh2["changed_argmax"] == 0.0)

    # 3. SKEW: a few probes rise a lot, the rest are untouched. Here the mean moves and the
    #    median does NOT, which is the case where a median IS the right instrument - so the two
    #    faults are distinguishable by these numbers and not by one of them.
    post3 = [0.5] * 90 + [5.0] * 10
    sh3 = shape(pre, post3, list(range(100)), list(range(100)))
    _plant("a skewed set does not separate mean from median (%.4f vs %.4f)"
           % (sh3["mean_eq7"], sh3["median"]), sh3["mean_eq7"] > 1.5 and sh3["median"] == 1.0)
    _plant("mean_over_median does not flag the skew (%.4f)" % sh3["mean_over_median"],
           sh3["mean_over_median"] > 1.5)

    # 4. the two faults must look DIFFERENT on these shapes, or the table cannot tell them apart
    _plant("cancellation and skew are indistinguishable on mean_over_median",
           abs(sh["mean_over_median"] - sh3["mean_over_median"]) > 0.5)

    # 5. p == 0 probes are excluded per E'_ind, and counted.
    sh5 = shape([0.0, 0.5], [0.3, 0.5], [0, 1], [0, 1])
    _plant("a zero-probability probe was not excluded and counted",
           sh5["n"] == 1 and sh5["excluded"] == 1)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_big")
    ap.add_argument("--size", type=int, default=1)
    ap.add_argument("--indirect", type=int, default=800)
    ap.add_argument("--arms", default="control,memit,retrain,corpus_w")
    ap.add_argument("--lam", type=float, default=1.0)
    ap.add_argument("--grow-per-case", dest="grow_per_case", type=int, default=1)
    ap.add_argument("--prune-k", dest="prune_k", type=int, default=16)
    ap.add_argument("--seed", type=int, default=19)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    raise SystemExit(selftest() if a.selftest else run(a))
