import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestActorId } from '@/lib/request-actor'
import { createShareToken } from '@/lib/share-links'

const supabase = createAdminClient()

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveAppBaseUrl(request: Request): string {
  const configured = [
    process.env.APP_BASE_URL,
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ]

  for (const candidate of configured) {
    const normalized = readTrimmed(candidate).replace(/\/+$/, '')
    if (/^https?:\/\//i.test(normalized)) return normalized
  }

  return new URL(request.url).origin
}

export async function POST(request: Request) {
  try {
    const actorId = await getRequestActorId()
    if (!actorId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      backupId?: unknown
    }
    const backupId = readTrimmed(body.backupId)
    if (!backupId) {
      return NextResponse.json({ success: false, error: 'backupId is required' }, { status: 400 })
    }

    const { data: backup, error: backupError } = await supabase
      .from('backups')
      .select('id, user_id')
      .eq('id', backupId)
      .maybeSingle()

    if (backupError || !backup) {
      return NextResponse.json({ success: false, error: 'Backup not found' }, { status: 404 })
    }
    if (backup.user_id !== actorId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { token, expiresAtEpochSeconds } = createShareToken(backupId)
    const shareUrl = `${resolveAppBaseUrl(request).replace(/\/+$/, '')}/shared/${token}`

    return NextResponse.json({
      success: true,
      shareUrl,
      expiresAtEpochSeconds,
    })
  } catch (error) {
    console.error('[Share Link] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create share link',
    }, { status: 500 })
  }
}
