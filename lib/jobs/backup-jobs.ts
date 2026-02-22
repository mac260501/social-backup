import type { SupabaseClient } from '@supabase/supabase-js'

type JsonObject = Record<string, unknown>

export type BackupJobType = 'archive_upload' | 'snapshot_scrape'
export type BackupJobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export type BackupJob = {
  id: string
  user_id: string
  job_type: BackupJobType
  status: BackupJobStatus
  progress: number
  message: string | null
  payload: JsonObject | null
  result_backup_id: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export const ACTIVE_BACKUP_JOB_STATUSES: BackupJobStatus[] = ['queued', 'processing']
const QUEUED_JOB_TIMEOUT_MS = 5 * 60 * 1000

function normalizeProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0
  if (progress < 0) return 0
  if (progress > 100) return 100
  return Math.round(progress)
}

function nowIso() {
  return new Date().toISOString()
}

function toJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

export async function findActiveBackupJobForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<BackupJob | null> {
  const loadActiveJob = async () => {
    const { data, error } = await supabase
      .from('backup_jobs')
      .select('*')
      .eq('user_id', userId)
      .in('status', ACTIVE_BACKUP_JOB_STATUSES)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to load active backup jobs: ${error.message}`)
    }

    return (data as BackupJob | null) ?? null
  }

  const activeJob = await loadActiveJob()
  if (!activeJob) return null

  const startedAt = activeJob.started_at ? Date.parse(activeJob.started_at) : Number.NaN
  const createdAt = Date.parse(activeJob.created_at)
  const ageMs = Number.isFinite(startedAt)
    ? Date.now() - startedAt
    : Number.isFinite(createdAt)
      ? Date.now() - createdAt
      : 0

  if (activeJob.status === 'queued' && ageMs > QUEUED_JOB_TIMEOUT_MS) {
    const timeoutMinutes = Math.round(QUEUED_JOB_TIMEOUT_MS / 60000)
    const timeoutMessage =
      `Backup job did not start within ${timeoutMinutes} minutes. Please retry.`
    await updateBackupJob(supabase, activeJob.id, {
      status: 'failed',
      progress: Math.max(0, activeJob.progress || 0),
      message: timeoutMessage,
      errorMessage:
        'Queue timeout: worker did not pick up this job. Verify Inngest keys and environment wiring.',
    })
    await mergeBackupJobPayload(supabase, activeJob.id, {
      lifecycle_state: 'failed',
      queue_timeout: true,
      queue_timed_out_at: nowIso(),
    })
    return await loadActiveJob()
  }

  return activeJob
}

export async function createBackupJob(
  supabase: SupabaseClient,
  params: {
    userId: string
    jobType: BackupJobType
    payload?: JsonObject
    message?: string
  },
): Promise<BackupJob> {
  const { data, error } = await supabase
    .from('backup_jobs')
    .insert({
      user_id: params.userId,
      job_type: params.jobType,
      status: 'queued',
      progress: 0,
      payload: params.payload || {},
      message: params.message || 'Queued',
      updated_at: nowIso(),
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create backup job: ${error?.message || 'Unknown error'}`)
  }

  return data as BackupJob
}

export async function getBackupJobForUser(
  supabase: SupabaseClient,
  jobId: string,
  userId: string,
): Promise<BackupJob | null> {
  const { data, error } = await supabase
    .from('backup_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load backup job: ${error.message}`)
  }

  return (data as BackupJob | null) ?? null
}

export async function listBackupJobsForUser(
  supabase: SupabaseClient,
  userId: string,
  limit: number = 15,
): Promise<BackupJob[]> {
  const safeLimit = Math.max(1, Math.min(50, limit))
  const { data, error } = await supabase
    .from('backup_jobs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(safeLimit)

  if (error) {
    console.error('[Backup Jobs] Failed to list jobs:', error)
    return []
  }

  return (data as BackupJob[]) || []
}

export async function updateBackupJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: {
    status?: BackupJobStatus
    progress?: number
    message?: string
    errorMessage?: string | null
    backupId?: string | null
    payload?: JsonObject
  },
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    updated_at: nowIso(),
  }

  if (patch.status) {
    updatePayload.status = patch.status
    if (patch.status === 'processing') {
      updatePayload.started_at = nowIso()
    }
    if (patch.status === 'completed' || patch.status === 'failed') {
      updatePayload.completed_at = nowIso()
    }
  }

  if (typeof patch.progress === 'number') {
    updatePayload.progress = normalizeProgress(patch.progress)
  }

  if (typeof patch.message === 'string') {
    updatePayload.message = patch.message
  }

  if (patch.errorMessage !== undefined) {
    updatePayload.error_message = patch.errorMessage
  }

  if (patch.backupId !== undefined) {
    updatePayload.result_backup_id = patch.backupId
  }

  if (patch.payload !== undefined) {
    updatePayload.payload = patch.payload
  }

  const { error } = await supabase
    .from('backup_jobs')
    .update(updatePayload)
    .eq('id', jobId)

  if (error) {
    console.error(`[Backup Jobs] Failed to update job ${jobId}:`, error)
  }
}

export async function mergeBackupJobPayload(
  supabase: SupabaseClient,
  jobId: string,
  payloadPatch: JsonObject,
): Promise<BackupJob | null> {
  const { data: existing, error: loadError } = await supabase
    .from('backup_jobs')
    .select('id, payload')
    .eq('id', jobId)
    .maybeSingle()

  if (loadError) {
    console.error(`[Backup Jobs] Failed to load payload for job ${jobId}:`, loadError)
    return null
  }
  if (!existing) return null

  const mergedPayload = {
    ...toJsonObject(existing.payload),
    ...payloadPatch,
  }

  const { data: updated, error: updateError } = await supabase
    .from('backup_jobs')
    .update({
      payload: mergedPayload,
      updated_at: nowIso(),
    })
    .eq('id', jobId)
    .select('*')
    .maybeSingle()

  if (updateError) {
    console.error(`[Backup Jobs] Failed to merge payload for job ${jobId}:`, updateError)
    return null
  }

  return (updated as BackupJob | null) ?? null
}

export async function isBackupJobCancellationRequested(
  supabase: SupabaseClient,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('backup_jobs')
    .select('status, payload')
    .eq('id', jobId)
    .maybeSingle()

  if (error || !data) {
    if (error) {
      console.error(`[Backup Jobs] Failed to inspect cancellation for ${jobId}:`, error)
    }
    return false
  }

  const payload = toJsonObject(data.payload)
  return payload.cancel_requested === true
}

export async function requestBackupJobCancellation(
  supabase: SupabaseClient,
  jobId: string,
  reason: string = 'User requested cancellation.',
): Promise<BackupJob | null> {
  const { data: existing, error: loadError } = await supabase
    .from('backup_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()

  if (loadError) {
    throw new Error(`Failed to load backup job for cancellation: ${loadError.message}`)
  }
  if (!existing) return null

  const existingPayload = toJsonObject(existing.payload)
  const mergedPayload = {
    ...existingPayload,
    cancel_requested: true,
    cancel_requested_at: nowIso(),
    cancel_reason: reason,
    lifecycle_state: 'cancelling',
  }

  const nextStatus: BackupJobStatus =
    existing.status === 'queued' || existing.status === 'processing'
      ? 'processing'
      : existing.status

  const { data: updated, error: updateError } = await supabase
    .from('backup_jobs')
    .update({
      status: nextStatus,
      message: 'Cancellation requested. Cleaning up...',
      progress: Math.max(1, normalizeProgress(existing.progress || 1)),
      payload: mergedPayload,
      updated_at: nowIso(),
      ...(existing.started_at ? {} : { started_at: nowIso() }),
    })
    .eq('id', jobId)
    .select('*')
    .maybeSingle()

  if (updateError) {
    throw new Error(`Failed to request cancellation: ${updateError.message}`)
  }

  return (updated as BackupJob | null) ?? null
}

export async function markBackupJobCleanup(
  supabase: SupabaseClient,
  jobId: string,
  message: string,
): Promise<void> {
  await updateBackupJob(supabase, jobId, {
    status: 'processing',
    progress: 95,
    message,
  })
  await mergeBackupJobPayload(supabase, jobId, {
    lifecycle_state: 'cleanup',
  })
}

export async function markBackupJobProcessing(
  supabase: SupabaseClient,
  jobId: string,
  progress: number,
  message: string,
): Promise<void> {
  await updateBackupJob(supabase, jobId, {
    status: 'processing',
    progress,
    message,
    errorMessage: null,
  })
}

export async function markBackupJobProgress(
  supabase: SupabaseClient,
  jobId: string,
  progress: number,
  message: string,
): Promise<void> {
  await updateBackupJob(supabase, jobId, {
    progress,
    message,
  })
}

export async function markBackupJobCompleted(
  supabase: SupabaseClient,
  jobId: string,
  backupId: string | null,
  message: string,
): Promise<void> {
  await updateBackupJob(supabase, jobId, {
    status: 'completed',
    progress: 100,
    message,
    backupId,
    errorMessage: null,
  })
}

export async function markBackupJobFailed(
  supabase: SupabaseClient,
  jobId: string,
  errorMessage: string,
  statusMessage: string = 'Job failed',
): Promise<void> {
  await updateBackupJob(supabase, jobId, {
    status: 'failed',
    progress: 100,
    message: statusMessage,
    errorMessage,
  })
}
