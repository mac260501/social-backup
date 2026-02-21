-- Add archive wizard tracking fields to profiles for request/download/upload state.

alter table public.profiles
  add column if not exists archive_request_status text default null;

alter table public.profiles
  add column if not exists archive_requested_at timestamptz default null;

alter table public.profiles
  add column if not exists archive_reminder_count integer not null default 0;

alter table public.profiles
  add column if not exists archive_last_reminder_at timestamptz default null;

create index if not exists profiles_archive_request_status_idx
  on public.profiles (archive_request_status);

create index if not exists profiles_archive_requested_at_idx
  on public.profiles (archive_requested_at);
