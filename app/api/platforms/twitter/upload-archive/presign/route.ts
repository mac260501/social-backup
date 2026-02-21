import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { validateArchiveUploadRequest } from '@/lib/platforms/twitter/archive-upload-intake'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createSignedPutUrl } from '@/lib/storage/r2'

type PresignBody = {
  fileName?: string
  fileType?: string
  fileSize?: number
}

function statusForArchiveError(message: string): number {
  if (message.includes('already in progress')) return 409
  if (message.includes('Invalid upload type')) return 400
  if (message.includes('empty')) return 400
  if (message.includes('size limit')) return 413
  if (message.includes('Storage limit exceeded')) return 413
  if (message.includes('Unauthorized')) return 401
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

    const body = (await request.json().catch(() => ({}))) as PresignBody
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
    const fileType = typeof body.fileType === 'string' ? body.fileType.trim() : ''
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0

    if (!fileName) {
      return NextResponse.json({ success: false, error: 'fileName is required' }, { status: 400 })
    }

    await validateArchiveUploadRequest({
      userId: user.id,
      fileName,
      fileType,
      fileSize,
    })

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
    const stagedInputPath = `${user.id}/job-inputs/${randomUUID()}-${safeName}`
    const uploadUrl = await createSignedPutUrl(stagedInputPath, {
      expiresInSeconds: 15 * 60,
    })

    return NextResponse.json({
      success: true,
      uploadUrl,
      stagedInputPath,
      expiresInSeconds: 15 * 60,
      method: 'PUT',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create upload URL'
    const status = statusForArchiveError(message)
    const clientMessage = status >= 500 ? 'Failed to create upload URL' : message
    console.error('[Upload Presign] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
