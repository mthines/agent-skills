---
title: Cropping — `ffmpeg` Section Crops and Transcoding
impact: HIGH
tags:
  - ffmpeg
  - crop
  - webm
  - mp4
  - gif
---

# Cropping

Playwright records the full viewport.
This rule explains how to crop the result to the target element's
bounding box (read from `bbox.json` produced by the recording script)
and how to transcode the `.webm` to `.mp4` or `.gif` when the caller
asks.

## Contents

- Why crop after recording, not via viewport sizing
- Reading `bbox.json`
- Crop command (flag-by-flag)
- Analyser-optimised sizing (768 px / 0.5 s GOP)
- Aspect-ratio safety check
- Padding for context (16 px default)
- Transcoding to `.mp4` (PR previews)
- Transcoding to `.gif` (budgeted)
- Output naming
- Examples (good + bad)
- Common mistakes

## Why crop after recording, not via viewport sizing

Sizing the viewport to the element's dimensions changes the layout:

- Responsive breakpoints kick in at smaller widths.
- Container queries on the target's ancestors may resolve differently.
- `position: fixed` overlays jump.
- Off-screen interactions (hover triggers, sticky headers) move out of
  view.

Record at the **real viewport** (default `1280×800`, the common
breakpoint band) and crop after.
This preserves what the user actually sees.

## Reading `bbox.json`

The recording script writes a sibling file:

```json
{ "x": 240, "y": 96, "w": 320, "h": 480 }
```

All values are integers (rounded by the script).
`ffmpeg` rejects fractional crops, so do not re-round.

## Crop command

```bash
ffmpeg -y -i input.webm \
  -filter:v "crop=${w}:${h}:${x}:${y},scale='min(768,iw)':-2" \
  -c:v libvpx-vp9 -b:v 0 -crf 32 \
  -g 15 -keyint_min 15 \
  -an \
  output.webm
```

Flag-by-flag:

| Flag                                       | Why                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `-y`                                       | Overwrite without prompting (idempotent reruns).                                |
| `-i input.webm`                            | Input from the recording script.                                                |
| `-filter:v "crop=W:H:X:Y,scale='min(768,iw)':-2"` | Crop, then downscale to ≤ 768 px wide. `min(768,iw)` clamps to source width — small crops are NOT upscaled. `:-2` preserves aspect ratio and rounds to an even height (`libvpx-vp9` / `libx264` require even dimensions). |
| `-c:v libvpx-vp9`                          | Match the source codec; avoids re-encode artifacts at the seam.                 |
| `-b:v 0 -crf 32`                           | CRF mode at quality 32 — good balance for 5–10 s UI clips.                      |
| `-g 15 -keyint_min 15`                     | Force a fixed-interval GOP — one keyframe every 15 frames (0.5 s at 30 fps).    |
| `-an`                                      | Drop audio. Playwright videos have no audio; this is belt-and-braces.            |
| `output.webm`                              | The deliverable.                                                                 |

## Analyser-optimised sizing

The defaults above are tuned for the [`video-analyser`](../../../analysis/video-analyser/SKILL.md) skill — the most expensive downstream consumer (per-token cost on a vision model). Two settings carry the weight:

| Setting             | Default        | Why                                                                                                                                                                                              |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `max-width`         | `768` px       | The `video-analyser` calls this the "curve knee for screen-recording legibility". UI text (error messages, console output, stack traces) stays readable; image tokens stay at ~786 per frame on Sonnet. Going to 1568 px doubles the cost with no legibility gain on screen content. |
| `keyint` (GOP)      | `15` frames    | At 30 fps that places an I-frame every 0.5 s. The `video-analyser`'s Step 5a uses `select='eq(pict_type,I)'` to pick the 8 most signal-dense frames — a short GOP guarantees enough I-frames even for 3 s clips. Without this, Playwright's native `.webm` output may have only a single keyframe at frame 0, forcing the analyser into uniform-time-sampling fallback (lower signal, noted in its Step 5a). |

Net effect on a typical 5 s clip:

| Stage                         | Before tuning              | After tuning              |
| ----------------------------- | -------------------------- | ------------------------- |
| Raw record dimensions          | 1280×800                   | 1280×800 (unchanged)      |
| Cropped dimensions (example)   | 1100×640                   | 1100×640 → 768×447         |
| Keyframes in 5 s               | 1                          | 10                        |
| Analyser sampling method       | Uniform fill (Step 5b)      | Pure keyframe (Step 5a)    |
| Analyser cost (8 frames)       | ~$0.019                    | ~$0.019 (cost unchanged)   |
| Analyser **signal quality**    | Lossy time-sampling         | Signal-dense scene transitions |

Set `max-width: 0` to disable downscaling (rare — only when a human reviewer reports text-still-unreadable at 768 px). The `keyint` rarely needs changing.

## Aspect-ratio safety

`ffmpeg`'s crop rejects out-of-bounds coordinates with `Invalid crop
parameters`.
Validate before running:

```bash
# Source dimensions
read SW SH < <(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height -of csv=p=0 input.webm | tr ',' ' ')

if (( x + w > SW || y + h > SH )); then
  echo "Bounding box exceeds source ${SW}x${SH}." >&2
  exit 1
fi
```

This catches cases where the element was partially off-screen at
recording time. If validation fails, skip the crop and surface a one-line
note ("element off-screen; delivering uncropped recording").

## Padding for context (optional)

Reviewers often want **a little** room around the section.
Apply a fixed padding of `16 px` on each side by default:

```bash
PAD=16
x2=$(( x - PAD ))   ; y2=$(( y - PAD ))
w2=$(( w + 2*PAD )) ; h2=$(( h + 2*PAD ))
# Clamp to source dimensions
(( x2 < 0 )) && { w2=$(( w2 + x2 )); x2=0; }
(( y2 < 0 )) && { h2=$(( h2 + y2 )); y2=0; }
(( x2 + w2 > SW )) && w2=$(( SW - x2 ))
(( y2 + h2 > SH )) && h2=$(( SH - y2 ))
ffmpeg -y -i input.webm -filter:v "crop=${w2}:${h2}:${x2}:${y2}" \
  -c:v libvpx-vp9 -b:v 0 -crf 32 -an output.webm
```

Disable padding by passing `padding: 0`.

## Transcoding

The deliverable is `.webm` by default.
Two opt-in transcodes are supported.

### `.mp4` (H.264) — for PR comment previews

GitHub previews `.mp4` inline in comments; `.webm` is downloaded.
When the caller is `reviewer` in PR Mode, transcode by default.

```bash
ffmpeg -y -i cropped.webm \
  -c:v libx264 -preset veryfast -crf 23 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -g 15 -keyint_min 15 -sc_threshold 0 \
  -an \
  cropped.mp4
```

| Flag                              | Why                                                       |
| --------------------------------- | --------------------------------------------------------- |
| `-pix_fmt yuv420p`                | Required for QuickTime / Safari preview.                  |
| `-movflags +faststart`            | Moves moov atom to the front so the browser streams it.   |
| `-preset veryfast -crf 23`        | Balance: small enough for chat clients, sharp enough to read text. |
| `-g 15 -keyint_min 15 -sc_threshold 0` | Same 0.5 s GOP as the `.webm` crop pass. `-sc_threshold 0` disables `libx264`'s scene-cut detection (which otherwise inserts opportunistic keyframes and would defeat the fixed-interval contract the `video-analyser` relies on). |

### `.gif` — for static doc embedding

Only for clips **≤ 4 s** and **≤ 400×400** after cropping.
Beyond that, `.gif` balloons past 10 MB and looks worse than `.mp4`.

**Probe the duration from the raw source `.webm`, not the cropped output.**
The VP9 crop re-encode may alter container timing by up to one GOP, causing
the cropped file's duration to differ from the source — leading to false
budget check results for clips right at the 4 s boundary.

```bash
# Duration probe — use the raw source, not the cropped output
SOURCE_DURATION_S=$(ffprobe -v error -show_entries format=duration \
  -of csv=p=0 raw.webm | awk '{print int($1+0.5)}')

# Two-pass with palette for acceptable colour fidelity
ffmpeg -y -i cropped.webm \
  -vf "fps=15,scale=400:-1:flags=lanczos,palettegen=stats_mode=full" \
  palette.png

ffmpeg -y -i cropped.webm -i palette.png \
  -filter_complex "fps=15,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" \
  cropped.gif
```

If the clip exceeds the budget, refuse to produce `.gif`:

```text
Refusing to transcode to .gif: source clip is 6.8 s at 800x600. Would
produce a ~15 MB file. Prefer .mp4, or trim the clip first.
```

## Output naming

| Output            | Path                                                       |
| ----------------- | ---------------------------------------------------------- |
| Raw recording     | `.agent/recordings/<slug>/<random>.webm` (Playwright-named) |
| Cropped `.webm`   | `.agent/recordings/<slug>/<slug>.webm`                     |
| Cropped `.mp4`    | `.agent/recordings/<slug>/<slug>.mp4`                      |
| Cropped `.gif`    | `.agent/recordings/<slug>/<slug>.gif`                      |
| Bounding box      | `.agent/recordings/<slug>/bbox.json`                       |

The raw recording is kept (do not delete) — it is the audit trail.

## Examples

### Good — full pipeline

```bash
SLUG="services-sidebar-1715500000"
DIR=".agent/recordings/$SLUG"
RAW=$(ls "$DIR"/*.webm | head -1)
read x y w h < <(jq -r '"\(.x) \(.y) \(.w) \(.h)"' "$DIR/bbox.json")

# Validate
read SW SH < <(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height -of csv=p=0 "$RAW" | tr ',' ' ')

ffmpeg -y -i "$RAW" \
  -filter:v "crop=${w}:${h}:${x}:${y}" \
  -c:v libvpx-vp9 -b:v 0 -crf 32 -an \
  "$DIR/$SLUG.webm"
```

### Bad — re-encoding to MP4 with default `pix_fmt`

```bash
ffmpeg -i input.webm -c:v libx264 output.mp4
# Safari and Quicktime refuse to play yuv444p.
```

**Fix:** add `-pix_fmt yuv420p`.

## Common mistakes

- **Cropping at fractional coordinates.**
  `ffmpeg` rejects `crop=320.5:480:240:96`.
  **Fix:** round in the recording script; never re-round here.
- **Forgetting `-pix_fmt yuv420p` for `.mp4`.**
  GitHub / Slack previews fail silently.
  **Fix:** always set `yuv420p` for `.mp4`.
- **Transcoding to `.gif` for animations longer than 4 s.**
  File explodes past 10 MB.
  **Fix:** refuse with the budget message; suggest `.mp4`.
- **Deleting the raw `.webm` after cropping.**
  Loses the audit trail and prevents re-cropping.
  **Fix:** keep both files; the slug directory holds them together.
