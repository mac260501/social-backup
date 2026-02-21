# Social Backup

Social Backup is a Next.js app backed by Supabase (auth + database), Cloudflare R2 (media storage), and Inngest (background jobs + cron).

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Sentry Setup

Sentry is configured for Next.js across client, server, and edge runtimes.

1. Add these required env vars:
   - `NEXT_PUBLIC_SENTRY_DSN`
   - `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (for source map uploads in production builds)
2. Optional env vars:
   - `SENTRY_DSN` (if you want a separate server DSN)
   - `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_ENVIRONMENT`
   - sampling and log flags listed in `.env.example`
3. Recommended production defaults:
   - `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1`
   - `SENTRY_TRACES_SAMPLE_RATE=0.1`
   - `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.02`
   - `NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=1`
4. Build in CI with Sentry env vars present so source maps upload:

```bash
npm run build
```

To verify end-to-end, trigger a handled error in an API route or a client `try/catch` using `Sentry.captureException(error)` and confirm it appears in your Sentry project.

## Operational Runbook

### Deleting test users (correct flow)

Use this flow so auth state and app state stay consistent:

1. Delete user(s) from Supabase Auth:
   - Supabase Dashboard -> Authentication -> Users -> Delete
2. Remove orphaned app profile rows:

```sql
delete from public.profiles p
where not exists (
  select 1 from auth.users u where u.id = p.id
);
```

Notes:
- `backup_jobs`, `backups`, `social_profiles`, and `media_files` are linked to `profiles` via foreign keys with cascade behavior.
- Deleting from `auth.users` alone does not automatically remove `public.profiles`.

### Rebuild `profiles` from existing auth users

If `public.profiles` was emptied, recreate profile rows with:

```sql
insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1),
    'User'
  )
from auth.users u
on conflict (id) do update
set display_name = excluded.display_name;
```

## Other Docs

- Domain launch checklist: `DOMAIN_LAUNCH_CHECKLIST.md`
- Supabase migrations/scripts: `supabase/README.md`
