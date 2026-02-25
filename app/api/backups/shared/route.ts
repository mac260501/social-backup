import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteBackupAndStorageById } from '@/lib/backups/delete-backup-data'
import { isGuestBackupExpired } from '@/lib/backups/retention'
import { getShareGrantFromCookies } from '@/lib/share-links'

const supabase = createAdminClient()

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const backupId = searchParams.get('backupId')?.trim()
    if (!backupId) {
      return NextResponse.json({ success: false, error: 'backupId is required' }, { status: 400 })
    }

    const shareGrant = await getShareGrantFromCookies()
    if (!shareGrant || shareGrant.backupId !== backupId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { data: backup, error } = await supabase
      .from('backups')
      .select('*')
      .eq('id', backupId)
      .maybeSingle()

    if (error || !backup) {
      return NextResponse.json({ success: false, error: 'Backup not found' }, { status: 404 })
    }

    if (isGuestBackupExpired(backup.data)) {
      try {
        await deleteBackupAndStorageById(supabase, {
          backupId,
          expectedUserId: String(backup.user_id),
        })
      } catch (cleanupError) {
        console.error(`[Shared Backup API] Failed to delete expired backup ${backupId}:`, cleanupError)
      }
      return NextResponse.json({ success: false, error: 'Backup link expired' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      backup,
    })
  } catch (error) {
    console.error('[Shared Backup API] Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to load shared backup',
    }, { status: 500 })
  }
}
