# <Flow name>

> One-line summary of the user-visible outcome.
> Example: "A signed-in user can create a project from the dashboard and
> see it in the sidebar after a refresh."

## Goal

<One sentence. Phrase as a user-facing outcome, not an implementation detail.>

## Preconditions

- Signed in as: <role / user fixture>.
- Seeded data: <fixtures or factories that must exist>.
- Feature flag: <name = state>, or "none".
- Starting URL: <path>.

## Flow

1. <User action — imperative, one action per step>.
2. <User action>.
3. <User action>.
4. ...

## Assertions

- <Observable outcome — what the user sees, not what the code does>.
- <Network call expected, if user-visible (e.g. "PDF downloads")>.
- <Persisted state visible after refresh, if applicable>.

## Out of scope

- <What this spec deliberately does not cover>.
- <Edge cases pushed to a separate spec>.
- <Lower-layer concerns delegated to unit / component tests>.

## Notes for the Generator

- Locator preference: `getByRole` > `getByLabel` > `getByTestId`.
- Reuse `storageState` from `tests/seed.spec.ts` — do not re-implement auth.
- One assertion per assertion line above.
