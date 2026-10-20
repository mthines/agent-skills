---
title: Prune Mode — Remove Skills That Cost Context and Add Nothing
impact: HIGH
tags:
  - prune
  - skill-doctor
  - lift
  - cleanup
---

# Prune Mode

Clean up an installed skill set in three passes: delete what is never used, lift-check what is left, and cut or delete what shows no lift.
Every skill in the listing costs context on every turn, so a skill that is never used or never helps is a pure cost.

**Why:** see [`references/lift-and-prune-rationale.md`](../references/lift-and-prune-rationale.md).

## Contents

- Step 1 — Inventory cost and usage
- Step 2 — Unused skills
- Step 3 — Lift-check the rest
- Step 4 — Before deleting anything
- Step 5 — Report
- Hard rules

## Step 1 — Inventory cost and usage

```bash
claude -p "/skill-doctor"
```

It lists each skill's context cost, how often it is used, and skills that were never invoked, highest cost first.
When the command is unavailable in this session, ask the user to run `/skill-doctor` and paste the output.
When `$ARGUMENTS` names skills (`/create-skill prune a b c`), restrict every later step to those skills.

## Step 2 — Unused skills

Classify each skill from the Step 1 output:

| Usage | Class | Next |
| --- | --- | --- |
| Never invoked | unused | delete candidate (Step 4) |
| Invoked, but only by other skills (`Skill()` callers in the repo) | dependency | keep; lift-check it in Step 3 |
| Invoked | used | lift-check in Step 3 |

A slash-only skill (`disable-model-invocation: true`) the user runs rarely is still `used`; ask before classing it `unused`.

## Step 3 — Lift-check the rest

Run [`lift-check.md`](./lift-check.md) on each `used` and `dependency` skill, highest context cost first.
Stop when the user's budget (`--max-cost-usd`, or the count they named) is spent, and list the skills left unchecked.

| Lift verdict | Prune action |
| --- | --- |
| lift | keep |
| decoration | trim candidate: propose the trimmed `SKILL.md` as a diff, re-run the lift check on it |
| harmful or inert | delete candidate (Step 4) |

## Step 4 — Before deleting anything

For each delete candidate:

1. Find callers: `grep -rn "<name>" skills agents CLAUDE.md README.md` (plus `scripts/eval/suites.mjs` in this repo).
2. Show the user the candidate list with each skill's cost, usage, lift verdict, and callers, and get an explicit yes per skill.
3. Repoint or remove each caller in the same change; a deleted skill must leave no `Skill()` call to it behind.
4. In this repo, apply the root `CLAUDE.md` "deleted a skill" eval row: delete the suite entry and its `golden/*.jsonl` together, then run `node scripts/eval/l1.mjs`.
5. Delete the skill's source directory, run `bash scripts/sync-symlinks.sh`, and remove its inventory lines from `CLAUDE.md` and `README.md`.
   For a skill installed outside this repo, remove its directory under `~/.claude/skills/` (or uninstall its plugin) instead.

```text
✗ Wrong — delete on a zero usage count alone
rm -rf skills/quality/foo   # pr-reviewer still invokes foo as a lens

✓ Right — callers found, user confirmed, callers migrated, then deleted
foo: cost 410 tok/turn, never invoked, Δ=+0.00 vs dummy +0.03, callers: agents/pr-reviewer.md:212
→ confirmed; pr-reviewer lens removed in the same commit; skill deleted.
```

## Step 5 — Report

```text
Prune: 24 skills inventoried
  deleted   3  (unused: a, b; inert: c)        −1,240 tok/turn
  trimmed   2  (d −60 lines, e −35 lines)      −310 tok/turn
  kept     17  (lift)
  unchecked 2  (budget spent: f, g)
```

## Hard rules

- Never delete or trim without the user's explicit per-skill confirmation.
- Never report a lift verdict from a partial (`exit 2`) eval run.
- Prune proposes changes to skill sources only; it never edits product code.
