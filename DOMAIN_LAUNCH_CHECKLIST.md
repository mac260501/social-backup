# Domain Launch Checklist (socialbackup.app)

Use this once your production site is live.

## 1) Update production environment variables
Set these in your production host (for example Vercel):

- `APP_BASE_URL=https://socialbackup.app`
- `NEXTAUTH_URL=https://socialbackup.app` (recommended fallback)
- `RESEND_FROM_EMAIL="Social Backup <noreply@socialbackup.app>"`
- `RESEND_API_KEY=<your real resend key>`
- `INNGEST_EVENT_KEY=<from Inngest>`
- `INNGEST_SIGNING_KEY=<from Inngest>`

## 2) Inngest sync and schedule
Backup processing runs through Inngest.

1. Ensure your app is synced in Inngest and points to:
   - `https://socialbackup.app/api/inngest`
2. Confirm these functions exist:
   - `archive-upload-processor`
   - `snapshot-scrape-processor`

## 3) Disable legacy Supabase cron (if previously enabled)
Run in Supabase SQL Editor:

- `supabase/scripts/disable_archive_reminder_cron.sql`

## 4) Quick production verification
After deploy:

1. Open `https://socialbackup.app/dashboard`
2. Upload a Twitter archive ZIP and confirm an `archive_upload` job is created
3. Trigger one snapshot scrape and confirm a `snapshot_scrape` job is created
4. Confirm both jobs process to completion via Inngest runs

## 5) Optional cleanup
- If any key was ever exposed, rotate:
  - Resend API key
  - Supabase service role key
  - Apify API key
  - R2 access key pair
