# YouTube AI Studio

> **🏆 First Place — DeepMind at UCLA Hackathon**
>
> We built this in a weekend and somehow pulled off a win. Watch the demo video to see it in action — fair warning, we had way too much fun with the skits.
>
> **[Watch the demo video →](YOUR_VIDEO_LINK_HERE)**

---

A hackathon demo that embeds AI-powered video editing directly into the YouTube Creator Studio upload workflow. The app reskins a full-featured timeline editor to look and feel indistinguishable from YouTube Studio, inserting an intelligent AI editing step between video upload and the standard publish flow — showing what a native AI editor inside YouTube Studio could look like.

## What It Does

- **AI-assisted editing** — Chat with Claude to cut, reorder, adjust speed/volume, add captions, and remove silences using natural language
- **Timeline editor** — Non-destructive clip-based editing with undo/redo, split/delete/reorder, color filters, fade effects, and transitions
- **Transcription** — OpenAI Whisper word-level transcription with silence detection and filler word tagging
- **Visual indexing** — Frame extraction, scene detection, and embedding-based visual search
- **In-browser export** — FFmpeg WASM renders the final video entirely in the browser (no server-side transcoding)
- **YouTube Studio UI** — Matches YouTube Creator Studio visually; post-editor stepper pages (Details → Visibility) are present as visual mockups

## Local Development

1. Copy `.env.example` to `.env.local` and fill in the required values.
2. Install dependencies:

```bash
npm ci
```

3. Apply Supabase migrations to your project.
4. Start the app:

```bash
npm run dev
```

5. Start the optional indexing worker in a second shell if you want transcription/visual search locally:

```bash
npm run worker:analysis
```

## Required Environment Variables

Web app and worker:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Optional tuning:

- `ANTHROPIC_FRAME_DESCRIPTION_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `ANALYSIS_WORKER_ID`
- `ANALYSIS_WORKER_POLL_MS`
- `ANALYSIS_WORKER_CONCURRENCY`
- `ANALYSIS_INDEX_SEGMENT_CONCURRENCY`
- `ANALYSIS_INDEX_DESCRIPTION_CONCURRENCY`
- `ANALYSIS_VERIFY_FRAME_CONCURRENCY`
- `ANALYSIS_INDEX_SHARD_SECONDS`
- `BETA_MAX_CHAT_REQUESTS_PER_DAY`
- `BETA_MAX_TRANSCRIBE_SECONDS_PER_DAY`
- `BETA_MAX_FRAME_DESCRIPTIONS_PER_DAY`
- `BETA_MAX_VISUAL_SEARCHES_PER_DAY`

## Supabase Setup

Run the SQL migrations in `supabase/migrations/` against a fresh Supabase project. They create:

- `projects` — user projects with edit state stored as JSONB
- `media_assets`, `analysis_jobs` — video file metadata and background processing queue
- `asset_scenes`, `asset_transcript_words`, `asset_visual_index` — indexing output tables
- `beta_usage_daily` — per-user daily usage tracking
- `storage_uploads` — quota enforcement
- `waitlist` — beta access list
- The private `videos` storage bucket with per-user path isolation
- RLS policies for all tables and storage objects
- The `consume_beta_usage` RPC used by public-beta guardrails

Auth configuration:

- Set the Supabase site URL to your deployment URL.
- Add `${YOUR_APP_URL}/auth/callback` as an additional redirect URL.
- Enable Google provider if you want Google login.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Zustand 5** — monolithic editor store (~2400 lines, ~180 state fields)
- **Tailwind CSS 4** — dark theme only; most styling done via inline styles and CSS variables
- **FFmpeg WASM** (`@ffmpeg/ffmpeg`) — in-browser video export via WebAssembly
- **Anthropic Claude** (`claude-sonnet-4-6`) — AI editing assistant
- **OpenAI Whisper** — audio transcription with word-level timestamps
- **Supabase** — auth (SSR), PostgreSQL, object storage

> Dev and prod both use `--webpack` because Turbopack breaks FFmpeg WASM loading.

## Deployment

### Web app

Deploy to Vercel as a standard Next.js project.

- Build command: `npm run build`
- Set all server environment variables in Vercel; `SUPABASE_SERVICE_ROLE_KEY` must remain server-only.

### Worker

Deploy a separate always-on service from `Dockerfile.worker`.

- Start command: `npm run worker:analysis`
- Requires `ffmpeg` and `ffprobe` — installed in the Docker image
- Auto-sizes concurrency from host CPU when `ANALYSIS_WORKER_CONCURRENCY` is unset
- Recommended starting point on a small instance: `ANALYSIS_WORKER_CONCURRENCY=2`, `ANALYSIS_INDEX_SEGMENT_CONCURRENCY=2`, `ANALYSIS_INDEX_DESCRIPTION_CONCURRENCY=2`
- `ANALYSIS_INDEX_SHARD_SECONDS` controls how much video each FFmpeg shard handles

## Verification

```bash
npm run lint
npm run build
```

Then verify end-to-end:

- Email signup/login and Google OAuth callback
- Video upload and project creation
- Transcription and frame descriptions
- Source indexing jobs moving from `queued` → `completed`
- Rate limits returning `429` once daily caps are reached
