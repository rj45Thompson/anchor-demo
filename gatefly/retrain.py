"""Retraining and editing arms, scored on the published metrics (UC-GF-3, UC-GF-5).

    py -X utf8 -I gatefly/retrain.py --name ttt_big --sizes 1,2,4,8,16,32
    py -X utf8 -I gatefly/retrain.py --selftest

THE QUESTION RJ ASKED, 2026-11-18: "Those figures can be adjusted better by removing or adding
neurons based on the gate patterns such that the math doesn't overlap dimensions. It might only
work in limited context?"

THE ARMS
  control          nothing done. IFR and Preservation must come out at exactly 1.0, which is the
                   instrument's null case; if they do not, nothing below means anything.
  control_matched  the same counterfactual target installed at a DIFFERENT position. The v4
                   lane's control: it separates a subject-specific effect from target priming.
  memit            the closed-form ridge edit, MEMIT's own solve (Meng et al., ICLR 2023) at
                   blocks.L.ffwd.net.2.weight:   W += R K^T (lambda C + K K^T)^-1
  retrain          the v4 lane's method - retrain the identified set. From
                   `selfimprove_v4/STATE_OF_ENTAILMENT.md`: "retraining the corrected set yields
                   a model consistent with the corrected data but NOT the model one would have
                   trained" (the Amnesiac caveat, Graves, Nagisetty & Ganesh, AAAI 2021).
  *_grow           + k NEW ffwd neurons whose output columns are ZERO, so the net's function is
                   bit-identical before the edit, and whose input rows are built to give each
                   case its own coordinate. The edit then has private dimensions: a rises, c
                   does not. This is RJ's "adding neurons so the math doesn't overlap".
  *_prune          - the ffwd neurons carrying the most SHARED key mass across the cases, which
                   is where the crowding between the edit's own keys lives. Removing them DOES
                   change the function, so the damage is measured and reported, never assumed
                   to be nil.

THE GATE IS THE SAME QUANTITY as the flythrough's: A = K^T (lambda C)^-1 K over the edit's keys,
gate_j = g(a_j - c_j). In the flythrough K is the weight columns; here it is the edit's keys. One
arithmetic, two sets of columns - gatefly/gate_math.py proves it is the ratchet lane's.

HONEST LIMIT. One net, one game, one site, one seed family. Tic-tac-toe has a perfect oracle,
which is the point - the metrics' RESOLUTION can be measured here - but it is not a language
model and nothing here transfers to one by itself.
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
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import data_ttt as D
import gate_math as GM
import metrics as M
import net as N
import train_ttt as T
import ttt

bits_of = T.bits_of
soft_ce = T.soft_ce

OUT = os.path.join(HERE, "runs")


# ---------------------------------------------------------------- running the net
def to_x(prefixes, device):
    x = torch.full((len(prefixes), D.BLOCK), D.BOS, dtype=torch.long, device=device)
    for r, pre in enumerate(prefixes):
        for j, mv in enumerate(pre):
            x[r, 1 + j] = mv
    return x


def probs(model, prefixes, device, batch=4096):
    """The net's full distribution at the position AFTER each prefix. Softmax over the whole
    vocabulary, BOS included, because that is the model's actual distribution; a softmax over
    the 9 cells would quietly hide probability mass the net puts on an impossible answer."""
    out = []
    model.eval()
    with torch.no_grad():
        for i in range(0, len(prefixes), batch):
            chunk = prefixes[i:i + batch]
            x = to_x(chunk, device)
            lg = model(x)
            L = torch.tensor([len(p) for p in chunk], device=device)
            at = lg[torch.arange(len(chunk), device=device), L]
            out.append(F.softmax(at.float(), dim=-1).cpu().numpy())
    return np.concatenate(out, axis=0) if out else np.zeros((0, D.VOCAB))


def ffwd_keys(model, prefixes, layer, device, batch=4096):
    """The ffwd hidden activation at the last position - the KEY the edit addresses."""
    blk = model.blocks[layer]
    grab = {}

    def hook(_m, args, _out):
        grab["k"] = args[0].detach()

    h = blk.ffwd.net[2].register_forward_hook(hook)
    keys = []
    model.eval()
    try:
        with torch.no_grad():
            for i in range(0, len(prefixes), batch):
                chunk = prefixes[i:i + batch]
                x = to_x(chunk, device)
                model(x)
                L = torch.tensor([len(p) for p in chunk], device=device)
                keys.append(grab["k"][torch.arange(len(chunk), device=device), L].float().cpu())
    finally:
        h.remove()
    return torch.cat(keys, dim=0).numpy().astype(np.float64)


# ---------------------------------------------------------------- the cases
def build_cases(model, n, device, seed=19, chain_depth=4):
    """n cases, each a position with a COUNTERFACTUAL target.

    The target is a legal move that minimax says is NOT optimal, so the edit is a genuine
    counterfactual and not a restatement of what the net already does. The worst legal move is
    chosen, so every case is the same KIND of counterfactual rather than a mixture.
    """
    rng = np.random.default_rng(seed)
    live = [s for s in ttt.decisions() if len(ttt.legal(s)) > 1]
    order = rng.permutation(len(live))
    cases = []
    for oi in order:
        s = live[oi]
        pre = M.prefix_of(s)
        if pre is None:
            continue
        opt = set(ttt.optimal_moves(s))
        alt = [m for m in ttt.legal(s) if m not in opt]
        if not alt:
            continue
        me = ttt.turn(s)
        # the WORST legal move, by the mover's own minimax value
        vals = [(m, ttt.value(ttt.play(s, m))) for m in alt]
        tgt = (min(vals, key=lambda t: t[1]) if me == 1 else max(vals, key=lambda t: t[1]))[0]
        orig = sorted(opt)[0]
        cases.append({"board": list(s), "prefix": pre, "orig": int(orig), "target": int(tgt),
                      "chain": [(h, m) for h, m in M.chain_from(pre, s, orig, chain_depth)]})
        if len(cases) >= n:
            break
    return cases


def indirect_set(cases, n, seed=23):
    """E_ind: positions whose BOARD differs from every edited one (ThinkEval Eq. 7's filter).

    The filter is in the paper and is easy to miss. Dropping it would score the edit's own
    neighbourhood as collateral and make every arm look more destructive than it is.
    """
    rng = np.random.default_rng(seed)
    edited = set(tuple(c["board"]) for c in cases)
    live = [s for s in ttt.decisions() if tuple(s) not in edited]
    idx = rng.permutation(len(live))[:n * 3]
    out = []
    for i in idx:
        s = live[i]
        pre = M.prefix_of(s)
        if pre is None:
            continue
        out.append({"prefix": pre, "answer": int(sorted(ttt.optimal_moves(s))[0])})
        if len(out) >= n:
            break
    return out


def read_all(model, cases, ind, device):
    """Every probability the three metrics need, in one pass per group."""
    tgt_pre = [c["prefix"] for c in cases]
    P = probs(model, tgt_pre, device)
    target_p = [float(P[i, c["target"]]) for i, c in enumerate(cases)]
    orig_p = [float(P[i, c["orig"]]) for i, c in enumerate(cases)]
    flat, owner = [], []
    for ci, c in enumerate(cases):
        for h, m in c["chain"]:
            flat.append(h)
            owner.append((ci, m))
    CP = probs(model, flat, device) if flat else np.zeros((0, D.VOCAB))
    chains = [[] for _ in cases]
    for k, (ci, m) in enumerate(owner):
        chains[ci].append(float(CP[k, m]))
    IP = probs(model, [t["prefix"] for t in ind], device) if ind else np.zeros((0, D.VOCAB))
    ind_p = [float(IP[i, t["answer"]]) for i, t in enumerate(ind)]
    return {"target_p": target_p, "orig_p": orig_p, "chains": chains, "ind_p": ind_p}


def score(pre, post, cases):
    """The four figures, each with its denominator and exclusions."""
    eff, n_eff = M.efficacy(post["target_p"])
    i_v, i_k, i_x = M.ifr(pre["chains"], post["chains"])
    p_v, p_k, p_x = M.preservation(pre["ind_p"], post["ind_p"])
    # PROPAGATION, with the oracle this setting has: after the edit, does the net play the line
    # the NEW move implies? Counted as the fraction of cases whose post-edit argmax at the
    # edited position is the target AND whose next position's argmax changed with it.
    prop = float(np.mean([1.0 if (post["target_p"][i] > pre["target_p"][i] and
                                  post["chains"][i] and pre["chains"][i] and
                                  post["chains"][i][0] < pre["chains"][i][0]) else 0.0
                          for i in range(len(cases))])) if cases else 0.0
    return {"Efficacy_p_gt_0.5": eff, "Efficacy_n": n_eff,
            "Propagation": prop,
            "IFR": i_v, "IFR_kept": i_k, "IFR_excluded": i_x,
            "Preservation": p_v, "Preservation_kept": p_k, "Preservation_excluded": p_x,
            "mean_target_p_pre": float(np.mean(pre["target_p"])) if pre["target_p"] else 0.0,
            "mean_target_p_post": float(np.mean(post["target_p"])) if post["target_p"] else 0.0}


# ---------------------------------------------------------------- the interventions
def covariance(model, layer, device, n=4000, seed=5, extra=None):
    """C = E[k k^T] at the site, over live positions. The MEMIT convention: a second moment over
    the model's own activations, not an assumed identity.

    `extra` adds prefixes that MUST be represented. This is not a convenience: a neuron grown to
    fire on ONE case has exactly zero mass in a corpus that does not contain that case, so lambda
    C acquires a zero eigenvalue and the solve raised `LinAlgError: Singular matrix` at n=16
    memit_grow. A covariance taken over a corpus that excludes every position where a dimension
    is alive is simply the WRONG C for that net - so the edited positions go in, and the
    condition number is reported so the consequence is visible rather than hidden.

    The consequence IS the mechanism, and it is worth saying: a dimension almost nothing uses
    gets almost no ridge, so it is cheap to write to. That is why growing raises `a`.
    """
    rng = np.random.default_rng(seed)
    live = ttt.decisions()
    idx = rng.permutation(len(live))[:n]
    pres = [M.prefix_of(live[i]) for i in idx]
    pres = [p for p in pres if p is not None]
    if extra:
        pres = pres + list(extra)
    K = ffwd_keys(model, pres, layer, device)
    C = (K.T @ K) / K.shape[0]
    ev = np.linalg.eigvalsh(C)
    cond = float(ev.max() / ev.min()) if ev.min() > 0 else float("inf")
    return C, K.shape[0], cond


def target_deltas(model, cases, layer, device, steps=160, lr=0.4):
    """R: the change at the site's OUTPUT that makes the net answer the counterfactual.

    MEMIT's v*: optimise a vector per case with every weight frozen, then solve for the weight
    change that installs those vectors. Done per case so R is the quantity the solve expects.
    """
    blk = model.blocks[layer]
    E = model.hyper["n_embed"]
    out = []
    for c in cases:
        z = torch.zeros(E, device=device, requires_grad=True)
        pos = len(c["prefix"])
        opt = torch.optim.Adam([z], lr=lr)
        hook = None

        def make_hook(zz, p):
            def h(_m, _args, output):
                output = output.clone()
                output[:, p, :] = output[:, p, :] + zz
                return output
            return h

        hook = blk.ffwd.net[2].register_forward_hook(make_hook(z, pos))
        x = to_x([c["prefix"]], device)
        try:
            for _ in range(steps):
                lg = model(x)[0, pos]
                loss = F.cross_entropy(lg.unsqueeze(0),
                                       torch.tensor([c["target"]], device=device)) \
                    + 0.02 * z.pow(2).sum()
                opt.zero_grad(set_to_none=True)
                loss.backward()
                opt.step()
        finally:
            hook.remove()
        out.append(z.detach().float().cpu().numpy().astype(np.float64))
    return np.stack(out, axis=1) if out else np.zeros((0, 0))   # (E, p)


def memit_edit(model, cases, layer, device, lam, C=None, cond=None, K=None, R=None):
    """W += R K^T (lambda C + K K^T)^-1, at blocks.L.ffwd.net.2.weight.

    Returns the gate quantities of THIS edit, which are the same arithmetic the flythrough
    shows: A = K^T (lambda C)^-1 K, a = diag(A), c = the Schur complement, gate = g(a - c).
    """
    if C is None:
        C, _, cond = covariance(model, layer, device,
                                extra=[c["prefix"] for c in cases])
    # The refusal is computed HERE from C itself, not taken on trust from the caller, and the
    # limit is stated: 1e12 is the float64 working limit, past which the inverse is noise.
    # A LinAlgError from the solve is converted to the same refusal rather than escaping as a
    # bare crash, which is how the first full run died at n=16.
    COND_LIMIT = 1e12
    ev_ = np.linalg.eigvalsh(np.asarray(C, dtype=np.float64))
    cond_here = float(ev_.max() / ev_.min()) if ev_.min() > 0 else float("inf")
    if not np.isfinite(cond_here) or cond_here > COND_LIMIT:
        raise ValueError("lambda C is singular or past the 1e12 working limit (cond %.3e), so "
                         "the solve is UNDEFINED here. A dimension with no corpus mass gets no "
                         "ridge at all - which is what growing a one-case neuron creates."
                         % cond_here)
    cond = cond_here if cond is None else cond
    # K and R may be supplied. The requested change R is computed against the BASE model and
    # does not depend on which subset is being solved, so a subset sweep that recomputes it is
    # doing the same optimisation O(n) times over - which is how the first headroom run became
    # O(n^2) target solves and had to be stopped.
    if K is None:
        K = ffwd_keys(model, [c["prefix"] for c in cases], layer, device).T   # (H, p)
    if R is None:
        R = target_deltas(model, cases, layer, device)                        # (E, p)
    if K.shape[1] != len(cases) or R.shape[1] != len(cases):
        raise ValueError("K has %d and R has %d columns for %d cases"
                         % (K.shape[1], R.shape[1], len(cases)))
    try:
        A, _ = GM.gate_matrix(K, C, lam)
    except np.linalg.LinAlgError as ex:
        raise ValueError("the ridge solve failed at this site: %r" % (ex,))
    a = np.diag(A).copy()
    cc = GM.crowding_all(A)
    gate = GM.g(a - cc)
    Mden = lam * C + K @ K.T
    delta = R @ K.T @ np.linalg.inv(Mden)                                 # (E, H)
    with torch.no_grad():
        W = model.blocks[layer].ffwd.net[2].weight
        W += torch.tensor(delta, dtype=W.dtype, device=W.device)
    return {"a": a.tolist(), "c": cc.tolist(), "gate": gate.tolist(),
            "median_a": float(np.median(a)), "median_c": float(np.median(cc)),
            "median_gate": float(np.median(gate)),
            "mean_crowding_fraction": float(np.mean(cc / np.maximum(a, 1e-12))),
            "lambda": lam, "keys": int(K.shape[1]), "key_dim": int(K.shape[0]),
            "cond_C": cond}


def grow(model, cases, layer, device, per_case=1, seed=31):
    """Add ffwd neurons with ZERO output columns, so the function is unchanged, each firing on
    ONE case and not the others, so the edit gets key coordinates of its own.

    WHERE THE ORTHOGONALITY ACTUALLY LIVES, corrected by this file's own negative control. The
    first version orthogonalised the new READ row against the existing read rows. That is
    impossible here and silently produced dead neurons: the ffwd is 4x over-complete, so the
    existing rows already span the whole input space R^{n_embed} and the projection left
    nothing. A new hidden neuron is instead a NEW COORDINATE OF THE KEY SPACE, automatically
    orthogonal to every existing coordinate; what has to be arranged is that the cases differ
    ALONG it. So each new neuron is built to fire on its own case and be switched off by its
    bias on the others, which makes the new coordinates near one-hot across cases.

    REQ-GF-5c: the crowding of what was added is MEASURED afterwards, never asserted from the
    construction.
    """
    rng = np.random.default_rng(seed)
    blk = model.blocks[layer]
    W0, b0 = blk.ffwd.net[0].weight.data, blk.ffwd.net[0].bias.data
    W2, b2 = blk.ffwd.net[2].weight.data, blk.ffwd.net[2].bias.data
    H, E = W0.shape
    k = per_case * len(cases)
    # the new READ rows: each is a case's own ln2(x) direction, orthogonalised against the
    # existing read rows, so the new neuron responds to that case and little else.
    xs = []
    blkin = {}

    def hook(_m, args, _out):
        blkin["x"] = args[0].detach()

    h = blk.ffwd.net[0].register_forward_hook(hook)
    try:
        with torch.no_grad():
            for c in cases:
                model(to_x([c["prefix"]], device))
                xs.append(blkin["x"][0, len(c["prefix"])].float().cpu().numpy())
    finally:
        h.remove()
    base = W0.float().cpu().numpy()
    scale = float(np.linalg.norm(base, axis=1).mean())
    X = np.stack(xs)                                    # (cases, E)
    rows, biases = [], []
    for i, v in enumerate(xs):
        nv = np.linalg.norm(v)
        w = (v / nv if nv > 1e-9 else rng.standard_normal(E) / np.sqrt(E)) * scale
        s = X @ w                                       # this row's response on every case
        others = np.delete(s, i)
        # a bias that lets case i through and shuts the rest out, with the margin placed
        # between case i and the highest of the others
        hi = float(others.max()) if others.size else 0.0
        for j in range(per_case):
            frac = 0.5 if per_case == 1 else 0.3 + 0.4 * j / max(1, per_case - 1)
            rows.append(w)
            biases.append(-(hi + frac * (float(s[i]) - hi)))
    newW0 = torch.tensor(np.stack(rows), dtype=W0.dtype, device=W0.device)
    newb0 = torch.tensor(np.array(biases), dtype=b0.dtype, device=b0.device)
    blk.ffwd.net[0].weight = torch.nn.Parameter(torch.cat([W0, newW0], dim=0))
    blk.ffwd.net[0].bias = torch.nn.Parameter(torch.cat([b0, newb0]))
    newW2 = torch.zeros(E, k, device=W2.device, dtype=W2.dtype)   # ZERO: function unchanged
    blk.ffwd.net[2].weight = torch.nn.Parameter(torch.cat([W2, newW2], dim=1))
    blk.ffwd.net[2].bias = torch.nn.Parameter(b2.clone())
    # REQ-GF-5c: MEASURE what was added rather than claiming it from the construction.
    Kn = ffwd_keys(model, [c["prefix"] for c in cases], layer, device)[:, H:]   # (cases, k)
    live_per_case = (Kn > 1e-9).sum(axis=1).tolist()
    own = float(np.mean([Kn[i, i * per_case:(i + 1) * per_case].max() if per_case else 0.0
                         for i in range(len(cases))])) if len(cases) else 0.0
    off = float(np.mean([np.delete(Kn[i], range(i * per_case, (i + 1) * per_case)).max()
                         if Kn.shape[1] > per_case else 0.0
                         for i in range(len(cases))])) if len(cases) else 0.0
    return {"added": k, "per_case": per_case, "new_hidden_width": H + k,
            "output_columns": "zero, so the net's function is unchanged by the growth alone",
            "measured_new_coordinates_alive_per_case": live_per_case,
            "measured_mean_own_coordinate": own,
            "measured_mean_largest_other_coordinate": off,
            "measured_one_hot_ratio": own / max(1e-12, off) if off > 0 else float("inf")}


def prune(model, cases, layer, device, k, C=None, lam=1.0):
    """Remove the k ffwd neurons carrying the most SHARED key mass across the cases.

    The shared mass of dimension h is sum_{i<j} |K[h,i] K[h,j]|: the part of the cases' mutual
    overlap that flows through that one coordinate. Removing it is RJ's "removing neurons so the
    math doesn't overlap". It DOES change the function; the change is measured, not assumed nil.
    """
    K = ffwd_keys(model, [c["prefix"] for c in cases], layer, device).T   # (H, p)
    G = np.abs(K) @ np.abs(K).T
    shared = np.array([float(np.abs(K[h]).sum() ** 2 - (K[h] ** 2).sum()) for h in range(K.shape[0])])
    order = np.argsort(-shared)
    drop = sorted(order[:k].tolist())
    keep = [h for h in range(K.shape[0]) if h not in set(drop)]
    blk = model.blocks[layer]
    W0, b0 = blk.ffwd.net[0].weight.data, blk.ffwd.net[0].bias.data
    W2 = blk.ffwd.net[2].weight.data
    idx = torch.tensor(keep, device=W0.device)
    blk.ffwd.net[0].weight = torch.nn.Parameter(W0[idx].clone())
    blk.ffwd.net[0].bias = torch.nn.Parameter(b0[idx].clone())
    blk.ffwd.net[2].weight = torch.nn.Parameter(W2[:, idx].clone())
    return {"removed": len(drop), "kept": len(keep), "indices_removed": drop,
            "rule": "the %d dimensions with the most shared key mass across the %d cases" % (k, K.shape[1])}


def retrain_set(model, cases, device, steps=220, lr=3e-4):
    """The v4 lane's method: retrain the identified set.

    Only the corrected items, which is what "retraining the identified set" literally says. The
    result is consistent with the corrected data; whether it is the model one WOULD have trained
    is a separate question, measured in UC-GF-3 step 5 and never assumed.
    """
    model.train()
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.0)
    x = to_x([c["prefix"] for c in cases], device)
    pos = torch.tensor([len(c["prefix"]) for c in cases], device=device)
    tgt = torch.tensor([c["target"] for c in cases], device=device)
    for _ in range(steps):
        lg = model(x)
        at = lg[torch.arange(len(cases), device=device), pos]
        loss = F.cross_entropy(at, tgt)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
    model.eval()
    return {"steps": steps, "lr": lr, "items": len(cases),
            "method": "retrain the identified set only (selfimprove_v4/STATE_OF_ENTAILMENT.md)"}


# ---------------------------------------------------------------- the run
def retrain_corrected_corpus(model, cases, device, steps=600, lr=1e-4, batch=512, seed=3,
                             weight=0.0):
    """The v4 lane's method read the OTHER way: retrain on the CORRECTED DATA, not only on the
    corrected items.

    `STATE_OF_ENTAILMENT.md` says "retraining the corrected set yields a model consistent with
    the corrected data". `retrain_set` takes that literally - fine-tune the identified items
    alone - and on this net it is catastrophic, which is a fair reading of the sentence but an
    unfair test of the intent. This arm is the other reading: the whole training distribution,
    with the edited positions' targets REPLACED by the counterfactual. It is the expensive one,
    and the cost ordering the v4 lane names (a 160 KB delta against retraining a set) is exactly
    what makes it expensive.

    Both arms are reported. Neither is called "the" v4 method, because the sentence admits both.
    """
    model.train()
    d = D.load()
    rng = np.random.default_rng(seed)
    games = torch.as_tensor(d["games"].astype(np.int64), device=device)
    gmask = torch.as_tensor(d["gmask"], device=device)
    bits = bits_of(d["gopt"], device)
    # the correction: wherever a game's prefix matches an edited case, the target at that step
    # becomes the counterfactual move and nothing else.
    key = {tuple(c["prefix"]): c["target"] for c in cases}
    lengths = sorted(set(len(k) for k in key))
    hit = 0
    touched_rows = set()
    G = d["games"]
    GM_ = d["gmask"]
    for t in lengths:
        if t > 8:
            continue
        # one vectorised pass per distinct prefix length, rather than a Python loop over all
        # 255,168 games at every step
        pref = G[:, 1:1 + t]
        live = GM_[:, t]
        for k, tgt in key.items():
            if len(k) != t:
                continue
            m_ = live.copy()
            for j, mv in enumerate(k):
                m_ &= (pref[:, j] == mv)
            idxs = np.nonzero(m_)[0]
            if idxs.size:
                bits[torch.as_tensor(idxs, device=device), t] = 0.0
                bits[torch.as_tensor(idxs, device=device), t, tgt] = 1.0
                hit += int(idxs.size)
                touched_rows.update(idxs.tolist())
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.0)
    N_ = games.shape[0]
    # `weight` is the fraction of each batch drawn from games that CONTAIN a corrected
    # position. 0.0 is the uniform corpus, where a handful of corrected steps among 2.3 M is
    # diluted to nothing; 1.0 would be retrain_set. The point of the parameter is that the two
    # arms are ends of one spectrum and the middle is where the trade-off lives.
    touched = np.array(sorted(touched_rows)) if touched_rows else np.zeros(0, dtype=np.int64)
    n_hot = int(round(batch * weight)) if touched.size else 0
    for _ in range(steps):
        sel = torch.as_tensor(rng.integers(0, N_, batch), device=device)
        if n_hot:
            hot = torch.as_tensor(touched[rng.integers(0, touched.size, n_hot)], device=device)
            sel[:n_hot] = hot
        lg = model(games[sel])[:, :9]
        loss = soft_ce(lg, bits[sel], gmask[sel])
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
    model.eval()
    return {"steps": steps, "lr": lr, "batch": batch, "items": len(cases),
            "game_steps_corrected": hit, "games_touched": int(touched.size),
            "hot_fraction_of_batch": weight,
            "method": "retrain the CORRECTED CORPUS - the whole distribution with the edited "
                      "positions' targets replaced"}


def clone(model, device):
    m = N.GPT(**{k: v for k, v in model.hyper.items()})
    m.load_state_dict(copy.deepcopy(model.state_dict()))
    return m.to(device).eval()


def run_arm(base, arm, cases, ind, pre, layer, device, lam, C, grow_per_case, prune_k):
    m = clone(base, device)
    info = {}
    if "grow" in arm:
        info["grow"] = grow(m, cases, layer, device, grow_per_case)
    if "prune" in arm:
        info["prune"] = prune(m, cases, layer, device, prune_k)
    if "memit" in arm:
        Cu, condu = C, None
        if "grow" in arm or "prune" in arm:
            # the key space itself changed, so C must be taken again on the NEW space, and the
            # edited positions must be in it (see covariance's note on the singular solve)
            Cu, _, condu = covariance(m, layer, device,
                                      extra=[c["prefix"] for c in cases])
            info["cov_cond_after_capacity_change"] = condu
        try:
            info["edit"] = memit_edit(m, cases, layer, device, lam, Cu, condu)
        except ValueError as ex:
            info["edit_refused"] = str(ex)
    if "corpus" in arm:
        info["retrain"] = retrain_corrected_corpus(
            m, cases, device, weight=(0.25 if "_w" in arm else 0.0))
    elif "retrain" in arm:
        info["retrain"] = retrain_set(m, cases, device)
    post = read_all(m, cases, ind, device)
    s = score(pre, post, cases)
    return m, s, info


def main(a):
    dev = "cuda" if torch.cuda.is_available() and not a.cpu else "cpu"
    stem = os.path.join(OUT, a.name)
    base, meta = N.load(stem, dev)
    layer = a.layer if a.layer >= 0 else meta["hyper"]["n_layers"] - 1
    C, cov_n, cov_cond = covariance(base, layer, dev)
    board_states, board_prefixes = [], []
    for s_ in ttt.decisions():
        pr = M.prefix_of(s_)
        if pr is not None:
            board_states.append(s_)
            board_prefixes.append(pr)
    sizes = [int(x) for x in a.sizes.split(",")]
    arms = a.arms.split(",")
    print("%s: %d params, editing blocks.%d.ffwd.net.2.weight, C over %d live positions "
          "(cond %.3e), %d distinct boards scored"
          % (a.name, meta["parameters"], layer, cov_n, cov_cond, len(board_states)))
    print("lambda %g   arms: %s   sizes: %s" % (a.lam, ", ".join(arms), sizes))

    rows = []
    for n in sizes:
        cases = build_cases(base, n, dev, a.seed)
        if len(cases) < n:
            print("  only %d cases available at size %d; reporting the smaller set" % (len(cases), n))
        ind = indirect_set(cases, a.indirect)
        pre = read_all(base, cases, ind, dev)
        for arm in arms:
            t0 = time.time()
            cs = cases
            if arm == "control_matched":
                # the same target installed at a DIFFERENT position, then scored against the
                # ORIGINAL cases: a subject-specific effect survives this, priming does not.
                other = build_cases(base, n * 2, dev, a.seed + 977)
                used = [o for o in other
                        if tuple(o["board"]) not in set(tuple(c["board"]) for c in cases)][:n]
                for i, o in enumerate(used):
                    o["target"] = cases[i % len(cases)]["target"]
                cs = used
            m, s, info = run_arm(base, "memit" if arm == "control_matched" else arm,
                                 cs, ind, pre if arm != "control_matched" else
                                 read_all(base, cs, ind, dev), layer, dev, a.lam, C,
                                 a.grow_per_case, a.prune_k)
            if arm == "control_matched":
                post = read_all(m, cases, ind, dev)     # scored on the ORIGINAL cases
                s = score(pre, post, cases)
            if arm == "control":
                m, s, info = run_arm(base, "", cases, ind, pre, layer, dev, a.lam, C,
                                     a.grow_per_case, a.prune_k)
            # What the net still does AT THE GAME, which no published metric asks and which
            # turns out to be the thing that separates the arms. Over the 4,520 DISTINCT live
            # boards - one observation per position (REQ-GF-3b), and 65x cheaper than the
            # 294,778 transcript prefixes, which buys the extra arm below.
            BP = probs(m, board_prefixes, dev)
            pick = BP.argmax(1)
            rate = float(np.mean([1.0 if (p < 9 and p in ttt.optimal_moves(s)) else 0.0
                                  for p, s in zip(pick, board_states)]))
            ill = int(sum(1 for p, s in zip(pick, board_states) if p >= 9 or s[p] != 0))
            row = {"size": len(cs), "arm": arm, "seconds": round(time.time() - t0, 1),
                   "optimal_rate_after_4520_boards": rate, "illegal_after": ill,
                   "positions": len(board_states), "info": info}
            row.update(s)
            rows.append(row)
            print("  n=%-3d %-16s Eff %.4f  Prop %.4f  IFR %7.4f (D'=%d)  Pres %7.4f   "
                  "still optimal on %.4f of boards"
                  % (len(cs), arm, s["Efficacy_p_gt_0.5"], s["Propagation"], s["IFR"],
                     s["IFR_kept"], s["Preservation"], rate))
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, a.name + ".retrain.json")
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"name": a.name, "layer": layer, "lambda": a.lam, "cov_positions": cov_n,
                   "arms": arms, "sizes": sizes, "seed": a.seed, "cov_cond": cov_cond,
                   "grow_per_case": a.grow_per_case, "prune_k": a.prune_k,
                   "metric_source": "ThinkEval Eq.6/7 (arXiv 2506.01386) via "
                                    "selfimprove_v4/knowgic_score.py; gatefly/metrics.py "
                                    "reproduces the KnowGIC README worked example",
                   "rows": rows}, f, indent=1)
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

    dev = "cpu"
    torch.manual_seed(7)
    m = N.GPT(D.VOCAB, D.BLOCK, 32, 2, 2, 0.0).to(dev).eval()

    # 1. every case is a genuine COUNTERFACTUAL: the target is legal and NOT optimal.
    cases = build_cases(m, 12, dev)
    okc = all(c["board"][c["target"]] == 0 and
              c["target"] not in ttt.optimal_moves(tuple(c["board"])) for c in cases)
    _plant("a case's target is illegal or already optimal", okc and len(cases) == 12)

    # 2. the control arm must give EXACTLY 1.0 on IFR and Preservation. This is the null case:
    #    if doing nothing moves the ruler, the ruler is broken.
    ind = indirect_set(cases, 40)
    pre = read_all(m, cases, ind, dev)
    _, s, _ = run_arm(m, "", cases, ind, pre, 1, dev, 1.0, None, 2, 4)
    _plant("the control arm does not give IFR 1.0 (%.10f)" % s["IFR"], abs(s["IFR"] - 1) < 1e-9)
    _plant("the control arm does not give Preservation 1.0 (%.10f)" % s["Preservation"],
           abs(s["Preservation"] - 1) < 1e-9)

    # 3. GROW must leave the function BIT-IDENTICAL: zero output columns write nothing.
    m2 = clone(m, dev)
    before = probs(m2, [c["prefix"] for c in cases], dev)
    g = grow(m2, cases, 1, dev, 2)
    print("    grow measured: own coord %.4f, largest other %.4f, one-hot ratio %.2f"
          % (g["measured_mean_own_coordinate"], g["measured_mean_largest_other_coordinate"],
             g["measured_one_hot_ratio"]))
    after = probs(m2, [c["prefix"] for c in cases], dev)
    _plant("growing changed the net's function, so a later difference is not the edit's "
           "(max %.3e)" % float(np.abs(before - after).max()),
           float(np.abs(before - after).max()) < 1e-6)
    _plant("growing did not widen the hidden layer",
           m2.blocks[1].ffwd.net[0].weight.shape[0] == m.blocks[1].ffwd.net[0].weight.shape[0] + 24)

    # 4. and the NEGATIVE CONTROL: with NON-zero output columns the function must change, so
    #    plant 3 is known to be able to detect a growth that is not inert.
    m3 = clone(m, dev)
    grow(m3, cases, 1, dev, 2)
    with torch.no_grad():
        # A RANDOM perturbation, not a constant one. Adding the SAME number to every output
        # column writes a uniform vector into the residual stream, and ln_f removes a uniform
        # shift exactly - so a constant control passed while detecting nothing, which is a fact
        # about LayerNorm and not about the growth.
        torch.manual_seed(101)
        m3.blocks[1].ffwd.net[2].weight[:, -24:] += torch.randn(
            m3.blocks[1].ffwd.net[2].weight.shape[0], 24) * 0.6
    after3 = probs(m3, [c["prefix"] for c in cases], dev)
    _plant("a growth with non-zero output columns still left the function unchanged - plant 3 "
           "cannot detect a live growth", float(np.abs(before - after3).max()) > 1e-4)
    # and the LayerNorm fact itself, as a plant, because it is the reason the first control
    # passed while measuring nothing and it would do so again.
    m3b = clone(m, dev)
    grow(m3b, cases, 1, dev, 2)
    with torch.no_grad():
        m3b.blocks[1].ffwd.net[2].weight[:, -24:] += 0.3
    _plant("a UNIFORM write into the residual changed the function, so ln_f is not removing it",
           float(np.abs(before - probs(m3b, [c["prefix"] for c in cases], dev)).max()) < 1e-5)

    # 5. PRUNE removes exactly k and the removal is reported.
    m4 = clone(m, dev)
    pr = prune(m4, cases, 1, dev, 5)
    _plant("prune removed the wrong number",
           pr["removed"] == 5 and m4.blocks[1].ffwd.net[0].weight.shape[0] ==
           m.blocks[1].ffwd.net[0].weight.shape[0] - 5)

    # 6. the MEMIT solve must RAISE the target's probability - otherwise the edit is not an edit.
    m5 = clone(m, dev)
    C, _, cond5 = covariance(m5, 1, dev, n=400, extra=[c["prefix"] for c in cases[:4]])
    e = memit_edit(m5, cases[:4], 1, dev, 1.0, C, cond5)
    post = probs(m5, [c["prefix"] for c in cases[:4]], dev)
    rose = sum(1 for i, c in enumerate(cases[:4]) if post[i, c["target"]] > pre["target_p"][i])
    _plant("the closed-form edit raised the target on %d of 4 cases" % rose, rose >= 3)
    _plant("the edit reported no gate quantities", "gate" in e and len(e["gate"]) == 4)

    # 7. the edit's gate is the SAME arithmetic as the flythrough's: recompute g(a-c) from the
    #    reported a and c and require it to match the reported gate.
    aa = np.array(e["a"]), np.array(e["c"])
    want = GM.g(aa[0] - aa[1])
    _plant("the edit's gate is not g(a - c)",
           float(np.abs(want - np.array(e["gate"])).max()) < 1e-12)

    # 8. THE SINGULAR RIDGE, which is how the first full run died. Growing adds dimensions
    #    that are alive on ONE case each, so a covariance taken without those cases has exactly
    #    zero mass there and lambda C is singular. The plant checks BOTH directions: without
    #    the cases it must be singular, with them it must not be.
    m6 = clone(m, dev)
    grow(m6, cases[:4], 1, dev, 1)
    Cbad, _, cbad = covariance(m6, 1, dev, n=300)
    Cok, _, cok = covariance(m6, 1, dev, n=300, extra=[c["prefix"] for c in cases[:4]])
    # Whether it is EXACTLY singular depends on whether any corpus position happens to trip a
    # grown neuron's bias: on ttt_big at n=16 it was (the run died there), on this small model
    # with 4 cases it is merely very ill-conditioned. Both are the same fact, so the plant
    # checks the fact - including the cases improves the conditioning - and the refusal path is
    # checked separately on a C that is singular by construction.
    _plant("including the grown neurons' own cases did not improve the conditioning "
           "(%.3e -> %.3e)" % (cbad, cok),
           (not np.isfinite(cbad)) or cok < cbad)
    _plant("the ridge is unusable even WITH the cases (cond %.3e)" % cok, np.isfinite(cok))
    print("    cond(C) without the grown cases %.3e, with them %.3e" % (cbad, cok))
    # the refusal path, on a C that is singular by construction
    Csing = Cok.copy()
    Csing[3, :] = 0.0
    Csing[:, 3] = 0.0          # a dimension with exactly no mass: the grown-neuron case
    try:
        memit_edit(m6, cases[:4], 1, dev, 1.0, Csing)
        refused = False
    except ValueError:
        refused = True
    _plant("a singular ridge was not REFUSED - it would crash or quietly pseudo-invert",
           refused)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_big")
    ap.add_argument("--layer", type=int, default=-1)
    ap.add_argument("--sizes", default="1,2,4,8,16,32")
    ap.add_argument("--arms", default="control,control_matched,memit,retrain,corpus,corpus_w,"
                                      "memit_grow,memit_prune")
    ap.add_argument("--lam", type=float, default=1.0)
    ap.add_argument("--indirect", type=int, default=400)
    ap.add_argument("--grow-per-case", dest="grow_per_case", type=int, default=1)
    ap.add_argument("--prune-k", dest="prune_k", type=int, default=16)
    ap.add_argument("--seed", type=int, default=19)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    raise SystemExit(selftest() if a.selftest else main(a))
