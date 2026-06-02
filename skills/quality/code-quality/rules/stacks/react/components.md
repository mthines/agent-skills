---
title: 'React Components — Splitting, Composition, Compound Namespaces'
impact: HIGH
tags:
  - react
  - components
  - composition
  - compound-components
  - namespace-components
  - hooks
  - api-design
---

# React Components

A React component is a function whose UI is its return type. The framework-agnostic rules apply directly: `rules/functions.md` (single responsibility, ≤ 3 parameters), `rules/abstraction.md` (one level of abstraction per body), `rules/api-design.md` (signature is the UI), `rules/maintainability.md` (consolidate parallel maps over a union, e.g. status → label/colour/icon). This rule covers the React-specific extensions: when to split a component, how to design a multi-part component's public API, and the deep-namespace compound pattern.

> **Pair with `ux` and `testability.md`.** Components in this stack must clear WCAG 2.2 and use semantic HTML — that pass lives in the [`ux`](../../../../../design/ux/SKILL.md) skill (`Skill('ux')`). The locator-stability subset that affects E2E (accessible names so `getByRole` / `getByLabel` work without `data-testid`) lives in [`../../testability.md`](../../testability.md#ui-testability--accessible-names-are-locators). Under `autonomous-workflow` Phase 3, `ux` is invoked from the phase rule directly — do not double-invoke from this skill.

## Contents

- 1. When to split a component
- 2. How to split — by responsibility, not by line count
- 3. Compound components: the deep-namespace pattern
- 4. Namespaced hooks: `Component.useComponent` for external control
- 5. Slots: `children`, render props, `asChild`
- 6. Server vs Client components (RSC)
- 7. Common mistakes

## 1. When to split a component

A component should split when **any** of these are true. Component size is the weakest signal — responsibility count is the strongest.

| Signal | Action |
| --- | --- |
| The honest name has "and" in it (`UserCardAndSettings`) | Two components |
| Two state machines coexist (`isLoading` + `isExpanded` + …) and don't reference each other | Extract one into its own component or hook |
| Same component renders in 3+ visually distinct modes via `if/else` chains | Split by mode (`<Card.Empty>`, `<Card.Loaded>`, `<Card.Error>`) — see compound pattern below |
| Prop list exceeds ~6 items, especially booleans | Either an options object (`api-design.md` §1) or compound sub-components |
| A subtree is reused elsewhere | Extract and import |
| A subtree depends on different data than the parent | Co-locate the fetch with the subtree (`rules/stacks/react/data-fetching.md`) |
| The component would not fit on one screen at a comfortable font size | Strong hint, not the rule itself — find the responsibility seam |

A 200-line component with one responsibility is fine; a 60-line component juggling fetch + form state + modal + analytics is not.

## 2. How to split — by responsibility, not by line count

Pick a seam and extract by what changes for the same reason. Common seams:

- **Data vs presentation.** Container fetches; presenter renders. The presenter takes typed props and is trivially storyable.
- **Layout vs content.** A `<Page>` shell that takes `header`, `sidebar`, `children` slots, and a content component that fills them.
- **State machine vs view.** A `useReducer` + a stateless `<View state={...}>`. The view is testable without setting up the reducer.
- **One mode per component.** Empty / loading / loaded / error become four sub-components, dispatched by a thin parent.

When in doubt, name the candidate split. If you can't name it crisply, the seam isn't where you think.

## 3. Compound components: the deep-namespace pattern

For any component with **more than one part** (header + body, list + items + actions, tabs + tab + panel), prefer the compound-component pattern with **deep dot-notation namespacing**. The state lives in the root via React Context; sub-parts read it. Consumers compose markup that mirrors the hierarchy.

### The shape

```tsx
<Combobox value={value} onValueChange={setValue}>
  <Combobox.Trigger />
  <Combobox.Content>
    <Combobox.Content.Search placeholder="Find a fruit…" />
    <Combobox.Content.List>
      {fruits.map((f) => (
        <Combobox.Content.List.Item key={f.id} value={f.id}>{f.name}</Combobox.Content.List.Item>
      ))}
    </Combobox.Content.List>
    <Combobox.Content.Empty>No fruits.</Combobox.Content.Empty>
  </Combobox.Content>
</Combobox>
```

Every sub-part is reached through the root. One import (`import { Combobox } from '@/ui'`) carries the whole family. The depth of the dot notation **mirrors the visual hierarchy**, so a reader sees the structure in the JSX without reading the implementation.

### Implementation

```tsx
// combobox.tsx
import { createContext, useContext, useId, useState } from 'react';

type ComboboxContextValue = {
  value: string | null;
  setValue: (v: string) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
  listboxId: string;
};
const ComboboxContext = createContext<ComboboxContextValue | null>(null);

function useComboboxContext() {
  const ctx = useContext(ComboboxContext);
  if (!ctx) throw new Error('Combobox.* must be rendered inside <Combobox>.');
  return ctx;
}

function ComboboxRoot({ value, onValueChange, children }: ComboboxRootProps) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const ctx = useMemo(() => ({ value, setValue: onValueChange, open, setOpen, listboxId }),
                       [value, onValueChange, open, listboxId]);
  return <ComboboxContext.Provider value={ctx}>{children}</ComboboxContext.Provider>;
}

function ComboboxTrigger(props: ComboboxTriggerProps) { /* reads ctx, renders <button> */ }
function ComboboxContent(props: ComboboxContentProps) { /* reads ctx, renders panel */ }
function ComboboxContentSearch(props: ComboboxContentSearchProps) { /* reads ctx */ }
function ComboboxContentList({ children }: { children: ReactNode }) { /* reads ctx */ }
function ComboboxContentListItem({ value, children }: ItemProps) { /* reads ctx */ }
function ComboboxContentEmpty({ children }: { children: ReactNode }) { /* reads ctx */ }

// Attach the family. Deep dot-notation mirrors the visual hierarchy.
export const Combobox = Object.assign(ComboboxRoot, {
  Trigger: ComboboxTrigger,
  Content: Object.assign(ComboboxContent, {
    Search: ComboboxContentSearch,
    List: Object.assign(ComboboxContentList, {
      Item: ComboboxContentListItem,
    }),
    Empty: ComboboxContentEmpty,
  }),
});
```

### Rules

- **Memoise the context value** (`useMemo`). A new object on every render re-renders every consumer.
- **Throw a clear error in `useXContext`** when used outside the provider. Otherwise consumers get `Cannot read properties of null` ten frames deep.
- **Do not also export sub-components separately** (`export { ComboboxTrigger }`). The whole point is one namespace; two ways to import the same thing fragments codebases. Exception: design-system maintainers occasionally re-export for tree-shaking — that decision is owned at the package level, not per-consumer.
- **Type each leaf strictly.** `Combobox.Content.List.Item` carries its own `Props`; `Object.assign` preserves the function type. For deeply-typed compound components, see [tkdodo's "Building Type-Safe Compound Components"](https://tkdodo.eu/blog/building-type-safe-compound-components).
- **Hierarchy in the JSX = hierarchy in the namespace.** `Card.Header.Action` only makes sense if `Action` is visually inside `Header`. Don't dot-notate for the sake of grouping; the depth must reflect the DOM.
- **Keep the root meaningful.** `<Combobox>` is the controller; the children are the parts. A flat `<Combobox><Trigger /><Content /></Combobox>` (without dot notation) is acceptable when the parts are siblings without sub-grouping — but the moment you have a `Content.List.Item`, dot-notation wins.

## 4. Namespaced hooks: `Component.useComponent` for external control

When a consumer needs to control internal state from outside (open / close, focus, selection, async lifecycle), expose the hook on the **same namespace**:

```tsx
function MyPage() {
  const combobox = Combobox.useCombobox();

  return (
    <>
      <button onClick={() => combobox.open()}>Pick a fruit</button>
      <Combobox value={combobox.value} onValueChange={combobox.setValue} open={combobox.isOpen}>
        ...
      </Combobox>
    </>
  );
}
```

### Why

- One import covers the whole API surface — `import { Combobox }` gives you the components **and** the hook.
- The hook's name is discoverable: anyone using `Combobox` finds `Combobox.useCombobox` without grepping.
- The hook name mirrors the component name, so a reader sees the relationship without thinking.

### Rules

- **The hook returns a stable controller object.** Memoise the returned actions (`open`, `close`, `setValue`); don't return new function references on every render.
- **The hook is the *only* way for external callers to control state.** Don't expose imperative `ref`-handles in addition; pick one mechanism.
- **For headless variants (Radix, Headless UI, react-aria), pass the hook's state to the component** via controlled props (`open={...}`, `onOpenChange={...}`). The hook owns the state; the component renders it.
- **One root, one hook.** `Combobox.useCombobox` is the only namespaced hook on `Combobox`. Don't proliferate `Combobox.useSelection`, `Combobox.useFilter` — those are implementation details.

## 5. Slots: `children`, render props, `asChild`

Compound components handle most cases; for the rest, three slot patterns:

| Slot | Use when |
| --- | --- |
| `children: ReactNode` | The slot is a single area with no structural variation |
| Render props (`children: (state) => ReactNode`) | The slot needs the parent's runtime state to render |
| `asChild` (Radix-style) | The consumer wants to swap the rendered element (`<Button asChild><Link href=…></Link></Button>`) |

`asChild` is genuinely powerful for design-system primitives: the parent owns behaviour and class names, the child supplies the element. Implement it with `cloneElement` or Radix's `Slot` primitive. Do not use `asChild` to disguise an absent compound API — if there are multiple parts, use compound components.

## 6. Server vs Client components (RSC)

In Next.js App Router and similar frameworks:

- **Server Components by default.** Reach for `'use client'` only when you need state, effects, refs, browser APIs, or event handlers.
- **Push `'use client'` as deep as it'll go.** A leaf interactive component is cheaper than a page-level client boundary that pulls everything to the client.
- **Compound components with shared state must live in a client subtree.** Context crosses the server/client boundary only as serialised props; the provider itself is client-side.
- **Server fetch, client interact.** Server Component fetches and prefetches into the TanStack Query cache (`rules/stacks/react/data-fetching.md` §10); the client compound component reads via `useSuspenseQuery`.
- **Don't pass non-serialisable props across the boundary.** Functions, class instances, dates as `Date` objects — convert at the boundary.

## 7. Common mistakes

- **Splitting by line count instead of responsibility.** **Fix:** name the candidate split's responsibility; if you can't, don't split.
- **Five booleans on one component.** **Fix:** compound sub-components or an enum-typed `mode` prop. R14 (Replace Boolean Parameter with Two Functions) applies to React props too.
- **Compound components without context — props drilled through every part.** **Fix:** lift state into the root via `createContext`; sub-parts read it.
- **Re-creating the context value on every render.** **Fix:** `useMemo` the value object so consumers don't re-render needlessly.
- **No guard in `useXContext`.** **Fix:** throw a named error so consumers get "must be inside `<Combobox>`" instead of a stack trace.
- **Flat sibling exports (`<TabsList>`, `<TabsTrigger>`) when there is real sub-hierarchy.** **Fix:** deep dot-notation (`Tabs.List.Trigger` if it nests; `Tabs.List` + `Tabs.Trigger` if they're siblings).
- **Both dot notation and named exports for the same parts.** **Fix:** pick one. Named exports are acceptable for design-system libraries that want maximum tree-shaking; product code should use dot notation only.
- **Imperative `ref` *and* a `useX` hook for external control.** **Fix:** one mechanism. Hooks are usually clearer.
- **A `'use client'` boundary at the top of every page.** **Fix:** push the boundary down to the actual interactive leaf; static branches stay on the server.
- **Calling hooks conditionally inside compound parts.** **Fix:** parts are real components — same Rules of Hooks as anywhere else.
- **Using compound components where a single component with one prop would do.** **Fix:** compound is for genuine hierarchy. `<Avatar size="sm" />` does not need `<Avatar.Image />`.
