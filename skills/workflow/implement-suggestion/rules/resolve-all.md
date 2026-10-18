# `--resolve-all` modifier

Loaded only when `--resolve-all` is in `$ARGUMENTS`.
Default is off: without it, non-fix comments are surfaced and their threads left open.
`review-loop` passes it so the loop can converge a PR to zero open threads.
It composes with `--watch`; free-text mode ignores it (no threads to resolve).

## Dispositions

In addition to applying fixes, the worker gives every fetched thread an explicit disposition and closes the ones it can honestly close:

| Disposition | Thread action |
| --- | --- |
| Fix applied (`apply`) | reply `Addressed in <sha>` + resolve (unchanged) |
| `question` | reply with the answer + resolve |
| `discussion`, or an `actionable`/`nit` the gates declined | reply with the rationale (a decline) + resolve |
| `praise` | drop silently (no thread action) |
| Genuine human-judgment flag — a real potential issue the agent will not auto-apply **and** cannot honestly decline (e.g. a `/critical` **Must-fix** surface, or a `surface`-band actionable) | **leave open** + surface, with a reply noting why it is flagged |

The last row is the safety valve: it never force-resolves a live finding.

## Per-phase deltas

| Phase | Change under `--resolve-all` |
| --- | --- |
| 3 — Classify | `discussion` / `question` are not skipped: they are carried into the pack as reply-only entries (no code change). A declined `actionable` / `nit` is reply-and-resolved in Phase 6 with its rationale. |
| 5 — Pack | Set `resolve-all: true` in the pack frontmatter and add the `## Reply-only` section: one entry per `question` / `discussion` / declined comment with its `disposition` (`answer` / `discussion` / `decline` / `flag`), thread ID, and the exact reply text the worker will post. |
| 6 — Handoff | After the commit/push pass, the worker posts a reply for every reply-only entry — the answer for a question, the agent's take for a discussion, the decline rationale for a gated-out change — then `resolveReviewThread`. Reply-only entries have no commit and push nothing. A human-judgment flag gets a reply noting why it is flagged and its thread stays open. Failures in this pass are non-fatal, like the fix-thread resolves. Contract: [`handoff.md#worker-prompt-template`](./handoff.md#worker-prompt-template). |
| 7 — Report | Add an `Answered` column: `<threads-answered-and-resolved>` — `question` / `discussion` / declined comments closed with a reply (no commit). `Surfaced` then counts only the human-judgment flags left open on purpose; `Surfaced` = `0` means the PR has zero open threads and the caller (`review-loop`) can exit. Report each still-open flag on its own line. |

## Hard rule

`--resolve-all` never green-washes.
It closes only threads it can honestly close (fix landed, question answered, discussion taken, change explicitly declined with a rationale).
A real potential issue the agent will not auto-apply and cannot honestly decline stays open and is surfaced — the same invariant as `thread-resolution.md`'s "never resolve a persisting/unaddressed finding".
Resolving to make a loop terminate is forbidden.
