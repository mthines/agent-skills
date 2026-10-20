# UX writing and microcopy

Review every user-facing string on the path from [`user-path.md`](./user-path.md), in path order.
Report copy findings in a table: location, current copy, problem, suggested copy.

## Rules

1. A label names the outcome, not the mechanism: "Create account", "Delete 3 photos" — never "Submit", "OK", or "Yes".
2. A step tells the user what to do **and** gives them what that step needs (the token, the link, the value).
3. Copy must match behaviour: if the button removes, it does not say "Add"; if the count means "items matching all", it does not read as a total.
4. An error says what failed and what to do next, without codes or blame.
5. An empty state says why it is empty and offers the one action that fills it.
6. A destructive confirmation names the object and the consequence; "Are you sure?" alone fails.
7. One term per concept across the product ("Sign in" everywhere, not "Log in" on one screen).
8. Ask for a permission after stating the user's benefit, and say how to re-enable it after denial.
9. Loading copy names what is loading when the wait exceeds about two seconds ("Loading 4 of 12 dashboards").
10. Placeholders give format hints only; they are never the label.

## Examples

| ✗ | ✓ |
| --- | --- |
| "Error 500: Internal server error" | "Couldn't save. Check your connection and try again." |
| "Invalid password" | "Use at least 8 characters." |
| "Are you sure?" | "Delete project 'Atlas'? This removes 12 dashboards and can't be undone." |
| "No data" | "No events yet. Send your first event with the command above." |
| "Run the installer, then come back." (token not shown) | "Copy your token, then run the installer — it will ask for it." |

## Tone

- Errors: calm and specific. Destructive: plain and serious. Success: brief.
- No confirmshaming, guilt, or fake urgency — see [`dark-patterns.md`](./dark-patterns.md).
- Sentence case; no ALL CAPS beyond short design-system labels.
