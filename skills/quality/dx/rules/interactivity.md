# Interactivity Rules

Interactive features make CLIs approachable for humans. Non-interactive mode makes
them automatable. A great CLI supports both seamlessly.

## TTY Detection

**Core rule**: Only use interactive features when stdin is an interactive terminal.

```
if (isatty(stdin)) {
  // Interactive: prompts, colors, spinners, menus OK
} else {
  // Non-interactive: no prompts, plain output, fail with guidance if input needed
}
```

### Behavior by Mode
| Feature | Interactive (TTY) | Non-interactive (piped/CI) |
|---------|------------------|---------------------------|
| Prompts | Show and wait for input | Skip or fail with error |
| Colors | Enabled (unless NO_COLOR) | Disabled |
| Spinners/progress | Show on stderr | Suppress or use simple log lines |
| Confirmations | Prompt user | Use `--yes`/`--force` flags |
| Menus/selectors | Interactive selection | Require explicit flag value |
| Paging | Use `$PAGER` for long output | Direct to stdout |

## Prompts

### Design Rules
- **Every prompt must have a flag bypass**: `--name "foo"` skips the name prompt
- Provide `--no-input` or `--yes` to skip all prompts
- When `--no-input` is set and required data is missing, fail with clear error naming the missing flag
- Show default values in prompts: `Port [3000]: `
- Allow empty input to accept the default
- Use `[y/N]` notation (capital letter = default)

### Prompt Types
| Type | Use Case | Example |
|------|----------|---------|
| Text input | Free-form values | `Project name: ` |
| Confirmation | Yes/no decisions | `Delete 5 files? [y/N]: ` |
| Selection | Choose from options | Arrow-key menu or numbered list |
| Multi-select | Choose multiple | Checkbox-style with space to toggle |
| Password | Sensitive input | Disable echo, show `****` or nothing |

### Quality Rules
- Never require typing through interactive prompts for common workflows
- Keep prompts to a minimum — ask only what can't be defaulted or detected
- Group related prompts into a logical flow
- Allow going back or canceling (Ctrl-C always works)
- Validate input immediately, re-prompt on invalid input
- Show what was selected after multi-step prompts ("Creating project 'foo' on port 3000...")

## Confirmations for Destructive Actions

### Severity Levels
| Level | Pattern | Example |
|-------|---------|---------|
| **Mild** | Optional confirmation, `--force` skips | "Remove cached files? [Y/n]: " |
| **Moderate** | Required confirmation, `--force` skips | "Delete 12 branches? [y/N]: " |
| **Severe** | Must type resource name, `--force` NOT available | "Type 'production-db' to confirm deletion: " |

### Rules
- Name what's being destroyed: "Delete 5 worktrees?" not "Are you sure?"
- Show what will be affected (list items, count, etc.)
- Default to the safe option (no-op) for moderate+ severity
- `--dry-run` should show what would happen without any confirmation

## Keyboard & Signal Handling

### Ctrl-C (SIGINT)
- Exit immediately on first Ctrl-C
- Print status before cleanup: "Interrupted. Cleaning up..."
- Add timeout to cleanup operations
- Second Ctrl-C during cleanup forces immediate exit
- Design for crash-only recovery: assume cleanup didn't run on next start

### Ctrl-D (EOF)
- Treat as end of input for stdin-reading tools
- Equivalent to submitting empty in prompts

### Terminal Raw Mode
- Restore terminal state on exit (always, including crashes)
- Use `try/finally` or signal handlers to ensure cleanup
- Test that Ctrl-C restores terminal properly

## What to Flag

- Prompts with no flag bypass (can't automate)
- No `--no-input` or `--yes` flag for CI/scripting
- Interactive features when stdin is not a TTY
- Confirmations that say "Are you sure?" without naming the action
- Missing Ctrl-C handling (tool hangs on interrupt)
- Terminal state not restored after crash/interrupt
- Default value not shown in prompt
- No default value for optional prompts
- Password input that echoes characters
- Prompts for information that could be auto-detected
