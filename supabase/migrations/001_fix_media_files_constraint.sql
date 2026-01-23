-- Fix media_files table to allow same file in multiple backups
-- The issue: unique constraint on file_path prevents the same media file
-- from being associated with multiple backups

-- Drop the existing unique constraint on file_path
ALTER TABLE media_files DROP CONSTRAINT IF EXISTS media_files_file_path_key;

-- Add a composite unique constraint on (backup_id, file_path)
-- This allows the same file to be stored once in storage but linked to multiple backups
ALTER TABLE media_files ADD CONSTRAINT media_files_backup_file_unique
  UNIQUE (backup_id, file_path);

-- Note: This migration allows the same media file (same file_path in storage)
-- to be associated with multiple different backups. Each backup will have its
-- own record in the media_files table pointing to the same storage location.
