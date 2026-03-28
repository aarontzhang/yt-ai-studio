alter table public.analysis_jobs
  drop constraint if exists analysis_jobs_status_check;

alter table public.analysis_jobs
  add constraint analysis_jobs_status_check
  check (status in ('queued', 'running', 'paused', 'completed', 'failed'));

alter table public.analysis_jobs
  add column if not exists pause_requested boolean not null default false;

create index if not exists analysis_jobs_asset_status_idx
  on public.analysis_jobs(asset_id, status, created_at desc);
