# Why the interview is small

The skill follows Anthropic's Claude Code [best practices](https://code.claude.com/docs/en/best-practices): a specific prompt plus a way to verify is usually enough, and an interview earns its cost only when requirements are unclear ("interview me until you could write the spec").

- **Research before asking.** A question the repository answers spends the user's attention on nothing.
- **Ask only `blocking` unknowns, in one batch.** The cost of an interview is active human minutes. Exhaustive "resolve every assumption" interviews, such as `grill-me`, have no published evidence of a net gain over a clear prompt, and long sessions drift into passive agreement.
- **Always pin non-goals and success criteria.** They are the two parts of a spec most often left out, and success criteria are what lets the implementing session verify its own work.
- **Spike instead of asking.** Some unknowns cannot be settled in conversation; asking them produces a guess dressed as a decision.
- **The brief is a spec, not a plan.** Clarifying behavior and planning files are separate steps; the brief feeds a fresh planning or implementation session.
