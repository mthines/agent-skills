---
title: Witnesses — the shared specs and edge probes in the browser, each window read back by telemetry-verify
impact: HIGH
tags:
  - ui-verify
  - intent-spec
  - edge-cases
  - playwright
  - telemetry-verify
---

# Witnesses

Phase 3 checks every acceptance criterion and every applicable edge case against the environment's `url` with evidence, and has `telemetry-verify` read back every window.
`ui-verify` owns the spec format, the runners, screenshots, recordings, and its adversarial pass; `telemetry-verify` owns the telemetry read; this rule decides what to feed them and when.

## Step 1 — Publish the acceptance specs (optional)

| Condition | Action |
| --- | --- |
| The PR body has no ui-verify block, and the push policy allows writing to this PR (`always`, or `own-prs` and you are the author) | `Skill("ui-verify", "author <pr-url>")` — it lifts `.agent/{branch}/specs.md` verbatim into the PR body |
| The PR body already has a block, or the policy forbids writing | Leave the PR body alone; note `spec not published (<reason>)` in the report |

`edge-specs.md` is never published; edge probes are local evidence.

## Step 2 — Run the browser witness

Record `window_start` (UTC ISO-8601) before and `window_end` after each invocation, in `.agent/{branch}/verify/probes.jsonl`.
Under the `command` stack driver, also record each process log's byte size before and after as `log_offsets` ([`stack/command.md § Logs`](./stack/command.md#logs-for-the-logs-telemetry-backend)); `telemetry-verify`'s `logs` backend reads that byte range.

```text
Skill("ui-verify", "run .agent/<branch>/specs.md --env <env> --url <url> --no-telemetry --no-comment")                         # acceptance specs
Skill("ui-verify", "run .agent/<branch>/verify/edge-specs.md --env <env> --url <url> --no-adversarial --no-telemetry --no-comment")   # edge specs, local only
```

- Always pass `--url`: on `local` it is the stack's `url`, so `ui-verify` never falls through to the deployed preview; on `preview` it is the URL Phase 2 resolved.
- `--env` picks the login and fixtures from `.agents/aw/environments.yml` via `.agent/{branch}/aw-target.<env>.yml`.
- Keep the adversarial pass on for the acceptance run: hostile input, double submit, failed requests, keyboard-only, small viewports.
- Login fails → run `/aw-verify setup` once and retry; never hand-roll a login. `.agents/aw/notes.md` names any repo-specific login step.
- Wait for a page-specific element, never `networkidle`: RUM beacons and background refetches keep the network busy. An `ERR_ABORTED` on a superseded request is not a defect.

One `probes.jsonl` line per spec, joined to its criterion by the `AC-n` / `EC-n` in the spec title:

```json
{"id": "EC-9", "title": "Save while the API fails", "result": "fail", "window_start": "2026-10-07T09:12:03Z", "window_end": "2026-10-07T09:12:41Z", "screenshots": [".agent/feat-x/.ui-verify/captures/ec-9.png"], "recordings": [".agent/feat-x/.aw-tester/recordings/spec-3.mp4"]}
```

`screenshots` and `recordings` list every image and video path `ui-verify` reported for that spec, relative to the checkout root; Phase 5 uploads them into the PR comment.

## Step 3 — Read all windows with `telemetry-verify`, once

After the last batch of Step 2 and Step 4 closes, dispatch the telemetry witness once over every window in `probes.jsonl`:

```text
Agent(subagent_type="general-purpose",
      prompt='Run Skill("telemetry-verify", "--env <env> --windows .agent/<branch>/verify/probes.jsonl --driver <driver> [--host <preview host>] --brief <plan.md or verify/intent.md> --out .agent/<branch>/verify/findings.jsonl --no-comment") and return only its TELEMETRY block')
```

- One dispatch per run: a sub-agent's setup costs about as much as its reads, so per-window dispatches multiply cost without adding evidence.
- A fix loop dispatches once more, over the windows it re-probed.
- Store the block in `.agent/{branch}/verify/telemetry.md`; the report takes the `AC-n` journey lines from it.
- `telemetry.yml` `backend: none` or `telemetry-verify` not installed → one line `telemetry: skipped (<reason>)`; never a pass.
- `aw-verify` owns the telemetry read, so both runs pass `--no-telemetry`; a window is never read twice.
- `aw-verify` owns the PR comment, so every `ui-verify` and `telemetry-verify` call passes `--no-comment` ([`pr-comment.md § When to post`](./pr-comment.md#when-to-post)).

**`ui-verify` or the browser MCP unavailable** (not installed, or it answers 403): load the `playwright-cli` skill, or run the repo's own Playwright from the package that depends on it (the root may resolve another version), and execute the same spec files step by step, capturing a full-page screenshot per `**Expected:**` item into `.agent/{branch}/verify/captures/`.

## Step 4 — API and worker probes

For `api:` criteria and edge cases, call the endpoint directly and record status and time:

```bash
start=$(date -u +%FT%TZ)
curl -sS -o /tmp/verify-ec12.json -w '%{http_code} %{time_total}\n' -X POST "$API_URL/api/views" \
  -H 'content-type: application/json' -d '{"name":"'"$(printf 'x%.0s' {1..5000})"'"}'
end=$(date -u +%FT%TZ)
# Expect a 4xx with a field error; a 5xx is a `crash` finding.
```

Auth comes from `.agents/aw/notes.md` or the repo's README; never paste a token into a file under `.agent/`.
For `worker:` criteria, trigger the job and check its outcome in the data it writes — read-only queries, or roll back what you insert.

## Step 5 — Record findings

Append to `findings.jsonl` per [`findings.md`](./findings.md):

| Observation | Kind |
| --- | --- |
| A failed `**Expected:**` item on an acceptance spec | `functional` |
| A failed `**Expected:**` item on an edge spec | `ungraceful`, or `crash` for a crash or 5xx |
| An uncaught console error or failed request during a passing spec | `crash` or `telemetry-error` |
| A `ui-verify` adversarial finding | Map to a kind; keep its screenshot as evidence |
| A `TELEMETRY` finding | Already written by `telemetry-verify` as `T-<n>`; do not duplicate it |
| A confusing but working flow | `ux`, after `Skill("ux", "<component path> — <what felt wrong>")` confirms it |

## Common mistakes

- Putting edge specs in the PR body. **Fix:** `specs.md` holds acceptance specs only.
- Rewriting an `/aw` spec to make it pass. **Fix:** a spec changes only when the ticket proves it wrong — that is `spec-drift`, reported.
- Calling an edge case passed because nothing crashed. **Fix:** check every `**Expected:**` item, including the message and preserved state.
