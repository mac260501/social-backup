import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TWITTER_UPLOAD_LIMITS } from '@/lib/platforms/twitter/limits'
import { createClient as createServerClient } from '@/lib/supabase/server'

const supabase = createAdminClient()

type InitEncryptedArchiveBody = {
  backupId?: string
  fileName?: string
  fileSize?: number
  chunkSize?: number
  chunkCount?: number
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function statusForError(message: string): number {
  if (message.includes('Unauthorized')) return 401
  if (message.includes('Backup not found')) return 404
  if (message.includes('Forbidden')) return 403
  if (message.includes('required')) return 400
  if (message.includes('invalid')) return 400
  if (message.includes('size limit')) return 413
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

    const body = (await request.json().catch(() => ({}))) as InitEncryptedArchiveBody
    const backupId = typeof body.backupId === 'string' ? body.backupId.trim() : ''
    const fileName = typeof body.fileName === 'string' ? sanitizeFileName(body.fileName.trim()) : 'archive.zip'
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'backupId is required' }, { status: 400 })
    }
    if (!fileSize || fileSize <= 0) {
      return NextResponse.json({ success: false, error: 'fileSize is required' }, { status: 400 })
    }
    if (fileSize > TWITTER_UPLOAD_LIMITS.maxArchiveBytes) {
      return NextResponse.json({
        success: false,
        error: `Archive exceeds size limit (${TWITTER_UPLOAD_LIMITS.maxArchiveBytes} bytes).`,
      }, { status: 413 })
    }

    const { data: backup, error: backupError } = await supabase
      .from('backups')
      .select('id, user_id')
      .eq('id', backupId)
      .maybeSingle()

    if (backupError || !backup) {
      return NextResponse.json({ success: false, error: 'Backup not found' }, { status: 404 })
    }
    if (backup.user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Forbidden - backup ownership mismatch' }, { status: 403 })
    }

    const requestedChunkSize =
      typeof body.chunkSize === 'number' && Number.isFinite(body.chunkSize) && body.chunkSize > 0
        ? Math.floor(body.chunkSize)
        : TWITTER_UPLOAD_LIMITS.encryptedArchiveChunkBytes
    const chunkSize = Math.min(requestedChunkSize, TWITTER_UPLOAD_LIMITS.maxEncryptedArchiveChunkBytes)
    const chunkCount = Math.max(1, Math.ceil(fileSize / chunkSize))
    if (chunkCount > TWITTER_UPLOAD_LIMITS.maxEncryptedArchiveChunkCount) {
      return NextResponse.json({
        success: false,
        error: `Archive requires too many chunks (${chunkCount}).`,
      }, { status: 413 })
    }
    const requestedChunkCount =
      typeof body.chunkCount === 'number' && Number.isFinite(body.chunkCount) && body.chunkCount > 0
        ? Math.floor(body.chunkCount)
        : chunkCount
    if (requestedChunkCount !== chunkCount) {
      return NextResponse.json({
        success: false,
        error: 'chunkCount is invalid for this fileSize/chunkSize.',
      }, { status: 400 })
    }

    const sessionId = randomUUID()
    const sessionPrefix = `${user.id}/encrypted-archives/${backupId}/${sessionId}-${fileName}`

    return NextResponse.json({
      success: true,
      sessionId,
      sessionPrefix,
      chunkSize,
      chunkCount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize encrypted archive upload'
    const status = statusForError(message)
    const clientMessage = status >= 500 ? 'Failed to initialize encrypted archive upload' : message
    console.error('[Encrypted Archive Init] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
