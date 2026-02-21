-- Clears runtime data while preserving schema, tables, indexes, and policies.
-- Run in Supabase SQL editor as an admin role.
-- Note: Direct DELETE on storage.objects is blocked by Supabase.
-- Some Supabase versions expose storage.empty_bucket(text); others do not.
-- This script will clear app tables and only empty storage bucket when supported.

begin;

-- App data tables
delete from public.media_files;
delete from public.backup_jobs;
delete from public.backups;
delete from public.social_profiles;

-- Storage objects (keeps the bucket definition itself), when helper exists.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'storage'
      and p.proname = 'empty_bucket'
      and p.pronargs = 1
  ) then
    execute 'select storage.empty_bucket(''twitter-media'')';
  else
    raise notice 'storage.empty_bucket(text) not available; skipping storage bucket cleanup.';
  end if;
end
$$;

commit;
