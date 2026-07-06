---
title: Finding grounding — claimed symbols must exist
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - grounding
  - false-positive-control
---

# Finding grounding

The single biggest driver of "comment is wrong" in LLM PR review is hallucinated symbol names — a comment that confidently names `userFoo` or `validateAuth` where neither symbol exists in the changed file. Research in the 2026 field studies (Appaxon "Can LLMs Review Code Effectively?", Crash Override on LLM security review) puts uncaught false-positive rates at 5–15 % without an explicit grounding step. Above 10 %, alert fatigue starts: by week two, developers stop reading the comments at all.

This rule closes that gap with a cheap mechanical check.

## The check

For every proposed comment, before it reaches the per-comment confidence step:

1. Extract every backticked token from the comment body: `` `foo` ``, `` `validateAuth` ``, `` `userIds` ``.
2. For each token, grep the **changed-file** content (not the whole repo) for the literal token.
3. If any backticked token is absent from the file, drop the comment.

```bash
# Example: comment body = "suggestion: Could use a `Map` here for clearer iteration semantics."
# Backticked tokens: ["Map"]
# Changed file: src/foo.ts

for token in $(echo "$BODY" | grep -oE '`[^`]+`' | tr -d '`'); do
  if ! grep -qF "$token" "$CHANGED_FILE"; then
    echo "DROP: token '$token' not in $CHANGED_FILE" >&2
    exit 1
  fi
done
```

## What counts as the "changed file"

In PR Mode (cross-review), pull the file's patch from the already-cached `/tmp/pr-files.json` (see `pr-reviewer/rules/line-validity.md`). The patch contains both context (` `-prefix) and added (`+`-prefix) lines. Strip the `+` / ` ` prefix before grepping. Do **not** include `-`-prefix (deleted) lines — a comment pinned to the RIGHT side cannot validly name a deleted symbol.

In `reviewer` Self-Review and Fix Mode, use the local working tree at HEAD.

## Tokens that bypass the check

- Language keywords (`Map`, `Set`, `null`, `undefined`, `true`, `false`, `await`, `async`, `const`, `let`, `var`, `function`, `class`, `import`, `export`).
- Built-in types in the language of the file (`number`, `string`, `boolean`, `object`, `Array`, `Promise`, `Record`, `Partial`, `Required`).
- Backticked phrases that contain whitespace — those are not symbol names, they are inline prose decoration.
- Backticked file paths (contain `/` or `.`) — handled by the line-validity check, not this one.

A short allowlist file lives at the agent root: `agents/shared/rules/grounding-allowlist.txt` — one token per line, language-agnostic. The check loads it once per run.

## What counts as a hit

`grep -F` (fixed-string, no regex). Case-sensitive. Whole-word **not** required — `userIds` matches `userIds`, `UserIdsList`, and `extractUserIds`. The point is to confirm the agent did not invent the symbol, not to enforce exact identity.

## What this check does not catch

- A comment that names a real symbol but describes the wrong behaviour ("`validateAuth` returns `null` on failure" when it actually throws). That is a semantic-claim failure. **Grounding = existence; claim-verification is `verification-receipt.md` (Step 2.6b)**, which runs immediately after this step and requires an executed proof for every behavioral claim.
- A comment that omits backticks entirely ("the validateAuth function returns null"). Encourage backticks in `comment-shape.md` examples but do not enforce — un-backticked claims pass this check by construction.
- A correctly-named symbol that the comment claims is defined in a different file. Beyond this rule's scope; route to per-comment confidence.

## Drop is final

Like all shape-layer checks, drop is final within one run. The agent does not retry on a different temperature or with a different framing. Dropped comments are logged with the offending token in the terminal output so the user can verify and post manually if the model was right and the grep missed (rare: usually the model was wrong).

## Logging

When this check fires, log one line per drop:

```
[grounding] DROP src/foo.ts:42 — token `userFoo` not in changed-file patch
```

The terminal report at end of run sums these into a `Grounding drops: N` line in the Quality Gate summary.
