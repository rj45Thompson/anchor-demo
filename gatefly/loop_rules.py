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
# A THIRD VERDICT, added because the two above forced a lie in one direction. An error whose
# machinery exists but whose CALL nothing forces is not ARCH - recording it so would let this
# lane count a handhold as a check, which is EMPTY-is-not-CLEAN. Nor is it NOT_ARCH, which
# says no rule could help and closes the question. PARTIAL_ARCH keeps it open and requires a
# why_not saying exactly what is still unforced.
PARTIAL_ARCH = "PARTIAL_ARCH"
# Exposure recording begins today; everything before it is PRE_FIELD, never False.
EXPOSURE_FIELD_FROM = "2026-11-19"
PRE_FIELD = "PRE-FIELD"
# An error that reached someone outside this machine. Distinguished from PRE_FIELD because the
# cost of a wrong figure changes when it lands in a stranger's inbox: it cannot be restated by
# editing a file, and the reader has no way to know it moved.
FIELD = "FIELD"
# ERA, CORRECTED - AND THE FIRST VERSION WAS TOO HARSH IN THE SAME DIRECTION THE SNIPERSHOT
# LANE'S WAS. It read: "23 of these were RECONSTRUCTED, not recorded." That measured the wrong
# artefact's age. The CATALOGUE ENTRY for each of the 23 was written at 3037632, but the FAULT
# was recorded at the time, in its own commit - the 0.9995 withdrawal at 18:27, the selftest
# rewriting its baseline at 19:08, the premise shapes at 19:27, the vacuity at 20:20, the
# staleness gate at 20:00, the smeared labels at 21:12.
#
# So the split is the one that lane arrived at independently, in a different column: THE
# RECORDS ARE CONTEMPORANEOUS, THE CLASSIFICATION IS RETROSPECTIVE. The recollection risk sits
# in `kind` - attributive against substantive, assigned in one sitting - and NOT in whether
# each fault happened or how it was described at the time.
#
# Two lanes, same disease, different column, and neither would have looked without the other
# going first: that lane checked because this one did, and this one re-checked because that
# one found its own check broken.
#
# METHOD, stated because that lane's was broken twice in the same direction: it used
# `git log head -1`, the NEWEST match, read as the first mention; and its search terms came
# from its own later retelling, so the search could only find the retelling. Dating a fault
# with vocabulary written afterwards can only date it to when that vocabulary was written.
# This check used --reverse (oldest first) and read commit SUBJECTS directly rather than
# grepping catalogue vocabulary, so neither fault applies - but it shares that lane's
# uncorrected one: dating by COMMIT makes a fault noticed at 19:02 and committed at 19:08 read
# as 19:08, which biases records LATER than the discovery.
RECONSTRUCTED, RECORDED = "CLASSIFIED-LATER", "CLASSIFIED-LIVE"

# Every error this lane made or had caught in it, how it was found, and what the loop owes.
# `caught_by` is recorded because it turned out to be the most informative column: almost
# nothing was caught by a failing check.
ERRORS = [
 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "raw-cosine-for-whitened", "kind": "SUBSTANTIVE", "initiated_by": "this lane SENT a claim; peer re-derived it", "caught_class": "peer checked it",
  "what": "Reported a key collinearity of 0.9995 that was the shared activation component. The "
          "whitened cosine on the same keys is 0.7238.",
  "caught_by": "a sibling lane checking the finding instead of adopting it",
  "verdict": ARCH, "rule": "R-METRIC-MATCHES-SOLVE"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "peer-resolved-by-display-name", "kind": "ATTRIBUTIVE", "initiated_by": "this lane SENT a claim to the wrong lane", "caught_class": "peer checked it",
  "what": "Sent an R7 report to the v4 lane because its display name matched; the request came "
          "from the snipershot lane.",
  "caught_by": "the recipient saying it had not asked",
  "verdict": ARCH, "rule": "R-ADDRESS-BY-ID"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "guessed-which-module-was-running", "kind": "ATTRIBUTIVE", "caught_class": "re-measured it",
  "what": "Reported metrics.py as the module grinding past ten minutes. It takes 1.0 s; "
          "ladder_probe.py at 266 s was next alphabetically.",
  "caught_by": "re-running the sweep with timing",
  "verdict": ARCH, "rule": "R-NAME-BEFORE-RUN"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "selftest-rewrote-its-own-baseline", "kind": "SUBSTANTIVE", "caught_class": "read an impossible output",
  "what": "plant_manifest.selftest() called write(), refreshing the drift baseline it compares "
          "against, so drift could never be reported after one run.",
  "caught_by": "a 'no drift' verdict arriving right after two plants were added",
  "verdict": ARCH, "rule": "R-SELFTEST-IS-READONLY"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "premise-shaped-plants", "kind": "SUBSTANTIVE", "caught_class": "read an output, then re-measured",
  "what": "Three plants asserting a deficiency still exists, so fixing the deficiency turned "
          "them red. Two more written 19 minutes after naming the shape.",
  "caught_by": "reading the shape screen's output, then a git-history diff",
  "verdict": ARCH, "rule": "R-PLANT-OVER-FIXTURE"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "vacuity-or-short-circuit", "kind": "SUBSTANTIVE", "initiated_by": "this lane SENT a shape; peer applied it to itself", "caught_class": "peer checked it",
  "what": "A plant of the form (not X) or Y, unconditionally true once X empties.",
  "caught_by": "a sibling lane finding the mirror shape in its own lane",
  "verdict": ARCH, "rule": "R-PLANT-OVER-FIXTURE"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "vacuous-test-proposed-in-prose", "kind": "SUBSTANTIVE", "initiated_by": "this lane PROPOSED a test; peer ran it", "caught_class": "peer checked it",
  "what": "Proposed 'replace the ratio with a difference of logs and see if the split survives'. "
          "log is monotone, so the two forms are identical by construction - 0 disagreements in "
          "200,000 draws. Proposed hours after building the vacuity screen.",
  "caught_by": "the lane that ran it",
  "verdict": ARCH, "rule": "R-SCREEN-THE-PROPOSAL"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "figure-drifted-across-three-values", "kind": "ATTRIBUTIVE", "initiated_by": "this lane SENT prose; peer checked it against earlier prose", "caught_class": "peer checked it",
  "what": "Told RJ 12, then 16, then 11 unswept nodes. Two sources for one figure, with prose "
          "regenerating from whichever was last read.",
  "caught_by": "a sibling lane quoting the retraction back",
  "verdict": ARCH, "rule": "R-ONE-READER-PER-FIGURE"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "unqualified-peer-referent", "kind": "ATTRIBUTIVE", "caught_class": "swept for siblings of a known fault",
  "what": "'the sibling lane' used four times while two sibling lanes were active.",
  "caught_by": "sweeping this lane after seeing the same fault elsewhere",
  "verdict": ARCH, "rule": "R-SCOPE-IN-THE-STATEMENT"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "attribution-by-default", "kind": "ATTRIBUTIVE", "caught_class": "swept for siblings of a known fault",
  "what": "lane_of() returned 'gatefly' for any unlisted file, so another lane's file became "
          "this lane's by being absent from a table.",
  "caught_by": "the same sweep",
  "verdict": ARCH, "rule": "R-NO-OWNERSHIP-BY-DEFAULT"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "cited-unpushed-commit-hashes", "kind": "ATTRIBUTIVE", "caught_class": "re-measured it",
  "what": "Gave sibling lanes commit hashes reachable only from this machine.",
  "caught_by": "checking whether a peer's row could resolve",
  "verdict": ARCH, "rule": "R-CITATION-RESOLVES-FOR-READER"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "labels-uncitable-from-source", "kind": "ATTRIBUTIVE", "initiated_by": "peer tried to USE an artefact this lane supplied", "caught_class": "peer checked it",
  "what": "24 of 290 plant labels span several source lines, so a line-based grep cannot find "
          "them. A peer's row read BROKEN LINK while the label was plainly there.",
  "caught_by": "a peer's tracker failing on a real citation",
  "verdict": ARCH, "rule": "R-CITATION-RESOLVES-FOR-READER"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "staleness-gate-failed-open", "kind": "SUBSTANTIVE", "initiated_by": "peer SENT its own design; this lane checked itself against it", "caught_class": "peer checked it",
  "what": "An entry with no search date passed the prior-art gate, because a missing date read "
          "as not-stale.",
  "caught_by": "a sibling lane saying it kept UNDATED distinct from STALE",
  "verdict": ARCH, "rule": "R-ABSENT-EVIDENCE-REFUSES"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "searched-nothing-found-read-as-unsearched", "kind": "SUBSTANTIVE", "caught_class": "read an impossible output",
  "what": "Seven nodes whose search found nothing reverted to NOT_SEARCHED, erasing the search.",
  "caught_by": "the count going 11 to 7 instead of to 0",
  "verdict": ARCH, "rule": "R-ABSENT-EVIDENCE-REFUSES"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "verdict-against-best-not-standard", "kind": "SUBSTANTIVE", "caught_class": "read an output",
  "what": "The ladder's _broke compared each rung to the best observed rung rather than to "
          "perfect, so it missed that 3,3,3 had already fallen.",
  "caught_by": "reading the verdict sentence out loud",
  "verdict": ARCH, "rule": "R-COMPARE-TO-THE-STANDARD"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "plant-matched-its-own-docstring", "kind": "SUBSTANTIVE", "caught_class": "a plant failed",
  "what": "check_hover's independence plant grepped source text for 'import gate_math' and "
          "matched the docstring sentence claiming the independence.",
  "caught_by": "the plant failing on its first run",
  "verdict": ARCH, "rule": "R-ASSERT-ON-STRUCTURE"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "plant-stronger-than-its-comment", "kind": "SUBSTANTIVE", "caught_class": "a plant failed",
  "what": "A comment said the rank order was 'nearly lambda-stable'; the assertion beneath it "
          "demanded it be identical, and failed.",
  "caught_by": "the plant failing on its first run",
  "verdict": ARCH, "rule": "R-ASSERT-ON-STRUCTURE"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "artefact-understated-its-own-figures", "kind": "SUBSTANTIVE", "initiated_by": "peer SENT a derivation", "caught_class": "peer checked it",
  "what": "runs/r9_keys.json called its whitened figures 'relative orderings' because lambda was "
          "fixed at 1.0. The whitened cosine is exactly lambda-free, so they were absolute.",
  "caught_by": "a sibling lane's algebra",
  "verdict": ARCH, "rule": "R-METRIC-MATCHES-SOLVE"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "unscoped-saturation-claim", "kind": "SUBSTANTIVE", "initiated_by": "peer SENT a passing remark", "caught_class": "peer checked it",
  "what": "'The gate saturates' stated unqualified; true at a~250, which is a lambda choice.",
  "caught_by": "a sibling lane's passing remark about concavity",
  "verdict": ARCH, "rule": "R-SCOPE-IN-THE-STATEMENT"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "m8-named-the-wrong-readout", "kind": "SUBSTANTIVE", "initiated_by": "peer ASKED for a prediction about a named population", "caught_class": "peer asked an unanswerable question",
  "what": "Pitched the gate to two lanes as the per-edit capacity read. The gate moves 1e-4 "
          "where c/a moves five orders of magnitude.",
  "caught_by": "a sibling lane asking a question the arithmetic could not answer",
  "verdict": ARCH, "rule": "R-READOUT-MUST-MOVE"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "reinvented-published-metrics", "kind": "SUBSTANTIVE", "caught_class": "re-measured it",
  "what": "The set-valued movement count is PEAK's metric; grow() is T-Patcher. Both published "
          "first.",
  "caught_by": "a literature sweep done after the work",
  "verdict": ARCH, "rule": "R-PRIOR-ART-BEFORE-BUILD"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "endorsed-a-figure-without-computing-it", "kind": "SUBSTANTIVE",
  "initiated_by": "peer SENT a caveat; this lane agreed with its arithmetic",
  "caught_class": "peer checked it",
  "what": "Wrote 'at nine tests one survivor at 5% is expected', agreeing with a peer's "
          "multiplicity caveat. The independent expectation is 9 x 0.05 = 0.45, so the figure "
          "was 2.2x too high. The '2.07 under dependence' this lane then adopted as the "
          "correction was ITSELF WITHDRAWN - see error 26. Endorsed without computing either - "
          "IN THE SAME MESSAGE that proposed R-PEER-CLAIM-IS-UNVERIFIED.",
  "caught_by": "the v4 lane correcting the peer, who then re-derived and told this lane",
  "verdict": ARCH, "rule": "R-PEER-CLAIM-IS-UNVERIFIED"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "adopted-the-correction-to-my-own-adoption", "kind": "SUBSTANTIVE",
  "initiated_by": "peer SENT a corrected figure; this lane took it while fixing the first one",
  "caught_class": "peer checked it",
  "what": "Took '2.07 expected survivors under dependence' as the correction to error 25, and "
          "wrote it into the catalogue and into a gate_math comment. It was a BUG, not a "
          "dependence effect, and one line refutes it: S is a sum of indicators, so E[S] = sum "
          "of the marginals by LINEARITY OF EXPECTATION, which holds under arbitrary "
          "dependence. Dependence moves variance and shape, never the mean - verified at "
          "E[S]=0.4462 perfectly dependent against 0.4489 independent, with variances 3.82 and "
          "0.43. So 2.069 meant the marginals were 0.23, not 0.05. Cause was ties: a percentile "
          "threshold with >= landing on an atom, one angle identically zero in all 4000 draws "
          "and 'surviving' every time.",
  "caught_by": "the v4 lane ruling it out by arithmetic, which this lane then re-derived",
  "verdict": ARCH, "rule": "R-PEER-CLAIM-IS-UNVERIFIED"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "compared-two-escape-rates-that-measure-different-things",
  "initiated_by": "this lane SENT a refutation; peer checked whether the quantities matched",
  "caught_class": "peer checked it", "kind": "SUBSTANTIVE",
  "what": "Reported '60% attributive escaped vs 57% substantive, so their cost asymmetry does "
          "not reproduce'. This lane's measure was ESCAPED TO A PEER; the snipershot lane's "
          "was REACHED A PEER OR ITS USER. Different quantities, compared as if one. It is "
          "error 27 - a fixed numerator over an unfixed denominator - one level up, inside the "
          "meta-analysis OF OUR OWN ERRORS, committed by both lanes at once. Recounted on this "
          "lane's measure, that lane is 67% against 0%: the claim does not FAIL here, it fails "
          "to REPLICATE across two lanes, which is weaker than either lane's version and the "
          "only thing the measurements support.",
  "caught_by": "the snipershot lane checking whether the two numbers were the same quantity",
  "verdict": ARCH, "rule": "R-BASELINE-AT-THE-SAME-MEAN"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "explained-a-ratio-difference-that-does-not-exist",
  "initiated_by": "this lane SENT an explanation; peer counted its own faults against it",
  "caught_class": "peer checked it", "kind": "SUBSTANTIVE",
  "what": "Explained this lane's 68% substantive mix against the snipershot lane's apparently "
          "attributive one by saying a lane's faults land where its work is - its work being "
          "provenance, this lane's being measurement. It counted: 13 substantive against 6 "
          "attributive, SAME 68%. So there was no difference to explain, and the explanation "
          "was the more satisfying of the two available, which is the warning sign. It had "
          "generalised from three instances; this lane built a causal story on top of that "
          "without asking for the denominator.",
  "caught_by": "the snipershot lane counting its own commit log",
  "verdict": ARCH, "rule": "R-PEER-CLAIM-IS-UNVERIFIED"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "quoted-faithful-re-use-as-independent-corroboration", "kind": "ATTRIBUTIVE",
  "initiated_by": "peer RETRACTED a claim about this lane and the retraction applied here too",
  "caught_class": "peer checked it",
  "what": "Reported 'the gate arithmetic is proven bit-identical to the ratchet lane, max|dA| "
          "and max|dG| and max|dc| all exactly 0.000e+00' for two days, in a form implying "
          "independent corroboration. The comparison imports THEIR gate_blueprint and runs it "
          "beside this implementation - two distinct implementations, but this one was RE-USED "
          "from theirs, as the module's own first line says. So the agreement establishes "
          "faithful re-use and would survive a shared bug. It is R-AGREEMENT-NEEDS-INDEPENDENT-"
          "PATHS on this lane's own headline, two messages after this lane registered that "
          "rule. The real corroboration is check_hover.py, which imports neither module and "
          "agrees to 8.327e-17 - a different claim this lane had been conflating with it.",
  "caught_by": "the snipershot lane retracting its own 'independently planted' claim, whose "
               "reasoning applies here",
  "verdict": ARCH, "rule": "R-AGREEMENT-NEEDS-INDEPENDENT-PATHS"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "miscredited-my-own-correction-to-the-lane-i-corrected", "kind": "ATTRIBUTIVE",
  "initiated_by": "this lane SENT a tally; peer checked its own commit log against it",
  "caught_class": "peer checked it",
  "what": "Listed three v4-lane claims that inverted a published result here, including the "
          "compression-versus-detectability distinction. That one is THIS LANE'S: it corrected "
          "the v4 lane, which accepted it under its own commit ec52e081. Two from them, not "
          "three. The error runs in the direction of giving credit AWAY, which is why it felt "
          "safe to write and is exactly why direction matters on an attribution error too. And "
          "it sat inside a registry that COUNTS peer claims - the one place a miscredit "
          "compounds.",
  "caught_by": "the v4 lane reading its own commit titles against this lane's tally",
  "verdict": ARCH, "rule": "R-ATTRIBUTE-BY-ORIGIN-NOT-SUBJECT"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "aimed-a-right-principle-at-the-wrong-sentence", "kind": "ATTRIBUTIVE",
  "initiated_by": "this lane SENT a correction; peer re-derived what it actually said",
  "caught_class": "peer checked it",
  "what": "Told the v4 lane its 4.613e-09 against this lane's 4.3e-09 'was agreement between "
          "two measurements of the same wrong dtype, which is why it looked like "
          "confirmation'. The principle is right; the sentence it aimed at did not contain the "
          "error. That agreement was claimed only as 'faithful enough to COMPARE' - one job, "
          "establishing that its acg reproduces this lane's - and the dtype fault was "
          "established by READING the line, not by any agreement. A correct correction, "
          "misaimed, which is R-THE-CORRECTION-IS-A-CLAIM in a new costume: the claim was "
          "re-derived and the TARGET was not.",
  "caught_by": "the v4 lane quoting back what it had actually written",
  "verdict": ARCH, "rule": "R-AGREEMENT-NEEDS-INDEPENDENT-PATHS"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "r7-plant-measured-the-wrong-dtype", "kind": "SUBSTANTIVE",
  "initiated_by": "peer READ this lane's source and found the cast",
  "caught_class": "peer checked it",
  "what": "gate_math's R7 plant perturbed weights by a FLOAT32 ULP while its label said "
          "'one-ULP f16' and its print reported float16 eps - the output claimed f16 twice. "
          "About 9,800x too small. With the ULP in the dtype the label names, the plant "
          "INVERTS: the gate moves 3.6e-05, is supported to ~4 decimals, and printing 6 IS "
          "false precision - the exact thing the plant exists to detect, which it cleared for "
          "two days. The 'clean negative' this lane published and both peers quoted was an "
          "artefact of the cast.",
  "caught_by": "the v4 lane reading the line, after both lanes had built on the figure",
  "verdict": ARCH, "rule": "R-METRIC-MATCHES-SOLVE"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "mismatched-baseline-under-a-fixed-numerator", "kind": "SUBSTANTIVE",
  "initiated_by": "peer SENT a corrected figure; this lane re-derived the DENOMINATOR only",
  "caught_class": "peer checked it",
  "what": "Reported 'the corrected comparison is 0.0218 against 0.00836, a factor of 2.6'. The "
          "numerator was computed with REALISED marginals averaging 0.0353 after a tie fix; the "
          "denominator was Binomial(9, 0.05), the NOMINAL marginal from before that fix. A "
          "fixed numerator over an unfixed denominator, one line below the fix that removed "
          "exactly that fault. Matched: m=9 p=0.0353 gives 6.9x; the live family is m=7 "
          "(two angles have a realised marginal of exactly 0.000, since a statistic whose atom "
          "spans its null can never produce p <= alpha) giving 7.6x. I computed 0.00836 myself "
          "and correctly - for the wrong quantity.",
  "caught_by": "the v4 lane, after both other lanes had published the same wrong factor",
  "verdict": ARCH, "rule": "R-BASELINE-AT-THE-SAME-MEAN"},

 {"exposure": PRE_FIELD, "era": RECORDED, "id": "reported-magnitude-without-direction", "kind": "SUBSTANTIVE", "initiated_by": "peer COMPUTED a signed error after accepting a correction", "caught_class": "peer checked it",
  "what": "Planted that (1-r)/4 is CLOSER to the exact peak than (1-r)/2, with no assertion of "
          "which SIDE. It under-estimates at every r, and the peak is a BOUND - so the "
          "approximation licenses a claim the exact form forbids. Magnitude without sign, in a "
          "quantity where the sign is the whole point.",
  "caught_by": "the v4 lane computing the signed error after accepting the correction",
  "verdict": ARCH, "rule": "R-STATE-THE-DIRECTION"},

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "comment-asserted-what-code-did-not-do", "kind": "SUBSTANTIVE", "caught_class": "looked at the artefact",
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

 {"exposure": PRE_FIELD, "era": RECONSTRUCTED, "id": "premise-retirement-action-too-aggressive", "kind": "SUBSTANTIVE", "caught_class": "read an output",
  "what": "A premise's retirement action said to drop the zero-plant census row. That row "
          "watches modules not yet written; only the premise was spent.",
  "caught_by": "the premise actually expiring and the action being acted on",
  "verdict": NOT_ARCH,
  "why_not": "The action was written while the premise still held, so it was written without "
             "the information available when it expires. No rule can supply that information "
             "earlier; the mechanism that worked was expiring loudly enough to be read."},

 # THE FIRST ERROR IN THIS CATALOGUE THAT LEFT THE MACHINE. Everything above was published to
 # a peer lane or to RJ; this one went to three external researchers who may build on it. The
 # exposure field earns its name here for the first time.
 {"exposure": {"scope": FIELD, "peer_first": False, "reached_user": True,
               "reached_outsiders": ["rxia@njust.edu.cn", "zldong@njust.edu.cn",
                                     "xiangqing.shen@njust.edu.cn"]},
  "era": RECORDED, "id": "quoted-register-baseline-as-current", "kind": "SUBSTANTIVE", "caught_class": "re-measured it",
  "what": "Emailed three external researchers 'There are 459 across 30 modules'. The live "
          "figure was 467 across 31 and had been for two commits - published.py itself was "
          "the 31st module. The number came from this register's BASELINE, which is by "
          "definition what was published last time, not what is true now.",
  "caught_by": "running published.py sixty seconds AFTER the send, when it should have run "
               "before it",
  "verdict": PARTIAL_ARCH, "rule": "R-QUOTE-LIVE-NOT-REMEMBERED",
  "why_not": "The machinery already existed - remeasure() would have caught this at any point "
             "in the preceding two commits. What was missing was a reason to call it at the "
             "moment a figure was being written into prose. live() now makes that one call "
             "and refuses both an unregistered key and an unmeasurable one, so the correct "
             "use is the short one. But NOTHING FORCES THE CALL: there is no pre-send gate on "
             "an outgoing email, and claiming the loop now catches this would be the "
             "EMPTY-is-not-CLEAN fault. It is a better-shaped handhold, not a check.",
  "irony": "The email this error is in describes, in its section 6, the exact loop that "
           "produced it: a figure is checked, therefore quoted, and being quoted is not being "
           "re-read. The lane named the fault to outsiders and committed it in the same act."},
]

# The rules the errors above owe. `in_loop` is whether this lane has it as a standing check.
RULES = {
 "R-QUOTE-LIVE-NOT-REMEMBERED": {
   "says": "A figure going into an outgoing message is read LIVE at the moment of writing - "
           "published.live(key) - never from memory and never from this register's baseline, "
           "which is by definition what was published last time rather than what is true now.",
   "in_loop": False,
   "where": "published.live() exists and refuses both an unregistered key and an unmeasurable "
            "one, so the correct call is the short one. Nothing FORCES it: there is no "
            "pre-send gate on an outgoing email. A handhold, not a check - recorded as "
            "PARTIAL_ARCH so it stays open."},
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
 "R-ATTRIBUTE-BY-ORIGIN-NOT-SUBJECT": {
   "says": "A claim is identified by WHO MADE IT, never by what it is about. All three "
           "attribution faults in this exchange took that one form: a lane routed its own side "
           "session's board findings here because the SUBJECT was gates; it then handed this "
           "lane's gate back as that lane's; and this lane credited its own correction to the "
           "lane the correction was ABOUT. Subject is the nearest handle and it is never the "
           "right one. Note the direction too - this instance gave credit away, which is why "
           "it felt safe to write.",
   "in_loop": True,
   "where": "loop_rules.py, the PEER_CLAIMS table - every claim carries its origin and a plant "
            "refuses one that does not. The MESSAGE-level half is still unimplemented: nothing "
            "checks a tally in prose before it is sent, which is where this instance occurred"},
 "R-AGREEMENT-NEEDS-INDEPENDENT-PATHS": {
   "says": "Agreement between two computations is evidence exactly to the extent their "
           "DERIVATION PATHS are independent. Two implementations written from one source "
           "share its bugs, so their agreement tests transcription and nothing else. The v4 "
           "lane's stand-in could disagree with this lane's gate only because it was written "
           "from the dtype QUESTION rather than from this lane's code - had it been written "
           "from the source it would have inherited the float32 cast and agreed perfectly on a "
           "bug. check_hover.py already instantiates this and never stated it: it does NOT "
           "import gate_math, which is why its 8.327e-17 hand-check agreement means anything, "
           "and its independence plant caught an attempt to break that today.",
   "in_loop": True, "where": "check_hover.py, the AST import scan plus the hand-check agreement"},
 "R-BASELINE-AT-THE-SAME-MEAN": {
   "says": "A ratio against a baseline requires the baseline to be computed at the SAME mean as "
           "the thing measured. It follows from linearity rather than convention: dependence is "
           "the one thing that cannot move E[S], so a baseline at a different mean measures the "
           "MARGINAL change as well as the correlation - and naming the product a dependence "
           "factor is measuring two things and reporting one.",
   "in_loop": True, "where": "gate_math.py, the matched-baseline plants"},
 "R-THE-CORRECTION-IS-A-CLAIM": {
   "says": "A correction gets the same gate as the thing it corrects. Error 26 was not a "
           "failure to re-derive - the refuting argument was stated correctly two lines later - "
           "but a failure to aim it: the claim being CORRECTED was re-derived and the claim "
           "being WRITTEN was not. Re-derive what you are about to assert, not only what you "
           "are retracting.",
   "in_loop": False, "where": "not implemented - it is a rule about aim, and no screen sees aim"},
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
# Peer claims this lane RE-DERIVED rather than adopted, each with WHO MADE IT. Was a bare
# {held, failed} pair - counts with no origin field, in the registry whose whole subject is
# attribution. A miscredit lived in a message about this table and the table could not have
# caught it. R-ATTRIBUTE-BY-ORIGIN-NOT-SUBJECT, applied to itself.
V4, SNIPER = "v4", "snipershot"
PEER_CLAIMS = [
 ("our two escape rates measure different quantities",      SNIPER, "HELD"),
 ("its errors are attributive, the arithmetic always held", SNIPER, "FAILED"),
 ("attributive errors always escape before being caught",   SNIPER, "FAILED"),
 ("my 'independently planted' claim is false - shared derivation", SNIPER, "HELD"),
 ("Jensen bound on the concave gate",                      V4,     "HELD"),
 ("g(x) + g(1/x) = 1, the reciprocal symmetry",            V4,     "HELD"),
 ("the hypergeometric null, mean 14.72, [11,18]",          V4,     "HELD"),
 ("a proportional to 1/lambda, the absorbable axis",       SNIPER, "HELD"),
 ("the whitened cosine is exactly lambda-free",            V4,     "HELD"),
 ("the R7 plant perturbs float32 on float16 weights",      V4,     "HELD"),
 ("agreement needs independent derivation paths",          V4,     "HELD"),
 ("the resampling SE at 4000 draws, 0.0011 at p=0.005",    SNIPER, "HELD"),
 ("the scope rule has a mechanical core",                  SNIPER, "HELD"),
 ("my tally miscredits my own correction to them",         V4,     "HELD"),
 ("peak ~ (1-r)/2",                                        V4,     "FAILED"),
 ("'a weak readout EVERYWHERE'",                           V4,     "FAILED"),
 ("'H7-H16 are your board'",                               SNIPER, "FAILED"),
 ("cross-lane catches start with a request for a value",   SNIPER, "FAILED"),
 ("2.069 expected survivors under dependence",             SNIPER, "FAILED"),
 ("P(>=4) = 0.0084",                                       SNIPER, "FAILED"),
 ("runs/plant_manifest.json is stale",                     V4,     "FAILED"),
]
PEER_CLAIMS_REDERIVED = {
 "held": sum(1 for _, _, v in PEER_CLAIMS if v == "HELD"),
 "failed": sum(1 for _, _, v in PEER_CLAIMS if v == "FAILED"),
}


# EXPOSURE, RECORDED FROM NOW RATHER THAN RECONSTRUCTED. The snipershot lane built the
# matching file on its side (exposure_log.py) after this lane said the escape-rate question
# could not be settled from here. It could not be settled from HERE; it can be settled from
# HERE ON, and the only reason it could not was that neither lane had started.
#
# BOTH MEASURES, TOGETHER, because the whole failure was comparing one against the other:
#     peer_first    did a peer catch it before anyone here did   (this lane's measure)
#     reached_user  did it reach RJ before anything caught it    (that lane's measure)
#
# reached_user IS NEVER DEFAULTED. A default of False silently turns "nobody recorded it" into
# "it did not reach him" - the exact substitution that made the two numbers incomparable. An
# unrecorded value is UNKNOWN, which is this lane's own ABSENT-is-not-UNKNOWN rule arriving
# where it is least convenient.
#
# AND THE 33 ALREADY IN THIS FILE ARE NOT BACKFILLED. They predate the field and are marked
# PRE-FIELD, not False. Reconstructing them from recollection is the fault that started the
# thread, and that lane's own count was damaged by a smaller version of it.


def exposure_rates():
    """-> (n_recorded, peer_first_rate, reached_user_rate) or (0, None, None) when EMPTY.

    Says EMPTY rather than 0%. An empty log and a log of clean runs read the same only to
    someone who has stopped looking.
    """
    rec = [e for e in ERRORS if e.get("exposure") not in (None, PRE_FIELD)]
    if not rec:
        return 0, None, None
    pf = sum(1 for e in rec if e["exposure"].get("peer_first")) / float(len(rec))
    ru = sum(1 for e in rec if e["exposure"].get("reached_user")) / float(len(rec))
    return len(rec), pf, ru


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
    _bad = [c for c, o, v in PEER_CLAIMS if o not in (V4, SNIPER)]
    _plant("a peer claim carries no recorded ORIGIN: %s - the registry that counts claims "
           "cannot catch a miscredit without one" % (_bad or "none"), not _bad)
    _plant("the counts disagree with the claim table (%d+%d vs %d)"
           % (PEER_CLAIMS_REDERIVED["held"], PEER_CLAIMS_REDERIVED["failed"], len(PEER_CLAIMS)),
           PEER_CLAIMS_REDERIVED["held"] + PEER_CLAIMS_REDERIVED["failed"] == len(PEER_CLAIMS))
    _plant("every peer claim came from ONE lane - then this table cannot distinguish origins "
           "and the rule it implements is untested here",
           len({o for _, o, _ in PEER_CLAIMS}) > 1)

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

    # THE SHARPEST RESULT IN THE CATALOGUE, and it is the snipershot lane's framing tested
    # against this lane's data rather than agreed with.
    #
    # It proposed that all its misuses of "independent" were ATTRIBUTIVE - claims about where
    # evidence CAME FROM rather than what it SHOWED - and that the arithmetic held every time,
    # which is why no numeric instrument caught any of them. Classified here:
    #
    #     ATTRIBUTIVE   caught by a plant failing   0 of 10
    #     SUBSTANTIVE   caught by a plant failing   2 of 21
    #
    # ZERO OF TEN. A plant checks a number; an attributive error leaves the number correct and
    # misstates its provenance, so there is nothing for a plant to be wrong about. All ten were
    # caught by a peer checking (6), a re-measurement (2), or a sweep for siblings of a known
    # fault (2).
    #
    # THE WIDER GENERALISATION DOES NOT TRANSFER, and that is worth recording against it: this
    # lane is 68% SUBSTANTIVE against that lane's near-total attributive mix. Its errors were
    # about provenance because its work IS provenance; this lane measures a net, so its faults
    # land in the measurement - a dtype cast, a raw cosine, the wrong readout, a mismatched
    # baseline. The mechanism generalises; the mix is a property of what a lane does.
    _att = [e for e in ERRORS if e.get("kind") == "ATTRIBUTIVE"]
    _att_plant = [e for e in _att if e["caught_class"] == "a plant failed"]
    _plant("a plant caught an ATTRIBUTIVE error (%d of %d) - then numeric instruments are not "
           "blind to provenance after all and this finding is wrong"
           % (len(_att_plant), len(_att)), not _att_plant)
    _sub = [e for e in ERRORS if e.get("kind") == "SUBSTANTIVE"]
    _plant("no plant caught a SUBSTANTIVE error either (%d) - then the contrast above is not "
           "about attribution, it is that plants catch nothing"
           % len([e for e in _sub if e["caught_class"] == "a plant failed"]),
           any(e["caught_class"] == "a plant failed" for e in _sub))
    _plant("every error is classified ATTRIBUTIVE or SUBSTANTIVE: %s"
           % ([e["id"] for e in ERRORS if e.get("kind") not in ("ATTRIBUTIVE", "SUBSTANTIVE")]
              or "all classified"),
           all(e.get("kind") in ("ATTRIBUTIVE", "SUBSTANTIVE") for e in ERRORS))

    # AND BOTH EXPLANATIONS OF THE SURROUNDING STRUCTURE HAVE NOW FAILED, which is the honest
    # landing. The MECHANISM replicated across two lanes - 0 of 10 attributive caught by a
    # plant here, 0 of 6 there. Every story either lane told about the structure around it did
    # not:
    #
    #   "its errors are attributive, the arithmetic held"   its own count: 13 vs 6, 68% - same
    #   "a lane's faults land where its work is"            refuted by that identical ratio
    #   "attributive errors always escape first"            here 60% vs 57% - no difference
    #
    # Two lanes, three generalisations, three refutations, one surviving mechanism. The
    # mechanism is the one neither of us invented: it falls out of what a plant can inspect.
    _esc = ("peer checked it", "peer asked an unanswerable question")
    _a = [e for e in ERRORS if e.get("kind") == "ATTRIBUTIVE"]
    _b = [e for e in ERRORS if e.get("kind") == "SUBSTANTIVE"]
    _ra = sum(1 for e in _a if e["caught_class"] in _esc) / float(len(_a))
    _rb = sum(1 for e in _b if e["caught_class"] in _esc) / float(len(_b))
    # THIS PLANT IS RETIRED AS A REFUTATION AND KEPT AS A MEASUREMENT. Its 15-point threshold
    # was built from THIS lane's measure - escaped to a PEER - while the claim it was aimed at
    # used REACHED A PEER OR THE USER. Two quantities, compared as one, which is error 33.
    #
    # The snipershot lane then declined to let its own recounted 67-against-0 clear this
    # threshold, on the grounds that accepting a lane-specific effect on n=6 would resurrect
    # the account this lane had just retired. That refusal is correct and the question is
    # UNRESOLVED, not settled either way.
    #
    # AND IT CANNOT BE SETTLED FROM HERE. Making the two comparable needs a field recording
    # whether an error reached RJ before anything caught it, which this lane never recorded
    # prospectively - and reconstructing it now from recollection is precisely the fault that
    # started this thread. So the honest output is the number with its scope, and no verdict.
    print("  escape rate, measure = ESCAPED TO A PEER (not comparable to a peer-or-user "
          "measure): attributive %.0f%%, substantive %.0f%%" % (100 * _ra, 100 * _rb))
    _plant("the escape-rate comparison is being reported as a refutation rather than as an "
           "unresolved question - the two lanes measured different quantities", True)

    # THE EXPOSURE FIELD, planted the day it was created and deliberately EMPTY.
    n_exp, pf, ru = exposure_rates()
    if n_exp == 0:
        print("  exposure log: EMPTY - no error has been recorded with both measures yet.")
        print("    This is not 'no error escaped'. The 33 above predate the field and are")
        print("    marked PRE-FIELD, never False. An empty log and a clean one read the same")
        print("    only to someone who has stopped looking.")
    else:
        print("  exposure: %d recorded, peer-first %.0f%%, reached-user %.0f%%"
              % (n_exp, 100 * pf, 100 * ru))
    # 1. reached_user must never be defaulted. UNRECORDED is not False.
    _bad = [e["id"] for e in ERRORS if isinstance(e.get("exposure"), dict)
            and "reached_user" not in e["exposure"]]
    _plant("an exposure record omits reached_user, so 'nobody recorded it' would read as 'it "
           "did not reach him': %s" % (_bad or "none"), not _bad)
    # 2. the pre-field errors must be MARKED, not silently absent - otherwise the two eras of
    #    this catalogue are indistinguishable and the rates would be computed over a mixture
    _unmarked = [e["id"] for e in ERRORS if "exposure" not in e]
    _plant("%d error(s) carry no exposure marking at all - then the pre-field era is "
           "indistinguishable from the recorded one" % len(_unmarked), not _unmarked)
    # 3. and the empty log must SAY empty rather than report a rate over nothing
    _plant("the exposure log reports a rate while empty - 0%% over no records reads as 'nothing "
           "escaped'", not (n_exp == 0 and (pf is not None or ru is not None)))

    # SCOPE STATED, NOT INFERRED. The snipershot lane's point: a reader computing a rate across
    # a reconstruction and a record cannot tell them apart, and inferring the scope from a file
    # being short is not the same as the file saying what it covers.
    _rec = [e for e in ERRORS if e.get("era") == RECONSTRUCTED]
    _rcd = [e for e in ERRORS if e.get("era") == RECORDED]
    print("  SCOPE: the FAULTS were recorded contemporaneously - each in its own commit at "
          "the time.")
    print("    What is retrospective is the CLASSIFICATION: %d of %d were labelled "
          "attributive/substantive" % (len(_rec), len(ERRORS)))
    print("    in one sitting at 3037632; %d were labelled as they occurred. So the "
          "recollection risk sits in" % len(_rcd))
    print("    `kind`, not in whether a fault happened or how it was described at the time.")
    _att_r = [e for e in _rcd if e.get("kind") == "ATTRIBUTIVE"]
    print("    The 0-of-10 holds under BOTH labellings: 0 of %d classified later, 0 of %d "
          "classified live." % (len([e for e in _rec if e.get("kind") == "ATTRIBUTIVE"]),
                                len(_att_r)))
    print("    It is STRONGER than the first version of this note implied, because "
          "caught_class for the")
    print("    %d is derivable from contemporaneous commits rather than from recollection - "
          "only `kind` was" % len(_rec))
    print("    assigned in one sitting. The live-labelled sample is %d, which is still thin."
          % len(_att_r))
    _plant("an error carries no era marking - then a reader cannot tell a reconstruction from "
           "a record and any rate is computed over a mixture",
           all(e.get("era") in (RECONSTRUCTED, RECORDED) for e in ERRORS))
    _plant("every error was CLASSIFIED LATER - then the labelling is wholly retrospective and "
           "no rate over `kind` should be quoted", bool(_rcd))
    _plant("every error was CLASSIFIED LIVE - then the marking is unnecessary and the first "
           "version of this note was right to claim a contemporaneous catalogue", bool(_rec))

    # WHAT A SINGLE AGENT WOULD HAVE CAUGHT, decomposed - because the snipershot lane is
    # putting the combined 0-of-16 to RJ as an input to a consolidation decision, and its
    # inference from it ("a single agent would have caught approximately none of sixteen")
    # overstates this lane's half.
    #
    # The 0-of-16 is about INSTRUMENTS and is solid: no plant, gate, probe or selftest across
    # two lanes caught a single attributive error, because every instrument reads values and an
    # attributive error leaves the value correct. But "no instrument" is not "no solo work":
    _att = [e for e in ERRORS if e.get("kind") == "ATTRIBUTIVE"]
    _peer = [e for e in _att if e["caught_class"].startswith("peer")]
    _swept = [e for e in _att if "siblings" in e["caught_class"]]
    _remeas = [e for e in _att if "re-measured" in e["caught_class"]]
    print("  WHAT CAUGHT THE %d ATTRIBUTIVE ERRORS HERE:" % len(_att))
    print("    %d by a peer lane directly" % len(_peer))
    print("    %d by sweeping for siblings - solo work, but TRIGGERED by a peer's finding "
          "elsewhere" % len(_swept))
    print("    %d by re-measuring, with no peer involvement at all" % len(_remeas))
    print("    0 by any instrument")
    print("    So a lone agent that RE-MEASURES catches some; the sweeps are solo in execution")
    print("    and peer-dependent in origin. 'Approximately none' understates it; '4 of 10 "
          "solo'")
    print("    overstates it. The defensible figure is %d of %d with no peer anywhere in the "
          "chain." % (len(_remeas), len(_att)))
    _plant("no attributive error was caught without a peer anywhere in the chain - then a lone "
           "agent catches none of this class and the consolidation input is as the snipershot "
           "lane stated it", bool(_remeas))
    _plant("the sibling sweeps are being counted as peer-independent - they were triggered by "
           "a peer finding the first instance",
           all("siblings" not in e["caught_class"] for e in _remeas))

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
