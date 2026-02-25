# MVP Cleanup Candidates

This is a delete-later shortlist for the no-signup/no-paywall MVP transition.
Nothing here has been removed yet.

## Marketing/Home Content (legacy)
- `components/home/AppPreviewSection.tsx`
- `components/home/BackupPreviewSection.tsx`
- `components/home/HowItWorksSection.tsx`
- `components/home/PrivacyAndControlSection.tsx`
- `components/social-logos.tsx`

## Auth Flow (remove once anonymous session is live)
- `app/login/page.tsx`
- `app/signup/page.tsx`
- `app/auth/callback/route.ts`
- `app/api/notifications/new-signup/route.ts`

## Dashboard Experience (replace with single-flow scrape UX)
- `app/dashboard/page.tsx`
- `app/dashboard/backups/page.tsx`
- `app/dashboard/backup/[backupId]/page.tsx`
- `components/dashboard/platforms/TwitterPanel.tsx`
- `components/dashboard/platforms/InstagramPanel.tsx`
- `components/dashboard/platforms/TikTokPanel.tsx`
- `components/dashboard/platforms/ComingSoonPanel.tsx`

## Archive Upload / Encryption Surface (not in strict scrape MVP)
- `app/api/platforms/twitter/upload-archive/**`
- `app/api/platforms/twitter/encrypted-archive/**`
- `lib/platforms/twitter/archive-upload*`
- `lib/platforms/twitter/archive-import.ts`
- `lib/platforms/twitter/direct-upload.ts`
- `lib/platforms/twitter/dm-crypto.ts`
- `lib/platforms/twitter/encrypted-archive*`

## API/Job Complexity To Revisit
- `app/api/backups/jobs/cancel/route.ts`
- `app/api/platforms/twitter/apify-webhook/route.ts`
- `lib/platforms/twitter/api-usage.ts`
- `lib/platforms/twitter/limits.ts` (budget-related keys)
