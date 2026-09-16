# Telemetry Schema (OpenTelemetry Weaver)

[OpenTelemetry Weaver](https://github.com/open-telemetry/weaver) is the OTel project's tool for
treating telemetry as a versioned, validated contract instead of as strings scattered through the
code.
It reads a **registry** — a directory of semantic-convention YAML plus a `manifest.yaml` — and uses
it to validate the schema, to validate a real OTLP stream against that schema, to diff two versions
of it, and to generate typed constants and documentation from it.

This rule file is advisory in every mode.
Weaver is an external binary, not a skill, and the repo may not have adopted it: when it is absent,
name it once and continue with the rest of the skill, exactly as Core Principle 6 requires for the
companion skills.

## The question Weaver adds

The other rule files here ask two questions.
Weaver asks a third, and nothing else in this skill does:

| Question                                                          | Owned by                                                                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Does a signal exist for this change?                               | [`scope-detection.md`](./scope-detection.md) → [`backend-instrumentation.md`](./backend-instrumentation.md) / [`frontend-rum.md`](./frontend-rum.md) |
| Does anything watch it?                                            | [`regression-signals.md`](./regression-signals.md)                                                              |
| Is it the signal it claims to be, and will it still be tomorrow?   | **this file**                                                                                                   |

The third question is not a naming preference.
A metric renamed from `checkout.duration` to `checkout.request.duration` keeps every dashboard
rendering, every check rule evaluating, and every panel empty — the alert does not fire, because the
series it queries no longer exists.
That is a regression with no error, no failed test, and no log line, and it is invisible to the
first two questions: a signal existed before the change, a signal exists after it, and something
watches a name that is now unused.

## Step 1 — Decide whether Weaver is in scope for this change

First match wins.
Do not raise Weaver on a change it has nothing to say about.

| Condition                                                                                               | Action                                                                                          |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The Observability Profile's **Telemetry Schema** section names a registry                                   | In scope. Follow Steps 2–4.                                                                        |
| No profile, or the profile records `none`, **and** the change introduces at least one new attribute, metric, span, event, or entity name | Advisory. Name [Rung 0](#rung-0--live-check-against-upstream-semconv-no-registry-to-author) once, in one line, and do not block on it. |
| The change emits only signal names that already exist                                                       | Out of scope — there is no new contract to validate.                                               |
| Every changed path classifies `infra` or `shared-lib`                                                       | Out of scope — neither emits a signal of its own.                                                  |
| `weaver` is not on `PATH` and this environment cannot install it                                            | Advisory only. Report what a run *would* check, never a finding graded as if it had run.           |

## Step 2 — Read the profile before assuming anything

[`setup-profile.md`](./setup-profile.md)'s interview records the registry path, the pinned Weaver
version, the upstream semconv version the registry depends on, and whether CI already runs a check.
Read the **Telemetry Schema** section of
[`templates/observability-profile.template.md`](../templates/observability-profile.template.md)
before proposing anything — a repo that already gates on `weaver registry check` does not need to be
told to adopt Weaver, it needs its new signal added to the registry in the same diff.

## Step 3 — The registry

A registry is a directory containing a `manifest.yaml` and one or more semantic-convention YAML
files.

```yaml
# manifest.yaml
name: acme
description: Semantic conventions owned by the Acme platform team.
schema_url: https://acme.com/schemas/0.1.0
dependencies:
  - schema_url: https://opentelemetry.io/schemas/1.40.0
    registry_path: https://github.com/open-telemetry/semantic-conventions@v1.40.0[model]
```

`schema_url` must include a version segment; it identifies the registry and its version for
provenance and conflict resolution, and it does not have to be fetchable.
Signals are declared as groups, and a group either defines a name or references one that already
exists upstream:

```yaml
groups:
  - id: metric.acme.checkout.duration
    type: metric
    metric_name: acme.checkout.duration
    instrument: histogram
    unit: s
    stability: development
    brief: 'End-to-end duration of a checkout attempt.'
    attributes:
      - ref: http.response.status_code # reused from the OTel registry, never redefined
        requirement_level: required
```

Reusing an upstream attribute by `ref` is the point: a locally invented `status_code` next to the
registry's `http.response.status_code` is exactly the duplicate
[`backend-instrumentation.md`](./backend-instrumentation.md) forbids, and the registry makes it
mechanically detectable instead of a review opinion.

## Step 4 — The commands, and what each one answers

| Command                            | Answers                                                                         | When to reach for it                                     |
| ------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `weaver registry check`              | Is the schema itself valid, resolvable, and policy-conformant?                     | CI, on every change to the registry.                       |
| `weaver registry live-check`         | Does the telemetry a real run **emitted** conform to the schema?                   | The dev loop, and CI around the test suite.                |
| `weaver registry diff`               | What changed between two registry versions, and is any of it breaking?             | Release, and any PR that renames or deprecates a signal.   |
| `weaver registry generate`           | Typed constants and docs, so an attribute name is a compile error, not a typo.     | Once, then on every registry change.                       |
| `weaver registry emit`               | Example signals for the whole registry, for a round-trip test.                     | Verifying a live-check setup before trusting it.           |
| `weaver registry infer`              | A starting registry inferred from an OTLP stream.                                  | Bootstrapping a repo that already emits telemetry.         |
| `weaver registry mcp`                | An MCP server exposing the registry to an LLM over stdio.                          | Looking an attribute up while writing instrumentation.     |

Two notes on lookup, because getting this wrong wastes a turn:

- `weaver registry mcp -r <registry>` is the lookup path for an agent.
  It serves the registry over stdio JSON-RPC so "is there already an attribute for the tenant id?"
  is a query rather than a guess.
- `weaver registry search` is **deprecated** and is not V2-schema compatible.
  Do not recommend it; use the MCP server, or the documentation `weaver registry generate` produces.

## The adoption ladder

Cheapest first, and each rung is useful standing alone.
Never propose rung *n* + 1 to a repo that has not taken rung *n*.

### Rung 0 — live-check against upstream semconv, no registry to author

`--registry` defaults to the upstream OTel semantic conventions, so the first useful run needs no
registry, no `manifest.yaml`, and no commit:

```bash
weaver registry live-check                       # OTLP listener on 127.0.0.1:4317
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317 ./run-the-thing
```

This immediately reports invented names that collide with the registry, wrong attribute types,
non-conforming namespaces, and use of deprecated attributes.
It is the highest-value single command in this file, and it costs a repo nothing to try.

### Rung 1 — commit a registry and check it in CI

Author the registry for the signals the repo owns, then gate the schema itself:

```bash
weaver registry check -r ./model --diagnostic-format gh_workflow_command
```

`--diagnostic-format` also takes `json` (for programmatic consumption) and `ansi` (the default).
The process exits 0 when the registry is valid.

### Rung 2 — generate constants and instrument against them

`weaver registry generate <target> <output>` renders the registry through Jinja templates into code
or documentation.
The value here is not the boilerplate: it converts the largest class of telemetry defect — a
misspelled attribute key, discovered in production as a missing dashboard series — into a build
failure.

### Rung 3 — diff the registry and gate the contract

See [`weaver registry diff` as a regression detector](#weaver-registry-diff-as-a-regression-detector)
below.
This is the rung that pays for the previous three.

## Live-check in the dev loop

Live-check takes samples from OTLP (the default), a file, or stdin, pairs each sample with a signal
in the registry, and reports findings at three levels — `violation`, `improvement`, and
`information`.
It exits non-zero when the report contains any `violation`.

```bash
weaver registry live-check --registry ./model --format json --output ./weaver-out &
LIVE_CHECK_PID=$!
sleep 3
# run the code under test, exporting OTLP to 127.0.0.1:4317
kill -HUP $LIVE_CHECK_PID
wait $LIVE_CHECK_PID    # non-zero if any violation was reported
```

A span name is free-form and a resource is a bare set of attributes, so neither says which
definition it belongs to.
Declare a matcher when a sample needs pairing with a signal (matchers require a v2 registry):

```toml
[[live-check.matchers]]
id = "match.checkout"
sample_type = "span"
when = '"acme.checkout.id" in attributes'
signal = "acme.checkout"
```

The report also carries statistics, of which `registry_coverage`, `seen_registry_attributes`, and
`seen_non_registry_attributes` are the useful ones: the last of these is the list of names the code
emits that no schema defines.

## Live-check in CI

Three first-party GitHub Actions cover the CI path, and they run on Linux runners only in v1:

```yaml
- uses: open-telemetry/weaver/.github/actions/setup-weaver@main
- uses: open-telemetry/weaver/.github/actions/weaver-live-check-start@main
  id: live-check
  with:
    registry: './model'
- env:
    OTEL_EXPORTER_OTLP_ENDPOINT: ${{ steps.live-check.outputs.otlp-grpc-endpoint }}
  run: ./run-the-test-suite
- uses: open-telemetry/weaver/.github/actions/weaver-live-check-stop@main
  if: always()
  with:
    fail-on: none # tighten to `violation` once the existing findings are cleared
```

`weaver-live-check-stop` does more than stop the listener: it fetches the report, renders a job
summary, uploads the JSON as an artifact, exposes `violations` / `improvements` / `informations` /
`samples` as outputs, and fails the job when the worst finding reaches `fail-on`.
Call it with `if: always()` or a failing build step leaves the listener running.

**Start at `fail-on: none`.** A repo adopting live-check against an existing codebase has findings
on day one, and a first run that fails the build gets the whole step deleted rather than the
findings fixed. The action's own documentation says to start there and tighten.

## Controlling the noise instead of deleting the check

The reason a conformance check gets switched off is a finding the team has decided not to act on
firing on every run.
`.weaver.toml` resolves that without weakening the check for everything else.
Filters drop a finding; level overrides change its severity and are applied **before** filters, so a
`min_level` filter sees the overridden level:

```toml
[[live-check.finding_filters]]
exclude_samples = ['trace.parent_id', 'trace.span_id'] # never registry attributes, never will be

[[live-check.finding_filters]]
signal_type = 'span'
exclude = ['not_stable'] # a development-stability signal is the point of a development registry

[[live-check.finding_level_overrides]]
ids = ['undefined_enum_variant']
level = 'violation' # information by default; this repo treats it as a break
```

Prefer a narrowly scoped filter (`sample_names`, `signal_type`) over a global one, and prefer a
level override over an exclusion — a finding demoted to `information` still appears in the report,
whereas an excluded one is gone.

Beyond the built-in advisors, custom rules are Rego policies in the `live_check_advice` package
(`--advice-policies`), and registry-check policies are Rego in the `after_resolution` package
(`-p` / `--policy`). Both return findings carrying `id`, `message`, and `level`.

## `weaver registry diff` as a regression detector

This is the part of Weaver that belongs to *this* skill rather than to instrumentation generally.

[`regression-signals.md`](./regression-signals.md) Question 2 asks what would change if the code
regressed.
A telemetry contract has its own answer to that question, and it is not covered by any metric the
code emits: the regression is the **rename**, and its symptom is a query that silently returns
nothing.

```bash
weaver registry diff -r ./model \
  --baseline-registry 'https://github.com/acme/semconv@v1.4.0[model]' \
  --format json
```

The diff classifies every top-level change as `added`, `renamed`, `updated`, `obsoleted`,
`uncategorized`, or `removed`.
Read them like this:

| Change type    | What it costs the people watching the signal                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `added`          | Nothing. A new signal breaks no existing query.                                                                       |
| `updated`        | Usually nothing, unless a unit or an instrument type changed — then every panel's axis is wrong and no query errors.  |
| `renamed`        | **Breaking.** Every dashboard panel, check rule, and saved query on the old name goes quiet, not red.                 |
| `obsoleted`      | Breaking on the same schedule as the consumers' migration; the old name still resolves, so nothing announces it.      |
| `removed`        | **Breaking and disallowed.** The convention is to deprecate, never remove; a `removed` in a diff is a defect to fix.  |
| `uncategorized`  | Unknown — read it by hand. It is the fallback for changes the differ could not classify.                              |

A `renamed`, `obsoleted`, or `removed` entry is a `missing` finding in
[`audit-checklist.md`](./audit-checklist.md) terms, not an `unlinked` one, and the fix named in the
finding is the migration — update the dashboards and check rules, or keep the old name emitting
alongside the new one for a release.
Naming the gap is where this skill stops: proposing the dashboard or check-rule edit goes through
Dash0 chat, per [`regression-signals.md`](./regression-signals.md).

## What a green Weaver run proves, and what it does not

A conformance check run by the same agent that authored both halves of the thing being compared
proves less than it appears to.
Split the report before citing it:

| Finding source                                                                                 | By-construction? | Citable as evidence                                               |
| ------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------- |
| The **upstream** semconv registry and the default OTel Rego policies — namespacing, formatting, stability, deprecation, type mismatch | No — nobody in this change wrote those rules | **Yes.** This is the load-bearing half of a live-check run.        |
| A registry group **this same change** authored, matched against instrumentation the same change authored | Yes | No. The two halves of one diff agreeing says nothing about either. |
| `weaver registry check` passing                                                                    | —                   | Only that the schema is well-formed. It does not mean any code emits the signal. |

This is the same rule
[`observe-run`'s assertion provenance](../../observe-run/rules/assertion-provenance.md) applies to
expectations, and it is why Weaver never replaces the prove-it step in `implement` mode:

- **Weaver live-check** grades the telemetry's *shape* against a schema — names, types, requirement
  levels, stability.
- **[`observe-run`](../../observe-run/SKILL.md)** grades the run's *behaviour* — span count per
  invocation, parent/child structure, attribute cardinality.

Neither answers the other's question. A run can be perfectly conformant and emit one span where
three were expected, and it can emit exactly the right three spans under names no registry knows.
Run both when both are available; never report one as though it covered the other.

## Audit-mode mapping — three verdicts, never a fourth

`audit` mode grades every finding as `missing`, `unlinked`, or `pass`
([`audit-checklist.md`](./audit-checklist.md)).
Weaver findings fold into those three.
Do **not** introduce a fourth verdict: the `pr-reviewer` measurability lens maps exactly these three
([`measurability-review.md`](../../../../agents/shared/rules/measurability-review.md)), and a
verdict it has no row for is a finding that reaches no surface.

| Weaver observation                                                            | Audit verdict                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A new signal in the diff appears in no registry group, and the profile names a registry | `missing` — the contract for a signal this change added does not exist.       |
| A `renamed` / `obsoleted` / `removed` entry in `weaver registry diff`             | `missing` — a consumer is about to go quiet and nothing names the migration.  |
| A registry group exists but no dashboard, check rule, or query reads the signal   | `unlinked` — the existing Question-3 answer, reached by a different route.    |
| A live-check `violation` on naming, type, or stability                            | Report it, cite the finding `id` and `path:line`, and grade it against the rule above — never invent a verdict for it. |
| Live-check clean, registry current, detector named                                | `pass`.                                                                        |

One boundary, stated because the two files would otherwise disagree: the `pr-reviewer` measurability
lens does not turn a naming or conformance finding into a review comment.
Its own "What this rule does not do" section assigns a wrong attribute name to the standards or
`code-quality` lens.
Registry conformance is for a standalone `audit` run, for `implement` mode, and for the
`autonomous-workflow` gate — not for that lens.

## Hard rules

1. **Advisory, always.** Weaver's absence never blocks a mode, never fails a gate, and never
   escalates a finding. Say "weaver not installed — schema conformance unchecked" in one line and
   move on.
2. **Never adopt Weaver as part of an unrelated change.** Introducing a registry is its own PR.
   A diff that adds one endpoint and a whole semantic-convention registry is two changes, and the
   reviewer will read neither.
3. **Never start CI at `fail-on: violation`.** Start at `none`, fix the backlog, then tighten.
4. **Pin the versions.** Pin the Weaver version in the `setup-weaver` action and the upstream
   semconv dependency to a released tag in `manifest.yaml`. An unpinned registry makes a CI failure
   arrive on a day nobody changed anything.
5. **Never edit a Dash0 dashboard, check rule, or SLO** to match a renamed signal. That boundary is
   unchanged by this file — propose it through Dash0 chat.
6. **A registry entry is not a signal.** Adding a group to the registry does not emit anything. The
   coverage question stays where it was, in
   [`backend-instrumentation.md`](./backend-instrumentation.md).

## Anti-patterns

- Citing a green `weaver registry check` as evidence that a change is instrumented — it validates
  YAML, and a registry full of signals no code emits passes it.
- Renaming a metric or an attribute in the registry and shipping it as a non-breaking change because
  no test failed. No test can fail; the consumers are dashboards and check rules.
- Reading `registry_coverage` as a quality score. It is the fraction of the registry the samples
  happened to touch, so it falls whenever the registry grows and whenever a test path is not
  exercised.
- Excluding a whole finding `id` globally to silence it on two attributes, when `sample_names`
  scopes the same filter to exactly those two.
- Proposing `weaver registry search` for attribute lookup. It is deprecated and not V2-compatible —
  use `weaver registry mcp`, or the generated documentation.
- Treating a live-check pass as a substitute for `observe-run`'s behavioral expectations, or the
  reverse. They grade different things and neither is evidence for the other.
