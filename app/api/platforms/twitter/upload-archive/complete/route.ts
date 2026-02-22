import { NextResponse } from 'next/server'
import {
  enqueueArchiveUploadJob,
  ensureUserScopedStagedPath,
  validateArchiveUploadRequest,
} from '@/lib/platforms/twitter/archive-upload-intake'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getObjectMetadataFromR2 } from '@/lib/storage/r2'

type CompleteUploadBody = {
  stagedInputPath?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  username?: string
  importSelection?: unknown
  dmEncryption?: unknown
  preserveArchiveFile?: boolean
}

function statusForArchiveError(message: string): number {
  if (message.includes('already in progress')) return 409
  if (message.includes('Invalid upload type')) return 400
  if (message.includes('empty')) return 400
  if (message.includes('size limit')) return 413
  if (message.includes('Storage limit exceeded')) return 413
  if (message.includes('Invalid staged upload path')) return 400
  if (message.includes('Invalid DM encryption payload')) return 400
  if (message.includes('DM encryption is required when importing chats')) return 400
  if (message.includes('Uploaded file not found')) return 404
  if (message.includes('Inngest API Error')) return 502
  if (message.includes('Inngest is not configured')) return 502
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

    const body = (await request.json().catch(() => ({}))) as CompleteUploadBody
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
    const fileType = typeof body.fileType === 'string' ? body.fileType.trim() : ''
    const bodyFileSize = typeof body.fileSize === 'number' ? body.fileSize : 0
    const username =
      (typeof body.username === 'string' && body.username.trim()) ||
      user.email?.split('@')[0] ||
      'twitter-user'

    if (!fileName) {
      return NextResponse.json({ success: false, error: 'fileName is required' }, { status: 400 })
    }

    const stagedInputPath = ensureUserScopedStagedPath(body.stagedInputPath || '', user.id)
    const metadata = await getObjectMetadataFromR2(stagedInputPath)
    if (!metadata) {
      return NextResponse.json({ success: false, error: 'Uploaded file not found. Please retry upload.' }, { status: 404 })
    }

    const resolvedSize = typeof metadata.contentLength === 'number' && metadata.contentLength > 0
      ? metadata.contentLength
      : bodyFileSize

    await validateArchiveUploadRequest({
      userId: user.id,
      fileName,
      fileType,
      fileSize: resolvedSize,
    })

    const job = await enqueueArchiveUploadJob({
      userId: user.id,
      username,
      fileName,
      fileSize: resolvedSize,
      stagedInputPath,
      importSelection: body.importSelection,
      dmEncryption: body.dmEncryption,
      preserveArchiveFile: body.preserveArchiveFile,
    })

    return NextResponse.json({
      success: true,
      message: 'Archive uploaded. Your backup job is now processing in the background.',
      job,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to finalize upload'
    const status = statusForArchiveError(message)
    const clientMessage = status >= 500 ? 'Failed to finalize upload' : message
    console.error('[Upload Complete] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
