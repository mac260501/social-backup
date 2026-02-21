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
  return `<a href="${href}" style="display:inline-block;padding:12px 20px;background:#1576e8;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:600;">${label}</a>`
}

function wrapEmail(body: string) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#111827;max-width:600px;margin:0 auto;padding:24px;">
      ${body}
      <p style="margin-top:24px;color:#4b5563;">- Social Backup</p>
    </div>
  `
}

export function buildArchiveReminderEmail(stage: ArchiveReminderStage, input: ReminderTemplateInput): ArchiveReminderEmail {
  const { firstName, continueUrl, twitterSettingsUrl } = input

  if (stage === 1) {
    const subject = 'Your Twitter archive is probably ready!'
    const html = wrapEmail(`
      <p>Hey ${firstName},</p>
      <p>You requested your Twitter archive about 24 hours ago. It should be ready to download now.</p>
      <p>1. Download your archive from Twitter<br /><a href="${twitterSettingsUrl}">${twitterSettingsUrl}</a></p>
      <p>2. Upload it to Social Backup<br /><a href="${continueUrl}">${continueUrl}</a></p>
      <p>This takes about 2 minutes and gives you a complete backup of your Twitter data.</p>
      <p>${ctaButton('Continue Setup', continueUrl)}</p>
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
      <p>Hey ${firstName},</p>
      <p>Quick reminder: your Twitter archive should be ready to download.</p>
      <p>Once you upload it, you'll have a complete backup of your tweets, followers, likes, DMs, and media.</p>
      <p>${ctaButton('Finish Your Backup', continueUrl)}</p>
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
      <p>Hey ${firstName},</p>
      <p>Twitter archives can expire, so don't wait too long to download yours.</p>
      <p>${ctaButton('Download & Upload Now', continueUrl)}</p>
      <p>After this, your data will be safely backed up.</p>
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
    <p>Hey ${firstName},</p>
    <p>If you still want to secure your Twitter history, you can finish setup in a couple minutes.</p>
    <p>${ctaButton('Resume Backup Setup', continueUrl)}</p>
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
