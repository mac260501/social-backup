# Platform API Organization

- Shared, cross-platform routes stay in `app/api` (auth/user backup listing, shared deletion).
- Platform-specific routes live under `app/api/platforms/<platform>/...`.

## Current platform routes
- `twitter/scrape`
- `twitter/upload-archive`
- `twitter/profile-media`
- `twitter/download-archive`

## Twitter safety limits
- Upload archive size limit (`TWITTER_MAX_ARCHIVE_BYTES`, default `512MB`)
- ZIP entry count limit (`TWITTER_MAX_ARCHIVE_ZIP_ENTRIES`, default `50000`)
- Media file count limit (`TWITTER_MAX_ARCHIVE_MEDIA_FILES`, default `20000`)
- Total uncompressed media bytes limit (`TWITTER_MAX_ARCHIVE_MEDIA_BYTES`, default `5GB`)
- Scrape tweet bounds (`TWITTER_SCRAPE_MIN_TWEETS` / `TWITTER_SCRAPE_DEFAULT_TWEETS` / `TWITTER_SCRAPE_MAX_TWEETS`, default `10 / 500 / 1000`)

## Reserved folders
- `instagram/`
- `tiktok/`

Keep new platform endpoints inside their own folder to avoid cross-team merge conflicts.
