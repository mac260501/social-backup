import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  enqueueArchiveUploadJob,
  validateArchiveUploadRequest,
} from '@/lib/platforms/twitter/archive-upload-intake'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { uploadObjectToR2 } from '@/lib/storage/r2'

function statusForArchiveError(message: string): number {
  if (message.includes('already in progress')) return 409
  if (message.includes('Invalid upload type')) return 400
  if (message.includes('empty')) return 400
  if (message.includes('size limit')) return 413
  if (message.includes('Storage limit exceeded')) return 413
  if (message.includes('Invalid DM encryption payload')) return 400
  if (message.includes('DM encryption is required when importing chats')) return 400
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

    const formData = await request.formData()
    const file = formData.get('file') as File
    const username = (formData.get('username') as string) || user.email?.split('@')[0] || 'twitter-user'
    const importSelection = formData.get('importSelection')
    const dmEncryption = formData.get('dmEncryption')
    const preserveArchiveFile = formData.get('preserveArchiveFile')
    const parsedImportSelection = (() => {
      if (typeof importSelection !== 'string' || !importSelection.trim()) return undefined
      try {
        return JSON.parse(importSelection)
      } catch {
        return undefined
      }
    })()
    const parsedDmEncryption = (() => {
      if (typeof dmEncryption !== 'string' || !dmEncryption.trim()) return undefined
      try {
        return JSON.parse(dmEncryption)
      } catch {
        return undefined
      }
    })()
    const parsedPreserveArchiveFile =
      typeof preserveArchiveFile === 'string'
        ? preserveArchiveFile.trim().toLowerCase() === 'true'
        : undefined

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 })
    }

    await validateArchiveUploadRequest({
      userId: user.id,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const stagedInputPath = `${user.id}/job-inputs/${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

    await uploadObjectToR2({
      key: stagedInputPath,
      body: buffer,
      contentType: file.type || 'application/zip',
      upsert: false,
    })

    const job = await enqueueArchiveUploadJob({
      userId: user.id,
      username,
      fileName: file.name,
      fileSize: file.size,
      stagedInputPath,
      importSelection: parsedImportSelection,
      dmEncryption: parsedDmEncryption,
      preserveArchiveFile: parsedPreserveArchiveFile,
    })

    return NextResponse.json({
      success: true,
      message: 'Archive uploaded. Your backup job is now processing in the background.',
      job,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    const status = statusForArchiveError(message)
    const clientMessage = status >= 500 ? 'Failed to upload archive' : message
    console.error('Upload enqueue error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
