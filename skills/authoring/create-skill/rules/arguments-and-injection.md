---
title: Arguments and Injection — Substitutions and Dynamic Context
impact: HIGH
tags:
  - arguments
  - substitutions
  - dynamic-context
  - injection
---

# Arguments and Injection

Two independent mechanisms feed runtime data into a skill body: **string
substitutions** (static text swapped in before the model sees the prompt)
and **dynamic context injection** (shell commands run before the model
sees the prompt, whose output is substituted in). Neither runs Claude —
both happen at invocation time.

## String substitutions

| Token                        | Expands to                                               |
| ----------------------------- | --------------------------------------------------------- |
| `$ARGUMENTS`                 | The full argument string the user typed after the skill name. |
| `$ARGUMENTS[N]`               | The Nth argument of `$ARGUMENTS` (0-indexed, shell-style quoting applies). |
| `$0`, `$1`, …                 | Positional shorthand, equivalent to `$ARGUMENTS[0]`, `$ARGUMENTS[1]`, … |
| `$<name>`                     | A named argument declared in frontmatter `arguments:` (e.g. `arguments: target` → `$target`). |
| `${CLAUDE_SESSION_ID}`        | The current session's ID.                                |
| `${CLAUDE_EFFORT}`            | The effort level in force for this turn.                 |
| `${CLAUDE_SKILL_DIR}`         | This skill's own directory — use for any path inside the skill (bundled script, template). |
| `${CLAUDE_PROJECT_DIR}`       | The repo root of the current project.                    |
| `${CLAUDE_PLUGIN_ROOT}`       | The installing plugin's root, when the skill ships as a plugin. |
| `${CLAUDE_PLUGIN_DATA}`       | The plugin's writable data directory.                    |

**Missing argument:** the three cases behave differently, so handle each
one explicitly rather than assume the argument was supplied.

| Case                                                | Result                                              |
| --------------------------------------------------- | --------------------------------------------------- |
| Indexed placeholder (`$2`) with no matching input    | Stays as the literal text `$2`.                     |
| Named placeholder (`$target`) with no matching input | Expands to an empty string.                         |
| Input given but no placeholder consumes it           | `ARGUMENTS: <input>` is appended to the skill body. |

**Quoting:** shell-style quoting applies — `/my-skill "hello world" second`
gives `$0` = `hello world` and `$1` = `second`.

**Escaping:** a single backslash directly before a token suppresses it
(`\$1` stays `$1`); a doubled backslash does not (`\\$1` keeps one
backslash and substitutes). A backslash before any other `$` is left
unchanged, and `${CLAUDE_*}` variables substitute even when escaped.
Use the single-backslash form when documenting the syntax itself (as this
file does).

### Good

```yaml
argument-hint: '<target-branch> [--dry-run]'
arguments: target_branch
```

```markdown
Merge into \$target_branch (escaped here to document the token itself;
in the live body write `$target_branch` unescaped) — falls back to
`main` if the argument is empty.
```

### Bad

```markdown
Merge into $1.
```

Why bad: no fallback for a missing argument, and an unnamed positional
forces the reader to count argument order instead of reading a name.

### `argument-hint` ↔ `arguments` design rule

Name positional arguments (`arguments: target_branch base_branch`) once
there are **2 or more**, or whenever argument order is easy to confuse
(a `<from> <to>` pair reads ambiguously as `$0 $1`). A single unambiguous
argument can stay positional (`$0`).

## Dynamic context injection

Two forms run a shell command **before** the prompt is sent, substituting
its stdout into the body:

```text
Current branch: !`git branch --show-current`
```

````text
Open PRs:
```!
gh pr list --state open
```
````

Both forms share the same semantics:

- **Run-before-send, single pass.** The command runs once, when the skill
  is invoked; its output is frozen into that turn's prompt. It does not
  re-run later in the same conversation.
- **Non-zero exit aborts the invocation.** A failing injected command
  stops the skill before the model sees anything. Append `|| true` to
  recover and continue with empty output when a non-zero exit is an
  expected outcome (e.g. `git diff --quiet || true` to tolerate "no
  diff").
- **2-minute timeout.** A long-running injected command is backgrounded
  or killed — do not inject anything that can legitimately take longer
  (dispatch a script from the body instead, via `Bash`). stderr is merged
  into stdout, and output past the inline ceiling arrives as a file path
  plus preview rather than being truncated.
- **`allowed-tools` pre-approves** the underlying tool so the injected
  command does not stop for a permission prompt on every invocation.
- **`disableSkillShellExecution`** (a settings-level control) disables
  dynamic context injection entirely for a given install — a skill that
  relies on it should degrade gracefully (state the fallback) rather than
  assume the injection always runs.
- **Synced skills** (enabled on claude.ai and synced into
  `~/.claude/skills/synced/`, see `invocation-control.md`) never run
  injected commands on the local machine — the placeholder is replaced
  with `[shell command execution disabled by policy]` or similar text, so
  a synced skill must not depend on injection for correctness.
- Use `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PROJECT_DIR}` for any path inside
  an injected command so it resolves the same way regardless of the
  caller's working directory.

### Good

```text
Lint status: !`cd ${CLAUDE_PROJECT_DIR} && npm run lint --silent || true`
```

Recovers cleanly when lint fails or is not configured, and resolves the
project root explicitly rather than assuming the invocation's cwd.

### Bad

```text
Lint status: !`npm run lint`
```

Why bad: a non-zero lint exit aborts the whole skill invocation instead of
surfacing "lint failed" as information the body can act on, and a relative
path breaks when the skill is invoked from a different cwd.
