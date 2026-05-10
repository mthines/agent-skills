---
title: Telemetry Verification — Confirm the Fix in Production
impact: MEDIUM
tags:
  - telemetry
  - dash0
  - post-deploy
  - production-verification
  - closed-loop
  - rare-bugs
  - app-crash
---

# Telemetry Verification

Phase 8. Runs only when the original input was a telemetry source (Dash0 span / log / web event,
or a Linear ticket whose evidence resolved to one). The fix is not done at PR merge — it is done
when the originating signal **stops firing in production**.

What "stops firing" means depends on how often the bug fires in the first place. Phase 8 picks a
verification mode based on the bug's observability shape; it does **not** assume a fixed rate or
a 30-minute window for every case.

Source: [Datadog Watchdog Faulty Deployment Detection](https://docs.datadoghq.com/watchdog/faulty_deployment_detection/),
[Sentry + Datadog collaborative bug-fixing](https://blog.sentry.io/collaborative-bug-fixing-with-datadog/),
Sentry release-health (issue resolution against `release.version`), Crashlytics build-version
attribution.

## Contents

- [When this phase runs](#when-this-phase-runs)
- [MCP capability gate](#mcp-capability-gate)
- [Step 8a — Classify observability shape](#step-8a--classify-observability-shape)
- [Step 8b — Pick verification mode](#step-8b--pick-verification-mode)
- [Mode procedures](#mode-procedures)
- [Outcomes](#outcomes)

---

## When this phase runs

Runs only when **all** hold:

- Phase 0 classified the input as a Dash0 / telemetry URL (or a Linear ticket that resolved to
  one).
- Phase 7 verifier returned green and the PR was undrafted.
- The PR has been merged and deployed to the environment that produced the original signal.

Skipped silently when the input was not a telemetry URL.

---

## MCP capability gate

Detect whether the Dash0 MCP exposes the tools needed to filter a query by release tag:

| Capability | Required tool (or equivalent) |
|------------|------------------------------|
| Run a saved query / metric query | `mcp__dash0__run_query` (name may vary) |
| Filter by release / deploy tag | The query supports a `service.version` or `deployment.version` parameter |
| Return a numeric count or rate | The query result includes events / events-per-time |

If any capability is missing, Phase 8 falls back to **deferred-watch** mode (see below) and prints:

```text
Telemetry verification falling back to deferred-watch: Dash0 MCP missing
required capability (<capability>). Registering a manual watch on the
originating query for release tag <tag>.
```

---

## Step 8a — Classify observability shape

Look at the Evidence Record's telemetry section and any baseline data the Dash0 MCP can pull.
Classify the shape:

| Field | How to compute |
|-------|----------------|
| `baseline_count` | Events matching the originating query in the **24 h before** the fix-bug ticket was opened |
| `baseline_rate_per_30min` | `baseline_count / 48` (24 h has 48 × 30-min windows) |
| `affected_users_24h` | Distinct `user.id` / `device.id` in the matching events (if exposed) |
| `is_crash_class` | The originating event is in a crash signal (e.g., Dash0 `event.name = crash`, or the bug class from Phase 0 is `null-deref` paired with a fatal-class log) |
| `cohort_known` | The Evidence Record has a `Sources` field that pins the bug to a specific user / tenant / device / request id |
| `release_attribution_available` | Telemetry events carry `service.version` / `release.version` / `deployment.version` |

Append the shape to the bug-notes ledger:

```markdown
### Phase 8 shape
- baseline_count (24h): <N>
- baseline_rate_per_30min: <N>
- affected_users_24h: <N>
- is_crash_class: <yes | no>
- cohort_known: <yes | no>
- release_attribution_available: <yes | no>
```

---

## Step 8b — Pick verification mode

Walk top-to-bottom. The first matching row wins.

| # | Condition | Mode |
|---|-----------|------|
| 1 | `release_attribution_available = no` OR MCP capability gate failed | **Deferred-watch** |
| 2 | `is_crash_class = yes` AND `release_attribution_available = yes` | **Build-version absence** |
| 3 | `baseline_rate_per_30min >= 10` | **Rate-decay** |
| 4 | `1 <= baseline_rate_per_30min < 10` OR `baseline_count >= 5` over 24h | **Extended watch** |
| 5 | `baseline_count <= 4` AND `cohort_known = yes` | **Cohort absence** |
| 6 | None of the above (one-shot, no cohort, no attribution) | **Deferred-watch** |

Append the chosen mode to the bug-notes ledger.

---

## Mode procedures

### Rate-decay

Use when the bug fires often enough that a baseline rate is meaningful.

1. Capture deploy ID (PR labels matching `release/*` or `deploy/*`; merge commit's
   `service.version`; CI build number).
2. Build verification query: original query with `service.version = <deploy_id>` and
   `time_range = [deploy_timestamp, deploy_timestamp + 30 minutes]`.
3. Poll at fixed cadence:

   | Time elapsed | Cadence |
   |--------------|---------|
   | 0–10 min     | Every 1 min |
   | 10–30 min    | Every 5 min |

4. Evaluate:

   | Outcome | Condition |
   |---------|-----------|
   | **Decayed** | Post-deploy rate ≤ 5% of baseline rate |
   | **Persistent** | Post-deploy rate > 5% of baseline at the 30-min mark |
   | **Inconclusive** | Total events < 10 in window — escalate to **Extended watch** |

### Extended watch

Use for bugs that fire 1–9 times per 30-min window or sparsely over hours.

1. Capture deploy ID as above.
2. Build verification query: original query with `service.version = <deploy_id>` and
   `time_range = [deploy_timestamp, deploy_timestamp + 24 h]`.
3. Poll once at: `+1 h`, `+6 h`, `+24 h`. Optionally extend to `+7 d` if traffic is low.
4. Evaluate:

   | Outcome | Condition |
   |---------|-----------|
   | **Pass** | Zero events on the new release tag at end of window |
   | **Fail** | Any event matches the originating query on the new release tag |

   For "Fail," capture each matching event as a counterexample in the bug-notes ledger and
   reopen the bug.

### Cohort absence

Use when the bug fired once or a few times but the **affected cohort is known** (specific user,
tenant, device, request, feature flag).

1. Capture deploy ID and the cohort from the Evidence Record (e.g., `user.id = abc123`,
   `tenant = acme`, `device.model = iPhone15,3`).
2. Build verification query: original query AND `service.version = <deploy_id>` AND
   `<cohort_filter>`, over a 7-day window.
3. Poll once at: `+24 h`, `+72 h`, `+7 d`.
4. Evaluate:

   | Outcome | Condition |
   |---------|-----------|
   | **Pass** | No recurrence within the cohort on the new release tag at end of window |
   | **Fail** | Any matching event in the cohort on the new release tag |

If the cohort is small (e.g., a single user), document the cohort verbatim in the bug-notes
ledger so re-verification later is reproducible.

### Build-version absence

Use for crash-class bugs with `release.version` attribution (Crashlytics, Sentry release-health,
Dash0 OTEL crash signals).

1. Capture the new build / release version.
2. Verification query: crashes attributed to `release.version = <new_tag>` over the watch
   window. Optionally restrict to the originating crash signature / fingerprint when the
   telemetry exposes one.
3. Pass criteria — **whichever comes first**:
   - **N session-equivalent**: e.g., 1 000 crash-free sessions on the new release tag (the
     standard Crashlytics-style threshold). Adjust N to the project's release size.
   - **7 days** with zero crashes matching the originating fingerprint on the new release tag.
4. Evaluate:

   | Outcome | Condition |
   |---------|-----------|
   | **Pass** | Threshold reached without a matching crash |
   | **Fail** | Matching crash recorded against the new release tag |

If the project's crash reporter natively supports issue-resolution-against-version (Sentry
"Resolved in next release", Crashlytics "Closed"), additionally mark the issue resolved against
the new release. If the crash recurs on a later session of the same release, the reporter will
auto-reopen.

### Deferred-watch

Use when no other mode applies — one-shot bug, no cohort, no release attribution, or MCP gate
failed.

This mode does **not** mechanically verify. Its job is to register a watch and exit honestly.

1. Capture deploy ID (or, if not available, the merge SHA).
2. Construct the watch artefact: a markdown block with the originating query (or its closest
   reproduction), the new release tag, the watch start / end timestamps, and the cohort if any.
3. Post the watch artefact as:
   - A comment on the originating Linear ticket (if input was a Linear URL).
   - A comment on the PR (always).
   - An entry in the bug-notes ledger.
4. Close the bug as **"deployed; watching for recurrence over `<N>` days"**. Default `N = 14`.
5. If a recurrence is detected (manually, via Linear automation, or by re-invocation of
   `/fix-bug --verify-deploy <PR>`), reopen the bug.

Watch artefact template:

```markdown
### Deferred verification watch

This bug fired once (or rarely) and could not be mechanically verified post-deploy.

- Originating query: <Dash0 URL or query expression>
- New release tag: <tag>
- Watch start: <ISO 8601 UTC>
- Watch end: <start + 14 days>
- Cohort (if any): <user.id / tenant / device — or "none">
- Resolution criterion: no matching event on release tag within the watch window.

Reopen this bug if the originating query produces a match on the new release tag. Re-invoke
`/fix-bug --verify-deploy <PR>` to refresh the watch.
```

---

## Outcomes

### Operating mode

`/fix-bug` is typically not running in the foreground when the deploy actually happens. Phase 8
runs in one of two modes:

| Mode | When | How |
|------|------|-----|
| **Inline** | The deploy completes within the same session as the merge (e.g., dev environment with auto-deploy on merge). Opt-in via `--inline-verify`. | Run synchronously after merge confirmation. |
| **Deferred** (default) | Production deploys happen later (release trains, manual cuts) | Emit a follow-up task: a Linear / PR comment with the verification mode, query, deploy filter, and watch budget. The user (or a CI hook) re-invokes `/fix-bug --verify-deploy <PR>` once the deploy lands. |

Modes 1–4 (rate-decay, extended watch, cohort absence, build-version absence) all produce a
mechanical pass / fail. Mode 5 (deferred-watch) explicitly does not — it produces a watch that
is closed manually.

### Reopened bugs

If any mode returns `fail`, the bug is reopened with the verification artefact (matching events,
deploy ID, comparison rates if applicable). The user decides whether to:

- Roll back the deploy.
- Iterate with `aw-executor` on the same branch (treat the persistent matches as counterexamples).
- Investigate whether the bug class was misdiagnosed (e.g., a config bug shipped as a code bug).

### One-shot bugs are honestly handled

Deferred-watch is **not** a fallback in the apologetic sense — it is the correct mode for bugs
that genuinely cannot be verified by post-deploy observation (rare crashes, edge-case data
shapes, environment-specific timing). The skill's job in that mode is to be honest: deploy the
fix, register the watch, close the case provisionally, and reopen on recurrence.
