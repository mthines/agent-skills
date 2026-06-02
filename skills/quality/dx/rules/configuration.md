# Configuration Rules

Configuration determines how a tool adapts to different environments, projects, and preferences.
Well-designed configuration is layered, discoverable, and rarely needed.

## Configuration Precedence

From highest to lowest priority:

| Priority | Source | Use Case |
|----------|--------|----------|
| 1 | Flags | Per-invocation overrides |
| 2 | Environment variables | Per-session/environment settings |
| 3 | Project config file | Team-shared project settings (`.toolrc`, `tool.config.json`) |
| 4 | User config file | Personal preferences (`~/.config/tool/config.json`) |
| 5 | System config file | Machine-wide defaults (`/etc/tool/config`) |
| 6 | Built-in defaults | Sensible out-of-the-box behavior |

**Every config value must be overridable by a flag.** Flags always win.

## Configuration Files

### Location
- **Project level**: `.tool/config.json` or `.toolrc` in project root
- **User level**: Follow [XDG Base Directory Spec](https://specifications.freedesktop.org/basedir-spec/latest/):
  - `$XDG_CONFIG_HOME/tool/config.json` (defaults to `~/.config/tool/`)
  - Fallback: `~/.toolrc` (legacy, but widely understood)
- **Auto-discovery**: Walk up directory tree from `cwd` to find project config

### Format
- Prefer JSON, YAML, or TOML (widely supported, IDE-friendly)
- Provide JSON Schema for IDE autocompletion and validation
- Reference schema in config file: `"$schema": "https://..."`
- Document all options with descriptions and defaults in the schema

### Auto-Creation
- Create default config on first use (with sensible defaults)
- Ask before creating if the tool modifies behavior significantly
- Include comments or schema reference in generated config

### Versioning
- Include a `configVersion` field for schema evolution
- Auto-migrate old configs to new format
- Never lose user data during migration
- Warn when config uses deprecated fields

## Environment Variables

### Naming
- Prefix with tool name: `TOOL_PORT`, `TOOL_DEBUG`
- Uppercase with underscores: `MY_TOOL_CONFIG_PATH`
- Don't commandeer POSIX-standard names

### Standard Variables to Respect
| Variable | Purpose |
|----------|---------|
| `NO_COLOR` | Disable color output |
| `FORCE_COLOR` | Force color even when not TTY |
| `DEBUG` | Enable debug output |
| `EDITOR` / `VISUAL` | Which editor to open |
| `PAGER` | How to page long output |
| `HOME` | User home directory |
| `XDG_CONFIG_HOME` | User config directory |
| `TMPDIR` | Temporary file location |
| `TERM` | Terminal type |
| `SHELL` | User's shell |
| `HTTP_PROXY` / `HTTPS_PROXY` | Network proxy |
| `CI` | Running in CI environment |

### Rules
- Single-line values only (multi-line breaks `env` command)
- Document all recognized env vars in `--help` or docs
- Don't require env vars for basic operation — always provide flag alternatives
- Never store secrets in env vars as primary mechanism (visible via `/proc`, `docker inspect`, CI logs)

## .env Files

- Read `.env` for project-specific, seldom-changed settings
- Don't use as substitute for proper config files
- Not for secrets in production (OK for local development)
- Typically `.gitignore`'d
- Provide `.env.example` with placeholder values

## Configuration Best Practices

### Sensible Defaults
- Tool should work with zero configuration for the common case
- "Convention over configuration" — derive values from project structure
- Auto-detect what you can (git branch, shell, OS, project type)

### Modification Consent
- Ask before modifying files the tool doesn't own (shell rc, git config)
- Prefer creating new files over appending to existing ones
- Use dated comments when modifying shared config: `# Added by tool (2024-01-15)`

### Configuration Display
- Provide `tool config` or `tool config list` to show current resolved config
- Show which source each value came from (flag, env, file, default)
- Support `tool config set <key> <value>` for common settings

## What to Flag

- Missing configuration file support (everything via flags only)
- No XDG compliance (dumping config in `$HOME` root)
- Config changes without user consent
- No way to see current resolved configuration
- Missing JSON Schema for IDE integration
- Env vars not documented in help text
- No auto-detection of obvious values (project root, default branch)
- Config files that silently ignore unknown fields (typo-prone)
- No config migration strategy for schema changes
- Secrets stored in plain text config files without warning
