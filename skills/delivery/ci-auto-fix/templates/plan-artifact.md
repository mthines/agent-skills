# ci-auto-fix run — <branch> — iteration <N>

## Failure

- Workflow / job / step: <names>
- Run URL: <https://github.com/owner/repo/actions/runs/...>
- Verdict: <code-bug | workflow-bug | dep-bug | env-bug>
- Root cause (one sentence): <…>
- Files touched by the proposed fix: <list>

## Proposed fix

<diff sketch or one-paragraph description>

## Confidence

- Score: <0–100>
- Risk tag: <workflow-touch | prod-code-touch | lockfile-touch>
- Action: <auto-apply | ask-once | escalate>
- Escalation reason: <one sentence — fill in only when Action is `escalate`>

## Iteration <N> — <result>

- Outcome: <green | same-failure | subset | regression-reverted>
- New run URL: <…>
- Notes: <…>
