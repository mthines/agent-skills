#!/bin/bash
# agent0-gh-shim.sh — installed by agent0-setup.sh as $PR_REVIEWER_ROOT/bin/gh, first on PATH.
#
# `gh api --paginate` follows GitHub's Link header, whose next-page URL is
# /repositories/<id>/..., a path an Agent0 sandbox's repo-scoped credential is not
# injected for, so page 2+ returns 401. Measured on dash0hq/dash0#24125 (127 files):
# prepare-review.mjs got 0 files from pulls/{n}/files, sized the reviewer's tool-call
# budget from that (60 instead of 200), and the review stopped at 32 of 127 files.
#
# This shim paginates REST list endpoints by explicit ?page=N and passes everything
# else straight to the host's gh. Tested by check-gh-shim.mjs --self-test (L1 G114).
# Builtins only (no `dirname`): a wrong self_dir would make the shim exec itself forever.
src="${BASH_SOURCE[0]}"; case "$src" in */*) src="${src%/*}" ;; *) src=. ;; esac
self_dir=$(cd "$src" && pwd -P) || { echo "gh shim: cannot resolve its own directory" >&2; exit 127; }
REAL=""
IFS=: read -ra dirs <<<"$PATH"
for d in "${dirs[@]}"; do
  [ -n "$d" ] && [ -x "$d/gh" ] && [ "$(cd "$d" 2>/dev/null && pwd -P)" != "$self_dir" ] && { REAL="$d/gh"; break; }
done
[ -n "$REAL" ] || { echo "gh shim: real gh not found on PATH" >&2; exit 127; }
# The host's gh may itself be a wrapper that resolves `gh` through PATH again; drop this
# directory from PATH so it never lands back here (that recursion exhausts memory).
clean=(); for d in "${dirs[@]}"; do [ -n "$d" ] && [ "$(cd "$d" 2>/dev/null && pwd -P)" = "$self_dir" ] || clean+=("$d"); done
PATH=$(IFS=:; echo "${clean[*]}"); export PATH

[ "${1:-}" = api ] || exec "$REAL" "$@"
has_pag=0; for a in "$@"; do [ "$a" = --paginate ] && has_pag=1; done
[ $has_pag = 1 ] || exec "$REAL" "$@"

shift
pass=(); endpoint=""; jqexpr=""; fallback=0
while [ $# -gt 0 ]; do
  case "$1" in
    --paginate) ;;
    --slurp|-t|--template|--template=*|--input|--input=*) fallback=1; pass+=("$1") ;;
    -q|--jq) jqexpr="$2"; shift ;;
    --jq=*) jqexpr="${1#--jq=}" ;;
    -H|--header|-X|--method|-f|--raw-field|-F|--field|--hostname|--cache|-p|--preview) pass+=("$1" "$2"); shift ;;
    -*) pass+=("$1") ;;
    *) if [ -z "$endpoint" ]; then endpoint="$1"; else pass+=("$1"); fi ;;
  esac
  shift
done
case "$endpoint" in graphql|"") fallback=1 ;; esac
if [ $fallback = 1 ]; then
  args=(); [ -n "$endpoint" ] && args+=("$endpoint"); args+=(--paginate "${pass[@]}")
  [ -n "$jqexpr" ] && args+=(--jq "$jqexpr")
  exec "$REAL" api "${args[@]}"
fi

per=100
if [[ "$endpoint" =~ [?\&]per_page=([0-9]+) ]]; then per="${BASH_REMATCH[1]}"; base="$endpoint"
else case "$endpoint" in *\?*) base="$endpoint&per_page=$per" ;; *) base="$endpoint?per_page=$per" ;; esac; fi
page=1
while :; do
  out=$("$REAL" api "${pass[@]}" "$base&page=$page") || exit $?
  n=$(printf '%s' "$out" | jq 'if type=="array" then length else -1 end' 2>/dev/null) || n=-1
  if [ "$n" = -1 ]; then
    # Not a plain array (e.g. {total_count, items}): hand the whole call back to gh.
    args=("$endpoint" --paginate "${pass[@]}"); [ -n "$jqexpr" ] && args+=(--jq "$jqexpr")
    [ $page = 1 ] && exec "$REAL" api "${args[@]}"
    break
  fi
  if [ -n "$jqexpr" ]; then printf '%s' "$out" | jq -r -c "$jqexpr" || exit 1
  else printf '%s' "$out"; fi
  [ "$n" -lt "$per" ] && break
  page=$((page+1)); [ $page -gt 300 ] && break
done
