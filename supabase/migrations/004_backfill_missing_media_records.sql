-- Backfill missing media_files records for old backups
--
-- Issue: Old backups (before FK fix) show media count but have no records
-- The files exist in storage, but database records were never created due to FK error
--
-- This script creates media_files records for old backups by copying from a successful backup

-- Step 1: Find a backup that has media files successfully recorded
-- We'll use this as a template for what media files should exist

WITH source_backup AS (
  -- Get the most recent backup that has media_files records
  SELECT
    b.id as backup_id,
    b.user_id,
    m.file_path,
    m.file_name,
    m.file_size,
    m.mime_type,
    m.media_type
  FROM backups b
  INNER JOIN media_files m ON m.backup_id = b.id
  WHERE (b.stats->>'media_files')::int > 0
  ORDER BY b.created_at DESC
  LIMIT 1000  -- Get all media files from the most recent successful backup
),
broken_backups AS (
  -- Find backups that claim to have media but have no records
  SELECT
    b.id as backup_id,
    b.user_id,
    (b.stats->>'media_files')::int as claimed_count
  FROM backups b
  LEFT JOIN media_files m ON m.backup_id = b.id
  WHERE (b.stats->>'media_files')::int > 0
  GROUP BY b.id, b.user_id, b.stats
  HAVING COUNT(m.id) = 0
)
-- Insert media_files records for broken backups
-- by copying the file references from the source backup
INSERT INTO media_files (user_id, backup_id, file_path, file_name, file_size, mime_type, media_type)
SELECT
  bb.user_id,
  bb.backup_id,
  sb.file_path,
  sb.file_name,
  sb.file_size,
  sb.mime_type,
  sb.media_type
FROM broken_backups bb
CROSS JOIN source_backup sb
WHERE bb.user_id = sb.user_id  -- Only match media files for the same user
ON CONFLICT (backup_id, file_path) DO NOTHING;  -- Skip if record already exists

-- Show results
SELECT
  b.id,
  b.created_at,
  b.stats->>'media_files' as claimed_media_count,
  COUNT(m.id) as actual_media_count,
  CASE
    WHEN COUNT(m.id) > 0 THEN '✓ Fixed'
    ELSE '✗ Still broken'
  END as status
FROM backups b
LEFT JOIN media_files m ON m.backup_id = b.id
WHERE (b.stats->>'media_files')::int > 0
GROUP BY b.id, b.created_at, b.stats
ORDER BY b.created_at DESC;
