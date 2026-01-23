-- Clean up orphaned files in Supabase Storage
--
-- Issue: When backups are deleted, media_files records are cascade-deleted,
-- but the actual files in storage remain, leading to orphaned files
--
-- This query identifies files that should be deleted from storage
-- because they have no media_files records pointing to them

-- First, let's see what files are currently referenced in the database
SELECT
  file_path,
  COUNT(DISTINCT backup_id) as backup_count,
  array_agg(DISTINCT backup_id) as backup_ids
FROM media_files
GROUP BY file_path
ORDER BY file_path;

-- To manually clean up storage:
-- 1. Go to Supabase Dashboard > Storage > twitter-media bucket
-- 2. Check the files listed above - these are the ACTIVE files (keep them)
-- 3. Delete any files NOT in this list (they are orphaned)
--
-- OR use the Supabase Storage API to list all files and compare

-- Note: Automatic cleanup would require a PostgreSQL extension or Edge Function
-- to call the Supabase Storage API from within the database, which is complex.
-- See the application-level solution below for a better approach.
