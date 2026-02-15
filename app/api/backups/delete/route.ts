import { NextResponse } from 'next/server'
import { verifyBackupOwnership } from '@/lib/auth-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'

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

    // Verify ownership - user must own the backup to delete it
    const isOwner = await verifyBackupOwnership(backupId, user.id)
    if (!isOwner) {
      console.warn(`[Security] User ${user.id} attempted to delete backup ${backupId} they don't own`)
      return NextResponse.json({
        success: false,
        error: 'Forbidden - you do not have permission to delete this backup'
      }, { status: 403 })
    }

    console.log(`[Delete Backup] Starting deletion for backup ${backupId}`)

    // Step 1: Get all media files for this backup
    const { data: mediaFiles, error: fetchError } = await supabase
      .from('media_files')
      .select('file_path, backup_id')
      .eq('backup_id', backupId)

    if (fetchError) {
      console.error('[Delete Backup] Error fetching media files:', fetchError)
      throw fetchError
    }

    console.log(`[Delete Backup] Found ${mediaFiles?.length || 0} media files`)

    // Step 2: For each media file, check if it's used by other backups
    const filesToDelete: string[] = []

    if (mediaFiles && mediaFiles.length > 0) {
      for (const media of mediaFiles) {
        // Check if this file is referenced by any OTHER backups
        const { data: otherRefs, error: refError } = await supabase
          .from('media_files')
          .select('backup_id')
          .eq('file_path', media.file_path)
          .neq('backup_id', backupId)

        if (refError) {
          console.error(`[Delete Backup] Error checking refs for ${media.file_path}:`, refError)
          continue
        }

        // If no other backups reference this file, mark it for deletion
        if (!otherRefs || otherRefs.length === 0) {
          filesToDelete.push(media.file_path)
        } else {
          console.log(`[Delete Backup] File ${media.file_path} is used by ${otherRefs.length} other backup(s), keeping it`)
        }
      }
    }

    console.log(`[Delete Backup] Will delete ${filesToDelete.length} orphaned files from storage`)

    // Step 3: Delete the backup (media_files records will cascade delete)
    const { error } = await supabase
      .from('backups')
      .delete()
      .eq('id', backupId)

    if (error) {
      console.error('[Delete Backup] Error deleting backup:', error)
      throw new Error(`Failed to delete backup: ${error.message}`)
    }

    console.log('[Delete Backup] Backup deleted from database')

    // Step 4: Delete orphaned files from storage
    let deletedCount = 0
    if (filesToDelete.length > 0) {
      const { data: storageData, error: storageError } = await supabase.storage
        .from('twitter-media')
        .remove(filesToDelete)

      if (storageError) {
        console.error('[Delete Backup] Error deleting from storage:', storageError)
        // Don't fail the whole operation - backup is already deleted
      } else {
        deletedCount = filesToDelete.length
        console.log(`[Delete Backup] Deleted ${deletedCount} orphaned files from storage`)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Backup deleted successfully',
      details: {
        mediaFilesChecked: mediaFiles?.length || 0,
        storageFilesDeleted: deletedCount,
      }
    })

  } catch (error) {
    console.error('[Delete Backup] Delete backup error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete backup',
    }, { status: 500 })
  }
}
