# Anchor — a knowledge engine that tells you how sure it is

A live demo, in two panels: **ask a question**, get an answer with a **measured** probability, the
independent sources behind it, and an explicit refusal when it doesn't know — and **write a
function**, watch it search a fixed primitive space and verify the result by real execution.

**No neural weights run anywhere.** Both panels do plain arithmetic and search in your browser.

## Ask a question

The full graph: **66,404,117 facts over 12.2 million subjects**, sharded 512 ways (~1.2MB each) so
the browser fetches only the piece it needs. Confidence is carried by **independent anchor count**.

| independent sources | predicted | actual (held out) | n |
|---:|---:|---:|---:|
| 1 | 45.0% | 44.8% | 423,406 |
| 2 | 87.1% | **87.5%** | 62,749 |
| 3 | 94.6% | 94.7% | 10,309 |

Fitted on one half of the entities and tested on the other, **split by subject** so no entity
appears on both sides. **Expected calibration error: 0.20 percentage points** across 496,464
held-out facts — the curve predicts, it does not merely describe its own fitting data.

If a subject genuinely isn't in the graph, a **Bloom filter with zero false negatives** proves it
rather than guessing — an abstain says *why*, not just *that*.

## Write a function

A small, honest reimplementation of the same idea in a different domain: given input→output
examples, search a fixed set of ~30 primitives for one that satisfies **every** example, verified by
real execution — no `eval()`, no model, no prediction. If nothing in the vocabulary fits, it says
so. The measured system this illustrates is a ~2,600-line search engine tested against 224 MBPP+
programming tasks.

## The law

> **An anchor is a second source, not a second opinion.**

The lift survives controls for popularity, for shared lineage between sources, and for gaps in the
reference set. It is also reported where it **fails**: in a program-synthesis domain where every
available checker read the same evidence, five checkers that were *provably independent of one
another* still bought nothing — independence was never the constraint, competence was.

## Known limitation

Subjects are matched by surface text, not a disambiguated entity id, so a name shared by more than
one real thing (many towns are named "Berlin") can appear merged under one heading. Every individual
fact shown is still real and independently sourced.

## Licence

Site code MIT. Facts data **CC BY-SA 4.0** — ShareAlike propagates from REBEL, ConceptNet, DBpedia
and others. See [LICENSE](LICENSE) for full attribution.
