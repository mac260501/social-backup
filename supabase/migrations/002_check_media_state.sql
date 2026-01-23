-- Diagnostic: Check current state of media files and backups
-- Run this to understand what data exists and troubleshoot the issue

-- 1. Count backups and their media stats
SELECT
  b.id,
  b.created_at,
  b.backup_name,
  b.stats->>'media_files' as media_files_in_stats,
  COUNT(m.id) as actual_media_records
FROM backups b
LEFT JOIN media_files m ON m.backup_id = b.id
GROUP BY b.id, b.created_at, b.backup_name, b.stats
ORDER BY b.created_at DESC
LIMIT 10;

-- 2. Check if there are any media files in the table at all
SELECT COUNT(*) as total_media_files FROM media_files;

-- 3. Show sample of media files if any exist
SELECT
  id,
  backup_id,
  file_name,
  media_type,
  created_at
FROM media_files
ORDER BY created_at DESC
LIMIT 5;

-- 4. Check for any backups that claim to have media but have no records
SELECT
  b.id,
  b.created_at,
  b.stats->>'media_files' as claimed_media_count,
  COUNT(m.id) as actual_media_count
FROM backups b
LEFT JOIN media_files m ON m.backup_id = b.id
WHERE (b.stats->>'media_files')::int > 0
GROUP BY b.id, b.created_at, b.stats
HAVING COUNT(m.id) = 0;
