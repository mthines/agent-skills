## Persistent Context

Before responding, run `Skill("persistent-memory", "read <scope>")`
to load accumulated memory for this scope. The returned INDEX surfaces
the relevant entries; load individual entries on demand only.

At the end of the conversation, if any durable fact emerged (a
preference, a routine, a decision, a relationship detail), run
`Skill("persistent-memory", "write <scope>")`. The write pipeline
will preview the candidate list before persisting — do not skip the
preview.

If the scope is parameterised by a subject (e.g. the host skill is a
generic `relationship-coach` and the user has multiple subjects), pass
the subject through as part of the scope name (e.g. `relationship-anna`).
