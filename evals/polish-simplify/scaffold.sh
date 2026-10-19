#!/bin/bash
# Build a git repo with a local bare `origin` whose `main` is the base, and a checked-out
# feature branch whose two commits add the shipping module, extend cart.mjs, and add tests.
set -euo pipefail
FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export GIT_AUTHOR_NAME="Dev" GIT_AUTHOR_EMAIL="dev@example.com"
export GIT_COMMITTER_NAME="Dev" GIT_COMMITTER_EMAIL="dev@example.com"

git init -q -b main .
git config user.name "Dev"
git config user.email "dev@example.com"
git config commit.gpgsign false
cp -R "$FIX/base/." .
git add -A && git commit -q -m "feat: cart subtotal"

# The bare origin lives inside the workspace so the sandboxed agent can fetch it; it is untracked noise, so exclude it.
git init -q --bare .origin.git
echo ".origin.git/" >> .git/info/exclude
git remote add origin "$PWD/.origin.git"
git push -q origin main
git fetch -q origin

git checkout -q -b feat/shipping-cost
cp "$FIX/feature/src/shipping.mjs" src/shipping.mjs
cp "$FIX/feature/test/shipping.test.mjs" test/shipping.test.mjs
git add -A && git commit -q -m "feat: shipping cost and free-shipping threshold"
cp "$FIX/feature/src/cart.mjs" src/cart.mjs
git add -A && git commit -q -m "feat: per-line totals with discount and tax"
git branch -q --set-upstream-to=origin/main 2>/dev/null || true

node --test >/dev/null 2>&1 || { echo "scaffold: fixture tests are red" >&2; exit 1; }

# macOS only: /usr/bin/git is an xcrun shim, and the eval's Bash sandbox can neither read the Xcode /
# Command Line Tools directory it forwards to nor write xcrun's cache under the user TMPDIR, so every
# git call inside the run fails ("Failed to locate 'git'"). Copy that git into the run's HOME (which
# the sandbox can read) and put it first on PATH through the shell rc files the Bash tool sources.
# Linux, or a macOS with a non-shim git, is untouched.
if [ "$(uname)" = Darwin ] && [ "$(command -v git)" = /usr/bin/git ] && DEV=$(xcode-select -p 2>/dev/null) && [ -x "$DEV/usr/bin/git" ]; then
  EG="$HOME/.eval-git"
  mkdir -p "$EG/bin" "$EG/libexec" "$EG/share"
  cp "$DEV/usr/bin/git" "$EG/bin/git"
  cp -R "$DEV/usr/libexec/git-core" "$EG/libexec/git-core"
  [ -d "$DEV/usr/share/git-core" ] && cp -R "$DEV/usr/share/git-core" "$EG/share/git-core"
  RC="export PATH=\"$EG/bin:\$PATH\" GIT_EXEC_PATH=\"$EG/libexec/git-core\" GIT_TEMPLATE_DIR=\"$EG/share/git-core/templates\" GIT_CONFIG_NOSYSTEM=1"
  for f in .zshenv .zshrc .bashrc .bash_profile .profile; do echo "$RC" >> "$HOME/$f"; done
fi
