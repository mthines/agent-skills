issue (high): 🟠 **Check-run variables rejected at runtime** **(blocking)**

The exhaustive `Record<TriggerKind>` maps `TRIGGER_VARIABLES` and `DESCRIPTIONS` both omit the new kind, so both fail `tsc`.

Evidence: `src/triggers/variables.ts:12` (map) · `src/ui/hover-card.tsx:40`

```ts
"github.check_run": ["conclusion", "name", "started_at"],
```

<a href="https://app.dash0.com/goto/agent0?auto_submit=true&amp;initial_prompt=Fix%20the%20finding&amp;utm_source=pr-reviewer-fix-this"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets/fix-this-agent0-dark.svg"><img alt="Fix with Agent0" src="https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets/fix-this-agent0-light.svg" height="36"></picture></a>

<sup>`pr-reviewer` · commit `7389036` · [how these findings are produced](https://github.com/mthines/agent-skills/blob/main/agents/pr-reviewer.md)</sup>

<!-- fp:v2:consumer-impact:contract-break:triggerKinds@src/triggers/kinds.ts -->
