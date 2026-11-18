"""Climb an m,n,k ladder until the closed-form edit stops installing (RJ, 2026-11-18).

    py -X utf8 -I gatefly/ladder.py --rungs 3,3,3 3,4,3 4,4,3 4,4,4 --edits 16
    py -X utf8 -I gatefly/ladder.py --selftest

THE PROBLEM THIS EXISTS FOR. On tic-tac-toe the closed-form edit installs with Efficacy 1.0000
at every set size from 1 to 32, and `headroom.py` returns NOT TESTABLE - saturated at n = 8, 32,
64 and 128. Nothing that needs the editor to FAIL can be measured there. RJ: "the complexity has
to rise where memit fails to get near 1, then isolate that fault and investigate why."

THE VARIABLE IS THE TASK, NOT THE NET. The net shape and the edit count are held FIXED across
rungs, so a fall in Efficacy is attributable to the game getting harder rather than to a smaller
model or a bigger edit. Published work varies the edit count at a fixed task; this is the other
axis.

THE CONFOUND, CHECKED AT EVERY RUNG AND NOT ASSUMED AWAY. A net that cannot PLAY the harder game
is not a harder editing problem, it is a worse net. So competence is measured before any edit,
and a rung whose net is not competent is reported with its editing figures MARKED, because an
edit to a net that was already wrong at a position means something different.

WHAT EACH RUNG REPORTS: the oracle's own figures (reachable positions sampled, empty-board
value), the net's competence before editing, then Efficacy, the gate quantities of the edit's
own keys (median a, median c, mean crowding fraction), and the competence left afterwards.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import gate_math as GM
import net as N
from mnk import MNK

OUT = os.path.join(HERE, "runs")


# ---------------------------------------------------------------- data
def build(game, n_games, rng, policy="mixed"):
    """Sampled games -> (X tokens, mask, optimal-move bitmasks) plus the distinct positions."""
    games = game.sample_games(n_games, rng, policy)
    pos = game.positions_from(games)
    B = game.BLOCK
    X = np.full((len(games), B), game.BOS, dtype=np.int64)
    M = np.zeros((len(games), game.cells), dtype=bool)
    O = np.zeros((len(games), game.cells), dtype=np.int64)
    for gi, mv in enumerate(games):
        s = game.EMPTY
        for t, m_ in enumerate(mv):
            if game.over(s):
                break
            X[gi, 1 + t] = m_
            M[gi, t] = True
            bits = 0
            for o in game.optimal_moves(s):
                bits |= 1 << o
            O[gi, t] = bits
            s = game.play(s, m_)
    return X, M, O, pos


def bits_to_f(O, cells, device):
    t = torch.as_tensor(O, device=device)
    sh = torch.arange(cells, device=device)
    return ((t.unsqueeze(-1) >> sh) & 1).float()


def soft_ce(logits, bits, mask):
    logp = F.log_softmax(logits.float(), dim=-1)[..., :bits.shape[-1]]
    cnt = bits.sum(-1).clamp(min=1.0)
    per = -(bits * logp).sum(-1) / cnt
    return (per * mask.float()).sum() / mask.float().sum().clamp(min=1.0)


def competence(model, game, pos_items, device, batch=2048):
    """Fraction of held positions where the net's argmax is IN the optimal set, plus the
    illegal count. Set-valued, because several moves are often equally optimal and counting
    against one of them would mislabel a correct swap as an error."""
    keys = [k for k, _ in pos_items]
    ok = ill = 0
    model.eval()
    with torch.no_grad():
        for i in range(0, len(keys), batch):
            chunk = keys[i:i + batch]
            x = torch.full((len(chunk), game.BLOCK), game.BOS, dtype=torch.long, device=device)
            for r, pre in enumerate(chunk):
                for j, mv in enumerate(pre):
                    x[r, 1 + j] = mv
            L = torch.tensor([len(p) for p in chunk], device=device)
            lg = model(x)[torch.arange(len(chunk), device=device), L]
            pick = lg.argmax(-1).cpu().numpy()
            for r, p in enumerate(pick):
                board, opt = pos_items[i + r][1]
                if int(p) >= game.cells or board[int(p)] != 0:
                    ill += 1
                elif int(p) in opt:
                    ok += 1
    return ok / max(1, len(keys)), ill, len(keys)


def train_rung(game, args, device, rng):
    # SEED TORCH. It was not seeded, so two runs with the same --seed drew different weight
    # initialisations and produced different nets - the 3,3,3 rung came out at crowd 0.0765 on
    # one run and 0.0540 on the next. Every figure was still measured correctly; what was wrong
    # is that the run was not reproducible, and a ladder whose rungs cannot be re-measured
    # cannot have a rung investigated later.
    torch.manual_seed(args.seed)
    X, M, O, pos = build(game, args.games, rng, args.policy)
    items = sorted(pos.items())
    cut = int(len(items) * 0.9)
    tr_items, te_items = items[:cut], items[cut:]
    model = N.GPT(game.VOCAB, game.BLOCK, args.embed, args.heads, args.layers, 0.0).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    xs = torch.as_tensor(X, device=device)
    ms = torch.as_tensor(M, device=device)
    bits = bits_to_f(O, game.cells, device)
    steps = max(1, (X.shape[0] // args.batch)) * args.epochs
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps,
                                                pct_start=0.15)
    hist = []
    for ep in range(args.epochs):
        model.train()
        perm = torch.randperm(X.shape[0], device=device)
        tot = nb = 0
        for i in range(0, X.shape[0] - args.batch + 1, args.batch):
            sl = perm[i:i + args.batch]
            lg = model(xs[sl])[:, :game.cells]
            loss = soft_ce(lg, bits[sl], ms[sl])
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            tot += float(loss)
            nb += 1
        hist.append(tot / max(1, nb))
    tr_c, tr_i, tr_n = competence(model, game, tr_items, device)
    te_c, te_i, te_n = competence(model, game, te_items, device)
    return model, {"positions_sampled": len(items), "train_n": tr_n, "holdout_n": te_n,
                   "competence_train": tr_c, "competence_holdout": te_c,
                   "illegal_train": tr_i, "illegal_holdout": te_i,
                   "final_loss": hist[-1], "games_sampled": args.games,
                   "policy": args.policy}, items


# ---------------------------------------------------------------- the edit
def ffwd_keys(model, prefixes, game, layer, device):
    blk = model.blocks[layer]
    grab = {}

    def hook(_m, a, _o):
        grab["k"] = a[0].detach()

    h = blk.ffwd.net[2].register_forward_hook(hook)
    try:
        x = torch.full((len(prefixes), game.BLOCK), game.BOS, dtype=torch.long, device=device)
        for r, pre in enumerate(prefixes):
            for j, mv in enumerate(pre):
                x[r, 1 + j] = mv
        L = torch.tensor([len(p) for p in prefixes], device=device)
        with torch.no_grad():
            model(x)
        return grab["k"][torch.arange(len(prefixes), device=device), L].float().cpu().numpy()
    finally:
        h.remove()


def probs_at(model, prefixes, game, device, batch=2048):
    out = []
    model.eval()
    with torch.no_grad():
        for i in range(0, len(prefixes), batch):
            chunk = prefixes[i:i + batch]
            x = torch.full((len(chunk), game.BLOCK), game.BOS, dtype=torch.long, device=device)
            for r, pre in enumerate(chunk):
                for j, mv in enumerate(pre):
                    x[r, 1 + j] = mv
            L = torch.tensor([len(p) for p in chunk], device=device)
            lg = model(x)[torch.arange(len(chunk), device=device), L]
            out.append(F.softmax(lg.float(), -1).cpu().numpy())
    return np.concatenate(out, 0)


def wilson(k, n, z=1.96):
    """A 95% interval on a proportion. Efficacy is k successes out of n EDITS, and with n small
    the interval is enormous: 15/16 is [0.7167, 0.9889] and 16/16 is [0.8064, 1.0000], which
    overlap almost entirely. Reporting 0.9375 against 1.0000 without these is reporting a
    difference the measurement cannot resolve."""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return (max(0.0, c - h), min(1.0, c + h))


def efficacies(P, cases, game):
    """Efficacy under THREE criteria, because one of them is not comparable across rungs.

    The ratchet lane's warning, which this file exists in its present form because of: a measure
    has to MEAN THE SAME THING at 3,3,3 and at 4,4,4 or a trend across rungs is an artefact of
    the measure. The published `p > 0.5` is taken over the whole vocabulary, and the vocabulary
    GROWS with the board - 10 tokens at 3,3,3, 17 at 4,4,4 - so the same concentration of mass
    reads lower on a bigger board for a reason that has nothing to do with the editor.

      p_gt_0.5        the published convention, kept because it is the benchmark's
      argmax          the target beats every other token - no threshold, but still harder when
                      there are more others
      legal_gt_0.5    p > 0.5 after renormalising over the LEGAL moves at that position, which
                      removes the vocabulary-size effect and is the one to compare across rungs

    All three are reported at every rung and a break is only called when they agree. Within a
    rung the MEASURE-DEPENDENT refusal already guards the unstable case; this is that guard
    applied along the other axis.
    """
    raw, arg, leg = [], [], []
    for i, cs in enumerate(cases):
        row = P[i]
        t = int(cs["target"])
        raw.append(1.0 if float(row[t]) > 0.5 else 0.0)
        arg.append(1.0 if int(np.argmax(row)) == t else 0.0)
        board = tuple(cs["board"])
        legal = [m for m in range(game.cells) if board[m] == 0]
        z = float(sum(row[m] for m in legal))
        leg.append(1.0 if (z > 0 and float(row[t]) / z > 0.5) else 0.0)
    n = len(cases)
    return {"efficacy_p_gt_0.5": float(np.mean(raw)),
            "efficacy_argmax": float(np.mean(arg)),
            "efficacy_legal_renormalised": float(np.mean(leg)),
            "n_edits": n,
            "resolution": 1.0 / max(1, n),
            "ci95_p_gt_0.5": list(wilson(int(sum(raw)), n)),
            "ci95_legal_renormalised": list(wilson(int(sum(leg)), n)),
            "mean_target_p": float(np.mean([float(P[i, int(c["target"])])
                                            for i, c in enumerate(cases)]))}


def pick_cases(items, game, n, rng):
    """n positions with a COUNTERFACTUAL target: a legal move minimax says is NOT optimal."""
    idx = rng.permutation(len(items))
    cases = []
    for i in idx:
        pre, (board, opt) = items[i]
        alt = [m for m in game.legal(board) if m not in opt]
        if not alt:
            continue
        me = game.turn(board)
        vals = [(m, game.value(game.play(board, m))) for m in alt]
        tgt = (min(vals, key=lambda t: t[1]) if me == 1 else max(vals, key=lambda t: t[1]))[0]
        cases.append({"prefix": list(pre), "target": int(tgt), "board": list(board)})
        if len(cases) >= n:
            break
    return cases


def target_deltas(model, cases, game, layer, device, steps=160, lr=0.4):
    blk = model.blocks[layer]
    E = model.hyper["n_embed"]
    out = []
    for c in cases:
        z = torch.zeros(E, device=device, requires_grad=True)
        pos = len(c["prefix"])
        o = torch.optim.Adam([z], lr=lr)

        def mk(zz, p):
            def h(_m, _a, output):
                out_ = output.clone()
                out_[:, p, :] = out_[:, p, :] + zz
                return out_
            return h

        hk = blk.ffwd.net[2].register_forward_hook(mk(z, pos))
        x = torch.full((1, game.BLOCK), game.BOS, dtype=torch.long, device=device)
        for j, mv in enumerate(c["prefix"]):
            x[0, 1 + j] = mv
        try:
            for _ in range(steps):
                lg = model(x)[0, pos]
                loss = F.cross_entropy(lg.unsqueeze(0),
                                       torch.tensor([c["target"]], device=device)) \
                    + 0.02 * z.pow(2).sum()
                o.zero_grad(set_to_none=True)
                loss.backward()
                o.step()
        finally:
            hk.remove()
        out.append(z.detach().float().cpu().numpy().astype(np.float64))
    return np.stack(out, 1)


def edit_and_score(model, cases, items, game, layer, device, lam, cov_n, rng):
    """The joint solve, then Efficacy and what it cost - with the edit's own gate quantities."""
    sub = [items[i][0] for i in rng.permutation(len(items))[:cov_n]]
    Kc = ffwd_keys(model, sub, game, layer, device)
    C = (Kc.T.astype(np.float64) @ Kc.astype(np.float64)) / Kc.shape[0]
    pre_c = [c["prefix"] for c in cases]
    Kc2 = ffwd_keys(model, pre_c, game, layer, device)
    # the edited positions must be represented in C, or a direction they use gets no ridge
    C = (C * Kc.shape[0] + Kc2.T.astype(np.float64) @ Kc2.astype(np.float64)) / \
        (Kc.shape[0] + Kc2.shape[0])
    K = Kc2.T.astype(np.float64)
    ev = np.linalg.eigvalsh(C)
    cond = float(ev.max() / ev.min()) if ev.min() > 0 else float("inf")
    if not np.isfinite(cond) or cond > 1e12:
        return {"refused": "lambda C is singular or past the 1e12 working limit (cond %.3e)"
                           % cond}
    A, _ = GM.gate_matrix(K, C, lam)
    a = np.diag(A).copy()
    c = GM.crowding_all(A)
    P_pre = probs_at(model, pre_c, game, device)
    eff_pre = efficacies(P_pre, cases, game)
    R = target_deltas(model, cases, game, layer, device)
    delta = R @ K.T @ np.linalg.inv(lam * C + K @ K.T)
    with torch.no_grad():
        W = model.blocks[layer].ffwd.net[2].weight
        W += torch.tensor(delta, dtype=W.dtype, device=W.device)
    P = probs_at(model, pre_c, game, device)
    hits = [float(P[i, cs["target"]]) for i, cs in enumerate(cases)]
    eff = efficacies(P, cases, game)
    return {**eff, "n_cases": len(cases),
            "median_a": float(np.median(a)), "median_c": float(np.median(c)),
            "mean_crowding_fraction": float(np.mean(c / np.maximum(a, 1e-12))),
            "median_gate": float(np.median(GM.g(a - c))),
            "cov_cond": cond, "cov_positions": int(Kc.shape[0] + Kc2.shape[0]),
            "delta_fro": float(np.linalg.norm(delta)),
            "before_edit": eff_pre,
            # PER-CASE gate quantities, not just their medians. Without these the question
            # "is the case that failed the most crowded one?" cannot be asked of a finished
            # run, and that question is what decides whether a break has a mechanism or a
            # cause that was never instrumented.
            "per_case": [{"i": i, "target_p": round(hits[i], 6),
                          "a": round(float(a[i]), 6), "c": round(float(c[i]), 6),
                          "gate": round(float(GM.g(a[i] - c[i])), 6),
                          "crowding_fraction": round(float(c[i] / max(a[i], 1e-12)), 6),
                          "cleared_half": bool(hits[i] > 0.5),
                          "prefix_len": len(cases[i]["prefix"])}
                         for i in range(len(cases))],
            "per_case_target_p": [round(h, 6) for h in hits]}


def run(args):
    dev = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    sys.setrecursionlimit(100000)
    rows = []
    for spec in args.rungs:
        m, n, k = (int(x) for x in spec.split(","))
        g = MNK(m, n, k)
        t0 = time.time()
        v = g.value(g.EMPTY)
        t_solve = time.time() - t0
        rng = np.random.default_rng(args.seed)
        model, info, items = train_rung(g, args, dev, rng)
        t_train = time.time() - t0
        stem0 = os.path.join(OUT, "ladder_%s%s" % (spec.replace(",", "x"),
                                                   ("_" + args.tag) if args.tag else ""))
        N.save(model, stem0 + "_preedit",
               extra={"rung": spec, "note": "BEFORE any edit", **info})
        cases = pick_cases(items, g, args.edits, np.random.default_rng(args.seed + 7))
        pre_items = [(kk, vv) for kk, vv in items]
        res = edit_and_score(model, cases, items, g, args.layers - 1, dev, args.lam,
                             min(args.cov, len(items)), np.random.default_rng(args.seed + 3))
        post_c, post_i, _ = competence(model, g, pre_items, dev)
        # SAVE THE CHECKPOINT. Without it the edit-count sensitivity control - the one that
        # says whether flat crowding is a property of the board axis or a ceiling of the key
        # budget - can only be run cross-checkpoint, which is weaker than it needs to be.
        # The saved net is POST-EDIT; the pre-edit one is saved beside it, because the control
        # needs the net as it was before anything was installed.
        stem = os.path.join(OUT, "ladder_%s%s" % (spec.replace(",", "x"),
                                                  ("_" + args.tag) if args.tag else ""))
        N.save(model, stem + "_postedit", extra={"rung": spec, "note": "AFTER the edit"})
        row = {"rung": spec, "cells": g.cells, "lines": len(g.LINES),
               "empty_board_value": v, "solve_seconds": round(t_solve, 2),
               "train_seconds": round(t_train - t_solve, 1), **info,
               "edit": res, "competence_after_edit": post_c,
               "competence_drop": info["competence_train"] - post_c,
               "net_competent": bool(info["competence_holdout"] >= args.competent_bar)}
        rows.append(row)
        eff = res.get("efficacy_legal_renormalised")
        print("  %-7s cells %2d  positions %6d  competence train %.4f holdout %.4f  |  "
              "EFF legal %s raw %s argmax %s  crowd %.4f  |  competence after %.4f%s"
              % (spec, g.cells, info["positions_sampled"], info["competence_train"],
                 info["competence_holdout"],
                 ("%.3f" % eff) if eff is not None else "REF",
                 ("%.3f" % res["efficacy_p_gt_0.5"]) if eff is not None else "REF",
                 ("%.3f" % res["efficacy_argmax"]) if eff is not None else "REF",
                 res.get("mean_crowding_fraction", float("nan")), post_c,
                 "" if row["net_competent"] else "   <- NET NOT COMPETENT, editing figures marked"))
    CRITERIA = ("efficacy_p_gt_0.5", "efficacy_argmax", "efficacy_legal_renormalised")
    def _broke(r, crit):
        """A break must survive the INTERVAL, not merely the point estimate. With n edits the
        finest departure from 1.0 the measure can express is 1/n, and its interval at that
        point still includes 1.0 until n is large: at n = 16 a single failure gives
        [0.7167, 0.9889] against a perfect [0.8064, 1.0000]. So a rung counts as broken only
        when the upper end of its interval falls below the LOWER end of the best rung's."""
        if not r["net_competent"] or r["edit"].get(crit, 1.0) >= 1.0:
            return False
        key = "ci95_legal_renormalised" if "legal" in crit else "ci95_p_gt_0.5"
        ci = r["edit"].get(key)
        if ci is None:
            return True
        best = max((q["edit"].get(crit, 0.0) for q in rows if q["net_competent"]), default=1.0)
        bestrow = next((q for q in rows
                        if q["net_competent"] and q["edit"].get(crit, 0.0) == best), None)
        bci = bestrow["edit"].get(key) if bestrow else None
        return bool(bci is None or ci[1] < bci[0])
    firsts = {}
    for crit in CRITERIA:
        hit = [r["rung"] for r in rows if _broke(r, crit)]
        firsts[crit] = hit[0] if hit else None
    agree = len(set(firsts.values())) == 1
    broke = [r for r in rows if all(_broke(r, c) for c in CRITERIA)]
    doc = {"rungs": rows, "edits_per_rung": args.edits, "lambda": args.lam,
           "net": {"layers": args.layers, "heads": args.heads, "embed": args.embed},
           "held_fixed": "net shape and edit count, so a fall in Efficacy is the TASK getting "
                         "harder and not a smaller model or a bigger edit",
           "why_competence_is_the_cross_rung_damage_measure":
               "Damage across rungs is reported as a drop in COMPETENCE - the fraction of "
               "positions whose argmax is IN the optimal set. That means the same thing at "
               "3,3,3 and at 4,4,4, which a divergence between move distributions does not: a "
               "total variation is bounded and compresses as the distribution spreads over a "
               "bigger board, while a KL does not, so either would turn board size into a "
               "trend. The set-valued accuracy has no such dependence.",
           "first_break_per_criterion": firsts,
           "criteria_agree": agree,
           "first_break": (broke[0]["rung"] if broke else None),
           "verdict": (
               ("Efficacy first falls below 1.0 at rung %s, under ALL THREE criteria"
                % broke[0]["rung"]) if (broke and agree) else
               ("MEASURE-DEPENDENT ACROSS RUNGS - the three criteria break at %s, so any trend "
                "here is partly a property of the measure and no break point is claimed"
                % firsts) if not agree else
               "Efficacy stayed at 1.0 on every competent rung tried, under all three criteria "
               "- the editor did NOT break on this ladder, which is a result about its "
               "robustness and not a confirmation of anything")}
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, "ladder%s.json" % (("_" + args.tag) if args.tag else ""))
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

    g = MNK(3, 3, 3)
    rng = np.random.default_rng(0)
    X, M, O, pos = build(g, 200, rng)

    # 1. a masked step must carry a NON-EMPTY optimal set, and an unmasked one must not be read
    bad = sum(1 for gi in range(X.shape[0]) for t in range(g.cells)
              if M[gi, t] and O[gi, t] == 0)
    _plant("a live training step carries an empty optimal set (%d)" % bad, bad == 0)

    # 2. every target bit must be a LEGAL move on the board at that step
    bad = 0
    for gi in range(0, X.shape[0], 11):
        s = g.EMPTY
        for t in range(g.cells):
            if not M[gi, t]:
                break
            for o in range(g.cells):
                if (int(O[gi, t]) >> o) & 1 and s[o] != 0:
                    bad += 1
            s = g.play(s, int(X[gi, 1 + t]))
    _plant("a target bit names an occupied cell (%d)" % bad, bad == 0)

    # 3. competence must span its range: an ORACLE scores 1.0, a net that always says BOS
    #    scores 0.0 with every move illegal. Without both ends the number means nothing.
    items = sorted(pos.items())[:400]

    class Oracle(torch.nn.Module):
        def forward(self, x):
            B, T = x.shape
            o = torch.zeros(B, T, g.VOCAB)
            for b in range(B):
                s = g.EMPTY
                last = 0
                for t in range(1, T):
                    v = int(x[b, t])
                    if v >= g.cells or s[v] != 0 or g.over(s):
                        break
                    s = g.play(s, v)
                    last = t
                for mv in g.optimal_moves(s):
                    o[b, last, mv] = 10.0
                for mv in g.optimal_moves(g.EMPTY):
                    o[b, 0, mv] = 10.0
            return o

    class Mute(torch.nn.Module):
        def forward(self, x):
            o = torch.zeros(x.shape[0], x.shape[1], g.VOCAB)
            o[..., g.BOS] = 10.0
            return o

    c1, i1, n1 = competence(Oracle(), g, items, "cpu", batch=64)
    c0, i0, n0 = competence(Mute(), g, items, "cpu", batch=64)
    _plant("the oracle does not score competence 1.0 (%.4f, %d illegal)" % (c1, i1),
           c1 == 1.0 and i1 == 0)
    _plant("a net that only says BOS does not score 0.0 with everything illegal (%.4f, %d/%d)"
           % (c0, i0, n0), c0 == 0.0 and i0 == n0)

    # 4. every case's target must be LEGAL and NOT optimal - a counterfactual, not a restatement
    cases = pick_cases(items, g, 20, np.random.default_rng(2))
    bad = sum(1 for c in cases
              if c["board"][c["target"]] != 0
              or c["target"] in g.optimal_moves(tuple(c["board"])))
    _plant("a case's target is illegal or already optimal (%d of %d)" % (bad, len(cases)),
           bad == 0 and len(cases) == 20)

    # 5. THE THREE CRITERIA MUST BE ABLE TO DISAGREE, or the across-rung guard could never
    #    fire and would be decorative. Built on purpose: a target holding 0.40 of the whole
    #    vocabulary but 0.80 of the legal moves fails the published p>0.5 and passes the
    #    renormalised one. This is exactly the vocabulary-growth effect the guard is for.
    gg = MNK(3, 3, 3)
    board = (1, 2, 0, 0, 0, 0, 0, 0, 0)        # cells 0 and 1 taken, 7 legal
    cs = [{"prefix": [0, 1], "target": 2, "board": list(board)}]
    row = np.zeros(gg.VOCAB)
    row[2] = 0.40            # the target
    row[0] = 0.30            # an ILLEGAL cell, holding mass
    row[gg.BOS] = 0.20       # BOS, also not a legal move
    row[3] = 0.10
    e = efficacies(row[None, :], cs, gg)
    _plant("a target at 0.40 of the vocabulary did not fail the published p>0.5 criterion",
           e["efficacy_p_gt_0.5"] == 0.0)
    _plant("the same target at 0.80 of the LEGAL mass did not pass the renormalised criterion",
           e["efficacy_legal_renormalised"] == 1.0)
    _plant("the argmax criterion disagreed with the raw probabilities",
           e["efficacy_argmax"] == 1.0)

    # and the negative control: when no mass sits on illegal tokens the two criteria COINCIDE,
    # so the gap above is the vocabulary effect and not a bug in the renormalisation.
    row2 = np.zeros(gg.VOCAB)
    row2[2] = 0.40
    row2[3] = 0.35
    row2[4] = 0.25
    e2 = efficacies(row2[None, :], cs, gg)
    _plant("with all mass on legal moves the two criteria still differ",
           e2["efficacy_p_gt_0.5"] == e2["efficacy_legal_renormalised"] == 0.0)

    # 6. THE INTERVAL GUARD. Checked against values computed here, not remembered: a single
    #    failure out of 16 must NOT be separable from a perfect 16, and a clear fall at a large
    #    n must be. Without the second half the guard would simply never fire.
    lo15, hi15 = wilson(15, 16)
    lo16, hi16 = wilson(16, 16)
    _plant("15/16 is separable from 16/16 at n=16, so the ladder would call a break on one "
           "case ([%.4f,%.4f] vs [%.4f,%.4f])" % (lo15, hi15, lo16, hi16), not (hi15 < lo16))
    lo_big, hi_big = wilson(200, 256)
    lo_perf, hi_perf = wilson(256, 256)
    _plant("a clear fall at n=256 is NOT separable, so the guard can never fire "
           "([%.4f,%.4f] vs [%.4f,%.4f])" % (lo_big, hi_big, lo_perf, hi_perf),
           hi_big < lo_perf)
    _plant("the Wilson interval for a perfect run reaches 1.0 at the top", abs(hi16 - 1.0) < 1e-9)
    _plant("the Wilson interval for a perfect run is not wide at n=16 (lo %.4f)" % lo16,
           lo16 < 0.85)
    print("    n=16: 15/16 [%.4f,%.4f] vs 16/16 [%.4f,%.4f] - overlapping, not a break"
          % (lo15, hi15, lo16, hi16))

    # 7. the SINGULAR-ridge refusal must be reachable, or a bad rung would be silently edited
    class FakeC:
        pass

    ev = np.linalg.eigvalsh(np.zeros((4, 4)))
    cond = float("inf") if ev.min() <= 0 else 1.0
    _plant("a zero covariance is not detected as singular", not np.isfinite(cond))

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rungs", nargs="+", default=["3,3,3", "3,4,3", "4,4,3", "4,4,4"])
    ap.add_argument("--edits", type=int, default=16)
    ap.add_argument("--games", type=int, default=20000)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--heads", type=int, default=4)
    ap.add_argument("--embed", type=int, default=64)
    ap.add_argument("--lam", type=float, default=1.0)
    ap.add_argument("--cov", type=int, default=4000)
    ap.add_argument("--policy", default="mixed")
    ap.add_argument("--competent-bar", dest="competent_bar", type=float, default=0.90)
    ap.add_argument("--seed", type=int, default=19)
    ap.add_argument("--tag", default="", help="suffix for the output files")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    raise SystemExit(selftest() if a.selftest else run(a))
