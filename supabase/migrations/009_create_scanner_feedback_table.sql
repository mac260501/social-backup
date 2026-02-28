-- Store anonymous feedback for tweet scanner analyses.

create table if not exists public.scanner_feedback (
  id uuid primary key default gen_random_uuid(),
  tweet_text text not null,
  analysis_result jsonb not null,
  risk_score integer,
  risk_level text,
  user_rating text check (user_rating in ('helpful', 'not_helpful')),
  user_comment text,
  session_id text,
  created_at timestamptz not null default now()
);

create index if not exists scanner_feedback_created_at_idx
  on public.scanner_feedback (created_at desc);

create index if not exists scanner_feedback_session_id_idx
  on public.scanner_feedback (session_id, created_at desc);

alter table public.scanner_feedback disable row level security;
