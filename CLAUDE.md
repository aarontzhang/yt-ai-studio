# CLAUDE.md

> **Global Rules:** See `~/.claude/CLAUDE.md` for organization-wide guidelines that apply to all projects.


This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm ci                    # Install dependencies (also runs postinstall to copy FFmpeg assets)
npm run dev               # Start dev server (uses --webpack, not Turbopack)
npm run build             # Production build (uses --webpack — Turbopack crashes in this repo)
npm run lint              # ESLint
npm run worker:analysis   # Start the indexing worker (separate process, requires ffmpeg/ffprobe)
```

No test runner is configured. Verify changes with `npm run lint && npm run build`.

## After Completing Changes

After finishing any set of code changes, always:
1. Stage the relevant files
2. Commit with a concise, descriptive message
3. Push to `origin main`

Do **not** include a `Co-Authored-By:` line in any commit message.

## Architecture

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Zustand 5 + Tailwind CSS 4 + Supabase (auth, storage, Postgres) + browser-side FFmpeg (WASM)

### Core Data Flow

1. **Upload:** Client → `/api/uploads/initiate` (signed token) → Supabase storage → `/api/uploads/finalize` (creates media asset)
2. **Indexing:** Worker polls `analysis_jobs` table → runs Whisper transcription, scene detection, frame extraction → updates media asset status to `ready`
3. **Editing:** All editor state lives in `useEditorStore` (Zustand). AI chat returns `<action>` JSON blocks (EditAction type) → user previews → `applyAction()` applies immutably → auto-saves via PATCH to `/api/projects/[id]`
4. **Export:** FFmpeg runs in-browser via WASM. Builds filter graph from clips/captions/overlays → renders → downloads blob

### Key Modules

- **`lib/useEditorStore.ts`** — Central Zustand store (~1000+ lines). Holds clips, captions, markers, transitions, text overlays, sources, chat messages, FFmpeg job state. Entry point for all editor mutations.
- **`lib/types.ts`** — All TypeScript types. `EditAction` is a discriminated union (split_clip, delete_clip, delete_range, set_clip_speed, add_captions, etc.).
- **`lib/playbackEngine.ts`** — Converts clips → timeline schedule, handles time mapping between timeline and source coordinates, accounts for speed changes.
- **`lib/editActionUtils.ts`** — Pure functions for applying edits to immutable `EditSnapshot` objects. Used by both the store and the preview system.
- **`lib/ffmpegClient.ts`** — Browser FFmpeg wrapper. Loads WASM from `/public/ffmpeg/`, handles media caching, builds filter graphs for export (speed, volume, captions via drawtext, transitions).
- **`lib/server/llmGuardrails.ts`** — Server-side validation of AI-proposed edits. Extracts `<action>` blocks from Claude responses, sanitizes, marks user data as untrusted.
- **`lib/indexer/sourceIndex.ts`** — Structures Whisper output into segments (sentence splitting, pause detection, filler word tagging).

### API Routes

All authenticated routes use `getSupabaseServer()` for auth. Security: `enforceSameOrigin()` (CSRF), `enforceRateLimit()` (per-user per-minute), `consumeBetaUsage()` (daily quota).

- `/api/chat` — Claude-powered edit suggestions. Receives project context, returns response with optional `<action>` block.
- `/api/transcribe` — OpenAI Whisper. Accepts audio, returns word-level timestamps.
- `/api/projects/[id]/source-index` — Polling endpoint for indexing status and source index data.
- `/api/uploads/{initiate,finalize}` — Two-step signed upload flow.

### FFmpeg in Browser

FFmpeg WASM requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (set in `next.config.ts`). Assets are copied from node_modules to `/public/ffmpeg/` by `scripts/copy-ffmpeg.mjs` at postinstall time. Dev and prod both use `--webpack` because Turbopack breaks FFmpeg loading.

### Auth & Middleware

`proxy.ts` handles path-based auth redirects. Protected routes: `/editor`, `/projects`, `/new`. Public: `/`, `/waitlist`, `/api/*`, `/auth/*`. Auth uses Supabase SSR with cookie-based sessions. `AuthProvider` component wraps the app.

### Database

Supabase with RLS on all tables. Key tables: `projects` (edit_state as JSONB), `media_assets`, `analysis_jobs`, `beta_usage_daily`. Migrations in `supabase/migrations/`. Storage bucket `videos` is private with per-user path isolation (`userId/projectId/`).

### Path Alias

`@/*` maps to project root (configured in `tsconfig.json`).

<!-- GSD:project-start source:PROJECT.md -->
## Project

**YouTube AI Studio**

A hackathon demo that integrates AI-powered video editing into the YouTube Creator Studio upload workflow. The app reskins the existing AutoCut editor to look and feel identical to YouTube Studio, inserting an AI editing step between video upload and the standard publish flow. The goal is to show Google what an AI editor natively embedded in YouTube Studio could look like.

**Core Value:** The upload-to-publish flow must feel like a natural extension of YouTube Creator Studio — visually indistinguishable from the real thing, with a functional AI editor in the middle.

### Constraints

- **Hackathon:** This is a hackathon submission — polish and visual fidelity matter more than production robustness
- **Tech stack:** Must stay on Next.js 16 + React 19 + Tailwind CSS 4 (existing stack)
- **Editor logic:** Editor functionality must not change — reskin only
- **Export flow:** FFmpeg export still downloads a blob; user manually proceeds to Details stepper after export
- **Non-functional pages:** Post-editor stepper pages (Details through Visibility) are visual only — forms don't save, radio buttons don't persist, dropdowns don't load real data
- **Design fidelity:** UI must be visually indistinguishable from YouTube Creator Studio (reference: `Storyline/walkthrough/` screenshots)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript ^5 - All application code (frontend, API routes, utilities)
- SQL (PostgreSQL) - Database migrations in `supabase/migrations/`
- JavaScript (ESM) - Build scripts in `scripts/copy-ffmpeg.mjs`
## Runtime
- Node.js (Next.js server runtime)
- Browser (client-side FFmpeg WASM, React UI)
- npm
- Lockfile: `package-lock.json` present
## Frameworks
- Next.js 16.1.6 - Full-stack React framework (App Router)
- React 19.2.3 - UI rendering
- React DOM 19.2.3 - DOM bindings
- Tailwind CSS ^4 - Utility-first CSS (via PostCSS plugin)
- Zustand ^5.0.11 - Client-side state management
- Not detected. No test framework, test config files, or test files present.
- ESLint ^9
- Webpack (via Next.js `--webpack` flag)
- PostCSS with `@tailwindcss/postcss`
- Postinstall script: `node scripts/copy-ffmpeg.mjs` copies FFmpeg WASM files to `public/ffmpeg/`
## Key Dependencies
- `@anthropic-ai/sdk` ^0.78.0 - Anthropic Claude API client for chat editing assistant
- `openai` ^6.25.0 - OpenAI API client for Whisper audio transcription
- `@supabase/supabase-js` ^2.98.0 - Supabase client (admin operations, direct DB access)
- `@supabase/ssr` ^0.9.0 - Supabase SSR integration (cookie-based auth for Next.js)
- `@ffmpeg/ffmpeg` ^0.12.15 - FFmpeg WebAssembly wrapper (client-side video export)
- `@ffmpeg/core` ^0.12.10 - FFmpeg WASM core (ESM single-thread build)
- `@ffmpeg/core-st` ^0.11.1 - FFmpeg single-thread core (fallback)
- `@ffmpeg/util` ^0.12.2 - FFmpeg utility functions
- `jpeg-js` ^0.4.4 - JPEG encoding/decoding for frame analysis
- `uuid` ^13.0.0 / `@types/uuid` ^10.0.0 - UUID generation for IDs (clips, segments, scenes)
- `dotenv` ^17.3.1 - Environment variable loading
## TypeScript Configuration
## Configuration
- `.env.example` present with required variable names
- Configuration loaded via `process.env` (Next.js built-in)
- See INTEGRATIONS.md for full env var list
- `next.config.ts` - Custom headers for COOP/COEP (required for SharedArrayBuffer / FFmpeg WASM), WASM MIME type for `/ffmpeg/*.wasm`
- `postcss.config.mjs` - Tailwind CSS PostCSS plugin
- `eslint.config.mjs` - ESLint flat config
## Platform Requirements
- Node.js (version not pinned; no `.nvmrc` or `.node-version`)
- `ffprobe` must be available on PATH (used server-side for video duration probing in `lib/server/videoDuration.ts`)
- Supabase project (local or hosted) for database and storage
- Next.js-compatible hosting (Vercel, self-hosted Node.js)
- `ffprobe` binary available in server environment
- Supabase hosted instance (PostgreSQL + Storage + Auth)
- Cross-Origin headers required for FFmpeg WASM: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`
## Database
- `projects` - User projects with edit state (JSONB)
- `media_assets` - Video file metadata and processing status
- `asset_scenes` - Detected scene boundaries per asset
- `asset_visual_index` - Visual frame embeddings and metadata (vector 1536)
- `asset_transcript_words` - Word-level transcript with timestamps
- `analysis_jobs` - Background job queue for asset indexing
- `beta_usage_daily` - Per-user daily usage tracking for rate limits
- `storage_uploads` - Tracked file uploads for quota enforcement
- `waitlist` - Email waitlist for beta access
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- React components: PascalCase (e.g., `components/editor/ClipBlock.tsx`, `components/chat/ChatSidebar.tsx`)
- Utility/library modules: camelCase (e.g., `lib/editActionUtils.ts`, `lib/playbackEngine.ts`, `lib/timelineUtils.ts`)
- Zustand stores: `use` prefix with camelCase (e.g., `lib/useEditorStore.ts`, `lib/useAutoSave.ts`, `lib/useStorageQuota.ts`)
- API routes: `route.ts` inside Next.js App Router directories (e.g., `app/api/chat/route.ts`, `app/api/projects/route.ts`)
- Server-only utilities: placed in `lib/server/` subdirectory (e.g., `lib/server/requestSecurity.ts`, `lib/server/llmGuardrails.ts`)
- Scripts: camelCase with `.mjs` extension (e.g., `scripts/copy-ffmpeg.mjs`)
- Use camelCase for all functions: `buildClipSchedule`, `normalizeSourceId`, `getTimelineDuration`
- Helper/factory functions use descriptive verb prefixes: `build*`, `normalize*`, `get*`, `make*`, `create*`, `sanitize*`
- Boolean check functions: `is*` prefix (e.g., `isFiller`, `isServerBackedSource`, `isFiniteNumber`, `isSameOriginUrl`)
- React hooks: `use` prefix (e.g., `useEditorStore`, `useAuth`, `useAutoSave`, `useStorageQuota`)
- camelCase for all variables and parameters
- Constants: UPPER_SNAKE_CASE for module-level constants (e.g., `MAIN_SOURCE_ID`, `SOURCE_INDEX_VERSION`, `MAX_CHAT_TURNS`, `STORAGE_QUOTA_BYTES`)
- CSS-related constants: UPPER_SNAKE_CASE (e.g., `BASE_TRACK_HEIGHT`, `HEADER_W`, `RULER_H`)
- Refs: `*Ref` suffix (e.g., `videoRef`, `playerRef`, `scrollRef`, `timerRef`)
- Interfaces: PascalCase, descriptive nouns (e.g., `VideoClip`, `CaptionEntry`, `EditAction`, `ProjectSource`)
- Type aliases: PascalCase (e.g., `TranscriptStatus`, `FFmpegJob`, `SelectedItem`, `SourceMedia`)
- Union types (string enums): lowercase with underscores (e.g., `'rolling_word' | 'static'`, `'queued' | 'running' | 'completed'`)
- All types are defined in `lib/types.ts` for shared domain types; component-local types are defined at the top of the file
## Code Style
- No Prettier config detected -- relies on ESLint only
- Single quotes for string literals consistently across the codebase
- Semicolons used at end of statements
- 2-space indentation
- Trailing commas in multi-line argument lists and array/object literals
- Line length is not enforced but typically stays under ~140 chars; long lines are common in JSX `style` props
- ESLint v9 with flat config at `eslint.config.mjs`
- Uses `eslint-config-next` presets: `core-web-vitals` and `typescript`
- Global ignores: `.next/`, `out/`, `build/`, `next-env.d.ts`, `public/ffmpeg/`, `ai-video-editor/`
- The only inline ESLint suppression observed: `// eslint-disable-next-line @typescript-eslint/no-explicit-any` in `lib/uploadVideo.ts` line 53
- Run lint: `npm run lint`
## Import Organization
- `@/*` maps to project root (configured in `tsconfig.json` paths: `"@/*": ["./*"]`)
- All internal imports use `@/lib/*` and `@/components/*` path aliases
- Relative imports (`./`, `../`) used only within closely related files (e.g., `'./types'` from within `lib/`)
## Component Patterns
- All client components begin with `'use client';` directive
- Server Components are used for pages with data fetching (e.g., `app/page.tsx` which calls `getSupabaseServer()`)
- Default exports for components: `export default function ComponentName()`
- Props defined inline or with dedicated interface directly above the component
- No class components anywhere in the codebase
- Large components define private sub-components in the same file (e.g., `ProjectLoadingState` and `EmptyDropZone` in `components/editor/EditorLayout.tsx`)
- Sub-components are plain functions at the bottom of the file, not exported
- `memo()` used selectively for performance (e.g., Timeline component imports `memo` from React)
- `forwardRef` + `useImperativeHandle` used for imperative APIs (e.g., `components/editor/VideoPlayer.tsx` exposes `VideoPlayerHandle`)
- Props typed with inline object types for simple components, interfaces for complex ones
- Callback props use `on*` prefix: `onSelect`, `onImportSources`, `onClick`
- Optional props use `?:` TypeScript optional syntax
- Children prop typed as `React.ReactNode`
- Extensive use of `useCallback` for event handlers and memoized functions
- `useRef` for DOM refs, mutable values, and imperative handles
- `useMemo` for derived computations
- `useEffect` for side effects with explicit dependency arrays
- No custom hook libraries -- all hooks are hand-written
## State Management Patterns
- Single monolithic store created with `create()` from Zustand
- Contains all editor state: clips, captions, markers, transitions, text overlays, chat messages, AI settings, playback state, undo/redo history, project metadata
- Store is ~2300 lines -- the largest file in the codebase
- Access pattern uses individual selectors to avoid re-renders:
- Direct state access via `useEditorStore.getState()` used in callbacks and async operations
- Undo/redo implemented manually with `history` and `future` arrays in state
- Single `AuthContext` providing `{ user, initialized }`
- `useAuth()` hook wraps `useContext(AuthContext)`
- Supabase auth state synchronized via `onAuthStateChange` listener
- `useState` for UI-local concerns: panel widths, loading flags, drag state, hover state
- Layout dimensions managed via `useState` with mouse-drag resize handlers (chat width, timeline height, media panel width)
- `fetch()` calls to internal API routes from client components
- No SWR, React Query, or other data-fetching libraries
- Manual loading/error state management with `useState`
- Auto-save via debounced `useEffect` in `lib/useAutoSave.ts` (1500ms debounce)
- Polling pattern for source index updates at 4-second intervals
## Styling Conventions
- Dark theme only -- no light mode support
- Background scale: `--bg-base` (#111111), `--bg-panel` (#171717), `--bg-elevated` (#1e1e1e), `--bg-surface` (#252525), `--bg-hover` (#2e2e2e)
- Foreground scale: `--fg-primary` (95% white), `--fg-secondary` (52%), `--fg-muted` (28%), `--fg-faint` (7%)
- Accent: `--accent` (#21d4ff cyan), `--accent-strong`, `--accent-dim`, `--accent-border`
- Border: `--border` (7% white), `--border-mid` (12% white)
- Clip colors: `--blue-clip`, `--caption-clip`, `--text-clip`, `--speed-clip`
- All variable references use `var(--name)` syntax
- Components overwhelmingly use inline `style={{ }}` objects rather than Tailwind utility classes
- Complex layouts built with inline flexbox: `display: 'flex'`, `flexDirection: 'column'`, `alignItems: 'center'`
- Dynamic styles computed in JS and applied inline (widths, positions, colors based on state)
- Example pattern from `components/editor/ClipBlock.tsx`:
- Tailwind v4 configured via `@tailwindcss/postcss` plugin
- `globals.css` imports Tailwind via `@import "tailwindcss";`
- `@theme inline` block maps CSS variables to Tailwind theme tokens
- Tailwind classes used sparingly, primarily in the root layout: `className="antialiased"`
- Most styling is done via inline styles, not utility classes
- Utility classes for reusable visual effects: `.panel-sheen`, `.iridescent-button`, `.iridescent-outline`, `.fade-in`, `.no-select`
- Clip type classes: `.clip-video`, `.clip-audio`, `.clip-caption`, `.clip-textoverlay`, `.clip-speed`
- Layout helpers: `.panel-divider-v`, `.panel-divider-h`
- Interaction states: `.drop-active`
- Keyframe animations: `dotPulse`, `spin`, `shimmer`, `fadeIn`
- Geist (sans-serif) as `--font-serif` (note: variable name is misleading -- it maps Geist, a sans-serif font)
- Geist Mono as `--font-mono`
- Loaded via `next/font/google` in `app/layout.tsx`
## TypeScript Usage
- `strict: true` enabled in `tsconfig.json`
- Target: ES2017
- Module resolution: `bundler`
- All shared domain types centralized in `lib/types.ts` (~464 lines)
- Heavy use of interfaces for data structures: `VideoClip`, `CaptionEntry`, `EditAction`, `MarkerEntry`
- Discriminated unions via `type` field on `EditAction` (30+ action types)
- Union string literal types for statuses: `MediaAssetStatus`, `AnalysisJobStatus`, `SourceIndexTaskStatus`
- Optional fields use `?:` syntax extensively
- Non-null assertions (`!`) used sparingly, mainly after validation guards (e.g., `clip.sourceStart!` after `Number.isFinite()` check)
- Pervasive defensive validation of data at boundaries (API routes, store hydration, loaded state)
- `Number.isFinite()` checks before using numeric values
- `typeof value === 'string'` guards before string operations
- Normalize functions that return `null` for invalid input:
- Sanitization functions in `lib/server/llmGuardrails.ts` validate all LLM output before applying
- Used in utility functions: `replaceEntriesForSource<T extends { sourceId?: string | null }>`
- Zustand store typed with full `EditorState` interface
- `import type { ... }` used consistently for type-only imports
- `export type { ... }` used for re-exports of types
## Error Handling
- Return `NextResponse.json({ error: message }, { status: code })` for errors
- Auth check pattern: `if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`
- Rate limiting returns 429 with `retryAfterSeconds` field
- CSRF protection via same-origin check returns 403
- Try/catch at route level with generic error responses
- `console.warn()` for non-critical failures (background transcription, source index refresh)
- `console.error()` for critical failures (project load)
- Errors caught and stored in state (e.g., `transcriptError`, `saveStatus: 'error'`)
- No global error boundary detected
- Async operations wrapped in `void` expression to suppress unhandled promise warnings:
- All data loaded from API or persisted state goes through normalization functions
- Invalid entries filtered out silently (return `null` from normalize, then filter)
- No thrown errors for invalid data -- graceful degradation preferred
## Logging
- `console.warn('Descriptive message:', error)` for recoverable failures
- `console.error('Descriptive message:', error)` for critical errors
- `console.log()` used in scripts only (`scripts/copy-ffmpeg.mjs`)
- Prefixed log messages with `[module]` in `lib/uploadVideo.ts`: `console.error('[uploadVideo] ...')`
- No structured logging framework -- no server-side logging library
## Function Design
- Destructured object parameters for functions with 3+ parameters
- Single primitive parameters for simple lookups and conversions
- Optional parameters via TypeScript `?:` syntax
- Callback parameters typed inline or with named types
- Normalize functions return `T | null` to indicate invalid input
- Async functions return `Promise<T>` explicitly
- Boolean predicates return `boolean`
- Builder functions return the constructed object directly
## Module Design
- Default exports for React components
- Named exports for utility functions, constants, types, and hooks
- One component per file (with private sub-components allowed)
- Type re-exports: `export type { EditSnapshot } from './editActionUtils'`
- Not used -- no `index.ts` barrel files detected
- All imports reference specific file paths
- `lib/server/` contains server-only code (never imported by client components)
- `lib/supabase/` isolates Supabase client creation (browser, server, admin variants)
- `lib/types.ts` is the shared type definition file imported by both client and server code
- `lib/indexer/` contains video analysis/indexing logic
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Single Next.js 16 application serving both the SPA editor and server-side API routes
- Client-side state managed through a single Zustand store (`useEditorStore`)
- AI chat powered by Anthropic Claude via streaming server-side API route
- Audio transcription via OpenAI Whisper API
- Video export handled entirely in-browser via FFmpeg WebAssembly
- Supabase for auth, Postgres database, and object storage (videos bucket)
- Clip-based timeline editing model where the source video is never mutated; edits are a sequence of `VideoClip` references into source material
## Layers
- Purpose: Render the editor UI, handle user interactions, manage local UI state
- Location: `components/`
- Contains: Editor panels (timeline, video player, chat sidebar, media panel), auth UI, project dashboard, upload screen, landing page
- Depends on: Zustand store (`lib/useEditorStore.ts`), utility libraries in `lib/`
- Used by: Next.js pages in `app/`
- Purpose: Single source of truth for all editor state; exposes actions for every editing operation
- Location: `lib/useEditorStore.ts`
- Contains: ~180-field state interface with video clips, captions, transitions, markers, text overlays, chat messages, AI settings, source index data, undo/redo history, FFmpeg job status, project metadata
- Depends on: `lib/editActionUtils.ts`, `lib/playbackEngine.ts`, `lib/timelineUtils.ts`, `lib/aiSettings.ts`, `lib/projectSources.ts`, `lib/sourceUtils.ts`, `lib/textOverlays.ts`
- Used by: All editor components via selector hooks
- Purpose: Timeline manipulation algorithms that are decoupled from React rendering
- Location: `lib/editActionUtils.ts`, `lib/playbackEngine.ts`, `lib/timelineUtils.ts`
- Contains: Clip splitting, range deletion, schedule building, source-to-timeline time mapping, caption projection, silence detection, waveform generation
- Depends on: `lib/types.ts`
- Used by: Zustand store, ChatSidebar, server-side chat route
- Purpose: Server-side endpoints for auth-gated CRUD, AI chat, transcription, file uploads, and storage quota
- Location: `app/api/`
- Contains: REST-style route handlers using Next.js `NextRequest`/`NextResponse`
- Depends on: `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `lib/server/*`
- Used by: Client-side fetch calls from components and lib modules
- Purpose: Server-only logic for security, rate limiting, beta usage tracking, LLM guardrails, storage quota enforcement, video duration validation
- Location: `lib/server/`
- Contains: `requestSecurity.ts` (CSRF + rate limiting), `llmGuardrails.ts` (sanitization of LLM I/O), `betaLimits.ts` (daily usage caps), `storageQuota.ts` (quota tracking via admin client), `videoDuration.ts`
- Depends on: `lib/supabase/admin.ts`, `lib/types.ts`
- Used by: API route handlers only
- Purpose: Shared TypeScript interfaces and type definitions
- Location: `lib/types.ts`
- Contains: ~465 lines of interfaces covering the entire domain model: `VideoClip`, `CaptionEntry`, `EditAction`, `ChatMessage`, `ProjectSource`, `MediaAsset`, `SourceIndex`, `VisualSearchSession`, `AIEditingSettings`, and more
- Depends on: Nothing
- Used by: Every other layer
- Purpose: Build structured source indexes from raw Whisper transcription output (filler detection, sentence segmentation, scene boundaries)
- Location: `lib/indexer/`
- Contains: `sourceIndex.ts` (word annotation, segment grouping), `sceneDetect.ts`, `representativeFrames.ts`
- Depends on: `lib/types.ts`
- Used by: Transcription API route, editor store
## Data Flow
- Single Zustand store (`useEditorStore`) with ~180 state fields and ~80 actions
- Undo/redo via snapshot-based history: `history: EditSnapshot[]` and `future: EditSnapshot[]`
- No middleware; all state mutations happen inside Zustand's `set()` callback
- Components subscribe to specific slices via selectors (e.g., `useEditorStore(s => s.clips)`)
- Preview snapshots support non-destructive previewing of proposed edits before committing
## Key Abstractions
- Purpose: A reference to a contiguous segment of source video material with per-clip effects
- Examples: `lib/types.ts` (interface), `lib/useEditorStore.ts` (manipulation), `lib/editActionUtils.ts` (splitting/deletion)
- Pattern: Immutable data; new arrays created on every edit; clips are never mutated in place
- Purpose: A discriminated union type representing any edit the AI or user can request (20+ action types)
- Examples: `lib/types.ts` (type definition), `app/api/chat/route.ts` (LLM output parsing), `lib/useEditorStore.ts` (`applyAction`)
- Pattern: Command pattern; actions are serializable JSON objects that can be validated, previewed, applied, and recorded in history
- Purpose: A frozen capture of timeline state (clips, captions, transitions, markers, textOverlays) used for undo/redo and preview
- Examples: `lib/editActionUtils.ts` (type + builders), `lib/useEditorStore.ts` (history stack)
- Pattern: Memento pattern for undo/redo
- Purpose: Structured representation of a video's content: transcript segments with word-level timing, scene boundaries, filler word detection
- Examples: `lib/types.ts` (interface), `lib/indexer/sourceIndex.ts` (builder), `app/api/transcribe/route.ts` (creation)
- Pattern: Derived data computed from Whisper output; stored as part of project edit_state
- Purpose: Represents one video file associated with a project, tracking its storage path, asset ID, duration, and indexing status
- Examples: `lib/types.ts` (interface), `lib/projectSources.ts` (hydration/merging), `lib/sourceMedia.ts` (runtime resolution)
- Pattern: Multi-source support where each project can have a primary video plus additional source clips
- Purpose: Computed timeline layout that maps clips to absolute timeline positions accounting for speed and transitions
- Examples: `lib/playbackEngine.ts` (`buildClipSchedule`, `buildRenderTimeline`), `lib/timelineUtils.ts`
- Pattern: Derived from clips array; recomputed on every render; never persisted
## Entry Points
- Location: `app/layout.tsx`
- Triggers: Every page load
- Responsibilities: Wraps entire app in `AuthProvider`, sets up fonts and global CSS
- Location: `app/page.tsx`
- Triggers: Unauthenticated visit to `/`
- Responsibilities: Server component that checks auth; redirects to `/projects` if logged in, otherwise renders `LandingPage`
- Location: `app/editor/page.tsx`
- Triggers: Navigation to `/editor?project={id}`
- Responsibilities: Reads `project` query param, renders `EditorLayout` component which orchestrates the entire editing experience
- Location: `app/projects/page.tsx`
- Triggers: Navigation to `/projects`
- Responsibilities: Lists user's projects, supports create/open/delete/rename
- Location: `app/api/chat/route.ts`
- Triggers: POST from ChatSidebar when user sends a message
- Responsibilities: Constructs LLM prompt with full editor context, calls Claude, validates response, returns structured action + message
- Location: `app/api/uploads/initiate/route.ts` and `app/api/uploads/finalize/route.ts`
- Triggers: Video upload from UploadScreen or media import in editor
- Responsibilities: Two-phase upload: initiate (quota check, signed URL generation) and finalize (validate, track, update project)
## Error Handling
- API routes wrap operations in try/catch and return structured JSON errors with appropriate HTTP status codes
- LLM output is validated through `lib/server/llmGuardrails.ts`: action JSON is extracted from freeform text, each field is bounds-checked and sanitized, invalid actions are rejected
- Rate limiting uses in-memory buckets (`lib/server/requestSecurity.ts`) with automatic cleanup; returns 429 with `retryAfterSeconds`
- Beta usage limits are enforced via Supabase RPC (`consumeBetaUsage`) with daily quotas for chat requests and transcription seconds
- Client-side: store normalization functions (`normalizeLoadedClip`, `normalizeCaptionEntry`, etc.) silently filter out malformed data when loading persisted state
- FFmpeg errors are caught and surfaced via the `ffmpegJob` state (`{ status: 'error', message }`)
## Cross-Cutting Concerns
- Client-side: Zustand store normalization on load
- API routes: Manual field validation in route handlers
- LLM output: `lib/server/llmGuardrails.ts` sanitizes all LLM-generated content (strips control chars, enforces length limits, validates action JSON structure and bounds)
- Prompt injection defense: Untrusted data (transcripts, frame descriptions, previous messages) is wrapped in `UNTRUSTED_*` blocks with explicit security rules in the system prompt
- Server: `getSupabaseServer()` reads auth from cookies via `@supabase/ssr`
- Client: `getSupabaseBrowser()` for client-side operations
- Admin: `getSupabaseAdmin()` with service role key for privileged operations (storage object queries, beta usage tracking)
- Auth flow: Email/password via `app/auth/login/page.tsx`, OAuth callback at `app/auth/callback/route.ts`
- Every API route checks `supabase.auth.getUser()` and returns 401 if not authenticated
- CSRF protection via same-origin check on all mutating requests (`enforceSameOrigin`)
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
