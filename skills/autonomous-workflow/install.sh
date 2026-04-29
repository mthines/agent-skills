#!/usr/bin/env bash
#
# install.sh — Install the autonomous-workflow agent + routing rule.
#
# This script is shipped alongside the skill. It assumes the skill has
# already been downloaded via `npx skills add` (or equivalent) into one
# of the standard discovery directories:
#
#   Global:   ~/.agents/skills/autonomous-workflow/
#   Project:  ./.agents/skills/autonomous-workflow/
#
# It then symlinks the agent definition and routing rule templates into
# the matching `.claude/` directory so Claude Code picks them up.
#
# Usage:
#   bash install.sh             # per-project install (current directory)
#   bash install.sh --global    # personal install (all projects)
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

if [[ "$MODE" == "global" ]]; then
  CLAUDE_DIR="$HOME/.claude"
  SKILL_DIR="$HOME/.agents/skills/autonomous-workflow"
else
  CLAUDE_DIR="$(pwd)/.claude"
  SKILL_DIR="$(pwd)/.agents/skills/autonomous-workflow"
fi

# Verify the skill is actually present where we expect it.
if [[ ! -d "$SKILL_DIR" ]]; then
  echo "error: autonomous-workflow skill not found at: $SKILL_DIR" >&2
  echo "" >&2
  echo "install the skill first:" >&2
  if [[ "$MODE" == "global" ]]; then
    echo "  npx skills add https://github.com/mthines/agent-skills \\" >&2
    echo "    --skill autonomous-workflow create-plan create-walkthrough confidence \\" >&2
    echo "            code-quality holistic-analysis tdd ux update-claude \\" >&2
    echo "            review-changes create-pr ci-auto-fix \\" >&2
    echo "    --global --yes" >&2
  else
    echo "  npx skills add https://github.com/mthines/agent-skills \\" >&2
    echo "    --skill autonomous-workflow create-plan create-walkthrough confidence \\" >&2
    echo "            code-quality holistic-analysis tdd ux update-claude \\" >&2
    echo "            review-changes create-pr ci-auto-fix \\" >&2
    echo "    --yes" >&2
  fi
  exit 1
fi

mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/rules"

# Link the agent definition (both modes).
ln -sf "$SKILL_DIR/templates/agent.template.md" "$CLAUDE_DIR/agents/autonomous-workflow.md"
echo "✓ Agent installed: $CLAUDE_DIR/agents/autonomous-workflow.md"

# Link the routing rule (project mode only — global users typically don't want
# auto-routing on every project).
if [[ "$MODE" == "project" ]]; then
  ln -sf "$SKILL_DIR/templates/routing-rule.template.md" "$CLAUDE_DIR/rules/autonomous-workflow-routing.md"
  echo "✓ Routing installed: $CLAUDE_DIR/rules/autonomous-workflow-routing.md"
else
  echo "  (skipping routing rule — global mode; add manually per-project if desired)"
fi

echo ""
echo "done. autonomous-workflow is ready ($MODE mode)."
