# Database Migrations

## Overview

This directory contains SQL migration files for the Supabase database schema.

## How to Apply Migrations

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the contents of the migration file
4. Paste and execute the SQL

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
