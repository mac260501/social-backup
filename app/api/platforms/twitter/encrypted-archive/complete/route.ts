import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeEncryptedArchiveManifest } from '@/lib/platforms/twitter/encrypted-archive'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { deleteObjectsFromR2 } from '@/lib/storage/r2'
import { recalculateAndPersistBackupStorage } from '@/lib/storage/usage'

const supabase = createAdminClient()

type CompleteEncryptedArchiveBody = {
  backupId?: string
  manifest?: unknown
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readArchivePathFromBackupData(data: Record<string, unknown>, userId: string, backupId: string): string {
  const path =
    typeof data.archive_file_path === 'string'
      ? data.archive_file_path.trim()
      : ''
  if (path) return path
  return `${userId}/archives/${backupId}.zip`
}

function isMissingColumnError(error: unknown, columnName?: string): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  const message = String((error as { message?: unknown }).message || '')
  const normalizedMessage = message.toLowerCase()
  const normalizedCode = typeof code === 'string' ? code.toUpperCase() : ''

  const isPostgresMissingColumn =
    normalizedCode === '42703' || /column .* does not exist/i.test(message)

  const isPostgrestMissingColumn =
    normalizedCode.startsWith('PGRST') &&
    normalizedMessage.includes('could not find') &&
    normalizedMessage.includes('column')

  if (!isPostgresMissingColumn && !isPostgrestMissingColumn) {
    return false
  }
  if (!columnName) return true
  return normalizedMessage.includes(columnName.toLowerCase())
}

function statusForError(message: string): number {
  if (message.includes('Unauthorized')) return 401
  if (message.includes('backupId is required')) return 400
  if (message.includes('Invalid encrypted archive manifest')) return 400
  if (message.includes('Backup not found')) return 404
  if (message.includes('Forbidden')) return 403
  if (message.includes('Encrypted archive chunk path is invalid')) return 400
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

    const body = (await request.json().catch(() => ({}))) as CompleteEncryptedArchiveBody
    const backupId = typeof body.backupId === 'string' ? body.backupId.trim() : ''
    if (!backupId) {
      return NextResponse.json({ success: false, error: 'backupId is required' }, { status: 400 })
    }

    const manifest = normalizeEncryptedArchiveManifest(body.manifest)
    if (!manifest) {
      return NextResponse.json({ success: false, error: 'Invalid encrypted archive manifest' }, { status: 400 })
    }

    const { data: backup, error: backupError } = await supabase
      .from('backups')
      .select('id, user_id, data')
      .eq('id', backupId)
      .maybeSingle()

    if (backupError || !backup) {
      return NextResponse.json({ success: false, error: 'Backup not found' }, { status: 404 })
    }
    if (backup.user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Forbidden - backup ownership mismatch' }, { status: 403 })
    }

    const expectedPrefix = `${user.id}/encrypted-archives/${backupId}/`
    if (manifest.file.chunk_count !== manifest.chunks.length) {
      return NextResponse.json({
        success: false,
        error: 'Invalid encrypted archive manifest',
      }, { status: 400 })
    }
    for (const chunk of manifest.chunks) {
      if (!chunk.storage_path.startsWith(expectedPrefix)) {
        return NextResponse.json({
          success: false,
          error: 'Encrypted archive chunk path is invalid.',
        }, { status: 400 })
      }
    }

    const encryptedArchiveBytes = manifest.chunks.reduce((sum, chunk) => sum + chunk.ciphertext_bytes, 0)
    const existingData = toRecord(backup.data)
    const existingArchivePath = readArchivePathFromBackupData(existingData, user.id, backupId)
    const nextData = {
      ...existingData,
      encrypted_archive: manifest,
      archive_file_path: null,
      uploaded_file_size: encryptedArchiveBytes,
    }

    let { error: updateError } = await supabase
      .from('backups')
      .update({
        data: nextData,
        archive_file_path: null,
      })
      .eq('id', backupId)

    if (updateError && isMissingColumnError(updateError, 'archive_file_path')) {
      const retry = await supabase
        .from('backups')
        .update({
          data: nextData,
        })
        .eq('id', backupId)
      updateError = retry.error
    }

    if (updateError) {
      throw new Error(`Failed to persist encrypted archive metadata: ${updateError.message}`)
    }

    try {
      await deleteObjectsFromR2([existingArchivePath])
    } catch (cleanupError) {
      console.warn('[Encrypted Archive Complete] Failed to delete plain archive object:', cleanupError)
    }

    const { error: mediaDeleteError } = await supabase
      .from('media_files')
      .delete()
      .eq('backup_id', backupId)
      .eq('file_path', existingArchivePath)
    if (mediaDeleteError) {
      console.warn('[Encrypted Archive Complete] Failed to delete plain archive media row:', mediaDeleteError)
    }

    await recalculateAndPersistBackupStorage(supabase, backupId)

    return NextResponse.json({
      success: true,
      encryptedArchiveBytes,
      chunkCount: manifest.chunks.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to finalize encrypted archive storage'
    const status = statusForError(message)
    const clientMessage = status >= 500 ? 'Failed to finalize encrypted archive storage' : message
    console.error('[Encrypted Archive Complete] Error:', error)
    return NextResponse.json({ success: false, error: clientMessage }, { status })
  }
}
