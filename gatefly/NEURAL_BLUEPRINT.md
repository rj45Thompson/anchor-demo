# The neural blueprint: what a blueprint is here, what does not fit, and what replaced it

UC-GF-6 step 1. REQ-GF-6a: "does not fit" is a list of SPECIFIC NAMED FIELDS read out of the
files, never a judgement. Everything below was read from
`blueprint/city/data/pong_3d.js` and `blueprint/city/data/priorgpt_3d.js` on 2026-11-18.

## What a blueprint is in this repo

`window.BPV3D = { meta, bp2d, classes, interfaces, proposals, diagrams, graphs, calls, members,
paths, usecases, requirements, asks, questions, rules, ngl }`.

The drawable part is `bp2d[i].model`, with exactly four populated fields:

| field | what it holds |
|---|---|
| `nodes` | `{ name, cls, x, y, w, h, title, sub, compact, pill, knot, color, pins, delegate, refs }` |
| `wires` | `{ from, to, exec, color, a:[x,y], b:[x,y] }` |
| `comments`, `notes`, `box` | authored annotations and the 2D bounding box |

and a pin is `{ id, name, dir, exec, color, label, def, linked, x, y }`.

Pong's `BP_Ball` has **23 nodes and 30 wires**. `priorgpt_3d.js` has `bp2d: []` and carries its
graph in `classes` instead - `{ name, parent, parentWhy, parentChain, components, fields, methods,
uses }`, where a method is `{ name, alias, title, kind, sig, owner }`. So the repo already has two
blueprint kinds: an Unreal graph and a CODE graph. Neither is a tensor graph.

## What specifically does not fit a net

Each row names the field and the neural fact it has nowhere to put.

| the field | why a net cannot use it |
|---|---|
| `node.x`, `node.y`, `node.w`, `node.h` | an AUTHORED 2D layout, read from the paste. A net has no authored layout: its geometry has to be DERIVED from (site, unit index). 800 units cannot be hand-placed, and were not. |
| `node.pins[]` with `id`, `name`, `label` | a pin is a NAMED, TYPED port. A weight matrix's connections have no names and no types; `blocks.0.ffwd.net.2.weight` alone is 32x128 = 4,096 scalar connections, against 23 nodes' worth of pins in all of Pong. Giving each one a pin id would be a lie about what it is. |
| `pin.exec`, `wire.exec` | EXECUTION FLOW. A net has none: every unit of a layer computes at once, and the only order is the layer order. The exec channel would be dead in every neural blueprint, and a dead-but-present field is the kind of thing that later gets filled with something made up. |
| `wire.a`, `wire.b` | a wire's authored 2D endpoints. Derived here, like the positions. |
| `wire.color`, `node.color` | authored colour. In a net the colour must CARRY a measurement - the gate - or it says nothing. |
| `node.cls`, `node.title`, `node.sub`, `node.refs` | a node is a STATEMENT (`K2Node_CallFunction`, "Add Actor World Offset"). A neuron has no statement, no title and no source reference. |
| `classes[].fields` / `.methods[].sig` | the code blueprint's unit is a declaration with a signature. A net's unit is a tensor slot: (site, index), with a shape and a dtype, none of which has a field here. |
| **missing entirely** | a per-unit MEASURED SCALAR. There is no field anywhere in `BPV3D` for a number attached to a node that came from measuring the thing, which is what a gate is. The city lights a node when it FIRES - a boolean - and a gate is a continuous fraction in (0,1) that does not change as the thing runs. |
| **missing entirely** | a LIVE channel. Nothing holds a value that updates per frame while the game plays, so an activation has nowhere to live either. |
| **missing entirely** | a stated edge CAP. A blueprint draws all 30 of its wires. A net cannot draw all 17,216, so the format has to say what it dropped (NO_TOYS rule 2). |

## What replaced it: `neural-blueprint v1`

Emitted by `gatefly/gate_read.py`, read by `harness/gatefly/index.html`.

```
{ format: "neural-blueprint v1", of, about, source_checkpoint, hyper, parameters,
  quantity: { gate, a, c, C, not_an_activation },      // what the numbers MEAN, in the file
  layers: [ { id, name, site, kind, units, writes_into, lambda, cond_I_plus_A, lane_site,
              refused, refused_why?, median_gate, median_a, median_c, min_gate, max_gate,
              median_crowding_fraction, x, grid_side, cell } ],
  units:  { n, layer[], index[], a[], c[], gate[], pos[] },   // parallel arrays, one per unit
  edges:  { from[], to[], w[], kept, considered, dropped, keep_per_unit, threshold_rule },
  checks: { hand_check, sites_refused, sites_drawn } }
```

What it has that a blueprint does not:

1. **A measured scalar per unit** - `a`, `c` and `gate`, with `quantity` saying in the file what
   each one means and that a gate is NOT an activation.
2. **A site, not a statement** - `layers[].site` is the tensor's own name
   (`blocks.1.ffwd.net.2.weight`), `kind` says whether its units are neurons, attention slots or
   residual dimensions, and `lane_site` marks the one the ratchet lane reads in GPT-2.
3. **Derived geometry** - `pos` and `grid_side` are computed from (site, index), not authored.
4. **A stated cap** - `edges.dropped` and `threshold_rule` say how many weights are NOT drawn.
5. **A refusal** - `refused` and `refused_why` for a site whose gate is undefined, rather than a
   gate of 0.
6. **A hand check in the file** - `checks.hand_check` carries the pipeline's figure, the same
   figure computed by a path that shares no code with it, and their difference.
7. **A live channel** - the page loads the net's own f16 checkpoint beside the blueprint and
   RUNS it, so a unit can show a live activation next to its static gate, labelled as a
   different quantity.

## What it does NOT do, so the claim stays the size it is

It does not replace the Unreal blueprint or the code blueprint: an exec graph of 23 named nodes
is the right format for Pong's gameplay logic, and `classes/methods/sig` is the right format for
reading source. This is a third kind beside them, for the one thing neither can hold.
