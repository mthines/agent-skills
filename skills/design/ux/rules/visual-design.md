# Visual design floor

This file enforces minimums: type size, dark mode, tokens, and color-as-meaning.
Style direction, brand, palette construction, and type pairing belong to [`/visual-design`](../../visual-design/SKILL.md).
Contrast math lives in [`accessibility.md`](./accessibility.md#contrast--compute-do-not-eyeball).

## Type minimums

| Platform | Body | Caption |
| --- | --- | --- |
| Web | 16 px | 12 px |
| iOS | 17 pt | 12 pt |
| Android | 14 sp | 12 sp |

- Web text in `rem`; Android in `sp`; iOS honours Dynamic Type — flag hard-coded sizes that block scaling.
- Cap prose width at about `65ch`; flag centered body paragraphs longer than two lines.

## Color as meaning

Never let color alone carry state (error, success, selected, active, diff added/removed, chart series) — pair it with text, an icon, or a pattern (WCAG 1.4.1).

```tsx
// ✗ Only the border turns red
<input className={error ? 'border-red-500' : ''} />

// ✓ Text and programmatic association too
<input aria-invalid={!!error} aria-describedby="email-err" className={error ? 'border-red-500' : ''} />
{error && <p id="email-err">Enter an email like name@example.com.</p>}
```

## Dark mode

- Use near-black surfaces (`#121212`, `#1C1C1E`), not `#000`, unless the design is deliberately OLED-black.
- Express elevation with lighter surfaces or borders; shadows disappear on dark backgrounds.
- Recompute contrast for every dark-mode pair; desaturated brand colors often drop below 3:1 on UI components.
- Follow the system setting and allow an override.

## Tokens and consistency

- Flag hard-coded hex values and arbitrary spacing where the project has tokens or a scale.
- Flag mixed outlined and filled icon sets on one surface.
