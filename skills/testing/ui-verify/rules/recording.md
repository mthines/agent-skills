---
title: Recording — a screen recording of every Playwright spec run and every adversarial finding
impact: MEDIUM
tags:
  - ui-verify
  - playwright
  - video
  - recording
---

# Recording

A `ui-verify run` on the Playwright driver records a video of each spec it runs, and of each adversarial probe that found something.
A reviewer then watches what the runner did instead of reconstructing it from screenshots.
Recording is **on by default**; `--no-recording` turns it off.
A recording is evidence, never an assertion: a failed recording is a `notes` line and never turns a spec red.

## Which runs record

| Driver | Spec run | Adversarial pass |
| --- | --- | --- |
| `playwright` | Yes — `--record-video` in the dispatch `Mode:` line, per the spec-run contract's § Record video (`autonomous-workflow/rules/spec-run-contract.md`) | Yes — `ADV_VIDEO=1` (see [`adversarial.md § Step 3`](./adversarial.md#step-3-run-the-probes)); kept for findings and probe errors only |
| `chrome` | No — the extension cannot record; report `recordings: none (chrome driver — video is Playwright-only)` | No |

`--no-recording` drops `--record-video` from the `Mode:` line and exports `ADV_VIDEO=0`.

## Where the files land

| Source | Path |
| --- | --- |
| Spec run | `.agent/{branch}/.aw-tester/recordings/<spec-id>.webm` — or `<spec-id>-<seq>.webm` segments when the runner could not join them (no `ffmpeg`) |
| Adversarial pass | `.agent/{branch}/.ui-verify/adversarial/recordings/<ADV-NN>-<slug>.webm` |

Both directories are gitignored scratch, like the screenshots.

## Report

List every recording under a **Recordings** heading in [`runner.md § Step 5`](./runner.md#step-5-report-the-verdict), after **Screenshots**: one line per file with the spec or probe id and its result.
When the verdict carries no `recordings:` key, print the reason instead — `none (--no-recording)`, `none (chrome driver — video is Playwright-only)`, or the runner's `notes` line.
Never inline video bytes; the paths are the deliverable.
When the PR comment posts, every recording is uploaded and linked from its spec's or probe's row ([`runner.md § Step 5a`](./runner.md#step-5a-post-the-ui-region)); a `.webm` over 10 MB is re-encoded to `.mp4` by `attach-media`.
To trim or crop a clip first, hand its path to the `screen-recorder` skill's crop pass.

```text
✅ RIGHT
Recordings (3):
  Spec-1 pass — .agent/feat-rename/.aw-tester/recordings/spec-1.webm
  Spec-2 fail — .agent/feat-rename/.aw-tester/recordings/spec-2.webm
  ADV-03 finding (high) — .agent/feat-rename/.ui-verify/adversarial/recordings/ADV-03-timing-double-submit.webm

❌ WRONG
Recordings: yes                      # no paths — nobody can open them
```
