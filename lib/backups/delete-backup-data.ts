import type { SupabaseClient } from '@supabase/supabase-js'

const STORAGE_BUCKET = 'twitter-media'
const STORAGE_REMOVE_BATCH_SIZE = 100

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function getArchivePathFromBackupData(data: unknown): string | null {
  const parsed = toRecord(data)
  const raw = parsed.archive_file_path
  if (typeof raw !== 'string') return null
  const path = raw.trim()
  return path.length > 0 ? path : null
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize))
  }
  return chunks
}

export type BackupDeleteResult = {
  mediaFilesChecked: number
  candidatePathsChecked: number
  storageFilesDeleted: number
  storageFilesDeleteFailed: number
  backupDeleted: boolean
}

export async function deleteBackupAndStorageById(
  supabase: SupabaseClient,
  params: {
    backupId: string
    expectedUserId?: string
  },
): Promise<BackupDeleteResult> {
  const { backupId, expectedUserId } = params

  const { data: backup, error: backupError } = await supabase
    .from('backups')
    .select('id, user_id, data')
    .eq('id', backupId)
    .maybeSingle()

  if (backupError) {
    throw new Error(`Failed to load backup: ${backupError.message}`)
  }
  if (!backup) {
    return {
      mediaFilesChecked: 0,
      candidatePathsChecked: 0,
      storageFilesDeleted: 0,
      storageFilesDeleteFailed: 0,
      backupDeleted: false,
    }
  }

  if (expectedUserId && backup.user_id !== expectedUserId) {
    throw new Error('Forbidden - backup ownership mismatch')
  }

  const { data: backupMediaFiles, error: mediaFetchError } = await supabase
    .from('media_files')
    .select('file_path')
    .eq('backup_id', backupId)

  if (mediaFetchError) {
    throw new Error(`Failed to load backup media rows: ${mediaFetchError.message}`)
  }

  const archivePath = getArchivePathFromBackupData(backup.data)
  const candidatePaths = Array.from(
    new Set([
      ...(backupMediaFiles || []).map((row) => row.file_path).filter((path): path is string => typeof path === 'string' && path.length > 0),
      ...(archivePath ? [archivePath] : []),
    ]),
  )

  const referencedByOtherBackups = new Set<string>()
  if (candidatePaths.length > 0) {
    const { data: otherRefs, error: refsError } = await supabase
      .from('media_files')
      .select('file_path')
      .in('file_path', candidatePaths)
      .neq('backup_id', backupId)

    if (refsError) {
      throw new Error(`Failed to verify shared file references: ${refsError.message}`)
    }

    for (const ref of otherRefs || []) {
      if (typeof ref.file_path === 'string' && ref.file_path.length > 0) {
        referencedByOtherBackups.add(ref.file_path)
      }
    }
  }

  const filesToDelete = candidatePaths.filter((path) => !referencedByOtherBackups.has(path))

  const { error: deleteBackupError } = await supabase
    .from('backups')
    .delete()
    .eq('id', backupId)

  if (deleteBackupError) {
    throw new Error(`Failed to delete backup row: ${deleteBackupError.message}`)
  }

  let deletedCount = 0
  const failedDeletes: string[] = []

  for (const chunk of chunkArray(filesToDelete, STORAGE_REMOVE_BATCH_SIZE)) {
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(chunk)

    if (storageError) {
      failedDeletes.push(...chunk)
      continue
    }

    deletedCount += chunk.length
  }

  return {
    mediaFilesChecked: backupMediaFiles?.length || 0,
    candidatePathsChecked: candidatePaths.length,
    storageFilesDeleted: deletedCount,
    storageFilesDeleteFailed: failedDeletes.length,
    backupDeleted: true,
  }
}
