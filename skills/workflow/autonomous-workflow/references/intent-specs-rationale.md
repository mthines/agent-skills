# Intent specs — why the route is flexible and the outcome is not

The rules live in [`spec-run-contract.md § 6`](../rules/spec-run-contract.md#6-intent-specs) and the format in [`intent-spec.md.template`](../templates/intent-spec.md.template).
This file records why they are shaped the way they are.

## The problem a step-exact grammar has

A WHEN/THEN spec pins every click to a locator the author guessed from the diff, before the app was ever opened.
Most of the friction the runners record is about that route, not about the change:

- a test id that differs from the one the source suggests (`card panel` rather than `panel`);
- a section that renders collapsed, so its contents are hidden until it is opened;
- an entry point that needs a toggle first, or a label that changes with the record's state;
- a name shared by two controls, so the locator resolves to the wrong one.

Each of these fails a spec whose change works.
An agent that reads the page and works out the route from intent passes all of them.

## The problem a free-form "try to do this" has

Two recorded failures run the other way: a spec **completed** and proved nothing.

- A spec clicked the first element with a shared test id; the element the diff changed was the second. Every assertion passed against the wrong element.
- A spec asserted that a new widget kind appeared in the picker. That proves a feature flag is on, not that the widget renders.

A runner given more freedom makes this failure more likely, not less, because "I finished" is easy to reach by a route that never touches the change.
So freedom is granted on the route only, and three things stay strict:

1. **`[must-follow]` steps.** When the change *is* the path — a new button, a new entry point — taking another route is not a heal, it is a missed regression. The author marks the step that exercises the change, and deviating from it fails.
2. **`**Expected:**` items, with evidence.** An outcome counts only with a locator, network, text, or (for layout) image line behind it. "Looked fine" is not evidence.
3. **The `**Changed:**` target.** The run must interact with or observe the thing the diff touches; evidence on a sibling instance is `not-observed`.

Deviations on guidance steps are reported, never failed, so a reviewer still sees when the app's route differs from the author's.

## Why `unreachable` is a closed list

The easiest way for a flexible runner to avoid a red verdict is to call a failure "unreachable".
The list is closed — auth, a named feature flag, named seed data, an environment fault outside the change, the action budget, and UI a performed mutation left open that a re-launching runner cannot reach again — so every other inability to observe an outcome is a fail.
The last cause is a limit of the Playwright runner's re-launching probe, named on its own so a reader can see it and re-run that spec with the Chrome driver, which never restarts the page.
This keeps `inconclusive` meaning "could not be checked here", never "probably broken".

## Why the grammar stays, as the compiled form

Playwright's agents split the same way: the planner writes a Markdown plan with separate steps and expected results, the generator turns it into an executable test while checking locators live, and the healer repairs a failing test — patching locators, waits, or data — and skips it rather than forcing a pass when the feature itself looks broken.

The WHEN/THEN grammar is already an executable, deterministic form that both runners parse, so it is the natural target for the generator step.
A passing exploration compiles to a grammar block; the next run replays it (cheap, deterministic, the same route every time) and explores again only when the replay fails.
That gives the repeatability a convergence loop needs without making the author predict locators, and it means no new executable syntax exists — the intent format compiles to the grammar rather than competing with it.

## Why the cache key is a hash of the spec text

A route is valid only for the spec that produced it.
Hashing the spec's own block makes an edited spec a cache miss with no bookkeeping, and an unedited spec against a changed app falls through replay into a heal.
The cache lives in the worktree's gitignored `.agent/`, so it never becomes a second source of truth that outlives the spec it was compiled from.

## Why the action budget

Exploration with no bound turns a missing element into an open-ended search.
Twenty-five actions per spec covers the observed specs — one to three behaviours, a handful of steps each, a few detours — and turns a runaway search into an honest `unreachable: explore budget exhausted` instead of a guess.
