---
title: Intent — what the feature must do, and how it could break
impact: HIGH
tags:
  - intent
  - acceptance-criteria
  - edge-cases
  - autonomous-workflow
---

# Intent

Phase 1 produces three files, all tested against by later phases:

| File | Holds |
| --- | --- |
| `.agent/{branch}/verify/intent.md` | Acceptance criteria with surfaces, the edge-case matrix, open questions |
| `.agent/{branch}/specs.md` | One intent spec per `ui:` acceptance criterion — shared with `/aw` and `ui-verify` |
| `.agent/{branch}/verify/edge-specs.md` | One intent spec per applicable `ui:` edge case — local only |

A vague criterion here becomes a vague verdict later.

## Step 1 — Find the intent source (first that exists wins)

| # | Source | How to tell | Use |
| --- | --- | --- | --- |
| 1 | An `/aw` brief on this branch | `.agent/{branch}/plan.md` has `## Acceptance Criteria` with `AC-{n}` items | Copy every `AC-{n}` verbatim with its ID; take surfaces from `## File Changes` |
| 2 | The PR and its ticket | A PR exists for the branch | Derive criteria per Step 3 |
| 3 | The diff alone | No PR | Derive criteria per Step 3 and write `intent source: diff only` in `intent.md` |

With source 1, still read the PR and ticket: a behavior they state that no `AC-{n}` covers is a `spec-drift` finding, never a silent new criterion.
Never renumber an `/aw` criterion; the IDs tie the brief, `checks.yaml`, the specs, and this report together.

### Gathering for sources 2 and 3

| Source | How | Extract |
| --- | --- | --- |
| PR | `gh pr view <ref> --json number,title,body,author,headRefName,baseRefName,url,files` | Stated behavior, "how to test", out-of-scope notes |
| Ticket, Linear (a Linear MCP tool is connected) | ID from the branch name (`[a-z]+-[0-9]+`, case-insensitive) or the PR body; Linear `get_issue` + `list_comments` | Problem statement, acceptance criteria, edge cases raised in comments |
| Ticket, GitHub issue | `Closes #n` / `Fixes #n` / `Resolves #n` in the PR body, or `closingIssuesReferences`; `gh issue view <n> --comments` | Same |
| No ticket found | — | Say so in `intent.md` |
| Diff | `gh pr diff <ref> --name-only` (or `git diff --name-only origin/HEAD...`), then the changed files | Surfaces: routes, components, endpoints, workers; new error paths; new telemetry |
| Neighbours | Grep the feature's components and endpoints for tests and sibling features | How the codebase handles empty, error, and loading states |

A ticket ID as the argument → find the PR from the ticket's attachments; an issue number → `gh pr list --search "<n> in:body"`.

## Step 2 — Prove the change is in the checkout

Work in a worktree on the PR head, never the base branch.

```bash
gh pr checkout <n>                       # or: cd into the existing worktree for headRefName
git fetch origin && git status -sb       # up to date with origin/<headRefName>?
grep -n '<a distinctive added line>' <a changed file>   # the fact, not an inference
```

The grep must hit; a miss stops the run with `blocked — checkout does not contain the PR head`.

## Step 3 — Write acceptance criteria (sources 2 and 3 only)

One line per user-visible or API-visible behavior, each testable by an observer, numbered `AC-1`, `AC-2`, …:

```text
✅ AC-2: Saving a view with an empty name shows "Name is required" under the field and sends no request.
❌ AC-2: Validation works.
```

When the PR and ticket disagree, the ticket wins; record the mismatch as `spec-drift`.

Tag every criterion, from every source, with its surface: `ui:<route>`, `api:<METHOD path>`, or `worker:<component>`.

## Step 4 — Write or reuse `specs.md`

| `.agent/{branch}/specs.md` | Action |
| --- | --- |
| Exists with `Format: intent` | Reuse it. A `ui:` criterion with no spec → append one `## Spec N:` for it and note `spec added by verify` in `intent.md`. |
| Exists in the WHEN/THEN grammar (no `Format: intent` line) | Reuse it unchanged — `ui-verify` and `aw-tester` run both formats. Write gap specs in intent form into `edge-specs.md` instead, so the file stays one format. |
| Absent | Write it: header `Target: <env>` and `Format: intent`, then one spec per `ui:` criterion, per `ui-verify`'s `rules/spec-format.md` § Writing an intent spec (v2). |

Name the spec after its criterion so the report can join them: `## Spec 2: AC-2 — An empty name is rejected inline`.
Every target in a spec comes from the code: grep the component and locale files and put the locator under `**Hints:**`.

## Step 5 — Build the edge-case matrix

For every input, state, or dependency the feature touches, pick the rows that apply.
Mark the rest `n/a` with a one-line reason; never drop them silently.

| Class | Probes |
| --- | --- |
| Empty | No data, empty list, empty string, whitespace only, zero results for the time range |
| Size | One item, exactly the page limit, limit + 1, 10× typical, a 5 000-character string |
| Content | Unicode / emoji / RTL, `<script>` and HTML, SQL and query-language metacharacters, leading/trailing spaces, duplicate names |
| Numbers & time | 0, negative, max int, decimal where int expected, a future time range, a range spanning a DST change |
| State | Reload mid-flow, back/forward, deep link to a deleted or foreign entity, two tabs editing one entity, stale cache after an edit |
| Concurrency | Double submit, rapid toggle, navigating away during a request |
| Failure | Backend 500, 403, timeout, offline (block the route), malformed response |
| Permissions | Read-only member, feature flag off, another tenant's entity ID |
| Viewport & input | 375 px width, keyboard-only path, 200 % zoom |

**Graceful** means: no uncaught console error, no blank screen or error boundary, a message a user can act on, no data loss, recovery without a reload, and a 4xx (not a 5xx) for bad input.

Write each applicable `ui:` row as an intent spec in `edge-specs.md` (same header, titles `## Spec N: EC-n — …`).
Each `**Expected:**` item is the row's graceful outcome, stated as something observable; the interruption step is `[must-follow]`.

## Output — `intent.md`

```markdown
# Intent — <PR title or branch> (#<n>, <TICKET-ID or "no ticket">)

Intent source: /aw brief | PR + ticket | diff only

## Behavior
<two sentences: what the feature does and for whom>

## Acceptance criteria
- AC-1 [ui:/settings/notifications] …   (spec: specs.md Spec 1)
- AC-2 [api:PUT /api/notification-settings] …

## Surfaces
- Routes: …   Endpoints: …   Components (stack component names): …

## Edge-case matrix
| ID | Class | Probe | Applies to | Expected graceful outcome |
| EC-1 | Empty | No channels configured | AC-1 | Empty state with a create action |
| EC-9 | Failure | PUT /api/notification-settings → 500 | AC-2 | Inline error, toggles keep their values |

## Not applicable
- Permissions: the diff touches no authorization code.

## Open questions
- <only what the sources cannot answer — resolve in Phase 4 by precedent, not by asking>
```

## Common mistakes

- Re-deriving criteria when `/aw` wrote a brief. **Fix:** Step 1 source 1; copy the `AC-{n}` items.
- Deriving criteria from the diff alone when a ticket exists. **Fix:** the diff shows what changed, not what was wanted.
- An edge case with no expected outcome. **Fix:** every row states the graceful result, so Phase 3 has an oracle.
- Verifying the base branch because a worktree was already open. **Fix:** Step 2's grep is mandatory.
