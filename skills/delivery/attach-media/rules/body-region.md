# The owned body region

`attach-media` owns one region of a PR or issue body.
It never edits text outside that region.
**Why:** the narrative body belongs to `create-pr`, and a review-loop refresh rewrites that narrative, so the region must be unambiguous to both.

## Shape

```markdown
<!-- attach-media:v1 -->
### <heading, default "Screenshots">

![<alt>](<asset-url>)

![<alt>](<asset-url>)

<video-asset-url>
<!-- /attach-media:v1 -->
```

- Put images first, in the order the caller passed them, then videos.
- Write each image as `![<alt>](<asset-url>)` on its own line, with a blank line between entries.
- Write each video as its bare asset URL on its own line, with blank lines around it.
  GitHub renders a URL that is the whole paragraph as a player; an image or link wrapper would not.
- Default alt text is the filename with its extension removed and `-`/`_` turned into spaces.
  Prefer the caller's alt text, such as an `aw-tester` capture label or a spec title.

## Placement

Use the first row that matches.

| # | Body state | Put the region |
| --- | --- | --- |
| 1 | A region already exists | In its place. Replace it whole, markers included. |
| 2 | A heading matches `/screenshot\|recording\|demo\|video\|visual\|preview\|before.*after/i` (a repo PR template) | Directly under that heading. Delete that section's placeholder text: an HTML comment, `N/A`, `TBD`, `TODO`, or `_No response_`. Omit the `###` heading inside the region, since the template's heading already labels it. |
| 3 | A `<!-- ui-verify:v2 -->` (or `v1` / `preview-spec:v1`) block exists | Immediately above that block. |
| 4 | Otherwise | At the end of the body. |

## Removal

When a caller passes zero files that survive preflight, write no region.
Leave an existing region untouched, because a failed re-run must not erase media a previous run attached.

## Callers

A caller that rewrites the body must keep this region intact, markers included.
That covers `review-loop`'s description refresh and `create-pr`'s contract.
The region does not count toward the description length budget.

```text
❌ WRONG — what this skill replaces
## Screenshots
<!-- TODO: add screenshots -->
Screenshots saved to .agent/feat-x/.aw-tester/captures/ — attach before merging.

✅ RIGHT — after attach-media
## Screenshots
<!-- attach-media:v1 -->
![Settings page with the new toggle](https://github.com/user-attachments/assets/1f0c…)
<!-- /attach-media:v1 -->
```
