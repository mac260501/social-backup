import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { createUuidFromString } from '@/lib/auth-helpers'

// Use service role for backend operations (bypasses RLS)
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
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 })
    }

    // Verify that the requested userId matches the authenticated session user
    if (userId !== session.user.id) {
      console.warn(`[Security] User ${session.user.id} attempted to fetch backups for user ${userId}`)
      return NextResponse.json({
        success: false,
        error: 'Forbidden - you can only access your own backups'
      }, { status: 403 })
    }

    const userUuid = createUuidFromString(userId)

    const { data, error } = await supabase
      .from('backups')
      .select('*')
      .eq('user_id', userUuid)
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
