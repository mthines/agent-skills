---
title: Locator Strategy — Role, Label, Test ID
impact: HIGH
tags:
  - locators
  - accessibility
  - data-testid
  - getByRole
---

# Locator Strategy

## Contents

- [The ladder](#the-ladder)
- [When to drop to `data-testid`](#when-to-drop-to-data-testid)
- [How to add `data-testid` correctly](#how-to-add-data-testid-correctly)
- [Naming conventions for `data-testid`](#naming-conventions-for-data-testid)
- [When **not** to add `data-testid`](#when-not-to-add-data-testid)
- [Cross-references](#cross-references)

Pick locators from the top of the ladder down.
Every step skipped is a future flake.
`data-testid` is a source change to the component, never a workaround in the
test file.

## The ladder

| Rung | Locator                                              | When to use                                                |
| ---- | ---------------------------------------------------- | ---------------------------------------------------------- |
| 1    | `getByRole('button', { name: 'Save' })`              | Default. Element has a stable accessible role and name.   |
| 2    | `getByLabel`, `getByPlaceholder`, `getByText`        | Form fields, headings, body text the user reads.          |
| 3    | `getByTestId('save-draft')`                          | Escape hatch — only after rungs 1 and 2 fail.             |

Forbidden:

- `page.locator('.btn-primary.lg-only.btn-32')` — class soup.
- `page.locator('div > div > button:nth-child(3)')` — structural.
- `page.locator('xpath=//button[contains(@class, "save")]')` — both at once.

## When to drop to `data-testid`

Drop only when **all** of these are true:

1. The element has no stable accessible role or name (rung 1 fails).
2. There is no unique label, placeholder, or visible text (rung 2 fails).
3. Multiple elements with the same role / text exist with no
   disambiguating ancestor.
4. The text is dynamic or i18n-translated and changes per locale.

## How to add `data-testid` correctly

`data-testid` is a **source diff**, not a test edit.
The Healer must propose the diff and offer it for user approval before
patching the test.

### Correct flow

1. Healer detects a non-recoverable locator.
2. Healer outputs a unified diff that adds `data-testid` to the component.
3. User approves.
4. Source change committed alongside the test.

### Example diff

```diff
--- a/components/CreateProjectButton.tsx
+++ b/components/CreateProjectButton.tsx
@@ -10,7 +10,11 @@ export function CreateProjectButton({ onCreate }: Props) {
   return (
-    <Button onClick={onCreate}>
+    <Button
+      data-testid="create-project"
+      onClick={onCreate}
+    >
       <PlusIcon />
     </Button>
   );
 }
```

```ts
// tests/dashboard/create-project.spec.ts
await page.getByTestId('create-project').click();
```

### Wrong flow

Patching the test alone with a brittle CSS selector:

```ts
// ❌ Don't do this.
await page.locator('button.btn-primary:has(svg.plus-icon)').click();
```

Why wrong: tied to class names that survive only by accident.
The first refactor breaks it.

## Naming conventions for `data-testid`

- Kebab-case: `create-project`, not `createProject` or `CreateProject`.
- Action-oriented for buttons: `submit-order`, `cancel-edit`.
- Object-oriented for containers: `cart-summary`, `pricing-table`.
- Scope when needed: `dashboard-create-project` — only if a global
  `create-project` already exists elsewhere.

## When **not** to add `data-testid`

- The element already has a stable accessible name.
  Use `getByRole` and improve a11y for free.
- The element is a heading or static text.
  Use `getByRole('heading', { name: ... })` or `getByText`.
- The element is the only one of its kind on the page.
  `getByRole` without a name is enough.

## Cross-references

- Spec-first flow: [`rules/spec-first-flow.md`](./spec-first-flow.md).
- Healer reference: [`references/playwright-agents.md`](../references/playwright-agents.md).
