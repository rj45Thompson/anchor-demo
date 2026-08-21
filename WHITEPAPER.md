# Verified Knowledge Extraction from Language Models

**Epistemic status:** pilot-scale, single model (Qwen2.5-1.5B) on the extraction side, six relations, all bars pre-registered before scoring. One strong positive result - the commit law, re-measured on real provenance against held-out external truth at n≈1M and surviving three controls. One honest null caught by its own controls. And **four corrections to our own prior claims, including this paper's headline law**: we had reported the commit law on distinct *objects* rather than distinct *provenance* and withdrew those figures; the synthesis lane's "search-composed" share was a shape classifier reported as a provenance claim, overstated ~5x; its grader-free router at 199/224 was an oracle ceiling produced by an acceptance predicate that consulted the hidden grader; and when we finally measured that router honestly it **missed its pre-registered 175-185 band badly, landing at 127/198 - worse than not routing at all.** Complementarity itself survives (union 162/198 beats the best single channel at 145/198); the routing rule that was supposed to realise it does not.

We think the architecture claim is solid and the scale claims are not yet made. Numbers are checked mechanically against the artifacts that produced them (`audit_paper.py`): **all 58 measurement-shaped claims trace to a named producing script.** Three legacy figures that could not be sourced were removed rather than left standing - the arguments they supported are kept, the unverifiable precision is not. We record the corrections in the body rather than restating the paper as though it had been right the first time.

---

A language model's factual knowledge is normally reachable only by prompting it and trusting the answer. We describe and measure a different access path: relations recovered as **linear operators over hidden states**, learned from an existing knowledge graph, with every proposal they produce **independently corroborated by that graph** before it may become a fact.

The decoding itself is not our contribution - relation linearity is established ([Hernandez et al. 2024](https://arxiv.org/abs/2308.09124), [Merullo et al. 2024](https://arxiv.org/abs/2305.16130), with the word-arithmetic tradition going back to [Mikolov et al. 2013](https://aclanthology.org/N13-1090/) and the framing of [Park et al. 2023](https://arxiv.org/abs/2311.03658)). Our contribution is the **architecture around it**: extraction where geometry may only propose, symbols must verify, and silence is honest.

## The commit law

One verification law governs everything, derived by measurement rather than assumed: confidence is carried by **independent anchor count**. A claim asserted by a single source agrees with held-out external truth 44.9% of the time; a claim asserted by two independent sources agrees 87.3% of the time. That step is why the gate commits at two.

**We first reported that law on the wrong measurement, then made the right one.** Our earlier figures - 88.3% at one anchor, 100.0% at two - counted *distinct shared objects*, not distinct provenance, on internal labels with n=214, and distinct is not independent, as that bench's own source note says. They are withdrawn. We re-measured the property the law actually names, on a graph of **66,404,117 facts carrying an explicit 8-source provenance bitmask**, holding **Wikidata-truthy out as external truth** and never counting it as an anchor. Scoring is closed-world per (subject, relation): only pairs the held-out source has an opinion on.

| distinct sources asserting the fact | n | agrees with held-out truth |
|---:|---:|---:|
| 1 | 847,267 | 44.9% |
| 2 | 125,074 | **87.3%** |
| 3 | 20,611 | 94.7% |

**A second independent source takes a claim from a coin-flip to 87.3%.** Those figures are from the strictest condition we ran, and they survived the three controls that could have explained them away. *Popularity*: famous entities appear in more sources and are likelier to be in Wikidata, so we re-ran the curve inside fixed subject-degree strata - the lift holds in every stratum, and is largest where facts are most contested (20.2% → 73.8% for the most-connected subjects). *Lineage*: several sources descend from Wikipedia/Wikidata, so we dropped w5m, the one sharing ancestry with the truth source - this lowers the single-source rate sharply (63.4% → 44.9%) while leaving two- and three-source agreement almost unmoved, which is precisely the signature of shared lineage inflating *single*-source agreement rather than corroboration. *KB incompleteness*: restricted to (s,r) pairs where the held-out source lists exactly one object, so a missing triple is a real disagreement rather than a gap.

The law survives, in a stronger form and on four orders of magnitude more evidence than the claim it replaces - but note what moved. One anchor is *worse* than we said (44.9%, not 88.3%) and two anchors do not reach certainty (87.3%, not 100%). The shape was right; the levels were optimistic. Result III reports what happened when we ran the same stricter test in the synthesis domain, where the answer was very different.

*Independent* is the load-bearing word. Two chains through the same hub are one path wearing two hats (enforcing this cut fabrications 19 → 2 in an earlier experiment). Two samples from the same model are one source: asked to corroborate seven plausible-sounding fake entities, two independent passes of the same model family agreed on the *same wrong answer* 7/7, while the symbolic gate abstained on all seven.

The law has a modal reading, and the two vocabularies are one statement. Treat the candidates as possible worlds and each independent check as an accessibility constraint: one surviving world is *necessary*, which is exactly when the system may commit, and several surviving worlds is *contested*, which is when it must ask a discriminating question instead. Adding an anchor and eliminating a world are the same move seen from two sides - 44.9% at one anchor and 87.3% at two is the counting form, and the synthesis lane in Result III runs the elimination form against executable tests. We flag one thing the modal reading does *not* buy us: necessity-as-commit was tested directly as a decision rule and failed (d=162), so Kripke earns its place here as the semantics that explains why counting works, not as a gate we ship.

## Result I: the operator channel is real, and the gate holds

**Method.** For six relations, verified subject→object pairs from a 66.4M-edge multi-provenance graph (2,000 train / 250 blind held-out per relation, split by subject-name hash), encoded through Qwen2.5-1.5B at four depths and three templates. Operators: an additive offset (mean of object-minus-subject states) and a ridge affine map. Readout: nearest neighbor against 16,648 entity states. All bars fixed in writing first.

| Relation | Operator top-1 | Operator top-10 | No-operator baseline top-10 |
|---|---|---|---|
| native language | 65.2% | **89.6%** | 0.0% |
| continent | 37.2% | 79.2% | 0.0% |
| country of citizenship | 39.6% | 73.2% | 0.0% |
| country | 23.2% | 54.8% | 0.4% |
| capital *(identity-class)* | 16.8% | 24.4% | 22.4% |
| headquarters *(identity-class)* | ~15% | ~25% | ~23% |

39 of 72 measured cells cleared the pre-declared bar (≥30% top-10, ≥+10 points over baseline).

**The wall that reproduced.** Attribute-class relations (a language, a continent) form a strong channel. Identity-class relations (a specific city among many hundreds of candidates) do not - the operator adds ~3 points over raw proximity. We had previously measured the same ceiling in a completely different embedding space with different machinery. Finding it inside the LLM's own contextual space suggests it is a property of the representation class:

> **Geometry carries kinds; it does not carry individuals. Symbols must own identity.**

**The gate, tested where it can fail.** Corroboration ran with the target relation **masked graph-wide** (including its inverse) - the gate cannot verify by lookup, only by assembling independent evidence from *other* relations:

| Test | Result |
|---|---|
| Strongest relation (native language) | **55/55 commits correct (100%)** - but see §"correcting our own headline" below: a constant-guess null later showed this is substantially base-rate |
| Pooled, all six relations | 93/108 (86.1%) at 7.2% coverage - below the 95% bar |
| 12 invented entities × 6 relations | **0/72 commits** (geometry proposed confidently for every fake) |

The pooled failures are *type-confusions verified by association* ("Thai" for a language slot attracts hundreds of converging anchors because Thai and Thailand are genuinely related): the gate verifies relatedness, and the missing constraint - the committed object must be of the type the relation demands - is available in the graph. We did **not** apply it post-hoc; it is future-work item #1.

Two systems notes: logit-lens decoding of operator outputs was dead (≤2%), so extraction is inherently **closed-world** - the graph supplies the vocabulary, the model only the geometry that selects among it. And encoding runs at 399 entities/s on a consumer GPU, so a 100k-entity sweep costs ~4 minutes per template: batched matrix arithmetic, not autoregressive generation.

## Correcting our own headline: the loud-class ride

A follow-up ran the null arm the original probe had not: **what does a constant guess achieve through the same gate?**

Proposing a single fixed object for *every* subject - "French" for the language relation - passes the gate **63 times at 88.9% precision**; "United States" for citizenship commits 86 times at 66.3%. The gate cannot refuse a high-base-rate object. So the 100% above is **substantially base-rate rather than earned**, and under pre-declared bars **0 of 6 relations passed** once these nulls were in place.

The type constraint we'd identified as future work did land, and worked: pooled precision **86.1% → 97.1%**, eliminating 13 of 15 wrong commits at a 35% coverage cost.

And a real channel survives underneath. Excluding high-base-rate objects and sweeping 62,000 subjects produced **696 residual extractions** with diverse objects, against a wrong-subject null of 32 and a random-direction null of 1 - beating its nulls by **~22x**. Externally graded: 107 of 400 sampled rows were gradeable at all (73% are tail entities no external source covers), scoring **90.7%**. In the reverse direction, 48 disagreements with the graph were hand-classified: 26 graph-right, 18 entity-linking artifacts, and **2 genuine graph errors the model caught**. Against the pre-declared bar (1,000 additions at 95%) this is **partial** - the artifact ships exploratory, not promoted into the graph.

> The same discipline that produced our best number is what took it back. A headline that cannot survive a constant-guess baseline was never a measurement of the method.

## Result II: a negative result, reported first-class

We applied the same discipline one level deeper. SAEs decompose activations into features ([Gao et al. 2024](https://arxiv.org/abs/2406.04093), [Cunningham et al. 2023](https://arxiv.org/abs/2309.08600), [Bricken et al. 2023](https://transformer-circuits.pub/2023/monosemantic-features)); the standing weakness is that features get labeled by asking an LLM what they seem to mean - unverified and circular. Our corpus is text *aligned to verified triples* ([REBEL](https://aclanthology.org/2021.findings-emnlp.204/)), so feature labeling can be a **measurement against external ground truth** instead.

We trained a TopK SAE (24,576 latents, k=32) on 250k activation positions. It reconstructed well - FVE 0.9645 against a 0.60 floor, 0.07% dead latents - and under our first grounding bench it labeled **41 features** at ≥90% held-out precision.

That number is wrong, and our own controls said so:

| Control | First bench | Corrected bench |
|---|---|---|
| SAE | 41 grounded | 0 grounded / 121 candidate |
| **Random directions** | **23 grounded** | **0 / 0** |
| **Shuffled labels** | **5 grounded** | 0 / 70 candidate |

The mechanism generalizes, which is why we report it in detail: one class ("human") was 63% of eval mentions and nearly linearly separable in raw activations; a threshold test on a dominant, geometrically loud class is easy to pass by chance; cosine against an *unnormalized* class centroid mostly measures "is this an entity mention at all"; and 24,576 candidates against a 5% false-pass threshold buys ~1,200 free passes. Two weak correlational tests conjoined still admit chance.

The corrected bench subtracts the shared mention direction (centroids then measure class, not mention-ness), replaces the significance threshold with a **selection-matched null** (beat the max of 24,576 random directions), and requires a **margin over every competing class**. Under it, random directions ground nothing - and neither does the SAE. The pre-declared retry (k=16, FVE 0.990) changed nothing: **zero grounded, retry delta zero**. Diagnosis: ~8 scoreable activations per latent at pilot scale - starvation, not refutation - plus class imbalance. Verdict: **null at this scale**, revival conditions recorded (class-balanced eval, ~10× more activations, finer classes), not a rescue.

> The measurable claim of this work is not that our extraction works. It is that when it does not work, our instruments say so before we do.

## A third access path, and a third null: reading the weights at rest

Weights are the cheapest access path - no forward pass at all. FFN layers behave as key-value memories ([Geva et al. 2021](https://arxiv.org/abs/2012.14913)), so a value vector can be decoded through the output embedding to ask what a neuron writes. We scanned every neuron for programming idioms, on CPU, in ~7 minutes.

It **passed the pre-declared bar on all 13 targets** - and is still a null. The bar compared against 500 random draws, which scored zero, making every ratio infinite. But the search ranged over the full candidate-direction space, orders of magnitude wider than the null. Running the null **as wide as the search** collapses it to **0.7x-1.8x**: real neurons hit idiom tokens at essentially the random rate, and random directions achieve rank 1 on 11/13 targets, matching the real ones.

One structural finding survives: `[::-1]` tokenizes as a **three-token sequence**, so the idiom cannot live in one neuron even in principle. The knowledge is a sequence of associations, not an address. Corpus mining beat weight-reading on every target tested.

## Result III: the same law in a second domain - complementarity without weights

The commit law was derived on facts. A sibling line applies it to program synthesis, where nothing neural runs at inference at all: verb semantics become checkable specifications, execution against the visible tests eliminates candidate worlds, and where the spec stays underdetermined the system asks a discriminating question instead of guessing.

**One pinned pool.** Earlier reports of this lane mixed denominators, which is its own small failure of discipline. The honest pool is the intersection of three sets - tasks the zero-weight system evaluated, tasks the code-model baseline evaluated, and tasks carrying a deflation map - giving **224 tasks**, scored under an identical spec (prompt plus given asserts), an identical `run_plus` grader (MBPP+ deflation, ~35x the original tests, so a solve must survive adversarial inputs), and greedy k=1 for the model.

| Channel | Solved on the common 224 |
|---|---|
| Qwen2.5-Coder-7B alone | 161 (71.9%) |
| Zero-weight system alone | 164 (73.2%) |
| Both | 126 |
| Only the zero-weight system | **38** |
| Only Qwen | 35 |
| **Union** | **199 (88.8%)** |

**The claim is the boost, not the head-to-head.** A channel with no weights at inference eliminates **60% of the code model's remaining failures** - +38 tasks, +17.0 points over the model alone - and this holds regardless of where any individual zero-weight solve came from. That is the facts-side shape again: uncorrelated errors plus a verifier that can say which channel to keep. The head-to-head reading (164 over 161) we explicitly do **not** make, and the next two paragraphs are why.

**Correcting this lane, twice.** First, we previously described roughly 111 of these solves as *search-composed*. That figure came from a **shape** classifier reading the syntax of the committed expression, and we reported it as a **provenance** claim. An audit that maps each committed program back to the vocabulary rows it actually came from gives, of the 169 solves on the wider 257-task run the audit was performed against: **22 composed from two or more independent primitives** - the only defensible "search synthesis" number - **70 carried by a single hole-filled template**, and 77 borderline. Bare search, with the capability modules stripped out, solves **118/257**. The zero-weight synthesis claim rides on the 22 and the 118, not on the total. That is a factor-of-five correction to our own headline, made before a reviewer made it for us.

Second, we reported a grader-free router - take the zero-weight answer when it commits, else the model - at 199/224 with 164 commits and 0 wrong. **Retracted.** The acceptance predicate recorded a program only under `if w2 and deflate(w2)`, and `deflate()` returns the verdict of the hidden MBPP+ grader. Programs that passed the visible tests and failed deflation were never written down at all, so "0 wrong commits" was a tautology of the recording rather than a property of the router: the grader-free router silently consulted the grader it claimed to run without. A second leak compounds it - the arm cascade escalates only on a hidden-grade failure, an escalation signal no deployed system has. So **199/224 is an oracle ceiling**, correct as a ceiling and as nothing else. We have since measured the deployable score, and it is reported next.

**We then measured it, and it is worse than we predicted and worse than doing nothing.** The instrument (`NOLLM_GRADER_FREE`, commit `0cedb7c`) separates the commit decision from the grade: commit on the visible tests alone, record public-pass and deflation-pass as independent fields. We pre-registered **175-185/224**, from a sibling debug bench where the same fixed routing rule captured 41% of its oracle gap. The measured result, on the 198 pool tasks the run completed:

| arm | score |
|---|---:|
| Deployable router | **127/198 (64.1%)** |
| Code model alone | 145/198 (73.2%) |
| Oracle ceiling (union, not achievable) | 162/198 (81.8%) |

The router is **18 tasks worse than simply always using the model**. It captures none of the oracle gap, against a pre-registration built on a sibling bench that captured 41% of its own - that estimate did not transfer.

The mechanism is the competence finding arriving in deployment. Of 159 commits, 103 survive deflation: **commit precision 64.8%**, with 56 commits (35.2%) passing the visible tests and failing the extended ones. "Take the zero-weight answer whenever it commits" is a losing rule exactly when commit precision sits *below* the fallback channel's accuracy - every commit trades a 73% chance for a 65% one. No amount of routing tuning fixes that; it needs a commit gate more precise than the model it overrides, and the anchor analysis above says none of our checkers supplies one. **The 199/224 ceiling was worth nothing in deployment**, which is what an oracle ceiling being reported as a router score always risked.

One honest caveat about the denominator: 26 pool tasks are excluded as unmeasured, because a single synthesized candidate allocated roughly 29GB and tripped the memory guard even at one worker. That exclusion is not random - memory-blowup tasks are ones where the synthesizer emits a catastrophically expensive program, which plausibly tracks difficulty - so the full-pool figure is more likely below 64.1% than above it. The negative result is not an artifact of the exclusion.

**And then the law does not transfer, which is the most useful thing we learned.** We ran the identical anchor analysis in this domain, over 274 candidate programs on 139 tasks, with labels re-run through the deflation grader only after every checker had voted. We could not build a second anchor at all. Five candidates were tested - inferred invariants, metamorphic relations, typed fuzzing, behavioural consensus across independently-enumerated programs, and the English prompt read as a checkable requirement. Against a 37.2% base rate they score 27.4%, 65.2% (on only 29 scored rows), 40.9%, 43.9%, and 23.7%. Three sit at or below chance. The AND-gate over all of them buys +6.3pp at Fisher p=0.177 while destroying 65 of the 102 correct programs.

The failure is not correlation. We checked, because we first concluded it was: an earlier version of this analysis reported three of the four checkers as hubs whose errors tracked the public asserts', and that conclusion did not survive its own control. Correlation against a constant-PASS reference collapses to a function of each checker's pass rate, and a pass-rate-matched null explained every value we had. Measured properly - Kish effective count on the excess over a shared-truth baseline - the checkers are **essentially fully independent, n_eff 3.96 of 4**, and stacking them still does nothing.

So the two domains isolate the variable. Independence was never sufficient. **What made the facts lane work is that its eight sources were separately *collected*; what makes the synthesis lane fail is that every available checker reads the same three public asserts.** Even the prompt, the one other body of evidence a task contains, routes back through them - the shipped extractor adopts a prompt-derived predicate only if the examples ratify it, and when we removed that guard and evaluated off-example the reader was too weak to help, killing 14 correct programs to catch 7 wrong ones. An anchor is not a second opinion. It is a second *source*, and a domain that cannot supply one does not get the law's benefit no matter how many checkers it stacks.

Increments in this lane are gated like the facts side. A mined English layer was A/B tested on exactly the **64 tasks it can affect** (the other 193 provably unchanged - the layer emits nothing for them): 0 regressions, +1 verified solve. Disclosed with it: 13 of those 64 were unmeasurable because the search overran its deadline, a tracked defect rather than a footnote.

## Result IV: the law running in a browser, with no weights at all

Everything above is a measurement report. This one is a thing you can open:
**https://rj45thompson.github.io/anchor-demo/**

The whole graph ships to the client - **66,404,117 facts over 12,172,957 subjects**, sharded 512
ways by an FNV-1a hash of the subject so a browser fetches only the piece it needs, plus a 13.9 MB
Bloom filter (zero false negatives) so a refusal can distinguish *genuinely absent* from *our
parser missed it*. No model runs. No server runs. The page hashes a subject, counts independent
sources, and composes.

**Chaining, and what composition costs.** A single hop is a lookup. The demo chains them: *the
capital of the country Melbourne is in* is not a recorded fact, it is
Melbourne -country-> Australia -capital-> Canberra, a path that has to be searched for. Chain
probability is the product of each hop's own measured probability - **94.7% x 94.7% = 89.7%** -
and the page states, wherever the number appears, that multiplying assumes the hops are
**independent**, which is an assumption and not a measurement. Chaining *costs* certainty and the
engine reports the cost rather than hiding it. On that question the search read **4,875 facts
across 26 shard fetches and ranked 92 complete chains**.

**A cap we could not cost, and what it had eaten.** The exporter kept the first 80 facts per
subject in row order. Measured rather than defended, that cap was discarding **1,046,813 facts
(1.58%)** while only **11,056 subjects (0.091%)** exceeded it at all - and it had deleted
`Australia -capital-> Canberra` outright, the answer to the demo's own headline example. Removing
it cost 9 MB. The lesson is the one this paper keeps relearning: a limit nobody has priced is a
guess, and this one was silently deciding what the system was allowed to know.

**A path is not an assertion, and we shipped that mistake first.** Asked *is a caliper used in a
car*, the engine finds caliper -has context-> automotive -related to-> automobile -related to->
car and originally presented it with a composed percentage. That is an overclaim of exactly the
kind this paper is about: in a graph this dense most pairs connect within a few hops, so
path-existence is nearly always true and says almost nothing about whether a specific relation
holds. The result now says so in the result itself. We caught it by using the demo, not by reading
it - which is the pattern behind every defect in this section.

**Standing gates, because a law nobody executes is a preference.** The iron law was written down
long before the demo and the demo violated it five ways anyway - an abstain message claiming an
exhaustive search that never ran, a page advertising "the whole graph" while capping every
subject, a headline example the data could not produce, a several-hundred-step search rendered as
two lines, and a synthesis example whose own inputs described a different function than its label.
None of that was caught by having the law; it was caught by finally running one. `audit_demo.py`
now lints the demo the way `audit_paper.py` lints this document, and `demo_probe.py` builds its
test questions by sampling the shipped shards at random so the test set cannot be curated by
whoever built the thing. Two of the linter's first five findings were bugs in *the linter*; we
fixed the linter rather than editing the page until it went quiet.

## The pattern across four rungs, in two domains: calibration is the whole game

Four independent attempts - three at reading knowledge out of a model, one at composing programs without one - each produced an apparently strong result, and each was retracted by a control matched to the actual selection pressure:

| Attempt | Apparent result | After a matched control |
|---|---|---|
| SAE features | 41 grounded | 0 - random dictionary grounded 23 under the same bar |
| Single-neuron weight reading | 13/13 targets pass | 0.7x-1.8x - null searched 500 draws against a vastly wider candidate space |
| Two-channel retrieval union | regressions fixed, recall up | 1.5x vs a union-matched null - the *second channel*, not the new one, did the work |
| Zero-weight synthesis (Result III) | ~111 solves search-composed; grader-free router 199/224, 0 wrong | 22 search-composed under a provenance audit; 199 is an oracle ceiling - the acceptance predicate consulted the hidden grader |

> A bar that a random baseline can also pass is not evidence, however many candidates clear it. **The null must search as wide as the claim.**

The fourth row is worth more than its size. The first three are one domain, and a pattern inside one domain is a habit of that domain - possibly an artifact of how we happen to build extraction probes. The fourth is a different domain, a different codebase, and a different failure mode: not a null that searched too narrow but an acceptance predicate that quietly consulted the answer key. It broke in the same shape anyway. Three rungs in one domain is a habit; four rungs across two domains is a method.

I regard this as the most transferable result here. Each of the four would have been publishable as a positive finding under a conventionally-specified control. What distinguishes the surviving positives is not that they were larger - it's that they went through nulls built to match how hard we searched. One of those nulls, applied late, correctly demoted our own best number.

## What this is for

Ranked by evidence:

1. **Verified KB growth and repair.** Bidirectional: facts the model holds that the graph lacks (gate-verified additions - the 55/55 above are literally this), and facts the graph holds that the model contradicts (in an earlier hybrid measurement, the graph overrode the model 11 times and was right 10).
2. **Abstention before generation.** The fake-entity result inverts into a guardrail: confident geometric proposal + zero independent corroboration is precisely the signature of a question that should be refused rather than answered - with a measured 0-fabrication property behind it rather than a heuristic.
3. **Knowledge inventory as a model audit.** Per model, which relations have a strong channel and which don't - the weak ones being where that model will confabulate. Model cards report benchmarks; this reports a verified factual inventory.
4. **A second channel beside a code model.** Verified synthesis with no weights at inference, routed by a verifier rather than by anyone's confidence: Result III measures **+38 tasks over a 7B code model** on a pinned 224-task pool, killing 60% of that model's residual failures. Note that the comparison flatters the model, since MBPP is in its pretraining and the zero-weight side has no such benefit. The deployment question - how much of the union survives once the router can no longer see the hidden grader - is open, instrumented, and its expected value pre-registered.

## Honest limits

- **This does not become a language model.** It is a knowledge/verification engine: closed-world, auditable, silent where it cannot verify.
- **Identity stays walled** - reproduced across two embedding spaces and three mechanisms.
- **Coverage has a principled floor**: an entity with <2 independent facts cannot be verified at any depth (measured: 0/69 recovered; 59 of them had ≤1 fact in total). Depth does not manufacture independence.
- **Relation linearity is replication**, on a different model with simpler estimators.
- **The feature rung is null at pilot scale**, as above; **the single-neuron rung is null** too (0.7x-1.8x vs a matched baseline).
- **Base rates can masquerade as verification.** A gate cannot refuse a high-frequency object; constant-guess baselines must be run per relation. Our own strongest figure was demoted by exactly this.
- **An acceptance predicate can hide a grader, and the ceiling it produces can be worth nothing.** The synthesis lane recorded a solve only when it passed the hidden deflation grader, making "commits, 0 wrong" true by construction. Measured properly, the deployable router scores **127/198 (64.1%)** against **145/198 (73.2%)** for the model alone - it is 18 tasks WORSE than not routing at all, and misses its own pre-registered 175-185 band badly. An oracle ceiling is not a discounted version of a real score; it can be uncorrelated with one.
- **Provenance is not shape.** Classifying solves by the syntax of the committed expression overstated genuine search synthesis by about 5x. The audited figure is 22 of 169 composed from two or more independent primitives, with 118/257 from bare search; no head-to-head "zero-weight beats the code model" claim is made on that basis.
- **Correlation against a constant is pass rate, not independence.** We labelled three checkers "hubs" on their error-correlation with the public asserts, then discovered the reference was constant-PASS, which makes that statistic a function of each checker's own pass rate; a pass-rate-matched null explained every value, in both directions. Any error-correlation claim here now requires that null. Applied correctly - Kish on the excess over a shared-truth baseline - the checkers are essentially fully independent (n_eff 3.96 of 4), which strengthens rather than rescues the negative result: independence was never the missing ingredient.
- **An anchor is a second source, not a second opinion.** The law's benefit is available only to domains that can supply separately *collected* evidence. Where every checker reads the same three examples, stacking independent checkers yields nothing, and we could not construct a competent second anchor at all.
- **Scale**: one 1.5B model, six relations, pilot-scale SAE. The throughput numbers make broader sweeps cheap; they have not yet been run.

## Method notes

Bars written before results (the 86.1% pooled gate figure is reported as a partial failure; the identified fix was withheld from the run). Mandatory adversarial controls (they killed a 41-feature "success"). Blind splits by entity. Masked corroboration (no verification-by-lookup). Independent adversarial audit of new code (it found a commit path that could emit code contradicting a user's own example; fixed before reporting). Negative results ledgered so dead levers stay dead.

*Full PDF with the complete result grids and references available; pre-registered measurement reports and code available on request.*
