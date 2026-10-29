---
name: usecase-map
description: Build and verify a UML model for a codebase - a use case model derived from the problem story, and a class model extracted from source - then diff the class model between sessions so reviewers read UML instead of code. Use when asked for use cases, UML, requirements coverage, a class diagram, or a session change report.
---

# UML model: use cases from the problem story, classes from the source

Two models, two different UML views, never conflated:

| | view | comes from | answers |
|---|---|---|---|
| **Use case model** | behavioural | the PROBLEM STORY, authored above the code | can the actor reach their goal, and what must be true along the way |
| **Class model** | structural | the source, extracted mechanically | what types and methods exist, and what changed since last session |

A use case is an actor's goal. A class is a unit of code. If you find yourself writing a use
case named after a method, stop: that is the failure this skill exists to prevent.

## 0. The rule that makes this worth doing

**Choose the MODE before you write a line, and name it in the output.** Whether to read the
code is a property of the task, not a law. Each mode has a different failure, and choosing wrong
is the one error you cannot repair later by adding rows.

| mode | when | base layer comes from | failure if chosen wrongly |
|---|---|---|---|
| **Clone-and-change** | copying an existing product, then changing it. **The common case.** | the REFERENCE product's end-to-end behaviour; your own code is only the delta | refusing to read the reference reinvents a product that already works |
| **Quarantine** | code exists but must not shape the base requirements | the problem story + end-to-end system basics, written BEFORE opening the source | reading code first bakes today's bugs in as intent |
| **Greenfield** | there is no code | the problem story alone | none, but say so, or a reader hunts for a source |
| **Code-is-spec** | the existing code's requirements are known-correct | harvest the source directly; it IS the base | canonising a broken implementation |

In every mode the **end-to-end system basics come first** - how a request crosses the whole system
and back - because user goals floating above an unspecified system describe features of something
nobody specified. Code-derived rows are marked **HAVE** with a real symbol; what the chain needs
and nobody authored is marked **INFERRED**.

Why four modes: the common job is to copy an existing product and then change it, but some projects
have product code that must not shape the base requirements, some have no code at all, and in some
the code's requirements are known to be right.

A use case does not store a requirement. It **binds requirements into a causal chain**: a
numbered scenario where each step's postcondition is the next step's precondition. When a
step needs a precondition that nothing guarantees, the chain has **inferred a requirement
nobody wrote**. Those inferred rows are the entire payload. Measured on the game's Block Painter:
7 inferred, 7 were real defects, 0 present in the authored requirements file.

## 1. Find the problem story first

Ask for it, or assemble it from what the user has actually said, with provenance per clause.
Never compose it from the code. If you cannot source a clause, mark it ABSENT and ask.

Write it as one sentence. Then list the problems that fall out of it - each becomes an epic
or an extension.

## 2. Find the authored requirements, and check their authority

Locate the human-authored requirement files. **Verify which are authoritative rather than
assuming** - a file named `*Requirements*` may declare itself non-normative. On the game,
`BattleRequirements.txt` says in its own header "I didn't write BattleRequirements.txt", and
an earlier version of this skill's output wrongly listed it as authored intent. Read the top
of every requirements file before citing it.

## 3. Write the model

Use Cockburn's goal levels: **kite** (summary, an epic), **sea** (user goal, the level to
prefer), **fish** (subfunction). A method name is fish level at best.

**Always write at least one EPIC**: the longest chain, binding the most requirements, ending
at the thing the software exists to do. If the epics run, the product works. Epic coverage is
the metric that matters; per-method coverage is not, because every method can be tested while
the actor still cannot reach the goal.

Fully dressed fields, in order: name (active-verb goal phrase), scope, level, primary actor,
supporting actors, stakeholders and interests, trigger, precondition, minimal guarantee,
success guarantee, main success scenario, extensions.

- Main success scenario: **3 to 11 steps**. Outside that range the goal level is wrong.
- Each step names what it NEEDS (its precondition), the code, and the requirement - or
  **INFERRED** when no authored requirement covers it.
- Extensions are where the chain breaks. Number them against the step (3a, 6a).
- `include` is mandatory and its arrow points base to included. `extend` is optional and its
  arrow points extension to base. **They point opposite ways**; this is the most commonly
  inverted detail in UML, so state it in the output.

## 4. Prove the inferred requirements are absent

For each inferred requirement, search the authored file for its key term and record the hit
count. `0 hits` is evidence only if the same search, run on a CONTROL term the file is known to
hold, hits: on 2026-10-27 Git Bash's grep 3.0 with `-o -i` returned 0 for every term, controls
included. "I did not see one" is not evidence. If a term hits, the requirement is authored and
does not belong in the inferred table.

## 5. Extract and verify the class model

    py .opus-tools/uml.py extract          # source -> class model
    py .opus-tools/uml.py snapshot --label session-N
    py .opus-tools/uml.py diff --from .uml/session-N.json
    py .opus-tools/uml.py mermaid --focus TypeA TypeB --only Method1 Method2
    py .opus-tools/uml.py check            # THE GATE

`check` refuses a model that names a class or method which does not exist, that has no
problem story, that has no primary actor, or whose epic falls outside 3-11 steps. Run it
before publishing anything. **A diagram nobody can verify is decoration** - UML is exactly
where plausible-looking names get invented, so it needs a resolver like any other value.
A class-model note that is not a use case model: `check --doc NOTE.md --names-only` (names only).
`uml.py check` runs with `--cache <work folder>` when another lane's `.uml/current.json` is dirty.

If the tool does not exist in this repo, port it; it is standalone. A model that must account for
every pathway is kept as data and checked by the usecase-interrogate skill's structured route
(`autobot/usecase_model.py`, `autobot/usecase_kg.py` - the knowledge graph with the anchor count).

## 6. Publish the artifact

One artifact per large completed session, because developers review UML rather than code:
the derivation, the use case model, the class diagram with real signatures, the structural
diff, and the verdict. Load `artifact-design` first. Mermaid renders natively; mermaid has
**no native use case diagram**, so approximate it with a flowchart plus a subgraph boundary
and SAY that you did.

## 6b. Verify the verifier, every time

A gate you have not tried to break is a gate you are trusting on faith. Three rules, each
from a real failure on this project:

**Prove it can FAIL.** Hand the gate something it must refuse. `uml.py selftest` does this
with a fabricated method name. A gate that has only ever passed is indistinguishable from a
gate that does nothing.

**Prove each CHANNEL is load-bearing.** Disable one channel and require the ANSWER to move.
If it does not, that channel is redundant and you are paying for it. ⚠ Ablate the channel,
not the input: my first attempt pointed the gate at an empty directory, which blinded BOTH
channels, so it would have passed with the second channel deleted entirely. Hold the input
fixed and swap only the one channel's answer.

**Check your own verification for the bug you are hunting.** I ran a silent-handler audit
over my own tools, resolved the paths after the auditor changed directory, and got "0
handlers, 0 SILENT" for a file with eight handlers - a not-found masquerading as a pass. Only
implausibility caught it. Assert that your check actually looked at something.

## 6c. An index may only be an anchor while it is FRESH

Indexes go stale silently and then answer confidently, which turns "I do not know" into "it
does not exist". Measured on this project: the Roslyn index was 56 days old with 67% of files
changed, holding 4,689 methods against 8,009 that exist - as an anchor it would have reported
ABSENT for ~40% of real methods.

Gate it (`uml.py freshness`), and know the SCOPE as well as the age: after a successful
rebuild that same index still had ZERO entries for anything under an `/Editor/` folder,
because it indexes one assembly. Not stale. Blind. Coverage and freshness are separate
questions and both must be asked.

Prefer an index you can rebuild in seconds over one you must remember to refresh.

## 7. Self-improvement pass (required, every run)

Answer these against what actually happened this run, not in the abstract. Add a dated
changelog line for anything you change. Rules: only add a rule that a REAL failure this run
would have prevented; never add speculative advice; if the file exceeds ~180 lines, cut the
weakest rule rather than appending.

1. Did I name any use case after a method or a CRUD verb? Why did it slip through?
2. Did the epic bind the most requirements available, or did I pick a short chain?
3. How many inferred requirements did the chain produce, and how many were real? If zero
   were real, the chain was written from the code - say so and fix the derivation.
4. Did the gate fail, and was the failure in the model or in the extractor? Verify before
   believing the tool.
5. Did I check the authority of every requirements file I cited?
6. What did I state without measuring?
7. Did any gate I added pass for a reason other than the one I intended? Try to make each
   one fail on purpose before believing it.
8. Did I count weak evidence as an anchor? A test that MENTIONS a name is not a test that
   covers it, and a requirement written in my own model is not a second source.

## Changelog

- 2026-09-01 created, then **rewritten after a review rejected the whole approach**: rows had been
  named after METHODS (not use cases); use cases come from the problem story and the chain is what
  INFERS missing requirements; epics are the longest chains and are the metric that matters; use
  case and class models are different views and must not be conflated. `uml.py` added as the gate
  after the first draft's coverage table proved unverifiable by hand.
- 2026-09-01 added 6b (verify the verifier) and 6c (freshness AND scope) and the step 2 authority
  check, all from real failures: a vacuous ablation gate, a self-audit that reported clean because
  it read nothing, an index 56 days stale and then structurally blind to a whole assembly, and a
  self-declared non-authoritative file cited as designer intent. Also demoted two non-anchors: a
  test that merely mentions a name, and a self-authored requirement.
- 2026-09-14 **"never from code" was wrong; it is now MODE SELECTION** (step 0), after a model came out with
  five user goals and no end-to-end basics. Also: grep-for-absence hits must be INSPECTED ("sync" matched
  "async" 17 times), and do not number headings (they become module names downstream).
- 2026-10-27 step 4 now needs a control term (u2ue Blueprint view run): a broken `grep -o -i` read
  0 for all 20 terms, which would have certified 16 inferred requirements on a search that read
  nothing. The same run widened coverage.py's id pattern (`UC-\d{3}` saw no `UC-BP1`).
- 2026-10-27 **mode chosen wrongly**: clone-and-change (Unreal's Blueprint editor as the product to copy) for an
  experiment that was meant to be QUARANTINED and human-ergonomics first. Before clone-and-change, ask whether the existing
  product should shape the base at all - when the job is to fix its friction, it is evidence, not the base.
