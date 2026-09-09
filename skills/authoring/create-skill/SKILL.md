---
name: create-skill
description: >
  Scaffolds, reviews, upgrades, or diagnoses agent skills against
  best-practice frontmatter, progressive disclosure, token-aware
  structure, and the agent-skills.git symlink + inventory wiring.
  Modes: `scaffold` (default — new skill), `review` (audit existing
  skill), `upgrade` (split a single-file skill into multi-file),
  `diagnose` (retrospective failure analysis that emits a
  confidence-gated unified diff against any skill declaring a
  diagnostic surface). Triggers on "create a skill", "scaffold a skill",
  "new SKILL.md", "review this skill", "audit my skill", "upgrade this
  skill", "split this skill", "diagnose this skill", "why did the skill
  miss this", "/create-skill".
disable-model-invocation: true
argument-hint: '[scaffold|review|upgrade|diagnose] [<skill-name>|<path>]'
license: MIT
metadata:
  author: mthines
  version: '1.4.0'
  workflow_type: scaffolder-advisory-and-diagnoser
  tags:
    - skill-authoring
    - scaffolding
    - meta
    - progressive-disclosure
    - token-optimization
    - frontmatter
    - best-practices
    - diagnose
    - self-improvement
    - evaluation
    - portability
---

# Create Skill

Author new agent skills — and audit existing ones — against the best practices
distilled from Anthropic's official Skill authoring guide and the patterns
already in this repo. Output is a complete skill directory plus the
agent-skills.git symlink wiring and inventory updates.

> **This `SKILL.md` is a thin index.** Detailed authoring rules live in
> `rules/*.md`, worked examples in `references/*.md`, literal scaffolding
> templates in `templates/*.md` — all load on demand. Reading them all
> up-front would burn tokens you do not need yet.

---

## Mode Detection

Parse `$ARGUMENTS` (first token) and detect the mode:

| Mode       | Default | Trigger                                                                  |
| ---------- | ------- | ------------------------------------------------------------------------ |
| `scaffold` | **yes** | Default. "create", "scaffold", "new skill", or no mode argument.         |
| `review`   |         | "review", "audit", "check this skill", or `$0 == "review"`.              |
| `upgrade`  |         | "upgrade", "split", "convert to multi-file", or `$0 == "upgrade"`.       |
| `diagnose` |         | "diagnose", "why did <skill> miss this", or `$0 == "diagnose"`.          |

If the user typed a path or skill name as `$ARGUMENTS`, treat it as the
target for `review`/`upgrade`/`diagnose`; for `scaffold` it is the proposed
skill name.

State the detected mode and target in one line before continuing. Example:

```text
Mode: scaffold
Target: skills/<category>/<proposed-name>/
```

---

## Scaffold Workflow (default)

A seven-phase pipeline. Each phase has a gate; do not proceed until it passes.

| Phase | Name                  | Gate                                                          |
| ----- | --------------------- | ------------------------------------------------------------- |
| 0     | Requirements          | User confirmed name, description, modes, structure choice, target runtime |
| 1     | Structure decision    | Single-file vs multi-file decided with reasoning              |
| 2     | Frontmatter draft     | Name + description + flags pass validation                    |
| 3     | File generation       | All planned files written, none over budget                   |
| 4     | Wiring & inventories  | Symlinks created (if local-dev), `CLAUDE.md` + `README.md` updated |
| 5     | Self-check            | Mechanical pre-pass (`scripts/validate-skill.mjs`) is PASS, and every judgment item in `rules/quality-checklist.md` passes |
| 6     | Evaluation            | ≥ 3 eval prompts written and at least one with-skill run observed, or the user explicitly waived it |

### Phase 0 — Requirements (interview)

Ask the user — in **one** message, batched, so they answer once:

1. **Working name** (kebab-case, ≤ 64 chars). What should the directory and
   `name:` field be?
2. **One-line purpose** — what does this skill do? Phrased as a third-person
   action ("Reviews X for Y", not "Helps you with X").
3. **Trigger phrases** — what would the user (or another agent) type to
   reach for this skill? Collect 3–8 phrases.
4. **Invocation control** — slash-only (`disable-model-invocation: true`),
   model-invokable (default), or hidden background (`user-invocable: false`)?
   See `rules/invocation-control.md`.
5. **Modes** — does the skill have one mode or several? If several, list
   them with a one-line description each.
6. **Inputs** — does the skill take `$ARGUMENTS`? Positional (`$0`, `$1`)?
   None?
7. **Tools** — should `allowed-tools` pre-approve any specific tools (e.g.
   `Bash(git *)`)? Default: leave unset.
8. **Scope** — is this an advisory skill (read-only), an applied skill
   (writes code), an orchestrator (calls other skills), a slash command, or
   a workflow companion?
9. **Target runtime** — `claude-code` (default, full frontmatter) or
   `portable` (Skills API / claude.ai upload, six spec fields only)? See
   `rules/frontmatter.md` § Portability profile.
10. **Verification** — does the output have objectively checkable results
    (right shape or not, exit 0 or not)? If yes, plan `evals/` now rather
    than after the fact — see `rules/evaluation.md`.

Confirm the answers back to the user verbatim before moving on. **Do not
guess any of these.**

### Phase 1 — Structure decision

Decide: **single-file** or **multi-file**? Apply this decision flow before
generating anything — see `rules/structure-decision.md` for the full rubric.

**Quick decision table:**

| Signal                                              | Pick           |
| --------------------------------------------------- | -------------- |
| Body fits comfortably under 200 lines               | Single-file    |
| Body would exceed 500 lines (the hard cap)          | Multi-file     |
| 3+ orthogonal concerns (e.g. naming + architecture + tests) | Multi-file (one rule per concern) |
| Worked examples > 100 lines                         | Move to `references/` |
| Reusable boilerplate the skill emits literally      | Move to `templates/` |
| One mode and one concern                            | Single-file    |

Output the chosen layout as a tree before writing files.
In this repo the directory is nested one level under a category (`workflow/`, `quality/`, `delivery/`, `testing/`, `design/`, `analysis/`, or `authoring/` — see `rules/repository-conventions.md`):

```text
skills/<category>/<name>/
├── SKILL.md
├── rules/...
├── references/...
└── templates/...
```

### Phase 2 — Frontmatter draft

Draft the YAML frontmatter using `rules/frontmatter.md` and
`rules/description-writing.md`. **Validate before writing**:

- `name` is kebab-case, ≤ 64 chars, no reserved words (`anthropic`, `claude`).
- `description` is third-person, ≤ 1024 chars, includes both **what** and
  **when** (trigger phrases), front-loaded with the most important keywords.
- `disable-model-invocation: true` is set if the user picked slash-only.
- `argument-hint` is set (unless the skill is `user-invocable: false`),
  derived from the **Modes** (Q5) and **Inputs** (Q6) answers from Phase 0.
  Mirror the actual modes / flags; use `[…]` for optional, `<…>` for
  placeholders, `|` for alternatives. If the skill takes no arguments,
  emit `argument-hint: ''` explicitly rather than omitting the field.
- `metadata.tags` are populated (5–10 specific terms).

### Phase 3 — File generation

Write each planned file. For each one:

- **`SKILL.md`** — start from `templates/SKILL.minimal.md` (single-file),
  `templates/SKILL.multi-file.md` (index pattern), or
  `templates/SKILL.portable.md` (target runtime is `portable`). Keep body
  ≤ 500 lines.
- **`rules/<concern>.md`** — start from `templates/rule.md`, one file per
  concern, loadable in isolation. TOC past 150 lines. Degrees-of-freedom
  and checklist shapes: `rules/workflow-patterns.md`.
- **`references/<topic>.md`** — start from `templates/reference.md`. TOC
  past 100 lines (Claude partial-reads long files; the TOC is the safety
  net).
- **`templates/<artefact>.md`** — literal text the skill emits. No prose
  meta-commentary inside templates.
- **`scripts/<name>.mjs`** — only for a deterministic check or transform
  of the skill's own. Zero dependencies, `${CLAUDE_SKILL_DIR}`-anchored,
  a `--self-test` mode. See `rules/scripts-and-assets.md`.
- **`evals/evals.json`, `evals/triggers.jsonl`** — this skill's own test
  prompts and trigger set, from `templates/evals.json` and
  `templates/triggers.jsonl`. See `rules/evaluation.md`.

After each file, verify:

- Code fences declare a language identifier.
- Sentences end with full stops.
- One sentence per line (semantic line breaks) — repo prose rule.
- No backslash-style paths. No time-sensitive claims ("after August 2025").

### Phase 4 — Wiring & inventories

If the user runs the local-dev symlink chain (the default for this repo),
follow `rules/repository-conventions.md` to:

1. Place the skill at `skills/<category>/<name>/` (categories: `workflow`,
   `quality`, `delivery`, `testing`, `design`, `analysis`, `authoring`).
2. Run `bash scripts/sync-symlinks.sh` from the repo root to wire the
   two-tier chain (`~/.claude/skills/<name>` → `~/.agents/skills/<name>` →
   `<repo>/skills/<category>/<name>`) — never `ln -s` by hand, and never
   invoke the script with `sh`.
3. Verify both hops with `readlink`.
4. Append an entry to the inventory in `CLAUDE.md` (under the matching
   `### \`<category>/\`` subsection, with the correct type marker).
5. Append a row to the table in `README.md` and add the skill to the
   "Repository Structure" tree at the bottom of the README.

If the user is publishing the skill via `npx skills add` only, skip steps
2–3 but still update the inventories.

### Phase 5 — Self-check

Run `node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir> [--portable]`
first, then work through the remaining `(judgment)` items in
`rules/quality-checklist.md`. Treat any unchecked item as a defect — fix it
before declaring the skill done. Report the validator's own `Self-check:` line
verbatim — it prints its own pass/total, so never restate that count from
memory or invent one — then confirm the remaining `(judgment)` items passed.
On failure:

```text
Self-check: FAIL — fix these:
- [ ] description over 1024 chars (currently 1180)
```

### Phase 6 — Evaluation

Follow `rules/evaluation.md`: write and run at least 3 realistic test
prompts, observe at least one with-skill run, and check the repo eval
obligation table. Report `Evaluation: PASS — 3 prompts run, with-skill
navigation observed`, or state explicitly that the user waived this phase.

---

## Review Workflow

For `review` mode, do not write any files. Read the target skill (the path
or skill name from `$ARGUMENTS`) and run the mechanical pre-pass, then work
through the judgment items:

1. Run `node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir> [--portable]`; record every `FAIL`/`WARN` as evidence, then load `rules/quality-checklist.md` for the remaining `(judgment)` items.
2. Read the target `SKILL.md`. If it has `rules/`, `references/`,
   `templates/`, list each file with line count.
3. For every judgment checklist item, mark **PASS / WARN / FAIL** with one
   line of evidence (file path + line number where applicable).
4. End with a prioritised "Top 3 fixes" list — biggest token / clarity wins
   first.

Do not mutate the skill in `review` mode.

## Upgrade Workflow

For `upgrade` mode, take a single-file skill and split it into multi-file:

1. Read the target `SKILL.md`.
2. Identify orthogonal concerns (each H2 section is a candidate).
3. Propose a layout tree (`rules/`, `references/`, `templates/`) and **show
   it to the user for approval before writing**.
4. Move each concern into its own rule file. Replace the section in
   `SKILL.md` with a one-line pointer + link to the new file.
5. Re-run the Phase 5 self-check.

---

## Diagnose Workflow

For `diagnose` mode, do not scaffold or review.
Analyse a session in which **another skill** executed and produced an
unsatisfactory result, identify which of that skill's gates should have
caught it, and emit a confidence-gated unified diff that hardens the target
skill against the same failure class.

The full procedure (seven steps, including the mandatory
`confidence(analysis) ≥ 90 %` gate before `--apply`), the report format,
and the hard rules live in [`rules/diagnose-mode.md`](./rules/diagnose-mode.md).

**Invocation:**

```text
/create-skill diagnose <target-skill-name> [--symptom "..."] [--scope <phase|companion>] [--apply] [--pr] [--no-write]
```

**The target declares its own diagnostic surface** in
`skills/<target>/rules/diagnostic-surface.md` (skills) or
`agents/<target>/rules/diagnostic-surface.md` (agents) — phase model,
failure taxonomy, existing-guards table, source root, hard invariants.
Step 1 of Diagnose Mode disambiguates by checking both locations.
The contract spec is in [`rules/diagnostic-surface.md`](./rules/diagnostic-surface.md);
the scaffolding template a target drops into its own `rules/` is
[`templates/diagnostic-surface.template.md`](./templates/diagnostic-surface.template.md).

If the target has not declared a surface, Diagnose Mode falls back to
inferring phases from the target body's H2 sections (`SKILL.md` for skills,
`agents/<name>.md` for agents) and warns the user once that fidelity is reduced.

Diagnose Mode never modifies user product code.
It only proposes changes to the target's own source.

**Self-improving skills.** An orchestrator skill can close the loop further with
a two-tier self-improvement loop: a fast episodic-lessons tier
(LoreKit `memory.*` tools) feeding the slow `diagnose` tier via a recurrence gate.
The reusable recipe — including when NOT to add one — is in
[`rules/self-improvement-loop-pattern.md`](./rules/self-improvement-loop-pattern.md).
When a target declares a `## Lessons scope`, Diagnose Mode reads it as evidence
(Step 2).

---

## Required Reading by Phase

Load these on demand — do not preload them all.

| Phase    | Files                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| 0        | `rules/description-writing.md`, `rules/invocation-control.md`                           |
| 1        | `rules/structure-decision.md`, `rules/progressive-disclosure.md`                        |
| 2        | `rules/frontmatter.md`, `rules/description-writing.md`, `rules/arguments-and-injection.md` |
| 3        | `rules/token-economics.md`, `rules/anti-patterns.md`, `rules/arguments-and-injection.md`, `rules/scripts-and-assets.md`, `rules/workflow-patterns.md`, plus templates in `templates/` |
| 4        | `rules/repository-conventions.md`                                                       |
| 5        | `rules/quality-checklist.md`                                                            |
| 6        | `rules/evaluation.md`                                                                   |
| diagnose | `rules/diagnose-mode.md`, `rules/diagnostic-surface.md`, plus the target's `rules/diagnostic-surface.md` |
| loop     | `rules/self-improvement-loop-pattern.md` (adding a self-improvement loop to an orchestrator skill) |
| lens     | `rules/review-lens-contract.md` + `templates/lens.md` (making an existing skill lens-eligible for `pr-reviewer`) |

`references/skill-archetypes.md` and `references/good-vs-bad-examples.md`
are optional — load only when the user asks for a worked shape or pair.

---

## Core Principles

1. **Concise is key.** The context window is a public good. Every line in
   `SKILL.md` is a recurring token cost once loaded — write nothing Claude
   already knows. See `rules/token-economics.md`.
2. **Progressive disclosure beats one big file.** Three tiers: metadata
   (always loaded), `SKILL.md` (loaded on trigger), supporting files
   (loaded on demand). Keep references one level deep.
3. **Description is the discovery surface.** Third person, what + when,
   front-loaded with trigger keywords. The first 1024 chars decide whether
   Claude even loads the rest.
4. **Match degrees of freedom to the task.** Prescriptive scripts for
   fragile sequences; high-freedom prose for judgment calls. See
   `rules/structure-decision.md`.
5. **One skill, one job.** Resist the mega-skill. Split into companions and
   compose with `Skill()` calls.
6. **Eval-first, not test-as-afterthought.** Identify the gap without the
   skill, write ≥ 3 realistic test prompts, run a baseline, then the
   minimal skill that closes the gap — iterate from there rather than
   front-loading content. See `rules/evaluation.md`.

---

## Anti-patterns (one-liner — full list in `rules/anti-patterns.md`)

- Vague descriptions ("Helps with documents").
- First-person voice in `description` ("I can help you …").
- Time-sensitive claims ("after August 2025 …").
- Deeply nested references (`SKILL.md` → `a.md` → `b.md` → `c.md`).
- Mega-skills doing five jobs.
- Backslash paths.
- Reserved words (`anthropic`, `claude`) in the `name`.
- All-caps MUST/NEVER as the only lever, instead of explaining the why.
- Claude-Code-only fields (`disable-model-invocation`, `context`, …) in a
  skill targeting the portable six-field profile.

---

## Definition of Done

A **scaffold** run is done when:

- [ ] All planned files written and within their line caps.
- [ ] `name` and `description` validate against the rules in
      `rules/frontmatter.md`.
- [ ] Symlinks resolve (local-dev) or `npx skills` install path documented.
- [ ] Inventory rows in `CLAUDE.md` and `README.md` added.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir>` reports `PASS`.
- [ ] Phase 5 self-check (mechanical + judgment) is `PASS`.
- [ ] Phase 6 evaluation has ≥ 3 eval prompts written (or the user
      explicitly waived evaluation).
- [ ] Target runtime (`claude-code` or `portable`) is recorded.
- [ ] One sentence summary delivered to the user with the install command
      they can run to start using the skill.

A **diagnose** run is done when:

- [ ] Target skill name resolved and source root verified writable.
- [ ] Diagnostic surface loaded (or fallback warning printed).
- [ ] Failure classified against the target's taxonomy (or `F-novel` plus a
      proposed new row).
- [ ] Phase-attribution table walks every phase in the target's surface.
- [ ] Exactly one improvement proposal constructed (one diff per report).
- [ ] `confidence(analysis)` score recorded; `--apply` honored only at
      ≥ 90 % (final score, after Step 6.5's two-iteration refinement loop
      if the initial score was below the gate).
- [ ] Report written to `.agent/{branch}/diagnose-{target}.md` (or
      stdout with `--no-write`).
- [ ] If `--apply` ran, user explicitly confirmed before `git apply`.
