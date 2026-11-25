---
title: Debt — list every shortcut marker as a ledger
impact: MEDIUM
tags: [shortcut, tech-debt, ledger, read-only]
---

# Debt

Load for `polish debt`.
It lists every `shortcut:` marker in the repo as one ledger row, so a deliberate shortcut is not forgotten.
The marker convention is `agents/shared/rules/shortcut-markers.md` in this repo: `shortcut: <the limit>, <when to upgrade>` on the line, or the line above.
Read-only: it never edits a file and never commits.

## Step 1 — Scan

Run the script from the repo root:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/shortcut-ledger.mjs"                 # default marker word
node "${CLAUDE_SKILL_DIR}/scripts/shortcut-ledger.mjs" --marker HACK    # when the user names another word
```

It greps comment prefixes (`#`, `//`, `/*`, a ` * ` block-comment body line, `--`, `<!--`, `;`) followed by the marker word and a colon, honours `.gitignore`, and skips Markdown and JSON files.
Each row reads `<file>:<line>, <what>. ceiling: <limit>. upgrade: <trigger>.`; a marker with no trigger reads `upgrade: none. [no-trigger]`.
The last line is `<N> markers, <M> with no trigger.`, or `No shortcut debt. Clean ledger.`

```text
✗ Wrong — grepping by hand: misses `/* … */` markers, lists README examples, and has no summary
git grep -n "shortcut:"

✓ Right — the script applies the comment-prefix, Markdown, and .gitignore rules
node "${CLAUDE_SKILL_DIR}/scripts/shortcut-ledger.mjs"
```

## Step 2 — Report

1. Print the script's output verbatim.
2. Drop a row only when the hit is not a deferral (a string literal that happens to contain the marker); say which rows you dropped.
3. When the user asks for an owner per row, add `git blame -L <line>,<line> -- <file>` for each `no-trigger` row.
4. Write the ledger to a file only when the user asks, at the path they name.

## Step 3 — Stop

One scan per invocation.
Fixing a shortcut is new work: name the rows the user may want to act on and stop.
