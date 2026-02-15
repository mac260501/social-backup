import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'

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
      .select('archive_file_path, user_id, created_at')
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

    // Check if archive file exists
    if (!backup.archive_file_path) {
      return NextResponse.json({
        success: false,
        error: 'Archive file not available for this backup'
      }, { status: 404 })
    }

    // Generate signed URL (valid for 1 hour)
    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from('twitter-media')
      .createSignedUrl(backup.archive_file_path, 3600, {
        download: true
      })

    if (urlError || !signedUrlData) {
      console.error('Error creating signed URL:', urlError)
      return NextResponse.json({
        success: false,
        error: 'Failed to generate download URL'
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      downloadUrl: signedUrlData.signedUrl
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate download URL'
    }, { status: 500 })
  }
}
