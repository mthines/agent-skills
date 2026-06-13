# Anthropic Architecture Research

How Anthropic's published guidance on agent architecture maps to concrete design choices in the autonomous-workflow skill.

## Contents

- [1. Purpose](#1-purpose)
- [2. Key principles with quotes and design mapping](#2-key-principles-with-quotes-and-design-mapping)
- [3. What the autonomous-workflow does NOT do (and why)](#3-what-the-autonomous-workflow-does-not-do-and-why)
- [4. Open questions and divergences](#4-open-questions-and-divergences)
- [5. Empirical evidence on plan artifacts](#5-empirical-evidence-on-plan-artifacts)
- [6. References](#6-references)

---

## 1. Purpose

This file consolidates Anthropic's published guidance on agent architecture and shows how each principle maps to a concrete design choice in the autonomous-workflow skill.
Citations are direct and verifiable — every quote is paired with its source URL so future contributors can re-check the underlying material without re-running the research.

This document is a *durable* reference.
When new Anthropic guidance lands, append to it; do not overwrite the principle-to-mapping rows already captured here.
The goal is to make the *why* behind autonomous-workflow legible to anyone reading the skill cold.

**Sources covered:**

- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Anthropic — When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)
- [Anthropic — Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Claude Code — Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code — Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

---

## 2. Key principles with quotes and design mapping

Each principle below pairs a verbatim quote with its source URL and the corresponding design choice in autonomous-workflow.
Use this section as the lookup table when proposing new agent flavors, splits, or coordinator layers — if a proposal contradicts a row here, it needs an explicit, written justification.

### 2.1 Start simple (single agent first)

> "A well-designed single agent with appropriate tools can accomplish far more than many developers expect."
> — [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)

**Mapping in autonomous-workflow:**
As of v3.3, the skill installs the split planner/executor pair by default.
The original monolithic agent (`agent.template.md`) is deprecated and retained only for backward compatibility with existing installs.

The "start simple" prescription is honored in the *design* of the split: the boundary is at Phase 2 → Phase 3, exactly one context boundary, not a five-role pipeline. The deprecated monolithic agent was the v1/v2 incarnation of this principle; v3.3 chose the split because empirical evidence showed that the planner's exploration history measurably crowds out the executor's working context even on medium-complexity tasks.

| Agent | Status | When used |
|---|---|---|
| `aw-planner` + `aw-executor` (under the `aw-` namespace) | Default (v3.3+) | All new installs |
| `agent.template.md` (monolithic) | Deprecated | Existing installs only — backward compat |

### 2.2 Multi-agent costs 3-10× more tokens

> "multi-agent implementations typically use 3-10x more tokens than single-agent approaches for equivalent tasks."
> — [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)

**Mapping in autonomous-workflow:**
The split is justified only because the planning context and execution context are genuinely independent.
The planner accumulates exploration history, dead-end probes, and design alternatives that the executor does not need.
A clean context reset at the planner→executor handoff produces measurable token savings that offset the multi-agent overhead — that's the *only* reason the split exists.
"Different roles" alone is never sufficient justification.

The corollary: any future proposal to add a third agent must demonstrate a third independent context — not a third role.
If the third agent would re-read the same `plan.md` and the same diff that the executor already has, it is a skill, not an agent.

### 2.3 Divide by context boundaries, not by role

> "Divide by context boundaries... Work should only be split when context can be truly isolated."
> — [Anthropic — When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)

**Mapping in autonomous-workflow:**

| Boundary | Same context? | Split into separate agent? |
|---|---|---|
| Phase 0 validation ↔ Phase 1 planning | Yes — same user intent + same codebase exploration | NO — Phase 0 lives WITH the planner |
| Phase 1 planning ↔ Phase 3 implementation | No — exploration history is dead weight for the executor | YES — planner→executor split |
| Phase 3 implementation ↔ Phase 6 review | Yes — executor already has the change history | NO — review-changes is a Skill called by the executor |

This is the load-bearing decision: planner/executor is split along a real context boundary (exploration/design vs. implementation/test).
Validation→planning is *not* split, because both phases share the same context (user intent + codebase exploration).
That's why Phase 0 lives WITH the planner, not as a separate clarifier agent.

### 2.4 Avoid sequential role-based architectures

> "Teams built sequential role-based architectures — planners handing off to implementers to testers — where subagents spent more tokens on coordination than on actual work."
> — [Anthropic — When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)

**Mapping in autonomous-workflow:**
As of v3.3 the skill uses exactly ONE architecture: Planner + Executor (two agents, one boundary).
The deprecated monolithic single-agent template still exists for backward compat, but is not the default.

It does NOT have five roles (clarifier → planner → implementer → tester → reviewer as separate agents).
The companion skills (`tdd`, `ux`, `code-quality`, `confidence`, `docs`, `review-changes`, `aw-create-plan`, `aw-create-walkthrough`, `create-pr`, `ci-auto-fix`) are advisory companions called by `Skill()`, not coordinator agents.
A skill is a tool the agent reaches for — it does not own a context window of its own.

### 2.5 Three roles when complexity warrants: Planner, Generator, Evaluator

> "Before each sprint, the generator and evaluator negotiated a sprint contract: agreeing on what 'done' looked like for that chunk of work before any code was written."
> — [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)

The harness-design post describes a Planner/Generator/Evaluator triad: the planner expands the prompt into a high-level spec; the generator implements; the evaluator validates against the contract.

**Mapping in autonomous-workflow:**

| Anthropic role | autonomous-workflow analog |
|---|---|
| Planner | Planner agent (phases 0–2) |
| Generator | Executor agent (phases 3–7) |
| Evaluator | `confidence` skill — invoked in plan, code-review, and analysis modes |
| Sprint contract | Acceptance Criteria section in `plan.md` |

The triad is realized without spawning three coordinator agents.
Planner and Generator are separate agents with a clean context boundary; Evaluator is an on-demand skill.

### 2.6 Validation lives downstream (with the evaluator), not upstream

> "Before each sprint, the generator and evaluator negotiated a sprint contract: agreeing on what 'done' looked like for that chunk of work before any code was written."
> — [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)

**Mapping in autonomous-workflow:**
`confidence(plan)` is a multi-signal evaluator combining LLM dimensional scoring with deterministic rule checks.
It is invoked at the planner→executor handoff — i.e., *downstream* of the planner, in front of the executor.
Phase 4 stuck-loop also gates via `confidence(analysis)`.

There is NO separate "validation agent" upstream of the planner.
A clarifier-then-planner pipeline is exactly the role-based architecture Anthropic warns against (see §2.4).
Phase 0 — the only upstream validation — is integrated into the planner agent itself, not delegated to a separate clarifier.

### 2.7 Keep the planner high-level

> "I prompted it to be ambitious about scope and to stay focused on product context and high level technical design rather than detailed technical implementation."
> — [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)

**Mapping in autonomous-workflow:**
The planner agent's tool budget is intentionally constrained.
It can run `git worktree add`, install deps for environment verification, and write `plan.md` — but it cannot edit production source files.
Source-file editing is reserved for the executor.

| Tool | Planner | Executor |
|---|---|---|
| Read | Yes | Yes |
| Grep / Glob | Yes | Yes |
| Bash | Yes (worktree, deps, env verification) | Yes |
| Edit / Write on `plan.md` and worktree setup | Yes | Yes |
| Edit / Write on production source | NO | Yes |
| Skill | Yes | Yes |
| WebFetch / WebSearch | Yes | No |

This makes "planner stays high-level" a tool-level invariant, not a prompting suggestion.

### 2.8 Prevent cascading errors

> "if the planner tried to specify granular technical details upfront and got something wrong, the errors in the spec would cascade into the downstream implementation."
> — [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)

**Mapping in autonomous-workflow:**
`plan.md` is intentionally not a code dump.
It is a structured spec containing:

- File paths to be created or modified.
- Decisions and their rationale (especially Phase 0 dialogue outcomes).
- Acceptance criteria.
- Risks and mitigations.
- Verification commands.

The executor adapts within those boundaries.
Specific function bodies, data structures, and inline error handling are decided at implementation time by the executor — not pinned in `plan.md`.
This contains the blast radius of any planner mistake.

### 2.9 Subagents preserve context, enforce constraints, specialize behavior

> "Subagents help you preserve context by keeping exploration and implementation out of your main conversation."
> — [Claude Code — Subagents](https://code.claude.com/docs/en/sub-agents)

**Mapping in autonomous-workflow:**

| Subagent use | Purpose served |
|---|---|
| Planner agent (phases 0–2) | The planner's research-heavy context never reaches the executor |
| Phase 1 parallel `Explore` subagents | Fan out across the codebase without polluting the planner's main context |
| Phase 7 `ci-auto-fix` per-job subagent | Each failing CI job gets its own retry budget and context |

Each use is justified by *context preservation*, not by role specialization.

### 2.10 Subagents have their own tool access and permissions

> "Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions."
> — [Claude Code — Subagents](https://code.claude.com/docs/en/sub-agents)

**Mapping in autonomous-workflow:**

| Agent | Tool access |
|---|---|
| Planner | Read, Grep, Glob, Bash, Edit, Write, Skill, WebFetch, WebSearch — research-heavy with limited write (only for setup and `plan.md`) |
| Executor | Read, Grep, Glob, Bash, Edit, Write, Skill — full write to source |

Tool budgets are not just suggestions in the prompt; they are enforced by the agent definition.

### 2.11 Pause to clarify under uncertainty

> "Claude Code asks for clarification more than twice as often on most complex tasks as on minimal-complexity tasks."
> — [Anthropic — Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)

**Mapping in autonomous-workflow:**
Phase 0 (validation) is mandatory. The planner agent stops to clarify before any planning, regardless of complexity.
The phase reads the codebase, surfaces clarifying questions, and proposes an approach — then waits for user confirmation before proceeding.

This is a fixed gate, not an adaptive heuristic.
Even for tasks that *look* simple, Phase 0 runs.
The cost is small (one round-trip with the user); the upside is catching misunderstandings before any planner or executor work.

### 2.12 Structured handoff artifacts beat in-place compaction

> "Before each sprint, the generator and evaluator negotiated a sprint contract: agreeing on what 'done' looked like for that chunk of work before any code was written."
> — [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)

The harness-design post advocates context resets backed by structured handoff artifacts rather than mid-conversation compaction.

**Mapping in autonomous-workflow:**

| Artifact | Hands off | Author | Consumer |
|---|---|---|---|
| `plan.md` | Planning context → implementation context | `aw-create-plan` (after Phase 2 worktree setup) | Executor (Phase 3+) |
| `walkthrough.md` | Implementation context → review context | `aw-create-walkthrough` (Phase 6) | PR reviewer (human) |
| Progress Log inside `plan.md` | Phase-to-phase within executor | Executor | Executor (next phase) |

These are real files inside the worktree, not in-conversation summaries.
A new session can pick up from `plan.md` alone.

### 2.13 Verifier role works because of minimal context transfer

> "Before each sprint, the generator and evaluator negotiated a sprint contract: agreeing on what 'done' looked like for that chunk of work before any code was written."
> — [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)

A verifier evaluates outputs against a contract without needing the full history of how those outputs were produced.

**Mapping in autonomous-workflow:**
This is exactly why `confidence` is a separate skill, not a method on the planner agent.
It evaluates `plan.md` from cold — without the planner's exploration history.
That cold read is what makes the score useful: if `confidence(plan)` cannot reconstruct the plan's intent from `plan.md` alone, the plan is not ready for the executor (who will also be reading it cold).

The same property holds for `review-changes` (cold-reads the diff) and `confidence(analysis)` (cold-reads a stuck-loop description).

| Verifier skill | Cold input | Why minimal context matters |
|---|---|---|
| `confidence(plan)` | `plan.md` only | Forces the plan to be self-contained; if a cold reader cannot grade it, the executor (also cold-reading) will fail |
| `review-changes` | Diff + `plan.md` | Independent perspective on whether the diff matches the contract |
| `confidence(analysis)` | Stuck-loop description | Detects when the executor's mental model has drifted into a wrong frame |

---

## 3. What the autonomous-workflow does NOT do (and why)

This section documents patterns Anthropic's guidance explicitly cautions against, paired with autonomous-workflow's matching rejection.
When proposing changes, check this section first — if a proposal reintroduces one of these patterns, it needs to clear a high evidence bar.

### 3.1 Separate clarifier-then-planner agents — REJECTED

> "Divide by context boundaries... Work should only be split when context can be truly isolated."
> — [Anthropic — When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)

**Why rejected:**
Phase 0 clarification and Phase 1 planning share the same context (user intent + codebase exploration).
Splitting them would pay the multi-agent token tax (§2.2) without buying any context isolation.
Phase 0 lives inside the planner agent, not in a dedicated clarifier.

### 3.2 Five-role sequential pipeline — REJECTED

> "Teams built sequential role-based architectures — planners handing off to implementers to testers — where subagents spent more tokens on coordination than on actual work."
> — [Anthropic — When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)

**Why rejected:**
A clarifier → planner → implementer → tester → reviewer pipeline is the canonical anti-pattern Anthropic names.
autonomous-workflow keeps the agent count to two (planner + executor), with all other roles realized as advisory skills. The deprecated monolithic template (`agent.template.md`) is backward-compat only.

### 3.3 A "code reviewer agent" parallel to the executor — REJECTED

> "Subagents help you preserve context by keeping exploration and implementation out of your main conversation."
> — [Claude Code — Subagents](https://code.claude.com/docs/en/sub-agents)

**Why rejected:**
A reviewer that runs *in parallel* with the executor cannot preserve context — both agents need overlapping access to the same diff.
`review-changes` is a Skill called by the executor agent at Phase 6, not a separate coordinator agent.
The skill cold-reads the diff, which gives it the verifier independence Anthropic recommends (§2.13) without paying the parallel-agent coordination cost.

### 3.4 Detailed technical implementation in the plan — REJECTED

> "if the planner tried to specify granular technical details upfront and got something wrong, the errors in the spec would cascade into the downstream implementation."
> — [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)

**Why rejected:**
`plan.md` deliberately stops at file paths, decisions, acceptance criteria, risks, and verification commands.
Concrete function bodies, data structures, and inline error handling are decided at implementation time.
This contains the blast radius of planner mistakes (§2.8).

---

## 4. Open questions and divergences

Areas where Anthropic's guidance is incomplete or where autonomous-workflow has chosen a defensible position without a direct source.
These are not contradictions of Anthropic's guidance — they are gaps where the skill made an empirical choice.

### 4.1 The 90% confidence gate threshold

There is no Anthropic-published number for the planning confidence threshold.
autonomous-workflow uses 90% as the gate.
The number was chosen empirically — high enough to reject under-specified plans, low enough that well-formed plans pass on the first attempt.
If Anthropic publishes guidance on calibrated confidence thresholds, revisit this number.

### 4.2 Iteration caps (3 Lite / 5 Full)

| Framework | Default cap |
|---|---|
| autonomous-workflow Lite | 3 iterations on stuck-loop |
| autonomous-workflow Full | 5 iterations on stuck-loop |
| Cursor (default) | 5 iterations |
| Reflexion (research) | Optimum varies by task |

autonomous-workflow's choice sits at the tight end of the field range.
The reasoning: most stuck loops past iteration 3 indicate a wrong mental model, not a hard problem; better to escalate (run `confidence(analysis)`) than to keep retrying.
This is distinct from quality-driven self-refinement, which has no fixed cap (see [`iterative-refinement.md`](./iterative-refinement.md)).

### 4.3 Always-on `docs update`

Most agent frameworks treat documentation updates as discretionary.
autonomous-workflow runs `docs update` as a Phase 5 step in Full Mode (and Lite Mode).
The reasoning: docs that drift silently become invisible; running the loop unconditionally prevents drift.
The skill is silent-skip — if there's nothing to update, it returns clean — so the cost is bounded.

### 4.4 Companion skills as advisory rather than load-bearing

CrewAI and AutoGen treat agents as load-bearing — the workflow does not progress unless each agent reports back.
autonomous-workflow treats companion skills as advisory: they are called, their output is considered, and the agent continues.
Skills can silent-skip, return advisory notes, or surface blocking findings — but they do not own progression.
The reasoning: a load-bearing skill graph reintroduces the coordination tax Anthropic warns about (§2.4).
Advisory skills keep the agent in charge of progress.

**Exceptions where a skill IS load-bearing:**

| Skill | Load-bearing because |
|---|---|
| `confidence(plan)` at Phase 1 → Phase 2 boundary | Score below 90% blocks worktree creation |
| `confidence(analysis)` during stuck-loop | Score below threshold escalates to user |

These are the only two gates where a skill blocks progression.
Both are evaluator-role gates Anthropic's harness-design post explicitly endorses (§2.6, §2.13).

---

## 5. Empirical evidence on plan artifacts

§§2–4 map autonomous-workflow to Anthropic's *engineering guidance* — practitioner posts, not controlled studies.
This section records the **academic and benchmark evidence** for (and against) the plan-artifact design, tiered by strength, so the *why* is grounded in data rather than authority.
When a future change touches plan structure, mode detection, or the confidence gate, check it against this section — not just the practitioner quotes above.

**Caveat on sourcing.**
The figures below were gathered via web search and several primary PDFs could not be fetched at gather time.
Treat exact percentages as indicative and re-verify against the cited source before quoting them as load-bearing.
Claims that are practitioner-reported rather than peer-reviewed are marked inline.

### 5.1 Explicit planning helps — but mainly on long-horizon / complex tasks (rigorous)

| Finding | Effect | Source |
| --- | --- | --- |
| As-needed decomposition (ADaPT) vs ReAct | +27 to +33 pts absolute (ALFWorld / WebShop / TextCraft) | arXiv:2311.05772 (NAACL Findings 2024) |
| Adding a dynamic plan to a base executor (Plan-and-Act) | +34 pts on WebArena-Lite | arXiv:2503.09572 |
| Iterative replan / reflect (Reflexion) | +20–22 pts on ALFWorld / HotPotQA | arXiv:2303.11366 (NeurIPS 2023) |
| Prompt-level planning on *simple* math (Plan-and-Solve vs Zero-shot-CoT) | only ~+2.9 pts on GSM8K; negative in some reproductions | arXiv:2305.04091 / 2312.06867 |

**Design mapping.**
This is the empirical backbone of the **Full vs. Lite mode split**: planning earns its tokens on complex / multi-file work and is neutral-to-harmful on small tasks.
The skeptical line (Kambhampati / PlanBench, arXiv:2206.10498, arXiv:2402.01817) adds that bare LLMs plan poorly unaided (~35 % on clean Blocksworld) and self-verify badly — the gains come from the *decomposition + verification scaffold*, which is exactly what `confidence(plan)` + Acceptance Criteria + the stuck-loop replan provide.
Keep the gate; do not rely on the planner's unaided judgment.

### 5.2 Externalizing the plan to a file — strong mechanism, no direct A/B (mixed)

The problem externalization solves is well-measured:

- Long-context degradation: *Lost in the Middle* (arXiv:2307.03172); NoLiMa — 11 of 13 models below 50 % of baseline at 32K (arXiv:2502.05167); RULER's effective-vs-claimed context gap (arXiv:2404.06654).
- *The Illusion of Diminishing Returns* (arXiv:2509.09677): long-task failures are execution errors that compound via **self-conditioning** — prior errors already in context beget more errors. A clean external plan isolates execution from that history.

External-memory architectures improve agent performance in controlled studies: Reflexion (+20–22 pts), Voyager's skill library (up to 15.3× faster milestones, arXiv:2305.16291), MemGPT (arXiv:2310.08560).
Letta's filesystem-as-memory beat a specialized memory system on LoCoMo (74.0 % vs 68.5 %) — practitioner benchmark.

**The honest gap.**
No rigorous A/B isolates "plan in a file" vs. "plan in the conversation" for coding.
The file's clearest, evidence-backed payoff is the case it was built for: **cross-session / post-compaction resumption**, where in-context state simply does not survive.
Anthropic's own multi-agent system does exactly this — *"saving its plan to Memory … if the context window exceeds 200,000 tokens it will be truncated and it is important to retain the plan"* (practitioner).
For a task that finishes inside one un-compacted window, the file's marginal benefit over in-context planning is unproven — which is why Lite Mode writes no file.

### 5.3 Over-detailed plans hurt — the case for the Core / Extended tiering (rigorous)

- *The Danger of Overthinking* (arXiv:2502.08235): across 4,018 SWE-bench-Verified trajectories, higher overthinking correlates with *lower* success; selecting lower-overthinking solutions improved performance ~30 % and cut cost ~43 %.
- *Inverse Scaling in Test-Time Compute* (arXiv:2507.14417): extending reasoning length can *reduce* accuracy on constructed tasks.
- Static, exhaustive plans underperform adaptive replanning (ADaPT, Plan-and-Act); decomposition depth plateaus fast (ADaPT: gains from depth 2→3, little beyond) and net-hurts on tasks the model already handles (a task-list tool dropped one suite 52/60 → 45/60 — practitioner).

**Design mapping.**
This is why the [`aw-create-plan`](../../aw-create-plan/SKILL.md) template is **two-tier**: a small always-on **Core** (the parts with measured value — Acceptance Criteria as the sprint contract, Decisions a cold session would otherwise re-derive, File Changes to bound scope, Verification as the done-check) plus **Extended** sections emitted only when an `Include when` trigger holds.
It is also why the plan stops at file paths / decisions / acceptance criteria and leaves function bodies to the executor (§2.8), and why the plan is revisable rather than a frozen upfront spec.

### 5.4 What is NOT evidence-backed

- That a *full structured spec* beats a *lean* one for agent task success — no head-to-head exists. The widely-cited spec-driven-development "50 % error reduction" traces to an unrelated TDD study, not SDD; do not cite it.
- The `plan.v{N}.md` snapshot / versioning is an audit-trail and review-UX feature. It is reasonable governance, but there is no evidence it improves task success — do not justify it on performance grounds.

---

## 6. References

- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) — Start simple; a single well-tooled agent goes further than developers expect.
- [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) — Planner/Generator/Evaluator triad with structured handoff artifacts and sprint contracts.
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — Multi-agent costs 3-10× more tokens; only justified by genuine context isolation.
- [Anthropic — When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them) — Divide by context boundaries, not by role; avoid sequential role pipelines.
- [Anthropic — Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) — Pause to clarify under uncertainty; clarification frequency scales with task complexity.
- [Claude Code — Subagents](https://code.claude.com/docs/en/sub-agents) — Subagents preserve context, enforce constraints, and specialize behavior; each gets its own context window, system prompt, tools, and permissions.
- [Claude Code — Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — Skills are advisory tools called by an agent, not coordinator agents themselves.

### Empirical research (§5)

- ADaPT: As-Needed Decomposition and Planning with Language Models — arXiv:2311.05772 (NAACL Findings 2024).
- Plan-and-Act: Improving Planning of Agents for Long-Horizon Tasks — arXiv:2503.09572.
- Reflexion: Language Agents with Verbal Reinforcement Learning — arXiv:2303.11366 (NeurIPS 2023).
- Plan-and-Solve Prompting — arXiv:2305.04091 (ACL 2023); reproduction table in Progressive Rectification Prompting — arXiv:2312.06867.
- PlanBench — arXiv:2206.10498 (NeurIPS D&B 2023); LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks — arXiv:2402.01817 (ICML 2024).
- Lost in the Middle — arXiv:2307.03172 (TACL 2024); NoLiMa — arXiv:2502.05167; RULER — arXiv:2404.06654.
- The Illusion of Diminishing Returns (long-horizon execution, self-conditioning) — arXiv:2509.09677.
- Voyager — arXiv:2305.16291 (NeurIPS 2023); MemGPT — arXiv:2310.08560.
- The Danger of Overthinking (agentic, SWE-bench Verified) — arXiv:2502.08235; Inverse Scaling in Test-Time Compute — arXiv:2507.14417.
- Anthropic — How we built our multi-agent research system (plan-to-Memory across 200K truncation) — https://www.anthropic.com/engineering/multi-agent-research-system.
