#!/bin/bash
# A git repo on branch feat/first-token with the Keyring app (race-broken), its .agents/aw config, and the brief.
set -euo pipefail
OVERLAY="race-broken"
FIX="$(cd "$(dirname "$0")/../verify-first-token-broken" && pwd)/fixtures"
export GIT_AUTHOR_NAME="Dev" GIT_AUTHOR_EMAIL="dev@example.com" GIT_COMMITTER_NAME="Dev" GIT_COMMITTER_EMAIL="dev@example.com"
git init -q -b main .
git config user.name Dev; git config user.email dev@example.com; git config commit.gpgsign false
cp -R "$FIX/app/." .
if [ -n "$OVERLAY" ]; then cp -R "$FIX/$OVERLAY/." .; fi
# The app serves on a loopback port; allow binding it inside the agent's Bash sandbox.
mkdir -p .claude && printf '%s\n' '{ "sandbox": { "network": { "allowLocalBinding": true } } }' > .claude/settings.json
echo "data/" > .gitignore; echo ".agent/" >> .gitignore
git add -A && git commit -q -m "feat: keyring app"
git checkout -q -b feat/first-token
mkdir -p .agent/feat-first-token
cat > .agent/feat-first-token/plan.md <<'BRIEF'
# Brief: show a new user their first API token

## Task
Verify the existing first-token onboarding on this branch; no code change.

## Acceptance Criteria
- [ ] AC-1 ui: a brand-new user who signs in for the first time and opens /welcome sees their first API token, ready to copy, and ends up with exactly one token.
- [ ] AC-2 nothing fails while this happens: no error is recorded by the app, and no stray data is left behind.

## File Changes
| Path | Change |
| --- | --- |
| src/welcome.mjs | surface |
BRIEF
node --test >/dev/null 2>&1 || { echo "scaffold: fixture tests are red" >&2; exit 1; }

# macOS only: /usr/bin/git is an xcrun shim the eval's Bash sandbox cannot follow; copy a real git into HOME.
if [ "$(uname)" = Darwin ] && [ "$(command -v git)" = /usr/bin/git ] && DEV=$(xcode-select -p 2>/dev/null) && [ -x "$DEV/usr/bin/git" ]; then
  EG="$HOME/.eval-git"
  mkdir -p "$EG/bin" "$EG/libexec" "$EG/share"
  cp "$DEV/usr/bin/git" "$EG/bin/git"
  cp -R "$DEV/usr/libexec/git-core" "$EG/libexec/git-core"
  [ -d "$DEV/usr/share/git-core" ] && cp -R "$DEV/usr/share/git-core" "$EG/share/git-core"
  RC="export PATH=\"$EG/bin:\$PATH\" GIT_EXEC_PATH=\"$EG/libexec/git-core\" GIT_TEMPLATE_DIR=\"$EG/share/git-core/templates\" GIT_CONFIG_NOSYSTEM=1"
  for f in .zshenv .zshrc .bashrc .bash_profile .profile; do echo "$RC" >> "$HOME/$f"; done
fi
