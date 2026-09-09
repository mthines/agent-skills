---
title: Scripts and Assets — Executable Helpers and Non-Prose Files
impact: MEDIUM
tags:
  - scripts
  - assets
  - executable
  - tier-3
---

# Scripts and Assets

Four directory roles beyond `rules/` and `references/`, each with a
different loading model.

## Directory roles

| Directory      | Role                                                    | Loaded how                          |
| --------------- | -------------------------------------------------------- | -------------------------------------- |
| `scripts/`     | Executed helpers (deterministic checks, transforms)      | Run via `Bash`; never read into context |
| `references/`  | Worked examples, citations — long-form reading           | Read on demand, whole file           |
| `templates/`   | Literal text this skill emits or fills in                | Read then copied/adapted into output |
| `assets/`      | Binary or static non-Markdown files the skill ships      | Read/copied as-is; never parsed as prose |
| `evals/`       | Test prompts and trigger sets for this skill itself      | Read only during Phase 6 / review testing |

This repo's `templates/` plays the role the wider Agent Skills spec calls
`assets/` for **emitted literal text** (a plan template, a commit-message
skeleton). Reserve this repo's `assets/` for genuinely non-Markdown files
— a font, an image, a binary fixture — that a skill needs to ship alongside
its Markdown. Most skills need no `assets/` directory at all.

## Execute vs. read intent

State explicitly, at the point a script is referenced, whether the agent
should **run** it or **read** it:

### Good

```markdown
Run the validator before declaring the skill done:

\`\`\`bash
node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir>
\`\`\`
```

### Bad

```markdown
See scripts/validate-skill.mjs for the validation logic.
```

Why bad: ambiguous whether the agent should open the file and read the
logic (burning tokens on implementation detail it does not need) or
simply run it. Default to "run it" for any deterministic check.

## Path convention

Always reference a bundled script through `${CLAUDE_SKILL_DIR}`, not a
path relative to the current working directory — the invoking session's
cwd is not guaranteed to be the skill's own directory:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs "$1"
```

## Implementation conventions

- **Zero dependencies.** A `.mjs` script uses only `node:` builtins; a
  Python script uses only the standard library. A skill script that needs
  `pip install` or `npm install` first is a script nobody can run reliably.
- **`--self-test` convention.** A script with any non-trivial parsing or
  branching logic accepts a `--self-test` flag that runs its own fixtures
  and exits `0`/`1` — so the script's correctness is itself verifiable
  without hand-built fixtures.
- **List dependencies explicitly** in a header comment (`# Requires: git`)
  even when the dependency is a system tool assumed to be present.
- **Solve, don't defer.** A script that catches an error only to print
  "ask Claude to handle this" has pushed the problem to a layer with less
  context than the script itself. Handle the error case in the script.
- **Justify constants.** Any magic number in a script carries a one-line
  comment explaining where the value came from (see `token-economics.md`
  § Habits to keep).

## Plan-validate-execute for batch or destructive work

A script that mutates many files, or that cannot be trivially undone,
runs in three passes rather than one:

1. **Plan** — compute what would change; print a summary.
2. **Validate** — check the plan against invariants (no unintended
   deletions, counts match expectations).
3. **Execute** — apply, only after validation passes.

```bash
node scripts/migrate.py --plan-only   # prints the diff, changes nothing
node scripts/migrate.py --verify      # validates the plan
node scripts/migrate.py --apply       # executes it
```

## Validator feedback loop

A script that checks a condition (lint, schema, structural contract)
should report **one line per finding**, with enough detail (file, line,
rule id) that the agent can act on it without re-deriving what failed —
mirror the shape of `scripts/validate-skill.mjs`'s own output
(`FAIL|WARN <id> <file>:<line?> — <message>`) rather than a bare pass/fail.
