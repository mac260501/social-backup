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
    const queryBackupId = searchParams.get('backupId')
    const queryBackupIds = (searchParams.get('backupIds') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    const bodyBackupIds: string[] = []
    try {
      const body = (await request.json()) as { backupId?: unknown; backupIds?: unknown }
      if (typeof body.backupId === 'string' && body.backupId.trim().length > 0) {
        bodyBackupIds.push(body.backupId.trim())
      }
      if (Array.isArray(body.backupIds)) {
        bodyBackupIds.push(
          ...body.backupIds
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean),
        )
      }
    } catch {
      // DELETE requests may not have a JSON body.
    }

    const requestedBackupIds = Array.from(
      new Set([
        ...(queryBackupId ? [queryBackupId.trim()] : []),
        ...queryBackupIds,
        ...bodyBackupIds,
      ].filter(Boolean)),
    )

    if (requestedBackupIds.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one backup ID is required' }, { status: 400 })
    }

    const { data: backups, error: backupsError } = await supabase
      .from('backups')
      .select('id, user_id')
      .in('id', requestedBackupIds)

    if (backupsError) {
      return NextResponse.json({ success: false, error: 'Failed to validate backups' }, { status: 500 })
    }

    const backupById = new Map((backups || []).map((backup) => [backup.id, backup]))
    const forbiddenIds = requestedBackupIds.filter((backupId) => {
      const backup = backupById.get(backupId)
      return Boolean(backup && backup.user_id !== user.id)
    })

    if (forbiddenIds.length > 0) {
      console.warn(`[Security] User ${user.id} attempted to delete backups they do not own: ${forbiddenIds.join(', ')}`)
      return NextResponse.json({
        success: false,
        error: 'Forbidden - you do not have permission to delete one or more selected backups'
      }, { status: 403 })
    }

    const missingIds = requestedBackupIds.filter((backupId) => !backupById.has(backupId))
    const deletableIds = requestedBackupIds.filter((backupId) => backupById.has(backupId))
    const results: Array<{
      backupId: string
      success: boolean
      details?: Awaited<ReturnType<typeof deleteBackupAndStorageById>>
      error?: string
    }> = []

    for (const missingId of missingIds) {
      results.push({
        backupId: missingId,
        success: false,
        error: 'Backup not found',
      })
    }

    for (const backupId of deletableIds) {
      try {
        console.log(`[Delete Backup] Starting deletion for backup ${backupId}`)
        const details = await deleteBackupAndStorageById(supabase, {
          backupId,
          expectedUserId: user.id,
        })
        if (details.storageFilesDeleteFailed > 0) {
          results.push({
            backupId,
            success: false,
            details,
            error: `Deleted backup row but failed to delete ${details.storageFilesDeleteFailed} storage object(s).`,
          })
          continue
        }
        results.push({
          backupId,
          success: true,
          details,
        })
      } catch (error) {
        results.push({
          backupId,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete backup',
        })
      }
    }

    const deletedCount = results.filter((item) => item.success).length
    const failedCount = results.length - deletedCount

    if (failedCount > 0) {
      return NextResponse.json({
        success: false,
        error: `Deleted ${deletedCount} of ${results.length} backup${results.length === 1 ? '' : 's'}.`,
        deletedCount,
        failedCount,
        results,
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `Deleted ${deletedCount} backup${deletedCount === 1 ? '' : 's'} successfully`,
      deletedCount,
      failedCount: 0,
      results,
    })
  } catch (error) {
    console.error('[Delete Backup] Delete backup error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to delete backup',
    }, { status: 500 })
  }
}
