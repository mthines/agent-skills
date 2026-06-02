---
title: Integration With Other Skills — Pointer Pattern
impact: HIGH
tags:
  - integration
  - pointer
  - skill-composition
---

# Integration With Other Skills

## Contents

- [Pattern A — Pointer (default)](#pattern-a--pointer-default)
- [Pattern B — SessionStart hook (opt-in, advanced)](#pattern-b--sessionstart-hook-opt-in-advanced)
- [Two-way handshake: write after a session](#two-way-handshake-write-after-a-session)
- [When NOT to integrate](#when-not-to-integrate)
- [Verifying integration](#verifying-integration)

Two patterns are documented. **Pointer-based is the default and the
recommendation** — it matches Claude Code's native progressive
disclosure and pays token cost only when the host skill is loaded.

## Pattern A — Pointer (default)

The host skill (e.g. `parenting`) keeps a one-line block in its
`SKILL.md` that tells the model to load memory for the scope before
proceeding.

The literal snippet to add lives in
[`../templates/pointer-snippet.md`](../templates/pointer-snippet.md).
Drop it near the top of the host skill, under the title:

```markdown
## Persistent Context

Before responding, run `Skill("persistent-memory", "read parenting")`
to load accumulated memory for this scope. The returned INDEX surfaces
relevant entries; load individual entries on demand only.

After the conversation, if any durable fact emerged (a preference, a
routine, a decision), run
`Skill("persistent-memory", "write parenting")` to capture it. The
write pipeline will preview the candidate list before persisting.
```

### Why pointer-based wins for quality / token cost

| Property                  | Pointer                                 | Hook (auto-load)                                   |
| ------------------------- | --------------------------------------- | -------------------------------------------------- |
| When INDEX loads          | Only when the host skill is invoked     | Every session, even when the scope is irrelevant   |
| Tokens paid               | INDEX (~50–200 lines) per host invoke   | INDEX × N scopes × every session                   |
| Debuggability             | One line, in source                     | Hidden in `.claude/settings.json` + a script       |
| Setup cost                | Add one block to host SKILL.md          | Configure hook, declare scopes, test silently      |
| Failure mode              | Visible — the line is absent            | Silent — the hook fires but content is unused      |

Pointer-based pays the cost where the value is. Hooks pay even when
the user is not asking about the scope.

### Tag-based scope coupling

When the host skill represents a topic (`parenting`), name the
persistent-memory scope identically: `parenting`. The 1-to-1 mapping is
the simplest mental model.

When the host skill is generic (`relationship-coach`) but the user has
multiple relationship scopes (`relationship-anna`, `relationship-john`),
the host skill should accept a `subject` argument and pass it through:

```markdown
## Persistent Context

If invoked with a `subject` argument (e.g. `anna`), run
`Skill("persistent-memory", "read relationship-<subject>")`. Otherwise
ask the user which subject this conversation is about before proceeding.
```

## Pattern B — SessionStart hook (opt-in, advanced)

A SessionStart hook auto-loads a configured INDEX into every session.
Use this **only** when the user explicitly wants always-on context for
a small number of scopes (e.g. a personal-assistant scope).

Steps (the user must opt in deliberately):

1. Pick scope names that should auto-load (cap: 2 — more than that
   bloats every session).
2. Add a SessionStart hook in `.claude/settings.json` (or
   `~/.claude/settings.json` for cross-project):

   ```json
   {
     "hooks": {
       "SessionStart": [
         {
           "command": "cat ~/.agent-memory/personal/INDEX.md ~/.agent-memory/parenting/INDEX.md"
         }
       ]
     }
   }
   ```

3. Re-confirm the cost: each INDEX runs about 50–200 lines. Two scopes
   could add ~400 lines of permanent context per session.

The skill itself does not install this hook automatically. The
documentation for `/update-config` covers hook installation; refer the
user there.

### When to choose hook over pointer

- The user wants a personal-assistant feel where memory is always
  present.
- There is one or two scopes that genuinely matter every session.
- The user has audited the INDEX size and is comfortable with the
  token spend.

If any of these conditions is uncertain, use pointer-based.

## Two-way handshake: write after a session

The pointer block also tells the host skill to call `write` at the
**end** of the conversation. Pseudo-flow:

1. Host skill starts.
2. Host skill calls `Skill("persistent-memory", "read <scope>")`.
3. INDEX content is now in context. Host responds to the user.
4. Conversation continues.
5. Before the host's final response, host calls
   `Skill("persistent-memory", "write <scope>")`.
6. `write` extracts candidates from the conversation, shows the
   preview, persists with user approval.

This is what makes the loop persistent: read at the start, write at
the end.

## When NOT to integrate

Some skills should never call `persistent-memory`:

- One-shot utilities (`changelog`, `resolve-conflicts`, `ci-auto-fix`)
  — they have no durable subject.
- Skills that operate on secrets or credentials (would risk routing
  them through extraction).
- Adversarial or audit skills that should not be biased by prior
  conversations.

If you are unsure whether a host skill should integrate, default to
**no**. Pointer can always be added later; removing context bias once a
host skill has read prior memory is harder.

## Verifying integration

After adding the pointer to a host skill, test it once:

1. Start a fresh conversation.
2. Invoke the host skill on a topic that has at least one memory entry.
3. Confirm the model references the memory in its response.
4. Confirm that `write` runs at the end and surfaces the candidate
   preview.

If either step fails silently, the pointer was not loaded — re-read
the host SKILL.md and confirm the block is above any conditional or
mode-detection logic.
