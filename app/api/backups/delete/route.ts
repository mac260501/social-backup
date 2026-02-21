import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { deleteBackupAndStorageById } from '@/lib/backups/delete-backup-data'

const supabase = createAdminClient()

export async function DELETE(request: Request) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized'
      }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const backupId = searchParams.get('backupId')

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'Backup ID is required' }, { status: 400 })
    }

    const { data: backup, error: backupError } = await supabase
      .from('backups')
      .select('id, user_id')
      .eq('id', backupId)
      .maybeSingle()

    if (backupError || !backup) {
      return NextResponse.json({ success: false, error: 'Backup not found' }, { status: 404 })
    }

    if (backup.user_id !== user.id) {
      console.warn(`[Security] User ${user.id} attempted to delete backup ${backupId} they don't own`)
      return NextResponse.json({
        success: false,
        error: 'Forbidden - you do not have permission to delete this backup'
      }, { status: 403 })
    }

    console.log(`[Delete Backup] Starting deletion for backup ${backupId}`)
    const details = await deleteBackupAndStorageById(supabase, {
      backupId,
      expectedUserId: user.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Backup deleted successfully',
      details,
    })
  } catch (error) {
    console.error('[Delete Backup] Delete backup error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to delete backup',
    }, { status: 500 })
  }
}
