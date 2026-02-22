import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

type NewSignupNotificationBody = {
  userId?: string
  email?: string
  fullName?: string
}

const DEFAULT_NOTIFICATION_EMAIL = 'mac.26.05.01@gmail.com'
const MAX_NOTIFICATION_AGE_MS = 30 * 60 * 1000

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readMetadataName(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return ''
  const record = metadata as Record<string, unknown>
  return (
    readTrimmed(record.full_name) ||
    readTrimmed(record.name) ||
    readTrimmed(record.display_name)
  )
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function POST(request: Request) {
  try {
    const resendApiKey = readTrimmed(process.env.RESEND_API_KEY)
    if (!resendApiKey) {
      return NextResponse.json({ success: true, skipped: true })
    }

    const body = (await request.json().catch(() => ({}))) as NewSignupNotificationBody
    const userId = readTrimmed(body.userId)
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: userResult, error: userError } = await supabase.auth.admin.getUserById(userId)
    if (userError || !userResult?.user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    const user = userResult.user
    const verifiedEmail = readTrimmed(user.email).toLowerCase()
    if (!verifiedEmail) {
      return NextResponse.json({ success: false, error: 'User email not found' }, { status: 400 })
    }
    const appMetadata = toRecord(user.app_metadata)
    const alreadySentAt = readTrimmed(appMetadata.signup_notification_sent_at)
    if (alreadySentAt) {
      return NextResponse.json({ success: true, skipped: true })
    }

    const requestedEmail = readTrimmed(body.email).toLowerCase()
    if (requestedEmail && requestedEmail !== verifiedEmail) {
      return NextResponse.json({ success: false, error: 'Email mismatch' }, { status: 400 })
    }

    const createdAtMs = Date.parse(readTrimmed(user.created_at))
    if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > MAX_NOTIFICATION_AGE_MS) {
      return NextResponse.json({ success: true, skipped: true })
    }

    const notificationEmail =
      readTrimmed(process.env.SIGNUP_NOTIFICATION_EMAIL) || DEFAULT_NOTIFICATION_EMAIL
    const fromEmail =
      readTrimmed(process.env.RESEND_FROM_EMAIL) || 'Social Backup <onboarding@resend.dev>'
    const fullName = readTrimmed(body.fullName) || readMetadataName(user.user_metadata)
    const providerList = Array.isArray(user.identities)
      ? user.identities
          .map((identity) => readTrimmed(identity.provider))
          .filter(Boolean)
      : []
    const providers = providerList.length > 0 ? providerList.join(', ') : 'email'
    const createdAtLabel = Number.isFinite(createdAtMs)
      ? new Date(createdAtMs).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : 'Unknown'
    const safeEmail = escapeHtml(verifiedEmail)
    const safeName = escapeHtml(fullName || 'Not provided')
    const safeUserId = escapeHtml(user.id)
    const safeProviders = escapeHtml(providers)
    const safeCreatedAtLabel = escapeHtml(createdAtLabel)

    const resend = new Resend(resendApiKey)
    await resend.emails.send({
      from: fromEmail,
      to: [notificationEmail],
      subject: 'New user signup',
      text: [
        'A new user signed up.',
        `Email: ${verifiedEmail}`,
        `Name: ${fullName || 'Not provided'}`,
        `User ID: ${user.id}`,
        `Provider: ${providers}`,
        `Created: ${createdAtLabel}`,
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
          <h2 style="margin:0 0 12px">New user signup</h2>
          <p style="margin:0 0 8px"><strong>Email:</strong> ${safeEmail}</p>
          <p style="margin:0 0 8px"><strong>Name:</strong> ${safeName}</p>
          <p style="margin:0 0 8px"><strong>User ID:</strong> ${safeUserId}</p>
          <p style="margin:0 0 8px"><strong>Provider:</strong> ${safeProviders}</p>
          <p style="margin:0"><strong>Created:</strong> ${safeCreatedAtLabel}</p>
        </div>
      `,
    })

    const updateMetadataResult = await supabase.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...appMetadata,
        signup_notification_sent_at: new Date().toISOString(),
      },
    })
    if (updateMetadataResult.error) {
      console.warn('[New Signup Notification] Sent email but failed to set app metadata flag:', updateMetadataResult.error)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[New Signup Notification] Failed to send:', error)
    return NextResponse.json({ success: false, error: 'Failed to send notification' }, { status: 500 })
  }
}
