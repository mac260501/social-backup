import { Resend } from 'resend'
import { createShareToken } from '@/lib/share-links'

type SendBackupReadyEmailParams = {
  email: string
  backupId: string
  appBaseUrl: string
}

const APP_BASE_URL_CANDIDATES = [
  'APP_BASE_URL',
  'NEXTAUTH_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SITE_URL',
] as const

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function resolveConfiguredAppBaseUrl(): string | null {
  for (const name of APP_BASE_URL_CANDIDATES) {
    const value = readTrimmed(process.env[name]).replace(/\/+$/, '')
    if (/^https?:\/\//i.test(value)) return value
  }
  return null
}

export function buildBackupShareUrl(
  backupId: string,
  appBaseUrl: string,
): { shareUrl: string; expiresAtEpochSeconds: number } {
  const normalizedBase = appBaseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalizedBase)) {
    throw new Error('A valid app base URL is required to create reminder links.')
  }
  const { token, expiresAtEpochSeconds } = createShareToken(backupId)
  return {
    shareUrl: `${normalizedBase}/shared/${token}`,
    expiresAtEpochSeconds,
  }
}

export async function sendBackupReadyEmail(params: SendBackupReadyEmailParams): Promise<{
  shareUrl: string
  expiresAtEpochSeconds: number
}> {
  const email = readTrimmed(params.email).toLowerCase()
  if (!email) {
    throw new Error('Valid email is required.')
  }

  const resendApiKey = readTrimmed(process.env.RESEND_API_KEY)
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY is not configured.')
  }

  const fromEmail = readTrimmed(process.env.RESEND_FROM_EMAIL) || 'Social Backup <onboarding@resend.dev>'
  const { shareUrl, expiresAtEpochSeconds } = buildBackupShareUrl(params.backupId, params.appBaseUrl)
  const escapedShareUrl = escapeHtml(shareUrl)
  const expiresAtLabel = new Date(expiresAtEpochSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  const resend = new Resend(resendApiKey)
  await resend.emails.send({
    from: fromEmail,
    to: [email],
    subject: 'Your Social Backup is ready',
    text: [
      'Your backup is ready.',
      `Open: ${shareUrl}`,
      `This URL expires on ${expiresAtLabel}.`,
    ].join('\n'),
    html: `
      <div style="margin:0;padding:0;background:#f5f5f5;color:#111827;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0a0a0a;border:1px solid #262626;border-radius:16px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 28px 20px 28px;">
                    <p style="margin:0 0 10px 0;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#a3a3a3;">Social Backup</p>
                    <h1 style="margin:0;color:#fafafa;font-size:28px;line-height:1.2;font-weight:700;">Your backup is ready.</h1>
                    <p style="margin:12px 0 0 0;color:#cbd5e1;font-size:15px;line-height:1.6;">
                      Open your snapshot in the backup viewer.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 24px 28px;">
                    <a href="${escapedShareUrl}" style="display:inline-block;background:#fafafa;color:#111827;text-decoration:none;font-weight:600;font-size:14px;padding:11px 16px;border-radius:10px;">Open Backup</a>
                    <p style="margin:14px 0 0 0;color:#a3a3a3;font-size:12px;line-height:1.5;">
                      This link is valid until <strong style="color:#d4d4d8;">${escapeHtml(expiresAtLabel)}</strong>.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 28px 28px;">
                    <p style="margin:0;color:#71717a;font-size:11px;line-height:1.5;">
                      If the button does not work, copy and paste this URL:<br />
                      <span style="word-break:break-all;color:#a1a1aa;">${escapedShareUrl}</span>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `,
  })

  return {
    shareUrl,
    expiresAtEpochSeconds,
  }
}
