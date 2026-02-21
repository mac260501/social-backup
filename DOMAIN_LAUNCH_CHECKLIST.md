# Domain Launch Checklist (socialbackup.app)

Use this once your production site is live.

## 1) Update production environment variables
Set these in your production host (for example Vercel):

- `APP_BASE_URL=https://socialbackup.app`
- `NEXTAUTH_URL=https://socialbackup.app` (recommended fallback)
- `RESEND_FROM_EMAIL="Social Backup <noreply@socialbackup.app>"`
- `ARCHIVE_REMINDER_CRON_SECRET=<keep if you still want manual reminder endpoint protection>`
- `RESEND_API_KEY=<your real resend key>`
- `INNGEST_EVENT_KEY=<from Inngest>`
- `INNGEST_SIGNING_KEY=<from Inngest>`

## 2) Inngest sync and schedule
Reminders and backup processing now run through Inngest.

1. Ensure your app is synced in Inngest and points to:
   - `https://socialbackup.app/api/inngest`
2. Confirm these functions exist:
   - `archive-upload-processor`
   - `snapshot-scrape-processor`
   - `archive-reminders-hourly`
3. The reminder schedule is hourly at minute 5 (`5 * * * *`).

## 3) Disable legacy Supabase cron (if previously enabled)
Run in Supabase SQL Editor:

- `supabase/scripts/disable_archive_reminder_cron.sql`

## 4) Keep migration applied
Make sure this migration has already been run in Supabase:

- `supabase/migrations/008_add_archive_wizard_profile_fields.sql`

## 5) Quick production verification
After deploy:

1. Open `https://socialbackup.app/dashboard/archive-wizard`
2. Click `I've Requested My Archive`
3. Confirm profile fields update in Supabase (`archive_request_status`, timestamps)
4. Trigger reminder endpoint manually once and check response logs:
   - `POST https://socialbackup.app/api/archive-wizard/reminders`
   - If `ARCHIVE_REMINDER_CRON_SECRET` is set, include `Authorization: Bearer <secret>`
5. Confirm a reminder email is delivered from your `@socialbackup.app` sender

## 6) Optional cleanup
- If any key was ever exposed, rotate:
  - Resend API key
  - Supabase service role key
  - Apify API key
  - R2 access key pair
