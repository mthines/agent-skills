# Accessibility Rules (WCAG 2.2)

## Contrast Requirements

| Element | AA Minimum | AAA Minimum |
|---------|-----------|-------------|
| Normal text (<18pt / <14pt bold) | 4.5:1 | 7:1 |
| Large text (>=18pt / >=14pt bold) | 3:1 | 4.5:1 |
| UI components & graphical objects | 3:1 | — |
| Focus indicators | 3:1 against adjacent | — |

**Check**: Never use color as the sole indicator of state (error, success, active, selected). Always pair with icon, text, or pattern.

## WCAG 2.2 New Requirements

| Success Criterion | Level | Check |
|---|---|---|
| 2.4.11 Focus Not Obscured (Min) | AA | Focused element not entirely hidden by sticky headers, modals, toasts |
| 2.4.13 Focus Appearance | AAA | Focus indicator >=2px thick, 3:1 contrast vs unfocused |
| 2.5.7 Dragging Movements | AA | Every drag operation has a non-dragging alternative (click/tap) |
| 2.5.8 Target Size (Min) | AA | Interactive targets >=24x24 CSS px (inline text links exempt) |
| 3.2.6 Consistent Help | A | Help mechanisms in consistent location across pages |
| 3.3.7 Redundant Entry | A | Don't re-ask for previously provided info in same flow |
| 3.3.8 Accessible Auth (Min) | AA | No cognitive function test for auth unless alternative exists |

## Screen Reader Support

### Web (HTML/JSX)
- Use semantic elements: `<nav>`, `<main>`, `<header>`, `<footer>`, `<section>`, `<article>`, `<button>`, `<a>`
- Heading hierarchy: logical H1->H2->H3. One H1 per page. Never skip levels.
- Image alt text: descriptive for meaningful, `alt=""` for decorative
- `aria-live` for dynamic content announcements
- `aria-label` / `aria-labelledby` for non-text interactive elements
- Reading order matches visual order (DOM order = visual order)

### React Native
- `accessibilityLabel`: describe the element's purpose (like alt text)
- `accessibilityHint`: describe what happens on activation
- `accessibilityRole`: `button`, `link`, `header`, `image`, `search`, `tab`, etc.
- `accessibilityState`: `{ disabled, selected, checked, busy, expanded }`
- `accessibilityValue`: `{ min, max, now, text }` for sliders/progress
- `accessibilityLiveRegion`: `"polite"` or `"assertive"` for dynamic content
- `importantForAccessibility`: `"yes"`, `"no"`, `"no-hide-descendants"`
- Group related elements with `accessible={true}` on container

### Common Violations to Flag
- `<div onClick>` or `<span onClick>` without `role="button"` and `tabIndex={0}` — use `<button>` instead
- Images without alt text
- Form inputs without associated labels
- Custom components missing accessibility props
- Icon-only buttons without `accessibilityLabel` / `aria-label`
- Color-only state indication
- Auto-playing media without controls

## Keyboard Navigation (Web)

- All interactive elements reachable via Tab
- Enter/Space activates buttons and links
- Escape dismisses modals, dropdowns, popovers
- Arrow keys navigate within composite widgets (tabs, menus, radio groups)
- Visible focus indicator: >=2px solid, 3:1 contrast. Never `outline: none` without replacement.
- Skip link as first focusable element: "Skip to main content"
- No keyboard traps (except intentional modal focus traps with Escape exit)
- Tab order follows visual layout

## Focus Management

| Event | Focus Should Move To |
|---|---|
| Modal opens | First focusable element or modal heading |
| Modal closes | Element that triggered the modal |
| Page navigation | New page's main heading or content |
| Item deleted from list | Previous/next item or list container |
| Drawer opens | First item in drawer |
| Toast/alert appears | Alert element (if actionable) |
| Dynamic content loads | Optionally announce via live region |

## Motion & Animation

```
/* Web */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- React Native: check `AccessibilityInfo.isReduceMotionEnabled()` or `useReducedMotion()` from reanimated
- Essential motion (progress bars, loading) can stay but simplify
- Decorative motion (parallax, auto-play, bouncing) must be disabled
- No content flashes >3 times per second (seizure risk)
- Provide in-app motion toggle as additional control
