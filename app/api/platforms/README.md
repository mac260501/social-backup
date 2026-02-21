# Platform API Organization

- Shared, cross-platform routes stay in `app/api` (auth/user backup listing, shared deletion).
- Platform-specific routes live under `app/api/platforms/<platform>/...`.

## Current platform routes
- `twitter/scrape`
- `twitter/upload-archive`
- `twitter/profile-media`
- `twitter/download-archive`
- `twitter/apify-webhook`

## Twitter safety limits
- Upload archive size limit (`TWITTER_MAX_ARCHIVE_BYTES`, default `1GB`)
- ZIP entry count limit (`TWITTER_MAX_ARCHIVE_ZIP_ENTRIES`, default `50000`)
- Media file count limit (`TWITTER_MAX_ARCHIVE_MEDIA_FILES`, default `20000`)
- Total uncompressed media bytes limit (`TWITTER_MAX_ARCHIVE_MEDIA_BYTES`, default `5GB`)
- User total storage limit (`USER_MAX_TOTAL_STORAGE_BYTES`, default `5GB`)
- Scrape tweet request default (`TWITTER_SCRAPE_DEFAULT_TWEETS`, used only by legacy callers)
- Scrape snapshot token budget caps (`TWITTER_SCRAPE_API_MAX_COST_PER_RUN_USD` / `TWITTER_SCRAPE_API_MAX_COST_PER_MONTH_USD`, default `$25 / $20`)
- Apify pricing knobs (`TWITTER_APIFY_PROFILE_QUERY_BASE_USD`, `TWITTER_APIFY_PROFILE_INCLUDED_ITEMS`, `TWITTER_APIFY_PROFILE_EXTRA_ITEM_USD`, `TWITTER_APIFY_USER_ITEM_USD`)
- Apify ad-hoc webhook auth (`APIFY_WEBHOOK_SECRET`) and optional app base URL override (`APP_BASE_URL`)

## Reserved folders
- `instagram/`
- `tiktok/`

Keep new platform endpoints inside their own folder to avoid cross-team merge conflicts.
