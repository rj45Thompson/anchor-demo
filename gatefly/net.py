"""A nanoGPT in priorgpt's own shape and checkpoint format (UC-GF-1 step 2).

    py -X utf8 -I gatefly/net.py --selftest

WHY NOT REUSE priorgpt's TRAINER. There is none in this repo to reuse: priorgpt's weights were
trained by a KAGGLE NOTEBOOK (`.opus-tools/priorgpt/kaggle/original.ipynb` and
`.opus-tools/priorgpt/chat/kaggle/*/notebook.ipynb`, from `ashtcoder/mingpt-shakespeare-andrej-
karpathy`) against Shakespeare, off this machine; what ships here is browser-side INFERENCE
(`priorgpt/core.js`) plus the weights. So what IS reused is the part that exists:

  * the MODEL SHAPE - Karpathy's lecture nanoGPT, with priorgpt's exact tensor NAMES
    (`token_embedding_table.weight`, `blocks.N.sa.heads.H.key.weight`, `blocks.N.ffwd.net.2`,
    `ln_f`, `lm_head`), read out of `priorgpt/data/meta.json` (174 tensors, 10,788,929 params);
  * the CHECKPOINT FORMAT - one flat float16 blob plus a `meta.json` index of
    {name, shape, offset, count}. A browser can load this net the same way it loads priorgpt.

THE GATE SITE. `blocks.N.ffwd.net.2.weight` is (n_embed, 4*n_embed): its COLUMNS are the
feed-forward neurons' write directions into the residual stream. That is the same object as
GPT-2's `mlp.c_proj` rows, which is the site the ratchet lane reads (`neuron_gates.py`), so the
transfer question asked in UC-GF-4 is about the same quantity at the same kind of site and not an
analogy. `blocks.N.sa.proj.weight` columns are the attention slots' write directions, read the
same way.
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
except ImportError as ex:                 # NO FALLBACK: this file cannot work without torch
    raise SystemExit("gatefly/net.py needs torch: %r" % (ex,))


# ---------------------------------------------------------------- the model
class Head(nn.Module):
    """One head of self-attention. Named as priorgpt names it: sa.heads.H.{key,query,value}."""

    def __init__(self, n_embed, head_size, block_size, dropout):
        super().__init__()
        self.key = nn.Linear(n_embed, head_size, bias=False)
        self.query = nn.Linear(n_embed, head_size, bias=False)
        self.value = nn.Linear(n_embed, head_size, bias=False)
        self.register_buffer("tril", torch.tril(torch.ones(block_size, block_size)))
        self.drop = nn.Dropout(dropout)

    def forward(self, x):
        B, T, C = x.shape
        k, q = self.key(x), self.query(x)
        w = q @ k.transpose(-2, -1) * k.shape[-1] ** -0.5
        w = w.masked_fill(self.tril[:T, :T] == 0, float("-inf"))
        w = self.drop(F.softmax(w, dim=-1))
        return w @ self.value(x)


class MultiHead(nn.Module):
    def __init__(self, n_heads, n_embed, block_size, dropout):
        super().__init__()
        hs = n_embed // n_heads
        self.heads = nn.ModuleList([Head(n_embed, hs, block_size, dropout) for _ in range(n_heads)])
        self.proj = nn.Linear(n_embed, n_embed)
        self.drop = nn.Dropout(dropout)

    def forward(self, x):
        return self.drop(self.proj(torch.cat([h(x) for h in self.heads], dim=-1)))


class FeedForward(nn.Module):
    """net.0 is the up-projection, net.2 the down-projection whose COLUMNS are the neurons'
    write directions into the residual stream - the gate site."""

    def __init__(self, n_embed, dropout, mult=4):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(n_embed, mult * n_embed), nn.ReLU(),
                                 nn.Linear(mult * n_embed, n_embed), nn.Dropout(dropout))

    def forward(self, x):
        return self.net(x)


class Block(nn.Module):
    def __init__(self, n_embed, n_heads, block_size, dropout, mult=4):
        super().__init__()
        self.sa = MultiHead(n_heads, n_embed, block_size, dropout)
        self.ffwd = FeedForward(n_embed, dropout, mult)
        self.ln1 = nn.LayerNorm(n_embed)
        self.ln2 = nn.LayerNorm(n_embed)

    def forward(self, x):
        x = x + self.sa(self.ln1(x))
        return x + self.ffwd(self.ln2(x))


class GPT(nn.Module):
    def __init__(self, vocab, block_size, n_embed, n_heads, n_layers, dropout=0.0, mult=4):
        super().__init__()
        self.hyper = dict(vocab=vocab, block_size=block_size, n_embed=n_embed, n_heads=n_heads,
                          n_layers=n_layers, dropout=dropout, mult=mult)
        self.token_embedding_table = nn.Embedding(vocab, n_embed)
        self.position_embedding_table = nn.Embedding(block_size, n_embed)
        self.blocks = nn.Sequential(*[Block(n_embed, n_heads, block_size, dropout, mult)
                                      for _ in range(n_layers)])
        self.ln_f = nn.LayerNorm(n_embed)
        self.lm_head = nn.Linear(n_embed, vocab)
        self.block_size = block_size

    def forward(self, idx):
        B, T = idx.shape
        x = self.token_embedding_table(idx) + self.position_embedding_table(
            torch.arange(T, device=idx.device))
        return self.lm_head(self.ln_f(self.blocks(x)))

    def n_params(self):
        return sum(p.numel() for p in self.parameters())


# ---------------------------------------------------------------- the checkpoint
def save(model, path_stem, extra=None):
    """priorgpt's format: `<stem>.f16` flat blob + `<stem>.meta.json` index.

    Offsets are in ELEMENTS, not bytes, exactly as priorgpt/data/meta.json has them.
    """
    sd = model.state_dict()
    names = [n for n in sd if not n.endswith("tril")]     # buffers are not weights
    blob, index, off = [], [], 0
    for n in names:
        t = sd[n].detach().cpu().float().numpy()
        index.append({"name": n, "shape": list(t.shape), "offset": off, "count": int(t.size)})
        blob.append(t.reshape(-1).astype(np.float16))
        off += int(t.size)
    arr = np.concatenate(blob) if blob else np.zeros(0, np.float16)
    with open(path_stem + ".f16", "wb") as f:
        arr.tofile(f)
    meta = {"format": "priorgpt f16 blob + element offsets, as priorgpt/data/meta.json",
            "hyper": model.hyper, "parameters": int(model.n_params()),
            "elements": int(arr.size), "weights": index}
    if extra:
        meta.update(extra)
    with open(path_stem + ".meta.json", "w", encoding="utf-8", newline="\n") as f:
        json.dump(meta, f, indent=1)
    return meta


def load(path_stem, device="cpu"):
    with open(path_stem + ".meta.json", encoding="utf-8") as f:
        meta = json.load(f)
    arr = np.fromfile(path_stem + ".f16", dtype=np.float16)
    if arr.size != meta["elements"]:
        raise ValueError("blob has %d elements, meta says %d" % (arr.size, meta["elements"]))
    h = meta["hyper"]
    model = GPT(h["vocab"], h["block_size"], h["n_embed"], h["n_heads"], h["n_layers"],
                0.0, h.get("mult", 4))
    sd = model.state_dict()
    for t in meta["weights"]:
        v = arr[t["offset"]:t["offset"] + t["count"]].astype(np.float32).reshape(t["shape"])
        sd[t["name"]] = torch.from_numpy(v.copy())
    model.load_state_dict(sd, strict=False)
    return model.to(device).eval(), meta


def tensors(path_stem):
    """Every weight as a float64 numpy array, by name. Reads the blob WITHOUT torch, so a gate
    read never depends on the model class being importable (REQ-GF-2a: the hand check must not
    share the viewer's code path)."""
    with open(path_stem + ".meta.json", encoding="utf-8") as f:
        meta = json.load(f)
    arr = np.fromfile(path_stem + ".f16", dtype=np.float16)
    out = {}
    for t in meta["weights"]:
        out[t["name"]] = arr[t["offset"]:t["offset"] + t["count"]].astype(
            np.float64).reshape(t["shape"])
    return out, meta


# ---------------------------------------------------------------- the plants
def selftest() -> int:
    import tempfile
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    torch.manual_seed(3)
    m = GPT(10, 10, 32, 2, 2, 0.0)
    x = torch.randint(0, 10, (4, 7))
    y = m(x)
    _plant("forward gives the wrong shape", tuple(y.shape) == (4, 7, 10))

    # CAUSALITY. A GPT that can see the future would score well and mean nothing; changing a
    # LATER token must not change an EARLIER position's logits.
    x2 = x.clone()
    x2[:, 6] = (x2[:, 6] + 1) % 10
    with torch.no_grad():
        a, b = m(x), m(x2)
    _plant("a later token changed an earlier position - attention is not causal",
           torch.allclose(a[:, :6], b[:, :6], atol=1e-6))
    _plant("changing the last token changed nothing at all - the net ignores its input",
           not torch.allclose(a[:, 6], b[:, 6], atol=1e-6))

    # priorgpt's TENSOR NAMES, so the browser loader can read this net.
    names = set(n for n in m.state_dict() if not n.endswith("tril"))
    want = {"token_embedding_table.weight", "position_embedding_table.weight",
            "blocks.0.sa.heads.0.key.weight", "blocks.0.sa.proj.weight",
            "blocks.0.ffwd.net.0.weight", "blocks.0.ffwd.net.2.weight",
            "blocks.0.ln1.weight", "ln_f.weight", "lm_head.weight", "lm_head.bias"}
    missing = want - names
    _plant("tensor names do not match priorgpt's: missing %s" % sorted(missing), not missing)

    # the gate site's shape: columns are the writers into n_embed.
    W = m.state_dict()["blocks.0.ffwd.net.2.weight"]
    _plant("the down-projection is not (n_embed, mult*n_embed)", tuple(W.shape) == (32, 128))

    # ROUND TRIP through the checkpoint, on the LOGITS and not only on the bytes: f16 loses
    # precision, so the bar is a tolerance that an actual mistake (a wrong offset, a dropped
    # tensor) could not pass.
    d = tempfile.mkdtemp()
    stem = os.path.join(d, "t")
    save(m, stem)
    m2, meta = load(stem)
    with torch.no_grad():
        y2 = m2(x)
    _plant("the checkpoint round trip changed the logits by more than f16 noise",
           float((y - y2).abs().max()) < 2e-2)
    _plant("the round trip is EXACT, so f16 is not actually being written",
           float((y - y2).abs().max()) > 0)
    _plant("parameter count disagrees with the meta", meta["parameters"] == m.n_params())

    # tensors() must agree with torch's own state dict, since the hand check uses it.
    tt, _ = tensors(stem)
    sd = m2.state_dict()
    worst = max(float(np.abs(tt[n] - sd[n].numpy()).max()) for n in tt)
    _plant("tensors() disagrees with the loaded state dict: %.3e" % worst, worst < 1e-12)

    # a WRONG offset must be caught, not silently loaded: mutate the meta and require a change.
    with open(stem + ".meta.json", encoding="utf-8") as f:
        bad = json.load(f)
    bad["weights"][5]["offset"] += 1
    with open(stem + ".meta.json", "w", encoding="utf-8") as f:
        json.dump(bad, f)
    tt2, _ = tensors(stem)
    _plant("a corrupted offset read back identical tensors - the reader ignores its index",
           any(not np.array_equal(tt[n], tt2[n]) for n in tt))

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(selftest())
