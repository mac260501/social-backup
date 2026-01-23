import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
 * Verify that a backup belongs to a specific user
 * @param backupId - The backup ID to check
 * @param userId - The user ID (from session) to verify ownership
 * @returns true if user owns the backup, false otherwise
 */
export async function verifyBackupOwnership(
  backupId: string,
  userId: string
): Promise<boolean> {
  const userUuid = createUuidFromString(userId)

  const { data, error } = await supabase
    .from('backups')
    .select('user_id')
    .eq('id', backupId)
    .single()

  if (error || !data) {
    return false
  }

  return data.user_id === userUuid
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
