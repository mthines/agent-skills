# Run telemetry — where one review's wall clock goes

A review's wall time is roughly its number of model turns times the time one turn takes.
A/B rounds 3–9 on sync-tray#72 measured 13–16 seconds per turn, but only four coarse phases per run — setup, finders, verification, finalize — so no single step's cost was ever known.
This rule gives every run a per-step breakdown, and exports it as a trace in the shape Dash0's AI Coding Insights reads.
[`review-telemetry.mjs`](../scripts/review-telemetry.mjs) is the executable form.

## What is recorded without you

| Step | Recorded by | When |
| --- | --- | --- |
| `prepare` | `prepare-review.mjs` | Starts the run; backdated to the script's own start. Each internal phase (`fetch`, `resolve`, `workspace`, `classify-shape`, `impact-graph`, `packet`, `standards`, `triage-routing`) is a child span with its own start and end. |
| `finalize` | `finalize.mjs` | Adds the outcome (verdict, candidates, confirmed, posted inline) to the run; **finishes and exports the run under `--dry-run`** when it renders; `--no-telemetry` records nothing, for a preview render that a real finalize follows. A finalize that fails to render is an ERROR step and leaves the run open, so the re-run that succeeds is the one exported. |
| `post` | `execute-write-plan.mjs` | A real run's last step; finishes and exports the run. |
| `load` | `worker intent import`, or the caller's `dispatch` | The gap in which the agent reads its definition and rules. A dispatch stamp before `prepare` starts the run there; when the caller ran `prepare` itself (`/pr-review`, `review-loop`), `review-telemetry.mjs dispatch` records the dispatch after it, and the gap holding that record is `load`. |

The ledger is `telemetry.jsonl` next to `context.json` — `context.telemetry.runDir`.
Read it once, right after `prepare-review.mjs` wrote the context:

```bash
RUN_DIR="$(jq -r '.telemetry.runDir' ctx.json)"
TELEMETRY="$AGENT_SUPPORT/pr-reviewer/scripts/review-telemetry.mjs"
```

Most harnesses start a fresh shell for every tool call, so these variables do not survive to the next command.
Write the two literal paths into every marker instead of relying on them; the examples below use the variables only for brevity.

Under `/pr-review` and `review-loop` the caller runs `prepare-review.mjs` once and hands the reviewer `--context`, so the run and its `prepare` step begin in the caller; the reviewer marks its steps into the same ledger. The intent worker runs no prepare at all. `prepare-review.mjs --no-telemetry` starts no run, for a caller that must not.

## What you mark: the model steps

Everything between `prepare` and `finalize` is model time, and only you know where one step ends and the next begins.
Mark a step when it starts; a step ends when the next one starts.
A gap nobody marked is exported as `unmarked`, so the steps always add up to the run.

`prepare-review.mjs` prints the marker for this run on its `markers` line, with both absolute paths filled in, followed by the steps this run's tier and topology will take.
The same two values are in the context as `telemetry.markers.command` and `telemetry.markers.steps`.
Copy the command from there rather than rebuilding it.
On dash0#20655 a deep run that read this rule before Step 1 marked `memory`, `gates`, `finders`, and `judgments`, and never marked `lenses`, `consolidate`, or `verify`, although all three ran.

| Step | Starts at |
| --- | --- |
| `memory` | Step 0.7 / Step 1.0 memory reads |
| `gates` | Step 1.8 |
| `finders` | Phase D, the first finder |
| `lenses` | Step 2.4, the holistic broad pass |
| `consolidate` | Step 2.5 |
| `verify` | Step 2.6b, your own candidates — on the first command that verifies one, with `--attr candidates=<n>` ([below](#verify-opens-before-the-verification-it-measures)) |
| `intent-wait` | hybrid only: after `verify`, waiting for the intent file; `--wait` records the wait as `intent_wait_ms` |
| `intent-verify` | hybrid only: deduping and verifying the intent candidates the verified pool did not already hold |
| `judgments` | writing `judgments.json` |
| `validate` | the `validate-judgments.mjs` command — it closes `judgments`, so that step gets a tool-call count too |
| `impact-image` | only when `context.impactImage.eligible`: the dry-run finalize that numbers the findings ([`posting.md` § The impact image](./posting.md#the-impact-image)); the real `finalize` closes it |
| `assert` | Step 4a's pre-write assertions, after `finalize` and before `post`; not under `--dry-run`, where `finalize` has already exported the run |

A step that does not run this time — `memory` when memory is skipped, `intent-wait` and `intent-verify` outside `hybrid`, `lenses` on `quick`, `impact-image` when the image is not eligible — gets no marker.
Step 4c and 4d's LoreKit writes are not a step: they run after `post` has already exported the run, so a marker there records nothing.

**Never spend a tool call on a marker.**
A turn costs 13–16 seconds; ten markers issued on their own would add two minutes to the run they measure.
Put the marker in front of the step's first real command, joined with `;`.
A marker always exits 0 — a misuse is a stderr warning — so it can never stop the command after it.

```bash
# correct: the marker rides on the command the step needed anyway
node "$TELEMETRY" step verify --attr candidates=6 --run-dir "$RUN_DIR"; rg -n "pendingCount" "$WORKDIR"

# incorrect: a turn spent on the marker alone
node "$TELEMETRY" step verify --attr candidates=6 --run-dir "$RUN_DIR"
```

**When a step starts with a Read or Write tool call**, which cannot carry a marker, put the marker on that step's first shell command instead.
A few seconds booked to the previous step costs less than a turn, and it never justifies writing a file through a heredoc instead of the Write tool.

**Pass your running tool-call count on every marker**, as `--attr tool_calls_so_far=<N>`: the number of tool calls you have made in this run so far.
The trace turns consecutive counts into `pr_review.step.tool_calls` per step.
It separates a step that is slow because it takes many turns from one that is slow because each turn generates a lot: in round 10 on sync-tray#72, `finders` was 11 calls in 212 s and `verify` was 2 calls in 205 s.
The count is yours, so it is approximate; the trace labels it as reported.

```bash
node /abs/review-telemetry.mjs step verify --attr tool_calls_so_far=34 --attr candidates=20 --run-dir /abs/run; rg -n "pendingCount" /abs/workdir
```

Attach a count to the open step with `--attr`; `verify` requires one (below).
Keys are prefixed `pr_review.` automatically, so a marker can never overwrite a `gen_ai.*` or VCS attribute.

### `verify` opens before the verification it measures

1. Put the `verify` marker on the **first command that verifies one of your own candidates**.
2. Give it `--attr candidates=<n>`: the consolidated candidates you are about to verify, `0` when there are none.
3. Never put it on the same command as `intent-wait`, `intent-verify`, or `judgments`, and never issue it after the verification ran.

`review-telemetry.mjs` prints a stderr note for a `verify` marker without a count, and for a marker that closes `verify` after under a second or zero tool calls while it held candidates; that `verify` is flagged `pr_review.empty=true` in the trace and `EMPTY` in the summary.
A `verify` with `candidates=0` may close at once.
`prepare-review.mjs` lists the requirement on its `markers` line and in `telemetry.markers.attrs`.

```bash
# correct: verify rides on the first verification command, with its count
node "$TELEMETRY" step verify --attr tool_calls_so_far=34 --attr candidates=6 --run-dir "$RUN_DIR"; sed -n 80,120p "$WORKDIR/src/jobs/sync.ts"

# incorrect: verify chained onto the next marker — the whole verification is booked to intent-wait
node "$TELEMETRY" step verify --attr tool_calls_so_far=34 --run-dir "$RUN_DIR"; node "$TELEMETRY" step intent-wait --attr tool_calls_so_far=34 --run-dir "$RUN_DIR"
```

**Why:** a `verify` closed early books its verification to the next step, so the trace blames the wrong step and hides how many candidates the time bought.

**Sub-agents.**
In the hybrid default, fold the intent worker in when you read its file, on the same command, after `verify`.
With `--wait <s>` it first polls for the file (every 2 s, 10 minutes in total across calls), prints `intent: ready after <s>s wait`, `intent: not ready … re-run this command`, or `intent: timed out …`, and records the wait as `intent_wait_ms` on the `intent-wait` step, the worker span, and the root — `pr_review.intent_wait_ms` is the number that says whether reading late brought the wait to ~0.
It prints one stderr line saying what it folded in.
When the caller left a dispatch stamp in the worker's directory (`dispatched_at`, or the `-<unix seconds>` suffix `/pr-review` puts on it), the run and the worker both start at the dispatch.
A delivered worker also tells `finalize.mjs` that the intent finder was isolated, so `--no-dispatch` does not report it as having run in-context:

```bash
INTENT_FROM="/the/path/passed/as/--intent-from/intent.json"
node "$TELEMETRY" step intent-wait --attr tool_calls_so_far=41 --run-dir "$RUN_DIR"; node "$TELEMETRY" worker intent import --from "$(dirname "$INTENT_FROM")" --done "$INTENT_FROM" --wait 540 --run-dir "$RUN_DIR"; cat "$INTENT_FROM"
```

**Stopping early.**
If you stop before a finalize succeeds, finish the run on your last command so the failure is exported rather than left in the ledger:

```bash
node "$TELEMETRY" finish --status error --message "<why the run stopped>" --run-dir "$RUN_DIR"
```

A finalize re-run after one that already exported is not added to the trace; the summary line says so.

## What the trace takes from you

### The memory

The root span says which LoreKit memories the review used and read, and links each one back to LoreKit.
`finalize.mjs` records them from `judgments.memory` as one `memory` ledger record; a finalize re-run replaces it.
You supply the inputs only: copy `id`, `scope`, and `key` onto every `memory.relevance_rules[]` and `memory.lessons_used[]` entry — `id` from the `memory_list` / `memory_search` entry, since `memory_read` returns none, and `scope` from the call when the entry omits it — and list every body you fetched with `memory_read` in `memory.read[]` ([`posting.md`](./posting.md)).

| Where | Attribute | Value |
| --- | --- | --- |
| root | `pr_review.memory.used` | memories that shaped the review — every `lessons_used[]` entry and every relevance rule that acted (an applied action, or a finding it suppressed), the same set Step 4c cites. The report's `Memories — … used` also lists idle rules, so the two counts can differ |
| root | `pr_review.memory.read` | memories whose body the run fetched; omitted when `memory.read` is absent |
| root | `pr_review.memory.used_ids` | the used memories' LoreKit ids, comma-separated — filter runs by one with `contains` |
| root | `pr_review.memory.suppressed` | findings a relevance rule suppressed this run |
| event `pr_review.memory.used` · `pr_review.memory.read` | `pr_review.memory.id`, `.scope`, `.key`, `.kind` (`rule` · `knowledge` · `hotspot` · `lesson`) | one event per memory; `used` when it shaped the review, `read` when it was only read — an idle relevance rule included |
| event | `pr_review.memory.url` | `<LOREKIT_APP_URL>/lore?memoryId=<id>`, else `/lore?scope=…&lesson={scope,key}`; omitted when neither is known — never fabricated |
| event | `pr_review.memory.action`, `.note`, `.fingerprint`, `.seen_count`, `.suppressed` | what it did: a rule's direction or applied action, a lesson's `used_as`, and the findings it suppressed |

A memory named in more than one array is one event, matched by `id`, else by `key` in the same scope.
At most 50 events are kept, used memories first.
A run whose finalize never ran carries none of these, so "no memory attributes" means unknown and `pr_review.memory.used=0` means none was used.

```text
# correct: id, scope, and key from the list or search entry — the trace links it by id
{ "id": "cb10f4e2-eaf1-48e1-933c-e633a23e2716", "scope": "repo::acme/widget", "key": "hotspot::src/api/client.ts", "used_as": "finder pointer (re-verified)" }

# incorrect: the id dropped — the trace falls back to the scope + key link, and a key alone gets none
{ "key": "hotspot::src/api/client.ts", "used_as": "finder pointer (re-verified)" }
```

### The lenses

The root span says which review lenses loaded, how each one loaded, and what each one raised.
`finalize.mjs` records them from `context.lenses` and `judgments.candidates` as one `lenses` ledger record; a finalize re-run replaces it.
You supply the inputs only: give every lens candidate `"finder": "lens"` and the `lens` name from `context.lenses.loaded[].name` ([`rubric-composition.md`](../../shared/rules/rubric-composition.md)).

| Where | Attribute | Value |
| --- | --- | --- |
| root, `lenses` step | `pr_review.lenses.loaded` | lenses the review walked |
| root, `lenses` step | `pr_review.lenses.names` | their names, sorted and comma-separated — group runs by it, or filter by one lens with `contains`; omitted when none loaded |
| root | `pr_review.lenses.findings`, `pr_review.lenses.confirmed` | lens candidates raised, and how many verification confirmed |
| root | `pr_review.lenses.skipped` | lenses named or found that did not load |
| event `pr_review.lens.loaded` · `pr_review.lens.skipped` | `pr_review.lens.name` | one event per lens; `skipped` carries only the name and `pr_review.lens.reason` |
| event `pr_review.lens.loaded` | `pr_review.lens.trigger` | `auto` (built-in auto lens) · `repo` (`.agents/review/lenses/`) · `review-yaml` (a `.review.yaml` `lenses:` list) · `with` (`--with`) · `unlisted` (named only by a candidate, such as the gated `animations` lens) · `other` |
| event `pr_review.lens.loaded` | `pr_review.lens.origin`, `.source` | `repo` · `repo-skill` (`.agents/skills/<name>/lens.md`) · `bundled`, and the lens file's path; omitted for `unlisted` |
| event `pr_review.lens.loaded` | `pr_review.lens.reason`, `.files`, `.findings`, `.confirmed` | the full selection reason, the changed files its trigger matched, and the candidates it raised |

At most 50 events are kept, loaded lenses first.
A run whose finalize never ran, or whose context predates lens selection, carries none of these, so "no lens attributes" means unknown and `pr_review.lenses.loaded=0` means none loaded.

```text
# correct: the lens candidate names its lens — the trace counts it against tdd
{ "finder": "lens", "lens": "tdd", "path": "src/retry.ts", "line": 120, "claim": "the retry loop has no test" }

# incorrect: the lens is missing — the candidate counts against no lens
{ "finder": "lens", "path": "src/retry.ts", "line": 120, "claim": "the retry loop has no test" }
```

## Exporting and querying

Export settings, the span and attribute contract, the instrumentation scope, the run counter, the cost query, and the proof live in [`references/run-telemetry-export.md`](../references/run-telemetry-export.md); a review never needs them to mark its steps.
