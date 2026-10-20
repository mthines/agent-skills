# Pass 2 — Accessibility and interaction depth

Apply to every interactive element on the path from [`user-path.md`](./user-path.md).
Cite the WCAG 2.2 success criterion on each finding; this file carries the checks reviewers get wrong, not the criteria list.

## Contrast — compute, do not eyeball

1. Resolve each token to its final value in every theme (follow CSS variables, Tailwind config, theme objects).
2. Composite alpha over the actual background before computing (`rgba(255,255,255,0.6)` on `#1C1C1E` is a new color).
3. Compute the ratio and report both values and the result.

| Element | AA |
| --- | --- |
| Text < 24 px (or < 18.66 px bold) | 4.5:1 |
| Larger text | 3:1 |
| UI component boundaries, icons that carry meaning, focus indicators | 3:1 against adjacent colors |

Commonly missed: placeholder text, disabled-but-readable labels, text on images or gradients, dark-mode secondary text, and focus rings against the component's own fill.

```markdown
✗ "The gray text looks low contrast."
✓ `Card.tsx:22` — `text-muted` resolves to `#8A8F98` on `#FFFFFF` = 3.2:1; needs 4.5:1. Use `#6B7079` (4.9:1).
```

## Focus management

| Event | Move focus to |
| --- | --- |
| Dialog / drawer opens | the dialog heading or its first field; trap Tab inside; Escape closes |
| Dialog closes | the control that opened it |
| Route change in a SPA | the new page's `<h1>` or main region |
| Item deleted from a list | the next item, else the previous, else the list heading |
| Inline edit saved / cancelled | the control that started the edit |

Also check WCAG 2.4.11: a focused element must not be fully hidden by a sticky header, toast, or cookie banner.
Never accept `outline: none` without a replacement indicator of at least 2 px and 3:1.

## Live regions

- Put `aria-live="polite"` (or `role="status"`) on a node that exists before its content changes; a region mounted with its content is not announced.
- Announce the outcome, not every tick: a typing demo, ticker, or streaming log inside a live region floods the screen reader — mark it `aria-hidden` or move it out and announce a summary.
- Use `assertive` / `role="alert"` only for errors that block the task.
- Loading: set `aria-busy="true"` on the region and announce completion once.
- Auto-advancing or looping content needs a pause control (WCAG 2.2.2) and must stop under reduced motion.

## ARIA patterns and roles

- Use the native element first: `<button>`, `<a href>`, `<input type="checkbox">`, `<select>`, `<dialog>`.
- A `<div onClick>` needs `role`, `tabIndex={0}`, and Enter **and** Space handlers; replace it with `<button>`.
- Match the APG pattern for composite widgets: tabs (`tablist` / `tab` / `tabpanel`, arrow keys, `aria-selected`), menus, comboboxes (`aria-expanded`, `aria-controls`, `aria-activedescendant`), and listbox options.
- Toggle buttons expose `aria-pressed`; disclosure buttons expose `aria-expanded`.
- Information shown only in a tooltip on hover is unreachable by keyboard and screen readers; make the trigger focusable, show on focus, link with `aria-describedby`, and dismiss on Escape (WCAG 1.4.13) — or put definitions in visible text.
- Icon-only controls need an accessible name that says the action ("Remove filter: status"), not the icon ("X").

## Keyboard paths

- Walk the primary task with Tab, Shift+Tab, Enter, Space, Escape, and arrows; every step must be completable.
- Tab order follows visual order; no positive `tabIndex`.
- Keyboard handlers must do what the click handler does — compare both branches.
- Every drag interaction needs a single-pointer alternative (WCAG 2.5.7).

## Touch targets and interaction states

| Standard | Minimum |
| --- | --- |
| WCAG 2.2 AA (2.5.8) | 24×24 CSS px, or 24 px spacing |
| iOS (HIG) | 44×44 pt |
| Android (Material 3) | 48×48 dp |

- Padding and `hitSlop` count toward the target; the visual icon may be smaller.
- The dismiss ×, inline row actions, and filter-chip remove buttons are the usual failures.
- Every pressable needs a pressed state; `TouchableWithoutFeedback` on a primary action has none.
- A submitting control must disable itself and show progress; a disabled control must say why.

## Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- React Native: `AccessibilityInfo.isReduceMotionEnabled()` or Reanimated `useReducedMotion()`.
- Stop parallax, autoplay, and loops; keep progress indicators.
- Nothing flashes more than three times per second.

## React Native specifics

- Set `accessibilityRole`, `accessibilityLabel`, and `accessibilityState` (`disabled`, `selected`, `checked`, `expanded`, `busy`) on every custom control.
- Group a row with `accessible={true}` so it reads as one element; otherwise each `Text` is a separate stop.
- Hide decorative or duplicated nodes with `importantForAccessibility="no-hide-descendants"` (Android) and `accessibilityElementsHidden` (iOS) — both, they are platform-specific.
- `accessibilityLiveRegion` works on Android only; on iOS call `AccessibilityInfo.announceForAccessibility()`.
- Respect font scaling: no fixed heights on text containers; test at the largest accessibility size.
- Respect safe-area insets (`useSafeAreaInsets()`); do not override the iOS edge-swipe back gesture; support Android predictive back.
