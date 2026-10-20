# Agent Skills

> An opinionated workflow for coding agents — my own way of working, current best practices, and lessons from real projects — kept only where evals show it helps.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Agent Skills spec](https://img.shields.io/badge/spec-Agent%20Skills-7c3aed)](https://agentskills.io/)
[![Skills](https://img.shields.io/badge/skills-51-0a7)](#skills-at-a-glance)
[![Agents](https://img.shields.io/badge/agents-5-0a7)](#agents-at-a-glance)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-supported-d97706)](https://claude.com/claude-code)

These skills encode how I build software with agents: scope the task, build against checks, get a second pair of eyes on the diff, prove the UI works, and keep CI green.
Each one is run with and without itself; a skill that doesn't change the outcome gets cut.
They install into Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, OpenCode, and any other [Agent Skills](https://agentskills.io)-compatible tool.

```bash
git clone https://github.com/mthines/agent-skills.git
cd agent-skills && bash scripts/sync-symlinks.sh
```

## What you get

<table>
<tr>
<td width="50%" valign="top">

### Ship a feature from one sentence

`aw` scopes the job, writes a short brief with sealed checks, builds until they pass, gets a fresh-eyes review, and opens a draft PR.

```text
Add dark mode to settings, all the way to a PR
```

[`aw`](#featured-autonomous-workflow) · [`autonomous-workflow`](./skills/workflow/autonomous-workflow/SKILL.md)

</td>
<td width="50%" valign="top">

### Fix a bug from whatever you have

A stack trace, a span URL, a screen recording, a ticket, or a hunch: it reproduces the bug, traces the root cause, fixes it behind a failing test, and opens a draft PR.

```text
/fix-bug <stack trace | span URL | file:line>
```

[`fix-bug`](./skills/workflow/fix-bug/SKILL.md) · [`video-analyser`](./skills/analysis/video-analyser/SKILL.md)

</td>
</tr>
<tr>
<td valign="top">

### Reviews that catch real bugs

Independent finders flag, a verifier filters, and only grounded findings reach your PR. `review-loop` then fixes or answers every thread until the PR converges.

```text
/pr-review 42
/review-branch
```

[`pr-reviewer`](./agents/pr-reviewer.md) · [`review-loop`](./skills/quality/review-loop/SKILL.md) · [`review-branch`](./skills/quality/review-branch/SKILL.md)

</td>
<td valign="top">

### Proof the UI actually works

A plain-language spec lives in the PR, runs against the preview or your local stack, then tries to break the change — with screenshots and recordings attached.

```text
/ui-verify verify <pr-url>
```

[`ui-verify`](./skills/testing/ui-verify/SKILL.md) · [`local-verify`](./skills/testing/local-verify/SKILL.md) · [`e2e-testing`](./skills/testing/e2e-testing/SKILL.md)

</td>
</tr>
<tr>
<td valign="top">

### Product craft, not just code

Audits walk the user's real path before checking contrast; visual direction, motion, charts, and behaviour change get the same rigor. Never a dark pattern.

```text
Review the UX of the onboarding flow
```

[`ux`](./skills/design/ux/SKILL.md) · [`visual-design`](./skills/design/visual-design/SKILL.md) · [`animations`](./skills/design/animations/SKILL.md) · [`charting`](./skills/design/charting/SKILL.md)

</td>
<td valign="top">

### Merge-ready, every time

A narrative PR description, a simplify pass that cuts noise without changing behaviour, CI fixes that never weaken a check, and telemetry that proves the change landed.

```text
/create-pr
/ci-auto-fix
```

[`create-pr`](./skills/delivery/create-pr/SKILL.md) · [`polish`](./skills/quality/polish/SKILL.md) · [`ci-auto-fix`](./skills/delivery/ci-auto-fix/SKILL.md) · [`measurable`](./skills/quality/measurable/SKILL.md)

</td>
</tr>
</table>

Most skills trigger from plain language — describe what you want. The rest are slash commands you type when you want them.

## Measured, not assumed

Every skill here has to earn its place in the context window.
Each one is run with and without itself on hard, real-usage cases; skills that changed nothing were deleted or folded into the skill that calls them.

- **Over 400 KB less prompt.** Seven skills and three agents cut; the reviewer's prompt went from 202 KB to 60 KB; skill descriptions from 44k to 17k characters.
- **`aw` beats a plain Claude Code run.** On three real tickets, each pair blind-judged by two independent reviewers, `aw` won 10 of 12 judgements — 8 of 8 since its current design. Every win came from a defect its fresh-eyes review caught that the plain run shipped. It costs about 1.5–2× a plain run, so reach for it when a missed bug costs more than that.
- **`/polish simplify` went from 0.73 to 1.00** on planted-defect evals, and the rewritten `ux` ranked first on 3 of 3 real audits against both the old skill and no skill.

The `aw` runs used Claude Opus 5.5. Method and every run: [PR #241](https://github.com/mthines/agent-skills/pull/241).

## Contents

- [Measured, not assumed](#measured-not-assumed)
- [Featured: autonomous workflow](#featured-autonomous-workflow)
- [Try it](#try-it)
- [Skills at a glance](#skills-at-a-glance) · [Agents at a glance](#agents-at-a-glance)
- [Install](#install) · [VS Code extension](#vs-code-extension) · [Domain navigator](#domain-navigator-per-project-plug-in)
- [Repository structure](#repository-structure) · [Local development](#local-development) · [Contributing](#contributing)

## Featured: autonomous workflow

![aw: one sentence in, a reviewed pull request out. It sizes the job (Micro, Lite, Full); a Full task runs Brief, Build until green, Fresh-eyes review, and Draft PR in an isolated worktree.](./assets/aw-flow.png)

**You write one sentence. `aw` delivers a tested, reviewed pull request.**

```text
Implement a dark-mode toggle independently
Add user authentication end-to-end
Refactor the API client to use retry logic — handle it in isolation
```

1. **Sizes the job.** Micro (one file) and Lite (a small change) finish in one pass; Full gets the loop below.
2. **Writes a short brief.** At most 60 lines: what done means, what must not change, and one sealed, runnable check per goal. Outcomes, never a design.
3. **Builds until green.** In your session, in its own Git worktree, looping on the checks until they print `CHECKS n/n PASS`. New code copies the mechanisms the codebase already has.
4. **Gets a fresh-eyes review.** A reviewer that did not write the code reads the diff; every finding is fixed or rejected with evidence. This is the step that wins the [benchmarks](#measured-not-assumed).
5. **Opens a draft PR** with a walkthrough and evidence, then gets CI green. Stuck after five attempts, it stops with `BLOCKED:` instead of guessing.
6. **Learns** from every run.

Each run also prints a paste-ready `/goal` line, so you can let the session drive itself to done hands-off.

### Under the hood

`aw` is a skill, so it runs in your session; [`aw/rules/full-tier.md`](./skills/workflow/autonomous-workflow/aw/rules/full-tier.md) is the whole Full procedure.

| Step | Unit |
|------|------|
| Brief | [`aw-create-plan`](./skills/workflow/aw-create-plan/SKILL.md) writes `plan.md` + `checks.yaml`, sealed by `checks.lock` |
| Build | [`run-checks.mjs`](./skills/workflow/autonomous-workflow/scripts/run-checks.mjs) prints the one sentinel line the loop gates on |
| Review | the [`branch-reviewer`](./agents/branch-reviewer.md) agent; once a PR exists, [`review-loop`](./skills/quality/review-loop/SKILL.md) |
| UI spec | the [`aw-tester`](./skills/workflow/autonomous-workflow/templates/aw-tester.agent.md) agent, when the diff touches UI |
| PR + CI | [`create-pr`](./skills/delivery/create-pr/SKILL.md), [`feature-pr-verifier`](./agents/feature-pr-verifier.md), [`ci-auto-fix`](./skills/delivery/ci-auto-fix/SKILL.md) |

Micro and Lite run the [`autonomous-workflow`](./skills/workflow/autonomous-workflow/SKILL.md) phase machinery in one pass.
[`aw-executor`](./skills/workflow/autonomous-workflow/templates/aw-executor.agent.md) runs a Full brief as a background sub-agent when you ask for background or parallel work.

### Setup

The [clone + symlink](#recommended-clone--symlink) install already links the `aw` dispatcher skill, the two `aw-` agents, and the routing rule — `sync-symlinks.sh` runs the dispatcher installer for you. If you used `npx skills add` instead, run the dispatcher installer manually (it places the `aw` dispatcher, which a plain skill install cannot reach — it is nested inside the autonomous-workflow skill):

```bash
bash ~/.claude/skills/autonomous-workflow/install.sh --global
```

Companions (`tdd`, `ux`, `docs`, `ci-auto-fix`, …) never block the workflow; an absent one is reported `skipped (not installed)` — see [Customizing](./skills/workflow/autonomous-workflow/README.md) to opt out individually. Drop `--global` for a per-project install. Requires [`gh`](https://cli.github.com); [`gw`](https://github.com/mthines/gw-tools) is optional (native `git worktree` fallback).

### Further reading

- [`skills/workflow/autonomous-workflow/README.md`](./skills/workflow/autonomous-workflow/README.md) — install, customize, migrate from v2
- [`skills/workflow/autonomous-workflow/CLAUDE.md`](./skills/workflow/autonomous-workflow/CLAUDE.md) — design intent
- [`skills/workflow/autonomous-workflow/rules/companion-skills.md`](./skills/workflow/autonomous-workflow/rules/companion-skills.md) — companion registry
- [`skills/workflow/autonomous-workflow/aw/references/dispatcher-rationale.md`](./skills/workflow/autonomous-workflow/aw/references/dispatcher-rationale.md) — why Full works in your session with a fresh-eyes review

## Try it

Skills that trigger from plain language:

```text
Implement this feature autonomously, all the way to a PR
Review the accessibility of this component
Add this feature using TDD
Red-team this plan before I build it
Analyse this screen recording for bugs
```

Slash commands:

```text
/fix-bug <stack trace | span URL | file:line | ticket URL>
/pr-review 42
/review-branch
/create-pr
/ci-auto-fix <run-id | pr-url>
/docs audit
```

## Skills at a glance

Each row shows how a skill is invoked:
**`auto`** triggers from plain language; **`/`** is a slash command with zero baseline context cost; **`Skill()`** is called by another skill.

<details>
<summary><b><code>workflow/</code></b> — end-to-end orchestrators · 5 skills</summary>

| Skill | What it does | Type |
|-------|--------------|------|
| **[autonomous-workflow](./skills/workflow/autonomous-workflow/SKILL.md)** | phase machinery behind `aw`; `plan.md` is a six-heading brief gated on `run-checks.mjs` printing `CHECKS M/M PASS`, ending in a paste-ready `/goal`. `aw` (`auto`) is the sole entry and owns tiers. Design: [`CLAUDE.md`](./skills/workflow/autonomous-workflow/CLAUDE.md) | `/` |
| **[fix-bug](./skills/workflow/fix-bug/SKILL.md)** | 10-phase bug pipeline: intake → triage → evidence → repro-lock → analyse → gate → handoff → verify → telemetry. Lane-split: fast for simple, standard for complex. Self-improves via `fix-bug-lessons` (read Phase 0.5 / write Phase 5·7·8) + promotion to `diagnose`. | `/` |
| **[implement-suggestion](./skills/workflow/implement-suggestion/SKILL.md)** | apply reviewer suggestions across PRs; `--watch` loops one PR, `--resolve-all` closes non-fix threads. Never fixes CI | `/` |
| **[aw-create-plan](./skills/workflow/aw-create-plan/SKILL.md)** | Writes the Full-tier brief: a `plan.md` of at most 60 lines, plus `checks.yaml` with one sealed, runnable check per acceptance criterion. | `Skill()` |
| **[aw-create-walkthrough](./skills/workflow/aw-create-walkthrough/SKILL.md)** | Generates `.agent/{branch}/walkthrough.md` — the PR-delivery summary. | `Skill()` |

</details>

<details>
<summary><b><code>quality/</code></b> — code, tests, plans, AI apps · 13 skills</summary>

| Skill | What it does | Type |
|-------|--------------|------|
| **[confidence](./skills/quality/confidence/SKILL.md)** | Rates confidence that work fully solves the requirement. Modes: `plan`, `code`, `analysis`. Multi-signal gate; deterministic rule checks cap LLM score. | `auto` |
| **[critical](./skills/quality/critical/SKILL.md)** | Adversarial pre-mortem: hostile-persona walk through failure modes, blast radius, rollback, hidden coupling, and a mandatory steelman alternative. Never iterates. `deep` mode runs 3–5 independent persona lenses in parallel (sub-agents when available; personas discovered via `ideate`, fallback catalog otherwise) and merges them into one attributed report — the end-of-feature pre-mortem. | `auto` |
| **[measurable](./skills/quality/measurable/SKILL.md)** | every delivery ships telemetry that proves impact and surfaces regressions; modes `guide` / `implement` / `audit` / `setup` | `auto` |
| **[observe-run](./skills/quality/observe-run/SKILL.md)** | runs a command and grades the telemetry that run emitted against behavioral assertions only | `Skill() + /` |
| **[polish](./skills/quality/polish/SKILL.md)** | Re-runnable pre-PR branch quality gate. Thin orchestrator over `pr-reviewer` (via `review-loop` — read-only, findings surfaced) and its own simplify pass (simplifies the changed code and prunes restating or ticket comments, each change behind a test check). Modes: bare → full, `review`, `simplify`, `quick`. Commits each pass separately. `/create-pr` delegates its post-draft quality loop to `review-loop`. | `/` |
| **[review-branch](./skills/quality/review-branch/SKILL.md)** | PR-less sibling of `review-loop`; findings bus `.agent/{branch}/findings.jsonl`, zero GitHub calls | `/` |
| **[review-loop](./skills/quality/review-loop/SKILL.md)** | bounded PR convergence loop: `pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify`, cap 5; `--ui` runs `ui-verify` in a parallel lane and resolves its findings. Run at the top level of a session that holds a dispatch tool | `Skill()` |
| **[tdd](./skills/quality/tdd/SKILL.md)** | Strict RED-GREEN-REFACTOR cycles. Writes one failing test, implements minimal code, refactors. | `auto` |
| **[test-provenance-guard](./skills/quality/test-provenance-guard/SKILL.md)** | Detects tests that pass by construction (re-declare the SUT instead of importing it) via static + mutation checks. Self-heals by extracting inline logic and rewriting the test. | `auto` |
| **[verify-behavior](./skills/quality/verify-behavior/SKILL.md)** | cheapest-first three-tier verification ladder; emits an evidence receipt, never a score | `Skill()` |
| **[jev-assert](./skills/quality/jev-assert/SKILL.md)** | semantic UI assertion via TypeSafe Jev; backs the `THEN semantic:` spec form | `Skill()` + `/` |
| **[/ai-engineering](./skills/quality/ai-engineering/SKILL.md)** | Reviews LLM/AI application engineering across 13 concerns: prompts, caching, RAG, agents, resilience, memory, evals, safety, observability. | `/` |
| **[/pr-review](./skills/quality/pr-review/SKILL.md)** | one read-only `pr-reviewer` dispatch at one PR; `/pr-review remember <fact>` writes a maintainer relevance rule | `/` |

</details>

<details>
<summary><b><code>delivery/</code></b> — Git, PR, CI · 5 skills</summary>

| Skill | What it does | Type |
|-------|--------------|------|
| **[/create-pr](./skills/delivery/create-pr/SKILL.md)** | narrative PR description; pre-push `review-branch`, draft PR, post-draft `review-loop`, CI watch | `/` |
| **[/ci-auto-fix](./skills/delivery/ci-auto-fix/SKILL.md)** | Verdict-gated CI diagnosis and fix (`code-bug\|workflow-bug\|dep-bug\|env-bug\|flaky\|unsure`); confidence gate (≥90 auto, 80–89 ask, <80 escalate); regressing pushes auto-revert. Refuses to disable or weaken checks. Self-improves via `ci-auto-fix-lessons` (read Phase 3 / write Phase 8·9) — conservative: verdict lessons default to `repo::` scope, `seen_count ≥ 5` bar, regression lessons volatile/30-day. | `/` |
| **[/resolve-conflicts](./skills/delivery/resolve-conflicts/SKILL.md)** | Detects merge/rebase conflicts, shows both sides with context, proposes resolutions, asks for ambiguous cases. | `/` |
| **[/attach-media](./skills/delivery/attach-media/SKILL.md)** | Uploads local screenshots and screen recordings to a PR or issue as GitHub-hosted `user-attachments` assets that render inline (videos as players). Uses `gh --attach` (gh ≥ 2.99), falls back to the same upload endpoint over `curl`, and reports `not attached` rather than writing a placeholder. It owns one `<!-- attach-media:v1 -->` body region that a re-run merges by filename, and every upload is checked by eye for secrets first. Called by `create-pr`, `ui-verify`, `storybook`, `screen-recorder`, and `aw` Phase 7. | `Skill()` + `/` |
| **[/github-actions-author](./skills/delivery/github-actions-author/SKILL.md)** | Authors and reviews fast, cheap, maintainable GitHub Actions workflows (2026 best practices). Modes: `scaffold`, `review`. | `/` |

</details>

<details>
<summary><b><code>testing/</code></b> — E2E and fixture tooling · 5 skills</summary>

| Skill | What it does | Type |
|-------|--------------|------|
| **[/e2e-testing](./skills/testing/e2e-testing/SKILL.md)** | Spec-first Playwright Test Agents loop (Planner / Generator / Healer, v1.56). Locator ladder, `data-testid` source diffs, 3-attempt heal cap. | `/` |
| **[/e2e-testing-mobile](./skills/testing/e2e-testing-mobile/SKILL.md)** | Mobile counterpart on Maestro YAML flows for Expo / React Native. `testID`-first locator ladder; runs on Maestro Cloud via EAS Workflow. | `/` |
| **[/e2e-pr-stabilizer](./skills/testing/e2e-pr-stabilizer/SKILL.md)** | local-first Playwright E2E stabilizer for one PR; modes `stabilize` / `optimize` | `/` |
| **[/ui-verify](./skills/testing/ui-verify/SKILL.md)** | Markdown intent spec in the PR body (`<!-- ui-verify:v2 -->`); `author` adds out-of-bounds specs from a PR-scoped brainstorm; the runner adapts the route but checks every outcome with evidence, then tries to break it, records it, and checks its Dash0 web events | `Skill()` + `/` |
| **[/local-verify](./skills/testing/local-verify/SKILL.md)** | verifies a PR on a local stack: reuses `/aw`'s brief and intent `specs.md`, runs them plus edge probes via `ui-verify run --url`, reads telemetry, fixes each finding as one commit; `setup` stores all repo values | `/` |

</details>

<details>
<summary><b><code>design/</code></b> — UI, visual, interaction · 7 skills</summary>

| Skill | What it does | Type |
|-------|--------------|------|
| **[animations](./skills/design/animations/SKILL.md)** | CSS-first web animation. Three modes: Brainstorm, Perceived-Performance, technical workflow (CSS → WAAPI → Motion → R3F). Redirects React Native to `animations-native`. | `auto` |
| **[animations-native](./skills/design/animations-native/SKILL.md)** | React Native / Expo animation: Reanimated (worklets, shared values, layout animations), react-native-gesture-handler (pan/pinch/drag/swipe), Moti/Lottie/Rive, Reduce Motion + haptics, UI-thread profiling. | `auto` |
| **[behavioral-design](./skills/design/behavioral-design/SKILL.md)** | Behavior-change design for team adoption and product flows: COM-B / Fogg B=MAP diagnosis, EAST and choice-architecture interventions with evidence grades and metrics, System 1 / System 2 fit, and workshop plans. Hard rule: never a dark pattern or sludge. | `auto` |
| **[charting](./skills/design/charting/SKILL.md)** | Selects chart type + visualization library for web (React/Next.js) and mobile (Expo/RN). Maps intent → chart → library based on platform and dataset size. | `auto` |
| **[storybook](./skills/design/storybook/SKILL.md)** | Scaffolds three artefacts per component: visual regression story, Playground, interaction test. Opt-in OS-keychain auth profiles. | `auto` |
| **[ux](./skills/design/ux/SKILL.md)** | Audits and plans UI by walking the user's real path and verifying what each control does, then WCAG 2.2 accessibility depth, microcopy, and **dark-pattern detection**. Hard rule: never recommends a dark pattern. | `auto` |
| **[visual-design](./skills/design/visual-design/SKILL.md)** | Generative, brand-aware visual design. Style-direction taxonomy (minimal, swiss, brutalist, glass, …), color systems, typography, signature details. Defers WCAG math to `/ux`. | `auto` |

</details>

<details>
<summary><b><code>analysis/</code></b> — investigate data, diagnose issues · 8 skills</summary>

| Skill | What it does | Type |
|-------|--------------|------|
| **[ideate](./skills/analysis/ideate/SKILL.md)** | Generates, stress-tests, and iteratively evolves ideas via research-grounded agent loops: parallel persona generators (nominal-group simulation), independent judges on separate novelty/feasibility/impact/fit axes with a protected wildcard, ≤ 3 recombination rounds, `confidence(analysis)` gate on finalists. Auto-triages `quick` vs `deep`. | `auto` |
| **[interview](./skills/analysis/interview/SKILL.md)** | pre-plan scope-alignment interview; emits `.agent/{branch}/brief.md` | `auto` |
| **[rum-tracking](./skills/analysis/rum-tracking/SKILL.md)** | Guides product analytics and RUM event tracking for web (React/Next.js) and mobile (React Native/Expo). Decides what to track, what's noise, what's PII; covers OTel semantic conventions, tracking plans, GDPR/CCPA compliance, and clean implement / audit / remove workflows. | `auto` |
| **[video-analyser](./skills/analysis/video-analyser/SKILL.md)** | Analyses a screen recording for bugs. Resolves input from a Linear ticket URL, local path, or direct URL. Optional Tesseract OCR and Whisper transcription. | `auto` |
| **[youtube-transcript](./skills/analysis/youtube-transcript/SKILL.md)** | Fetches a YouTube video's captions as plain text (optional `[mm:ss]` timestamps) with one stdlib-only Python script. Calls YouTube's InnerTube player endpoint as the Android/iOS app with a visitor id, so it works from cloud and datacenter IPs where `youtube-transcript-api` and `yt-dlp` are bot-blocked. | `auto` |
| **[/profile-optimizer](./skills/analysis/profile-optimizer/SKILL.md)** | Analyses React DevTools Profiler exports or Chrome Performance traces. Maps hotspots to source. Iterates via `confidence(analysis)` until ≥ 90%. | `/` |
| **[/playwright-trace-analyzer](./skills/analysis/playwright-trace-analyzer/SKILL.md)** | Analyses Playwright `trace.zip` (or downloads from a GitHub Actions run URL). Names the race behind a flake, emits a ranked fix plan. | `/` |
| **[/screen-recorder](./skills/analysis/screen-recorder/SKILL.md)** | Records short cropped videos of UI sections via Playwright + ffmpeg. Validates multi-frame interactions a screenshot can't prove. | `/` |

</details>

<details>
<summary><b><code>authoring/</code></b> — skills about Claude Code itself · 5 skills</summary>

| Skill | What it does | Type |
|-------|--------------|------|
| **[docs](./skills/authoring/docs/SKILL.md)** | Authors and audits `CLAUDE.md`, `AGENTS.md`, `README.md`, and Diátaxis `docs/` trees. Modes: `init`, `update`, `readme`, `audit`. | `auto` |
| **[/create-skill](./skills/authoring/create-skill/SKILL.md)** | Scaffold, review, upgrade, or diagnose agent skills, gated by a mechanical `scripts/validate-skill.mjs` pre-pass and an eval-first Phase 6. `diagnose <target>` is the retrospective self-improvement entry point. | `/` |
| **[/optimize-claude-md](./skills/authoring/optimize-claude-md/SKILL.md)** | Audits `CLAUDE.md` for context bloat. Modes: `audit`, `trim`, `extract`. Flags rarely-used agent-invokable skills that should become slash-only. | `/` |
| **[/persistent-memory](./skills/authoring/persistent-memory/SKILL.md)** | cross-conversation markdown memory store. Self-improvement loops run on LoreKit instead; bucket taxonomy: [`memory-buckets.md`](./agents/shared/rules/memory-buckets.md) | `/` |
| **[/handoff](./skills/authoring/handoff/SKILL.md)** | Distills the current session's task, context, and plan into a self-contained, copy-pasteable markdown handoff for a fresh agent/LLM — Goal, Current state, Plan/next steps, and Key files/decisions/gotchas — curated to the important bits (no tool transcripts, no chit-chat, no secrets). Writes to `.agent/{branch}/handoff.md` and copies it to the clipboard. Optional focus phrase scopes it; `--brief` condenses it. | `/` |

</details>

## Agents at a glance

Agents run as sub-agents with their own model and tools; skills dispatch them, you don't.
`aw` itself is a skill, so it runs in your session.

| Agent | What it does |
|-------|--------------|
| **[aw-executor](./skills/workflow/autonomous-workflow/templates/aw-executor.agent.md)** | Runs a Full-tier `aw` brief as a background sub-agent — only when you ask for background or parallel work; by default `aw` does the work in your session. Installed as `aw-executor.md`. |
| **[pr-reviewer](./agents/pr-reviewer.md)** | PR reviewer for self and cross relations; read-only; one sticky report comment plus append-only inline findings |
| **[branch-reviewer](./agents/branch-reviewer.md)** | PR-less reviewer for `/review-branch`; writes `.agent/{branch}/findings.jsonl`, zero GitHub calls |
| **[feature-pr-verifier](./agents/feature-pr-verifier.md)** | Independent fresh-context verifier for feature PRs. Verifies acceptance criteria, pass-to-pass, walkthrough integrity for `autonomous-workflow` Full Mode — and re-runs `checks.yaml` checks itself, verifying check integrity (no drift, no unlogged amendments, no special-casing). |

## Install

Two ways in:

| Path | Stays current? | Customizable? | Best for |
| ---- | -------------- | ------------- | -------- |
| **Clone + symlink** (recommended) | Yes — `git pull` updates everything live | Yes — edit any skill in place | Living with these skills day to day |
| **`npx skills add`** | No — installs a frozen copy you re-fetch to update | No — edits are overwritten on re-fetch | A quick, no-clone trial — one skill or all |

### Recommended: clone + symlink

```bash
git clone https://github.com/mthines/agent-skills.git
cd agent-skills
bash scripts/sync-symlinks.sh
```

The script builds a two-tier symlink chain, so a single clone serves every Agent Skills–compatible tool:

```
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <clone>/skills/<category>/<name>
~/.claude/agents/<name>.md  →  ~/.agents/agents/<name>.md  →  <clone>/agents/<name>.md
```

Because skills are symlinked, your edits and every `git pull` land on the **next agent turn** — no reinstall. The middle layer (`~/.agents/skills/`) is the cross-tool discovery directory other tools read. Run it with `bash`, not `sh`; pass `--dry-run` to preview.

Any skill that ships its own `install.sh` (currently only [`autonomous-workflow`](./skills/workflow/autonomous-workflow/), which links two `aw-` agents and a routing rule) auto-runs at the end of the sync — no separate step.

### Upgrading

```bash
cd agent-skills && git pull
bash scripts/sync-symlinks.sh   # only to wire up newly added skills/agents
```

`git pull` updates every symlinked skill in place. Re-run the sync script only to pick up skills or agents that are **new** since your last pull — it's a no-op for everything already linked.

> **Coming from `npx skills add`?** That copy never tracks upstream — which is why upgrading felt hard. Delete the copied entries from `~/.claude/skills/` (and `~/.agents/skills/`), then switch to [clone + symlink](#recommended-clone--symlink). After that, `git pull` is the whole upgrade.

### Customize and still track upstream

To bend a skill to your own preferences **and** keep pulling new changes, fork and track this repo as `upstream`:

```bash
# Clone YOUR fork, then add this repo as upstream:
git clone https://github.com/<you>/agent-skills.git
cd agent-skills
git remote add upstream https://github.com/mthines/agent-skills.git
bash scripts/sync-symlinks.sh

# Edit any skill, commit to your fork, and pull new work anytime:
git pull upstream main
```

Customizations live on your fork; `git pull upstream main` merges in upstream changes. Keep edits scoped to the skills you actually change so merges stay clean.

### Quick try: `npx skills add`

A no-clone way to grab one skill or the whole collection. This installs a **frozen copy** — re-run to pick up changes; it does not track upstream.

> **Keep it tidy.** Always pass `--agent <your-tool>` (e.g. `--agent claude-code`). Without it, `npx skills` symlinks every skill into ~24 different AI-tool directories at once.

```bash
# One skill, Claude Code:
npx skills add https://github.com/mthines/agent-skills --skill confidence --agent claude-code --yes

# All skills, Claude Code:
npx skills add https://github.com/mthines/agent-skills --all --agent claude-code

# Universal — any Agent Skills tool:
npx skills add https://github.com/mthines/agent-skills --all
```

<details>
<summary>Other tools (Claude Code marketplace, Gemini, manual clone)</summary>

```bash
# Claude Code plugin marketplace:
/plugin marketplace add mthines/agent-skills
/plugin install mthines-agent-skills@mthines

# Gemini CLI:
gemini extensions install https://github.com/mthines/agent-skills

# Cursor / Copilot / Codex / manual — most tools auto-discover ~/.agents/skills/:
git clone https://github.com/mthines/agent-skills.git ~/.agents/skills/mthines-agent-skills
```

</details>

## VS Code extension

The [`vscode-agent-tasks`](./packages/vscode-agent-tasks/) package visualizes `plan.md`, `task.md`, and `walkthrough.md` in the VS Code sidebar — phase progress, decisions, blockers, and completed checkboxes update live as the agent works.

Install from the Marketplace by searching for **Agent Tasks** or:

```
mthines.agent-tasks
```

Default scan paths are `.agent/` and `.gw/`. Configure via `agentTasks.directories`. See [`packages/vscode-agent-tasks/README.md`](./packages/vscode-agent-tasks/README.md) for full docs.

For live session status in the panel, add the optional [`agent-tasks-hooks`](./plugins/agent-tasks-hooks/README.md) Claude Code plugin — it emits privacy-safe NDJSON lifecycle events the extension reads. It's only useful with the extension installed:

```
/plugin marketplace add mthines/agent-skills
/plugin install agent-tasks-hooks@agent-skills-plugins
```

## Domain navigator (per-project plug-in)

`/fix-bug` turns a Linear ticket into an Evidence Record in its own context ([Linear input](./skills/workflow/fix-bug/rules/evidence-resolution.md#linear-input)). Its accuracy depends on grounding in your project's structure.

It looks for context in this order:

1. Top-level `CLAUDE.md` / `AGENTS.md`.
2. Component-specific `CLAUDE.md` / `AGENTS.md` in directories the ticket points at.
3. A **domain-navigator skill**, auto-discovered by name.
4. Top-level `README.md` (fallback).

Steps 1, 2, and 4 work out of the box. Step 3 is the high-leverage customization for monorepos.

### Naming convention

`/fix-bug` scans its available-skills list at runtime for any skill whose name is:

- **exactly `domain-navigator`**, or
- **ending in `-domain-navigator`** — e.g. `dash0-domain-navigator`, `acme-domain-navigator`.

Any match is invoked automatically. No code changes, no registration.

### Starter template

Create `.claude/skills/<project>-domain-navigator/SKILL.md`:

```markdown
---
name: <project>-domain-navigator
description: >
  Maps Linear labels and ticket terminology to component directories in <project>.
  Surfaces cross-component dependencies. Use during investigation or planning.
user-invocable: true
---

# <Project> Domain Navigator

## Label → directory map

| Label | Component paths                       |
| ----- | ------------------------------------- |
| ui    | components/ui/, packages/web/         |
| api   | components/api/, packages/server/api/ |

## Cross-component dependencies

- `ui` calls `api` via `packages/web/src/client/`
- `api` reads from `db-migrator` schemas in `packages/db/`

## Where the docs live

- Architecture overview: `docs/architecture.md`
- API contract: `packages/server/api/openapi.yaml`
```

That is the entire integration.

## Repository structure

```
skills/                   51 skills, each with SKILL.md (some with rules/, references/, templates/, scripts/)
agents/                   3 agents (pr-reviewer, branch-reviewer, feature-pr-verifier)
plugins/                  3 Claude Code plugins (agent-tasks-hooks, pr-relevance-memory, pr-reviewer-shape-guard)
packages/                 VS Code extension (vscode-agent-tasks)
.claude-plugin/           marketplace.json — plugin distribution manifest
scripts/                  Local symlink sync (scripts/sync-symlinks.sh)
scripts/eval/             Regression evals in three layers — l1.mjs (deterministic contract
                          checks, no LLM), l2.mjs (behavioral classification suites, table in
                          suites.mjs, per-PR subset via select-suites.mjs), and
                          l2-detection.mjs (does the reviewer actually find the seeded bug —
                          recall and false-positive rate measured together)
```

Each skill has a `SKILL.md` manifest with YAML frontmatter (name, description, metadata) and a Markdown body with instructions. Skills with `rules/` subdirectories contain focused guidance documents that load on demand. Agents live in `agents/` because they require their own model and tool configuration.

## Local development

If you installed via [clone + symlink](#recommended-clone--symlink), you're already set up: every skill is live-linked, so edits to `skills/<category>/<name>/SKILL.md` take effect on the next agent turn.

### Add a new skill

1. Create `skills/<category>/<name>/SKILL.md` in this repo.
2. Run `bash scripts/sync-symlinks.sh` to wire the symlink chain for every new or missing skill/agent (`--dry-run` to preview).
3. Add an entry to the inventory in [`CLAUDE.md`](./CLAUDE.md) and this README.

For agents, write `agents/<name>.md` and rerun the sync script.

If your skill needs extra wiring beyond the standard symlink chain (e.g. linking template files as agents, like `autonomous-workflow`), ship a `skills/<category>/<name>/install.sh`. The sync script discovers it automatically and invokes it with `--development --quiet` after the main pass. Contract: accept both flags, be idempotent, write errors to stderr.

### Edit an existing skill

Edit `skills/<category>/<name>/SKILL.md` directly in this repo — never through the `~/.claude/skills/` symlink, or it gets ambiguous which checkout you touched when multiple worktrees exist.

### Verify the chain

```bash
readlink ~/.claude/skills/<name>      # → ~/.agents/skills/<name>
readlink ~/.agents/skills/<name>      # → <repo>/skills/<category>/<name>
```

Both must resolve. If either is missing, the agent harness won't see the skill.

## Contributing

PRs welcome. Read [`CLAUDE.md`](./CLAUDE.md) for the prose conventions and [`skills/authoring/create-skill/SKILL.md`](./skills/authoring/create-skill/SKILL.md) for the skill-authoring rubric.

## License

[MIT](./LICENSE)
