---
title: 'Review-Lens Contract — Letting the pr-reviewer Agent Borrow a Skill'
impact: HIGH
tags:
  - pr-reviewer
  - lens
  - token-budget
  - contract
---

# Review-Lens Contract

The `pr-reviewer` and `branch-reviewer` agents load small, fixed-shape files
called **lenses** and apply each as an additional review rubric: a lens a skill
ships (`skills/<category>/<name>/lens.md`), or a lens a team keeps in the
reviewed repo (`.agents/review/lenses/<name>.md`).
A lens loads when its trigger matches the diff, when a `.review.yaml` lists it
under `lenses:`, or when the caller names it with `--with <name>`.
This contract specifies exactly what a lens file looks like, where it
lives, and what the reviewing agent is allowed to do with it.

## Contents

- Hard rules
- File shape
- Writing a good lens
- What the pr-reviewer does at runtime
- Team lenses in the reviewed repo
- Versioning
- Opting an existing skill in
- Anti-patterns

The contract exists to keep the feature **token-cheap**:
loading the entire `SKILL.md` of every referenced skill would burn 3–10 k
tokens per review.
A lens file is capped at ≤ 80 lines / ≤ 600 tokens, so each one is cheap; the
reviewer grows its tool-call budget per lens instead of capping the count.

## Hard rules

1. **One file, one path.** A lens lives at `skills/<category>/<name>/lens.md`,
   top-level, sibling to `SKILL.md`. No nested lenses. No `rules/lens.md`.
   The `pr-reviewer` reads exactly this path and nothing else when applying the
   lens.
2. **Hard size cap.** ≤ 80 lines, ≤ 600 tokens. Lenses that exceed this
   cap MUST be split or trimmed — the `pr-reviewer` will refuse to load
   anything larger than 1 000 lines as a defensive guard.
3. **No count cap.** Any number of lenses may load; `route-depth.mjs` adds
   `LENS_CALLS` to the tool-call budget for each lens past the first three.
4. **No fallback to SKILL.md.** If `lens.md` is missing, the `pr-reviewer`
   warns once (`skill X has no lens — skipping`) and continues. It does
   NOT read `SKILL.md` as a fallback — that would defeat the token
   budget.
5. **Lens findings flow through the existing Quality Gate.** Lens
   criteria go through Step 2.5 (dedupe + consolidate) just like
   built-in findings. A lens cannot bypass the gate.
6. **Lenses are additive.** `--with` adds to the lenses the diff already
   triggered; a name already loaded is a no-op (dedupe by name).
7. **Selection is a script, not judgment.** `agents/pr-reviewer/scripts/select-lenses.mjs`
   decides which lenses load and why; the reviewer walks exactly its list.

## File shape

A lens MUST conform to this exact structure:

```markdown
---
for: pr-reviewer
lens-version: 1
applies-to: <glob list OR "always">
---

# <Skill Name> — Review Lens

## Trigger

<1–3 lines: when this lens should be applied. Either echo the
`applies-to` glob in prose, or describe the diff shape that signals the
lens is relevant.>

## Checklist

- [ ] <criterion — testable, falsifiable, ends with a verb>
- [ ] <criterion>
- [ ] <criterion>
...

## Severity hints (optional)

- **Must-fix**: <which checklist items are blocking>
- **Should-fix**: <which are non-blocking suggestions>
- **Nice-to-have**: <which are praise-or-skip>
```

### Frontmatter fields

| Field          | Required | Notes                                                                         |
| -------------- | -------- | ----------------------------------------------------------------------------- |
| `for`          | yes      | Always `pr-reviewer` for v1. Reserved field for future consumers.             |
| `lens-version` | yes      | Schema version. Currently `1`. `pr-reviewer` rejects unknown versions.        |
| `applies-to`   | yes      | Glob list (e.g. `**/*.tsx, app/**/*.ts`) or the literal string `always`. Optional in a repo lens, where absent means `always`. |
| `auto`         | no       | `true` loads the lens whenever its trigger matches, without being named. Repo lenses default to `true`; skill lenses to `false`. |
| `diff-matches` | no       | Regexes (comma list, or a block list for a regex containing a comma), at least one of which must match an added line in a file `applies-to` matched. Single-quote each regex. |
| `min-tier`     | no       | `quick`, `standard`, or `deep`: load only when the review's depth tier is at least this. |

A named lens (`--with`, `.review.yaml` `lenses:`) checks only `applies-to`;
`auto`, `diff-matches`, and `min-tier` decide automatic loading.

### Section rules

- **`## Trigger`** — short prose. Repeats `applies-to` for human readers
  and adds context the glob can't express ("only when the diff defines a
  new tool-use loop").
- **`## Checklist`** — flat list of GitHub-style checkboxes. Each item is
  a single sentence, falsifiable, and ends with an action verb. No
  nested bullets, no headings.
- **`## Severity hints`** — optional, but recommended. Maps checklist
  items to verdict tiers so the `pr-reviewer` knows what's blocking.

## Writing a good lens

A lens is **not** a summary of your skill.
It is the subset of your skill that is *actionable in a diff review*.

| Belongs in a lens                           | Belongs in `SKILL.md` / `rules/`                         |
| ------------------------------------------- | -------------------------------------------------------- |
| "Was a system prompt added without caching?" | The full prompt-caching tutorial                         |
| "Is the locator ladder followed?"           | Why the locator ladder exists, alternatives, edge cases  |
| "Are tool descriptions ≤ 1024 chars?"       | How to write good tool descriptions                      |
| Short, testable yes/no questions            | Long-form explanations, worked examples, decision trees  |

If the checklist item cannot be answered by reading a diff hunk in
isolation, it does not belong in the lens.
Push it back into the skill body.

## What the pr-reviewer does at runtime

`select-lenses.mjs` runs once per review (from `prepare-review.mjs`, or by
`branch-reviewer` on local git):

1. Read `.agents/review/lenses/*.md` and every `.review.yaml` governing a
   changed file at the **base** commit. A lens the PR adds is not loaded.
2. Resolve each named lens, first match wins: `.agents/review/lenses/<name>.md`
   → repo `.agents/skills/<name>/lens.md` → a lens bundled with the agent →
   `$HOME/.claude/skills/<name>/lens.md`. A missing name is skipped with a reason.
3. Reject a lens with an unknown `lens-version`, a bad `min-tier`, an invalid
   regex, or over 1 000 lines; it is skipped with a reason, never half-loaded.
4. Match each trigger (`applies-to`, then `diff-matches`, then `min-tier`) and
   record the files it matched.
5. During Step 2, the reviewer walks each loaded lens's checklist against those
   files. Each failing item becomes a finding tagged `[lens:<name>]`, deduped and
   consolidated at Step 2.5 like any other finding.

## Team lenses in the reviewed repo

A team adds a rule the reviewer must check on its code by committing one file:

1. Create `.agents/review/lenses/<name>.md` in the repo under review. `<name>` is the lens name.
2. Write `applies-to` for the team's paths, and `diff-matches` when the rule only matters for certain calls.
3. Write 3–15 checklist items a reviewer can decide from the diff alone.
4. Add a `CODEOWNERS` line for the file so the team owns its changes.
5. Merge it. The reviewer reads lenses at the base commit, so a lens reviews the PRs that come after the one adding it.

```markdown
<!-- ✓ Right — .agents/review/lenses/feature-flags.md: a house rule no generic reviewer knows -->
---
applies-to: "apps/web/**"
diff-matches: 'useFlag\('
---
# Feature flags — Review Lens
## Checklist
- [ ] Every new `useFlag(` call names a flag declared in `apps/web/flags.ts`.
- [ ] A flag-gated branch keeps the old code path working when the flag is off.

<!-- ✗ Wrong — vague items that restate the quality checklist and need no repo knowledge -->
---
applies-to: always
---
- [ ] Code is clean and readable.
```

Use `.review.yaml` `lenses: [<name>]` instead when a lens has `auto: false` or is a
built-in skill lens the team wants on its directory only; use `REVIEW.md` for facts
about the code that are not a checklist.
A repo lens with a built-in's name (for example `ux.md`) replaces the built-in for that repo.

## Versioning

`lens-version: 1` covers the contract described above.
Future versions will be additive (new optional fields, new sections).
A `pr-reviewer` that supports version N MUST refuse to load a lens declaring
version N+1 — refuse, don't degrade silently.

## Opting an existing skill in

To make an existing skill lens-eligible:

1. Identify the 5–15 checklist items in your skill that are
   diff-reviewable.
2. Copy `skills/authoring/create-skill/templates/lens.md` to
   `skills/<your-skill>/lens.md`.
3. Fill in `applies-to` and the checklist.
4. Verify the line count: `wc -l skills/<your-skill>/lens.md` must be
   ≤ 80.
5. Test with `/pr-review <PR-URL> --with <your-skill>` on a known PR.
6. Add a one-line note to your skill's `SKILL.md` saying "Lens-eligible
   for the `pr-reviewer` agent — see `lens.md`."

## Anti-patterns

- ❌ Lens that just `@imports` the full `SKILL.md`. Defeats the budget.
- ❌ Lens checklist items that require running code or reading other
  files. The `pr-reviewer` applies lenses against a diff only.
- ❌ Skill lens with no `applies-to`. Always apply or always-skip — never
  ambiguous. (A repo lens may omit it: absent means `always`.)
- ❌ Multiple lens files per skill. One file. One path.
- ❌ Lens prose longer than the checklist. The checklist is the
  product; everything else is scaffolding.
