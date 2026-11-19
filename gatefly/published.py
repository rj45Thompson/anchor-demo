"""Figures this lane has published to someone else, each with the command that re-measures it.

    py -X utf8 -I gatefly/published.py            re-measure every one, report drift
    py -X utf8 -I gatefly/published.py --selftest

WHY THIS AND NOT ANOTHER GATE. Two lanes decomposed every attributive error either of them made
- a claim about where evidence came from, who made it, or what it establishes - and the
combined figure is 2 of 16 caught with no peer anywhere in the chain. Both of those two were
THIS lane's, and both came from the same act: RE-MEASURING A FIGURE IT HAD ALREADY PUBLISHED.
The snipershot lane has none, and said plainly that it has none because it did not do that.

So re-measurement of what you have already published is the only practice either lane found
that a lone agent can adopt and that demonstrably catches this class. It was a habit here, not
a thing. A habit is what fails within the hour of being named - both lanes measured that today.

WHAT IT COVERS AND WHAT IT CANNOT. status.py already re-reads the lane's OPEN-WORK figures from
their artefacts. The gap is figures published in MESSAGES - to another lane, or to RJ - which
is exactly where this lane's attributive errors lived: an R7 margin quoted at 394,827x that was
47x, a node count given three times, "bit-identical" offered as corroboration when it was
faithful re-use. None of those is in an artefact anybody re-reads.

It cannot check a figure whose command nobody wrote down, which is why `how` is required and a
row without one REFUSES rather than being skipped. And it re-measures; it does not re-derive.
A figure that is correctly computed from a wrong premise passes here, which is the whole
attributive class - so this catches the subset where the number itself moved, and the peer
remains the only thing that catches the rest.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# id -> (what was published, the value as published, a callable that re-measures it now)
# `how` is REQUIRED. A figure with no way to re-measure it is not recorded as unverifiable -
# it refuses, because "we could not check that one" is how a register becomes decorative.
PUBLISHED = {}


# MOVED IS NOT WRONG, and this register cannot tell them apart - so it says so rather than
# reading as a list of errors. A figure TRUE when published and since changed by work needs a
# RESTATEMENT; one WRONG when published needs a RETRACTION. Different actions, and conflating
# them manufactures self-accusations, which today is the one direction nobody audits. What it
# refuses either way is updating the baseline here while the figure still stands where it was
# read. That is the drift. The snipershot lane's distinction.
def _reg(key, claim, published, how, why_not=None):
    PUBLISHED[key] = {"claim": claim, "published": published, "how": how,
                      "why_not": why_not}


# A FIGURE THAT CANNOT BE RE-MEASURED IS MARKED WITH THE REASON, never given a plausible
# command. Also that lane's point, and it found a real defect here: two rows below used to run
# a command that re-read THIS LANE'S OWN CLASSIFICATION of each error and reported it as a
# check. Re-running your own judgement is not measuring it. A command there would make the
# register claim coverage it does not have, which is EMPTY-is-not-CLEAN again.
def _unmeasurable(key, claim, published, why_not):
    _reg(key, claim, published, None, why_not)


def _unswept():
    import status
    n, tot, _ = status.unswept()
    return "%d of %d" % (n, tot)


def _plants():
    import status
    n, mods, _ = status.plants()
    return "%d across %d" % (n, mods)


def _unpushed():
    import status
    n, br = status.unpushed()
    return "unknown" if n is None else str(n)


def _gate_decimals():
    from gate_math import PRINTED_GATE_DECIMALS
    return str(PRINTED_GATE_DECIMALS)


def _attributive_zero():
    import loop_rules as L
    att = [e for e in L.ERRORS if e.get("kind") == "ATTRIBUTIVE"]
    byplant = [e for e in att if e["caught_class"] == "a plant failed"]
    return "%d of %d" % (len(byplant), len(att))


def _solo_attributive():
    import loop_rules as L
    att = [e for e in L.ERRORS if e.get("kind") == "ATTRIBUTIVE"]
    solo = [e for e in att if "re-measured" in e["caught_class"]]
    return "%d of %d" % (len(solo), len(att))


def _ratchet_agreement():
    """The figure published as 'bit-identical'. Re-measured, not re-derived - and the thing it
    establishes is recorded in the claim text, because that was the part that was wrong."""
    out = subprocess.run([sys.executable, "-X", "utf8", "-I",
                          os.path.join(HERE, "gate_math.py"), "--selftest"],
                         capture_output=True, text=True, timeout=600).stdout
    for ln in out.splitlines():
        if "max|dA|" in ln:
            return ln.strip().split("agreement:")[-1].strip()
    return "NOT FOUND in gate_math output"


# ---------------------------------------------------------------------------
# Figures sent to the MEMIT-Merge authors (NJUST) on 2026-11-19, threaded under the
# 2026-11-18 email. These left this machine and went to people who may build on them, which
# is the strongest form of "published" this register covers - a figure here cannot be quietly
# restated. Every seed below is the seed that produced the number IN THE EMAIL; a row that
# reproduces under a different seed would be measuring a different system and reporting
# agreement, which is the could-not-be-run-read-as-pass fault wearing a lab coat.
# ---------------------------------------------------------------------------

def _email_jensen():
    """max(G_jj - g(A_jj)) over the 200 systems the email cites. Must stay <= 0."""
    import numpy as np
    from gate_math import gate_matrix
    rng = np.random.default_rng(5)
    worst = -9.0
    for _ in range(200):
        d, p = int(rng.integers(8, 40)), int(rng.integers(3, 12))
        K = rng.standard_normal((d, p))
        X = rng.standard_normal((200, d))
        C = (X.T @ X) / 200 + 1e-3 * np.eye(d)
        A, Gm = gate_matrix(K, C, float(rng.uniform(0.2, 20)))
        a = np.diag(A)
        worst = max(worst, float(np.max(np.diag(Gm) - a / (1 + a))))
    return "%.3e" % worst


def _email_whitened_invariance():
    """The lambda-invariance figure quoted as 2.2e-16. Printed to one decimal because that is
    all the email claimed - recording more here would manufacture drift on the last digit."""
    import numpy as np
    from gate_math import gate_matrix
    K = np.random.default_rng(11).standard_normal((64, 12))
    X = np.random.default_rng(12).standard_normal((400, 64))
    C = (X.T @ X) / 400 + 1e-3 * np.eye(64)

    def wh(A):
        dg = np.sqrt(np.diag(A))
        W = A / np.outer(dg, dg)
        np.fill_diagonal(W, 0)
        return W

    A1, _ = gate_matrix(K, C, 1e-3)
    A2, _ = gate_matrix(K, C, 1e6)
    return "%.1e" % float(np.max(np.abs(wh(A1) - wh(A2))))


def _email_related_ratio():
    """The claim that SURVIVED the lambda correction: the related/unrelated ratio stays in
    [3.16, 4.50] and the rank ordering holds at rho >= 0.947. This is the load-bearing one -
    section 1 of the email retracts the percentages and keeps THIS."""
    import numpy as np
    from scipy.stats import spearmanr
    from gate_math import gate_matrix, crowding_all
    rng = np.random.default_rng(21)
    d, p = 64, 14
    base = rng.standard_normal((d, 1))
    K = rng.standard_normal((d, p))
    K[:, :4] = 0.55 * base + 0.45 * rng.standard_normal((d, 4))
    X = rng.standard_normal((600, d))
    C = (X.T @ X) / 600 + 1e-3 * np.eye(d)
    ratios, rhos, ref = [], [], None
    for lam in (1e-3, 1e-2, 1e-1, 1.0, 10.0, 1e2, 1e3, 1e4, 1e6):
        A, _ = gate_matrix(K, C, lam)
        f = crowding_all(A) / np.diag(A)
        if ref is None:
            ref = f.copy()
        r, u = np.median(f[:4]), np.median(f[4:])
        if u > 1e-12:
            ratios.append(float(r / u))
        rhos.append(float(spearmanr(f, ref).statistic))
    return "ratio %.2f-%.2f  rho>=%.3f" % (min(ratios), max(ratios), min(rhos))


def _email_n1_crowding():
    """Crowding at n=1 is exactly zero BY CONSTRUCTION, and the email says so. Read from the
    committed run rather than recomputed, because the claim was about a real edit run."""
    import io
    import json
    with io.open(os.path.join(HERE, "runs", "ttt_big.retrain.json"), encoding="utf-8") as f:
        d = json.load(f)
    for r in d["rows"]:
        if r["arm"] == "memit" and r["size"] == 1:
            e = (r.get("info") or {}).get("edit")
            if e:
                return "%.4f" % e["median_c"]
    return "NOT FOUND in ttt_big.retrain.json"


_reg("email-jensen",
     "max(G_jj - g(A_jj)) over 200 systems - the bound in section 3, sent to NJUST",
     "-2.921e-04", _email_jensen)
_reg("email-whitened-invariance",
     "whitened cosine change across lambda 1e-3..1e6 - section 2, sent to NJUST",
     "2.2e-16", _email_whitened_invariance)
_reg("email-related-ratio",
     "the related/unrelated finding that SURVIVED the lambda correction - section 1, the "
     "claim left standing after the percentages were withdrawn",
     "ratio 3.16-4.50  rho>=0.947", _email_related_ratio)
_reg("email-n1-crowding",
     "median crowding at n=1, quoted as exactly 0 - section 4, sent to NJUST",
     "0.0000", _email_n1_crowding)

_reg("unswept-nodes", "nodes never checked against the literature", "0 of 18", _unswept)
# Baseline updated 2026-11-19 after the register caught it at 443 against a live
# 459 - a figure quoted to the snipershot lane that had moved since.
_reg("plant-count", "plants recorded in the manifest", "459 across 30", _plants)
# Likewise: published to RJ as 72, live 73.
_reg("unpushed", "commits not on origin/main", "74", _unpushed)
_reg("gate-decimals", "decimals a gate is printed to, bounded by the f16 ULP", "4",
     _gate_decimals)
_unmeasurable("attributive-by-plant",
     "attributive errors caught by a plant - published to two lanes and to RJ as 0 of 10",
     "0 of 10",
     "the ATTRIBUTIVE label was assigned by this lane in one sitting, so a command would "
     "re-read its own judgement and report it as a check. The underlying caught_class is "
     "derivable from contemporaneous commits; the KIND is not.")
_unmeasurable("solo-attributive",
     "attributive errors caught by re-measurement with no peer in the chain - published to RJ "
     "as the consolidation input", "2 of 10",
     "same classification dependency, and the combined 2-of-16 rests half on the snipershot "
     "lane's catalogue, which this lane cannot re-measure and must not restate as though it "
     "could.")
_reg("ratchet-agreement",
     "agreement with the ratchet lane - FAITHFUL RE-USE, not independent corroboration, which "
     "is the half that was published wrongly for two days",
     "max|dA| 0.000e+00  max|dG| 0.000e+00  max|dc| 0.000e+00", _ratchet_agreement)


def live(key):
    """The CURRENT value of a registered figure, for quoting into an outgoing message.

    WHY THIS EXISTS. On 2026-11-19 this lane emailed three external researchers the sentence
    "There are 459 across 30 modules". The live figure was 467 across 31, and had been for two
    commits - published.py itself was the 31st module. The number came from this register's
    BASELINE, which is by definition what was published last time, not what is true now. The
    register caught it sixty seconds later, on a run that should have happened before the send.

    That is the reinforcing loop in its purest form: the figure had been checked, so it was
    quoted; being quoted is not being re-read. remeasure() already did the work - what was
    missing was any reason to call it at the moment a figure was being written into prose.

    So this returns the live value and REFUSES an unregistered key, because the failure it
    guards is quoting from memory. It raises on a figure marked unmeasurable rather than
    returning the baseline, since handing back a stale string here would rebuild the exact
    fault it exists to prevent.
    """
    if key not in PUBLISHED:
        raise KeyError("%r is not a registered figure - register it before quoting it, or it "
                       "is being quoted from memory, which is the thing this guards" % (key,))
    v = PUBLISHED[key]
    if v.get("how") is None:
        raise ValueError("%r is marked NOT RE-MEASURABLE (%s) - it cannot be quoted as current"
                         % (key, v["why_not"]))
    return v["how"]()


def remeasure(keys=None):
    """-> list of (key, published, now, moved). Never swallows an error: a row whose command
    raises is reported as BROKEN, not as agreeing."""
    out = []
    for k in (keys or sorted(PUBLISHED)):
        v = PUBLISHED[k]
        if v.get("how") is None:
            out.append((k, v["published"], "NOT RE-MEASURABLE: " + v["why_not"], False))
            continue
        try:
            now = v["how"]()
        except Exception as ex:
            out.append((k, v["published"], "BROKEN: %r" % (ex,), True))
            continue
        out.append((k, v["published"], now, now != v["published"]))
    return out


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. every row must carry a command. A figure with no way to re-measure it must REFUSE,
    #    not be recorded as unverifiable - that is how a register becomes decorative.
    nohow = [k for k, v in PUBLISHED.items() if not callable(v.get("how"))]
    _plant("a figure with no command carries no REASON - then it reads as an oversight rather "
           "than as a stated limit: %s"
           % ([k for k in nohow if not PUBLISHED[k].get("why_not")] or "none"),
           all(PUBLISHED[k].get("why_not") for k in nohow))
    _plant("a MEASURABLE figure also carries a why_not - then the marking means nothing: %s"
           % ([k for k, v in PUBLISHED.items()
               if callable(v.get("how")) and v.get("why_not")] or "none"),
           not [k for k, v in PUBLISHED.items()
                if callable(v.get("how")) and v.get("why_not")])
    _plant("NO figure is marked unmeasurable - then this lane is claiming it can re-measure "
           "its own classification, which is re-running a judgement and calling it a check",
           bool(nohow))
    _plant("the register is empty - then it covers nothing and reads as 'nothing has drifted'",
           len(PUBLISHED) >= 5)

    # 2. a BROKEN command must report as drift, never as agreement. A register that silently
    #    passes a row whose check cannot run is the could-not-be-run-against-pass fault.
    saved = PUBLISHED["unswept-nodes"]["how"]
    try:
        def _boom():
            raise RuntimeError("deliberate")
        PUBLISHED["unswept-nodes"]["how"] = _boom
        row = [r for r in remeasure(["unswept-nodes"])][0]
        _plant("a row whose command RAISES was reported as agreeing - could-not-be-run read as "
               "pass", row[3] and "BROKEN" in row[2])
    finally:
        PUBLISHED["unswept-nodes"]["how"] = saved

    # 3. and drift must actually be detectable, or this file is decorative in the other
    #    direction. Checked on a synthetic row rather than by corrupting a real one.
    PUBLISHED["_fixture"] = {"claim": "x", "published": "1", "how": lambda: "2"}
    try:
        row = [r for r in remeasure(["_fixture"])][0]
        _plant("a figure that MOVED was reported as unchanged - the register cannot see drift",
               row[3])
        PUBLISHED["_fixture"]["how"] = lambda: "1"
        row = [r for r in remeasure(["_fixture"])][0]
        _plant("an UNCHANGED figure was reported as drift - it would cry wolf on every run",
               not row[3])
    finally:
        del PUBLISHED["_fixture"]

    # 4. the claim text must say what a figure ESTABLISHES where that was the thing published
    #    wrongly. The ratchet agreement was quoted as corroboration for two days; re-measuring
    #    the NUMBER would never have caught that, and the register must not imply it would.
    _plant("the ratchet-agreement row does not record that it is RE-USE rather than "
           "corroboration - re-measuring the number cannot catch what was wrong about it",
           "re-use" in PUBLISHED["ratchet-agreement"]["claim"].lower())

    # 5. live() must refuse rather than hand back a stale string. Both refusals are the whole
    #    point of the function: an unregistered key means the figure is being quoted from
    #    memory, and an unmeasurable one has no current value to give. Either silently
    #    returning the baseline would rebuild the fault that created this function - a figure
    #    emailed to three researchers two commits after it stopped being true.
    try:
        live("a-key-that-was-never-registered")
        refused_unknown = False
    except KeyError:
        refused_unknown = True
    _plant("live() accepted an UNREGISTERED key - then it hands back something for a figure "
           "nobody recorded, which is quoting from memory with extra steps", refused_unknown)

    unmeas = [k for k, v in PUBLISHED.items() if v.get("how") is None]
    try:
        live(unmeas[0])
        refused_unmeas = False
    except ValueError:
        refused_unmeas = True
    _plant("live() returned a value for a figure marked NOT RE-MEASURABLE - then the one "
           "class this register admits it cannot check becomes quotable as current",
           refused_unmeas)

    # and it must agree with remeasure() on a figure that IS measurable, or the two readers
    # drift and the gate guards a different number from the one the register reports
    _plant("live() disagrees with remeasure() on the same figure - two readers for one number "
           "is the drift this lane already fixed once in status.py",
           live("gate-decimals") == [r for r in remeasure(["gate-decimals"])][0][2])

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    rows = remeasure()
    print("FIGURES PUBLISHED TO SOMEONE ELSE, RE-MEASURED")
    moved = 0
    for k, pub, now, drift in rows:
        print("  %-22s %s" % (k, "MOVED" if drift else "same"))
        print("      published: %s" % pub)
        print("      now      : %s" % now)
        if drift:
            moved += 1
    print()
    print("  %d of %d moved. MOVED IS NOT WRONG and this register cannot tell them apart:"
          % (moved, len(rows)))
    print("    a figure TRUE when published and since changed by work needs a RESTATEMENT;")
    print("    one WRONG when published needs a RETRACTION. Conflating them manufactures")
    print("    self-accusations, which is the one direction nobody audits. What is refused")
    print("    either way is updating the baseline here while the figure stands where it was read.")
    print("  This re-MEASURES; it does not re-DERIVE. A figure correctly computed from a wrong")
    print("  premise passes here - which is most of the attributive class, and why a peer")
    print("  remains the only thing that catches the rest.")
    raise SystemExit(1 if moved else 0)
