import { Resend } from 'resend'

type AdminEventEmailParams = {
  subject: string
  title: string
  details: Array<{ label: string; value: string }>
}

const DEFAULT_ADMIN_NOTIFICATION_EMAIL = 'mac.26.05.01@gmail.com'

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

function resolveNotificationRecipient(): string {
  return (
    readTrimmed(process.env.ADMIN_NOTIFICATION_EMAIL)
    || readTrimmed(process.env.SIGNUP_NOTIFICATION_EMAIL)
    || DEFAULT_ADMIN_NOTIFICATION_EMAIL
  )
}

export async function sendAdminEventEmail(params: AdminEventEmailParams): Promise<void> {
  const resendApiKey = readTrimmed(process.env.RESEND_API_KEY)
  if (!resendApiKey) return

  const notificationEmail = resolveNotificationRecipient()
  if (!notificationEmail) return

  const fromEmail = readTrimmed(process.env.RESEND_FROM_EMAIL) || 'Social Backup <onboarding@resend.dev>'
  const normalizedDetails = params.details
    .map((item) => ({
      label: readTrimmed(item.label),
      value: readTrimmed(item.value) || 'Not provided',
    }))
    .filter((item) => item.label.length > 0)

  const textBody = [
    params.title,
    '',
    ...normalizedDetails.map((item) => `${item.label}: ${item.value}`),
  ].join('\n')

  const htmlRows = normalizedDetails
    .map((item) => {
      const safeLabel = escapeHtml(item.label)
      const safeValue = escapeHtml(item.value)
      return `<p style="margin:0 0 8px;color:#d4d4d8;font-size:13px;line-height:1.5;"><strong style="color:#fafafa;">${safeLabel}:</strong> ${safeValue}</p>`
    })
    .join('')

  const resend = new Resend(resendApiKey)
  await resend.emails.send({
    from: fromEmail,
    to: [notificationEmail],
    subject: params.subject,
    text: textBody,
    html: `
      <div style="margin:0;padding:24px;background:#f5f5f5;color:#111827;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0a0a0a;border:1px solid #262626;border-radius:16px;overflow:hidden;">
                <tr>
                  <td style="padding:24px 24px 18px 24px;">
                    <p style="margin:0 0 10px 0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#a3a3a3;">Social Backup</p>
                    <h2 style="margin:0;color:#fafafa;font-size:24px;line-height:1.25;font-weight:700;">${escapeHtml(params.title)}</h2>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 24px 24px 24px;">
                    ${htmlRows}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `,
  })
}
