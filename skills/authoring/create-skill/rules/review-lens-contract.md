---
title: 'Review-Lens Contract — Letting the Reviewer Agent Borrow a Skill'
impact: HIGH
tags:
  - reviewer
  - lens
  - token-budget
  - contract
---

# Review-Lens Contract

When the user invokes the `reviewer` agent with `--with <skill-name>`, the
agent loads a small, fixed-shape file called a **lens** from each named
skill and applies it as an additional review rubric.
This contract specifies exactly what a lens file looks like, where it
lives, and what the reviewer is allowed to do with it.

The contract exists to keep the feature **token-cheap**:
loading the entire `SKILL.md` of every referenced skill would burn 3–10 k
tokens per review.
A lens file is capped at ≤ 80 lines / ≤ 600 tokens — the reviewer can
afford to load three of them.

## Hard rules

1. **One file, one path.** A lens lives at `skills/<category>/<name>/lens.md`,
   top-level, sibling to `SKILL.md`. No nested lenses. No `rules/lens.md`.
   The reviewer reads exactly this path and nothing else when applying the
   lens.
2. **Hard size cap.** ≤ 80 lines, ≤ 600 tokens. Lenses that exceed this
   cap MUST be split or trimmed — the reviewer will refuse to load
   anything larger than 1 000 lines as a defensive guard.
3. **Max three lenses per invocation.** The reviewer enforces
   `--with a,b,c` (three items max). The fourth is rejected with a clear
   error. This bounds worst-case load at ~1.8 k tokens.
4. **No fallback to SKILL.md.** If `lens.md` is missing, the reviewer
   warns once (`skill X has no lens — skipping`) and continues. It does
   NOT read `SKILL.md` as a fallback — that would defeat the token
   budget.
5. **Lens findings flow through the existing Quality Gate.** Lens
   criteria go through Step 2.5 (`/aw-review-quality-gate`) just like
   built-in findings. A lens cannot bypass the gate.
6. **Lenses are additive.** The reviewer's existing auto-loads
   (`code-quality`, `ux`, `critical`) still fire on the same triggers.
   Passing `--with code-quality` when code-quality already auto-loads is
   a no-op (the reviewer dedupes by skill name).

## File shape

A lens MUST conform to this exact structure:

```markdown
---
for: reviewer
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
| `for`          | yes      | Always `reviewer` for v1. Reserved field for future consumers.                |
| `lens-version` | yes      | Schema version. Currently `1`. Reviewer rejects unknown versions.             |
| `applies-to`   | yes      | Glob list (e.g. `**/*.tsx, app/**/*.ts`) or the literal string `always`.      |

### Section rules

- **`## Trigger`** — short prose. Repeats `applies-to` for human readers
  and adds context the glob can't express ("only when the diff defines a
  new tool-use loop").
- **`## Checklist`** — flat list of GitHub-style checkboxes. Each item is
  a single sentence, falsifiable, and ends with an action verb. No
  nested bullets, no headings.
- **`## Severity hints`** — optional, but recommended. Maps checklist
  items to verdict tiers so the reviewer knows what's blocking.

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

## What the reviewer does at runtime

For each `--with <name>`:

1. Resolve `~/.claude/skills/<name>/lens.md`.
2. If absent → warn, skip, continue.
3. If present → read it; reject if `lens-version` is unknown or if file
   exceeds 1 000 lines (defensive guard against accidentally pointing at
   the wrong file).
4. Parse `applies-to`. If `always`, apply unconditionally. If a glob
   list, apply only when at least one changed file matches.
5. During Step 2, iterate the checklist. Each item that fails becomes a
   finding tagged `[lens:<skill-name>]`.
6. Each lens finding flows through the Quality Gate in Step 2.5 like any
   other finding.
7. Step 3 lists active lenses in the summary table:

   ```
   Active lenses: ai-engineering (3/9 items flagged), tdd (0/6 items flagged)
   ```

## Versioning

`lens-version: 1` covers the contract described above.
Future versions will be additive (new optional fields, new sections).
A reviewer that supports version N MUST refuse to load a lens declaring
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
5. Test with `reviewer --pr <PR-URL> --with <your-skill>` on a known PR.
6. Add a one-line note to your skill's `SKILL.md` saying "Lens-eligible
   for the `reviewer` agent — see `lens.md`."

## Anti-patterns

- ❌ Lens that just `@imports` the full `SKILL.md`. Defeats the budget.
- ❌ Lens checklist items that require running code or reading other
  files. The reviewer applies lenses against a diff only.
- ❌ Lens with no `applies-to`. Always apply or always-skip — never
  ambiguous.
- ❌ Multiple lens files per skill. One file. One path.
- ❌ Lens prose longer than the checklist. The checklist is the
  product; everything else is scaffolding.
