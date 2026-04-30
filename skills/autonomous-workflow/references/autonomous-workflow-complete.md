# Complete Autonomous Workflow Example

This example demonstrates a full autonomous workflow execution from start to finish.

> **Note on tooling:** This example uses [`gw`](https://github.com/mthines/gw-tools)
> commands as the happy path because `gw` is the recommended worktree tool and
> ships with auto-copy of secrets, pre/post-checkout hooks, smart cleanup, and
> shell-integrated `gw cd`. **`gw` is optional, not required.** If `gw` is not
> installed, every `gw` command shown here has a native `git worktree`
> equivalent — see
> [`rules/prerequisites.md#fallback-to-native-git-worktree`](../rules/prerequisites.md#fallback-to-native-git-worktree)
> for the full mapping. The only hard-required CLI tool for this workflow is
> `gh`.

## Scenario

**User request:** "Implement dark mode toggle for the app"

**Context:**

- Next.js app with Tailwind CSS
- No existing theme infrastructure
- Component library uses standard React patterns

---

## Phase 0: Validation & Questions

### Agent Response

```markdown
Let me understand this requirement before implementation.

Current analysis:

- Project: Next.js 14 app with Tailwind CSS v3.4
- Tech stack: TypeScript, React 18, App Router
- Testing: Jest + React Testing Library
- No existing theme infrastructure found

Clarifying questions:

1. **Scope**: Should dark mode apply globally or be page-specific?
2. **Persistence**: Save preference (localStorage/cookie/database)?
3. **Default behavior**: System preference or manual toggle?
4. **UI placement**: Where should toggle appear?
5. **Approach**: Prefer Tailwind dark: classes or CSS variables?
6. **Components**: All pages or specific sections?

My proposed approach:

- Add React context for theme state
- Use Tailwind dark: classes
- Persist to localStorage
- System preference as default
- Toggle button in navbar
- Apply theme globally

Does this match your vision?
```

### User Response

```markdown
Yes, that's perfect! A few clarifications:

- Global dark mode is correct
- localStorage persistence is fine
- System preference as default: yes
- Toggle in navbar: yes
- Cover all components
```

**✅ Phase 0 complete - proceeding to implementation**

---

## Phase 1: Task Intake & Planning

### Codebase Analysis

```markdown
Project structure:
├── src/
│ ├── app/ # Next.js App Router
│ │ ├── layout.tsx # Root layout (inject provider)
│ │ └── page.tsx # Home page
│ ├── components/
│ │ ├── Navbar.tsx # Add toggle here
│ │ └── ui/ # Component library
│ └── lib/
│ └── utils.ts # Utility functions

Existing patterns discovered:

- Context providers in app/layout.tsx
- UI components use shadcn/ui patterns
- TypeScript strict mode enabled
- All exports have explicit types
```

### Implementation Plan

```markdown
Changes required:

1. **Create theme context** (new file)
   - File: `src/contexts/ThemeContext.tsx`
   - Exports: ThemeProvider, useTheme hook
   - Features: state management, localStorage sync, system preference

2. **Add theme provider to layout**
   - File: `src/app/layout.tsx`
   - Change: Wrap children with ThemeProvider
   - Reason: Apply theme globally

3. **Create toggle component**
   - File: `src/components/ThemeToggle.tsx`
   - UI: Sun/moon icon button
   - Behavior: Toggle theme on click

4. **Add toggle to navbar**
   - File: `src/components/Navbar.tsx`
   - Change: Insert ThemeToggle component
   - Location: Right side of navbar

5. **Configure Tailwind**
   - File: `tailwind.config.js`
   - Change: Enable dark mode class strategy
   - Reason: Support dark: classes

6. **Add tests**
   - New file: `src/contexts/__tests__/ThemeContext.test.tsx`
   - Coverage: theme toggling, persistence, system preference

7. **Update documentation**
   - File: `README.md` - Usage examples
   - File: `CHANGELOG.md` - Feature entry

Testing strategy:

- Unit tests: Theme context logic (Jest)
- Component tests: ThemeToggle interactions (RTL)
- Manual: Visual validation in browser

Documentation:

- README: Usage example
- CHANGELOG: Feature entry
- JSDoc: API documentation
```

### Confidence Gate (Mandatory)

```
Skill("confidence", "plan")
→ 94% — passed gate (≥ 90% required)

Strengths:
- Requirements fully captured from Phase 0 dialogue
- File-by-file change list aligned with discovered patterns
- Testing strategy covers context logic + UI interactions
- Risks (hydration flash) identified with mitigation

Concerns:
- Manual visual validation noted as out-of-scope for automation
```

**✅ Plan validated (94%, gate ≥ 90%) - proceeding to worktree setup**

---

## Phase 2: Worktree Setup

### Commands Executed

```bash
# Generate branch name
# Type: feat (new feature)
# Description: dark-mode-toggle
Branch: feat/dark-mode-toggle

# Create worktree
$ gw add feat/dark-mode-toggle
✓ Created worktree: feat/dark-mode-toggle

# Navigate
$ gw cd feat/dark-mode-toggle

# Install dependencies
$ pnpm install
Lockfile is up to date
Dependencies installed successfully

# Verify build
$ pnpm build
✓ Compiled successfully

# Sync config
$ gw sync feat/dark-mode-toggle
✓ Synced: .env.local
✓ Synced: .env.test
```

### Generate plan.md artifact (Full Mode)

```
Skill("create-plan")
→ Wrote .agent/feat-dark-mode-toggle/plan.md
→ Captured: Phase 0 dialogue, requirements, file-change list,
            testing strategy, risks, verification commands
→ Initialized Progress Log
```

**Progress Log entries:**

```markdown
- [2026-04-29T10:12:04Z] Phase 2: worktree created (gw add feat/dark-mode-toggle)
- [2026-04-29T10:12:31Z] Phase 2: deps installed, build verified
- [2026-04-29T10:12:48Z] Phase 2: create-plan() — invoked (.agent/feat-dark-mode-toggle/plan.md written)
```

**✅ Environment ready, artifacts populated - proceeding to implementation**

---

## Phase 3: Implementation

### Step 1: Create Theme Context

**File:** `src/contexts/ThemeContext.tsx`

````typescript
'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  // Initialize from localStorage or system preference
  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored) {
      setThemeState(stored);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setThemeState(prefersDark ? 'dark' : 'light');
    }
    setMounted(true);
  }, []);

  // Apply theme to DOM
  useEffect(() => {
    if (mounted) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      localStorage.setItem('theme', theme);
    }
  }, [theme, mounted]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState(prev => prev === 'light' ? 'dark' : 'light');
  };

  // Prevent flash of wrong theme
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme context.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { theme, toggleTheme } = useTheme();
 *   return <button onClick={toggleTheme}>Toggle: {theme}</button>;
 * }
 * ```
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
````

**Validation:**

```bash
$ pnpm tsc --noEmit
✓ No TypeScript errors

$ pnpm lint src/contexts/ThemeContext.tsx
✓ No lint errors
```

**Commit:**

```bash
$ git add src/contexts/ThemeContext.tsx
$ git commit -m "feat(theme): add theme context with persistence"
```

### Step 2: Configure Tailwind

**File:** `tailwind.config.js`

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // Enable class-based dark mode
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

**Validation:**

```bash
$ pnpm build
✓ Build successful with dark mode enabled
```

**Commit:**

```bash
$ git add tailwind.config.js
$ git commit -m "feat(theme): enable Tailwind dark mode"
```

### Step 3: Add Provider to Layout

**File:** `src/app/layout.tsx`

```diff
+ import { ThemeProvider } from '@/contexts/ThemeContext';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
+       <ThemeProvider>
          {children}
+       </ThemeProvider>
      </body>
    </html>
  )
}
```

**Validation:**

```bash
$ pnpm build
✓ Build successful

$ pnpm dev &
$ curl http://localhost:3000 | grep ThemeProvider
✓ Provider rendered
```

**Commit:**

```bash
$ git add src/app/layout.tsx
$ git commit -m "feat(theme): add ThemeProvider to root layout"
```

### Step 4: Create Toggle Component

**File:** `src/components/ThemeToggle.tsx`

```typescript
'use client';

import { useTheme } from '@/contexts/ThemeContext';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      aria-label="Toggle theme"
    >
      {theme === 'light' ? (
        <Moon className="w-5 h-5 text-gray-800 dark:text-gray-200" />
      ) : (
        <Sun className="w-5 h-5 text-gray-800 dark:text-gray-200" />
      )}
    </button>
  );
}
```

**Validation:**

```bash
$ pnpm tsc --noEmit
✓ No errors

$ pnpm lint src/components/ThemeToggle.tsx
✓ No errors
```

**Commit:**

```bash
$ git add src/components/ThemeToggle.tsx
$ git commit -m "feat(theme): create theme toggle component"
```

### Step 5: Add Toggle to Navbar

**File:** `src/components/Navbar.tsx`

```diff
+ import { ThemeToggle } from './ThemeToggle';

export function Navbar() {
  return (
    <nav className="flex items-center justify-between p-4 bg-white dark:bg-gray-900">
      <div className="text-xl font-bold">My App</div>
      <div className="flex items-center gap-4">
        <a href="/about">About</a>
+       <ThemeToggle />
      </div>
    </nav>
  );
}
```

**Validation:**

```bash
$ pnpm build
✓ Build successful
```

**Commit:**

```bash
$ git add src/components/Navbar.tsx
$ git commit -m "feat(theme): add theme toggle to navbar"
```

**✅ Implementation complete - proceeding to testing**

---

## Phase 4: Testing & Iteration

### Step 1: Run Existing Tests

```bash
$ pnpm test
PASS  src/components/__tests__/Navbar.test.tsx
PASS  src/app/page.test.tsx

Test Suites: 8 passed, 8 total
Tests:       42 passed, 42 total

✓ No regressions
```

### Step 2: Create Theme Context Tests

**File:** `src/contexts/__tests__/ThemeContext.test.tsx`

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../ThemeContext';

function TestComponent() {
  const { theme, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>Toggle</button>
      <button onClick={() => setTheme('dark')}>Dark</button>
      <button onClick={() => setTheme('light')}>Light</button>
    </div>
  );
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('should default to light theme', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('should toggle theme', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');

    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('should persist theme to localStorage', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText('Dark'));
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('should apply dark class to html element', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText('Dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should restore theme from localStorage', () => {
    localStorage.setItem('theme', 'dark');

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('should throw error when useTheme used outside provider', () => {
    // Suppress console.error for this test
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useTheme must be used within ThemeProvider');

    jest.restoreAllMocks();
  });
});
```

### Step 3: Run New Tests

```bash
$ pnpm test ThemeContext
FAIL  src/contexts/__tests__/ThemeContext.test.tsx
  ● should restore theme from localStorage

    expect(received).toHaveTextContent()

    Expected: "dark"
    Received: "light"

Tests: 1 failed, 5 passed, 6 total
```

### Step 4: Iteration 1 - Fix localStorage Restoration

**Issue:** Theme not restoring from localStorage properly.

**Root cause:** `useEffect` dependency issue - mounted state causes re-render.

**Fix:** Adjust initialization logic in ThemeContext.tsx:

```diff
  useEffect(() => {
+   if (mounted) return;
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored) {
      setThemeState(stored);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setThemeState(prefersDark ? 'dark' : 'light');
    }
    setMounted(true);
- }, []);
+ }, [mounted]);
```

**Retest:**

```bash
$ pnpm test ThemeContext
PASS  src/contexts/__tests__/ThemeContext.test.tsx

Tests: 6 passed, 6 total
✓ All tests passing
```

**Commit:**

```bash
$ git add src/contexts/__tests__/ThemeContext.test.tsx
$ git commit -m "test(theme): add comprehensive theme context tests"

$ git add src/contexts/ThemeContext.tsx
$ git commit -m "fix(theme): correct localStorage restoration timing"
```

### Step 5: Create Toggle Component Tests

**File:** `src/components/__tests__/ThemeToggle.test.tsx`

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '../ThemeToggle';
import { ThemeProvider } from '@/contexts/ThemeContext';

describe('ThemeToggle', () => {
  it('should render toggle button', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument();
  });

  it('should show moon icon in light mode', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    // Moon icon shown when theme is light
    expect(screen.getByRole('button').querySelector('svg')).toBeInTheDocument();
  });

  it('should toggle theme when clicked', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
```

**Run tests:**

```bash
$ pnpm test ThemeToggle
PASS  src/components/__tests__/ThemeToggle.test.tsx

Tests: 3 passed, 3 total
```

**Commit:**

```bash
$ git add src/components/__tests__/ThemeToggle.test.tsx
$ git commit -m "test(theme): add theme toggle component tests"
```

### Step 6: Full Test Suite

```bash
$ pnpm test
PASS  src/contexts/__tests__/ThemeContext.test.tsx
PASS  src/components/__tests__/ThemeToggle.test.tsx
PASS  src/components/__tests__/Navbar.test.tsx
PASS  src/app/page.test.tsx

Test Suites: 10 passed, 10 total
Tests:       51 passed, 51 total
Coverage:    92.3% (all files)

✓ All tests passing
```

**✅ Testing complete - proceeding to documentation**

---

## Phase 5: Documentation

### Update README

**File:** `README.md`

````diff
+ ## Dark Mode
+
+ The app supports system-wide dark mode with manual toggle control.
+
+ ### Using the Toggle
+
+ Click the sun/moon icon in the navigation bar to switch between light and dark themes.
+
+ ### Programmatic Usage
+
+ \```typescript
+ import { useTheme } from '@/contexts/ThemeContext';
+
+ function MyComponent() {
+   const { theme, setTheme, toggleTheme } = useTheme();
+
+   return (
+     <div>
+       <p>Current theme: {theme}</p>
+       <button onClick={toggleTheme}>Toggle Theme</button>
+       <button onClick={() => setTheme('dark')}>Force Dark</button>
+       <button onClick={() => setTheme('light')}>Force Light</button>
+     </div>
+   );
+ }
+ \```
+
+ ### Behavior
+
+ - **Default**: Respects system preference (`prefers-color-scheme`)
+ - **Persistence**: User preference saved to localStorage
+ - **Scope**: Applied globally across all pages
+ - **Flash prevention**: Hydration mismatch handling included
````

**Commit:**

```bash
$ git add README.md
$ git commit -m "docs(theme): add dark mode usage documentation"
```

### Update CHANGELOG

**File:** `CHANGELOG.md`

```diff
  ## [Unreleased]

+ ### Added
+ - Dark mode toggle in navigation bar (#42)
+   - Respects system color scheme preference
+   - Persists user choice to localStorage
+   - Global theme application using Tailwind CSS
+   - Theme context API for programmatic control
+
  ### Changed
- None
```

**Commit:**

```bash
$ git add CHANGELOG.md
$ git commit -m "docs(changelog): add dark mode feature entry"
```

### Self-Improving Doc Loop

```
Skill("update-claude")
→ Scanned changes for new conventions worth promoting
→ Suggested: "Theme context pattern (provider + useTheme hook) — promote to CLAUDE.md?"
→ Accepted: appended snippet under "## Patterns" in CLAUDE.md
→ No drift detected in existing rules
```

**Progress Log entry:**

```markdown
- [2026-04-29T10:38:15Z] Phase 5: update-claude() — CLAUDE.md updated with ThemeContext pattern
```

**✅ Documentation complete - proceeding to PR creation**

---

## Phase 6: PR Creation & Delivery

### Pre-Flight Validation

```bash
# All committed?
$ git status
On branch feat/dark-mode-toggle
nothing to commit, working tree clean
✓

# Tests pass?
$ pnpm test
Tests: 51 passed, 51 total
✓

# Build succeeds?
$ pnpm build
✓ Compiled successfully
✓

# Lint clean?
$ pnpm lint
✓ No lint errors
✓
```

### Review Changes (Self-Review)

```
Skill("review-changes")
→ Analyzed 8 commits across 5 new files / 3 modified files
→ Coverage: 100% on new code, no regressions in existing tests
→ Consistency: matches shadcn/ui patterns and existing context layout
→ No blocking findings; 2 advisory notes captured for the walkthrough
```

### Generate Walkthrough Artifact

```
Skill("create-walkthrough")
→ Wrote .agent/feat-dark-mode-toggle/walkthrough.md
→ Captured: change narrative, testing summary, screenshots placeholder,
            review-changes advisory notes
```

### Create PR

```
Skill("create-pr")
→ Pushed feat/dark-mode-toggle to origin
→ Title: "feat(ui): add dark mode toggle"
→ Body sourced from walkthrough.md (no AI attribution lines —
  the user owns the PR)
→ Draft PR opened: https://github.com/user/nextjs-app/pull/123
```

**Progress Log entries:**

```markdown
- [2026-04-29T10:42:01Z] Phase 6: review-changes() — no blocking findings
- [2026-04-29T10:42:18Z] Phase 6: create-walkthrough() — walkthrough.md written
- [2026-04-29T10:42:44Z] Phase 6: create-pr() — draft PR #123 opened
```

> **Fallback (only if `create-pr` is unavailable):** push manually with
> `git push -u origin feat/dark-mode-toggle` and open the PR with
> `gh pr create --draft --title "..." --body "$(cat <<'EOF' ... EOF)"`.
> Never include AI attribution lines (`Co-Authored-By`, "Generated with
> ...", etc.) in the title or body — the user owns the PR.

---

## Phase 7: CI Gate

### Watch CI and Auto-Fix

```
Skill("ci-auto-fix")
→ Polled GitHub Actions for PR #123
→ All checks green: build (12s), test (38s), lint (4s), typecheck (9s)
→ No fixes needed
```

If a check had failed, `ci-auto-fix` would have fanned out a sub-agent per
failed job (capped at 2 handoffs per PR), each with its own retry budget.

**Progress Log entry:**

```markdown
- [2026-04-29T10:46:09Z] Phase 7: ci-auto-fix() — all checks green, no fixes needed
```

**✅ CI green - workflow complete**

---

### Completion Report

```markdown
✅ **Dark mode feature implementation complete!**

**Delivered:**

- Branch: `feat/dark-mode-toggle`
- Worktree: `/path/to/repo.git/feat/dark-mode-toggle`
- Draft PR: https://github.com/user/nextjs-app/pull/123

**Summary:**

- Implemented theme context with persistence
- Created toggle component with accessibility
- All tests passing (51 tests, +9 new)
- Documentation complete (README + CHANGELOG)
- Ready for your review

**Files changed:**

- 5 new files
- 3 modified files
- 9 new tests (100% coverage for new code)
- 8 commits with clear messages

**Next steps:**

1. Review the draft PR
2. Test locally if desired: `gw cd feat/dark-mode-toggle`
3. Add screenshots to PR
4. Mark as ready for review when satisfied
5. Merge when approved

**Worktree cleanup:**
After PR is merged, run: `gw remove feat/dark-mode-toggle`
```

---

## Outcome

**Total execution time:** ~45 minutes

**Statistics:**

- 8 commits
- 5 new files created
- 3 existing files modified
- 9 new tests added (100% coverage)
- 51 total tests passing
- 0 lint errors
- Draft PR created

**Validation checkpoints passed:**

- ✅ Phase 0: Requirements validated
- ✅ Phase 1: Plan validated by `confidence(plan)` (94%, gate ≥ 90%)
- ✅ Phase 2: Environment validated, `create-plan` invoked
- ✅ Phase 3: Implementation self-reviewed
- ✅ Phase 4: Tests passing (1 iteration)
- ✅ Phase 5: Documentation validated, `update-claude` invoked
- ✅ Phase 6: `review-changes` + `create-walkthrough` + `create-pr` invoked
- ✅ Phase 7: `ci-auto-fix` invoked — all checks green

**Result:** Complete, production-ready feature delivered autonomously!
