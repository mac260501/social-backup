import { inngest } from '@/lib/inngest/client'
import {
  createBackupJob,
  findActiveBackupJobForUser,
  markBackupJobFailed,
  mergeBackupJobPayload,
} from '@/lib/jobs/backup-jobs'
import {
  normalizeDmEncryptionUploadMetadata,
  normalizeArchiveImportSelection,
} from '@/lib/platforms/twitter/archive-import'
import { isZipUpload, TWITTER_UPLOAD_LIMITS, USER_STORAGE_LIMITS } from '@/lib/platforms/twitter/limits'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateUserStorageSummary } from '@/lib/storage/usage'
import { deleteObjectsFromR2, normalizeStoragePath } from '@/lib/storage/r2'

const supabase = createAdminClient()

function extractInngestEventIds(response: unknown): string[] {
  if (!response || typeof response !== 'object') return []
  const ids = (response as { ids?: unknown }).ids
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

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
  importSelection?: unknown
  dmEncryption?: unknown
  preserveArchiveFile?: boolean
}) {
  const { userId, username, fileName, fileSize, stagedInputPath } = params
  const importSelection = normalizeArchiveImportSelection(params.importSelection)
  const hasDmEncryptionPayload = params.dmEncryption !== undefined && params.dmEncryption !== null
  const parsedDmEncryption = normalizeDmEncryptionUploadMetadata(params.dmEncryption)
  if (hasDmEncryptionPayload && !parsedDmEncryption) {
    throw new Error('Invalid DM encryption payload.')
  }
  const dmEncryption = parsedDmEncryption
    ? {
        ...parsedDmEncryption,
        encrypted_input_path: ensureUserScopedStagedPath(parsedDmEncryption.encrypted_input_path, userId),
      }
    : null
  if (importSelection.direct_messages && !dmEncryption) {
    throw new Error('DM encryption is required when importing chats.')
  }
  const preserveArchiveFile =
    typeof params.preserveArchiveFile === 'boolean'
      ? params.preserveArchiveFile
      : true

  const job = await createBackupJob(supabase, {
    userId,
    jobType: 'archive_upload',
    message: 'Archive uploaded. Waiting to process...',
    payload: {
      username,
      upload_file_name: fileName,
      upload_file_size: fileSize,
      import_selection: importSelection,
      dm_encryption: dmEncryption,
      preserve_archive_file: preserveArchiveFile,
    },
  })

  await mergeBackupJobPayload(supabase, job.id, {
    staged_input_path: stagedInputPath,
    lifecycle_state: 'queued',
    import_selection: importSelection,
    dm_encryption: dmEncryption,
    preserve_archive_file: preserveArchiveFile,
  })

  try {
    const eventKey = process.env.INNGEST_EVENT_KEY?.trim()
    if (!eventKey) {
      throw new Error('Inngest is not configured. Missing INNGEST_EVENT_KEY.')
    }

    const sendResult = await inngest.send({
      name: 'backup/archive-upload.requested',
      data: {
        jobId: job.id,
        userId,
        username,
        inputStoragePath: stagedInputPath,
        importSelection,
        dmEncryption,
        preserveArchiveFile,
      },
    })

    const eventIds = extractInngestEventIds(sendResult)
    if (eventIds.length > 0) {
      await mergeBackupJobPayload(supabase, job.id, {
        inngest_event_ids: eventIds,
      })
    }
  } catch (enqueueError) {
    await markBackupJobFailed(
      supabase,
      job.id,
      `Failed to queue background processing: ${enqueueError instanceof Error ? enqueueError.message : 'Unknown error'}`,
    )
    await deleteObjectsFromR2([
      stagedInputPath,
      ...(dmEncryption ? [dmEncryption.encrypted_input_path] : []),
    ]).catch(() => {})
    throw enqueueError
  }

  return job
}
