---
title: 'Phase 3: Implementation'
impact: HIGH
tags:
  - implementation
  - coding
  - phase-3
---

# Phase 3: Implementation

## Receiving Planner Handoff

This is the executor's entry phase. Before starting Step 1 of implementation:

1. Verify you're inside the worktree (`pwd && git branch --show-current`).
2. Read `plan.md` end-to-end:
   ```bash
   cat .agent/$(git branch --show-current)/plan.md
   ```
3. Verify the Acceptance Criteria section is non-empty (these are the
   contract you'll gate Phase 4 testing against).
4. **Bail if missing:** if `plan.md` doesn't exist, is malformed, or has no
   Acceptance Criteria, STOP and tell the user "no plan to execute — run
   aw-planner first."
5. Log the takeover:
   ```markdown
   - [TIMESTAMP] Phase 3: executor took over (plan confidence Y%)
   ```

See [`planner-executor-handoff.md`](./planner-executor-handoff.md) for the
full handoff contract.

## Overview

Incremental implementation with continuous verification. Work in the isolated
worktree created in Phase 2. Follow existing patterns, commit at logical
milestones, and invoke companions per task signal.

Companions invoked from this phase **skip silently if not installed** — see
[`companion-skills.md`](./companion-skills.md) for the full registry.

## Prerequisite

Before starting, verify:

| Check                                   | Command                                                |
| --------------------------------------- | ------------------------------------------------------ |
| Worktree exists                         | `gw list` (with `gw`) or `git worktree list` (native)  |
| Currently in the worktree directory     | `pwd`                                                  |
| Dependencies installed                  | per project (`pnpm i`, `go mod tidy`)                  |
| Environment validated                   | type-check or compile passes                           |
| `plan.md` populated (Full Mode)         | `cat .agent/{branch}/plan.md`                          |

If the worktree was not created, **STOP and return to Phase 2.**

## Core Principles

| Principle                              | What it means                                    |
| -------------------------------------- | ------------------------------------------------ |
| Follow existing patterns               | Consistency with codebase                        |
| Implement incrementally                | Small, focused changes — one concern per edit    |
| Verify after every edit                | Fast type-check / compile before moving on       |
| Commit at logical milestones           | Atomic commits with conventional format          |
| Invoke companions per signal           | TDD / UX / code-quality at the right moments     |
| Sequential, not parallel               | File-level changes share state; no fan-out here  |

---

## Procedure

### Step 1: Read `plan.md` Implementation Order

Open `.agent/{branch}/plan.md` and follow the **Implementation Order** section
verbatim. Typical order:

1. Types / interfaces (if TypeScript)
2. Core logic / pure functions
3. UI components (if applicable)
4. Integration / glue code
5. Configuration updates

If `plan.md` is missing (Lite Mode), use the order above as the default.

### Step 2: One Change at a Time

**Before editing**

- Read the existing file completely.
- Identify insertion points.
- Note the existing patterns and naming.

**During editing**

- Make a single focused change.
- Match existing code style and formatting.

**After editing — verify (fast check)**

Run the project's fastest type-check / compile loop. Examples:

```bash
npx tsc --noEmit              # TypeScript type check
go vet ./...                  # Go vet
cargo check                   # Rust compile check
ruff check <file>             # Python lint
```

| Outcome           | Action                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| Pass              | Move to next file                                                      |
| Fail              | Fix immediately. **Max 3 attempts on the same failure.**               |
| Still failing     | Stop iterating; reassess the approach (re-read the surrounding code, revisit `plan.md`, ask if root assumption is wrong) |

The 3-attempt cap mirrors the [Phase 4 stuck-loop protocol](./phase-4-testing.md#stuck-loop-detection)
and exists for the same reason: more than three local attempts almost always
means the mental model is wrong.

### Step 3: Companion Triggers

Invoke companions at the moments described below. Detailed trigger conditions,
invocation, and disable instructions live in:

- [TDD Trigger](#tdd-trigger) — pure logic / business rules
- [UX Trigger](#ux-trigger) — UI files touched
- [Code Quality Trigger](#code-quality-trigger) — once at end of phase

**All companions skip silently if not installed** — log the result and continue.

### Step 4: Commit at Milestones

Every 2-3 files (or after a logically complete unit), commit:

```bash
git add <changed-files>
git commit -m "<type>(<scope>): <description>"
```

**Conventional commit format:**

| Type     | Example                                              |
| -------- | ---------------------------------------------------- |
| `feat`   | `feat(ui): add dark mode toggle button`              |
| `feat`   | `feat(theme): implement theme context provider`      |
| `test`   | `test(theme): add theme toggle unit tests`           |
| `refactor` | `refactor(api): extract pagination helper`         |
| `fix`    | `fix(parser): handle empty input`                    |

**Rules:**

- One logical change per commit.
- Descriptive messages — explain *why* in the body when non-obvious.
- **Never** add `Co-Authored-By` lines. See [`safety-guardrails.md`](./safety-guardrails.md).

### Step 5: Update `plan.md` Progress Log (Full Mode)

At each milestone (not after every file), append to the Progress Log in
`.agent/{branch}/plan.md`:

```markdown
- [2026-04-29T15:42:10Z] Phase 3: Implemented ThemeContext + ThemeToggle
- [2026-04-29T15:48:33Z] Phase 3: Updated Tailwind config for dark mode classes
- [2026-04-29T15:51:05Z] Phase 3: ux() — invoked (2 contrast suggestions integrated)
- [2026-04-29T15:55:12Z] Phase 3: code-quality(code) — not available, continuing
```

Use full ISO 8601 timestamps with hours, minutes, seconds.

### Step 6: Periodic Broader Validation

After every 2-3 files, run a wider check beyond the fast type-check:

```bash
# Tests related to changed code
npm test -- --testPathPattern="<area>"

# Full build
npm run build
```

**Self-assessment questions:**

- Is the implementation tracking with `plan.md`?
- Any deviations? Are they justified, and is `plan.md` updated?
- Are checks getting cleaner each iteration, or repeatedly catching the same class of issue?

If the same class of issue keeps appearing, that's a Phase-4-style stuck loop
forming early. Stop, reassess, and consider re-reading `plan.md` before
continuing. See [Phase 4 stuck-loop protocol](./phase-4-testing.md#stuck-loop-detection)
for the recovery pattern.

### Step 7: Pre-Testing Commit

After all implementation is complete and `code-quality(code)` has been invoked:

```bash
git add .
git commit -m "feat(scope): implement <feature-name>

- Detail 1
- Detail 2"
```

---

## TDD Trigger

This section is the anchor referenced from [`companion-skills.md`](./companion-skills.md#registry).

**When:** task involves pure logic, business rules, or the user explicitly
requested "test-driven" / "TDD".

```bash
Skill("tdd")
```

| Behavior                       | Detail                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| Owns the inner loop            | TDD drives RED-GREEN-REFACTOR cycle; you do not run code-quality per file while TDD is active |
| Replaces verify-after-editing  | TDD's GREEN step is the verification                                |
| If skill missing               | Log `tdd() — not available, continuing` and fall back to verify-after-editing in Step 2 |
| Progress Log entry             | `[TIMESTAMP] Phase 3: tdd() — invoked` (or `not available, continuing`) |

Disable: remove the `Skill("tdd")` invocation from this section. Registry:
[`companion-skills.md`](./companion-skills.md#registry).

---

## UX Trigger

This section is the anchor referenced from [`companion-skills.md`](./companion-skills.md#registry).

**When:** files written or edited in this phase include any of:

| Pattern                              | Examples                                          |
| ------------------------------------ | ------------------------------------------------- |
| `*.tsx`, `*.jsx`                     | React components                                  |
| `*.vue`                              | Vue single-file components                        |
| `*.svelte`                           | Svelte components                                 |
| React Native screens                 | `screens/**/*.tsx`, Expo Router `app/**/*.tsx`    |

```bash
Skill("ux")
```

| Behavior                       | Detail                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| When to invoke                 | After the UI files are written, before Phase 4 testing              |
| Purpose                        | Catch accessibility / design issues while changes are fresh         |
| If skill missing               | Log `ux() — not available, continuing`; do a manual a11y scan if confident |
| Progress Log entry             | `[TIMESTAMP] Phase 3: ux() — invoked` (or `not available, continuing`) |

Disable: remove the `Skill("ux")` invocation from this section. Registry:
[`companion-skills.md`](./companion-skills.md#registry).

---

## Code Quality Trigger

This section is the anchor referenced from [`companion-skills.md`](./companion-skills.md#registry).

**When:** **once** at the end of Phase 3, after all files are written and
**before** Phase 4 testing begins. **Not per-file** — TDD owns the per-file
inner loop when active.

```bash
Skill("code-quality", "code")
```

| Behavior                       | Detail                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| Frequency                      | Exactly once per phase                                              |
| Purpose                        | Catch cognitive complexity, naming, and structural smells that emerged during implementation |
| If skill missing               | Log `code-quality(code) — not available, continuing`                |
| Progress Log entry             | `[TIMESTAMP] Phase 3: code-quality(code) — invoked` (or `not available, continuing`) |

Disable: remove the `Skill("code-quality", "code")` invocation from this section.
Registry: [`companion-skills.md`](./companion-skills.md#registry).

---

## Implementation Checklist

- [ ] All planned files modified
- [ ] Code follows existing patterns
- [ ] Fast check passes after each edit (max 3 attempts per failure)
- [ ] TDD invoked if pure logic / business rules
- [ ] UX invoked if UI files touched
- [ ] `code-quality(code)` invoked once at end of phase
- [ ] Commits are logical, atomic, conventional
- [ ] No `Co-Authored-By` lines
- [ ] Progress Log updated in `.agent/{branch}/plan.md` (Full Mode)
- [ ] Ready for Phase 4 testing

## References

- [`companion-skills.md`](./companion-skills.md) — full companion registry and disable instructions
- [`safety-guardrails.md`](./safety-guardrails.md) — hard stops and limits
- [`phase-2-worktree.md`](./phase-2-worktree.md) — prior phase
- [`phase-4-testing.md`](./phase-4-testing.md) — stuck-loop protocol referenced above
