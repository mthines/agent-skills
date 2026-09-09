---
title: Progressive Disclosure — The Three-Tier Loading Model
impact: HIGH
tags:
  - progressive-disclosure
  - context
  - tokens
  - structure
---

# Progressive Disclosure

Skills load in **three tiers** with very different token economics. Design
each file knowing which tier it lives in.

## Contents

- Tier 1 — metadata
- Tier 2 — `SKILL.md` body
- Tier 3 — supporting files
- Patterns
- One-level-deep references
- Long reference and rule files need a TOC
- Content lifecycle
- Don't bury the lede

| Tier | What loads                                         | When                                          | Cost                      |
| ---- | -------------------------------------------------- | --------------------------------------------- | ------------------------- |
| 1    | `name` + `description` of every installed skill    | Session start, always                         | Bounded by `skillListingBudgetFraction` (~1% of the context window), shared across every installed skill |
| 2    | The skill's `SKILL.md` body                        | When the skill is invoked / triggered         | Whatever your body weighs |
| 3    | Files referenced from `SKILL.md` (`rules/...md`)   | When Claude actively reads them on a turn     | Loaded read-by-read       |

The trick is to keep the **always-loaded** tier (1) tiny and informative,
the **invoke-loaded** tier (2) lean and navigational, and push everything
else into tier 3 where it costs nothing until needed.

## Tier 1 — metadata

You have ~1024 chars of `description`. That's the entire trailer for your
skill. Make every word work — see `description-writing.md`. When the
listing budget is tight, the least-used descriptions shrink first —
`/skill-doctor` and `/context` show the actual cost, so check one rather
than assuming your budget is unlimited.

Keep `name` short (≤ 24 chars is comfortable, ≤ 64 is the hard limit). The
skill listing puts `name` + `description` adjacent in Claude's view.

## Tier 2 — `SKILL.md` body

**Hard cap: 500 lines.** Anthropic's authoring guide recommends staying
well under this. Once `SKILL.md` is loaded, it stays in context for the
rest of the session — every line is a recurring tax.

What belongs in `SKILL.md`:

- The decision tree / mode detection.
- A workflow checklist (steps the agent must follow in order).
- A pointer table from phase → rule file.
- 1–3 boilerplate snippets if they're load-bearing.
- A "core principles" list (≤ 8 items).

What does **not** belong in `SKILL.md`:

- Long worked examples → `references/`.
- One-off rule explanations that only fire in a specific phase → `rules/`.
- Boilerplate text the skill emits literally → `templates/`.
- Anything Claude already knows (definitions of common concepts).

## Tier 3 — supporting files

| Subdirectory   | Purpose                                                       | Loaded                                  |
| -------------- | ------------------------------------------------------------- | --------------------------------------- |
| `rules/`       | Focused, self-contained guidance documents                    | When the workflow points at one         |
| `references/`  | Worked examples, citations, archetypes — long-form reading    | When the agent explicitly opts in       |
| `templates/`   | Literal text the skill emits or fills in                      | When the skill is generating output     |
| `scripts/`     | Executable helpers (Python, Bash, Node)                       | Executed via `Bash`; not read into ctx  |
| `evals/`       | This skill's own test prompts and trigger set                 | Read only during Phase 6 / review testing |

`assets/` (binary or static non-Markdown files a skill ships) is rare —
most skills need none. See `scripts-and-assets.md` for the full mapping,
including how this repo's `templates/` corresponds to the wider Agent
Skills spec's `assets/` term for emitted literal text.

`templates/` may also hold agent or rule definitions that the skill's
`install.sh` symlinks *verbatim* into `~/.claude/agents/` or `~/.claude/rules/`
(the A5 orchestrator case). Those are not emitted boilerplate — name them
`<agent-name>.agent.md` / `<name>.rule.md` (not `*.template.md`) so the filename
states what they are and a search for the agent name finds them.

## Patterns

### Pattern A — High-level guide with references

```text
my-skill/
├── SKILL.md              # Quick start + pointers
├── reference.md          # Full API reference
├── examples.md           # Worked examples
└── advanced.md           # Edge cases
```

`SKILL.md` shows the quick start; the others are linked one click away.

### Pattern B — Domain-organised rules

```text
my-skill/
├── SKILL.md              # Index
└── rules/
    ├── frontmatter.md
    ├── description-writing.md
    └── token-economics.md
```

Each rule is loadable in isolation. The agent loads only the rules
relevant to the current step.

### Pattern C — Multi-mode skill with shared rules

```text
my-skill/
├── SKILL.md              # Mode detection + shared workflow
├── rules/
│   ├── shared-checklist.md
│   └── ...
├── references/
│   └── archetypes.md
└── templates/
    ├── mode-A.md
    └── mode-B.md
```

`holistic-analysis` and `confidence` are good examples of this pattern.

## One-level-deep references

Claude often **partial-reads** files when they are referenced from another
referenced file (e.g. `head -100`). That means deeply nested references
silently lose information.

**Rule:** every file in tiers 3 should be linked **directly from
`SKILL.md`**. Do not chain `SKILL.md` → `a.md` → `b.md` → `c.md`.

If you must reference `b.md` from `a.md`, also link `b.md` from `SKILL.md`
so the agent can load it directly when needed.

## Long reference and rule files need a TOC

The threshold differs by directory, because they are read differently:
a `references/*.md` file is opted into for long-form reading and gets a
TOC past **100 lines**; a `rules/*.md` file is meant to be read whole
once loaded, so its TOC exists as the partial-read safety net and applies
past **150 lines**. Either way, add a table of contents at the top so the
agent sees the full scope of what is available even when previewing with
`head`:

```markdown
# API Reference

## Contents

- Authentication
- Core methods
- Webhooks
- Error handling

## Authentication
...
```

## Content lifecycle

A skill's `SKILL.md` and its linked files are **not re-read on later
turns** once loaded — the content Claude has is the content it acts on
for the rest of that invocation's context.

- **Identical re-invocation** (the same skill triggers again later in the
  same session with no content change) adds only a short note, not the
  full body again.
- **Changed content** (you edited the file since it was last loaded)
  re-appends the full, current body on the next invocation.
- **Compaction** re-attaches the most recent invocation of each skill,
  capped at 5,000 tokens per skill and 25,000 tokens combined — see
  `token-economics.md` § Lifecycle and compaction.

Implication: do not assume a rule file you edited mid-session is visible
to the agent until the skill is invoked again.

## Don't bury the lede

If something is critical to nearly every invocation, it lives in `SKILL.md`,
not in a rule. Rules are for things that fire conditionally. The
`description` field is for the absolute minimum Claude needs to **decide**
whether to load `SKILL.md` at all.
