-- Normalize schema drift for backups/media_files across environments.
--
-- Goals:
-- 1) Ensure backups has both created_at and uploaded_at timestamps.
-- 2) Ensure media_files has media_type for classification/filtering.
-- 3) Backfill missing values safely and add helpful indexes.

begin;

-- 1) backups timestamp normalization
alter table public.backups
  add column if not exists created_at timestamptz;

alter table public.backups
  add column if not exists uploaded_at timestamptz;

update public.backups
set
  created_at = coalesce(created_at, uploaded_at, now()),
  uploaded_at = coalesce(uploaded_at, created_at, now())
where created_at is null or uploaded_at is null;

alter table public.backups
  alter column created_at set default now();

alter table public.backups
  alter column uploaded_at set default now();

do $$
begin
  if exists (select 1 from public.backups where created_at is null) then
    raise notice 'Skipping NOT NULL on backups.created_at because null rows remain.';
  else
    execute 'alter table public.backups alter column created_at set not null';
  end if;

  if exists (select 1 from public.backups where uploaded_at is null) then
    raise notice 'Skipping NOT NULL on backups.uploaded_at because null rows remain.';
  else
    execute 'alter table public.backups alter column uploaded_at set not null';
  end if;
end
$$;

create index if not exists backups_user_created_at_idx
  on public.backups (user_id, created_at desc);

-- 2) media_files media_type normalization
alter table public.media_files
  add column if not exists media_type text;

do $$
declare
  mime_expr text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'media_files'
      and column_name = 'mime_type'
  ) then
    mime_expr := 'lower(coalesce(mime_type, ''''))';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'media_files'
      and column_name = 'file_type'
  ) then
    mime_expr := 'lower(coalesce(file_type, ''''))';
  else
    mime_expr := '''''';
  end if;

  execute format($sql$
    update public.media_files
    set media_type = case
      when media_type is not null and btrim(media_type) <> '' then media_type
      when lower(coalesce(file_path, '')) like '%%/archives/%%' then 'archive_file'
      when %s in ('application/zip', 'application/x-zip-compressed', 'multipart/x-zip') then 'archive_file'
      when lower(coalesce(file_path, '')) like '%%/profile_media/%%' then 'profile_media'
      when lower(coalesce(file_path, '')) like '%%/profiles_media/%%' then 'profile_media'
      else 'scraped_media'
    end
    where media_type is null or btrim(media_type) = ''
  $sql$, mime_expr);
end
$$;

alter table public.media_files
  alter column media_type set default 'scraped_media';

create index if not exists media_files_backup_media_type_idx
  on public.media_files (backup_id, media_type);

commit;
