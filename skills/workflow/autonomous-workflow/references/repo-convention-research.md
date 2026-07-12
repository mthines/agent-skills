# Repo-Convention Understanding — Web-Research Pass (2024–2026)

Evidence base and decision record for the **repo-convention layer**: a
persistent, self-updating understanding of a repository's conventions and tech
stack that `aw` reads at intake and applies consistently (React practices for UI
code, API practices for backend code, monorepo awareness).

This is the companion research doc to
[`anthropic-architecture-research.md`](./anthropic-architecture-research.md) and
[`planning-quality-research.md`](./planning-quality-research.md).
Read it before changing
[`../rules/convention-memory.md`](../rules/convention-memory.md) or the
[`aw-setup` repo-profile mode](../aw-setup/rules/repo-profile.md).

---

## 1. The headline finding — split into two layers

The naive design ("one generated profile file, gitignored, that `aw` reads at
run start") is contradicted by the research on three axes.
The design that survives is **two layers**:

| Layer | Content | Storage | Committed? | Mechanism |
| ----- | ------- | ------- | ---------- | --------- |
| **1 — Convention rules** | Proven per-area conventions (React for `**/*.tsx`, API rules for `packages/api/**`) | `.claude/rules/*.md` (path-scoped) | **Yes** | Harness auto-loads only when a matching file is touched |
| **2 — Learned deltas** | Unproven conventions the agent discovered mid-run | `persistent-memory` `aw-conventions` scope | **No** (gitignored `.agent/` tiers) | `aw` reads at intake, writes at exit, promotes proven ones up to Layer 1 |

The two are joined by a one-way promotion path: a Layer-2 delta that recurs
(`seen_count >= 3`) is *suggested* for promotion into a committed Layer-1 rule.

---

## 2. Why path-scoped committed rules, not a read-at-start profile

**Path-scoping is the industry-standard mechanism for per-area conventions**, and
every leading tool ships it:

- Anthropic Claude Code — `.claude/rules/*.md` with a `paths:` glob; the rule
  loads only when Claude reads a matching file
  ([memory docs](https://code.claude.com/docs/en/memory)).
- Cursor — `.cursor/rules/*.mdc` with `globs:` (Auto-Attached rule type)
  ([rules docs](https://cursor.com/docs/rules)).
- GitHub Copilot — `.github/instructions/*.instructions.md` with an `applyTo:`
  glob
  ([custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions)).
- Continue — `.continue/rules/*.md` with `globs:` and `regex:`
  ([rules deep-dive](https://docs.continue.dev/customize/deep-dives/rules)).

The cross-tool `AGENTS.md` standard ([agents.md](https://agents.md)) scopes only
by directory nesting — no in-file globs — which is why Layer 1 targets
`.claude/rules` (with `paths:`), the surface the repo already authors through the
`docs` skill.

**A profile the model must choose to read is the weaker design.**
IFScale ([arXiv 2507.11538](https://arxiv.org/abs/2507.11538)) measured only
~68 % instruction adherence at high instruction density even on frontier models,
with *omission* — silently dropping instructions — the dominant failure mode.
Chroma's "context rot" work
([trychroma.com](https://www.trychroma.com/research/context-rot)) shows 30–50 %
accuracy drops well before advertised context limits and a strong
lost-in-the-middle penalty.
A large always-loaded profile is exactly the long, low-signal context these
findings warn against; a path-scoped rule that loads *with* the relevant file is
as close to deterministic as static context gets.

---

## 3. Why the convention layer is committed and the learned layer is not

The cross-tool convention is unambiguous: **commit team conventions, gitignore
per-user and volatile state.**
Every leading tool commits `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, and
`.github/copilot-instructions.md`; per-user overrides
(`.claude/settings.local.json`, `CLAUDE.local.md`) are gitignored
([Claude Code settings](https://code.claude.com/docs/en/settings)).
Morph's guidance is blunt: gitignore an override the day you create it, because a
committed per-user file becomes a source of drift
([agents-md guide](https://www.morphllm.com/agents-md-guide)).

`aw-setup` already follows this precedent — it commits `aw-target.yml` and its
bootstrap scripts and only gitignores `.auth/*.json` (the secrets).
A convention map is config, not secret, so the proven layer is committed and only
the unproven learned deltas stay in the gitignored `.agent/` tiers.

**Caveat worth knowing:** `.gitignore` does not hide files from agents — they
read the working directory directly.
An emerging `.agentignore` convention exists but is not universal
([gitignore is not agentignore](https://blog.cani.ne.jp/2026/02/22/gitignore-is-not-agentignore.html)).
This is why the learned layer stores *conventions*, never secrets or product
data — the persistent-memory privacy pre-flight still applies.

---

## 4. Monorepo — thin router root, per-area rules that lazy-load

Consensus across every tool and vendor: a thin always-loaded root for repo-wide
invariants plus per-package/per-area files that load only when the agent touches
that area
([Claude Code large-codebases](https://code.claude.com/docs/en/large-codebases)).
Concrete thresholds: keep the root around 150–300 lines; question anything past
500; push specifics to per-area rules.
Nx ships `nx configure-ai-agents` and explicitly tells the agent to query the
**project graph** (`nx show projects`, `nx graph`) rather than read every config
([Nx AI docs](https://nx.dev/docs/features/enhance-ai)) — directly usable here
since this repo is Nx.

Unsettled: a prompt-driven "root points to per-package files" router is only as
reliable as the model's willingness to follow pointers; harness-guaranteed
lazy-load (Claude subtree load, Cursor/Copilot globs) is stronger.
Layer 1 therefore prefers glob-scoped rules over a prose router.

---

## 5. Structure is re-derived, conventions are stored

The dividing line that the research settles: split repo understanding by
**information type**.

- *Slow-changing intent/conventions* → generated-and-stored (Layer 1).
- *Structure and symbol-relevance* → re-derived live each run.

Leading code agents (Claude Code, Cursor, Aider, Cody) favor grep, tree-walking,
and import-following over a stored structural snapshot; Aider's repo-map recomputes
a tree-sitter + PageRank ranking live within a token budget
([repomap docs](https://aider.chat/docs/repomap.html)).
The dominant criticism of stored context is **staleness** — "a stale MEMORY.md
that doesn't reflect recent decisions is worse than none."
Claude Code's own mitigation is to inject a freshness reminder at read time for
memory older than a day.
Practical rule for the learned layer: store the *invocation* ("run `pnpm test`"),
not a frozen snapshot of output, and never persist a file tree.
This is why persisting repo *structure* is explicitly out of scope for the
convention layer.

---

## 6. Self-updating memory must be gated hard

The self-updating half of the design is where regressions come from.
The literature is emphatic and directly reused by the entrenchment guards in
[`self-improvement-loop.md`](../rules/self-improvement-loop.md):

- **Reflexion** ([arXiv 2303.11366](https://arxiv.org/abs/2303.11366)) — write a
  lesson only after an *evaluated outcome*, into a bounded buffer.
  This is the "verify before you write" rule.
- **Mem0** ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)) — resolve each
  candidate as ADD / UPDATE / MERGE / DELETE / NOOP so duplicates do not
  accumulate.
- **CoALA** ([arXiv 2309.02427](https://arxiv.org/abs/2309.02427)) — the
  episodic → semantic/procedural promotion path (a delta earns a permanent rule
  only after recurrence).
- **MINJA** ([arXiv 2503.03704](https://arxiv.org/abs/2503.03704)) — a query-only
  memory-poisoning attack with >95 % success: any lesson distilled from untrusted
  text (issue bodies, PR comments, web, tool output) is an injection vector.
  A convention delta must come from the repo's own verified code/config, and can
  **never** authorize weakening a check.
- **Voyager** ([arXiv 2305.16291](https://arxiv.org/abs/2305.16291)) and **The
  Forgetting Problem**
  ([tianpan.co](https://tianpan.co/blog/2026-04-12-the-forgetting-problem-when-agent-memory-becomes-a-liability))
  — reusable skill/lesson libraries help, but a single bad update corrupts future
  behavior and unbounded memory *degrades* performance; keep the working set
  bounded, TTL'd, and consolidated.

The gates the convention loop inherits: advisory-only, verify-before-write,
`seen_count >= 3` before promotion, TTL + bounded INDEX, contradiction-flagged,
privacy pre-flight never bypassed, and never authorize a check-weakening.

---

## 7. Adherence hygiene for generated rules

Generated rules are only useful if the agent follows them.
The documented adherence levers, applied by delegating authoring to the `docs`
skill's [`content-routing.md`](../../../authoring/docs/rules/content-routing.md)
and [`claude-rule.md`](../../../authoring/docs/templates/claude-rule.md):

- Keep each rule thin (hot-path budget 150/200 lines) and path-scoped so it loads
  only when relevant.
- Phrase positively and concretely with good/bad examples and a stated "why"
  ([Anthropic prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)).
- One concern per rule file.
- Put critical rules first (primacy bias, per IFScale).

For rules that must *never* be skipped, prose is not enough — a deterministic
hook is the only mechanism that removes model discretion
([Claude Code best practices](https://code.claude.com/docs/en/best-practices)).
The convention layer stays advisory by design; hard guarantees remain the
province of the existing gates (`confidence`, `checks.yaml`, `reviewer`).

---

## 8. Decision record

| Decision | Rationale | Sources |
| -------- | --------- | ------- |
| Two layers (committed rules + gitignored learned deltas) | Commit team conventions, gitignore volatile; path-scoped committed rules fire consistently | §2, §3 |
| Layer 1 = `.claude/rules` authored via the `docs` skill | Anti-reinvention — `docs` already owns rule authoring, routing, and the hot-path budget | §2, §7 |
| Layer 2 = new `persistent-memory` scope `aw-conventions` | Separate from `aw-lessons` (mechanics) — conventions are a different concern with a different promotion target | §6 |
| Promotion target = `.claude/rules` via `docs update --add-rule` | Conventions are repo-specific; they belong in the repo's committed rules, mirroring the existing `project-shared` promotion branch | §6 |
| Repo *structure* is out of scope (live-derived only) | Structure goes stale; leading agents re-derive it with grep/repo-map | §5 |
| Inherit the `self-improvement-loop.md` entrenchment guards | The self-updating loop's dominant risk is self-reinforcing error | §6 |

### Honest gaps

- The behavioral claims — that `aw` actually reads the scope at intake and that a
  delta actually promotes — cannot be proven by static markdown checks; they need
  a live dispatcher run (the same limitation noted for the `aw` dispatcher smoke
  test in [`../CLAUDE.md`](../CLAUDE.md)).
- Several 2026 memory-poisoning and homogenization papers surfaced by search
  could not have their exact arXiv IDs confirmed and are cited by their stable
  predecessors (Reflexion, MINJA, Voyager) rather than the unverified follow-ups.
- Whether reuse of learned conventions nets positive or causes homogenization is
  unsettled in the literature; the mitigation (store mechanics, keep divergent
  work lessons-blind) is carried over from `ideate`'s design, not proven here.
