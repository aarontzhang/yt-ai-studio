create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now(),
  constraint waitlist_email_unique unique (email)
);

alter table waitlist enable row level security;

-- Only service role can read; inserts are open (handled via service role in API)
