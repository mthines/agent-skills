# pr-reviewer report shape guard

A GitHub Actions reusable workflow that validates a **posted** `pr-reviewer` body against the report
shape contract, from outside the agent.

## Why this exists

The report shape has four layers of enforcement, and until this one they all ran somewhere the agent
controls:

| Guard | Where it runs | Sees a posted report? |
| --- | --- | --- |
| L1 `G25` (439 checks) | CI, against `agent-skills` | **No** — it validates the repository |
| `render-report.mjs` fail-closed | inside the run | Only if the run invokes it |
| Step 4a pre-write assertions | inside the run | Only if the run reaches them |
| ingest round-trip | CI, against fixtures | **No** — committed fixtures, not live output |

So a run that simply hand-writes the body is invisible to every one of them. That is not theoretical.
On `mthines/lorekit#503` the same agent definition produced the correct shape three times and then a
flat, marker-less body on the fourth run 24 minutes later:

| Time (UTC) | Review | Shape |
| --- | --- | --- |
| 17:44 | `4964076700` | accordion, counts, links correct |
| 17:56 | `4964171425` | correct |
| 18:07 | `4964277130` | correct |
| 18:31 | `4964475125` | **flat** — no marker, no accordion, gate table at top level |

This workflow is the first check that looks at what was actually published.

## What it checks

Run `node scripts/validate-report-shape.mjs <file>` locally to see the same verdict.

| Code | Meaning |
| --- | --- |
| `missing-report-marker` | The body carries report sections but no `<!-- PR_REVIEWER_REPORT -->` |
| `report-marked-as-pointer` | A full report carries the pointer marker, so a later run recovers it as a pointer and reads the report as absent |
| `no-review-details-accordion` | No `<details>` immediately followed by `<summary>Review details` — the report renders expanded |
| `accordion-pre-expanded` | A `<details>` carries `open` |
| `accordion-owned-line-at-top-level` | A gate table, run mode, memories, quality or footer line renders above the accordion |
| `verdict-in-posted-body` | The Step 3 advisory verdict is terminal-only |
| `link-caged-in-code-span` | A markdown link wrapped in backticks renders as dead monospace text |
| `count-disagrees-with-list` | `**Open bot threads (N)**` does not equal the bullets under it |
| `summary-count-disagrees` | The `<summary>` counter disagrees with the list |
| `pointer-too-long` / `pointer-carries-sections` | A pointer body grew into a report |

A body that is not a `pr-reviewer` report or pointer is ignored, so ordinary PR comments never
trigger it.

## Installation

1. Copy `templates/report-shape-caller.yml` to `YOUR_REPO/.github/workflows/reviewer-report-shape.yml`.
2. That's it — no secrets.

The validation logic stays in `mthines/agent-skills` and tracks `@main`, so pin a tag instead if you
want to control upgrades.

## What it does on a violation

It posts **one** sticky notice comment per PR (marked `<!-- PR_REVIEWER_SHAPE_GUARD -->`), rewritten
in place on later runs, so a repeatedly-drifting reviewer leaves one comment rather than a thread per
run. When a later post conforms it rewrites the notice to say so rather than deleting it, keeping the
record that drift happened.

It is **read-only on the reviewer's objects**: it never edits or deletes a report, because a
malformed body is still evidence of what the run did, and rewriting it would hide the failure this
guard exists to surface.

By default a violation does not fail the check — a malformed report body does not mean the review's
findings are wrong. Set `fail-the-check: true` in the caller to gate a branch on it.
