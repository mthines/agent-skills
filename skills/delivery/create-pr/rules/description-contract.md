---
title: PR description contract — the shared narrative + length rules
impact: HIGH
tags:
  - create-pr
  - review-loop
  - pr-description
  - single-source-of-truth
---

# PR description contract

The single source of truth for **what a good PR body looks like** and **how to
write it**. Two skills consume this contract:

- `create-pr` — writes the initial body when it opens the draft PR.
- `review-loop` — refreshes the body after the loop converges, so the
  description matches the code that actually shipped (fixes applied during the
  loop can drift the diff away from `create-pr`'s first draft).

Both apply the same body via `gh` (`gh pr create --body …` for the first write,
`gh pr edit --body …` for a refresh). This file owns the contract; neither skill
restates it.

## Length budget — the hard rule

A reviewer should read the entire description in **under 30 seconds**. Concretely:

- **Body target: ≤ 25 rendered lines.** Hard ceiling: 40. Tables, checklists, and blank lines all count toward this.
- **Why: 1–2 sentences.** Not paragraphs.
- **What changed: 2–4 bullets, one line each.** No sub-bullets, no code blocks inside bullets.
- **How to verify: ≤ 3 lines.** Prefer a single command over prose.
- **Notes for reviewers: optional. If present, ≤ 2 sentences.** Move implementation detail into code comments or PR review threads, not the body.

If you can't fit the change inside this budget, the PR is probably too big — stop and offer the user `/create-pr --split` instead of expanding the description.

## Core principles

1. **Narrative over checklist.** Reads like prose explaining a decision, not a bullet-point manifest of every file touched.
2. **Why first, then what, then how to verify.** Motivation drives understanding. A reviewer should be able to predict the diff after reading the description.
3. **Group by concept, not by file.** Don't enumerate every changed file — describe the *ideas* the change introduces.
4. **No filler.** Skip empty checklists, stock "Code follows guidelines" boxes, and boilerplate that adds noise without information.
5. **One line per bullet.** If a bullet wants a follow-up clause, it's two changes — split or cut the second.

## Step 1: Gather information

Run these in parallel:

```bash
git branch --show-current
git log main..HEAD --oneline
git diff main...HEAD --name-status
git diff main...HEAD --stat
git diff main...HEAD              # full diff — needed to understand intent
```

Also check for a PR template:

```bash
# Common template locations (check all)
ls .github/pull_request_template.md \
   .github/PULL_REQUEST_TEMPLATE.md \
   .github/PULL_REQUEST_TEMPLATE/ \
   docs/pull_request_template.md \
   PULL_REQUEST_TEMPLATE.md 2>/dev/null
```

When **refreshing** an existing PR (the `review-loop` case), diff against the
PR's base branch and read the PR's current body first, so the refresh is a
minimal edit rather than a rewrite — keep the reviewer's mental model stable.

## Step 2: Understand the narrative

Before writing anything, answer these questions for yourself by reading the diff:

- **What problem or goal motivated this change?** (the *why*)
- **What is the core idea of the solution?** (one sentence — the *headline*)
- **What are the 2–4 conceptual moves the diff makes?** (not files — concepts)
- **What should a reviewer pay extra attention to?** (risk areas, judgment calls, follow-ups)
- **How was it verified?** (tests added, manual checks, scenarios covered)

If you can't answer these from the diff alone, ask the user — don't pad the description with guesses.

## Step 3: Choose output format

**Branch A — Repository has a PR template:** Use it. Fill each section with the *narrative* version (short, focused, no filler). Leave optional sections empty rather than padding with `N/A` boilerplate. Keep checkbox lists if the template has them, but only check what genuinely applies.

**Branch B — No PR template:** Use the lean default below. Do not invent extra sections.

### Lean default (when no template exists)

```markdown
## Why

[1–2 sentences. The problem or user-visible outcome. Link the issue if there is one. Don't restate the title.]

## What changed

- [Conceptual change 1 — one line]
- [Conceptual change 2 — one line]
- [Conceptual change 3 — one line]

## How to verify

- [Single test command or one scenario, one line]

## Notes for reviewers

[Optional, ≤ 2 sentences. Skip this section entirely if there's nothing load-bearing to flag.]
```

Aim for **2–4 bullets** under "What changed". If you have 6+, the PR is too big or you're enumerating files instead of concepts.

## Step 4: Write the title

- Imperative mood, specific, under ~70 chars.
- Follow Conventional Commits if the repo uses them: `type(scope): brief description`.
- Good: `fix(auth): refresh token when API returns 401`
- Bad: `Bug fix`, `Various improvements`, `feat: stuff`

## Step 5: Length self-check (before writing the body)

Count the rendered lines of the body. If it's over 25, cut. Common cuts:

- **Collapse "Notes for reviewers"** unless it flags a real risk or judgment call. "We chose X because Y" usually belongs in a code comment.
- **Drop "internal narration"** — explanations of memo deps, useEffect timing, and other implementation detail that a reviewer will read in the diff anyway.
- **Merge bullets that share a verb.** "Added X. Added Y. Added Z." → one bullet listing the three.
- **Cut "How to verify" prose** — one command beats three sentences.
- **Drop sub-bullets entirely.** If a bullet needs a sub-bullet, split it into two top-level bullets or remove the detail.

If you've cut as much as you can and it's still over 40 lines, the PR is too big. Stop and offer the user `/create-pr --split` before pushing.
