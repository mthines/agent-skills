# Interaction Autocapture (global listener, no per-button events)

Applies to `web` classifications from [`scope-detection.md`](./scope-detection.md).
Read it **before** [`frontend-rum.md`](./frontend-rum.md) Step 1: most "this button
needs an event" findings are answered here, with a test id instead of new
tracking code.

**The rule:** plain interactions (clicks on buttons, links, menu items, options)
are recorded by **one** global listener, never by an `onClick` that calls a
tracker. A new button ships with context for the listener, not with an event.
Per-element events are only for *outcomes* the listener cannot see (Step 4).

## Step 1: Find out whether autocapture already exists

Check the Observability Profile first (its `Interaction capture` line). If there
is no profile, look for, in this order:

1. A document-level listener registered once at the app root, typically
   `document.addEventListener("click", fn, true)` (capture phase, so handlers
   that call `stopPropagation()` cannot hide a click), mounted from the layout
   or an instrumentation component.
2. A vendor autocapture: PostHog (`autocapture`), Amplitude, Heap, or the
   `@opentelemetry/instrumentation-user-interaction` package.
3. Nothing. Go to Step 3.

Record what you found. If the listener is mounted only in some layouts or route
groups, say which ones: a button outside them is uncovered no matter what you
add to it.

## Step 2: Make the new element visible to it (the only code a button needs)

Autocapture reads the DOM, so coverage is a property of the markup:

- **Use a semantic, recognizable element.** `<button>`, `<a>`, `input[type=submit]`,
  or an element with `role="button|link|option|menuitem"`. A clickable `<div>`
  with an `onClick` is invisible to most listeners. Fix the element, do not
  add an event.
- **Give it a name.** A visible text label or an `aria-label`. Icon-only buttons
  with neither are usually dropped. Prefer the label the user would read,
  never a generated id.
- **Put a stable `data-testid` (or the repo's equivalent) on the feature
  container**, not on every button. The listener builds a path from the
  ancestors, so `["tracing", "list"]` plus the button text identifies the
  interaction. If the repo keeps a test-id catalog, add the id there so
  usages are searchable.
- **Keep customer data out of the capture.** Text, aria-labels and attributes
  are sent as written. If an element's label can contain customer data, use
  the repo's opt-out (a class name or `data-` attribute the listener
  ignores) instead of removing the element from capture.
- **Bounded text only.** Labels built from user input make the `text`
  attribute unbounded, which fails the cardinality row in
  [`audit-checklist.md`](./audit-checklist.md).

Do **not** add a tracker call to the click handler. It double-counts with the
listener and drifts from it over time.

## Step 3: When there is no autocapture, add one (once)

Propose it as its **own** change, never bundled into a feature diff, and name
the user-facing question it answers first ("which controls do people use, and
where do they stop"). Minimum shape:

- One capture-phase `click` listener on `document`, registered once in the
  root layout/provider, removed on unmount.
- Resolve the nearest interactive element from the event target
  (`closest()` or a parent walk) using the Step 2 element list.
- Send a single, centrally named event (for example `browser.mouse.click`) through
  the repo's existing tracker wrapper (`rum-tracking` owns the wrapper and
  naming), with: element text truncated to a fixed length, the ancestor test-id
  path, and the route. Skip the click when there is no path or no text,
  because an event nobody can interpret is noise.
- No field values, no `innerText` of containers, no full URL query.
- Sample or cap if volume matters. Clicks are the highest-volume event the
  product emits.

Delegate event naming, the schema entry, and the PII gate to
`Skill("rum-tracking", "implement", "<target>")`. This rule decides *that* a
global listener is the right tool; `rum-tracking` decides how it is built.

## Step 4: What autocapture cannot see (still needs an explicit event)

State this boundary in the report, so "autocapture covers it" is never a
blanket answer:

| Interaction | Autocapture sees it? | What to do |
| --- | --- | --- |
| Click on a button, link, menu item, option | Yes | Nothing, if Step 2 holds |
| A form **submit succeeded or failed** | No (it sees the click, not the result) | Explicit outcome event, or the error path from [`regression-signals.md`](./regression-signals.md) |
| Form field changes, selections inside custom widgets | No | A `submit` or `change` listener at the root, or an outcome event; never per field |
| Keyboard-only actions (shortcuts, Cmd+Enter, Enter in an input) | No | Explicit event, or add a `keydown` path to the global listener |
| Programmatic actions (a redirect, a dataset switch, a mutation completing) | No | Explicit event: it is an outcome, not an interaction |
| Hover, focus, scroll | No | Not tracked unless a question needs it |

A form is covered for *attempts* by the submit button's click and for
*outcomes* by one event on the success and failure branches. It is not covered
by one event per field.

## Step 5: Feed the regression-signal check

An autocaptured click stream still needs a reader. Name the detector per
[`regression-signals.md`](./regression-signals.md): usually a funnel or a
dashboard panel filtered by the container's test-id path. A panel that watches
`path = ["checkout", "payment"]` going quiet after a release is the regression
signal for a button that stopped rendering or stopped working.

## Anti-patterns

- Adding `trackClick("save-clicked")` to a handler the global listener
  already captures.
- Putting a `data-testid` on every button instead of on the feature container.
- Claiming a clickable `<div onClick>` is "tracked by autocapture".
- Calling a form "tracked" because its submit button is clicked, with no
  success or failure signal.
- Turning on a vendor autocapture without checking what it records: labels
  and attributes of customer-named elements go out as written.
- Bundling "add global autocapture" into a feature PR.
