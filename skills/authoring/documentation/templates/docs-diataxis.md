# Diátaxis Quadrant Templates

Each Diátaxis quadrant has a distinct shape. This file ships one
skeleton per quadrant. Pick by reader need:

- **Section 1: Tutorial** — learning-oriented. "Teach me."
- **Section 2: How-to** — task-oriented. "How do I X?"
- **Section 3: Reference** — information-oriented. "Look up Y."
- **Section 4: Explanation** — understanding-oriented. "Why Z?"

A doc serves **exactly one** quadrant. If yours feels like two, split it.

---

## 1. Tutorial — Learning-Oriented

**Tone:** concrete, encouraging, "look what you can do".
**Reader state:** beginner, knows nothing, wants to see something work.
**Hard rules:** one path, no choices, every step produces a visible
result, no theory.

```markdown
# <Verb something — "Build your first X">

Time to complete: ~<N> minutes.
By the end you will have <concrete, visible artifact>.

## Before you start

You need:
- <prereq>
- <prereq>

## 1. <Verb the first step>

<One concrete action. Show the command. Show the output.>

```bash
<command>
```

You should see:

```
<output>
```

## 2. <Verb the next step>

…

## 3. <Final visible result>

You now have <concrete artifact>.

## What's next

- To do <related task>, see the [how-to guide](../how-to/<task>.md).
- To understand <concept>, see the [explanation](../explanation/<concept>.md).
```

**Anti-patterns:** "you can also try", "there are several ways", "this
works because…". All of these belong in other quadrants.

---

## 2. How-to — Task-Oriented

**Tone:** crisp, imperative, action-only.
**Reader state:** competent user with a specific goal.
**Hard rules:** state the goal, list prerequisites, show the steps, do
not teach.

```markdown
# How to <verb something specific>

<One-sentence statement of what this guide accomplishes.>

## Prerequisites

- <prereq>
- <prereq>

## Steps

1. <Imperative action.>

   ```bash
   <command>
   ```

2. <Imperative action.>

   ```bash
   <command>
   ```

3. <Imperative action.>

   <Code block or screenshot showing the expected state.>

## Verify

<How to confirm the task worked. A specific check, command, or visible
state.>

## Troubleshooting

| Symptom                                | Cause                                | Fix                                                          |
| -------------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| <Observed failure>                     | <Likely cause>                       | <Specific fix>                                               |
| <Observed failure>                     | <Likely cause>                       | <Specific fix>                                               |

## See also

- [Related how-to](./<related>.md)
- [Background explanation](../explanation/<topic>.md) for the *why*
```

**Anti-patterns:** "first, let's understand X", "this works by", any
sentence with "you should learn".

---

## 3. Reference — Information-Oriented

**Tone:** austere, uncompromising, neutral, factual.
**Reader state:** working, knows what they are looking for, scanning for
a single fact.
**Hard rules:** mirrors product structure (alphabetical or by API
shape), no instruction, no narrative, no opinion.

```markdown
# <API surface, e.g. CLI reference>

<One-line orientation — what this document indexes. No tutorial language.>

## <Top-level item, e.g. command name>

<One-line description of what this item is.>

### Synopsis

```
<exact syntax>
```

### Arguments

| Name        | Type      | Required | Default | Description                               |
| ----------- | --------- | -------- | ------- | ----------------------------------------- |
| `<name>`    | `<type>`  | yes / no | `<val>` | <one-line description>                    |

### Options

| Flag                  | Default  | Description                              |
| --------------------- | -------- | ---------------------------------------- |
| `--<flag>, -<short>`  | `<val>`  | <one-line description>                   |

### Returns

<What it returns or produces.>

### Example

```bash
<command>
# => <output>
```

### See also

- `<related-item>`
```

**Anti-patterns:** "first, let me explain", "you should use this when",
"this is useful because". Reference does not teach; reference catalogs.

---

## 4. Explanation — Understanding-Oriented

**Tone:** discursive, reflective.
**Reader state:** studying, wants to understand the *why*.
**Hard rules:** covers why, history, trade-offs, alternatives; does not
give step-by-step instructions; does not catalog APIs.

```markdown
# <Topic — "Why we use X">

<One-paragraph framing of the question this doc answers.>

## The constraint

<What problem or constraint prompted the design choice.>

## The options we considered

We considered:

- **<Option A>** — <one-line description>. Strengths: <…>. Weaknesses: <…>.
- **<Option B>** — <one-line description>. Strengths: <…>. Weaknesses: <…>.
- **<Option C>** — <one-line description>. Strengths: <…>. Weaknesses: <…>.

## The decision

<What we picked. Why.>

## Consequences

<What this enables.>
<What this costs.>

## Open questions

<What we have not yet decided. What conditions would prompt revisiting.>

## See also

- [How-to: <related task>](../how-to/<task>.md) — practical follow-up.
- [Reference: <related API>](../reference/<api>.md) — exact details.
```

**Anti-patterns:** numbered "step 1, step 2" instructions, copy-pasteable
recipes, exhaustive API tables. All belong in other quadrants.

---

## 5. Mixed-Quadrant Smell Test

If you are about to write a doc and find yourself wanting to:

- Teach a concept *and* show a procedure → split into explanation + how-to.
- List every API method *and* tell the reader when to use each →
  split into reference + how-to.
- Walk through a tutorial *and* explain why each step works → split
  into tutorial + explanation. (The explanation goes in a separate
  file; the tutorial links to it.)

Splitting feels like more work up front. It pays back the first time a
reader bounces off a doc because it answered the wrong question.
