import { NextResponse } from 'next/server'
import { ensureUserScopedStagedPath } from '@/lib/platforms/twitter/archive-upload-intake'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { deleteObjectsFromR2 } from '@/lib/storage/r2'

type DiscardBody = {
  stagedInputPath?: string
}

export async function POST(request: Request) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as DiscardBody
    const stagedInputPath = ensureUserScopedStagedPath(body.stagedInputPath || '', user.id)

    await deleteObjectsFromR2([stagedInputPath])
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to discard staged upload'
    const status = message.includes('Invalid staged upload path') ? 400 : 500
    const clientMessage = status >= 500 ? 'Failed to discard staged upload' : message
    console.error('[Archive Discard] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
