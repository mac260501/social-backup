import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { createHash } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function createUuidFromString(str: string): string {
  const hash = createHash('sha256').update(str).digest('hex')
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32),
  ].join('-')
}

export async function GET(request: Request) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)
    if (!session || !session.user?.id) {
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

    // Convert user ID to UUID format for comparison
    const userUuid = createUuidFromString(session.user.id)

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
    if (backup.user_id !== userUuid) {
      console.warn(`[Security] User ${userUuid} attempted to download backup ${backupId} they don't own`)
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
