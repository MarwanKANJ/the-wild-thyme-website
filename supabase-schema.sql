create table if not exists public.wt_content_entries (
  entry_key text primary key,
  bucket text not null,
  id text not null,
  sort_order integer not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists wt_content_entries_bucket_sort_idx
  on public.wt_content_entries (bucket, sort_order, id);

create table if not exists public.wt_contact_messages (
  id bigint generated always as identity primary key,
  source text not null default 'website',
  name text not null,
  email text not null,
  phone text,
  subject text not null,
  message text not null,
  page text,
  page_url text,
  referrer text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists wt_contact_messages_created_at_idx
  on public.wt_contact_messages (created_at desc);