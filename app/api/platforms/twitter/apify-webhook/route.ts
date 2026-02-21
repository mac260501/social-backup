import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { markBackupJobFailed, mergeBackupJobPayload } from '@/lib/jobs/backup-jobs'

const supabase = createAdminClient()
const TERMINAL_FAILURE_EVENTS = new Set([
  'ACTOR.RUN.FAILED',
  'ACTOR.RUN.TIMED_OUT',
  'ACTOR.RUN.ABORTED',
])

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseRunType(value: unknown): 'timeline' | 'social_graph' | null {
  const normalized = asString(value)?.toLowerCase()
  if (normalized === 'timeline') return 'timeline'
  if (normalized === 'social_graph') return 'social_graph'
  return null
}

function parseEventType(body: Record<string, unknown>): string | null {
  return asString(body.eventType) || asString(body.event_type)
}

function parseActorRunId(body: Record<string, unknown>): string | null {
  const eventData = toRecord(body.eventData || body.event_data)
  return asString(eventData.actorRunId) || asString(body.actorRunId)
}

function toEventHistory(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[]
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url)
    const expectedToken = process.env.APIFY_WEBHOOK_SECRET?.trim()
    const receivedToken = asString(url.searchParams.get('token'))

    if (!expectedToken && process.env.NODE_ENV === 'production') {
      console.error('[Apify Webhook] APIFY_WEBHOOK_SECRET is not configured in production.')
      return NextResponse.json({ success: false, error: 'Webhook is not configured' }, { status: 503 })
    }

    if (expectedToken && expectedToken !== receivedToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const payload = toRecord(body)
    const payloadRoot = toRecord(payload.payload)

    const jobId =
      asString(url.searchParams.get('jobId'))
      || asString(payload.jobId)
      || asString(payloadRoot.jobId)
    const runType =
      parseRunType(url.searchParams.get('runType'))
      || parseRunType(payload.runType)
      || parseRunType(payloadRoot.runType)
    const eventType = parseEventType(payload)
    const actorRunId = parseActorRunId(payload)

    if (!jobId) {
      return NextResponse.json({ success: true, acknowledged: true, ignored: 'Missing jobId' })
    }

    const { data: job, error: jobError } = await supabase
      .from('backup_jobs')
      .select('id, status, payload')
      .eq('id', jobId)
      .maybeSingle()

    if (jobError || !job) {
      return NextResponse.json({ success: true, acknowledged: true, ignored: 'Job not found' })
    }

    const currentPayload = toRecord(job.payload)
    const currentRuns = toRecord(currentPayload.apify_runs)
    const nowIso = new Date().toISOString()
    const nextRuns: Record<string, unknown> = { ...currentRuns }

    if (runType) {
      const runIdKey = `${runType}_run_id`
      if (actorRunId && !asString(currentRuns[runIdKey])) {
        nextRuns[runIdKey] = actorRunId
      }
      nextRuns[`${runType}_last_event`] = eventType
      nextRuns[`${runType}_last_event_at`] = nowIso
    }

    const eventRecord: Record<string, unknown> = {
      received_at: nowIso,
      event_type: eventType,
      run_type: runType,
      actor_run_id: actorRunId,
    }
    const nextEvents = [eventRecord, ...toEventHistory(currentPayload.apify_webhook_events)].slice(0, 25)

    await mergeBackupJobPayload(supabase, jobId, {
      apify_runs: nextRuns,
      apify_webhook_last_event: eventRecord,
      apify_webhook_events: nextEvents,
    })

    if (eventType && TERMINAL_FAILURE_EVENTS.has(eventType) && (job.status === 'queued' || job.status === 'processing')) {
      await markBackupJobFailed(
        supabase,
        jobId,
        `Apify ${runType || 'run'} failed with ${eventType}.`,
        'Provider failed',
      )
    }

    return NextResponse.json({
      success: true,
      acknowledged: true,
      details: {
        jobId,
        runType,
        eventType,
        actorRunId,
      },
    })
  } catch (error) {
    console.error('[Apify Webhook] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to process webhook' }, { status: 500 })
  }
}
