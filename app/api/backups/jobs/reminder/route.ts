import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBackupJobForUser, mergeBackupJobPayload } from '@/lib/jobs/backup-jobs'
import { getRequestActorId } from '@/lib/request-actor'
import { resolveConfiguredAppBaseUrl, sendBackupReadyEmail } from '@/lib/notifications/backup-ready-email'
import { sendAdminEventEmail } from '@/lib/notifications/admin-event-email'

const supabase = createAdminClient()
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readReminderEmail(payload: unknown): string | null {
  const record = toRecord(payload)
  const email = readTrimmed(record.reminder_email).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) return null
  return email
}

export async function POST(request: Request) {
  try {
    const actorId = await getRequestActorId()
    if (!actorId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      jobId?: unknown
      email?: unknown
    }

    const jobId = readTrimmed(body.jobId)
    const email = readTrimmed(body.email).toLowerCase()

    if (!jobId) {
      return NextResponse.json({ success: false, error: 'jobId is required.' }, { status: 400 })
    }
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ success: false, error: 'Valid email is required.' }, { status: 400 })
    }

    const job = await getBackupJobForUser(supabase, jobId, actorId)
    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found.' }, { status: 404 })
    }
    const existingPayload = toRecord(job.payload)
    const reminderAdminNotifiedAt = readTrimmed(existingPayload.reminder_admin_notified_at)

    if (job.status === 'failed') {
      return NextResponse.json({ success: false, error: 'This job is no longer active.' }, { status: 409 })
    }

    const nowIso = new Date().toISOString()
    const updatedJob = await mergeBackupJobPayload(supabase, jobId, {
      reminder_email: email,
      reminder_requested_at: nowIso,
      reminder_delivery_status: 'requested',
      reminder_error: null,
    })

    if (!reminderAdminNotifiedAt) {
      try {
        await sendAdminEventEmail({
          subject: 'Backup reminder requested',
          title: 'User requested reminder email',
          details: [
            { label: 'Actor ID', value: actorId },
            { label: 'Job ID', value: jobId },
            { label: 'Reminder email', value: email },
            { label: 'Job status', value: updatedJob?.status || job.status || 'unknown' },
          ],
        })
        await mergeBackupJobPayload(supabase, jobId, {
          reminder_admin_notified_at: new Date().toISOString(),
        })
      } catch (notificationError) {
        console.warn('[Reminder Email] Failed to send admin reminder notification:', notificationError)
      }
    }

    const resolvedPayload = updatedJob?.payload || job.payload
    const storedEmail = readReminderEmail(resolvedPayload)
    const resultBackupId = readTrimmed(updatedJob?.result_backup_id || job.result_backup_id)

    if (storedEmail && resultBackupId && (updatedJob?.status === 'completed' || job.status === 'completed')) {
      const appBaseUrl = resolveConfiguredAppBaseUrl()
      if (!appBaseUrl) {
        return NextResponse.json(
          {
            success: false,
            error: 'APP_BASE_URL (or NEXTAUTH_URL / NEXT_PUBLIC_APP_URL) is required for reminder emails.',
          },
          { status: 500 },
        )
      }

      try {
        const delivery = await sendBackupReadyEmail({
          email: storedEmail,
          backupId: resultBackupId,
          appBaseUrl,
        })

        await mergeBackupJobPayload(supabase, jobId, {
          reminder_delivery_status: 'sent',
          reminder_sent_at: new Date().toISOString(),
          reminder_error: null,
          reminder_share_url: delivery.shareUrl,
        })

        return NextResponse.json({
          success: true,
          sent: true,
          message: 'Reminder email sent.',
        })
      } catch (sendError) {
        await mergeBackupJobPayload(supabase, jobId, {
          reminder_delivery_status: 'failed',
          reminder_error: sendError instanceof Error ? sendError.message : 'Failed to send reminder email.',
        })
        throw sendError
      }
    }

    return NextResponse.json({
      success: true,
      sent: false,
      message: 'Reminder saved. We will email you when the backup is ready.',
    })
  } catch (error) {
    console.error('[Reminder Email] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save reminder.',
      },
      { status: 500 },
    )
  }
}
