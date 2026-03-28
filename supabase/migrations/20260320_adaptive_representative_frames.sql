alter table public.asset_visual_index
  drop constraint if exists asset_visual_index_sample_kind_check;

alter table public.asset_visual_index
  add constraint asset_visual_index_sample_kind_check
  check (sample_kind in ('scene_rep', 'coarse_window_rep', 'window_250ms'));
