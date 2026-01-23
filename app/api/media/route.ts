import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { verifyMediaOwnership } from '@/lib/auth-helpers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    // Verify ownership - user must own the backup to view its media
    const isOwner = await verifyMediaOwnership(backupId, session.user.id)
    if (!isOwner) {
      console.warn(`[Security] User ${session.user.id} attempted to access media for backup ${backupId} they don't own`)
      return NextResponse.json({
        success: false,
        error: 'Forbidden - you do not have access to this backup'
      }, { status: 403 })
    }

    const { data: mediaFiles, error } = await supabase
      .from('media_files')
      .select('*')
      .eq('backup_id', backupId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching media files:', error)
      throw error
    }

    return NextResponse.json({
      success: true,
      mediaFiles: mediaFiles || []
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch media files'
    }, { status: 500 })
  }
}
