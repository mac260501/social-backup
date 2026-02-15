# Platform Architecture

This folder defines ownership boundaries for each social platform so teams can work in parallel with minimal conflicts.

## Rules
- Shared shell/layout lives in `app/dashboard/page.tsx`.
- Platform-specific dashboard UI lives in `components/dashboard/platforms/<Platform>Panel.tsx`.
- Platform-specific backup viewer UI lives in `components/platforms/<platform>/backup/*`.
- Platform-specific API routes live in `app/api/platforms/<platform>/...`.
- Shared backup classification and platform inference lives in `lib/platforms/backup.ts`.
- Shared platform metadata (labels, enablement, known sources) lives in `lib/platforms/registry.ts`.

## Current state
- `twitter` is fully wired and enabled.
- `instagram` and `tiktok` have dedicated panel components and route namespace reserved for implementation.

## Working independently
- Twitter work: edit `components/dashboard/platforms/TwitterPanel.tsx` and `app/api/platforms/twitter/*`.
- Twitter backup UI work: edit `components/platforms/twitter/backup/*`.
- Instagram work: create/update `components/dashboard/platforms/InstagramPanel.tsx`, `components/platforms/instagram/backup/*`, and `app/api/platforms/instagram/*`.
- TikTok work: create/update `components/dashboard/platforms/TikTokPanel.tsx`, `components/platforms/tiktok/backup/*`, and `app/api/platforms/tiktok/*`.

Avoid editing shared files unless needed (`app/dashboard/page.tsx`, `lib/platforms/*`).
