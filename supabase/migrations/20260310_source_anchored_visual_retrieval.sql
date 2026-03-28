create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null,
  duration_seconds double precision,
  fps double precision,
  width integer,
  height integer,
  status text not null default 'pending' check (status in ('pending', 'indexing', 'ready', 'error')),
  created_at timestamptz not null default now(),
  indexed_at timestamptz,
  unique(project_id, storage_path)
);

create table if not exists public.asset_scenes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  scene_index integer not null,
  source_start double precision not null,
  source_end double precision not null,
  representative_thumbnail_path text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.asset_visual_index (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  source_time double precision not null,
  window_duration double precision not null default 0.25,
  sample_kind text not null check (sample_kind in ('scene_rep', 'window_250ms')),
  thumbnail_path text,
  ocr_text text,
  embedding vector(1536),
  brightness double precision,
  contrast double precision,
  edge_density double precision,
  motion_score double precision,
  fog_score double precision,
  darkness_score double precision,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.asset_transcript_words (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  start_time double precision not null,
  end_time double precision not null,
  text text not null,
  confidence double precision
);

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid references public.media_assets(id) on delete cascade,
  job_type text not null check (job_type in ('index_asset', 'verify_visual_candidates', 'repeat_detect_from_seed')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  priority integer not null default 100,
  attempt_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  locked_at timestamptz,
  locked_by text,
  progress jsonb not null default '{"completed":0,"total":1,"stage":"queued"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_assets_project_id_idx on public.media_assets(project_id);
create index if not exists asset_scenes_asset_id_idx on public.asset_scenes(asset_id, scene_index);
create index if not exists asset_visual_index_asset_id_time_idx on public.asset_visual_index(asset_id, source_time);
create index if not exists asset_transcript_words_asset_id_time_idx on public.asset_transcript_words(asset_id, start_time);
create index if not exists analysis_jobs_queue_idx on public.analysis_jobs(status, priority, created_at);

alter table public.media_assets enable row level security;
alter table public.asset_scenes enable row level security;
alter table public.asset_visual_index enable row level security;
alter table public.asset_transcript_words enable row level security;
alter table public.analysis_jobs enable row level security;

drop policy if exists "users can access media assets for own projects" on public.media_assets;
create policy "users can access media assets for own projects"
on public.media_assets
for all
using (exists (
  select 1 from public.projects
  where projects.id = media_assets.project_id
    and projects.user_id = auth.uid()
))
with check (exists (
  select 1 from public.projects
  where projects.id = media_assets.project_id
    and projects.user_id = auth.uid()
));

drop policy if exists "users can access asset scenes for own projects" on public.asset_scenes;
create policy "users can access asset scenes for own projects"
on public.asset_scenes
for all
using (exists (
  select 1 from public.media_assets
  join public.projects on projects.id = media_assets.project_id
  where media_assets.id = asset_scenes.asset_id
    and projects.user_id = auth.uid()
))
with check (exists (
  select 1 from public.media_assets
  join public.projects on projects.id = media_assets.project_id
  where media_assets.id = asset_scenes.asset_id
    and projects.user_id = auth.uid()
));

drop policy if exists "users can access visual samples for own projects" on public.asset_visual_index;
create policy "users can access visual samples for own projects"
on public.asset_visual_index
for all
using (exists (
  select 1 from public.media_assets
  join public.projects on projects.id = media_assets.project_id
  where media_assets.id = asset_visual_index.asset_id
    and projects.user_id = auth.uid()
))
with check (exists (
  select 1 from public.media_assets
  join public.projects on projects.id = media_assets.project_id
  where media_assets.id = asset_visual_index.asset_id
    and projects.user_id = auth.uid()
));

drop policy if exists "users can access asset transcripts for own projects" on public.asset_transcript_words;
create policy "users can access asset transcripts for own projects"
on public.asset_transcript_words
for all
using (exists (
  select 1 from public.media_assets
  join public.projects on projects.id = media_assets.project_id
  where media_assets.id = asset_transcript_words.asset_id
    and projects.user_id = auth.uid()
))
with check (exists (
  select 1 from public.media_assets
  join public.projects on projects.id = media_assets.project_id
  where media_assets.id = asset_transcript_words.asset_id
    and projects.user_id = auth.uid()
));

drop policy if exists "users can access analysis jobs for own projects" on public.analysis_jobs;
create policy "users can access analysis jobs for own projects"
on public.analysis_jobs
for all
using (exists (
  select 1 from public.projects
  where projects.id = analysis_jobs.project_id
    and projects.user_id = auth.uid()
))
with check (exists (
  select 1 from public.projects
  where projects.id = analysis_jobs.project_id
    and projects.user_id = auth.uid()
));
