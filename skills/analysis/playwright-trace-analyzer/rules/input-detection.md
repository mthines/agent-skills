---
title: Input Detection — Playwright trace.zip, unpacked dir, JSONL streams
impact: HIGH
tags:
  - input-detection
  - file-format
  - intake
  - trace-zip
---

# Input Detection

Decide what shape the user passed. Detection is by file shape and entry
list, never by extension alone — Playwright traces always end in
`.zip`, but so do many unrelated archives.

## Decision flow

| First signal                                                          | Format                       | Next step                                         |
| --------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| URL matches `https://github.com/<o>/<r>/actions/runs/<id>`            | GitHub Actions run           | Run [`scripts/fetch-gh-run.mjs`](../scripts/fetch-gh-run.mjs) to download artifacts |
| Magic bytes `50 4b 03 04`                                             | ZIP archive                  | List entries; check for `trace.trace`             |
| ZIP entries include `trace.trace` AND `trace.network`                 | Playwright `trace.zip`       | Unpack with [`scripts/trace-extract.mjs`](../scripts/trace-extract.mjs) |
| Plain directory with `trace.trace`, `trace.network`, `resources/`     | Unpacked Playwright trace    | Use directly                                      |
| NDJSON file; first line has `{"type":"context-options"...}`           | Bare `trace.trace` stream    | Parse line-by-line (no resources/snapshots)       |
| NDJSON file; first line has `{"type":"resource-snapshot"...}` or `requestEvent` | Bare `trace.network` stream | Parse line-by-line; correlate by `requestId`      |
| JSON file with top-level `config` + `suites` + `stats`                | Playwright `report.json`     | Treat as high-level status only                   |
| Directory `test-results/` with subdirs containing `trace.zip`         | Playwright output dir        | Pick the most recent `trace.zip` per failed test  |

If none match, ask the user to identify the source. Do not guess.

## Quick checks

Run these in order. The first match wins.

```bash
# 0. GitHub Actions run URL?
echo "<input>" | grep -Eq '^https://github\.com/[^/]+/[^/]+/actions/runs/[0-9]+' \
  && echo "github-actions-run"

# 1. ZIP check + trace contents
unzip -l "<path>" 2>/dev/null | grep -E '(trace\.trace|trace\.network)' \
  && echo "playwright-trace-zip"

# 2. Unpacked dir
[ -f "<dir>/trace.trace" ] && [ -f "<dir>/trace.network" ] \
  && echo "playwright-trace-dir"

# 3. Bare trace.trace JSONL
head -1 "<path>" | jq -e '.type and .callId // .params' >/dev/null 2>&1 \
  && echo "playwright-trace-jsonl"

# 4. report.json
jq -e 'has("config") and has("suites") and has("stats")' "<path>" >/dev/null 2>&1 \
  && echo "playwright-report-json"

# 5. test-results dir
[ -d "<dir>/test-results" ] \
  && find "<dir>/test-results" -name 'trace.zip' -print -quit \
  && echo "playwright-test-results-dir"
```

## GitHub Actions run download

When the input is a `github.com/.../actions/runs/<id>` URL, prefer the
bundled script:

```bash
node <skill_dir>/scripts/fetch-gh-run.mjs "<run-url>" [--out <dir>] [--artifact <name>]
```

It uses `gh run download` under the hood, so it requires the `gh` CLI to
be authenticated (`gh auth status`). It:

1. Parses the run URL into `<owner>/<repo>` + `<runId>`.
2. Lists all artifacts via `gh api /repos/<o>/<r>/actions/runs/<id>/artifacts`.
3. Downloads every artifact whose name matches a Playwright pattern
   (`playwright-*`, `*-trace*`, `test-results*`).
4. Recursively unpacks nested ZIPs (Playwright shards often double-zip).
5. Writes a `gh-run-manifest.json` with `{ run, artifacts, traces[] }`,
   where each `traces[]` entry is a path to an unpacked `trace.zip` (or
   directory).
6. Surfaces the failing-test names by reading any sibling
   `report.json` if present.

If `gh` is not installed, the script prints a one-line install hint and
exits non-zero. Do not attempt to scrape the page — Playwright artifact
URLs require an authenticated `Cookie` and the public `gh api` route
needs the auth token.

If the run is from a private repo, the user's `gh` token must already
have access — the script does not handle re-authentication.

## Unpack recipe

For a `trace.zip`, prefer the bundled script:

```bash
node <skill_dir>/scripts/trace-extract.mjs <path/to/trace.zip> [--out <dir>]
```

It writes:

```
<out>/
  trace.trace        # NDJSON action stream (verbatim copy)
  trace.network      # NDJSON network stream (verbatim copy)
  trace.stacks       # NDJSON stack traces (if present)
  resources/         # blob assets referenced by snapshots
  manifest.json      # { events, requests, snapshots, errors, totals }
```

`manifest.json` is the cheap entry point for further analysis — it
summarises the trace without re-parsing the NDJSON each time.

If `unzip` is not available, fall back to:

```bash
python3 -m zipfile -e "<path>" "<out>/"
```

## Anatomy of `trace.trace` (NDJSON)

Each line is a JSON object. The most important `type` values:

| `type`             | Meaning                                                      | Key fields                                              |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------- |
| `context-options`  | Browser context config (viewport, locale, baseURL)           | `options.{viewport, baseURL, ...}`                       |
| `screencast-frame` | Frame snapshot (binary in `resources/`)                      | `sha1`, `timestamp`, `width`, `height`                  |
| `before`           | Action started                                               | `callId`, `startTime`, `class`, `method`, `params`, `stack`, `location` |
| `input`            | Mid-action input event (e.g. typed character, mouse move)    | `callId`, `point`, `selector`                            |
| `after`            | Action ended                                                 | `callId`, `endTime`, `error`, `result`                   |
| `event`            | Page event (navigation, console, dialog, request)            | `class`, `method`, `params`                              |
| `resource-snapshot`| DOM snapshot for time-travel debugging                       | `frameId`, `snapshot`, `viewport`                        |

A complete action is the `before` line + matching `after` line by
`callId`. Duration is `after.endTime - before.startTime` in ms.

Source paths come from `before.location` (`{ file, line, column }`) when
the trace was recorded with stack capture (the default since Playwright
1.30).

## Anatomy of `trace.network` (NDJSON)

| `type`             | Meaning                          | Key fields                                                         |
| ------------------ | -------------------------------- | ------------------------------------------------------------------ |
| `requestEvent`     | Request started                  | `requestId`, `url`, `method`, `headers`, `timestamp`, `frameId`    |
| `responseEvent`    | Response headers received        | `requestId`, `status`, `headers`, `timestamp`                      |
| `requestFinishedEvent` | Response body fully received | `requestId`, `timestamp`, `responseEnd`, `transferSize`, `encodedBodySize` |
| `requestFailedEvent` | Request failed                 | `requestId`, `errorText`, `timestamp`                              |
| `resource-snapshot` | Embedded asset metadata          | `request`, `response`, `requestSizes`, `responseSizes`             |

Pair events by `requestId`. Total request time:
`requestFinishedEvent.timestamp - requestEvent.timestamp` (or
`requestFailedEvent.timestamp` for failures). Use **ms** throughout —
Playwright timestamps are already in milliseconds (Unix epoch).

## Sanity checks before trusting the file

| Check                                                                 | Why                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| File size > 1 KB                                                      | Empty traces capture nothing                                 |
| Archive contains `trace.trace`                                        | A `trace.zip` without it is something else                   |
| At least one `before`/`after` pair                                    | A trace without actions wasn't actually recording the test   |
| `context-options` line present                                        | Confirms it was saved by Playwright, not constructed         |
| For flake diagnosis: ≥ 2 traces (one pass, one fail)                  | One trace can describe a failure but not the race            |
| Trace duration ≥ 100ms                                                | Sub-100ms traces usually mean the recorder was misconfigured |

If any sanity check fails, surface it to the user before continuing.

## Examples

### Good — minimal `trace.trace` first lines

```
{"type":"context-options","origin":"library","browserName":"chromium","options":{"viewport":{"width":1280,"height":720},"baseURL":"http://localhost:3000"}}
{"type":"before","callId":"page@1","startTime":1714000000123,"class":"BrowserContext","method":"newPage","params":{},"location":{"file":"tests/login.spec.ts","line":12,"column":18}}
{"type":"after","callId":"page@1","endTime":1714000000189}
{"type":"before","callId":"page@2","startTime":1714000000200,"class":"Page","method":"goto","params":{"url":"http://localhost:3000/login"},"location":{"file":"tests/login.spec.ts","line":13,"column":14}}
{"type":"event","class":"Page","method":"console","params":{"type":"warning","text":"deprecated API"}}
{"type":"after","callId":"page@2","endTime":1714000000812}
```

### Good — minimal `trace.network`

```
{"type":"requestEvent","requestId":"req-1","url":"http://localhost:3000/login","method":"GET","timestamp":1714000000201,"frameId":"f-1"}
{"type":"responseEvent","requestId":"req-1","status":200,"timestamp":1714000000389}
{"type":"requestFinishedEvent","requestId":"req-1","timestamp":1714000000412,"transferSize":4821,"encodedBodySize":4096}
```

### Bad — wrong file passed

```
{ "name": "playwright-test-app", "version": "1.0.0", "scripts": {} }
```

`package.json` is not a trace. Reject and ask the user for the correct file.

## Common mistakes

- **Trusting the `.zip` extension.** Many ZIPs contain unrelated
  payloads. **Fix:** always list entries before unpacking analytically.
- **Reading `startTime` as seconds.** Playwright stores ms. **Fix:** use
  ms directly; never multiply or divide by 1000.
- **Treating `event` lines as actions.** `event` is a page-side event
  (console, request, dialog), not an awaited action. **Fix:** only pair
  `before`/`after` for action timing.
- **Loading 200 MB of `resources/` into context.** Resources are binary
  blobs; you almost never need to read them. **Fix:** index in the
  manifest and read by sha1 only when explicitly required.
- **Diagnosing a flake from a single failing trace.** **Fix:** ask for a
  matching pass trace, or run the test 5–10 times and collect both
  outcomes — the diff is the diagnosis.
