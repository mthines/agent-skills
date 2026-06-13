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

| Tier | What loads                                         | When                                          | Cost                      |
| ---- | -------------------------------------------------- | --------------------------------------------- | ------------------------- |
| 1    | `name` + `description` of every installed skill    | Session start, always                         | Few hundred tokens total  |
| 2    | The skill's `SKILL.md` body                        | When the skill is invoked / triggered         | Whatever your body weighs |
| 3    | Files referenced from `SKILL.md` (`rules/...md`)   | When Claude actively reads them on a turn     | Loaded read-by-read       |

The trick is to keep the **always-loaded** tier (1) tiny and informative,
the **invoke-loaded** tier (2) lean and navigational, and push everything
else into tier 3 where it costs nothing until needed.

## Tier 1 — metadata

You have ~1024 chars of `description`. That's the entire trailer for your
skill. Make every word work — see `description-writing.md`.

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

## Long reference files need a TOC

For any file > 100 lines, add a table of contents at the top so the agent
sees the full scope of what is available even when previewing with
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

## Don't bury the lede

If something is critical to nearly every invocation, it lives in `SKILL.md`,
not in a rule. Rules are for things that fire conditionally. The
`description` field is for the absolute minimum Claude needs to **decide**
whether to load `SKILL.md` at all.
