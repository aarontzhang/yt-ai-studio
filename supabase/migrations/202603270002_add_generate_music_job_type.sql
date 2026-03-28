-- Allow generate_music as a valid job type in analysis_jobs
alter table public.analysis_jobs
  drop constraint if exists analysis_jobs_job_type_check;

alter table public.analysis_jobs
  add constraint analysis_jobs_job_type_check
  check (job_type in ('index_asset', 'verify_visual_candidates', 'repeat_detect_from_seed', 'generate_music'));
