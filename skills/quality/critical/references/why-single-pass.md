# Why `critical` is one hostile, grounded, unscored pass

A single LLM "be honest" pass tends to confirm rather than challenge.
Naïve self-refine has been shown to amplify bias (Pride and Prejudice, ACL 2024) and to add no gains over self-consistency when the initial answer is already strong (SELF-[IN]CORRECT, AAAI).
External grounding plus a fixed taxonomy beats vague introspection (CRITIC framework).

`critical` is the structured counter-pressure that follows from those results:

- **One pass, hostile persona.** A second critique of the same target re-introduces the self-refine loop; a revised target gets a fresh invocation instead.
- **Mandatory citations.** Pure introspection is unreliable, so every finding is grounded in a file, a line, or a named assumption, and at least one grounding action runs first.
- **Mandatory steelman.** It is the load-bearing differentiator from `/confidence`; without an alternative, the run only checks the proposal against itself.
- **No self-scoring.** Scoring is `/confidence`'s job; conflating critique and scoring re-creates the bias amplification problem.
- **Skipped rows are listed.** A silent skip hides whether the taxonomy was actually walked.
