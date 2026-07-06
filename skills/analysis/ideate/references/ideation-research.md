---
title: Ideation Research — Evidence Basis for the Ideate Skill
impact: MEDIUM
tags:
  - reference
  - research
  - brainstorming
  - creativity
  - llm-ideation
---

# Ideation Research

The evidence behind every rule and numerical default in the `ideate` skill.
Load this when questioning a default, tuning a parameter, or extending the skill — each section is cited with a strength-of-evidence note.
Compiled from a web research sweep (2026-07); primary sources span 1987–2026.

## Contents

- [§1 Classic ideation research](#1-classic-ideation-research)
- [§2 Structured ideation methods](#2-structured-ideation-methods)
- [§3 Divergent vs convergent thinking](#3-divergent-vs-convergent-thinking)
- [§4 LLM-specific ideation research](#4-llm-specific-ideation-research)
- [§5 Iterated refinement](#5-iterated-refinement)
- [Numerical defaults table](#numerical-defaults-table)
- [Evidence-strength summary](#evidence-strength-summary)

---

## §1 Classic ideation research

### §1.1 Osborn's rules — partially validated

"Quantity breeds quality" holds: high-quality idea count correlates with total idea count.
Deferred judgment as practiced in interactive groups does not rescue group brainstorming (§1.2).
Source: [Paulus & Brown, "Beyond Productivity Loss"](https://www.sciencedirect.com/science/article/abs/pii/S006526011043004X) — strong (field-leader literature review).

### §1.2 Nominal groups beat interactive groups

One of the most replicated findings in the field.
Mullen, Johnson & Salas (1991), meta-analysis of 20 studies: nominal groups (individuals alone, ideas pooled) produce substantially more non-redundant AND more high-quality ideas than interacting groups.
Diehl & Stroebe (1987): interactive groups produce roughly **half** as many ideas; **production blocking** (turn-taking) is the dominant cause.
Sources: [Mullen et al. 1991](https://dynamic.decorrespondent.nl/downloads/michiel-de-hoog/Mullen-1991-Productivity-Loss-in-Brainstorming-Groups.pdf), [Diehl & Stroebe 1987](https://homepages.se.edu/cvonbergen/files/2013/01/Productivity-Loss-In-Brainstorming_Toward-the-Solution-of-a-Riddle.pdf) — strong (meta-analysis + canonical experiments).
**Skill consequence:** divergence simulates a nominal group — independent generation contexts, pooled afterwards.

### §1.3 Electronic (parallel, written) brainstorming scales

Parallel written input beats verbal groups from size ≈ 4 and nominal groups from size ≈ 10 — it removes production blocking while retaining cross-stimulation.
Source: [DeRosa / Dennis & Valacich meta-analysis](https://www.researchgate.net/publication/220474993_A_Meta-Analysis_of_Group_Size_Effects_in_Electronic_Brainstorming) — strong, with a noted dispute ([Pinsonneault et al.](https://pubsonline.informs.org/doi/10.1287/isre.10.4.375)).
**Skill consequence:** burst 2's titles-only reseed is the cross-stimulation channel.

### §1.4 Brainwriting 6-3-5

6 participants × 3 ideas × 5-minute rounds; evidence thinner but mechanism-consistent (parallel, silent, written).
Source: [6-3-5 Brainwriting](https://en.wikipedia.org/wiki/6-3-5_Brainwriting), [IxDF brainwriting synthesis](https://ixdf.org/literature/topics/brainwriting) — moderate.
**Skill consequence:** the per-generator burst size — as an *operationalization*, not a study number.
The cited method's per-round count is 3; the skill doubles it to 6 because an agent run has few bursts and subagent dispatch is expensive relative to human 5-minute rounds.

### §1.5 Serial-order effect

Originality rises across an ideation session while fluency drops — the obvious ideas come first.
Source: [Beaty & Silvia 2012](http://libres.uncg.edu/ir/uncg/f/p_silvia_why_2012.pdf) — strong (robust, replicated).
**Skill consequence:** burst 2 is mandatory and reseeded with "what has NOT been said yet".

### §1.6 Incubation

Positive delayed-incubation effect, mean **d = 0.29** across 117 studies; strongest for divergent tasks with undemanding filler.
Source: [Sio & Ormerod 2009](https://gwern.net/doc/psychology/writing/2009-sio.pdf) — strong (meta-analysis).
**Skill consequence:** the incubation offer in Finalist validation (interactive sessions) and the report's verdict section — a verdict after a break is legitimate, not stalling.

---

## §2 Structured ideation methods

### §2.1 Structure beats free association; TRIZ beats SCAMPER on novelty

Murphy, Daly & Seifert (Univ. of Michigan) head-to-head: TRIZ-contradiction ideas more novel and creative than SCAMPER; Design Heuristics most practical.
Source: [Murphy et al.](https://dalyresearch.engin.umich.edu/wp-content/uploads/sites/237/2022/02/Murphy_Daly_and_Seifer_Idea_characteristics_arising_from_individual_brainstorming_and_DH_ideation_methods.pdf) — moderate (single controlled comparison; few exist).

### §2.2 Six Thinking Hats / viewpoint techniques

Improve problem-finding and problem-construction performance in experiments; evidence positive but sparse and mostly small-N.
Sources: [problem-construction study](https://www.sciencedirect.com/science/article/abs/pii/S1871187117301803), [structured-techniques study](https://www.researchgate.net/publication/264459649_Thinking_hats_and_good_men_Structured_techniques_in_a_problem_construction_task) — weak-to-moderate.
Not adopted as an operator — the persona fan-out (§4.4) already covers viewpoint variation.

### §2.3 SCAMPER

Positive in educational studies; loses to TRIZ on novelty (§2.1) — moderate-weak.
Used in the skill for coverage, not novelty.

### §2.4 Analogical thinking — best-evidenced stimulus method

Far-field, less-common examples increase novelty; distance trades against feasibility past a point.
Abstract-the-problem-then-search-distant-domains pipelines reliably yield more creative ideas.
Sources: [Kittur et al., PNAS](https://www.pnas.org/doi/10.1073/pnas.1807185116), [Chan & Schunn line](https://www.academia.edu/943767/On_the_benefits_and_pitfalls_of_analogies_for_innovative_design) — strong.
**Skill consequence:** far-domain analogy is the top-ranked operator, with the novelty↑/feasibility↓ label requirement.

### §2.5 Problem framing

Frame width measurably shapes ideation direction and breadth; invest in framing before generating.
"How Might We" phrasing itself is practitioner lore (IDEO/d.school), not experimentally isolated.
Sources: [Magistretti et al. 2025, JPIM](https://onlinelibrary.wiley.com/doi/10.1111/jpim.12783), [Design Studies framing study](https://www.sciencedirect.com/science/article/abs/pii/S0142694X21000260) — moderate.
**Skill consequence:** Phase 1 generates width-varied framings.

### §2.6 Reversal / worst-idea / first principles

Mechanism-plausible; empirical support is practitioner literature or small-N.
Assumption reversal is the one adopted into the operator catalog (with no evidence claim); worst-idea and first principles are not adopted — constraint injection and the abstraction step of far-domain analogy cover their mechanisms.

---

## §3 Divergent vs convergent thinking

### §3.1 The one hard rule: separate generation from evaluation

The Double Diamond is a scheduling discipline, not a finding; its evidential backbone is that evaluation during generation suppresses output — Osborn's one rule that survives scrutiny.
Source: [Double Diamond](https://en.wikipedia.org/wiki/Double_Diamond_(design_process_model)) plus §1 literature — strong for the separation rule itself.

### §3.2 Idea selection is the weak link

Rietzschel, Nijstad & Stroebe (2010): after generating, people select ideas **barely better than random**, systematically preferring feasible/desirable over original — selected sets are *less original than the average of the generated pool*.
Instructing selectors to "select creative ideas" partially corrects this.
Sources: [Rietzschel et al. 2010, BJP](https://bpspsychub.onlinelibrary.wiley.com/doi/10.1348/000712609X414204), [review](https://research.rug.nl/en/publications/why-great-ideas-are-often-overlooked-a-review-and-theoretical-ana/) — strong (replicated line).
**Skill consequence:** the verbatim "select the most creative" instruction, the novelty-protection wildcard, and axes scored separately — finalists are never chosen on a single averaged number alone (the composite orders the pool; the selection rules and wildcard override it).

### §3.3 Dot voting / impact-effort

No controlled-outcome evidence; documented failure modes are anchoring and HIPPO.
Weighted scoring against explicit criteria is preferred because it forces originality to be scored separately from feasibility.
Sources: practitioner ([Google Sprint Kit](https://designsprintkit.withgoogle.com/methodology/phase4-decide/dot-vote)); [Ideometrics pipeline](https://pmc.ncbi.nlm.nih.gov/articles/PMC12904029/) — weak-to-moderate.

---

## §4 LLM-specific ideation research

### §4.1 The Stanford study — the anchor result

Si, Yang & Hashimoto (2024): 100+ NLP researchers, blind review, 49 ideas per condition.
LLM ideas judged **more novel** than expert ideas (5.64 vs 4.84 / 10, p < 0.01); feasibility indistinguishable (6.34 vs 6.61).
Two documented failure modes:

- **Diversity collapse:** 4,000 seed ideas per topic → only ~5% (~200) survived embedding dedup (cosine ≥ 0.8); non-duplicate rate of new batches keeps decreasing and plateaus — brute-force generation has an intrinsic ceiling.
- **LLM-judge unreliability:** best judge (pairwise Swiss tournament, **5 rounds**) reached 71.4% accuracy but only **53.3% consistency** — below the 56.1% human inter-reviewer agreement; direct score prediction is poorly calibrated.

Source: [arXiv 2409.04109](https://arxiv.org/abs/2409.04109) — strong (large-scale, blind).
**Skill consequences:** the 20% non-duplicate stopping signal, pairwise order-swapped ranking, and surfacing the confidence gate instead of pretending score precision.

### §4.2 The execution follow-up — novelty at ideation is inflated

43 experts executed randomly-assigned ideas (>100 h each, blind re-review): LLM-idea scores dropped more than human-idea scores on **all** metrics; rankings *flipped* post-execution.
Source: [arXiv 2506.20803](https://arxiv.org/abs/2506.20803) — strong (costly, blind).
**Skill consequence:** the mandatory executability probe per finalist.

### §4.3 Homogenization is real and measured

- Doshi & Hauser (Sci. Adv. 2024): GPT-4 ideas lift individual stories but make the pool **10.7% more similar**.
  [Study](https://www.researchgate.net/publication/383466490), [PNAS follow-up](https://www.pnas.org/doi/10.1073/pnas.2504966122) — strong.
- Anderson, Shah & Kreminski (2024): ChatGPT-assisted divergence more homogeneous than Oblique Strategies (N = 33) — moderate.
- [arXiv 2602.20408](https://arxiv.org/pdf/2602.20408): two mechanisms — **within-context fixation** (early outputs anchor later ones) and **knowledge aggregation** (one model = one distribution).
  CoT reduces fixation; **diverse ordinary personas beat celebrity "creative" personas**; CoT + ordinary personas exceeded human-sample diversity — moderate (recent, mechanism-driven).

**Skill consequences:** independent contexts, ordinary-professional personas, CoT inside each generator, and the lessons-blind divergence invariant (stored preferences are a homogenization vector).

### §4.4 Persona prompting — architecture matters

Cambridge *Design Science* (5 personas × 5 concepts × 7 problems × 3 LLMs): **parallel one-persona-per-call beats all-personas-in-one-prompt** and beats no-persona on semantic diversity.
Source: [Cambridge Design Science](https://www.cambridge.org/core/journals/design-science/article/enhancing-design-concept-diversity-multipersona-prompting-strategies-for-large-language-models/3B346E253508337A4EE899499BE49D9B) — moderate-strong.
**Skill consequence:** the 5-parallel-generator default.

### §4.5 Multi-agent diverge → debate → converge

Role-played multi-agent discussion beats single-LLM and parallel-vote baselines on Alternative Uses Test originality — but only in the bounded three-phase shape.
Source: [LLM Discussion, arXiv 2405.06373](https://arxiv.org/pdf/2405.06373) — moderate.

### §4.6 Temperature is not the creativity knob

Temperature correlates only weakly with novelty, moderately with *incoherence*; novelty is U-shaped with quality collapse past ~1.0–1.25.
Sources: [Peeperkorn et al.](https://arxiv.org/pdf/2405.00492), [arXiv 2604.18031](https://arxiv.org/pdf/2604.18031) — moderate.
**Skill consequence:** diversity from personas/operators/framings, not sampling noise.

### §4.7 LLM-as-judge biases

Documented: self-preference (judges favor own-style output), position bias (pair order flips verdicts), verbosity bias.
Mitigations: swap-and-average pair orders, rubric anchoring, judge ≠ generator, diverse judge panels.
Sources: [Self-Preference Bias, arXiv 2410.21819](https://arxiv.org/abs/2410.21819), [bias taxonomy, arXiv 2410.02736](https://arxiv.org/html/2410.02736v1) — strong for the phenomena.

### §4.8 Tree-of-Thought

Deliberate generate-evaluate-search lifts GPT-4 Game-of-24 from 4% to **74%**; evidence supports evaluating *between* stages at branch granularity — not during raw generation.
Source: [Yao et al. 2023](https://arxiv.org/abs/2305.10601) — strong for structured tasks.

---

## §5 Iterated refinement

### §5.1 Self-refinement helps early, then plateaus or lies

- Self-Refine: ~20% average improvement, but the gains concentrate in iterations 1–2, near-plateau by 3 — [selfrefine.info](https://selfrefine.info/) — strong for checkable tasks.
- Self-bias amplifies per iteration: perceived quality rises while actual quality does not — [arXiv 2402.11436](https://arxiv.org/pdf/2402.11436) — strong (multi-model).
- Generator+judge in one model spontaneously reward-hacks — [arXiv 2407.04549](https://arxiv.org/pdf/2407.04549) — moderate.

**Skill consequences:** the 3-round cap, external-judge-only stopping, and the generator-never-scores-itself rule.

### §5.2 Evolutionary / quality-diversity approaches counteract homogenization

MAP-Elites-style archives (best idea per behavioral niche; mutate/crossover from the archive) are the standard remedy for LLM mode collapse; diversity is maintained **structurally**, not hoped for.
Sources: [survey, arXiv 2410.14716](https://arxiv.org/pdf/2410.14716), [EvoLattice](https://arxiv.org/html/2512.13857), [GigaEvo](https://arxiv.org/pdf/2511.17592) — moderate.
**Skill consequence:** the niche-elite archive in the evolution loop.

### §5.3 When iteration homogenizes

Iterating within one context triggers fixation (§4.3); productive iteration is *recombination across independent lineages*, not repeated polishing of one list.

---

## Numerical defaults table

| Default in the skill                          | Number and source                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 5 parallel persona generators                  | The design parameter of the 5-persona parallel prompting study — [Cambridge Design Science](https://www.cambridge.org/core/journals/design-science/article/enhancing-design-concept-diversity-multipersona-prompting-strategies-for-large-language-models/3B346E253508337A4EE899499BE49D9B). The study demonstrated the parallel *architecture*, not an optimal count; 5 is adopted as the default, not proven optimal. |
| 6 ideas per generator per burst                | Operationalization of 6-3-5 brainwriting — [Wikipedia](https://en.wikipedia.org/wiki/6-3-5_Brainwriting). The cited method's per-round count is 3; doubled to 6 because an agent run has few bursts (see §1.4). |
| Mandatory burst 2 ("not yet said")             | Serial-order effect — [Beaty & Silvia 2012](http://libres.uncg.edu/ir/uncg/f/p_silvia_why_2012.pdf).                |
| Stop bursts below 20% non-duplicate yield      | Dedup plateau (~5% unique at 4,000 ideas; declining batch yield) — [arXiv 2409.04109](https://arxiv.org/abs/2409.04109). 20% is the skill's conservative early-warning threshold above the study's terminal ~5%. |
| Pairwise, order-swapped ranking for pools > 10 | Swiss tournament, 5 rounds; position-bias swap — [arXiv 2409.04109](https://arxiv.org/abs/2409.04109), [arXiv 2410.02736](https://arxiv.org/html/2410.02736v1). |
| 3-judge finalist panel (deep)                  | Judge consistency 53.3% < human 56.1%; panel diversity mitigation — [arXiv 2409.04109](https://arxiv.org/abs/2409.04109), [arXiv 2410.21819](https://arxiv.org/abs/2410.21819). |
| ≤ 3 evolution rounds                           | Self-Refine plateau at ~3 iterations — [selfrefine.info](https://selfrefine.info/).                                 |
| < 5% round-over-round improvement → stop       | Flat *external* scores as the only trusted signal — [arXiv 2402.11436](https://arxiv.org/pdf/2402.11436). The 5% cut is the skill's operationalization, not a study number. |
| Executability probe per finalist               | Post-execution ranking flip — [arXiv 2506.20803](https://arxiv.org/abs/2506.20803).                                 |
| "Select the most creative" verbatim instruction | Partial-correction effect of the explicit instruction — [Rietzschel et al. 2010](https://bpspsychub.onlinelibrary.wiley.com/doi/10.1348/000712609X414204). |

### Operationalizations with no study number

These defaults are the skill's own engineering choices — consistent with the findings above but not taken from any source.
They are listed here so no number in the skill silently masquerades as evidence.

| Default                                                        | Rationale                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Quick mode: 2 bursts × 8 ideas                                  | Matches deep mode's two-burst shape at roughly half the volume for in-context runs.                   |
| Pool gates ≥ 12 (quick) / ≥ 25 (deep) unique ideas              | Reachable from the burst structures with expected dedup loss; forces at least two bursts.             |
| Composite weights 0.30 N / 0.25 F / 0.30 I / 0.15 Fit           | Novelty and impact weighted above feasibility to lean against the §3.2 bias; composite orders the pool only — selection rules override it. |
| Wildcard floor: Feasibility ≥ 4                                 | Excludes only outright-impossible ideas from novelty protection; any higher floor would re-create the §3.2 bias inside the wildcard rule. |
| Panel of 3 finalist judges (deep)                               | Smallest odd panel; §4.7 motivates panels but names no size, and same-model panels approximate — not achieve — the diversity §4.7 means. |
| `--n 3` finalists; 3–5 HMW framings                             | Presentation-size choices.                                                                            |
| Pairwise refinement for pools > 10, top half only               | Cost bound; direct rubric scoring suffices for small pools.                                           |
| ≤ 2 finalists per niche                                         | Structural diversity guard at selection, mirroring the per-niche elitism of §5.2.                     |
| Evolution skip: pool ≤ 6 or top composite ≥ 8.5                 | Skip when there is nothing to breed or little headroom.                                               |
| 2–3 variants per operator; ≥ 80% duplicate variants → stop      | Volume/stop bounds consistent with the §4.1 plateau logic.                                            |
| Archive replacement: higher composite, or higher Novelty with composite within 0.5 | The novelty branch stops the feasibility weight from silently discarding high-novelty variants (§3.2); the 0.5 window is an engineering choice. |

---

## Evidence-strength summary

- **Bedrock (safe to hard-code):** nominal > interactive; production blocking; quantity→quality; serial-order effect; feasibility-biased selection; LLM homogenization; LLM-judge bias; self-refine plateau + self-bias amplification; Stanford novelty result + execution-gap correction.
- **Solid but narrower:** parallel persona prompting; CoT + ordinary personas; far-analogy stimuli; incubation; bounded multi-agent debate.
- **Folklore / mechanism-plausible only (used as operators, no evidence claims):** SCAMPER superiority, Six Thinking Hats specifics, dot voting, worst-possible-idea, first principles, the Double Diamond beyond its separation rule.
