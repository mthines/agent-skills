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

## Contents

- [Step 1 — Find the intent source](#step-1--find-the-intent-source-first-that-exists-wins)
- [Step 2 — Prove the change is in the checkout](#step-2--prove-the-change-is-in-the-checkout)
- [Step 3 — Write acceptance criteria](#step-3--write-acceptance-criteria-sources-2-and-3-only)
- [Step 3b — Lint every criterion and map the surfaces](#step-3b--lint-every-criterion-and-map-the-surfaces)
- [Step 4 — Write or reuse `specs.md`](#step-4--write-or-reuse-specsmd)
- [Step 5 — Build the edge-case matrix](#step-5--build-the-edge-case-matrix)
- [Output — `intent.md`](#output--intentmd)

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

One line per user-visible or API-visible behavior, each testable by an observer, numbered `AC-1`, `AC-2`, …, each saying what base does so the criterion can fail:

```text
✅ AC-2: Saving a view with an empty name shows "Name is required" under the field and sends no request (base: saves a view named "").
❌ AC-2: Validation works.
❌ AC-3: The page does not show "Your invitations".      (absence only: base passes it)
```

When the PR and ticket disagree, the ticket wins; record the mismatch as `spec-drift`.

Tag every criterion, from every source, with its surface: `ui:<route>`, `api:<METHOD path>`, or `worker:<component>`.

## Step 3b — Lint every criterion and map the surfaces

Run all five tests on every `AC-{n}` from every source, a brief's included.
Most runs derive their own criteria, so Step 3 is where a weak one is cheapest to fix.

| # | Test | The criterion fails it when |
| --- | --- | --- |
| 1 | Observable | No screenshot, response, span, or log line could show it |
| 2 | On the changed target | It checks a sibling surface instead of the one the diff changed |
| 3 | Fails on base | It is absence only, checks an attribute and not the effect, reaches a state without checking it moved, accepts either of two outcomes, or base already satisfies it. A removal passes this test when it checks the removal's observable effect, such as a request that stops firing |
| 4 | Reachable on this environment | A flag, seeded record, credential, or backend change it needs is missing on `<env>` |
| 5 | Not by construction | Reading the source would satisfy it |

A failed test never drops or silently rewrites a criterion:

| Source of the AC | Action |
| --- | --- |
| Fails test 4, from any source | Name the missing precondition in `intent.md`; keep the AC on its own target and never rewrite it onto a reachable sibling; it reports `⏭️ not verified on target (<cause>)` ([`report.md § Substitution`](./report.md#substitution)), never `pass` |
| Fails test 2, derived by this run (sources 2 and 3) | Rewrite it onto the changed target the diff names |
| Fails test 1, 3, or 5, derived by this run | Rewrite it in place, on the same target, so it passes the test |
| Fails test 1, 2, 3, or 5, from an `/aw` brief | Keep the ID and text verbatim; write a `criterion-quality` finding ([`findings.md`](./findings.md#kind)) and a stronger probe as an `EC-n` row naming the AC under **Applies to** |

Then fill the **Coverage** table in `intent.md`: one row per changed surface from Step 1 — route, endpoint, event added or removed, and every performance or security claim in the PR text.
A claim that is not a UI outcome needs an `api:` or `worker:` criterion, or a `telemetry:` one when the claim is an event or span; a UI check does not cover it.
A surface with no AC and no `Not applicable — <reason>` is a `criterion-quality` finding.

```text
✗ Perf claim "idle chats run no animations" → AC-4 [ui:/agent0] the chat looks the same as before
✓ Perf claim "idle chats run no animations" → AC-4 [ui:/agent0] with the chat idle for 5 s, the page reports 0 running animations
```

Why each test exists: [`../references/criterion-quality.md`](../references/criterion-quality.md).

## Step 4 — Write or reuse `specs.md`

| `.agent/{branch}/specs.md` | Action |
| --- | --- |
| Exists with `Format: intent` | Reuse it. A `ui:` criterion with no spec → append one `## Spec N:` for it and note `spec added by verify` in `intent.md`. |
| Exists in the WHEN/THEN grammar (no `Format: intent` line) | Reuse it unchanged — `ui-verify` and `aw-tester` run both formats. Write gap specs in intent form into `edge-specs.md` instead, so the file stays one format. |
| Absent | Write it: header `Target: <env>` and `Format: intent`, then one spec per `ui:` criterion, per `ui-verify`'s `rules/spec-format.md` § Writing an intent spec (v2). |

Name the spec after its criterion so the report can join them: `## Spec 2: AC-2 — An empty name is rejected inline`.
Every target in a spec comes from the code: grep the component and locale files and put the locator under `**Hints:**`.
End each spec's `**Changed:**` line with `(base: …)` and give its `**Expected:**` list at least one outcome base cannot show (`ui-verify`'s `rules/spec-format.md`, rule 5).

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
| Concurrency | Double submit, rapid toggle, navigating away during a request; for anything a page does on its first render, N parallel requests on a fresh session minted out of band (a browser login already renders the landing page, often twice) |
| Failure | Backend 500, 403, timeout, offline (block the route), malformed response; one row per guardrail in the brief, breaking the dependency it names |
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

## Coverage
| Surface | Covered by |
| --- | --- |
| /settings/notifications | AC-1 |
| event `notification.saved` | AC-3 (telemetry:) |
| removed event `footer.diag` | AC-4 (the event no longer fires) |

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
- An AC every run would pass: absence only, an attribute, a state reached but never checked. **Fix:** Step 3b test 3; write the positive outcome and the `(base: …)` clause.
- A claim about performance, security, or an event, covered only by a UI screenshot. **Fix:** the Coverage table; add an `api:` or `telemetry:` criterion.
- Running a sibling surface because the named one is unreachable, then reporting the AC as passed. **Fix:** Step 3b test 4; the AC is `⏭️ not verified on target`.
