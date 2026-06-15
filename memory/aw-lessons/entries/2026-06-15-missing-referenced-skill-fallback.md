---
id: 2026-06-15-missing-referenced-skill-fallback
created: 2026-06-15T13:45:00Z
updated: 2026-06-15T13:45:00Z
type: procedural
scope: aw-lessons
phase: 1
trigger-context: skill scaffolding tasks that reference a skill by name for pattern extraction (e.g. "read playwright-cli-authed and extract patterns")
seen_count: 1
confidence: high
status: active
expires: 2026-09-15T13:45:00Z
source: system
redacted: false
---

# When a referenced skill is absent, check installed siblings for equivalent patterns

**What failed:** The task prompt referenced `playwright-cli-authed` for pattern extraction. The skill was not installed in this repo (not in `~/.claude/skills/` or the agent-skills repo). The find command returned zero results.

**Why:** The task intent was "extract auth-caching and headless-invocation patterns from this skill" — it was a pattern reference, not a dependency. The skill may exist in some installs but not all.

**What to do next time:** When a referenced skill is absent, scan installed siblings with overlapping tags (`e2e`, `playwright`, `browser-automation`) using `find ~/.claude/skills -name "SKILL.md" | xargs grep -l "playwright"`. Use the best available match. Do not block — the task intent is pattern extraction, not runtime dependency.

**Promotion target:** Phase 1 planning rule — could become a "skill reference resolution" note in `phase-1-planning.md#step-1-analyze-codebase`.
