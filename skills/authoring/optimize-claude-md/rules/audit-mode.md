---
title: Audit Mode — Read-only Ranked Report
impact: HIGH
tags:
  - audit
  - report
  - read-only
---

# Audit Mode (default)

Read-only. Produces a ranked report with concrete suggestions per offender. Never mutates the target file. Safe to run anytime.

## Procedure

1. Run Phase 1 ([`measurement.md`](./measurement.md)) on the target file. Capture totals + top-10 longest sections / entries.
2. Run Phase 2 ([`classification.md`](./classification.md)) on each section and each top-10 entry. Tag every one **hot-path**, **cold-path**, or **rot**.
3. For frontmatter-duplication checks, only run if `skills/` exists in the repo. Otherwise skip.
4. Run Phase 2.5 ([`invocation-review.md`](./invocation-review.md)) — only if `skills/` exists in the repo. Walk every agent-invokable skill and emit slash-conversion candidates with baseline-savings estimates.
5. Build the ranked list of suggestions (see template below). Sort by *estimated token savings*, descending. Levers (1) and (2) are reported separately because they reduce different costs.
6. Emit the report. Do not ask the user to do anything yet — they pick the next mode.

## Report template

Use this exact structure:

```markdown
# CLAUDE.md Audit — <relative-path>

## Headline

- **Total:** 43,012 chars / ~10,753 tokens (warning threshold: 40,000 chars)
- **Status:** OVER threshold by 3,012 chars (~750 tokens)
- **Top win:** trim inventory entries (~21k chars / ~5,250 tokens recoverable)

## Top sections by size

| Chars  | Section                              | Class         |
| -----: | ------------------------------------ | ------------- |
| 35,399 | "Repository Structure" (inventory)   | mixed         |
|  4,512 | "Nx Workspace (VSCode Extension)"    | hot-path      |
|  1,890 | "Local Development"                  | hot-path      |
|    310 | "Prose Rules"                        | hot-path      |
|    160 | "Audience"                           | hot-path      |

## Top entries by size

| Chars | Entry                  | Class      | Suggestion                                                                            | Est. saved |
| ----: | ---------------------- | ---------- | ------------------------------------------------------------------------------------- | ---------: |
| 3,582 | `fix-bug`              | cold-path  | Description duplication. Trim to one-line hook + link to `skills/fix-bug/SKILL.md`.   |   ~870 tok |
| 2,988 | `animations`           | cold-path  | Description duplication. Trim to one-line hook + link.                                |   ~720 tok |
| 2,542 | `persistent-memory`    | cold-path  | Description duplication. Trim + link.                                                 |   ~610 tok |
| 2,191 | `optimize-mock-data`   | cold-path  | Description duplication. Trim + link.                                                 |   ~520 tok |
| 2,091 | `implement-suggestion` | cold-path  | Description duplication. Trim + link.                                                 |   ~500 tok |
| 1,911 | `screen-recorder`      | cold-path  | Description duplication. Trim + link.                                                 |   ~460 tok |
| 1,873 | `storybook`            | cold-path  | Description duplication. Trim + link.                                                 |   ~450 tok |

## Bloat patterns detected

- **Description duplication** — 17 of 55 inventory entries (≥ 700 chars each) duplicate their skill's `description:` frontmatter, which the harness already preloads. Trim each to a one-line hook + link.
- **Embedded rationale** — none detected.
- **Repeated tree** — none detected.
- **Decayed claim** — `Nx 22.4 + pnpm 10.13` is hot-path (version pinning); leave.

## Invocation control candidates (Phase 2.5)

Lever (2). Reduces the always-on **available-skills list**, not the CLAUDE.md file size — orthogonal saving.

| Skill                       | Current         | Recommended | Why                                                          | Baseline saved |
| --------------------------- | --------------- | ----------- | ------------------------------------------------------------ | -------------: |
| `video-analyser`            | agent-invokable | slash-only  | Side-effectful; user-driven trigger only.                    |    ~70 tokens |
| `ai-engineering`            | agent-invokable | slash-only  | Verbose description (1,170 chars); used rarely.              |   ~290 tokens |
| `docs`                      | agent-invokable | slash-only  | Documentation work is user-initiated, not auto-triggered.    |   ~460 tokens |
| `tdd`                       | agent-invokable | **leave**   | Composable; legitimately auto-loads on "write tests" / "add coverage". | — |
| `code-quality`              | agent-invokable | **leave**   | Composable; auto-loads during reviews.                       | — |

Total estimated baseline saving: **~820 tokens / session**.

To apply: `/create-skill review <skill-name> --convert-to-slash` per candidate, or edit `skills/<name>/SKILL.md` frontmatter and re-run `scripts/sync-symlinks.sh`. After conversion, run `/optimize-claude-md trim` to move the inventory entry from "Agent-invokable skills" to "Slash commands".

## Companion files

- `skills/*/CLAUDE.md` — checked. No duplication with root.
- `.claude/rules/` — not present in repo root.

## Recommended next steps

1. Run `/optimize-claude-md trim` to walk the top 17 entries interactively. Estimated savings: ~21,000 chars / ~5,250 tokens. File drops below the warning threshold.
2. Convert the 3 invocation candidates above via `/create-skill review`. Additional baseline saving: ~820 tokens / session.

Or run `/optimize-claude-md extract` to move the full inventory to `docs/inventory.md` and replace with a brief link. Estimated savings: ~35,000 chars / ~8,750 tokens.
```

## Suggestion tagging

Every suggestion must carry:

| Field          | Format                                                     |
| -------------- | ---------------------------------------------------------- |
| Class          | `hot-path`, `cold-path`, or `rot`.                         |
| Pattern        | One of the bloat-pattern names from [`classification.md`](./classification.md). |
| Action         | `trim`, `extract`, `delete`, or `leave`.                   |
| Destination    | Where the content lives (or will live) after the change.   |
| Estimated saved | Chars + approx tokens.                                    |

## Refusal and edge cases

- If Phase 1 reports < 10k chars, **stop before the report**. Print the refusal from [`hard-rules.md`](./hard-rules.md).
- If there are no cold-path or rot findings, emit a one-line "file is already lean — no action recommended" report.
- If a section is borderline (per [`classification.md`](./classification.md)), tag it `borderline` and recommend `leave` unless the user re-runs with explicit intent.

## Common mistakes

- **Recommending `trim` for hot-path content.** Audit should recommend `leave` for hot-path even if the section is long. **Fix:** classification gates the recommendation.
- **Omitting the destination.** A suggestion without a destination is unactionable. **Fix:** always cite where the content goes (which file, which line).
- **Estimating tokens by char count alone for code-heavy sections.** Code is denser than prose; use `chars / 3.5` for code blocks. **Fix:** use the 4-char ratio only for prose; for code, lean conservative.
