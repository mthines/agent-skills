# Plan: create automation card above the follow-up steps

<!-- Fixture: the Requirements, Guardrails, and Acceptance Criteria lines of the real /aw brief behind
     dash0hq/dash0#29652, which names its flag only in AC-5 and AC-6; plus the legacyCart guardrail that
     must not prefill. tick.mjs --self-test and the aw checks read it. -->

## Task

Show a "Create automation" card above the "Next steps" suggestions; it ships dark behind the existing convert-thread-to-automation flag.

## Requirements

1. A "Create automation" card is shown above the follow-up steps when a thread completes successfully — [user-stated] — ticket AC 1.
4. The card is gated behind the existing feature flag of the convert-thread-to-automation capability — [user-stated] — ticket notes + request ("gate the card behind the existing flag").
5. The PR body carries a `<!-- deployment-verify:v1 -->` contract naming the flag — [user-stated] — request.

## Guardrails

- Never: merge the PR or mark it ready for review — the user.
- Keep unchanged: the `agent.suggested_prompt.use` event and the suggestion rows — ticket: "related measurement ticket" relies on them.
- Leave the code behind the `legacyCart` flag untouched — the user.

## Acceptance Criteria (Definition of Done)

- [ ] AC-1 (covers: R1, R4) [ui:/agent0] — When a chain has completed with follow-up suggestions and the flag is on, the system shall render a "Create automation" card before the "Next steps" list; with the flag off, or while the chain is still loading or errored, it shall not.
- [ ] AC-3 (covers: R3) [api:POST /api/automations] — When the create form is submitted from a definition the card stashed, the system shall emit `automation.create_form.submitted` with `entryPoint: "agent0_thread"`.
- [ ] AC-4 telemetry: (covers: R3) `automation.create_form.submitted` web event from `dash0-ui` carries `entryPoint = agent0_thread` after a creation from the card.
- [ ] AC-5 (covers: R4) — The browser shall read `enableAutomationProposeFlow` (seeded through `UI_EXTRA_FLAG_KEYS`), and the card shall read that flag.
- [ ] AC-6 (covers: R5) — The PR body shall contain a `deployment-verify:v1` contract whose `flag.key` is `enableAutomationProposeFlow`.

## Turn Cap

30 turns.
