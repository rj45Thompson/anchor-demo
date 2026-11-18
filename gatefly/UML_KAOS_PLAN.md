# The UML x KAOS hybrid, planned to its maximal potential

RJ, 2026-11-18: *"Make sure the UML and KAOS hybrid is planned to its maximal potential. And add
it to the light loop if the other agents agree."*

This is the plan, separated from what is built. **Built so far is section 1. Sections 2 to 5 are
not built**, and each says what it would cost and what would make it worth building. Nothing
below is described as working unless it is.

---

## 0. What each half contributes, and the one thing neither has

| | KAOS gives | UML gives |
|---|---|---|
| structure | AND/OR goal refinement | containment, «deriveReqt» - AND-shaped only |
| failure | **obstacle analysis**: negate a goal, refine the negation | - |
| linkage | - | **«satisfy» «verify» «refine» «trace»** to real artefacts |
| actors | agents, responsibility assignment | actors, use cases |

**Neither gives OR-refinement in UML.** Containment and «deriveReqt» are AND-shaped, so the OR
edge - the one carrying *"this route alone would settle the parent"* - has to be added as a
stereotype with its own semantics. That edge is what makes RJ's "would solve" and "might solve"
lists computable instead of judged, so it is not an optional extra.

**And neither resolves its own links.** A traceability matrix whose links are asserted reports
full coverage over links that went stale. That is the failure this hybrid exists to prevent and
it is the one thing here that could not be done on a whiteboard.

---

## 1. BUILT: refinement, resolved links, obstacles, and a gate

`gatefly/problem_tree.py` (25 nodes, AND/OR, root *why can't we build a perfect editor*) and
`gatefly/uml_kaos.py`.

- «satisfy» -> the artefact that realises a node; «verify» -> the **plant** that tests it.
- Every link is **resolved against the source**: a «verify» link names a plant and that plant's
  own label must appear in the named file.
- KAOS **obstacles** per node, each with its mitigation or a plain statement that there is none.
- Runs as a **light-loop-style gate**: refuses on a link that does not resolve, or a node
  asserted `settled` with no plant. Unrealised and untested nodes are honest work-not-done and
  do **not** refuse.
- 8 plants, both directions on the resolver and on the map.

**What it found on its first run**, which is the argument for the whole thing:

1. A **semantic bug in the tree**: two confirmed *blockers* were marked `settled`, so the solver
   was counting a route **known to fail** toward its AND-parent being solved.
2. A **broken «satisfy» link** (`Oracle.grade` did not resolve).
3. **Two nodes asserted settled with no plant** - claims resting on run output rather than on a
   test that can fail.

Current state: 25 nodes, **12 leaves unrealised, 12 untested, 19 unanalysed**, 3 covered.

---

## 2. NOT BUILT: obstacle refinement as a first-class tree

Obstacles are currently a flat list per node. KAOS refines an obstacle the same way it refines a
goal - AND/OR, down to *basic* obstacles - which is what turns "what could go wrong" from a
brainstorm into a walk.

**Worth building when** a node has more than ~3 obstacles, or when two obstacles turn out to
share a cause. Today 19 of 25 nodes have **none**, so the gap is breadth, not depth: enumerating
one obstacle per node beats refining the six that exist.

## 3. NOT BUILT: agents and responsibility assignment

KAOS assigns each leaf goal to an **agent** that can achieve it alone. Here the agents are real
and distinct: this lane, the ratchet lane, the v4 lane, and *the literature*. A leaf assigned to
"the literature" is a prior-art search, not an experiment - and `E2.2` (attribution unreliable
at depth) is already marked `external` by hand for exactly that reason.

**Worth building when** more than one lane edits the tree. It would answer "who is blocked on
whom", which three parallel lanes currently answer by messaging each other.

## 4. NOT BUILT: «refine» links to the use case model

`gatefly/UC_GATEFLY.md` already has numbered steps with observable outcomes and REQ- rules
linked to steps. Right now the goal tree and the use case model are two unconnected
descriptions of the same work. A «refine» link from each tree node to the UC step that
operationalises it would let one query answer *"which use case step is this goal's
implementation, and does that step have a plant?"*

**This is the highest-value unbuilt item.** It costs an afternoon, needs no new concepts, and
would catch the specific drift where a use case step is written, the goal moves on, and the step
is never revisited.

## 5. NOT BUILT: the gate on the OTHER direction - artefacts with no goal

Today the gate walks goals and asks what realises them. The reverse walk asks: **which modules,
plants and run files serve no node of the tree?** That finds work nobody can say why they did,
which is the complement of work nobody did.

This lane has 17 run files and ~18 modules; a reverse walk would be cheap. **Worth building
alongside section 4**, since both need the same index.

---

## The argument for putting section 1 in the light loop

**For.**

1. **It has already caught three faults in the lane that wrote it**, within seconds of first
   running, including a claim counted backwards. A check that only fires on other people's work
   has not been tested.
2. **It refuses on claims, not on gaps.** A standing check that fails because work is unfinished
   gets switched off within a week. This one is silent about unrealised and untested nodes and
   refuses only on a link that does not resolve and on `settled` asserted without a plant - both
   of which are *assertions that something is true*.
3. **It is cheap and has no external dependency**: pure Python, reads source, no model, no GPU,
   sub-second.
4. **It closes a hole the light loop already cares about.** That loop's own rule is that a
   planted fault must move a verdict. This gate catches the case *one step earlier*: a verdict
   with no plant behind it at all.

**Against, stated because the decision is not mine.**

1. **The tree is this lane's**, and a gate over it in a shared loop makes one lane's model of
   the problem into everyone's. That is a real cost and the honest mitigation is that the tree
   must then be editable by the lanes it binds.
2. **A tree nobody updates rots**, and a rotten tree that still passes its gate is worse than no
   tree - the exact failure mode of every traceability matrix ever abandoned.
3. **Sections 2-5 are not built**, so adopting section 1 adopts a partial thing.

**My position:** adopt section 1 only, keep the refusal narrow to resolve-failures and
unplanted-settled claims, and do not adopt the gap counts as a gate until section 4 connects it
to the use case model. **But the decision belongs to the lanes it would bind**, which is why
they are being asked rather than told.
