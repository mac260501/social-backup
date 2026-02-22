export const ARCHIVE_WIZARD_STATUSES = [
  'pending',
  'pending_extended',
  'ready',
  'completed',
  'skipped',
] as const

export type ArchiveWizardStatus = (typeof ARCHIVE_WIZARD_STATUSES)[number]

export type ArchiveWizardStep = 1 | 2 | 3

export type ArchiveWizardResolvedStep = ArchiveWizardStep | 'success'

export type ArchiveWizardJobSummary = {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  message: string | null
  result_backup_id?: string | null
}

export type ArchiveWizardStatusResponse = {
  success: boolean
  schemaReady?: boolean
  status: ArchiveWizardStatus | null
  archiveRequestedAt: string | null
  archiveReminderCount: number
  archiveLastReminderAt: string | null
  hasArchiveBackup: boolean
  suggestedStep: ArchiveWizardResolvedStep
  activeArchiveJob: ArchiveWizardJobSummary | null
  latestArchiveBackupId: string | null
  latestArchiveBackupStats?: {
    tweets: number
    followers: number
    following: number
    likes: number
    dms: number
    mediaFiles: number
  } | null
  error?: string
}

export function isArchiveWizardStatus(value: unknown): value is ArchiveWizardStatus {
  return typeof value === 'string' && ARCHIVE_WIZARD_STATUSES.includes(value as ArchiveWizardStatus)
}

export function resolveArchiveWizardStep(params: {
  status: ArchiveWizardStatus | null
  hasArchiveBackup: boolean
  hasActiveArchiveJob?: boolean
}): ArchiveWizardResolvedStep {
  const { status, hasArchiveBackup, hasActiveArchiveJob } = params

  if (hasActiveArchiveJob) return 3
  // Wizard is only truly complete when a processed archive backup exists.
  if (hasArchiveBackup) return 'success'
  if (status === 'completed') return 3
  if (status === 'ready') return 3
  if (status === 'pending' || status === 'pending_extended') return 2
  return 1
}
