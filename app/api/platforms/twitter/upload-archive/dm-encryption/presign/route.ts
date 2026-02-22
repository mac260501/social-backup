import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { TWITTER_UPLOAD_LIMITS } from '@/lib/platforms/twitter/limits'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createSignedPutUrl } from '@/lib/storage/r2'

type DmEncryptionPresignBody = {
  fileName?: string
  fileSize?: number
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
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

    const body = (await request.json().catch(() => ({}))) as DmEncryptionPresignBody
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : 'encrypted-dms.json'
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0

    if (!fileSize || fileSize <= 0) {
      return NextResponse.json({ success: false, error: 'Encrypted DM payload is empty.' }, { status: 400 })
    }

    if (fileSize > TWITTER_UPLOAD_LIMITS.maxEncryptedDmPayloadBytes) {
      return NextResponse.json(
        {
          success: false,
          error: `Encrypted DM payload exceeds size limit (${TWITTER_UPLOAD_LIMITS.maxEncryptedDmPayloadBytes} bytes).`,
        },
        { status: 413 },
      )
    }

    const stagedInputPath = `${user.id}/job-inputs/${randomUUID()}-${sanitizeFileName(fileName)}`
    const uploadUrl = await createSignedPutUrl(stagedInputPath, {
      expiresInSeconds: 15 * 60,
      contentType: 'application/json',
    })

    return NextResponse.json({
      success: true,
      uploadUrl,
      stagedInputPath,
      expiresInSeconds: 15 * 60,
      method: 'PUT',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create encrypted DM upload URL'
    const status = message.includes('Unauthorized') ? 401 : 500
    const clientMessage = status >= 500 ? 'Failed to create encrypted DM upload URL' : message
    console.error('[DM Encryption Presign] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
