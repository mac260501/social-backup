import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyMediaOwnership } from '@/lib/auth-helpers'

export async function GET(request: Request) {
  try {
    // Check authentication via Supabase
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
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

    // Verify ownership - user must own the backup to view its media
    const isOwner = await verifyMediaOwnership(backupId, user.id)
    if (!isOwner) {
      console.warn(`[Security] User ${user.id} attempted to access media for backup ${backupId} they don't own`)
      return NextResponse.json({
        success: false,
        error: 'Forbidden - you do not have access to this backup'
      }, { status: 403 })
    }

    const admin = createAdminClient()

    const { data: mediaFiles, error } = await admin
      .from('media_files')
      .select('*')
      .eq('backup_id', backupId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching media files:', error)
      throw error
    }

    // Generate signed URLs for each media file (valid for 1 hour)
    const mediaWithUrls = await Promise.all(
      (mediaFiles || []).map(async (media) => {
        const { data: signedUrlData } = await admin.storage
          .from('twitter-media')
          .createSignedUrl(media.file_path, 3600)

        return {
          ...media,
          signedUrl: signedUrlData?.signedUrl || null
        }
      })
    )

    return NextResponse.json({
      success: true,
      mediaFiles: mediaWithUrls
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch media files'
    }, { status: 500 })
  }
}
