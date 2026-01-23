# Database Migrations

## Overview

This directory contains SQL migration files for the Supabase database schema.

## How to Apply Migrations

### Step 1: Run Diagnostic (Optional but Recommended)

Before applying the migration, you can check what constraints/indexes currently exist:

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Open and copy the contents of `000_diagnostic_check.sql`
4. Paste and execute the SQL
5. Review the results to see current constraints/indexes

### Step 2: Apply the Migration

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the contents of `001_fix_media_files_constraint.sql`
4. Paste and execute the SQL
5. The migration is safe to run - it uses IF EXISTS/IF NOT EXISTS to avoid errors

## Migrations

### 001_fix_media_files_constraint.sql

**Issue**: The `media_files` table had a unique constraint on `file_path` which prevented the same media file from being associated with multiple backups. This caused the following problems:

- When uploading the same Twitter archive multiple times, each upload creates a new backup
- Media files already exist in storage from the first upload
- Trying to insert media_file records for subsequent backups fails with error 23505 (duplicate key)
- Users see a media count but "No media files found" when expanding the section

**Solution**: This migration:
- Removes the unique constraint on `file_path` alone
- Adds a composite unique constraint on `(backup_id, file_path)`
- Allows the same media file in storage to be linked to multiple different backups

**When to apply**: Apply this migration first before 003_fix_media_files_user_fkey.sql

---

### 003_fix_media_files_user_fkey.sql

**Issue**: The `media_files.user_id` field had a foreign key constraint pointing to `auth.users(id)`, but the application code uses a UUID generated from the Twitter user ID which is stored in `profiles.id`. This caused error 23503 when trying to insert media records:

```
insert or update on table "media_files" violates foreign key constraint "media_files_user_id_fkey"
Key (user_id)=(xxx) is not present in table "users".
```

**Solution**: This migration:
- Drops the foreign key constraint pointing to `auth.users(id)`
- Adds a new foreign key constraint pointing to `public.profiles(id)`
- Makes it consistent with the `backups` table which also references `profiles.id`

**When to apply**: Apply this migration after 001_fix_media_files_constraint.sql

---

### 002_check_media_state.sql

This is a diagnostic query (not a migration) used to troubleshoot media file issues
- Trying to insert media_file records for subsequent backups fails with error 23505 (duplicate key)
- Users see a media count but "No media files found" when expanding the section

**Solution**: This migration:
- Removes the unique constraint on `file_path` alone
- Adds a composite unique constraint on `(backup_id, file_path)`
- Allows the same media file in storage to be linked to multiple different backups

**When to apply**: Apply this migration if you're experiencing issues where:
- Media files show a count but don't appear when expanded
- Logs show "0 new records inserted" for media files
- You're getting error 23505 when uploading the same archive multiple times

## Database Schema Reference

### media_files table

Expected columns:
- `id` - Primary key
- `user_id` - Foreign key to profiles
- `backup_id` - Foreign key to backups
- `file_path` - Path to file in Supabase storage
- `file_name` - Original filename
- `file_size` - Size in bytes
- `mime_type` - MIME type (e.g., 'image/jpeg')
- `media_type` - Type of media (e.g., 'tweets_media', 'profile_media')
- `created_at` - Timestamp

**Constraints after migration**:
- Unique constraint on `(backup_id, file_path)` - same file can exist for different backups
