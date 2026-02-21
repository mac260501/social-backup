# Domain Launch Checklist (socialbackup.app)

Use this once your production site is live.

## 1) Update production environment variables
Set these in your production host (for example Vercel):

- `APP_BASE_URL=https://socialbackup.app`
- `NEXTAUTH_URL=https://socialbackup.app` (recommended fallback)
- `RESEND_FROM_EMAIL="Social Backup <noreply@socialbackup.app>"`
- `ARCHIVE_REMINDER_CRON_SECRET=<same secret you already use>`
- `RESEND_API_KEY=<your real resend key>`

Notes:
- Keep `ARCHIVE_REMINDER_CRON_SECRET` the same unless you want to rotate it.
- If you rotate it, update both app env and Supabase cron auth header.

## 2) Update Supabase cron reminder endpoint URL
In Supabase SQL Editor, replace your ngrok reminder cron with the production URL.

```sql
-- remove old schedule if it exists
select cron.unschedule('archive_wizard_reminders_hourly');

-- create new hourly schedule (runs at minute 5)
select cron.schedule(
  'archive_wizard_reminders_hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://socialbackup.app/api/archive-wizard/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ARCHIVE_REMINDER_CRON_SECRET'
    )
  );
  $$
);
```

## 3) Keep migration applied
Make sure this migration has already been run in Supabase:

- `supabase/migrations/008_add_archive_wizard_profile_fields.sql`

## 4) Quick production verification
After deploy:

1. Open `https://socialbackup.app/dashboard/archive-wizard`
2. Click `I've Requested My Archive`
3. Confirm profile fields update in Supabase (`archive_request_status`, timestamps)
4. Trigger reminder endpoint manually once and check response logs
5. Confirm a reminder email is delivered from your `@socialbackup.app` sender

## 5) Optional cleanup
- Remove/stop the old ngrok cron schedule if still present.
- If any key was ever exposed, rotate:
  - Resend API key
  - Supabase service role key
  - Apify API key
