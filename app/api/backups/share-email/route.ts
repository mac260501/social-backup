import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestActorId } from '@/lib/request-actor'
import { resolveConfiguredAppBaseUrl, sendBackupReadyEmail } from '@/lib/notifications/backup-ready-email'

const supabase = createAdminClient()
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveAppBaseUrl(request: Request): string {
  return resolveConfiguredAppBaseUrl() || new URL(request.url).origin
}

export async function POST(request: Request) {
  try {
    const actorId = await getRequestActorId()
    if (!actorId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      backupId?: unknown
      email?: unknown
    }
    const backupId = readTrimmed(body.backupId)
    const email = readTrimmed(body.email).toLowerCase()

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'backupId is required' }, { status: 400 })
    }
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ success: false, error: 'Valid email is required' }, { status: 400 })
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

    const appBaseUrl = resolveAppBaseUrl(request)
    const delivery = await sendBackupReadyEmail({
      email,
      backupId,
      appBaseUrl,
    })

    return NextResponse.json({
      success: true,
      message: 'Email sent.',
      shareUrl: delivery.shareUrl,
      expiresAtEpochSeconds: delivery.expiresAtEpochSeconds,
    })
  } catch (error) {
    console.error('[Share Email] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send share email',
    }, { status: 500 })
  }
}
