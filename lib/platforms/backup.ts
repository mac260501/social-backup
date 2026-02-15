import type { PlatformId } from '@/lib/platforms/types'

export type BackupLike = {
  backup_type?: string | null
  source?: string | null
  backup_source?: string | null
  data?: {
    uploaded_file_size?: number
    archive_file_path?: string
    profile?: {
      username?: string
    }
  } | null
}

export function inferBackupPlatform(backup: BackupLike): PlatformId {
  void backup
  // Current schema only stores Twitter backups. Keeping this centralized makes
  // future platform mapping additive and avoids touching multiple UIs/routes.
  return 'twitter'
}

export function isArchiveBackup(backup: BackupLike) {
  return (
    backup.backup_type === 'full_archive' ||
    backup.source === 'archive' ||
    backup.backup_source === 'archive_upload' ||
    Boolean(backup.data?.uploaded_file_size) ||
    Boolean(backup.data?.archive_file_path)
  )
}

export function formatBackupMethodLabel(backup: BackupLike) {
  const usernameSuffix = backup.data?.profile?.username ? ` @${backup.data.profile.username}` : ''
  return isArchiveBackup(backup)
    ? `Archive Backup${usernameSuffix}`
    : `Current Snapshot${usernameSuffix}`
}
