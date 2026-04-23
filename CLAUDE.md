# Agent Skills

## Audience

The skills, commands, and agents in this repository are consumed operationally by agentic frameworks (AI coding agents, copilots, and autonomous developer tools).
Every piece of guidance must be written so that an agent can act on it without human interpretation.

When writing or editing content, follow these principles:
- **Be prescriptive, not descriptive.**
  Tell the agent what to do, not explain concepts.
- **Make decisions enumerable.**
  Provide numbered decision processes, lookup tables, or explicit criteria.
- **Include code examples for every actionable rule.**
  Show both correct and incorrect patterns.
- **Avoid subjective conditions.**
  State concrete, testable criteria.
- **Keep rules self-contained.**
  Each file must make sense on its own.

## Repository Structure

Skills live in `skills/` as standard SKILL.md files.
Agents live in `agents/` since they require their own model and tool configuration.

### Auto-activated skills
- `confidence` — Confidence assessment for plans, code, and bug analysis
- `dx` — Developer Experience review for CLI tools and shell scripts
- `ux` — UX design review for web and React Native apps
- `holistic-analysis` — Full execution path analysis for stuck bugs/refactors
- `tdd` — Test-Driven Development with strict RED-GREEN-REFACTOR cycles

### Slash commands (`disable-model-invocation: true`)
- `init-claude` — Initialize Claude Code configuration for a project
- `update-claude` — Update CLAUDE.md and rules based on code changes
- `resolve-conflicts` — Analyze and resolve Git merge/rebase conflicts
- `review-changes` — Review branch changes or PR (dispatches to reviewer)
- `implement-suggestion` — Implement fixes from review comments

### Background skills (`user-invocable: false`)
- `reviewer` — Constructive code reviewer with auto-fix, report, and PR comment modes

## Prose Rules

- One sentence per line (semantic line breaks).
- Use inline Markdown links.
- Fence code with language identifier.
- End sentences with full stops.
- Use the Oxford comma.
