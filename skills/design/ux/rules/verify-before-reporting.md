# Verify before reporting

Every finding that describes behaviour is a claim about the code, and it must be checked against the code before it is reported.
**Why:** [`../references/path-first.md`](../references/path-first.md).

## Rule

1. Cite the `file:line` that proves each behavioural claim — the handler, option, or branch, not the component name.
2. Follow the call one level past the component when the behaviour lives in a hook, store, or router helper.
3. When the code cannot prove the claim statically (runtime config, third-party widget, server behaviour), write **unverified** in the finding and name the check that would settle it.
4. Delete a finding whose evidence contradicts it; never soften it into a vaguer claim.

## Example

```markdown
<!-- ✗ Asserted from the label, never checked -->
- **High** — "Clear all" cannot be undone with the browser Back button.

<!-- ✓ Checked: the helper pushes a history entry, so Back restores the filters — no finding -->
(dropped: `useFilterState.ts:41` calls `setParams(next, { navigationMode: 'push' })`)

<!-- ✓ Checked and real -->
- **High** — `StatusFilter.tsx:58` writes with `history.replaceState`, so Back skips the status change, unlike every other filter (`push` at `useFilterState.ts:41`).

<!-- ✓ Not provable statically -->
- **Medium (unverified)** — The embedded widget may trap focus; the vendor script is loaded at runtime (`Embed.tsx:12`). Confirm with Tab from the widget in a browser.
```

## What counts as checked

| Claim | Evidence |
| --- | --- |
| "Does X on click / Enter" | the handler and every branch it takes |
| "Not announced to screen readers" | absence of `aria-live` / `role="status"` on the updating node and its ancestors |
| "Contrast fails" | the resolved color values of both tokens and the computed ratio |
| "Stale data shown" | the query option (`keepPreviousData`, `placeholderData`, cache key) and what renders during refetch |
| "Back button does not restore" | the history call (`push` vs `replace`) |
