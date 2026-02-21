import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createSignedGetUrl } from '@/lib/storage/r2'

const supabase = createAdminClient()

export async function GET(request: Request) {
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
      return NextResponse.json({
        success: false,
        error: 'Backup ID is required'
      }, { status: 400 })
    }

    // Get backup and verify ownership
    const { data: backup, error: backupError } = await supabase
      .from('backups')
      .select('archive_file_path, data, user_id')
      .eq('id', backupId)
      .single()

    if (backupError || !backup) {
      return NextResponse.json({
        success: false,
        error: 'Backup not found'
      }, { status: 404 })
    }

    // Verify user owns this backup
    if (backup.user_id !== user.id) {
      console.warn(`[Security] User ${user.id} attempted to download backup ${backupId} they don't own`)
      return NextResponse.json({
        success: false,
        error: 'Forbidden - you do not have access to this backup'
      }, { status: 403 })
    }

    const archiveFilePath = backup.archive_file_path || backup.data?.archive_file_path

    if (!archiveFilePath) {
      return NextResponse.json({
        success: false,
        error: 'Archive file not available for this backup'
      }, { status: 404 })
    }

    const downloadUrl = await createSignedGetUrl(archiveFilePath, {
      expiresInSeconds: 3600,
      downloadFileName: `${backupId}.zip`,
    })

    return NextResponse.json({
      success: true,
      downloadUrl
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to generate download URL'
    }, { status: 500 })
  }
}
