---
title: Flags — set, apply, prove, and restore a feature flag a criterion needs
impact: HIGH
tags:
  - flags
  - stack
  - config
  - local
---

# Flags

A criterion that needs a feature flag in a given state sets it itself.
It never asks the user to edit a file when `environments.<env>.flags` declares how.
The repo declares the mechanism ([`config.md § flags`](./config.md#flags)); this file is the protocol every run follows.

## When it applies

- A criterion, edge row, or fault row needs a flag on or off (`flag off` is a permissions row in [`intent.md`](./intent.md)).
- [`intent.md` test 4](./intent.md#step-3b--lint-every-criterion-and-map-the-surfaces) found a flag missing on `<env>`.

Do nothing for a flag already in the needed state; read it with `verify` first.

## Preconditions

| `environments.<env>.flags` | Action |
| --- | --- |
| A block for the flag's service | Run the protocol below |
| `manual` (a preview, a hosted environment) | Do not set it. Record `⏭️ not verified on target (flag <key> is <state> on <env>; set by <owner>)` and list the exact key and value needed under what needs a human |
| Absent, or no block for the service | Same as `manual`. Never edit a `.env*` file, never guess a mechanism, never ask the user to run `sed` |

A `.env*` file is never read, grepped, or edited by the run, whatever the config says.

## Protocol

Run per flag, from the PR's checkout, on `local` only.

0. **Restore what an earlier run left set**, at run start, before the stack step, whether or not this run needs the flag.
   A pending restore is a service folder under `.agent/{branch}/verify/flags/` that still holds a saved original: an earlier run crashed or was killed before step 6.
   For each one, run that service's `restore` for every key `flags.json` names for it, then its `apply` commands, and append a `restore` entry (below).

1. **Record** the service, the flag, the value needed, and the criterion it serves, appended to `.agent/{branch}/verify/flags.json` (append-only, never rewritten).
   The saved original under `{backup_dir}` is the pending-restore record: it exists from `set` until a successful `restore` deletes it.
   Use `.agent/{branch}/verify/flags/<service>/` as that service's `{backup_dir}`.
   A service folder that still holds a saved original means an earlier run did not restore: for each `flags.json` entry of that service, run its `restore` and `apply` commands first, then continue.
   A `restore` with nothing saved for the key does nothing and exits 0, so replaying an entry that was already restored changes no value.
2. **Set**: run the service's `set` command.
   It must save the original value under `{backup_dir}` before it changes anything; a second `set` of the same key must not overwrite that original.
3. **Apply**: run each `apply` command in order.
   Restart only the components named in `components`, from this checkout.
   A `shared` service changes a file every checkout reads: its `apply` reloads without restarting other checkouts ([`config.md § flags`](./config.md#flags)).
   Say in the report which other checkouts still hold the old value until their next restart.
4. **Prove**: run `verify`; the output must show the value just set.
   No `verify` command, or an output that does not show it → keep going, and report the flag as `set, not observed` in the report's `**Notes**`.
5. **Probe** the criterion.
6. **Restore** after the last probe that needs the flag, a fix-loop re-verify included ([`fix-loop.md`](./fix-loop.md)), so the flag stays set across the fix loop and its stack restarts, and on every exit path (a crash, a cap, an abort): run `restore`, then the same `apply` commands, then `verify` again, which must show the original value.
   `restore` deletes the key's saved original, so the next run never restores a value older than the developer's own edits.
   Restore even when `policies.cleanup: leave`; a flag is state the developer did not ask for.
   `--keep-stack` keeps the stack, never the flipped flag.
   Append `{"service": "<service>", "key": "<key>", "restore": "ok" | "failed" | "skipped"}` to `flags.json` for every restore, including step 0's.

### `shared: true` — restore on every exit

A `shared` service's file is read by every checkout on the machine, so a flag left set changes the user's other stacks.
For a `shared` service, step 6 is not optional on any exit path:

| Exit | Restore runs |
| --- | --- |
| `✅` pass, `❌` fail, `⚠️` partial | After the last probe, before the report is rendered |
| `blocked (…)`, `--loops` cap, an abort, a refused step | Before the run prints its blocked or final line |
| A crash or a killed session | At the next run's step 0, in the same checkout |

A restore whose command exits non-zero, whose `verify` does not show the original value, or that never ran is one line at the end of the run's output, which `aw` copies into its own `Degraded:`:

```text
✓ Degraded: flag USE_SANDBOX not restored (web, shared: true) — run: AW_FLAGS_BACKUP_DIR=.agent/feat-x/verify/flags/web .agents/aw/scripts/flags/flags.sh web restore USE_SANDBOX
✗ Notes: flags restored        # a failed restore hidden in a success line, the other checkouts still see the flipped value
```

The same item is a bullet in the report's attention section ([Report](#report)).
**Why:** a flag set for one worktree that outlives the run silently changes the user's other stacks ([`config.md § flags`](./config.md#flags)).

A flag state that differs between two criteria is two runs of steps 2–6, in the order that minimises restarts.
When one criterion needs a flag on and the next off, probe all the "on" criteria, then flip once.

## Report

The report's `**Notes**` carry one line per flag: `key: <original> → <set> (<service>, applied by <command>, <observed|not observed>) → restored`.
A flag left set because restore failed is environment state, not a product defect: it is a bullet in the report's attention section ([`pr-comment.md § Attention line`](./pr-comment.md#attention-line)) with the command that restores it, never in `findings.jsonl`, so the fix loop never edits code for it.

## Never

- Flip a flag in a service this run did not need.
- Leave a shared file edited to make a run pass: a flag value is part of the test, not part of the fix.
- Change a flag's registry default, a committed config, or a deployed environment to get a criterion green.
- Print a file that holds credentials. Read only the key you set.

```text
# ✗ Wrong — edits an env file the agent may not read, or asks a human to
sed -i '' 's/^USE_FLAG=.*/USE_FLAG=false/' app/.env.local
# ✓ Right — the declared command, with a saved original and a proof
AW_FLAGS_BACKUP_DIR=.agent/<branch>/verify/flags/web .agents/aw/scripts/flags/flags.sh web set USE_FLAG false
```
