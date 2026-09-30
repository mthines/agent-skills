#!/bin/bash
#
# agent0-playwright.sh — installs (or honestly records the absence of) a
# headless Playwright/Chromium browser for ui-verify's aw-tester, and
# rewrites the four UI_VERIFY_*/PLAYWRIGHT_BROWSERS_PATH export lines in
# ENV_FILE in place, idempotently.
#
# This is the ONLY writer of those four lines. Two callers share it:
#   - scripts/agent0-setup.sh (the prepared-sandbox path), which points
#     ENV_FILE at a scratch file and cats it into the host env.sh itself.
#   - ui-verify's own on-demand top-up block (SKILL.md), which runs this
#     script against the live env.sh directly, for a sandbox that skipped
#     Playwright at setup time or was never prepared at all.
# One install procedure, so the two paths cannot drift apart.
#
# Never fatal to its caller by default: a failure records
# UI_VERIFY_BROWSER=missing plus a non-empty reason. REQUIRE_PLAYWRIGHT=1
# makes a failed install exit non-zero instead — the only case this script
# exits non-zero.
#
# Requires: bash. WITH_PLAYWRIGHT=1 additionally needs node/npm and network
#           access to the npm registry, and (unless SKIP_CDN=1) the
#           Playwright CDN or storage.googleapis.com for the Chrome-for-
#           Testing fallback. The fallback covers Linux x86_64 only.
# envVars:  PW (install dir, default /tmp/workspace/playwright), ENV_FILE
#           (rewritten in place, default /tmp/workspace/agent-skills/env.sh),
#           WITH_PLAYWRIGHT (default 1), REQUIRE_PLAYWRIGHT (default 0),
#           BUDGET (seconds, default 900 — each step's own timeout is
#           capped to whatever of BUDGET remains), SKIP_CDN (test knob:
#           skip both CDN download rungs and go straight to the
#           Chrome-for-Testing fallback, default 0).
#
# Rationale (two-stage design, the budget, the fallback, the consent):
# skills/testing/ui-verify/references/agent0-browser-install.md

set -uo pipefail

PW="${PW:-/tmp/workspace/playwright}"
ENV_FILE="${ENV_FILE:-/tmp/workspace/agent-skills/env.sh}"
WITH_PLAYWRIGHT="${WITH_PLAYWRIGHT:-1}"
REQUIRE_PLAYWRIGHT="${REQUIRE_PLAYWRIGHT:-0}"
BUDGET="${BUDGET:-900}"
SKIP_CDN="${SKIP_CDN:-0}"

T="$(mktemp -d)"
cleanup() { rm -rf "$T"; }
trap cleanup EXIT

STATUS="skipped"
REASON="WITH_PLAYWRIGHT=0"

# left CAP — this step's own timeout: never more than CAP, and never more
# than whatever of BUDGET remains (never negative — a 0 means "no time left").
left() {
  cap="$1"
  remain=$(( BUDGET - SECONDS ))
  [ "$remain" -lt 0 ] && remain=0
  if [ "$remain" -lt "$cap" ]; then echo "$remain"; else echo "$cap"; fi
}

# write_env — the single place the four export lines are produced. Strips
# any prior copy of each (so a second run is idempotent) and keeps every
# other line untouched. Works whether ENV_FILE already exists or not.
write_env() {
  if [ -f "$ENV_FILE" ]; then
    grep -v -E '^export (UI_VERIFY_BROWSER|UI_VERIFY_BROWSER_REASON|UI_VERIFY_PLAYWRIGHT_NODE_MODULES|PLAYWRIGHT_BROWSERS_PATH)=' "$ENV_FILE" > "$T/env.out" || true
  else
    mkdir -p "$(dirname "$ENV_FILE")" 2>/dev/null || true
    : > "$T/env.out"
  fi
  {
    echo "export UI_VERIFY_BROWSER=$STATUS"
    printf 'export UI_VERIFY_BROWSER_REASON=%q\n' "$REASON"
    echo "export UI_VERIFY_PLAYWRIGHT_NODE_MODULES=$PW/node_modules"
    echo "export PLAYWRIGHT_BROWSERS_PATH=$PW/browsers"
  } >> "$T/env.out"
  mv "$T/env.out" "$ENV_FILE"
}

# cft_fallback CAP — Chrome-for-Testing rung (Linux x86_64 only). Reads the
# chromium-headless-shell revision + browserVersion Playwright itself pinned
# in browsers.json, downloads the matching headless-shell build straight
# from storage.googleapis.com, and (best-effort) the full chrome build at
# the same version — the `chromium` browser entry is the same Chrome-for-
# Testing build, so marking it complete too makes a later
# `playwright install chromium` an idempotent no-op instead of a failing
# CDN download. Echoes a one-line summary/reason; returns 0 on success.
cft_fallback() {
  cap="$1"
  bj="$PW/node_modules/playwright-core/browsers.json"
  if [ ! -f "$bj" ]; then
    echo "no browsers.json at $bj"
    return 1
  fi
  if [ "$(uname -s 2>/dev/null)" != "Linux" ] || [ "$(uname -m 2>/dev/null)" != "x86_64" ]; then
    echo "not linux x86_64"
    return 1
  fi
  rev="$(node -e "const b=require('$bj').browsers.find(x=>x.name==='chromium-headless-shell'); if(b) process.stdout.write(String(b.revision))" 2>/dev/null)"
  ver="$(node -e "const b=require('$bj').browsers.find(x=>x.name==='chromium-headless-shell'); if(b) process.stdout.write(b.browserVersion||'')" 2>/dev/null)"
  if [ -z "$rev" ] || [ -z "$ver" ]; then
    echo "no chromium-headless-shell pin in browsers.json"
    return 1
  fi
  hs_dir="$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-$rev"
  ch_dir="$PLAYWRIGHT_BROWSERS_PATH/chromium-$rev"
  mkdir -p "$hs_dir" "$ch_dir"
  hs_url="https://storage.googleapis.com/chrome-for-testing-public/$ver/linux64/chrome-headless-shell-linux64.zip"
  if ! timeout "$cap" curl -fsSL --max-time 30 -o "$T/hs.zip" "$hs_url" 2>"$T/cft.log"; then
    echo "download failed: $hs_url ($(tail -n 1 "$T/cft.log" 2>/dev/null))"
    return 1
  fi
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$T/hs.zip" -d "$hs_dir" || { echo "unzip failed for $hs_url"; return 1; }
  else
    python3 -m zipfile -e "$T/hs.zip" "$hs_dir" || { echo "python3 zipfile extraction failed for $hs_url"; return 1; }
  fi
  chmod -R a+rx "$hs_dir"
  touch "$hs_dir/INSTALLATION_COMPLETE"
  # Best-effort only: the full chrome build shares the revision/version, so a
  # later `install chromium` (a different browser entry) is also a no-op.
  ch_url="https://storage.googleapis.com/chrome-for-testing-public/$ver/linux64/chrome-linux64.zip"
  if timeout 30 curl -fsSL --max-time 30 -o "$T/ch.zip" "$ch_url" 2>/dev/null; then
    if command -v unzip >/dev/null 2>&1; then
      unzip -q -o "$T/ch.zip" -d "$ch_dir" 2>/dev/null && { chmod -R a+rx "$ch_dir"; touch "$ch_dir/INSTALLATION_COMPLETE"; }
    else
      python3 -m zipfile -e "$T/ch.zip" "$ch_dir" 2>/dev/null && { chmod -R a+rx "$ch_dir"; touch "$ch_dir/INSTALLATION_COMPLETE"; }
    fi
  fi
  echo "chrome-for-testing $ver (rev $rev)"
  return 0
}

if [ "$WITH_PLAYWRIGHT" = 1 ]; then
  STATUS="missing"
  REASON="not attempted"
  NPM_OK=0
  BROWSER_OK=0
  rm -rf "$PW" && mkdir -p "$PW/browsers"
  export PLAYWRIGHT_BROWSERS_PATH="$PW/browsers"

  # Rung 1: npm install playwright + @playwright/test.
  cap="$(left 300)"
  if [ "$cap" = 0 ]; then
    REASON="on-demand budget exhausted at npm install"
  elif ( cd "$PW" && echo '{"private":true}' > package.json \
         && timeout "$cap" npm install --no-audit --no-fund --silent playwright @playwright/test ) >"$T/npm.log" 2>&1; then
    NPM_OK=1
  else
    REASON="npm install playwright failed: $(tail -n 1 "$T/npm.log" 2>/dev/null)"
  fi

  if [ "$NPM_OK" = 1 ]; then
    # Rung 2: the CDN, unless SKIP_CDN=1 (a testing knob that forces rung 3).
    # --with-deps only with root + apt-get — without root it burns budget and
    # still fails.
    if [ "$SKIP_CDN" != 1 ]; then
      if [ "$(id -u)" = 0 ] && command -v apt-get >/dev/null 2>&1; then
        cap="$(left 300)"
        [ "$cap" != 0 ] && timeout "$cap" "$PW/node_modules/.bin/playwright" install --with-deps chromium >"$T/pw.log" 2>&1 && BROWSER_OK=1
      fi
      if [ "$BROWSER_OK" = 0 ]; then
        cap="$(left 300)"
        [ "$cap" != 0 ] && timeout "$cap" "$PW/node_modules/.bin/playwright" install chromium >"$T/pw.log" 2>&1 && BROWSER_OK=1
      fi
      if [ "$BROWSER_OK" = 1 ]; then
        HOW="cdn"
      else
        REASON="chromium download failed (allow the Playwright CDN, or networkLevel full): $(tail -n 1 "$T/pw.log" 2>/dev/null)"
      fi
    fi

    # Rung 3: Chrome-for-Testing fallback, when the CDN rungs were skipped or
    # failed.
    if [ "$BROWSER_OK" = 0 ]; then
      cap="$(left 120)"
      if [ "$cap" = 0 ]; then
        REASON="on-demand budget exhausted at chrome-for-testing fallback"
      else
        cft_out="$(cft_fallback "$cap" 2>&1)"
        cft_rc=$?
        if [ "$cft_rc" = 0 ]; then
          BROWSER_OK=1
          HOW="chrome-for-testing fallback: $cft_out"
        else
          REASON="chrome-for-testing fallback failed ($cft_out); ${REASON:-chromium download failed}"
        fi
      fi
    fi

    # Rung 4: smoke test.
    if [ "$BROWSER_OK" = 1 ]; then
      cap="$(left 60)"
      if [ "$cap" = 0 ]; then
        REASON="on-demand budget exhausted at smoke test"
      elif ( cd "$PW" && timeout "$cap" node -e "require('playwright').chromium.launch().then(b => b.close())" ) >"$T/smoke.log" 2>&1; then
        STATUS="ok"
        REASON="$("$PW/node_modules/.bin/playwright" --version 2>/dev/null) ($HOW)"
      else
        REASON="headless launch failed (missing system libraries?): $(tail -n 1 "$T/smoke.log" 2>/dev/null)"
      fi
    fi
  fi

  echo "playwright: $STATUS — $REASON"
fi

write_env

if [ "$STATUS" != "ok" ] && [ "$REQUIRE_PLAYWRIGHT" = 1 ]; then
  echo "FATAL: REQUIRE_PLAYWRIGHT=1 and no working Playwright browser: $REASON" >&2
  exit 1
fi

exit 0
