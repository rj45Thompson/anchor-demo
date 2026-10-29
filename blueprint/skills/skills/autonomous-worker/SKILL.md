---
name: autonomous-worker
description: Use when the user hands over a long multi-item job and wants it FINISHED without the session stopping early to ask permission or to report progress - "finish it all", "work through the list", "keep going until done", "/autonomous-worker", "don't stop", "loop until stagnant". Keeps a durable file-backed task list (./TASKS.md) that survives context compaction, loops item by item until a pass moves nothing, verifies each item against a named observable before marking it done, records blockers instead of halting on them, and reports once at the end.
---

# Autonomous worker

The user is not watching. Stopping to ask costs them a round trip and often a whole
evening. The job is to FINISH, and to be honest about what finished.

## 0. FIRST, EVERY TIME - read the list off disk

Your first tool call under this skill, and again at the top of every item:

    Read ./TASKS.md          (step 1 creates it if it is missing)

Not "if context was compacted" - you cannot perceive your own compaction, and the run
that most needs this reminder is the one that already lost it. So make it
unconditional. Re-reading a 30-line file costs nothing. Reporting "done" for work you
can no longer see costs the whole run. **The file is the source of truth; your memory
is not.**

## 1. First action - write the list

**ADOPT, DO NOT FORK.** First look for a list that already exists - `TASKS.md`, a
`*_TASKS.md`, or the tracker the user named. If one is there, USE IT, whatever it is
called. A second list is worse than none: the moment two exist, one of them is silently
going stale and you cannot tell which one the next session will read. (Measured
2026-08-31: this skill's own first run created `TASKS.md` alongside an existing
`BLOCKPAINTER_TASKS.md` and left both on disk.) Only write a new file when no list exists.

Then write the list. One line per item, in this exact shape:

    - [ ] ID  <verb + target>  -> DONE WHEN: <observable a stranger could re-check>

GOOD - `- [ ] T3  null-guard OptionsPanel.Show -> DONE WHEN: OptionsPanelTests.Show_NullOverlay_DoesNotThrow passes`
BAD  - `- [ ] T3  look at the options panel`   (no verb, no observable, can never be honestly marked done)

Markers: `[ ]` open, `[x]` done + evidence, `[!]` blocked + measurement, `[-]` dropped +
reason. If the job arrived as prose, decompose it into these lines FIRST. A vague line
is a line you will later tick on vibes.

Keep the file SKIMMABLE. Open items at the top, done items below them, and evidence held to the one or two lines
that carry the number - a `[x]` line that runs to a paragraph belongs in the commit message, with the list keeping
the claim and the figure. A task list nobody can scan is a task list the next session re-derives from scratch.

## 1b. If the user gave a TIME BOX or a REPORT POINT, that outranks the loop

"work for an hour and report", "check in at 5", "one pass then tell me" - the termination test below is NOT the
whole contract when the user named a time or a checkpoint. Measured 2026-09-06: the invocation said "Work for one
hour, then report"; this file said the loop ends on stagnation and nothing else, so the run continued well past the
hour and the user had to ask twice for the report they had already requested.

At the top of the run, write the deadline into the list as a line of its own:

    <!-- time box: report at 22:06Z (one hour from 21:06Z), asked for in the invocation -->

Then: take the clock at the top of every pass (`date -u +%H:%M`). When the box is spent, STOP TAKING NEW ITEMS,
run the verification gate, and report. If work is genuinely mid-flight, finish that one item first - never leave a
half-applied edit - then report. The user may say "continue" after; that starts a new box, it does not retro-extend
the old one. With no time box given, the stagnation test below is the whole contract.

## 1c. A message from the user mid-run outranks everything on the list

The user is not gone just because the run is autonomous. When a new instruction arrives, it is the highest-priority
item - fold it in as `[ ]` lines immediately, before continuing. Do not finish the current sweep first and do not
treat "do not stop to report" as a reason to ignore new direction: that rule is about volunteering status, not
about deafness. If the new instruction contradicts an open item, mark the old one `[-] superseded by <what>`.

Measured 2026-09-06: eight instructions arrived during one run (deprecate a window, more looks, AAA quality, a
properly mapped mesh, a washed-out planet, invisible droids, agent sprawl). Every one was a real change of
direction, and treating them as interruptions to be batched would have produced an hour of the wrong work.

## 1d. ONE agent

Do not spawn subagents, forks, or workflow fan-outs from inside this loop. Do the work in this session.

Measured 2026-09-06: six spawned CLI workers were alive at once and kept launching more, until the user stepped in
and capped it at one agent each. The spawnAgent default is Opus + ultracode, so a fan-out is
not a small cost. If the job is genuinely too big for one session, say so in the report and let the user decide.

## 2. The loop

Repeat until the termination test fires:

1. Read `TASKS.md`.
2. Take the topmost `[ ]` item.
3. Do it.
4. Verify against its DONE WHEN, then rewrite that line in place with the evidence:
   `- [x] T3  null-guard OptionsPanel.Show -> PASSED Show_NullOverlay_DoesNotThrow (12/12)`
5. Append any new work that surfaced as fresh `[ ]` lines. Go to 1.

At the end of each pass over the remaining open items, append a counter line to the file:

    <!-- pass 3: 2 done, 1 blocked, 1 appended -->

**STAGNANT = one complete pass in which nothing moved to `[x]` or `[!]` and nothing new
was appended** (a `0 done, 0 blocked, 0 appended` line). That is the termination
condition. Otherwise you stop only when no `[ ]` lines remain, or a DO-stop trigger
below fires. Nothing else ends the loop - not "this feels like a good place to check
in", not a long turn, not context pressure. Update the file and keep going.

## Definition of done, per item

An item is done when its OBSERVABLE is true, never when the edit is written:

| kind of work | what "done" means |
|---|---|
| code change | it COMPILES, and the relevant test passes - name the test |
| bug fix | the failure is REPRODUCED first, then gone, and something guards it |
| tool | it RAN, on the real input, and its output was inspected |
| UI change | it was rendered and LOOKED AT, not just typechecked |

Write the evidence next to the item. "Fixed" with no observable is not done.

## Nothing ships without a line

If you find yourself about to commit, check in, publish, or hand over something that has
no line in the file, STOP and add the line first - with its DONE WHEN - then satisfy it.

This is not bookkeeping. The DONE WHEN is the only thing that makes you check; work that
never became an item never gets checked. (Measured 2026-08-31: a UI panel was written,
typechecked and CHECKED IN without ever being rendered, because it was done as a side
quest and so never acquired the "DONE WHEN: rendered and looked at" that every other UI
item had. It was caught later by luck, not by process.)

The rule is not "add it afterwards for tidiness". It is: an item with no observable is an
item you will ship unverified.

## 1e. THE TURN BOUNDARY IS NOT THE END OF THE RUN

This is the defect behind six unwanted stops in one session, each one restarted by the user, and the file did not
cover it. "Batch the reporting" was read as "report once per turn", which is once per few minutes.

**A report is the LAST thing in a RUN, not a habit at the end of a TURN.** Before you write a
closing summary, look at the list. If an open `[ ]` item exists and nothing in DO-stop applies, take
it instead. Writing prose is not progress and a well-written status is still a stop.

The test, applied literally: *is there an item I could start right now?* If yes, start it. The run
ends when the list is empty, stagnation fires, a DO-stop trigger fires, or a time box is spent.
Nothing else, and specifically not "this is a natural place to check in" or "I have a satisfying
amount to report".

**A "not done" line in a report is an open item you skipped.** Before the report, read your own draft:
every "not done", "remaining", "next would be", "could also" that you are able to do without the user
goes back on the list as `[ ]` and gets done. A report may only list as not done what is BLOCKED (on the
user, hardware, a decision) - with the block named. Measured 2026-10-24: a run closed its list
by marking items `[x] ... NOT done: cliff relief` and reported "Not done: cliff relief, a close frame
of a disc", and the user had to ask why it had stopped. Tucking work into a done
line's evidence is the same stop with better manners.

## 1f. EVERY ITEM MUST EARN ITS PLACE AGAINST THE USER'S OWN WORDS

Pin the user's acceptance test at the TOP of the list, quoted in THEIR words, before any item:

    <!-- ACCEPTANCE (the user's own words): "a player can finish a battle end to end: the turns,
         the cameras, the abilities and the effects" -->

Then every item answers: does this move that line? An item that does not is a `[-]` with the reason,
however interesting it is.

Measured 2026-09-26: a run spent a long stretch chasing 1-ULP differences in Quaternion members
while the stated goal was a working Unreal build, until the user stopped it.
The work was real and correct and it was not the job.
The same run then reported completion percentages against denominators it had invented, which is
the same failure wearing a tie: **progress is measured against the user's acceptance test, never
against your own plan.** If you catch yourself quoting a percentage, say what the denominator is in
the user's words or do not say it.

## 1g. NEVER BLOCK A TURN ON SOMETHING SLOW

Builds, engine launches and imports here run 90 seconds to 7 minutes. Waiting on them synchronously
spends the turn doing nothing, and several turns in one session went that way.

Background anything over ~60s and do other list items while it runs. A polling loop that sleeps is
the same mistake with extra steps. Reorder around it as 1h (below) already says, and come back when
the notification arrives.

## 1h. WHEN BLOCKED: SOLVE IT OR ASK. NEVER PIVOT SIDEWAYS.

The worst failure in a long run is not stopping and it is not guessing. It is DRIFTING: hitting a
real blocker on the item that matters and quietly starting adjacent work that does not.

Measured 2026-09-27, one Unreal-port run: blocked on getting a managed actor to spawn, the run
produced a conformance harness, a seam map, a logic digest, a hole-finder, a render smoke test and a
plugin gate. Every one was sound, none was the thing asked for, and the user's summary was "far from
complete ... I imagine if I try nothing is working at all." Six good instruments do not add up to one
working slice.

When the top item blocks, there are exactly two moves:

1. **Solve it.** Dig into the actual blocker. Read the engine's source, probe the API, try the next
   approach on the SAME item. This is almost always the right move and it is the one that feels
   slow.
2. **Ask.** One precise question naming the decision only the user can make, e.g. "may I write C++
   in this module?". Then stop on THAT item and take the next unrelated `[ ]` item.

What is NOT a move: inventing a nearby task because it is tractable. Tractability is not relevance.
If you notice yourself building a tool when the item called for a result, you have already drifted -
go back to the item.

**Build a tool only when the item cannot be verified without it.** A measurement instrument is
justified when it is the DONE WHEN, never as a consolation prize for a blocked one.

## Do not stop for these

- Reversible work that follows from the original request. Just do it.
- Choosing between two reasonable implementations. Pick the better one, say which and why.
- A tidy-up you noticed on the way (dead code, a missing guard, a stale comment).
- Wanting to report progress. Batch it - one report at the end, or when something changes
  the plan.

## DO stop for these

- Destructive or outward-facing actions: deleting data, force-pushing, sending anything,
  publishing, spending money.
- A genuine scope change - the user asked for X and the honest fix is a different X.
- A decision that is the user's to make: licensing, product behaviour, what a look should be.
- Anything a standing rule in the project forbids (in this repo: running the Unity test
  runner without an explicit go-ahead; auto-answering a modal in the live editor - EXCEPT
  Unity's "The open scene(s) have been modified externally", a standing exception the user
  granted: click Reload when the scene has no unsaved changes, keep the user's work (Ignore)
  and say so when it has).
- The user is working in the Unity editor: do not touch it - no bridge renders, compiles or
  asset writes. Do the work that needs no Unity, and resume the Unity steps when the user says
  the editor is free.

## The list lives in the REPO you are changing

`./TASKS.md` means the tree whose files you are about to edit, not whatever directory the
session happens to have started in. A session can be opened in one repo and asked to work
in another; putting the list where the work is not is how the next session finds nothing.

"ADOPT, DO NOT FORK" means adopt a list for THIS project. A big `TASKS.md` belonging to a
DIFFERENT project in the same session is not the list to adopt - check what it is about
before writing into it. (Measured 2026-09-06: a run in `<another project>` nearly adopted
`<workspace>/TASKS.md`, 142KB of another project's work, because both are "./TASKS.md" from
some point of view.)

## Someone else may be editing the same tree

Before the first edit, check whether another agent or another session is live in this repo:
`git log` with times, `git status`, and file mtimes over the last hour. A second worker
committing every few minutes is not hypothetical and it is not visible from your own context.

If there is one, do all three:

1. **Take a lane and write it down** - put a "hands off" list of THEIR live files at the top
   of `TASKS.md`, and stay out of those files even when you find a real bug in one.
2. **Report the bugs you find in their files instead of fixing them.** A verified finding with
   its file:line and its reproduction, recorded in the shared list, is worth more than a patch
   that collides. Losing the finding is the only failure mode here.
3. **Stage precisely.** `git add -A` will sweep their half-finished work into your commit. Stage
   named files; if one file holds both your change and theirs, build the blob you mean with
   `git show HEAD:file > tmp`, edit that, `git hash-object -w --path file`, `git update-index
   --cacheinfo`, and leave their working tree alone.

(Measured 2026-09-06: a lane ran alongside another agent making ~1 commit per 4 minutes in the
same repo. Zero collisions, because the lane was declared before the first edit - and one
`index.html` commit had to be staged by hash because the other agent's version bump sat three
lines from my own change.)

## Do not contaminate what you are measuring

A probe that changes the system has not measured it. This bites hardest in a live page or a
long-running process, where your scratch names share a namespace with the program's.

- Wrap every injected probe in an IIFE, or namespace it. A bare `var x =` at global scope in a
  browser page **overwrites a global of that name** in the program under test.
- Restore anything you monkey-patch in a `finally`, not at the end of the happy path.
- After a probe, check the program still works before trusting the numbers it just gave you.

(Measured 2026-09-06: a one-line profiling probe declared `var rr = ...`; the game under test
had a global `rr()` that draws every rounded rectangle. The game threw "rr is not a function"
on every label from then on, and the run AFTER that read 31.6 ms/frame against a true 15.3 - it
was measuring its own damage. It was caught only because that game happens to show a crash
banner. Assume yours does not.)

**Drive the WHOLE loop, not the part you think matters.** When you hand-step a system to measure it, step every
function the real loop steps, in the real order. A subset silently freezes whatever you left out, and then you are
measuring a state the program never has.

(Measured 2026-09-06, same run: a visibility test stepped `step()` and the subsystem under test but not
`updateCamera()`, so it projected objects against a camera frozen at page load. It reported 0 of 240 samples on
screen and would have justified a second round of "fixes" to something that was not broken. With the camera
stepped too, the same code measured 66%. The first number was not a small error - it was the opposite conclusion.)

**A measurement that contradicts what you can see is the measurement's problem until proven otherwise.** Open the
screenshot, or read the value the program itself displays, before you act on a number that says everything failed.

## Before starting anything long, check what it blocks

Long background work (a test suite, a build, an import) often makes the NEXT items
impossible while it runs - it can take a lock, saturate the machine, or steal focus. Look
at the remaining `[ ]` lines before you launch one, and reorder so the blocked items are
not next. (Measured 2026-08-31: a full test-suite run was launched immediately before an
item that needed the editor, and the suite's own second editor stole the window.)

Reordering is free. Discovering the conflict halfway through is not.

## When an item blocks

Do NOT halt the run. Record and continue:

1. Rewrite the line: `- [!] ID  blocked: <what failed, measured> | need: <the one thing>`.
2. Take the next item.
3. Surface every blocker in the final report.

A blocked item is information, not a stopping condition.

## 3. The verification gate - run this BEFORE the report

Not a sentiment, a pass. Walk every `[x]` line in the file and answer out loud:

1. Does the line name a real observable, or just say "fixed"? No observable -> `[ ]`.
2. Re-run / re-read that observable **now**, this turn. Memory of it passing is not
   evidence; a test that passed 40 turns and 6 edits ago is unverified.
3. Did it actually reproduce? No -> flip back to `[ ]` or `[!]` and say so.
4. Is the change where the user will look - the live tree, not a clone or scratch copy?

Order the gate by what a later edit could have broken, not by the order the items were done: anything touching a
file that changed after its check, first. If the gate cannot be finished inside the time box, verify those and say
plainly in the report which lines are **claimed but not re-verified** - an honest gap beats a blanket "all done".

Only lines that survive all four may be reported as done. A run that reports work it
cannot demonstrate is worse than a run that did less.

## 4. The final report

One message. Lead with what changed and whether it works. Then:
- what got done, with the evidence for each
- what is blocked, and on what
- what you deliberately did NOT do, and why
- the single most useful next thing
- where the list lives, so the next session resumes instead of restarting

**Do NOT include advice on how to prompt this skill better.** If a run only went well
because the user phrased the request a particular way, that is a DEFECT IN THIS FILE, not
a lesson for them. Fix the file instead - the behaviour should be automatic. The user
should be able to type `/autonomous-worker do the thing` and get the same discipline they
would get from a carefully worded paragraph.

Never end a turn with a plan you could have executed. If the last paragraph is "next I
will...", go back to step 2 and do it instead.

## 1i. LESSONS THIS FILE EARNED ON 2026-09-28/29 (a 16-hour, 81-agent port run)

Each of these cost real time or real trust. None is theoretical.

- **Headless is not a flag you claim, it is a window count.** `UnrealEditor-Cmd -ExecutePythonScript
  -unattended` put TWO visible editor windows on the user's desktop (measured: 102 polls over 30 s);
  `-RenderOffScreen` puts zero. `-unattended` only changes the prompt action. If a tool can steal
  focus, prove it does not, with a probe, and put the proof behind a gate that names no executable.
- **A picture is never the proof, and a frame sent early is worse than no frame.** The user's words:
  "until the basics are done there is no reason to screenshot it's all fake puppet show". Ship counts
  first (how many objects, what residual, against what floor); a rendered frame is a courtesy after.
- **Measure before you hypothesise, and say so when the measurement refutes you.** Two confident
  explanations for a dark scene (the sun, then the skylight) were both refuted by sweeps; the real
  cause was our own exposure pin making every frame exactly 4x too bright. Sweeping one variable with
  the others pinned found it in one pass; arguing about it would not have.
- **Stop a background run only after its structured result lands.** The evidence line is written
  BEFORE the result; killing in between loses the step and its cache entry, and the work has to be
  hand-fed to the next agent.
- **Editing a workflow script that is running: freeze the cached prefix.** The runner keys its cache
  on (prompt, opts) per call, so any edit to an embedded constant re-runs every completed step. Keep
  a pre-edit copy and diff the frozen entries before resuming.
- **A gate that goes red on someone else's data must not halt your run.** A teammate's asset edit
  reddened a parity gate mid-run and stopped the whole port; the fix is to distinguish "the product
  still works and the diff names a file we did not touch" from "our code broke" and record the first
  rather than dying on it. Never re-baseline someone else's work without telling them.
- **⚠ THIS FILE IS 350 LINES AND ITS OWN RULE SAYS ~180.** Before adding anything else, cut the
  weakest rule instead of appending. That is now the first job of the next run that touches it.

## Changelog

- 2026-09-27 added 1e, 1f, 1g from a measured Unreal-port run.
- 2026-09-29 added 1i from a 16-hour port run: headless is a window count, pictures are not proof,
  measure before hypothesising, stop only after the result lands, freeze a running script's cache
  prefix, and a foreign-data red must not halt the run. Flagged the file's own length for trimming.
