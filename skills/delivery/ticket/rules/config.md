---
title: 'tracker.yml — the repo ticket tracker config'
impact: HIGH
tags:
  - ticket
  - config
---

# `tracker.yml`

`.agents/aw/tracker.yml` is committed and holds no secrets.
`~/.agents/aw/config.yml` → `repos.<owner/repo>.tracker` is merged over it, key by key, for values only you use.

```yaml
# .agents/aw/tracker.yml — the ticket skill. Committed; no secrets.
version: 1
provider: linear                 # linear | github | none
require: ask                     # always | ask | never — default ask
linear:
  team: AI                       # required for linear: the team key
  project: ""                    # optional
  labels: [agent]
github:
  labels: [agent]                # issues go to the repo's origin
states:                          # pipeline stage → tracker state; `none` = leave it
  build: In Progress             # linear defaults: In Progress, In Review, Done
  ready: In Review               # github defaults: none, none, closed
  merge: Done
skills:
  create: project-management:linear-planning   # optional: a skill that creates the ticket instead of the default call
```

| Key | Default | Meaning |
| --- | --- | --- |
| `provider` | `none` | Which tracker holds the tickets |
| `require` | `ask` | `always`: every request gets a ticket, unattended too · `ask`: ask a human, skip unattended · `never`: only link a named one |
| `linear.team` | — | Required when `provider: linear` |
| `states.<stage>` | per provider | The state a ticket moves to when that stage proceeds |
| `skills.create` | — | A skill name passed to `Skill()` to create the ticket |

```yaml
# ~/.agents/aw/config.yml — personal, never committed
repos:
  dash0hq/dash0:
    tracker:
      require: always
      skills:
        create: project-management:linear-planning
```

- The parser reads maps, scalars, `[a, b]` lists, and `- x` scalar lists; a list of maps is refused, never misread.
- An unknown `provider` or `require`, or `provider: linear` without `linear.team`, makes `ticket.mjs` exit 1 with the reason.
