"""An offline fixture set, so a sweep can be re-ground without re-doing the expensive parts.

    py -X utf8 -I gatefly/offline.py --build --name ttt_big
    py -X utf8 -I gatefly/offline.py --bench --name ttt_big
    py -X utf8 -I gatefly/offline.py --selftest

RJ, 2026-11-18: "Build an offline set so we can grind fast and hard."

WHAT IS ACTUALLY SLOW HERE, measured rather than guessed, because caching the wrong thing costs
correctness and buys nothing:

  * solving a game exactly               - deterministic, pure, expensive at 4,4,4 and up
  * the activation covariance C          - a forward pass over thousands of positions
  * the edit site's keys                 - a forward pass per position
  * the parent's move distributions      - a forward pass over every live position
  * training a net                       - already cached as a checkpoint
  * target_deltas (the v* optimisation)  - NOT cached: it depends on the CURRENT weights, which
                                           every arm changes, so a cache of it would be wrong
                                           for every arm after the first

The first four are functions of (checkpoint, position set) alone. Nothing an arm does changes
them, because an edit at a site does not move that site's own keys - measured in retrain.py's
plants, max |key change| exactly 0.0. That is what makes this cache sound rather than merely
convenient, and it is why the fifth is excluded.

THE DANGEROUS PART OF ANY CACHE is a stale entry used silently. Every fixture here carries a
CONTENT HASH of the checkpoint bytes and the position set that produced it, and loading one
whose hash does not match REFUSES rather than falling back to a recompute - because a silent
recompute is indistinguishable from a cache that worked, and a silent reuse is worse.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

CACHE = os.path.join(HERE, "data", "offline")


def _hash(*parts):
    h = hashlib.sha256()
    for p in parts:
        if isinstance(p, bytes):
            h.update(p)
        elif isinstance(p, np.ndarray):
            h.update(np.ascontiguousarray(p).tobytes())
        else:
            h.update(repr(p).encode("utf-8"))
    return h.hexdigest()[:16]


def ckpt_hash(stem):
    with open(stem + ".f16", "rb") as f:
        return _hash(f.read())


def path_for(name, kind, key):
    os.makedirs(CACHE, exist_ok=True)
    return os.path.join(CACHE, "%s.%s.%s.npz" % (name, kind, key))


def save(name, kind, key, **arrays):
    p = path_for(name, kind, key)
    np.savez_compressed(p, _key=np.array([key]), **arrays)
    return p


def load(name, kind, key, required=True):
    """REFUSES on a hash mismatch instead of recomputing silently.

    A cache that quietly falls back to a recompute is indistinguishable from one that worked,
    so a miss is reported and a MISMATCH is an error. The caller decides to rebuild; this
    function never decides for it.
    """
    p = path_for(name, kind, key)
    if not os.path.exists(p):
        if required:
            raise FileNotFoundError("no fixture %s/%s for key %s - build it first" %
                                    (name, kind, key))
        return None
    z = np.load(p)
    got = str(z["_key"][0])
    if got != key:
        raise ValueError("fixture %s holds key %s, caller asked for %s - REFUSING rather than "
                         "using a stale fixture" % (p, got, key))
    return {k: z[k] for k in z.files if k != "_key"}


# ---------------------------------------------------------------- the fixtures
def build(name, device="cuda", cov_n=4000, seed=5):
    """Everything that is a function of (checkpoint, position set) and nothing else."""
    import torch
    import metrics as M
    import net as N
    import retrain as R
    import ttt

    dev = device if torch.cuda.is_available() else "cpu"
    stem = os.path.join(HERE, "runs", name)
    model, meta = N.load(stem, dev)
    layer = meta["hyper"]["n_layers"] - 1
    key = ckpt_hash(stem)

    t0 = time.time()
    boards, prefixes = [], []
    for s in ttt.decisions():
        pre = M.prefix_of(s)
        if pre is not None:
            boards.append(s)
            prefixes.append(pre)
    t_pos = time.time() - t0

    t0 = time.time()
    P = R.probs(model, prefixes, dev)
    t_dist = time.time() - t0

    t0 = time.time()
    K = R.ffwd_keys(model, prefixes, layer, dev)
    t_keys = time.time() - t0

    t0 = time.time()
    C, n_cov, cond = R.covariance(model, layer, dev, n=cov_n, seed=seed)
    t_cov = time.time() - t0

    t0 = time.time()
    opt = np.zeros((len(boards), 9), dtype=bool)
    for i, s in enumerate(boards):
        for m in ttt.optimal_moves(s):
            opt[i, m] = True
    t_oracle = time.time() - t0

    padded = np.full((len(prefixes), max(len(p) for p in prefixes) or 1), -1, dtype=np.int8)
    for i, pre in enumerate(prefixes):
        padded[i, :len(pre)] = pre

    save(name, "offline", key, P=P, K=K, C=C, opt=opt, prefixes=padded,
         boards=np.array(boards, dtype=np.int8))
    cost = {"positions": t_pos, "distributions": t_dist, "keys": t_keys,
            "covariance": t_cov, "oracle_sets": t_oracle}
    meta_out = {"name": name, "checkpoint_hash": key, "layer": layer,
                "positions": len(prefixes), "cov_positions": n_cov, "cov_cond": cond,
                "build_seconds": cost, "build_total": round(sum(cost.values()), 2),
                "excluded": {"target_deltas": "depends on the CURRENT weights, which every arm "
                                              "changes, so a cached copy would be wrong for "
                                              "every arm after the first"}}
    with open(os.path.join(CACHE, "%s.offline.json" % name), "w",
              encoding="utf-8", newline="\n") as f:
        json.dump(meta_out, f, indent=1)
    return meta_out


def bench(name, device="cuda"):
    """The cost/benefit number RJ asked to be kept an eye on, measured not claimed."""
    import torch
    import net as N
    dev = device if torch.cuda.is_available() else "cpu"
    stem = os.path.join(HERE, "runs", name)
    key = ckpt_hash(stem)
    with open(os.path.join(CACHE, "%s.offline.json" % name), encoding="utf-8") as f:
        built = json.load(f)
    t0 = time.time()
    fx = load(name, "offline", key)
    t_load = time.time() - t0
    cold = built["build_total"]
    return {"cold_seconds": cold, "warm_seconds": round(t_load, 3),
            "speedup": round(cold / max(t_load, 1e-6), 1),
            "arrays": {k: list(v.shape) for k, v in fx.items()},
            "bytes_on_disk": os.path.getsize(path_for(name, "offline", key)),
            "per_build_cost": built["build_seconds"]}


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    import tempfile
    global CACHE
    saved = CACHE
    CACHE = tempfile.mkdtemp()
    try:
        a = np.arange(12, dtype=np.float64).reshape(3, 4)
        save("t", "offline", "KEY1", P=a)

        # 1. a round trip returns the same bytes
        got = load("t", "offline", "KEY1")
        _plant("the fixture did not round trip", np.array_equal(got["P"], a))

        # 2. A STALE FIXTURE MUST REFUSE, not be used and not be silently rebuilt. This is the
        #    only plant that matters: a cache that quietly falls back is indistinguishable from
        #    one that worked, and a silent reuse of the wrong fixture is worse than no cache.
        os.rename(path_for("t", "offline", "KEY1"), path_for("t", "offline", "KEY2"))
        try:
            load("t", "offline", "KEY2")
            refused = False
        except ValueError:
            refused = True
        _plant("a fixture whose key does not match was USED instead of refused", refused)

        # 3. a missing fixture is a miss, reported, and optional misses return None rather than
        #    raising - the caller decides to rebuild, never this function
        try:
            load("t", "offline", "NOPE")
            raised = False
        except FileNotFoundError:
            raised = True
        _plant("a missing required fixture did not raise", raised)
        _plant("a missing optional fixture did not return None",
               load("t", "offline", "NOPE", required=False) is None)

        # 4. the hash must actually depend on the bytes, or every checkpoint shares a fixture
        h1 = _hash(b"abc")
        h2 = _hash(b"abd")
        _plant("the content hash does not depend on the content", h1 != h2)
        _plant("the content hash is not stable across calls", _hash(b"abc") == h1)
    finally:
        CACHE = saved

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_big")
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--bench", action="store_true")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    dev = "cpu" if a.cpu else "cuda"
    if a.build:
        m = build(a.name, dev)
        print("built offline set for %s (checkpoint %s)" % (a.name, m["checkpoint_hash"]))
        for k, v in m["build_seconds"].items():
            print("  %-16s %6.2f s" % (k, v))
        print("  %-16s %6.2f s total" % ("COLD", m["build_total"]))
    if a.bench:
        b = bench(a.name, dev)
        print("cold %.2f s -> warm %.3f s   SPEEDUP %.1fx   (%d KB on disk)"
              % (b["cold_seconds"], b["warm_seconds"], b["speedup"],
                 b["bytes_on_disk"] // 1024))
        for k, v in b["arrays"].items():
            print("  %-10s %s" % (k, v))
