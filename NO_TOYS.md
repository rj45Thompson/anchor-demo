# The no-toys law

This project exists to argue that a system should tell you how sure it is and refuse when it
cannot. A demo that stages its own success argues the opposite, no matter what the copy says.

A **toy** is anything that looks like a working system from the outside while the inside is
arranged to produce the demo. A toy is worse than no demo: a missing feature costs nothing, a
staged one costs trust, and trust is the entire product here.

These are the rules the demo has to pass. They are written as tests, not aspirations.

---

### 1. No curated inputs
If it only works on the examples shipped with it, it does not work. Presets exist to show what a
question *looks like*, never to hide that arbitrary questions fail.

**Test:** take ten inputs nobody involved in building it has ever typed. Most must work, and the
rest must fail *honestly*. Run this before claiming anything, not after.

### 2. No silent truncation
Any cap states its number and what it dropped. "Showing 10 of 63" is fine. Showing 10 of 63 and
saying nothing is a lie of omission, and it is the easiest lie to ship by accident.

**Test:** grep the source for every `slice`, `head`, `limit`, `top-N`. Each one either surfaces its
count to the reader or has a comment explaining why the reader does not need it.

### 3. No narration
Progress output, traces and logs are emitted from the code path that actually did the work. Never
write a line that describes work in order to look busy. If the engine reads 312 facts the trace has
312 entries; if it reads 4, the trace has 4 and the demo looks less impressive, which is correct.

**Test:** delete the work and the trace must go silent. If the log still scrolls, it was theatre.

### 4. A bound is not an absence
A bounded search reported as "not found" claims an exhaustive search that never ran. Say the bound,
say what was left unexplored, and say that the answer may lie beyond it.

**Test:** every "no result" path names the specific limit that stopped it.

### 5. Hand-written help is declared
Alias tables, whitelists, special cases, tuned constants: all of it is listed in the open, in the
page itself and not only in the source. The reader decides whether the help is reasonable; they
cannot do that if they cannot see it.

**Test:** a stranger reading the page can state exactly which parts a human wrote by hand.

### 6. Measure before defending a limit
A cap you cannot cost in numbers is a guess wearing a justification. Before arguing for one,
measure what it drops.

**Test:** every remaining cap has a measured cost written next to it. The per-subject cap survived
three revisions on the strength of "hub entities are large" and was removed in one afternoon once
somebody actually measured it: it was discarding 1.58% of the graph and, with it, Australia's
capital city.

### 7. Failure is a result
Refusing, with the reason and the evidence, is a pass. Producing a confident wrong answer is the
only real failure. Any change that converts an honest refusal into a plausible guess is a
regression, however much better the demo looks afterwards.

---

### What this cost

Applying these rules to this demo found, in order: a mislabelled synthesis example that made a
correct engine look broken; a 14MB download with no progress indicator, indistinguishable from a
hang; a question parser that read the film *Inception* as a date-relation and answered a different
question entirely; an abstain message claiming an exhaustive search that never ran; and a
per-subject cap that had quietly deleted the answer to the demo's own headline example.

None of those were found by reading the code. All of them were found by using it as a stranger
would, then measuring what happened.
