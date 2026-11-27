---
title: Flag policy — which user-visible changes need a feature flag, and which may ship without one
impact: HIGH
tags: [atelier, merge, gate, flag, deployment-verify, ui]
---

# Flag policy

A flag is a rollout tool.
A change that has nothing to roll out does not need one, and a registry full of flags nobody will ever flip is its own cost.
The merge gate ([`merge-gate.md`](./merge-gate.md)) therefore asks two questions of a user-visible diff that has no flag contract: does a hard trigger hit, and did the author class the change as one that needs no rollout.
**Why:** [`../references/design.md` § The merge gate](../references/design.md#the-merge-gate).

## Hard triggers

The gate counts these itself, from the PR's file list (`gh pr view --json files`), and the author cannot override them.
When one hits, the change needs a flag and a flag contract, and a marker is ignored.

| Trigger | Hits when | Default | `merge.yml` key |
| --- | --- | --- | --- |
| New route | a file the PR adds, renames, or copies into a route glob (a moved page is a new URL) | `**/app/**/page.{tsx,ts,jsx,js}`, `**/pages/**` | `route_globs` (replaces the list) |
| Always-flag path | any changed file matches a glob | none | `always_flag` |
| Large diff | added plus deleted lines in the diff's UI files exceed the limit | 150 | `max_unflagged_lines` |
| Many new files | the PR adds more UI files than the limit | 2 | `max_new_ui_files` |

The UI files are the ones `is-ui-diff.mjs` matches, so tests and the `exclude` globs in `.agents/aw/ui.yml` never count.
When the gate cannot count (no file list, a UI file missing from it, or a file with no change type) it refuses a marker instead of guessing: an unknown size is never a small one.
A rename adds no code, so it does not count toward the new-file limit; a copy does.

## The no-flag marker

Below the triggers, the author may ship without a flag by putting this in the PR body:

```text
<!-- atelier:no-flag — <class>: <why> -->
<!-- atelier:no-flag — already-flagged <flag>: <why> -->
```

The reason is required, one line, and says why nothing needs rolling out.
The class is a closed list, so a reviewer can check it at a glance.

| Class | Use it when | Not when |
| --- | --- | --- |
| `bugfix` | the change restores behaviour that was meant to be there | it changes behaviour on purpose, even a little |
| `copy` | only text changes: a label, a message, a translation | the text change reorders or hides something |
| `style` | spacing, colour, or alignment, with no change to what a control does | it changes layout enough that a user must relearn it |
| `a11y` | the change adds a label, a role, focus handling, or contrast | it changes what a keyboard or screen-reader user can do |
| `refactor` | the rendered output and behaviour are the same | any pixel or interaction differs |
| `internal` | a surface only staff or tests see | customers can reach it |
| `already-flagged <flag>` | the change sits inside a flag that already exists and is off for users | the flag is already on for users |

```text
✗ <!-- atelier:no-flag — bugfix: new empty state for the dashboards list -->   # a new state is a new surface
✓ <!-- atelier:no-flag — bugfix: the dashboards list lost its sort order after the last refactor -->
✗ <!-- atelier:no-flag — copy -->                                                # no reason
✓ <!-- atelier:no-flag — copy: "Dataset" is now "Data set" in the settings page title -->
```

## What a no-flag change still needs

| Repo | Needs | Gate decision |
| --- | --- | --- |
| hosted (`release.yml` detects production deploys) | the marker, and the same `deployment-verify:v1` contract a non-UI change carries: `service` and `root_spans`, no `flag` | `pass`; Deliver then watches the deploy and opens a revert PR when it regresses |
| hosted | the marker without that contract | `refuse`, asking for the before/after contract |
| not hosted | the marker | `pass` with `warning: no deploy verify runs here: nothing watches this change after the merge` |

A flag contract always wins: with one, the gate passes the diff as it always did and ignores the marker.

## `merge.yml`

```yaml
# .agents/aw/merge.yml — every key optional; a missing block means the defaults above.
flag_policy:
  max_unflagged_lines: 150
  max_new_ui_files: 2
  route_globs: ["components/ui/src/app/**/page.tsx"]   # replaces the default list
  always_flag: ["components/ui/src/**/navigation/**", "components/ui/src/**/onboarding/**"]
  classes: [bugfix, copy, style, a11y, refactor, internal, already-flagged]   # narrow the list; never add one
  require_flag: always                                  # every user-visible diff needs a flag, as before this policy
```

A value the gate cannot read (a negative limit, an unknown class, `require_flag` set to anything but `always`) stops it with exit 2, and it never merges on a policy it misread.

## Never

```text
✗ pick a class so a flag is not needed, on a diff the triggers already flagged   # the gate ignores the marker; the author's word never lowers a trigger
✗ edit the PR body to add a marker after the gate refused on a trigger          # same refusal, and a second one is a human's call
✓ trigger hit → add the flag and the flag contract, or ask a human to change flag_policy
```
