import { NextResponse } from 'next/server'
import { runArchiveReminderCycle } from '@/lib/archive-wizard/reminder-runner'

function isAuthorized(request: Request) {
  const secret = process.env.ARCHIVE_REMINDER_CRON_SECRET
  if (!secret) {
    return process.env.NODE_ENV !== 'production'
  }

  const authHeader = request.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`
  return authHeader === expected
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized cron invocation' }, { status: 401 })
    }

    const summary = await runArchiveReminderCycle(500)
    return NextResponse.json(summary)
  } catch (error) {
    console.error('[Archive Wizard] Reminder cron failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Reminder cron failed',
      },
      { status: 500 },
    )
  }
}
