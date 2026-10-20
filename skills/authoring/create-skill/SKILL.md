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
Phases 0–2 do the job with no skill loaded and record every correction it needed; Phases 3–5 write a skill made of those corrections only and prove it closes them.
The full procedure for Phases 0–2 is [`rules/run-first.md`](./rules/run-first.md); why it beats designing the skill up front is [`references/run-first-rationale.md`](./references/run-first-rationale.md).

**No one to ask.** When the user said not to ask questions, or the session is headless, answer each question below yourself from the request and the run, record the answers in the ledger, and continue.

| Phase | Name    | Gate |
| ----- | ------- | ---- |
| 0     | Brief   | Task, real input, guardrails, and a definition of done that can fail |
| 1     | Run     | The job ran on the real input with no skill and passes its definition of done, and every correction is in the ledger — or the run was waived with a recorded reason |
| 2     | Distill | Every ledger row routed; no-skill exit evaluated; name, description, and invocation settled |
| 3     | Write   | Every skill line traces to a ledger row, a guardrail, or the definition of done |
| 4     | Check   | `scripts/validate-skill.mjs` is PASS; wiring done when inside this repo |
| 5     | Verify  | A fresh run with the skill needed none of the ledger's corrections |

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
   On a zero count, stop here and say no skill is needed — unless the run was waived, which skips the exit.
2. Propose these three, derived from the run, and confirm them with the user in **one** message:
   1. **Name** — kebab-case, ≤ 64 chars, no `anthropic` or `claude`.
   2. **Description** — third person, what it does and when to use it, with 3–8 trigger phrases including how the user asked in Phase 0 ([`rules/description-writing.md`](./rules/description-writing.md)).
   3. **Invocation** — model-invokable (default) or slash-only (`disable-model-invocation: true`) ([`rules/invocation-control.md`](./rules/invocation-control.md)).
3. Add `argument-hint` only when the run took an argument, `allowed-tools` only when the run needed repeated permission prompts, and the `portable` profile only when the user asks for it ([`rules/frontmatter.md`](./rules/frontmatter.md) § Portability profile).

### Phase 3 — Write

Write the skill from the ledger, not from the process:

| Ledger route | Becomes |
| --- | --- |
| `skill gotcha` | one line or one short block under `## Gotchas` |
| `check script` | `scripts/check-<name>.mjs` (zero dependencies, `${CLAUDE_SKILL_DIR}`-anchored; [`rules/scripts-and-assets.md`](./rules/scripts-and-assets.md)) plus one line to run it before reporting done |
| `subagent step` | one instruction to run that step in a sub-agent and return only its result |
| `hook`, `workspace fact` | its routed destination, never the skill |

Never add a step the agent did correctly in the run, a heading with no ledger row under it, or frontmatter the run did not need.
Start from [`templates/SKILL.minimal.md`](./templates/SKILL.minimal.md); split into `rules/` only when the body passes 200 lines ([`rules/structure-decision.md`](./rules/structure-decision.md)).

```markdown
<!-- ✗ Wrong — a manual for the process, plus ceremony -->
## Overview / ## Steps (1. Read the export. 2. Compute totals. …) / ## Best practices / ## Troubleshooting

<!-- ✓ Right — only what the run got wrong, and how done is checked -->
## Gotchas
- Refund rows carry positive amounts; subtract them.
- JPY has no minor unit; never divide its amount by 100.

Before reporting done, run `node ${CLAUDE_SKILL_DIR}/scripts/check-report.mjs report.md` and show its last line.
```

### Phase 4 — Check

Run `node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir> [--portable]`, fix every `FAIL`, and report its `Self-check:` line verbatim.

```text
FAIL FM05 SKILL.md:3 — description must be non-empty and <= 1024 chars, got 1180
Self-check: FAIL — 1 failing
```

Inside this repo (it has `scripts/sync-symlinks.sh`), place the skill at `skills/<category>/<name>/`, run `bash scripts/sync-symlinks.sh`, and add the inventory hook to `CLAUDE.md` and the row to `README.md` ([`rules/repository-conventions.md`](./rules/repository-conventions.md)).
Anywhere else, skip wiring and state where the skill was written.

### Phase 5 — Verify

Re-run the Phase 0 brief in a sub-agent with the skill installed, on a fresh input (another real input, or the same one with the previous output deleted), and check that no ledger correction recurs.
A recurring correction means the line meant to prevent it is wrong or missing: fix that line and re-run once.
Report `Verify: PASS — fresh run, 0 of <n> corrections recurred`.

The lift check ([`rules/lift-check.md`](./rules/lift-check.md)) and eval files ([`rules/evaluation.md`](./rules/evaluation.md)) are not part of a scaffold: run them when the user asks, or before the skill is shipped to other people.

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

| Phase    | Files |
| -------- | ----- |
| 0–2      | `rules/run-first.md`, `rules/description-writing.md`, `rules/invocation-control.md` |
| 3        | `rules/scripts-and-assets.md`, `rules/structure-decision.md` (only past 200 lines), `templates/SKILL.minimal.md` |
| 4        | `rules/repository-conventions.md` (inside this repo only) |
| review   | `rules/quality-checklist.md`, `rules/anti-patterns.md`, `rules/token-economics.md`, `rules/arguments-and-injection.md`, `rules/workflow-patterns.md` |
| upgrade  | `rules/structure-decision.md`, `rules/progressive-disclosure.md` |
| prune    | `rules/prune-mode.md`, `rules/lift-check.md` |
| diagnose | `rules/diagnose-mode.md`, `rules/diagnostic-surface.md`, plus the target's `rules/diagnostic-surface.md` |
| loop     | `rules/self-improvement-loop-pattern.md` (adding a self-improvement loop to an orchestrator skill) |
| lens     | `rules/review-lens-contract.md` + `templates/lens.md` (making an existing skill lens-eligible for `pr-reviewer`) |

`references/skill-archetypes.md` and `references/good-vs-bad-examples.md` are optional — load only when the user asks for a worked shape or pair.

---

## Core Principles

1. **A skill is the list of what the agent got wrong.** Do the job once without it and write only the corrections; a run that needed none means no skill ([`rules/run-first.md`](./rules/run-first.md)).
2. **Every line is a recurring cost.** Write nothing the model already does ([`rules/token-economics.md`](./rules/token-economics.md)).
3. **The description is the discovery surface.** Third person, what and when, trigger phrases first.
4. **Guarantees are hooks and scripts, not capitals.** What must never happen becomes a hook; a done condition that can be checked becomes a script the skill runs.

---

## Definition of Done

A **scaffold** run is done when:

- [ ] The job ran once without the skill on a real input (or the waiver is recorded), and the ledger at `.agent/{branch}/skill-run-<task-slug>.md` routes every correction.
- [ ] Every `SKILL.md` line traces to a ledger row, a guardrail, or the definition of done.
- [ ] `validate-skill.mjs` reports `PASS`.
- [ ] Inside this repo: symlinks resolve and the `CLAUDE.md` and `README.md` rows exist.
- [ ] Phase 5 verify passed, or the user waived it.
- [ ] One sentence to the user: where the skill is and how to invoke it.

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