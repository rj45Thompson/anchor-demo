"""Train a nanoGPT to play tic-tac-toe (UC-GF-1 step 2, UC-GF-3 steps 1 and 3).

    py -X utf8 -I gatefly/train_ttt.py --name small --layers 2 --heads 2 --embed 32 --epochs 30
    py -X utf8 -I gatefly/train_ttt.py --selftest

The loss is cross-entropy against the UNIFORM DISTRIBUTION OVER OPTIMAL MOVES at each step, so
correct play against a position with several best moves is not marked wrong. Padding steps are
masked. The vocabulary includes BOS, and nothing stops the net putting mass on BOS or on an
occupied cell - that is an illegal move and REQ-GF-1b says it is counted, never masked away.

--rows is the retraining hook used by UC-GF-3: a file of prefix indices to train on, with
everything else held out. That is the v4 lane's method - retrain the identified set - and not a
weight edit.
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

import data_ttt as D
import net as N

OUT = os.path.join(HERE, "runs")


def bits_of(mask_i16, device):
    """int16 bitmask -> (..., 9) float of 0/1."""
    m = torch.as_tensor(mask_i16.astype(np.int32), device=device)
    sh = torch.arange(9, device=device)
    return ((m.unsqueeze(-1) >> sh) & 1).float()


def soft_ce(logits, bits, mask):
    """-sum_m (1/|opt|) log p(m), averaged over the masked steps. logits are over the whole
    vocabulary; only the 9 cell columns carry target mass, which is what lets the net lose
    probability to BOS and be caught for it later."""
    logp = F.log_softmax(logits.float(), dim=-1)[..., :9]
    cnt = bits.sum(-1).clamp(min=1.0)
    per = -(bits * logp).sum(-1) / cnt
    return (per * mask.float()).sum() / mask.float().sum().clamp(min=1.0)


def optimal_rate(model, d, device, batch=8192):
    """The fraction of the 294,778 DISTINCT live prefixes where the net's argmax over the whole
    vocabulary is an optimal move. Deduped, so a position is one observation however many games
    reach it (REQ-GF-3b). Also returns the illegal-argmax count."""
    model.eval()
    pre = torch.as_tensor(d["prefix"].astype(np.int64))
    plen = torch.as_tensor(d["plen"].astype(np.int64))
    popt = d["popt"]
    board = d["pboard"]
    ok = 0
    illegal = 0
    n = pre.shape[0]
    with torch.no_grad():
        for i in range(0, n, batch):
            x = pre[i:i + batch].to(device)
            L = plen[i:i + batch].to(device)
            lg = model(x)
            at = lg[torch.arange(x.shape[0], device=device), L]       # logits AFTER the prefix
            pick = at.argmax(-1).cpu().numpy()
            opt = popt[i:i + batch]
            bd = board[i:i + batch]
            good = np.array([(int(p) < 9) and ((int(o) >> int(p)) & 1) == 1
                             for p, o in zip(pick, opt)])
            bad = np.array([(int(p) >= 9) or (bd[j, int(p)] != 0)
                            for j, p in enumerate(pick)])
            ok += int(good.sum())
            illegal += int(bad.sum())
    return ok / n, illegal, n


def train(args):
    dev = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    d = D.load()
    torch.manual_seed(args.seed)

    games = torch.as_tensor(d["games"].astype(np.int64))
    gmask = torch.as_tensor(d["gmask"])
    gopt = d["gopt"]

    if args.rows:
        with open(args.rows, encoding="utf-8") as f:
            sel = json.load(f)
        idx = np.array(sel["game_rows"], dtype=np.int64)
        if idx.size == 0:
            raise SystemExit("--rows gave an empty selection; refusing to train on nothing")
        games, gmask, gopt = games[idx], gmask[idx], gopt[idx]
        print("retraining on %d of %d games, from %s" % (idx.size, d["games"].shape[0], args.rows))

    Nrows = games.shape[0]
    model = N.GPT(D.VOCAB, D.BLOCK, args.embed, args.heads, args.layers, args.dropout).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    if args.init:
        base, _ = N.load(args.init, dev)
        model.load_state_dict(base.state_dict(), strict=False)
        print("initialised from %s" % args.init)

    steps = max(1, (Nrows // args.batch)) * args.epochs
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps,
                                                pct_start=0.15)
    gpu_opt = bits_of(gopt, dev)
    gx = games.to(dev)
    gm = gmask.to(dev)
    print("%s: %d params, %d rows, %d steps on %s"
          % (args.name, model.n_params(), Nrows, steps, dev))

    t0 = time.time()
    hist = []
    step = 0
    for ep in range(args.epochs):
        model.train()
        perm = torch.randperm(Nrows, device=dev)
        tot, nb = 0.0, 0
        for i in range(0, Nrows - args.batch + 1, args.batch):
            sl = perm[i:i + args.batch]
            x = gx[sl]
            lg = model(x)[:, :9]              # position t predicts move t
            loss = soft_ce(lg, gpu_opt[sl], gm[sl])
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            step += 1
            tot += float(loss)
            nb += 1
        rate, ill, tot_pre = optimal_rate(model, d, dev)
        hist.append({"epoch": ep + 1, "loss": tot / max(1, nb), "optimal_rate": rate,
                     "illegal_argmax": ill})
        print("  epoch %2d  loss %.4f  optimal on %.4f of %d prefixes  illegal argmax %d"
              % (ep + 1, tot / max(1, nb), rate, tot_pre, ill))

    os.makedirs(OUT, exist_ok=True)
    stem = os.path.join(OUT, args.name)
    meta = N.save(model, stem, extra={
        "trained_by": "gatefly/train_ttt.py",
        "args": vars(args),
        "rows_trained": int(Nrows),
        "seconds": round(time.time() - t0, 1),
        "history": hist,
        "final_optimal_rate_on_all_prefixes": hist[-1]["optimal_rate"],
        "final_illegal_argmax": hist[-1]["illegal_argmax"],
        "device": dev,
    })
    print("wrote %s.f16 (%d params, %.1f s)" % (stem, meta["parameters"], time.time() - t0))
    return 0


def selftest() -> int:
    """Plants on the loss and the measurement, not on the training run."""
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    dev = "cpu"
    # 1. soft_ce on a PERFECT prediction over a 2-move optimal set is log 2, not 0: putting all
    #    the mass on one of two optimal moves is not free under this loss, and putting half on
    #    each is the minimum. Fails if the loss is written against a single hard target.
    bits = torch.zeros(1, 1, 9)
    bits[0, 0, 3] = 1
    bits[0, 0, 5] = 1
    mask = torch.ones(1, 1, dtype=torch.bool)
    half = torch.full((1, 1, 10), -1e9)
    half[0, 0, 3] = 0.0
    half[0, 0, 5] = 0.0
    both = float(soft_ce(half, bits, mask))
    one = torch.full((1, 1, 10), -1e9)
    one[0, 0, 3] = 0.0
    single = float(soft_ce(one, bits, mask))
    _plant("splitting mass over the two optimal moves is not the minimum (%.4f vs %.4f)"
           % (both, single), both < single)
    _plant("the minimum of this loss on a 2-move set is not log 2 (%.6f)" % both,
           abs(both - np.log(2)) < 1e-4)

    # 2. the mask must switch a step off: scoring a masked step would train on padding.
    m0 = torch.zeros(1, 1, dtype=torch.bool)
    _plant("a fully masked batch does not give zero loss", float(soft_ce(one, bits, m0)) == 0.0)

    # 3. optimal_rate on a PERFECT oracle must be 1.0 with no illegal moves, and on a net that
    #    always answers BOS must be 0.0 with every move illegal. Two ends, so the measurement is
    #    known to span the range rather than merely return a plausible number.
    d = D.load()

    class Oracle(torch.nn.Module):
        def forward(self, x):
            B, T = x.shape
            out = torch.zeros(B, T + 1, 10)
            import ttt as T_
            for b in range(B):
                board = T_.EMPTY
                for t in range(1, T):
                    v = int(x[b, t])
                    if v < 9 and board[v] == 0 and not T_.over(board):
                        board = T_.play(board, v)
                    else:
                        break
                    opt = T_.optimal_moves(board)
                    if opt:
                        out[b, t, list(opt)] = 10.0
                opt0 = T_.optimal_moves(T_.EMPTY)
                out[b, 0, list(opt0)] = 10.0
            return out[:, :T]

    class Mute(torch.nn.Module):
        def forward(self, x):
            out = torch.zeros(x.shape[0], x.shape[1], 10)
            out[..., 9] = 10.0
            return out

    sub = {k: v[:4000] for k, v in d.items() if k in ("prefix", "plen", "popt", "pboard")}
    r1, i1, n1 = optimal_rate(Oracle(), sub, dev, batch=512)
    r0, i0, n0 = optimal_rate(Mute(), sub, dev, batch=512)
    _plant("the oracle does not score 1.0 (%.4f, %d illegal)" % (r1, i1), r1 == 1.0 and i1 == 0)
    _plant("a net that only says BOS does not score 0.0 with every move illegal (%.4f, %d/%d)"
           % (r0, i0, n0), r0 == 0.0 and i0 == n0)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_small")
    ap.add_argument("--layers", type=int, default=2)
    ap.add_argument("--heads", type=int, default=2)
    ap.add_argument("--embed", type=int, default=32)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--wd", type=float, default=0.01)
    ap.add_argument("--dropout", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=23)
    ap.add_argument("--rows", default=None, help="json with game_rows: retrain that set only")
    ap.add_argument("--init", default=None, help="checkpoint stem to start from")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    raise SystemExit(selftest() if a.selftest else train(a))
