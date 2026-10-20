#!/usr/bin/env bash
# Wire every skill in skills/ and every agent in agents/ into the
# two-tier symlink chain described in CLAUDE.md:
#
#   ~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <repo>/skills/<category>/<name>
#   ~/.claude/agents/<name>.md  →  ~/.agents/agents/<name>.md  →  <repo>/agents/<name>.md
#
# Skills are discovered recursively under skills/ — any directory
# containing a SKILL.md is treated as a skill, so flat layouts and
# nested category layouts both work.
#
# Safe to re-run. Skips entries that are already linked correctly,
# repairs broken or wrong-target symlinks, refuses to touch real
# files or directories that would otherwise be overwritten.
#
# Prunes stale links left behind by deleted or renamed skills/agents:
# a dangling ~/.agents link that points into this repo, and a dangling
# ~/.claude link that points into ~/.agents. Nothing else is removed —
# real files, live links, and links owned by other tools are untouched.
#
# Usage:
#   scripts/sync-symlinks.sh                  # apply changes (verbose per-action log)
#   scripts/sync-symlinks.sh tdd pr-reviewer  # only these skills/agents (agent `.md` optional)
#   scripts/sync-symlinks.sh --aw             # only autonomous-workflow + its companions
#   scripts/sync-symlinks.sh --aw docs        # names add to the --aw bundle
#   scripts/sync-symlinks.sh --dry-run        # preview only, table view
#   scripts/sync-symlinks.sh -n               # short form of --dry-run
#   scripts/sync-symlinks.sh --no-prune       # keep dangling links from deleted skills

set -euo pipefail

usage() {
  echo "usage: $0 [--aw] [--dry-run|-n] [--no-prune] [name ...]" >&2
}

DRY_RUN=0
AW_ONLY=0
PRUNE=1
declare -a NAMES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-n) DRY_RUN=1; shift ;;
    --aw)         AW_ONLY=1; shift ;;
    --no-prune)   PRUNE=0; shift ;;
    -h|--help)    usage; exit 0 ;;
    -*)
      echo "error: unknown argument: $1" >&2
      usage
      exit 1
      ;;
    *)            NAMES+=("${1%.md}"); shift ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_SKILLS_DIR="$HOME/.agents/skills"
AGENTS_AGENTS_DIR="$HOME/.agents/agents"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
CLAUDE_AGENTS_DIR="$HOME/.claude/agents"

# Curated bundle for --aw: the autonomous-workflow skill plus the companion
# skills documented in skills/workflow/autonomous-workflow/README.md, and the
# agents the workflow dispatches to (reviewer / pr-reviewer).
#
# The aw-planner / aw-executor / aw-tester agent symlinks are created by the
# autonomous-workflow install.sh, which runs as part of the install.sh
# discovery pass at the bottom of this script. The `aw` dispatcher is a SKILL
# (skills/workflow/autonomous-workflow/aw/), not an agent, so it is linked here
# by the normal recursive skill discovery.
AW_SKILLS=(
  autonomous-workflow
  aw
  aw-setup
  aw-tester-chrome
  aw-create-plan
  aw-create-walkthrough
  confidence
  code-quality
  holistic-analysis
  tdd
  ux
  docs
  review-loop
  implement-suggestion
  create-pr
  ci-auto-fix
  persistent-memory
)
AW_AGENTS=(
  pr-reviewer.md
)

in_aw_set() {
  local kind="$1" name="$2"
  local item
  if (( ! AW_ONLY )); then
    return 1
  elif [[ "$kind" == "skill" ]]; then
    for item in "${AW_SKILLS[@]}"; do
      [[ "$item" == "$name" ]] && return 0
    done
  else
    for item in "${AW_AGENTS[@]}"; do
      [[ "$item" == "$name" ]] && return 0
    done
  fi
  return 1
}

# in_names <name> — true when <name> (agent `.md` stripped) was passed as an argument.
in_names() {
  local name="${1%.md}" item
  for item in ${NAMES[@]+"${NAMES[@]}"}; do
    [[ "$item" == "$name" ]] && return 0
  done
  return 1
}

# selected <kind> <name> — true when the entry is in scope for this run.
# No --aw and no names means everything is in scope.
selected() {
  local kind="$1" name="$2"
  if (( ! AW_ONLY )) && (( ${#NAMES[@]} == 0 )); then
    return 0
  fi
  in_aw_set "$kind" "$name" || in_names "$name"
}

created=0
repaired=0
pruned=0
skipped_ok=0
skipped_unsafe=0

log() { printf '%s\n' "$*"; }

# Resolve a symlink target to a canonical absolute path so a relative
# symlink (e.g. ../../.agents/skills/foo) is treated as equivalent to
# the equivalent absolute symlink. Falls back to the raw target if the
# referent does not exist.
canonicalize_link() {
  local link="$1"
  local target parent
  target="$(readlink "$link")"
  parent="$(dirname "$link")"
  if [[ "$target" = /* ]]; then
    ( cd "$(dirname "$target")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$target")" ) \
      || printf '%s\n' "$target"
  else
    ( cd "$parent" && cd "$(dirname "$target")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$target")" ) \
      || printf '%s\n' "$target"
  fi
}

canonicalize_target() {
  local target="$1"
  ( cd "$(dirname "$target")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$target")" ) \
    || printf '%s\n' "$target"
}

# check_state <link> <target> → prints one of: ok | create | repair | skip
check_state() {
  local link="$1"
  local target="$2"
  if [[ -L "$link" ]]; then
    if [[ "$(canonicalize_link "$link")" == "$(canonicalize_target "$target")" ]]; then
      printf 'ok'
    else
      printf 'repair'
    fi
  elif [[ -e "$link" ]]; then
    printf 'skip'
  else
    printf 'create'
  fi
}

ensure_dir() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    if (( DRY_RUN )); then
      log "would create dir  $dir"
    else
      mkdir -p "$dir"
    fi
  fi
}

# apply_link <link> <target> — applies the change implied by check_state.
# Updates counters and prints per-action log line.
apply_link() {
  local link="$1"
  local target="$2"
  local state
  state="$(check_state "$link" "$target")"
  case "$state" in
    ok)
      skipped_ok=$((skipped_ok + 1))
      ;;
    repair)
      rm "$link"
      ln -s "$target" "$link"
      log "repaired          $link → $target"
      repaired=$((repaired + 1))
      ;;
    create)
      ln -s "$target" "$link"
      log "created           $link → $target"
      created=$((created + 1))
      ;;
    skip)
      log "SKIP (not a symlink, will not overwrite): $link"
      skipped_unsafe=$((skipped_unsafe + 1))
      ;;
  esac
}

# Glyph for a state column.
glyph_for() {
  case "$1" in
    ok)     printf '✓ ok    ' ;;
    create) printf '+ create' ;;
    repair) printf '~ repair' ;;
    skip)   printf '! skip  ' ;;
    none)   printf '  —     ' ;;
    *)      printf '?       ' ;;
  esac
}

ensure_dir "$AGENTS_SKILLS_DIR"
ensure_dir "$AGENTS_AGENTS_DIR"
ensure_dir "$CLAUDE_SKILLS_DIR"
ensure_dir "$CLAUDE_AGENTS_DIR"

# Collect entries first so we can compute max name width for the table.
declare -a entries=()
declare -a all_names=()
max_name=4   # "NAME"

# Walk skills/ recursively: any directory containing a SKILL.md is a skill.
# Supports both flat (skills/<name>/SKILL.md) and nested category layouts
# (skills/<category>/<name>/SKILL.md). Depth is capped to keep walks cheap;
# the `skills` CLI itself caps at depth 5.
while IFS= read -r -d '' skill_md; do
  skill_path="$(dirname "$skill_md")"
  name="$(basename "$skill_path")"
  all_names+=("$name")
  if ! selected skill "$name"; then
    continue
  fi
  entries+=("skill	$name	$skill_path")
  (( ${#name} > max_name )) && max_name=${#name}
done < <(find "$REPO_ROOT/skills" -mindepth 1 -maxdepth 5 -type f -name SKILL.md -print0 2>/dev/null)

for agent_path in "$REPO_ROOT"/agents/*.md; do
  [[ -f "$agent_path" ]] || continue
  name="$(basename "$agent_path")"
  all_names+=("${name%.md}")
  if ! selected agent "$name"; then
    continue
  fi
  entries+=("agent	$name	$agent_path")
  (( ${#name} > max_name )) && max_name=${#name}
done

# Reject unknown names up front so a typo cannot silently install nothing.
unknown=()
for want in ${NAMES[@]+"${NAMES[@]}"}; do
  found=0
  for have in "${all_names[@]}"; do
    [[ "$have" == "$want" ]] && { found=1; break; }
  done
  (( found )) || unknown+=("$want")
done
if (( ${#unknown[@]} > 0 )); then
  echo "error: no skill or agent named: ${unknown[*]}" >&2
  exit 1
fi

if (( AW_ONLY )); then
  log "mode: --aw (autonomous-workflow bundle: ${#AW_SKILLS[@]} skills + ${#AW_AGENTS[@]} agents)"
fi
if (( ${#NAMES[@]} > 0 )); then
  log "mode: selected (${NAMES[*]})"
fi
(( AW_ONLY || ${#NAMES[@]} > 0 )) && log ""

if (( DRY_RUN )); then
  # Header.
  printf '%-*s  %-5s  %-8s  %-8s\n' "$max_name" "NAME" "KIND" ".agents" ".claude"
  printf '%s\n' "$(printf '%.0s─' $(seq 1 $((max_name + 2 + 5 + 2 + 8 + 2 + 8))))"

  for row in "${entries[@]}"; do
    IFS=$'\t' read -r kind name path <<< "$row"
    if [[ "$kind" == "skill" ]]; then
      a_state="$(check_state "$AGENTS_SKILLS_DIR/$name" "$path")"
      c_state="$(check_state "$CLAUDE_SKILLS_DIR/$name" "$AGENTS_SKILLS_DIR/$name")"
    else
      a_state="$(check_state "$AGENTS_AGENTS_DIR/$name" "$path")"
      c_state="$(check_state "$CLAUDE_AGENTS_DIR/$name" "$AGENTS_AGENTS_DIR/$name")"
    fi
    printf '%-*s  %-5s  %s  %s\n' \
      "$max_name" "$name" "$kind" "$(glyph_for "$a_state")" "$(glyph_for "$c_state")"

    # Tally for the summary line.
    for s in "$a_state" "$c_state"; do
      case "$s" in
        ok)     skipped_ok=$((skipped_ok + 1)) ;;
        create) created=$((created + 1)) ;;
        repair) repaired=$((repaired + 1)) ;;
        skip)   skipped_unsafe=$((skipped_unsafe + 1)) ;;
      esac
    done
  done

  log ""
  log "summary: $created create, $repaired repair, $skipped_ok ok, $skipped_unsafe skip"
  log "(dry run — no changes applied)"
else
  for row in "${entries[@]}"; do
    IFS=$'\t' read -r kind name path <<< "$row"
    if [[ "$kind" == "skill" ]]; then
      apply_link "$AGENTS_SKILLS_DIR/$name" "$path"
      apply_link "$CLAUDE_SKILLS_DIR/$name" "$AGENTS_SKILLS_DIR/$name"
    else
      apply_link "$AGENTS_AGENTS_DIR/$name" "$path"
      apply_link "$CLAUDE_AGENTS_DIR/$name" "$AGENTS_AGENTS_DIR/$name"
    fi
  done

  log ""
  log "summary: $created created, $repaired repaired, $skipped_ok already ok, $skipped_unsafe skipped (unsafe)"
fi

# Prune links left dangling by a deleted or renamed skill/agent. Each tier
# only touches links this script owns:
#   ~/.agents/{skills,agents}/X  dangling, target inside this repo
#   ~/.claude/{skills,agents}/X  dangling, target inside ~/.agents
# `-e` follows the whole chain, so a ~/.claude link whose ~/.agents hop is
# dangling counts as dangling too, in a dry run as well as a real one.
prune_dir() {
  local dir="$1" owner="$2" link
  [[ -d "$dir" ]] || return 0
  for link in "$dir"/*; do
    [[ -L "$link" && ! -e "$link" ]] || continue
    [[ "$(canonicalize_link "$link")" == "$owner"/* ]] || continue
    if (( DRY_RUN )); then
      log "would prune       $link → $(readlink "$link")"
    else
      log "pruned            $link → $(readlink "$link")"
      rm "$link"
    fi
    pruned=$((pruned + 1))
  done
}

if (( PRUNE )); then
  repo_canon="$(cd "$REPO_ROOT" && pwd -P)"
  prune_dir "$AGENTS_SKILLS_DIR" "$repo_canon/skills"
  prune_dir "$AGENTS_AGENTS_DIR" "$repo_canon/agents"
  prune_dir "$CLAUDE_SKILLS_DIR" "$(canonicalize_target "$AGENTS_SKILLS_DIR")"
  prune_dir "$CLAUDE_AGENTS_DIR" "$(canonicalize_target "$AGENTS_AGENTS_DIR")"
  if (( pruned > 0 )); then
    if (( DRY_RUN )); then log "would prune: $pruned dangling link(s)"; else log "pruned: $pruned dangling link(s)"; fi
  fi
fi

# Per-skill install scripts: some skills need extra wiring beyond the
# basic skill/agent symlink (e.g. autonomous-workflow installs three
# agent-template links and a routing rule). Convention: a skill that
# ships an install.sh must accept --development for local-clone wiring,
# must accept --quiet to suppress success output, and must be idempotent.
# Errors still print to stderr; set -e aborts this script on installer
# failure so the user sees the installer's error directly.
queued=()
while IFS= read -r -d '' install_script; do
  skill_name="$(basename "$(dirname "$install_script")")"
  if ! selected skill "$skill_name"; then
    continue
  fi
  queued+=("$skill_name")
  (( DRY_RUN )) || bash "$install_script" --development --quiet
done < <(find "$REPO_ROOT/skills" -mindepth 1 -maxdepth 5 -type f -name install.sh -print0 2>/dev/null)

if (( DRY_RUN )) && (( ${#queued[@]} > 0 )); then
  log "would run skill installers: ${queued[*]}"
fi
