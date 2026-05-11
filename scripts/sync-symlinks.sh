#!/usr/bin/env bash
# Wire every skill in skills/ and every agent in agents/ into the
# two-tier symlink chain described in CLAUDE.md:
#
#   ~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <repo>/skills/<name>
#   ~/.claude/agents/<name>.md  →  ~/.agents/agents/<name>.md  →  <repo>/agents/<name>.md
#
# Safe to re-run. Skips entries that are already linked correctly,
# repairs broken or wrong-target symlinks, refuses to touch real
# files or directories that would otherwise be overwritten.
#
# Usage:
#   scripts/sync-symlinks.sh            # apply changes (verbose per-action log)
#   scripts/sync-symlinks.sh --dry-run  # preview only, table view
#   scripts/sync-symlinks.sh -n         # short form of --dry-run

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" || "${1:-}" == "-n" ]]; then
  DRY_RUN=1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_SKILLS_DIR="$HOME/.agents/skills"
AGENTS_AGENTS_DIR="$HOME/.agents/agents"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
CLAUDE_AGENTS_DIR="$HOME/.claude/agents"

created=0
repaired=0
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
max_name=4   # "NAME"

for skill_path in "$REPO_ROOT"/skills/*/; do
  [[ -d "$skill_path" ]] || continue
  name="$(basename "$skill_path")"
  skill_path="${skill_path%/}"
  entries+=("skill	$name	$skill_path")
  (( ${#name} > max_name )) && max_name=${#name}
done

for agent_path in "$REPO_ROOT"/agents/*.md; do
  [[ -f "$agent_path" ]] || continue
  name="$(basename "$agent_path")"
  entries+=("agent	$name	$agent_path")
  (( ${#name} > max_name )) && max_name=${#name}
done

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
