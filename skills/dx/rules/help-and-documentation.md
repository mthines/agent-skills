# Help & Documentation Rules

Help text is the primary interface documentation. Every developer's first interaction with your tool is `--help`.

## Help Flag Requirements

| Flag | Behavior |
|------|----------|
| `-h` | Short help: description, usage, common examples, pointer to `--help` |
| `--help` | Full help: all flags, all subcommands, detailed examples, links |
| `help` subcommand | Same as `--help`, allows `tool help <command>` pattern |
| No args (interactive) | If tool expects input but receives none from TTY, show help — don't hang |

When `-h` or `--help` is passed, ignore all other flags and just show help.

## Help Text Structure

### Short Help (-h)
```
tool-name — one-line description

Usage: tool-name <command> [flags]

Commands:
  init       Initialize a new project
  build      Build the project
  deploy     Deploy to production

Run 'tool-name help <command>' for details on a specific command.
```

### Full Help (--help)
```
tool-name — one-line description

Detailed description of what the tool does and when to use it.

Usage: tool-name <command> [flags]

Commands:
  init       Initialize a new project
  build      Build the project
  deploy     Deploy to production

Global Flags:
  -h, --help       Show help
  -v, --version    Show version
  -q, --quiet      Suppress non-essential output
      --no-color   Disable color output
      --json       Output as JSON

Examples:
  tool-name init my-project          Create a new project
  tool-name build --watch            Build with file watching
  tool-name deploy --env staging     Deploy to staging

Documentation: https://tool-name.dev/docs
Issues: https://github.com/org/tool-name/issues
```

### Command Help (tool help <cmd>)
```
tool-name build — compile the project

Usage: tool-name build [flags] [path]

Arguments:
  path    Path to project root (default: current directory)

Flags:
  -w, --watch      Watch for changes and rebuild
  -o, --output     Output directory (default: ./dist)
      --minify     Minify output
      --sourcemap  Generate source maps

Examples:
  tool-name build                    Build current project
  tool-name build ./src -o ./out     Build from src to out
  tool-name build --watch --minify   Watch with minification
```

## Help Text Quality Checklist

### Content
- [ ] One-line description explains what the tool does (not how)
- [ ] Examples use realistic values, not `<arg1>` placeholders
- [ ] Examples show output when it helps understanding
- [ ] Most common use case is the first example
- [ ] Flags have descriptions (concise, lowercase, no periods)
- [ ] Default values shown for flags that have them
- [ ] Required vs optional flags clearly distinguished
- [ ] Related flags grouped together
- [ ] Links to full documentation for complex features

### Formatting
- [ ] Fits 80-character terminal width
- [ ] Consistent indentation and alignment
- [ ] Commands and flags sorted logically (frequency or alphabetically)
- [ ] Descriptions begin with lowercase (Heroku convention) or verb
- [ ] No trailing periods on descriptions

## Discoverability Features

### Typo Correction
When a user types a wrong command, suggest the closest match:
```
$ tool-name buidl
Error: unknown command "buidl"

Did you mean "build"?

Run 'tool-name --help' for available commands.
```

### Shell Completions
- Provide `tool-name completion <shell>` for bash, zsh, fish
- Document installation: `eval "$(tool-name completion zsh)"`
- Complete subcommands, flags, and flag values where possible

### Version Information
- `--version` or `-V` shows: tool name, version, build info
- Optionally include: runtime version, OS/arch, commit hash
- Example: `gw 2.1.0 (deno 1.40.2, darwin-arm64, abc1234)`

## What to Flag

- Missing `-h`/`--help` flag
- Help text that hangs when no args provided in interactive terminal
- Examples using abstract placeholders instead of realistic values
- No examples in help text at all
- Flags without descriptions
- Missing default values for optional flags
- No link to documentation or issue tracker
- Inconsistent help formatting across subcommands
- Missing shell completion support
- No typo suggestion on unrecognized commands
- Help text wider than 80 characters
- `--version` missing or providing no useful info
