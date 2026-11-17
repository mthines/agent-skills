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

1. **Record** the service, the flag, the value needed, and the criterion it serves, appended to `.agent/{branch}/verify/flags.json` (append-only, never rewritten).
   Use `.agent/{branch}/verify/flags/<service>/` as that service's `{backup_dir}`.
   A service folder that still holds a saved original means an earlier run did not restore: for each `flags.json` entry of that service, run its `restore` and `apply` commands first, then continue.
2. **Set**: run the service's `set` command.
   It must save the original value under `{backup_dir}` before it changes anything; a second `set` of the same key must not overwrite that original.
3. **Apply**: run each `apply` command in order.
   Restart only the components named in `components`, from this checkout.
   A `shared` service changes a file every checkout reads: its `apply` reloads without restarting other checkouts ([`config.md § flags`](./config.md#flags)).
   Say in the report which other checkouts still hold the old value until their next restart.
4. **Prove**: run `verify`; the output must show the value just set.
   No `verify` command, or an output that does not show it → keep going, and report the flag as `set, not observed` in the report's `**Notes**`.
5. **Probe** the criterion.
6. **Restore** after the last probe that needs the flag, and on every exit path (a crash, a cap, an abort): run `restore`, then the same `apply` commands, then `verify` again, which must show the original value.
   `restore` deletes the key's saved original, so the next run never restores a value older than the developer's own edits.
   Restore even when `policies.cleanup: leave`; a flag is state the developer did not ask for.
   `--keep-stack` keeps the stack, never the flipped flag.

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
