#!/bin/bash
#
# agent0-playwright.sh — installs (or honestly records the absence of) a
# headless Playwright/Chromium browser for ui-verify's aw-tester, and
# rewrites its export lines in ENV_FILE in place, idempotently: the four
# UI_VERIFY_*/PLAYWRIGHT_BROWSERS_PATH lines on every run, plus
# LD_LIBRARY_PATH and FONTCONFIG_FILE when rung 5 supplied Chromium's
# system libraries.
#
# This is the ONLY writer of those lines. Two callers share it:
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
# Rungs (WITH_PLAYWRIGHT=1):
#   1. npm install playwright + @playwright/test into PW.
#   2. System libraries from the host's own apt mirror
#      (`playwright install-deps chromium`), only when root, apt-get, and a
#      short `apt-get update` probe all succeed; then the browser from the
#      Playwright CDN, only when a short probe reaches it.
#   3. Chrome-for-Testing fallback for the browser (storage.googleapis.com).
#   4. Headless smoke test.
#   5. When the smoke test fails on missing shared libraries: Playwright's
#      Ubuntu 22.04 Chromium library list, downloaded over HTTPS from
#      archive.ubuntu.com and unpacked into DEPS (never installed), then the
#      smoke test again with LD_LIBRARY_PATH/FONTCONFIG_FILE pointing at it.
#
# Requires: bash. WITH_PLAYWRIGHT=1 additionally needs node/npm and network
#           access to the npm registry, and the Playwright CDN or
#           storage.googleapis.com (the Chrome-for-Testing fallback, Linux
#           x86_64 only). Rung 5 needs root, apt-get, dpkg-deb, glibc >= 2.35,
#           and HTTPS to archive.ubuntu.com and security.ubuntu.com.
# envVars:  PW (install dir, default /tmp/workspace/playwright), ENV_FILE
#           (rewritten in place, default /tmp/workspace/agent-skills/env.sh),
#           WITH_PLAYWRIGHT (default 1), REQUIRE_PLAYWRIGHT (default 0),
#           BUDGET (seconds, default 900 — each step's own timeout is
#           capped to whatever of BUDGET remains), SKIP_CDN (skip the CDN
#           download and go straight to the Chrome-for-Testing fallback,
#           default 0; set automatically when the CDN probe fails),
#           WITH_UBUNTU_DEPS (rung 5, default 1), DEPS (rung 5's unpacked
#           libraries, default $PW-deps — outside PW because PW is wiped on
#           every run, so a later run reuses them).
#
# Rationale (two-stage design, the budget, the fallbacks, the consent):
# skills/testing/ui-verify/references/agent0-browser-install.md

set -uo pipefail

PW="${PW:-/tmp/workspace/playwright}"
ENV_FILE="${ENV_FILE:-/tmp/workspace/agent-skills/env.sh}"
WITH_PLAYWRIGHT="${WITH_PLAYWRIGHT:-1}"
REQUIRE_PLAYWRIGHT="${REQUIRE_PLAYWRIGHT:-0}"
BUDGET="${BUDGET:-900}"
SKIP_CDN="${SKIP_CDN:-0}"
WITH_UBUNTU_DEPS="${WITH_UBUNTU_DEPS:-1}"
DEPS="${DEPS:-$PW-deps}"
DEPS_LIBS="$DEPS/root/usr/lib/x86_64-linux-gnu:$DEPS/root/lib/x86_64-linux-gnu"
DEPS_OK=0

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

# write_env — the single place the export lines are produced. Strips any
# prior copy of each (so a second run is idempotent, and a run that no longer
# needs rung 5's libraries drops their lines) and keeps every other line
# untouched. Works whether ENV_FILE already exists or not.
write_env() {
  if [ -f "$ENV_FILE" ]; then
    grep -v -E '^export (UI_VERIFY_BROWSER|UI_VERIFY_BROWSER_REASON|UI_VERIFY_PLAYWRIGHT_NODE_MODULES|PLAYWRIGHT_BROWSERS_PATH|LD_LIBRARY_PATH|FONTCONFIG_FILE)=' "$ENV_FILE" > "$T/env.out" || true
  else
    mkdir -p "$(dirname "$ENV_FILE")" 2>/dev/null || true
    : > "$T/env.out"
  fi
  {
    echo "export UI_VERIFY_BROWSER=$STATUS"
    printf 'export UI_VERIFY_BROWSER_REASON=%q\n' "$REASON"
    echo "export UI_VERIFY_PLAYWRIGHT_NODE_MODULES=$PW/node_modules"
    echo "export PLAYWRIGHT_BROWSERS_PATH=$PW/browsers"
    if [ "$DEPS_OK" = 1 ]; then
      echo "export LD_LIBRARY_PATH=$DEPS_LIBS\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
      echo "export FONTCONFIG_FILE=$DEPS/fonts.conf"
    fi
  } >> "$T/env.out"
  mv "$T/env.out" "$ENV_FILE"
}

# apt_reachable CAP — true when the host's own apt sources answer. Uses a
# private lists directory and short timeouts, so a blocked mirror (Agent0
# trusted-hosts mode blocks deb.debian.org) costs seconds instead of the
# minutes `install-deps` would spend retrying it. `apt-get update` exits 0
# when every source fails, so its warnings decide.
apt_reachable() {
  mkdir -p "$T/apt-probe/partial"
  timeout "$1" apt-get update -q -o Dir::State::Lists="$T/apt-probe" \
    -o Acquire::http::Timeout=10 -o Acquire::https::Timeout=10 -o Acquire::Retries=0 >"$T/apt-probe.log" 2>&1 \
    && ! grep -qE '^(W|E): (Failed to fetch|Some index files failed)' "$T/apt-probe.log"
}

# smoke CAP — launches the headless shell once. On failure echoes the first
# line naming the cause: Playwright's last output line is only the Node.js
# version banner.
smoke() {
  if ( cd "$PW" && timeout "$1" node -e "require('playwright').chromium.launch().then(b => b.close())" ) >"$T/smoke.log" 2>&1; then
    return 0
  fi
  grep -m1 -E 'error while loading shared libraries|Error:|Timeout' "$T/smoke.log" || tail -n 1 "$T/smoke.log"
  return 1
}

# headless_shell — path of the downloaded chrome-headless-shell, or nothing.
headless_shell() {
  find "$PLAYWRIGHT_BROWSERS_PATH" -type f -name chrome-headless-shell 2>/dev/null | head -n 1
}

# missing_libs BIN [LIBPATH] — the shared libraries BIN cannot resolve.
missing_libs() {
  LD_LIBRARY_PATH="${2:-${LD_LIBRARY_PATH:-}}" ldd "$1" 2>/dev/null | awk '/not found/ {print $1}' | tr '\n' ' '
}

# ubuntu_deps CAP — rung 5. Downloads Playwright's ubuntu22.04-x64 Chromium
# dependency list plus its fonts with a private apt configuration, verified
# against the Ubuntu archive key (from the ubuntu-keyring package, over
# HTTPS), and unpacks the packages into DEPS without installing anything.
# libc, libstdc++, and libgcc are never unpacked, so the system's own stay in
# charge; that is why it needs glibc >= 2.35 (jammy's). Reuses DEPS when it
# already resolves every library. Echoes a one-line summary/reason; returns 0
# on success.
ubuntu_deps() {
  bin="$(headless_shell)"
  [ -n "$bin" ] || { echo "no chrome-headless-shell under $PLAYWRIGHT_BROWSERS_PATH"; return 1; }
  if [ -f "$DEPS/fonts.conf" ] && [ -z "$(missing_libs "$bin" "$DEPS_LIBS")" ]; then
    echo "reused ubuntu 22.04 libraries in $DEPS"
    return 0
  fi
  [ "$(id -u)" = 0 ] && command -v apt-get >/dev/null 2>&1 && command -v dpkg-deb >/dev/null 2>&1 \
    || { echo "needs root, apt-get, and dpkg-deb"; return 1; }
  glibc="$(ldd --version 2>/dev/null | head -n 1 | grep -oE '[0-9]+\.[0-9]+$')"
  [ "$(printf '%s\n2.35\n' "$glibc" | sort -V | head -n 1)" = 2.35 ] || { echo "glibc ${glibc:-unknown} < 2.35"; return 1; }

  ub=https://archive.ubuntu.com/ubuntu
  sec=https://security.ubuntu.com/ubuntu
  a="$DEPS/apt"
  rm -rf "$DEPS"
  mkdir -p "$a/lists/partial" "$a/archives/partial" "$a/cache" "$a/sources.list.d" "$a/preferences.d" "$a/keyring" "$DEPS/root" "$DEPS/fontcache"
  cap="$(left 20)"; [ "$cap" != 0 ] || { echo "budget exhausted before the ubuntu-keyring download"; return 1; }
  kdeb="$(timeout "$cap" curl -fsS --max-time "$cap" "$ub/pool/main/u/ubuntu-keyring/" 2>/dev/null | grep -oE 'ubuntu-keyring_[0-9.]+_all\.deb' | sort -uV | tail -n 1)"
  kdeb="${kdeb:-ubuntu-keyring_2023.11.28.1_all.deb}"
  cap="$(left 30)"; [ "$cap" != 0 ] || { echo "budget exhausted before the ubuntu-keyring download"; return 1; }
  timeout "$cap" curl -fsSL --retry 2 --max-time "$cap" -o "$a/$kdeb" "$ub/pool/main/u/ubuntu-keyring/$kdeb" 2>"$T/deps.log" \
    || { echo "ubuntu-keyring download failed ($(tail -n 1 "$T/deps.log"))"; return 1; }
  dpkg-deb -x "$a/$kdeb" "$a/keyring" || { echo "could not unpack $kdeb"; return 1; }
  key="$a/keyring/usr/share/keyrings/ubuntu-archive-keyring.gpg"
  printf 'deb [arch=amd64 signed-by=%s] %s %s main universe\n' \
    "$key" "$ub" jammy "$key" "$ub" jammy-updates "$key" "$sec" jammy-security > "$a/sources.list"
  apt=(apt-get -q -o Dir::Etc::sourcelist="$a/sources.list" -o Dir::Etc::sourceparts="$a/sources.list.d"
    -o Dir::Etc::preferencesparts="$a/preferences.d" -o Dir::State::Lists="$a/lists"
    -o Dir::Cache="$a/cache" -o Dir::Cache::Archives="$a/archives"
    -o APT::Get::List-Cleanup=0 -o Acquire::Languages=none -o Acquire::Retries=3)
  # Playwright nativeDeps["ubuntu22.04-x64"].chromium, plus its fonts (no xvfb: headless only).
  pkgs=(libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2
    libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libwayland-client0 libx11-6 libxcb1
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2
    libfontconfig1 libfreetype6 fonts-liberation fonts-noto-color-emoji fonts-unifont
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf)
  cap="$(left 120)"; [ "$cap" != 0 ] || { echo "budget exhausted before apt-get update"; return 1; }
  timeout "$cap" "${apt[@]}" update >"$T/deps.log" 2>&1 \
    || { echo "apt-get update against archive.ubuntu.com failed ($(grep -m1 -E '^(E|W):' "$T/deps.log" || tail -n 1 "$T/deps.log"))"; return 1; }
  cap="$(left 180)"; [ "$cap" != 0 ] || { echo "budget exhausted before the library download"; return 1; }
  timeout "$cap" "${apt[@]}" install -y --download-only --no-install-recommends "${pkgs[@]}" >>"$T/deps.log" 2>&1 \
    || { echo "library download from archive.ubuntu.com failed ($(grep -m1 -E '^(E|W):' "$T/deps.log" || tail -n 1 "$T/deps.log"))"; return 1; }
  n=0
  for deb in "$a"/archives/*.deb; do
    case "$(basename "$deb")" in
      libc6_*|libc-bin_*|libgcc-s1_*|libstdc++6_*|gcc-12-base_*|libcrypt1_*|libselinux1_*) continue ;;
    esac
    dpkg-deb -x "$deb" "$DEPS/root" && n=$((n + 1))
  done
  rm -rf "$a/archives" "$a/cache" "$a/lists"
  cat > "$DEPS/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$DEPS/root/usr/share/fonts</dir>
  <dir>/usr/share/fonts</dir>
  <cachedir>$DEPS/fontcache</cachedir>
  <include ignore_missing="yes">$DEPS/root/etc/fonts/conf.d</include>
</fontconfig>
EOF
  missing="$(missing_libs "$bin" "$DEPS_LIBS")"
  [ -z "$missing" ] || { echo "still missing after unpacking $n packages: $missing"; return 1; }
  echo "ubuntu 22.04 libraries ($n packages) in $DEPS"
  return 0
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
  cft_base="https://storage.googleapis.com/chrome-for-testing-public/$ver/linux64"
  hs_url="$cft_base/chrome-headless-shell-linux64.zip"
  if ! timeout "$cap" curl -fsSL --max-time "$cap" -o "$T/hs.zip" "$hs_url" 2>"$T/cft.log"; then
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
  ch_url="$cft_base/chrome-linux64.zip"
  # Reserve rung 4's smoke-test cap (left 60) so this optional download can
  # never starve it; skip the fetch when there is no headroom.
  c2=$(( $(left 90) - 60 ))
  if [ "$c2" -gt 0 ] && timeout "$c2" curl -fsSL --max-time "$c2" -o "$T/ch.zip" "$ch_url" 2>/dev/null; then
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

  # Measure the host as it is: drop rung-5 paths an earlier run's env.sh put
  # on LD_LIBRARY_PATH (the on-demand block sources env.sh before calling
  # this), so a run whose smoke test only passes because of them still
  # records them. Rung 5 adds them back, reusing DEPS, when they are needed.
  if [ -n "${LD_LIBRARY_PATH:-}" ]; then
    LD_LIBRARY_PATH="$(printf '%s' "$LD_LIBRARY_PATH" | tr ':' '\n' | grep -v -F "$DEPS/root/" | paste -sd: -)"
    if [ -n "$LD_LIBRARY_PATH" ]; then export LD_LIBRARY_PATH; else unset LD_LIBRARY_PATH; fi
  fi
  [ "${FONTCONFIG_FILE:-}" = "$DEPS/fonts.conf" ] && unset FONTCONFIG_FILE

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
    # Rung 2a: system libraries from the host's own apt mirror — only with
    # root and apt-get, and only when the probe reaches the mirror; without
    # either, install-deps burns budget and still fails. Rung 5 covers a
    # host where this does not run or does not finish.
    if [ "$(id -u)" = 0 ] && command -v apt-get >/dev/null 2>&1; then
      cap="$(left 60)"
      if [ "$cap" != 0 ] && apt_reachable "$cap"; then
        cap="$(left 300)"
        [ "$cap" != 0 ] && timeout "$cap" "$PW/node_modules/.bin/playwright" install-deps chromium >"$T/deps-apt.log" 2>&1
      fi
    fi

    # Rung 2b: the browser from the Playwright CDN, unless SKIP_CDN=1 or the
    # probe cannot reach it (it is off Agent0's trusted-hosts allowlist, where
    # a blocked download stalls for minutes before failing).
    if [ "$SKIP_CDN" != 1 ]; then
      cap="$(left 8)"
      if [ "$cap" = 0 ] || [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time "$cap" https://cdn.playwright.dev/ 2>/dev/null)" = 000 ]; then
        SKIP_CDN=1
        REASON="Playwright CDN unreachable"
      fi
    fi
    if [ "$SKIP_CDN" != 1 ]; then
      cap="$(left 300)"
      [ "$cap" != 0 ] && timeout "$cap" "$PW/node_modules/.bin/playwright" install chromium >"$T/pw.log" 2>&1 && BROWSER_OK=1
      if [ "$BROWSER_OK" = 1 ]; then
        HOW="cdn"
      else
        REASON="chromium download failed (allow the Playwright CDN, or networkLevel full): $(tail -n 1 "$T/pw.log" 2>/dev/null)"
      fi
    fi

    # Rung 3: Chrome-for-Testing fallback, when the CDN rung was skipped or
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
      elif err="$(smoke "$cap")"; then
        STATUS="ok"
      else
        REASON="headless launch failed: $err"
        # Rung 5: missing shared libraries → Ubuntu 22.04's, unpacked into DEPS.
        bin="$(headless_shell)"
        if [ "$WITH_UBUNTU_DEPS" = 1 ] && [ -n "$bin" ] && [ -n "$(missing_libs "$bin")" ]; then
          deps_out="$(ubuntu_deps 2>&1)"
          if [ $? = 0 ]; then
            export LD_LIBRARY_PATH="$DEPS_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
            export FONTCONFIG_FILE="$DEPS/fonts.conf"
            cap="$(left 60)"
            if [ "$cap" = 0 ]; then
              REASON="on-demand budget exhausted at smoke test (after $deps_out)"
            elif err="$(smoke "$cap")"; then
              STATUS="ok"
              DEPS_OK=1
              HOW="$HOW; $deps_out"
            else
              REASON="headless launch failed with $deps_out: $err"
            fi
          else
            REASON="headless launch failed: $err; ubuntu libraries: $deps_out"
          fi
        fi
      fi
      [ "$STATUS" = ok ] && REASON="$("$PW/node_modules/.bin/playwright" --version 2>/dev/null) ($HOW)"
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
