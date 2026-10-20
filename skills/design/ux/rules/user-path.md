# Pass 1 — The user's path

Run this pass first on every audit and on every existing surface a plan touches.
It finds the findings that change outcomes: broken flows, controls that do the wrong thing, and dead ends.
**Why:** [`../references/path-first.md`](../references/path-first.md).

## 1. Name the job and the task

Write two sentences before reading for defects:

```text
Job:  The page exists so a new visitor installs the CLI and sends a first event.
Task: Copy the install command → run it → paste a token → see the first event.
```

When the page serves several tasks, name the primary one and audit it first.

## 2. Walk the task in the code

Trace each step from the entry route to the screen after success.
Read the component, its handlers, the hooks and stores they call, the route definitions, and the API calls.
At each step, answer: what does the user see, what can they do, and where does it take them?

Flag any step the user cannot complete with what the page gives them:

```text
✗ "Run the installer" is step 1; the installer blocks on a token; the token is only shown in Settings, which the page never links.
✓ Step order matches what each step needs; every input the user must supply is reachable from the step that asks for it.
```

## 3. Verify what each control does

For every control on the path, read its handler and compare the effect with the label, icon, and surrounding copy.

| Check | Read |
| --- | --- |
| Effect matches label | the handler body, not its name |
| State change | the setter, reducer, or store action it calls |
| URL and history | `push` vs `replace`, query-param sync, back-button result |
| Data flow | which request fires, what it filters, what the count or result reflects |
| Keyboard path | `onKeyDown` / `Enter` / `Escape` branches — they often diverge from the click path |
| Toggles and re-selection | what happens when the user selects an already-selected value |

Flag behaviour that contradicts the UI:

```tsx
// ✗ The chip looks like "add filter"; Enter on an applied value removes it.
onKeyDown={(e) => e.key === 'Enter' && toggle(value)}

// ✓ Enter adds; removal has its own explicit control.
onKeyDown={(e) => e.key === 'Enter' && add(value)}
```

Also check: counts that do not match what the filter mode means ("includes all", "is not"), search that silently returns nothing for valid input, and controls that update the view but skip the URL.

## 4. Cover every state

| State | Question |
| --- | --- |
| First run / empty | Does the user see why it is empty and the one action that fills it? |
| Loading | Is there a placeholder shaped like the content, and is the trigger disabled against double submit? |
| Stale / refetching | When inputs change, does old data sit under a new caption (`keepPreviousData`, cached query) without a marker? |
| Error | Does the user see what failed and a retry, with their input preserved? |
| Partial / truncated | Is a row, page, or result limit visible to the user, or silent? |
| Success | Does the user see confirmation and the next step? |

## 5. Check the activation path

Find the call to action that moves the user to the next stage (install, connect, invite, upgrade, next page).
Confirm the target exists, is reachable, and gives the user everything the next stage requires.
Flag dead UI: cards, links, or components that render but lead nowhere or are never mounted.

## 6. Record what works

List the patterns that already serve the task well; the report keeps them in **What works (keep)** so a fix does not regress them.
