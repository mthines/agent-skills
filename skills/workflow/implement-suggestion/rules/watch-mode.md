# Watch Mode (`--watch`)

Detailed rule for the `--watch` flag of `/implement-suggestion`.
Loaded only when `--watch` is present in `$ARGUMENTS`; normal invocations skip this file.

`--watch` turns the single-pass apply into a **feedback loop on one PR**: after each apply-and-push, wait for the repo's review bots (and humans) to re-review the new commit, then apply the next round of actionable comments — repeating until the reviewers go quiet or an iteration cap is hit.

This is what `/create-pr` dispatches (as a background subagent) after it opens a PR, so a freshly-created PR converges to "all actionable bot feedback addressed" without the user babysitting it.

## Preconditions and parameters

- **Exactly one PR.** `--watch` operates on a single PR. If `$ARGUMENTS` resolves to more than one PR, refuse: print `--watch operates on a single PR; pass exactly one.` and exit. With empty `$ARGUMENTS`, use the active-PR auto-detection (mode rule #4).
- The PR must be `OPEN`. A `MERGED` / `CLOSED` PR refuses as usual.

Defaults (override via flags):

| Parameter        | Flag                  | Default |
| ---------------- | --------------------- | ------- |
| Max iterations   | `--max-iters <n>`     | `5`     |
| Poll interval    | `--interval <secs>`   | `300` (5 min); **clamped to `540`** — above that the harness kills the call before the loop's own bound fires |

Hard cap: `--max-iters` may not exceed `10`. Clamp silently.

## The loop

```text
resolve PR  →  baseline = HEAD sha + current UTC timestamp
iter = 0
while iter < max-iters:
    iter++
    wait for new review activity (shared poll, up to <interval> — see below)
    if no NEW actionable comment since `baseline.timestamp` AND iter > 1:
        stop  → reason "reviewers quiet"
    run ONE standard single-pass (Phases 1–7) scoped to comments newer than baseline.timestamp
    baseline = new HEAD sha + new UTC timestamp        # so next round only sees fresh feedback
    read CI state once (stateless, no watch)           # pending / unregistered => "unread"
    if any check is failing:
        stop  → reason "ci red — <check names>"        # report only; never fixes CI
    if the pass applied 0 changes AND surfaced 0:
        stop  → reason "nothing actionable left"
stop  → reason "iteration cap (<max-iters>)"

# EVERY stop above passes through here first. The read inside the loop happens seconds
# after that iteration's own push, so it is almost always "unread" — stopping on it
# would report a CI state no check had reached.
before reporting any stop reason:
    if CI state is still "unread":
        read CI state once more at the current head
        if any check is failing:
            stop reason = "ci red — <check names>"     # overrides the reason above
```

Key invariants:

- **Only process comments newer than the last processed timestamp.** Each iteration advances `baseline.timestamp` to "now" *after* the pass, so the next iteration sees only feedback the bots posted in response to the latest push. This is what prevents re-applying the same comment in a churn loop.
- **Resolved threads are skipped at fetch time** (inherited from Phase 2). A comment the worker addressed and the bot then resolves will not reappear.
- **The two-gate validation (`/critical` + `/confidence`) runs every iteration.** Watch mode never lowers the bar; a low-confidence comment is surfaced, not force-applied, on every pass.
- **One commit per applied comment, every iteration** (inherited from the per-comment commit rule).
  Each iteration applies, commits per comment, pushes, then resolves the threads it addressed — so an iteration that lands 2 fixes leaves 2 commits and 2 newly-resolved threads.
  This is also why the next iteration sees fewer open comments: threads resolved in a prior iteration are skipped at fetch time.

## Lesson capture on re-flag

Watch mode surfaces the loop's **strongest self-improvement signal**: a reviewer
re-commenting on a location or topic that a **prior iteration already applied**
means that earlier apply was wrong or incomplete. When an iteration's new
feedback overlaps (same file:line region or same topic + reviewer source) a
comment an earlier iteration tagged `apply`, write an
`implement-suggestion-lessons` lesson (LoreKit tag
`loop::implement-suggestion-lessons`, via `memory.write`) for that reviewer
source + topic before running the pass — this is the `Watch re-flag` write point
in
[`self-improvement-loop.md#write-lessons`](./self-improvement-loop.md#write-lessons).
The lesson is advisory (it biases the next run's Phase 3 / Phase 4); it never
changes the current iteration's gates.

## Waiting for new review activity

Run the shared [review-activity poll](../../../../agents/shared/rules/review-activity-poll.md#the-poll).
That file is the owner of the procedure — call it, never restate it. Issue its
Bash call with the tool parameter `timeout: 600000`, and clamp `--interval` to
540 as the parameter table above states.

Map its [caller-neutral outcomes](../../../../agents/shared/rules/review-activity-poll.md#outcomes-caller-neutral)
onto this loop:

| Poll outcome | Watch mode does |
| ------------ | --------------- |
| `NEW_FEEDBACK` | Run the pass |
| `NO_FEEDBACK` | On iteration 1, still run one pass (there may be feedback that predates the loop, e.g. a bot that reviewed before the watch started); on later iterations, stop with reason `reviewers quiet` |
| `POLL_ERROR` | `gh` failed; report the stderr and escalate. **Never** treat a broken probe as an absence of feedback |

The poll is a *liveness probe* (did anyone post?). The actual actionable/nit
classification and filtering still happens in Phases 2–4 of the pass — the probe
only decides whether to run a pass, not what to apply.

## CI state is a stop reason, not a fix

Watch mode **never fixes CI**. Fixing red CI belongs to `ci-auto-fix`, and
composing the two belongs to [`review-loop`](../../../quality/review-loop/SKILL.md)
— see [Relationship to other skills](../SKILL.md#relationship-to-other-skills).

But continuing to apply comment after comment on a branch whose CI is already red
wastes iterations and buries the real blocker under a pile of fix commits. So after
each iteration's push, read the check state once — stateless, current head, no watch:

```bash
gh pr checks <pr-number> --repo <owner>/<repo>
```

Classify the result exactly as [`phase-7-ci-gate.md` Step 1](../../../workflow/autonomous-workflow/rules/phase-7-ci-gate.md#step-1-identify-the-pr--initial-watch) does — "no checks reported" is three different states, and a bare `gh pr checks` **exits non-zero while merely pending**, printing to stdout, so non-zero with empty stderr means "registered and running", not an error.

| Check state | Watch mode does |
| ----------- | --------------- |
| All terminal and passing | Continue the loop |
| Any still pending | Continue the loop — never wait here. Record the state as **unread**, not green (see the re-read below) |
| Any check failing | **Stop** with reason `ci red — <check names>`. Surface the failing checks in the report and name `ci-auto-fix` (or `review-loop`, which composes both) as the next step |
| Query errored (exit 127, or stderr naming auth / network / rate limit) | Tooling failure, not "no CI". Report and escalate — the same rule as `POLL_ERROR` |
| Nothing reported, query succeeded, and this iteration just pushed | Not registered yet. Run the shared [registration poll](../../../delivery/create-pr/rules/registration-poll.md#the-poll) and re-classify from its outcome; `no-ci` means this repo genuinely has no CI and counts as green |

**Re-read before you stop, or the `ci red` stop never fires.** This read runs
seconds after the iteration's own push, when every check is pending or not yet
registered, so a single post-push read almost always classifies as "continue" and
the red arrives during the next wait. So: whenever the recorded state is `unread`
(pending, or the registration poll came back still-pending), read it **once more**
at the current head immediately before the loop stops — for any stop reason, cap
included — and classify with the same table. Never report a CI state you did not
read at the head you are stopping on.

This is **reporting, not fixing**: watch mode dispatches nothing, pushes no CI fix,
and spends none of the `ci-auto-fix` handoff budget that
[`create-pr` Step 9](../../../delivery/create-pr/SKILL.md) and `phase-7-ci-gate.md`
own. It stops early and hands off cleanly.

## Report (watch mode)

Replace the single Phase 7 table with a per-iteration roll-up, then the standard final state:

```markdown
## Implement-Suggestion (watch) — <owner>/<repo>#<n>

| Iter | New feedback | Applied | Surfaced | Skipped | Commits | Pushed | Resolved |
|------|--------------|---------|----------|---------|---------|--------|----------|
| 1    | 4            | 3       | 1        | 0       | abc1234, def5678, 9a0bcde | ✓ | 3/3 |
| 2    | 1            | 1       | 0        | 0       | c0ffee1 | ✓ | 1/1 |
| 3    | 0            | —       | —        | —       | —       | —      | —   |

Stopped: reviewers quiet after 3 iterations.
Head commit: def5678
Surfaced (needs you): <one line per surfaced comment across all iterations, or "none">
```

`Stopped:` is one of: `reviewers quiet`, `nothing actionable left`, `ci red — <check names>`, `iteration cap (<n>)`, `poll error`.

On a `ci red` stop, list the failing check names and name the handoff (`ci-auto-fix`, or `review-loop` which composes both) — the loop fixes no CI itself.

## Hard rules (in addition to the skill's global Hard Rules)

- **Never exceed the iteration cap.** The loop is bounded; a runaway bot conversation must terminate.
- **Never undraft the PR.** Watch mode applies and pushes; it never marks the PR ready-for-review. The user decides readiness.
- **Never lower the confidence gate to "make progress".** A surfaced comment stays surfaced across every iteration.
- **Never re-apply a comment already processed in an earlier iteration.** Advance the baseline timestamp after each pass.
- **Never `--force` push.** Inherited; watch mode pushes fast-forward only.
- **Never fix CI.** Watch mode reads check state to decide whether to *stop*; it dispatches no `ci-auto-fix`, pushes no CI fix, and spends none of the 2-handoff budget owned by `create-pr` Step 9 / `phase-7-ci-gate.md`.
