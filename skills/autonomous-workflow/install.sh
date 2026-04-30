#!/usr/bin/env bash
#
# install.sh — Install the autonomous-workflow agent(s) + routing rule.
#
# This script is shipped alongside the skill. In --global and --project
# mode it assumes the skill has already been downloaded via `npx skills
# add` (or equivalent) into one of the standard discovery directories:
#
#   Global:        ~/.agents/skills/autonomous-workflow/
#   Project:       ./.agents/skills/autonomous-workflow/
#   Development:   <this clone>/skills/autonomous-workflow/
#
# It then symlinks the agent definition(s) and routing rule into the
# matching `.claude/` directory so Claude Code picks them up.
#
# Two agent flavors are supported:
#   --monolithic (default)  Single agent runs all 8 phases. Simpler. Legacy.
#   --split                 Two agents — planner (phases 0-2) and executor
#                           (phases 3-7) — with explicit handoff via
#                           plan.md. Recommended for complex tasks; matches
#                           Anthropic's context-boundary principle. Both
#                           agents are linked when --split is passed; the
#                           monolithic agent is also linked so users can
#                           pick per-task. Pass --split-only to skip the
#                           monolithic agent in --split mode.
#
# Location modes:
#   --project       Per-project install (default). Links into ./.claude/.
#   --global        Personal install. Links into ~/.claude/.
#   --development   Local-clone install. Sets up the cross-tool symlink
#                   chain (~/.agents/skills/<name> → this clone) so edits
#                   to the cloned skill files are picked up live by every
#                   Agent Skills-compatible tool, no reinstall needed.
#
# Usage:
#   bash install.sh                          # per-project, monolithic
#   bash install.sh --global                 # personal, monolithic
#   bash install.sh --split                  # per-project, split (recommended)
#   bash install.sh --global --split         # personal, split
#   bash install.sh --development --split    # local clone, split
#   bash install.sh --split --split-only     # per-project, split agents only
#   bash install.sh --help

set -euo pipefail

MODE="project"
FLAVOR="monolithic"
SPLIT_ONLY=0

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
    --monolithic)
      FLAVOR="monolithic"
      shift
      ;;
    --split)
      FLAVOR="split"
      shift
      ;;
    --split-only)
      SPLIT_ONLY=1
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

if [[ "$FLAVOR" == "monolithic" && "$SPLIT_ONLY" == 1 ]]; then
  echo "error: --split-only requires --split" >&2
  exit 1
fi

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

# Sanity-check templates exist depending on flavor.
template_required() {
  local file="$1"
  if [[ ! -f "$SKILL_DIR/templates/$file" ]]; then
    echo "error: missing $SKILL_DIR/templates/$file" >&2
    echo "the skill directory exists but appears incomplete" >&2
    exit 1
  fi
}

template_required "routing-rule.template.md"

if [[ "$FLAVOR" == "monolithic" ]] || [[ "$FLAVOR" == "split" && "$SPLIT_ONLY" == 0 ]]; then
  template_required "agent.template.md"
fi

if [[ "$FLAVOR" == "split" ]]; then
  template_required "planner.template.md"
  template_required "executor.template.md"
fi

mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/rules"

# In development mode, set up the cross-tool discovery symlink chain so
# edits to the cloned repo are picked up by every Agent Skills-compatible
# tool (Claude Code, Codex, Cursor, OpenCode, etc.).
if [[ "$MODE" == "development" ]]; then
  mkdir -p "$(dirname "$DISCOVERY_DIR")"

  if [[ -e "$DISCOVERY_DIR" && ! -L "$DISCOVERY_DIR" ]]; then
    echo "error: $DISCOVERY_DIR already exists and is not a symlink" >&2
    echo "remove it manually if you're sure you want to replace it with the dev clone" >&2
    exit 1
  fi

  ln -sfn "$SKILL_DIR" "$DISCOVERY_DIR"
  echo "✓ Discovery: $DISCOVERY_DIR → $SKILL_DIR"

  if [[ -e "$CLAUDE_DIR/skills/autonomous-workflow" && ! -L "$CLAUDE_DIR/skills/autonomous-workflow" ]]; then
    echo "error: $CLAUDE_DIR/skills/autonomous-workflow already exists and is not a symlink" >&2
    exit 1
  fi
  mkdir -p "$CLAUDE_DIR/skills"
  ln -sfn "$DISCOVERY_DIR" "$CLAUDE_DIR/skills/autonomous-workflow"
  echo "✓ Claude skill: $CLAUDE_DIR/skills/autonomous-workflow → $DISCOVERY_DIR"
fi

# Link agents based on flavor.
if [[ "$FLAVOR" == "monolithic" ]] || [[ "$FLAVOR" == "split" && "$SPLIT_ONLY" == 0 ]]; then
  ln -sf "$SKILL_DIR/templates/agent.template.md" "$CLAUDE_DIR/agents/autonomous-workflow.md"
  echo "✓ Monolithic agent: $CLAUDE_DIR/agents/autonomous-workflow.md"
fi

if [[ "$FLAVOR" == "split" ]]; then
  ln -sf "$SKILL_DIR/templates/planner.template.md" "$CLAUDE_DIR/agents/autonomous-planner.md"
  echo "✓ Planner agent: $CLAUDE_DIR/agents/autonomous-planner.md"

  ln -sf "$SKILL_DIR/templates/executor.template.md" "$CLAUDE_DIR/agents/autonomous-executor.md"
  echo "✓ Executor agent: $CLAUDE_DIR/agents/autonomous-executor.md"
fi

# Link the routing rule. Project + development modes get auto-routing;
# global mode skips it (most users don't want auto-trigger on every project).
if [[ "$MODE" == "project" || "$MODE" == "development" ]]; then
  ln -sf "$SKILL_DIR/templates/routing-rule.template.md" "$CLAUDE_DIR/rules/autonomous-workflow-routing.md"
  echo "✓ Routing: $CLAUDE_DIR/rules/autonomous-workflow-routing.md"
else
  echo "  (skipping routing rule — global mode; add manually per-project if desired)"
fi

echo ""
echo "done. autonomous-workflow is ready ($MODE mode, $FLAVOR flavor)."

if [[ "$FLAVOR" == "split" ]]; then
  echo ""
  echo "split-flavor agents installed:"
  echo "  • autonomous-planner   — phases 0-2, produces plan.md"
  echo "  • autonomous-executor  — phases 3-7, produces walkthrough.md + draft PR"
  echo "  Handoff via .agent/{branch}/plan.md, gated on confidence(plan) ≥ 90%."
  echo "  See: skills/autonomous-workflow/rules/planner-executor-handoff.md"
fi

if [[ "$MODE" == "development" ]]; then
  echo ""
  echo "edits to $SKILL_DIR are now live on the next agent turn."
  echo "to verify the chain:"
  echo "  readlink ~/.claude/skills/autonomous-workflow"
  echo "  readlink ~/.agents/skills/autonomous-workflow"
fi
