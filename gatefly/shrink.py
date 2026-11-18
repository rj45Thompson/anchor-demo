"""Cut neurons by the gate, against a random-cut null (UC-GF-4).

    py -X utf8 -I gatefly/shrink.py --name ttt_big --budgets 192,128,96,64,48,32,16
    py -X utf8 -I gatefly/shrink.py --selftest

THE HONEST FAILURE MODE, named before any cutting (REQ-GF-4a). Tic-tac-toe is easy. A net cut to
a quarter of its neurons may still draw every game because the GAME is forgiving, not because the
cut copied what the gates do. Game outcome therefore cannot settle this, and no claim here rests
on it. Three things can:

  1. THE RANDOM-CUT NULL. At every budget k, cut by a-ordering AND cut at random over many seeds.
     If a-ordering is not better than random at matched k, the ordering bought nothing. This is
     the ratchet lane's budgeted-selection result - "ranking by a picks the best available subset
     at EVERY size" - tested on a different system, which is the whole transfer question.
  2. FUNCTION, NOT OUTCOME. Top-1 agreement and total-variation distance against the PARENT over
     all 4,520 live positions, and separately over the positions where exactly ONE move is
     optimal, which is where an easy game stops hiding a difference.
  3. THE GATE'S OWN PREDICTION. Remove ONE neuron at a time and measure the damage. The gate says
     how much of what you write at a unit arrives; if it describes this net, the damage a single
     removal does should be ORDERED by it. That is a quantitative prediction tic-tac-toe's
     easiness cannot manufacture, and it is the strongest of the three.

ALT-5: if the rank correlation is not significant, the gate did not predict the damage here and
the verdict is DOES NOT TRANSFER, reported with the correlation and n. A null is a result.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys
import time

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import data_ttt as D
import gate_math as GM
import metrics as M
import net as N
import play as P
import ttt

OUT = os.path.join(HERE, "runs")


def live_prefixes():
    out = []
    for s in ttt.decisions():
        pre = M.prefix_of(s)
        if pre is not None:
            out.append((s, pre))
    return out


def dists(model, prefixes, device, batch=4096):
    """The net's full distribution at every position, once."""
    import retrain as R
    return R.probs(model, prefixes, device, batch)


def agreement(parent_P, child_P, one_best_mask):
    """How faithfully the child copies the parent's FUNCTION, not its results."""
    pa, ca = parent_P.argmax(1), child_P.argmax(1)
    top1 = float((pa == ca).mean())
    tv = float(np.abs(parent_P - child_P).sum(1).mean() / 2.0)
    top1_hard = float((pa[one_best_mask] == ca[one_best_mask]).mean())
    tv_hard = float(np.abs(parent_P[one_best_mask] - child_P[one_best_mask]).sum(1).mean() / 2.0)
    return {"top1_agreement": top1, "total_variation": tv,
            "top1_agreement_one_best_only": top1_hard,
            "total_variation_one_best_only": tv_hard}


def site_of(model, layer):
    return model.blocks[layer].ffwd


def unit_gates(model, layer):
    """a, c, gate for the ffwd neurons of one block: the lane's own site, C = I, lambda the
    median squared column norm. The same call the flythrough's file is built from."""
    W = model.blocks[layer].ffwd.net[2].weight.detach().double().cpu().numpy()
    lam = GM.ridge_scale(W)
    a, c, g = GM.acg(W, None, lam)
    return a, c, g, lam


def cut_to(model, layer, keep_idx, device):
    """A child with only `keep_idx` of the block's ffwd neurons."""
    m = N.GPT(**model.hyper).to(device)
    m.load_state_dict(copy.deepcopy(model.state_dict()))
    blk = m.blocks[layer]
    idx = torch.tensor(sorted(keep_idx), device=device)
    W0, b0, W2 = blk.ffwd.net[0].weight.data, blk.ffwd.net[0].bias.data, blk.ffwd.net[2].weight.data
    blk.ffwd.net[0].weight = torch.nn.Parameter(W0[idx].clone())
    blk.ffwd.net[0].bias = torch.nn.Parameter(b0[idx].clone())
    blk.ffwd.net[2].weight = torch.nn.Parameter(W2[:, idx].clone())
    return m.eval()


def one_at_a_time(model, layer, prefixes, parent_P, device, limit=None, seed=3):
    """UC-GF-4 step 5. Remove ONE neuron, measure the damage, and correlate with its gate."""
    a, c, g, lam = unit_gates(model, layer)
    H = len(g)
    idx = list(range(H))
    if limit and limit < H:
        idx = list(np.random.default_rng(seed).permutation(H)[:limit])
    rows = []
    for j in idx:
        keep = [i for i in range(H) if i != j]
        child = cut_to(model, layer, keep, device)
        cp = dists(child, prefixes, device)
        dmg = float(np.abs(parent_P - cp).sum(1).mean() / 2.0)
        rows.append({"unit": int(j), "gate": float(g[j]), "a": float(a[j]), "c": float(c[j]),
                     "damage_tv": dmg})
    return rows


def spearman(x, y):
    """Rank correlation and a two-sided p-value from the t approximation. Written out rather
    than imported so the figure does not depend on scipy being installed, and checked against a
    known case in the selftest."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    n = x.size
    if n < 3:
        return float("nan"), float("nan"), n

    def rank(v):
        o = np.argsort(v, kind="mergesort")
        r = np.empty(n, dtype=np.float64)
        r[o] = np.arange(1, n + 1, dtype=np.float64)
        # average ties
        s = np.sort(v)
        i = 0
        while i < n:
            j = i
            while j + 1 < n and s[j + 1] == s[i]:
                j += 1
            if j > i:
                r[o[i:j + 1]] = (i + j + 2) / 2.0
            i = j + 1
        return r

    rx, ry = rank(x), rank(y)
    rx -= rx.mean()
    ry -= ry.mean()
    den = np.sqrt((rx * rx).sum() * (ry * ry).sum())
    if den == 0:
        return float("nan"), float("nan"), n
    rho = float((rx * ry).sum() / den)
    if abs(rho) >= 1.0:
        return rho, 0.0, n
    t = rho * np.sqrt((n - 2) / (1 - rho * rho))
    # two-sided p from the t distribution, by its incomplete-beta form
    import math
    df = n - 2
    xb = df / (df + t * t)

    def betainc(aa, bb, xx):
        # Regularised incomplete beta by the Lentz continued fraction. The SYMMETRY SWAP is not
        # optional: the fraction converges poorly for x above (a+1)/(a+b+2), and without it this
        # drifted from scipy by 1.5e-3 on random pairs - small enough to look fine and large
        # enough to move a p-value across 0.05. The plant below holds it to 1e-6 against scipy.
        if xx <= 0:
            return 0.0
        if xx >= 1:
            return 1.0
        if xx > (aa + 1.0) / (aa + bb + 2.0):
            return 1.0 - betainc(bb, aa, 1.0 - xx)
        lbeta = math.lgamma(aa) + math.lgamma(bb) - math.lgamma(aa + bb)
        front = math.exp(math.log(xx) * aa + math.log(1 - xx) * bb - lbeta) / aa
        f, cc, dd = 1.0, 1.0, 0.0
        for i in range(0, 300):
            m2 = i // 2
            if i == 0:
                num = 1.0
            elif i % 2 == 0:
                num = (m2 * (bb - m2) * xx) / ((aa + 2 * m2 - 1) * (aa + 2 * m2))
            else:
                num = -((aa + m2) * (aa + bb + m2) * xx) / ((aa + 2 * m2) * (aa + 2 * m2 + 1))
            dd = 1.0 + num * dd
            dd = 1e-30 if abs(dd) < 1e-30 else dd
            dd = 1.0 / dd
            cc = 1.0 + num / cc
            cc = 1e-30 if abs(cc) < 1e-30 else cc
            f *= cc * dd
            if abs(1.0 - cc * dd) < 1e-12:
                break
        return front * (f - 1.0)

    p = betainc(df / 2.0, 0.5, xb)
    return rho, float(min(1.0, max(0.0, p))), n


def main(a):
    dev = "cuda" if torch.cuda.is_available() and not a.cpu else "cpu"
    stem = os.path.join(OUT, a.name)
    parent, meta = N.load(stem, dev)
    layer = a.layer if a.layer >= 0 else meta["hyper"]["n_layers"] - 1
    lp = live_prefixes()
    prefixes = [p for _, p in lp]
    one_best = np.array([len(ttt.optimal_moves(s)) == 1 for s, _ in lp])
    parent_P = dists(parent, prefixes, dev)
    a_, c_, g_, lam = unit_gates(parent, layer)
    H = len(g_)
    print("%s: %d params. Cutting blocks.%d.ffwd from %d neurons."
          % (a.name, meta["parameters"], layer, H))
    print("  %d live positions, %d of them with exactly one optimal move"
          % (len(prefixes), int(one_best.sum())))
    print("  site lambda %.6f, median gate %.4f, median c/a %.4f"
          % (lam, float(np.median(g_)), float(np.median(c_ / a_))))

    pm = P.measure(parent, dev, a.games)
    order_a = list(np.argsort(-a_))
    order_gate = list(np.argsort(-g_))
    rng = np.random.default_rng(a.seed)
    rows = []
    for k in [int(x) for x in a.budgets.split(",")]:
        if k > H:
            continue
        for rule in ("a_order", "gate_order", "random"):
            seeds = range(a.random_seeds) if rule == "random" else [0]
            for si in seeds:
                keep = (order_a[:k] if rule == "a_order" else order_gate[:k] if rule == "gate_order"
                        else list(rng.permutation(H)[:k]))
                child = cut_to(parent, layer, keep, dev)
                cp = dists(child, prefixes, dev)
                ag = agreement(parent_P, cp, one_best)
                # The optimal rate is read off the distributions already computed, over the
                # 4,520 DISTINCT live boards - one observation per position, not per transcript
                # (REQ-GF-3b). The training figure quoted elsewhere is over the 294,778
                # transcript prefixes; both are stated, neither is swapped for the other.
                pick = cp.argmax(1)
                rate = float(np.mean([1.0 if (p < 9 and p in ttt.optimal_moves(s)) else 0.0
                                      for p, (s, _) in zip(pick, lp)]))
                ill = int(sum(1 for p, (s, _) in zip(pick, lp) if p >= 9 or s[p] != 0))
                row = {"budget": k, "rule": rule, "seed": si,
                       "optimal_rate_4520_boards": rate, "illegal_argmax": ill,
                       "params": sum(p.numel() for p in child.parameters()), **ag}
                # the game itself, for the orderings and one random seed: a full play
                # measurement for every random seed costs more than it tells
                if rule != "random" or si == 0:
                    res = P.measure(child, dev, a.games)
                    row["losses_over_all_arms"] = sum(r["loss"] for arm in res.values()
                                                      for r in arm.values())
                    row["play"] = res
                rows.append(row)
        sel = [r for r in rows if r["budget"] == k]
        ao = [r for r in sel if r["rule"] == "a_order"][0]
        go = [r for r in sel if r["rule"] == "gate_order"][0]
        rd = [r for r in sel if r["rule"] == "random"]
        print("  k=%-4d a-order opt %.4f tv %.4f top1 %.4f | gate-order opt %.4f | "
              "random opt %.4f +- %.4f over %d seeds (best %.4f)"
              % (k, ao["optimal_rate_4520_boards"], ao["total_variation"],
                 ao["top1_agreement"], go["optimal_rate_4520_boards"],
                 float(np.mean([r["optimal_rate_4520_boards"] for r in rd])),
                 float(np.std([r["optimal_rate_4520_boards"] for r in rd])), len(rd),
                 float(np.max([r["optimal_rate_4520_boards"] for r in rd]))))

    print("  one-at-a-time removals (UC-GF-4 step 5)...")
    oaat = one_at_a_time(parent, layer, prefixes, parent_P, dev, a.one_limit)
    rho, pval, n = spearman([r["gate"] for r in oaat], [r["damage_tv"] for r in oaat])
    rho_a, p_a, _ = spearman([r["a"] for r in oaat], [r["damage_tv"] for r in oaat])
    rho_c, p_c, _ = spearman([r["c"] for r in oaat], [r["damage_tv"] for r in oaat])
    verdict = ("TRANSFERS" if (np.isfinite(rho) and rho > 0 and pval < 0.05)
               else "DOES NOT TRANSFER")
    print("  gate vs damage: rho %.4f  p %.3g  n %d   -> %s" % (rho, pval, n, verdict))
    print("  a    vs damage: rho %.4f  p %.3g" % (rho_a, p_a))
    print("  c    vs damage: rho %.4f  p %.3g" % (rho_c, p_c))

    doc = {"name": a.name, "layer": layer, "hidden": H, "parent_params": meta["parameters"],
           "parent_play": pm, "positions": len(prefixes),
           "one_best_positions": int(one_best.sum()),
           "site_lambda": lam, "budgets": rows, "one_at_a_time": oaat,
           "gate_vs_damage": {"spearman_rho": rho, "p_value": pval, "n": n, "verdict": verdict},
           "a_vs_damage": {"spearman_rho": rho_a, "p_value": p_a},
           "c_vs_damage": {"spearman_rho": rho_c, "p_value": p_c},
           "why_game_outcome_is_not_the_test":
               "Tic-tac-toe is easy; a cut net can still draw every game without copying the "
               "gates. The random-cut null, the function agreement on one-best positions, and "
               "the gate-versus-damage correlation are what can tell those apart."}
    p = os.path.join(OUT, a.name + ".shrink.json")
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

    # 1. spearman against a case with a known answer: a perfect monotone pair is rho 1.
    rng0 = np.random.default_rng(77)
    r1, p1, _ = spearman([1, 2, 3, 4, 5, 6, 7, 8], [2, 4, 6, 8, 10, 12, 14, 16])
    _plant("spearman is not 1 on a perfectly monotone pair (%.6f)" % r1, abs(r1 - 1) < 1e-12)
    r2, p2, _ = spearman([1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1])
    _plant("spearman is not -1 on a reversed pair (%.6f)" % r2, abs(r2 + 1) < 1e-12)
    # A middling case, checked against the CLOSED FORM rho = 1 - 6*sum(d^2)/(n(n^2-1)) computed
    # here, and against scipy when it is installed. The first version of this plant compared
    # against two constants written from memory - 0.7714 and 0.072 - and BOTH were wrong while
    # the implementation was right. Remembered numbers are exactly what this repo forbids, so
    # they are gone: every figure this plant uses is computed in front of it.
    xa = [1, 2, 3, 4, 5, 6]
    ya = [2, 1, 4, 3, 6, 5]
    r3, p3, _ = spearman(xa, ya)
    nn = len(xa)
    d2 = sum((i - j) ** 2 for i, j in zip(xa, ya))      # both are already their own ranks
    closed = 1 - 6.0 * d2 / (nn * (nn * nn - 1))
    _plant("spearman disagrees with the closed form 1-6*sum(d^2)/(n(n^2-1)): %.10f vs %.10f"
           % (r3, closed), abs(r3 - closed) < 1e-12)
    try:
        from scipy import stats as _st
        sr = _st.spearmanr(xa, ya)
        _plant("spearman disagrees with scipy: rho %.10f vs %.10f" % (r3, float(sr.statistic)),
               abs(r3 - float(sr.statistic)) < 1e-9)
        _plant("the p-value disagrees with scipy: %.10f vs %.10f" % (p3, float(sr.pvalue)),
               abs(p3 - float(sr.pvalue)) < 1e-6)
        # and over many random pairs, not just one, so the agreement is not a coincidence
        worst = 0.0
        for _ in range(30):
            u, v = rng0.standard_normal(25), rng0.standard_normal(25)
            rr, pp, _ = spearman(u, v)
            s2 = _st.spearmanr(u, v)
            worst = max(worst, abs(pp - float(s2.pvalue)))
        _plant("the p-value drifts from scipy over random pairs (worst %.3e)" % worst,
               worst < 1e-6)
    except ImportError:
        print("  ABSENT  scipy is not installed, so the cross-check did not run")
    # noise must NOT be significant: the test has to be able to say no.
    rng = np.random.default_rng(2)
    sig = 0
    for _ in range(40):
        _, pn, _ = spearman(rng.standard_normal(30), rng.standard_normal(30))
        sig += pn < 0.05
    _plant("unrelated noise was significant %d times in 40 - the test cannot say no" % sig,
           sig <= 6)

    # 2. cut_to really removes neurons and keeps the rest intact.
    dev = "cpu"
    torch.manual_seed(9)
    m = N.GPT(D.VOCAB, D.BLOCK, 32, 2, 2, 0.0).to(dev).eval()
    keep = list(range(0, 128, 2))
    ch = cut_to(m, 1, keep, dev)
    _plant("cut_to kept the wrong number of neurons",
           ch.blocks[1].ffwd.net[0].weight.shape[0] == 64)
    _plant("cut_to changed a neuron it kept",
           torch.allclose(ch.blocks[1].ffwd.net[0].weight[0],
                          m.blocks[1].ffwd.net[0].weight[0]))
    _plant("cut_to changed the OTHER block", torch.allclose(
        ch.blocks[0].ffwd.net[2].weight, m.blocks[0].ffwd.net[2].weight))

    # 3. cutting EVERYTHING but one must damage the function, and cutting NOTHING must not.
    import retrain as R
    lp = live_prefixes()[:600]
    pres = [p for _, p in lp]
    pP = R.probs(m, pres, dev)
    same = cut_to(m, 1, list(range(128)), dev)
    _plant("cutting nothing changed the function",
           float(np.abs(pP - R.probs(same, pres, dev)).max()) < 1e-6)
    tiny = cut_to(m, 1, [0], dev)
    _plant("cutting 127 of 128 neurons changed nothing - the site does not matter at all",
           float(np.abs(pP - R.probs(tiny, pres, dev)).max()) > 1e-3)

    # 4. agreement is 1.0 / 0.0 against itself, which is the measurement's null case.
    mask = np.array([len(ttt.optimal_moves(s)) == 1 for s, _ in lp])
    ag = agreement(pP, pP, mask)
    _plant("agreement against itself is not perfect",
           ag["top1_agreement"] == 1.0 and ag["total_variation"] < 1e-12)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_big")
    ap.add_argument("--layer", type=int, default=-1)
    ap.add_argument("--budgets", default="192,128,96,64,48,32,16,8")
    ap.add_argument("--random-seeds", dest="random_seeds", type=int, default=8)
    ap.add_argument("--one-limit", dest="one_limit", type=int, default=0)
    ap.add_argument("--games", type=int, default=200)
    ap.add_argument("--seed", type=int, default=41)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    raise SystemExit(selftest() if a.selftest else main(a))
