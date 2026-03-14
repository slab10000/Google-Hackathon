# Google Hackathon

## VibeCut

VibeCut is an AI-native video editor built during this project. The app focuses on editing video by meaning instead of only by raw timeline manipulation: it transcribes uploaded clips, generates semantic embeddings, lets you search spoken content, and can apply natural-language edit commands to the current sequence.

The working application lives in [`vibecut/`](./vibecut).

## What The Project Does

- Import one or more video clips into a media bin.
- Transcribe each clip on the server with Gemini after extracting audio with `ffmpeg`.
- Generate embeddings for transcript segments so clips can be searched semantically.
- Build a sequence by dragging processed clips into a timeline.
- Remove transcript-selected spoken sections from the sequence.
- Run natural-language edit commands such as removing ranges, keeping only selected ranges, reordering clips, or inserting AI-generated still images.
- Preview either the source clip or the assembled sequence in a source/program style monitor.

## Current Status

As checked on **March 14, 2026**, the repository is in active development and partially mid-refactor.

- The main editor UI, semantic search flow, transcription route, embedding route, edit-command route, and image-generation route are implemented.
- The data model has already been expanded to support word-level transcript timing and detected pause ranges.
- `npm run lint` passes inside `vibecut/`.
- `npm run build` and `npx tsc --noEmit` currently fail because the UI still expects the older transcript return shape in a few places.

Current TypeScript/build drift:

- [`vibecut/src/app/api/transcribe/route.ts`](./vibecut/src/app/api/transcribe/route.ts) has an implicit `any` in a filter callback.
- [`vibecut/src/components/Editor.tsx`](./vibecut/src/components/Editor.tsx) still treats `transcribe(...)` as returning a plain segment array, while [`vibecut/src/hooks/useTranscript.ts`](./vibecut/src/hooks/useTranscript.ts) now returns `{ segments, pauses }`.
- New `LibraryClip` fields such as `pauseRanges` and new `TranscriptSegment.words` requirements are not fully threaded through the editor yet.

## Tech Stack

- Next.js 16.1.6
- React 19.2.3
- TypeScript 5
- Tailwind CSS 4
- Google GenAI SDK (`@google/genai`)
- `ffmpeg` on the server for audio extraction and silence detection
- `@ffmpeg/ffmpeg` and `@ffmpeg/core` for browser-side wasm support
- `uuid` for clip, segment, word, and range identifiers

## AI Models Configured

The app currently uses Gemini models defined in [`vibecut/src/lib/gemini.ts`](./vibecut/src/lib/gemini.ts):

- Reasoning: `gemini-3.1-pro-preview`
- Embeddings: `gemini-embedding-2-preview`
- Image generation: `gemini-3.1-flash-image-preview`

The only required environment variable right now is:

```bash
GEMINI_API_KEY=your_key_here
```

See [`vibecut/.env.example`](./vibecut/.env.example).

## Local Development

### Prerequisites

- Node.js 20+
- npm
- System `ffmpeg` available on your `PATH`
- A valid Google Gemini API key

### Setup

```bash
cd vibecut
npm install
cp .env.example .env.local
```

Then add your Gemini key to `.env.local`:

```bash
GEMINI_API_KEY=your_key_here
```

### Run The App

```bash
cd vibecut
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available Scripts

Run these from [`vibecut/`](./vibecut):

- `npm run dev`: starts the Next.js development server with webpack.
- `npm run build`: creates a production build.
- `npm run start`: starts the production server.
- `npm run lint`: runs ESLint.
- `npm run sync:ffmpeg`: copies `ffmpeg-core.js` and `ffmpeg-core.wasm` into `public/ffmpeg`.

`postinstall` automatically runs `sync:ffmpeg`.

## Repository Layout

```text
Google-Hackathon/
├── README.md
└── vibecut/
    ├── next.config.ts
    ├── package.json
    ├── public/ffmpeg/
    └── src/
        ├── app/
        │   ├── api/
        │   ├── globals.css
        │   ├── layout.tsx
        │   └── page.tsx
        ├── components/
        ├── hooks/
        ├── lib/
        └── types/
```

## Key Source Files

- [`vibecut/src/app/page.tsx`](./vibecut/src/app/page.tsx): app entry point, renders the editor.
- [`vibecut/src/components/Editor.tsx`](./vibecut/src/components/Editor.tsx): main client-side orchestrator for clip state, preview state, search, transcript selection, and AI editing.
- [`vibecut/src/components/MediaBin.tsx`](./vibecut/src/components/MediaBin.tsx): clip import UI, semantic search box, library list.
- [`vibecut/src/components/Timeline.tsx`](./vibecut/src/components/Timeline.tsx): sequence timeline with scrubbing, trim, split, drag-reorder, and drag-drop clip insertion.
- [`vibecut/src/components/TranscriptPanel.tsx`](./vibecut/src/components/TranscriptPanel.tsx): transcript display, search highlighting, and transcript-range removal from the sequence.
- [`vibecut/src/lib/timeline.ts`](./vibecut/src/lib/timeline.ts): reducer that mutates the sequence model.
- [`vibecut/src/hooks/useTranscript.ts`](./vibecut/src/hooks/useTranscript.ts): client wrapper for transcription and embedding APIs.

## How The App Works

### 1. Import and Preparation

When a user imports videos, the editor:

- Creates object URLs for local preview.
- Reads video metadata to estimate duration.
- Adds clips to the media bin in a `queued` state.
- Starts background processing for each clip.

### 2. Server-Side Transcription

The transcription route in [`vibecut/src/app/api/transcribe/route.ts`](./vibecut/src/app/api/transcribe/route.ts):

- Accepts multipart video uploads or raw audio payloads.
- Uses system `ffmpeg` to extract mono 16 kHz MP3 audio from uploaded video.
- Sends the audio to Gemini and asks for timestamped transcript segments.
- Normalizes transcript segments and word-level timing.
- Detects silence regions with `ffmpeg` `silencedetect`.
- Returns both `segments` and `pauses`.

### 3. Embeddings and Semantic Search

The embedding/search flow is split across:

- [`vibecut/src/app/api/embeddings/route.ts`](./vibecut/src/app/api/embeddings/route.ts)
- [`vibecut/src/app/api/search/route.ts`](./vibecut/src/app/api/search/route.ts)
- [`vibecut/src/lib/embeddings.ts`](./vibecut/src/lib/embeddings.ts)

Document embeddings are generated for transcript segments, query embeddings are generated for the search term, and final ranking is computed client-side with cosine similarity.

### 4. Sequence Editing

The timeline state is stored as a list of `TimelineClip` items. Supported reducer operations include:

- `ADD_SOURCE_CLIP`
- `REMOVE_SEGMENTS`
- `REMOVE_RANGES`
- `INSERT_IMAGE`
- `SPLIT_CLIP`
- `TRIM_CLIP`
- `DELETE_CLIP`
- `REORDER_CLIP`
- `APPLY_EDIT`
- `SET_CLIPS`

The reducer is implemented in [`vibecut/src/lib/timeline.ts`](./vibecut/src/lib/timeline.ts).

### 5. Natural-Language Edit Commands

The edit-command route in [`vibecut/src/app/api/edit-command/route.ts`](./vibecut/src/app/api/edit-command/route.ts) converts user instructions into structured operations. It currently supports:

- `remove_time_range`
- `keep_only_ranges`
- `insert_image`
- `reorder`

The editor then applies those operations to the local timeline state.

### 6. AI Image Generation

The image-generation route in [`vibecut/src/app/api/generate-image/route.ts`](./vibecut/src/app/api/generate-image/route.ts) sends prompts to Gemini image generation and returns base64 image data so the editor can insert generated stills into the sequence.

## API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/transcribe` | `POST` | Extracts audio, transcribes speech, normalizes word timing, and detects pauses |
| `/api/embeddings` | `POST` | Generates embedding vectors for transcript segment text |
| `/api/search` | `POST` | Generates the embedding vector for a semantic search query |
| `/api/edit-command` | `POST` | Converts natural-language edit requests into structured timeline operations |
| `/api/generate-image` | `POST` | Generates an image from a prompt and returns base64 data |

## Data Model

Important types are defined in [`vibecut/src/types/index.ts`](./vibecut/src/types/index.ts):

- `LibraryClip`: uploaded source media and processing state
- `TranscriptSegment`: transcript segment with timing, text, words, and optional embedding
- `TranscriptWord`: word-level timing metadata
- `PauseRange`: silence range metadata detected from audio
- `TimelineClip`: sequence item, either video or generated image
- `TimelineState`: complete sequence state
- `EditCommandResponse`: structured AI output for timeline edits

## Browser FFmpeg Notes

The project includes browser-side ffmpeg wasm assets in `public/ffmpeg`. The Next.js config in [`vibecut/next.config.ts`](./vibecut/next.config.ts) sets:

- `Cross-Origin-Embedder-Policy: credentialless`
- `Cross-Origin-Opener-Policy: same-origin`

Those headers are needed for the browser ffmpeg wasm setup.

## Components And Code That Exist But Are Not Fully Wired Into The Main Flow

These files are present but are not the center of the active editor path today:

- [`vibecut/src/components/ExportButton.tsx`](./vibecut/src/components/ExportButton.tsx)
- [`vibecut/src/components/VideoUpload.tsx`](./vibecut/src/components/VideoUpload.tsx)
- [`vibecut/src/hooks/useFFmpeg.ts`](./vibecut/src/hooks/useFFmpeg.ts)
- [`vibecut/src/hooks/useVideoPlayer.ts`](./vibecut/src/hooks/useVideoPlayer.ts)

They may represent earlier or future directions for the app.

## Known Gaps

- The README now reflects the real app architecture, but the codebase still needs the current transcript/pause refactor to be completed.
- Production builds are not green yet because of the TypeScript mismatches described above.
- The semantic search ranking happens client-side after the query embedding is returned from the server.
- Export exists as a component but is not currently integrated into the main editor shell.

## Summary

This project is a semantic video editor prototype with a strong foundation:

- transcript-aware editing
- semantic search over spoken content
- natural-language timeline editing
- AI-generated still insertion
- source/program style preview and timeline editing

The main work left is bringing the newer transcript model fully through the editor so the codebase is build-clean again.
