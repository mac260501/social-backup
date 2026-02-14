import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const supabase = createAdminClient()

export function createUuidFromString(str: string): string {
  const hash = createHash('sha256').update(str).digest('hex')
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32),
  ].join('-')
}

/**
 * Verify that a backup belongs to a specific user.
 * With Supabase Auth the userId is already a UUID (auth.uid()),
 * so we compare directly — no hashing needed.
 */
export async function verifyBackupOwnership(
  backupId: string,
  userId: string
): Promise<boolean> {
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
 */
export async function verifyMediaOwnership(
  backupId: string,
  userId: string
): Promise<boolean> {
  return verifyBackupOwnership(backupId, userId)
}
