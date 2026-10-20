---
name: create-skill
description: >
  Scaffolds, reviews, upgrades, or diagnoses agent skills against
  best-practice frontmatter, progressive disclosure, token-aware
  structure, and the agent-skills.git symlink + inventory wiring.
  Modes: `scaffold` (default — runs the job once without a skill on a
  real input, records every correction, then writes a skill made of
  only those corrections), `review` (audit existing
  skill), `upgrade` (split a single-file skill into multi-file),
  `diagnose` (retrospective failure analysis that emits a
  confidence-gated unified diff against any skill declaring a
  diagnostic surface), `prune` (deletes unused skills and trims or
  deletes those whose with/without-skill eval shows no lift over a
  same-length dummy). Triggers on "create a skill", "scaffold a skill",
  "new SKILL.md", "review this skill", "audit my skill", "upgrade this
  skill", "split this skill", "diagnose this skill", "why did the skill
  miss this", "prune my skills", "clean up my skills", "/create-skill".
disable-model-invocation: true
argument-hint: '[scaffold|review|upgrade|diagnose|prune] [<skill-name>|<path>...]'
license: MIT
metadata:
  author: mthines
  version: '1.5.0'
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
    - run-first
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
| `prune`    |         | "prune", "clean up my skills", "which skills are useless", or `$0 == "prune"`. |

If the user typed a path or skill name as `$ARGUMENTS`, treat it as the
target for `review`/`upgrade`/`diagnose`/`prune`; for `scaffold` it is the proposed
skill name.

State the detected mode and target in one line before continuing. Example:

```text
Mode: scaffold
Target: skills/<category>/<proposed-name>/
```

---

## Scaffold Workflow (default)

Run the job first, write the skill second.
Phases 0–2 do the job the skill is for, with no skill loaded, and record every correction it needed; Phases 3–8 write a skill made of those corrections only.
The full procedure for Phases 0–2 is [`rules/run-first.md`](./rules/run-first.md); why it beats designing the skill up front is [`references/run-first-rationale.md`](./references/run-first-rationale.md).

| Phase | Name                  | Gate                                                          |
| ----- | --------------------- | ------------------------------------------------------------- |
| 0     | Brief                 | Task, real input, guardrails, and a definition of done that can fail |
| 1     | Run                   | The job ran on the real input with no skill, the user accepted the output, and every correction is in the ledger — or the run was waived with a recorded reason |
| 2     | Distill               | Every ledger row routed; no-skill exit evaluated; user confirmed name, description, modes, invocation, and target runtime |
| 3     | Structure decision    | Single-file vs multi-file decided with reasoning              |
| 4     | Frontmatter draft     | Name + description + flags pass validation                    |
| 5     | File generation       | Every skill line traces to a ledger row, the guardrails, or the definition of done; none over budget |
| 6     | Wiring & inventories  | Symlinks created (if local-dev), `CLAUDE.md` + `README.md` updated |
| 7     | Self-check            | Mechanical pre-pass (`scripts/validate-skill.mjs`) is PASS, and every judgment item in `rules/quality-checklist.md` passes |
| 8     | Evaluation            | The Phase 0 brief re-run with the skill closes the ledger's corrections, ≥ 2 more prompts run, and the lift check verdict is `lift` — or the user explicitly waived it |

### Phase 0 — Brief

Ask the user, in **one** message, for the four brief fields in `rules/run-first.md` § Step 1: task, a real input, guardrails, and a definition of done.
Do not ask for the skill's name, description, or structure yet.

### Phase 1 — Run

Do the job on the real input, in this session, without the skill, following `rules/run-first.md` § Step 2.
Show the output with its definition-of-done result, take the user's corrections, and repeat until they accept it.
Write each correction to the ledger at `.agent/{branch}/skill-run-<task-slug>.md` as it happens.

```text
✗ Wrong — writing the skill from the user's description of the process
User: create a skill for our weekly client report
Agent: Here is skills/…/weekly-client-report/SKILL.md with 9 steps …

✓ Right — doing the report first
User: create a skill for our weekly client report
Agent: Give me this week's export, what I must not touch, and what "done" means.
       I'll produce the report without a skill, you correct me, and the skill
       will be made of those corrections.
```

### Phase 2 — Distill

1. Route every ledger row (`rules/run-first.md` § Step 4) and apply the no-skill exit (§ Step 5).
   On a zero count, stop here and say no skill is needed.
2. Propose answers to the questions below, derived from the run, and ask the user to confirm or change them in **one** message:
   1. **Working name** (kebab-case, ≤ 64 chars).
   2. **One-line purpose**, third person ("Reviews X for Y", not "Helps you with X").
   3. **Trigger phrases** — 3–8, including the phrasing the user used to start Phase 0.
   4. **Invocation control** — slash-only (`disable-model-invocation: true`), model-invokable (default), or hidden background (`user-invocable: false`). See `rules/invocation-control.md`.
   5. **Modes** — one, or several with a one-line description each.
   6. **Inputs** — `$ARGUMENTS`, positional (`$0`, `$1`), or none; mirror what the run's real input was.
   7. **Tools** — `allowed-tools` to pre-approve, if the run needed repeated permission prompts. Default: unset.
   8. **Scope** — advisory (read-only), applied (writes code), orchestrator, slash command, or workflow companion.
   9. **Target runtime** — `claude-code` (default) or `portable` (six spec fields only). See `rules/frontmatter.md` § Portability profile.
   10. **Routed extras** — confirm each `hook`, `workspace fact`, and `check script` row will be written where `rules/run-first.md` § Step 4 routes it.
3. Confirm the answers back verbatim before moving on.
   **Do not guess any of these.**

### Phase 3 — Structure decision

Decide: **single-file** or **multi-file**? Apply this decision flow before
generating anything — see `rules/structure-decision.md` for the full rubric.
A ledger with fewer than ten routed rows almost always fits a single file.

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

### Phase 4 — Frontmatter draft

Draft the YAML frontmatter using `rules/frontmatter.md` and
`rules/description-writing.md`. **Validate before writing**:

- `name` is kebab-case, ≤ 64 chars, no reserved words (`anthropic`, `claude`).
- `description` is third-person, ≤ 1024 chars, includes both **what** and
  **when** (trigger phrases), front-loaded with the most important keywords.
- `disable-model-invocation: true` is set if the user picked slash-only.
- `argument-hint` is set (unless the skill is `user-invocable: false`),
  derived from the **Modes** and **Inputs** answers from Phase 2.
  Mirror the actual modes / flags; use `[…]` for optional, `<…>` for
  placeholders, `|` for alternatives. If the skill takes no arguments,
  emit `argument-hint: ''` explicitly rather than omitting the field.
- `metadata.tags` are populated (5–10 specific terms).

### Phase 5 — File generation

Write the skill from the ledger, not from the process.
Each `skill gotcha` row becomes one line or one short block; each `check script` row becomes the script and one instruction to run it before reporting done; each `subagent step` row becomes one instruction to run that step in a sub-agent.
Never add a step the agent did correctly in the run.
Write each `hook` and `workspace fact` row to its routed destination, not into the skill.

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
  `templates/triggers.jsonl`. The Phase 0 brief is the first eval. See
  `rules/evaluation.md`.

After each file, verify:

- Code fences declare a language identifier.
- Sentences end with full stops.
- One sentence per line (semantic line breaks) — repo prose rule.
- No backslash-style paths. No time-sensitive claims ("after August 2025").

### Phase 6 — Wiring & inventories

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

### Phase 7 — Self-check

Run `node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir> [--portable]`
first, then work through the remaining `(judgment)` items in
`rules/quality-checklist.md`. Treat any unchecked item as a defect — fix it
before declaring the skill done. Report the validator's own `Self-check:` line
verbatim — it prints its own pass/total, so never restate that count from
memory or invent one — then confirm the remaining `(judgment)` items passed.
On failure:

```text
FAIL FM05 SKILL.md:3 — description must be non-empty and <= 1024 chars, got 1180
Self-check: FAIL — 1 failing
```

### Phase 8 — Evaluation

Follow `rules/evaluation.md`.
The Phase 1 run is the no-skill baseline: re-run the Phase 0 brief on a fresh input with the skill installed and confirm every `skill gotcha` row no longer needs a correction.
Add at least 2 more realistic prompts, observe at least one with-skill run, and check the repo eval obligation table.
Then run the lift check in [`rules/lift-check.md`](./rules/lift-check.md): the skill must beat both no skill and a same-length dummy, or it is trimmed or not shipped.
Report `Evaluation: PASS — 3 prompts run, ledger corrections closed, with-skill navigation observed`, then the lift check's `Lift:` line, or state explicitly that the user waived this phase.

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
5. Re-run the Phase 7 self-check.

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

## Prune Workflow

For `prune` mode, clean up an installed skill set; follow [`rules/prune-mode.md`](./rules/prune-mode.md):

1. Inventory each skill's context cost and usage with `claude -p "/skill-doctor"`.
2. Delete candidates: skills never invoked.
3. Lift-check every used skill ([`rules/lift-check.md`](./rules/lift-check.md)), highest cost first; no lift over the dummy makes it a trim or delete candidate.
4. Find and migrate callers, then get the user's explicit yes per skill before deleting or trimming anything.

Why: [`references/lift-and-prune-rationale.md`](./references/lift-and-prune-rationale.md).

---

## Required Reading by Phase

Load these on demand — do not preload them all.

| Phase    | Files                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| 0–1      | `rules/run-first.md`                                                                    |
| 2        | `rules/run-first.md`, `rules/description-writing.md`, `rules/invocation-control.md`     |
| 3        | `rules/structure-decision.md`, `rules/progressive-disclosure.md`                        |
| 4        | `rules/frontmatter.md`, `rules/description-writing.md`, `rules/arguments-and-injection.md` |
| 5        | `rules/token-economics.md`, `rules/anti-patterns.md`, `rules/arguments-and-injection.md`, `rules/scripts-and-assets.md`, `rules/workflow-patterns.md`, plus templates in `templates/` |
| 6        | `rules/repository-conventions.md`                                                       |
| 7        | `rules/quality-checklist.md`                                                            |
| 8        | `rules/evaluation.md`, `rules/lift-check.md`                                            |
| prune    | `rules/prune-mode.md`, `rules/lift-check.md`                                            |
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
6. **Run first, write second.** Do the job once without the skill and
   write only the corrections it needed — a skill is a list of what the
   agent got wrong, not a manual for the process. A run that needed no
   corrections means no skill. See `rules/run-first.md`.
7. **Guarantees are hooks, not capitals.** Something that must never
   happen becomes a hook; a definition of done that can be checked
   mechanically becomes a check script the skill runs.

---

## Anti-patterns (one-liner — full list in `rules/anti-patterns.md`)

- Writing the skill before the job has run once without it.
- Documenting steps the agent already does correctly.
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

- [ ] The job ran once without the skill on a real input (or the waiver is recorded), and the ledger at `.agent/{branch}/skill-run-<task-slug>.md` routes every correction.
- [ ] Every `SKILL.md` line traces to a ledger row, a guardrail, or the definition of done.
- [ ] All planned files written and within their line caps.
- [ ] `name` and `description` validate against the rules in
      `rules/frontmatter.md`.
- [ ] Symlinks resolve (local-dev) or `npx skills` install path documented.
- [ ] Inventory rows in `CLAUDE.md` and `README.md` added.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir>` reports `PASS`.
- [ ] Phase 7 self-check (mechanical + judgment) is `PASS`.
- [ ] Phase 8 evaluation has ≥ 3 eval prompts written (or the user
      explicitly waived evaluation).
- [ ] `rules/lift-check.md` verdict is `lift`, with both deltas reported (or the user
      explicitly waived it).
- [ ] Target runtime (`claude-code` or `portable`) is recorded.
- [ ] One sentence summary delivered to the user with the install command
      they can run to start using the skill.

A **prune** run is done when:

- [ ] Every skill in scope has a cost, a usage class, and (if used) a lift verdict or an `unchecked` mark.
- [ ] No skill was deleted or trimmed without the user's explicit per-skill confirmation.
- [ ] Every deleted skill's callers were repointed or removed in the same change.
- [ ] The report states the context saved per turn.

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
