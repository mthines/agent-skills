# `docs/` Folder Structure

The `docs/` tree owns **narrative content** — tutorials, how-tos,
reference material, and rationale. Structure follows the
[Diátaxis framework](https://diataxis.fr/) by Daniele Procida, adopted
by Django, NumPy, Cloudflare, Gatsby, and many others.

## 1. When to Have a `docs/` Tree

| Project tier (from complexity triage) | `docs/` tree?                  | Notes                                       |
| -------------------------------------- | ------------------------------ | ------------------------------------------- |
| **Small** (< 50 source files)          | No — `README.md` is enough     | Avoid premature structure                   |
| **Medium** (50 – 250 files)            | Yes — root `docs/` only        | `architecture.md`, `contributing.md`, indexes |
| **Large** / monorepo (250+ files, packages) | Yes — root + per-package nested | Each package gets its own `docs/`           |

Complexity thresholds:

| Metric                  | Small | Medium  | Large |
| ----------------------- | ----- | ------- | ----- |
| Source files            | < 50  | 50–250  | 250+  |
| Directories             | < 20  | 20–60   | 60+   |
| Monorepo packages       | 0     | 0–1     | 2+    |
| Has CI/CD               | No    | Yes     | Yes   |

## 2. The Diátaxis Framework

Every doc serves **exactly one** of four user needs:

| Quadrant      | Orientation            | User context              | Style                                                                                                  |
| ------------- | ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Tutorial**  | Learning-oriented      | Beginner, "teach me"      | Concrete; one path; every step produces visible result; no choices, no explanation — link out          |
| **How-to**    | Task-oriented          | Competent user with a goal | Action-only; no teaching; logical sequence; "How to X" titles                                          |
| **Reference** | Information-oriented   | Working; looking up facts | Austere, uncompromising, neutral, factual; mirrors product structure; no instruction                   |
| **Explanation** | Understanding-oriented | Studying, reflecting     | Discursive; covers *why*, history, trade-offs, alternatives                                            |

**Hard rule:** each document serves exactly one quadrant. If it serves
two, split it. A "tutorial" that explains *why* is actually two docs.

## 3. Canonical Folder Layout

The reference layout per Diátaxis, adopted by major projects:

```
docs/
├── README.md            # Index of docs/ topics (human entry point)
├── tutorials/           # Learning
│   ├── getting-started.md
│   └── first-app.md
├── how-to/              # Task recipes
│   ├── deploy-to-fly.md
│   └── add-a-migration.md
├── reference/           # API / config / CLI facts
│   ├── api.md
│   ├── cli.md
│   └── config.md
└── explanation/         # Background, design rationale, ADRs
    ├── architecture.md
    ├── data-model.md
    └── adr-001-database.md
```

**Smaller projects** can skip the quadrant subdirectories and put files
directly in `docs/`:

```
docs/
├── README.md          # Index
├── architecture.md    # Explanation
├── contributing.md    # How-to (onboarding)
└── conventions.md     # Reference / explanation hybrid (split if it grows)
```

Promote to the full Diátaxis subdirectory layout when `docs/` exceeds
~10 files.

## 4. Per-Surface Templates

The skill ships templates for each doc kind. Pick by quadrant:

| Quadrant    | Template                                                       |
| ----------- | -------------------------------------------------------------- |
| Tutorial    | [`templates/docs-diataxis.md`](../templates/docs-diataxis.md) §1 |
| How-to      | [`templates/docs-diataxis.md`](../templates/docs-diataxis.md) §2 |
| Reference   | [`templates/docs-diataxis.md`](../templates/docs-diataxis.md) §3 |
| Explanation | [`templates/docs-diataxis.md`](../templates/docs-diataxis.md) §4 |
| Index       | [`templates/docs-index.md`](../templates/docs-index.md)         |
| Architecture | [`templates/docs-architecture.md`](../templates/docs-architecture.md) |
| Contributing | [`templates/docs-contributing.md`](../templates/docs-contributing.md) |

## 5. Monorepo: Root `docs/` vs. Nested `docs/`

For monorepos (`packages/*/`, `apps/*/`), the pattern is:

```
docs/                                  # workspace-wide
├── README.md
├── architecture.md                    # how packages fit together
├── contributing.md
└── how-to/
    └── set-up-the-monorepo.md

packages/
├── foo/
│   ├── CLAUDE.md                      # foo-specific agent rules
│   ├── README.md                      # foo as an OSS package
│   └── docs/                          # foo-internal narrative
│       ├── README.md
│       └── architecture.md
└── bar/
    └── (same structure)
```

The root `docs/` covers cross-package concerns. Each package's `docs/`
covers package-internal narrative. The package's `CLAUDE.md` `@imports`
its nested `docs/architecture.md` so the agent has a hot path into
package-specific narrative when working in that subtree.

## 6. When to Promote `docs/` to a Static Site

Plain markdown in `docs/` is read fine via GitHub's `docs/` render and
through Read tool calls. Promote to a static site when at least two of
these are true:

- > 50 doc pages
- Versioned docs needed (public API with breaking-change history)
- Full-text search needed
- Code playgrounds embedded
- Internationalization (i18n) needed

Tool selection:

| Tool           | Best for                                                                   | Source                                |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------- |
| **Docusaurus** | Large projects needing built-in versioning, i18n, plugin ecosystem         | [docusaurus.io](https://docusaurus.io/) |
| **Starlight (Astro)** | Cleaner default theme, faster runtime, smaller plugin tail            | [starlight.astro.build](https://starlight.astro.build/) |
| **Nextra**     | Already on Next.js; MDX-first                                              | [nextra.site](https://nextra.site/)   |
| **MkDocs + Material** | Python projects, simple Markdown, mature search                     | [mkdocs.org](https://www.mkdocs.org/) |
| **VitePress**  | Vue-stack or Vue-friendly; minimal config                                  | [vitepress.dev](https://vitepress.dev/) |

**Do not version pre-emptively.** Version only when you ship breaking
changes to a public API.

## 7. Audit Rubric for an Existing `docs/` Tree

| Check                                                                                       | Pass condition                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Every doc serves exactly one Diátaxis quadrant                                              | Read each file's purpose                                    |
| Tutorials are concrete (one path, no choices)                                                | No "you can also …" branches in tutorials                   |
| How-tos do not teach concepts (link out instead)                                             | No "first, let's understand …" in how-tos                   |
| Reference docs are neutral and factual (no instruction)                                      | No "you should …" in reference                              |
| Explanation docs do not give step-by-step instructions                                       | No numbered "step 1, step 2" in explanations                |
| Every file in `docs/` is reachable from `docs/README.md`                                    | No orphans                                                  |
| Every relative link inside `docs/` resolves                                                  | Run link checker                                            |
| `docs/contributing.md` commands match `package.json` / `Makefile` scripts                   | Cross-check                                                 |
| Architecture doc directories match the actual file tree                                      | Diff against `ls`                                           |
| No marketing adjectives without evidence                                                    | Search for "blazingly", "simply", "easily"                  |
| Headings sentence-case                                                                       | Visual inspection                                           |
| No content duplicated between root `docs/` and a nested `<pkg>/docs/`                       | Diff for shared paragraphs                                  |

## 8. Sample Docs Index (`docs/README.md`)

A minimal `docs/README.md` for a medium project:

```markdown
# Documentation

This directory holds narrative documentation. The agent hot path (rules,
commands, gotchas) lives in `CLAUDE.md` and `.claude/rules/` — see
[`../CLAUDE.md`](../CLAUDE.md) for the entry point.

## Quadrants

- **Tutorials** — learning-oriented. `tutorials/`
- **How-to guides** — task-oriented. `how-to/`
- **Reference** — looking up facts. `reference/`
- **Explanation** — understanding. `explanation/`

## Common entry points

- [Architecture](./explanation/architecture.md) — how the system fits together
- [Contributing](./how-to/contributing.md) — dev environment + workflow
- [API reference](./reference/api.md) — every public function
```

## 9. Common Failure Modes

| Failure                                                          | Detection                                                | Fix                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| Tutorial that branches ("you can also try X")                    | Read the tutorial                                        | Split into one tutorial + one how-to         |
| How-to that teaches concepts ("first, let's understand X")       | Read the how-to                                          | Move concept to explanation; link out        |
| Reference doc with imperative instructions                       | Search for "you should", "run this"                      | Move instructions to how-to                  |
| Orphan doc (unreachable from `docs/README.md`)                   | Walk links from `README.md`                              | Add to index or delete                       |
| Architecture doc lists directories that no longer exist          | Diff against `ls`                                        | Update or remove                             |
| Per-package `docs/` duplicates root `docs/`                      | Cross-diff                                               | Pick the right scope; link from the other    |
| One doc serves two quadrants                                     | Read for tone shifts (concrete → discursive)             | Split                                        |
