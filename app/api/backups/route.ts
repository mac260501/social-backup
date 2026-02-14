import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

    // Use admin client for database queries (bypasses RLS)
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('backups')
      .select('*')
      .eq('user_id', user.id)
      .order('uploaded_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch backups:', error)
      throw new Error(`Failed to fetch backups: ${error.message}`)
    }

    return NextResponse.json({
      success: true,
      backups: data || [],
    })

  } catch (error) {
    console.error('Fetch backups error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch backups',
    }, { status: 500 })
  }
}
