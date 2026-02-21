import type { SupabaseClient } from '@supabase/supabase-js'

type JsonRecord = Record<string, unknown>

type BackupRow = {
  id: string
  data?: unknown
}

type MediaFileRow = {
  backup_id?: string
  file_path?: string
  file_size?: number | string | null
}

type PathUsage = {
  size: number
  kind: 'archive' | 'media'
}

export type BackupStorageBreakdown = {
  payloadBytes: number
  mediaBytes: number
  archiveBytes: number
  totalBytes: number
  mediaFiles: number
}

export type UserStorageSummary = {
  totalBytes: number
  payloadBytes: number
  mediaBytes: number
  archiveBytes: number
  uniqueFileCount: number
  backupsCount: number
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function parsePositiveNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

function isArchivePath(path: string) {
  return /\/archives\//.test(path)
}

function getArchivePathFromBackupData(data: JsonRecord): string | null {
  const value = data.archive_file_path
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function applyPathUsage(map: Map<string, PathUsage>, path: string, size: number, kind: 'archive' | 'media') {
  const existing = map.get(path)
  if (!existing) {
    map.set(path, { size, kind })
    return
  }
  if (size > existing.size) {
    map.set(path, { size, kind: existing.kind === 'archive' ? 'archive' : kind })
    return
  }
  if (existing.kind !== 'archive' && kind === 'archive') {
    map.set(path, { ...existing, kind: 'archive' })
  }
}

function pruneStorageMetadataForSize(data: JsonRecord): JsonRecord {
  const next: JsonRecord = { ...data }
  delete next.storage
  delete next.file_size

  const stats = toRecord(next.stats)
  if (Object.keys(stats).length > 0) {
    delete stats.storage_payload_bytes
    delete stats.storage_media_bytes
    delete stats.storage_archive_bytes
    delete stats.storage_total_bytes
    next.stats = stats
  }

  return next
}

function calculateJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8')
  } catch {
    return 0
  }
}

function buildUpdatedBackupData(
  currentData: JsonRecord,
  breakdown: BackupStorageBreakdown,
): JsonRecord {
  const currentStorage = toRecord(currentData.storage)
  const currentStats = toRecord(currentData.stats)

  return {
    ...currentData,
    file_size: breakdown.totalBytes,
    storage: {
      ...currentStorage,
      payload_bytes: breakdown.payloadBytes,
      media_bytes: breakdown.mediaBytes,
      archive_bytes: breakdown.archiveBytes,
      total_bytes: breakdown.totalBytes,
      media_files: breakdown.mediaFiles,
      updated_at: new Date().toISOString(),
    },
    stats: {
      ...currentStats,
      media_files: breakdown.mediaFiles,
      storage_payload_bytes: breakdown.payloadBytes,
      storage_media_bytes: breakdown.mediaBytes,
      storage_archive_bytes: breakdown.archiveBytes,
      storage_total_bytes: breakdown.totalBytes,
    },
  }
}

export function calculateBackupStorageBreakdown(
  backupData: unknown,
  mediaRows: MediaFileRow[],
): BackupStorageBreakdown {
  const parsedData = toRecord(backupData)
  const payloadSource = pruneStorageMetadataForSize(parsedData)
  const payloadBytes = calculateJsonBytes(payloadSource)
  const mediaRowsSafe = Array.isArray(mediaRows) ? mediaRows : []
  let mediaBytes = 0
  let mediaFiles = 0
  let archiveBytesFromMediaRows = 0
  const archivePath = getArchivePathFromBackupData(parsedData)

  for (const row of mediaRowsSafe) {
    const filePath = typeof row.file_path === 'string' ? row.file_path : ''
    const rowSize = parsePositiveNumber(row.file_size)
    const isArchiveRow =
      (archivePath && filePath === archivePath) ||
      isArchivePath(filePath)

    if (isArchiveRow) {
      archiveBytesFromMediaRows += rowSize
      continue
    }
    mediaBytes += rowSize
    mediaFiles += 1
  }

  const archiveBytesFromBackup = parsePositiveNumber(parsedData.uploaded_file_size)
  const archiveBytes = archiveBytesFromBackup || archiveBytesFromMediaRows
  const totalBytes = payloadBytes + archiveBytes + mediaBytes

  return {
    payloadBytes,
    mediaBytes,
    archiveBytes,
    totalBytes,
    mediaFiles,
  }
}

export async function recalculateAndPersistBackupStorage(
  supabase: SupabaseClient,
  backupId: string,
): Promise<BackupStorageBreakdown | null> {
  const { data: backup, error: backupError } = await supabase
    .from('backups')
    .select('id, data')
    .eq('id', backupId)
    .maybeSingle()

  if (backupError || !backup) {
    console.error('[Storage] Failed to fetch backup for recalc:', backupError || 'Backup not found')
    return null
  }

  const { data: mediaRows, error: mediaError } = await supabase
    .from('media_files')
    .select('file_size, file_path')
    .eq('backup_id', backupId)

  if (mediaError) {
    console.error('[Storage] Failed to fetch media rows for recalc:', mediaError)
    return null
  }

  const breakdown = calculateBackupStorageBreakdown(backup.data, (mediaRows || []) as MediaFileRow[])
  const updatedData = buildUpdatedBackupData(toRecord(backup.data), breakdown)

  const { error: updateError } = await supabase
    .from('backups')
    .update({ data: updatedData })
    .eq('id', backupId)

  if (updateError) {
    console.error('[Storage] Failed to persist backup storage:', updateError)
    return null
  }

  return breakdown
}

export async function calculateUserStorageSummary(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserStorageSummary> {
  const [{ data: backups, error: backupsError }, { data: mediaRows, error: mediaError }] = await Promise.all([
    supabase
      .from('backups')
      .select('id, data')
      .eq('user_id', userId),
    supabase
      .from('media_files')
      .select('backup_id, file_path, file_size')
      .eq('user_id', userId),
  ])

  if (backupsError) {
    console.error('[Storage] Failed to load backups for summary:', backupsError)
  }
  if (mediaError) {
    console.error('[Storage] Failed to load media rows for summary:', mediaError)
  }

  const backupRows = ((backups || []) as BackupRow[])
  const mediaRowsSafe = ((mediaRows || []) as MediaFileRow[])

  const uniquePathUsage = new Map<string, PathUsage>()

  for (const media of mediaRowsSafe) {
    if (typeof media.file_path !== 'string' || media.file_path.length === 0) continue
    const path = media.file_path
    const size = parsePositiveNumber(media.file_size)
    const kind: 'archive' | 'media' =
      isArchivePath(path) ? 'archive' : 'media'
    applyPathUsage(uniquePathUsage, path, size, kind)
  }

  for (const backup of backupRows) {
    const backupData = toRecord(backup.data)

    const archivePath = getArchivePathFromBackupData(backupData)
    if (!archivePath) continue
    const archiveSize = parsePositiveNumber(backupData.uploaded_file_size)
    applyPathUsage(uniquePathUsage, archivePath, archiveSize, 'archive')
  }

  let uniqueArchiveBytes = 0
  let uniqueMediaBytes = 0
  let payloadBytes = 0
  for (const usage of uniquePathUsage.values()) {
    if (usage.kind === 'archive') uniqueArchiveBytes += usage.size
    else uniqueMediaBytes += usage.size
  }
  for (const backup of backupRows) {
    payloadBytes += calculateJsonBytes(pruneStorageMetadataForSize(toRecord(backup.data)))
  }

  return {
    totalBytes: payloadBytes + uniqueArchiveBytes + uniqueMediaBytes,
    payloadBytes,
    archiveBytes: uniqueArchiveBytes,
    mediaBytes: uniqueMediaBytes,
    uniqueFileCount: uniquePathUsage.size,
    backupsCount: backupRows.length,
  }
}
