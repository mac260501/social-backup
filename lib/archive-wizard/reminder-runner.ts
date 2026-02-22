import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildArchiveReminderEmail,
  resolveReminderStage,
  type ArchiveReminderStage,
} from '@/lib/archive-wizard/reminder-email'

const supabase = createAdminClient()
const TWITTER_SETTINGS_URL = 'https://x.com/settings/download_your_data'

type ReminderCandidate = {
  id: string
  display_name: string | null
  archive_request_status: string | null
  archive_requested_at: string | null
  archive_reminder_count: number | null
  archive_last_reminder_at: string | null
}

export type ArchiveReminderRunSummary = {
  success: true
  scanned: number
  sent: number
  skipped: number
  failed: number
  details: Array<{
    userId: string
    stage?: ArchiveReminderStage
    status: 'sent' | 'skipped' | 'failed'
    reason?: string
  }>
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function toFirstName(displayName: string | null, email: string) {
  const fromName = displayName?.trim()?.split(/\s+/)?.[0]
  if (fromName && fromName.length > 0) return fromName
  return email.split('@')[0] || 'there'
}

function normalizeBaseUrl() {
  const candidates = [
    process.env.APP_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXTAUTH_URL,
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    if (!trimmed) continue
    return trimmed.replace(/\/$/, '')
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Missing app base URL env. Set APP_BASE_URL (or NEXTAUTH_URL / NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL).')
  }

  return 'http://localhost:3000'
}

function resolveReminderFromEmail() {
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim()
  if (fromEmail) return fromEmail

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Missing RESEND_FROM_EMAIL environment variable in production.')
  }

  return 'onboarding@resend.dev'
}

export async function runArchiveReminderCycle(limit = 500): Promise<ArchiveReminderRunSummary> {
  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    throw new Error('Missing RESEND_API_KEY environment variable')
  }

  const resend = new Resend(resendApiKey)
  const fromEmail = resolveReminderFromEmail()
  const continueUrl = `${normalizeBaseUrl()}/dashboard/archive-wizard?step=2`

  const { data: candidates, error: fetchError } = await supabase
    .from('profiles')
    .select('id, display_name, archive_request_status, archive_requested_at, archive_reminder_count, archive_last_reminder_at')
    .in('archive_request_status', ['pending', 'pending_extended'])
    .not('archive_requested_at', 'is', null)
    .limit(limit)

  if (fetchError) {
    throw new Error(`Failed to load reminder candidates: ${fetchError.message}`)
  }

  const summary: ArchiveReminderRunSummary = {
    success: true,
    scanned: (candidates || []).length,
    sent: 0,
    skipped: 0,
    failed: 0,
    details: [],
  }

  for (const profile of (candidates || []) as ReminderCandidate[]) {
    const reminderCount = parseNumber(profile.archive_reminder_count)
    const stage = resolveReminderStage({
      reminderCount,
      requestedAtIso: profile.archive_requested_at,
      lastReminderAtIso: profile.archive_last_reminder_at,
    })

    if (!stage) {
      summary.skipped += 1
      summary.details.push({ userId: profile.id, status: 'skipped', reason: 'Not due yet' })
      continue
    }

    const userResult = await supabase.auth.admin.getUserById(profile.id)
    const userEmail = userResult.data.user?.email

    if (!userEmail) {
      summary.failed += 1
      summary.details.push({ userId: profile.id, stage, status: 'failed', reason: 'No email found on auth user' })
      continue
    }

    const firstName = toFirstName(profile.display_name, userEmail)
    const message = buildArchiveReminderEmail(stage, {
      firstName,
      continueUrl,
      twitterSettingsUrl: TWITTER_SETTINGS_URL,
    })

    const sendResult = await resend.emails.send({
      from: fromEmail,
      to: userEmail,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })

    if (sendResult.error) {
      summary.failed += 1
      summary.details.push({
        userId: profile.id,
        stage,
        status: 'failed',
        reason: sendResult.error.message || 'Resend returned an unknown error',
      })
      continue
    }

    const nextReminderCount = Math.max(reminderCount + 1, stage)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        archive_reminder_count: nextReminderCount,
        archive_last_reminder_at: new Date().toISOString(),
      })
      .eq('id', profile.id)

    if (updateError) {
      summary.failed += 1
      summary.details.push({
        userId: profile.id,
        stage,
        status: 'failed',
        reason: `Email sent but failed to update reminder state: ${updateError.message}`,
      })
      continue
    }

    summary.sent += 1
    summary.details.push({ userId: profile.id, stage, status: 'sent' })
  }

  return summary
}
