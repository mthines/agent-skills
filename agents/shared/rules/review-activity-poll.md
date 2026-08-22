# Review-activity poll

**This file is the owner of the procedure.** Two callers consume it:
[`implement-suggestion --watch`](../../../skills/workflow/implement-suggestion/rules/watch-mode.md#waiting-for-new-review-activity)
and [`review-loop --external-review`](../../../skills/quality/review-loop/SKILL.md#sub-step-a--external-review-mode).

Neither caller may edit the procedure or restate it. Change it here, then re-read
both callers' outcome mappings. Ownership stated in prose is what prevents drift —
the directory only implies it.

> **Why a shared file and not a copy.** This block encodes five properties that are
> individually easy to drop and collectively load-bearing: `updated_at` over
> `created_at`, `--paginate` with a line-per-match `--jq` (the REST default page
> size is 30, and gh runs `--jq` once per page), a guarded `count()` that separates
> a broken `gh` from an empty result, the interval clamp under the harness tool cap,
> and the bare-fence requirement. A copy forks all five. Call this file; do not
> paste it.

## What this answers

Exactly one question: **has any reviewer posted or edited feedback since a given timestamp?**

Never *what* the feedback says. Classifying actionable-vs-nit is the caller's
pipeline (`implement-suggestion` Phases 2–4). This is a liveness probe: it decides
whether to run a pass, not what to apply.

## Why it is needed

A caller that waits on an external reviewer has no return value to read — the
reviewer is another process writing to GitHub. Sleeping a fixed interval wastes
the reviewer's turnaround; polling `created_at` alone misses a report **rewritten
in place**, which is how `pr-reviewer` (and any agent using a sticky comment)
publishes a re-review.

## Access path

This block is the **`gh` path**. Resolve your GitHub access first per
[`github-access.md`](./github-access.md) — `gh` is **absent in Claude Code cloud
sessions**. On the MCP path, poll the equivalent read verbs on the same bounded
schedule (interval clamp and tool timeout unchanged) and apply the identical
three-way outcome mapping below; with **neither** path, say so precisely and hand
back rather than reporting the reviewers quiet.

## The poll

Poll instead of sleeping the full interval — proceed as soon as a reviewer posts,
so a fast reviewer does not cost a full interval. Run this as a single Bash call
per wait step (internal loop, so it is not a bare `sleep`).

**Two bounds are required, and the second is the one that is easy to miss.** The Bash tool's timeout **defaults to 120 000 ms** and maxes at 600 000 ms, so a loop whose own `INTERVAL` exceeds 120 s is killed by the harness before its `NO_FEEDBACK` break can fire — the internal bound becomes dead code and the wait looks like a hang. Therefore:

- **Issue this Bash call with the tool parameter `timeout: 600000`.**
- **Clamp the caller's `--interval` to 540 seconds** (below the 600 s tool cap). Values above 540 are clamped silently.

```bash
# Issue this Bash call with the tool parameter timeout: 600000.
PR_URL="<pr-url>"; SINCE="<baseline-timestamp>"; INTERVAL=300; POLL=30   # INTERVAL <= 540
read OWNER REPO NUMBER < <(echo "$PR_URL" \
  | sed -E 's|https://github.com/([^/]+)/([^/]+)/pull/([0-9]+).*|\1 \2 \3|')
# DO NOT wrap this block in `bash -c '...'` when "harmonising" it with the poll
# loops in registration-poll.md / ci-auto-fix. It contains single quotes in two
# places (the trap below and the sed above); an enclosing bash -c '...' would be
# terminated by either, silently breaking both. Those siblings avoid apostrophes
# deliberately. This block is correct only as a bare fence, bounded by the tool
# timeout plus the interval clamp.
START=$(date +%s); ERR=$(mktemp); trap 'rm -f "$ERR"' EXIT INT TERM

# A failing `gh api` prints nothing to stdout, so an unguarded $(...) yields "",
# which arithmetic reads as 0 — indistinguishable from "no new comments". That
# would report the reviewers quiet whenever gh is broken. Fail loudly instead.
#
# --paginate is required, and so is the shape of the --jq that goes with it:
#   * Without --paginate the REST default page size is 30. Past 30 comments the
#     newest sit on page 2, an unpaginated read matches none of them, and the
#     probe reports NO_FEEDBACK on real feedback — the quiet this file bans.
#   * With --paginate, gh applies --jq to EACH page separately. A --jq that
#     reduces to a per-page count therefore emits one number per line, which the
#     numeric guard below rejects and every poll returns POLL_ERROR. So emit one
#     LINE PER MATCH (.id is present on all three endpoints) and count the lines.
#   * per_page=100 keeps the page count low; it does not replace --paginate.
count() {                       # $1 = api path, $2 = timestamp field
  local n
  n=$(gh api --paginate "$1?per_page=100" \
        --jq ".[] | select(.$2 > \"$SINCE\") | .id" 2>"$ERR" | wc -l | tr -d " ")
  [ -s "$ERR" ] && return 1     # gh spoke on stderr = gh failed
  case "$n" in ''|*[!0-9]*) return 1 ;; esac
  printf %s "$n"
}

while :; do
  NEW=$(count "/repos/$OWNER/$REPO/pulls/$NUMBER/comments" created_at)   || { echo "POLL_ERROR"; { [ -s "$ERR" ] && cat "$ERR" >&2 || echo "gh returned no usable count" >&2; }; break; }
  NEW_REVIEWS=$(count "/repos/$OWNER/$REPO/pulls/$NUMBER/reviews" submitted_at) || { echo "POLL_ERROR"; { [ -s "$ERR" ] && cat "$ERR" >&2 || echo "gh returned no usable count" >&2; }; break; }
  # updated_at, not created_at: a rewritten-in-place reviewer report is new feedback even
  # though the comment itself is old. GitHub guarantees updated_at >= created_at, so this
  # subsumes the created_at test. See "Edited reports count as feedback".
  NEW_ISSUE=$(count "/repos/$OWNER/$REPO/issues/$NUMBER/comments" updated_at)   || { echo "POLL_ERROR"; { [ -s "$ERR" ] && cat "$ERR" >&2 || echo "gh returned no usable count" >&2; }; break; }
  if [ $((NEW + NEW_REVIEWS + NEW_ISSUE)) -gt 0 ]; then echo "NEW_FEEDBACK"; break; fi
  [ $(( $(date +%s) - START )) -ge $INTERVAL ] && { echo "NO_FEEDBACK"; break; }
  sleep $POLL
done
```

## Outcomes (caller-neutral)

| Outcome | Meaning | What every caller must do |
| ------- | ------- | ------------------------- |
| `NEW_FEEDBACK` | A reviewer posted or edited since `SINCE` | Run one pass |
| `NO_FEEDBACK` | The interval elapsed with nothing new | **First iteration:** still run one pass — there may be feedback predating the wait (a reviewer that reviewed before the caller started). **Later iterations:** the reviewer is quiet; stop |
| `POLL_ERROR` | `gh` failed | **Never "reviewers quiet".** Report the stderr and escalate. Treating a broken probe as an absence of feedback silently converts a tooling failure into "the reviewers had nothing to say" — and the stop reason then reads like success |

**Advance the baseline after every pass.** Set `SINCE` to "now" once a pass
completes, so the next wait sees only feedback posted in response to the latest
push. A caller that leaves `SINCE` at its original value re-reports the same
review forever and never reaches a quiet outcome.

## Edited reports count as feedback

`pr-reviewer` keeps its report in a **sticky comment it rewrites in place** every run, and posts a
review only when it has new inline findings (`pr-reviewer.md § Step 4b`). An edit moves
`updated_at`, never `created_at`. This matters more than it used to: with the notification-only
posting conditions retired, a re-review whose output is entirely body-only produces **no** review
object at all, so `created_at` sees nothing whatsoever.

A probe filtering on `created_at` alone therefore misses a re-review whose only new output is
body-only — gate rows, optimality cards, deferred `Additional findings`. The caller would report
`reviewers quiet` and stop with those findings unaddressed, and the stop reason would look like
success. Hence the `updated_at` field above, which GitHub guarantees is `>= created_at` and so
covers newly-created comments too.

The cost is one extra pass when a human merely edits a typo in their own comment; the caller's
classification phases then find nothing actionable and the loop stops on its own no-progress exit.
Stopping early on real feedback is the worse failure, so the probe errs toward running.
