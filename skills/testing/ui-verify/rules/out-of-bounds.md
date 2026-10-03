---
title: Out-of-bounds brainstorm — PR-scoped edge-case specs written at author time
impact: HIGH
tags:
  - ui-verify
  - out-of-bounds
  - edge-cases
  - ideation
  - sub-agents
---

# Out-of-bounds brainstorm

`author` writes the happy-path specs a reviewer would click through.
This step adds the specs for a user who leaves that path while the changed component is waiting on something: they ignore it, dismiss it, reload, come back later, or act on it from a second tab.
It runs inside `author`, at the top level of the session, where a sub-agent can still be dispatched.
`run` only executes the specs it writes — it never brainstorms, because its adversarial pass already runs inside a sub-agent.
Why it is shaped this way: [`../references/out-of-bounds-rationale.md`](../references/out-of-bounds-rationale.md).

## Contents

- [When it runs](#when-it-runs)
- [Step 1: Find the pending states](#step-1-find-the-pending-states)
- [Step 2: The baseline moves](#step-2-the-baseline-moves)
- [Step 3: Generate](#step-3-generate)
- [Step 4: Judge and select](#step-4-judge-and-select)
- [Step 5: Write each selected idea as an intent spec](#step-5-write-each-selected-idea-as-an-intent-spec)
- [Step 6: Report](#step-6-report)
- [Hard rules](#hard-rules)

## When it runs

Read the rows in order; the first row whose condition holds decides the mode.

| # | Condition | Mode | Report line |
| --- | --- | --- | --- |
| 1 | `--no-brainstorm` was passed | `skipped` | `brainstorm: skipped (--no-brainstorm)` |
| 2 | The block is a lifted grammar block (`<!-- ui-verify:v1 -->`, from the planner's `specs.md`) | `skipped` | `brainstorm: skipped (lifted grammar block — intent specs only)` |
| 3 | Step 1 finds no pending state in the diff | `skipped` | `brainstorm: skipped (no pending state in the diff)` |
| 4 | `--brainstorm deep` was passed, the `ideate` skill is installed, and some available tool dispatches a sub-agent | `deep` | `brainstorm: deep (ideate)` |
| 5 | Some available tool dispatches a sub-agent | `fan-out` | `brainstorm: fan-out (5 generators, 1 judge)` |
| 6 | Otherwise | `in-context` | `brainstorm: in-context (no sub-agent dispatch in this session)` |

When `--brainstorm deep` was passed but row 4 does not hold, the run takes row 5 or 6 and appends the reason to the report line: `brainstorm: fan-out (deep requested, ideate not installed)`.

**Dispatch is a capability, never a tool name.**
`Task` (Claude Code CLI), `Agent` (Claude Agent SDK), and `task` (OpenCode, Dash0 Agent0) are spellings of one capability: a tool that takes a sub-agent type.
Decide row 5 from your tool list, never by attempting a dispatch to see whether it fails.

```text
❌ WRONG — a name check; misses `Agent` and `task`, and a probe dispatch wastes a round trip
if "Task" not in available_tools: mode = "in-context"

✅ RIGHT
if any available tool dispatches a sub-agent (Task, Agent, task, or another spelling): mode = "fan-out"
```

`author` runs at the top level of the session in every normal entry point — a slash command, `create-pr` Step 6.4, `verify`, an Agent0 Automation's top-level session — so row 5 is the common case.
When `author` itself runs inside a dispatched agent (the `aw` Full-tier executor on a host that does not nest sub-agents), no dispatch tool is present and row 6 applies.

## Step 1: Find the pending states

A **pending state** is UI that waits — on the user or on the server — while the user could do something else.
Read the diff and list every pending state the changed component creates or shows:

| Kind | Recognise it in the diff by | Example |
| --- | --- | --- |
| Waiting on a user decision | a card, dialog, banner, or inline prompt with answer, confirm, approve, or dismiss controls; a status such as `pending`, `awaiting`, `paused`, or `suspended` | an agent's question card; a write approval |
| Unsaved input | a form, editor, inline field, or draft the change adds or edits | an inline rename field |
| In-flight operation | a submit, stream, upload, or long request with a loading or streaming state | a streaming chat reply |
| Temporary UI | a toast with an action, an undo window, a popover with controls | an "Undo delete" toast |
| Optimistic state | UI that updates before the server confirms | a row added before its `POST` returns |

Record each one as `surface · kind · how to reach it`.

**How to reach it must be deterministic.**
When a pending state appears only after a non-deterministic step — a model deciding to ask a question, a race — reach it through a seeded record named under `**Preconditions:**` instead.
A named seed that is missing grades the spec `skipped` (unreachable, seed data); a non-deterministic step that simply did not happen grades it `fail`.

```text
❌ WRONG — the pending state depends on what the model decides
1. Ask Agent0 a question vague enough that it asks a clarifying question.

✅ RIGHT
**Preconditions:**
- A seeded thread whose last turn is paused on an unanswered question
```

## Step 2: The baseline moves

Pair every pending state with each baseline move below.
These pairs are always candidates, so the common interruptions are covered even when no generator thinks of them; generators add moves beyond this table.

| Move | While the state is pending, the user… | Keep-going step |
| --- | --- | --- |
| `ignore` | uses the page's main control instead (sends a new message, starts another action) | the main control's next normal use |
| `dismiss` | closes it every way the UI offers: its close or dismiss control, Escape, a click outside | the page's main action |
| `reload` | reloads the page | resolve the pending item if it is shown, else the page's main action |
| `leave-and-return` | goes to another page or record, then comes back (in-app link, then Back) | resolve the pending item, else the main action |
| `second-tab` | opens the same URL in a second tab, resolves the item there, then returns to the first tab | act on the item in the first tab |
| `refused-next` | takes a next action the server refuses through the page alone — an invalid value, a conflicting setting — then retries a valid one | the valid retry |

**Every move must run on both drivers.**
A spec acts through the page alone: no network interception, no offline mode, no clock or storage control — the Chrome driver has none of them, and `run --driver auto` picks Chrome when it is connected. The adversarial pass's `network`, `session`, and `data` categories already cover those disruptions under Playwright.

**Every out-of-bounds spec ends with a keep-going step.**
The interruption itself usually looks fine; the dead end shows only when the user tries to carry on.

## Step 3: Generate

Fill this framing and send it verbatim to every generator:

```text
The pull request changes <the changed component, as a user sees it>. While <the pending state> is open, the app is waiting on <the user | the server>.
How might a user, or the environment, leave the intended path here, and what would show the app failed when the user tries to carry on?
```

Every idea uses exactly this format:

```text
### <title>
Move: <a baseline move name, or new>
Trigger: <the browser actions, in order, starting from the pending state>
Keep going: <the next action a user takes to continue>
Check: <what must be observable afterwards if the app is correct — one recovery outcome from Step 5>
```

### `fan-out` mode

Dispatch the five generators in **one message**, one persona each, 4 ideas each; then dispatch one judge (Step 4).
That is 6 dispatches in total — never more, and never a dispatch from a generator or the judge.

| # | Persona |
| --- | --- |
| 1 | a QA tester who looks for sequence breaks |
| 2 | a support engineer who reproduces "it's stuck" tickets |
| 3 | an SRE who thinks about partial failures between client and server |
| 4 | a keyboard and screen-reader user |
| 5 | a field worker on a flaky connection who switches between laptop and phone |

Use the host's generic sub-agent type: `general-purpose` in Claude Code, `general` on OpenCode and Dash0 Agent0.
Inline everything a generator needs — never a file path:

```text
<dispatch>(
  subagent_type: "<generic type>",
  description: "ui-verify out-of-bounds generator <n>",
  prompt: |
    You are <persona>. Do not call any tools; work only from this message. Generation only — do not evaluate or rank.
    <the filled framing>
    Pending states: <the Step 1 list>
    Baseline moves: <the Step 2 table>
    Diff excerpt (changed component only, at most 150 lines):
    <excerpt>
    Propose 4 ideas in exactly this format:
    <the idea format>
)
```

### `in-context` mode

No sub-agents.
Generate in two passes in this context: pass 1 speaks as personas 1–3, 4 ideas each; pass 2 speaks as personas 4–5, 4 ideas each, and proposes only what pass 1 has not said.
Then judge in a separate pass that begins by restating the Step 4 rubric.
The report names this mode, because the independence of five separate contexts is only simulated.

### `deep` mode

Invoke `Skill("ideate", "deep --no-framing <the filled framing> Every idea must use this format: <the idea format>")`.
Add every idea that cleared ideate's admission bar to Step 4's candidate list, next to the baseline pairs, and run Step 4 from the start — one judge, all four axes. ideate's own scores have no Checkability axis, so they never replace Step 4's.
Deep mode is opt-in: it dispatches far more sub-agents and takes far longer than `fan-out`.

## Step 4: Judge and select

First build the candidate list: write each Step 2 baseline pair in the idea format (`Move: <move>`), add the generators' ideas, and merge any two whose trigger and keep-going step are interchangeable — keep the clearer wording.
One judge — a fresh sub-agent in `fan-out` mode, a separate pass in `in-context` mode — scores every candidate 1–10 on each axis:

| Axis | Question |
| --- | --- |
| Likelihood | How likely is a real user or environment to do this? |
| Damage | If it breaks, how stuck or misled is the user? |
| Fit | Does it exercise the component this PR changed? |
| Checkability | Can its check be observed in the page, console, or network without knowing the product's intended design? |

The judge receives the ideas anonymized, shuffled, and trimmed to the idea format, and returns only the score table.
Then select:

1. Drop every idea with Checkability below 6 or Fit below 6, and every idea whose trigger needs network interception, offline mode, or clock or storage control.
2. Rank the rest by Likelihood + Damage, highest first.
3. Take at most 3, and at most one per move.
4. When nothing survives, write no out-of-bounds spec and report `brainstorm: 0 selected (<N> ideas, none checkable on this change)`.

## Step 5: Write each selected idea as an intent spec

An out-of-bounds spec is an ordinary intent spec — the same fields, no new syntax — with three conventions:

1. Its title starts with `Out of bounds:`.
2. Its plain steps reach the pending state; then the move is a `[must-follow]` step; then the keep-going step is a second `[must-follow]` step.
3. Every `**Expected:**` item is a recovery outcome from this table, made concrete for the change — never a design choice the author cannot know.

| Recovery outcome | Example `**Expected:**` item |
| --- | --- |
| The user can continue | A new message sent from the composer gets an agent reply, and no error message appears. |
| The pending item has one clear state | The question card either still accepts an answer, or shows as closed with no answer controls. |
| Nothing is lost silently | The text typed into the answer field is still there after the reload, or the page warned before leaving. |
| One action, one effect | Exactly one `POST /api/answers` is sent. |
| Views agree | After the reload, the card shows the same state it showed before the reload. |

```markdown
❌ WRONG — asserts a design choice, and stops at the interruption
## Spec 3: Out of bounds: dismiss the question
**Steps:**
1. Open the seeded thread.
2. [must-follow] Click Dismiss on the question card.
**Expected:**
- A toast says "Question dismissed".

✅ RIGHT
## Spec 3: Out of bounds: dismiss a pending question, then keep chatting
**Changed:** the question card in an Agent0 thread
**Start:** /agent0
**Preconditions:**
- A seeded thread whose last turn is paused on an unanswered question
**Steps:**
1. Open the seeded thread.
2. [must-follow] Dismiss the question card.
3. [must-follow] Type "Continue without that" in the composer and send it.
**Expected:**
- The question card either still accepts an answer, or shows as closed with no answer controls.
- The new message gets an agent reply, and no error message appears.
```

Number the out-of-bounds specs after the happy-path specs, so a block holds at most 3 happy-path specs and at most 3 out-of-bounds specs.
They are graded like every intent spec; a failing one is `red`, because the changed component leaves a user stuck off the happy path.

## Step 6: Report

`author` adds one line to its report: `brainstorm: <mode> — <N> ideas, <M> specs (<title>; <title>)`, or the `skipped` line from [When it runs](#when-it-runs).

## Hard rules

- **The brainstorm runs only in `author`** (including `verify`'s author step) — never in `run`, and never in the adversarial pass.
- **`fan-out` dispatches exactly 6 sub-agents** — five generators in one message, then one judge — and none of them dispatches.
- **Decide the mode from capabilities**, never from a tool name and never by attempting a dispatch.
- **Generators get no tools and no file paths**; the framing, the pending states, the baseline moves, and the diff excerpt are inlined.
- **At most 3 out-of-bounds specs, each ending in a keep-going step, each `**Expected:**` item a recovery outcome.**
- **Never ask the user a question** — `create-pr`, `review-loop`, and automations call `author` with nobody to answer.
- **Never reach a pending state through a non-deterministic step**; seed it under `**Preconditions:**`.
- **Every out-of-bounds spec acts through the page alone**, so it runs on both the Playwright and the Chrome driver.
