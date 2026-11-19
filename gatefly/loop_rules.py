"""RJ's rule: an error that LOOP ARCHITECTURE could have prevented must become a loop rule.

    py -X utf8 -I gatefly/loop_rules.py              every error, its verdict, the rule it owes
    py -X utf8 -I gatefly/loop_rules.py --new        only rules not yet in the loop
    py -X utf8 -I gatefly/loop_rules.py --selftest

RJ, 2026-11-19: "make a rule if there an error that could have been solved by architecture of
the light loop then it should be added. check every result for this."

WHY THIS IS A GATE AND NOT A LIST. This lane produced about twenty errors in two days and fixed
each one where it happened. Fixing an instance is not the same as closing the hole it came
through, and this lane has already measured that naming a class does NOT prevent the next
instance - it wrote two more premise-shaped plants nineteen minutes after naming the premise
shape, and proposed a vacuous test hours after building the vacuity screen. So the question
"could the loop have stopped this" has to be asked of every error, by a thing that refuses when
it is not asked, rather than remembered.

THE TWO VERDICTS, and the second is the one that keeps this honest:

  ARCHITECTURAL  - a loop rule would have caught it before it shipped. Owes a RULE id. The
                   gate refuses if one is missing, because "architectural" without a rule is
                   an observation, not a fix.
  NOT_ARCH       - no loop change would have caught it, and the entry must say WHY. An
                   unexplained NOT_ARCH is how everything quietly becomes unpreventable.

WHAT THIS CANNOT DO. "Would have caught it" is a judgement, made after the fact by the person
who made the error, and nothing here verifies it. A rule listed as WOULD_HAVE_CAUGHT has not
been run against the error that motivated it - that is the next thing to build and it is named
in the not-done list rather than implied.
"""
from __future__ import annotations

import argparse
import os
import sys

ARCH, NOT_ARCH = "ARCHITECTURAL", "NOT_ARCH"

# Every error this lane made or had caught in it, how it was found, and what the loop owes.
# `caught_by` is recorded because it turned out to be the most informative column: almost
# nothing was caught by a failing check.
ERRORS = [
 {"id": "raw-cosine-for-whitened", "initiated_by": "this lane SENT a claim; peer re-derived it", "caught_class": "peer checked it",
  "what": "Reported a key collinearity of 0.9995 that was the shared activation component. The "
          "whitened cosine on the same keys is 0.7238.",
  "caught_by": "a sibling lane checking the finding instead of adopting it",
  "verdict": ARCH, "rule": "R-METRIC-MATCHES-SOLVE"},

 {"id": "peer-resolved-by-display-name", "initiated_by": "this lane SENT a claim to the wrong lane", "caught_class": "peer checked it",
  "what": "Sent an R7 report to the v4 lane because its display name matched; the request came "
          "from the snipershot lane.",
  "caught_by": "the recipient saying it had not asked",
  "verdict": ARCH, "rule": "R-ADDRESS-BY-ID"},

 {"id": "guessed-which-module-was-running", "caught_class": "re-measured it",
  "what": "Reported metrics.py as the module grinding past ten minutes. It takes 1.0 s; "
          "ladder_probe.py at 266 s was next alphabetically.",
  "caught_by": "re-running the sweep with timing",
  "verdict": ARCH, "rule": "R-NAME-BEFORE-RUN"},

 {"id": "selftest-rewrote-its-own-baseline", "caught_class": "read an impossible output",
  "what": "plant_manifest.selftest() called write(), refreshing the drift baseline it compares "
          "against, so drift could never be reported after one run.",
  "caught_by": "a 'no drift' verdict arriving right after two plants were added",
  "verdict": ARCH, "rule": "R-SELFTEST-IS-READONLY"},

 {"id": "premise-shaped-plants", "caught_class": "read an output, then re-measured",
  "what": "Three plants asserting a deficiency still exists, so fixing the deficiency turned "
          "them red. Two more written 19 minutes after naming the shape.",
  "caught_by": "reading the shape screen's output, then a git-history diff",
  "verdict": ARCH, "rule": "R-PLANT-OVER-FIXTURE"},

 {"id": "vacuity-or-short-circuit", "initiated_by": "this lane SENT a shape; peer applied it to itself", "caught_class": "peer checked it",
  "what": "A plant of the form (not X) or Y, unconditionally true once X empties.",
  "caught_by": "a sibling lane finding the mirror shape in its own lane",
  "verdict": ARCH, "rule": "R-PLANT-OVER-FIXTURE"},

 {"id": "vacuous-test-proposed-in-prose", "initiated_by": "this lane PROPOSED a test; peer ran it", "caught_class": "peer checked it",
  "what": "Proposed 'replace the ratio with a difference of logs and see if the split survives'. "
          "log is monotone, so the two forms are identical by construction - 0 disagreements in "
          "200,000 draws. Proposed hours after building the vacuity screen.",
  "caught_by": "the lane that ran it",
  "verdict": ARCH, "rule": "R-SCREEN-THE-PROPOSAL"},

 {"id": "figure-drifted-across-three-values", "initiated_by": "this lane SENT prose; peer checked it against earlier prose", "caught_class": "peer checked it",
  "what": "Told RJ 12, then 16, then 11 unswept nodes. Two sources for one figure, with prose "
          "regenerating from whichever was last read.",
  "caught_by": "a sibling lane quoting the retraction back",
  "verdict": ARCH, "rule": "R-ONE-READER-PER-FIGURE"},

 {"id": "unqualified-peer-referent", "caught_class": "swept for siblings of a known fault",
  "what": "'the sibling lane' used four times while two sibling lanes were active.",
  "caught_by": "sweeping this lane after seeing the same fault elsewhere",
  "verdict": ARCH, "rule": "R-SCOPE-IN-THE-STATEMENT"},

 {"id": "attribution-by-default", "caught_class": "swept for siblings of a known fault",
  "what": "lane_of() returned 'gatefly' for any unlisted file, so another lane's file became "
          "this lane's by being absent from a table.",
  "caught_by": "the same sweep",
  "verdict": ARCH, "rule": "R-NO-OWNERSHIP-BY-DEFAULT"},

 {"id": "cited-unpushed-commit-hashes", "caught_class": "re-measured it",
  "what": "Gave sibling lanes commit hashes reachable only from this machine.",
  "caught_by": "checking whether a peer's row could resolve",
  "verdict": ARCH, "rule": "R-CITATION-RESOLVES-FOR-READER"},

 {"id": "labels-uncitable-from-source", "initiated_by": "peer tried to USE an artefact this lane supplied", "caught_class": "peer checked it",
  "what": "24 of 290 plant labels span several source lines, so a line-based grep cannot find "
          "them. A peer's row read BROKEN LINK while the label was plainly there.",
  "caught_by": "a peer's tracker failing on a real citation",
  "verdict": ARCH, "rule": "R-CITATION-RESOLVES-FOR-READER"},

 {"id": "staleness-gate-failed-open", "initiated_by": "peer SENT its own design; this lane checked itself against it", "caught_class": "peer checked it",
  "what": "An entry with no search date passed the prior-art gate, because a missing date read "
          "as not-stale.",
  "caught_by": "a sibling lane saying it kept UNDATED distinct from STALE",
  "verdict": ARCH, "rule": "R-ABSENT-EVIDENCE-REFUSES"},

 {"id": "searched-nothing-found-read-as-unsearched", "caught_class": "read an impossible output",
  "what": "Seven nodes whose search found nothing reverted to NOT_SEARCHED, erasing the search.",
  "caught_by": "the count going 11 to 7 instead of to 0",
  "verdict": ARCH, "rule": "R-ABSENT-EVIDENCE-REFUSES"},

 {"id": "verdict-against-best-not-standard", "caught_class": "read an output",
  "what": "The ladder's _broke compared each rung to the best observed rung rather than to "
          "perfect, so it missed that 3,3,3 had already fallen.",
  "caught_by": "reading the verdict sentence out loud",
  "verdict": ARCH, "rule": "R-COMPARE-TO-THE-STANDARD"},

 {"id": "plant-matched-its-own-docstring", "caught_class": "a plant failed",
  "what": "check_hover's independence plant grepped source text for 'import gate_math' and "
          "matched the docstring sentence claiming the independence.",
  "caught_by": "the plant failing on its first run",
  "verdict": ARCH, "rule": "R-ASSERT-ON-STRUCTURE"},

 {"id": "plant-stronger-than-its-comment", "caught_class": "a plant failed",
  "what": "A comment said the rank order was 'nearly lambda-stable'; the assertion beneath it "
          "demanded it be identical, and failed.",
  "caught_by": "the plant failing on its first run",
  "verdict": ARCH, "rule": "R-ASSERT-ON-STRUCTURE"},

 {"id": "artefact-understated-its-own-figures", "initiated_by": "peer SENT a derivation", "caught_class": "peer checked it",
  "what": "runs/r9_keys.json called its whitened figures 'relative orderings' because lambda was "
          "fixed at 1.0. The whitened cosine is exactly lambda-free, so they were absolute.",
  "caught_by": "a sibling lane's algebra",
  "verdict": ARCH, "rule": "R-METRIC-MATCHES-SOLVE"},

 {"id": "unscoped-saturation-claim", "initiated_by": "peer SENT a passing remark", "caught_class": "peer checked it",
  "what": "'The gate saturates' stated unqualified; true at a~250, which is a lambda choice.",
  "caught_by": "a sibling lane's passing remark about concavity",
  "verdict": ARCH, "rule": "R-SCOPE-IN-THE-STATEMENT"},

 {"id": "m8-named-the-wrong-readout", "initiated_by": "peer ASKED for a prediction about a named population", "caught_class": "peer asked an unanswerable question",
  "what": "Pitched the gate to two lanes as the per-edit capacity read. The gate moves 1e-4 "
          "where c/a moves five orders of magnitude.",
  "caught_by": "a sibling lane asking a question the arithmetic could not answer",
  "verdict": ARCH, "rule": "R-READOUT-MUST-MOVE"},

 {"id": "reinvented-published-metrics", "caught_class": "re-measured it",
  "what": "The set-valued movement count is PEAK's metric; grow() is T-Patcher. Both published "
          "first.",
  "caught_by": "a literature sweep done after the work",
  "verdict": ARCH, "rule": "R-PRIOR-ART-BEFORE-BUILD"},

 {"id": "endorsed-a-figure-without-computing-it",
  "initiated_by": "peer SENT a caveat; this lane agreed with its arithmetic",
  "caught_class": "peer checked it",
  "what": "Wrote 'at nine tests one survivor at 5% is expected', agreeing with a peer's "
          "multiplicity caveat. The independent expectation is 9 x 0.05 = 0.45, so the figure "
          "was 2.2x too high; the dependent truth for nine statistics on one set of 50 cases is "
          "about 2.07. Wrong in both directions, and endorsed without computing either - IN THE "
          "SAME MESSAGE that proposed R-PEER-CLAIM-IS-UNVERIFIED.",
  "caught_by": "the v4 lane correcting the peer, who then re-derived and told this lane",
  "verdict": ARCH, "rule": "R-PEER-CLAIM-IS-UNVERIFIED"},

 {"id": "reported-magnitude-without-direction", "initiated_by": "peer COMPUTED a signed error after accepting a correction", "caught_class": "peer checked it",
  "what": "Planted that (1-r)/4 is CLOSER to the exact peak than (1-r)/2, with no assertion of "
          "which SIDE. It under-estimates at every r, and the peak is a BOUND - so the "
          "approximation licenses a claim the exact form forbids. Magnitude without sign, in a "
          "quantity where the sign is the whole point.",
  "caught_by": "the v4 lane computing the signed error after accepting the correction",
  "verdict": ARCH, "rule": "R-STATE-THE-DIRECTION"},

 {"id": "comment-asserted-what-code-did-not-do", "caught_class": "looked at the artefact",
  "what": "A comment said the distance fade stops the labels piling into a smear. The fade "
          "worked as written and the smear was there: the defect is screen-space collision.",
  "caught_by": "looking at a screenshot",
  "verdict": NOT_ARCH,
  "why_not": "A screen over comment prose was built far enough to cost out and declined on "
             "measurement: this lane's shape screens run at 9-18% precision, and a sibling "
             "lane's wider probe ran at 0%. A low-precision screen over prose does not merely "
             "get ignored - it SPENDS the attention a reader would have given the thing it "
             "screens. The catching mechanism here was looking at the artefact, which is not a "
             "loop rule but a habit."},

 {"id": "premise-retirement-action-too-aggressive", "caught_class": "read an output",
  "what": "A premise's retirement action said to drop the zero-plant census row. That row "
          "watches modules not yet written; only the premise was spent.",
  "caught_by": "the premise actually expiring and the action being acted on",
  "verdict": NOT_ARCH,
  "why_not": "The action was written while the premise still held, so it was written without "
             "the information available when it expires. No rule can supply that information "
             "earlier; the mechanism that worked was expiring loudly enough to be read."},
]

# The rules the errors above owe. `in_loop` is whether this lane has it as a standing check.
RULES = {
 "R-METRIC-MATCHES-SOLVE": {
   "says": "A similarity, rank or threshold used on model quantities must be the one the "
           "ARITHMETIC uses. No raw cosine where the solve whitens; no claim about a quantity "
           "without checking what it is invariant to.",
   "in_loop": True, "where": "gate_math.py, the whitened and lambda-invariance plants"},
 "R-ADDRESS-BY-ID": {
   "says": "Address a peer lane by session id, never by display name. A name resolves against "
           "whoever is in mind; an id does not.",
   "in_loop": False, "where": "not implemented - this lane has no outbound-message check"},
 "R-NAME-BEFORE-RUN": {
   "says": "A runner prints the name of what it is about to run BEFORE running it, so an "
           "observer never has to infer which item is in flight.",
   "in_loop": False, "where": "not implemented - the sweep script still prints on completion"},
 "R-SELFTEST-IS-READONLY": {
   "says": "A selftest must not write any artefact the lane reads. Guarded by mtime AND bytes, "
           "since either alone can miss it.",
   "in_loop": True, "where": "plant_manifest.py, 'running the selftest MODIFIED the stored "
                             "manifest'"},
 "R-PLANT-OVER-FIXTURE": {
   "says": "A plant tests a READER against a synthetic input whose answer is known. A plant "
           "reading live lane state can go red when the work finishes (premise) or green "
           "forever when a collection empties (vacuity); a fixture can do neither.",
   "in_loop": True, "where": "plant_manifest.py, premise_shaped() and the premise/plant split"},
 "R-SCREEN-THE-PROPOSAL": {
   "says": "A test PROPOSED to another lane gets the same vacuity check as one written in code. "
           "Ask what result would refute it before sending.",
   "in_loop": False, "where": "not implemented - screens read Python, not messages"},
 "R-ONE-READER-PER-FIGURE": {
   "says": "Every published figure has exactly one reader that reads its artefact, and a plant "
           "asserts the reader agrees with its source. Prose quotes the reader.",
   "in_loop": True, "where": "status.py"},
 "R-SCOPE-IN-THE-STATEMENT": {
   "says": "If a claim holds only under a condition, the condition goes IN the claim, not in "
           "the next sentence, the path, or a filter applied elsewhere.",
   "in_loop": False, "where": "partially - named in comments, no standing check"},
 "R-NO-OWNERSHIP-BY-DEFAULT": {
   "says": "A resolver returns 'unknown' for what it cannot establish. Ownership is never "
           "asserted by a default.",
   "in_loop": True, "where": "uml_kaos.lane_of(), planted three ways"},
 "R-CITATION-RESOLVES-FOR-READER": {
   "says": "A citation must resolve from the READER's position: absolute paths not bare "
           "filenames, a pushed ref or a path, and a label greppable on one line.",
   "in_loop": True, "where": "runs/plant_manifest.json and its greppability plants"},
 "R-ABSENT-EVIDENCE-REFUSES": {
   "says": "Missing evidence refuses; it never passes. Undated is not recent, and "
           "searched-found-nothing is not unsearched - each gets its own state.",
   "in_loop": True, "where": "prior_art.py, the undated and three-state plants"},
 "R-COMPARE-TO-THE-STANDARD": {
   "says": "A verdict compares to the standard, never to the best observed value. Comparing to "
           "best-so-far is how a bar drifts to fit a result.",
   "in_loop": True, "where": "ladder.py, _broke split from _worse_than_best"},
 "R-ASSERT-ON-STRUCTURE": {
   "says": "Assert on structure (AST, fields) rather than on wording, and never let an "
           "assertion be stronger than the comment above it.",
   "in_loop": True, "where": "check_hover.py import scan, plant_manifest.py premise_shaped()"},
 "R-READOUT-MUST-MOVE": {
   "says": "A quantity proposed as a readout must be shown to MOVE with the thing it reads, "
           "over the range of interest, before it is offered to anyone.",
   "in_loop": True, "where": "gate_math.py, the responsiveness table and non-monotonicity plant"},
 "R-PEER-CLAIM-IS-UNVERIFIED": {
   "says": "A claim arriving from another lane is UNVERIFIED until this lane re-derives it - "
           "the same treatment as an absent search being UNKNOWN rather than open. Measured "
           "here: of 9 peer claims re-derived, 4 did not hold, and each would have propagated. "
           "Re-deriving is also what produced 11 of this catalogue's catches, in both "
           "directions, and it requires no request from either side.",
   "in_loop": True, "where": "loop_rules.py, PEER_CLAIMS_REDERIVED and the initiated_by field"},
 "R-STATE-THE-DIRECTION": {
   "says": "A reported error, gap or difference carries its SIGN, not only its size - and for "
           "anything used as a BOUND the sign decides whether the approximation is safe. A "
           "quantity whose direction is unstated is the unnamed-statistic fault one level up.",
   "in_loop": True, "where": "gate_math.py, the (1-r)/4 under-estimate plants"},
 "R-PRIOR-ART-BEFORE-BUILD": {
   "says": "No registered item is WORKED without a dated prior-art search of its atoms.",
   "in_loop": True, "where": "prior_art.py may_work_on()"},
}


# WHAT ACTUALLY INITIATES A CROSS-LANE CATCH, measured rather than supposed.
#
# The snipershot lane proposed that every instance "started with a peer asking for a NUMBER or
# a PATH - not with a peer offering an opinion", on the grounds that a request for a specific
# value is checkable on arrival. Tested against this catalogue's own peer-caught errors:
#
#     started with a peer ASKING for a value or path   2 of 11
#     started with THIS LANE SENDING a claim           5 of 11
#     started with a peer sending its own work         4 of 11
#
# So the request form is not the common factor. What the eleven share is that THE RECEIVER
# RE-DERIVED INSTEAD OF ADOPTING - which needs no request at all and works in both directions.
#
# AND THE RATE MAKES IT WORTH DOING. Peer claims this lane re-derived rather than took:
#     Jensen bound on the concave gate                      HELD
#     g(x) + g(1/x) = 1                                     HELD
#     the hypergeometric null, mean 14.72, [11,18]          HELD
#     a proportional to 1/lambda (the absorbable axis)      HELD
#     the whitened cosine is exactly lambda-free            HELD
#     peak ~ (1-r)/2                                        FAILED - it is (1-r)/4
#     "a weak readout EVERYWHERE"                           FAILED - conflates compression
#                                                                    with detectability
#     "H7-H16 are your board"                               FAILED - four times
#     "catches start with a request for a value"            FAILED - this measurement
#
# Five held, four did not, of nine. EVERY ONE OF THE FOUR WOULD HAVE PROPAGATED HAD IT BEEN
# ADOPTED, and three of them arrived with working arithmetic attached, which is what makes
# adoption tempting. That is the argument for the rule below, and it is a number rather than a
# preference.
PEER_CLAIMS_REDERIVED = {"held": 6, "failed": 5}
#     + the binomial P(>=4) quoted as 0.0084                FAILED - that is P(>=3)=0.00836;
#       P(>=4)=0.00064, an off-by-one that UNDERSTATES the sender's own conclusion 13x
#     + the resampling SE at 4000 draws, 0.0011 at p=0.005   HELD - exactly


def check():
    """-> (missing_rule, unexplained_not_arch, unknown_rule, new_rules)."""
    missing = [e["id"] for e in ERRORS if e["verdict"] == ARCH and not e.get("rule")]
    unexplained = [e["id"] for e in ERRORS if e["verdict"] == NOT_ARCH and not e.get("why_not")]
    unknown = [(e["id"], e["rule"]) for e in ERRORS
               if e.get("rule") and e["rule"] not in RULES]
    new = sorted({e["rule"] for e in ERRORS
                  if e.get("rule") and RULES.get(e["rule"], {}).get("in_loop") is False})
    return missing, unexplained, unknown, new


def report():
    missing, unexplained, unknown, new = check()
    arch = [e for e in ERRORS if e["verdict"] == ARCH]
    print("ERRORS THIS LANE MADE, AND WHAT THE LOOP OWES")
    print("  %d errors; %d ARCHITECTURAL, %d NOT_ARCH with a stated reason"
          % (len(ERRORS), len(arch), len(ERRORS) - len(arch)))
    print()
    byrule = {}
    for e in arch:
        byrule.setdefault(e["rule"], []).append(e["id"])
    for r in sorted(byrule):
        meta = RULES.get(r, {})
        mark = "IN LOOP " if meta.get("in_loop") else "NOT YET"
        print("  [%s] %s" % (mark, r))
        print("      %s" % meta.get("says", "(undefined)"))
        print("      from: %s" % ", ".join(byrule[r]))
        print("      %s" % meta.get("where", ""))
    print()
    print("  NOT_ARCH, with reasons:")
    for e in ERRORS:
        if e["verdict"] == NOT_ARCH:
            print("    %s" % e["id"])
            print("      %s" % e["why_not"][:150])
    print()
    print("  RULES NOT YET IN THE LOOP: %d  %s" % (len(new), ", ".join(new)))
    print()
    # CLASSIFIED EXPLICITLY. The first version of this summary keyword-matched caught_by and
    # reported 9 as "a check failing" when most were re-measurements and sweeps - a loose
    # classifier producing a headline number, inside the file catalogueing errors of that kind.
    # It is the twenty-fourth entry's worth of the same fault and it is why caught_class is a
    # field rather than an inference.
    print("  How these were caught - classified explicitly, not inferred from the prose:")
    cb = {}
    for e in ERRORS:
        cb[e["caught_class"]] = cb.get(e["caught_class"], 0) + 1
    for k, v in sorted(cb.items(), key=lambda kv: -kv[1]):
        print("    %-38s %d" % (k, v))
    print()
    print("    A PLANT FAILING caught %d of %d. Everything else was a peer checking the claim,"
          % (cb.get("a plant failed", 0), len(ERRORS)))
    print("    somebody reading an output, or a sweep for siblings of a known fault.")
    return missing, unexplained, unknown, new


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    missing, unexplained, unknown, new = check()

    # 1. THE RULE RJ ASKED FOR, as a refusal. An error judged preventable by loop architecture
    #    that names no rule is an observation wearing a fix's clothes.
    _plant("an ARCHITECTURAL error names no loop rule: %s" % (missing or "none"), not missing)

    # 2. and the other half, which is what keeps the first honest: NOT_ARCH must be ARGUED.
    #    Without this every error quietly becomes unpreventable and the gate passes forever.
    _plant("a NOT_ARCH error gives no reason: %s" % (unexplained or "none"), not unexplained)

    # 3. a named rule must exist, or the id is a string that looks like a commitment
    _plant("an error cites a rule that is not defined: %s" % (unknown or "none"), not unknown)

    # 4. NOT_ARCH must be USED, or the classification is a rubber stamp. If everything is
    #    architectural the gate is not discriminating, it is agreeing.
    n_not = len([e for e in ERRORS if e["verdict"] == NOT_ARCH])
    _plant("every single error was judged ARCHITECTURAL - a classifier that never says no is "
           "not classifying", n_not > 0)

    # 5. and the converse control: it must not be mostly NOT_ARCH either, or the rule RJ asked
    #    for would never fire
    n_arch = len([e for e in ERRORS if e["verdict"] == ARCH])
    _plant("fewer than half the errors were ARCHITECTURAL (%d of %d) - then this gate rarely "
           "produces a rule and is not worth its cost" % (n_arch, len(ERRORS)),
           n_arch > len(ERRORS) / 2)

    # 6. every rule must say WHERE it lives, so "in_loop: True" is checkable rather than claimed
    noloc = [r for r, v in RULES.items() if not v.get("where")]
    _plant("a rule does not say where it is implemented: %s" % (noloc or "none"), not noloc)

    # 7. a rule marked in_loop must point at a module that EXISTS here
    HERE = os.path.dirname(os.path.abspath(__file__))
    badloc = [r for r, v in RULES.items() if v.get("in_loop")
              and ".py" in v.get("where", "")
              and not os.path.exists(os.path.join(
                  HERE, v["where"].split(".py")[0].split(",")[0].split()[-1] + ".py"))]
    _plant("a rule claims to be IN LOOP but names no module that exists: %s"
           % (badloc or "none"), not badloc)

    # 8. the not-yet list must be non-empty, or this file is claiming the loop is complete -
    #    which after two days of errors would be the least believable output it could produce
    # 9. every error must carry an EXPLICIT catch class. The first version derived this by
    #     keyword-matching caught_by and reported 9 "a check failing" when most were
    #     re-measurements - a loose classifier producing a headline, inside the file about
    #     errors of that kind.
    nocls = [e["id"] for e in ERRORS if not e.get("caught_class")]
    _plant("an error has no explicit caught_class, so the summary would be inferred from "
           "prose: %s" % (nocls or "none"), not nocls)

    # 10. the peer-claim rate must be recorded with BOTH halves. A count of claims that failed,
    #     without the count that held, is a scare number; the count that held, without the
    #     failures, is a reason to adopt. Either alone argues the opposite of the truth.
    _plant("the peer-claim re-derivation record is missing a half: %s"
           % PEER_CLAIMS_REDERIVED,
           PEER_CLAIMS_REDERIVED.get("held", 0) > 0 and PEER_CLAIMS_REDERIVED.get("failed", 0) > 0)
    # and the initiation hypothesis must be REFUTED by the data rather than by assertion
    _init = [e for e in ERRORS if e.get("initiated_by")]
    _asked = [e for e in _init if e["initiated_by"].startswith("peer ASKED")
              or "tried to USE" in e["initiated_by"]]
    _plant("MOST peer-caught errors started with a peer asking for a value (%d of %d) - then "
           "the snipershot lane's hypothesis holds here and this lane's counter-result is "
           "wrong" % (len(_asked), len(_init)), len(_asked) < len(_init) / 2)

    _plant("every rule is already in the loop - a catalogue of twenty errors that implies the "
           "loop needs no change", len(new) > 0)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--new", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    if a.new:
        _, _, _, new = check()
        print("LOOP RULES OWED BUT NOT YET IMPLEMENTED")
        for r in new:
            print("  %s" % r)
            print("    %s" % RULES[r]["says"])
            print("    %s" % RULES[r]["where"])
        raise SystemExit(1 if new else 0)
    missing, unexplained, unknown, new = report()
    raise SystemExit(1 if (missing or unexplained or unknown) else 0)
