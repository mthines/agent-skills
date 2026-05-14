# `docs/README.md` Template

The human entry point to the `docs/` tree. Keep it short — a few lines
of orientation plus a list of common destinations. Update whenever a
top-level `docs/` subdirectory is added or removed.

---

```markdown
# Documentation

This directory holds narrative documentation. The agent hot path
(commands, rules, gotchas) lives in [`../CLAUDE.md`](../CLAUDE.md) and
[`../.claude/rules/`](../.claude/rules/).

## Quadrants

Each doc serves exactly one of four user needs
([Diátaxis framework](https://diataxis.fr/)):

- **[Tutorials](./tutorials/)** — learning-oriented. Step-by-step from
  zero.
- **[How-to guides](./how-to/)** — task-oriented. "How do I X?"
- **[Reference](./reference/)** — looking up facts. Neutral, factual.
- **[Explanation](./explanation/)** — understanding. The "why".

## Common entry points

- [Architecture](./explanation/architecture.md) — how the system fits
  together
- [Contributing](./how-to/contributing.md) — dev environment and
  workflow
- [API reference](./reference/api.md) — every public function

## Conventions

- One H1 per file.
- Sentence-case headings.
- One sentence per line (semantic line breaks).
- Code blocks declare a language identifier.
```

---

## Smaller projects

For projects with fewer than ~10 doc files, skip the quadrant subdirectories
and reference files directly:

```markdown
# Documentation

This directory holds narrative documentation.

- [Architecture](./architecture.md)
- [Contributing](./contributing.md)
- [Conventions](./conventions.md)
```

Promote to the full Diátaxis subdirectory layout when `docs/` exceeds
~10 files.
