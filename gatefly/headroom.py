"""Does REFUSING to include a key ever beat including it? (the ratchet lane's headroom claim)

    py -X utf8 -I gatefly/headroom.py --name ttt_big --sizes 8,16,32,64,128
    py -X utf8 -I gatefly/headroom.py --selftest

WHY THIS FILE EXISTS. This lane's brief carried, as an established result:

    "REFUSING to include something never beats including it. Headroom was exactly zero in all
     four regimes. So an ABSTENTION rule has nothing to protect against."

The ratchet lane then wrote, unprompted, that the companion claim in the same brief - that
ranking by `a` picks the best subset at EVERY size - came from 15 subsets of FOUR keys at one
gpt2 layer and was an overclaim, which this lane's own k = 16 and 8 measurements refuted. It
said plainly that the headroom result rests on the same four keys, one layer, one lambda, one
model, and that testing it here would be worth more than taking it on trust. This is that test.

WHAT HEADROOM IS, stated so it can come out zero honestly. Given p requested edits, the joint
solve installs all p at once and pays for their cross-talk. An ABSTENTION rule would instead
install some subset S and refuse the rest. Refusing a key means that key's edit does not happen
at all, so abstention can only win if the cross-talk the dropped keys were causing cost the
REMAINING keys more than the dropped keys were worth.

    headroom = max over S of objective(S)  -  objective(all p)

The objective counts installed edits over ALL p requested, so a refused edit counts as a miss -
otherwise "refuse everything" would score perfectly and the question would be empty.

THE SATURATION TRAP, checked first and reported whether or not it fires. If the joint solve
already installs every edit, headroom is zero because there is a CEILING, not because the solve
is optimal, and those are different facts. So the sweep runs upward until the full-set objective
drops below 1.0, and if it never does, this file says the claim could not be tested here rather
than reporting a confirmation it has not earned.
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

import gate_math as GM
import metrics as M
import net as N
import retrain as R
import ttt

OUT = os.path.join(HERE, "runs")


def installed(model, cases, device, threshold=0.5):
    """How many of the REQUESTED edits actually hold, over all of them."""
    P = R.probs(model, [c["prefix"] for c in cases], device)
    hits = [1.0 if float(P[i, c["target"]]) > threshold else 0.0 for i, c in enumerate(cases)]
    return float(np.mean(hits)), hits


def key_alignment(K):
    """Mean pairwise cosine of the edit's keys - the regime axis the lane swept."""
    Kn = K / np.maximum(np.linalg.norm(K, axis=0, keepdims=True), 1e-12)
    G = Kn.T @ Kn
    p = G.shape[0]
    if p < 2:
        return float("nan")
    iu = np.triu_indices(p, 1)
    return float(G[iu].mean())


def edit_subset(base, cases, subset, layer, device, lam, C, K=None, Rd=None):
    """The joint solve over `subset` only, then score over ALL cases.

    K and Rd are the keys and the requested changes for ALL cases, computed ONCE against the
    base model; the subset just selects columns. Recomputing them per subset is the same
    optimisation repeated and makes the sweep O(n^2) - the first run had to be stopped for it.
    """
    m = R.clone(base, device)
    if subset:
        sub_cases = [cases[i] for i in subset]
        R.memit_edit(m, sub_cases, layer, device, lam, C,
                     K=None if K is None else K[:, subset],
                     R=None if Rd is None else Rd[:, subset])
    return m


def run(a):
    dev = "cuda" if torch.cuda.is_available() and not a.cpu else "cpu"
    base, meta = N.load(os.path.join(OUT, a.name), dev)
    layer = meta["hyper"]["n_layers"] - 1
    C, cov_n, cov_cond = R.covariance(base, layer, dev)
    rows = []
    for n in [int(x) for x in a.sizes.split(",")]:
        cases = R.build_cases(base, n, dev, a.seed)
        if len(cases) < n:
            print("  only %d cases available at n=%d" % (len(cases), n))
        K = R.ffwd_keys(base, [c["prefix"] for c in cases], layer, dev).T
        align = key_alignment(K)
        A, _ = GM.gate_matrix(K, C, a.lam)
        aa = np.diag(A).copy()
        cc = GM.crowding_all(A)

        Rd = R.target_deltas(base, cases, layer, dev)     # ONCE, against the base model
        full = edit_subset(base, cases, list(range(len(cases))), layer, dev, a.lam, C, K, Rd)
        obj_full, hits_full = installed(full, cases, dev)

        row = {"n": len(cases), "mean_pairwise_cosine": align,
               "median_a": float(np.median(aa)), "median_c": float(np.median(cc)),
               "mean_crowding_fraction": float(np.mean(cc / np.maximum(aa, 1e-12))),
               "objective_full_set": obj_full,
               "saturated": bool(obj_full >= 1.0 - 1e-12)}

        if row["saturated"]:
            row["headroom"] = 0.0
            row["headroom_why"] = ("the full joint solve already installs every edit, so "
                                   "headroom is zero by CEILING and not by optimality. The "
                                   "claim is NOT tested at this size.")
            print("  n=%-4d cos %+.3f  full objective %.4f  SATURATED - not a test"
                  % (len(cases), align, obj_full))
        else:
            # leave-one-out, which is where an abstention rule would act first, plus random
            # subsets so the search is not only over one shape
            best, best_what = obj_full, "the full set"
            trials = []
            for j in range(len(cases)):
                sub = [i for i in range(len(cases)) if i != j]
                o, _ = installed(edit_subset(base, cases, sub, layer, dev, a.lam, C, K, Rd),
                                 cases, dev)
                trials.append({"drop": [j], "objective": o})
                if o > best + 1e-12:
                    best, best_what = o, "dropping key %d" % j
            rng = np.random.default_rng(a.seed + 5)
            for t in range(a.random_subsets):
                k = int(rng.integers(max(1, len(cases) // 2), len(cases)))
                sub = sorted(rng.permutation(len(cases))[:k].tolist())
                o, _ = installed(edit_subset(base, cases, sub, layer, dev, a.lam, C, K, Rd),
                                 cases, dev)
                trials.append({"keep": sub, "objective": o})
                if o > best + 1e-12:
                    best, best_what = o, "a random subset of %d" % k
            row["headroom"] = best - obj_full
            row["best_subset_objective"] = best
            row["best_subset_was"] = best_what
            row["subsets_tried"] = len(trials)
            row["trials"] = trials
            print("  n=%-4d cos %+.3f  full objective %.4f  best subset %.4f  HEADROOM %+.4f  "
                  "(%s, %d subsets tried)"
                  % (len(cases), align, obj_full, best, row["headroom"], best_what, len(trials)))
        rows.append(row)

    tested = [r for r in rows if not r["saturated"]]
    doc = {"name": a.name, "layer": layer, "lambda": a.lam, "seed": a.seed, "rows": rows,
           "claim_under_test": "REFUSING to include something never beats including it; "
                               "headroom was exactly zero (the ratchet lane, 4 keys, one gpt2 "
                               "layer, one lambda, one model)",
           "sizes_that_actually_tested_it": [r["n"] for r in tested],
           "verdict": ("NOT TESTABLE HERE - the joint solve installs every edit at every size "
                       "tried, so headroom is zero by ceiling"
                       if not tested else
                       ("HOLDS on this net: no subset beat the full set at any size where the "
                        "full set left room"
                        if all(r["headroom"] <= 1e-12 for r in tested) else
                        "DOES NOT HOLD on this net: a subset beat the full set"))}
    p = os.path.join(OUT, a.name + ".headroom.json")
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, indent=1)
    print("  VERDICT: " + doc["verdict"])
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

    # 1. the objective must count a REFUSED edit as a miss, or "refuse everything" wins.
    class Stub:
        def __init__(self, hit):
            self.hit = hit

    import types
    cases = [{"prefix": [0], "target": 1} for _ in range(4)]
    # a model that installs nothing scores 0, not 1: checked through the real function with a
    # fake probs, so the arithmetic under test is the shipped one
    saved = R.probs
    try:
        R.probs = lambda m, pre, dev, batch=4096: np.full((len(pre), 10), 0.01)
        o, h = installed(None, cases, "cpu")
        _plant("an edit that installed nothing did not score 0", o == 0.0)
        R.probs = lambda m, pre, dev, batch=4096: np.full((len(pre), 10), 0.9)
        o2, _ = installed(None, cases, "cpu")
        _plant("an edit that installed everything did not score 1", o2 == 1.0)
    finally:
        R.probs = saved

    # 2. key_alignment must span the range it is meant to report.
    same = np.ones((8, 4))
    _plant("identical keys do not give cosine 1", abs(key_alignment(same) - 1.0) < 1e-9)
    opp = np.zeros((8, 2))
    opp[0, 0] = 1.0
    opp[0, 1] = -1.0
    _plant("opposed keys do not give cosine -1", abs(key_alignment(opp) + 1.0) < 1e-9)
    Q = np.linalg.qr(np.random.default_rng(1).standard_normal((9, 9)))[0][:, :4]
    _plant("orthogonal keys do not give cosine 0", abs(key_alignment(Q)) < 1e-9)

    # 3. THE SATURATION TRAP must be detectable: a full objective of 1.0 is reported as "not a
    #    test" and NOT as a confirmation. This is the plant that stops this file agreeing with
    #    the claim for the wrong reason.
    row = {"objective_full_set": 1.0}
    row["saturated"] = bool(row["objective_full_set"] >= 1.0 - 1e-12)
    _plant("a saturated full set was not flagged as untested", row["saturated"])
    row2 = {"objective_full_set": 0.9}
    _plant("an unsaturated full set was wrongly flagged as saturated",
           not bool(row2["objective_full_set"] >= 1.0 - 1e-12))

    # 4. REUSING K and R must give the SAME edit as recomputing them per subset. If it does
    #    not, the thing that made the sweep finishable also changed its answer.
    import torch as _t
    _t.manual_seed(13)
    m0 = N.GPT(10, 10, 32, 2, 2, 0.0).to("cpu").eval()
    cs = R.build_cases(m0, 5, "cpu")
    C0, _, _ = R.covariance(m0, 1, "cpu", n=300, extra=[c["prefix"] for c in cs])
    K0 = R.ffwd_keys(m0, [c["prefix"] for c in cs], 1, "cpu").T
    R0 = R.target_deltas(m0, cs, 1, "cpu", steps=40)
    sub = [0, 2, 4]
    m_reuse = R.clone(m0, "cpu")
    R.memit_edit(m_reuse, [cs[i] for i in sub], 1, "cpu", 1.0, C0,
                 K=K0[:, sub], R=R0[:, sub])
    m_recompute = R.clone(m0, "cpu")
    R.memit_edit(m_recompute, [cs[i] for i in sub], 1, "cpu", 1.0, C0,
                 K=None, R=R0[:, sub])        # K recomputed, R held so the optimiser is not rerun
    w1 = m_reuse.blocks[1].ffwd.net[2].weight.detach().numpy()
    w2 = m_recompute.blocks[1].ffwd.net[2].weight.detach().numpy()
    _plant("reusing the keys changed the edit (max %.3e)" % float(np.abs(w1 - w2).max()),
           float(np.abs(w1 - w2).max()) < 1e-9)
    # and the mismatch guard must fire when the columns do not line up
    try:
        R.memit_edit(R.clone(m0, "cpu"), [cs[i] for i in sub], 1, "cpu", 1.0, C0,
                     K=K0, R=R0[:, sub])
        caught = False
    except ValueError:
        caught = True
    _plant("a K with the wrong number of columns was not refused", caught)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_big")
    ap.add_argument("--sizes", default="8,16,32,64,128")
    ap.add_argument("--lam", type=float, default=1.0)
    ap.add_argument("--random-subsets", dest="random_subsets", type=int, default=12)
    ap.add_argument("--seed", type=int, default=19)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    raise SystemExit(selftest() if a.selftest else run(a))
