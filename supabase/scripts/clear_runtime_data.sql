-- Clears runtime data while preserving schema, tables, indexes, and policies.
-- Run in Supabase SQL editor as an admin role.
-- Storage is now in Cloudflare R2, so this script only resets database runtime state.

begin;

-- Backup/runtime tables
truncate table public.media_files restart identity cascade;
truncate table public.backup_jobs restart identity cascade;
truncate table public.backups restart identity cascade;
truncate table public.social_profiles restart identity cascade;

commit;
