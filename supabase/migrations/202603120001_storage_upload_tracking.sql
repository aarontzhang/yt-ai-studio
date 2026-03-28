create table if not exists public.storage_uploads (
  storage_path text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  upload_kind text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storage_uploads_kind_check check (upload_kind in ('project-main', 'main', 'sources', 'tracks'))
);

create index if not exists storage_uploads_user_id_idx
  on public.storage_uploads(user_id, updated_at desc);

create index if not exists storage_uploads_project_id_idx
  on public.storage_uploads(project_id);

drop trigger if exists set_storage_uploads_updated_at on public.storage_uploads;
create trigger set_storage_uploads_updated_at
before update on public.storage_uploads
for each row
execute function public.set_updated_at();

alter table public.storage_uploads enable row level security;

drop policy if exists "users can read own storage uploads" on public.storage_uploads;
create policy "users can read own storage uploads"
on public.storage_uploads
for select
using (auth.uid() = user_id);
