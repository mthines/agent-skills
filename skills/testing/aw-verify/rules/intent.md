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
- [Step 6 — Publish the criteria on the PR](#step-6--publish-the-criteria-on-the-pr)
- [Output — `intent.md`](#output--intentmd)

## Step 1 — Find the intent source (first that exists wins)

| # | Source | How to tell | Use |
| --- | --- | --- | --- |
| 1 | An `/aw` brief on this branch | `.agent/{branch}/plan.md` has `## Acceptance Criteria` with `AC-{n}` items | Copy every `AC-{n}` verbatim with its ID; take each surface from the AC's own `[kind:target]` tag, else from `## File Changes`. `/aw` may already have published the rows ([§ Step 6](#step-6--publish-the-criteria-on-the-pr)) |
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

Tag every criterion, from every source, with its surface: `ui:<route>`, `api:<METHOD path>`, or `worker:<component>` (an `/aw` brief may already carry the tag, or read `check` for a criterion with no surface of its own).

## Step 3b — Lint every criterion and map the surfaces

Run all five tests on every `AC-{n}` from every source, a brief's included.
Most runs derive their own criteria, so Step 3 is where a weak one is cheapest to fix.

| # | Test | The criterion fails it when |
| --- | --- | --- |
| 1 | Observable | No screenshot, response, span, or log line could show it |
| 2 | On the changed target | It checks a sibling surface instead of the one the diff changed |
| 3 | Fails on base | It is absence only, checks an attribute and not the effect, reaches a state without checking it moved, accepts either of two outcomes, or base already satisfies it. A removal passes this test when it checks the removal's observable effect, such as a request that stops firing |
| 4 | Reachable on this environment | A seeded record, credential, or backend change it needs is missing on `<env>`, or a flag it needs is neither in the needed state nor settable through `environments.<env>.flags` ([`flags.md`](./flags.md)) |
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

## Step 6 — Publish the criteria on the PR

Whenever a PR resolves, every run, every surface, a UI diff or not: publish the criteria so `deployment-verify`, `telemetry-verify`, and a later session read the same list after `.agent/{branch}/` is gone.
This is not optional and does not depend on the push policy: it is the `intent` region of the PR's verify report, written by the same script and under the same trust rules as the report ([`pr-comment.md § Where the report lives`](./pr-comment.md#where-the-report-lives)); on anyone else's PR where posting needs a yes, ask once for both.

1. Render [`templates/intent-block.md.template`](../templates/intent-block.md.template) from `intent.md`: a collapsed `<details>` holding one table row per criterion, `| ⬜&nbsp;AC‑n | <criterion verbatim> | <kind> |` (the ID with a non-breaking hyphen, the Proof cell starting `<kind>:<target>` for every kind: `ui:/settings`, `api:PUT /api/x`, `worker:<component>`, `telemetry:<span>`), then each guardrail from the brief as `| 🛡️&nbsp;G‑n | <text> | guardrail |`. Write it to `.agent/{branch}/verify/comment-intent.md`.
2. `node "$VC" --pr <pr-url> --section intent --file .agent/{branch}/verify/comment-intent.md`
3. Exit `1` with `the PR is merged, so its criteria are frozen` → keep the PR's criteria, note `criteria: frozen (merged)`, and compare yours against them in `intent.md` as a `spec-drift` finding when they differ.
4. A criterion added by this run (sources 2 and 3, or a `criterion-quality` rewrite of a derived one) is published as written; an `/aw` brief's criteria are published verbatim, their `criterion-quality` findings staying in `findings.jsonl`.

```text
✗ the criteria listed again in the report's body, or only in a trace table, as `AC-2 | Saving … | ✅ pass | browser`
✓ node "$VC" --pr <pr-url> --section intent --file .agent/<branch>/verify/comment-intent.md
  # own PR → a region of the description, next to the ui-verify spec; the ui spec keeps its own marker pair
```

### An `/aw` brief is published by `/aw`, with the same script

`/aw` opens the PR before `aw-verify` can post, so it publishes the brief's criteria itself, with `verify-comment.mjs --from-plan .agent/{branch}/plan.md --statuses "$(run-checks.mjs --statuses)"` (`/aw`'s side of this is its `rules/phase-6-pr-creation.md § Publish the criteria`).
The rows are the brief's text verbatim: an AC tagged `[ui:/x]`, `[api:PUT /x]`, or `[worker:c]` keeps that tag in its Proof cell, a `telemetry:` AC reads `telemetry:<span>`, and an untagged one reads `check`.
This run's Step 6 then adds the surfaces and Proof it found: `--from-plan <plan.md> --print > comment-intent.md`, edit the Proof cells in that file (a `check` row may become `ui:/x`), and publish it with `--file comment-intent.md`; its **Status** call then ticks every row from the final results.
A run-checks `✅` can rest on a `grep` or `command` check, so `aw-verify`'s result replaces it.

```text
✗ rendering an /aw brief's rows by hand in Step 6 (a second renderer that drifts from /aw's)
✓ node "$VC" --pr <pr-url> --section intent --from-plan .agent/<branch>/plan.md   # the one renderer, then add Proof
```

### The criteria are a living checklist

Each criterion row carries a leading status that says where it stands, so a reviewer reads the PR top-down without opening the report:

| Mark | Meaning | Set by |
| --- | --- | --- |
| `⬜` | Published, not run yet | `/aw` at PR open, or Step 6 |
| `✅` | Passed on its own target (`pass`, `after fix`) | `/aw` from `run-checks.mjs` at PR open, then `aw-verify`, end of every run |
| `❌` | Failed, or a finding is still open on it | `aw-verify`, end of every run |
| `⏭️` | `not verified on target` | `aw-verify`, end of every run |
| `🚀` | Confirmed on production traffic | `deployment-verify` after a `PASS`, only for criteria a contract root span watches |

After the report renders (and after each fix-loop re-verify), fill each row's Proof cell and set the statuses, in two steps.

**Proof.** Re-publish the region with every Proof cell completed: `<kind>:<target> · <witnesses> · <link>` (keep the target exactly as published; a Proof cell without it makes `deployment-verify` read the criterion as unwatched), where the witnesses are `browser`, `telemetry`, or `tests`, and the link is the strongest proof the run has: a Dash0 deep link to the trace or traces explorer, else a SHA-pinned link to the committed test file, else a screenshot. Reword nothing else. A merged PR freezes the rows, so fill Proof before the merge.

**Status.** Write the marks from the final results, one call for all criteria:

```bash
node "$VC" --pr <pr-url> --section intent --marks '{"AC-1":{"status":"✅"},"AC-2":{"status":"❌"},"AC-3":{"status":"⏭️"}}'
```

`--marks` changes only the leading marks of existing rows, never their text, and refreshes the counts in the summary (`18 criteria · 15 ✅ · 3 ⏭️ · 3 guardrails`); an unknown ID or status exits `1`.
The older line form (`- ⬜ AC-1 [ui:/x] text`) is still read and marked, so a PR written by an earlier version keeps working.
A merged PR freezes the criteria text and still takes marks.
With no PR yet, mark the run directory's `intent.md` the same way, `node "$VC" --local .agent/<branch>/verify --marks '<json>'`, before `--check --local` ([run card Step 7](../SKILL.md#run-card)); an AC line there with no mark counts as not run.
That `intent.md` also reads the `/aw` brief's AC line copied verbatim (`- [ ] AC-1 (covers: R1) [ui:/x] — text`), and the mark goes after the checkbox.
Every list item whose first word is an `AC-n` is counted, and one with no `[kind:target]` tag fails the gate as untagged.

```text
✗ rewrite the whole intent region to tick a box, and reword AC-2 on the way
✓ node "$VC" --pr <pr-url> --section intent --marks '{"AC-2":{"status":"✅"}}'
```

The UI spec stays in the `ui-verify:v2` block, joined to its criterion by the `AC-n` in the spec title; the `intent` region holds what must be true, the spec holds how the browser checks it.

## Output — `intent.md`

```markdown
# Intent — <PR title or branch> (#<n>, <TICKET-ID or "no ticket">)

Intent source: /aw brief | PR + ticket | diff only

## Behavior
<two sentences: what the feature does and for whom>

## Acceptance criteria
- AC-1 [ui:/settings/notifications] …   (spec: specs.md Spec 1)   # `--marks --local` adds a leading ⬜ ✅ ❌ ⏭️ here at the end of the run, and the PR copy carries them too
- AC-2 [api:PUT /api/notification-settings] …

## Guardrails
- G-1 [guardrail] Keep unchanged: the public settings API shape   (verbatim from the brief; none → omit the section)

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
