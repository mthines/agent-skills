# Visual Design Rules

## Typography

### Size Minimums
| Platform | Body Min | Caption Min | Large Title |
|----------|----------|-------------|-------------|
| Web | 16px | 12px | 32-40px |
| iOS | 17pt | 12pt | 34pt |
| Android | 14sp | 12sp | 32sp |

### Line Length & Spacing
- **Optimal line length**: 45-75 characters (66 ideal). Use `max-width: 65ch`.
- **Line height**: 1.4-1.6 for body text, 1.1-1.3 for headings
- **Letter spacing**: slight increase (0.01-0.02em) for text <14px, slight decrease for large headings
- **Paragraph spacing**: 0.5-1.0x the body line height between paragraphs

### Hierarchy
- Establish clear type scale with distinct levels: display, heading, subheading, body, caption
- Maximum 2-3 font families (usually 1 is enough — system font is excellent)
- Use weight and size for hierarchy, not multiple fonts
- iOS: SF Pro (system). Android: Roboto (system). Web: system-ui or carefully chosen web font.

### Dynamic Type / Responsive Text
- iOS: support Dynamic Type — never hardcode font sizes
- Android: use `sp` units (scale with user font size preference)
- Web: use `rem` or `clamp()` for fluid scaling: `font-size: clamp(1rem, 0.5rem + 1.5vw, 1.5rem)`
- Test with largest accessibility text size — layouts must not break

## Color

### Usage Rules
- **Primary color**: 1 dominant brand color for primary actions and key UI elements
- **Secondary**: supporting color for less prominent elements
- **Neutral palette**: grays for text, backgrounds, borders (most of the UI)
- **Semantic colors**: error (red), success (green), warning (amber), info (blue)
- Never rely on color alone to convey meaning — always pair with text, icon, or pattern
- Limit total palette to 5-7 colors (plus neutrals)

### Dark Mode
- Background: #121212 (Material) or #1C1C1E (Apple) — never pure #000000
- Primary text: ~87% opacity white (#E0E0E0)
- Secondary text: ~60% opacity white
- Elevation in dark: lighter surfaces for higher elevation (not shadows)
- Desaturate brand colors by 10-20% for dark mode
- Test contrast ratios separately for dark mode
- Shadows don't work in dark mode — use subtle borders or luminance
- Respect system setting (`prefers-color-scheme` / Appearance API)
- Allow user override: light / dark / system

### Contrast Checks
- Check every text-on-background combination
- Check UI component borders against their background
- Check placeholder text contrast (often fails — should be >=4.5:1 for AA)
- Check disabled state contrast (should still be readable, just visually muted)
- Tool references: Stark, Chrome DevTools contrast checker, WebAIM contrast checker

## Spacing & Alignment

### Spacing Scale
Use a consistent scale based on 4px unit: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px

| Usage | Typical Value |
|-------|---------------|
| Inline element spacing | 4-8px |
| Related items (within group) | 8-12px |
| Between groups | 16-24px |
| Section separation | 24-48px |
| Page margins (mobile) | 16-20px |
| Page margins (desktop) | 24-48px |
| Card internal padding | 12-16px (mobile), 16-24px (desktop) |

### Alignment
- Consistent alignment within sections (left-aligned for LTR content)
- Avoid center-aligned body text (hard to read beyond 2-3 lines)
- Right-align numbers in data tables
- Vertically center icons with adjacent text

## Elevation & Depth
- Use elevation to indicate interactive hierarchy: higher = more prominent
- iOS: shadows with blur + offset
- Android: `elevation` prop — Material Design 3 defines 6 levels: 0, 1, 3, 6, 8, 12dp
- Be consistent — same elevation level = same visual treatment
- Floating elements (FAB, modal, dropdown) should have highest elevation

## Icons
- Consistent style: all outlined OR all filled (not mixed)
- Size: 20-24px for inline, 24-32px for standalone
- Always pair with text label for primary actions
- Icon-only acceptable for universally understood symbols (close, search, share, back)
- Even icon-only buttons need `aria-label` / `accessibilityLabel`

## What to Flag
- Inconsistent spacing (arbitrary values instead of scale)
- Text below minimum size for platform
- Missing dark mode support in a production app
- Color as sole state indicator
- More than 3 font families
- Text wider than 75 characters
- Centered body text paragraphs
- Pure black (#000) background in dark mode
- Inconsistent icon styles (mixing outlined and filled)
- Missing elevation/shadow on floating elements
- Hardcoded colors instead of theme tokens
