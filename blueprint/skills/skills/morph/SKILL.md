---
name: morph
description: |
  Morphological analysis (Zwicky) of an option space: name the DIMENSIONS
  of a design problem and every VALUE on each, then account for every
  cell as either PRESENT (with a `where` that resolves) or ABSENT (with
  a `why`). Use it whenever the ask is about "the options" - adding
  settings to a tool or a tab, "every option you could think that I
  would want", "did we cover everything", "what is missing", reviewing
  a feature's surface before calling it done, or deciding whether a new
  control is a new axis or a new value on an existing one.

  Trigger phrases: /morph, "morphological analysis", "the options",
  "every option", "did we miss anything", "is this complete", "what
  else would I want", "option space", "Zwicky", "cover the space".

  The box is gated by a real script - a box that is only written is a
  claim, not an analysis. Pairs with /decide (which routes a single
  decision through the reasoning matrix); this one covers a SPACE.
allowed-tools: Read, Bash, Grep, Glob, Agent, Write, Edit
---

# /morph - morphological analysis of an option space

Fritz Zwicky's method (1969): define the *dimensions* of a problem and the possible
*values* on each, lay them out as a box, and work the cells. The framework writeup in
this repo is `<workspace>/Tools/Copilot pilot/copilot pilot/proof/neurogolf_2026/MORPHOLOGICAL_MATRIX.md`.

**Why it exists.** Without it, an option space is whatever occurred to whoever was
typing. Twice in one week (a backdrop's settings on 2026-09-21, the rope mounts on 2026-09-24)
the request was for every option a user could want; both times the first cut was thin, and both times the gaps were
findable in ten minutes by asking what would have to CHANGE for this to be a different
instance.

## The tool

```bash
py <workspace>/.opus-tools/morph_box.py --new "<subject>" > <workspace>/.opus-tools/morph_boxes/<name>.json
py <workspace>/.opus-tools/morph_box.py <workspace>/.opus-tools/morph_boxes/<name>.json --verify-present
```

It exits 1 and names the offending dimension and cell when a cell has no verdict, a
PRESENT has no `where`, an ABSENT has no `why`, a dimension has fewer than two cells, or
a name is duplicated. `--verify-present` OPENS every `where` and proves the symbol is
there; an unresolved read is a failure, never a warning (CLAUDE.md, IRON LAW 1).
`--selftest` runs the rule against synthetic boxes, including its own null case.
Worked example that ships and passes: `.opus-tools/morph_boxes/rope_mounts.json`.

## The method

1. **Name the subject** as a noun a designer would use. "A thing hung on a rope", not
   "RopeMount's fields". The wrong subject gives you the class's members back.
2. **Find the dimensions** by asking what would have to CHANGE for this to be a
   different instance. A dimension with one value is not a dimension, it is an
   assumption - write it down as a one-value dimension anyway, because that is where the
   holes are. MEASURED example: the Water tab's placement is
   `inst.transform.rotation = Quaternion.identity` and nothing else
   (`BlockTilePainterWindow.Water.cs:705`), so "which way it faces" is a real dimension
   with exactly one value and no stated reason - a river is unreachable.
3. **List every value**, including the ones that are not built.
4. **Classify every cell.** Exactly two verdicts, never a third:
   - `PRESENT` with a `where` (file:line, or `path:symbol`) that resolves;
   - `ABSENT` with a `why`, and where possible what to use instead.
   An ABSENT with no reason is a guess wearing a verdict. This is the repo's NO GUESSING
   law applied to design space instead of to data.
5. **Cross the axes.** The holes that matter are usually in the product, not in one
   column. MEASURED: BackdropAutofit has an Anchor axis (Centred/Top/Bottom) and an op
   axis; `ApplyBackdropFitLift(root, rep, anchor)` takes the anchor and
   `ApplyBackdropFitSize(root, rep)` does not
   (`BlockTilePainterWindow.BackdropAutofit.cs:724` vs `:757`), so three cells of that
   sub-box do not exist - and the window draws the anchor popup three lines above the
   button that ignores it.
6. **Diff every surface** that exposes the space. A window and an HTTP route are two
   spellings of one box and they drift in BOTH directions. MEASURED: `/backdrop/autofit`
   accepts `apply=size` alone, which the window never offers; the window's Cards op is
   not an `apply` value at all, it is a separate route.
7. **Axis or value?** Before adding a control, ask whether it is a new dimension or a new
   value on one that exists. `BlockTilePainterWindow.Trees.cs:618` already reasons this
   way in its own comment: *"SWAY OFF IS ONE VALUE, NOT A SECOND MECHANISM"*.
8. **Run the gate.** A box that is only written is a claim.
9. **Fill the holes, or record the ABSENT with its reason.** Both are finishing. Neither
   is optional, and "I'll note it" is not either one.

## Use the agent toolset for step 2 and 3

Dimensions are cheap to generate and expensive to generate WELL, and a single reader
anchors on the code in front of them. Fan out one agent per surface that exposes the
space - the window, the HTTP route, the pure rules file - each asked for dimensions and
values **with file:line**. Then reconcile. Divergence between two agents' boxes is the
finding, not a disagreement to average away: it is usually a real surface divergence of
the kind in step 6.

Spot-check the citations by opening the files yourself. An agent report is data, not a
result. (Three of this skill's own measured claims were re-read before being written down
here; all three held.)

## What a gate can and cannot do - measured, so nobody re-derives it

- It CAN check that the box is complete: every cell classified, every `where` resolving,
  every `why` present.
- It CANNOT enumerate values that only exist at runtime. The Trees tab's Set and Type
  filters are built from an asset scan (`Trees.cs:437`, `:491`) and their legal values
  change per category.
- It CANNOT reach an option whose only control is a Scene-view gesture. Trees' dialled
  yaw is `[SerializeField] treeManualYaw`, written ONLY inside the Shift-drag handler
  (`Trees.cs:1350`); the tab displays the angle and offers Clear, with no field to type
  one into. That is a value on a dimension the tab names and cannot reach.
- It CANNOT see an option whose home is a ScriptableObject, a scene component or a static
  (`TreePaletteAsset`; `WindZone.windMain`; `GaiaWindEditorPreview.Enabled`).
- The nearest existing instrument, `/blockpainter/draw-audit`, enumerates FIELDS and only
  proves the tab does not throw - the codebase says exactly that about itself at
  `CopilotBridge.cs:4831`.

So the gate checks the box; a person or an agent still has to WRITE the box by reading
the code. That division is the point, not a shortcoming.

## Keep the box next to the code

The rope mounts' box lives as a comment block in
`<game>/Assets/Media/Scripts/Ropes/RopeMount.cs` (`THE OPTION SPACE`), and
`RopeMountOptionSpaceTests` fails if a dimension or an ABSENT reason is deleted from that
header, or if two values on the facing axis pose identically. A box in a separate document
rots; a box the tests read does not.

## Where to put the JSON

`<workspace>/.opus-tools/morph_boxes/<subject>.json`. That directory is checked in, so a
box is a durable artifact and the next session inherits the analysis instead of redoing it.
