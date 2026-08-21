# RJ's wishes — the canonical burn-down

Every ask from the 2026-08 demo sessions, in one place, with status and evidence. Priority is set
by me (Claude) per RJ's instruction; the ordering rule is: **credibility first, capability second,
polish third** — a resume demo dies on the first thing that looks broken, not on a missing feature.

Status codes: ✅ done+verified · 🟡 built, not watched in a browser · 🔴 open · ⛔ deferred by design

## Done

| wish | status | evidence |
|---|---|---|
| full graph, real, no caps | ✅ | 66,404,117 facts live; cap measured (1.58% loss) then removed |
| multi-hop "watch it think" + huge trace | ✅ | Melbourne→Australia→Canberra 89.7%; 5,015-step trace |
| trace = reasoning, not scanning (Claude-style) | 🟡 | HYPOTHESIS / REVISE / DEAD-END narration + live-hypothesis glow; not watched in motion |
| never give up; user stops it | ✅ | unbounded search + Stop; Stop bug (autorun bypassed runningQ) fixed |
| **ask questions back** | ✅ | **fires on 7/8 chain questions** (ambiguity-confirm: "which reading did you mean?"), options built only from found chains; verified headless |
| stream ALL results, ranked live | ✅ | live-ranked chain list + instant one-hop rows |
| stop/start buttons | 🟡 | root cause fixed (runningQ owned by reason()); logic-verified, not clicked |
| question bleed-through | 🟡 | 4 bleed paths sealed (tail render, per-node body, trace flush, ask-back); regression-clean |
| no autorun on load | ✅ | removed; stage boots alive, nothing fires until asked |
| static explainer → per-question explanation | ✅ | "What just happened" is generated from THIS run's counters; zero canned prose |
| debug logs for future sessions | ✅ | `window.__anchorLog` (structured, capped) + `window.anchorDump()` |
| zoo of random questions; fix fundamentals | ✅ | 40% → 90% → **97.5% hold-out**; entity linker redesigned (longest-span-wins) |
| Claude as stand-in/contrast | ✅ | 0/8 → 4/8; found O7 (inverse relations) — a bug no ground-truth test could see |
| full test suite | ✅ | `suite.mjs`: zoo + contrast + no-toys gate, pinned floors, non-zero exit on regression |
| bug list + real dev cycle | ✅ | `BUGS.md`: 11 fixed w/ root causes, open items owned |
| no-toys / anti-cheat law + gates | ✅ | `NO_TOYS.md` + `audit_demo.py`, 0 violations |
| whitepaper finished | ✅ | Result IV; 66/66 claims trace to artifacts |
| LinkedIn post | ✅ | drafted 3 lengths (no connector to post — RJ pastes) |
| three.js scene, WASD quake keys, no ship, node gridview | 🟡 | built + code-verified (380 objects); motion unwatched |
| path ≠ assertion honesty; samples removed; clone size | ✅ | all shipped |
| basics work ("what is an apple", plurals, "eat" not an entity) | ✅ | probe verified: cow(340) not [cows,eat]; worm the animal not malware; suite stayed green |
| footer links to whitepaper / bug ledger / no-toys / wishlist | ✅ | shipped |
| loading bar + live step-by-step narration at the bottom | ✅ | fixed bottom bar: current-step sentence, honest progress fill, pulse while downloading; 300ms liveness flush kills the "updates stop after a few seconds" freeze (B13) |
| 3D view shows the chains AS they complete | ✅ | liveAdd marks every completed chain's nodes+edges live (B12); was end-of-search, best-chain-only |
| visible build stamp (cache diagnosis) | ✅ | footer says `build 2026-08-21`; Pages caches HTML ~10 min, so "still auto-starts" = stale copy, provable on sight |

## Open — in the priority order I set

1. **O7 — inverse relations** ("capital" vs "capital of" → Barcelona→Catalonia). The only
   remaining source of confident-WRONG answers; the one unforgivable class. Fold the Abbey-Road
   one-hop-short case into the same matcher work.
2. **UI-in-motion pass (#132).** One visible-pane session (or RJ's 60-second click-through)
   collapses every 🟡 to ✅ or to a real bug.
3. **Debugger game** *(new wish, captured)*: after a conclusion, compile the winning chain into
   stepped pseudo-code — step/back through it watching a variables pane (subject, hop, k, p_hop,
   p_chain, shard), each step lighting its hop in 3D. Human help = at divergence points, switch to
   another chain the search ACTUALLY completed. Every value measured, nothing recomputed.
4. **Live "top 3 questions for you"** *(new wish, captured)*: while searching, keep a live-updating
   panel of the three questions whose answers would most move the search (ambiguous readings,
   endpoint disagreements, unopened high-fact frontier nodes) — updating in real time as it figures
   things out, each clickable to act. The ask-back-on-ambiguity (7/8) is the seed of this.
5. **Learn-on-abstain (#135)** — still never fired. Prove or delete; no third state.
6. **Liars Game, human-in-the-loop** *(new wish, re-scoped)*: a tab where the engine presents
   facts/chains and the HUMAN adjudicates in real time. RJ's framing solves the old provenance
   objection: the human judge IS the independent second anchor, so adjudications can honestly
   carry anchor semantics. Design before build.
7. **Spacegame in the demo** *(new wish, large — needs its own arc)*:
   - a tab hosting the three.js spacegame, restored to its ORIGINAL intent: the chat/arena where
     AIs battle to improve;
   - a fork `SpaceGame-simple` cut down to a verified end-to-end core (the main game has hundreds
     of half-finished features, e.g. ship upgrades);
   - removed features preserved as DATA in a front-end dashboard menu, so anything can be added
     back deliberately instead of rotting half-on.
   This is a project, not a task — schedule as its own session(s) with its own zoo-equivalent.
8. **Research tab: all the whitepapers** *(new wish, captured)*: a final tab collecting RJ's
   research artifacts in one place — the Anchor whitepaper (already ships), the Hadamard/KG work
   (`kg_hadamard.py` line), and the spacegame research corpus (PILLARS.md, the emergent-signaling /
   theory-of-mind / iron-law results). Execution note: these live in the PRIVATE fleet repo today;
   inventory first and confirm each is meant for public before copying — publishing is
   irreversible, and a paper's claims must pass the same trace-to-artifact audit the Anchor
   whitepaper passes before it ships on the public tab.
9. **Synonym layer (O4)**, then **latency (O5)** — exporter-side alias pass; IndexedDB or server.
10. ⛔ **Book ingest** — still deferred on provenance grounds (superseded in spirit by wish 6).

## Standing rules that got us here

Measure before defending. A bound is not an absence. A path is not an assertion. Disclosure rots —
gate it. The test set must be un-curatable. And every one of the 11 fixed bugs was found by
RUNNING the thing, never by reading it.
