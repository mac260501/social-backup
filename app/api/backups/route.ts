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
    const userId = searchParams.get('userId')

    // Keep backward compatibility with callers that still send userId.
    if (userId && userId !== user.id) {
      console.warn(`[Security] User ${user.id} attempted to fetch backups for user ${userId}`)
      return NextResponse.json({
        success: false,
        error: 'Forbidden - you can only access your own backups'
      }, { status: 403 })
    }

    const { data, error } = await supabase
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
