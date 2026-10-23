---
title: Recording — a screen recording of every spec run and every adversarial finding
impact: MEDIUM
tags:
  - ui-verify
  - playwright
  - video
  - recording
---

# Recording

A `ui-verify run` records a video of each spec it runs (an `.mp4` on both drivers), and of each adversarial probe that found something.
A reviewer then watches what the runner did instead of reconstructing it from screenshots.
Recording is **on by default**; `--no-recording` turns it off.
A recording is evidence, never an assertion: a failed recording is a `notes` line and never turns a spec red.

## Which runs record

| Driver | Spec run | Adversarial pass |
| --- | --- | --- |
| `playwright` | Yes — `--record-video` in the dispatch `Mode:` line; the runner records through the `screencast` skill (overlay, step timings, `finish.mjs` → `.mp4`) per the spec-run contract's § Record video (`autonomous-workflow/rules/spec-run-contract.md`) | Yes — `ADV_VIDEO=1` (see [`adversarial.md § Step 3`](./adversarial.md#step-3-run-the-probes)); kept for findings and probe errors only, finished to `.mp4` |
| `chrome` | Yes — the runner records the tab with `screencast`'s `capture.mjs` (DevTools protocol → `.mp4`); the user clicks **Allow** in Chrome once per Chrome session. Remote debugging off → `gif_creator`, converted to `.mp4` | No |

`--no-recording` drops `--record-video` from both drivers' `Mode:` lines and exports `ADV_VIDEO=0`.
`screencast` not installed → raw `.webm` files and a `notes` line; recording still never fails a spec.

## Where the files land

| Source | Path |
| --- | --- |
| Spec run (`playwright`) | `.agent/{branch}/.aw-tester/recordings/<spec-id>.mp4`, with `<spec-id>.timings.json` and `<spec-id>.sheet.png` beside it |
| Spec run (`chrome`) | The same three files as `playwright` |
| Adversarial pass | `.agent/{branch}/.ui-verify/adversarial/recordings/<ADV-NN>-<slug>.mp4` |

```bash
SC="${SCREENCAST_DIR:-$HOME/.claude/skills/screencast}"
node "$SC/scripts/finish.mjs" test-results/<probe>/video.webm --out "<output dir>/recordings/ADV-03-timing-double-submit.mp4"
```

Both directories are gitignored scratch, like the screenshots.

## Report

1. **Open each `<id>.sheet.png` before you list or upload its video.** A recording whose frames do not show the spec's steps is a `notes` line, not evidence.
2. List every recording under a **Recordings** heading in [`runner.md § Step 5`](./runner.md#step-5-report-the-verdict), after **Screenshots**: one line per file with the spec or probe id and its result.
3. When the verdict carries no `recordings:` key, print the reason instead — `none (--no-recording)` or the runner's `notes` line.
4. When the PR comment posts, every recording is uploaded as an `.mp4` and embedded under its spec's or probe's section as a bare URL on its own line, which GitHub renders as a player ([`runner.md § Step 5a`](./runner.md#step-5a-post-the-ui-region)). Never upload a GIF when an `.mp4` exists.

```text
✅ RIGHT
Recordings (3):
  Spec-1 pass — .agent/feat-rename/.aw-tester/recordings/spec-1.mp4
  Spec-2 fail — .agent/feat-rename/.aw-tester/recordings/spec-2.mp4
  ADV-03 finding (high) — .agent/feat-rename/.ui-verify/adversarial/recordings/ADV-03-timing-double-submit.mp4

❌ WRONG
Recordings: yes                      # no paths — nobody can open them
```
