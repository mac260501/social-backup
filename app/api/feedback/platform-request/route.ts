import { NextResponse } from 'next/server'
import { sendAdminEventEmail } from '@/lib/notifications/admin-event-email'
import { getRequestActorId } from '@/lib/request-actor'

type PlatformId = 'instagram' | 'tiktok'

const ALLOWED_PLATFORMS = new Set<PlatformId>(['instagram', 'tiktok'])

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toPlatform(value: unknown): PlatformId | null {
  const normalized = readTrimmed(value).toLowerCase()
  if (ALLOWED_PLATFORMS.has(normalized as PlatformId)) return normalized as PlatformId
  return null
}

export async function POST(request: Request) {
  try {
    const actorId = await getRequestActorId()
    if (!actorId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as { platform?: unknown }
    const platform = toPlatform(body.platform)

    if (!platform) {
      return NextResponse.json(
        { success: false, error: 'platform must be one of: instagram, tiktok' },
        { status: 400 },
      )
    }

    try {
      await sendAdminEventEmail({
        subject: 'Platform request vote',
        title: 'User requested new platform support',
        details: [
          { label: 'Actor ID', value: actorId },
          { label: 'Platform', value: platform },
          { label: 'Path', value: '/dashboard' },
          { label: 'UA', value: request.headers.get('user-agent') || 'unknown' },
        ],
      })
    } catch (notifyError) {
      console.warn('[Platform Vote] Failed to send admin notification:', notifyError)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Platform Vote] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save vote.',
      },
      { status: 500 },
    )
  }
}
