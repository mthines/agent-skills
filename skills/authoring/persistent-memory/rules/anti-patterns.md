---
title: Anti-patterns — What Not To Do
impact: MEDIUM
tags:
  - anti-patterns
---

# Anti-patterns

## Contents

- [Writes without consent](#writes-without-consent)
- [Mega-scopes](#mega-scopes)
- [Re-recording the same fact](#re-recording-the-same-fact)
- [Storing secrets](#storing-secrets)
- [Deleting without an audit line](#deleting-without-an-audit-line)
- [Skipping consolidation forever](#skipping-consolidation-forever)
- [Reflexive auto-write](#reflexive-auto-write)
- [Cross-scope leakage](#cross-scope-leakage)
- [Committing `home` tier to git](#committing-home-tier-to-git)
- [Loading every entry on read](#loading-every-entry-on-read)
- [Magical hooks for everything](#magical-hooks-for-everything)
- [Premature graduation](#premature-graduation)
- [Self-reflection entrenchment](#self-reflection-entrenchment)
- [Forgetting without confirmation](#forgetting-without-confirmation)

Patterns this skill refuses, and the reason behind each refusal.

## Writes without consent

❌ Writing to memory at the end of a conversation without showing the
user the candidate list first.

✅ Always render the ADD / UPDATE / DELETE / NOOP plan and wait for
approval. `--auto` is allowed but still prints the plan to the
transcript.

## Mega-scopes

❌ One scope called `life` that holds every fact about the user.

✅ Split by topic: `parenting`, `health`, `work`, `relationship-anna`.
The INDEX stays under 200 lines and recall stays sharp.

## Re-recording the same fact

❌ Treating every conversation as if memory is empty and `ADD`-ing
duplicates.

✅ Phase 3 of the write pipeline compares candidates to existing
entries. NOOP a duplicate; UPDATE a refinement; never ADD a near-copy.

## Storing secrets

❌ Letting the model write an API key or password into a memory entry
because the user pasted it into the chat.

✅ The never-store list in [`privacy-and-consent.md`](./privacy-and-consent.md)
is unconditional. Refuse without recording the content.

## Deleting without an audit line

❌ `rm entries/<file>.md` from a tool call. AUDIT.log not updated.

✅ Every delete (archive, hard, or redact) appends one NDJSON line to
AUDIT.log with the operation, scope, and IDs.

## Skipping consolidation forever

❌ INDEX grows to 800 lines over six months. Recall degrades. New
writes still ADD on top.

✅ When INDEX exceeds 200 lines, warn the user. Run `consolidate`
quarterly for active scopes.

## Reflexive auto-write

❌ Every model turn triggers an automatic `write` to capture the
turn's content. Memory accumulates conversation noise.

✅ The model decides when a durable fact emerged. Most turns do not
write. The conversation noise filter is part of extraction.

## Cross-scope leakage

❌ A `read` for `parenting` returns INDEX entries from `work` because
they share a tag.

✅ Scopes are hard boundaries. Tag overlap across scopes is a
coincidence, not a join.

## Committing `home` tier to git

❌ `~/.agent-memory/` gets symlinked into a repo for "backup".

✅ `home` is per-machine, per-user. If the user wants version
control, the right move is to use `project-shared` tier, accepting
that the content is team-visible.

## Loading every entry on read

❌ A `read` operation loads INDEX.md AND every file in `entries/` "to
be thorough".

✅ Only INDEX is auto-loaded. Detail entries load on demand when the
INDEX cross-references them.

## Magical hooks for everything

❌ A SessionStart hook auto-loads five scopes on every session.
Permanent context bloat.

✅ Pointer-based is the default. Hooks are opt-in for at most one or
two scopes that genuinely matter every session.

## Premature graduation

❌ Switching to a hosted vector DB because "we might scale someday".

✅ Stay on Tier 1 (markdown) until a concrete signal forces a move.
See [`scaling-tiers.md`](./scaling-tiers.md).

## Self-reflection entrenchment

❌ The model writes an inference as `high` confidence after a single
conversation, and every future session treats it as fact.

✅ Inferred facts default to `medium` confidence. Only user-stated
facts get `high`. The `## History` block on UPDATE preserves the prior
wording so the user can spot drift.

## Forgetting without confirmation

❌ `/persistent-memory forget parenting "anna"` deletes 40 entries
matching that tag with no preview.

✅ Always show the candidate list. Require an explicit affirmative
reply. Double-confirm for `--all` or for scopes on `project-shared`.
