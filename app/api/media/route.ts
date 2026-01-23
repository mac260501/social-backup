import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const backupId = searchParams.get('backupId')

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'Backup ID is required' }, { status: 400 })
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
