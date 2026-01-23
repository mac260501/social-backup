-- Diagnostic query: Run this FIRST to see what constraints/indexes exist
-- This will help you understand what the migration will change

-- Check for unique constraints on media_files table
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.media_files'::regclass
  AND contype = 'u'  -- unique constraints
ORDER BY conname;

-- Check for indexes on media_files table
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'media_files'
  AND schemaname = 'public'
ORDER BY indexname;

-- Check for any constraints involving file_path column specifically
SELECT
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.media_files'::regclass
  AND pg_get_constraintdef(oid) LIKE '%file_path%'
ORDER BY conname;
