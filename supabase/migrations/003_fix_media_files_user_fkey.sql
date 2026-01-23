-- Fix media_files.user_id foreign key to reference profiles instead of auth.users
--
-- Issue: media_files.user_id has FK to auth.users(id), but the code uses
-- a UUID generated from Twitter user ID which is stored in profiles.id
-- This causes error 23503 when trying to insert media records
--
-- Solution: Change FK to reference profiles.id (consistent with backups table)

-- Drop the existing foreign key constraint that points to auth.users
ALTER TABLE media_files
  DROP CONSTRAINT IF EXISTS media_files_user_id_fkey;

-- Add new foreign key constraint pointing to profiles
ALTER TABLE media_files
  ADD CONSTRAINT media_files_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Note: Now media_files.user_id and backups.user_id both reference profiles.id,
-- which is consistent with how the application generates user IDs from Twitter user IDs
