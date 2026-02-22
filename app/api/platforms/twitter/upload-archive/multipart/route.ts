import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  enqueueArchiveUploadJob,
  ensureUserScopedStagedPath,
  validateArchiveUploadRequest,
} from '@/lib/platforms/twitter/archive-upload-intake'
import { createClient as createServerClient } from '@/lib/supabase/server'
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  createSignedUploadPartUrl,
  getObjectMetadataFromR2,
  type MultipartUploadPart,
} from '@/lib/storage/r2'

const MULTIPART_UPLOAD_PART_SIZE_BYTES = 8 * 1024 * 1024

type MultipartInitBody = {
  action: 'init'
  fileName?: string
  fileType?: string
  fileSize?: number
}

type MultipartSignBody = {
  action: 'sign'
  stagedInputPath?: string
  uploadId?: string
  partNumber?: number
}

type MultipartCompleteBody = {
  action: 'complete'
  stagedInputPath?: string
  uploadId?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  username?: string
  startProcessing?: boolean
  importSelection?: unknown
  dmEncryption?: unknown
  preserveArchiveFile?: boolean
  parts?: Array<{
    partNumber?: number
    etag?: string
  }>
}

type MultipartAbortBody = {
  action: 'abort'
  stagedInputPath?: string
  uploadId?: string
}

type MultipartBody = MultipartInitBody | MultipartSignBody | MultipartCompleteBody | MultipartAbortBody

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
  if (message.includes('Unauthorized')) return 401
  if (message.includes('Inngest API Error')) return 502
  if (message.includes('Inngest is not configured')) return 502
  return 500
}

function getSafeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function parseMultipartParts(value: unknown): MultipartUploadPart[] {
  if (!Array.isArray(value)) return []
  return value
    .map((part) => {
      if (!part || typeof part !== 'object') return null
      const record = part as Record<string, unknown>
      const partNumber =
        typeof record.partNumber === 'number'
          ? record.partNumber
          : typeof record.partNumber === 'string'
            ? Number.parseInt(record.partNumber, 10)
            : Number.NaN
      const etag = typeof record.etag === 'string' ? record.etag.trim() : ''
      if (!Number.isInteger(partNumber) || partNumber < 1 || !etag) return null
      return {
        partNumber,
        etag,
      }
    })
    .filter((value): value is MultipartUploadPart => Boolean(value))
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

    const body = (await request.json().catch(() => ({}))) as MultipartBody

    if (body.action === 'init') {
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

      const stagedInputPath = `${user.id}/job-inputs/${randomUUID()}-${getSafeFileName(fileName)}`
      const multipart = await createMultipartUpload(stagedInputPath, {
        contentType: fileType || 'application/zip',
      })

      const totalParts = Math.max(1, Math.ceil(fileSize / MULTIPART_UPLOAD_PART_SIZE_BYTES))

      return NextResponse.json({
        success: true,
        stagedInputPath,
        uploadId: multipart.uploadId,
        partSize: MULTIPART_UPLOAD_PART_SIZE_BYTES,
        totalParts,
      })
    }

    if (body.action === 'sign') {
      const stagedInputPath = ensureUserScopedStagedPath(body.stagedInputPath || '', user.id)
      const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : ''
      const partNumber = typeof body.partNumber === 'number' ? body.partNumber : Number.NaN

      if (!uploadId) {
        return NextResponse.json({ success: false, error: 'uploadId is required' }, { status: 400 })
      }
      if (!Number.isInteger(partNumber) || partNumber < 1) {
        return NextResponse.json({ success: false, error: 'partNumber must be a positive integer' }, { status: 400 })
      }

      const uploadUrl = await createSignedUploadPartUrl(stagedInputPath, {
        uploadId,
        partNumber,
        expiresInSeconds: 15 * 60,
      })

      return NextResponse.json({
        success: true,
        uploadUrl,
      })
    }

    if (body.action === 'complete') {
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
      const fileType = typeof body.fileType === 'string' ? body.fileType.trim() : ''
      const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0
      const startProcessing = body.startProcessing !== false
      const username =
        (typeof body.username === 'string' && body.username.trim()) ||
        user.email?.split('@')[0] ||
        'twitter-user'
      const stagedInputPath = ensureUserScopedStagedPath(body.stagedInputPath || '', user.id)
      const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : ''
      const parts = parseMultipartParts(body.parts)

      if (!fileName) {
        return NextResponse.json({ success: false, error: 'fileName is required' }, { status: 400 })
      }
      if (!uploadId) {
        return NextResponse.json({ success: false, error: 'uploadId is required' }, { status: 400 })
      }
      if (parts.length === 0) {
        return NextResponse.json({ success: false, error: 'parts are required' }, { status: 400 })
      }

      await completeMultipartUpload(stagedInputPath, {
        uploadId,
        parts,
      })

      const metadata = await getObjectMetadataFromR2(stagedInputPath)
      if (!metadata) {
        return NextResponse.json({ success: false, error: 'Uploaded file not found. Please retry upload.' }, { status: 404 })
      }

      const resolvedSize =
        typeof metadata.contentLength === 'number' && metadata.contentLength > 0
          ? metadata.contentLength
          : fileSize

      if (!startProcessing) {
        return NextResponse.json({
          success: true,
          stagedInputPath,
          fileSize: resolvedSize,
          message: 'Archive upload complete. Review archive contents before importing.',
        })
      }

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
    }

    if (body.action === 'abort') {
      const stagedInputPath = ensureUserScopedStagedPath(body.stagedInputPath || '', user.id)
      const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : ''

      if (!uploadId) {
        return NextResponse.json({ success: false, error: 'uploadId is required' }, { status: 400 })
      }

      await abortMultipartUpload(stagedInputPath, { uploadId })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Invalid multipart action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process multipart upload'
    const status = statusForArchiveError(message)
    const clientMessage = status >= 500 ? 'Failed to process multipart upload' : message
    console.error('[Multipart Upload] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
