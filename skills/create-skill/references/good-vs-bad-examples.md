---
title: Good vs Bad — Full SKILL.md Examples
impact: MEDIUM
tags:
  - examples
  - reference
  - good-vs-bad
---

# Good vs Bad

Side-by-side full-skill examples to internalise what good looks like.

## Contents

- E1 — Description rewrite (vague → specific)
- E2 — Frontmatter (over-broad → focused)
- E3 — `SKILL.md` body (verbose → concise)
- E4 — Reference structure (deep → flat)
- E5 — A complete bad skill, fixed

---

## E1 — Description rewrite

### Bad

```yaml
---
name: helper
description: This skill helps you with files. You can use it to do many things.
---
```

Problems: vague verb (`helps`), first/second person (`you`), no triggers,
generic name.

### Good

```yaml
---
name: csv-cleaner
description: >
  Normalises CSV files: removes BOM, fixes inconsistent quoting, deduplicates
  rows, infers column types. Use when ingesting third-party CSVs or before
  loading into a database. Triggers on "clean this CSV", "fix CSV quoting",
  "/csv-cleaner".
---
```

Why better: starts with a specific verb, names the file type, lists the
operations, gives the use cases, and provides triggers including the
slash form.

---

## E2 — Frontmatter

### Bad

```yaml
---
name: code-helper
description: A general-purpose skill for code reviews, refactoring, fixing bugs, writing tests, generating documentation, deploying, and managing pull requests across all languages and frameworks.
metadata:
  tags: [tools, code]
---
```

Problems: mega-skill scope, no triggers, generic tags. No agent will
choose this skill consistently because it overlaps with everything else.

### Good

```yaml
---
name: code-quality
description: >
  Reviews code for cognitive complexity, readability, and maintainability
  using guard clauses, early returns, single-responsibility functions, and
  discriminated unions. Use during PR review, after writing new code, or
  when asked to "clean this up", "make this readable", "reduce
  complexity". Triggers on "review code", "audit complexity",
  "/code-quality".
metadata:
  workflow_type: advisory
  tags:
    - code-quality
    - readability
    - cognitive-complexity
    - clean-code
    - refactoring
    - guard-clauses
    - maintainability
---
```

Why better: focused scope, named methodology, concrete triggers, specific
tags.

---

## E3 — `SKILL.md` body

### Bad (verbose, ≈ 220 tokens)

````markdown
# CSV Cleaner

When working with CSV files, it's important to understand that there are
many different conventions for how CSV files can be formatted. Some CSV
files use commas as separators, while others use tabs or semicolons.
Some files quote every field, while others only quote fields that
contain special characters. Some files have a byte-order mark (BOM) at
the beginning, while others don't.

When the user asks you to clean a CSV, you should think carefully about
the file's actual format before making any changes, because making the
wrong assumption could corrupt the data. Read the first few lines and
look for clues about the format.

Once you've determined the format, you should normalise it. Use the
csv module from the Python standard library, or pandas if it's already
in the project's dependencies. Remove the BOM if present, normalise
quoting, and deduplicate rows.
````

Problems: explains things Claude already knows (what a BOM is, what a
CSV is, why formats vary), throat-clearing ("it's important to
understand"), no decision rules, no code.

### Good (≈ 90 tokens)

````markdown
# CSV Cleaner

## Workflow

1. **Detect format** — read the first 5 lines. Decide:
   - Separator: `,`, `\t`, or `;`.
   - Quoting: minimal or all-fields.
   - BOM: present (`\ufeff`)?
2. **Normalise** with the standard library:

   ```python
   import csv

   with open(path, encoding="utf-8-sig", newline="") as f:
       rows = list(csv.reader(f, dialect=detected_dialect))
   ```
3. **Deduplicate** — drop exact-row duplicates. Preserve order.
4. **Write back** — same path, `csv.writer`, `quoting=csv.QUOTE_MINIMAL`.
````

Why better: same information in 1/3 the tokens. No definitions. Lead with
the action.

---

## E4 — Reference structure

### Bad — deeply nested

```text
SKILL.md → advanced.md → details.md → really-here.md
```

`SKILL.md`:

```markdown
For advanced use, see [advanced.md](advanced.md).
```

`advanced.md`:

```markdown
For details, see [details.md](details.md).
```

`details.md`:

```markdown
For the actual content, see [really-here.md](really-here.md).
```

Problem: when Claude follows the chain, it tends to partial-read each
hop (`head -100`). The terminal file may never load completely.

### Good — one level deep

`SKILL.md`:

```markdown
**Quick start:** see the steps above.
**Form filling:** see [forms.md](./forms.md).
**API reference:** see [reference.md](./reference.md).
**Examples:** see [examples.md](./examples.md).
```

All three reference files are linked directly. Each loads completely
when the agent reads it.

---

## E5 — A complete bad skill, fixed

### Bad

```yaml
---
name: claude-deployer
description: A skill that deploys things to production
---
```

````markdown
# Claude Deployer

I can help you deploy your application to production. To deploy, you
should make sure all your tests are passing and your code is ready
to go. Then you can deploy.

You'll need to be careful when deploying because production deployments
can break things. Make sure you have a rollback plan.

To deploy, run something like:

  deploy

Or maybe:

  npm run deploy

Or whatever your deploy command is.
````

Problems gathered:

- Reserved word `claude` in `name`.
- First-person voice in `description`.
- No triggers.
- Vague body, throat-clearing.
- "Whatever your deploy command is" — no decision rule.
- No code fence language.
- Indented "code" instead of fenced block.

### Fixed

```yaml
---
name: deploy-prod
description: >
  Deploys the current branch to production via the Helm pipeline:
  validates green CI, runs the canary, then promotes to 100%. Refuses to
  proceed if CI is red or the branch is behind main. Triggers on
  "deploy to prod", "ship it", "/deploy-prod".
disable-model-invocation: true
allowed-tools: Bash(gh *) Bash(helm *) Bash(kubectl *) Read
metadata:
  workflow_type: slash-command
  tags:
    - deploy
    - production
    - canary
    - helm
---
```

````markdown
# Deploy Prod

## Pre-flight (mandatory)

| Check                           | Command                              | Pass criterion       |
| ------------------------------- | ------------------------------------ | -------------------- |
| CI green on current branch      | `gh pr checks --required`            | All checks `pass`    |
| Up to date with `main`          | `git fetch && git rev-list HEAD..origin/main \| wc -l` | `0`        |
| User has prod deploy permission | `helm whoami`                        | Output `prod-deploy` |

If any check fails, abort and surface the failing check to the user. Do
not attempt to "fix" CI in this skill.

## Deploy

```bash
helm upgrade --install web ./charts/web \
  --namespace prod \
  --values prod.values.yaml \
  --atomic --timeout 5m
```

## Verify

```bash
kubectl rollout status deploy/web -n prod --timeout=5m
```

If the rollout fails, run the rollback in
[`scripts/rollback.sh`](./scripts/rollback.sh) and surface the failure.
````

Why fixed:

- `name` is concrete; no reserved words.
- `description` is third-person, lists triggers, names the methodology
  (canary/Helm).
- Slash-only because deploys must be user-controlled.
- `allowed-tools` pre-approves only the tools the skill needs.
- Body has decisions in tables, code in fenced blocks with language, and
  a clear pass-criterion for every step.
- The rollback path is a separate script, referenced once, no duplication.
