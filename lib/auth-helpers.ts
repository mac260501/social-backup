import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Verify that a backup belongs to a specific user
 * @param backupId - The backup ID to check
 * @param userId - The user ID (from session) to verify ownership
 * @returns true if user owns the backup, false otherwise
 */
export async function verifyBackupOwnership(
  backupId: string,
  userId: string
): Promise<boolean> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('backups')
    .select('user_id')
    .eq('id', backupId)
    .single()

  if (error || !data) {
    return false
  }

  return data.user_id === userId
}

/**
 * Verify that media files belong to a user through their backup
 * @param backupId - The backup ID to check
 * @param userId - The user ID (from session) to verify ownership
 * @returns true if user owns the backup (and therefore the media), false otherwise
 */
export async function verifyMediaOwnership(
  backupId: string,
  userId: string
): Promise<boolean> {
  return verifyBackupOwnership(backupId, userId)
}
