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