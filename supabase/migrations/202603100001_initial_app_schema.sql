create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled Project',
  video_path text,
  video_filename text,
  video_size bigint,
  edit_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_updated_at_idx
  on public.projects(user_id, updated_at desc);

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

alter table public.projects enable row level security;

drop policy if exists "users can manage own projects" on public.projects;
create policy "users can manage own projects"
on public.projects
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do nothing;

drop policy if exists "users can read own video objects" on storage.objects;
create policy "users can read own video objects"
on storage.objects
for select
using (
  bucket_id = 'videos'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "users can upload own video objects" on storage.objects;
create policy "users can upload own video objects"
on storage.objects
for insert
with check (
  bucket_id = 'videos'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "users can update own video objects" on storage.objects;
create policy "users can update own video objects"
on storage.objects
for update
using (
  bucket_id = 'videos'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'videos'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "users can delete own video objects" on storage.objects;
create policy "users can delete own video objects"
on storage.objects
for delete
using (
  bucket_id = 'videos'
  and split_part(name, '/', 1) = auth.uid()::text
);
