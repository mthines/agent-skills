# aw-setup repo-profile mode — scaffold committed per-area convention rules

The **repo-profile** mode of `aw-setup` scans a repository once (including its
monorepo layout), detects each area's tech stack, and scaffolds **committed,
path-scoped convention rules** so `aw` — and Cursor, Copilot, and any other
Agent-Skills-compatible tool — applies per-area best practices consistently
(React conventions for UI code, API conventions for backend code, and so on).

This is **Layer 1** of the two-layer repo-convention system. The self-updating
**Layer 2** (learned deltas that promote up into these rules) is owned by
[`../../rules/convention-memory.md`](../../rules/convention-memory.md). Design
basis: [`../../references/repo-convention-research.md`](../../references/repo-convention-research.md).

> **This mode does not author rule files itself.** It does *detection* and
> *delegation*: it discovers the repo shape, then hands each convention to the
> [`docs`](../../../../authoring/docs/SKILL.md) skill, which owns
> `.claude/rules` authoring (the `paths:` template, the content-routing rubric,
> and the hot-path budget). aw-setup never re-implements rule authoring.

---

## When to run

- **First time:** once per project, before (or alongside) the first autonomous
  task, to seed the committed convention rules.
- **Re-run:** when the stack changes (a package is added, a framework is swapped,
  the workspace is restructured). Idempotent — see [Idempotency](#idempotency-contract).
- **Not auto-triggered.** The user runs `/aw-setup repo-profile` explicitly, the
  same as the aw-target setup mode.

---

## What it produces (and what it does not)

| Produced (committed) | Not produced |
| -------------------- | ------------ |
| `.claude/rules/<area>.md` — one path-scoped rule per detected area, authored by `docs` | Any file tree / symbol map / repo snapshot (structure is re-derived live — [research §5](../../references/repo-convention-research.md)) |
| A subtree `<dir>/CLAUDE.md` instead, when `docs` content-routing says the rule is subtree-scoped | The `aw-conventions` learned deltas (Layer 2 — those accrue at runtime, gitignored) |
| Optional root `CLAUDE.md` monorepo-layout section (thin router) | Any secret, credential, or product data |

**Committed vs gitignored:** the convention rules are **committed** (team-shared,
reviewable in PRs, inherited by fresh clones — the same precedent as this skill's
`aw-target.yml`). Only the runtime *learned* layer is gitignored (under `.agent/`
via persistent-memory). See [research §3](../../references/repo-convention-research.md).

---

## Phases

### Phase A — Detect

Scan the repo to build a **profile map**: `area → paths → stack → candidate
conventions`. Detection signals:

| Signal | What to look for |
| ------ | ---------------- |
| Monorepo layout | `pnpm-workspace.yaml`, `nx.json`, `turbo.json`, `lerna.json`, `workspaces` in root `package.json`; enumerate `apps/*` and `packages/*` |
| Project graph (Nx) | If `nx.json` exists, prefer `nx show projects` / `nx graph` over reading every config — teach the root rule to query the graph rather than snapshot it |
| Per-area UI stack | React/Next (`react`, `next`), Vue (`vue`, `nuxt`), Svelte, React Native / Expo (`react-native`, `expo`) in each package's `package.json`; component file globs (`**/*.tsx`, `**/*.vue`) |
| Per-area backend stack | API/server frameworks (`express`, `fastify`, `hono`, `nest`, `next` route handlers), ORM/db (`prisma`, `drizzle`), validation (`zod`, `yup`) |
| Language + tooling | `typescript`, test runner (`vitest`, `jest`, `playwright`, `pytest`), linter/formatter config |
| Existing conventions | current `.claude/rules/*.md`, `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md` (re-run + ingest path) |

Detection confidence:

- **High:** workspace file present, per-package stack unambiguous from deps.
- **Medium:** stack inferred from file extensions or a single dep.
- **Low:** nothing conclusive — ask in Phase B.

### Phase B — Confirm

Use `AskUserQuestion` with a single batched message. Show the detected profile
map and confirm:

1. Which areas to scaffold rules for (pre-checked from detection).
2. For each area, the `paths:` globs (proposed from detection; editable).
3. Any convention the user wants to assert up front that detection cannot infer
   (e.g. "we always use Zod, never Yup" — a real project preference).

Keep the question set lean when detection confidence is high; expand only for
low-confidence areas. Never invent a convention the repo's code does not support
— a seeded rule must be grounded in a detected signal or a user statement, not a
generic framework tutorial.

### Phase C — Generate (delegate to `docs`)

For each confirmed area, hand the convention set to the `docs` skill:

```
Skill("docs", "update --add-rule \"<area> conventions\" --paths \"<globs>\"")
```

`docs` decides the destination via its
[`content-routing.md`](../../../../authoring/docs/rules/content-routing.md)
rubric and writes the file from its
[`claude-rule.md`](../../../../authoring/docs/templates/claude-rule.md)
template:

- Path/pattern-scoped rule → `.claude/rules/<area>.md` with `paths:`.
- Subtree-scoped (a single `packages/foo/**`) → `packages/foo/CLAUDE.md`.
- One-line repo-wide invariant → root `CLAUDE.md`.

Seed each rule thin and concrete: prescriptive bullets, a good example and an
anti-pattern, one concern per file, within the 150/200-line hot-path budget.
Every seeded convention must trace to a Phase-A signal or a Phase-B user
statement — do not pad with generic advice (adherence drops when rules bloat;
see [research §7](../../references/repo-convention-research.md)).

### Phase D — Register the learned layer (one-time)

Confirm the runtime learned layer is wired so `aw` will keep these rules fresh:

- The `aw` dispatcher already reads/writes `aw-conventions` at intake/exit (see
  [`../../rules/convention-memory.md`](../../rules/convention-memory.md)); no
  scaffolding is required for the `home` tier.
- If the team wants **committed, team-shared** learned deltas, tell the user they
  can opt in once with
  `Skill("persistent-memory", "write aw-conventions --tier project-shared")` —
  aw-setup does **not** create the committed scope silently (the persistent-memory
  consent contract).
- Confirm `.agent/` is gitignored (it already is in this repo's `.gitignore`); the
  gitignored learned layer must never be committed.

### Phase E — Validate

For each generated rule:

1. Every `paths:` glob matches at least one current file (reuse the
   [`claude-rule.md` audit checklist](../../../../authoring/docs/templates/claude-rule.md)).
2. The file is within the hot-path budget and has ≥ 1 example.
3. Show the complete set of new/changed files as a diff and require user
   confirmation before writing (committed files — never write without review).

Report a one-line summary: `Scaffolded N convention rules across M areas.`

---

## Idempotency contract

**First run:** full Detect → Confirm → Generate → Validate.

**Re-run:** detect existing `.claude/rules/*.md` (and any `CLAUDE.md` convention
sections), then:

- Re-scan the stack and diff against the existing rules.
- Only re-prompt for areas that are **new** or whose stack **drifted** (a
  framework changed, a package appeared/disappeared, a glob no longer matches any
  file).
- Show a unified diff before overwriting any rule; never silently overwrite a
  human-edited rule — surface the conflict and ask.
- If nothing drifted, report `No changes — convention rules are up to date.`

This mirrors the aw-target setup mode's re-run contract: detect, validate each
field, re-prompt only for what broke or changed.

---

## Definition of done

- [ ] Profile map built from Phase-A detection (monorepo layout + per-area stack).
- [ ] User confirmed the areas and `paths:` globs.
- [ ] Each area's rule authored **via the `docs` skill** (not hand-rolled), routed
      per `content-routing.md`, within the hot-path budget, with ≥ 1 example.
- [ ] Every `paths:` glob matches ≥ 1 current file.
- [ ] New/changed files shown as a diff and confirmed before writing.
- [ ] `.agent/` confirmed gitignored; no learned-layer or secret files committed.
- [ ] User told what is next: "Run an autonomous task — `aw` now reads these
      rules per-path and will learn new conventions into `aw-conventions`,
      suggesting promotion into these committed rules once one recurs."
