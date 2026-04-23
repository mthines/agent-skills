# Navigation & Layout Rules

## Navigation Patterns

### Mobile (React Native / Expo Router)

| Pattern | When to Use | Limits |
|---------|-------------|--------|
| **Bottom Tab Bar** | Primary app navigation | 3-5 items. Icons + labels always visible. Active state clear. |
| **Stack (push/pop)** | Hierarchical drill-down | Always provide back affordance. Use native transitions. |
| **Drawer** | Secondary/settings nav | Lower discoverability than tabs. Don't use for primary nav. |
| **Top Tabs** | Filtering within a section | 2-5 peer-level views. Swipeable. |
| **Modal** | Focused tasks breaking main flow | Clear dismiss. Don't stack modals. Full-screen on mobile for complex forms. |

**Expo Router specifics:**
- Use `(tabs)` layout group for tab navigation
- Use `_layout.tsx` files for nested navigation configuration
- Stack screens get automatic back button — don't add redundant back controls
- Use `router.push()` for forward nav, `router.back()` for backward
- Deep linking: ensure all routes are bookmarkable and shareable

### Web

| Pattern | When to Use | Limits |
|---------|-------------|--------|
| **Top horizontal nav** | Primary site navigation | 5-8 items max |
| **Sidebar** | App/dashboard with many sections | Collapsible. Indicate current section. |
| **Breadcrumbs** | Hierarchical content >2 levels | Always show current location. Last item not a link. |
| **Mega menu** | Large sites, many categories | Show structure at glance. Don't auto-open on hover. |
| **Command palette (Cmd+K)** | Power user shortcut | Searchable actions. Trending pattern. |

### Common Violations
- More than 5 items in bottom tab bar
- Hamburger menu as only navigation on mobile (low discoverability)
- No back button or gesture support
- Deep nesting (>3-4 levels) without breadcrumbs or clear path
- Inconsistent navigation between sections
- Modal on top of modal
- Navigation that changes based on context without clear indication
- Missing current-location indicator (which tab/page is active)

## Responsive Layout

### Breakpoints (2024 consensus)
| Category | Range |
|----------|-------|
| Small phone | 320-374px |
| Phone | 375-427px |
| Large phone | 428-767px |
| Tablet portrait | 768-1023px |
| Tablet/small desktop | 1024-1279px |
| Desktop | 1280-1919px |
| Large desktop | 1920px+ |

### Layout Rules
- **Content determines breakpoints**, not device categories
- **Single column** for mobile (<768px) — almost always
- **Two column** possible from tablet (>=768px)
- **Max content width**: 1200-1440px for readability. Center on larger screens.
- **Text containers**: `max-width: 65ch` for optimal line length (45-75 chars)
- **Spacing scales with viewport**: use relative units or spacing scale
- **No horizontal scroll**: ever, unless it's a deliberate carousel/gallery
- **Touch-friendly on all sizes**: don't assume mouse on tablet-sized screens

### React Native Layout
- Use `Dimensions.get('window')` or `useWindowDimensions()`
- Flexbox is default and preferred layout system
- `flex: 1` for fill-available patterns
- `Platform.select()` for platform-specific values
- Consider `SafeAreaView` / `useSafeAreaInsets()` for notch/island
- Test landscape orientation if app supports it

### Spacing & Grid
- Use a consistent spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px
- **4px base unit** (aligns with both iOS 4pt and Android 4dp grids)
- Maintain consistent padding within sections
- Group related items with tighter spacing, separate groups with wider spacing (Gestalt proximity)
- Card padding: 12-16px mobile, 16-24px desktop
- Section padding: 16-24px mobile, 24-48px desktop

### What to Flag
- Hardcoded pixel widths that don't adapt
- Missing `SafeAreaView` or safe area insets
- Content extending beyond viewport (horizontal overflow)
- Inconsistent spacing (mixing arbitrary values)
- Text containers wider than 75 characters
- No responsive consideration at all (fixed layout)
- Missing `maxWidth` on content containers for large screens
