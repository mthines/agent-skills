# Core DX Principles

Always-loaded reference. Apply these principles to every review.

## CLI Design Heuristics

Adapted from Nielsen's usability heuristics for developer tooling, grounded in [clig.dev](https://clig.dev), the [Heroku CLI Style Guide](https://devcenter.heroku.com/articles/cli-style-guide), and the [12 Factor CLI](https://medium.com/@jdxcode/12-factor-cli-apps-dd3c227a0e46).

| # | Heuristic | What to Check |
|---|-----------|---------------|
| 1 | **Visibility of System Status** | Progress indicators, spinners for operations >100ms, clear success/failure feedback, state changes announced |
| 2 | **Match Developer Mental Models** | Familiar command patterns (`verb noun` or `noun verb` — pick one), standard flag names, conventional exit codes, predictable behavior |
| 3 | **User Control and Freedom** | Ctrl-C exits immediately, `--dry-run` for preview, undo/rollback where possible, `--force` to skip confirmations |
| 4 | **Consistency and Standards** | Same flag = same behavior across subcommands, consistent output formatting, standard flag names (`-h`, `-v`, `-q`, `-n`) |
| 5 | **Error Prevention** | Confirm destructive actions, validate input early, good defaults, `--dry-run` for risky operations |
| 6 | **Recognition Over Recall** | Comprehensive `--help`, command suggestions on typos, shell completions, examples in help text |
| 7 | **Flexibility and Efficiency** | Short flags for common use (`-v`), long flags for clarity (`--verbose`), config files for repeated options, aliases for common commands |
| 8 | **Minimalist Output** | No unnecessary output by default, progressive verbosity (`-v`, `-vv`, `-vvv`), clean output for piping, `--quiet` for silence |
| 9 | **Helpful Error Recovery** | Plain-language errors, specific problem + actionable fix, suggest next command, link to docs for complex issues |
| 10 | **Discoverable Help** | `-h` for quick reference, `--help` for full docs, `help` subcommand, web docs link, contextual suggestions |

## Cognitive Principles Applied to CLI

### Hick's Law (Decision Complexity)
- **Rule**: Decision time increases logarithmically with number of choices
- **Check**: Max 5-8 subcommands visible in help. Group related commands under topics. Highlight the most common subcommand. Use progressive disclosure — hide advanced commands behind `help advanced` or similar.

### Miller's Law (Working Memory)
- **Rule**: Working memory holds 4±1 unfamiliar chunks
- **Check**: Don't require memorizing flag combinations. Provide sensible defaults. Show examples with real values, not abstract placeholders. Group related flags in help output.

### Jakob's Law (Convention Following)
- **Rule**: Developers expect your tool to work like tools they already use
- **Check**: Follow POSIX/GNU flag conventions. Use standard names (`--help`, `--version`, `--verbose`, `--quiet`, `--output`, `--force`). Subcommand patterns match popular tools (git, docker, kubectl). Don't reinvent well-known patterns.

### Doherty Threshold (Responsiveness)
- **Rule**: Productivity increases when response time <400ms
- **Check**: Print something within 100ms. Show progress before network requests. Never hang silently. Optimistic output for fast operations.

### Peak-End Rule (Experience Memory)
- **Rule**: Experience judged by peak moment and ending
- **Check**: Error messages are the "peak" for failure paths — make them excellent. Success output is the "end" — confirm what happened and suggest next steps. Installation experience is the first impression — make it effortless.

### Principle of Least Surprise
- **Rule**: A tool should behave as developers expect
- **Check**: Default behavior is safe (no data loss). Flags don't have unexpected side effects. Output format is predictable. Breaking changes are announced.

## Unix Philosophy (Applied to Modern CLI)

| Principle | Modern Application |
|-----------|-------------------|
| **Do one thing well** | Each command/subcommand has a single clear purpose |
| **Expect output to become input** | stdout is pipe-friendly, `--json` for structured data |
| **Design for composability** | Support stdin, stdout, exit codes, signals properly |
| **Fail fast and loudly** | Non-zero exit on failure, clear error to stderr |
| **Silence is golden** | Don't output anything unnecessary; success can be quiet |
| **Text streams as universal interface** | Line-oriented output, parseable by grep/awk/jq |

## DX Quality Indicators

Quick checks that signal good or bad DX:

| Good DX Signal | Bad DX Signal |
|----------------|---------------|
| Tool works with zero config on first run | Requires setup wizard before any use |
| Error tells you what to do next | Error shows stack trace or error code |
| `--help` has real examples | `--help` shows only flag list |
| Stdout is pipeable, stderr is for humans | Mixes logs and data on stdout |
| `--dry-run` available for destructive ops | No way to preview before committing |
| Non-zero exit code on failure | Returns 0 regardless of outcome |
| Colors disabled when piped | ANSI codes corrupt piped output |
| One command to install | Requires manual PATH editing, compiling, or 5 steps |
| Suggests fix when you make a typo | "Unknown command" with no suggestion |
| `--json` for structured output | Only human-formatted, unparseable output |

## The Three Audiences

Every CLI tool serves three audiences simultaneously. Check that code addresses all three:

| Audience | Needs | Mechanism |
|----------|-------|-----------|
| **Interactive human** | Colors, progress, help, suggestions, confirmations | TTY detection, `--help`, spinners, prompts |
| **Script/automation** | Predictable output, exit codes, no prompts, parseable data | `--json`, `--quiet`, `--no-input`, `--no-color`, non-zero exits |
| **Future maintainer** | Clear code, documented behavior, tests | Code structure, comments on non-obvious behavior, test coverage |
