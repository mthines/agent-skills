# Style Direction Brief — <Product / Feature>

**Audience:** <one sentence>
**Voice (one sentence):** <"We're the <adjective> <product category>">
**Adjacency — feels like:** <2–3 named exemplars>
**Adjacency — never like:** <1–2 named anti-exemplars>

---

## Primary direction — <Name from style-directions.md>

**Why this direction.** <2–3 sentences mapping voice to direction using
the `brand-identity.md` table. Cite which voice traits drove the choice.>

### Worked sketch

**Palette**

| Role               | Value (hex / OKLCH)         | Note                          |
| ------------------ | --------------------------- | ----------------------------- |
| `surface.base`     | <hex>                       | Background                    |
| `surface.card`     | <hex>                       | Elevated 2–5% lighter         |
| `content.primary`  | <hex>                       | Body and headlines            |
| `content.secondary`| <hex>                       | Metadata                      |
| `accent.default`   | <hex>                       | Primary action, focus         |
| `accent.hover`     | <hex>                       | Darker / more saturated       |
| `accent.surface`   | `<hex>` at 10% alpha        | Tinted backgrounds            |
| `semantic.error`   | <hex>                       | Recognisable as error         |
| `semantic.success` | <hex>                       | Recognisable as success       |
| `semantic.warning` | <hex>                       | Recognisable as warning       |

**Typography**

| Role         | Family              | Size (web / iOS / Android) | Weight | Tracking |
| ------------ | ------------------- | -------------------------- | ------ | -------- |
| Display      | <family>            | <values>                   | <wt>   | <tr>     |
| H1           | <family>            | <values>                   | <wt>   | <tr>     |
| Body         | <family>            | 16 / 17 / 14               | 400    | 0        |
| UI label     | <family>            | 14 / 15 / 14               | 500    | <tr>     |
| Mono         | <family>            | match body                 | 400    | 0        |

Scale ratio: <1.125 / 1.25 / 1.333 / 1.5>.

**Space & radius**

- Base unit: <4 px / 8 px>
- Radius lock: <one or two values>
- Outer container padding: <value>
- Inter-group spacing: <value>

**Signature moves (pick 1–3)**

1. <Move 1 — e.g. "Double-ring focus, 2 px offset, accent colour">
2. <Move 2 — e.g. "Numbered section markers `01 /` in monospace">
3. <Move 3 — optional>

**Density posture:** <sparse | comfortable | dense>

### Sample component — <Component name>

```<lang>
<copy-pasteable code applying tokens, type, signature moves>
```

### Defer to /ux

- Contrast pairs to verify with WCAG: <list of pairs>
- Touch targets to verify: <list>
- Dark mode posture: <one line — light variant first, dark via /ux>

---

## Runner-up direction — <Name from style-directions.md>

**Why this would also work.** <1–2 sentences.>
**Why the primary wins.** <1 sentence — the decisive trait.>

(Compressed sketch — palette and one signature move only.)

**Palette accent:** <hex>
**Type:** <one-line family choice>
**Signature move:** <one>

---

## Decision

Recommended: **<Primary direction name>**.
Open question for the user: <one — e.g. "do you want a serif headline, or
stay sans-only?">

## Next steps

1. Confirm direction with user.
2. Implement tokens in <theme.ts / tailwind.config / tokens.json>.
3. Build sample component(s): <list>.
4. Run `/visual-design review` after the first 2–3 components ship to
   verify direction holds.
5. Run `/ux` for accessibility + microcopy pass.
