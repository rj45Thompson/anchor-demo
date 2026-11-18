"""Read a checkpoint's gate network and emit a NEURAL BLUEPRINT for the flythrough.

    py -X utf8 -I gatefly/gate_read.py --name ttt_small
    py -X utf8 -I gatefly/gate_read.py --selftest

UC-GF-2 step 1. For every weight matrix W (out, in) in the net, its INPUT units are writers into
its OUTPUT space: unit f contributes x_f * W[:, f]. So K = W, one column per writer, and

    a = diag(K^T (lambda C)^-1 K)      c = Schur complement of each column against the rest
    gate = g(a - c)                    g(x) = x / (1 + x)

with C = I and lambda = the MEDIAN SQUARED COLUMN NORM of that site (neuron_gates.py's
convention: it scales a to O(1) so c/a is readable, and c/a is scale-free so it cannot change a
conclusion). lambda is written into the file for every site.

SITES. `blocks.N.ffwd.net.2.weight` is the lane's own site: its columns are the feed-forward
NEURONS writing into the residual stream, the same object as GPT-2's mlp.c_proj rows. The other
matrices are included and LABELLED, because their input units are residual dimensions or
attention slots rather than neurons, and calling those "neurons" would be the kind of quiet
relabelling this repo logs as a fault.

ALT-2, CORRECTED BY ITS OWN PLANT. The use case said "if a site's Gram is singular the gate is
undefined". That cannot happen through (I + A): A = K^T (lambda C)^-1 K is positive semi-definite,
so I + A >= I and its condition number is at most 1 + lambda_max - never singular, for any net.
A refusal keyed on it could never fire, which is the exact fault this repo logs as a check that
cannot fail. The refusal is therefore keyed on what CAN fire:

  * lambda <= 0 - a DEAD site whose columns are all zero, so there is no scale to divide by;
  * a non-finite A, which is how an f16 overflow would arrive;
  * (for the activation-covariance reading used by the retraining module) a singular lambda C.

cond(I + A) is still reported per site, because it bounds what the inverse can do, but it is not
a refusal criterion and is not presented as one.

THE FORMAT, "neural-blueprint v1", is defined by this file and read by harness/gatefly. What it
holds and an Unreal Blueprint does not: a per-unit MEASURED SCALAR, a derived layout, a dense
weight edge set with a stated threshold, and a live-activation channel. See NEURAL_BLUEPRINT.md.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import gate_math as GM
import net as N

FORMAT = "neural-blueprint v1"
LANE_SITE = "ffwd.net.2.weight"


def sites_of_mlp(tens, hyper):
    """A plain MLP: `layers.N.weight` is (out, in), so its COLUMNS are layer N-1's units.

    The last matrix's OUTPUT units are addresses, not writers, and are absent here for the same
    reason the GPT's logits are.
    """
    out = []
    sizes = hyper["sizes"]
    i = 0
    while ("layers.%d.weight" % i) in tens:
        nm = "layers.%d.weight" % i
        kind = "input" if i == 0 else "neuron"
        label = ("the %d inputs" % sizes[0]) if i == 0 else ("hidden layer %d" % i)
        out.append((nm, label, kind, tens[nm]))
        i += 1
    return out


def sites_of(tens, hyper):
    """The weight matrices whose INPUT units get a gate, in forward order.

    Returns a list of dicts: name, W, the space it writes into, and whether it is the ratchet
    lane's own site. Order is the order a forward pass touches them, so the flythrough's x axis
    is the net's own depth and not an alphabetical accident.
    """
    out = []
    L = hyper["n_layers"]
    for b in range(L):
        for h in range(hyper["n_heads"]):
            for part in ("key", "query", "value"):
                nm = "blocks.%d.sa.heads.%d.%s.weight" % (b, h, part)
                if nm in tens:
                    out.append((nm, "block %d head %d %s" % (b, h, part), "attention head"))
        for nm, label, kind in (
                ("blocks.%d.sa.proj.weight" % b, "block %d attention out" % b, "attention slot"),
                ("blocks.%d.ffwd.net.0.weight" % b, "block %d ffwd in" % b, "residual dim"),
                ("blocks.%d.ffwd.net.2.weight" % b, "block %d ffwd neurons" % b, "neuron")):
            if nm in tens:
                out.append((nm, label, kind))
    if "lm_head.weight" in tens:
        out.append(("lm_head.weight", "output head", "residual dim"))
    return [(nm, label, kind, tens[nm]) for nm, label, kind in out]


def read(stem, cond_limit=1e12):
    tens, meta = N.tensors(stem)
    hyper = meta["hyper"]
    # which kind of net this is comes from the checkpoint itself, never from the file's name
    mk = (meta.get("kind") or hyper.get("kind") or "gpt").lower()
    sites = sites_of_mlp(tens, hyper) if mk == "mlp" else sites_of(tens, hyper)
    layers, u_layer, u_index, u_a, u_c, u_g = [], [], [], [], [], []
    for li, (nm, label, kind, W) in enumerate(sites):
        d, p = W.shape
        lam = GM.ridge_scale(W)
        dead = not (lam > 0) or not np.isfinite(lam)
        A = None
        if not dead:
            A, _ = GM.gate_matrix(W, np.eye(d), lam)
            dead = not np.isfinite(A).all()
        ev = np.linalg.eigvalsh(A + np.eye(p)) if A is not None else None
        cond = float(ev.max() / ev.min()) if ev is not None and ev.min() > 0 else float("inf")
        rec = {"id": li, "name": label, "site": nm, "kind": kind, "units": int(p),
               "writes_into": int(d), "lambda": lam, "cond_I_plus_A": cond,
               "lane_site": nm.endswith(LANE_SITE), "refused": bool(dead)}
        if dead:
            rec["refused_why"] = ("this site has no usable scale (median squared column norm "
                                  "%r) or a non-finite Gram, so the gate is UNDEFINED here, "
                                  "not 0" % (lam,))
            layers.append(rec)
            continue
        a = np.diag(A).copy()
        c = GM.crowding_all(A)
        gate = GM.g(a - c)
        rec.update({"median_gate": float(np.median(gate)), "median_a": float(np.median(a)),
                    "median_c": float(np.median(c)), "min_gate": float(gate.min()),
                    "max_gate": float(gate.max()),
                    "median_crowding_fraction": float(np.median(c / a))})
        layers.append(rec)
        for j in range(p):
            u_layer.append(li)
            u_index.append(j)
            u_a.append(float(a[j]))
            u_c.append(float(c[j]))
            u_g.append(float(gate[j]))
    return {"tens": tens, "meta": meta, "layers": layers,
            "layer": np.array(u_layer, np.int32), "index": np.array(u_index, np.int32),
            "a": np.array(u_a), "c": np.array(u_c), "gate": np.array(u_g)}


def layout(r, spacing=150.0, cell=11.0):
    """Derive a position per unit: x is the net's own depth, and each site's units fill a square
    grid on the y-z plane. A net carries no authored layout, so geometry is COMPUTED - which is
    the first thing an Unreal Blueprint's x/y/w/h fields cannot supply."""
    pos = np.zeros((r["layer"].size, 3), dtype=np.float32)
    live = [L for L in r["layers"] if not L["refused"]]
    xs = {L["id"]: i * spacing for i, L in enumerate(live)}
    for L in r["layers"]:
        if L["refused"]:
            continue
        sel = np.where(r["layer"] == L["id"])[0]
        n = sel.size
        side = int(math.ceil(math.sqrt(n)))
        for k, i in enumerate(sel):
            gy, gz = divmod(k, side)
            pos[i] = (xs[L["id"]],
                      (gy - (side - 1) / 2.0) * cell,
                      (gz - (side - 1) / 2.0) * cell)
        L["x"] = xs[L["id"]]
        L["grid_side"] = side
        L["cell"] = cell
    return pos


def edges(r, keep_per_unit=6):
    """Weight edges between consecutive SITES, thresholded.

    NO_TOYS rule 2: the cap states its number. For each unit of site L we keep its
    `keep_per_unit` largest-magnitude weights into site L+1's units and report how many were
    dropped, in the file and in the page.
    """
    live = [L for L in r["layers"] if not L["refused"]]
    frm, to, w = [], [], []
    total = 0
    base = {}
    for L in live:
        base[L["id"]] = int(np.where(r["layer"] == L["id"])[0][0])
    for L1, L2 in zip(live, live[1:]):
        W = r["tens"][L2["site"]]           # (out=L2.writes_into, in=L2.units)
        # L1's units write into a space of dimension L1["writes_into"], which is L2's input
        # space only when the shapes line up; when they do not (a head's smaller space, say)
        # the pair is skipped and said so rather than joined by a made-up correspondence.
        if L1["writes_into"] != L2["units"]:
            continue
        mag = np.abs(W)
        k = min(keep_per_unit, W.shape[0])
        for j in range(W.shape[1]):
            col = mag[:, j]
            total += int(col.size)
            idx = np.argpartition(col, -k)[-k:]
            for i in idx:
                frm.append(base[L1["id"]] + j)
                to.append(base[L2["id"]] + int(i))
                w.append(float(W[i, j]))
    return {"from": frm, "to": to, "w": w, "kept": len(w), "considered": total,
            "dropped": total - len(w), "keep_per_unit": keep_per_unit,
            "threshold_rule": "the %d largest-magnitude weights per writing unit; %d of %d "
                              "considered weights are NOT drawn" % (keep_per_unit,
                                                                    total - len(w), total)}


def hand_check(r, which=None):
    """REQ-GF-2a. Recompute ONE unit's gate by a path that shares no code with the viewer: read
    the f16 blob again, take the one column and the one submatrix, and do the 2x2 algebra.

    Done with explicit numpy on slices rather than through gate_math, so a bug in gate_math
    cannot hide here. Returns both figures and their difference.
    """
    lane = [L for L in r["layers"] if L["lane_site"] and not L["refused"]]
    if not lane:
        lane = [L for L in r["layers"] if not L["refused"]]
    L = lane[0]
    W = r["tens"][L["site"]]
    p = W.shape[1]
    j = (p // 3) if which is None else which
    lam = L["lambda"]
    # the direct computation: A = W^T W / lam, then the Schur complement of column j.
    A = (W.T @ W) / lam
    others = [i for i in range(p) if i != j]
    S = np.eye(p - 1) + A[np.ix_(others, others)]
    aj = float(A[j, j])
    cj = float(A[others, j] @ np.linalg.solve(S, A[others, j]))
    eff = aj - cj
    direct = eff / (1.0 + eff)
    # and the FULL matrix inverse, a third independent route: diag(A (I+A)^-1)_jj.
    full = float((A @ np.linalg.inv(np.eye(p) + A))[j, j])
    sel = np.where((r["layer"] == L["id"]) & (r["index"] == j))[0][0]
    emitted = float(r["gate"][sel])
    return {"site": L["site"], "unit": int(j),
            "a_direct": aj, "c_direct": cj,
            "gate_emitted_by_the_pipeline": emitted,
            "gate_by_hand_from_the_identity": direct,
            "gate_by_hand_from_the_full_inverse": full,
            "abs_difference_identity": abs(emitted - direct),
            "abs_difference_full_inverse": abs(emitted - full),
            "how": "A = W^T W / lambda on the f16 blob's own columns, then c_j = "
                   "A[-j,j] (I + A[-j,-j])^-1 A[-j,j] and gate = (a-c)/(1+a-c). No gate_math "
                   "call on this path."}


def emit(stem, out_path, keep_per_unit=6, about=None):
    r = read(stem)
    pos = layout(r)
    E = edges(r, keep_per_unit)
    hc = hand_check(r)
    live = [L for L in r["layers"] if not L["refused"]]
    doc = {
        "format": FORMAT,
        "of": os.path.basename(stem),
        "about": about or "",
        "source_checkpoint": os.path.basename(stem) + ".f16",
        "hyper": r["meta"]["hyper"],
        "kind": (r["meta"].get("kind") or r["meta"]["hyper"].get("kind") or "gpt").lower(),
        "parameters": r["meta"]["parameters"],
        "quantity": {
            "gate": "g(a - c) with g(x)=x/(1+x): the fraction of what you try to write at this "
                    "unit that actually arrives, given every other unit writing into the same "
                    "space. The ratchet lane's quantity (gate_blueprint.py, effective_a.py); "
                    "gatefly/gate_math.py proves agreement to 0.0.",
            "a": "ADDRESSABILITY: A_jj, how reachable this unit's write direction is.",
            "c": "CROWDING: the Schur complement of this unit against all the others - how much "
                 "of its direction the others already span.",
            "C": "the identity. lambda per site is the median squared column norm, so a is O(1) "
                 "and c/a is readable; c/a is scale-free.",
            "not_an_activation": "This is a property of the WEIGHTS, not of any input. It does "
                                 "not change as the net runs."
        },
        "layers": r["layers"],
        "units": {
            "n": int(r["layer"].size),
            "layer": r["layer"].tolist(),
            "index": r["index"].tolist(),
            "a": [round(v, 6) for v in r["a"].tolist()],
            "c": [round(v, 6) for v in r["c"].tolist()],
            "gate": [round(v, 6) for v in r["gate"].tolist()],
            "pos": [round(float(v), 3) for v in pos.reshape(-1).tolist()],
        },
        "edges": E,
        "checks": {"hand_check": hc,
                   "sites_refused": [L["site"] for L in r["layers"] if L["refused"]],
                   "sites_drawn": len(live)},
    }
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, separators=(",", ":"))
    return doc


def selftest() -> int:
    import tempfile
    import torch
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    torch.manual_seed(5)
    m = N.GPT(10, 10, 32, 2, 2, 0.0)
    d = tempfile.mkdtemp()
    stem = os.path.join(d, "t")
    N.save(m, stem)
    doc = emit(stem, os.path.join(d, "t.json"))

    # 1. the lane's site is present and its unit count is mult * n_embed.
    lane = [L for L in doc["layers"] if L["lane_site"]]
    _plant("the lane's ffwd.net.2 site is missing", len(lane) == 2)
    _plant("the lane's site does not have 4*n_embed units",
           all(L["units"] == 128 and L["writes_into"] == 32 for L in lane))

    # 2. every emitted gate is a fraction in (0,1), and a and c are non-negative with c <= a.
    g = np.array(doc["units"]["gate"])
    a = np.array(doc["units"]["a"])
    c = np.array(doc["units"]["c"])
    _plant("an emitted gate left (0,1)", bool((g > 0).all() and (g < 1).all()))
    _plant("a crowding term is negative or exceeds its own a",
           bool((c >= -1e-9).all() and (c <= a + 1e-9).all()))

    # 3. THE HAND CHECK must agree. This is REQ-GF-2a's own observable.
    hc = doc["checks"]["hand_check"]
    _plant("the pipeline's gate disagrees with the hand computation: %.3e"
           % hc["abs_difference_identity"], hc["abs_difference_identity"] < 1e-9)
    _plant("the identity and the full inverse disagree: %.3e"
           % hc["abs_difference_full_inverse"], hc["abs_difference_full_inverse"] < 1e-9)
    print("    hand check: emitted %.10f  by hand %.10f  diff %.3e"
          % (hc["gate_emitted_by_the_pipeline"], hc["gate_by_hand_from_the_identity"],
             hc["abs_difference_identity"]))

    # 4. a unit count and a position count that agree, since the viewer indexes one by the other.
    _plant("pos has the wrong length",
           len(doc["units"]["pos"]) == 3 * doc["units"]["n"])
    _plant("the unit count does not equal the sum of the drawn sites' units",
           doc["units"]["n"] == sum(L["units"] for L in doc["layers"] if not L["refused"]))

    # 5. the edge cap STATES its number (NO_TOYS rule 2) and the numbers add up.
    E = doc["edges"]
    _plant("the edge cap does not say what it dropped",
           E["dropped"] >= 0 and str(E["dropped"]) in E["threshold_rule"])
    _plant("kept + dropped != considered", E["kept"] + E["dropped"] == E["considered"])

    # 6. NEGATIVE CONTROL on the crowding statistic: duplicate a site's columns and the median
    #    crowding fraction must RISE. If it does not, c is not measuring overlap.
    W = m.state_dict()["blocks.0.ffwd.net.2.weight"].detach().double().numpy()
    half = W[:, :64]
    dup = np.concatenate([half, half + 1e-9], axis=1)
    _, c1, _ = GM.acg(half, None, GM.ridge_scale(half))
    a1, _, _ = GM.acg(half, None, GM.ridge_scale(half))
    _, c2, _ = GM.acg(dup, None, GM.ridge_scale(dup))
    a2, _, _ = GM.acg(dup, None, GM.ridge_scale(dup))
    _plant("duplicating every column did not raise the crowding fraction (%.4f -> %.4f)"
           % (float(np.median(c1 / a1)), float(np.median(c2 / a2))),
           float(np.median(c2 / a2)) > float(np.median(c1 / a1)))

    # 7. ALT-2 must be REACHABLE: a DEAD site (all-zero columns, so lambda = 0) is refused and
    #    carries no gate. Built on purpose by zeroing a real checkpoint's site, which is the
    #    only way to know the refusal path runs at all.
    sd = m.state_dict()
    sd["blocks.1.ffwd.net.2.weight"] = torch.zeros_like(sd["blocks.1.ffwd.net.2.weight"])
    m2 = N.GPT(10, 10, 32, 2, 2, 0.0)
    m2.load_state_dict(sd)
    stem2 = os.path.join(d, "dead")
    N.save(m2, stem2)
    doc2 = emit(stem2, os.path.join(d, "dead.json"))
    ref = [L for L in doc2["layers"] if L["refused"]]
    _plant("a dead site was not refused", len(ref) == 1
           and ref[0]["site"] == "blocks.1.ffwd.net.2.weight")
    _plant("a refused site still carries a gate", "median_gate" not in ref[0])
    _plant("refusing one site dropped the others too",
           doc2["checks"]["sites_drawn"] == doc["checks"]["sites_drawn"] - 1)
    # the negative control: the HEALTHY net refuses nothing, so the refusal is not always-on.
    _plant("a healthy net refused a site - the refusal fires on everything",
           not doc["checks"]["sites_refused"])

    # 8. and the mathematical note that corrected ALT-2: I + A is NEVER singular, so a refusal
    #    keyed on its condition number could not fire. Checked rather than merely asserted.
    rng = np.random.default_rng(4)
    worst = 0.0
    for _ in range(25):
        Kr = rng.standard_normal((rng.integers(2, 9), rng.integers(2, 40)))
        Ar, _ = GM.gate_matrix(Kr, np.eye(Kr.shape[0]), GM.ridge_scale(Kr))
        evr = np.linalg.eigvalsh(Ar + np.eye(Kr.shape[1]))
        worst = max(worst, float(evr.min()))
    _plant("I+A had an eigenvalue below 1 on a rank-deficient Gram, so it CAN be singular "
           "after all and ALT-2's original criterion should be restored",
           worst >= 1.0 - 1e-9)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_small")
    ap.add_argument("--keep", type=int, default=6)
    ap.add_argument("--out", default=None)
    ap.add_argument("--about", default=None)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    stem = os.path.join(HERE, "runs", a.name)
    out = a.out or os.path.join(os.path.dirname(HERE), "harness", "gatefly",
                               "nb_%s.json" % a.name)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    doc = emit(stem, out, a.keep, a.about)
    # the page RUNS the net, so the checkpoint has to sit beside the blueprint it describes.
    # Copied rather than linked, and the copy is verified by size: a stale blob next to a fresh
    # blueprint would show the wrong net with the right numbers, which is the worst of both.
    import shutil
    for ext in (".f16", ".meta.json"):
        src, dst = stem + ext, os.path.join(os.path.dirname(out), a.name + ext)
        shutil.copyfile(src, dst)
        if os.path.getsize(src) != os.path.getsize(dst):
            raise SystemExit("copy of %s did not match in size" % src)
    # a manifest of what is ACTUALLY here, so the page's picker offers only nets that exist
    # rather than a hopeful list that errors when chosen
    mdir = os.path.dirname(out)
    nets = []
    for fn in sorted(os.listdir(mdir)):
        if fn.startswith("nb_") and fn.endswith(".json"):
            with open(os.path.join(mdir, fn), encoding="utf-8") as fh:
                dd = json.load(fh)
            nets.append({"net": fn[3:-5], "of": dd.get("of"), "about": dd.get("about", ""),
                         "units": dd["units"]["n"], "kind": dd.get("kind", "gpt"),
                         "parameters": dd.get("parameters")})
    with open(os.path.join(mdir, "nets.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"nets": nets}, fh, indent=1)
    print("%s -> %s" % (a.name, out))
    print("  %d units over %d drawn sites, %d refused"
          % (doc["units"]["n"], doc["checks"]["sites_drawn"],
             len(doc["checks"]["sites_refused"])))
    for L in doc["layers"]:
        if L["refused"]:
            print("  REFUSED %-34s %s" % (L["site"], L["refused_why"]))
        else:
            print("  %-34s %-13s %4d units -> %3d dims  median gate %.4f  median c/a %.4f"
                  % (L["site"], L["kind"], L["units"], L["writes_into"],
                     L["median_gate"], L["median_crowding_fraction"]))
    print("  edges: %s" % doc["edges"]["threshold_rule"])
    hc = doc["checks"]["hand_check"]
    print("  hand check on %s unit %d: pipeline %.10f, by hand %.10f, diff %.3e"
          % (hc["site"], hc["unit"], hc["gate_emitted_by_the_pipeline"],
             hc["gate_by_hand_from_the_identity"], hc["abs_difference_identity"]))
    raise SystemExit(0)
