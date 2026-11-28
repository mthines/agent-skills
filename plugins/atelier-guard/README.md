# atelier-guard

Claude Code hooks that keep an `/atelier` session from moving past unresolved review threads.
The hard gate lives in atelier's scripts (`state.mjs` refuses Ready `proceed` without clear thread evidence, `merge-gate.mjs` refuses open threads); these hooks steer the session and catch threads that open after Ready.

## Install

```bash
claude plugin marketplace add mthines/agent-skills
claude plugin install atelier-guard@agent-skills-plugins
```

It needs the `prepare` skill installed (`PREPARE_DIR`, `~/.claude/skills/prepare`, or `~/.agents/skills/prepare`) with `scripts/threads.mjs`, and an authenticated `gh`.
Without either, every hook stays silent.

## Hooks

Every hook acts only in a session that started `/atelier`: a prompt that starts with `/atelier` (not `/atelier setup`), or the Skill tool running `atelier`, writes a marker at `${ATELIER_GUARD_DIR:-~/.claude/state/atelier-guard}/<session_id>.json`.
Markers older than 7 days are pruned.

| Event | Does |
| --- | --- |
| `UserPromptSubmit` | `/atelier [<pr-url>]` → writes the marker and adds the PR's `THREADS:` and `CI:` lines plus the rule "never record Ready proceed with open threads" to context |
| `PreToolUse` on `Skill` | `atelier` → writes the marker |
| `PreToolUse` on `Bash` | `gh pr merge`, `gh api -X PUT …/pulls/<n>/merge`, or `state.mjs --record --stage ready --decision proceed` while threads are open → denied with the threads named; allowed ones are remembered. A Merge `proceed` record is never denied: it is written after the merge |
| `Stop` | the session allowed a Ready `proceed` or a merge and threads are open now → blocks once; never when `stop_hook_active` |

A lookup that fails (GitHub down, a timeout, no `prepare` skill) allows the action and prints nothing.

## Test

```bash
node plugins/atelier-guard/bin/guard.mjs --self-test
ATELIER_GUARD_THREADS_FIXTURE=open node plugins/atelier-guard/bin/guard.mjs --event UserPromptSubmit <<< '{"session_id":"s","prompt":"/atelier https://github.com/o/r/pull/1"}'
```
