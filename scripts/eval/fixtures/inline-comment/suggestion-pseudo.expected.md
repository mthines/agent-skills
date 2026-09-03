suggestion (medium): 🟡 **Backoff jitter is seeded once per process** **(non-blocking)**

Every worker shares one seed, so retries across the pool collide instead of spreading.

Evidence: `src/api/backoff.ts:41`

```ts
const jitter = () => Math.random() * base;
```

_Pseudo-code — verify before applying._

<sup>`pr-reviewer` · commit `7389036` · [how these findings are produced](https://github.com/mthines/agent-skills/blob/main/agents/pr-reviewer.md)</sup>

<!-- fp:v2:quality:maintainability:jitter@src/api/backoff.ts -->
