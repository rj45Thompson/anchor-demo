# Anchor — a knowledge engine that tells you how sure it is

A live demo: ask a question, get an answer with a **measured** probability, the
independent sources behind it, and an explicit refusal when it doesn't know.

**No neural weights run anywhere.** The page loads a data file and counts sources
in your browser. That is the entire computation.

## The law

Confidence is carried by **independent anchor count** — how many separately
*collected* sources assert a fact.

| independent sources | predicted | actual (held out) | n |
|---:|---:|---:|---:|
| 1 | 45.0% | 44.8% | 423,406 |
| 2 | 87.1% | **87.5%** | 62,749 |
| 3 | 94.6% | 94.7% | 10,309 |

Fitted on one half of the entities and tested on the other, **split by subject** so
no entity appears on both sides. **Expected calibration error: 0.20 percentage
points** across 496,464 held-out facts — the curve predicts, it does not merely
describe its own fitting data.

The lift survives three controls: **popularity** (holds within every
subject-degree stratum), **lineage** (dropping the source that shares ancestry
with the reference set cuts *single*-source agreement sharply while leaving
multi-source agreement almost unmoved), and **reference-set incompleteness**.

> **An anchor is a second source, not a second opinion.**

## Where it fails

Measured, and reported because it matters: in a program-synthesis domain where
every available checker read the same evidence, five checkers that were *provably
independent of one another* still bought nothing. Independence was never the
binding constraint — competence was. The law's benefit is available only to
domains that can supply separately *collected* evidence.

## What this demo is

A slice: 4,000 well-connected subjects and 180,000 facts drawn from a
66,404,117-fact graph. Subjects are chosen by **connectivity, never by
confidence**, so weakly-supported facts appear at their natural rate rather than
being curated away.

## Licence

Site code MIT. Data **CC BY-SA 4.0** — ShareAlike propagates from REBEL,
ConceptNet, DBpedia and others. See [LICENSE](LICENSE) for full attribution.
