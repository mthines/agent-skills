# Content Routing Rubric

Decide *which surface owns each piece of content* before writing it.
Routing by content kind — not by file pattern — is the single highest-leverage
rule in this skill. Every other rule downstream assumes routing is correct.

The four surfaces, ordered by recurring token cost:

| Surface                            | Loaded                           | Audience                | Recurring token cost |
| ---------------------------------- | -------------------------------- | ----------------------- | -------------------- |
| `CLAUDE.md` (root)                 | Every Claude Code turn           | Agent                   | **Every turn**       |
| `<dir>/CLAUDE.md` (nested)         | When the agent is in `<dir>`     | Agent                   | Every turn in scope  |
| `.claude/rules/<topic>.md` (path-scoped) | When a file matches `paths:`     | Agent                   | Only when path hit   |
| `README.md`                        | When a human visits the repo     | Humans                  | Zero (not auto-loaded) |
| `docs/<topic>.md`                  | Only on explicit Read            | Humans + agent fallback | Zero (not auto-loaded) |

## 1. The Routing Table

Classify each piece of content by kind, then route to the cheapest surface
that still reaches its reader.

| Content kind                                              | Destination                                | Why                                                  |
| --------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| Hard rule ("MUST", "NEVER"), command, gotcha              | `CLAUDE.md` (inline)                       | Auto-loaded; agent acts on it without a round-trip   |
| Decision table (path → owner, file → command)             | `CLAUDE.md` (inline)                       | Agent hot path; cheap to scan                        |
| File inventory ("key source files")                       | `CLAUDE.md` (inline)                       | Agent needs it before tool calls; humans skim it too |
| Path-scoped rule (only relevant for `src/api/**`)         | `.claude/rules/<topic>.md` with `paths:`   | Loaded only when matching files are touched          |
| Pattern-scoped rule (every `**/bindings.ts`)              | `.claude/rules/<topic>.md` with `paths:`   | Never root `CLAUDE.md` — defeats the point           |
| Subtree-scoped rule (`packages/foo/**`)                   | `packages/foo/CLAUDE.md` (innermost)       | Loads only when working in that subtree              |
| Project value proposition / quickstart                    | `README.md`                                | Humans evaluate the project here                     |
| Install / usage example with expected output              | `README.md`                                | First thing a new user runs                          |
| Badges (build / version / license)                        | `README.md`                                | Trust signal above the fold                          |
| Tutorial (learning-oriented, beginner)                    | `docs/tutorials/<topic>.md`                | Long-form; Diátaxis tutorial quadrant                |
| How-to (task-oriented, "how do I X")                      | `docs/how-to/<task>.md`                    | Diátaxis how-to quadrant                             |
| API reference (mechanical, looked up)                     | `docs/reference/<api>.md` or `docs/api/`   | Diátaxis reference quadrant                          |
| Architectural rationale, ADR, design history              | `docs/explanation/<topic>.md`              | Diátaxis explanation quadrant                        |
| Onboarding / dev environment setup                        | `docs/contributing.md`                     | New contributors; rarely needed mid-task             |
| Domain glossary                                           | `docs/glossary.md` or `docs/reference/glossary.md` | Stable reference material                            |
| Changelog                                                 | `CHANGELOG.md` (root)                      | Standard tooling reads this path                     |

## 2. Routing Decision Flow

For every paragraph or rule you draft, walk this flow top-down. Stop at
the first match.

1. **Is this a hard rule the agent must obey on every turn?**
   - If repo-wide → root `CLAUDE.md`.
   - If subtree-scoped with an existing nested `CLAUDE.md` → that file.
   - If path / pattern scoped → `.claude/rules/<topic>.md` with `paths:`.
2. **Is this a command Claude could not guess?** (e.g. `pnpm test:unit` not `npm test`)
   - → root `CLAUDE.md` `## Commands` section.
3. **Is this a marketing claim, install instruction, or quickstart for humans?**
   - → `README.md`.
4. **Is this an explanation, rationale, or onboarding step?**
   - → `docs/<topic>.md` per Diátaxis quadrant.
5. **Is this content already in two places?**
   - Pick a single owner. Link from the other. **Always.**
6. **Is the content unique to one Diátaxis quadrant?**
   - If two quadrants — tutorial *and* reference, e.g. — split the doc.

## 3. The "Test by Removal" Filter

Before writing any line, ask: *would removing this cause Claude or a
reader to make a mistake?*

- If **yes** → keep it.
- If **no** → do not write it. Claude can read the code. A reader can
  read the README's quickstart.

This single filter prunes 30–50% of what's tempting to write.

## 4. Hard Rules — never break these

- **Never** duplicate facts across surfaces. Pick one owner; link from the
  others. Duplicates always drift.
- **Never** put pattern-scoped rules in root `CLAUDE.md`. They cost tokens
  every turn for users who never touch the matching files. Use
  `.claude/rules/` with `paths:` instead.
- **Never** put narrative ("we picked X because Y", "the system grew as
  Z") in `CLAUDE.md` or `.claude/rules/`. That is `docs/` material.
- **Never** put API reference in `README.md`. Move to `docs/reference/`
  and link from the README.
- **Never** make `CLAUDE.md` a thin pointer file. If the agent has to
  Read 3+ docs to do its job, the hot path is broken — promote the
  critical rules back inline.

## 5. Hot-Path Budget

If a `CLAUDE.md` edit would push the file past **150 lines**, treat that as
a yellow flag. At **200 lines**, treat it as a red flag — Anthropic's own
guidance is that adherence drops measurably beyond this. Move narrative
or rationale to `docs/` and `@import` it back when needed.

The hot path is finite. Spend it on rules the agent acts on every turn —
not on context that exists to make a human comfortable.
