# Autocut

Autocut is a Next.js video editor with Supabase-backed auth/storage, browser-side FFmpeg editing, OpenAI transcription, Anthropic-powered assistant flows, and a background worker for source-video indexing.

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

5. Start the optional indexing worker in a second shell if you want visual search/indexing locally:

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

- `projects`
- visual-indexing tables and job queue tables
- `beta_usage_daily`
- the private `videos` storage bucket
- RLS policies for projects, storage objects, and beta usage
- the `consume_beta_usage` RPC used by the public-beta guardrails

Auth configuration:

- Set the Supabase site URL to your Vercel deployment URL.
- Add `${YOUR_APP_URL}/auth/callback` as an additional redirect URL.
- Enable Google provider if you want Google login.
- If email confirmation stays enabled, the UI now shows a check-your-email state after signup instead of assuming immediate login.

## Deployment

### Web app

Deploy the repo to Vercel as a standard Next.js project.

- Build command: `npm run build`
- Output: standard Next.js server deployment
- Production build uses Webpack because the current Turbopack production path crashes in this repo

Set all server environment variables in Vercel. `SUPABASE_SERVICE_ROLE_KEY` must remain server-only.

### Worker

Deploy a separate always-on worker service from `Dockerfile.worker`.

- Start command: `npm run worker:analysis`
- Required system dependency: `ffmpeg` and `ffprobe` are installed in the image
- The worker now auto-sizes its process slot count from host CPU capacity when `ANALYSIS_WORKER_CONCURRENCY` is unset.
- Each indexing job also fans out internally:
  frame extraction is sharded across `ANALYSIS_INDEX_SEGMENT_CONCURRENCY` FFmpeg workers and frame-description batches are sent with `ANALYSIS_INDEX_DESCRIPTION_CONCURRENCY`.
- `ANALYSIS_INDEX_SHARD_SECONDS` controls how much video each FFmpeg shard handles before the next shard is launched.
- Recommended starting point on a small instance: `ANALYSIS_WORKER_CONCURRENCY=2`, `ANALYSIS_INDEX_SEGMENT_CONCURRENCY=2`, `ANALYSIS_INDEX_DESCRIPTION_CONCURRENCY=2`.

Any container host that supports long-running Node processes works here.

## Verification

Run these checks before shipping:

```bash
npm run lint
npm run build
```

Then verify:

- email signup/login
- Google OAuth callback
- video upload and project creation
- transcription
- frame descriptions
- source indexing jobs moving from queued to completed
- rate limits returning `429` once daily caps are reached
