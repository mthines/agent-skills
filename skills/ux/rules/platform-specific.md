# Platform-Specific Rules

## Apple Human Interface Guidelines (iOS 17-18)

### Navigation
- Prefer bottom tab bar (max 5 items) for primary navigation
- Use `NavigationStack` / stack navigation for hierarchical content
- Back gesture (swipe from left edge) must always work — don't override it
- Large title in navigation bar for top-level screens, inline title for detail screens

### Typography
- System font: SF Pro. Use Dynamic Type — never hardcode font sizes.
- Minimum body: 17pt. Caption: 12pt. Large Title: 34pt.
- Test with all Dynamic Type sizes including accessibility sizes

### Layout
- Respect safe area insets (notch, Dynamic Island, home indicator)
- Use `useSafeAreaInsets()` from `react-native-safe-area-context`
- Standard margin: 16pt from edges
- List row height minimum: 44pt

### Interactions
- Haptics: use `UIFeedbackGenerator` patterns — `.success`, `.warning`, `.error`, `.selection`
- Pull-to-refresh: native feel with bounce
- Swipe actions: standard delete red, leading/trailing actions
- Long-press context menus for secondary actions

### Modals & Sheets
- Prefer sheet presentation over full-screen modals
- Support half-height (detent) sheets where appropriate
- Dismiss via swipe down or close button (both)
- Card-style presentation (rounded corners, slight inset)

## Material Design 3 (Android)

### Navigation
- Bottom navigation bar: 3-5 items. Labels always visible.
- Top app bar: 64dp standard height
- Navigation drawer for secondary nav
- Predictive back gesture (Android 14+): design for peek-behind animation

### Typography Scale
Display (L/M/S), Headline (L/M/S), Title (L/M/S), Body (L/M/S), Label (L/M/S)

### Color & Theming
- Dynamic Color (Material You): extract scheme from wallpaper
- Color roles: Primary, Secondary, Tertiary, Error, Surface, On-Surface
- Each role has Container and On-Container variants
- Use `DynamicColorAndroid` or Material 3 theming in RN

### Shape
- Corner radius categories: None (0), Extra Small (4dp), Small (8dp), Medium (12dp), Large (16dp), Extra Large (28dp), Full
- Consistent corner radius per component type

### Elevation
- 6 levels: 0, 1, 3, 6, 8, 12dp
- Dark mode: elevation increases surface lightness (not shadow)

### Components
- FAB: 56dp standard, 40dp small, 96dp large
- Bottom nav: 80dp height
- Buttons: 40dp height minimum
- Cards: 12dp corner radius

## React Native Platform-Adaptive Patterns

### What to Adapt Per Platform
| Element | iOS | Android |
|---------|-----|---------|
| Primary nav | Bottom tab bar | Bottom nav bar |
| Back button | Chevron left | Arrow left |
| Scroll bounce | Yes (elastic) | No (edge glow) |
| Switch style | iOS-style toggle | Material switch |
| Date picker | Wheel picker or inline | Dialog picker |
| Font | SF Pro (system) | Roboto (system) |
| Elevation | shadow* props | elevation prop |
| Status bar | Translucent, dark/light | Colored or translucent |
| Pull to refresh | Native bounce | Material indicator |
| Alert style | iOS action sheet | Material dialog |

### Implementation
```
// Platform-adaptive values
Platform.select({ ios: value, android: value, web: value })

// Platform-adaptive components
Platform.OS === 'ios' ? <IOSComponent /> : <AndroidComponent />

// File-based platform selection
Component.ios.tsx / Component.android.tsx
```

### Cross-Platform Consistency
- Core functionality and information architecture should be identical
- Visual style should feel native to each platform
- Don't force iOS patterns on Android or vice versa
- Shared design tokens (colors, spacing) with platform-specific components
- Test on both platforms — don't assume cross-platform means identical

## What to Flag
- iOS-style back chevron on Android (should be arrow)
- Material-style top tabs as primary nav on iOS (should be bottom tabs)
- Missing safe area handling on iOS
- Bounce scroll on Android (non-native feel)
- Same elevation/shadow approach on both platforms
- Fixed font sizes that don't respect Dynamic Type (iOS) / font scale (Android)
- Missing `Platform.select()` for platform-divergent UI elements
- Full-screen modals where sheets are more appropriate (iOS)
- Missing predictive back support (Android 14+)
- Wheel date picker on Android (should be dialog)
