<!-- impact-map:v1 -->
## Impact map

**Why:** {{the PR's purpose, one sentence}}

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="{{dark PNG asset URL}}">
  <img alt="{{the diagram caption plus one clause per box group, naming each decision number}}" src="{{light PNG asset URL}}">
</picture>

**Verdict:** {{one sentence}} Open a line for the detail and the lines to check.

<details>
<summary><b>①</b> {{decision 1 as one statement}}</summary>
<br>

**What:** {{one sentence}}\
**Risk:** {{one sentence}}\
**Ask:** {{one either/or or yes/no question}}

Lines to check:

- [`{{short/path.ext:a–b}}`]({{primary URL}}): {{the question to answer at this line}}

</details>

<!-- Repeat for ② and ③. An "also live on merge" row uses <b>·</b> instead of a number. -->

**Verified:** {{what the author ran}}. **Not run:** {{what did not run, or "nothing"}}.

<details>
<summary>Already settled (intended, covered by a test or the docs)</summary>
<br>

- **{{the behavior}}** {{where it is settled, with a link}}
- **Safe to skim:** {{generated, moved, or mechanical files}}

</details>
<!-- /impact-map:v1 -->
