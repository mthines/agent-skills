---
project-key: <normalised-git-remote-key>
stack: <vitest | jest | deno | playwright | pytest | maestro | storybook>
detect-command: <command to run the full test suite>
single-test-command: <command to run one test — use {file} and {name} as placeholders>
failure-parser: '<regex with two capture groups: (1) file path, (2) test name>'
cache-bust-flag: <flag to append when a cached-pass is suspected — leave blank if not applicable>
notes: <one-line summary, e.g. "Vitest jsdom + separate Storybook surface">
---

## Notes

Free-text body for human-readable context the YAML can't capture:

- Other stacks detected alongside the primary (e.g. "Vitest is primary; Storybook
  interaction tests live in a sibling surface `<key>-storybook.md`").
- Project-specific quirks (e.g. "tests require `pnpm exec` not bare `vitest` because
  the binary is hoisted only at the workspace root").
- Known-flaky tests to escalate rather than auto-heal.
- Surface-validation overrides (e.g. "binary lives under `mise`; tolerate `which` miss").

This section is read by humans, not parsed by the skill.
