#!/usr/bin/env bash
#
# install.sh — Install the autonomous-workflow agent + routing rule.
#
# This script is shipped alongside the skill. In --global and --project
# mode it assumes the skill has already been downloaded via `npx skills
# add` (or equivalent) into one of the standard discovery directories:
#
#   Global:        ~/.agents/skills/autonomous-workflow/
#   Project:       ./.agents/skills/autonomous-workflow/
#   Development:   <this clone>/skills/autonomous-workflow/
#
# It then symlinks the agent definition and routing rule templates into
# the matching `.claude/` directory so Claude Code picks them up.
#
# Modes:
#   --project      Per-project install (default). Links into ./.claude/.
#   --global       Personal install. Links into ~/.claude/.
#   --development  Local-clone install. Sets up the cross-tool symlink
#                  chain (~/.agents/skills/<name> → this clone) so edits
#                  to the cloned skill files are picked up live by every
#                  Agent Skills-compatible tool, no reinstall needed.
#                  Use this when you've cloned agent-skills.git and want
#                  to hack on the autonomous-workflow skill itself.
#
# Usage:
#   bash install.sh                 # per-project install (current directory)
#   bash install.sh --global        # personal install (all projects)
#   bash install.sh --development   # local-clone install (for skill development)
#   bash install.sh --help

set -euo pipefail

MODE="project"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global)
      MODE="global"
      shift
      ;;
    --project)
      MODE="project"
      shift
      ;;
    --development|--dev)
      MODE="development"
      shift
      ;;
    -h|--help)
      sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# *//;s/^#//'
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      echo "run with --help to see usage" >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  global)
    CLAUDE_DIR="$HOME/.claude"
    SKILL_DIR="$HOME/.agents/skills/autonomous-workflow"
    ;;
  project)
    CLAUDE_DIR="$(pwd)/.claude"
    SKILL_DIR="$(pwd)/.agents/skills/autonomous-workflow"
    ;;
  development)
    # The cloned skill directory is wherever this script lives.
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    CLAUDE_DIR="$HOME/.claude"
    SKILL_DIR="$SCRIPT_DIR"
    DISCOVERY_DIR="$HOME/.agents/skills/autonomous-workflow"
    ;;
esac

# Verify the skill is actually present where we expect it.
if [[ ! -d "$SKILL_DIR" ]]; then
  echo "error: autonomous-workflow skill not found at: $SKILL_DIR" >&2
  echo "" >&2
  case "$MODE" in
    global)
      echo "install the skill first:" >&2
      echo "  npx skills add https://github.com/mthines/agent-skills \\" >&2
      echo "    --skill autonomous-workflow create-plan create-walkthrough confidence \\" >&2
      echo "            code-quality holistic-analysis tdd ux update-claude \\" >&2
      echo "            review-changes create-pr ci-auto-fix \\" >&2
      echo "    --global --yes" >&2
      ;;
    project)
      echo "install the skill first:" >&2
      echo "  npx skills add https://github.com/mthines/agent-skills \\" >&2
      echo "    --skill autonomous-workflow create-plan create-walkthrough confidence \\" >&2
      echo "            code-quality holistic-analysis tdd ux update-claude \\" >&2
      echo "            review-changes create-pr ci-auto-fix \\" >&2
      echo "    --yes" >&2
      ;;
    development)
      echo "the script can't locate its own directory — this is a bug." >&2
      ;;
  esac
  exit 1
fi

# Sanity-check that the skill has the templates we need to link.
if [[ ! -f "$SKILL_DIR/templates/agent.template.md" ]]; then
  echo "error: missing $SKILL_DIR/templates/agent.template.md" >&2
  echo "the skill directory exists but appears incomplete" >&2
  exit 1
fi

if [[ ! -f "$SKILL_DIR/templates/routing-rule.template.md" ]]; then
  echo "error: missing $SKILL_DIR/templates/routing-rule.template.md" >&2
  echo "the skill directory exists but appears incomplete" >&2
  exit 1
fi

mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/rules"

# In development mode, set up the cross-tool discovery symlink chain so
# edits to the cloned repo are picked up by every Agent Skills-compatible
# tool (Claude Code, Codex, Cursor, OpenCode, etc.).
if [[ "$MODE" == "development" ]]; then
  mkdir -p "$(dirname "$DISCOVERY_DIR")"

  # If the discovery path already exists and isn't a symlink we'd overwrite,
  # bail rather than clobber a previously-installed skill.
  if [[ -e "$DISCOVERY_DIR" && ! -L "$DISCOVERY_DIR" ]]; then
    echo "error: $DISCOVERY_DIR already exists and is not a symlink" >&2
    echo "remove it manually if you're sure you want to replace it with the dev clone" >&2
    exit 1
  fi

  ln -sfn "$SKILL_DIR" "$DISCOVERY_DIR"
  echo "✓ Discovery: $DISCOVERY_DIR → $SKILL_DIR"

  # Mirror into Claude Code's skills dir.
  if [[ -e "$CLAUDE_DIR/skills/autonomous-workflow" && ! -L "$CLAUDE_DIR/skills/autonomous-workflow" ]]; then
    echo "error: $CLAUDE_DIR/skills/autonomous-workflow already exists and is not a symlink" >&2
    exit 1
  fi
  mkdir -p "$CLAUDE_DIR/skills"
  ln -sfn "$DISCOVERY_DIR" "$CLAUDE_DIR/skills/autonomous-workflow"
  echo "✓ Claude skill: $CLAUDE_DIR/skills/autonomous-workflow → $DISCOVERY_DIR"
fi

# Link the agent definition (all three modes).
ln -sf "$SKILL_DIR/templates/agent.template.md" "$CLAUDE_DIR/agents/autonomous-workflow.md"
echo "✓ Agent: $CLAUDE_DIR/agents/autonomous-workflow.md"

# Link the routing rule. Project + development modes get auto-routing;
# global mode skips it (most users don't want auto-trigger on every project).
if [[ "$MODE" == "project" || "$MODE" == "development" ]]; then
  ln -sf "$SKILL_DIR/templates/routing-rule.template.md" "$CLAUDE_DIR/rules/autonomous-workflow-routing.md"
  echo "✓ Routing: $CLAUDE_DIR/rules/autonomous-workflow-routing.md"
else
  echo "  (skipping routing rule — global mode; add manually per-project if desired)"
fi

echo ""
echo "done. autonomous-workflow is ready ($MODE mode)."

if [[ "$MODE" == "development" ]]; then
  echo ""
  echo "edits to $SKILL_DIR are now live on the next agent turn."
  echo "to verify the chain:"
  echo "  readlink ~/.claude/skills/autonomous-workflow"
  echo "  readlink ~/.agents/skills/autonomous-workflow"
fi
