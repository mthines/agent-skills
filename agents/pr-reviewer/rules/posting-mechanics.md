---
title: Posting mechanics — pending review payload and verification
impact: CRITICAL
tags:
  - pr-reviewer
  - github-api
  - pending-review
---

# Posting mechanics

After `authorization-gate.md` grants, this rule covers the exact mechanics of posting a pending review. The non-negotiables are listed first because each one corresponds to a real prior incident.

## The four non-negotiable rules

1. **Omit the `event` field entirely.** GitHub's API: *"By leaving this blank, you set the review action state to PENDING."* Do **not** send `"event": "PENDING"` (rejected by the API). Do **not** map the verdict to `APPROVE` / `COMMENT` / `REQUEST_CHANGES` — those submit the review and bypass the user's review gate.

   **Common LLM confusion** — mid-run the agent may convince itself that "the API does not support pending reviews." False. What is true: the API rejects the *literal string* `"PENDING"` as an `event` value. What is *also* true and easy to forget: **omitting the `event` key entirely** is the documented mechanism. If reasoning trails toward "pending isn't possible, I'll fall back to COMMENT" — STOP and re-read this rule. `event: "COMMENT"` posts publicly and bypasses the user gate; forbidden.

2. **Never use `gh pr comment` or `POST /issues/{n}/comments`.** Those create general PR conversation comments, immediately visible. Only use `POST /repos/.../pulls/{n}/reviews` with `comments[]`.

3. **The review `body` must be empty (`body: ""`).** All actionable feedback goes in `comments[]` pinned to a diff line. Verdict, score, rationale live in the agent's terminal output to the user, never on the PR. A non-empty `body` produces a top-level review comment that dilutes line-level feedback.

4. **On API failure, do not fall back.** Not to `gh pr comment`, not to `event: COMMENT`, not to any submitting event. Report the failure verbatim with the request payload, list the unposted comments, and stop. The exact anti-pattern is "the omit-event approach didn't work, I'll send `event: COMMENT` to get *something* posted" — forbidden.

## Mechanical pre-flight assertions

Before any `gh api` call, assert:

```python
def payload_is_safe(payload: dict) -> tuple[bool, str]:
    if "event" in payload:
        return (False, "event key present — must be omitted for PENDING")
    if payload.get("body", None) != "":
        return (False, f"body must be empty string, got {payload.get('body')!r}")
    if not payload.get("comments"):
        return (False, "comments[] is empty — nothing to post")
    for c in payload["comments"]:
        if not c.get("body", "").startswith((
            "praise:", "nitpick:", "suggestion:", "issue:", "question:"
        )):
            return (False, f"comment body missing Conventional-Comments prefix: {c['body'][:40]}")
        if len(c.get("body", "")) > 240:
            return (False, f"comment body > 240 chars: {len(c['body'])}")
    return (True, "")
```

If `payload_is_safe` returns `False`, abort and surface the reason in the terminal report. Do not attempt to auto-fix the payload here — every gate the payload failed should have been caught earlier in the pipeline. A failure at this layer is evidence that an earlier shape-layer rule was bypassed.

## Posting

```bash
REPO=${PR_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
COMMIT_SHA=$(gh api repos/$REPO/pulls/$PR_NUMBER --jq '.head.sha')

# NO "event" key (absence is what makes the review pending).
# "body" is the empty string (top-level summary belongs in the agent's terminal output).
cat > /tmp/review-payload.json <<'JSONEOF'
{
  "commit_id": "<COMMIT_SHA>",
  "body": "",
  "comments": [
    {
      "path": "src/foo.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "suggestion: Could use a `Map` here for clearer iteration semantics. **(non-blocking)**"
    }
  ]
}
JSONEOF

gh api repos/$REPO/pulls/$PR_NUMBER/reviews --input /tmp/review-payload.json
```

**Multi-line comments** add `start_line` and `start_side`:

```json
{
  "path": "src/baz.ts",
  "start_line": 15,
  "start_side": "RIGHT",
  "line": 18,
  "side": "RIGHT",
  "body": "..."
}
```

## Verification after posting

After the API call, **always verify** the review is pending:

```bash
gh api repos/$REPO/pulls/$PR_NUMBER/reviews \
  --jq '.[] | select(.user.login == "'"$(gh api user --jq .login)"'") | {id, state}'
```

The newest entry's `state` MUST be `"PENDING"`. If it shows `CHANGES_REQUESTED`, `COMMENTED`, or `APPROVED`, **the review was submitted by accident** — alert the user immediately with the review ID and offer to dismiss:

```bash
gh api -X PUT repos/$REPO/pulls/$PR_NUMBER/reviews/<REVIEW_ID>/dismissals \
  -f message="Posted in error by automated reviewer; please disregard."
```

## Existing pending review

A previous run may have left a pending review under the current user. Check before posting:

```bash
ME=$(gh api user --jq .login)
gh api repos/$REPO/pulls/$PR_NUMBER/reviews \
  --jq --arg me "$ME" '.[] | select(.user.login == $me) | {id, state, submitted_at}'
```

If a `PENDING` review exists from the current user, **add to it** via `POST /pulls/{n}/reviews/{id}/comments` rather than creating a new one — GitHub allows only one pending review per user per PR.

Submitted `CHANGES_REQUESTED` / `APPROVED` / `COMMENTED` reviews are ignored — a new pending review can coexist.

## Reporting

After the API call succeeds, report concisely. **Lead with invisibility**, then mechanics:

- `Drafted N pending comments on PR #<n> — invisible to the author until you submit from the GitHub UI.`
- Verified state (must be `PENDING`).
- Any comments dropped because they couldn't pin to a diff line, with the body verbatim so the user can paste manually.
- Direct link: `https://github.com/$REPO/pull/$PR_NUMBER/files`.
- Closing: `Open the PR → Files Changed → review, edit, dismiss as needed, then click "Finish your review" to submit (or discard).`

## Communication invariant — use "drafted", never "posted"

"Posted" reads as "made public" to most users. Use "drafted" or "added to the pending review". This is a communication invariant; mechanically pre-check the report wording before delivering. Failing this invariant produces false-failure perceptions like "the agent posted a comment directly" even when the review is correctly PENDING.
