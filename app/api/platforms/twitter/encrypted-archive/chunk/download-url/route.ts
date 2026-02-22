import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createSignedGetUrl } from '@/lib/storage/r2'

type DownloadUrlBody = {
  storagePath?: string
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

    const body = (await request.json().catch(() => ({}))) as DownloadUrlBody
    const storagePath = ensureUserScopedPath(body.storagePath || '', user.id)

    const downloadUrl = await createSignedGetUrl(storagePath, {
      expiresInSeconds: 15 * 60,
    })

    return NextResponse.json({
      success: true,
      downloadUrl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create encrypted archive chunk download URL'
    const status =
      message.includes('Unauthorized') ? 401
        : message.includes('Invalid encrypted archive chunk path.') ? 400
          : 500
    const clientMessage = status >= 500 ? 'Failed to create encrypted archive chunk download URL' : message
    console.error('[Encrypted Archive Chunk Download URL] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
