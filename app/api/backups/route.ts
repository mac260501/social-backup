import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findActiveBackupJobForUser, listBackupJobsForUser } from '@/lib/jobs/backup-jobs'
import { USER_STORAGE_LIMITS } from '@/lib/platforms/twitter/limits'
import { getTwitterApiUsageSummary } from '@/lib/platforms/twitter/api-usage'
import { deleteBackupAndStorageById } from '@/lib/backups/delete-backup-data'
import { isGuestBackupExpired } from '@/lib/backups/retention'
import { getRequestActorId } from '@/lib/request-actor'
import { calculateUserStorageSummary } from '@/lib/storage/usage'

const supabase = createAdminClient()

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET(request: Request) {
  try {
    const actorId = await getRequestActorId()
    if (!actorId) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized'
      }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    // Keep backward compatibility with callers that still send userId.
    if (userId && userId !== actorId) {
      console.warn(`[Security] User ${actorId} attempted to fetch backups for user ${userId}`)
      return NextResponse.json({
        success: false,
        error: 'Forbidden - you can only access your own backups'
      }, { status: 403 })
    }

    // Reconcile stale queued jobs before loading dashboard payload.
    await findActiveBackupJobForUser(supabase, actorId)

    const [{ data, error }, jobs, storageSummary, apiUsage] = await Promise.all([
      supabase
        .from('backups')
        .select('*')
        .eq('user_id', actorId)
        .order('uploaded_at', { ascending: false }),
      listBackupJobsForUser(supabase, actorId, 20),
      calculateUserStorageSummary(supabase, actorId),
      getTwitterApiUsageSummary(supabase, actorId),
    ])

    if (error) {
      console.error('Failed to fetch backups:', error)
      throw new Error(`Failed to fetch backups: ${error.message}`)
    }

    const activeJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'processing')
    const hiddenBackupIds = new Set<string>()
    for (const job of activeJobs) {
      const payload = toRecord(job.payload)
      const partialBackupId = asNonEmptyString(payload.partial_backup_id)
      const createdBackupId = asNonEmptyString(payload.created_backup_id)
      const resultBackupId = asNonEmptyString(job.result_backup_id)
      if (partialBackupId) hiddenBackupIds.add(partialBackupId)
      if (createdBackupId) hiddenBackupIds.add(createdBackupId)
      if (resultBackupId) hiddenBackupIds.add(resultBackupId)
    }
    const visibleBackups = (data || []).filter((backup) => !hiddenBackupIds.has(String(backup.id)))
    const nowMs = Date.now()
    const nonExpiredBackups: typeof visibleBackups = []
    for (const backup of visibleBackups) {
      if (isGuestBackupExpired(backup.data, nowMs)) {
        try {
          await deleteBackupAndStorageById(supabase, {
            backupId: String(backup.id),
            expectedUserId: actorId,
          })
        } catch (cleanupError) {
          console.error(`[Backups API] Failed to delete expired backup ${backup.id}:`, cleanupError)
        }
        continue
      }
      nonExpiredBackups.push(backup)
    }

    return NextResponse.json({
      success: true,
      backups: nonExpiredBackups,
      jobs,
      storage: {
        ...storageSummary,
        limitBytes: USER_STORAGE_LIMITS.maxTotalBytes,
        remainingBytes: Math.max(0, USER_STORAGE_LIMITS.maxTotalBytes - storageSummary.totalBytes),
      },
      apiUsage,
    })

  } catch (error) {
    console.error('Fetch backups error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch backups',
    }, { status: 500 })
  }
}
