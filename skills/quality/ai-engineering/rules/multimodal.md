---
title: Multimodal — Vision, Audio, PDFs
impact: HIGH
tags:
  - multimodal
  - vision
  - audio
  - pdf
  - tokens
---

# Multimodal

Rules for prompts that take images, audio, or documents as input.
The text-side rules in `prompt-writing.md` and `system-prompt-design.md`
still apply — these are the modality-specific additions.

## Contents

- Image inputs: token cost, sizing, vision vs OCR
- Vision prompting (where to put the image, how to refer to it)
- Audio inputs: transcription, voice agents, latency budgets
- PDFs and documents: native PDF support vs text extraction
- Caching invariants under multimodal
- Common mistakes

## Image inputs

### Token cost

Images are billed in tokens, computed from pixel dimensions.
Approximate (Q1 2026, primary providers):

| Provider  | Formula                                                                  |
| --------- | ------------------------------------------------------------------------ |
| Anthropic | `(width × height) / 750` tokens (each image; capped at ~1.6k tokens).    |
| OpenAI    | Tile-based: 85 tokens for low-res; 170 tokens per 512×512 tile for high-res. |
| Google    | Per-image token cost depending on resolution; see Gemini docs.            |

**Always check the current provider docs** — formulas change.
At runtime, use the provider's token-counter API rather than approximating.

### Resize before sending

Most prompts do **not** need full-resolution images.
Resize aggressively before upload:

| Use case                                | Recommended longest edge   |
| --------------------------------------- | -------------------------- |
| UI screenshots, document pages          | 1568 px                    |
| Object detection, diagrams              | 1024 px                    |
| Avatar / thumbnail classification       | 512 px                     |
| Pure layout / colour analysis           | 256 px                     |

Anthropic's vision quality plateaus around 1568 px on the longest edge;
larger inputs cost more without measurable accuracy gains.
Source: [Anthropic — Vision](https://platform.claude.com/docs/en/build-with-claude/vision).

### Vision vs OCR

| Input type                         | Use                                                |
| ---------------------------------- | -------------------------------------------------- |
| Screenshots, photos with mixed UI  | Native vision.                                     |
| Scanned PDFs with dense text       | OCR first (Tesseract, AWS Textract), then send text. |
| Tables, forms                      | Native vision usually wins; benchmark both.         |
| Handwriting                        | Native vision (modern models > Tesseract).         |

OCR-then-text is **cheaper** by 5–20× when the document is text-heavy
and the model only needs the text content.
Native vision wins when layout, colour, or non-text content carries
meaning.

### Vision prompting

Place the image **before** the question that references it:

```xml
<image>data:image/png;base64,...</image>
<question>Identify every form field that is missing a label.</question>
```

Refer to images explicitly when there is more than one:

```xml
<image_1>...</image_1>
<image_2>...</image_2>

Compare the layout in <image_1> with the redesign in <image_2>.
List every visual change.
```

Vague references ("the image") work poorly when the prompt has
multiple images.

## Audio inputs

### Transcription pipelines

For "user uploads voice → app processes":

1. Transcribe with **Whisper-large-v3** (open) or provider transcription
   API (OpenAI Audio, Google Speech-to-Text).
2. Pass the transcript to the LLM as text.
3. Keep the original audio file path/ID for re-listening on debug.

Latency budget for synchronous flows:

| Step                | Typical                          |
| ------------------- | -------------------------------- |
| Whisper-large-v3    | 0.1–0.3× real-time on GPU; CPU is much slower. |
| Provider transcription API | ~1–3s for a 30s clip.            |
| LLM call            | Streaming starts ~500ms.         |

Don't transcribe a 5-minute clip in the request path; chunk it or
process async.

### Voice agents (real-time)

For interactive voice agents (OpenAI Realtime API, Anthropic real-time
endpoints, vendor stacks like LiveKit + Deepgram):

| Concern                           | Default                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| Voice activity detection (VAD)    | Server-side VAD with 200–500 ms silence threshold.            |
| Interruption handling             | Cancel in-flight model output when the user starts speaking. |
| End-of-turn detection             | VAD + semantic stop ("ok", "go ahead").                       |
| Latency target                    | ≤ 800 ms total turnaround (audio → response → audio).         |

Voice agents amplify every other rule in this skill — caching,
streaming, model routing — because the latency budget is much tighter
than chat.

## PDFs and documents

### Native PDF support

Both Anthropic and OpenAI accept PDFs as inputs directly (Q1 2026):

- **Anthropic Files API + `document` block** — PDF, DOCX, plain text;
  100MB / 100 pages per file.
- **OpenAI Files + Assistants/Responses APIs** — similar limits.

Native ingest extracts text **and** runs vision over each page.
That's the right call when:

- Layout matters (tables, forms, diagrams).
- The document mixes text and images.
- You don't already have a custom chunker.

### Custom chunking — when to do it instead

If you have many documents and need search/RAG over them, **don't**
upload to native PDF on every query.
Use the RAG pipeline:

1. Extract text + images during ingest (PyMuPDF, pdfplumber, AWS
   Textract).
2. Chunk per `rag.md` rules (recursive 512, 20–30% overlap).
3. Index with hybrid search.
4. Pass top-K chunks to the model.

Native PDF is for **one-off, deep-read** tasks (summarise this paper,
fill in this form).
RAG is for **search across a corpus**.

### Layout-aware chunking

For PDFs where layout carries meaning (legal contracts, financial
statements, scientific papers):

- Keep tables intact in a single chunk.
- Preserve heading hierarchy in chunk metadata.
- Carry page numbers + source filename in metadata for citation.

PyMuPDF's structured extraction (`get_text("dict")`) preserves layout
better than naive `pdf.extract_text()`.

## Caching invariants under multimodal

From `token-optimization.md`: toggling images on or off in any message
**invalidates the cached prefix from system onward.**

Implications:

- Don't conditionally include images.
  Either every request in a session has them, or none does.
- For chat sessions where some turns have images and some don't, accept
  reduced cache hits — it's cheaper than restructuring.
- For batch eval, group items with images together and items without
  separately so each group caches its own prefix.

## Common mistakes

- **Sending full-resolution screenshots.**
  **Fix:** resize to ≤ 1568 px longest edge before upload.
- **Native vision on text-heavy scanned PDFs.**
  **Fix:** OCR first; pass text. 5–20× cheaper.
- **Vague image references in multi-image prompts.**
  **Fix:** number them (`<image_1>`, `<image_2>`); refer by number.
- **Whisper-on-the-request-path for long clips.**
  **Fix:** chunk or process async; keep the request path under 3s.
- **Native PDF upload on every RAG query.**
  **Fix:** ingest once, chunk, index; native PDF is for one-off deep reads.
- **Mixing image-and-text-only requests in the same cache scope.**
  **Fix:** group; toggling images flushes the cache.
- **Treating tables as flowing text in chunking.**
  **Fix:** keep tables intact; use layout-aware extraction.
