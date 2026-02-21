import { NextResponse } from 'next/server'
import { ApifyClient } from 'apify-client'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { deleteBackupAndStorageById, type BackupDeleteResult } from '@/lib/backups/delete-backup-data'
import { deleteObjectsFromR2 } from '@/lib/storage/r2'
import {
  getBackupJobForUser,
  markBackupJobCleanup,
  markBackupJobFailed,
  mergeBackupJobPayload,
  requestBackupJobCancellation,
} from '@/lib/jobs/backup-jobs'

const supabase = createAdminClient()

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

type ApifyAbortResult = {
  runId: string
  aborted: boolean
  error?: string
}

function parseApifyRunIds(payload: Record<string, unknown>): string[] {
  const apifyRuns = toRecord(payload.apify_runs)
  const ids = [
    asString(apifyRuns.timeline_run_id),
    asString(apifyRuns.social_graph_run_id),
  ].filter((id): id is string => Boolean(id))
  return Array.from(new Set(ids))
}

async function abortApifyRuns(runIds: string[]): Promise<ApifyAbortResult[]> {
  if (runIds.length === 0) return []
  const token = process.env.APIFY_API_KEY
  if (!token) {
    return runIds.map((runId) => ({
      runId,
      aborted: false,
      error: 'APIFY_API_KEY is not configured.',
    }))
  }

  const client = new ApifyClient({ token })
  const results: ApifyAbortResult[] = []
  for (const runId of runIds) {
    try {
      await client.run(runId).abort({ gracefully: false })
      results.push({ runId, aborted: true })
    } catch (error) {
      results.push({
        runId,
        aborted: false,
        error: error instanceof Error ? error.message : 'Failed to abort run',
      })
    }
  }
  return results
}

export async function POST(request: Request) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const jobId = asString((body as Record<string, unknown>).jobId)

    if (!jobId) {
      return NextResponse.json({ success: false, error: 'jobId is required.' }, { status: 400 })
    }

    const job = await getBackupJobForUser(supabase, jobId, user.id)
    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found.' }, { status: 404 })
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return NextResponse.json({
        success: true,
        message: 'Job already finished.',
        job,
      })
    }

    await requestBackupJobCancellation(supabase, jobId)

    const latestJob = await getBackupJobForUser(supabase, jobId, user.id)
    const payload = toRecord(latestJob?.payload || job.payload)
    const apifyRunIds = parseApifyRunIds(payload)
    const apifyAbortResults = await abortApifyRuns(apifyRunIds)

    await markBackupJobCleanup(
      supabase,
      jobId,
      'Cancellation requested. Stopping provider and cleaning up partial data...',
    )
    const candidateBackupId = asString(latestJob?.result_backup_id || job.result_backup_id)
      || asString(payload.partial_backup_id)
      || asString(payload.created_backup_id)
      || null
    const stagedInputPath = asString(payload.staged_input_path) || asString(payload.input_storage_path)

    let backupCleanupResult: BackupDeleteResult | null = null

    if (candidateBackupId) {
      try {
        backupCleanupResult = await deleteBackupAndStorageById(supabase, {
          backupId: candidateBackupId,
          expectedUserId: user.id,
        })
      } catch (cleanupError) {
        console.error('[Cancel Job] Backup cleanup error:', cleanupError)
      }
    }

    let stagedInputRemoved = false
    if (stagedInputPath) {
      try {
        await deleteObjectsFromR2([stagedInputPath])
        stagedInputRemoved = true
      } catch (removeError) {
        console.warn('[Cancel Job] Failed to remove staged input:', removeError)
      }
    }

    await mergeBackupJobPayload(supabase, jobId, {
      lifecycle_state: 'cancelled',
      cleanup_completed_at: new Date().toISOString(),
      cleanup: {
        backup_id: candidateBackupId,
        backup_cleanup: backupCleanupResult,
        staged_input_removed: stagedInputRemoved,
        apify_abort_results: apifyAbortResults,
      },
      apify_runs: {
        timeline_run_id: null,
        social_graph_run_id: null,
      },
    })

    await markBackupJobFailed(supabase, jobId, 'Cancelled by user', 'Cancelled')

    return NextResponse.json({
      success: true,
      message: 'Job cancelled and cleanup completed.',
      details: {
        backupId: candidateBackupId,
        backupCleanup: backupCleanupResult,
        stagedInputRemoved,
        apifyAbortResults,
      },
    })
  } catch (error) {
    console.error('[Cancel Job] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel job',
    }, { status: 500 })
  }
}
