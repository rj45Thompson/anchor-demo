# agentbox

The help chat on the resume page, backed by a Claude Code CLI agent with **every tool switched
off**. Text in, text out, nothing else.

## Run it

```bash
py agentbox/server.py
```

Binds `127.0.0.1:8778`. The page probes `/health` and goes live on its own; when this is not
running the chat box says **offline** and points the reader at the CV tab, the PDF and an email
address. It never fakes an answer to cover an unreachable backend.

Prove the lockdown without spending a token:

```bash
py agentbox/server.py --selftest
```

## What stops a stranger doing damage

In descending order of how much each layer actually matters.

**1. The agent has no tools.** This is the only layer that really counts. Prompt injection is not
a filtering problem: a model cannot reliably tell its operator's instructions from text a stranger
typed. So the answer is not "detect the attack", it is "have nothing worth reaching".

| flag | effect |
|---|---|
| `--restricted` | removes Bash, PowerShell, REPL and the other code-runners, and WebFetch; ignores user, project and local settings files |
| `--strict-mcp-config` + `--mcp-config` pointing at `{"mcpServers": {}}` | no connectors at all |
| `--disallowed-tools` (16 names) | Read, Write, Edit, Glob, Grep, WebSearch, Task, Agent and the rest, denied by name |
| `--permission-mode manual` | nothing can be granted without a human, and there is no human here |
| `--max-turns 1` | one answer, no agentic loop |

A perfect injection wins the right to make it say something silly.

> ⚠ Every name in `DENY_TOOLS` is verified against the CLI, because an unknown name is **not
> ignored** - it makes the CLI refuse the whole invocation. `SlashCommand` was in that list and is
> not a real tool, which took the agent down completely while every flag-presence check stayed
> green. `--selftest` now asks the CLI itself.

**2. It cannot be reached by default.** Loopback only, and a CORS allowlist rather than `*`.

**3. Caps.** 4 questions per IP per minute, 40 per IP per day, 400 globally per day, 600 characters
in, 2,400 out, 120s timeout.

**4. Output scrub.** A reply containing system-prompt markers is replaced, because that is the one
output that would confirm an extraction attempt worked.

**5. Grounding.** The system prompt carries the CV and instructs refusal outside it. This is the
**weakest** layer and is treated as such. It shapes normal behaviour; it does not contain an
attacker, and nothing above depends on it holding.

**6. Logging.** `chatlog.jsonl`, one line per call: timestamp, salted IP hash, question, whether it
answered, and which suspicious patterns matched. The salt rotates per process, so callers are not
linkable across restarts. Enough to spot abuse and answer "who used it", not a personal-data store.

## Exposing it to real recruiters

**It does not work over the internet as shipped, and that is deliberate.** GitHub Pages cannot
reach your desktop: a visitor's browser resolves `127.0.0.1` to *their* machine, not yours. So this
answers for someone sitting at your desk and reports itself offline to everyone else.

Making it reachable means putting a tunnel in front of it, which puts a personal machine on the
public internet. If you do that:

- terminate TLS at the tunnel and add rate limiting there too, in front of this process
- add the tunnel hostname to `CFG["ORIGINS"]`
- keep the bind on `127.0.0.1` and let the tunnel connect locally; do not pass `--host 0.0.0.0`
- watch `chatlog.jsonl` for the `flags` column

That is your call, and this file does not make it for you.

## Files

| | |
|---|---|
| `server.py` | the bridge, the lockdown, the caps, the self-test |
| `resume_context.txt` | the only facts the agent is given; regenerate from the master .docx |
| `chatlog.jsonl` | append-only call log (gitignored) |
| `../chatbox.js` | the front-end control, reusable, degrades honestly |
