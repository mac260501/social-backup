import { inngest } from '@/lib/inngest/client'
import {
  createBackupJob,
  findActiveBackupJobForUser,
  markBackupJobFailed,
  mergeBackupJobPayload,
} from '@/lib/jobs/backup-jobs'
import { isZipUpload, TWITTER_UPLOAD_LIMITS, USER_STORAGE_LIMITS } from '@/lib/platforms/twitter/limits'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateUserStorageSummary } from '@/lib/storage/usage'
import { deleteObjectsFromR2, normalizeStoragePath } from '@/lib/storage/r2'

const supabase = createAdminClient()

export type ArchiveUploadValidationInput = {
  userId: string
  fileName: string
  fileType?: string | null
  fileSize: number
}

export async function validateArchiveUploadRequest(input: ArchiveUploadValidationInput): Promise<void> {
  const { userId, fileName, fileType, fileSize } = input

  const activeJob = await findActiveBackupJobForUser(supabase, userId)
  if (activeJob) {
    throw new Error('A backup job is already in progress. Please wait for it to finish before starting another one.')
  }

  if (!isZipUpload(fileName, fileType || '')) {
    throw new Error('Invalid upload type. Please upload a .zip Twitter archive file.')
  }

  if (fileSize <= 0) {
    throw new Error('Uploaded file is empty.')
  }

  if (fileSize > TWITTER_UPLOAD_LIMITS.maxArchiveBytes) {
    throw new Error(`Archive exceeds size limit (${TWITTER_UPLOAD_LIMITS.maxArchiveBytes} bytes).`)
  }

  const storageSummary = await calculateUserStorageSummary(supabase, userId)
  const projectedTotalBytes = storageSummary.totalBytes + fileSize
  if (projectedTotalBytes > USER_STORAGE_LIMITS.maxTotalBytes) {
    throw new Error(
      `Storage limit exceeded. Current usage: ${storageSummary.totalBytes} bytes. Upload would raise usage to ${projectedTotalBytes} bytes, above the ${USER_STORAGE_LIMITS.maxTotalBytes} byte limit.`,
    )
  }
}

export function ensureUserScopedStagedPath(path: string, userId: string): string {
  const normalizedPath = normalizeStoragePath(path)
  if (!normalizedPath.startsWith(`${userId}/job-inputs/`)) {
    throw new Error('Invalid staged upload path.')
  }
  return normalizedPath
}

export async function enqueueArchiveUploadJob(params: {
  userId: string
  username: string
  fileName: string
  fileSize: number
  stagedInputPath: string
}) {
  const { userId, username, fileName, fileSize, stagedInputPath } = params

  const job = await createBackupJob(supabase, {
    userId,
    jobType: 'archive_upload',
    message: 'Archive uploaded. Waiting to process...',
    payload: {
      username,
      upload_file_name: fileName,
      upload_file_size: fileSize,
    },
  })

  await mergeBackupJobPayload(supabase, job.id, {
    staged_input_path: stagedInputPath,
    lifecycle_state: 'queued',
  })

  try {
    await inngest.send({
      name: 'backup/archive-upload.requested',
      data: {
        jobId: job.id,
        userId,
        username,
        inputStoragePath: stagedInputPath,
      },
    })
  } catch (enqueueError) {
    await markBackupJobFailed(
      supabase,
      job.id,
      `Failed to queue background processing: ${enqueueError instanceof Error ? enqueueError.message : 'Unknown error'}`,
    )
    await deleteObjectsFromR2([stagedInputPath]).catch(() => {})
    throw enqueueError
  }

  return job
}
