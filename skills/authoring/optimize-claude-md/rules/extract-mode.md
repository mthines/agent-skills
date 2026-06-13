---
title: Extract Mode — Move Long Sections to Linked Files
impact: HIGH
tags:
  - extract
  - linking
  - placement
  - preservation
---

# Extract Mode

Moves a long section (or entire sub-section) from `CLAUDE.md` to a linked file under `docs/` or `.claude/rules/`, then replaces it with a brief link. Strictly preserves content — extract first, verify, then remove.

## When to extract vs trim

| Signal                                                         | Pick           |
| -------------------------------------------------------------- | -------------- |
| Cold-path content > 1,000 chars in a single section            | **extract**    |
| Cold-path content can be summarized in one line per entry      | **trim**       |
| Section is design rationale / decision log                     | **extract**    |
| Section is feature history / changelog                         | **extract** to `CHANGELOG.md` or `docs/history.md` |
| Whole inventory paragraph could move to `docs/inventory.md`    | **extract**    |
| Mixed hot-path + cold-path within one section                  | **extract** the cold-path subset; keep the rest |

## Procedure

1. Run Phases 1 + 2 silently. Identify extract candidates (sections + entries tagged `cold-path` with size > 1,000 chars).
2. For each candidate, pick a destination via the destination resolver (below).
3. Show the user the proposed move (source section + destination path + new replacement link). Ask for approval.
4. On approval:
   - Create or append to the destination file.
   - **Verify the destination file now contains the moved text.** Read it back.
   - Replace the source section with the brief link.
   - Emit the per-section before/after metrics.
5. After the last extract (or `skip-rest`), emit the preservation receipt from [`hard-rules.md`](./hard-rules.md).

## Destination resolver

| Source content                                            | Default destination                                   |
| --------------------------------------------------------- | ----------------------------------------------------- |
| Skill / agent inventory paragraph                         | `docs/inventory.md` (or per-skill `SKILL.md` if appropriate) |
| Cross-cutting rule applying to multiple subtrees          | `.claude/rules/<topic>.md` with `paths:` glob (delegates to [`docs` skill's Placement Resolver](../../docs/rules/placement-resolver.md)) |
| Rule applying only to one package                         | `<package-dir>/CLAUDE.md`                             |
| Design rationale ("why we chose X")                       | `docs/decisions/<topic>.md` (or `ADR-<n>.md` if the repo uses ADRs) |
| Feature history / changelog                               | `CHANGELOG.md` (or `docs/history.md`)                 |
| Workspace structure tree > 30 lines                       | `docs/structure.md`                                   |
| Long worked examples or before/after code                 | The skill's own `references/<topic>.md`               |

If the user has a `docs` skill installed, **delegate cross-cutting placement** via `Skill("docs", "pattern <glob>")` rather than picking the destination by hand. The Placement Resolver handles glob-scoped routing.

## Brief-link replacement template

Replace the extracted section with:

```markdown
## <Original H2 heading>

See [`<destination-path>`](<destination-path>) for <one-sentence summary>.
```

For inventory extraction, replace the entire inventory block with:

```markdown
## Repository Structure

Skills live in `skills/`, agents in `agents/`. See [`docs/inventory.md`](./docs/inventory.md) for the full annotated list.
```

## Preservation verification

After every extract, **before** removing the source section:

1. `Read` the destination file.
2. Confirm the new content is present.
3. Confirm the link in `CLAUDE.md` resolves (the path exists relative to repo root).
4. Only then `Edit` `CLAUDE.md` to remove the source section.

If preservation verification fails (file write error, missing destination), **abort the extract for that section** and continue with the next.

## Examples

### Good — extract the inventory to `docs/inventory.md`

Before (in `CLAUDE.md`):

```markdown
## Repository Structure

Skills live in `skills/` as standard SKILL.md files. Agents live in `agents/`.

### Agent-invokable skills (model can `Skill()`-invoke without a slash command)

- `autonomous-workflow` — Phase-based orchestrator [3 paragraphs]
- `confidence` — [paragraph]
- ... [55 entries]
```

After (in `CLAUDE.md`):

```markdown
## Repository Structure

Skills live in `skills/` as standard SKILL.md files. Agents live in `agents/`.

See [`docs/inventory.md`](./docs/inventory.md) for the annotated list of every skill, companion, and agent (grouped by invocation type).
```

And the moved content lives verbatim in `docs/inventory.md`.

### Bad — moved content without creating the destination

If `docs/inventory.md` doesn't exist after the extract, the link is broken and the content is lost. **Fix:** always create or append, then read back before removing.

### Bad — extracted hot-path content

A `Nx commands` section is hot-path (agents run those commands). Moving it to `docs/nx.md` adds a Read on every task. **Fix:** classification gate prevents this.

## Common mistakes

- **Removing source before verifying destination.** Race-condition for content loss. **Fix:** read destination first.
- **Picking a destination that doesn't exist in the repo's docs structure.** Adds an orphan directory. **Fix:** check for an existing `docs/` or use the `docs` skill's Placement Resolver.
- **Extracting partial content from a code block.** Breaks syntax / examples. **Fix:** never split a fenced code block — extract the whole section that contains it.
- **Linking to the destination using an absolute path.** Brittle across worktrees. **Fix:** always use relative paths.
- **Forgetting to ask for approval.** Required by [`hard-rules.md`](./hard-rules.md). **Fix:** always show the proposed move, then ask `y/n/skip-rest`.
