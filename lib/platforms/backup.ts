import type { PlatformId } from '@/lib/platforms/types'

export type BackupLike = {
  backup_type?: string | null
  source?: string | null
  backup_source?: string | null
  archive_file_path?: string | null
  data?: {
    uploaded_file_size?: number
    archive_file_path?: string
    scrape?: {
      is_partial?: boolean | string | number | null
      partial_reason?: string | null
      partial_reasons?: unknown
      timeline_limit_hit?: boolean | string | number | null
      social_graph_limit_hit?: boolean | string | number | null
    } | null
    profile?: {
      username?: string
    }
  } | null
}

export type BackupPartialDetails = {
  isPartial: boolean
  reasons: string[]
}

const PARTIAL_REASON_LABELS: Record<string, string> = {
  timeline_limit_reached: 'Timeline reached this run\'s item limit',
  timeline_source_gap: 'Source API returned fewer timeline items than the profile total',
  social_graph_budget_cap_reached: 'Followers/following capped by run budget',
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true
    if (['false', '0', 'no', 'n'].includes(normalized)) return false
  }
  return null
}

function normalizeReasonList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
  return Array.from(new Set(normalized))
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
    Boolean(backup.archive_file_path) ||
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

export function getBackupPartialDetails(backup: BackupLike): BackupPartialDetails {
  if (isArchiveBackup(backup)) {
    return {
      isPartial: false,
      reasons: [],
    }
  }

  const scrapeData = backup.data?.scrape
  const reasons = normalizeReasonList(scrapeData?.partial_reasons)
  const partialReason = typeof scrapeData?.partial_reason === 'string' ? scrapeData.partial_reason.trim() : ''
  if (partialReason) {
    reasons.push(partialReason)
  }

  if (normalizeBoolean(scrapeData?.timeline_limit_hit) === true && !reasons.includes('timeline_limit_reached')) {
    reasons.push('timeline_limit_reached')
  }
  if (
    normalizeBoolean(scrapeData?.social_graph_limit_hit) === true
    && !reasons.includes('social_graph_budget_cap_reached')
  ) {
    reasons.push('social_graph_budget_cap_reached')
  }

  const explicitPartial = normalizeBoolean(scrapeData?.is_partial)
  return {
    isPartial: explicitPartial !== null ? explicitPartial : reasons.length > 0,
    reasons: Array.from(new Set(reasons)),
  }
}

export function formatPartialReasonLabel(reason: string): string {
  return PARTIAL_REASON_LABELS[reason] || 'Run ended before full dataset was fetched'
}
