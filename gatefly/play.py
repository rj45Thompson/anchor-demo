"""Play a trained net against a PERFECT opponent and against a random one (UC-GF-1 step 3).

    py -X utf8 -I gatefly/play.py --name ttt_small --games 1000
    py -X utf8 -I gatefly/play.py --selftest

REQ-GF-1b: the net's move is its ARGMAX over the whole vocabulary. If that is BOS or an occupied
cell it is an ILLEGAL MOVE: counted, the game scored a loss, and the game stopped. Nothing is
re-sampled and nothing is masked to the legal set, because masking would measure a wrapper.

REQ-GF-1c: both seats are played and reported separately.

A PERFECT opponent is deterministic, so against it the net's play is deterministic too and ONE
game per seat is the whole measurement; playing it 1000 times would print a fake sample size.
That is why the perfect-opponent table reports 1 game per seat and the random-opponent table
reports many. The deterministic case is instead broadened the honest way: every opening the
perfect opponent could legally choose is played (`--perfect-openings`), which is a real sweep
rather than a repeated one.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import data_ttt as D
import net as N
import ttt


class NetPlayer:
    """Picks argmax over the whole vocabulary from the move-sequence transcript."""

    def __init__(self, model, device="cpu"):
        self.m = model
        self.dev = device

    def move(self, moves):
        x = torch.full((1, D.BLOCK), D.BOS, dtype=torch.long, device=self.dev)
        for j, mv in enumerate(moves):
            x[0, 1 + j] = mv
        with torch.no_grad():
            lg = self.m(x)[0, len(moves)]
        return int(lg.argmax())


def perfect_move(board, rng=None):
    opt = ttt.optimal_moves(board)
    return opt[0] if rng is None else rng.choice(opt)


def one_game(player, seat, opponent, rng=None, opening=None):
    """-> (result, illegal, moves). seat is 1 (moves first) or 2."""
    board = ttt.EMPTY
    moves = []
    if opening is not None:
        board = ttt.play(board, opening)
        moves.append(opening)
    while not ttt.over(board):
        if ttt.turn(board) == seat:
            mv = player.move(moves)
            if mv >= 9 or board[mv] != 0:
                return "loss", 1, moves + [mv]
        else:
            mv = opponent(board, rng)
        board = ttt.play(board, mv)
        moves.append(mv)
    return ttt.result_for(board, seat), 0, moves


def random_move(board, rng):
    return rng.choice(ttt.legal(board))


def table(player, opponent, seats=(1, 2), games=1, rng=None, openings=None):
    out = {}
    for seat in seats:
        rec = {"win": 0, "draw": 0, "loss": 0, "illegal": 0, "games": 0,
               "should_not_lose": 0, "lost_a_drawable_game": 0}
        plays = []
        if openings is not None and seat == 2:
            plays = [(o,) for o in openings]
        else:
            plays = [(None,)] * games
        for (op,) in plays:
            # what the position is WORTH to the net before it moves: with perfect play by both,
            # tic-tac-toe is a draw, so any loss is a loss of a drawable game.
            res, ill, mv = one_game(player, seat, opponent, rng, op)
            rec[res] += 1
            rec["illegal"] += ill
            rec["games"] += 1
            rec["should_not_lose"] += 1
            if res == "loss":
                rec["lost_a_drawable_game"] += 1
        out["seat_%d" % seat] = rec
    return out


def measure(model, device="cpu", random_games=500, seed=7):
    """The whole UC-GF-1 step 3 observable."""
    p = NetPlayer(model, device)
    res = {}

    # against PERFECT play. Deterministic on both sides, so one game per seat - plus the sweep
    # over every legal first move the perfect opponent could make when the net moves second.
    res["vs_perfect"] = table(p, perfect_move, seats=(1, 2), games=1,
                              openings=list(ttt.optimal_moves(ttt.EMPTY)))
    # the full opening sweep for seat 2 against EVERY legal opening, not only the optimal ones:
    # a perfect opponent would not play these, so they are labelled as a separate sweep.
    res["vs_perfect_any_opening_seat2"] = table(p, perfect_move, seats=(2,),
                                                openings=list(range(9)))
    rng = random.Random(seed)
    res["vs_random"] = table(p, random_move, seats=(1, 2), games=random_games, rng=rng)
    return res


def fmt(res):
    L = []
    for arm, seats in res.items():
        for seat, r in seats.items():
            L.append("  %-32s %-7s  W %-4d D %-4d L %-4d  illegal %-3d  of %d games"
                     % (arm, seat, r["win"], r["draw"], r["loss"], r["illegal"], r["games"]))
    return "\n".join(L)


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. UC-GF-1 step 1's observable: two perfect players draw, 1000 times, with the opponent
    #    choosing randomly among its optimal moves so the 1000 games are not one game repeated.
    rng = random.Random(1)

    class Perfect:
        def move(self, moves):
            b = ttt.EMPTY
            for m in moves:
                b = ttt.play(b, m)
            return rng.choice(ttt.optimal_moves(b))

    draws = 0
    distinct = set()
    for _ in range(1000):
        r, ill, mv = one_game(Perfect(), 1, lambda b, g: rng.choice(ttt.optimal_moves(b)), rng)
        draws += (r == "draw")
        distinct.add(tuple(mv))
    _plant("two perfect players did not draw 1000 of 1000: %d" % draws, draws == 1000)
    _plant("the 1000 perfect games were all the same game, so the count is theatre: %d distinct"
           % len(distinct), len(distinct) > 1)
    print("  %d distinct perfectly-played games out of 1000" % len(distinct))

    # 2. A DELIBERATELY ILLEGAL player must be caught and scored a loss, never re-sampled.
    class Always0:
        def move(self, moves):
            return 0

    r2, ill2, mv2 = one_game(Always0(), 2, perfect_move, rng, opening=0)
    _plant("an illegal move was not counted", ill2 == 1 and r2 == "loss")
    # Always0 moving FIRST is legal once and illegal on its second move, which is itself the
    # check that the detector looks at the board and not only at the first ply.
    r1, ill1, mv1 = one_game(Always0(), 1, perfect_move, rng)
    _plant("an occupied cell was not caught on a LATER ply", ill1 == 1 and len(mv1) > 1)

    # and a player that always takes the first LEGAL cell must never be flagged: the detector
    # must not simply call every repeated player illegal.
    class FirstLegal:
        def move(self, moves):
            b = ttt.EMPTY
            for m in moves:
                b = ttt.play(b, m)
            return ttt.legal(b)[0]

    il = sum(one_game(FirstLegal(), s, perfect_move, rng)[1] for s in (1, 2))
    _plant("a always-legal player was flagged illegal", il == 0)

    # 3. A player that always says BOS is illegal immediately.
    class Bos:
        def move(self, moves):
            return 9

    r3, ill3, _ = one_game(Bos(), 1, perfect_move, rng)
    _plant("BOS as a move was not counted illegal", ill3 == 1 and r3 == "loss")

    # 4. A RANDOM player must lose to perfect play at least sometimes - otherwise the opponent
    #    is not perfect and every later "did not lose" verdict is vacuous.
    class Rand:
        def move(self, moves):
            b = ttt.EMPTY
            for m in moves:
                b = ttt.play(b, m)
            return rng.choice(ttt.legal(b))

    losses = sum(one_game(Rand(), 1, perfect_move, rng)[0] == "loss" for _ in range(200))
    _plant("a random player never lost to the 'perfect' opponent in 200 games - the opponent "
           "is not perfect", losses > 0)
    print("  a random player loses %d of 200 games to the perfect opponent" % losses)

    # 5. and a random player must NOT beat perfect play even once. If it does, the opponent is
    #    not perfect in the other direction either.
    wins = sum(one_game(Rand(), 1, perfect_move, rng)[0] == "win" for _ in range(500))
    _plant("a random player BEAT the perfect opponent %d times in 500" % wins, wins == 0)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_small")
    ap.add_argument("--games", type=int, default=500)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    dev = "cuda" if torch.cuda.is_available() and not a.cpu else "cpu"
    stem = os.path.join(HERE, "runs", a.name)
    model, meta = N.load(stem, dev)
    res = measure(model, dev, a.games)
    d = D.load()
    import train_ttt as T
    rate, ill, n = T.optimal_rate(model, d, dev)
    print("%s: %d params" % (a.name, meta["parameters"]))
    print("  optimal move on %.4f of %d distinct live positions, %d illegal argmax"
          % (rate, n, ill))
    print(fmt(res))
    out = os.path.join(HERE, "runs", a.name + ".play.json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"name": a.name, "params": meta["parameters"],
                   "optimal_rate_all_positions": rate, "illegal_argmax": ill,
                   "positions": n, "play": res}, f, indent=1)
    print("wrote " + out)
