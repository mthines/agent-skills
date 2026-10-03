---
title: Deep Mode — parallel multi-lens adversarial review
impact: HIGH
tags:
  - critical
  - deep
  - multi-lens
  - personas
  - sub-agents
  - ideate
---

# Deep Mode

`deep` runs the same pre-mortem from 3–5 independent angles at once, then merges the results into one report.
It is a depth modifier, not a target: combine it with `plan`, `code`, or `analysis` (`/critical deep code`).
**Why:** one hostile persona finds what one hostile persona looks for; independent lenses find disjoint failures, the same way independent generators out-produce one brainstorming context (the `ideate` skill's `rules/divergence.md` applies that evidence to ideas — deep mode applies it to failure modes).

## Contents

- [When to use deep](#when-to-use-deep)
- [Arguments](#arguments)
- [Procedure](#procedure)
- [D1 — Lens selection](#d1--lens-selection)
- [D2 — Lens passes](#d2--lens-passes)
- [D3 — Synthesis](#d3--synthesis)
- [Output format](#output-format)
- [Hard rules](#hard-rules)
- [Common mistakes](#common-mistakes)

## When to use deep

| Use `deep` | Use the single pass |
| --- | --- |
| End of a feature, before opening the PR (`/critical deep code`) | Routine change, one concern, one file area |
| High-stakes change: migration, auth, billing, shared infra, public API | You need an answer in one turn and the budget is tight |
| A single pass returned `No blocking concerns found.` and doubt remains | `/confidence` already passed at ≥ 90 % with zero concerns |
| The change spans ≥ 2 domains (e.g. UI + data model + infra) | A caller agent (`pr-reviewer --critical`, `implement-suggestion`) — they always use the single pass |

Cost: one lens-discovery sub-agent plus one sub-agent per lens (about 5 dispatches at the default of 4 lenses), each lens re-reading the full target, plus D3's re-grounding reads.
Under `optimize-approach --deep`, add O4's `holistic-analysis` trace for every lens candidate that survives the rubric.
Caller agents never add `deep` on their own; it is a human or orchestrator opt-in.

`deep` here is unrelated to `pr-reviewer`'s `deep` depth tier and to `ideate deep` — deep mode calls `ideate` in `quick` mode, and no reviewer tier turns it on.

## Arguments

| Token | Default | Meaning |
| --- | --- | --- |
| `deep` | — | Enables this mode. Recognised **only as the first token**, so free text such as `analysis deep recursion in parser` never turns it on. |
| `plan` \| `code` \| `analysis` | `plan` | Target kind, exactly as in the single pass. Selects the taxonomy every lens walks. |
| `--lenses <n>` | `4` | Lens count, clamped to `3..5`. Includes the baseline lens. |
| `--lenses <a,b,c>` | unset | Explicit kebab-case lens names; skips D1 discovery. The baseline lens is prepended when absent; a list shorter than 3 including it is filled from the [fallback catalog](#fallback-catalog), and a longer one is clamped to 5. A catalog name takes its catalog record; any other name gets a persona derived from the name and 2–3 probes drawn from the mode's taxonomy. No wildcard is added. |
| `--no-ideate` | off | Skip `ideate` discovery and pick lenses from the [fallback catalog](#fallback-catalog). |

```text
✓ /critical deep code
✓ /critical deep code --lenses 5
✓ /critical deep plan --lenses sre-on-call,security-attacker,new-hire-maintainer
✗ /critical code deep             # `deep` not first — runs the single code pass; say "did you mean /critical deep code?"
✗ /critical deep --lenses 9        # clamp to 5 and say so in the report header
```

## Procedure

| Step | Name | Gate |
| --- | --- | --- |
| D0 | Target capture + grounding | Target summarised in one line; the mode's [grounding actions](../SKILL.md#external-grounding-rule) ran once in the main context |
| D1 | Lens selection | Exactly the requested count (3–5), each with a distinct focus; exactly one baseline lens; exactly one wildcard unless the lenses were user-supplied |
| D2 | Lens passes | Every lens returned its YAML or is listed under `Lost lenses`; no lens saw another lens's output |
| D3 | Synthesis | Findings re-grounded, deduplicated, attributed; one steelman chosen; no new findings added |

Detect dispatch by capability, not by tool name: the first dispatch call (D1 discovery, or the D2 batch when `ideate` is missing, `--no-ideate` is set, or `--lenses <names>` was given) is the test.
If it succeeds, run D1 and D2 in sub-agents.
If no dispatch tool exists, or that first call is refused (nested contexts often list `Agent`/`Task` and still refuse it), run D1 and D2 in this context and record `Independence: single-context (reduced)` in the report header.

## D1 — Lens selection

A lens is a record:

```yaml
- name: sre-on-call                 # kebab-case, unique in the run
  persona: "On-call SRE paged at 3 a.m. by this change"
  focus:                            # 2–3 concrete probes, phrased as questions
    - "Which alert fires first, and does it point at this change?"
    - "Can I disable this without a deploy?"
  source: baseline | ideate | catalog | user
  wildcard: false
```

Fill exactly `n` slots (the `--lenses <n>` value) in this order:

1. **Baseline slot (always).** `hostile-staff-engineer` — the [persona contract](../SKILL.md#the-persona-contract) verbatim, `source: baseline`.
   It is the only lens that reports a status for every taxonomy row, so the "skipped rows are listed" rule still holds.
2. **Wildcard slot (always, unless user-supplied).** The ideate wildcard when discovery ran; otherwise the catalog's `wildcard-far-domain` row.
3. **Focused slots (`n - 2`).**
   When `ideate` is installed and `--no-ideate` is absent, discover them with `ideate` in `quick` mode:

   ```text
   Skill("ideate", "quick --no-framing --n <n-2> Which reviewer personas would most likely find why <one-line target> fails in production or is not the best approach? Changed areas: <every changed path or plan section>. Return personas as ordinary professionals adjacent to these areas, each with 2–3 probe questions.")
   ```

   Take the Lead finalists, in rank order, until the focused slots are full.
   `--n` only caps ideate's finalists and never adds any, so a short return is normal: fill every empty slot from the catalog.
   With dispatch available, run that call inside one sub-agent and return only the lens records, so ideate's pool and scoring never enter the critical context.
   Do not relay ideate's "Your verdict" question — the user invoked `critical`, not `ideate`.
4. **Fallback.** When `ideate` is missing or `--no-ideate` is set, fill the focused slots from the catalog below: rows whose "Pick when" matches the target, in table order.
   Report `ideate — skipped (not installed | --no-ideate)` in one line.
5. **Distinctness check.** Drop a lens whose focus probes duplicate another lens's probes, then refill that slot from the catalog.
   Two lenses that would ask the same questions are one lens with double cost.

### Fallback catalog

| Lens | Persona | Pick when the target… | Focus probes |
| --- | --- | --- | --- |
| `sre-on-call` | On-call SRE paged by this change | runs in production (any `code`/`plan` with a deploy) | What alerts? How is it disabled? What is the rollback time? |
| `security-attacker` | External attacker with a valid low-privilege account | touches auth, input parsing, permissions, secrets, or network boundaries | What can I read or do that I could not before? Where is input trusted? |
| `new-hire-maintainer` | Engineer inheriting this code in 6 months | adds abstractions, config, or > 3 new files | What would I misread? Which name lies? Where is the one place to change X? |
| `downstream-consumer` | Owner of a service or UI that calls this | changes an exported API, schema, event, or file format | What breaks for me without a compile error? What do I learn about it, and when? |
| `data-steward` | Owner of the persisted data | migrates, writes, or deletes persisted state | What is lost or duplicated on partial failure? Can the migration run twice? |
| `performance-engineer` | Engineer holding the latency/cost budget | sits on a request path, loop, or batch job | What scales with input size? What new IO runs per request? |
| `end-user` | First-time user on a slow device with a screen reader | changes UI, copy, or user-visible flow | What do I see while it loads, fails, or is empty? Can I complete the task by keyboard? |
| `product-skeptic` | PM asked to justify the scope | is a `plan`, or a feature-sized `code` diff | Which part does the requirement not need? What simpler version ships 80 % of the value? |
| `wildcard-far-domain` | Practitioner from a distant field (aviation checklist designer, pharmacist, accountant) | always eligible as the wildcard | How does my field prevent this class of failure, and does the change have that guard? |

## D2 — Lens passes

Run every lens in parallel, in one dispatch batch.
Each lens prompt is self-contained and contains exactly:

1. The lens record (persona + focus probes).
2. The one-line target summary and how to read it (`plan.md` path, `git diff <base>...HEAD`, or the analysis text).
3. The mode's taxonomy table from [`../SKILL.md`](../SKILL.md) and the [persona contract](../SKILL.md#the-persona-contract)'s three rules (no hedging, no vibes, no re-stating).
4. The grounding instruction: run at least one `Read`/`Grep` of your own before writing findings.
5. The return shape below, and nothing else — no conversation history, no other lens's output, no lessons.

```yaml
lens: <name>
grounding: [<Read/Grep/Bash calls run>]
findings:
  - class: must-fix | should-fix | nice-to-have
    row: <taxonomy row number>
    claim: <specific failure, one sentence>
    cite: <file:line | assumption: "<quoted from the target>">
    cite_source: target | codebase   # target = the plan/diff/analysis names it; codebase = you found it
alternative:                     # exactly one — the lens's steelman candidate
  approach: <one line>
  why_better: [<concrete advantage>, <concrete advantage>]
  reuses: <file or symbol it would reuse, or "none">
rows:                            # baseline lens only — one entry per taxonomy row without a finding
  - row: <n>
    status: ok | skipped
    reason: <one line>
```

**Lost lens.** A lens whose sub-agent errors, times out, or returns YAML that does not parse gets one retry in a fresh sub-agent.
If the retry also fails, list it under `Lost lenses` with the failure, and print the header as `sub-agents (<k> of <n> lenses)`.
If the lost lens is the baseline, run it in this context once after D2 and add `baseline single-context` to the `Independence` line — it has then seen the other lenses' output, and the report must say so.
Never print a lost lens as having returned zero findings.

Single-context fallback: run the lenses one at a time, write each lens's YAML in full before adopting the next persona, and never revise an earlier lens's output after reading a later one.

## D3 — Synthesis

Synthesis merges; it never critiques.
Do these in order:

1. **Re-ground.** For every `cite`, resolve the path or symbol with `Grep`/`Read`.
   A `cite_source: target` citation that does not exist stays and becomes `must-fix` (hallucinated grounding in the target).
   A `cite_source: codebase` citation that does not exist is dropped and listed verbatim (lens, claim, cite) under `Dropped (ungrounded)`, so a human can challenge the drop.
2. **Deduplicate.** Two findings are one when they share the cited location and the failure mechanism.
   Keep the clearest wording, union the lens names into `raised_by`, and take the highest `class` any lens gave.
3. **Keep single-lens findings.** A `must-fix` raised by one lens stays `must-fix` — the point of independent lenses is that one of them sees what the others miss; never require a majority.
4. **Record conflicts.** When one lens marks a row `must-fix` and the baseline lens's `rows` entry gives that row `status: ok`, list both positions under `Conflicts` and keep the higher class.
5. **Pick one steelman.** From the lens alternatives, pick one by these tie-breakers, in order: its `reuses` target resolves in the codebase, smallest blast radius, the wildcard lens's alternative.
   Never break ties by how many lenses proposed something similar — the lenses share one model and one target, so agreement measures shared blind spots, not confirmation.
   Write it in the [steelman structure](../SKILL.md#mandatory-steelman-alternative).
   List every other distinct alternative in one line each under `Other alternatives raised` — `optimize-approach --deep` consumes that list.
6. **Add nothing.** A concern that no lens raised does not enter the report, even if synthesis notices it.
   Name it under `Next step` as a reason to re-run on the revised target instead.

## Output format

```markdown
## Adversarial review (critical/deep/<mode>)

**Target:** <one line>
**Independence:** sub-agents (<k> of <n> lenses)[, baseline single-context] | single-context (reduced)
**Lens discovery:** ideate quick | fallback catalog | user-supplied
**Grounding actions run:** <main-context calls> + <n> lens passes

### Lenses
| Lens | Persona | Source | Findings |
| --- | --- | --- | --- |
| hostile-staff-engineer | Hostile staff engineer, pre-mortem | baseline | <n> |
| <name> | <persona> | ideate · wildcard | <n> |

### Must-fix
1. <claim> — `<file:line>` — raised by: <lens>, <lens> — why it matters in one line.

### Should-fix
1. ...

### Nice-to-have
1. ...

### Conflicts
- Row <n> (<concern>): <lens> says <position>; <lens> says <position>. Kept: <class>.

### Steelman alternative
**Lens:** <name of the lens that proposed it>

<steelman structure>

### Other alternatives raised
- <lens>: <one-line approach> — why better: <the lens's first why_better line>

### Skipped rows (baseline lens)
- Row N (<concern>): <reason>

### Lost lenses
- <lens>: <error | timeout | unparseable YAML> after one retry.

### Dropped (ungrounded)
- <lens>: <claim> — `<cite>` did not resolve.

### Next step
Run `/confidence <mode>` once the must-fix items are addressed.
Do not re-run `/critical deep` on the unchanged target.
```

Omit `Conflicts`, `Other alternatives raised`, `Lost lenses`, and `Dropped (ungrounded)` when empty.
When `Must-fix` and `Should-fix` are both empty, print `No blocking concerns found across <n> lenses.` plus the steelman.

## Hard rules

1. **Parallel, not iterative.** Deep mode is still one pass: N independent lenses in one round, no lens sees another's output, and no second round critiques the first.
2. **Synthesis adds no findings.** It re-grounds, merges, attributes, and picks the steelman — nothing else.
3. **No scores.** `raised_by` lists the lenses that raised a finding; it is not a confidence; never print a percentage or grade.
4. **No fixes.** Deep mode edits no files, exactly like the single pass.
5. **Baseline lens always runs** and alone carries the full row walk.
6. **Independence is reported.** A single-context run, a lost lens, or an in-context baseline is stated in the header; never present it as full sub-agent independence.

## Common mistakes

- Giving every lens the same generic "find bugs" brief. **Fix:** each lens gets its own persona and 2–3 focus probes; the distinctness check drops duplicates.
- Passing lens A's findings to lens B "for context". **Fix:** that turns parallel lenses into a self-refine chain — the bias-amplifying loop the single pass forbids.
- Requiring two lenses to agree before keeping a must-fix. **Fix:** single-lens findings stay; consensus filtering throws away the reason to run deep.
- Letting synthesis "notice" an extra issue and add it. **Fix:** synthesis has no persona and walked no taxonomy; its addition is unattributed and ungrounded — name it as a re-run reason instead.
- Breaking the steelman tie by counting lenses that agree. **Fix:** use the `reuses` / blast-radius / wildcard tie-breakers — the lone dissent is the reason to run deep.
- Relaying ideate's full report or verdict question. **Fix:** only the lens records cross into the critical run.
