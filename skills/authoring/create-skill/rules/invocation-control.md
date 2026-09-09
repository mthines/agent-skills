---
title: Invocation Control — Who Can Trigger This Skill
impact: HIGH
tags:
  - invocation
  - frontmatter
  - slash-command
  - permissions
---

# Invocation Control

By default, both the user and the model can invoke any skill. Two
frontmatter fields restrict that.

## Contents

- The matrix
- When to set `disable-model-invocation: true`
- When to set `user-invocable: false`
- When to leave both at their defaults
- `allowed-tools`
- `paths` — auto-load only on relevant files
- `model` and `effort` — per-skill overrides
- `context: fork` and `agent`
- `disallowed-tools`
- Where skills load from
- `skillOverrides`
- Decision matrix

## The matrix

| Frontmatter                       | User can `/invoke` | Model auto-loads | Description in always-loaded context |
| --------------------------------- | ------------------ | ---------------- | ------------------------------------ |
| (default)                         | Yes                | Yes              | Yes                                  |
| `disable-model-invocation: true`  | Yes                | No               | **No**                               |
| `user-invocable: false`           | No                 | Yes              | Yes                                  |
| Both flags `true` / `false`       | No                 | No               | (skill is unreachable — don't do this) |

## When to set `disable-model-invocation: true`

Use this for **slash commands** — workflows the user controls the timing of:

- Side-effectful actions (`/deploy`, `/commit`, `/send-slack-message`).
- Workflows where you do not want Claude to "decide it's time" (e.g.
  `/create-pr` should fire when the user says so, not when the diff
  *looks* ready).
- Workflow companions called by another skill via `Skill()`. The model
  doesn't pick these directly; the orchestrator does.

**Bonus benefit:** zero baseline context cost. The description is *not*
loaded into the always-on metadata block, so a slash-only skill costs the
context window nothing until invoked.

Trade-off: the user has to know the skill exists. Document it in
`README.md` and `CLAUDE.md` so it's discoverable.

## When to set `user-invocable: false`

Use this for **background-knowledge skills** — knowledge the model should
have available but isn't an action the user would type:

- `legacy-system-context` explaining how an old subsystem works. Claude
  applies it when relevant; `/legacy-system-context` isn't a meaningful
  command.
- A glossary the model consults when domain-specific terms appear.

**Trade-off:** the skill cannot be invoked by the user even with `/`. If
you want the user to also have access, leave this default (`true`).

## When to leave both at their defaults

The skill is reasonably autonomous and useful in both directions:

- Advisory skills (`code-quality`, `tdd`, `ux`, `dx`, `holistic-analysis`).
- Orchestrators with no destructive side effects until the user approves.

This is the most permissive setting. The model auto-loads when relevant,
the user can also `/invoke` it.

## `disallowed-tools`

```yaml
disallowed-tools: Bash(rm *) Bash(git push *)
```

`disallowed-tools` **removes** tools from the active set while the skill
runs — the opposite of `allowed-tools`, which only pre-approves. Use it to
hard-block a dangerous action a skill should never take (a read-only
advisory skill removing `Edit`/`Write`, for example).

The restriction **clears on the next user message** — it does not persist
past the turn the skill was invoked for. It also cannot remove
`EndConversation` on its own; that tool always stays reachable.

## `allowed-tools`

`allowed-tools` is a permission grant, not a restriction:

```yaml
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *) Read Edit
```

While the skill is active, the listed tools run **without per-use approval
prompts**. Other tools still fall back to your default permission settings.

Use this for slash commands that hammer specific tools (e.g. a `/commit`
skill that runs `git add`/`git commit` repeatedly), and resist the urge
to broaden it. `Bash(* *)` defeats the safety net.

## `paths` — auto-load only on relevant files

```yaml
paths: ['**/*.tsx', '**/*.jsx', 'apps/web/**']
```

Restricts the **auto-load** trigger so the skill only fires when working
with files matching the pattern. Has no effect on user `/invoke`.

Useful for:

- A React-specific skill that should not chime in on a Go file.
- A monorepo-package-specific skill scoped to one app's directory.

## `model` and `effort` — per-skill overrides

```yaml
model: opus
effort: high
```

Apply only for the duration of the skill's turn; revert to the session
defaults afterwards. Overrides are not saved to settings.

Use sparingly. Overriding to a stronger model in every skill defeats the
point of the session model.

## `context: fork` and `agent`

```yaml
context: fork
agent: Explore
```

Runs the skill in a **forked subagent** with no conversation history. The
skill content becomes the subagent's prompt. Best for:

- Read-only research (`agent: Explore`).
- Long reasoning that should not pollute the main thread (`agent: Plan`).
- Multi-step tasks where the result, not the trace, is what you want back.

If you set `context: fork`, your `SKILL.md` body **is** the prompt — write
it as actionable instructions, not as advisory background. A skill that
just says "use these conventions" returns nothing useful from a forked
context.

`background` (default `true`) only applies alongside `context: fork`.
Claude still waits on the forked skill instead of backgrounding it when:
running non-interactively (`-p`), `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`
is set, the same skill is already running, or the invocation is a
scheduled task. In those cases the forked context also gets a narrower
tool set and can edit files outside the normal checkpoint boundaries —
treat `background` as an optimisation the runtime is free to override, not
a guarantee.

## `disallowed-tools`

```yaml
disallowed-tools: Bash(rm *) Bash(git push *)
```

`disallowed-tools` **removes** tools from the active set while the skill
runs — the opposite of `allowed-tools`, which only pre-approves. Use it to
hard-block a dangerous action a skill should never take (a read-only
advisory skill removing `Edit`/`Write`, for example).

The restriction **clears on the next user message** — it does not persist
past the turn the skill was invoked for. It also cannot remove
`EndConversation` on its own; that tool always stays reachable.

## Where skills load from

Skills resolve from several locations, in precedence order (highest wins
on a name collision):

| Location                | Path                                       | Scope                          |
| ------------------------ | -------------------------------------------- | ------------------------------- |
| Enterprise               | Managed enterprise policy directory          | Every user in the organization  |
| Personal                 | `~/.claude/skills/<name>`                    | This user, every project        |
| Project                  | `.claude/skills/<name>` in the repo          | This repo only                  |
| Nested (monorepo)        | `.claude/skills/<name>` in a subpackage      | That subpackage's working dir   |
| `--add-dir`              | An explicitly added directory                | The current session only        |
| Plugin                   | Namespaced under the plugin's own name       | Wherever the plugin is enabled  |

Name resolution: a more specific location shadows a less specific one that
declares the same `name`, and a plugin-provided skill is namespaced
(`<plugin>:<name>`) so it never collides with a same-named personal or
project skill.
The folder name `synced` is **reserved** for synced-skill placeholders —
do not name a skill directory `synced`; a skill placed there will not
resolve as expected.

## `skillOverrides`

A consumer-side kill switch, set outside the skill itself (repo or user
settings), that overrides a skill's own invocation flags: `off` (skill
unreachable), `user-invocable-only` (equivalent to forcing
`disable-model-invocation: true`), `name-only` (visible in the `/` menu but
the description is dropped from the always-loaded listing), or `on`
(restores the skill's own declared flags). Document this for skills you
expect a consuming team to want to silence.

## Decision matrix

| Goal                                                | Setting                          |
| --------------------------------------------------- | -------------------------------- |
| Side-effectful workflow the user controls            | `disable-model-invocation: true` |
| Workflow companion called by another skill           | `disable-model-invocation: true` |
| Background knowledge the model applies silently      | `user-invocable: false`          |
| Advisory or composable skill, both can invoke        | (defaults)                       |
| Read-only research without conversation pollution    | `context: fork`, `agent: Explore` |
| Long forked task that should not block the session   | `context: fork`, `background: true` (default) |
| Limit auto-load to a specific file scope             | `paths: [...]`                   |
| Pre-approve tools so the skill runs without prompts  | `allowed-tools: ...`             |
| Hard-block a dangerous tool for this skill's turn    | `disallowed-tools: ...`          |
| Silence or restrict a skill from outside its own file | `skillOverrides` (consumer-side) |
