# `docs/explanation/architecture.md` Template

The single most-read narrative doc in any project. A new contributor
(human or agent) reads this to build a mental model of the codebase.

Diátaxis quadrant: **Explanation**. No instructions, no step-by-step
recipes. Save those for `how-to/`.

---

```markdown
# Architecture

<One-paragraph orientation — what kind of system is this, what does it do, what is the rough shape.>

## Directory layout

```
<repo-root>/
├── <top-level-dir>/    <one-line purpose>
├── <top-level-dir>/    <one-line purpose>
└── <top-level-dir>/    <one-line purpose>
```

<For each non-obvious top-level directory, one paragraph on what lives there and why.>

## Module boundaries

<Which modules depend on which. State the dependency direction explicitly.>

- `<module-a>` calls `<module-b>` via `<entry-point>`.
- `<module-b>` is pure logic; never imports from `<module-c>`.
- `<module-c>` is the outermost shell; nothing imports from it.

## Key design decisions

For each non-obvious decision, write a short ADR-style entry. Three
fields, in this order:

### <Decision title>

**Context.** <What constraint or problem prompted this.>
**Decision.** <What we picked.>
**Consequences.** <What this enables. What this costs.>

### <Decision title>

**Context.** …
**Decision.** …
**Consequences.** …

## Where this doc does **not** cover

- Onboarding / setup → [how-to/contributing.md](../how-to/contributing.md).
- API reference → [reference/api.md](../reference/api.md).
- Step-by-step deployment → [how-to/deploy.md](../how-to/deploy.md).
```

---

## Author guidance

- This is **explanation** territory — discursive, narrative, "why".
  Tone is reflective, not imperative.
- Each "Key design decision" entry caps at three fields: Context,
  Decision, Consequences. Resist longer ADRs in this doc — promote to
  `docs/explanation/adr-NNN-<slug>.md` if a decision needs its own page.
- Update the **Directory layout** section whenever a top-level directory
  is added, removed, or renamed. Diff the section against `ls` in
  every `update` run.
- Resist documenting implementation details that change weekly —
  document the **patterns**, not the **wiring**.
