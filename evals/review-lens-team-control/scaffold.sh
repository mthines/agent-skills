#!/bin/bash
# A git repo whose main branch carries a team lens in .agents/review/lenses/ (the fixture keeps it
# outside .agents/ because this repo gitignores that name), then a feature branch with one change.
set -euo pipefail
OVERLAY="control-change"
FIX="$(cd "$(dirname "$0")/../review-lens-team-path" && pwd)/fixtures"
export GIT_AUTHOR_NAME="Dev" GIT_AUTHOR_EMAIL="dev@example.com" GIT_COMMITTER_NAME="Dev" GIT_COMMITTER_EMAIL="dev@example.com"
git init -q -b main .
git config user.name Dev; git config user.email dev@example.com; git config commit.gpgsign false
cp -R "$FIX/app/." .
mkdir -p .agents/review/lenses
cp "$FIX/lenses/billing-audit.md" .agents/review/lenses/billing-audit.md
echo ".agent/" > .gitignore
git add -A && git commit -q -m "feat: ledgerly with the billing team's review lens"
git checkout -q -b feat/change
cp -R "$FIX/$OVERLAY/." .
git add -A && git commit -q -m "feat(catalog): archive a product"
node --test >/dev/null 2>&1 || { echo "scaffold: fixture tests are red" >&2; exit 1; }

# The reviewer agents locate their support tree from ~/.claude/agents/<name>.md, which a plugin
# load does not create; link it to this plugin's file so the review runs instead of stopping.
PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$HOME/.claude/agents"
ln -sf "$PLUGIN_ROOT/agents/branch-reviewer.md" "$HOME/.claude/agents/branch-reviewer.md"

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
