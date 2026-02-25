import { createAdminClient } from '@/lib/supabase/admin'
import { deleteBackupAndStorageById } from '@/lib/backups/delete-backup-data'
import { isGuestBackupExpired } from '@/lib/backups/retention'

type CandidateBackup = {
  id: string
  user_id: string
  data: unknown
}

export async function cleanupExpiredGuestBackups(limit: number = 200): Promise<number> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('backups')
    .select('id, user_id, data')
    .limit(Math.max(1, Math.min(1000, limit)))

  if (error) {
    console.error('[Guest Retention] Failed to load backups:', error)
    return 0
  }

  const candidates = ((data || []) as CandidateBackup[])
    .filter((backup) => typeof backup.id === 'string' && typeof backup.user_id === 'string')
    .filter((backup) => isGuestBackupExpired(backup.data))

  let deletedCount = 0
  for (const backup of candidates) {
    try {
      const result = await deleteBackupAndStorageById(supabase, {
        backupId: backup.id,
        expectedUserId: backup.user_id,
      })
      if (result.backupDeleted) deletedCount += 1
    } catch (error) {
      console.error(`[Guest Retention] Failed deleting backup ${backup.id}:`, error)
    }
  }

  return deletedCount
}
