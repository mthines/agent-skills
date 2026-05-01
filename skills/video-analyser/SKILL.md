---
name: video-analyser
description: >
  Analyse a video file — primarily a screen recording of a bug — to extract errors,
  UI state, and reproduction steps. Resolves input from a Linear ticket URL, a local
  file path, or a direct video URL. Extracts keyframes with ffmpeg, runs optional
  Tesseract OCR and Whisper audio transcription, then delivers structured findings.
  Trigger phrases: "analyse this video", "analyze this recording", "what does this
  video show", "extract bugs from this recording", "analyse this screen recording",
  "investigate this mp4", "investigate this mov", "analyse this clip",
  "look at this screen capture", "what is happening in this video",
  "analyse this screen capture", "video-analyser", "/video-analyser".
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: analysis
  tags:
    - video
    - screen-recording
    - bug-analysis
    - ffmpeg
    - ocr
    - vision
    - frame-extraction
---

# Video Analyser Skill

Analyse a video file to extract bugs, errors, UI state, and reproduction steps.
The pipeline uses `ffmpeg` for frame extraction, optional `tesseract` OCR for text, and optional `whisper` for audio narration.
The default path (8 keyframes at 768 px) is the Pareto-optimal setting for screen recordings: best quality-per-token on the legibility curve.

## Prerequisites

### Required tools

| Tool | Check | If missing |
|---|---|---|
| `ffmpeg` | `which ffmpeg` | Print: `ffmpeg is required. Install with: brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux). Then exit. |
| `ffprobe` | `which ffprobe` | Print: `ffprobe is required. It ships with ffmpeg — reinstall ffmpeg`. Then exit. |

### Optional tools (silent degradation)

| Tool | If present | If absent |
|---|---|---|
| `tesseract` | Enable OCR mode for text-heavy frames | Skip silently; use vision-only mode |
| `whisper` | Enable audio transcription when user mentions narration or voiceover | Skip audio step silently |

Run tool detection before any other step.

```bash
which ffmpeg  || { echo "ffmpeg is required. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)."; exit 1; }
which ffprobe || { echo "ffprobe is required. It ships with ffmpeg — reinstall ffmpeg."; exit 1; }
OCR_ENABLED=false; which tesseract >/dev/null 2>&1 && OCR_ENABLED=true
AUDIO_ENABLED=false
```

### Minimum ffmpeg version

Require ffmpeg 4 or later.
The `select='eq(pict_type\,I)'` filter and `-vsync vfr` were introduced in ffmpeg 4.
Document this requirement in the bail message if detection fails.

## Temp Directory

Declare the temp directory and cleanup trap at the very start of execution, before source resolution.
This ensures downloaded files, extracted frames, and audio are always removed, even on error.

```bash
WORK_DIR=$(mktemp -d /tmp/video-analyser-XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT
```

Use `$WORK_DIR` as the staging area for all intermediate files throughout the pipeline.

## Step 1 — Source Resolution

Resolve the user's input to a local file path before running anything else.
Walk this table top-to-bottom; the first matching rule wins.

| Input shape | Detection rule | Resolution steps |
|---|---|---|
| Linear ticket URL | Input matches `linear\.app/.+/issue/` | Follow the [Linear resolution procedure](#linear-ticket-url) below. |
| Local file path | Input starts with `/`, `./`, `~/`, or `~` | Follow the [local path procedure](#local-file-path) below. |
| Direct video URL | Input matches `^https?://` and does not match `linear\.app` | Download: `curl -fL -o "$WORK_DIR/input.mp4" "$INPUT"`. Use `$WORK_DIR/input.mp4` as `VIDEO_PATH`. |
| Bare filename | Input contains no `/` and no `http` | Prepend `$PWD/`; then follow the local path procedure. |
| Unresolvable | None of the above match | Print: `Cannot resolve input to a video file. Provide a Linear ticket URL, a local file path, or a direct URL to a video file.` Then exit. |

### Linear ticket URL

1. Check Linear MCP availability.

```bash
if ! mcp list 2>/dev/null | grep -q linear; then
  echo "Linear MCP is not configured. Download the video from the ticket and re-invoke with a local file path."
  exit 1
fi
```

Do not attempt to scrape the Linear web UI as a fallback.

2. Extract the issue ID from the URL (e.g., `XYZ-123` from `https://linear.app/team/issue/XYZ-123`).
3. Call Linear MCP `get_issue` with the issue ID.
4. Scan the `description` field and all `comments` for attachment URLs matching `\.(mp4|mov|webm|avi)` (case-insensitive).
5. If no video attachment is found, print: `No video attachment found in Linear issue <ID>. Attach a .mp4, .mov, .webm, or .avi file to the issue and retry.` Then exit.
6. Download the first matching attachment.

```bash
curl -fL -o "$WORK_DIR/input.mp4" "$ATTACHMENT_URL"
VIDEO_PATH="$WORK_DIR/input.mp4"
```

### Local file path

1. Expand `~` to the home directory.

```bash
VIDEO_PATH="${INPUT/#\~/$HOME}"
```

2. Confirm the file exists.

```bash
test -f "$VIDEO_PATH" || { echo "File not found: $VIDEO_PATH"; exit 1; }
```

3. Check the file extension.
   If the extension is not `.mp4`, `.mov`, `.webm`, or `.avi`, print a warning but continue.

```bash
case "${VIDEO_PATH##*.}" in
  mp4|mov|webm|avi) ;;
  *) echo "Warning: unrecognised extension '${VIDEO_PATH##*.}'. Continuing anyway." ;;
esac
```

## Step 2 — Video Probe

Run `ffprobe` to extract metadata before any frame work.

```bash
PROBE=$(ffprobe -v quiet -print_format json -show_streams -show_format "$VIDEO_PATH")
DURATION_S=$(echo "$PROBE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(float(d['format']['duration']))")
WIDTH=$(echo "$PROBE" | python3 -c "import sys,json; d=json.load(sys.stdin); v=[s for s in d['streams'] if s.get('codec_type')=='video'][0]; print(v['width'])")
HEIGHT=$(echo "$PROBE" | python3 -c "import sys,json; d=json.load(sys.stdin); v=[s for s in d['streams'] if s.get('codec_type')=='video'][0]; print(v['height'])")
HAS_AUDIO=$(echo "$PROBE" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if any(s.get('codec_type')=='audio' for s in d['streams']) else 'false')")
```

## Step 3 — Bail Gates

Check these conditions in order before proceeding.
Stop immediately when a gate triggers.

| Condition | Action |
|---|---|
| `DURATION_S > 600` | Print the trim command below, then exit. |
| `DURATION_S < 1` | Print: `Video is less than 1 second — too short to analyse.` Then exit. |
| `WIDTH < 100` | Print a warning; continue (unusual resolution but allow). |

Trim command to print when duration exceeds 600 s:

```
Video is longer than 10 minutes (${DURATION_S}s). Trim it first:
  ffmpeg -i "$VIDEO_PATH" -ss 0 -t 600 -c copy "$WORK_DIR/trimmed.mp4"
Re-invoke with: $WORK_DIR/trimmed.mp4
```

## Step 4 — Determine Frame Count (N)

Use this table to select N.
Apply the first matching row.

| Video duration | User intent signal | N frames | Note |
|---|---|---|---|
| 0–600 s | None (default) | 8 | Pareto-optimal default |
| 0–600 s | Contains "fine-grained", "detailed", or "every frame" | 16 | Escalation |
| 181–600 s | "fine-grained" + explicit opt-in after cost warning | 24 | Show cost warning first |
| > 600 s | Any | — | Bail at Step 3 |

**Cost warning for 24-frame opt-in.**
Before proceeding to N=24, print:

```
Note: 24 frames at 768 px ≈ 18,864 tokens ≈ $0.057 on Sonnet 4.6.
Proceed? (yes/no)
```

Wait for explicit confirmation.
If the user does not confirm, fall back to N=16.

## Step 5 — Extract Frames

Use the keyframe-first strategy.
I-frames in screen recordings mark scene transitions (page loads, error dialogs, modal appearances) and carry the most diagnostic signal.

### Step 5a — Keyframe extraction

```bash
ffmpeg -i "$VIDEO_PATH" \
  -vf "select='eq(pict_type\,I)',scale=768:-2" \
  -vsync vfr -q:v 2 \
  "$WORK_DIR/frame_%04d.jpg" -y 2>/dev/null
IFRAME_COUNT=$(ls "$WORK_DIR"/frame_*.jpg 2>/dev/null | wc -l)
```

If `$VIDEO_PATH` is a `.webm` file and `IFRAME_COUNT` is 0, the container may not expose keyframe metadata.
Fall back immediately to uniform sampling (Step 5b) with `IFRAME_COUNT=0`.

### Step 5b — Uniform fill (when keyframes are sparse)

| Condition | Action |
|---|---|
| `IFRAME_COUNT >= N` | Use the first N keyframes; skip Step 5b. |
| `IFRAME_COUNT < N` | Run uniform extraction; merge with keyframes. |
| `IFRAME_COUNT == 0` | Run uniform extraction only. |

Uniform extraction command:

```bash
FILL_NEEDED=$((N - IFRAME_COUNT))
FPS=$(echo "scale=4; $FILL_NEEDED / $DURATION_S" | bc)
ffmpeg -i "$VIDEO_PATH" \
  -vf "fps=${FPS},scale=768:-2" \
  -q:v 2 \
  "$WORK_DIR/uniform_%04d.jpg" -y 2>/dev/null
```

### Step 5c — Select final N frames

1. List all keyframes first (`frame_*.jpg`), sorted by name.
2. Append uniform frames (`uniform_*.jpg`), sorted by name.
3. Keep the first N entries.
4. Copy selected frames to `$WORK_DIR/selected_%04d.jpg`.

If fewer than N total frames were extracted, proceed with however many were extracted.
Do not bail on a low frame count.

### Scaling note

If `scale=768:-2` produces an error (odd-dimension video), use `scale=768:trunc(ow/a/2)*2` instead.

## Step 6 — OCR (conditional)

Run OCR when ALL of the following are true:
- `OCR_ENABLED=true` (tesseract is present).
- The user's goal is text or error extraction (default — skip only if user explicitly requests visual-only analysis).

For each selected frame:

```bash
for FRAME in "$WORK_DIR"/selected_*.jpg; do
  FRAME_ID=$(basename "$FRAME" .jpg)
  tesseract "$FRAME" "$WORK_DIR/ocr_${FRAME_ID}" -l eng 2>/dev/null
done
```

Store OCR output in `$WORK_DIR/ocr_selected_*.txt`.
Pass OCR text to the analysis prompt as `<ocr_frame_N>TEXT</ocr_frame_N>` blocks, one per frame.
OCR text is cheaper context than asking vision to re-read the same text.

**Non-English UI text.**
The default language is `-l eng`.
If the user specifies a language (e.g., "the UI is in German"), substitute `-l <lang>` (e.g., `-l deu`).
Tesseract language codes follow ISO 639-3.

## Step 7 — Audio Transcription (conditional)

Run audio transcription when ALL of the following are true:
- `whisper` is available on `$PATH`.
- `HAS_AUDIO=true` (the video has an audio stream).
- The user's message contains "narration", "voiceover", "audio", or "they said".

Extract audio and transcribe:

```bash
ffmpeg -i "$VIDEO_PATH" -vn -acodec pcm_s16le -ar 16000 "$WORK_DIR/audio.wav" -y 2>/dev/null
whisper "$WORK_DIR/audio.wav" --model small --output_format txt --output_dir "$WORK_DIR" 2>/dev/null
```

Append the transcript to the analysis prompt as `<audio_transcript>TEXT</audio_transcript>`.

## Step 8 — Assemble Analysis Prompt

Use the cheapest delivery mechanism for the chosen frame count.
For N ≤ 16, inline base64 is typically cheapest; for N > 16, prefer the Files API if the runtime supports it.
The executor decides at runtime.

Construct the prompt as follows:

```
System:
  You are analysing a screen recording of a software application.
  Your goal: <USER_GOAL> (default: "identify bugs, errors, UI state issues, and reproduction steps").
  You will receive <N> frames extracted from the recording.
  Cross-reference OCR text blocks with what you see in each frame.
  Do not hallucinate text — if OCR and vision disagree, note both.

For each frame (in order):
  [image content block — JPEG]
  [if OCR enabled: <ocr_frame_N>OCR TEXT HERE</ocr_frame_N>]

[if audio transcription enabled:]
  <audio_transcript>TRANSCRIPT TEXT HERE</audio_transcript>

Request:
  Return findings in the structured format specified in Step 9.
```

## Step 9 — Deliver Structured Output

Return findings in this exact schema.
Do not omit sections; use "None detected" for sections with no findings.

```markdown
## Video Analysis

### Recording summary
- Duration: <X> seconds
- Resolution: <W>×<H>
- Frames analysed: <N> (<method: keyframe | uniform | hybrid>)
- OCR: <enabled | disabled>
- Audio transcription: <enabled | disabled>

### Findings

#### Errors and exceptions
<List each error message, stack trace fragment, or exception found. Quote exact text where available.>

#### UI state at key moments
<For each significant frame transition, describe what the UI shows and what changed.>

#### Reproduction steps inferred
<Numbered list of steps to reproduce the observed behaviour.>

#### Recommended next steps
<Concrete actions the developer should take — e.g., "Check the network tab at frame 4", "Add error boundary at component X".>
```

## Token Budget

The default setting (8 frames, 768 px) is the Pareto-optimal point on the quality-vs-token curve for screen recordings.

768 px is the curve knee for screen-recording legibility.
UI text (error messages, stack traces, console output) is fully legible at 768 px.
Going lower (512 px) risks misreading small-font terminal output.
Going higher (1568 px) roughly doubles token cost with no meaningful legibility gain for screen content.

8 frames is the sweet spot for recordings under 3 min.
I-frame sampling captures the scene transitions that carry the diagnostic signal.
Beyond ~10 frames, incremental frames are typically near-duplicates that add tokens without adding context.

| Frames | Resolution | Tokens/frame | Total image tokens | Cost (Sonnet 4.6, $3/M) | Use when |
|---|---|---|---|---|---|
| 8 (default) | 768 px | ~786 | ~6,288 | ~$0.019 | Standard bug recording; Pareto-optimal default |
| 16 (escalation) | 768 px | ~786 | ~12,576 | ~$0.038 | User says "fine-grained" or "detailed" |
| 24 (long clip opt-in) | 768 px | ~786 | ~18,864 | ~$0.057 | Clip 181–600 s + user explicitly opts in after cost warning |
| 8 | 1568 px (cap) | ~1,568 | ~12,544 | ~$0.038 | Only if user reports text still unreadable at 768 px |

For clips longer than 10 min (after the user trims), or for frame counts > 24, consider Gemini's native video API as an escalation path.
Gemini charges per-second rather than per-frame and handles long clips natively.

## Sampling Method Reference

| Condition | Method |
|---|---|
| I-frame count ≥ N | Keyframe extraction only |
| I-frame count > 0 and < N | Hybrid: I-frames + uniform fill |
| I-frame count = 0 (e.g., some .webm) | Uniform time-based sampling only |

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `select='eq(pict_type\,I)'` rejected on ffmpeg < 4 | Low | Document minimum version (ffmpeg 4+); bail with version check if needed. |
| `scale=768:-2` fails on odd-dimension video | Low | Substitute `scale=768:trunc(ow/a/2)*2`; documented in Step 5. |
| Tesseract produces garbage on non-English UI text | Medium | Default is `-l eng`; user can override with a language code. |
| Very short clips (< 1 s) yield 0 frames | Low | Bail gate in Step 3. |
| Claude vision hallucinates text not in frames | Low | Cross-reference OCR output when available; note disagreements. |
| Linear attachment URL requires authenticated download | Medium | Use the Linear MCP tool to obtain a pre-signed URL rather than a raw `curl`. |
