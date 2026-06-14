---
id: 2026-06-14-add-contents-to-long-rules-files
created: 2026-06-14T12:00:00Z
updated: 2026-06-14T12:00:00Z
type: procedural
scope: aw-lessons
phase: 3
trigger-context: skill scaffolding (skills/<category>/<name>/rules/*.md files)
seen_count: 1
confidence: high
status: active
expires: 2026-09-14T12:00:00Z
source: system
redacted: false
---

# Add ## Contents to rules files exceeding 100 lines before quality-checklist gate

**What failed:** Three rule files (`bootstrap.md`, `project-keying.md`, `surface-validation.md`) were written at 120, 107, and 103 lines respectively without `## Contents` sections. The quality-checklist gate requires every file >100 lines to have one, causing retroactive edits.

**Why:** Files were written to spec and grew past 100 lines organically. The Contents requirement was only caught at the checklist phase rather than during authoring.

**What to do next time:** After writing each `rules/*.md` file, immediately check its line count with `wc -l`. If it exceeds 100 lines, add a `## Contents` section listing all `##` headings before moving to the next file. Do not batch this check to the end of Phase 3.

**Promotion target:** Phase 3 implementation rule for skill scaffolding — could become a per-file gate in `create-skill`'s quality-checklist.md.
