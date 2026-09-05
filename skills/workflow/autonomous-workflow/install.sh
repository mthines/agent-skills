#!/usr/bin/env bash
#
# install.sh — Install the autonomous-workflow agents + routing rule.
#
# This script is shipped alongside the skill. In --global and --project
# mode it assumes the skill has already been downloaded via `npx skills
# add` (or equivalent) into one of the standard discovery directories:
#
#   Global:        ~/.agents/skills/autonomous-workflow/
#   Project:       ./.agents/skills/autonomous-workflow/
#   Development:   <this clone>/skills/autonomous-workflow/
#
# It then symlinks the agent definitions and the routing rule into the
# matching `.claude/` directory so Claude Code picks them up. All agents
# use the `aw-` namespace prefix (short for "autonomous-workflow") so they
# group together in `.claude/agents/` and stay distinct from unrelated
# agents:
#
#   • aw-planner   — phases 0-2 (validation, planning,
#                   worktree + plan.md generation).
#                   Terminal artifact: .agent/{branch}/plan.md,
#                   gated on confidence(plan) ≥ 90%.
#   • aw-executor  — phases 3-7 (implement, test, docs, PR, CI).
#                   Terminal artifact:
#                   .agent/{branch}/walkthrough.md + draft PR.
#
# The handoff between them is mediated by plan.md. See
# rules/planner-executor-handoff.md for the contract.
#
# The `aw` dispatcher is deliberately NOT in that list — it is a SKILL
# (aw/SKILL.md), invoked as /aw, so it runs in the caller's context and
# dispatches the two agents from there. See CLAUDE.md → "The dispatcher is
# a skill, not an agent".
#
# It is still THIS script's job to link it, in every mode. Skills are
# discovered under a flat installed name, so the nested aw/SKILL.md is not
# reachable as /aw from the autonomous-workflow skill directory alone — the
# normal skill-install path cannot place it the way it places a top-level
# skill. And the legacy-cleanup pass below removes the pre-v3.23 `aw` AGENT
# in every mode, so a --global / --project install that did not create the
# replacement link would delete /aw outright.
#
# Modes:
#   --project      Per-project install (default). Links into ./.claude/.
#   --global       Personal install. Links into ~/.claude/.
#   --development  Local-clone install. Sets up the cross-tool symlink
#                  chain (~/.agents/skills/<name> → this clone) so edits
#                  to the cloned skill files are picked up live by every
#                  Agent Skills-compatible tool, no reinstall needed.
#
# Flags:
#   -q, --quiet    Suppress success output (errors still print to stderr).
#                  Used when invoked from a parent installer.
#
# Usage:
#   bash install.sh                 # per-project install (current directory)
#   bash install.sh --global        # personal install (all projects)
#   bash install.sh --development   # local-clone install (skill development)
#   bash install.sh --help

set -euo pipefail

MODE="project"
QUIET=0

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
    -q|--quiet)
      QUIET=1
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

vlog() { (( QUIET )) || echo "$@"; }

case "$MODE" in
  global)
    CLAUDE_DIR="$HOME/.claude"
    # Try .claude/skills/ first (--agent claude-code layout),
    # then fall back to .agents/skills/ (universal layout).
    if [[ -d "$HOME/.claude/skills/autonomous-workflow" ]]; then
      SKILL_DIR="$HOME/.claude/skills/autonomous-workflow"
    else
      SKILL_DIR="$HOME/.agents/skills/autonomous-workflow"
    fi
    ;;
  project)
    CLAUDE_DIR="$(pwd)/.claude"
    if [[ -d "$(pwd)/.claude/skills/autonomous-workflow" ]]; then
      SKILL_DIR="$(pwd)/.claude/skills/autonomous-workflow"
    else
      SKILL_DIR="$(pwd)/.agents/skills/autonomous-workflow"
    fi
    ;;
  development)
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
      echo "    --skill autonomous-workflow aw-create-plan aw-create-walkthrough confidence \\" >&2
      echo "            code-quality holistic-analysis tdd ux docs \\" >&2
      echo "            review-changes create-pr ci-auto-fix \\" >&2
      echo "    --agent claude-code \\" >&2
      echo "    --global --yes" >&2
      ;;
    project)
      echo "install the skill first:" >&2
      echo "  npx skills add https://github.com/mthines/agent-skills \\" >&2
      echo "    --skill autonomous-workflow aw-create-plan aw-create-walkthrough confidence \\" >&2
      echo "            code-quality holistic-analysis tdd ux docs \\" >&2
      echo "            review-changes create-pr ci-auto-fix \\" >&2
      echo "    --agent claude-code \\" >&2
      echo "    --yes" >&2
      ;;
    development)
      echo "the script can't locate its own directory — this is a bug." >&2
      ;;
  esac
  exit 1
fi

# Sanity-check the templates exist.
template_required() {
  local file="$1"
  if [[ ! -f "$SKILL_DIR/templates/$file" ]]; then
    echo "error: missing $SKILL_DIR/templates/$file" >&2
    echo "the skill directory exists but appears incomplete" >&2
    exit 1
  fi
}

template_required "aw-planner.agent.md"
template_required "aw-executor.agent.md"
template_required "aw-tester.agent.md"
template_required "routing.rule.md"

# Skills nested inside this skill directory. They are not templates, so they
# need their own existence check — without it an incomplete skill directory
# yields a dangling symlink instead of an error.
NESTED_SKILLS=(aw aw-setup aw-tester-chrome)

for nested in "${NESTED_SKILLS[@]}"; do
  if [[ ! -f "$SKILL_DIR/$nested/SKILL.md" ]]; then
    echo "error: missing $SKILL_DIR/$nested/SKILL.md" >&2
    echo "the skill directory exists but appears incomplete" >&2
    exit 1
  fi
done

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
  vlog "✓ Discovery: $DISCOVERY_DIR → $SKILL_DIR"

  if [[ -e "$CLAUDE_DIR/skills/autonomous-workflow" && ! -L "$CLAUDE_DIR/skills/autonomous-workflow" ]]; then
    echo "error: $CLAUDE_DIR/skills/autonomous-workflow already exists and is not a symlink" >&2
    exit 1
  fi
  mkdir -p "$CLAUDE_DIR/skills"
  ln -sfn "$DISCOVERY_DIR" "$CLAUDE_DIR/skills/autonomous-workflow"
  vlog "✓ Claude skill: $CLAUDE_DIR/skills/autonomous-workflow → $DISCOVERY_DIR"

  # Development mode adds the cross-tool discovery hop for each nested skill,
  # so Codex / Cursor / OpenCode see them too. The Claude-side links are
  # created for every mode below.
  mkdir -p "$HOME/.agents/skills"
  for nested in "${NESTED_SKILLS[@]}"; do
    if [[ -e "$HOME/.agents/skills/$nested" && ! -L "$HOME/.agents/skills/$nested" ]]; then
      echo "error: $HOME/.agents/skills/$nested already exists and is not a symlink" >&2
      exit 1
    fi
    ln -sfn "$SKILL_DIR/$nested" "$HOME/.agents/skills/$nested"
  done
  NESTED_LINK_BASE="$HOME/.agents/skills"
fi

# Link every nested skill in EVERY mode. Skills are discovered under a FLAT
# installed name, so a nested `.claude/skills/autonomous-workflow/aw/SKILL.md`
# is not found as `/aw`. The normal skill-install path cannot reach any of them
# the way it reaches a top-level skill, and this script has to place them —
# which is why the loop covers all three rather than just the dispatcher:
#
#   aw               the dispatcher (a skill, not an agent — see CLAUDE.md →
#                    "The dispatcher is a skill, not an agent"). Load-bearing:
#                    the legacy cleanup below removes the pre-v3.23 `aw` AGENT
#                    unconditionally, so a --global / --project upgrade that
#                    skipped this link would delete /aw and leave no way back.
#   aw-setup         scaffolds .claude/aw-targets/ for aw-tester. The summary
#                    below tells the user to run it, and aw-planner HALTS on a
#                    UI task until an aw-target exists while being forbidden to
#                    scaffold one itself — so an unlinked /aw-setup is a dead
#                    end with no recovery path, not a missing convenience.
#   aw-tester-chrome the in-session Chrome runner preview-spec selects when the
#                    extension is connected.
mkdir -p "$CLAUDE_DIR/skills"
for nested in "${NESTED_SKILLS[@]}"; do
  if [[ -e "$CLAUDE_DIR/skills/$nested" && ! -L "$CLAUDE_DIR/skills/$nested" ]]; then
    echo "error: $CLAUDE_DIR/skills/$nested already exists and is not a symlink" >&2
    exit 1
  fi
  ln -sfn "${NESTED_LINK_BASE:-$SKILL_DIR}/$nested" "$CLAUDE_DIR/skills/$nested"
done
vlog "✓ Dispatcher:   $CLAUDE_DIR/skills/aw (opt-in entry point; tier routing + self-improvement loop)"
vlog "✓ Nested skills: $CLAUDE_DIR/skills/{aw-setup,aw-tester-chrome}"

# Clean up legacy agent symlinks from older installs. We only remove them when
# they're symlinks pointing at our templates — never touch hand-authored files.
#
#   autonomous-{planner,executor}.md — pre-`aw-` namespace names.
#   aw.md                            — the dispatcher was an agent until v3.23;
#                                      it is now the `aw` SKILL linked above.
#                                      Leaving the agent in place would put two
#                                      `aw` entries with near-identical
#                                      auto-trigger descriptions in the harness.
for legacy in "autonomous-planner.md:planner.template.md" \
              "autonomous-executor.md:executor.template.md" \
              "aw.md:aw.agent.md"; do
  legacy_name="${legacy%%:*}"
  legacy_target="${legacy##*:}"
  legacy_path="$CLAUDE_DIR/agents/$legacy_name"
  if [[ -L "$legacy_path" ]] && [[ "$(readlink "$legacy_path")" == *"/templates/$legacy_target" ]]; then
    rm "$legacy_path"
    vlog "✓ Removed legacy:  $legacy_path (renamed to aw- prefix)"
  fi
done

# Link the agent definitions under the `aw-` namespace
# (short for "autonomous-workflow"). The dispatcher is NOT here — it is the
# `aw` skill (see the dev-mode block above and CLAUDE.md).
ln -sf "$SKILL_DIR/templates/aw-planner.agent.md" "$CLAUDE_DIR/agents/aw-planner.md"
vlog "✓ Planner agent:  $CLAUDE_DIR/agents/aw-planner.md"

ln -sf "$SKILL_DIR/templates/aw-executor.agent.md" "$CLAUDE_DIR/agents/aw-executor.md"
vlog "✓ Executor agent: $CLAUDE_DIR/agents/aw-executor.md"

ln -sf "$SKILL_DIR/templates/aw-tester.agent.md" "$CLAUDE_DIR/agents/aw-tester.md"
vlog "✓ Tester agent:   $CLAUDE_DIR/agents/aw-tester.md (spec-driven UI verification; dispatched by executor in Phase 4)"

# No repo-side memory scaffolding — fast-tier lessons live in LoreKit (the
# `memory.*` MCP tools), scope `global` for universal lessons so they accumulate
# per-user across every project. LoreKit creates the scope lazily on first write.

# Link the routing rule. Project + development modes get auto-routing;
# global mode skips it (most users don't want auto-trigger on every project).
if [[ "$MODE" == "project" || "$MODE" == "development" ]]; then
  ln -sf "$SKILL_DIR/templates/routing.rule.md" "$CLAUDE_DIR/rules/autonomous-workflow-routing.md"
  vlog "✓ Routing:        $CLAUDE_DIR/rules/autonomous-workflow-routing.md"
else
  vlog "  (skipping routing rule — global mode; add manually per-project if desired)"
fi

vlog ""
vlog "done. autonomous-workflow is ready ($MODE mode)."
vlog ""
vlog "dispatcher (a SKILL, not an agent — runs in your context):"
vlog "  • /aw          — detects tier (Micro/Lite/Full) + owns the lessons loop"
vlog ""
vlog "three agents installed (aw- = autonomous-workflow namespace):"
vlog "  • aw-planner   — phases 0-2, produces .agent/{branch}/plan.md (Full tier)"
vlog "  • aw-executor  — phases 3-7, produces walkthrough.md + draft PR (Full tier)"
vlog "  • aw-tester    — spec-driven UI verification; dispatched by executor in Phase 4 (before lint/type/test)"
vlog "  Micro/Lite run single-pass via aw; Full hands off planner → executor (gated on confidence(plan) ≥ 90%)."
vlog "  See: skills/workflow/autonomous-workflow/rules/planner-executor-handoff.md"
vlog ""
vlog "UI verification setup (one-time, per project):"
vlog "  Run /aw-setup to scaffold .claude/aw-targets/local.yml before the first UI autonomous task."
vlog "  See: skills/workflow/autonomous-workflow/aw-setup/SKILL.md"

if [[ "$MODE" == "development" ]]; then
  vlog ""
  vlog "edits to $SKILL_DIR are now live on the next agent turn."
  vlog "to verify the chain:"
  vlog "  readlink ~/.claude/skills/autonomous-workflow"
  vlog "  readlink ~/.agents/skills/autonomous-workflow"
fi
