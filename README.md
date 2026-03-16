# Google Hackathon

## VibeCut

VibeCut is an AI-native video editor built in this project. The app mixes timeline editing with semantic understanding, transcription-aware cuts, generative media, cinematic text treatments, and AI-assisted transitions.

The working application lives in [`vibecut/`](./vibecut).

## What The Project Does

- Imports video clips into a media bin and processes them in the background.
- Transcribes speech with timestamps, word-level timing, and detected pause ranges.
- Generates embeddings so spoken content can be searched semantically.
- Lets you cut by words, remove pauses, trim clips, split clips, reorder clips, and insert still images.
- Accepts natural-language edit commands for sequence changes.
- Generates AI still images and AI video clips that can be added back into the library.
- Generates cinematic text overlays and AI intro-style text videos from the current frame.
- Generates AI “vibe transitions” between clips.
- Provides source/program monitoring with a resizable editor layout.

## Current Status

As checked on **March 15, 2026**, the repository is active and usable, but still not fully polished.

- `npm run build` in [`vibecut/`](./vibecut) currently succeeds.
- The main editor, semantic search flow, transcription pipeline, AI media generation, font tools, and transition generation are implemented.
- `npm run lint` currently fails.

Current lint drift:

- Generated `.vercel` output is being linted and creates a large amount of noise.
- There are source-level lint errors in newer cinematic text and AI media files, including [`vibecut/src/components/TextEditorBar.tsx`](./vibecut/src/components/TextEditorBar.tsx), [`vibecut/src/components/VibeFontPanel.tsx`](./vibecut/src/components/VibeFontPanel.tsx), [`vibecut/src/components/VibeTransitionPanel.tsx`](./vibecut/src/components/VibeTransitionPanel.tsx), and [`vibecut/src/lib/ai-media.ts`](./vibecut/src/lib/ai-media.ts).

## Tech Stack

- Next.js 16.1.6
- React 19.2.3
- TypeScript 5
- Tailwind CSS 4
- Google GenAI SDK (`@google/genai`)
- System `ffmpeg` on the server for audio extraction and silence detection
- `@ffmpeg/ffmpeg` and `@ffmpeg/core` for browser-side wasm work
- `uuid` for generated identifiers

## AI Models Configured

The app currently uses models defined in [`vibecut/src/lib/gemini.ts`](./vibecut/src/lib/gemini.ts):

- Reasoning: `gemini-3.1-pro-preview`
- Embeddings: `gemini-embedding-2-preview`
- Image generation: `gemini-3.1-flash-image-preview`
- Video generation: `veo-3.1-fast-generate-preview`

The required environment variable is:

```bash
GEMINI_API_KEY=your_key_here
```

See [`vibecut/.env.example`](./vibecut/.env.example).

## Local Development

### Prerequisites

- Node.js 20+
- npm
- System `ffmpeg` available on your `PATH`
- A valid Gemini API key

### Setup

```bash
cd vibecut
npm install
cp .env.example .env.local
```

Then add your key:

```bash
GEMINI_API_KEY=your_key_here
```

### Run

```bash
cd vibecut
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available Scripts

Run these from [`vibecut/`](./vibecut):

- `npm run dev`: start the Next.js dev server
- `npm run build`: production build
- `npm run start`: run the production server
- `npm run lint`: run ESLint
- `npm run sync:ffmpeg`: copy wasm ffmpeg assets into `public/ffmpeg`

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

- [`vibecut/src/components/Editor.tsx`](./vibecut/src/components/Editor.tsx): the main client-side app shell and interaction orchestrator
- [`vibecut/src/components/MediaBin.tsx`](./vibecut/src/components/MediaBin.tsx): clip import, browsing, and semantic-search entry point
- [`vibecut/src/components/Timeline.tsx`](./vibecut/src/components/Timeline.tsx): timeline editing UI
- [`vibecut/src/components/TranscriptPanel.tsx`](./vibecut/src/components/TranscriptPanel.tsx): transcript, word selection, and pause removal UI
- [`vibecut/src/components/AssetGenPanel.tsx`](./vibecut/src/components/AssetGenPanel.tsx): AI image/video asset generation panel
- [`vibecut/src/components/VibeFontPanel.tsx`](./vibecut/src/components/VibeFontPanel.tsx): cinematic text overlay and AI intro generation
- [`vibecut/src/components/VibeTransitionPanel.tsx`](./vibecut/src/components/VibeTransitionPanel.tsx): AI transition generation UI
- [`vibecut/src/hooks/useTranscript.ts`](./vibecut/src/hooks/useTranscript.ts): client wrapper for transcription and embedding calls
- [`vibecut/src/app/api/transcribe/route.ts`](./vibecut/src/app/api/transcribe/route.ts): transcription endpoint
- [`vibecut/src/app/api/vibe-text/route.ts`](./vibecut/src/app/api/vibe-text/route.ts): multi-action route for cinematic text and transition generation
- [`vibecut/src/lib/ai-media.ts`](./vibecut/src/lib/ai-media.ts): shared generative media helpers
- [`vibecut/src/lib/timeline.ts`](./vibecut/src/lib/timeline.ts): timeline reducer

## How The App Works

### 1. Clip Import And Processing

When clips are imported, the editor:

- creates object URLs for local preview
- reads media metadata to estimate clip duration
- adds clips to the library in a queued state
- processes each clip in the background

### 2. Audio-First Transcription

The transcription flow now uses an audio-first path.

- [`vibecut/src/hooks/useTranscript.ts`](./vibecut/src/hooks/useTranscript.ts) first tries browser-side audio extraction.
- It uploads raw audio to [`/api/transcribe`](./vibecut/src/app/api/transcribe/route.ts) using `X-Audio-Filename`.
- If browser extraction fails, it can fall back to direct video upload for smaller files.
- The server extracts audio when needed, transcribes it, normalizes words, and detects pauses.

The transcription route returns:

- `segments`
- `words` inside each segment
- `pauses`

### 3. Semantic Search

Semantic search is powered by:

- [`vibecut/src/app/api/embeddings/route.ts`](./vibecut/src/app/api/embeddings/route.ts)
- [`vibecut/src/app/api/search/route.ts`](./vibecut/src/app/api/search/route.ts)
- [`vibecut/src/lib/embeddings.ts`](./vibecut/src/lib/embeddings.ts)

Transcript segment embeddings are generated for documents, query embeddings are generated for search text, and ranking is computed client-side with cosine similarity.

### 4. Timeline Editing

The editor supports:

- appending source clips to the sequence
- trimming and splitting clips
- reordering clips
- deleting clips
- inserting still images
- removing specific spoken words
- removing individual pauses or long pauses
- rebuilding the sequence from AI-suggested ranges

Timeline state is managed in [`vibecut/src/lib/timeline.ts`](./vibecut/src/lib/timeline.ts).

### 5. Natural-Language Editing

The AI edit prompt sends the current timeline and transcript context to [`/api/edit-command`](./vibecut/src/app/api/edit-command/route.ts), which returns structured operations such as:

- `remove_time_range`
- `keep_only_ranges`
- `insert_image`
- `reorder`

### 6. Generative Media

The app now includes broader generative tooling:

- [`/api/generate-image`](./vibecut/src/app/api/generate-image/route.ts): prompt-to-image generation
- [`/api/generate-video`](./vibecut/src/app/api/generate-video/route.ts): direct prompt-to-video generation
- [`/api/generate-font`](./vibecut/src/app/api/generate-font/route.ts): frame-based typography style suggestions
- [`/api/vibe-text`](./vibecut/src/app/api/vibe-text/route.ts): multi-step cinematic text and transition workflows

`/api/vibe-text` currently supports:

- `style`
- `image`
- `video`
- `transition`

### 7. Cinematic Text And Transitions

The newer creative tools include:

- AI font styling from the current frame
- custom editable text overlays
- AI-generated intro-style text videos that can be added to the library
- AI-generated transition clips based on either two captured frames or a prompt

### 8. Editor Layout

The current editor shell also includes:

- resizable left and right sidebars
- adjustable timeline height
- source/program monitor switching
- an inspector dock
- a dedicated font dock

## API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/transcribe` | `POST` | Transcribes audio/video input and returns segments, words, and pauses |
| `/api/embeddings` | `POST` | Generates embeddings for transcript text |
| `/api/search` | `POST` | Generates an embedding for a semantic search query |
| `/api/edit-command` | `POST` | Converts edit prompts into structured timeline operations |
| `/api/generate-image` | `POST` | Generates an image from a prompt |
| `/api/generate-video` | `POST` | Generates a video clip from a prompt |
| `/api/generate-font` | `POST` | Suggests typography styling from a captured frame |
| `/api/vibe-text` | `POST` | Handles cinematic text style, image, video, and transition actions |

## Data Model

Important types are defined in [`vibecut/src/types/index.ts`](./vibecut/src/types/index.ts):

- `LibraryClip`: uploaded media and processing status
- `TranscriptSegment`: segment-level transcript data
- `TranscriptWord`: word-level timing data
- `PauseRange`: detected silence/pause ranges
- `TimelineClip`: sequence item for either video or image content
- `TimelineRange`: source range used for removals
- `TimelineState`: sequence state
- `EditCommandResponse`: structured AI edit result

## Browser FFmpeg Notes

The project ships browser ffmpeg assets in `public/ffmpeg`. [`vibecut/next.config.ts`](./vibecut/next.config.ts) sets:

- `Cross-Origin-Embedder-Policy: credentialless`
- `Cross-Origin-Opener-Policy: same-origin`

Those headers support the browser wasm ffmpeg workflow.

## Components Present But Not Central To The Main Flow

These files still exist but are not the main path described above:

- [`vibecut/src/components/ExportButton.tsx`](./vibecut/src/components/ExportButton.tsx)
- [`vibecut/src/components/VideoUpload.tsx`](./vibecut/src/components/VideoUpload.tsx)
- [`vibecut/src/components/VideoMergePanel.tsx`](./vibecut/src/components/VideoMergePanel.tsx)
- [`vibecut/src/hooks/useFFmpeg.ts`](./vibecut/src/hooks/useFFmpeg.ts)
- [`vibecut/src/hooks/useVideoPlayer.ts`](./vibecut/src/hooks/useVideoPlayer.ts)

Some of these look like earlier experiments or side tools that are only partially integrated.

## Known Gaps

- Full-project lint is not clean yet.
- Generated `.vercel` output should likely be ignored by ESLint.
- Some newer AI media files still use rough edges like `any`, `@ts-ignore`, and debug logging.
- The direct prompt-to-video and cinematic text paths are more experimental than the core transcript/timeline flow.

## Summary

VibeCut is now broader than a transcript-aware video editor. It combines:

- semantic search over spoken content
- word-level and pause-level timeline edits
- natural-language edit commands
- AI still and video generation
- cinematic text overlays and intro generation
- AI transition generation

The main documentation update needed was real: the README had fallen behind the current app. It now matches the present feature set and the current build/lint status more closely.
