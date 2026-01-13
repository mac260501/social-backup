import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for backend operations (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const backupId = searchParams.get('backupId')

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'Backup ID is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('backups')
      .delete()
      .eq('id', backupId)

    if (error) {
      console.error('Failed to delete backup:', error)
      throw new Error(`Failed to delete backup: ${error.message}`)
    }

    return NextResponse.json({
      success: true,
      message: 'Backup deleted successfully',
    })

  } catch (error) {
    console.error('Delete backup error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete backup',
    }, { status: 500 })
  }
}
