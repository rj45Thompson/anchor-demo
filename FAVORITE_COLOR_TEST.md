# Predictions for "is there a favorite color" - written BEFORE running it

Rule for this exercise: nothing below gets edited after the test. Wrong predictions stay wrong and
get marked wrong.

## Why this question is a good default

A favourite colour is a *subjective preference*, not a fact about the world. A Wikidata-derived
graph has no `favorite color` relation for anything, because it is not the sort of thing that gets
recorded as a fact. So the correct behaviour is **abstention**, and this question showcases the one
property the whole page claims: it says "I do not know" instead of producing a fluent guess.

## P1 - The headline outcome

**The engine will not complete a chain and will abstain.** No answer, 0 chains completed. It should
say so plainly rather than emitting a colour.

## P2 - Entity linking

`color` exists as a real entity in the graph (Q1075 and similar). `favorite` does not.
**Prediction: it links "color" as the start entity and treats "favorite" as an unmatched modifier.**

## P3 - The failure mode I am most worried about

There are real works titled "Favourite Colour" / "Favorite Color" (songs, albums). If entity linking
is greedy it could bind the whole phrase to a *song*, then confidently answer about that song's
performer or release date. That would be the confident-and-wrong case, which is worse than
abstaining. **Prediction: roughly 30% chance this happens.** If it does, it is a real bug worth
reporting, not a curiosity.

## P4 - Trace content

The step trace should be dominated by `MISS` lines: facts read off `color`, none of them attesting
anything like `favorite`. **Prediction: a handful of hops, many MISS, zero COMMIT.**

## P5 - Graph size

Nothing to chain to, so the search should stay small and stop early.
**Prediction: fewer than about 60 nodes, and it terminates in a couple of seconds rather than
grinding to the node cap.**

## P6 - Which of my three Views tabs will show what

- **Answer chain** should render the honest empty state: "No chain completed - the engine abstained
  on this one." This is the single best demonstration of the page's thesis, so if it works this
  question probably belongs as the default.
- **Hop layers** should show hop 0 with one node and a wide-ish hop 1, then nothing much beyond.
- **Evidence** should still populate, because edges get touched even on a failed search.

## P7 - The debugger

The step debugger replays a recorded run rather than recomputing. **Prediction: it will show the
same MISS sequence, be steppable, and will NOT show a committed answer.** If the debugger shows a
different number of steps than the trace did, that is a genuine inconsistency between record and
replay and worth flagging.

## P8 - Phrasing sensitivity

"is there a favorite color" is phrased as a yes/no question, which the parser may handle worse than
a noun phrase. **Prediction: it will strip the interrogative and search on `favorite color` or just
`color`.** Mild risk it produces the `count` intent instead ("how many...") - I rate that low.

## What would make me say the default is WRONG

If P3 happens (confidently answers about a song), or if the engine emits an actual colour as though
it were a fact. Either would mean this question makes the page look dishonest rather than careful,
and I would recommend a different default.

---

# RESULTS - measured after the predictions above, nothing edited retroactively

Run: "is there a favorite color", live engine, 2026-08-26.

| # | Prediction | Outcome |
|---|---|---|
| P1 | Abstains, 0 chains | **WRONG.** It answered. Chain completed. |
| P2 | Links `color` as the entity | **WRONG.** Linked `favorite` as subject, `color` as the target *relation*. |
| P3 | ~30% it binds to a song/album and is confidently wrong | **Right in spirit, wrong in mechanism, and worse.** Not a song. It drifted through ConceptNet association edges. |
| P4 | Many MISS, zero COMMIT | MISS confirmed early, but it did commit. |
| P5 | <60 nodes, settles in a couple of seconds | **BADLY WRONG.** Hit the 190-node cap, 5000+ trace steps, still running after 30s. |
| P7 | Debugger steppable, shows no committed answer | Debugger works and shows the program. It *does* show a committed answer. |
| P8 | Strips the interrogative | Right - parsed to subject + relation. |

## What it actually answered

    00 LOAD   subject := "favorite"                          shard 461
    01 CHECK  favorite --related to--> "website"   k=1 PASS
    02 WALK   favorite --related to--> "website"   p_hop=44.9%  p_chain=44.9%
    03 CHECK  website --part of--> "The Web"       k=1 PASS
    04 WALK   website --part of--> "The Web"       p_hop=44.9%  p_chain=20.2%
    05 CHECK  The Web --color--> "black and white" k=1 PASS

**The answer was "black and white".** Route: favorite -> website -> The Web -> black and white.

## The honest read

Two things are true at once and they should not be collapsed.

**It is not lying.** `p_hop=44.9%` is the *measured* one-source figure straight out of the anchor
law in this project's own whitepaper, and `p_chain` decays 44.9 -> 20.2 -> ~9% across the hops. The
engine is telling you this chain is about nine percent likely. That is the calibration machinery
working exactly as designed, on real numbers.

**It should never have surfaced this chain at all.** The defect is that `related to`
(ConceptNet RelatedTo) is treated as chainable evidence. RelatedTo is an *association*, not a fact -
"favorite" is related to "website" because of bookmarks. Allowing it as a hop lets the search walk
from any word to any other word. Every hop here was k=1, and the gate still said
"PASS (1 independent source - real evidence)" three times in a row.

So the bug is not the confidence maths. It is that a 9%-confidence chain built from three
association edges is presented as an answer instead of being discarded, and that
`p_hop` for RelatedTo is being taken as 44.9% when a word-association edge is not the same kind of
object the 44.9% was measured on.

## Verdict on using it as the default

Added as requested, and it is first in the Try list. But I would not leave it there long: the first
thing a visitor sees is the engine grinding to its node cap for half a minute and then answering
"black and white". That reads as wandering, which is the opposite of the page's claim.

It is an excellent *bug report* and an excellent debugger demo. It is a poor shop window until
RelatedTo is excluded from chaining.
