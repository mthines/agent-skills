---
for: reviewer
lens-version: 1
applies-to: "**/cli/**, **/bin/**, **/*.sh, **/Makefile, **/Taskfile.yml, **/justfile, **/*-cli.ts, **/scripts/**"
---

# Developer Experience — Review Lens

## Trigger

Fires when the diff touches a CLI entry point, a shell script, a build/task runner (Make / Just / Task), or any code under `bin/` or `scripts/`. Also fires on changes to help text, flag parsing, exit codes, or stdout/stderr output.

## Checklist

- [ ] `--help` / `-h` exists, lists every flag with a one-line description, and shows a USAGE line; works without any other arguments.
- [ ] `--version` / `-v` exists and prints `<name> <semver>` to stdout.
- [ ] Errors and progress messages go to stderr; primary machine-readable output goes to stdout — never interleaved.
- [ ] Exit codes follow convention: `0` success, `1` general error, `2` usage error (bad flags/args), `126` not executable, `127` not found, `130` Ctrl-C.
- [ ] Destructive operations (delete, overwrite, push, drop) require confirmation unless `--force` / `--yes` is passed; severe ops require explicit resource naming.
- [ ] Color output honours `NO_COLOR` env and `--no-color` flag; TTY detection disables color when output is piped.
- [ ] Scriptable commands support `--json` for machine-readable output.
- [ ] Help text and flag descriptions use imperative voice ("Print version", "List users") — not "Prints the version".
- [ ] Bash scripts start with `set -euo pipefail`; all variables are quoted (`"$var"`); `cd` is paired with `|| exit 1`.
- [ ] Secrets are never accepted as flag values (visible in `ps`) — read from stdin, env, or a file path instead.
- [ ] Long-running operations (>1 s) show a spinner or progress; operations >5 s show ETA and accept Ctrl-C (SIGINT exits 130, not 1).
- [ ] No `eval` of user-supplied input; no string-concatenated command construction — use arrays or `--` to terminate flag parsing.

## Severity hints

- **Must-fix**: secret accepted as flag value; `eval` on user input; destructive op without confirmation or `--yes`; wrong exit code on Ctrl-C (130 expected).
- **Should-fix**: missing `--help` / `--version`; stderr/stdout misused; `NO_COLOR` ignored; missing `set -euo pipefail` in bash script; help text not imperative.
- **Nice-to-have**: missing `--json` on scriptable command; missing progress on long op; flag naming drift from clig.dev conventions.
