---
title: Ideate — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - ideate
---

# Ideate — Diagnostic Surface

This file declares the contract `/create-skill diagnose ideate` reads to parameterize Diagnose Mode for this skill.
The contract spec lives at [`skills/authoring/create-skill/rules/diagnostic-surface.md`](../../../authoring/create-skill/rules/diagnostic-surface.md).

## Contents

- [Source root](#source-root)
- [Phase model](#phase-model)
- [Existing guards per phase](#existing-guards-per-phase)
- [Failure taxonomy](#failure-taxonomy)
- [Hard invariants](#hard-invariants)
- [Artifacts](#artifacts)
- [Lessons scope](#lessons-scope)
- [Validators](#validators)

---

## Source root

`skills/analysis/ideate/`

---

## Phase model

| Phase | Name            | Rule file                                                    | Gate                                                                    |
| ----- | --------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0     | Intake & triage | [`../SKILL.md`](../SKILL.md)                                  | Problem restated; success criterion named; depth chosen; lessons read.    |
| 1     | Frame           | [`../SKILL.md`](../SKILL.md)                                  | 3–5 HMW framings; one selected and logged.                                |
| 2     | Diverge         | [`divergence.md`](./divergence.md)                            | Unique-pool gate met; no evaluation during generation.                    |
| 3     | Score           | [`idea-scoring.md`](./idea-scoring.md)                        | Four independent axes; non-generator judge; anonymized pool.              |
| 4     | Evolve          | [`evolution-loop.md`](./evolution-loop.md)                    | ≤ 3 rounds; external-score stopping.                                      |
| 5     | Validate        | [`idea-scoring.md`](./idea-scoring.md)                        | Executability probes; `confidence(analysis)` gate.                        |
| 6     | Report          | [`../templates/ideation-report.md`](../templates/ideation-report.md) | Report emitted with wildcard, run stats, and verdict question.       |
| 7     | Learn           | [`self-improvement-loop.md`](./self-improvement-loop.md)      | Mechanics-only lessons written.                                           |

---

## Existing guards per phase

| Phase | Existing guards                                                        | Typical gaps                                                             |
| ----- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 0     | Depth-triage table; missing-problem refusal.                             | Ambiguous asks triaged quick when the user wanted depth.                    |
| 1     | Width-varied framings; autonomous default (one step wider than literal). | Framing chosen re-states the literal ask five ways (no real width variance). |
| 2     | Persona-per-call; mandatory burst 2; gate-met/yield/4-burst stopping rule. | Personas too similar; operators assigned but ignored by generators.         |
| 3     | Anonymization; order-swap pairs; length normalization.                   | Composite used for selection despite the selection rules.                   |
| 4     | Niche elitism; 3-round cap; external re-scoring.                         | Niches drawn too coarsely (everything lands in 2 buckets).                   |
| 5     | Executability probe; confidence thresholds.                              | Probe written as marketing prose instead of a first concrete step.           |
| 6     | Template with run stats + verdict question.                              | Wildcard silently dropped when it scored poorly.                             |
| 7     | Mechanics-only content policy; verdict-gated calibration lessons.         | Calibration lesson written without an actual user verdict.                   |

---

## Failure taxonomy

| ID      | Class                  | Symptom                                                                    | Primary phase | Primary gate / companion                                           |
| ------- | ---------------------- | --------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| F1      | Depth mis-triage       | Deep pipeline on a trivial ask, or quick on an open-ended one.               | 0             | Depth-triage table.                                                 |
| F2      | Homogeneous pool       | Pool passes the count gate but ideas share 1–2 mechanisms.                   | 2             | Persona/operator rotation; dedup-by-mechanism.                      |
| F3      | Judge miscalibration   | User verdict contradicts the ranking (picked a low-ranked idea, rejected finalists). | 3        | Axis independence; selection rules; panel vote.                     |
| F4      | Novelty loss           | All finalists are safe/incremental; wildcard missing or token.               | 3             | Novelty-protection rule.                                            |
| F5      | Evolution degradation  | Later rounds produced duplicates or lower external scores that were kept.    | 4             | Stopping criteria; external re-scoring.                             |
| F6      | Unvalidated finalists  | Recommendation shipped without probes or below the confidence threshold.     | 5             | Executability probe; confidence gate.                               |
| F-novel | Novel mode             | Does not match any existing row.                                             | —             | Diagnosis proposes a new row inline (added on user approval only).  |

Taxonomy is append-only.
Every new row must come from a real, confidence-gated, user-approved diagnosis.

---

## Hard invariants

- Generation and evaluation never co-occur in one pass.
- Divergence runs lessons-blind; lessons never carry idea content or user idea-taste.
- The judge is never the generator; finalists in deep mode require the 3-judge panel.
- At least one high-novelty wildcard survives to the report.
- The 3-round evolution cap (1 in quick mode) cannot be raised.
- The `confidence(analysis)` gate on finalists cannot be skipped or its thresholds lowered.

---

## Artifacts

| File pattern                          | Produced by       | When                          |
| -------------------------------------- | ------------------ | ------------------------------ |
| `.agent/ideate/<yyyy-mm-dd>-<slug>.md` | Phase 6 (deep mode) | Report emission.               |

---

## Lessons scope

- Scope: `ideate-lessons`
- Tiers: `home` (always, `~/.agent-memory/ideate-lessons/`) + `project-shared` (opt-in per repo, `<repo>/memory/ideate-lessons/`)
- Read for evidence with the two-tier fan-out:

  ```text
  Skill("persistent-memory", "read ideate-lessons --tier home")
  if [ -f memory/ideate-lessons/INDEX.md ]; then
    Skill("persistent-memory", "read ideate-lessons --tier project-shared")
  fi
  ```

---

## Validators

- `node scripts/eval/l1.mjs` (repo-wide link/anchor integrity — covers this skill's cross-links).
- `bash scripts/sync-symlinks.sh --dry-run` (wiring intact).
