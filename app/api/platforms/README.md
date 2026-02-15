# Platform API Organization

- Shared, cross-platform routes stay in `app/api` (auth/user backup listing, shared deletion).
- Platform-specific routes live under `app/api/platforms/<platform>/...`.

## Current platform routes
- `twitter/scrape`
- `twitter/upload-archive`
- `twitter/profile-media`
- `twitter/download-archive`

## Reserved folders
- `instagram/`
- `tiktok/`

Keep new platform endpoints inside their own folder to avoid cross-team merge conflicts.
