# Add Media Tracking and Storage for Twitter Backups

## 🎯 Overview

This PR adds comprehensive media file tracking and storage capabilities to the Social Backup application. Users can now view, manage, and download media files (images, videos, GIFs) from both Twitter archive uploads and scraped tweets.

## ✨ Features Added

### 1. Media File Display in UI
- **Dashboard**: Added orange "Media" card showing media file count alongside tweets, followers, etc.
- **Backups Page**: Added expandable "Media Files" section to view media details
- **Smart Display**: Shows first 15 media files with filename, type, size, and MIME type
- **Responsive Design**: Adapts grid layout for mobile (2 cols), tablet (3 cols), desktop (6 cols for archives, 4 cols for scrapes)

### 2. Media Extraction from Archives
- Automatically extracts media files from `tweets_media/`, `profile_media/`, and `direct_messages_media/` folders in Twitter archives
- Uploads media files to Supabase Storage (`twitter-media` bucket)
- Creates `media_files` records in database with metadata (filename, size, MIME type, media type)
- Links media to tweets via `tweet_id` field

### 3. Media Extraction from Scraped Tweets
- Extracts media URLs from Apify tweet responses (`entities.media`, `extended_entities.media`)
- Downloads media files from Twitter CDN in background
- Uploads to Supabase Storage under `{userId}/scraped_media/`
- Creates database records linked to source tweets
- Non-blocking: scrape completes immediately, media processes asynchronously

### 4. Differentiated Backup Types in UI
- **Archive Backups**: Show all 6 metrics (Tweets, Media, Followers, Following, Likes, DMs)
- **Scraped Backups**: Show only 4 metrics (Tweets, Media, Followers, Following)
- Automatically detects backup type using `backup_source` field
- Cleaner UI without showing "0 Likes" and "0 DMs" for scraped backups

### 5. Automatic Storage Cleanup
- When deleting a backup, checks if media files are used by other backups
- Deletes orphaned files from storage (files only used by deleted backup)
- Preserves shared files (files referenced by multiple backups)
- Prevents storage bloat and reduces costs

## 🐛 Bug Fixes

### Database Schema Issues (Fixed)
1. **Foreign Key Constraint**: Changed `media_files.user_id` FK from `auth.users(id)` to `public.profiles(id)` to match application's user model
2. **Unique Constraint**: Changed from unique on `file_path` alone to composite unique on `(backup_id, file_path)` to allow same media file in multiple backups
3. **Cascade Deletion**: Added `ON DELETE CASCADE` to properly clean up records

### Media Count Issues (Fixed)
1. Fixed media count not persisting in backup stats
2. Fixed files already in storage (409 error) not being counted
3. Fixed batch insert failures by switching to individual inserts with proper error handling

### UI Bugs (Fixed)
1. Fixed empty expandable sections appearing for followers/following with no data
2. Added validation to check arrays contain meaningful data before displaying sections
3. Fixed "No media files found" when count showed > 0 (due to FK constraint issues)

## 🔒 Security Improvements

### Authentication & Authorization
- **All API routes now verify NextAuth session** before processing requests
- **Ownership verification** on all operations:
  - `/api/backups` - Users can only see their own backups
  - `/api/media` - Users can only access media from their own backups
  - `/api/backups/delete` - Users can only delete their own backups
- **Security logging** for unauthorized access attempts
- **Defense in depth**: Service role + manual authorization checks

### Created Security Helpers
- `verifyBackupOwnership()` - Check if user owns a backup
- `verifyMediaOwnership()` - Check if user owns media (via backup)
- Centralized in `/lib/auth-helpers.ts`

### Documentation
- Added comprehensive `SECURITY.md` with:
  - Security architecture overview
  - Threat model and mitigations
  - Best practices for developers
  - Security checklist for new features

## 📊 Database Changes

### New Table: `media_files`
```sql
- id (uuid, primary key)
- user_id (uuid, FK to profiles.id)
- backup_id (uuid, FK to backups.id)
- file_path (text) - Path in Supabase Storage
- file_name (text)
- file_size (bigint)
- mime_type (text)
- media_type (text) - e.g., 'tweets_media', 'scraped_media'
- tweet_id (text, optional)
- created_at (timestamp)

Constraints:
- UNIQUE (backup_id, file_path)
- FK to profiles with ON DELETE CASCADE
- FK to backups with ON DELETE CASCADE
```

### Migrations Provided
1. **`001_fix_media_files_constraint.sql`** - Fix unique constraint to allow file sharing
2. **`003_fix_media_files_user_fkey.sql`** - Fix foreign key to reference profiles
3. **`004_backfill_missing_media_records.sql`** - Backfill old backups with media records
4. **`005_cleanup_orphaned_storage_files.sql`** - Diagnostic query for orphaned files

### Updated `backups` Table
- Added `media_files` to `stats` JSONB field for all backups

## 🛠 Technical Details

### New Type Definitions
```typescript
interface TweetMedia {
  url: string
  type: 'photo' | 'video' | 'animated_gif'
  media_url?: string
}

interface Tweet {
  // ... existing fields
  media?: TweetMedia[]
}
```

### File Structure
```
/app/api/media/route.ts              # New: Media files API
/app/api/backups/delete/route.ts     # Updated: Smart cleanup
/app/api/upload-archive/route.ts     # Updated: Media extraction
/app/api/scrape/route.ts             # Updated: Scraped media
/lib/auth-helpers.ts                 # New: Security helpers
/lib/twitter/types.ts                # Updated: TweetMedia type
/lib/twitter/providers/apify-provider.ts  # Updated: Media extraction
/supabase/migrations/                # New: Migration files
/supabase/README.md                  # New: Migration docs
/SECURITY.md                         # New: Security docs
```

### Background Processing
- Media from scraped tweets is processed asynchronously after scrape completes
- Uses `.catch()` to handle errors without failing the scrape operation
- Logs progress: `[Scraped Media] Processed X/Y - filename.jpg`

## 🧪 Testing Notes

### Manual Testing Performed
1. ✅ Upload Twitter archive with media → Media files extracted and displayed
2. ✅ Scrape Twitter profile with tweets containing media → Media downloaded and tracked
3. ✅ Multiple uploads of same archive → Same files shared across backups
4. ✅ Delete backup with unique media → Files removed from storage
5. ✅ Delete backup with shared media → Files preserved for other backups
6. ✅ Unauthorized access attempts → Properly blocked with 403
7. ✅ UI displays correctly for both archive and scraped backups
8. ✅ Empty followers/following sections don't appear anymore

### Migrations Required
Users must run these migrations in Supabase SQL Editor:
1. `001_fix_media_files_constraint.sql` (critical)
2. `003_fix_media_files_user_fkey.sql` (critical)
3. `004_backfill_missing_media_records.sql` (optional, fixes old backups)

### Breaking Changes
- ⚠️ All API routes now require authentication (previously had no auth checks)
- ⚠️ Database schema changes required for media files to work

## 📸 Screenshots

See commit history for UI screenshots showing:
- Media cards in dashboard
- Expandable media sections in backups page
- Differentiated display for archive vs scraped backups
- Media file details (filename, type, size)

## 🎯 Future Enhancements

Potential follow-ups (not in this PR):
- [ ] Display media thumbnails/previews instead of just metadata
- [ ] Add download button for individual media files
- [ ] Implement media gallery view with lightbox
- [ ] Add media search/filter capabilities
- [ ] Support for video playback in browser

## 📝 Commits

This PR includes 13 commits:
- Media UI display and tracking
- Storage persistence fixes
- Database constraint fixes
- Security implementation
- Scraped media extraction
- UI improvements and cleanup

---

**Ready for review!** This is a substantial feature addition with security improvements. Please review migrations carefully before merging.
