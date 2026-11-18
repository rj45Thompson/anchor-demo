"""Pong: the game, and a net that plays it (UC-GF-6 step 3).

    py -X utf8 -I gatefly/pong.py --train
    py -X utf8 -I gatefly/pong.py --selftest

THE GAME is deterministic and exactly specified, so "it plays" can be measured rather than
asserted: a ball with integer-free float position, two paddles, unit-time steps, and a serve
whose angle comes from a seeded generator. No frame timing is involved - a step is a step - so
the Python measurement and the browser's are the same game, and the browser's can be checked
against it.

THE NET is a small MLP, not a GPT, and the reason is worth stating rather than defaulting to:
pong's input is a FIXED 6-number state, not a sequence, so a causal transformer over a
transcript would be the wrong shape and its attention would have nothing to attend to. The gate
arithmetic does not care - it reads the columns of each weight matrix either way - and the
flythrough's format carries both, which is the point of UC-GF-6.

THE TEACHER is the exact interception point: where the ball will cross the paddle's x, computed
by reflecting the trajectory off the walls. That is a closed-form oracle, like tic-tac-toe's
minimax, so the net's play has something exact to be scored against.
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

W, H = 1.0, 1.0            # the court, in units
PAD = 0.18                 # paddle half-height... (full height 2*PAD would overfill; see below)
PAD_H = 0.16               # paddle HALF height
PAD_X = 0.04               # how far the paddles sit from each wall
PAD_V = 0.035              # how far a paddle may move in one step
BALL_V = 0.028             # the ball's speed per step
OUT = os.path.join(HERE, "runs")


class Pong:
    """State: ball (x, y), ball velocity (vx, vy), left paddle y, right paddle y."""

    def __init__(self, seed=0):
        self.rng = np.random.default_rng(seed)
        self.reset(+1)
        self.score = [0, 0]
        self.rally = 0

    def reset(self, towards):
        self.bx, self.by = 0.5, float(self.rng.uniform(0.25, 0.75))
        ang = float(self.rng.uniform(-0.55, 0.55))
        self.vx = towards * BALL_V * math.cos(ang)
        self.vy = BALL_V * math.sin(ang)
        self.ly = self.ry = 0.5
        self.rally = 0

    def state(self, side):
        """Six numbers, from `side`'s point of view (side = +1 right, -1 left), so one net
        plays both ends and a result is about the net and not about which end it was given."""
        bx, vx = (self.bx, self.vx) if side > 0 else (W - self.bx, -self.vx)
        me, you = (self.ry, self.ly) if side > 0 else (self.ly, self.ry)
        return [bx, self.by, vx / BALL_V, self.vy / BALL_V, me, you]

    def predict_y(self, side):
        """THE ORACLE: where the ball will cross this paddle's x, after any wall bounces.

        Closed form by reflection, not by simulation, so it is an independent answer and not
        the same loop wearing a different name.
        """
        px = W - PAD_X if side > 0 else PAD_X
        if (side > 0 and self.vx <= 0) or (side < 0 and self.vx >= 0):
            return self.by            # the ball is going away; hold station
        t = (px - self.bx) / self.vx
        y = self.by + self.vy * t
        # fold y into [0, H] by reflection
        period = 2 * H
        y = math.fmod(y, period)
        if y < 0:
            y += period
        return y if y <= H else period - y

    def step(self, left_dy, right_dy):
        """-> 'alive' | 'left_scored' | 'right_scored'."""
        self.ly = min(H - PAD_H, max(PAD_H, self.ly + max(-PAD_V, min(PAD_V, left_dy))))
        self.ry = min(H - PAD_H, max(PAD_H, self.ry + max(-PAD_V, min(PAD_V, right_dy))))
        self.bx += self.vx
        self.by += self.vy
        if self.by < 0:
            self.by = -self.by
            self.vy = -self.vy
        elif self.by > H:
            self.by = 2 * H - self.by
            self.vy = -self.vy
        if self.bx <= PAD_X and self.vx < 0:
            if abs(self.by - self.ly) <= PAD_H:
                self.bx = PAD_X + (PAD_X - self.bx)
                self.vx = -self.vx
                self.vy += (self.by - self.ly) / PAD_H * BALL_V * 0.35
                self._renorm()
                self.rally += 1
            else:
                self.score[1] += 1
                return "right_scored"
        if self.bx >= W - PAD_X and self.vx > 0:
            if abs(self.by - self.ry) <= PAD_H:
                self.bx = (W - PAD_X) - (self.bx - (W - PAD_X))
                self.vx = -self.vx
                self.vy += (self.by - self.ry) / PAD_H * BALL_V * 0.35
                self._renorm()
                self.rally += 1
            else:
                self.score[0] += 1
                return "left_scored"
        return "alive"

    def _renorm(self):
        """Keep the speed constant so a rally cannot drift into an unplayable regime, and keep
        |vx| above a floor so the ball always makes progress across the court."""
        s = math.hypot(self.vx, self.vy)
        if s > 0:
            self.vx *= BALL_V / s
            self.vy *= BALL_V / s
        if abs(self.vx) < BALL_V * 0.35:
            self.vx = math.copysign(BALL_V * 0.35, self.vx)
            self.vy = math.copysign(math.sqrt(max(0.0, BALL_V ** 2 - self.vx ** 2)), self.vy)


def oracle_dy(g, side):
    want = g.predict_y(side)
    me = g.ry if side > 0 else g.ly
    return max(-PAD_V, min(PAD_V, want - me))


def dataset(n_games=1200, seed=11):
    """States paired with the oracle's move, over games the ORACLE plays against a weaker
    opponent - so the distribution the net trains on is the one it will meet."""
    rng = np.random.default_rng(seed)
    X, Y = [], []
    for gi in range(n_games):
        g = Pong(seed=int(rng.integers(0, 2 ** 31)))
        lag = float(rng.uniform(0.3, 1.0))        # the opponent's competence, varied
        for _ in range(900):
            X.append(g.state(+1))
            Y.append(oracle_dy(g, +1) / PAD_V)    # the label, in units of the move limit
            r = oracle_dy(g, +1)
            l = oracle_dy(g, -1) * lag
            s = g.step(l, r)
            if s != "alive":
                g.reset(+1 if s == "left_scored" else -1)
    return np.array(X, dtype=np.float32), np.array(Y, dtype=np.float32).reshape(-1, 1)


class MLP:
    """A plain MLP held as numpy arrays, so the same weights drive torch training, the Python
    measurement and the browser - one set of numbers, three readers."""

    def __init__(self, sizes):
        self.sizes = sizes
        self.W = []
        self.b = []

    def forward(self, x):
        h = x
        for i, (Wm, bb) in enumerate(zip(self.W, self.b)):
            h = h @ Wm.T + bb
            if i < len(self.W) - 1:
                h = np.maximum(0, h)
        return h


def train(hidden=(64, 64), epochs=14, seed=5):
    import torch
    import torch.nn as nn
    X, Y = dataset()
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(seed)
    sizes = [X.shape[1]] + list(hidden) + [1]
    layers = []
    for i in range(len(sizes) - 1):
        layers.append(nn.Linear(sizes[i], sizes[i + 1]))
        if i < len(sizes) - 2:
            layers.append(nn.ReLU())
    net = nn.Sequential(*layers).to(dev)
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
    xt = torch.tensor(X, device=dev)
    yt = torch.tensor(Y, device=dev)
    n = xt.shape[0]
    for ep in range(epochs):
        perm = torch.randperm(n, device=dev)
        tot = 0.0
        nb = 0
        for i in range(0, n - 1023, 1024):
            sl = perm[i:i + 1024]
            loss = ((net(xt[sl]) - yt[sl]) ** 2).mean()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            tot += float(loss)
            nb += 1
        print("  epoch %2d  mse %.6f" % (ep + 1, tot / max(1, nb)))
    m = MLP(sizes)
    for mod in net:
        if isinstance(mod, nn.Linear):
            m.W.append(mod.weight.detach().cpu().numpy().astype(np.float64))
            m.b.append(mod.bias.detach().cpu().numpy().astype(np.float64))
    return m, sizes


def save(m, sizes, stem, extra=None):
    """The same priorgpt-shaped checkpoint: one flat f16 blob plus an index in ELEMENTS."""
    blob, index, off = [], [], 0
    for i, (Wm, bb) in enumerate(zip(m.W, m.b)):
        for nm, t in (("layers.%d.weight" % i, Wm), ("layers.%d.bias" % i, bb)):
            index.append({"name": nm, "shape": list(t.shape), "offset": off,
                          "count": int(t.size)})
            blob.append(t.reshape(-1).astype(np.float16))
            off += int(t.size)
    arr = np.concatenate(blob)
    with open(stem + ".f16", "wb") as f:
        arr.tofile(f)
    meta = {"format": "priorgpt f16 blob + element offsets",
            "kind": "mlp", "sizes": sizes,
            "parameters": int(sum(w.size for w in m.W) + sum(b.size for b in m.b)),
            "elements": int(arr.size), "weights": index,
            "hyper": {"sizes": sizes, "kind": "mlp"}}
    if extra:
        meta.update(extra)
    with open(stem + ".meta.json", "w", encoding="utf-8", newline="\n") as f:
        json.dump(meta, f, indent=1)
    return meta


def load(stem):
    with open(stem + ".meta.json", encoding="utf-8") as f:
        meta = json.load(f)
    arr = np.fromfile(stem + ".f16", dtype=np.float16)
    m = MLP(meta["sizes"])
    by = {t["name"]: arr[t["offset"]:t["offset"] + t["count"]].astype(np.float64).reshape(t["shape"])
          for t in meta["weights"]}
    i = 0
    while ("layers.%d.weight" % i) in by:
        m.W.append(by["layers.%d.weight" % i])
        m.b.append(by["layers.%d.bias" % i])
        i += 1
    return m, meta


def measure(m, games=120, steps=4000, seed=77, opponent="oracle"):
    """UC-GF-6 step 3's observable: rallies and score against a scripted opponent."""
    rng = np.random.default_rng(seed)
    rallies, scores_for, scores_against, lens = [], 0, 0, []
    for _ in range(games):
        g = Pong(seed=int(rng.integers(0, 2 ** 31)))
        best = 0
        for t in range(steps):
            dy = float(m.forward(np.array([g.state(+1)]))[0, 0]) * PAD_V
            if opponent == "oracle":
                l = oracle_dy(g, -1)
            elif opponent == "lagging":
                l = oracle_dy(g, -1) * 0.6
            else:
                l = float(rng.uniform(-PAD_V, PAD_V))
            s = g.step(l, max(-PAD_V, min(PAD_V, dy)))
            best = max(best, g.rally)
            if s != "alive":
                if s == "right_scored":
                    scores_for += 1
                else:
                    scores_against += 1
                lens.append(t)
                break
        rallies.append(best)
    return {"games": games, "opponent": opponent,
            "median_rally": float(np.median(rallies)), "mean_rally": float(np.mean(rallies)),
            "max_rally": int(np.max(rallies)),
            "net_scored": scores_for, "net_conceded": scores_against,
            "survived_all_steps": int(games - len(lens))}


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. THE ORACLE must actually intercept: a paddle driven by predict_y never concedes.
    g = Pong(seed=1)
    conceded = 0
    for _ in range(20000):
        s = g.step(oracle_dy(g, -1), oracle_dy(g, +1))
        if s != "alive":
            conceded += 1
            g.reset(+1)
    _plant("the oracle conceded %d times in 20000 steps - predict_y is wrong" % conceded,
           conceded == 0)
    print("  two oracles rallied 20000 steps without conceding")

    # 2. NEGATIVE CONTROL: a paddle that does NOTHING must concede, or the game is unloseable
    #    and every later rally figure is meaningless.
    g = Pong(seed=2)
    lost = 0
    for _ in range(20000):
        s = g.step(oracle_dy(g, -1), 0.0)
        if s != "alive":
            lost += 1
            g.reset(+1)
    _plant("a motionless paddle never conceded - the game cannot be lost", lost > 0)
    print("  a motionless paddle concedes %d times in 20000 steps" % lost)

    # 3. the ball stays in the court and its speed stays constant.
    g = Pong(seed=3)
    bad = 0
    speeds = []
    for _ in range(8000):
        if g.step(oracle_dy(g, -1), oracle_dy(g, +1)) != "alive":
            g.reset(+1)
        if not (-0.02 <= g.by <= H + 0.02):
            bad += 1
        speeds.append(math.hypot(g.vx, g.vy))
    _plant("the ball left the court %d times" % bad, bad == 0)
    _plant("the ball's speed is not constant (%.5f to %.5f)" % (min(speeds), max(speeds)),
           max(speeds) - min(speeds) < 1e-9)

    # 4. predict_y is an INDEPENDENT answer: check it against simulating the ball forward with
    #    the paddles frozen. If these two ever disagree, one of them is wrong.
    worst = 0.0
    for sd in range(40):
        g = Pong(seed=100 + sd)
        if g.vx <= 0:
            continue
        want = g.predict_y(+1)
        sim = Pong(seed=100 + sd)
        for _ in range(4000):
            sim.bx += sim.vx
            sim.by += sim.vy
            if sim.by < 0:
                sim.by = -sim.by
                sim.vy = -sim.vy
            elif sim.by > H:
                sim.by = 2 * H - sim.by
                sim.vy = -sim.vy
            if sim.bx >= W - PAD_X:
                break
        worst = max(worst, abs(want - sim.by))
    _plant("the closed-form interception disagrees with simulating it (%.4f)" % worst,
           worst < 0.05)
    print("  closed-form interception agrees with simulation to %.4f" % worst)

    # 5. the seat mirror: state(+1) and state(-1) must describe the same moment from two ends.
    g = Pong(seed=5)
    a, b = g.state(+1), g.state(-1)
    _plant("the two seats are not mirror images",
           abs(a[0] - (W - b[0])) < 1e-12 and abs(a[2] + b[2]) < 1e-12)

    # 6. the dataset's labels are inside the move limit, by construction, and vary.
    X, Y = dataset(n_games=6)
    _plant("a label exceeds the move limit", float(np.abs(Y).max()) <= 1.0 + 1e-9)
    _plant("the labels are all the same - the teacher is not teaching", float(Y.std()) > 0.01)
    print("  dataset %s states, label sd %.4f" % (X.shape, float(Y.std())))

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", action="store_true")
    ap.add_argument("--name", default="pong")
    ap.add_argument("--hidden", default="64,64")
    ap.add_argument("--epochs", type=int, default=14)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.train:
        hid = tuple(int(x) for x in a.hidden.split(","))
        m, sizes = train(hid, a.epochs)
        os.makedirs(OUT, exist_ok=True)
        res = {op: measure(m, opponent=op) for op in ("oracle", "lagging", "random")}
        meta = save(m, sizes, os.path.join(OUT, a.name),
                    extra={"trained_by": "gatefly/pong.py", "play": res})
        print("%s: %d params, sizes %s" % (a.name, meta["parameters"], sizes))
        for op, r in res.items():
            print("  vs %-8s median rally %5.1f  mean %6.2f  max %4d  scored %3d  conceded %3d"
                  % (op, r["median_rally"], r["mean_rally"], r["max_rally"],
                     r["net_scored"], r["net_conceded"]))
        raise SystemExit(0)
    raise SystemExit(selftest())
