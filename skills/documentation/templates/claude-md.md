# CLAUDE.md Template

A drop-in skeleton sized to the **Medium** tier. Trim to Small (drop the
`## Documentation` section) or expand to Large (add per-package nested
`CLAUDE.md` files with the same shape).

Replace every `<placeholder>` with project-specific content. Delete any
section that genuinely has nothing to say.

---

```markdown
# <Project Name>

<One-line description — what this project is, in one sentence.>

## Commands

```bash
# Development
<detected dev command, e.g. pnpm dev>

# Testing
<detected test command, e.g. pnpm test>

# Linting
<detected lint command, e.g. pnpm lint>

# Build
<detected build command, e.g. pnpm build>
```

## Code Style

- <Only rules that differ from defaults for the detected language>
- <Framework-specific conventions, e.g. "Use Server Components by default">
- <Repo-specific conventions, e.g. "Named exports only; no default exports">

## Architecture

- <Key directory purposes — only non-obvious ones>
- `<dir>/` — <one-line purpose>
- <Important patterns, e.g. "API handlers live in `src/api/handlers/`">

## Gotchas

- <Common mistakes to avoid, e.g. "Never edit `prisma/migrations/` by hand">
- <Non-obvious behaviors, e.g. "The `--json` flag bypasses every spinner">

## Documentation

Narrative content lives in `docs/`. Read on demand.

- `docs/explanation/architecture.md` — directory layout, module boundaries, design rationale
- `docs/how-to/contributing.md` — dev environment, branch workflow, PR conventions
- `docs/reference/<topic>.md` — API / config / CLI facts

@docs/explanation/architecture.md
@docs/how-to/contributing.md
```

---

## Notes for the author

- Keep the file **≤ 200 lines**. Anthropic's threshold; adherence drops
  beyond it.
- Every line must pass the **"would removing this cause Claude to make
  a mistake?"** filter.
- Move narrative ("we picked X because Y") to `docs/explanation/`.
- Move path-scoped rules to `.claude/rules/<topic>.md` with `paths:`.
- Move sub-package quirks to `<dir>/CLAUDE.md` (innermost-wins).
