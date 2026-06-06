---
title: Authorization gate — external-system write under user identity
impact: CRITICAL
tags:
  - pr-reviewer
  - authorization
  - github-api
  - safety
---

# Authorization gate

Posting to `POST /repos/.../pulls/{n}/reviews` is an **external-system write under the user's GitHub identity**. The PENDING state at GitHub (which keeps the review invisible until the user submits from the UI) is *secondary* safety — visibility limit. The *primary* gate is explicit per-call authorization captured in this sub-agent's transcript.

Without that authorization, the harness security policy treats the post as unauthorized **regardless of whether the resulting review is correctly PENDING**.

## When this gate runs

This gate is the **only** thing standing between the comment proposal (Step 5.5 in `pr-reviewer.md`) and the actual API call (Step 5.6). The proposal is always produced — Steps 5.1–5.5 are mandatory in cross-review and are not gated on authorization. The API call is separately gated by this rule.

## The two authorization paths

**Path 1 — Token**: The literal token `--publish` appears as a whitespace-delimited argument in the raw arguments captured at Step 0 (exact match, two leading ASCII hyphens, no quoting).

**Path 2 — Phrase**: The **most recent user message in this sub-agent's transcript** contains one of the explicit authorization phrases (case-insensitive, anywhere in the message), AND the negation guard does not fire.

Authorization phrases:
- `publish them`
- `publish the comments`
- `publish the review`
- `post them`
- `post the comments`
- `post the review`
- `go ahead and post`
- `go ahead and publish`
- `submit the review`

## Negation guard

Before accepting a phrase match, scan the **entire** user message for any of:

`don't`, `do not`, `dont`, `no`, `not yet`, `wait`, `cancel`, `abort`, `stop`, `nope`, `hold off`, `nevermind`, `never mind`

If any appears, treat as **STOP** regardless of the matched phrase. Replies like "don't publish them" contain the phrase but are clearly a stop; the negation guard catches the obvious cases. When in doubt, require the user to re-invoke with `--publish`.

## Mechanical assertion

Before any `gh api repos/.../pulls/{n}/reviews` call, assert:

```
token_path_satisfied OR (phrase_path_satisfied AND NOT negation_guard_fired)
```

If the assertion fails, abort and emit the closing report below verbatim. Skipping this assertion is the canonical anti-pattern.

## What does NOT count as authorization

- **The parent agent's invocation prompt.** Not visible to the user; not per-call authorization for an external-system write.
- **The user's original request to the parent agent**, paraphrased into this sub-agent's prompt. Only the transcript visible to this sub-agent counts.
- **Vague approval** like "ok", "yes", "looks good", "thanks". May mean "good review" rather than "publish".
- **A vague mention of "comments"** in the original arguments without the literal `--publish` token.
- **Auto mode or any harness-level "continuous execution" flag.** Auto mode explicitly does not bypass per-call external-system-write authorization.

## Closing report (verbatim — do not paraphrase)

When authorization is not granted, emit exactly:

```
Proposal drafted: <N> comments above ready to publish as a PENDING review on PR #<n>.

Authorization gate: not granted.

To post, either:
- Re-invoke me with `--publish` appended (e.g. `<original-invocation> --publish`), OR
- Reply with one of: "publish them", "post them", "go ahead and post", "submit the review" (no negation).

Without explicit authorization, posting under your GitHub identity is blocked.
The proposal above is the deliverable for this run; no GitHub API call was made.
```

## Authorship pre-check

This rule runs only after the authorship pre-check at the top of `pr-reviewer.md` has confirmed `author != current user`. If the agent was invoked on the user's own PR, it refuses earlier with `Use \`reviewer\` for your own PR.` — this gate is never reached.

## Why the gate exists at all

A reasonable reader might ask: "If the review is PENDING and invisible until the user submits, why does it need per-call authorization?" Three reasons:

1. **PENDING is reversible only if the user knows it exists.** A pending review filed silently in a parent-agent-driven workflow may be discovered later when the user opens the PR for unrelated reasons, by which point the user has lost track of what the agent intended to post.
2. **The harness security policy treats external-system writes uniformly.** It does not distinguish "visible immediately" from "visible-after-confirmation". A write under the user's identity is a write under the user's identity.
3. **The previous mode of failure was exactly this.** Cross-review agent posting under user identity without explicit per-call authorization is the canonical incident this gate exists to prevent (see `diagnostic-surface.md` failure class `F-publish-unauthorized`).
