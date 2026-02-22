import { NextResponse } from 'next/server'
import { TWITTER_UPLOAD_LIMITS } from '@/lib/platforms/twitter/limits'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createSignedPutUrl } from '@/lib/storage/r2'

type PresignEncryptedArchiveChunkBody = {
  sessionPrefix?: string
  chunkIndex?: number
  chunkSize?: number
}

function normalizeStoragePath(path: string): string {
  return path.trim().replace(/^\/+/, '')
}

function ensureUserScopedEncryptedArchivePrefix(prefix: string, userId: string): string {
  const normalized = normalizeStoragePath(prefix)
  if (!normalized.startsWith(`${userId}/encrypted-archives/`)) {
    throw new Error('Invalid encrypted archive session prefix.')
  }
  return normalized
}

function statusForError(message: string): number {
  if (message.includes('Unauthorized')) return 401
  if (message.includes('Invalid encrypted archive session prefix')) return 400
  if (message.includes('chunkIndex')) return 400
  if (message.includes('chunkSize')) return 400
  return 500
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

    const body = (await request.json().catch(() => ({}))) as PresignEncryptedArchiveChunkBody
    const sessionPrefix = ensureUserScopedEncryptedArchivePrefix(body.sessionPrefix || '', user.id)
    const chunkIndex =
      typeof body.chunkIndex === 'number' && Number.isInteger(body.chunkIndex) ? body.chunkIndex : Number.NaN
    const chunkSize = typeof body.chunkSize === 'number' && Number.isFinite(body.chunkSize) ? body.chunkSize : 0

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return NextResponse.json({ success: false, error: 'chunkIndex must be a non-negative integer' }, { status: 400 })
    }
    if (!chunkSize || chunkSize <= 0) {
      return NextResponse.json({ success: false, error: 'chunkSize must be greater than zero' }, { status: 400 })
    }
    if (chunkSize > TWITTER_UPLOAD_LIMITS.maxEncryptedArchiveChunkBytes + 256) {
      return NextResponse.json({
        success: false,
        error: `chunkSize exceeds limit (${TWITTER_UPLOAD_LIMITS.maxEncryptedArchiveChunkBytes + 256} bytes).`,
      }, { status: 413 })
    }

    const chunkPath = `${sessionPrefix}/chunks/${String(chunkIndex).padStart(8, '0')}.bin`
    const uploadUrl = await createSignedPutUrl(chunkPath, {
      expiresInSeconds: 15 * 60,
      contentType: 'application/octet-stream',
    })

    return NextResponse.json({
      success: true,
      uploadUrl,
      chunkPath,
      method: 'PUT',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create encrypted archive chunk upload URL'
    const status = statusForError(message)
    const clientMessage = status >= 500 ? 'Failed to create encrypted archive chunk upload URL' : message
    console.error('[Encrypted Archive Chunk Presign] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
