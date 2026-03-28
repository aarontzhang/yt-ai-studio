create unique index if not exists analysis_jobs_active_asset_job_type_uidx
  on public.analysis_jobs(asset_id, job_type)
  where status in ('queued', 'running', 'paused');
