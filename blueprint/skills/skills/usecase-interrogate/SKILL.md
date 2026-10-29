---
name: usecase-interrogate
description: Reach complete requirements by generating QUESTIONS from holes in a use-case chain, instead of writing more rows and hoping. Walks the chain, types each hole (inferred requirement, unmapped feature in a closed space, orphan id, unanchored precondition, an alternate pathway with no requirement, a source sentence no requirement cites), emits a question with the hole cited, and exits non-zero while any question is unanswered. For a model that must account for every pathway, checks it as data (usecase_model.py) and as a SQLite knowledge graph with the anchor count per requirement (usecase_kg.py). Use when asked for every requirement, full requirements coverage, what is missing, what should I be asking, or when a use-case model needs to be proved complete rather than merely long.
---

# Interrogate the chain: completeness as a count, not a feeling

The sibling skill `usecase-map` BUILDS a model and verifies it. This one attacks the model and
asks what it cannot answer. Run `usecase-map` first if there is no model; run this to find out
whether the model is finished.

## The one idea

**"Did I think of every requirement?" is unanswerable** - what you failed to think of leaves no
trace, so no amount of care detects it. **"Is the question queue empty?" is answerable**, because
the queue is generated from a closed structure rather than from imagination.

So never try to reach completeness by writing more rows. Close a space, walk the chain, and let
the holes generate the questions. Completeness becomes a count that has to reach zero.

This is not speculative. `<game>/Assets/Docs/UseCases.md:86` - *"as INFERRED, and all five of them
were real defects."* Five holes in the chain, five genuine bugs, found by asking what the chain
needed rather than by reading the code.

## Run it

```
py .opus-tools/autobot/coverage.py    --selftest        # FIRST, every run: a gate that has only ever passed proves nothing
py .opus-tools/autobot/interrogate.py --selftest
py .opus-tools/autobot/coverage.py    --space <matrix.json> --game <name> --docs <doc.md>
py .opus-tools/autobot/interrogate.py --doc <doc.md> [--space <matrix.json> --game <name>]
                                      [--source <ref.txt> --reqs <reqs.txt> [--every-sentence]]
                                      [--no-probe] [--no-pathways]   # probe and pathways are ON by default
```

`coverage` proves the space is closed and mapped - and, when a feature names its `req`, that a STEP of its use case carries it
(mapping a requirement to a use case's name proves nothing about the scenario). `interrogate` turns what is left into questions,
including every alternate pathway that cites no requirement and every use case of 3+ steps that has none.
`--every-sentence` holds every sentence of an essay-style source to a requirement, not only the ones with a rule word.
**Both exit 1 while anything is open.** That is the gate; there is no prose rule to skip.

### When the model must account for EVERY pathway: write it as data, check it as a graph

Markdown hides structure in prose. When every pathway of the use case descriptions must be accounted for, and a knowledge
graph should help detect more gaps, keep the model as YAML (use cases with parents, steps,
extensions, requirements, closed spaces, a question bank) and run:

```
py .opus-tools/autobot/usecase_model.py --selftest                 # 17 rules, each proved by a planted fault
py .opus-tools/autobot/usecase_kg.py    --selftest                 # agrees with those rules on 12 plants; finds 2 classes they cannot
py .opus-tools/autobot/usecase_model.py <model folder>             # U1-U17: hierarchy, every pathway, carriers, cells, gulfs ...
py .opus-tools/autobot/usecase_kg.py build <model folder> --db <store.sqlite> --nt <graph.nt>
```

`usecase_model.py` is the rules checker (the "compiler" for requirements: every step and every extension must carry a
requirement, every requirement must be carried, every cell of every closed space mapped or excluded with a reason, every kite
step decomposed, every user goal states its gulf of execution and evaluation). `usecase_kg.py` builds the same model into a
SQLite knowledge graph (chosen by measurement over DuckDB, igraph and NetworkX; Node's `node:sqlite` reads it, so the Anchor 2
engine can join it) whose completeness schema is DECLARED BY THE STORE, and adds what rules over YAML cannot see: the ANCHOR
COUNT k per requirement (distinct independent evidence families - story, framework, language, brainstorm, code - never the
model's own structure), single-family requirements listed as questions, possible duplicates, and chains from source sentences
to epics. Its review format is sorted N-Triples, byte-identical across rebuilds. Worked example:
`.opus-tools/quarantine/blueprint_view/` (model/, KG_SURVEY.md, DEBUG.md).

## The four holes, and the question each becomes

| hole | detected by | the question |
|---|---|---|
| **inferred requirement** | every `INFERRED IR-n` cite, in a step's Requirement cell or on an alternate pathway; each cite is its own question | step N (or pathway Na) needs X and nobody authored it - intended, and which file carries it? |
| **unmapped feature** | a closed space says the parent game does X, no use case maps it | do we do X? if yes which use case and what file:line; if no, what search proves it absent? |
| **orphan id** | the space names UC-n, no document defines it | what is that use case's goal, or should the mapping be retired? |
| **unanchored need** | a step's precondition no earlier step delivers | which step is meant to deliver it, or is it an entry precondition? |
| **baseline facet** | a module whose prose never says who/what/why/when/where/before/after | the five Ws for this module, each with the exact line to add to close it |
| **one-sided link** | A says B runs after it, B names someone else as its predecessor | which of the two is right? |
| **alternate pathway** | an extension (`- 3a.`, `**Extensions**: 1a.`, `**Extension 3a - ...:**`) citing no requirement, or a use case of 3+ steps with none | what happens when this step cannot complete, where does it end, which requirement does it carry? |

The first three, the last three except `unanchored`, are **facts** and fail the gate. `unanchored`, and an extension that never
says where it ends, are **keyword heuristics** - they cannot tell a real break from a rewording - so they are candidates and
never fail the gate. A guess that can fail a build is worse than no check.

Measured 2026-10-27 before the pathway hole existed: a model this tool passed had 14 of 14 extensions citing no requirement;
on five real documents the new hole asks 4 to 16 questions each, and Inventory.md (no alternate pathway at all) went 10 -> 20.

## The second space: why one closed space is never enough

Every new use case module gets a who / what / why / when / where attack that grows a baseline of
knowledge about it, plus what comes before it and what comes after. This is
`--probe`, and it is **ON by default** (`--no-probe` to gate on step-level holes only).

It exists because of a measured failure. On `starfighter/ASTEROID_USE_CASES.md` the closed space of
61 `CFG` constants read **61/61 claimed** and the gate went green - while the document had no step
at all for *a bullet damages a rock*, and `astHitBullet` is a real function in the file. **A space
of constants cannot see a missing step, because a missing step consumes no constant.** Re-running
the same idea over a space of FUNCTIONS instead found 17 holes in the same document, one of which
answered an open question the constant space had left standing.

So the rule is: **each round of interrogation needs a space of a different SHAPE.** Constants, then
functions, then the baseline facts a reader needs before any step can be checked at all. Closing
one shape's queue is progress, not completion - say which shape you closed.

The probe **detects rather than assumes**: it reads the prose under each module heading for an
opening label (`**Actor:**`, `- Why:`, `> **Trigger** - `) and accepts a step's backticked symbol or
`file:line` as the answer to *where*, so it never asks what the document already says. It prints the
whole grid, answered and open, because "nothing fired" and "nothing was examined" are otherwise the
same silence. Measured 2026-09-08: `ASTEROID_USE_CASES.md` 6/42 answered, `<game>/Assets/Docs/UseCases.md`
4/56.

Answering **before**/**after** is what makes the queue recursive rather than a checklist: once two
modules both declare their links, a one-sided link becomes a new question the tool derives on its own.

## The third space: the SOURCE itself, never only your summary of it

Measured 2026-10-24, on a remake of an arcade castle-defence game: a key game mechanic was missing from the build while the use
case gap check stayed green, so the check itself needed repair. The closed space was 50 rows read from the SNES manual and the
gate was green: every row mapped to a use case. But the rows were MY paraphrases. Row S15 said "no enclosed castle loses the round"
where the manual says ":675-677 if **you** do not have at least one Castle completely enclosed ... **you** lose the round"; the
requirement written from the row said "the **team** loses a life", and every gate then agreed with every other gate about a rule
the source never states. Death did not work, and nothing could see it. **A gate that checks a summary certifies the summariser.**

So when a reference text exists (a manual, a spec, a design doc), gate it directly:

```
py .opus-tools/autobot/interrogate.py --doc <chain.md> --space <space.json> --game <col> \
    --source <reference.txt> --reqs <requirements.txt>
```

`source_rules.py` extracts every sentence of the source that states a rule (mechanically - must/cannot/only/lose/win/become/award
...), and each must be cited by a live requirement's `:N-M` line range, or excluded by a reason recorded in the space
(`source_excluded`, or a row whose copy cell is `no`). A sentence whose subject is the player ("you", "his") cited only by
requirements that speak of the team is a **drift** question. Measured: the pre-fix requirements leave :675-677 and :689-698
uncited (30 holes); a team-worded death rule citing :675-677 is caught as drift; the fixed file passes 142 sentences, 0 holes.
Two traps it already handles: a WIDE cite (a page pointer) covers a sentence only if it also shares its words, and a cite must
hold half a sentence's lines (OCR sentences share boundary lines, so `:673-675` once "covered" the death rule at `:675-677`).

## Four rules, each earned

1. **Never write the document you audit.** It is usually owned by another session. A tool that
   rewrites the artifact it grades cannot be trusted about it.
2. **Check the parse against a quantity known independently**, and print both. The first run of
   `interrogate` read one table out of four - 10 steps, 5 of the document's 15 `INFERRED` markers -
   and reported a confident question count over a third of the file. Nothing in the output looked
   wrong. `grep -c INFERRED` is what caught it. A parser that silently reads a fraction is
   indistinguishable from one that read it all, unless you hold it against an outside number.
3. **An empty selection fails.** `coverage --game <typo>` selected 0 features, scored 0/0 as 100%
   and PASSED. Empty means the selector matched nothing - a broken question, not an answer.
4. **A question names its hole with a file:line.** A question nobody can locate is as unfalsifiable
   as the prose this whole approach exists to replace.

## Answering, and stopping

Work the queue by kind, not by order: `inferred` first (each is a real requirement nobody wrote),
then `link` (two claims disagree), then `unmapped`, then `orphan`, then `baseline` breadth-first -
every module's *who* before any module's *why*, so the shallow pass over the whole epic lands before
the deep pass over one corner of it. An answer is one of exactly two things - an **authored requirement**
the step can cite, or a recorded **ABSENT** with the search that proves it. "Probably fine" is
neither and does not clear a question.

Record each answer as a claim with provenance:

```
py .opus-tools/agent_graph.py claim --subject "IR-8" --verdict yes \
    --evidence "<file>:<line> <quoted token>" --kind READ --topic requirements
```

**Stop when the queue is zero, not when the list feels long.** If you stop with questions open,
say how many and of which kind - that is an honest, useful report. A model with 30 open questions
described as "complete" is the failure this skill exists to prevent.

## Log your own reasoning chain, and hold it to the graph (by default, where there is code)

Write the chain of reasoning to a file, then check it against the actual node graph, to find what the reasoning cannot see
without the graph. Whenever you reason about a model that has code under it (a trace: the
statements, decisions, paths and brainstorm questions of `quarantine/blueprint_view/view/trace.js`), write the chain down as you
go - one claim per step, each citing the graph nodes it rests on - in `<set>/chains/CH-n_<what>.yaml`:

```
chain: {id, by, from, when, question, steps: [{says: "...", cites: [Alias#sN | Alias#sN:outcome | REQ id | Q id]}]}
py -X utf8 .opus-tools/quarantine/blueprint_view/tools/chain_check.py <set>/trace <set>/chains/*.yaml --out results/CHAINS.md
```

It reports each step ANCHORED (its cites exist), SUPPORTED (what the graph attaches there - questions, the pathways' requirements,
their extensions - says the same) or not, and the owner questions the graph holds that no step reached: what the chain could not
see. A cite naming nothing or a step citing nothing FAILS (`u2ue blueprint gates` runs it on every logged chain). Measured on the
online sample (CH-1, six claims written from the converted code alone, before the graph existed): 6/6 anchored and supported - no
claim was wrong - and **9 of the 18 owner questions were invisible to it** (a variable the search reads that nothing writes, a
trace miss read as 0 units, a re-lock that never tells the old target). The chain is not worthless; it is half the picture.

## Changelog

- 2026-10-27 (a review found the gap checker missing gaps): measured what it missed on a model it passed (4 mis-carried
  requirements, 14/14 extensions with no requirement, 22/44 source sentences unchecked), then added the alternate-pathway hole,
  --every-sentence, a carrier check in coverage.py, self-tests for interrogate.py and coverage.py, and the structured model +
  knowledge graph route (usecase_model.py, usecase_kg.py). Evidence: .opus-tools/quarantine/blueprint_view/DEBUG.md.
- 2026-10-27 later the same night: the gate I had just fixed still missed inferred requirements, found only by holding its
  question count against `grep INFERRED`: a cite on a pathway (5 of 16), a second cite on one row, and a bold pathway's
  unindented last line (GodRays.md:42) were never asked. Fixed, and interrogate now PRINTS that outside count on every run
  (`INFERRED  N cite(s) in the text, M asked`, naming any id never asked) - read it before believing a pass. usecase_model.py
  gained U16 (a requirement only epics carry) and U17 (a use case of 3+ steps with no alternate pathway), so the two checkers ask
  the same questions. "Outcome: end minimal/success" now counts as a stated outcome (30 false candidates gone). DEBUG.md D14-D19.
