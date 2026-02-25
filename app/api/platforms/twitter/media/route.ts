import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestActorId } from '@/lib/request-actor'
import { getShareGrantFromCookies } from '@/lib/share-links'
import { createSignedGetUrl, normalizeStoragePath } from '@/lib/storage/r2'

const supabase = createAdminClient()

function asPath(value: string | null): string | null {
  if (!value) return null
  const normalized = normalizeStoragePath(value)
  return normalized.length > 0 ? normalized : null
}

export async function GET(request: Request) {
  try {
    const actorId = await getRequestActorId()
    const shareGrant = await getShareGrantFromCookies()
    if (!actorId && !shareGrant) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const rawPath = searchParams.get('path')
    const storagePath = asPath(rawPath)

    if (!storagePath) {
      return NextResponse.json({ success: false, error: 'path is required' }, { status: 400 })
    }

    let allowed = false

    if (actorId && storagePath.startsWith(`${actorId}/`)) {
      allowed = true
    }

    if (!allowed && actorId) {
      const { data: mediaFile, error: mediaError } = await supabase
        .from('media_files')
        .select('id')
        .eq('user_id', actorId)
        .eq('file_path', storagePath)
        .maybeSingle()

      if (!mediaError && mediaFile) {
        allowed = true
      }
    }

    if (!allowed && actorId) {
      const { data: backup } = await supabase
        .from('backups')
        .select('id')
        .eq('user_id', actorId)
        .eq('archive_file_path', storagePath)
        .maybeSingle()

      if (backup) {
        allowed = true
      }
    }

    if (!allowed && shareGrant) {
      const { data: sharedMedia } = await supabase
        .from('media_files')
        .select('id')
        .eq('backup_id', shareGrant.backupId)
        .eq('file_path', storagePath)
        .maybeSingle()
      if (sharedMedia) {
        allowed = true
      }
    }

    if (!allowed && shareGrant) {
      const { data: sharedArchive } = await supabase
        .from('backups')
        .select('id')
        .eq('id', shareGrant.backupId)
        .eq('archive_file_path', storagePath)
        .maybeSingle()
      if (sharedArchive) {
        allowed = true
      }
    }

    if (!allowed) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const signedUrl = await createSignedGetUrl(storagePath, { expiresInSeconds: 120 })
    return NextResponse.redirect(signedUrl, { status: 302 })
  } catch (error) {
    console.error('[Media Proxy] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch media' }, { status: 500 })
  }
}
