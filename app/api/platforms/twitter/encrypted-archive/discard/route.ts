import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { deleteObjectsFromR2 } from '@/lib/storage/r2'

type DiscardEncryptedArchiveBody = {
  chunkPaths?: unknown
}

function normalizeStoragePath(path: string): string {
  return path.trim().replace(/^\/+/, '')
}

function ensureUserScopedPath(path: string, userId: string): string {
  const normalized = normalizeStoragePath(path)
  if (!normalized.startsWith(`${userId}/encrypted-archives/`)) {
    throw new Error('Invalid encrypted archive chunk path.')
  }
  return normalized
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

    const body = (await request.json().catch(() => ({}))) as DiscardEncryptedArchiveBody
    const chunkPathsRaw = Array.isArray(body.chunkPaths) ? body.chunkPaths : []
    const chunkPaths = chunkPathsRaw
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .map((path) => ensureUserScopedPath(path, user.id))

    if (chunkPaths.length === 0) {
      return NextResponse.json({ success: true })
    }

    await deleteObjectsFromR2(chunkPaths)
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to discard encrypted archive chunks'
    const status =
      message.includes('Unauthorized') ? 401
        : message.includes('Invalid encrypted archive chunk path.') ? 400
          : 500
    const clientMessage = status >= 500 ? 'Failed to discard encrypted archive chunks' : message
    console.error('[Encrypted Archive Discard] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
