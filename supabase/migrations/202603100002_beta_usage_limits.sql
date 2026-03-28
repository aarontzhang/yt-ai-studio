create table if not exists public.beta_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default ((now() at time zone 'utc')::date),
  metric text not null check (metric in (
    'chat_requests',
    'transcribe_seconds',
    'frame_descriptions',
    'visual_searches'
  )),
  used_amount bigint not null default 0 check (used_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, metric)
);

create index if not exists beta_usage_daily_usage_date_metric_idx
  on public.beta_usage_daily(usage_date, metric);

drop trigger if exists set_beta_usage_daily_updated_at on public.beta_usage_daily;
create trigger set_beta_usage_daily_updated_at
before update on public.beta_usage_daily
for each row
execute function public.set_updated_at();

alter table public.beta_usage_daily enable row level security;

drop policy if exists "users can read own beta usage" on public.beta_usage_daily;
create policy "users can read own beta usage"
on public.beta_usage_daily
for select
using (auth.uid() = user_id);

create or replace function public.consume_beta_usage(
  p_user_id uuid,
  p_metric text,
  p_amount bigint,
  p_limit bigint
)
returns table (
  allowed boolean,
  used_amount bigint,
  limit_amount bigint,
  remaining_amount bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_used bigint;
begin
  if p_amount <= 0 then
    select coalesce(used_amount, 0)
    into v_used
    from public.beta_usage_daily
    where user_id = p_user_id
      and usage_date = v_today
      and metric = p_metric;

    return query
    select true, coalesce(v_used, 0), p_limit, greatest(p_limit - coalesce(v_used, 0), 0);
    return;
  end if;

  insert into public.beta_usage_daily (user_id, usage_date, metric, used_amount)
  values (p_user_id, v_today, p_metric, 0)
  on conflict (user_id, usage_date, metric) do nothing;

  update public.beta_usage_daily
  set used_amount = beta_usage_daily.used_amount + p_amount,
      updated_at = now()
  where user_id = p_user_id
    and usage_date = v_today
    and metric = p_metric
    and (p_limit <= 0 or beta_usage_daily.used_amount + p_amount <= p_limit)
  returning beta_usage_daily.used_amount
  into v_used;

  if found then
    return query
    select true, v_used, p_limit, case when p_limit <= 0 then null else greatest(p_limit - v_used, 0) end;
    return;
  end if;

  select coalesce(used_amount, 0)
  into v_used
  from public.beta_usage_daily
  where user_id = p_user_id
    and usage_date = v_today
    and metric = p_metric;

  return query
  select false, coalesce(v_used, 0), p_limit, case when p_limit <= 0 then null else greatest(p_limit - coalesce(v_used, 0), 0) end;
end;
$$;

grant execute on function public.consume_beta_usage(uuid, text, bigint, bigint) to authenticated, service_role;
