---
title: Browser verification — the shared specs and the edge probes, on localhost
impact: HIGH
tags:
  - ui-verify
  - intent-spec
  - edge-cases
  - playwright
---

# Browser verification

Phase 3 checks every acceptance criterion and every applicable edge case against the running app at `app_url`, with evidence.
`ui-verify` owns the spec format, the runners, screenshots, recordings, and its adversarial pass; this rule decides what to feed it.

## Step 1 — Publish the acceptance specs (optional)

| Condition | Action |
| --- | --- |
| The PR body has no ui-verify block, and the push policy allows writing to this PR (`always`, or `own-prs` and you are the author) | `Skill("ui-verify", "author <pr-url>")` — it lifts `.agent/{branch}/specs.md` verbatim into the PR body |
| The PR body already has a block, or the policy forbids writing | Leave the PR body alone; note `spec not published (<reason>)` in the report |

`edge-specs.md` is never published; edge probes are local evidence.

## Step 2 — Run against localhost

Record `window_start` (ISO, UTC) before and `window_end` after each invocation, in `.agent/{branch}/local-verify/probes.jsonl`.
Under the `command` stack driver, also record each process log's byte size before and after as `log_offsets` ([`stack/command.md § Logs`](./stack/command.md#logs-for-the-logs-telemetry-backend)).

```text
Skill("ui-verify", "run .agent/<branch>/specs.md --url <app_url>")                     # acceptance specs
Skill("ui-verify", "run .agent/<branch>/local-verify/edge-specs.md --url <app_url> --no-adversarial")  # edge specs
```

- Always pass the local path and `--url`: without `--url`, `ui-verify` resolves the deployed preview and tests deployed code, not this stack.
- `--url` overrides the aw-target's base URL and is passed to its login script, so one login works locally and on the preview.
- Keep the adversarial pass on for the acceptance run; it adds hostile input, double submit, failed requests, keyboard-only, and small viewports.
- Login fails → run `/aw-setup --target local` once and retry; never hand-roll a login. The notes file names any repo-specific login step.

One `probes.jsonl` line per spec, joined to its criterion by the `AC-n` / `EC-n` in the spec title:

```json
{"id": "EC-9", "title": "Save while the API fails", "result": "fail", "window_start": "2026-10-07T09:12:03Z", "window_end": "2026-10-07T09:12:41Z", "screenshots": [".agent/feat-x/.ui-verify/captures/ec-9.png"]}
```

`screenshots` lists every image path `ui-verify` reported for that spec, relative to the checkout root; Phase 6 attaches them.

**`ui-verify` unavailable:** load the `playwright-cli` skill and execute the same spec files step by step, capturing a full-page screenshot per `**Expected:**` item into `.agent/{branch}/local-verify/captures/`.

## Step 3 — API and worker probes

For `api:` criteria and edge cases, call the endpoint directly and record status and time:

```bash
start=$(date -u +%FT%TZ)
curl -sS -o /tmp/lv-ec12.json -w '%{http_code} %{time_total}\n' -X POST "$API_URL/api/views" \
  -H 'content-type: application/json' -d '{"name":"'"$(printf 'x%.0s' {1..5000})"'"}'
end=$(date -u +%FT%TZ)
# Expect a 4xx with a field error; a 5xx is a `crash` finding.
```

Auth comes from the notes file or the repo's README; never paste a token into a file under `.agent/`.
For `worker:` criteria, trigger the job and check its outcome in the data it writes — read-only queries, or roll back what you insert.

## Step 4 — Record findings

Append to `findings.jsonl` per [`findings.md`](./findings.md):

| Observation | Kind |
| --- | --- |
| A failed `**Expected:**` item on an acceptance spec | `functional` |
| A failed `**Expected:**` item on an edge spec | `ungraceful`, or `crash` for a crash or 5xx |
| An uncaught console error or failed request during a passing spec | `crash` or `telemetry-error` |
| A `ui-verify` adversarial finding | Map to a kind; keep its screenshot as evidence |
| A confusing but working flow | `ux`, after `Skill("ux", "<component path> — <what felt wrong>")` confirms it |

## Common mistakes

- Putting edge specs in the PR body. **Fix:** `specs.md` holds acceptance specs only.
- Rewriting an `/aw` spec to make it pass. **Fix:** a spec changes only when the ticket proves it wrong — that is `spec-drift`, reported.
- Calling an edge case passed because nothing crashed. **Fix:** check every `**Expected:**` item, including the message and preserved state.
