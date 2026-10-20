---
name: youtube-transcript
description: >
  Fetches a YouTube video's transcript as plain text (optional [mm:ss] timestamps) with a stdlib-only Python script that works from cloud IPs where yt-dlp and youtube-transcript-api are blocked.
  Use before summarising or quoting a video; triggers on a youtube.com / youtu.be link plus "transcript", "summarise this video", or "/youtube-transcript".
disable-model-invocation: false
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - youtube
    - transcript
    - captions
    - research
---

# YouTube Transcript

Gets a YouTube video's captions as text in one command.
Why the script takes this route, and what fails instead: [`references/why-innertube.md`](./references/why-innertube.md).

## Procedure

1. Run the script with the URL or the 11-character video id:

   ```bash
   python3 -I <skill_dir>/scripts/yt_transcript.py "<url-or-id>" > transcript.txt
   ```

   - `--lang <code>` picks the caption language (default `en`).
     It prefers a human-made track and falls back to an auto-generated (`asr`) one, then to any track.
   - `--timestamps` emits one `[mm:ss] text` line per caption instead of one paragraph.
   - stderr carries `# <title> [<lang>, <manual|asr>]`; stdout carries only the transcript.
2. Read `transcript.txt` from disk.
   Never paste a long transcript back to the user verbatim: summarise or quote short passages.
3. Tell the user when the track is `asr`: auto-captions mishear names and jargon, so quote them with that caveat.

```bash
# ✓ Right — one call, output to a file
python3 -I scripts/yt_transcript.py "https://youtu.be/J9NQTYUP6k0" --timestamps > transcript.txt

# ✗ Wrong — these are bot-blocked from cloud IPs; do not try them first
pip install youtube-transcript-api && youtube_transcript_api J9NQTYUP6k0
yt-dlp --write-auto-subs --skip-download "https://youtu.be/J9NQTYUP6k0"
```

## When it fails

| Exit message contains | Do this |
| --- | --- |
| `LOGIN_REQUIRED` / `not a bot` on both clients | Bump `clientVersion` and the matching `User-Agent` for `ANDROID` and `IOS` in `CLIENTS` to the current app versions, then retry once |
| `HTTP 429` | Wait a minute and retry once; the IP is rate-limited |
| any other `HTTP <code>` or `network error` | Retry once; if it repeats, the host is unreachable from this session — report it verbatim |
| `unreadable caption track` or `unexpected response` | Retry once; if it repeats, YouTube is serving a block page to this IP — treat it as unobtainable (below). The video may still have captions, so never say it has none |
| `UNPLAYABLE` / `ERROR` with a reason | The video is private, removed, or age/region-restricted; report the reason to the user |
| `no captions` | The video has no caption tracks; say so — do not invent content |

If it still fails, tell the user the transcript is unobtainable from this IP.
Offer three ways forward: run the script on a residential IP (a local machine), set a proxy, or paste the transcript from YouTube's "Show transcript" panel.
The video title is always available without a block from `https://www.youtube.com/oembed?url=<url>&format=json`.
