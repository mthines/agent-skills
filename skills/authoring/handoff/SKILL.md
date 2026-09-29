---
name: handoff
description: >
  Distills the current session's task, context, and plan into a clean,
  copy-pasteable markdown handoff document for another agent or LLM to pick up.
  Captures the goal, current state, remaining plan, and the key files,
  decisions, and gotchas — and leaves out conversational noise, tool-call
  transcripts, and dead ends. Writes to `.agent/{branch}/handoff.md` and copies
  it to the clipboard. Use when continuing work in a fresh session, passing a
  task to a teammate's agent, or briefing a different model. Invoke with
  /handoff; add a focus phrase to scope the handoff, or --brief for a condensed
  version.
argument-hint: '[focus phrase] [--brief]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: scaffolder
  tags:
    - handoff
    - context-transfer
    - session-continuation
    - agent-to-agent
    - portable-context
    - briefing
    - plan
    - markdown
    - clipboard
---

# Handoff

Distill everything a fresh agent or LLM needs to continue this work — and
nothing it doesn't — into a single self-contained markdown document, written to
`.agent/{branch}/handoff.md` and copied to the clipboard.

The reader has **zero** conversation history. Write for that reader: an LLM
picking this up cold, with no access to this chat, these tool results, or your
scratch reasoning. Front-load the goal, name every file and command explicitly,
and resolve every pronoun.

## Workflow

1. **Parse the invocation.** A free-text focus phrase (e.g. `/handoff the auth
   refactor`) scopes the handoff to one thread of work — include only material
   on that thread. `--brief` produces a condensed version: Goal + Next steps +
   top 3 files only. Default is the full document. State the chosen scope in one
   line before writing.
2. **Gather the material** from this session into the five section buckets
   below (Goal, Current state, Plan, Key files, Decisions & gotchas). Pull from
   what actually happened — files edited, commands run and their results,
   decisions made — not from what was merely discussed.
3. **Curate.** Apply the Include / Exclude table. When unsure whether a detail
   earns its place, ask: *would the next agent make a wrong move without it?* If
   no, cut it.
4. **Resolve the output path.** Run `git rev-parse --abbrev-ref HEAD` for the
   branch. Write to `.agent/{branch}/handoff.md` (create the directory). If the
   cwd is not a git repo, fall back to `.agent/handoff.md`, and if `.agent/` is
   not writable, fall back to the scratchpad directory — report which path was
   used.
5. **Write the file** from [`templates/handoff.template.md`](./templates/handoff.template.md),
   filling every section. Omit a section entirely (heading and all) only if it
   is genuinely empty — never leave a placeholder or a "TODO" in the output.
6. **Copy to clipboard.** Pipe the file to `pbcopy` (`pbcopy < <path>`). If
   `pbcopy` is absent (non-macOS or not on `PATH`), skip it and say so in
   the report — the file is the primary artifact; the clipboard is a
   convenience.
7. **Report.** Print the resolved path, whether the clipboard copy succeeded,
   and the section count. Do not dump the whole document back into the chat — a
   one-line pointer plus the path is enough.

## What goes in each section

| Section | Include |
| --- | --- |
| **Goal** | The one-line objective and what "done" means (the acceptance criteria). |
| **Current state** | What is finished and verified, what is in progress, what is blocked. Mark claims `verified` vs `assumed`. |
| **Plan / next steps** | The remaining work, ordered, actionable — each step something the reader can start. |
| **Key files** | Every file the work touches, with its role and what changed. Repo-relative paths. |
| **Decisions & gotchas** | Decisions and their rationale (and rejected alternatives), plus constraints, non-obvious dependencies, and traps. |

## Include / Exclude

| Include | Exclude |
| --- | --- |
| The goal and acceptance criteria | Chit-chat, restated requirements, meta-commentary about the conversation |
| Decisions **and their rationale** | Verbose reasoning chains that led to a settled decision |
| Files, functions, and exact commands | Full tool-call transcripts and raw command dumps |
| Dead ends **only if instructive** ("X doesn't work because Y") | Every abandoned attempt |
| How to build / test / run | Anything the reader can discover trivially from the repo |
| Constraints and gotchas | Secrets, tokens, credentials, API keys — **never** write these to the file |

## Examples

### Good — a next step the reader can act on

```markdown
## Plan / next steps
1. Add a `--brief` branch to `src/cli.ts:parseArgs` — mirror the existing
   `--json` flag handling at line 42. Covered by `tests/cli.test.ts`.
2. Run `pnpm test` and confirm the 3 new brief-mode assertions pass.
```

### Bad — vague, assumes shared context

```markdown
## Plan / next steps
1. Finish the thing we discussed.
2. Fix the other bit and make sure it works.
```

## Anti-patterns (one-liners)

- Dumping the raw conversation instead of curating it.
- Pronouns with no antecedent ("it", "that", "the thing we changed").
- Writing secrets, tokens, or credentials into the file.
- Leaving `TODO` / placeholder text in a section instead of omitting it.
- Echoing the full handoff back into the chat instead of pointing to the file.

## Definition of done

- [ ] Scope stated (full / focused / `--brief`) before writing.
- [ ] Output path resolved from the git branch, directory created, path reported.
- [ ] Every non-empty section filled from what actually happened this session.
- [ ] No secrets, no placeholders, no raw tool transcripts in the file.
- [ ] Clipboard copy attempted; success or graceful skip reported.
- [ ] One-line pointer (not the whole document) returned to the user.
