export type ArchiveReminderStage = 1 | 2 | 3 | 4

export type ArchiveReminderEmail = {
  subject: string
  html: string
  text: string
}

type ReminderTemplateInput = {
  firstName: string
  continueUrl: string
  twitterSettingsUrl: string
}

function ctaButton(label: string, href: string) {
  return `<a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:linear-gradient(180deg,#32a7ff 0%,#1576e8 100%);color:#ffffff;text-decoration:none;font-weight:600;">${label}</a>`
}

function wrapEmail(body: string) {
  return `
    <div style="margin:0;padding:24px;background:#050813;font-family:Inter,Arial,Helvetica,sans-serif;color:#e5e7eb;">
      <div style="max-width:600px;margin:0 auto;background:#0b1220;border:1px solid #1f2937;border-radius:16px;padding:28px;">
        <div style="display:flex;align-items:center;gap:8px;margin:0 0 14px;">
          <p style="margin:0;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#9ca3af;">Social Backup</p>
          <span style="display:inline-block;border:1px solid #22d3ee66;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#22d3ee;">Beta</span>
        </div>
        ${body}
        <p style="margin:22px 0 0;font-size:13px;color:#94a3b8;">- Social Backup</p>
      </div>
    </div>
  `
}

export function buildArchiveReminderEmail(stage: ArchiveReminderStage, input: ReminderTemplateInput): ArchiveReminderEmail {
  const { firstName, continueUrl, twitterSettingsUrl } = input

  if (stage === 1) {
    const subject = 'Your Twitter archive is probably ready!'
    const html = wrapEmail(`
      <h2 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#ffffff;">Your Twitter archive is likely ready</h2>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#cbd5e1;">Hey ${firstName}, you requested your Twitter archive about 24 hours ago, so it should be ready to download now.</p>
      <div style="margin:0 0 18px;padding:14px;border:1px solid #334155;border-radius:12px;background:#020617;">
        <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#cbd5e1;"><strong>1.</strong> Download your archive from Twitter</p>
        <p style="margin:0 0 10px;"><a href="${twitterSettingsUrl}" style="color:#7dd3fc;word-break:break-all;">${twitterSettingsUrl}</a></p>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#cbd5e1;"><strong>2.</strong> Upload it to Social Backup</p>
        <p style="margin:0;"><a href="${continueUrl}" style="color:#7dd3fc;word-break:break-all;">${continueUrl}</a></p>
      </div>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#cbd5e1;">This usually takes about 2 minutes and gives you a complete backup of your Twitter data.</p>
      <div>${ctaButton('Continue Setup', continueUrl)}</div>
    `)

    return {
      subject,
      html,
      text:
        `Hey ${firstName},\n\n` +
        `You requested your Twitter archive about 24 hours ago. It should be ready now.\n\n` +
        `1) Download from Twitter: ${twitterSettingsUrl}\n` +
        `2) Continue setup: ${continueUrl}\n\n` +
        `- Social Backup`,
    }
  }

  if (stage === 2) {
    const subject = 'Quick reminder: your Twitter archive is waiting'
    const html = wrapEmail(`
      <h2 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#ffffff;">Quick reminder</h2>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#cbd5e1;">Hey ${firstName}, your Twitter archive should be ready to download.</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#cbd5e1;">Upload it to lock in a complete backup of your tweets, followers, following, likes, DMs, and media.</p>
      <div>${ctaButton('Finish Your Backup', continueUrl)}</div>
    `)

    return {
      subject,
      html,
      text:
        `Hey ${firstName},\n\n` +
        `Your Twitter archive should be ready.\n` +
        `Finish your backup: ${continueUrl}\n\n` +
        `- Social Backup`,
    }
  }

  if (stage === 3) {
    const subject = "Don't lose your Twitter data"
    const html = wrapEmail(`
      <h2 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#ffffff;">Don&apos;t lose your Twitter data</h2>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#cbd5e1;">Hey ${firstName}, Twitter archives can expire, so don&apos;t wait too long to download yours.</p>
      <div style="margin:0 0 16px;">${ctaButton('Download & Upload Now', continueUrl)}</div>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#cbd5e1;">Once uploaded, your data will be safely backed up in Social Backup.</p>
    `)

    return {
      subject,
      html,
      text:
        `Hey ${firstName},\n\n` +
        `Twitter archives can expire, so don't wait too long.\n` +
        `Continue setup: ${continueUrl}\n\n` +
        `- Social Backup`,
    }
  }

  const subject = 'Still want to back up your Twitter?'
  const html = wrapEmail(`
    <h2 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#ffffff;">Still want to back up your Twitter?</h2>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#cbd5e1;">Hey ${firstName}, if you still want to secure your Twitter history, you can finish setup in a couple minutes.</p>
    <div>${ctaButton('Resume Backup Setup', continueUrl)}</div>
  `)

  return {
    subject,
    html,
    text:
      `Hey ${firstName},\n\n` +
      `You can still finish your Twitter backup anytime.\n` +
      `Resume setup: ${continueUrl}\n\n` +
      `- Social Backup`,
  }
}

export function resolveReminderStage(params: {
  reminderCount: number
  requestedAtIso: string | null
  lastReminderAtIso: string | null
  now?: Date
}): ArchiveReminderStage | null {
  const now = params.now ?? new Date()
  const requestedAtMs = params.requestedAtIso ? new Date(params.requestedAtIso).getTime() : NaN
  if (!Number.isFinite(requestedAtMs)) return null

  const lastReminderMs = params.lastReminderAtIso ? new Date(params.lastReminderAtIso).getTime() : NaN
  const hoursSinceRequest = (now.getTime() - requestedAtMs) / (1000 * 60 * 60)
  const hoursSinceLastReminder = Number.isFinite(lastReminderMs)
    ? (now.getTime() - lastReminderMs) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY

  if (params.reminderCount <= 0 && hoursSinceRequest >= 24) {
    return 1
  }

  if (params.reminderCount === 1 && hoursSinceRequest >= 48 && hoursSinceLastReminder >= 20) {
    return 2
  }

  if (params.reminderCount === 2 && hoursSinceRequest >= 72 && hoursSinceLastReminder >= 20) {
    return 3
  }

  if (params.reminderCount >= 3 && params.reminderCount < 4 && hoursSinceRequest >= 24 * 7 && hoursSinceLastReminder >= 24) {
    return 4
  }

  return null
}
