# Distribution Rules

Installation is the first DX touchpoint. If developers can't install your tool
easily, they won't use it — no matter how good it is.

## Installation Principles

### Zero-to-Running Speed
- One command to install, zero to configure for basic use
- Tool works immediately after installation with sensible defaults
- First-run experience guides users: "Run `tool init` to get started"

### Multiple Channels
Offer installation via the package managers your audience already uses:

| Audience | Channel | Example |
|----------|---------|---------|
| Node developers | npm/yarn/pnpm | `npm install -g @org/tool` |
| macOS users | Homebrew | `brew install org/tap/tool` |
| Linux users | apt/yum/AUR | `yay -S tool` |
| Rust developers | cargo | `cargo install tool` |
| Go developers | go install | `go install github.com/org/tool@latest` |
| Anyone | Standalone binary | Download from GitHub releases |
| CI/Docker | curl pipe | `curl -fsSL https://tool.dev/install.sh | bash` |

### Single Binary Distribution
- Prefer compiled, self-contained binaries when possible (no runtime dependencies)
- Cross-compile for major platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64
- Platform auto-detection in install scripts
- Set executable permissions automatically

## Version Management

### Semantic Versioning
- Follow [semver](https://semver.org): `MAJOR.MINOR.PATCH`
- Breaking changes = major version bump
- New features = minor version bump
- Bug fixes = patch version bump

### Version Display
```
$ tool --version
tool 2.1.0 (deno 1.40.2, darwin-arm64, abc1234)
```
Include: tool version, runtime version (if applicable), platform, commit hash.

### Update Notifications
- Check for updates periodically (not on every run — cache for 24h)
- Show non-blocking notice: "Update available: 2.1.0 → 2.2.0. Run `tool update`"
- Print to `stderr` so it doesn't break piped output
- Provide `--no-update-check` flag and env var to disable
- Never auto-update without explicit consent

## Deprecation & Breaking Changes

### Deprecation Process
1. Warn when deprecated flag/command is used (to stderr)
2. Suggest the replacement: "Warning: --legacy is deprecated, use --format instead"
3. Keep deprecated feature for at least one major version
4. Remove in next major version with clear migration guide

### Breaking Change Communication
- CHANGELOG with clear migration steps
- `tool migrate` command if automated migration is possible
- Pre-release versions (`--next`, `--beta`) for early testing

## Shell Integration

### Install Pattern
```bash
# Eval-based (dynamic, no permanent changes needed)
eval "$(tool shell-init)"

# Or add to shell rc file
echo 'eval "$(tool shell-init)"' >> ~/.zshrc
```

### Completions
- Generate completions for bash, zsh, fish
- `tool completion <shell>` outputs completion script
- Document installation for each shell
- Test completions actually work after installation

## Release Process

### Checksums & Verification
- Provide SHA-256 checksums for all binaries
- Optionally sign releases (GPG or sigstore)
- Publish checksums alongside release artifacts

### CI/CD Automation
- Automated builds for all target platforms
- Automated testing before release
- Automated publishing to package registries
- Release notes generated from commits/PRs

## Analytics & Telemetry

**Core rule**: Do not phone home usage or crash data without explicit consent.

### If You Collect Data
- Be explicit about: what's collected, why, anonymization method, retention period
- Prefer opt-in; if opt-out, clearly communicate on first run and in docs
- Provide simple disable mechanism (env var + flag + config)
- Never collect in CI by default (check `CI` env var)

### Alternatives to Telemetry
- Instrument web documentation (what people search for)
- Track downloads by OS/platform (rough usage metric)
- Ask users directly for feedback
- GitHub issues and discussions

## Uninstallation

- Document how to uninstall at the bottom of install instructions
- Provide `tool uninstall` or clear manual steps
- Clean up: binaries, config files, cache, shell modifications
- Don't leave orphaned files after uninstall

## What to Flag

- Installation requires more than one command
- No pre-built binaries (source compilation required for non-developer users)
- Missing platform support (no macOS, no Linux, no ARM)
- No `--version` flag
- No update mechanism or notification
- Deprecated features removed without warning period
- Shell integration that permanently modifies rc files without asking
- Missing checksums for binary releases
- No uninstall documentation or mechanism
- Install script that requires `sudo` without explanation
- Post-install requiring manual configuration for basic use
